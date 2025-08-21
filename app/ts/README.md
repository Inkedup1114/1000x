# TypeScript Client Development Guide

This directory contains TypeScript scripts for interacting with the 1000x Token program on Solana.

## Environment Setup

### 1. Install Dependencies

```bash
# From project root
pnpm install

# Install TypeScript globally (optional)
npm install -g typescript ts-node
```

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit environment variables
nano .env
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PRIVATE_KEY` | Base58 encoded keypair for signing transactions | `4UhGWy1...` |
| `RPC_URL` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `PROGRAM_ID` | Hook program address | `HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2` |
| `MINT_ADDRESS` | Token mint address | `EYfH82983...` |
| `DEV_WALLET` | Developer wallet (exempt from cap) | `Gz8dQdJi...` |
| `BURNER_AUTHORITY_KEY` | Keypair for fee withdrawal/burning | `4GmJEDYB...` |

### Network Configuration

**Devnet** (recommended for testing):
```bash
RPC_URL=https://api.devnet.solana.com
```

**Mainnet** (production):
```bash
RPC_URL=https://api.mainnet-beta.solana.com
# Or use a private RPC provider for better reliability
```

## Available Scripts

### Token Management

```bash
# Create new Token-2022 mint with extensions
npm run mint:create
# Creates mint, sets transfer fee (10%), configures hook, mints initial supply

# Verify mint configuration
npm run mint:verify  
# Checks transfer fee config, hook setup, and extensions

# Configure fee parameters (if needed)
npm run fee:configure
# Updates transfer fee settings (requires fee authority)
```

### Hook Management

```bash
# Initialize hook configuration PDA
npm run hook:init
# Creates config PDA with wallet cap and dev wallet settings

# Register extra account metas for hook execution
npm run hook:register
# Creates extra-account-metas PDA that specifies additional accounts for hook
```

### Burner Bot Operations

```bash
# Run burner bot interactively
npm run burner:run
# Sweeps collected fees and burns them continuously

# Check system health
npm run health:check
# Validates RPC connection, account states, balances
```

### Development and Testing

```bash
# Build program
npm run build:program
# Compiles Rust program using cargo build-sbf

# Run monitoring script
npm run monitor
# Checks service status, logs, and system health
```

## Script Details

### create_mint.ts

Creates a new Token-2022 mint with required extensions:

- **Transfer Fee Extension**: 10% fee on all transfers
- **Transfer Hook Extension**: Links to wallet cap enforcement program
- **Mint Authority**: Set to dev wallet for initial minting
- **Freeze Authority**: Set to dev wallet (optional)

```typescript
// Key functionality:
// 1. Generate mint keypair
// 2. Calculate space for extensions
// 3. Create mint account with extensions
// 4. Initialize transfer fee config
// 5. Initialize transfer hook config
// 6. Mint initial supply to dev wallet
```

### verify_mint_config.ts

Validates mint configuration and displays current state:

```typescript
// Checks:
// - Mint account exists and is valid
// - Transfer fee extension properly configured
// - Transfer hook extension points to correct program
// - Withdraw-withheld authority is set correctly
```

### init_hook_config.ts

Initializes the hook configuration PDA:

```typescript
// Creates PDA at seeds: ["config", mint_address]
// Stores:
// - dev_wallet: Pubkey (exempt from cap)
// - wallet_cap_raw: u64 (5 tokens = 5_000_000_000 with 9 decimals)
```

### register_hook_extra_metas.ts

Registers additional accounts needed during hook execution:

```typescript
// Creates PDA at seeds: ["extra-account-metas", mint_address]
// Specifies that hook needs:
// - Config PDA (for accessing wallet cap and dev wallet)
// This allows the runtime to automatically include required accounts
```

### burner_bot.ts

Automated fee collection and burning service:

```typescript
// Features:
// - Retry logic with exponential backoff
// - Rate limiting to respect RPC limits
// - Structured JSON logging
// - Health monitoring and alerts
// - Graceful error handling
// - Resource usage controls

// Process:
// 1. Scan all token accounts for mint
// 2. Withdraw withheld fees to burner ATA
// 3. Burn collected tokens
// 4. Log results and metrics
```

## Development Workflow

### Local Testing Flow

1. **Setup Environment**
   ```bash
   cp .env.example .env
   # Edit .env with devnet settings
   ```

2. **Build and Deploy Program**
   ```bash
   npm run build:program
   solana program deploy programs/1kx_hook/target/deploy/one_kx_hook.so
   ```

3. **Create Token Infrastructure**
   ```bash
   npm run mint:create
   npm run hook:init
   npm run hook:register
   ```

4. **Verify Setup**
   ```bash
   npm run mint:verify
   npm run health:check
   ```

5. **Test Transfers**
   ```bash
   # Use your preferred Solana wallet or write test scripts
   # Transfers should respect 5 token wallet cap
   ```

6. **Test Fee Burning**
   ```bash
   npm run burner:run
   ```

### Adding New Scripts

1. Create new TypeScript file in `app/ts/`
2. Add environment variable imports:
   ```typescript
   import * as dotenv from "dotenv";
   dotenv.config({ path: "./app/ts/.env" });
   ```
3. Use consistent error handling and logging
4. Add npm script to `package.json`
5. Document in this README

## Debugging

### Common Issues

**TypeScript compilation errors**:
```bash
# Install TypeScript dependencies
pnpm install -D typescript @types/node

# Check tsconfig.json exists in project root
```

**RPC connection failures**:
```bash
# Test RPC connectivity
curl -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' $RPC_URL

# Try different RPC endpoint
# Public devnet: https://api.devnet.solana.com
# Public mainnet: https://api.mainnet-beta.solana.com
```

**Transaction simulation failures**:
```bash
# Check account addresses
solana account $MINT_ADDRESS
solana account $PROGRAM_ID

# Verify program deployment
solana program show $PROGRAM_ID
```

**PDA derivation issues**:
```javascript
// Hook config PDA
const [hookConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("config"), mintAddress.toBuffer()],
  programId
);

// Extra account metas PDA  
const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mintAddress.toBuffer()],
  programId
);
```

### Logging and Monitoring

**Enable verbose logging**:
```bash
# Set environment variable for detailed logs
export DEBUG=1
npm run burner:run
```

**Monitor RPC usage**:
```bash
# Check rate limits and response times
# Most public RPCs limit to 10-100 requests per second
```

**Service monitoring**:
```bash
# Check burner bot service status
sudo systemctl status burner-bot

# View real-time logs
sudo journalctl -u burner-bot -f

# Check resource usage
sudo systemctl show burner-bot --property=MemoryCurrent,CPUUsageNSec
```

## Best Practices

### Security

- **Never commit private keys** to version control
- **Use hardware wallets** for mainnet operations
- **Validate all addresses** before transactions
- **Test on devnet first** before mainnet deployment

### Performance

- **Batch operations** when possible
- **Implement rate limiting** for RPC calls
- **Use confirmed commitment** for reliability
- **Monitor compute unit usage** in complex transactions

### Error Handling

- **Use structured logging** with JSON format
- **Implement retry logic** with exponential backoff
- **Classify errors** (recoverable vs fatal)
- **Provide helpful error messages** with context

### Code Organization

- **Separate concerns** (mint creation, hook management, fee burning)
- **Use consistent patterns** across scripts
- **Document complex logic** and PDA derivations
- **Add type definitions** for account structures

## Testing

### Unit Testing

```bash
# Run Anchor tests
anchor test

# Run specific test suites
anchor test -- --grep "transfer hook"
anchor test -- --grep "wallet cap"
```

### Integration Testing

```bash
# Test full flow on local validator
solana-test-validator --reset
# In another terminal:
npm run mint:create
npm run hook:register
# Run transfer tests
```

### Manual Testing Checklist

- [ ] Mint creation with all extensions
- [ ] Hook config initialization
- [ ] Extra account metas registration
- [ ] Transfer under cap limit (should succeed)
- [ ] Transfer over cap limit (should fail)
- [ ] Fee collection and burning
- [ ] Burner bot error recovery
- [ ] Service restart and health checks

## Production Deployment

### Pre-deployment Checklist

- [ ] All tests pass on devnet
- [ ] Security review completed
- [ ] Monitoring and alerting configured
- [ ] Backup and recovery procedures tested
- [ ] Documentation updated

### Deployment Steps

1. **Deploy to mainnet** with proper authority management
2. **Configure production environment** with secure key storage
3. **Start monitoring services** and health checks
4. **Announce deployment** and provide user documentation

### Post-deployment

- **Monitor system health** and performance metrics
- **Set up automated backups** of configuration and logs
- **Establish incident response** procedures
- **Plan for upgrades** and maintenance windows

For additional support, see the main [README.md](../../README.md) and [TODO.md](../../TODO.md) files.
