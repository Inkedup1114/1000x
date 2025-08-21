import fc from 'fast-check';
import { TokenMath, ValidationUtils } from '../../app/ts/utils';

// Test constants
const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%
const MAX_BASIS_POINTS = 10000; // 100%

describe('Property-Based Tests: Fee Calculations', () => {
  describe('Fee Calculation Properties', () => {
    test('fee + net amount should always equal original amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1n, max: 2n ** 32n }),
          fc.integer({ min: 0, max: MAX_BASIS_POINTS }),
          async (amount, feeBasisPoints) => {
            try {
              ValidationUtils.validateFeeBasisPoints(feeBasisPoints);
              
              const fee = TokenMath.calculateFee(amount, feeBasisPoints);
              const netAmount = TokenMath.calculateNetAmount(amount, feeBasisPoints);
              
              // Core property: fee + net = original
              expect(fee + netAmount).toBe(amount);
              
              // Additional properties
              expect(fee).toBeGreaterThanOrEqual(0n);
              expect(netAmount).toBeGreaterThanOrEqual(0n);
              expect(fee).toBeLessThanOrEqual(amount);
              expect(netAmount).toBeLessThanOrEqual(amount);
            } catch (error) {
              // Invalid fee basis points should throw
              expect(feeBasisPoints < 0 || feeBasisPoints > MAX_BASIS_POINTS).toBe(true);
            }
          }
        ),
        { numRuns: 1000 }
      );
    });

    test('fee should be proportional to amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1000n, max: 2n ** 40n }),
          fc.integer({ min: 1, max: MAX_BASIS_POINTS }),
          async (amount, feeBasisPoints) => {
            const fee = TokenMath.calculateFee(amount, feeBasisPoints);
            const expectedFee = (amount * BigInt(feeBasisPoints)) / BigInt(MAX_BASIS_POINTS);
            
            expect(fee).toBe(expectedFee);
            
            // Double the amount should double the fee
            const doubleAmount = amount * 2n;
            const doubleFee = TokenMath.calculateFee(doubleAmount, feeBasisPoints);
            expect(doubleFee).toBe(fee * 2n);
          }
        ),
        { numRuns: 500 }
      );
    });

    test('zero amount should always result in zero fee', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: MAX_BASIS_POINTS }),
          async (feeBasisPoints) => {
            const fee = TokenMath.calculateFee(0n, feeBasisPoints);
            const netAmount = TokenMath.calculateNetAmount(0n, feeBasisPoints);
            
            expect(fee).toBe(0n);
            expect(netAmount).toBe(0n);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('100% fee should result in zero net amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1n, max: 2n ** 32n }),
          async (amount) => {
            const fee = TokenMath.calculateFee(amount, MAX_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(amount, MAX_BASIS_POINTS);
            
            expect(fee).toBe(amount);
            expect(netAmount).toBe(0n);
          }
        ),
        { numRuns: 200 }
      );
    });

    test('zero fee should result in full net amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1n, max: 2n ** 32n }),
          async (amount) => {
            const fee = TokenMath.calculateFee(amount, 0);
            const netAmount = TokenMath.calculateNetAmount(amount, 0);
            
            expect(fee).toBe(0n);
            expect(netAmount).toBe(amount);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Edge Cases and Rounding', () => {
    test('should handle rounding correctly for indivisible amounts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 9999 }), // Amounts that don't divide evenly
          async (amount) => {
            const amountBigInt = BigInt(amount);
            const fee = TokenMath.calculateFee(amountBigInt, TRANSFER_FEE_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(amountBigInt, TRANSFER_FEE_BASIS_POINTS);
            
            // Should round down (floor division)
            const expectedFee = (amountBigInt * BigInt(TRANSFER_FEE_BASIS_POINTS)) / BigInt(MAX_BASIS_POINTS);
            expect(fee).toBe(expectedFee);
            
            // Verify no precision loss
            expect(fee + netAmount).toBe(amountBigInt);
          }
        ),
        { numRuns: 300 }
      );
    });

    test('should handle minimum fee scenarios', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 99 }), // Very small amounts
          async (smallAmount) => {
            const amount = BigInt(smallAmount);
            const fee = TokenMath.calculateFee(amount, TRANSFER_FEE_BASIS_POINTS);
            
            // For very small amounts, fee might be 0 due to rounding
            if (amount < BigInt(MAX_BASIS_POINTS / TRANSFER_FEE_BASIS_POINTS)) {
              expect(fee).toBe(0n);
            } else {
              expect(fee).toBeGreaterThan(0n);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Basis Points Validation', () => {
    test('should validate basis points range correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 15000 }),
          async (basisPoints) => {
            if (basisPoints >= 0 && basisPoints <= MAX_BASIS_POINTS) {
              expect(() => {
                ValidationUtils.validateFeeBasisPoints(basisPoints);
              }).not.toThrow();
            } else {
              expect(() => {
                ValidationUtils.validateFeeBasisPoints(basisPoints);
              }).toThrow('Fee basis points must be between 0 and 10000');
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Mathematical Properties', () => {
    test('should maintain associative property for multiple fees', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 10000n, max: 2n ** 30n }),
          fc.integer({ min: 100, max: 1000 }),
          fc.integer({ min: 100, max: 1000 }),
          async (amount, fee1, fee2) => {
            // Apply fees sequentially
            const afterFirstFee = TokenMath.calculateNetAmount(amount, fee1);
            const afterBothFees = TokenMath.calculateNetAmount(afterFirstFee, fee2);
            
            // Calculate total fee rate
            const totalFeeRate = fee1 + fee2;
            if (totalFeeRate <= MAX_BASIS_POINTS) {
              const directTotal = TokenMath.calculateNetAmount(amount, totalFeeRate);
              
              // Sequential application should be less than or equal to direct application
              // (due to compounding effect)
              expect(afterBothFees).toBeLessThanOrEqual(directTotal);
            }
          }
        ),
        { numRuns: 300 }
      );
    });

    test('should handle fee rate boundaries correctly', async () => {
      const boundaryRates = [0, 1, 999, 1000, 1001, 9999, 10000];
      
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 10000n, max: 2n ** 30n }),
          fc.constantFrom(...boundaryRates),
          async (amount, feeRate) => {
            const fee = TokenMath.calculateFee(amount, feeRate);
            const netAmount = TokenMath.calculateNetAmount(amount, feeRate);
            
            // Verify boundary behaviors
            switch (feeRate) {
              case 0:
                expect(fee).toBe(0n);
                expect(netAmount).toBe(amount);
                break;
              case 10000:
                expect(fee).toBe(amount);
                expect(netAmount).toBe(0n);
                break;
              default:
                expect(fee).toBeGreaterThan(0n);
                expect(fee).toBeLessThan(amount);
                expect(netAmount).toBeGreaterThan(0n);
                expect(netAmount).toBeLessThan(amount);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});