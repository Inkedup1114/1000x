# Technical Specification: 1000x Token Hook Program

## Overview

This document provides detailed technical specifications for the 1000x Token Transfer Hook Program, including Program Derived Addresses (PDAs), account data layouts, and instruction interfaces.

## Program Information

- **Program ID**: `HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2`
- **Anchor Version**: 0.30.0
- **Solana Program Type**: Anchor-based
- **Purpose**: Enforce wallet cap limits on Token-2022 transfers

## Program Derived Addresses (PDAs)

### 1. Hook Configuration PDA

**Seeds**: `["config", mint_address]`

**Purpose**: Stores wallet cap limit and developer wallet exemption

**Derivation**:
```rust
let (hook_config_pda, bump) = Pubkey::find_program_address(
    &[b"config", mint_address.as_ref()],
    program_id,
);
```

**TypeScript Derivation**:
```typescript
const [hookConfigPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("config"), mintAddress.toBuffer()],
  programId
);
```

### 2. Extra Account Meta List PDA

**Seeds**: `["extra-account-metas", mint_address]`

**Purpose**: Specifies additional accounts required during hook execution

**Derivation**:
```rust
let (extra_account_meta_list_pda, bump) = Pubkey::find_program_address(
    &[b"extra-account-metas", mint_address.as_ref()],
    program_id,
);
```

**TypeScript Derivation**:
```typescript
const [extraAccountMetaListPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mintAddress.toBuffer()],
  programId
);
```

## Account Data Layouts

### Hook Configuration Account

**Account Type**: `HookConfig`
**Size**: 106 bytes total (8 + 1 + 32 + 8 + 32 + 25)

| Offset | Size | Field | Type | Description |
|--------|------|-------|------|-------------|
| 0 | 8 | discriminator | `[u8; 8]` | Anchor account discriminator |
| 8 | 1 | `version` | `u8` | Configuration version for future compatibility |
| 9 | 32 | `dev_wallet` | `Pubkey` | Developer wallet (exempt from cap) |
| 41 | 8 | `wallet_cap_raw` | `u64` | Maximum tokens per wallet (lamports) |
| 49 | 32 | `governance_authority` | `Pubkey` | Governance authority for updates |
| 81 | 25 | `pending_cap_update` | `Option<PendingCapUpdate>` | Timelock pending updates |

**Rust Definition**:
```rust
#[account]
pub struct HookConfig {
    pub version: u8,
    pub dev_wallet: Pubkey,
    pub wallet_cap_raw: u64,
    pub governance_authority: Pubkey,
    pub pending_cap_update: Option<PendingCapUpdate>,
}
```

**Current Values**:
- `dev_wallet`: `Gz8dQdJi4eDWckdNPk52LgfDKu6dDABM2YPf8KtQWaX5`
- `wallet_cap_raw`: `5_000_000_000` (5 tokens with 9 decimals)

### Extra Account Meta List Account

**Account Type**: `ExtraAccountMetaList` (from spl-tlv-account-resolution)
**Size**: 128 bytes (allocated space)

**Structure**: TLV (Type-Length-Value) format
- **TLV Header**: 8 bytes
- **List Header**: Variable size
- **Account Metas**: Variable size per entry

**Current Configuration**:
```rust
vec![
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"config".to_vec() },
            Seed::AccountKey { index: 0 }, // mint address
        ],
        false, // is_signer
        false, // is_writable
    )?,
]
```

This configuration tells the runtime to automatically include the Hook Configuration PDA when executing the transfer hook.

## Versioning Strategy

### Overview

The `HookConfig` struct includes a `version` field to support future upgrades and migrations while maintaining backward compatibility.

### Version History

- **Version 1** (Current): Initial implementation with governance and timelock features
  - Basic wallet cap enforcement
  - Dev wallet exemption  
  - Configurable wallet caps with 48-hour timelock
  - Account ownership validation
  - Governance authority controls

### Migration Framework

The hook includes a migration system for future upgrades:

#### Migration Instruction

```rust
pub fn migrate_config(ctx: Context<MigrateConfig>, target_version: u8) -> Result<()>
```

**Requirements:**
- Only governance authority can initiate migrations
- Target version must be greater than current version
- Migration path must be supported

**Events:**
- Emits `ConfigMigrated` event with version details

#### Migration Logic

Migrations are handled through a match statement supporting version-specific upgrade paths:

```rust
match (current_version, target_version) {
    // Future migrations will be added here
    // Example: (1, 2) => { /* migrate from v1 to v2 */ },
    _ => return Err(HookError::UnsupportedMigration.into()),
}
```

### Adding New Versions

When adding a new version:

1. **Update maximum supported version** in `migrate_config`
2. **Add migration logic** for the new version path
3. **Update documentation** with new version features
4. **Test migration paths** thoroughly

### Best Practices

#### Backward Compatibility
- Avoid removing fields from existing versions
- Add new fields at the end of structs when possible
- Maintain support for reading older versions

#### Migration Safety
- Always validate migration prerequisites
- Use governance authority requirement for migrations
- Emit events for migration tracking
- Test all migration paths thoroughly

## Program Instructions

### 1. Initialize Hook Configuration

**Function**: `initialize`
**Purpose**: Creates and initializes the hook configuration PDA

**Accounts**:
| Index | Name | Type | Signer | Writable | Description |
|-------|------|------|--------|----------|-------------|
| 0 | `payer` | `Signer` | ✓ | ✓ | Transaction fee payer |
| 1 | `config` | `HookConfig` | ✗ | ✓ | Hook config PDA (to be created) |
| 2 | `mint` | `UncheckedAccount` | ✗ | ✗ | Token mint address |
| 3 | `system_program` | `System` | ✗ | ✗ | System program |

**Instruction Data**:
```rust
pub struct InitializeData {
    dev_wallet: Pubkey,
}
```

**Space Allocation**: 48 bytes (8 discriminator + 32 pubkey + 8 u64)

### 2. Initialize Extra Account Meta List

**Function**: `init_extra_account_meta_list`
**Purpose**: Creates the extra account meta list PDA

**Accounts**:
| Index | Name | Type | Signer | Writable | Description |
|-------|------|------|--------|----------|-------------|
| 0 | `payer` | `Signer` | ✓ | ✓ | Transaction fee payer |
| 1 | `extra_account_meta_list` | `UncheckedAccount` | ✗ | ✓ | Extra account meta PDA |
| 2 | `mint` | `UncheckedAccount` | ✗ | ✗ | Token mint address |
| 3 | `system_program` | `System` | ✗ | ✗ | System program |

**Space Allocation**: 128 bytes

### 3. Transfer Hook

**Function**: `transfer_hook`
**Purpose**: Validates wallet cap before transfer execution

**Accounts**:
| Index | Name | Type | Signer | Writable | Description |
|-------|------|------|--------|----------|-------------|
| 0 | `source` | `UncheckedAccount` | ✗ | ✗ | Source token account |
| 1 | `mint` | `UncheckedAccount` | ✗ | ✗ | Token mint |
| 2 | `destination` | `UncheckedAccount` | ✗ | ✗ | Destination token account |
| 3 | `owner` | `UncheckedAccount` | ✗ | ✗ | Transfer authority |
| 4 | `extra_account_meta_list` | `UncheckedAccount` | ✗ | ✗ | Extra account meta list |
| 5 | `config` | `HookConfig` | ✗ | ✗ | Hook configuration |
| 6 | `token_program` | `Token2022` | ✗ | ✗ | Token program |

**Validation Logic**:
1. Parse destination token account
2. Calculate post-transfer balance: `current_balance + transfer_amount`
3. Check if post-balance ≤ `wallet_cap_raw`
4. Allow transfer if under cap, reject if over cap

### 4. Execute Hook (SPL Interface)

**Function**: `execute`
**Purpose**: Alternative entry point for SPL Transfer Hook Interface

**Accounts**: Same as transfer_hook with UncheckedAccount types

**Validation**: Identical logic to transfer_hook

## Error Codes

| Code | Name | Message |
|------|------|---------|
| 6000 | `WalletCapExceeded` | "Wallet cap exceeded" |
| 6001 | `InsufficientAccountSpace` | "Insufficient account space for ExtraAccountMetaList" |
| 6002 | `UnauthorizedGovernance` | "Unauthorized governance operation" |
| 6003 | `InvalidWalletCap` | "Invalid wallet cap value" |
| 6004 | `NoPendingUpdate` | "No pending cap update" |
| 6005 | `TimelockNotExpired` | "Timelock period has not expired" |
| 6006 | `InvalidAccountOwner` | "Invalid account owner" |
| 6007 | `InvalidMigrationVersion` | "Invalid migration version" |
| 6008 | `UnsupportedVersion` | "Unsupported version" |
| 6009 | `UnsupportedMigration` | "Unsupported migration path" |

## Constants

```rust
// Wallet cap: 5 tokens with 9 decimals
const WALLET_CAP_RAW: u64 = 5_000_000_000;

// Space allocation for extra account meta list
const EXTRA_ACCOUNT_META_LIST_SIZE: usize = 128;
```

## Integration Examples

### Token Transfer with Hook

When performing a transfer that triggers the hook:

**Required Accounts** (automatically resolved):
1. Source token account
2. Token mint
3. Destination token account
4. Transfer authority
5. **Hook Configuration PDA** (resolved from extra account metas)
6. Token-2022 program

**Example Transfer Call**:
```typescript
import { 
  createTransferInstruction,
  TOKEN_2022_PROGRAM_ID 
} from "@solana/spl-token";

// Standard transfer instruction
// Hook accounts are automatically included by Token-2022 program
const transferInstruction = createTransferInstruction(
  sourceTokenAccount,
  destinationTokenAccount,
  authority,
  amount,
  [],
  TOKEN_2022_PROGRAM_ID
);
```

### Hook Validation Flow

1. **User initiates transfer** via any Token-2022 compatible interface
2. **Token program** checks for transfer hook extension on mint
3. **Token program** resolves extra account metas from PDA
4. **Token program** calls hook program with required accounts
5. **Hook program** validates destination balance won't exceed cap
6. **Transfer completes** if validation passes, **fails** if cap exceeded

### Fee Collection and Burning

The transfer fee (10%) is handled by Token-2022's built-in extension:

1. **Transfer fee** automatically withheld during transfers
2. **Burner bot** periodically calls `withdrawWithheldTokensFromAccounts`
3. **Collected fees** transferred to burner authority's ATA
4. **Burner bot** calls `burn` instruction to permanently remove tokens

## Security Considerations

### Access Control

- **Hook Configuration**: Only payer can initialize (one-time setup)
- **Wallet Cap**: Immutable after initialization (no update instruction)
- **Dev Wallet**: Fixed at initialization, cannot be changed

### Attack Vectors

**Attempted Circumvention**:
- ✅ **Self-transfers**: Hook validates destination balance regardless of source
- ✅ **Multi-step transfers**: Each transfer individually validated
- ✅ **CPI calls**: Hook executes on all Token-2022 transfers

**Resource Exhaustion**:
- ✅ **Compute limits**: Hook uses minimal compute units
- ✅ **Account limits**: Only 1 additional account required
- ✅ **Storage limits**: Fixed-size account data

### Known Limitations

1. **Dev wallet exemption**: Implicit (validation only applies to destination)
2. **Cap adjustment**: No instruction to modify cap post-deployment
3. **Emergency pause**: No mechanism to temporarily halt transfers

## Deployment Information

### Current Devnet Deployment

- **Program**: `HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2`
- **Mint**: `EYfH82983Mq85apeFGnz4wH4Xaexjun5MToNQfYevKic`
- **Hook Config**: `Bss3giGqbbhMU1m59z9SgfjbQe6Ah2ggkQSW7WbjG92w`
- **Extra Account Metas**: *Pending deployment*

### Upgrade Authority

Current upgrade authority: `Gz8dQdJi4eDWckdNPk52LgfDKu6dDABM2YPf8KtQWaX5`

**Recommendations for Mainnet**:
- Transfer to multisig or governance program
- Implement timelock for upgrade protection
- Consider burning upgrade authority for immutability

## Monitoring and Maintenance

### Health Checks

Monitor these account states:
1. **Hook Config PDA**: Should exist and contain correct values
2. **Extra Account Metas PDA**: Should exist and be properly formatted
3. **Program upgrades**: Monitor upgrade authority actions

### Operational Metrics

Track these on-chain metrics:
1. **Transfer success rate**: Percentage of transfers that pass hook validation
2. **Cap violations**: Number of transfers rejected due to wallet cap
3. **Fee collection**: Amount of fees collected and burned over time

### Emergency Procedures

**If hook malfunction detected**:
1. Investigate through transaction logs and simulation
2. Deploy program fix if needed (requires upgrade authority)
3. Monitor transfer patterns for unexpected behavior

**If burner bot fails**:
1. Check service health and logs
2. Manual fee withdrawal and burning if needed
3. Restart automated service after issue resolution

For implementation details and current status, see [TODO.md](../TODO.md) and [README.md](../README.md).
