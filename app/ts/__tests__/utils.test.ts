import { jest } from '@jest/globals';
import { PublicKey, Keypair } from '@solana/web3.js';
import { ExtensionType } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  TokenMath,
  PDAUtils,
  AccountUtils,
  EnvUtils,
  RetryUtils,
  ValidationUtils,
  LogUtils,
  RateLimitUtils,
  WALLET_CAP_TOKENS,
  DECIMALS,
  TRANSFER_FEE_BASIS_POINTS,
  TOTAL_SUPPLY_TOKENS,
} from '../utils';

// Mock external dependencies
jest.mock('@solana/web3.js');
jest.mock('bs58');

const MockedPublicKey = PublicKey as jest.MockedClass<typeof PublicKey>;
const MockedKeypair = Keypair as jest.MockedClass<typeof Keypair>;
const mockBs58 = bs58 as jest.Mocked<typeof bs58>;

describe('Utility Functions Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('Constants', () => {
    test('should have correct constant values', () => {
      expect(WALLET_CAP_TOKENS).toBe(5);
      expect(DECIMALS).toBe(9);
      expect(TRANSFER_FEE_BASIS_POINTS).toBe(1000);
      expect(TOTAL_SUPPLY_TOKENS).toBe(1000);
    });
  });

  describe('TokenMath', () => {
    describe('tokensToBaseUnits', () => {
      test('should convert tokens to base units correctly', () => {
        expect(TokenMath.tokensToBaseUnits(1, 9)).toBe(1000000000n);
        expect(TokenMath.tokensToBaseUnits(5, 9)).toBe(5000000000n);
        expect(TokenMath.tokensToBaseUnits(1000, 9)).toBe(1000000000000n);
        expect(TokenMath.tokensToBaseUnits(0.1, 9)).toBe(100000000n);
      });

      test('should handle different decimal places', () => {
        expect(TokenMath.tokensToBaseUnits(1, 6)).toBe(1000000n);
        expect(TokenMath.tokensToBaseUnits(1, 18)).toBe(1000000000000000000n);
      });

      test('should handle zero tokens', () => {
        expect(TokenMath.tokensToBaseUnits(0, 9)).toBe(0n);
      });
    });

    describe('baseUnitsToTokens', () => {
      test('should convert base units to tokens correctly', () => {
        expect(TokenMath.baseUnitsToTokens(1000000000n, 9)).toBe(1);
        expect(TokenMath.baseUnitsToTokens(5000000000n, 9)).toBe(5);
        expect(TokenMath.baseUnitsToTokens(1000000000000n, 9)).toBe(1000);
        expect(TokenMath.baseUnitsToTokens(100000000n, 9)).toBe(0.1);
      });

      test('should handle different decimal places', () => {
        expect(TokenMath.baseUnitsToTokens(1000000n, 6)).toBe(1);
        expect(TokenMath.baseUnitsToTokens(1000000000000000000n, 18)).toBe(1);
      });

      test('should handle zero base units', () => {
        expect(TokenMath.baseUnitsToTokens(0n, 9)).toBe(0);
      });
    });

    describe('calculateFee', () => {
      test('should calculate fees correctly', () => {
        const amount = 1000000000n; // 1 token
        const feeBasisPoints = 1000; // 10%
        const expectedFee = 100000000n; // 0.1 token

        expect(TokenMath.calculateFee(amount, feeBasisPoints)).toBe(expectedFee);
      });

      test('should handle different fee rates', () => {
        const amount = 1000000000n; // 1 token
        
        expect(TokenMath.calculateFee(amount, 500)).toBe(50000000n); // 5%
        expect(TokenMath.calculateFee(amount, 2500)).toBe(250000000n); // 25%
        expect(TokenMath.calculateFee(amount, 0)).toBe(0n); // 0%
        expect(TokenMath.calculateFee(amount, 10000)).toBe(1000000000n); // 100%
      });

      test('should handle zero amount', () => {
        expect(TokenMath.calculateFee(0n, 1000)).toBe(0n);
      });
    });

    describe('calculateNetAmount', () => {
      test('should calculate net amount after fee correctly', () => {
        const amount = 1000000000n; // 1 token
        const feeBasisPoints = 1000; // 10%
        const expectedNet = 900000000n; // 0.9 token

        expect(TokenMath.calculateNetAmount(amount, feeBasisPoints)).toBe(expectedNet);
      });

      test('should handle different fee rates', () => {
        const amount = 1000000000n; // 1 token
        
        expect(TokenMath.calculateNetAmount(amount, 0)).toBe(1000000000n); // No fee
        expect(TokenMath.calculateNetAmount(amount, 2500)).toBe(750000000n); // 25% fee
        expect(TokenMath.calculateNetAmount(amount, 10000)).toBe(0n); // 100% fee
      });
    });

    describe('exceedsWalletCap', () => {
      test('should check wallet cap correctly', () => {
        const capAmount = TokenMath.tokensToBaseUnits(5, 9); // 5 tokens
        const underCapAmount = TokenMath.tokensToBaseUnits(4, 9); // 4 tokens
        const atCapAmount = TokenMath.tokensToBaseUnits(5, 9); // 5 tokens
        const overCapAmount = TokenMath.tokensToBaseUnits(6, 9); // 6 tokens

        expect(TokenMath.exceedsWalletCap(underCapAmount)).toBe(false);
        expect(TokenMath.exceedsWalletCap(atCapAmount)).toBe(false);
        expect(TokenMath.exceedsWalletCap(overCapAmount)).toBe(true);
      });

      test('should handle custom cap and decimals', () => {
        const customCapTokens = 10;
        const customDecimals = 6;
        const amount = TokenMath.tokensToBaseUnits(15, customDecimals);

        expect(TokenMath.exceedsWalletCap(amount, customCapTokens, customDecimals)).toBe(true);
      });
    });
  });

  describe('PDAUtils', () => {
    beforeEach(() => {
      MockedPublicKey.findProgramAddressSync = jest.fn();
    });

    describe('deriveHookConfigPDA', () => {
      test('should derive hook config PDA correctly', () => {
        const mockMint = new PublicKey('11111111111111111111111111111111');
        const mockProgram = new PublicKey('22222222222222222222222222222222');
        const mockPDA = new PublicKey('33333333333333333333333333333333');
        const mockBump = 254;

        MockedPublicKey.findProgramAddressSync.mockReturnValue([mockPDA, mockBump]);

        const [pda, bump] = PDAUtils.deriveHookConfigPDA(mockMint, mockProgram);

        expect(MockedPublicKey.findProgramAddressSync).toHaveBeenCalledWith(
          [Buffer.from('config'), mockMint.toBuffer()],
          mockProgram
        );
        expect(pda).toBe(mockPDA);
        expect(bump).toBe(mockBump);
      });
    });

    describe('deriveExtraAccountMetasPDA', () => {
      test('should derive extra account metas PDA correctly', () => {
        const mockMint = new PublicKey('11111111111111111111111111111111');
        const mockProgram = new PublicKey('22222222222222222222222222222222');
        const mockPDA = new PublicKey('44444444444444444444444444444444');
        const mockBump = 253;

        MockedPublicKey.findProgramAddressSync.mockReturnValue([mockPDA, mockBump]);

        const [pda, bump] = PDAUtils.deriveExtraAccountMetasPDA(mockMint, mockProgram);

        expect(MockedPublicKey.findProgramAddressSync).toHaveBeenCalledWith(
          [Buffer.from('extra-account-metas'), mockMint.toBuffer()],
          mockProgram
        );
        expect(pda).toBe(mockPDA);
        expect(bump).toBe(mockBump);
      });
    });
  });

  describe('AccountUtils', () => {
    describe('validateMintAddress', () => {
      test('should validate correct mint address', () => {
        const validAddress = '11111111111111111111111111111111';
        MockedPublicKey.mockImplementation(() => new PublicKey(validAddress) as any);

        expect(() => {
          AccountUtils.validateMintAddress(validAddress);
        }).not.toThrow();
      });

      test('should throw error for invalid mint address', () => {
        MockedPublicKey.mockImplementation(() => {
          throw new Error('Invalid public key');
        });

        expect(() => {
          AccountUtils.validateMintAddress('invalid-address');
        }).toThrow('Invalid mint address: invalid-address');
      });
    });

    describe('validateProgramId', () => {
      test('should validate correct program ID', () => {
        const validProgramId = '22222222222222222222222222222222';
        MockedPublicKey.mockImplementation(() => new PublicKey(validProgramId) as any);

        expect(() => {
          AccountUtils.validateProgramId(validProgramId);
        }).not.toThrow();
      });

      test('should throw error for invalid program ID', () => {
        MockedPublicKey.mockImplementation(() => {
          throw new Error('Invalid public key');
        });

        expect(() => {
          AccountUtils.validateProgramId('invalid-program-id');
        }).toThrow('Invalid program ID: invalid-program-id');
      });
    });

    describe('parseKeypairFromBase58', () => {
      test('should parse valid keypair from base58', () => {
        const mockSecretKey = new Uint8Array(64);
        const mockKeypair = new Keypair();

        mockBs58.decode.mockReturnValue(mockSecretKey);
        MockedKeypair.fromSecretKey.mockReturnValue(mockKeypair);

        const result = AccountUtils.parseKeypairFromBase58('valid-base58-string');

        expect(mockBs58.decode).toHaveBeenCalledWith('valid-base58-string');
        expect(MockedKeypair.fromSecretKey).toHaveBeenCalledWith(mockSecretKey);
        expect(result).toBe(mockKeypair);
      });

      test('should throw error for invalid base58 string', () => {
        mockBs58.decode.mockImplementation(() => {
          throw new Error('Invalid base58');
        });

        expect(() => {
          AccountUtils.parseKeypairFromBase58('invalid-base58');
        }).toThrow('Invalid keypair format');
      });
    });

    describe('getMintAccountSize', () => {
      test('should get correct mint account size', () => {
        const extensions = [ExtensionType.TransferFeeConfig, ExtensionType.TransferHook];
        
        // Mock the getMintLen function from utils.ts
        jest.doMock('@solana/spl-token', () => ({
          getMintLen: jest.fn().mockReturnValue(165),
        }));

        const size = AccountUtils.getMintAccountSize(extensions);
        expect(typeof size).toBe('number');
      });
    });
  });

  describe('EnvUtils', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    describe('getRequiredEnv', () => {
      test('should return environment variable if exists', () => {
        process.env.TEST_VAR = 'test-value';
        
        expect(EnvUtils.getRequiredEnv('TEST_VAR')).toBe('test-value');
      });

      test('should throw error if environment variable missing', () => {
        delete process.env.TEST_VAR;
        
        expect(() => {
          EnvUtils.getRequiredEnv('TEST_VAR');
        }).toThrow('Missing required environment variable: TEST_VAR');
      });
    });

    describe('getOptionalEnv', () => {
      test('should return environment variable if exists', () => {
        process.env.OPTIONAL_VAR = 'optional-value';
        
        expect(EnvUtils.getOptionalEnv('OPTIONAL_VAR', 'default')).toBe('optional-value');
      });

      test('should return default value if environment variable missing', () => {
        delete process.env.OPTIONAL_VAR;
        
        expect(EnvUtils.getOptionalEnv('OPTIONAL_VAR', 'default-value')).toBe('default-value');
      });
    });

    describe('validateRequiredEnvVars', () => {
      test('should not throw if all required variables exist', () => {
        process.env.VAR1 = 'value1';
        process.env.VAR2 = 'value2';
        process.env.VAR3 = 'value3';
        
        expect(() => {
          EnvUtils.validateRequiredEnvVars(['VAR1', 'VAR2', 'VAR3']);
        }).not.toThrow();
      });

      test('should throw error if any required variable missing', () => {
        process.env.VAR1 = 'value1';
        delete process.env.VAR2;
        process.env.VAR3 = 'value3';
        
        expect(() => {
          EnvUtils.validateRequiredEnvVars(['VAR1', 'VAR2', 'VAR3']);
        }).toThrow('Missing required environment variables: VAR2');
      });

      test('should list all missing variables', () => {
        delete process.env.VAR1;
        delete process.env.VAR2;
        process.env.VAR3 = 'value3';
        
        expect(() => {
          EnvUtils.validateRequiredEnvVars(['VAR1', 'VAR2', 'VAR3']);
        }).toThrow('Missing required environment variables: VAR1, VAR2');
      });
    });
  });

  describe('RetryUtils', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    describe('withExponentialBackoff', () => {
      test('should succeed on first attempt', async () => {
        const mockOperation = jest.fn().mockResolvedValue('success');
        
        const result = await RetryUtils.withExponentialBackoff(mockOperation, 3, 100, 1000);
        
        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledTimes(1);
      });

      test('should retry with exponential backoff', async () => {
        let attempts = 0;
        const mockOperation = jest.fn().mockImplementation(() => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return Promise.resolve('success');
        });

        const resultPromise = RetryUtils.withExponentialBackoff(mockOperation, 3, 100, 1000);
        
        // Fast-forward through delays
        jest.runAllTimers();
        
        const result = await resultPromise;
        
        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledTimes(3);
      });

      test('should throw after max retries', async () => {
        const mockOperation = jest.fn().mockRejectedValue(new Error('Persistent failure'));
        
        const promise = RetryUtils.withExponentialBackoff(mockOperation, 2, 100, 1000);
        
        jest.runAllTimers();
        
        await expect(promise).rejects.toThrow('Persistent failure');
        expect(mockOperation).toHaveBeenCalledTimes(2);
      });
    });

    describe('withLinearRetry', () => {
      test('should retry with linear delay', async () => {
        let attempts = 0;
        const mockOperation = jest.fn().mockImplementation(() => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Failure');
          }
          return Promise.resolve('success');
        });

        const resultPromise = RetryUtils.withLinearRetry(mockOperation, 3, 500);
        
        jest.runAllTimers();
        
        const result = await resultPromise;
        
        expect(result).toBe('success');
        expect(mockOperation).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('ValidationUtils', () => {
    describe('validatePositiveAmount', () => {
      test('should not throw for positive amounts', () => {
        expect(() => {
          ValidationUtils.validatePositiveAmount(1n);
        }).not.toThrow();

        expect(() => {
          ValidationUtils.validatePositiveAmount(1000000000n);
        }).not.toThrow();
      });

      test('should throw for zero or negative amounts', () => {
        expect(() => {
          ValidationUtils.validatePositiveAmount(0n);
        }).toThrow('Amount must be positive');

        expect(() => {
          ValidationUtils.validatePositiveAmount(-1n);
        }).toThrow('Amount must be positive');
      });
    });

    describe('validateSufficientBalance', () => {
      test('should not throw when balance is sufficient', () => {
        expect(() => {
          ValidationUtils.validateSufficientBalance(100n, 1000n);
        }).not.toThrow();

        expect(() => {
          ValidationUtils.validateSufficientBalance(1000n, 1000n);
        }).not.toThrow();
      });

      test('should throw when balance is insufficient', () => {
        expect(() => {
          ValidationUtils.validateSufficientBalance(1000n, 100n);
        }).toThrow('Insufficient balance. Transfer: 1000, Balance: 100');
      });
    });

    describe('validateFeeBasisPoints', () => {
      test('should not throw for valid fee basis points', () => {
        expect(() => {
          ValidationUtils.validateFeeBasisPoints(0);
        }).not.toThrow();

        expect(() => {
          ValidationUtils.validateFeeBasisPoints(1000);
        }).not.toThrow();

        expect(() => {
          ValidationUtils.validateFeeBasisPoints(10000);
        }).not.toThrow();
      });

      test('should throw for invalid fee basis points', () => {
        expect(() => {
          ValidationUtils.validateFeeBasisPoints(-1);
        }).toThrow('Fee basis points must be between 0 and 10000');

        expect(() => {
          ValidationUtils.validateFeeBasisPoints(10001);
        }).toThrow('Fee basis points must be between 0 and 10000');
      });
    });
  });

  describe('LogUtils', () => {
    describe('createLogEntry', () => {
      test('should create log entry with timestamp', () => {
        const entry = LogUtils.createLogEntry('INFO', 'Test message');
        
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('level', 'INFO');
        expect(entry).toHaveProperty('message', 'Test message');
        expect(new Date(entry.timestamp)).toBeInstanceOf(Date);
      });

      test('should include data if provided', () => {
        const data = { key: 'value', number: 42 };
        const entry = LogUtils.createLogEntry('ERROR', 'Error message', data);
        
        expect(entry).toHaveProperty('data', data);
      });

      test('should not include data property if not provided', () => {
        const entry = LogUtils.createLogEntry('WARN', 'Warning message');
        
        expect(entry).not.toHaveProperty('data');
      });
    });

    describe('log', () => {
      test('should log with proper JSON format', () => {
        const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
        
        LogUtils.log('INFO', 'Test log message', { test: true });
        
        expect(mockConsoleLog).toHaveBeenCalledWith(
          expect.stringContaining('"level":"INFO"')
        );
        expect(mockConsoleLog).toHaveBeenCalledWith(
          expect.stringContaining('"message":"Test log message"')
        );
        
        mockConsoleLog.mockRestore();
      });
    });
  });

  describe('RateLimitUtils', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    describe('enforceDelay', () => {
      test('should enforce minimum delay between calls', async () => {
        let currentTime = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

        // First call should not wait
        await RateLimitUtils.enforceDelay(1000);
        
        // Second call should wait
        currentTime += 500; // 500ms later
        const delayPromise = RateLimitUtils.enforceDelay(1000);
        
        jest.advanceTimersByTime(500);
        await delayPromise;

        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
      });

      test('should not delay if enough time has passed', async () => {
        let currentTime = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

        await RateLimitUtils.enforceDelay(1000);
        
        currentTime += 2000; // Wait longer than delay period
        await RateLimitUtils.enforceDelay(1000);

        // Should not call setTimeout for second delay
        expect(setTimeout).not.toHaveBeenCalled();
      });
    });

    describe('createRateLimited', () => {
      test('should create rate-limited function', async () => {
        const mockFn = jest.fn().mockResolvedValue('result');
        const rateLimitedFn = RateLimitUtils.createRateLimited(mockFn, 1000);

        let currentTime = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

        // Call rate-limited function
        const result1 = rateLimitedFn('arg1');
        currentTime += 500;
        const result2 = rateLimitedFn('arg2');
        
        jest.advanceTimersByTime(500);
        
        await Promise.all([result1, result2]);

        expect(mockFn).toHaveBeenCalledTimes(2);
        expect(mockFn).toHaveBeenCalledWith('arg1');
        expect(mockFn).toHaveBeenCalledWith('arg2');
      });
    });
  });
});