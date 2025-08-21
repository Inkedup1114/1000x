# 1000x Token (1K)

A Solana Token-2022 mint with 10% transfer fee (burned) and 0.5% max wallet cap.

## Architecture

- **Token-2022 Mint**: 1000 total supply, 9 decimals  
- **Transfer Fee**: 10% on all transfers, collected and automatically burned
- **Wallet Cap**: 5 tokens max per wallet (0.5% of total supply), enforced by transfer hook
- **Transfer Hook Program**: On-chain program that validates wallet cap before transfers
- **Burner Bot**: Automated service that sweeps collected fees and burns them every 5 minutes
- **Meteora DLMM**: Optional liquidity pool configuration for trading

## Current Status (Devnet)

- ✅ **Program Deployed**: `HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2`
- ✅ **Mint Created**: `EYfH82983Mq85apeFGnz4wH4Xaexjun5MToNQfYevKic`
- ✅ **Hook Config Initialized**: `Bss3giGqbbhMU1m59z9SgfjbQe6Ah2ggkQSW7WbjG92w`
- ⚠️ **Extra Account Metas**: Pending deployment (program space fix needed)
- ✅ **Burner Bot**: Enhanced with safety features and monitoring

## Quick Start

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install Solana CLI (version 1.18+)
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
export PATH="$HOME/.config/solana/install/active_release/bin:$PATH"

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Install Node.js 20+ and pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm

# Clone and setup project
git clone <repo-url>
cd 1000x
pnpm install
```

### Environment Configuration

```bash
# Copy example environment file
cp app/ts/.env.example app/ts/.env

# Edit environment variables
nano app/ts/.env
```

Required environment variables:

- `PRIVATE_KEY`: Base58 encoded keypair for deployment and transactions
- `RPC_URL`: Solana RPC endpoint (devnet: <https://api.devnet.solana.com>)
- `PROGRAM_ID`: Hook program address
- `MINT_ADDRESS`: Token mint address  
- `DEV_WALLET`: Developer wallet address (exempt from cap)
- `BURNER_AUTHORITY_KEY`: Keypair for fee withdrawal and burning

## Complete Deployment Guide

### 1. Build and Deploy Program

```bash
# Build the hook program
npm run build:program
# or: cargo build-sbf --manifest-path programs/1kx_hook/Cargo.toml

# Set Solana config for devnet
solana config set --url devnet

# Deploy program (requires ~1.7 SOL)
solana program deploy programs/1kx_hook/target/deploy/one_kx_hook.so --program-id programs/1kx_hook/target/deploy/one_kx_hook-keypair.json

# Update PROGRAM_ID in app/ts/.env with deployed address
```

### 2. Create Token Mint

```bash
# Create Token-2022 mint with transfer fee and hook extensions
npm run mint:create

# This will:
# - Create mint with 1000 total supply
# - Set 10% transfer fee (1000 basis points)
# - Configure transfer hook program
# - Mint initial supply to dev wallet
# - Display mint address for .env update
```

### 3. Initialize Hook Configuration

```bash
# Initialize hook config PDA with wallet cap and dev wallet
npm run hook:init

# Verify hook config exists
npm run mint:verify
```

### 4. Register Extra Account Metas

```bash
# Register extra account metadata for hook execution
npm run hook:register

# This creates the PDA that tells the runtime which accounts 
# the hook needs during transfer execution
```

### 5. Test Transfer Hook

```bash
# Run comprehensive tests
npm test

# Or test specific scenarios:
anchor test -- --grep "wallet cap"
anchor test -- --grep "transfer fee"
```

### 6. Setup Burner Bot

```bash
# Test burner bot functionality
npm run burner:run

# For production service deployment:
sudo cp ops/burner.service /etc/systemd/system/burner-bot.service
sudo cp ops/burner.env /home/ubuntu/1000x/ops/burner.env

# Edit production environment
sudo nano /home/ubuntu/1000x/ops/burner.env

# Compile TypeScript for production
npx tsc app/ts/burner_bot.ts --target es2020 --module commonjs --outDir dist

# Start service
sudo systemctl daemon-reload
sudo systemctl enable burner-bot
sudo systemctl start burner-bot

# Monitor service
sudo systemctl status burner-bot
sudo journalctl -u burner-bot -f
```

## Available NPM Scripts

```bash
# Program development
npm run build:program        # Build Solana program
npm run build               # Build using Anchor

# Token and hook management  
npm run mint:create         # Create Token-2022 mint
npm run mint:verify         # Verify mint configuration
npm run hook:init           # Initialize hook config PDA
npm run hook:register       # Register extra account metas

# Burner bot operations
npm run burner:run          # Run burner bot (interactive)
npm run health:check        # Check system health
npm run monitor             # Run monitoring script

# Testing and deployment
npm test                    # Run all tests
npm run deploy:devnet       # Deploy to devnet
npm run deploy:mainnet      # Deploy to mainnet
```

## Architecture Details

### Transfer Hook Flow

1. **User initiates transfer** via any Token-2022 compatible wallet/program
2. **Token program** calls the registered transfer hook before executing transfer  
3. **Hook program** validates destination wallet balance won't exceed cap (5 tokens)
4. **Transfer executes** if validation passes, **rejected** if cap would be exceeded
5. **Transfer fee** (10%) automatically collected by Token-2022 extension
6. **Burner bot** periodically sweeps collected fees and burns them

### Program Data Accounts (PDAs)

- **Hook Config**: `seeds: ["config", mint]`
  - Stores: `dev_wallet: Pubkey`, `wallet_cap_raw: u64`
  - Size: 48 bytes (32 + 8 + 8 discriminator)

- **Extra Account Metas**: `seeds: ["extra-account-metas", mint]`
  - Stores: List of additional accounts needed during hook execution
  - Size: ~128 bytes (depends on number of accounts)

### Security Features

- **Rate limiting**: Burner bot includes RPC rate limiting and retry logic
- **Error handling**: Comprehensive error classification and recovery
- **Resource limits**: Systemd service includes memory/CPU constraints  
- **Monitoring**: Health checks and automated alerting capabilities
- **Privilege restriction**: Service runs with minimal system privileges

## Monitoring and Operations

### Health Monitoring

```bash
# Check overall system health
npm run health:check

# Setup automated monitoring (cron)
# Add to crontab: */5 * * * * /path/to/1000x/ops/monitor.sh
crontab -e
```

### Alerting Configuration

The monitoring system supports multiple alerting methods for operational notifications. Configure alerting by setting environment variables:

```bash
# Email alerts (requires mail command)
export ALERT_EMAIL="ops-team@company.com"

# Slack webhook integration
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

# PagerDuty integration for critical alerts
export PAGERDUTY_INTEGRATION_KEY="your_integration_key_here"
```

For detailed alerting setup including Discord, system notifications, and production deployment configurations, see [ops/ALERTING.md](ops/ALERTING.md).

### Log Management

```bash
# View burner bot logs
sudo journalctl -u burner-bot -f

# View recent errors
sudo journalctl -u burner-bot --since "1 hour ago" | grep ERROR

# View alert history
tail -f /var/log/burner-bot-alerts.log

# Monitor resource usage
systemctl status burner-bot
```

### Emergency Procedures

```bash
# Stop burner bot
sudo systemctl stop burner-bot

# Manual fee withdrawal (if burner fails)
npm run burner:run

# Check program upgrade authority
solana program show $PROGRAM_ID

# Manual fee configuration update
npm run fee:configure
```

## Mainnet Deployment

⚠️ **Warning**: Thoroughly test all functionality on devnet before mainnet deployment.

### Pre-deployment Checklist

- [ ] All tests passing on devnet
- [ ] Burner bot tested and operational  
- [ ] Program audit completed (if handling significant value)
- [ ] Upgrade authority properly secured (multisig recommended)
- [ ] Emergency procedures documented and tested

### Mainnet Commands

```bash
# Update cluster configuration
solana config set --url mainnet-beta

# Deploy program (requires upgrade authority)
solana program deploy programs/1kx_hook/target/deploy/one_kx_hook.so --program-id programs/1kx_hook/target/deploy/one_kx_hook-keypair.json

# Update .env for mainnet
cp app/ts/.env app/ts/.env.mainnet
# Edit mainnet configuration

# Create mainnet mint
npm run mint:create

# Register hook and start operations
npm run hook:init
npm run hook:register
```

## Troubleshooting

### Common Issues

**Program deployment fails with insufficient funds**:

```bash
solana balance  # Check SOL balance
solana airdrop 2  # Get devnet SOL
```

**Hook registration fails with space error**:

- Program needs updated space allocation for ExtraAccountMetaList
- Deploy updated program with increased space (current: 128 bytes)

**Burner bot fails to start**:

```bash
npm run health:check  # Check configuration
sudo journalctl -u burner-bot --since "10 minutes ago"  # Check logs
```

**Transfer hook not working**:

- Verify hook config PDA exists: `npm run mint:verify`
- Check extra account metas registered: `npm run hook:register`
- Ensure clients use correct additional accounts in CPI calls

## Support

For issues and questions:

- Check [TODO.md](./TODO.md) for known issues and status
- Review system logs for error details
- Test on devnet before mainnet operations
