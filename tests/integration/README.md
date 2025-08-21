# Integration Tests

This directory contains comprehensive integration tests for the 1000x Token (1kx_hook) project.

## Overview

The integration tests simulate the complete token lifecycle:

1. **Mint Creation** - Deploy a Token-2022 mint with transfer hook and fee extensions
2. **Hook Configuration** - Initialize the transfer hook with wallet cap enforcement
3. **Token Distribution** - Mint initial tokens to the dev wallet
4. **Transfer Cap Testing** - Verify wallet cap enforcement (5 token limit)
5. **Fee Collection** - Test 10% transfer fee mechanism
6. **Burner Bot Integration** - Test withdrawal and burning of collected fees
7. **End-to-End Verification** - Comprehensive system state validation
8. **Stress Testing** - Multiple rapid transfers and concurrent user scenarios

## Running Tests

### Prerequisites

1. Ensure you have a local Solana validator running:
   ```bash
   solana-test-validator
   ```

2. Build the program:
   ```bash
   npm run build
   ```

### Run Integration Tests

```bash
# Run only integration tests
npm run test:integration

# Run unit tests only
npm run test:unit

# Run all tests
npm run test:all

# Run with Anchor (includes program deployment)
anchor test tests/integration/full_flow_test.ts
```

## Test Structure

### Test Scenarios

1. **Mint Creation and Program Deployment**
   - Creates Token-2022 mint with extensions
   - Verifies mint configuration

2. **Hook Configuration**
   - Initializes hook config with dev wallet exemption
   - Registers extra account metas for transfer hook

3. **Initial Token Distribution**
   - Mints 1000 tokens to dev wallet
   - Verifies initial distribution

4. **Transfer Cap Enforcement Tests**
   - ✅ Under cap transfers (4 tokens)
   - ✅ Exactly at cap transfers (5 tokens)
   - ❌ Over cap transfers (7 tokens - should fail)
   - ✅ Dev wallet exemption (unlimited)

5. **Fee Collection Tests**
   - Verifies 10% transfer fee is collected
   - Checks withheld token accumulation

6. **Burner Bot Integration Tests**
   - Withdraws withheld tokens to fee collection account
   - Burns tokens to reduce total supply
   - Verifies supply reduction

7. **End-to-End Flow Verification**
   - Validates complete system state
   - Confirms all mechanisms working together

8. **Stress Tests**
   - Multiple rapid transfers
   - Concurrent user scenarios
   - Cap enforcement under load

### Key Test Parameters

- **Wallet Cap**: 5 tokens (5,000,000,000 with 9 decimals)
- **Transfer Fee**: 10% (1000 basis points)
- **Initial Mint**: 1000 tokens to dev wallet
- **Test Transfer**: 0.1 tokens for fee testing

## Expected Outcomes

### Successful Tests Should Show:

1. **Mint Creation**: Token-2022 mint with transfer hook and fee extensions
2. **Cap Enforcement**: Regular users limited to 5 tokens, dev wallet unlimited
3. **Fee Collection**: 10% of transfer amount withheld as fees
4. **Burner Bot**: Successful withdrawal and burning of collected fees
5. **Supply Management**: Total supply decreases when tokens are burned

### Test Metrics Logged:

- Total token supply
- Withheld fee amounts
- User wallet balances
- Dev wallet balance
- Number of successful/failed transfers

## Troubleshooting

### Common Issues:

1. **"Custom program error"** - Usually indicates wallet cap enforcement working correctly
2. **"Insufficient funds"** - Ensure test accounts have enough SOL for transaction fees
3. **"Account not found"** - Verify program is deployed and accounts are initialized
4. **Connection timeout** - Check local validator is running

### Debug Mode:

Add more logging by setting environment variables:
```bash
RUST_LOG=debug anchor test tests/integration/full_flow_test.ts
```

## Integration with CI/CD

These tests can be integrated into CI/CD pipelines:

```bash
# In GitHub Actions or similar
- name: Run Integration Tests
  run: |
    solana-test-validator --detach
    sleep 5
    npm run test:integration
    pkill solana-test-validator
```

## Test Data

The tests generate deterministic results but use random keypairs for security. Key addresses are logged for debugging:

- Program ID
- Mint Address  
- Dev Wallet Address
- User Account Addresses
- PDA Addresses (config, extra metas)

## Extending Tests

To add new test scenarios:

1. Add new test cases to the existing describe blocks
2. Create new describe blocks for different feature areas
3. Follow the existing pattern of setup, execution, verification
4. Update this README with new test descriptions

## Security Considerations

- Tests use isolated keypairs and accounts
- No mainnet or production data is used
- All test tokens are burned or left on local validator
- Private keys are generated locally and not persisted