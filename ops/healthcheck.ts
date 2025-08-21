import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getAccount, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as dotenv from "dotenv";
import bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

interface HealthStatus {
  timestamp: string;
  status: 'healthy' | 'warning' | 'critical';
  checks: {
    rpcConnection: boolean;
    mintExists: boolean;
    burnerAuthorityBalance: number;
    withheldTokensBalance: number;
    configPdaExists: boolean;
  };
  errors: string[];
  warnings: string[];
}

async function performHealthCheck(): Promise<HealthStatus> {
  const health: HealthStatus = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {
      rpcConnection: false,
      mintExists: false,
      burnerAuthorityBalance: 0,
      withheldTokensBalance: 0,
      configPdaExists: false,
    },
    errors: [],
    warnings: []
  };

  try {
    const connection = new Connection(process.env.RPC_URL!, "confirmed");
    const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
    const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!)).publicKey;
    const hookProgramId = new PublicKey(process.env.PROGRAM_ID!);

    // Check RPC connection
    try {
      await connection.getSlot();
      health.checks.rpcConnection = true;
    } catch (error) {
      health.errors.push(`RPC connection failed: ${error}`);
      health.status = 'critical';
    }

    // Check mint exists
    try {
      const mintInfo = await connection.getAccountInfo(mintAddress);
      health.checks.mintExists = !!mintInfo;
      if (!mintInfo) {
        health.errors.push('Mint account does not exist');
        health.status = 'critical';
      }
    } catch (error) {
      health.errors.push(`Failed to check mint: ${error}`);
      health.status = 'critical';
    }

    // Check burner authority SOL balance
    try {
      const balance = await connection.getBalance(burnerAuthority);
      health.checks.burnerAuthorityBalance = balance / 1e9; // Convert to SOL
      
      if (balance < 0.01 * 1e9) { // Less than 0.01 SOL
        health.warnings.push('Burner authority SOL balance is low');
        if (health.status === 'healthy') health.status = 'warning';
      }
    } catch (error) {
      health.errors.push(`Failed to check burner authority balance: ${error}`);
      health.status = 'critical';
    }

    // Check withheld tokens balance in burner ATA
    try {
      const burnerAta = getAssociatedTokenAddressSync(
        mintAddress,
        burnerAuthority,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      const ataAccount = await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      health.checks.withheldTokensBalance = Number(ataAccount.amount);
      
      if (ataAccount.amount > 1000n) { // If more than 1000 lamports accumulated
        health.warnings.push('Withheld tokens accumulating, burner may not be running');
        if (health.status === 'healthy') health.status = 'warning';
      }
    } catch (error) {
      // ATA might not exist yet, which is normal
      health.warnings.push('Burner ATA does not exist yet (normal on first run)');
    }

    // Check hook config PDA exists
    try {
      const [hookConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), mintAddress.toBuffer()],
        hookProgramId
      );
      
      const configAccount = await connection.getAccountInfo(hookConfigPda);
      health.checks.configPdaExists = !!configAccount;
      
      if (!configAccount) {
        health.errors.push('Hook config PDA does not exist');
        health.status = 'critical';
      }
    } catch (error) {
      health.errors.push(`Failed to check hook config: ${error}`);
      health.status = 'critical';
    }

  } catch (error) {
    health.errors.push(`Unexpected error during health check: ${error}`);
    health.status = 'critical';
  }

  return health;
}

async function main() {
  try {
    const health = await performHealthCheck();
    
    // Output JSON for easy parsing by monitoring systems
    console.log(JSON.stringify(health, null, 2));
    
    // Exit with appropriate code for monitoring
    if (health.status === 'critical') {
      process.exit(2);
    } else if (health.status === 'warning') {
      process.exit(1);
    } else {
      process.exit(0);
    }
    
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      status: 'critical',
      error: `Health check script failed: ${error}`
    }));
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

export { performHealthCheck, HealthStatus };
