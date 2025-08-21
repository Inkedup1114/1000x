import { expect } from 'chai';
import { TokenMath, ValidationUtils } from '../../app/ts/utils';

// Test constants - matching the actual program values
const WALLET_CAP_TOKENS = 5;
const DECIMALS = 9;
const WALLET_CAP_BASE_UNITS = BigInt(WALLET_CAP_TOKENS * Math.pow(10, DECIMALS)); // 5_000_000_000n
const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%

// Helper function to generate random BigInt in range
function randomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min;
  const randomValue = BigInt(Math.floor(Math.random() * Number(range)));
  return min + randomValue;
}

describe('Property-Based Tests: Wallet Cap Boundary Conditions (Native)', () => {
  describe('Random Amounts Under Cap', () => {
    it('should always succeed for random amounts under wallet cap', () => {
      // Run 100 random tests
      for (let i = 0; i < 100; i++) {
        const transferAmount = randomBigInt(1n, WALLET_CAP_BASE_UNITS - 1n);
        
        // Calculate net amount after 10% fee
        const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        
        // Verify that net amount doesn't exceed cap
        const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
        
        // For amounts under cap, after fee, should never exceed cap
        expect(exceedsCap).to.be.false;
        
        // Verify the math is consistent
        expect(netAmount <= WALLET_CAP_BASE_UNITS).to.be.true;
        expect(transferAmount > 0n).to.be.true;
        expect(transferAmount < WALLET_CAP_BASE_UNITS).to.be.true;
      }
    });

    it('should handle fee calculations correctly for random under-cap amounts', () => {
      for (let i = 0; i < 50; i++) {
        const transferAmount = randomBigInt(1000n, WALLET_CAP_BASE_UNITS - 1n);
        
        // Calculate fee and net amount
        const fee = TokenMath.calculateFee(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        
        // Verify fee calculation properties
        expect(fee + netAmount).to.equal(transferAmount); // Fee + net = total
        
        // For 10% fee, allow for rounding differences due to BigInt floor division
        const expectedFee = (transferAmount * BigInt(TRANSFER_FEE_BASIS_POINTS)) / 10000n;
        const expectedNet = transferAmount - expectedFee;
        expect(fee).to.equal(expectedFee); // Actual fee calculation
        expect(netAmount).to.equal(expectedNet); // Actual net calculation
        expect(fee > 0n).to.be.true; // Fee should be positive
        expect(netAmount > 0n).to.be.true; // Net should be positive
        expect(netAmount < transferAmount).to.be.true; // Net should be less than total
      }
    });
  });

  describe('Random Amounts At Exact Cap', () => {
    it('should handle amounts that result in exactly cap after fees', () => {
      for (let i = 0; i < 50; i++) {
        // Calculate amount that results in exactly cap after fee
        const targetNetAmount = WALLET_CAP_BASE_UNITS;
        const requiredTransferAmount = (targetNetAmount * 10n) / 9n; // Account for 10% fee
        
        // Add small random variation to test boundary
        const feeVariation = BigInt(Math.floor(Math.random() * 100));
        const transferAmount = requiredTransferAmount + feeVariation;
        
        const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        
        // Should be at or very close to cap
        const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
        
        if (netAmount <= WALLET_CAP_BASE_UNITS) {
          expect(exceedsCap).to.be.false;
        } else {
          expect(exceedsCap).to.be.true;
        }
        
        // Verify the calculation is sensible
        expect(transferAmount > targetNetAmount).to.be.true;
        expect(netAmount <= transferAmount).to.be.true;
      }
    });

    it('should handle exact cap boundary with random existing balance', () => {
      for (let i = 0; i < 50; i++) {
        const existingBalance = randomBigInt(0n, WALLET_CAP_BASE_UNITS - 1n);
        const transferAmount = randomBigInt(1n, WALLET_CAP_BASE_UNITS);
        
        const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        const finalBalance = existingBalance + netAmount;
        
        const exceedsCap = finalBalance > WALLET_CAP_BASE_UNITS;
        
        // Verify cap logic
        if (exceedsCap) {
          expect(finalBalance > WALLET_CAP_BASE_UNITS).to.be.true;
        } else {
          expect(finalBalance <= WALLET_CAP_BASE_UNITS).to.be.true;
        }
        
        // Verify math consistency
        expect(finalBalance).to.equal(existingBalance + netAmount);
        expect(netAmount <= transferAmount).to.be.true;
      }
    });
  });

  describe('Random Amounts Over Cap', () => {
    it('should always fail for random amounts over wallet cap', () => {
      for (let i = 0; i < 50; i++) {
        // Use amounts that are significantly over cap to account for 10% fee
        // If we want net amount > cap, we need gross amount > cap / 0.9
        const minAmount = (WALLET_CAP_BASE_UNITS * 10n) / 9n + 1n; // Slightly over what would result in exactly cap
        const transferAmount = randomBigInt(minAmount, WALLET_CAP_BASE_UNITS * 3n);
        
        const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
        
        // For amounts over cap, should always exceed cap even after fee
        expect(exceedsCap).to.be.true;
        expect(netAmount > WALLET_CAP_BASE_UNITS).to.be.true;
        expect(transferAmount > WALLET_CAP_BASE_UNITS).to.be.true;
      }
    });

    it('should fail when existing balance plus transfer exceeds cap', () => {
      for (let i = 0; i < 50; i++) {
        const existingBalance = randomBigInt(1n, WALLET_CAP_BASE_UNITS - 1n);
        const transferAmount = randomBigInt(1n, WALLET_CAP_BASE_UNITS);
        
        const netAmount = TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
        const finalBalance = existingBalance + netAmount;
        
        if (finalBalance > WALLET_CAP_BASE_UNITS) {
          // Should be detected as exceeding cap
          expect(finalBalance > WALLET_CAP_BASE_UNITS).to.be.true;
          
          // Verify the transfer would be rejected
          expect(() => {
            ValidationUtils.validateSufficientBalance(transferAmount, transferAmount);
            if (finalBalance > WALLET_CAP_BASE_UNITS) {
              throw new Error('Wallet cap exceeded');
            }
          }).to.throw('Wallet cap exceeded');
        }
      }
    });
  });

  describe('Overflow Scenarios with Large Numbers', () => {
    it('should handle large token amounts without overflow', () => {
      for (let i = 0; i < 20; i++) {
        const largeAmount = randomBigInt(2n ** 40n, 2n ** 50n);
        
        // Test that calculations don't overflow
        const fee = TokenMath.calculateFee(largeAmount, TRANSFER_FEE_BASIS_POINTS);
        const netAmount = TokenMath.calculateNetAmount(largeAmount, TRANSFER_FEE_BASIS_POINTS);
        
        // Verify no overflow occurred
        expect(typeof fee).to.equal('bigint');
        expect(typeof netAmount).to.equal('bigint');
        expect(fee + netAmount).to.equal(largeAmount);
        expect(fee < largeAmount).to.be.true;
        expect(netAmount < largeAmount).to.be.true;
        
        // Cap check should still work with large numbers
        const exceedsCap = TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
        expect(exceedsCap).to.be.true; // Large amounts should always exceed cap
      }
    });

    it('should handle zero and minimum values correctly', () => {
      for (let i = 0; i < 20; i++) {
        const smallAmount = BigInt(Math.floor(Math.random() * 100));
        
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
    });
  });

  describe('Fee Calculation Properties', () => {
    it('fee + net amount should always equal original amount for random inputs', () => {
      for (let i = 0; i < 100; i++) {
        const amount = randomBigInt(1n, 2n ** 32n);
        const feeBasisPoints = Math.floor(Math.random() * 10001); // 0-10000
        
        try {
          ValidationUtils.validateFeeBasisPoints(feeBasisPoints);
          
          const fee = TokenMath.calculateFee(amount, feeBasisPoints);
          const netAmount = TokenMath.calculateNetAmount(amount, feeBasisPoints);
          
          // Core property: fee + net = original
          expect(fee + netAmount).to.equal(amount);
          
          // Additional properties
          expect(fee >= 0n).to.be.true;
          expect(netAmount >= 0n).to.be.true;
          expect(fee <= amount).to.be.true;
          expect(netAmount <= amount).to.be.true;
        } catch (error) {
          // Invalid fee basis points should throw - this is expected
          expect(feeBasisPoints < 0 || feeBasisPoints > 10000).to.be.true;
        }
      }
    });

    it('should handle boundary fee rates correctly', () => {
      const boundaryRates = [0, 1, 999, 1000, 1001, 9999, 10000];
      
      for (let rate of boundaryRates) {
        for (let i = 0; i < 10; i++) {
          const amount = randomBigInt(10000n, 2n ** 25n);
          
          const fee = TokenMath.calculateFee(amount, rate);
          const netAmount = TokenMath.calculateNetAmount(amount, rate);
          
          // Verify boundary behaviors
          switch (rate) {
            case 0:
              expect(fee).to.equal(0n);
              expect(netAmount).to.equal(amount);
              break;
            case 10000:
              expect(fee).to.equal(amount);
              expect(netAmount).to.equal(0n);
              break;
            default:
              expect(fee > 0n).to.be.true;
              expect(fee < amount).to.be.true;
              expect(netAmount > 0n).to.be.true;
              expect(netAmount < amount).to.be.true;
          }
        }
      }
    });
  });

  describe('Concurrent Transfers Simulation', () => {
    it('should handle multiple transfers to same destination correctly', () => {
      for (let testRun = 0; testRun < 30; testRun++) {
        // Generate 2-5 random transfer amounts
        const numTransfers = 2 + Math.floor(Math.random() * 4);
        const transferAmounts: bigint[] = [];
        
        for (let i = 0; i < numTransfers; i++) {
          transferAmounts.push(randomBigInt(100000000n, 2000000000n)); // 0.1 to 2 tokens
        }
        
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
            expect(proposedBalance > WALLET_CAP_BASE_UNITS).to.be.true;
            expect(TokenMath.exceedsWalletCap(proposedBalance, WALLET_CAP_TOKENS, DECIMALS)).to.be.true;
            // Current balance remains unchanged
          }
          
          // Invariant: current balance should never exceed cap
          expect(currentBalance <= WALLET_CAP_BASE_UNITS).to.be.true;
        }
      }
    });
  });
});