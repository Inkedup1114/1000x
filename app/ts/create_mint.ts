import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  ExtensionType,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as dotenv from "dotenv";
import bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
  const devWallet = new PublicKey(process.env.DEV_WALLET!);
  const hookProgramId = new PublicKey(process.env.PROGRAM_ID!);
  const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));
  
  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  console.log("Mint address:", mintKeypair.publicKey.toBase58());
  
  // Calculate mint account size with extensions
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
  
  // Initialize transfer fee (10% = 1000 basis points)
  const transferFeeConfigIx = createInitializeTransferFeeConfigInstruction(
    mintKeypair.publicKey,
    payer.publicKey, // transfer fee config authority
    burnerAuthority.publicKey, // withdraw withheld authority
    1000, // 10% fee in basis points
    BigInt("100000000000000000"), // max fee (large number)
    TOKEN_2022_PROGRAM_ID
  );
  
  // Initialize transfer hook
  const transferHookIx = createInitializeTransferHookInstruction(
    mintKeypair.publicKey,
    payer.publicKey, // hook authority
    hookProgramId,
    TOKEN_2022_PROGRAM_ID
  );
  
  // Initialize mint
  const initMintIx = createInitializeMintInstruction(
    mintKeypair.publicKey,
    9, // decimals
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority
    TOKEN_2022_PROGRAM_ID
  );
  
  // Create transaction
  const tx = new Transaction().add(
    createAccountIx,
    transferFeeConfigIx,
    transferHookIx,
    initMintIx
  );
  
  // Send transaction
  const sig = await sendAndConfirmTransaction(
    connection,
    tx,
    [payer, mintKeypair],
    { commitment: "confirmed" }
  );
  
  console.log("Mint created! Signature:", sig);
  
  // Initialize hook config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mintKeypair.publicKey.toBuffer()],
    hookProgramId
  );
  
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed" }
  );
  
  const idl = await Program.fetchIdl(hookProgramId, provider);
  const program = new Program(idl!, provider);
  
  await program.methods
    .initialize(devWallet)
    .accounts({
      payer: payer.publicKey,
      config: configPda,
      mint: mintKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  console.log("Hook config initialized!");
  
  // Create dev wallet ATA
  const devAta = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    devWallet,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  const createAtaIx = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    devAta,
    devWallet,
    mintKeypair.publicKey,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Mint total supply to dev wallet (1000 tokens = 1000 * 10^9)
  const mintToIx = createMintToInstruction(
    mintKeypair.publicKey,
    devAta,
    payer.publicKey,
    BigInt("1000000000000"),
    [],
    TOKEN_2022_PROGRAM_ID
  );
  
  const mintTx = new Transaction().add(createAtaIx, mintToIx);
  const mintSig = await sendAndConfirmTransaction(
    connection,
    mintTx,
    [payer],
    { commitment: "confirmed" }
  );
  
  console.log("Total supply minted to dev wallet! Signature:", mintSig);
  console.log("✅ Wallet cap set to 5 tokens (0.5% of supply)");
  console.log("\nSave this mint address in .env:", mintKeypair.publicKey.toBase58());
}

main().catch(console.error);
