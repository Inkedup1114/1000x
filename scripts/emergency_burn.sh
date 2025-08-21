#!/bin/bash

# Emergency Manual Burn Script for 1000x Token System
# Performs manual fee withdrawal and burn when automated system fails

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/emergency-burn.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Ensure log file exists and is writable
sudo touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/emergency-burn.log"
sudo chmod 666 "$LOG_FILE" 2>/dev/null || true

# Load environment
if [ -f "$PROJECT_DIR/app/ts/.env" ]; then
    set -a
    source "$PROJECT_DIR/app/ts/.env"
    set +a
else
    echo -e "${RED}ERROR: Environment file not found at $PROJECT_DIR/app/ts/.env${NC}"
    exit 1
fi

# Logging function
log() {
    echo "[$TIMESTAMP] $*" | tee -a "$LOG_FILE"
}

# Status functions
status_info() {
    echo -e "${BLUE}ℹ${NC} $1"
    log "INFO: $1"
}

status_ok() {
    echo -e "${GREEN}✓${NC} $1"
    log "SUCCESS: $1"
}

status_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    log "WARNING: $1"
}

status_error() {
    echo -e "${RED}✗${NC} $1"
    log "ERROR: $1"
}

# Cleanup function
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        status_error "Emergency burn script failed with exit code $exit_code"
        log "Script failed at $(date)"
    fi
    exit $exit_code
}

trap cleanup EXIT

echo "=== 1000x Token Emergency Manual Burn ==="
echo "Time: $(date)"
echo "Host: $(hostname)"
echo ""

# Validation checks
status_info "Performing pre-burn validation..."

# Check required tools
for tool in ts-node solana curl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        status_error "Required tool '$tool' not found"
        exit 1
    fi
done

# Check required environment variables
required_vars=(
    "RPC_URL"
    "MINT_ADDRESS"
    "PROGRAM_ID"
    "BURNER_AUTHORITY_KEY"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
        status_error "Required environment variable $var is not set"
        exit 1
    fi
done

status_ok "Environment validation passed"

# Check SOL balance
status_info "Checking SOL balance..."
if balance_lamports=$(solana balance --lamports 2>/dev/null); then
    balance_sol=$(echo "scale=4; $balance_lamports/1000000000" | bc -l)
    
    if [ "$balance_lamports" -lt 1000000 ]; then  # Less than 0.001 SOL
        status_error "Insufficient SOL balance ($balance_sol SOL) for transactions"
        exit 1
    fi
    
    status_ok "SOL balance adequate: $balance_sol SOL"
else
    status_error "Failed to check SOL balance"
    exit 1
fi

# Check RPC connection
status_info "Testing RPC connection..."
if curl -s -m 10 -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' >/dev/null 2>&1; then
    status_ok "RPC connection successful"
else
    status_error "RPC connection failed"
    exit 1
fi

echo ""

# Stop automatic burner if running
status_info "Stopping automatic burner service..."
if systemctl is-active --quiet burner-bot 2>/dev/null; then
    sudo systemctl stop burner-bot || true
    status_ok "Burner service stopped"
    RESTART_SERVICE=true
else
    status_info "Burner service was not running"
    RESTART_SERVICE=false
fi

echo ""

# Perform manual burn operation
status_info "Starting manual burn operation..."

cd "$PROJECT_DIR"

# Create manual burn script
cat > /tmp/manual_burn_operation.ts << 'EOF'
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
import bs58 from "bs58";

async function performEmergencyBurn() {
  console.log("Starting emergency burn operation...");
  
  try {
    const connection = new Connection(process.env.RPC_URL!, "confirmed");
    const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
    const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));
    
    console.log("Connected to RPC:", process.env.RPC_URL);
    console.log("Mint Address:", mintAddress.toBase58());
    console.log("Burner Authority:", burnerAuthority.publicKey.toBase58());
    
    // Get burner ATA
    const burnerAta = getAssociatedTokenAddressSync(
      mintAddress,
      burnerAuthority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log("Burner ATA:", burnerAta.toBase58());
    
    // Check if ATA exists
    let ataExists = true;
    try {
      await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      console.log("✓ Burner ATA exists");
    } catch (error) {
      console.log("⚠ Burner ATA does not exist, creating...");
      ataExists = false;
    }
    
    // Get all token accounts for the mint
    console.log("Fetching token accounts...");
    const tokenAccounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      filters: [
        { dataSize: 182 }, // Token Account size
        { memcmp: { offset: 0, bytes: mintAddress.toBase58() } }
      ]
    });
    
    console.log(`Found ${tokenAccounts.length} token accounts`);
    
    // Prepare transaction
    const transaction = new Transaction();
    
    // Create ATA if needed
    if (!ataExists) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        burnerAuthority.publicKey,
        burnerAta,
        burnerAuthority.publicKey,
        mintAddress,
        TOKEN_2022_PROGRAM_ID
      );
      transaction.add(createAtaIx);
      console.log("Added create ATA instruction");
    }
    
    // Withdraw withheld tokens (process in chunks to avoid transaction size limits)
    const CHUNK_SIZE = 20;
    const accountPubkeys = tokenAccounts.map(account => account.pubkey);
    
    for (let i = 0; i < accountPubkeys.length; i += CHUNK_SIZE) {
      const chunk = accountPubkeys.slice(i, i + CHUNK_SIZE);
      
      const withdrawIx = createWithdrawWithheldTokensFromAccountsInstruction(
        mintAddress,
        burnerAta,
        burnerAuthority.publicKey,
        [],
        chunk,
        TOKEN_2022_PROGRAM_ID
      );
      
      // If transaction gets too large, send current one and start new
      if (transaction.instructions.length > 0 && transaction.instructions.length + 1 > 10) {
        console.log(`Sending withdraw transaction (${transaction.instructions.length} instructions)...`);
        const signature = await sendAndConfirmTransaction(connection, transaction, [burnerAuthority]);
        console.log("✓ Withdraw transaction confirmed:", signature);
        
        // Start new transaction
        transaction.instructions = [];
      }
      
      transaction.add(withdrawIx);
      console.log(`Added withdraw instruction for ${chunk.length} accounts`);
    }
    
    // Send final withdraw transaction if it has instructions
    if (transaction.instructions.length > 0) {
      console.log(`Sending final withdraw transaction (${transaction.instructions.length} instructions)...`);
      const signature = await sendAndConfirmTransaction(connection, transaction, [burnerAuthority]);
      console.log("✓ Final withdraw transaction confirmed:", signature);
    }
    
    // Wait a bit for balances to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check ATA balance and burn if there are tokens
    try {
      const ataAccount = await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const balance = ataAccount.amount;
      
      console.log(`Burner ATA balance: ${balance} tokens`);
      
      if (balance > 0n) {
        console.log("Burning tokens...");
        
        const burnIx = createBurnInstruction(
          burnerAta,
          mintAddress,
          burnerAuthority.publicKey,
          balance,
          [],
          TOKEN_2022_PROGRAM_ID
        );
        
        const burnTransaction = new Transaction().add(burnIx);
        const burnSignature = await sendAndConfirmTransaction(connection, burnTransaction, [burnerAuthority]);
        
        console.log("✓ Burn transaction confirmed:", burnSignature);
        console.log(`✓ Successfully burned ${balance} tokens`);
      } else {
        console.log("ℹ No tokens to burn");
      }
    } catch (error) {
      console.log("⚠ Could not check ATA balance or burn failed:", error);
    }
    
    console.log("Emergency burn operation completed successfully");
    return true;
    
  } catch (error) {
    console.error("Emergency burn operation failed:", error);
    return false;
  }
}

performEmergencyBurn().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error("Script error:", error);
  process.exit(1);
});
EOF

# Run the manual burn operation
status_info "Executing burn operation..."
if ts-node /tmp/manual_burn_operation.ts 2>&1 | tee -a "$LOG_FILE"; then
    status_ok "Manual burn operation completed successfully"
else
    status_error "Manual burn operation failed"
    exit 1
fi

echo ""

# Restart service if it was running
if [ "$RESTART_SERVICE" = true ]; then
    status_info "Restarting burner service..."
    sleep 2
    sudo systemctl start burner-bot
    
    # Give service time to start
    sleep 3
    
    if systemctl is-active --quiet burner-bot; then
        status_ok "Burner service restarted successfully"
    else
        status_warning "Burner service failed to restart - manual intervention may be needed"
    fi
else
    status_info "Burner service was not restarted (was not running initially)"
fi

echo ""

# Final health check
status_info "Performing post-burn health check..."
if "$SCRIPT_DIR/quick_health.sh" >/dev/null 2>&1; then
    status_ok "System health check passed"
else
    status_warning "System health check reported issues - review logs"
fi

# Cleanup temporary file
rm -f /tmp/manual_burn_operation.ts

echo ""
echo "=== Emergency Burn Summary ==="
status_ok "Emergency burn operation completed"
echo "Log file: $LOG_FILE"
echo "Timestamp: $(date)"
echo ""
echo "Next steps:"
echo "1. Monitor burner service: sudo systemctl status burner-bot"
echo "2. Check logs: tail -f $LOG_FILE"
echo "3. Verify ongoing operations: curl http://localhost:8080/health"