import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Connection,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
  const hookProgramId = new PublicKey(process.env.PROGRAM_ID!);
  const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
  const devWallet = new PublicKey(process.env.DEV_WALLET!);
  
  console.log("Initializing hook config...");
  console.log("Hook Program ID:", hookProgramId.toString());
  console.log("Mint Address:", mintAddress.toString());
  console.log("Dev Wallet:", devWallet.toString());
  console.log("Payer:", payer.publicKey.toString());
  
  // Derive hook config PDA
  const [hookConfigPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mintAddress.toBuffer()],
    hookProgramId
  );
  
  console.log("Hook Config PDA:", hookConfigPda.toString());
  console.log("Bump:", bump);
  
  // Check if hook config exists
  const existingAccount = await connection.getAccountInfo(hookConfigPda);
  if (existingAccount) {
    console.log("✅ Hook config already exists!");
    console.log("Account owner:", existingAccount.owner.toString());
    console.log("Account data length:", existingAccount.data.length);
    return;
  }
  
  // Try using native Anchor approach first (if IDL is available)
  try {
    console.log("Attempting Anchor approach...");
    
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(payer),
      { commitment: "confirmed" }
    );
    
    // Try to fetch IDL
    const idl = await anchor.Program.fetchIdl(hookProgramId, provider);
    if (idl) {
      console.log("✅ IDL found! Using Anchor approach...");
      const program = new anchor.Program(idl, provider);
      
      const tx = await program.methods
        .initialize(devWallet)
        .accounts({
          payer: payer.publicKey,
          config: hookConfigPda,
          mint: mintAddress,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log("✅ Hook config initialized with Anchor!");
      console.log("Transaction signature:", tx);
      return;
    }
  } catch (error: any) {
    console.log("❌ Anchor approach failed:", error?.message || "Unknown error");
    console.log("Falling back to raw instruction approach...");
  }
  
  // Raw instruction approach
  console.log("Using raw instruction approach...");
  
  // Calculate required space for HookConfig (32 bytes pubkey + 8 bytes u64)
  const space = 8 + 32 + 8; // discriminator + dev_wallet + wallet_cap_raw
  const lamports = await connection.getMinimumBalanceForRentExemption(space);
  
  console.log("Required space:", space, "bytes");
  console.log("Required lamports:", lamports);
  
  // Create instruction data for initialize
  const instructionData = Buffer.alloc(8 + 32); // discriminator + pubkey
  
  // Anchor function discriminator for "initialize"
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  discriminator.copy(instructionData, 0);
  
  // Dev wallet pubkey
  devWallet.toBuffer().copy(instructionData, 8);
  
  // Create accounts array
  const accounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: hookConfigPda, isSigner: false, isWritable: true },
    { pubkey: mintAddress, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  // Create instruction
  const instruction = new TransactionInstruction({
    keys: accounts,
    programId: hookProgramId,
    data: instructionData,
  });
  
  // Create and send transaction
  const transaction = new Transaction().add(instruction);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      { commitment: "confirmed" }
    );
    
    console.log("✅ Hook config initialized with raw instruction!");
    console.log("Transaction signature:", signature);
    
    // Verify the account was created
    const verifyAccount = await connection.getAccountInfo(hookConfigPda);
    if (verifyAccount) {
      console.log("✅ Verification: Account created with", verifyAccount.data.length, "bytes");
      console.log("Account owner:", verifyAccount.owner.toString());
    }
    
  } catch (error: any) {
    console.error("❌ Error initializing hook config:", error);
    if (error?.logs) {
      console.log("Transaction logs:", error.logs);
    }
  }
}

main().catch(console.error);
