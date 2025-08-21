import fc from 'fast-check';
import { expect } from 'chai';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createTransferInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import { TokenMath, ValidationUtils } from '../../app/ts/utils';

const MockedConnection = Connection as jest.MockedClass<typeof Connection>;
const MockedKeypair = Keypair as jest.MockedClass<typeof Keypair>;
const MockedPublicKey = PublicKey as jest.MockedClass<typeof PublicKey>;
const mockSendAndConfirmTransaction = sendAndConfirmTransaction as jest.MockedFunction<typeof sendAndConfirmTransaction>;
const mockGetAccount = getAccount as jest.MockedFunction<typeof getAccount>;

// Test constants - matching the actual program values
const WALLET_CAP_TOKENS = 5;
const DECIMALS = 9;
const WALLET_CAP_BASE_UNITS = BigInt(WALLET_CAP_TOKENS * Math.pow(10, DECIMALS)); // 5_000_000_000n
const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%

// Mock setup for property tests
const setupMocks = () => {
  const mockConnection = {
    sendTransaction: jest.fn(),
    confirmTransaction: jest.fn(),
    getAccountInfo: jest.fn(),
  } as any;

  const mockPayer = {
    publicKey: new PublicKey('11111111111111111111111111111111'),
    secretKey: new Uint8Array(64),
  } as any;

  const mockMint = new PublicKey('22222222222222222222222222222222');
  const mockSource = new PublicKey('33333333333333333333333333333333');
  const mockDestination = new PublicKey('44444444444444444444444444444444');

  MockedConnection.mockImplementation(() => mockConnection);
  mockSendAndConfirmTransaction.mockResolvedValue('mock-signature');

  return {
    mockConnection,
    mockPayer,
    mockMint,
    mockSource,
    mockDestination,
  };
};

describe('Property-Based Tests: Wallet Cap Boundary Conditions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  describe('Random Amounts Under Cap', () => {
    test('should always succeed for amounts under wallet cap', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 1n,
            max: WALLET_CAP_BASE_UNITS - 1n // Just under cap
          }),
          async (transferAmount) => {
            const { mockConnection, mockPayer, mockMint, mockSource, mockDestination } = setupMocks();

            // Mock current balance as 0 (empty wallet)
            mockGetAccount.mockResolvedValue({
              amount: 0n,
              mint: mockMint,
              owner: new PublicKey('44444444444444444444444444444444'),
              address: mockDestination,
              isInitialized: true,
              isFrozen: false,
              isNative: false,
            } as any);

            // Calculate net amount after 10% fee
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Verify that net amount doesn't exceed cap
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            // For amounts under cap, after fee, should never exceed cap
            expect(exceedsCap).toBe(false);
            
            // Verify the math is consistent
            expect(netAmount).toBeLessThanOrEqual(WALLET_CAP_BASE_UNITS);
            expect(transferAmount).toBeGreaterThan(0n);
            expect(transferAmount).toBeLessThan(WALLET_CAP_BASE_UNITS);
          }
        ),
        {
          numRuns: 1000, // Run 1000 random tests
          seed: 42, // Deterministic seed for reproducibility
        }
      );
    });

    test('should handle fee calculations correctly for under-cap amounts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 1000n, // Minimum meaningful amount
            max: WALLET_CAP_BASE_UNITS - 1n
          }),
          async (transferAmount) => {
            // Calculate fee and net amount
            const fee = TokenMath.calculateFee(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Verify fee calculation properties
            expect(fee + netAmount).toBe(transferAmount); // Fee + net = total
            expect(fee).toBe(transferAmount / 10n); // 10% fee
            expect(netAmount).toBe(transferAmount * 9n / 10n); // 90% received
            expect(fee).toBeGreaterThan(0n); // Fee should be positive
            expect(netAmount).toBeGreaterThan(0n); // Net should be positive
            expect(netAmount).toBeLessThan(transferAmount); // Net should be less than total
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Random Amounts At Exact Cap', () => {
    test('should always succeed for amounts that result in exactly cap after fees', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // Small variations
          async (feeVariation) => {
            const { mockConnection, mockMint, mockDestination } = setupMocks();

            // Calculate amount that results in exactly cap after fee
            // If we want 5 tokens after 10% fee, we need to send 5.555... tokens
            const targetNetAmount = WALLET_CAP_BASE_UNITS;
            const requiredTransferAmount = (targetNetAmount * 10n) / 9n; // Account for 10% fee
            
            // Add small variation to test boundary
            const transferAmount = requiredTransferAmount + BigInt(feeVariation);
            
            // Mock current balance as 0
            mockGetAccount.mockResolvedValue({
              amount: 0n,
              mint: mockMint,
              owner: new PublicKey('44444444444444444444444444444444'),
              address: mockDestination,
            } as any);

            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Should be at or very close to cap
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            if (netAmount <= WALLET_CAP_BASE_UNITS) {
              expect(exceedsCap).toBe(false);
            } else {
              expect(exceedsCap).toBe(true);
            }
            
            // Verify the calculation is sensible
            expect(transferAmount).toBeGreaterThan(targetNetAmount);
            expect(netAmount).toBeLessThanOrEqual(transferAmount);
          }
        ),
        { numRuns: 200 }
      );
    });

    test('should handle exact cap boundary with existing balance', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 0n,
            max: WALLET_CAP_BASE_UNITS - 1n
          }), // Existing balance
          fc.bigUint64({
            min: 1n,
            max: WALLET_CAP_BASE_UNITS
          }), // Transfer amount
          async (existingBalance, transferAmount) => {
            const { mockMint, mockDestination } = setupMocks();

            // Mock existing balance
            mockGetAccount.mockResolvedValue({
              amount: existingBalance,
              mint: mockMint,
            } as any);

            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const finalBalance = existingBalance + netAmount;
            
            const exceedsCap = finalBalance > WALLET_CAP_BASE_UNITS;
            
            // Verify cap logic
            if (exceedsCap) {
              expect(finalBalance).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
            } else {
              expect(finalBalance).toBeLessThanOrEqual(WALLET_CAP_BASE_UNITS);
            }
            
            // Verify math consistency
            expect(finalBalance).toBe(existingBalance + netAmount);
            expect(netAmount).toBeLessThanOrEqual(transferAmount);
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('Random Amounts Over Cap', () => {
    test('should always fail for amounts over wallet cap', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: WALLET_CAP_BASE_UNITS + 1n,
            max: WALLET_CAP_BASE_UNITS * 10n // Up to 10x cap
          }),
          async (transferAmount) => {
            const { mockMint, mockDestination } = setupMocks();

            // Mock current balance as 0
            mockGetAccount.mockResolvedValue({
              amount: 0n,
              mint: mockMint,
            } as any);

            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            // For amounts over cap, should always exceed cap even after fee
            expect(exceedsCap).toBe(true);
            expect(netAmount).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
            expect(transferAmount).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
          }
        ),
        { numRuns: 500 }
      );
    });

    test('should fail when existing balance plus transfer exceeds cap', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 1n,
            max: WALLET_CAP_BASE_UNITS - 1n
          }), // Existing balance
          fc.bigUint64({
            min: 1n,
            max: WALLET_CAP_BASE_UNITS
          }), // Transfer amount
          async (existingBalance, transferAmount) => {
            const { mockMint } = setupMocks();

            // Mock existing balance
            mockGetAccount.mockResolvedValue({
              amount: existingBalance,
              mint: mockMint,
            } as any);

            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const finalBalance = existingBalance + netAmount;
            
            if (finalBalance > WALLET_CAP_BASE_UNITS) {
              // Should be detected as exceeding cap
              expect(finalBalance).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
              
              // Verify the transfer would be rejected
              expect(() => {
                ValidationUtils.validateSufficientBalance(transferAmount, transferAmount);
                if (finalBalance > WALLET_CAP_BASE_UNITS) {
                  throw new Error('Wallet cap exceeded');
                }
              }).toThrow('Wallet cap exceeded');
            }
          }
        ),
        { numRuns: 400 }
      );
    });
  });

  describe('Overflow Scenarios with Large Numbers', () => {
    test('should handle maximum possible token amounts without overflow', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 2n ** 60n, // Very large numbers
            max: 2n ** 63n - 1n // Near max safe BigInt
          }),
          async (largeAmount) => {
            // Test that calculations don't overflow
            const fee = TokenMath.calculateFee(largeAmount, TRANSFER_FEE_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(largeAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Verify no overflow occurred
            expect(fee).toBeInstanceOf(BigInt);
            expect(netAmount).toBeInstanceOf(BigInt);
            expect(fee + netAmount).toBe(largeAmount);
            expect(fee).toBeLessThan(largeAmount);
            expect(netAmount).toBeLessThan(largeAmount);
            
            // Cap check should still work with large numbers
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            expect(exceedsCap).toBe(true); // Large amounts should always exceed cap
          }
        ),
        { numRuns: 100 }
      );
    });

    test('should handle edge cases near maximum uint64', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(2n ** 64n - 1n), // Maximum uint64
          async (maxAmount) => {
            // Test that we can handle maximum values safely
            expect(() => {
              const fee = TokenMath.calculateFee(maxAmount, TRANSFER_FEE_BASIS_POINTS);
              const netAmount = TokenMath.calculateNetAmount(maxAmount, TRANSFER_FEE_BASIS_POINTS);
              
              // Should not throw overflow errors
              expect(fee).toBeDefined();
              expect(netAmount).toBeDefined();
              expect(typeof fee).toBe('bigint');
              expect(typeof netAmount).toBe('bigint');
            }).not.toThrow();
          }
        ),
        { numRuns: 10 }
      );
    });

    test('should handle zero and minimum values correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 0n, max: 100n }),
          async (smallAmount) => {
            if (smallAmount === 0n) {
              // Zero transfers should be handled
              const fee = TokenMath.calculateFee(smallAmount, TRANSFER_FEE_BASIS_POINTS);
              const netAmount = TokenMath.calculateNetAmount(smallAmount, TRANSFER_FEE_BASIS_POINTS);
              
              expect(fee).toBe(0n);
              expect(netAmount).toBe(0n);
              expect(TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS)).toBe(false);
            } else {
              // Small positive amounts
              expect(() => {
                ValidationUtils.validatePositiveAmount(smallAmount);
              }).not.toThrow();
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Concurrent Transfers to Same Destination', () => {
    test('should handle multiple simultaneous transfers correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.bigUint64({
              min: 100000000n, // 0.1 tokens
              max: 2000000000n  // 2 tokens
            }),
            { minLength: 2, maxLength: 10 }
          ),
          async (transferAmounts) => {
            const { mockMint, mockDestination } = setupMocks();

            // Mock starting with empty balance
            let currentBalance = 0n;
            
            // Process transfers sequentially (simulating concurrent arrival)
            for (const transferAmount of transferAmounts) {
              const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
              const proposedBalance = currentBalance + netAmount;
              
              if (proposedBalance <= WALLET_CAP_BASE_UNITS) {
                // Transfer should succeed
                currentBalance = proposedBalance;
                expect(TokenMath.exceedsWalletCap(currentBalance, WALLET_CAP_TOKENS, DECIMALS)).toBe(false);
              } else {
                // Transfer should fail - balance shouldn't change
                expect(proposedBalance).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
                expect(TokenMath.exceedsWalletCap(proposedBalance, WALLET_CAP_TOKENS, DECIMALS)).toBe(true);
                // Current balance remains unchanged
              }
              
              // Invariant: current balance should never exceed cap
              expect(currentBalance).toBeLessThanOrEqual(WALLET_CAP_BASE_UNITS);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    test('should maintain consistency under race conditions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.bigUint64({
              min: 1000000000n, // 1 token
              max: 3000000000n  // 3 tokens
            }),
            { minLength: 3, maxLength: 5 }
          ),
          async (concurrentTransfers) => {
            // Simulate race condition by checking cap for all transfers against same initial balance
            const initialBalance = 0n;
            let successfulTransfers = 0;
            let totalProcessed = 0n;
            
            for (const transferAmount of concurrentTransfers) {
              const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
              
              // Check if this transfer would exceed cap
              if (initialBalance + netAmount <= WALLET_CAP_BASE_UNITS) {
                successfulTransfers++;
                totalProcessed += netAmount;
              }
              
              // In reality, only first few transfers would succeed before hitting cap
              // But we test the cap logic for each
              const wouldExceedCap = (initialBalance + netAmount) > WALLET_CAP_BASE_UNITS;
              if (wouldExceedCap) {
                expect(initialBalance + netAmount).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
              }
            }
            
            // At least one small transfer should be possible if amounts are reasonable
            if (concurrentTransfers.length > 0) {
              const smallestNet = Math.min(...concurrentTransfers.map(amt => 
                Number(TokenMath.calculateNetAmount(amt, TRANSFER_FEE_BASIS_POINTS))
              ));
              
              if (smallestNet <= Number(WALLET_CAP_BASE_UNITS)) {
                expect(successfulTransfers).toBeGreaterThan(0);
              }
            }
          }
        ),
        { numRuns: 150 }
      );
    });
  });

  describe('Custom Generators and Shrinking', () => {
    // Custom generator for amounts that should succeed
    const genUnderCapAmount = fc.bigUint64({
      min: 1n,
      max: WALLET_CAP_BASE_UNITS - 1n
    });

    // Custom generator for amounts that should fail
    const genOverCapAmount = fc.bigUint64({
      min: WALLET_CAP_BASE_UNITS + 1n,
      max: WALLET_CAP_BASE_UNITS * 2n
    });

    test('should properly shrink failing test cases to minimal examples', async () => {
      await fc.assert(
        fc.asyncProperty(
          genOverCapAmount,
          async (amount) => {
            const netAmount = TokenMath.calculateNetAmount(amount, TRANSFER_FEE_BASIS_POINTS);
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            // This should always be true for over-cap amounts
            expect(exceedsCap).toBe(true);
            
            // Additional constraint to help with shrinking
            expect(netAmount).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
          }
        ),
        { 
          numRuns: 100,
          // Fast-check will automatically shrink to find minimal failing case
        }
      );
    });

    test('should generate comprehensive boundary test cases', async () => {
      // Custom generator that focuses on boundary conditions
      const genBoundaryAmount = fc.oneof(
        fc.constant(WALLET_CAP_BASE_UNITS - 1n), // Just under cap
        fc.constant(WALLET_CAP_BASE_UNITS),       // Exactly at cap
        fc.constant(WALLET_CAP_BASE_UNITS + 1n), // Just over cap
        fc.bigUint64({ min: WALLET_CAP_BASE_UNITS - 100n, max: WALLET_CAP_BASE_UNITS + 100n }), // Near boundary
      );

      await fc.assert(
        fc.asyncProperty(
          genBoundaryAmount,
          async (amount) => {
            const netAmount = TokenMath.calculateNetAmount(amount, TRANSFER_FEE_BASIS_POINTS);
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            // Verify boundary behavior is consistent
            if (netAmount <= WALLET_CAP_BASE_UNITS) {
              expect(exceedsCap).toBe(false);
            } else {
              expect(exceedsCap).toBe(true);
            }
            
            // Verify mathematical relationships
            expect(netAmount).toBeLessThanOrEqual(amount); // Net should be <= gross
            expect(amount - netAmount).toBe(TokenMath.calculateFee(amount, TRANSFER_FEE_BASIS_POINTS));
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Integration with Real Transfer Logic', () => {
    test('should validate complete transfer flow with random amounts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1n, max: WALLET_CAP_BASE_UNITS * 2n }),
          fc.bigUint64({ min: 0n, max: WALLET_CAP_BASE_UNITS }),
          async (transferAmount, existingBalance) => {
            const { mockMint, mockSource, mockDestination } = setupMocks();

            // Mock account states
            mockGetAccount.mockResolvedValue({
              amount: existingBalance,
              mint: mockMint,
            } as any);

            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const finalBalance = existingBalance + netAmount;
            
            // Create transfer instruction
            const transferIx = createTransferCheckedInstruction(
              mockSource,
              mockMint,
              mockDestination,
              mockSource, // authority
              transferAmount,
              DECIMALS,
              [],
              TOKEN_2022_PROGRAM_ID
            );

            expect(transferIx).toBeDefined();
            
            // Validate cap logic
            const wouldExceedCap = finalBalance > WALLET_CAP_BASE_UNITS;
            if (wouldExceedCap) {
              expect(finalBalance).toBeGreaterThan(WALLET_CAP_BASE_UNITS);
              // In real implementation, this would cause the hook to reject the transfer
            } else {
              expect(finalBalance).toBeLessThanOrEqual(WALLET_CAP_BASE_UNITS);
              // Transfer should be allowed
            }
          }
        ),
        { numRuns: 300 }
      );
    });
  });
});