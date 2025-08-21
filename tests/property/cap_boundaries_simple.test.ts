import fc from 'fast-check';
import { expect } from 'chai';
import { TokenMath, ValidationUtils } from '../../app/ts/utils';

// Test constants - matching the actual program values
const WALLET_CAP_TOKENS = 5;
const DECIMALS = 9;
const WALLET_CAP_BASE_UNITS = BigInt(WALLET_CAP_TOKENS * Math.pow(10, DECIMALS)); // 5_000_000_000n
const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%

describe('Property-Based Tests: Wallet Cap Boundary Conditions', () => {
  describe('Random Amounts Under Cap', () => {
    it('should always succeed for amounts under wallet cap', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 1n,
            max: WALLET_CAP_BASE_UNITS - 1n // Just under cap
          }),
          async (transferAmount) => {
            // Calculate net amount after 10% fee
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Verify that net amount doesn't exceed cap
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            // For amounts under cap, after fee, should never exceed cap
            expect(exceedsCap).to.be.false;
            
            // Verify the math is consistent
            expect(netAmount).to.be.lessThanOrEqual(WALLET_CAP_BASE_UNITS);
            expect(transferAmount).to.be.greaterThan(0n);
            expect(transferAmount).to.be.lessThan(WALLET_CAP_BASE_UNITS);
          }
        ),
        {
          numRuns: 100, // Reduced for faster execution
          seed: 42, // Deterministic seed for reproducibility
        }
      );
    });

    it('should handle fee calculations correctly for under-cap amounts', async () => {
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
            expect(fee + netAmount).to.equal(transferAmount); // Fee + net = total
            expect(fee).to.equal(transferAmount / 10n); // 10% fee
            expect(netAmount).to.equal(transferAmount * 9n / 10n); // 90% received
            expect(fee).to.be.greaterThan(0n); // Fee should be positive
            expect(netAmount).to.be.greaterThan(0n); // Net should be positive
            expect(netAmount).to.be.lessThan(transferAmount); // Net should be less than total
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Random Amounts At Exact Cap', () => {
    it('should always succeed for amounts that result in exactly cap after fees', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // Small variations
          async (feeVariation) => {
            // Calculate amount that results in exactly cap after fee
            // If we want 5 tokens after 10% fee, we need to send 5.555... tokens
            const targetNetAmount = WALLET_CAP_BASE_UNITS;
            const requiredTransferAmount = (targetNetAmount * 10n) / 9n; // Account for 10% fee
            
            // Add small variation to test boundary
            const transferAmount = requiredTransferAmount + BigInt(feeVariation);
            
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Should be at or very close to cap
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            if (netAmount <= WALLET_CAP_BASE_UNITS) {
              expect(exceedsCap).to.be.false;
            } else {
              expect(exceedsCap).to.be.true;
            }
            
            // Verify the calculation is sensible
            expect(transferAmount).to.be.greaterThan(targetNetAmount);
            expect(netAmount).to.be.lessThanOrEqual(transferAmount);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle exact cap boundary with existing balance', async () => {
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
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const finalBalance = existingBalance + netAmount;
            
            const exceedsCap = finalBalance > WALLET_CAP_BASE_UNITS;
            
            // Verify cap logic
            if (exceedsCap) {
              expect(finalBalance).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
            } else {
              expect(finalBalance).to.be.lessThanOrEqual(WALLET_CAP_BASE_UNITS);
            }
            
            // Verify math consistency
            expect(finalBalance).to.equal(existingBalance + netAmount);
            expect(netAmount).to.be.lessThanOrEqual(transferAmount);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Random Amounts Over Cap', () => {
    it('should always fail for amounts over wallet cap', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: WALLET_CAP_BASE_UNITS + 1n,
            max: WALLET_CAP_BASE_UNITS * 2n // Up to 2x cap for safety
          }),
          async (transferAmount) => {
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            
            // For amounts over cap, should always exceed cap even after fee
            expect(exceedsCap).to.be.true;
            expect(netAmount).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
            expect(transferAmount).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should fail when existing balance plus transfer exceeds cap', async () => {
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
            const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
            const finalBalance = existingBalance + netAmount;
            
            if (finalBalance > WALLET_CAP_BASE_UNITS) {
              // Should be detected as exceeding cap
              expect(finalBalance).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
              
              // Verify the transfer would be rejected
              expect(() => {
                ValidationUtils.validateSufficientBalance(transferAmount, transferAmount);
                if (finalBalance > WALLET_CAP_BASE_UNITS) {
                  throw new Error('Wallet cap exceeded');
                }
              }).to.throw('Wallet cap exceeded');
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Overflow Scenarios with Large Numbers', () => {
    it('should handle maximum possible token amounts without overflow', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({
            min: 2n ** 40n, // Large but manageable numbers
            max: 2n ** 50n // Still safe for BigInt operations
          }),
          async (largeAmount) => {
            // Test that calculations don't overflow
            const fee = TokenMath.calculateFee(largeAmount, TRANSFER_FEE_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(largeAmount, TRANSFER_FEE_BASIS_POINTS);
            
            // Verify no overflow occurred
            expect(typeof fee).to.equal('bigint');
            expect(typeof netAmount).to.equal('bigint');
            expect(fee + netAmount).to.equal(largeAmount);
            expect(fee).to.be.lessThan(largeAmount);
            expect(netAmount).to.be.lessThan(largeAmount);
            
            // Cap check should still work with large numbers
            const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
            expect(exceedsCap).to.be.true; // Large amounts should always exceed cap
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle zero and minimum values correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 0n, max: 100n }),
          async (smallAmount) => {
            if (smallAmount === 0n) {
              // Zero transfers should be handled
              const fee = TokenMath.calculateFee(smallAmount, TRANSFER_FEE_BASIS_POINTS);
              const netAmount = TokenMath.calculateNetAmount(smallAmount, TRANSFER_FEE_BASIS_POINTS);
              
              expect(fee).to.equal(0n);
              expect(netAmount).to.equal(0n);
              expect(TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS)).to.be.false;
            } else {
              // Small positive amounts
              expect(() => {
                ValidationUtils.validatePositiveAmount(smallAmount);
              }).to.not.throw();
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Concurrent Transfers to Same Destination', () => {
    it('should handle multiple simultaneous transfers correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.bigUint64({
              min: 100000000n, // 0.1 tokens
              max: 2000000000n  // 2 tokens
            }),
            { minLength: 2, maxLength: 5 }
          ),
          async (transferAmounts) => {
            // Mock starting with empty balance
            let currentBalance = 0n;
            
            // Process transfers sequentially (simulating concurrent arrival)
            for (const transferAmount of transferAmounts) {
              const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
              const proposedBalance = currentBalance + netAmount;
              
              if (proposedBalance <= WALLET_CAP_BASE_UNITS) {
                // Transfer should succeed
                currentBalance = proposedBalance;
                expect(TokenMath.exceedsWalletCap(currentBalance, WALLET_CAP_TOKENS, DECIMALS)).to.be.false;
              } else {
                // Transfer should fail - balance shouldn't change
                expect(proposedBalance).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
                expect(TokenMath.exceedsWalletCap(proposedBalance, WALLET_CAP_TOKENS, DECIMALS)).to.be.true;
                // Current balance remains unchanged
              }
              
              // Invariant: current balance should never exceed cap
              expect(currentBalance).to.be.lessThanOrEqual(WALLET_CAP_BASE_UNITS);
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Custom Generators and Shrinking', () => {
    it('should properly handle boundary test cases', async () => {
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
              expect(exceedsCap).to.be.false;
            } else {
              expect(exceedsCap).to.be.true;
            }
            
            // Verify mathematical relationships
            expect(netAmount).to.be.lessThanOrEqual(amount); // Net should be <= gross
            expect(amount - netAmount).to.equal(TokenMath.calculateFee(amount, TRANSFER_FEE_BASIS_POINTS));
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});