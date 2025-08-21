import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createWithdrawWithheldTokensFromAccountsInstruction,
  createBurnInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import * as dotenv from "dotenv";
import bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

// Enhanced logging with timestamps and structured output
function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data })
  };
  console.log(JSON.stringify(logEntry));
}

// Sleep utility for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface BurnResult {
  success: boolean;
  tokensWithdrawn: bigint;
  tokensBurned: bigint;
  withdrawSignature?: string;
  burnSignature?: string;
  error?: string;
}

async function performManualBurn(): Promise<BurnResult> {
  const result: BurnResult = {
    success: false,
    tokensWithdrawn: 0n,
    tokensBurned: 0n
  };

  try {
    log('INFO', 'Starting manual burn operation');

    // Environment validation
    const requiredEnvVars = ['RPC_URL', 'MINT_ADDRESS', 'PROGRAM_ID', 'BURNER_AUTHORITY_KEY'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    const connection = new Connection(process.env.RPC_URL!, "confirmed");
    const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
    const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));

    log('INFO', 'Initialized connection and addresses', {
      rpcUrl: process.env.RPC_URL,
      mintAddress: mintAddress.toBase58(),
      burnerAuthority: burnerAuthority.publicKey.toBase58()
    });

    // Check SOL balance
    const solBalance = await connection.getBalance(burnerAuthority.publicKey);
    if (solBalance < 0.001 * 1e9) { // Less than 0.001 SOL
      throw new Error(`Insufficient SOL balance: ${solBalance / 1e9} SOL`);
    }

    log('INFO', 'SOL balance check passed', { balanceSOL: solBalance / 1e9 });

    // Get burner ATA
    const burnerAta = getAssociatedTokenAddressSync(
      mintAddress,
      burnerAuthority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    log('INFO', 'Burner ATA calculated', { ata: burnerAta.toBase58() });

    // Check if ATA exists
    let ataExists = true;
    try {
      await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      log('INFO', 'Burner ATA exists');
    } catch (error) {
      log('WARN', 'Burner ATA does not exist, will create');
      ataExists = false;
    }

    // Get all token accounts for the mint
    log('INFO', 'Fetching token accounts for withdrawal');
    const tokenAccounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      filters: [
        { dataSize: 182 }, // Token Account size for Token-2022
        { memcmp: { offset: 0, bytes: mintAddress.toBase58() } }
      ]
    });

    log('INFO', 'Found token accounts', { count: tokenAccounts.length });

    if (tokenAccounts.length === 0) {
      log('WARN', 'No token accounts found for withdrawal');
      result.success = true; // Not an error, just nothing to do
      return result;
    }

    // Prepare withdrawal transaction
    const withdrawTransaction = new Transaction();

    // Create ATA if needed
    if (!ataExists) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        burnerAuthority.publicKey,
        burnerAta,
        burnerAuthority.publicKey,
        mintAddress,
        TOKEN_2022_PROGRAM_ID
      );
      withdrawTransaction.add(createAtaIx);
      log('INFO', 'Added create ATA instruction');
    }

    // Process token accounts in chunks to avoid transaction size limits
    const CHUNK_SIZE = 20; // Conservative chunk size
    const accountPubkeys = tokenAccounts.map(account => account.pubkey);
    let totalTokensWithdrawn = 0n;

    for (let i = 0; i < accountPubkeys.length; i += CHUNK_SIZE) {
      const chunk = accountPubkeys.slice(i, i + CHUNK_SIZE);
      
      log('INFO', 'Processing chunk', { 
        chunkIndex: Math.floor(i / CHUNK_SIZE) + 1,
        totalChunks: Math.ceil(accountPubkeys.length / CHUNK_SIZE),
        accountsInChunk: chunk.length
      });

      const withdrawIx = createWithdrawWithheldTokensFromAccountsInstruction(
        mintAddress,
        burnerAta,
        burnerAuthority.publicKey,
        [],
        chunk,
        TOKEN_2022_PROGRAM_ID
      );

      // If transaction gets too large, send current one and start new
      if (withdrawTransaction.instructions.length > 0 && withdrawTransaction.instructions.length >= 8) {
        log('INFO', 'Sending intermediate withdrawal transaction', {
          instructionCount: withdrawTransaction.instructions.length
        });

        try {
          const signature = await sendAndConfirmTransaction(
            connection, 
            withdrawTransaction, 
            [burnerAuthority],
            { commitment: 'confirmed', skipPreflight: false }
          );
          
          log('INFO', 'Withdrawal transaction confirmed', { signature });
          result.withdrawSignature = signature;

          // Wait a bit between transactions
          await sleep(1000);

          // Start new transaction
          withdrawTransaction.instructions = [];
        } catch (error) {
          log('ERROR', 'Withdrawal transaction failed', { error: String(error) });
          throw error;
        }
      }

      withdrawTransaction.add(withdrawIx);
    }

    // Send final withdrawal transaction if it has instructions
    if (withdrawTransaction.instructions.length > 0) {
      log('INFO', 'Sending final withdrawal transaction', {
        instructionCount: withdrawTransaction.instructions.length
      });

      try {
        const signature = await sendAndConfirmTransaction(
          connection, 
          withdrawTransaction, 
          [burnerAuthority],
          { commitment: 'confirmed', skipPreflight: false }
        );
        
        log('INFO', 'Final withdrawal transaction confirmed', { signature });
        result.withdrawSignature = signature;
      } catch (error) {
        log('ERROR', 'Final withdrawal transaction failed', { error: String(error) });
        throw error;
      }
    }

    // Wait for balances to update
    log('INFO', 'Waiting for balances to update');
    await sleep(3000);

    // Check ATA balance and burn tokens
    try {
      const ataAccount = await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const balance = ataAccount.amount;
      result.tokensWithdrawn = balance;

      log('INFO', 'Tokens available for burning', { amount: balance.toString() });

      if (balance > 0n) {
        log('INFO', 'Creating burn transaction');

        const burnIx = createBurnInstruction(
          burnerAta,
          mintAddress,
          burnerAuthority.publicKey,
          balance,
          [],
          TOKEN_2022_PROGRAM_ID
        );

        const burnTransaction = new Transaction().add(burnIx);
        
        const burnSignature = await sendAndConfirmTransaction(
          connection, 
          burnTransaction, 
          [burnerAuthority],
          { commitment: 'confirmed', skipPreflight: false }
        );

        result.burnSignature = burnSignature;
        result.tokensBurned = balance;

        log('INFO', 'Burn transaction confirmed', { 
          signature: burnSignature,
          tokensBurned: balance.toString()
        });
      } else {
        log('INFO', 'No tokens to burn');
      }

      result.success = true;
      log('INFO', 'Manual burn operation completed successfully', {
        tokensWithdrawn: result.tokensWithdrawn.toString(),
        tokensBurned: result.tokensBurned.toString()
      });

    } catch (error) {
      log('ERROR', 'Failed to check ATA balance or burn tokens', { error: String(error) });
      // Don't throw here - withdrawal was successful even if burn failed
      result.error = `Burn failed: ${error}`;
      result.success = true; // Withdrawal was successful
    }

  } catch (error) {
    log('ERROR', 'Manual burn operation failed', { error: String(error) });
    result.error = String(error);
    result.success = false;
  }

  return result;
}

// Health check function for manual operations
async function performHealthCheck(): Promise<boolean> {
  try {
    log('INFO', 'Performing health check before manual burn');

    const connection = new Connection(process.env.RPC_URL!, "confirmed");
    
    // Test RPC connection
    await connection.getSlot();
    
    // Check burner authority balance
    const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));
    const balance = await connection.getBalance(burnerAuthority.publicKey);
    
    if (balance < 0.001 * 1e9) {
      log('ERROR', 'Health check failed - insufficient SOL balance', { balance: balance / 1e9 });
      return false;
    }

    // Check mint exists
    const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
    const mintInfo = await connection.getAccountInfo(mintAddress);
    
    if (!mintInfo) {
      log('ERROR', 'Health check failed - mint does not exist');
      return false;
    }

    log('INFO', 'Health check passed');
    return true;

  } catch (error) {
    log('ERROR', 'Health check failed', { error: String(error) });
    return false;
  }
}

async function main() {
  try {
    log('INFO', 'Manual burn script started');

    // Perform health check first
    const healthOk = await performHealthCheck();
    if (!healthOk) {
      log('ERROR', 'Health check failed - aborting manual burn');
      process.exit(1);
    }

    // Perform the manual burn
    const result = await performManualBurn();

    // Output result summary
    log('INFO', 'Manual burn script completed', {
      success: result.success,
      tokensWithdrawn: result.tokensWithdrawn.toString(),
      tokensBurned: result.tokensBurned.toString(),
      withdrawSignature: result.withdrawSignature,
      burnSignature: result.burnSignature,
      error: result.error
    });

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);

  } catch (error) {
    log('ERROR', 'Manual burn script failed', { error: String(error) });
    process.exit(1);
  }
}

// Export for potential use as module
export { performManualBurn, performHealthCheck };

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    log('ERROR', 'Unhandled script error', { error: String(error) });
    process.exit(1);
  });
}