import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  VersionedTransaction,
  ComputeBudgetProgram,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createWithdrawWithheldTokensFromAccountsInstruction,
  createBurnInstruction,
  getAccount,
  getMint,
  getTransferFeeConfig,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

// Configuration constants for safety
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds
const RPC_RATE_LIMIT_DELAY = 2000; // 2 seconds between RPC calls
const SWEEP_INTERVAL = 300000; // 5 minutes instead of 1 minute for safety

// Compute unit configuration
const DEFAULT_CU_LIMIT = 200_000; // Default compute units per transaction
const MAX_CU_LIMIT = 1_400_000; // Maximum allowed compute units
const CU_BUFFER_MULTIPLIER = 1.2; // 20% buffer for estimation safety
const ACCOUNTS_PER_TX = 10; // Default accounts per transaction
const CU_PER_ACCOUNT_ESTIMATE = 15_000; // Rough estimate per account
const CU_WARNING_THRESHOLD = 0.8; // Warn at 80% of limit

// Sleep utility for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Compute unit metrics tracking
interface ComputeMetrics {
  estimated: number;
  actual?: number;
  limit: number;
  utilizationRate: number;
  accounts: number;
  timestamp: number;
}

const computeMetricsHistory: ComputeMetrics[] = [];
const MAX_METRICS_HISTORY = 100;

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

// Compute unit estimation and simulation
async function estimateComputeUnits(
  connection: Connection, 
  transaction: Transaction, 
  signers: Keypair[]
): Promise<number> {
  try {
    const recentBlockhash = await connection.getLatestBlockhash();
    transaction.recentBlockhash = recentBlockhash.blockhash;
    transaction.feePayer = signers[0].publicKey;
    
    // Sign transaction for simulation
    transaction.partialSign(...signers);
    
    const simulation: RpcResponseAndContext<SimulatedTransactionResponse> = 
      await connection.simulateTransaction(transaction);
    
    if (simulation.value.err) {
      log('WARN', 'Transaction simulation failed', {
        error: simulation.value.err
      });
      // Return conservative estimate if simulation fails
      return DEFAULT_CU_LIMIT;
    }
    
    const unitsConsumed = simulation.value.unitsConsumed || 0;
    log('INFO', 'Compute units estimated via simulation', {
      unitsConsumed,
      logs: simulation.value.logs?.slice(-5) // Last 5 log entries
    });
    
    return unitsConsumed;
  } catch (error) {
    log('WARN', 'Failed to estimate compute units via simulation', {
      error: error instanceof Error ? error.message : String(error)
    });
    // Fallback to formula-based estimation
    return DEFAULT_CU_LIMIT;
  }
}

// Heuristic compute unit estimation based on transaction content
function estimateComputeUnitsHeuristic(accountCount: number, hasCreateATA: boolean): number {
  let estimate = 50_000; // Base transaction cost
  
  // Add cost per account
  estimate += accountCount * CU_PER_ACCOUNT_ESTIMATE;
  
  // Add cost for ATA creation
  if (hasCreateATA) {
    estimate += 30_000;
  }
  
  // Add buffer
  estimate = Math.ceil(estimate * CU_BUFFER_MULTIPLIER);
  
  log('INFO', 'Heuristic compute unit estimation', {
    baseEstimate: 50_000,
    accountCount,
    accountsCost: accountCount * CU_PER_ACCOUNT_ESTIMATE,
    createATACost: hasCreateATA ? 30_000 : 0,
    bufferMultiplier: CU_BUFFER_MULTIPLIER,
    finalEstimate: estimate
  });
  
  return estimate;
}

// Set compute unit budget for transaction
function addComputeBudget(transaction: Transaction, computeUnits: number): void {
  const actualLimit = Math.min(computeUnits, MAX_CU_LIMIT);
  
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ 
      units: actualLimit 
    })
  );
  
  log('INFO', 'Added compute unit budget to transaction', {
    requested: computeUnits,
    actualLimit,
    wasCapped: computeUnits > MAX_CU_LIMIT
  });
}

// Track compute unit metrics
function trackComputeMetrics(metrics: ComputeMetrics): void {
  computeMetricsHistory.push(metrics);
  
  // Trim history to max size
  if (computeMetricsHistory.length > MAX_METRICS_HISTORY) {
    computeMetricsHistory.shift();
  }
  
  // Check for warnings
  if (metrics.utilizationRate > CU_WARNING_THRESHOLD) {
    log('WARN', 'High compute unit utilization detected', {
      utilizationRate: metrics.utilizationRate,
      estimated: metrics.estimated,
      limit: metrics.limit,
      accounts: metrics.accounts
    });
  }
  
  // Log metrics
  log('INFO', 'Compute unit metrics recorded', metrics);
}

// Analyze compute metrics patterns
function analyzeComputePatterns(): void {
  if (computeMetricsHistory.length < 10) return;
  
  const recent = computeMetricsHistory.slice(-10);
  const avgUtilization = recent.reduce((sum, m) => sum + m.utilizationRate, 0) / recent.length;
  const maxUtilization = Math.max(...recent.map(m => m.utilizationRate));
  const avgAccountsPerTx = recent.reduce((sum, m) => sum + m.accounts, 0) / recent.length;
  
  log('INFO', 'Compute usage pattern analysis', {
    samplesAnalyzed: recent.length,
    averageUtilization: avgUtilization,
    maxUtilization,
    averageAccountsPerTx: avgAccountsPerTx,
    recommendedAccountsPerTx: avgUtilization > 0.7 ? Math.floor(avgAccountsPerTx * 0.8) : ACCOUNTS_PER_TX
  });
  
  // Alert if consistently high utilization
  if (avgUtilization > CU_WARNING_THRESHOLD) {
    log('WARN', 'Consistently high compute utilization - consider reducing accounts per transaction', {
      averageUtilization: avgUtilization,
      recommendedReduction: Math.floor(avgAccountsPerTx * 0.8)
    });
  }
}

// Dynamic chunking based on compute unit estimates
function calculateOptimalChunkSize(totalAccounts: number, hasCreateATA: boolean): number {
  // Start with default and adjust based on recent patterns
  let chunkSize = ACCOUNTS_PER_TX;
  
  if (computeMetricsHistory.length >= 5) {
    const recent = computeMetricsHistory.slice(-5);
    const avgUtilization = recent.reduce((sum, m) => sum + m.utilizationRate, 0) / recent.length;
    
    if (avgUtilization > 0.8) {
      // High utilization - reduce chunk size
      chunkSize = Math.floor(chunkSize * 0.7);
    } else if (avgUtilization < 0.5) {
      // Low utilization - can increase chunk size
      chunkSize = Math.min(chunkSize * 1.3, 15);
    }
  }
  
  // Conservative adjustment for ATA creation
  if (hasCreateATA) {
    chunkSize = Math.floor(chunkSize * 0.8);
  }
  
  // Ensure minimum of 1
  chunkSize = Math.max(1, Math.floor(chunkSize));
  
  log('INFO', 'Calculated optimal chunk size', {
    totalAccounts,
    hasCreateATA,
    calculatedChunkSize: chunkSize,
    chunksNeeded: Math.ceil(totalAccounts / chunkSize)
  });
  
  return chunkSize;
}

// Retry wrapper with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = MAX_RETRY_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
      
      log('WARN', `${context} failed on attempt ${attempt}/${maxRetries}`, {
        error: error instanceof Error ? error.message : String(error),
        willRetry: !isLastAttempt,
        nextDelay: isLastAttempt ? null : delay
      });
      
      if (isLastAttempt) {
        throw error;
      }
      
      await sleep(delay);
    }
  }
  throw new Error(`Failed after ${maxRetries} attempts`);
}

async function sweepAndBurn() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));
  const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
  
  log('INFO', 'Starting sweep and burn operation', {
    mintAddress: mintAddress.toString(),
    burnerAuthority: burnerAuthority.publicKey.toString()
  });
  
  try {
    // Rate limit protection: add delay between RPC calls
    await sleep(RPC_RATE_LIMIT_DELAY);
    
    // Get mint info with retry
    const mintInfo = await withRetry(
      () => getMint(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID),
      'Get mint info'
    );
    
    log('INFO', 'Retrieved mint info', {
      supply: mintInfo.supply.toString(),
      decimals: mintInfo.decimals
    });
    
    await sleep(RPC_RATE_LIMIT_DELAY);
    
    // Get all token accounts for this mint with retry
    const tokenAccounts = await withRetry(
      () => connection.getProgramAccounts(
        TOKEN_2022_PROGRAM_ID,
        {
          filters: [
            { dataSize: 165 }, // Token account size
            {
              memcmp: {
                offset: 0,
                bytes: mintAddress.toBase58(),
              },
            },
          ],
        }
      ),
      'Get token accounts'
    );
    
    if (tokenAccounts.length === 0) {
      log('INFO', 'No token accounts found for mint');
      return;
    }
    
    log('INFO', `Found ${tokenAccounts.length} token accounts`);
    
    await sleep(RPC_RATE_LIMIT_DELAY);
    
    // Get burn sink ATA
    const burnSinkAta = getAssociatedTokenAddressSync(
      mintAddress,
      burnerAuthority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Check if burn sink exists, create if not
    let burnSinkExists = false;
    try {
      await withRetry(
        () => getAccount(connection, burnSinkAta, "confirmed", TOKEN_2022_PROGRAM_ID),
        'Check burn sink existence'
      );
      burnSinkExists = true;
      log('INFO', 'Burn sink account already exists', { burnSinkAta: burnSinkAta.toString() });
    } catch (e) {
      log('INFO', 'Burn sink account does not exist, will create', { burnSinkAta: burnSinkAta.toString() });
    }
    
    const tx = new Transaction();
    
    if (!burnSinkExists) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          burnerAuthority.publicKey,
          burnSinkAta,
          burnerAuthority.publicKey,
          mintAddress,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      log('INFO', 'Added create ATA instruction to transaction');
    }
    
    // Dynamic chunking based on compute unit optimization
    const optimalChunkSize = calculateOptimalChunkSize(tokenAccounts.length, !burnSinkExists);
    const allAccountsToProcess = tokenAccounts.map(acc => acc.pubkey);
    
    // Process accounts in chunks to respect compute limits
    const chunks: PublicKey[][] = [];
    for (let i = 0; i < allAccountsToProcess.length; i += optimalChunkSize) {
      chunks.push(allAccountsToProcess.slice(i, i + optimalChunkSize));
    }
    
    log('INFO', 'Prepared account chunks for processing', {
      totalAccounts: tokenAccounts.length,
      optimalChunkSize,
      totalChunks: chunks.length,
      willCreateATA: !burnSinkExists
    });
    
    // Process the first chunk in this iteration
    const accountsToWithdraw = chunks[0] || [];
    
    if (chunks.length > 1) {
      log('INFO', 'Processing first chunk - remaining chunks will be handled in future iterations', {
        currentChunk: 1,
        totalChunks: chunks.length,
        currentChunkSize: accountsToWithdraw.length,
        remainingAccounts: allAccountsToProcess.length - accountsToWithdraw.length
      });
    }
    
    // Only add withdraw instruction if we have accounts to process
    if (accountsToWithdraw.length > 0) {
      // Withdraw withheld tokens from accounts
      tx.add(
        createWithdrawWithheldTokensFromAccountsInstruction(
          mintAddress,
          burnSinkAta,
          burnerAuthority.publicKey,
          [],
          accountsToWithdraw,
          TOKEN_2022_PROGRAM_ID
        )
      );
      
      log('INFO', 'Added withdraw withheld tokens instruction', {
        accountCount: accountsToWithdraw.length
      });
    }
    
    // Estimate compute units and set budget
    const startTime = Date.now();
    let estimatedCU: number;
    
    try {
      // Try simulation-based estimation first
      estimatedCU = await estimateComputeUnits(connection, tx, [burnerAuthority]);
    } catch (error) {
      // Fallback to heuristic estimation
      log('WARN', 'Simulation failed, using heuristic estimation', {
        error: error instanceof Error ? error.message : String(error)
      });
      estimatedCU = estimateComputeUnitsHeuristic(accountsToWithdraw.length, !burnSinkExists);
    }
    
    // Add compute budget to transaction
    addComputeBudget(tx, estimatedCU);
    
    // Send withdraw transaction with retry and idempotency protection
    const withdrawSig = await withRetry(
      () => sendAndConfirmTransaction(
        connection,
        tx,
        [burnerAuthority],
        { 
          commitment: "confirmed",
          maxRetries: 0 // We handle retries ourselves
        }
      ),
      'Send withdraw transaction'
    );
    
    // Track compute metrics
    const txMetrics: ComputeMetrics = {
      estimated: estimatedCU,
      limit: Math.min(estimatedCU, MAX_CU_LIMIT),
      utilizationRate: estimatedCU / Math.min(estimatedCU, MAX_CU_LIMIT),
      accounts: accountsToWithdraw.length,
      timestamp: Date.now()
    };
    
    trackComputeMetrics(txMetrics);
    
    log('INFO', 'Successfully withdrew withheld fees', { signature: withdrawSig });
    
    await sleep(RPC_RATE_LIMIT_DELAY);
    
    // Get burn sink balance with retry
    const burnSinkAccount = await withRetry(
      () => getAccount(connection, burnSinkAta, "confirmed", TOKEN_2022_PROGRAM_ID),
      'Get burn sink balance'
    );
    
    const amountToBurn = burnSinkAccount.amount;
    
    if (amountToBurn > BigInt(0)) {
      // Prepare burn transaction with compute budget
      const burnTx = new Transaction();
      
      // Estimate compute units for burn transaction (simpler, more predictable)
      const burnEstimatedCU = 50_000; // Burn transactions are typically lightweight
      addComputeBudget(burnTx, burnEstimatedCU);
      
      burnTx.add(
        createBurnInstruction(
          burnSinkAta,
          mintAddress,
          burnerAuthority.publicKey,
          amountToBurn,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      
      const burnSig = await withRetry(
        () => sendAndConfirmTransaction(
          connection,
          burnTx,
          [burnerAuthority],
          { 
            commitment: "confirmed",
            maxRetries: 0 // We handle retries ourselves
          }
        ),
        'Send burn transaction'
      );
      
      // Track burn transaction metrics
      const burnMetrics: ComputeMetrics = {
        estimated: burnEstimatedCU,
        limit: burnEstimatedCU,
        utilizationRate: 1.0, // Conservative assumption for burn
        accounts: 1, // Only burning from one account
        timestamp: Date.now()
      };
      
      trackComputeMetrics(burnMetrics);
      
      log('INFO', 'Successfully burned collected fees', { 
        amount: amountToBurn.toString(),
        signature: burnSig 
      });
    } else {
      log('INFO', 'No fees collected to burn');
    }
    
    // Analyze compute patterns after successful operations
    analyzeComputePatterns();
    
  } catch (error) {
    log('ERROR', 'Error in sweep and burn operation', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error; // Re-throw to be handled by the main loop
  }
}

// Main loop with enhanced error handling and monitoring
async function main() {
  log('INFO', 'Burner bot starting', {
    sweepInterval: SWEEP_INTERVAL,
    maxRetries: MAX_RETRY_ATTEMPTS,
    rpcUrl: process.env.RPC_URL
  });
  
  // Validate environment variables
  const requiredEnvVars = ['RPC_URL', 'BURNER_AUTHORITY_KEY', 'MINT_ADDRESS'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    log('ERROR', 'Missing required environment variables', { missingVars });
    process.exit(1);
  }
  
  // Validate keypair format
  try {
    Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));
  } catch (error) {
    log('ERROR', 'Invalid BURNER_AUTHORITY_KEY format', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
  
  // Validate mint address format
  try {
    new PublicKey(process.env.MINT_ADDRESS!);
  } catch (error) {
    log('ERROR', 'Invalid MINT_ADDRESS format', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
  
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;
  
  // Run immediately on startup
  try {
    await sweepAndBurn();
    consecutiveFailures = 0;
    log('INFO', 'Initial sweep and burn completed successfully');
  } catch (error) {
    consecutiveFailures++;
    log('ERROR', 'Initial sweep and burn failed', {
      error: error instanceof Error ? error.message : String(error),
      consecutiveFailures
    });
  }
  
  // Set up the interval for continuous operation
  const interval = setInterval(async () => {
    try {
      await sweepAndBurn();
      consecutiveFailures = 0;
      log('INFO', 'Scheduled sweep and burn completed successfully');
    } catch (error) {
      consecutiveFailures++;
      log('ERROR', 'Scheduled sweep and burn failed', {
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailures
      });
      
      // If too many consecutive failures, shut down gracefully
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log('ERROR', 'Too many consecutive failures, shutting down', {
          maxFailures: MAX_CONSECUTIVE_FAILURES
        });
        clearInterval(interval);
        process.exit(1);
      }
    }
  }, SWEEP_INTERVAL);
  
  // Graceful shutdown handling
  process.on('SIGINT', () => {
    log('INFO', 'Received SIGINT, shutting down gracefully');
    clearInterval(interval);
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log('INFO', 'Received SIGTERM, shutting down gracefully');
    clearInterval(interval);
    process.exit(0);
  });
  
  // Keep the process alive
  log('INFO', 'Burner bot is now running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  log('ERROR', 'Fatal error in main process', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
