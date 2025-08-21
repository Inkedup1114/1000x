// Jest setup file for TypeScript utility tests

import { jest } from '@jest/globals';

// Mock environment variables
process.env.NODE_ENV = 'test';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods for cleaner test output
const originalConsole = global.console;

beforeEach(() => {
  // Suppress console logs in tests unless explicitly testing logging
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  };
});

afterEach(() => {
  // Restore console after each test
  global.console = originalConsole;
  
  // Clear all mocks
  jest.clearAllMocks();
});

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection in tests:', reason);
});

// Set up default environment variables for tests
const defaultEnvVars = {
  RPC_URL: 'http://localhost:8899',
  PRIVATE_KEY: 'test-private-key-base58',
  DEV_WALLET: 'test-dev-wallet-address',
  PROGRAM_ID: 'test-program-id',
  MINT_ADDRESS: 'test-mint-address',
  BURNER_AUTHORITY_KEY: 'test-burner-authority-key',
};

// Set default env vars if not already set
Object.entries(defaultEnvVars).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

export {};