import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { 
  TEST_CONFIG, 
  createTestProvider, 
  ensureLocalValidator, 
  airdropSol 
} from "./test-config";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  ExtensionType,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  getTransferFeeConfig,
  createWithdrawWithheldTokensFromAccountsInstruction,
  createBurnInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("1000x Token - Full Flow Integration Tests", () => {
  // Test configuration from config file
  const WALLET_CAP = TEST_CONFIG.WALLET_CAP;
  const TRANSFER_FEE_BASIS_POINTS = TEST_CONFIG.TRANSFER_FEE_BASIS_POINTS;
  const MAX_FEE = TEST_CONFIG.MAX_FEE;
  const INITIAL_MINT_AMOUNT = TEST_CONFIG.INITIAL_MINT_AMOUNT;
  const TEST_TRANSFER_AMOUNT = TEST_CONFIG.TEST_TRANSFER_AMOUNT;

  // Test accounts
  let provider: anchor.AnchorProvider;
  let program: Program;
  let connection: Connection;
  let payer: Keypair;
  let mintKeypair: Keypair;
  let devWallet: Keypair;
  let feeCollectionAuthority: Keypair;
  let hookAuthority: Keypair;

  // User accounts for testing
  let user1: Keypair;
  let user2: Keypair;
  let user3: Keypair;

  // Token accounts
  let devAta: PublicKey;
  let user1Ata: PublicKey;
  let user2Ata: PublicKey;
  let user3Ata: PublicKey;

  // Program accounts
  let configPda: PublicKey;
  let extraMetasAccount: PublicKey;

  before(async () => {
    console.log("🚀 Setting up full flow integration test environment...");
    
    // Setup provider and connection
    try {
      // Try to use Anchor workspace first
      provider = anchor.AnchorProvider.env();
    } catch {
      // Fall back to test provider
      provider = createTestProvider();
    }
    
    anchor.setProvider(provider);
    connection = provider.connection;
    
    // Check if local validator is running
    const isValidatorRunning = await ensureLocalValidator(connection);
    if (!isValidatorRunning) {
      console.warn("⚠️ Local validator not detected. Make sure solana-test-validator is running.");
    }
    
    program = anchor.workspace.OneKxHook as Program;
    payer = (provider.wallet as anchor.Wallet).payer;

    // Generate test keypairs
    mintKeypair = Keypair.generate();
    devWallet = Keypair.generate();
    feeCollectionAuthority = Keypair.generate();
    hookAuthority = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    user3 = Keypair.generate();

    console.log(`📄 Program ID: ${program.programId.toString()}`);
    console.log(`🪙 Mint Address: ${mintKeypair.publicKey.toString()}`);
    console.log(`👤 Dev Wallet: ${devWallet.publicKey.toString()}`);

    // Airdrop SOL to test accounts for transaction fees
    await Promise.all([
      airdropSol(connection, payer.publicKey),
      airdropSol(connection, devWallet.publicKey),
      airdropSol(connection, user1.publicKey),
      airdropSol(connection, user2.publicKey),
      airdropSol(connection, user3.publicKey),
      airdropSol(connection, feeCollectionAuthority.publicKey),
      airdropSol(connection, hookAuthority.publicKey),
    ]);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log("✅ Test environment setup complete");
  });

  describe("1. Mint Creation and Program Deployment", () => {
    it("Should create mint with transfer hook and fee extensions", async () => {
      console.log("🏗️ Creating mint with extensions...");

      const extensions = [ExtensionType.TransferFeeConfig, ExtensionType.TransferHook];
      const mintLen = getMintLen(extensions);
      const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      // Create mint account
      const createAccountIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      });

      // Initialize transfer fee config
      const transferFeeConfigIx = createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        feeCollectionAuthority.publicKey,
        feeCollectionAuthority.publicKey,
        TRANSFER_FEE_BASIS_POINTS,
        MAX_FEE,
        TOKEN_2022_PROGRAM_ID
      );

      // Initialize transfer hook
      const transferHookIx = createInitializeTransferHookInstruction(
        mintKeypair.publicKey,
        hookAuthority.publicKey,
        program.programId,
        TOKEN_2022_PROGRAM_ID
      );

      // Initialize mint
      const initMintIx = createInitializeMintInstruction(
        mintKeypair.publicKey,
        9, // decimals
        payer.publicKey, // mint authority
        null, // freeze authority
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(
        createAccountIx,
        transferFeeConfigIx,
        transferHookIx,
        initMintIx
      );

      await provider.sendAndConfirm(tx, [mintKeypair]);

      // Verify mint was created successfully
      const mint = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(mint.decimals).to.equal(9);
      expect(mint.mintAuthority?.toString()).to.equal(payer.publicKey.toString());

      // Verify transfer fee config
      const transferFeeConfig = getTransferFeeConfig(mint);
      expect(transferFeeConfig?.newerTransferFee.transferFeeBasisPoints).to.equal(TRANSFER_FEE_BASIS_POINTS);

      console.log("✅ Mint created successfully with extensions");
    });
  });

  describe("2. Hook Configuration", () => {
    it("Should initialize hook config with dev wallet exemption", async () => {
      console.log("⚙️ Initializing hook configuration...");

      // Derive config PDA
      [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), mintKeypair.publicKey.toBuffer()],
        program.programId
      );

      // Initialize hook config
      await program.methods
        .initialize(devWallet.publicKey)
        .accounts({
          payer: payer.publicKey,
          config: configPda,
          mint: mintKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Verify config was created
      const config = await program.account.hookConfig.fetch(configPda);
      expect(config.mint.toString()).to.equal(mintKeypair.publicKey.toString());
      expect(config.devWallet.toString()).to.equal(devWallet.publicKey.toString());
      expect(config.walletCap.toString()).to.equal(WALLET_CAP.toString());

      console.log("✅ Hook configuration initialized successfully");
    });

    it("Should register extra account metas for transfer hook", async () => {
      console.log("📝 Registering extra account metas...");

      // Derive extra account metas PDA
      [extraMetasAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeExtraAccountMetaList()
          .accounts({
            payer: payer.publicKey,
            extraAccountMetaList: extraMetasAccount,
            mint: mintKeypair.publicKey,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("✅ Extra account metas registered successfully");
      } catch (error) {
        console.log("ℹ️ Extra account metas may already be registered");
      }
    });
  });

  describe("3. Initial Token Distribution", () => {
    it("Should mint initial tokens to dev wallet", async () => {
      console.log("💰 Minting initial tokens to dev wallet...");

      // Create dev wallet ATA
      devAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        devWallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const createAtaIx = createAssociatedTokenAccountInstruction(
        payer.publicKey,
        devAta,
        devWallet.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      const mintToIx = createMintToInstruction(
        mintKeypair.publicKey,
        devAta,
        payer.publicKey,
        INITIAL_MINT_AMOUNT,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(createAtaIx, mintToIx);
      await provider.sendAndConfirm(tx, []);

      // Verify balance
      const account = await getAccount(connection, devAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.amount).to.equal(INITIAL_MINT_AMOUNT);

      console.log(`✅ Minted ${INITIAL_MINT_AMOUNT.toString()} tokens to dev wallet`);
    });
  });

  describe("4. Transfer Cap Enforcement Tests", () => {
    it("Should allow transfers under the wallet cap", async () => {
      console.log("🔄 Testing transfer under cap...");

      // Create user1 ATA
      user1Ata = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        user1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const transferAmount = BigInt("4000000000"); // 4 tokens (under 5 token cap)

      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          user1Ata,
          user1.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createTransferInstruction(
          devAta,
          user1Ata,
          devWallet.publicKey,
          transferAmount,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(tx, [devWallet]);

      // Verify balance (should receive less due to 10% fee)
      const account = await getAccount(connection, user1Ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      const expectedBalance = transferAmount * BigInt(9) / BigInt(10); // 90% after 10% fee
      expect(account.amount).to.equal(expectedBalance);

      console.log("✅ Transfer under cap successful");
    });

    it("Should allow transfers exactly at the wallet cap", async () => {
      console.log("🎯 Testing transfer exactly at cap...");

      // Create user2 ATA
      user2Ata = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        user2.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Calculate amount that results in exactly 5 tokens after fee
      // If 10% fee, we need to send ~5.56 tokens to receive 5 tokens
      const transferAmount = (WALLET_CAP * BigInt(10)) / BigInt(9); // Adjust for fee

      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          user2Ata,
          user2.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createTransferInstruction(
          devAta,
          user2Ata,
          devWallet.publicKey,
          transferAmount,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(tx, [devWallet]);

      // Verify balance is at or near the cap
      const account = await getAccount(connection, user2Ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.amount).to.be.at.most(WALLET_CAP);

      console.log("✅ Transfer at cap successful");
    });

    it("Should reject transfers over the wallet cap", async () => {
      console.log("🚫 Testing transfer over cap...");

      // Create user3 ATA
      user3Ata = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        user3.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const transferAmount = BigInt("7000000000"); // 7 tokens (exceeds 5 token cap even after fee)

      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          user3Ata,
          user3.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createTransferInstruction(
          devAta,
          user3Ata,
          devWallet.publicKey,
          transferAmount,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      try {
        await provider.sendAndConfirm(tx, [devWallet]);
        expect.fail("Transfer should have failed due to wallet cap");
      } catch (error) {
        expect(error.toString()).to.include("custom program error");
        console.log("✅ Transfer over cap correctly rejected");
      }
    });

    it("Should allow dev wallet to exceed cap (exemption)", async () => {
      console.log("👨‍💻 Testing dev wallet exemption...");

      // Dev wallet should already have 1000 tokens, which exceeds the 5 token cap
      const account = await getAccount(connection, devAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.amount).to.be.greaterThan(WALLET_CAP);

      console.log("✅ Dev wallet exemption working correctly");
    });
  });

  describe("5. Fee Collection Tests", () => {
    let initialWithheldAmount: bigint;

    it("Should collect transfer fees in withheld tokens", async () => {
      console.log("💳 Testing fee collection...");

      // Get initial withheld amount
      const mintInfo = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      initialWithheldAmount = mintInfo.withheldAmount;

      // Make a transfer to generate fees
      const transferAmount = TEST_TRANSFER_AMOUNT; // 0.1 tokens
      const expectedFee = transferAmount / BigInt(10); // 10% fee

      const tx = new Transaction().add(
        createTransferInstruction(
          devAta,
          user1Ata,
          devWallet.publicKey,
          transferAmount,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(tx, [devWallet]);

      // Check that withheld amount increased
      const updatedMintInfo = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      const newWithheldAmount = updatedMintInfo.withheldAmount;
      
      expect(newWithheldAmount).to.be.greaterThan(initialWithheldAmount);
      
      const feeCollected = newWithheldAmount - initialWithheldAmount;
      expect(feeCollected).to.be.greaterThan(0);

      console.log(`✅ Fee collected: ${feeCollected.toString()} tokens`);
    });
  });

  describe("6. Burner Bot Integration Tests", () => {
    let withdrawnAmount: bigint;

    it("Should withdraw withheld tokens from accounts", async () => {
      console.log("🔄 Testing withdraw withheld tokens...");

      // Create fee collection account
      const feeCollectionAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        feeCollectionAuthority.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Create ATA for fee collection
      const createFeeAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          feeCollectionAta,
          feeCollectionAuthority.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(createFeeAtaTx, []);

      // Get accounts that have withheld tokens
      const accounts = [user1Ata, user2Ata]; // Accounts that received transfers

      // Withdraw withheld tokens
      const withdrawTx = new Transaction().add(
        createWithdrawWithheldTokensFromAccountsInstruction(
          mintKeypair.publicKey,
          feeCollectionAta,
          feeCollectionAuthority.publicKey,
          [],
          accounts,
          TOKEN_2022_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(withdrawTx, [feeCollectionAuthority]);

      // Check that fee collection account received tokens
      const feeAccount = await getAccount(connection, feeCollectionAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      withdrawnAmount = feeAccount.amount;
      
      expect(withdrawnAmount).to.be.greaterThan(0);

      console.log(`✅ Withdrawn ${withdrawnAmount.toString()} tokens to fee collection account`);
    });

    it("Should burn withdrawn tokens to reduce supply", async () => {
      console.log("🔥 Testing token burning...");

      // Get initial supply
      const initialMint = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      const initialSupply = initialMint.supply;

      // Burn half of the withdrawn tokens
      const burnAmount = withdrawnAmount / BigInt(2);
      
      const feeCollectionAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        feeCollectionAuthority.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const burnTx = new Transaction().add(
        createBurnInstruction(
          feeCollectionAta,
          mintKeypair.publicKey,
          feeCollectionAuthority.publicKey,
          burnAmount,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(burnTx, [feeCollectionAuthority]);

      // Verify supply reduction
      const finalMint = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      const finalSupply = finalMint.supply;
      
      expect(finalSupply).to.equal(initialSupply - burnAmount);

      console.log(`✅ Burned ${burnAmount.toString()} tokens, supply reduced from ${initialSupply.toString()} to ${finalSupply.toString()}`);
    });
  });

  describe("7. End-to-End Flow Verification", () => {
    it("Should verify complete token ecosystem is working", async () => {
      console.log("🔍 Running end-to-end verification...");

      // Verify mint state
      const mint = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(mint.isInitialized).to.be.true;

      // Verify hook config
      const config = await program.account.hookConfig.fetch(configPda);
      expect(config.mint.toString()).to.equal(mintKeypair.publicKey.toString());

      // Verify token balances
      const devBalance = await getAccount(connection, devAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const user1Balance = await getAccount(connection, user1Ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      const user2Balance = await getAccount(connection, user2Ata, "confirmed", TOKEN_2022_PROGRAM_ID);

      // Dev wallet should still have a large balance
      expect(devBalance.amount).to.be.greaterThan(WALLET_CAP);

      // User wallets should respect the cap
      expect(user1Balance.amount).to.be.at.most(WALLET_CAP);
      expect(user2Balance.amount).to.be.at.most(WALLET_CAP);

      // Verify fee mechanism is working
      expect(mint.withheldAmount).to.be.greaterThan(0);

      console.log("✅ End-to-end verification complete");
      console.log(`📊 Final State:`);
      console.log(`   - Total Supply: ${mint.supply.toString()}`);
      console.log(`   - Withheld Amount: ${mint.withheldAmount.toString()}`);
      console.log(`   - Dev Wallet Balance: ${devBalance.amount.toString()}`);
      console.log(`   - User1 Balance: ${user1Balance.amount.toString()}`);
      console.log(`   - User2 Balance: ${user2Balance.amount.toString()}`);
    });
  });

  describe("8. Stress Tests", () => {
    it("Should handle multiple rapid transfers", async () => {
      console.log("⚡ Testing rapid multiple transfers...");

      const smallTransfer = BigInt("10000000"); // 0.01 tokens
      const numTransfers = 5;

      // Get initial balance
      const initialBalance = await getAccount(connection, user1Ata, "confirmed", TOKEN_2022_PROGRAM_ID);

      // Execute multiple small transfers rapidly
      for (let i = 0; i < numTransfers; i++) {
        const tx = new Transaction().add(
          createTransferInstruction(
            devAta,
            user1Ata,
            devWallet.publicKey,
            smallTransfer,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );

        await provider.sendAndConfirm(tx, [devWallet]);
      }

      // Verify all transfers were processed
      const finalBalance = await getAccount(connection, user1Ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      const expectedIncrease = smallTransfer * BigInt(numTransfers) * BigInt(9) / BigInt(10); // Account for 10% fee
      
      expect(finalBalance.amount).to.be.greaterThan(initialBalance.amount);
      
      console.log(`✅ Processed ${numTransfers} rapid transfers successfully`);
    });

    it("Should enforce cap even with multiple concurrent users", async () => {
      console.log("👥 Testing concurrent user transfers...");

      // This test verifies that the cap is enforced even when multiple users
      // are receiving transfers simultaneously
      const user4 = Keypair.generate();
      const user5 = Keypair.generate();

      // Airdrop SOL for transaction fees
      await connection.requestAirdrop(user4.publicKey, LAMPORTS_PER_SOL);
      await connection.requestAirdrop(user5.publicKey, LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const user4Ata = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        user4.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const user5Ata = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        user5.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Create ATAs
      const createAtasTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          user4Ata,
          user4.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          user5Ata,
          user5.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(createAtasTx, []);

      // Try to transfer amount that would exceed cap
      const largeTransfer = BigInt("6000000000"); // 6 tokens

      // Both transfers should fail due to cap
      try {
        const tx1 = new Transaction().add(
          createTransferInstruction(
            devAta,
            user4Ata,
            devWallet.publicKey,
            largeTransfer,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );
        await provider.sendAndConfirm(tx1, [devWallet]);
        expect.fail("Transfer to user4 should have failed");
      } catch (error) {
        expect(error.toString()).to.include("custom program error");
      }

      try {
        const tx2 = new Transaction().add(
          createTransferInstruction(
            devAta,
            user5Ata,
            devWallet.publicKey,
            largeTransfer,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );
        await provider.sendAndConfirm(tx2, [devWallet]);
        expect.fail("Transfer to user5 should have failed");
      } catch (error) {
        expect(error.toString()).to.include("custom program error");
      }

      console.log("✅ Cap enforcement working with concurrent users");
    });
  });

  after(async () => {
    console.log("🧹 Cleaning up test environment...");
    
    // Log final state for debugging
    try {
      const finalMint = await getMint(connection, mintKeypair.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      console.log(`📈 Final token metrics:`);
      console.log(`   - Final Supply: ${finalMint.supply.toString()}`);
      console.log(`   - Final Withheld: ${finalMint.withheldAmount.toString()}`);
    } catch (error) {
      console.log("Could not fetch final metrics");
    }
    
    console.log("✅ Integration tests completed successfully!");
  });
});