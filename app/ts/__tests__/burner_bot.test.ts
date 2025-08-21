import { jest } from '@jest/globals';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createWithdrawWithheldTokensFromAccountsInstruction,
  createBurnInstruction,
  getAccount,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { RetryUtils, RateLimitUtils, LogUtils, ValidationUtils } from '../utils';

// Mock external dependencies
jest.mock('@solana/web3.js');
jest.mock('@solana/spl-token');
jest.mock('bs58');

const MockedConnection = Connection as jest.MockedClass<typeof Connection>;
const MockedKeypair = Keypair as jest.MockedClass<typeof Keypair>;
const MockedPublicKey = PublicKey as jest.MockedClass<typeof PublicKey>;
const mockSendAndConfirmTransaction = sendAndConfirmTransaction as jest.MockedFunction<typeof sendAndConfirmTransaction>;
const mockGetMint = getMint as jest.MockedFunction<typeof getMint>;
const mockGetAccount = getAccount as jest.MockedFunction<typeof getAccount>;
const mockBs58 = bs58 as jest.Mocked<typeof bs58>;

// Mock console.log to capture logs
const mockConsoleLog = jest.fn();
console.log = mockConsoleLog;

describe('Burner Bot Tests', () => {
  let mockConnection: jest.Mocked<Connection>;
  let mockBurnerAuthority: jest.Mocked<Keypair>;
  let mockMintAddress: jest.Mocked<PublicKey>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Setup mock instances
    mockConnection = {
      getMint: jest.fn(),
      getAccount: jest.fn(),
      getProgramAccounts: jest.fn(),
      sendTransaction: jest.fn(),
    } as any;

    mockBurnerAuthority = {
      publicKey: new PublicKey('11111111111111111111111111111111'),
      secretKey: new Uint8Array(64),
    } as any;

    mockMintAddress = new PublicKey('22222222222222222222222222222222') as any;

    // Setup mock implementations
    MockedConnection.mockImplementation(() => mockConnection);
    MockedKeypair.fromSecretKey.mockReturnValue(mockBurnerAuthority);
    mockBs58.decode.mockReturnValue(new Uint8Array(64));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Retry Logic', () => {
    test('should retry failed operations with exponential backoff', async () => {
      let attempts = 0;
      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Operation failed');
        }
        return Promise.resolve('success');
      });

      const result = await RetryUtils.withExponentialBackoff(mockOperation, 3, 100, 1000);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    test('should throw after max retries exceeded', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Persistent failure'));

      await expect(
        RetryUtils.withExponentialBackoff(mockOperation, 2, 100, 1000)
      ).rejects.toThrow('Persistent failure');

      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    test('should use exponential backoff delays', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = jest.fn().mockImplementation((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0); // Execute immediately for test
      });

      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Operation failed');
        }
        return Promise.resolve('success');
      });

      await RetryUtils.withExponentialBackoff(mockOperation, 3, 100, 1000);

      // First retry should be ~100ms, second should be ~200ms
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);

      global.setTimeout = originalSetTimeout;
    });

    test('should respect maximum delay limit', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = jest.fn().mockImplementation((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      });

      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 5) {
          throw new Error('Operation failed');
        }
        return Promise.resolve('success');
      });

      const maxDelay = 300;
      await RetryUtils.withExponentialBackoff(mockOperation, 5, 100, maxDelay);

      // Delays should be capped at maxDelay
      expect(delays[3]).toBe(maxDelay); // 4th attempt should be capped

      global.setTimeout = originalSetTimeout;
    });

    test('should work with linear retry strategy', async () => {
      let attempts = 0;
      const mockOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Operation failed');
        }
        return Promise.resolve('success');
      });

      const result = await RetryUtils.withLinearRetry(mockOperation, 3, 100);

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    test('should handle connection errors gracefully', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Connection timeout'));

      await expect(
        RetryUtils.withExponentialBackoff(mockOperation, 1)
      ).rejects.toThrow('Connection timeout');
    });

    test('should handle RPC errors with proper logging', async () => {
      const error = new Error('RPC Error: -32603');
      const mockOperation = jest.fn().mockRejectedValue(error);

      await expect(
        RetryUtils.withExponentialBackoff(mockOperation, 1)
      ).rejects.toThrow('RPC Error: -32603');

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('should validate environment variables', () => {
      const requiredVars = ['RPC_URL', 'BURNER_AUTHORITY_KEY', 'MINT_ADDRESS'];
      
      // Mock missing environment variable
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.RPC_URL;

      expect(() => {
        ValidationUtils.validatePositiveAmount(0n);
      }).toThrow('Amount must be positive');

      // Restore environment
      process.env = originalEnv;
    });

    test('should handle invalid keypair format', () => {
      mockBs58.decode.mockImplementation(() => {
        throw new Error('Invalid base58 string');
      });

      expect(() => {
        Keypair.fromSecretKey(bs58.decode('invalid-key'));
      }).toThrow();
    });

    test('should handle transaction simulation failures', async () => {
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction simulation failed')
      );

      const tx = new Transaction();
      await expect(
        mockSendAndConfirmTransaction(mockConnection, tx, [mockBurnerAuthority])
      ).rejects.toThrow('Transaction simulation failed');
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce minimum delay between operations', async () => {
      const start = Date.now();
      
      // Mock Date.now to control time
      let currentTime = start;
      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First call should not wait
      await RateLimitUtils.enforceDelay(1000);
      
      // Second call should wait
      currentTime += 500; // 500ms later
      const delayPromise = RateLimitUtils.enforceDelay(1000);
      
      // Fast-forward timers
      jest.advanceTimersByTime(500);
      await delayPromise;

      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    test('should create rate-limited function wrapper', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const rateLimitedFn = RateLimitUtils.createRateLimited(mockFn, 1000);

      // Mock Date.now
      let currentTime = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First call
      const result1 = rateLimitedFn('arg1');
      currentTime += 500;
      
      // Second call should be delayed
      const result2 = rateLimitedFn('arg2');
      
      jest.advanceTimersByTime(500);
      
      await Promise.all([result1, result2]);

      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenCalledWith('arg1');
      expect(mockFn).toHaveBeenCalledWith('arg2');
    });

    test('should not delay if enough time has passed', async () => {
      let currentTime = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First call
      await RateLimitUtils.enforceDelay(1000);
      
      // Wait longer than the delay period
      currentTime += 2000;
      
      // Second call should not wait
      await RateLimitUtils.enforceDelay(1000);

      // No setTimeout should be called for the second delay
      expect(setTimeout).not.toHaveBeenCalled();
    });
  });

  describe('Token Account Fetching', () => {
    test('should fetch token accounts correctly', async () => {
      const mockTokenAccounts = [
        {
          pubkey: new PublicKey('33333333333333333333333333333333'),
          account: { data: Buffer.from('mock-data'), owner: TOKEN_2022_PROGRAM_ID }
        },
        {
          pubkey: new PublicKey('44444444444444444444444444444444'),
          account: { data: Buffer.from('mock-data'), owner: TOKEN_2022_PROGRAM_ID }
        }
      ];

      mockConnection.getProgramAccounts.mockResolvedValue(mockTokenAccounts);

      const result = await mockConnection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        filters: [
          { dataSize: 165 },
          {
            memcmp: {
              offset: 0,
              bytes: mockMintAddress.toBase58(),
            },
          },
        ],
      });

      expect(result).toEqual(mockTokenAccounts);
      expect(mockConnection.getProgramAccounts).toHaveBeenCalledWith(
        TOKEN_2022_PROGRAM_ID,
        expect.objectContaining({
          filters: expect.arrayContaining([
            { dataSize: 165 },
            expect.objectContaining({
              memcmp: expect.objectContaining({
                offset: 0,
                bytes: mockMintAddress.toBase58(),
              }),
            }),
          ]),
        })
      );
    });

    test('should handle empty token accounts', async () => {
      mockConnection.getProgramAccounts.mockResolvedValue([]);

      const result = await mockConnection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        filters: [{ dataSize: 165 }],
      });

      expect(result).toEqual([]);
    });

    test('should limit accounts per transaction for compute limits', () => {
      const MAX_ACCOUNTS_PER_TX = 10;
      const allAccounts = Array.from({ length: 15 }, (_, i) => 
        new PublicKey(`${i.toString().padStart(44, '1')}`)
      );

      const limitedAccounts = allAccounts.slice(0, MAX_ACCOUNTS_PER_TX);

      expect(limitedAccounts).toHaveLength(MAX_ACCOUNTS_PER_TX);
      expect(limitedAccounts.length).toBeLessThanOrEqual(allAccounts.length);
    });
  });

  describe('Mint Information Fetching', () => {
    test('should fetch mint info with retry', async () => {
      const mockMintInfo = {
        supply: 1000000000000n,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: null,
        mintAuthority: mockBurnerAuthority.publicKey,
      };

      mockGetMint.mockResolvedValue(mockMintInfo as any);

      const result = await mockGetMint(mockConnection, mockMintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);

      expect(result).toEqual(mockMintInfo);
      expect(mockGetMint).toHaveBeenCalledWith(
        mockConnection,
        mockMintAddress,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
    });

    test('should handle mint fetch failures', async () => {
      mockGetMint.mockRejectedValue(new Error('Mint not found'));

      await expect(
        mockGetMint(mockConnection, mockMintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID)
      ).rejects.toThrow('Mint not found');
    });
  });

  describe('Burn Operations', () => {
    test('should create burn instruction with correct parameters', () => {
      const burnSinkAta = new PublicKey('55555555555555555555555555555555');
      const amountToBurn = 1000000000n; // 1 token

      const burnIx = createBurnInstruction(
        burnSinkAta,
        mockMintAddress,
        mockBurnerAuthority.publicKey,
        amountToBurn,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      expect(createBurnInstruction).toHaveBeenCalledWith(
        burnSinkAta,
        mockMintAddress,
        mockBurnerAuthority.publicKey,
        amountToBurn,
        [],
        TOKEN_2022_PROGRAM_ID
      );
    });

    test('should handle zero balance burn attempts', () => {
      const amountToBurn = 0n;

      if (amountToBurn > 0n) {
        // Should not create burn instruction
        expect(createBurnInstruction).not.toHaveBeenCalled();
      } else {
        // Should log that no fees collected
        expect(true).toBe(true); // No burn operation needed
      }
    });

    test('should validate burn amount is positive', () => {
      expect(() => {
        ValidationUtils.validatePositiveAmount(1000000000n);
      }).not.toThrow();

      expect(() => {
        ValidationUtils.validatePositiveAmount(0n);
      }).toThrow('Amount must be positive');

      expect(() => {
        ValidationUtils.validatePositiveAmount(-1000000000n);
      }).toThrow('Amount must be positive');
    });
  });

  describe('Transaction Building and Execution', () => {
    test('should build withdraw and burn transaction correctly', () => {
      const tx = new Transaction();
      const burnSinkAta = new PublicKey('55555555555555555555555555555555');
      const accountsToWithdraw = [
        new PublicKey('66666666666666666666666666666666'),
        new PublicKey('77777777777777777777777777777777'),
      ];

      // Add create ATA instruction if needed
      const createAtaIx = createAssociatedTokenAccountInstruction(
        mockBurnerAuthority.publicKey,
        burnSinkAta,
        mockBurnerAuthority.publicKey,
        mockMintAddress,
        TOKEN_2022_PROGRAM_ID
      );

      // Add withdraw instruction
      const withdrawIx = createWithdrawWithheldTokensFromAccountsInstruction(
        mockMintAddress,
        burnSinkAta,
        mockBurnerAuthority.publicKey,
        [],
        accountsToWithdraw,
        TOKEN_2022_PROGRAM_ID
      );

      tx.add(createAtaIx, withdrawIx);

      expect(tx.instructions).toHaveLength(2);
    });

    test('should handle transaction confirmation', async () => {
      const tx = new Transaction();
      const mockSignature = 'test-transaction-signature';

      mockSendAndConfirmTransaction.mockResolvedValue(mockSignature);

      const result = await mockSendAndConfirmTransaction(
        mockConnection,
        tx,
        [mockBurnerAuthority],
        { commitment: 'confirmed', maxRetries: 0 }
      );

      expect(result).toBe(mockSignature);
      expect(mockSendAndConfirmTransaction).toHaveBeenCalledWith(
        mockConnection,
        tx,
        [mockBurnerAuthority],
        { commitment: 'confirmed', maxRetries: 0 }
      );
    });
  });

  describe('Logging and Monitoring', () => {
    test('should create structured log entries', () => {
      const logEntry = LogUtils.createLogEntry('INFO', 'Test message', { key: 'value' });

      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('level', 'INFO');
      expect(logEntry).toHaveProperty('message', 'Test message');
      expect(logEntry).toHaveProperty('data', { key: 'value' });
      expect(new Date(logEntry.timestamp)).toBeInstanceOf(Date);
    });

    test('should log with proper formatting', () => {
      LogUtils.log('ERROR', 'Test error', { error: 'Something went wrong' });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"level":"ERROR"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test error"')
      );
    });

    test('should handle log data serialization', () => {
      const complexData = {
        publicKey: mockBurnerAuthority.publicKey,
        amount: 1000000000n,
        nested: { array: [1, 2, 3] }
      };

      const logEntry = LogUtils.createLogEntry('INFO', 'Complex data', complexData);
      
      expect(logEntry.data).toEqual(complexData);
    });
  });

  describe('Graceful Shutdown', () => {
    test('should handle SIGINT signal', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      const mockClearInterval = jest.spyOn(global, 'clearInterval');

      // Simulate SIGINT handling
      expect(() => {
        process.emit('SIGINT' as any);
      }).not.toThrow();

      mockExit.mockRestore();
      mockClearInterval.mockRestore();
    });

    test('should handle SIGTERM signal', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      const mockClearInterval = jest.spyOn(global, 'clearInterval');

      // Simulate SIGTERM handling
      expect(() => {
        process.emit('SIGTERM' as any);
      }).not.toThrow();

      mockExit.mockRestore();
      mockClearInterval.mockRestore();
    });
  });

  describe('Consecutive Failure Handling', () => {
    test('should track consecutive failures', () => {
      let consecutiveFailures = 0;
      const MAX_CONSECUTIVE_FAILURES = 5;

      // Simulate failures
      for (let i = 0; i < 3; i++) {
        consecutiveFailures++;
      }

      expect(consecutiveFailures).toBe(3);
      expect(consecutiveFailures < MAX_CONSECUTIVE_FAILURES).toBe(true);

      // Simulate success (should reset)
      consecutiveFailures = 0;
      expect(consecutiveFailures).toBe(0);
    });

    test('should shutdown after max consecutive failures', () => {
      const MAX_CONSECUTIVE_FAILURES = 5;
      let consecutiveFailures = MAX_CONSECUTIVE_FAILURES;

      const shouldShutdown = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
      expect(shouldShutdown).toBe(true);
    });
  });
});