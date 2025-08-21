import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Connection,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  ConfirmOptions,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import * as bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

// Enhanced configuration with retry and verification settings
interface Config {
  maxRetries: number;
  retryDelayMs: number;
  confirmationTimeout: number;
  verificationAttempts: number;
}

const CONFIG: Config = {
  maxRetries: 5,
  retryDelayMs: 2000,
  confirmationTimeout: 60000,
  verificationAttempts: 3,
};

// Helper function to sleep for specified milliseconds
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

// Enhanced error types for better error handling
class ProgramNotDeployedError extends Error {
  constructor(programId: string) {
    super(`Program ${programId} is not deployed or not executable`);
    this.name = "ProgramNotDeployedError";
  }
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

class SpaceAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpaceAllocationError";
  }
}

// Verify program is deployed and executable
async function verifyProgramDeployment(
  connection: Connection, 
  programId: PublicKey
): Promise<void> {
  console.log("🔍 Verifying program deployment...");
  
  try {
    const programAccount = await connection.getAccountInfo(programId);
    
    if (!programAccount) {
      throw new ProgramNotDeployedError(programId.toString());
    }
    
    if (!programAccount.executable) {
      throw new ProgramNotDeployedError(
        `Program ${programId.toString()} exists but is not executable`
      );
    }
    
    console.log("✅ Program is deployed and executable");
    console.log(`   Program ID: ${programId.toString()}`);
    console.log(`   Account size: ${programAccount.data.length} bytes`);
    console.log(`   Owner: ${programAccount.owner.toString()}`);
    
  } catch (error) {
    if (error instanceof ProgramNotDeployedError) {
      throw error;
    }
    throw new Error(`Failed to verify program deployment: ${error}`);
  }
}

// Enhanced retry logic with exponential backoff
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  isRetryableError: (error: any) => boolean = () => true
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${CONFIG.maxRetries} for ${operationName}`);
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if this is a rate limit error
      if (error instanceof Error && 
          (error.message.includes("429") || 
           error.message.includes("rate limit") ||
           error.message.includes("Too Many Requests"))) {
        const rateLimitError = new RateLimitError(error.message);
        console.log(`⚠️  Rate limited on attempt ${attempt}, waiting ${CONFIG.retryDelayMs * attempt}ms...`);
      } else if (!isRetryableError(error)) {
        console.log(`❌ Non-retryable error for ${operationName}: ${error}`);
        throw error;
      } else {
        console.log(`⚠️  Attempt ${attempt} failed for ${operationName}: ${error}`);
      }
      
      if (attempt < CONFIG.maxRetries) {
        // Exponential backoff with jitter
        const delayMs = CONFIG.retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`⏳ Waiting ${Math.round(delayMs)}ms before retry...`);
        await sleep(delayMs);
      }
    }
  }
  
  throw new Error(`${operationName} failed after ${CONFIG.maxRetries} attempts. Last error: ${lastError}`);
}

// Enhanced space allocation error handling
function handleSpaceAllocationError(error: any): void {
  const errorMessage = error?.message || error?.toString() || "Unknown error";
  
  if (errorMessage.includes("insufficient funds")) {
    throw new SpaceAllocationError(
      "Insufficient funds for account creation. Please ensure the payer has enough SOL for rent exemption."
    );
  }
  
  if (errorMessage.includes("invalid account data")) {
    throw new SpaceAllocationError(
      "Invalid account data size. The calculated space allocation may be incorrect."
    );
  }
  
  if (errorMessage.includes("account already exists")) {
    // This might actually be OK, we'll verify the account later
    console.log("⚠️  Account already exists, will verify its configuration...");
    return;
  }
  
  throw new SpaceAllocationError(`Space allocation failed: ${errorMessage}`);
}

// Verify registration by reading back account data
async function verifyRegistration(
  connection: Connection,
  extraAccountMetaListPda: PublicKey,
  hookProgramId: PublicKey
): Promise<void> {
  console.log("🔍 Verifying registration...");
  
  const verifyOperation = async () => {
    const accountInfo = await connection.getAccountInfo(extraAccountMetaListPda);
    
    if (!accountInfo) {
      throw new Error("ExtraAccountMetaList account was not created");
    }
    
    if (!accountInfo.owner.equals(hookProgramId)) {
      throw new Error(
        `Account owner mismatch. Expected: ${hookProgramId.toString()}, Got: ${accountInfo.owner.toString()}`
      );
    }
    
    if (accountInfo.data.length === 0) {
      throw new Error("Account was created but has no data");
    }
    
    console.log("✅ Registration verification successful!");
    console.log(`   PDA Address: ${extraAccountMetaListPda.toString()}`);
    console.log(`   Account size: ${accountInfo.data.length} bytes`);
    console.log(`   Owner: ${accountInfo.owner.toString()}`);
    console.log(`   Rent-exempt reserve: ${accountInfo.lamports} lamports`);
    
    return accountInfo;
  };
  
  await executeWithRetry(
    verifyOperation,
    "registration verification",
    (error) => !error.message.includes("owner mismatch") // Don't retry owner mismatches
  );
}
async function main() {
  console.log("🚀 Starting hook extra account metas registration...");
  console.log(`📋 Configuration:`);
  console.log(`   Max retries: ${CONFIG.maxRetries}`);
  console.log(`   Retry delay: ${CONFIG.retryDelayMs}ms`);
  console.log(`   Confirmation timeout: ${CONFIG.confirmationTimeout}ms`);
  
  try {
    // Initialize connection and keys
    const connection = new Connection(process.env.RPC_URL!, "confirmed");
    const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
    const hookProgramId = new PublicKey(process.env.PROGRAM_ID!);
    
    // Use provided mint address or fall back to environment
    const mintAddress = new PublicKey(
      process.env.MINT_ADDRESS || "EYfH82983Mq85apeFGnz4wH4Xaexjun5MToNQfYevKic"
    );
    
    console.log("\n📊 Connection Details:");
    console.log(`   RPC URL: ${process.env.RPC_URL}`);
    console.log(`   Hook Program ID: ${hookProgramId.toString()}`);
    console.log(`   Mint Address: ${mintAddress.toString()}`);
    console.log(`   Payer: ${payer.publicKey.toString()}`);
    
    // Step 1: Verify program deployment
    await verifyProgramDeployment(connection, hookProgramId);
    
    // Step 2: Check and ensure hook config exists
    const [hookConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mintAddress.toBuffer()],
      hookProgramId
    );
    
    console.log(`\n🔧 Hook Config PDA: ${hookConfigPda.toString()}`);
    
    await executeWithRetry(async () => {
      const hookConfigAccount = await connection.getAccountInfo(hookConfigPda);
      if (!hookConfigAccount) {
        console.log("⚠️  Hook config PDA doesn't exist. Initializing it first...");
        
        // Get dev wallet from environment
        const devWallet = new PublicKey(process.env.DEV_WALLET!);
        console.log(`👤 Dev wallet: ${devWallet.toString()}`);
        
        // Create instruction data for initialize
        const initializeData = Buffer.alloc(8 + 32);
        const initializeDiscriminator = Buffer.from([0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed]);
        initializeDiscriminator.copy(initializeData, 0);
        devWallet.toBuffer().copy(initializeData, 8);
        
        // Create initialize instruction
        const initializeInstruction = new TransactionInstruction({
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: hookConfigPda, isSigner: false, isWritable: true },
            { pubkey: mintAddress, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          programId: hookProgramId,
          data: initializeData,
        });
        
        // Send initialize transaction
        const initTx = new Transaction().add(initializeInstruction);
        
        const confirmOptions: ConfirmOptions = {
          commitment: "confirmed",
          maxRetries: 3,
        };
        
        const initSignature = await sendAndConfirmTransaction(
          connection,
          initTx,
          [payer],
          confirmOptions
        );
        
        console.log("✅ Hook config initialized!");
        console.log(`   Transaction signature: ${initSignature}`);
        
      } else {
        console.log("✅ Hook config PDA already exists");
      }
    }, "hook config initialization");
    
    // Step 3: Register extra account metas with comprehensive error handling
    const [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintAddress.toBuffer()],
      hookProgramId
    );
    
    console.log(`\n📝 Extra Account Meta List PDA: ${extraAccountMetaListPda.toString()}`);
    
    // Check if already exists
    const existingAccount = await connection.getAccountInfo(extraAccountMetaListPda);
    if (existingAccount) {
      console.log("ℹ️  Extra account meta list already exists!");
      await verifyRegistration(connection, extraAccountMetaListPda, hookProgramId);
      return;
    }
    
    console.log("📦 Proceeding with registration...");
    
    // Calculate space and rent
    const space = 128; // Conservative space for ExtraAccountMetaList
    const lamports = await connection.getMinimumBalanceForRentExemption(space);
    console.log(`💰 Required lamports for rent exemption: ${lamports}`);
    console.log(`📏 Required space: ${space} bytes`);
    
    // Register with retry logic and enhanced error handling
    await executeWithRetry(async () => {
      try {
        // Create instruction data for init_extra_account_meta_list
        const instructionData = Buffer.from([0x10, 0x0c, 0xfe, 0xfb, 0xfc, 0x67, 0x73, 0x3a]);
        
        // Create the instruction
        const initInstruction = new TransactionInstruction({
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: extraAccountMetaListPda, isSigner: false, isWritable: true },
            { pubkey: mintAddress, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          programId: hookProgramId,
          data: instructionData,
        });
        
        // Create and send transaction
        const transaction = new Transaction().add(initInstruction);
        
        const confirmOptions: ConfirmOptions = {
          commitment: "confirmed",
          maxRetries: 3,
        };
        
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [payer],
          confirmOptions
        );
        
        console.log("✅ Extra account metas registered successfully!");
        console.log(`   Transaction signature: ${signature}`);
        console.log(`   Explorer: https://explorer.solana.com/tx/${signature}`);
        
        return signature;
        
      } catch (error) {
        handleSpaceAllocationError(error);
        throw error;
      }
    }, "extra account metas registration");
    
    // Step 4: Verify the registration
    await verifyRegistration(connection, extraAccountMetaListPda, hookProgramId);
    
    console.log("\n🎉 Registration completed successfully!");
    console.log(`   PDA Address: ${extraAccountMetaListPda.toString()}`);
    
  } catch (error) {
    console.error("\n❌ Registration failed:");
    
    if (error instanceof ProgramNotDeployedError) {
      console.error(`   ${error.message}`);
      console.error("   Please deploy the program first using the deployment script.");
    } else if (error instanceof RateLimitError) {
      console.error(`   Rate limiting detected: ${error.message}`);
      console.error("   Please wait a moment and try again.");
    } else if (error instanceof SpaceAllocationError) {
      console.error(`   Space allocation error: ${error.message}`);
      console.error("   Please check account funding and space calculations.");
    } else {
      console.error(`   Unexpected error: ${error}`);
    }
    
    process.exit(1);
  }
}

main().catch(console.error);
