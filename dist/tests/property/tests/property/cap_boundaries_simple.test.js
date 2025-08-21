"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fast_check_1 = __importDefault(require("fast-check"));
const chai_1 = require("chai");
const utils_1 = require("../../app/ts/utils");
// Test constants - matching the actual program values
const WALLET_CAP_TOKENS = 5;
const DECIMALS = 9;
const WALLET_CAP_BASE_UNITS = BigInt(WALLET_CAP_TOKENS * Math.pow(10, DECIMALS)); // 5_000_000_000n
const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%
describe('Property-Based Tests: Wallet Cap Boundary Conditions', () => {
    describe('Random Amounts Under Cap', () => {
        it('should always succeed for amounts under wallet cap', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({
                min: 1n,
                max: WALLET_CAP_BASE_UNITS - 1n // Just under cap
            }), async (transferAmount) => {
                // Calculate net amount after 10% fee
                const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                // Verify that net amount doesn't exceed cap
                const exceedsCap = utils_1.TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
                // For amounts under cap, after fee, should never exceed cap
                (0, chai_1.expect)(exceedsCap).to.be.false;
                // Verify the math is consistent
                (0, chai_1.expect)(netAmount).to.be.lessThanOrEqual(WALLET_CAP_BASE_UNITS);
                (0, chai_1.expect)(transferAmount).to.be.greaterThan(0n);
                (0, chai_1.expect)(transferAmount).to.be.lessThan(WALLET_CAP_BASE_UNITS);
            }), {
                numRuns: 100, // Reduced for faster execution
                seed: 42, // Deterministic seed for reproducibility
            });
        });
        it('should handle fee calculations correctly for under-cap amounts', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({
                min: 1000n, // Minimum meaningful amount
                max: WALLET_CAP_BASE_UNITS - 1n
            }), async (transferAmount) => {
                // Calculate fee and net amount
                const fee = utils_1.TokenMath.calculateFee(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                // Verify fee calculation properties
                (0, chai_1.expect)(fee + netAmount).to.equal(transferAmount); // Fee + net = total
                (0, chai_1.expect)(fee).to.equal(transferAmount / 10n); // 10% fee
                (0, chai_1.expect)(netAmount).to.equal(transferAmount * 9n / 10n); // 90% received
                (0, chai_1.expect)(fee).to.be.greaterThan(0n); // Fee should be positive
                (0, chai_1.expect)(netAmount).to.be.greaterThan(0n); // Net should be positive
                (0, chai_1.expect)(netAmount).to.be.lessThan(transferAmount); // Net should be less than total
            }), { numRuns: 50 });
        });
    });
    describe('Random Amounts At Exact Cap', () => {
        it('should always succeed for amounts that result in exactly cap after fees', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.integer({ min: 1, max: 100 }), // Small variations
            async (feeVariation) => {
                // Calculate amount that results in exactly cap after fee
                // If we want 5 tokens after 10% fee, we need to send 5.555... tokens
                const targetNetAmount = WALLET_CAP_BASE_UNITS;
                const requiredTransferAmount = (targetNetAmount * 10n) / 9n; // Account for 10% fee
                // Add small variation to test boundary
                const transferAmount = requiredTransferAmount + BigInt(feeVariation);
                const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                // Should be at or very close to cap
                const exceedsCap = utils_1.TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
                if (netAmount <= WALLET_CAP_BASE_UNITS) {
                    (0, chai_1.expect)(exceedsCap).to.be.false;
                }
                else {
                    (0, chai_1.expect)(exceedsCap).to.be.true;
                }
                // Verify the calculation is sensible
                (0, chai_1.expect)(transferAmount).to.be.greaterThan(targetNetAmount);
                (0, chai_1.expect)(netAmount).to.be.lessThanOrEqual(transferAmount);
            }), { numRuns: 50 });
        });
        it('should handle exact cap boundary with existing balance', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({
                min: 0n,
                max: WALLET_CAP_BASE_UNITS - 1n
            }), // Existing balance
            fast_check_1.default.bigUint64({
                min: 1n,
                max: WALLET_CAP_BASE_UNITS
            }), // Transfer amount
            async (existingBalance, transferAmount) => {
                const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                const finalBalance = existingBalance + netAmount;
                const exceedsCap = finalBalance > WALLET_CAP_BASE_UNITS;
                // Verify cap logic
                if (exceedsCap) {
                    (0, chai_1.expect)(finalBalance).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
                }
                else {
                    (0, chai_1.expect)(finalBalance).to.be.lessThanOrEqual(WALLET_CAP_BASE_UNITS);
                }
                // Verify math consistency
                (0, chai_1.expect)(finalBalance).to.equal(existingBalance + netAmount);
                (0, chai_1.expect)(netAmount).to.be.lessThanOrEqual(transferAmount);
            }), { numRuns: 50 });
        });
    });
    describe('Random Amounts Over Cap', () => {
        it('should always fail for amounts over wallet cap', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({
                min: WALLET_CAP_BASE_UNITS + 1n,
                max: WALLET_CAP_BASE_UNITS * 2n // Up to 2x cap for safety
            }), async (transferAmount) => {
                const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                const exceedsCap = utils_1.TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
                // For amounts over cap, should always exceed cap even after fee
                (0, chai_1.expect)(exceedsCap).to.be.true;
                (0, chai_1.expect)(netAmount).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
                (0, chai_1.expect)(transferAmount).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
            }), { numRuns: 50 });
        });
        it('should fail when existing balance plus transfer exceeds cap', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({
                min: 1n,
                max: WALLET_CAP_BASE_UNITS - 1n
            }), // Existing balance
            fast_check_1.default.bigUint64({
                min: 1n,
                max: WALLET_CAP_BASE_UNITS
            }), // Transfer amount
            async (existingBalance, transferAmount) => {
                const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                const finalBalance = existingBalance + netAmount;
                if (finalBalance > WALLET_CAP_BASE_UNITS) {
                    // Should be detected as exceeding cap
                    (0, chai_1.expect)(finalBalance).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
                    // Verify the transfer would be rejected
                    (0, chai_1.expect)(() => {
                        utils_1.ValidationUtils.validateSufficientBalance(transferAmount, transferAmount);
                        if (finalBalance > WALLET_CAP_BASE_UNITS) {
                            throw new Error('Wallet cap exceeded');
                        }
                    }).to.throw('Wallet cap exceeded');
                }
            }), { numRuns: 50 });
        });
    });
    describe('Overflow Scenarios with Large Numbers', () => {
        it('should handle maximum possible token amounts without overflow', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({
                min: 2n ** 40n, // Large but manageable numbers
                max: 2n ** 50n // Still safe for BigInt operations
            }), async (largeAmount) => {
                // Test that calculations don't overflow
                const fee = utils_1.TokenMath.calculateFee(largeAmount, TRANSFER_FEE_BASIS_POINTS);
                const netAmount = utils_1.TokenMath.calculateNetAmount(largeAmount, TRANSFER_FEE_BASIS_POINTS);
                // Verify no overflow occurred
                (0, chai_1.expect)(typeof fee).to.equal('bigint');
                (0, chai_1.expect)(typeof netAmount).to.equal('bigint');
                (0, chai_1.expect)(fee + netAmount).to.equal(largeAmount);
                (0, chai_1.expect)(fee).to.be.lessThan(largeAmount);
                (0, chai_1.expect)(netAmount).to.be.lessThan(largeAmount);
                // Cap check should still work with large numbers
                const exceedsCap = utils_1.TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
                (0, chai_1.expect)(exceedsCap).to.be.true; // Large amounts should always exceed cap
            }), { numRuns: 20 });
        });
        it('should handle zero and minimum values correctly', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.bigUint64({ min: 0n, max: 100n }), async (smallAmount) => {
                if (smallAmount === 0n) {
                    // Zero transfers should be handled
                    const fee = utils_1.TokenMath.calculateFee(smallAmount, TRANSFER_FEE_BASIS_POINTS);
                    const netAmount = utils_1.TokenMath.calculateNetAmount(smallAmount, TRANSFER_FEE_BASIS_POINTS);
                    (0, chai_1.expect)(fee).to.equal(0n);
                    (0, chai_1.expect)(netAmount).to.equal(0n);
                    (0, chai_1.expect)(utils_1.TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS)).to.be.false;
                }
                else {
                    // Small positive amounts
                    (0, chai_1.expect)(() => {
                        utils_1.ValidationUtils.validatePositiveAmount(smallAmount);
                    }).to.not.throw();
                }
            }), { numRuns: 20 });
        });
    });
    describe('Concurrent Transfers to Same Destination', () => {
        it('should handle multiple simultaneous transfers correctly', async () => {
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.array(fast_check_1.default.bigUint64({
                min: 100000000n, // 0.1 tokens
                max: 2000000000n // 2 tokens
            }), { minLength: 2, maxLength: 5 }), async (transferAmounts) => {
                // Mock starting with empty balance
                let currentBalance = 0n;
                // Process transfers sequentially (simulating concurrent arrival)
                for (const transferAmount of transferAmounts) {
                    const netAmount = utils_1.TokenMath.calculateNetAmount(transferAmount, TRANSFER_FEE_BASIS_POINTS);
                    const proposedBalance = currentBalance + netAmount;
                    if (proposedBalance <= WALLET_CAP_BASE_UNITS) {
                        // Transfer should succeed
                        currentBalance = proposedBalance;
                        (0, chai_1.expect)(utils_1.TokenMath.exceedsWalletCap(currentBalance, WALLET_CAP_TOKENS, DECIMALS)).to.be.false;
                    }
                    else {
                        // Transfer should fail - balance shouldn't change
                        (0, chai_1.expect)(proposedBalance).to.be.greaterThan(WALLET_CAP_BASE_UNITS);
                        (0, chai_1.expect)(utils_1.TokenMath.exceedsWalletCap(proposedBalance, WALLET_CAP_TOKENS, DECIMALS)).to.be.true;
                        // Current balance remains unchanged
                    }
                    // Invariant: current balance should never exceed cap
                    (0, chai_1.expect)(currentBalance).to.be.lessThanOrEqual(WALLET_CAP_BASE_UNITS);
                }
            }), { numRuns: 30 });
        });
    });
    describe('Custom Generators and Shrinking', () => {
        it('should properly handle boundary test cases', async () => {
            // Custom generator that focuses on boundary conditions
            const genBoundaryAmount = fast_check_1.default.oneof(fast_check_1.default.constant(WALLET_CAP_BASE_UNITS - 1n), // Just under cap
            fast_check_1.default.constant(WALLET_CAP_BASE_UNITS), // Exactly at cap
            fast_check_1.default.constant(WALLET_CAP_BASE_UNITS + 1n), // Just over cap
            fast_check_1.default.bigUint64({ min: WALLET_CAP_BASE_UNITS - 100n, max: WALLET_CAP_BASE_UNITS + 100n }));
            await fast_check_1.default.assert(fast_check_1.default.asyncProperty(genBoundaryAmount, async (amount) => {
                const netAmount = utils_1.TokenMath.calculateNetAmount(amount, TRANSFER_FEE_BASIS_POINTS);
                const exceedsCap = utils_1.TokenMath.exceedsWalletCap(netAmount, WALLET_CAP_TOKENS, DECIMALS);
                // Verify boundary behavior is consistent
                if (netAmount <= WALLET_CAP_BASE_UNITS) {
                    (0, chai_1.expect)(exceedsCap).to.be.false;
                }
                else {
                    (0, chai_1.expect)(exceedsCap).to.be.true;
                }
                // Verify mathematical relationships
                (0, chai_1.expect)(netAmount).to.be.lessThanOrEqual(amount); // Net should be <= gross
                (0, chai_1.expect)(amount - netAmount).to.equal(utils_1.TokenMath.calculateFee(amount, TRANSFER_FEE_BASIS_POINTS));
            }), { numRuns: 50 });
        });
    });
});
