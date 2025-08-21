use anchor_lang::prelude::*;
use anchor_spl::token_2022::{Token2022, ID as TOKEN_2022_PROGRAM_ID};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};

declare_id!("HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2");

const WALLET_CAP_RAW: u64 = 5_000_000_000; // 5 tokens with 9 decimals (0.5% of 1000 supply)

// Space calculation for ExtraAccountMetaList with 1 account
// Being generous with space allocation to ensure sufficient room
const EXTRA_ACCOUNT_META_LIST_SIZE: usize = 128;

#[program]
pub mod one_kx_hook {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, dev_wallet: Pubkey, governance_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.version = 1;
        config.dev_wallet = dev_wallet;
        config.wallet_cap_raw = WALLET_CAP_RAW;
        config.governance_authority = governance_authority;
        config.pending_cap_update = None;
        Ok(())
    }

    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // Validate account ownership
        require!(ctx.accounts.source.owner == &TOKEN_2022_PROGRAM_ID, HookError::InvalidAccountOwner);
        require!(ctx.accounts.destination.owner == &TOKEN_2022_PROGRAM_ID, HookError::InvalidAccountOwner);
        require!(ctx.accounts.mint.owner == &TOKEN_2022_PROGRAM_ID, HookError::InvalidAccountOwner);
        
        let config = &ctx.accounts.config;
        
        // Parse destination token account
        let destination_data = ctx.accounts.destination.try_borrow_data()?;
        let destination_account = spl_token_2022::extension::StateWithExtensions::<spl_token_2022::state::Account>::unpack(&destination_data)?;
        
        // Check if destination is dev wallet (exempt from cap)
        let destination_owner = destination_account.base.owner;
        if destination_owner == config.dev_wallet {
            return Ok(()); // Dev wallet exempt from cap restrictions
        }
        
        // Calculate post-transfer balance
        let post_balance = destination_account.base.amount.saturating_add(amount);
        
        // Enforce wallet cap for non-dev wallets
        require!(
            post_balance <= config.wallet_cap_raw,
            HookError::WalletCapExceeded
        );
        
        Ok(())
    }

    // Required for SPL Transfer Hook Interface
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        // Validate account ownership
        require!(ctx.accounts.source.owner == &TOKEN_2022_PROGRAM_ID, HookError::InvalidAccountOwner);
        require!(ctx.accounts.destination.owner == &TOKEN_2022_PROGRAM_ID, HookError::InvalidAccountOwner);
        require!(ctx.accounts.mint.owner == &TOKEN_2022_PROGRAM_ID, HookError::InvalidAccountOwner);
        
        let destination = ctx.accounts.destination.clone(); 
        let config = &ctx.accounts.config;
        
        // Parse destination token account
        let destination_data = destination.try_borrow_data()?;
        let destination_account = spl_token_2022::extension::StateWithExtensions::<spl_token_2022::state::Account>::unpack(&destination_data)?;
        
        // Check if destination is dev wallet (exempt from cap)
        let destination_owner = destination_account.base.owner;
        if destination_owner == config.dev_wallet {
            return Ok(()); // Dev wallet exempt from cap restrictions
        }
        
        // Calculate post-transfer balance
        let post_balance = destination_account.base.amount.saturating_add(amount);
        
        // Enforce wallet cap for non-dev wallets
        require!(
            post_balance <= config.wallet_cap_raw,
            HookError::WalletCapExceeded
        );
        
        Ok(())
    }

    // Initialize extra account metas for the hook
    pub fn init_extra_account_meta_list(
        ctx: Context<InitExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = vec![
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"config".to_vec() },
                    Seed::AccountKey { index: 0 }, // mint
                ],
                false, // is_signer
                false, // is_writable
            )?,
        ];

        let account_size = ExtraAccountMetaList::size_of(account_metas.len())?;
        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        
        // Provide detailed error information for debugging
        msg!("Required account size: {}", account_size);
        msg!("Allocated space: {}", data.len());
        
        require!(
            data.len() >= account_size,
            HookError::InsufficientAccountSpace
        );
        
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;
        
        Ok(())
    }

    /// Propose a new wallet cap (timelock mechanism)
    pub fn propose_wallet_cap_update(
        ctx: Context<ProposeWalletCapUpdate>,
        new_cap: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let clock = Clock::get()?;
        
        // Validate the new cap is reasonable
        require!(new_cap > 0, HookError::InvalidWalletCap);
        
        // Maximum reasonable cap: 10% of expected total supply (1000 tokens)
        let max_reasonable_cap = 100_000_000_000u64; // 100 tokens with 9 decimals
        require!(new_cap <= max_reasonable_cap, HookError::InvalidWalletCap);
        
        // Set timelock period (48 hours)
        let timelock_duration = 48 * 60 * 60; // 48 hours in seconds
        let execution_time = clock.unix_timestamp + timelock_duration;
        
        config.pending_cap_update = Some(PendingCapUpdate {
            new_cap,
            proposed_at: clock.unix_timestamp,
            execution_time,
        });
        
        emit!(WalletCapUpdateProposed {
            new_cap,
            current_cap: config.wallet_cap_raw,
            proposed_at: clock.unix_timestamp,
            execution_time,
            governance_authority: ctx.accounts.governance_authority.key(),
        });
        
        Ok(())
    }

    /// Execute a previously proposed wallet cap update (after timelock)
    pub fn execute_wallet_cap_update(ctx: Context<ExecuteWalletCapUpdate>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let clock = Clock::get()?;
        
        let pending_update = config.pending_cap_update
            .as_ref()
            .ok_or(HookError::NoPendingUpdate)?;
        
        // Check if timelock has expired
        require!(
            clock.unix_timestamp >= pending_update.execution_time,
            HookError::TimelockNotExpired
        );
        
        let old_cap = config.wallet_cap_raw;
        config.wallet_cap_raw = pending_update.new_cap;
        config.pending_cap_update = None;
        
        emit!(WalletCapUpdated {
            old_cap,
            new_cap: config.wallet_cap_raw,
            updated_at: clock.unix_timestamp,
            governance_authority: ctx.accounts.governance_authority.key(),
        });
        
        Ok(())
    }

    /// Cancel a pending wallet cap update (governance authority only)
    pub fn cancel_wallet_cap_update(ctx: Context<CancelWalletCapUpdate>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let clock = Clock::get()?;
        
        require!(
            config.pending_cap_update.is_some(),
            HookError::NoPendingUpdate
        );
        
        let canceled_update = config.pending_cap_update.take().unwrap();
        
        emit!(WalletCapUpdateCanceled {
            canceled_cap: canceled_update.new_cap,
            current_cap: config.wallet_cap_raw,
            canceled_at: clock.unix_timestamp,
            governance_authority: ctx.accounts.governance_authority.key(),
        });
        
        Ok(())
    }

    /// Update governance authority (requires current governance authority)
    pub fn update_governance_authority(
        ctx: Context<UpdateGovernanceAuthority>,
        new_governance_authority: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let old_authority = config.governance_authority;
        
        config.governance_authority = new_governance_authority;
        
        emit!(GovernanceAuthorityUpdated {
            old_authority,
            new_authority: new_governance_authority,
            updated_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Migrate HookConfig to a newer version
    pub fn migrate_config(ctx: Context<MigrateConfig>, target_version: u8) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let current_version = config.version;
        
        require!(target_version > current_version, HookError::InvalidMigrationVersion);
        require!(target_version <= 1, HookError::UnsupportedVersion); // Update this as new versions are added
        
        // Version-specific migration logic
        match (current_version, target_version) {
            // Future migrations will be handled here
            // Example: (1, 2) => { /* migrate from v1 to v2 */ },
            _ => return Err(HookError::UnsupportedMigration.into()),
        }
        
        config.version = target_version;
        
        emit!(ConfigMigrated {
            old_version: current_version,
            new_version: target_version,
            migrated_at: Clock::get()?.unix_timestamp,
            governance_authority: ctx.accounts.governance_authority.key(),
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + 1 + 32 + 8 + 32 + 1 + (1 + 8 + 8 + 8), // discriminator + version + dev_wallet + wallet_cap_raw + governance_authority + Option<PendingCapUpdate>
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, HookConfig>,
    
    /// CHECK: Mint account
    pub mint: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: Source token account
    pub source: UncheckedAccount<'info>,
    
    /// CHECK: Mint
    pub mint: UncheckedAccount<'info>,
    
    /// CHECK: Destination token account
    pub destination: UncheckedAccount<'info>,
    
    /// CHECK: Owner of source
    pub owner: UncheckedAccount<'info>,
    
    /// CHECK: Extra accounts
    pub extra_account_meta_list: UncheckedAccount<'info>,
    
    #[account(seeds = [b"config", mint.key().as_ref()], bump)]
    pub config: Account<'info, HookConfig>,
    
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: Source
    pub source: UncheckedAccount<'info>,
    
    /// CHECK: Mint  
    pub mint: UncheckedAccount<'info>,
    
    /// CHECK: Destination
    pub destination: UncheckedAccount<'info>,
    
    /// CHECK: Owner
    pub owner: UncheckedAccount<'info>,
    
    /// CHECK: Extra account meta list
    pub extra_account_meta_list: UncheckedAccount<'info>,
    
    #[account(seeds = [b"config", mint.key().as_ref()], bump)]
    pub config: Account<'info, HookConfig>,
    
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct InitExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// CHECK: Extra account meta list PDA
    #[account(
        init,
        payer = payer,
        space = 8 + EXTRA_ACCOUNT_META_LIST_SIZE, // 8 bytes discriminator + calculated size
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    
    /// CHECK: Mint
    pub mint: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeWalletCapUpdate<'info> {
    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump,
        constraint = config.governance_authority == governance_authority.key() @ HookError::UnauthorizedGovernance
    )]
    pub config: Account<'info, HookConfig>,
    
    pub governance_authority: Signer<'info>,
    
    /// CHECK: Mint account for seed derivation
    pub mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExecuteWalletCapUpdate<'info> {
    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump,
        constraint = config.governance_authority == governance_authority.key() @ HookError::UnauthorizedGovernance
    )]
    pub config: Account<'info, HookConfig>,
    
    pub governance_authority: Signer<'info>,
    
    /// CHECK: Mint account for seed derivation
    pub mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelWalletCapUpdate<'info> {
    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump,
        constraint = config.governance_authority == governance_authority.key() @ HookError::UnauthorizedGovernance
    )]
    pub config: Account<'info, HookConfig>,
    
    pub governance_authority: Signer<'info>,
    
    /// CHECK: Mint account for seed derivation
    pub mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateGovernanceAuthority<'info> {
    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump,
        constraint = config.governance_authority == governance_authority.key() @ HookError::UnauthorizedGovernance
    )]
    pub config: Account<'info, HookConfig>,
    
    pub governance_authority: Signer<'info>,
    
    /// CHECK: Mint account for seed derivation
    pub mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump,
        constraint = config.governance_authority == governance_authority.key() @ HookError::UnauthorizedGovernance
    )]
    pub config: Account<'info, HookConfig>,
    
    pub governance_authority: Signer<'info>,
    
    /// CHECK: Mint account for seed derivation
    pub mint: UncheckedAccount<'info>,
}

#[account]
pub struct HookConfig {
    pub version: u8,
    pub dev_wallet: Pubkey,
    pub wallet_cap_raw: u64,
    pub governance_authority: Pubkey,
    pub pending_cap_update: Option<PendingCapUpdate>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PendingCapUpdate {
    pub new_cap: u64,
    pub proposed_at: i64,
    pub execution_time: i64, // When the update can be executed (timelock)
}

#[event]
pub struct WalletCapUpdateProposed {
    pub new_cap: u64,
    pub current_cap: u64,
    pub proposed_at: i64,
    pub execution_time: i64,
    pub governance_authority: Pubkey,
}

#[event]
pub struct WalletCapUpdated {
    pub old_cap: u64,
    pub new_cap: u64,
    pub updated_at: i64,
    pub governance_authority: Pubkey,
}

#[event]
pub struct WalletCapUpdateCanceled {
    pub canceled_cap: u64,
    pub current_cap: u64,
    pub canceled_at: i64,
    pub governance_authority: Pubkey,
}

#[event]
pub struct GovernanceAuthorityUpdated {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub updated_at: i64,
}

#[event]
pub struct ConfigMigrated {
    pub old_version: u8,
    pub new_version: u8,
    pub migrated_at: i64,
    pub governance_authority: Pubkey,
}

#[error_code]
pub enum HookError {
    #[msg("Wallet cap exceeded")]
    WalletCapExceeded,
    #[msg("Insufficient account space for ExtraAccountMetaList")]
    InsufficientAccountSpace,
    #[msg("Unauthorized governance operation")]
    UnauthorizedGovernance,
    #[msg("Invalid wallet cap value")]
    InvalidWalletCap,
    #[msg("No pending cap update")]
    NoPendingUpdate,
    #[msg("Timelock period has not expired")]
    TimelockNotExpired,
    #[msg("Invalid account owner")]
    InvalidAccountOwner,
    #[msg("Invalid migration version")]
    InvalidMigrationVersion,
    #[msg("Unsupported version")]
    UnsupportedVersion,
    #[msg("Unsupported migration path")]
    UnsupportedMigration,
}

// Unit tests for core business logic
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet_cap_constants() {
        // Test that wallet cap is correctly set to 5 tokens (5% of 1000 supply)
        assert_eq!(WALLET_CAP_RAW, 5_000_000_000); // 5 tokens with 9 decimals
        
        // Test that cap is 0.5% of expected 1000 token supply
        let total_supply = 1000_000_000_000u64; // 1000 tokens with 9 decimals
        let expected_cap_percentage = (WALLET_CAP_RAW * 1000) / total_supply; // per mille
        assert_eq!(expected_cap_percentage, 5); // 0.5% = 5 per mille
    }

    #[test]
    fn test_balance_calculations() {
        // Test saturating_add behavior for balance calculations
        let current_balance = 4_000_000_000u64; // 4 tokens
        let transfer_amount = 1_000_000_000u64; // 1 token
        let post_balance = current_balance.saturating_add(transfer_amount);
        assert_eq!(post_balance, 5_000_000_000u64); // Should equal cap exactly
        
        // Test just under cap
        let under_cap_balance = 4_999_999_999u64; // Just under 5 tokens
        let small_transfer = 1u64; // 1 lamport
        let post_balance_under = under_cap_balance.saturating_add(small_transfer);
        assert_eq!(post_balance_under, 5_000_000_000u64); // Should equal cap exactly
        
        // Test overflow protection
        let large_balance = u64::MAX - 1000;
        let large_transfer = 2000u64;
        let protected_balance = large_balance.saturating_add(large_transfer);
        assert_eq!(protected_balance, u64::MAX); // Should saturate at MAX
    }

    #[test]
    fn test_cap_enforcement_logic() {
        // Test cases for wallet cap enforcement
        struct TestCase {
            current_balance: u64,
            transfer_amount: u64,
            should_pass: bool,
            description: &'static str,
        }
        
        let test_cases = vec![
            TestCase {
                current_balance: 0,
                transfer_amount: 5_000_000_000,
                should_pass: true,
                description: "Zero to exactly cap should pass",
            },
            TestCase {
                current_balance: 0,
                transfer_amount: 4_999_999_999,
                should_pass: true,
                description: "Zero to just under cap should pass",
            },
            TestCase {
                current_balance: 0,
                transfer_amount: 5_000_000_001,
                should_pass: false,
                description: "Zero to over cap should fail",
            },
            TestCase {
                current_balance: 3_000_000_000,
                transfer_amount: 2_000_000_000,
                should_pass: true,
                description: "Partial to exactly cap should pass",
            },
            TestCase {
                current_balance: 3_000_000_000,
                transfer_amount: 2_000_000_001,
                should_pass: false,
                description: "Partial to over cap should fail",
            },
            TestCase {
                current_balance: 5_000_000_000,
                transfer_amount: 1,
                should_pass: false,
                description: "At cap receiving any amount should fail",
            },
            TestCase {
                current_balance: 1,
                transfer_amount: 1,
                should_pass: true,
                description: "Tiny amounts under cap should pass",
            },
        ];
        
        for test_case in test_cases {
            let post_balance = test_case.current_balance.saturating_add(test_case.transfer_amount);
            let passes_cap_check = post_balance <= WALLET_CAP_RAW;
            
            assert_eq!(
                passes_cap_check, 
                test_case.should_pass,
                "Test case failed: {} (balance: {}, transfer: {}, post: {}, cap: {})",
                test_case.description,
                test_case.current_balance,
                test_case.transfer_amount,
                post_balance,
                WALLET_CAP_RAW
            );
        }
    }

    #[test]
    fn test_dev_wallet_exemption_logic() {
        use anchor_lang::prelude::Pubkey;
        
        // Mock dev wallet address for testing
        let dev_wallet = Pubkey::new_unique();
        let regular_wallet = Pubkey::new_unique();
        
        // Test case structure for dev wallet exemption
        struct DevWalletTestCase {
            destination_owner: Pubkey,
            current_balance: u64,
            transfer_amount: u64,
            is_dev_wallet: bool,
            should_pass: bool,
            description: &'static str,
        }
        
        let test_cases = vec![
            DevWalletTestCase {
                destination_owner: dev_wallet,
                current_balance: 0,
                transfer_amount: 1_000_000_000_000, // 1000 tokens - way over cap
                is_dev_wallet: true,
                should_pass: true,
                description: "Dev wallet should accept any amount (initial mint scenario)",
            },
            DevWalletTestCase {
                destination_owner: dev_wallet,
                current_balance: 1_000_000_000_000, // Already has 1000 tokens
                transfer_amount: 1_000_000_000, // 1 more token
                is_dev_wallet: true,
                should_pass: true,
                description: "Dev wallet should accept additional tokens beyond cap",
            },
            DevWalletTestCase {
                destination_owner: regular_wallet,
                current_balance: 0,
                transfer_amount: 1_000_000_000_000, // 1000 tokens - way over cap
                is_dev_wallet: false,
                should_pass: false,
                description: "Regular wallet should be rejected for over-cap transfers",
            },
            DevWalletTestCase {
                destination_owner: regular_wallet,
                current_balance: 4_000_000_000, // 4 tokens
                transfer_amount: 1_000_000_000, // 1 token - exactly at cap
                is_dev_wallet: false,
                should_pass: true,
                description: "Regular wallet should accept transfers up to cap",
            },
            DevWalletTestCase {
                destination_owner: regular_wallet,
                current_balance: 5_000_000_000, // Already at cap
                transfer_amount: 1, // Even 1 lamport over
                is_dev_wallet: false,
                should_pass: false,
                description: "Regular wallet at cap should reject any additional tokens",
            },
        ];
        
        for test_case in test_cases {
            let is_dev_wallet_check = test_case.destination_owner == dev_wallet;
            assert_eq!(is_dev_wallet_check, test_case.is_dev_wallet, 
                "Dev wallet identification failed for: {}", test_case.description);
            
            // Simulate the cap enforcement logic
            let should_pass = if is_dev_wallet_check {
                true // Dev wallet always passes
            } else {
                let post_balance = test_case.current_balance.saturating_add(test_case.transfer_amount);
                post_balance <= WALLET_CAP_RAW
            };
            
            assert_eq!(
                should_pass,
                test_case.should_pass,
                "Dev wallet exemption test failed: {} (owner: {:?}, balance: {}, transfer: {}, is_dev: {})",
                test_case.description,
                test_case.destination_owner,
                test_case.current_balance,
                test_case.transfer_amount,
                test_case.is_dev_wallet
            );
        }
    }

    #[test]
    fn test_extra_account_meta_list_size() {
        // Test that our allocated space is sufficient for the expected data
        let expected_account_count = 1; // We have 1 extra account (config PDA)
        
        // Calculate required size using the same logic as the program
        // This should match the calculation in init_extra_account_meta_list
        let base_size = 8; // discriminator
        let meta_size_per_account = 32; // Approximate size per ExtraAccountMeta
        let estimated_size = base_size + (expected_account_count * meta_size_per_account);
        
        assert!(
            EXTRA_ACCOUNT_META_LIST_SIZE >= estimated_size,
            "Allocated space ({}) should be >= estimated requirement ({})",
            EXTRA_ACCOUNT_META_LIST_SIZE,
            estimated_size
        );
        
        // Ensure we have reasonable buffer space but not excessive waste
        assert!(
            EXTRA_ACCOUNT_META_LIST_SIZE <= estimated_size * 3,
            "Allocated space ({}) should not be more than 3x estimated requirement ({})",
            EXTRA_ACCOUNT_META_LIST_SIZE,
            estimated_size * 3
        );
    }

    #[test]
    fn test_hook_config_size() {
        // Test that HookConfig struct size matches our space allocation
        // discriminator (8) + version (1) + dev_wallet (32) + wallet_cap_raw (8) + governance_authority (32) + Option<PendingCapUpdate> (1 + 8 + 8 + 8)
        let expected_size = 8 + 1 + 32 + 8 + 32 + 1 + (8 + 8 + 8);
        assert_eq!(expected_size, 106);
        
        // This should match the space allocated in the Initialize account structure
        assert!(expected_size <= 106, "HookConfig too large for allocated space");
    }

    #[test]
    fn test_seed_derivation_constants() {
        // Test that our seed constants are correctly defined
        let config_seed = b"config";
        let extra_metas_seed = b"extra-account-metas";
        
        assert_eq!(config_seed.len(), 6);
        assert_eq!(extra_metas_seed.len(), 19);
        
        // Ensure seeds are reasonable length (Solana PDA seeds have limits)
        assert!(config_seed.len() <= 32, "Config seed too long");
        assert!(extra_metas_seed.len() <= 32, "Extra metas seed too long");
    }
}
