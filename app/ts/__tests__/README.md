# TypeScript Utility Functions Unit Tests

This directory contains comprehensive unit tests for the TypeScript utility functions used in the 1000x Token project.

## Overview

The test suite uses Jest with TypeScript support and includes comprehensive mocking of external dependencies like Solana Web3.js and SPL Token libraries.

## Test Files

### 1. `create_mint.test.ts`
Tests for mint creation functionality including:
- **Mint Creation Parameters**: Validation of mint account creation parameters
- **Extension Configuration**: Testing Token-2022 extension setup (TransferFee, TransferHook)
- **Token Math Utilities**: BigInt conversions and calculations
- **PDA Derivation**: Program Derived Address generation for hook configs
- **Transaction Building**: Instruction creation and transaction assembly
- **Token Supply Management**: Initial supply minting to dev wallet
- **Error Handling**: Invalid addresses, connection failures, transaction errors
- **Environment Configuration**: Environment variable validation and parsing

**Key Features Tested:**
- ✅ Mint account size calculation with extensions
- ✅ Transfer fee configuration (10% fee)
- ✅ Transfer hook initialization
- ✅ Mint initialization with 9 decimals
- ✅ Token conversions (tokens ↔ base units)
- ✅ Fee calculations and net amount calculations
- ✅ Wallet cap validation
- ✅ PDA derivation for hook config and extra metas
- ✅ Transaction signing and confirmation
- ✅ Error handling for invalid inputs

### 2. `burner_bot.test.ts`
Tests for burner bot functionality including:
- **Retry Logic**: Exponential and linear backoff strategies
- **Error Handling**: Connection timeouts, RPC errors, transaction failures
- **Rate Limiting**: Minimum delay enforcement between operations
- **Token Account Fetching**: Program account queries and filtering
- **Mint Information Fetching**: Mint state retrieval with retry logic
- **Burn Operations**: Token burning instructions and validation
- **Transaction Building**: Withdraw and burn transaction assembly
- **Logging and Monitoring**: Structured logging and health monitoring
- **Graceful Shutdown**: Signal handling (SIGINT, SIGTERM)
- **Consecutive Failure Handling**: Failure tracking and shutdown logic

**Key Features Tested:**
- ✅ Exponential backoff retry with configurable delays
- ✅ Linear retry strategy implementation
- ✅ Rate limiting with minimum delay enforcement
- ✅ Rate-limited function wrapper creation
- ✅ Token account fetching and filtering
- ✅ Mint info retrieval with error handling
- ✅ Burn instruction creation and validation
- ✅ Transaction building for withdraw and burn operations
- ✅ Structured logging with timestamps and context
- ✅ Graceful shutdown signal handling
- ✅ Consecutive failure tracking and limits

### 3. `utils.test.ts`
Tests for utility functions including:
- **TokenMath**: Token/base unit conversions, fee calculations
- **PDAUtils**: Program Derived Address generation
- **AccountUtils**: Account validation and keypair parsing
- **EnvUtils**: Environment variable management
- **RetryUtils**: Retry strategies with backoff
- **ValidationUtils**: Input validation and error checking
- **LogUtils**: Structured logging utilities
- **RateLimitUtils**: Rate limiting implementation

**Key Features Tested:**
- ✅ Token to base unit conversions (with various decimals)
- ✅ Base unit to token conversions
- ✅ Fee calculation based on basis points
- ✅ Net amount calculation after fees
- ✅ Wallet cap validation
- ✅ Hook config PDA derivation
- ✅ Extra account metas PDA derivation
- ✅ Mint address validation
- ✅ Program ID validation
- ✅ Keypair parsing from base58
- ✅ Environment variable validation (required/optional)
- ✅ Retry logic with exponential/linear backoff
- ✅ Input validation (positive amounts, sufficient balance)
- ✅ Fee basis points validation
- ✅ Structured log entry creation
- ✅ Rate limiting enforcement

## Test Configuration

### Jest Configuration (`jest.config.js`)
```javascript
{
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/app/ts/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/app/ts/__tests__/setup.ts'],
  coverageDirectory: 'coverage',
  testTimeout: 30000
}
```

### Setup File (`setup.ts`)
- Mock environment variables
- Global test timeout configuration
- Console log suppression for cleaner test output
- Mock cleanup after each test
- Default environment variable setup

## Mocking Strategy

### External Dependencies Mocked:
- `@solana/web3.js`: Connection, Keypair, PublicKey, transactions
- `@solana/spl-token`: Token operations, mint operations
- `@coral-xyz/anchor`: Anchor framework components
- `bs58`: Base58 encoding/decoding
- Console methods for clean test output

### Mock Features:
- **RPC Call Mocking**: Complete mocking of Solana RPC calls
- **Keypair Generation**: Mock keypair creation and validation
- **Transaction Simulation**: Mock transaction building and signing
- **Time Control**: Jest fake timers for retry and rate limiting tests
- **Error Simulation**: Controlled error injection for error handling tests

## Running Tests

### Available Commands:
```bash
# Run all Jest tests
npm run test:jest

# Run Jest tests in watch mode
npm run test:jest-watch

# Run only TypeScript utility tests
npm run test:ts-utils

# Run all tests (Mocha + Jest)
npm run test:all
```

### Test Coverage:
The test suite provides comprehensive coverage of:
- **Happy Path Scenarios**: Normal operation flows
- **Error Scenarios**: Invalid inputs, network failures, timeout handling
- **Edge Cases**: Zero values, maximum values, boundary conditions
- **Retry Logic**: Failure recovery and backoff strategies
- **Rate Limiting**: API call frequency control
- **Validation**: Input validation and sanitization

## Test Results

### Expected Test Statistics:
- **create_mint.test.ts**: ~40 test cases covering mint creation
- **burner_bot.test.ts**: ~35 test cases covering burner bot operations  
- **utils.test.ts**: ~50 test cases covering utility functions
- **Total**: ~125 comprehensive unit tests

### Coverage Areas:
- ✅ **Function Coverage**: All utility functions tested
- ✅ **Branch Coverage**: All conditional paths tested
- ✅ **Error Coverage**: All error scenarios handled
- ✅ **Mock Coverage**: All external dependencies mocked
- ✅ **Integration Points**: Interface boundaries tested

## Development Guidelines

### Adding New Tests:
1. Create test file with `.test.ts` extension
2. Import required dependencies and utilities
3. Set up proper mocking in `beforeEach`
4. Group related tests in `describe` blocks
5. Use descriptive test names starting with "should"
6. Include both positive and negative test cases
7. Clean up mocks in `afterEach`

### Mock Best Practices:
- Mock external dependencies completely
- Use `jest.clearAllMocks()` between tests
- Provide realistic mock return values
- Test both success and failure scenarios
- Use `jest.spyOn()` for partial mocking when needed

### Error Testing:
- Test all possible error conditions
- Verify error messages and types
- Test error propagation through retry logic
- Validate error logging and monitoring

## Troubleshooting

### Common Issues:
1. **Mock Not Working**: Ensure mocks are set up before imports
2. **Timer Tests Failing**: Use `jest.useFakeTimers()` and `jest.runAllTimers()`
3. **Async Test Issues**: Use `await` with async operations
4. **Environment Variables**: Set up test env vars in setup file

### Debug Tips:
- Use `console.log` temporarily in tests (will be mocked)
- Add `--verbose` flag to see detailed test output
- Use Jest's `--detectOpenHandles` to find hanging processes
- Check mock implementations match expected interface

## Continuous Integration

The test suite is designed to run in CI/CD environments:
- No external dependencies (all mocked)
- Deterministic test results
- Fast execution (< 30 seconds)
- Comprehensive coverage reporting
- Clean exit without hanging processes

## Security Considerations

Tests follow security best practices:
- No real private keys or sensitive data
- Mock all external network calls
- Validate input sanitization
- Test error handling without exposing details
- No production data in test cases