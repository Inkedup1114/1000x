# Deployment Script for 1kx_hook Program

## Overview
The `deploy_program_upgrade.sh` script automates the deployment of the 1kx_hook program upgrade with updated space allocation for ExtraAccountMetaList.

## Features
- ✅ SOL balance verification (minimum 0.08 SOL required)
- ✅ Program build verification
- ✅ Comprehensive error handling and logging
- ✅ Transaction logging with Solana Explorer links
- ✅ Post-deployment verification
- ✅ Colored output for better visibility
- ✅ Detailed log file generation

## Usage

### Prerequisites
1. Ensure `solana` CLI is installed and configured
2. Ensure `anchor` CLI is installed
3. Build the program: `anchor build`
4. Have at least 0.08 SOL in your wallet

### Running the Script
```bash
# From the project root directory
./scripts/deploy_program_upgrade.sh
```

### Script Output
The script will:
1. Check your SOL balance
2. Verify the program binary exists
3. Show current program information
4. Deploy the program upgrade
5. Verify the deployment was successful
6. Generate a timestamped log file

### Log Files
Each deployment creates a log file named `deployment_YYYYMMDD_HHMMSS.log` in the current directory.

## Program Details
- **Program ID**: `HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2`
- **Binary Path**: `programs/1kx_hook/target/deploy/one_kx_hook.so`
- **Updated Feature**: ExtraAccountMetaList space allocation (EXTRA_ACCOUNT_META_LIST_SIZE = 128)

## Troubleshooting

### Insufficient SOL Balance
```
[ERROR] Insufficient SOL balance. Required: 0.08 SOL, Available: X SOL
```
**Solution**: Fund your wallet with more SOL

### Program Binary Not Found
```
[ERROR] Program binary not found at: programs/1kx_hook/target/deploy/one_kx_hook.so
```
**Solution**: Run `anchor build` to build the program

### Wallet Not Configured
```
[ERROR] Failed to get SOL balance. Is your wallet configured?
```
**Solution**: Configure your wallet with `solana config set --keypair <path-to-keypair>`

### Deployment Failed
Check the log file for detailed error information and ensure:
- Network connectivity is stable
- Solana RPC endpoint is responsive
- Program binary is valid and not corrupted

## Manual Deployment Command
If you need to deploy manually:
```bash
solana program deploy programs/1kx_hook/target/deploy/one_kx_hook.so --program-id HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2
```
