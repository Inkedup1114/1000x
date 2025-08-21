import fc from 'fast-check';
import { expect } from 'chai';
import { TokenMath, ValidationUtils } from '../../app/ts/utils';

// Test constants
const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%
const MAX_BASIS_POINTS = 10000; // 100%

describe('Property-Based Tests: Fee Calculations', () => {
  describe('Fee Calculation Properties', () => {
    it('fee + net amount should always equal original amount', async () => {
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
              expect(fee + netAmount).to.equal(amount);
              
              // Additional properties
              expect(fee).to.be.greaterThanOrEqual(0n);
              expect(netAmount).to.be.greaterThanOrEqual(0n);
              expect(fee).to.be.lessThanOrEqual(amount);
              expect(netAmount).to.be.lessThanOrEqual(amount);
            } catch (error) {
              // Invalid fee basis points should throw
              expect(feeBasisPoints < 0 || feeBasisPoints > MAX_BASIS_POINTS).to.be.true;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('fee should be proportional to amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1000n, max: 2n ** 30n }),
          fc.integer({ min: 1, max: MAX_BASIS_POINTS }),
          async (amount, feeBasisPoints) => {
            const fee = TokenMath.calculateFee(amount, feeBasisPoints);
            const expectedFee = (amount * BigInt(feeBasisPoints)) / BigInt(MAX_BASIS_POINTS);
            
            expect(fee).to.equal(expectedFee);
            
            // Double the amount should double the fee
            const doubleAmount = amount * 2n;
            const doubleFee = TokenMath.calculateFee(doubleAmount, feeBasisPoints);
            expect(doubleFee).to.equal(fee * 2n);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('zero amount should always result in zero fee', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: MAX_BASIS_POINTS }),
          async (feeBasisPoints) => {
            const fee = TokenMath.calculateFee(0n, feeBasisPoints);
            const netAmount = TokenMath.calculateNetAmount(0n, feeBasisPoints);
            
            expect(fee).to.equal(0n);
            expect(netAmount).to.equal(0n);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('100% fee should result in zero net amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1n, max: 2n ** 32n }),
          async (amount) => {
            const fee = TokenMath.calculateFee(amount, MAX_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(amount, MAX_BASIS_POINTS);
            
            expect(fee).to.equal(amount);
            expect(netAmount).to.equal(0n);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('zero fee should result in full net amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 1n, max: 2n ** 32n }),
          async (amount) => {
            const fee = TokenMath.calculateFee(amount, 0);
            const netAmount = TokenMath.calculateNetAmount(amount, 0);
            
            expect(fee).to.equal(0n);
            expect(netAmount).to.equal(amount);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Edge Cases and Rounding', () => {
    it('should handle rounding correctly for indivisible amounts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 9999 }), // Amounts that don't divide evenly
          async (amount) => {
            const amountBigInt = BigInt(amount);
            const fee = TokenMath.calculateFee(amountBigInt, TRANSFER_FEE_BASIS_POINTS);
            const netAmount = TokenMath.calculateNetAmount(amountBigInt, TRANSFER_FEE_BASIS_POINTS);
            
            // Should round down (floor division)
            const expectedFee = (amountBigInt * BigInt(TRANSFER_FEE_BASIS_POINTS)) / BigInt(MAX_BASIS_POINTS);
            expect(fee).to.equal(expectedFee);
            
            // Verify no precision loss
            expect(fee + netAmount).to.equal(amountBigInt);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle minimum fee scenarios', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 99 }), // Very small amounts
          async (smallAmount) => {
            const amount = BigInt(smallAmount);
            const fee = TokenMath.calculateFee(amount, TRANSFER_FEE_BASIS_POINTS);
            
            // For very small amounts, fee might be 0 due to rounding
            if (amount < BigInt(MAX_BASIS_POINTS / TRANSFER_FEE_BASIS_POINTS)) {
              expect(fee).to.equal(0n);
            } else {
              expect(fee).to.be.greaterThan(0n);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Basis Points Validation', () => {
    it('should validate basis points range correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 15000 }),
          async (basisPoints) => {
            if (basisPoints >= 0 && basisPoints <= MAX_BASIS_POINTS) {
              expect(() => {
                ValidationUtils.validateFeeBasisPoints(basisPoints);
              }).to.not.throw();
            } else {
              expect(() => {
                ValidationUtils.validateFeeBasisPoints(basisPoints);
              }).to.throw('Fee basis points must be between 0 and 10000');
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Mathematical Properties', () => {
    it('should maintain associative property for multiple fees', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 10000n, max: 2n ** 25n }),
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
              expect(afterBothFees).to.be.lessThanOrEqual(directTotal);
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle fee rate boundaries correctly', async () => {
      const boundaryRates = [0, 1, 999, 1000, 1001, 9999, 10000];
      
      await fc.assert(
        fc.asyncProperty(
          fc.bigUint64({ min: 10000n, max: 2n ** 25n }),
          fc.constantFrom(...boundaryRates),
          async (amount, feeRate) => {
            const fee = TokenMath.calculateFee(amount, feeRate);
            const netAmount = TokenMath.calculateNetAmount(amount, feeRate);
            
            // Verify boundary behaviors
            switch (feeRate) {
              case 0:
                expect(fee).to.equal(0n);
                expect(netAmount).to.equal(amount);
                break;
              case 10000:
                expect(fee).to.equal(amount);
                expect(netAmount).to.equal(0n);
                break;
              default:
                expect(fee).to.be.greaterThan(0n);
                expect(fee).to.be.lessThan(amount);
                expect(netAmount).to.be.greaterThan(0n);
                expect(netAmount).to.be.lessThan(amount);
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});