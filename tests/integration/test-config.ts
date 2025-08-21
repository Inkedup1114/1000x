import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";

// Test configuration for local validator
export const TEST_CONFIG = {
  // Local validator endpoint
  RPC_URL: "http://127.0.0.1:8899",
  
  // Test timeouts
  CONFIRMATION_TIMEOUT: 30000,
  AIRDROP_TIMEOUT: 10000,
  
  // Test amounts (in base units with 9 decimals)
  WALLET_CAP: BigInt("5000000000"), // 5 tokens
  INITIAL_MINT_AMOUNT: BigInt("1000000000000"), // 1000 tokens
  TEST_TRANSFER_AMOUNT: BigInt("100000000"), // 0.1 tokens
  
  // Fee configuration
  TRANSFER_FEE_BASIS_POINTS: 1000, // 10%
  MAX_FEE: BigInt("100000000000000000"),
  
  // SOL amounts for test accounts
  AIRDROP_AMOUNT: 5 * 1_000_000_000, // 5 SOL
};

// Create test provider for local validator
export function createTestProvider(): anchor.AnchorProvider {
  const connection = new Connection(TEST_CONFIG.RPC_URL, "confirmed");
  
  // Generate a test wallet or use existing one
  let wallet: anchor.Wallet;
  
  try {
    // Try to load existing wallet
    const keypair = anchor.web3.Keypair.fromSecretKey(
      Buffer.from(JSON.parse(require('fs').readFileSync(
        require('os').homedir() + '/.config/solana/id.json', 'utf8'
      )))
    );
    wallet = new anchor.Wallet(keypair);
  } catch {
    // Generate new wallet if none exists
    const keypair = Keypair.generate();
    wallet = new anchor.Wallet(keypair);
  }
  
  return new anchor.AnchorProvider(
    connection,
    wallet,
    { 
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );
}

// Utility to ensure local validator is running
export async function ensureLocalValidator(connection: Connection): Promise<boolean> {
  try {
    const health = await connection.getHealth();
    return health === 'ok';
  } catch {
    return false;
  }
}

// Airdrop SOL to account with retry logic
export async function airdropSol(
  connection: Connection, 
  publicKey: anchor.web3.PublicKey, 
  amount: number = TEST_CONFIG.AIRDROP_AMOUNT
): Promise<void> {
  try {
    const signature = await connection.requestAirdrop(publicKey, amount);
    await connection.confirmTransaction(signature, "confirmed");
  } catch (error) {
    console.warn(`Airdrop failed for ${publicKey.toString()}: ${error}`);
    // Don't throw - test might still work with existing balance
  }
}