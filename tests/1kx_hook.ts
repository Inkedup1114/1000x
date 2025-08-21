import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
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
} from "@solana/spl-token";

describe("1kx_hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.OneKxHook as Program;
  const mintKeypair = Keypair.generate();
  const devWallet = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  let devAta: PublicKey;

  it("Enforces wallet cap", async () => {
    // Setup mint with hook
    const extensions = [ExtensionType.TransferFeeConfig, ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    // Create mint with extensions
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const transferFeeConfigIx = createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      provider.wallet.publicKey,
      provider.wallet.publicKey,
      1000, // 10% fee
      BigInt("100000000000000000"),
      TOKEN_2022_PROGRAM_ID
    );

    const transferHookIx = createInitializeTransferHookInstruction(
      mintKeypair.publicKey,
      provider.wallet.publicKey,
      program.programId,
      TOKEN_2022_PROGRAM_ID
    );

    const initMintIx = createInitializeMintInstruction(
      mintKeypair.publicKey,
      9,
      provider.wallet.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(
      createAccountIx,
      transferFeeConfigIx,
      transferHookIx,
      initMintIx
    );

    await provider.sendAndConfirm(tx, [mintKeypair]);

    // Initialize hook config
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mintKeypair.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize(devWallet.publicKey)
      .accounts({
        payer: provider.wallet.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Test: Dev wallet can hold more than cap
    devAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      devWallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          devAta,
          devWallet.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createMintToInstruction(
          mintKeypair.publicKey,
          devAta,
          provider.wallet.publicKey,
          BigInt("1000000000000"), // 1000 tokens
          [],
          TOKEN_2022_PROGRAM_ID
        )
      ),
      []
    );

    // Test: Regular user cannot exceed cap (6 tokens > 5 token cap)
    const user1Ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      user1.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    try {
      await provider.sendAndConfirm(
        new Transaction().add(
          createAssociatedTokenAccountInstruction(
            provider.wallet.publicKey,
            user1Ata,
            user1.publicKey,
            mintKeypair.publicKey,
            TOKEN_2022_PROGRAM_ID
          ),
          createTransferInstruction(
            devAta,
            user1Ata,
            devWallet.publicKey,
            BigInt("6000000000"), // 6 tokens (exceeds 5 token cap)
            [],
            TOKEN_2022_PROGRAM_ID
          )
        ),
        [devWallet]
      );
      expect.fail("Should have failed due to wallet cap");
    } catch (error) {
      expect(error.toString()).to.include("custom program error");
    }

    console.log("✅ Wallet cap enforcement working!");

    // Test: Transfer under cap should succeed (4 tokens < 5 token cap)
    const user3 = Keypair.generate();
    const user3Ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      user3.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          user3Ata,
          user3.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createTransferInstruction(
          devAta,
          user3Ata,
          devWallet.publicKey,
          BigInt("4000000000"), // 4 tokens (under 5 token cap)
          [],
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [devWallet]
    );

    console.log("✅ Transfer under cap successful!");
  });

  it("Applies 10% transfer fee", async () => {
    // Transfer 1 token, expect 0.9 received (0.1 fee)
    const user2Ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      user2.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          user2Ata,
          user2.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        ),
        createTransferInstruction(
          devAta,
          user2Ata,
          devWallet.publicKey,
          BigInt("100000000"), // 0.1 tokens
          [],
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [devWallet]
    );

    const account = await getAccount(
      provider.connection,
      user2Ata,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    // With 10% fee, 0.1 tokens should result in 0.09 received
    expect(account.amount.toString()).to.equal("90000000");
    console.log("✅ Transfer fee working!");
  });
});
