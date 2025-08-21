"use strict";
// Utility functions for the 1000x Token project
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitUtils = exports.LogUtils = exports.ValidationUtils = exports.RetryUtils = exports.EnvUtils = exports.AccountUtils = exports.PDAUtils = exports.TokenMath = exports.TOTAL_SUPPLY_TOKENS = exports.TRANSFER_FEE_BASIS_POINTS = exports.DECIMALS = exports.WALLET_CAP_TOKENS = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const bs58_1 = __importDefault(require("bs58"));
// Constants
exports.WALLET_CAP_TOKENS = 5;
exports.DECIMALS = 9;
exports.TRANSFER_FEE_BASIS_POINTS = 1000; // 10%
exports.TOTAL_SUPPLY_TOKENS = 1000;
// BigInt utility functions
class TokenMath {
    /**
     * Convert token amount to base units (with decimals)
     */
    static tokensToBaseUnits(tokens, decimals = exports.DECIMALS) {
        return BigInt(tokens * Math.pow(10, decimals));
    }
    /**
     * Convert base units to token amount (with decimals)
     */
    static baseUnitsToTokens(baseUnits, decimals = exports.DECIMALS) {
        return Number(baseUnits) / Math.pow(10, decimals);
    }
    /**
     * Calculate fee amount based on transfer amount and fee basis points
     */
    static calculateFee(amount, feeBasisPoints) {
        return (amount * BigInt(feeBasisPoints)) / BigInt(10000);
    }
    /**
     * Calculate net amount after fee deduction
     */
    static calculateNetAmount(amount, feeBasisPoints) {
        const fee = this.calculateFee(amount, feeBasisPoints);
        return amount - fee;
    }
    /**
     * Check if amount exceeds wallet cap
     */
    static exceedsWalletCap(amount, capTokens = exports.WALLET_CAP_TOKENS, decimals = exports.DECIMALS) {
        const capBaseUnits = this.tokensToBaseUnits(capTokens, decimals);
        return amount > capBaseUnits;
    }
}
exports.TokenMath = TokenMath;
// PDA derivation utilities
class PDAUtils {
    /**
     * Derive hook config PDA
     */
    static deriveHookConfigPDA(mintAddress, programId) {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("config"), mintAddress.toBuffer()], programId);
    }
    /**
     * Derive extra account metas PDA
     */
    static deriveExtraAccountMetasPDA(mintAddress, programId) {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("extra-account-metas"), mintAddress.toBuffer()], programId);
    }
}
exports.PDAUtils = PDAUtils;
// Account parsing utilities
class AccountUtils {
    /**
     * Parse and validate mint address
     */
    static validateMintAddress(address) {
        try {
            return new web3_js_1.PublicKey(address);
        }
        catch (error) {
            throw new Error(`Invalid mint address: ${address}`);
        }
    }
    /**
     * Parse and validate program ID
     */
    static validateProgramId(programId) {
        try {
            return new web3_js_1.PublicKey(programId);
        }
        catch (error) {
            throw new Error(`Invalid program ID: ${programId}`);
        }
    }
    /**
     * Parse keypair from base58 string
     */
    static parseKeypairFromBase58(base58String) {
        try {
            const secretKey = bs58_1.default.decode(base58String);
            return web3_js_1.Keypair.fromSecretKey(secretKey);
        }
        catch (error) {
            throw new Error(`Invalid keypair format: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Get required space for mint with extensions
     */
    static getMintAccountSize(extensions) {
        return (0, spl_token_1.getMintLen)(extensions);
    }
}
exports.AccountUtils = AccountUtils;
// Environment variable utilities
class EnvUtils {
    /**
     * Get required environment variable or throw error
     */
    static getRequiredEnv(varName) {
        const value = process.env[varName];
        if (!value) {
            throw new Error(`Missing required environment variable: ${varName}`);
        }
        return value;
    }
    /**
     * Get optional environment variable with default
     */
    static getOptionalEnv(varName, defaultValue) {
        return process.env[varName] || defaultValue;
    }
    /**
     * Validate all required environment variables
     */
    static validateRequiredEnvVars(requiredVars) {
        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }
    }
}
exports.EnvUtils = EnvUtils;
// Retry utilities
class RetryUtils {
    /**
     * Execute function with exponential backoff retry
     */
    static async withExponentialBackoff(operation, maxRetries = 3, initialDelay = 1000, maxDelay = 10000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error(`Failed after ${maxRetries} attempts`);
    }
    /**
     * Execute function with linear retry
     */
    static async withLinearRetry(operation, maxRetries = 3, delay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error(`Failed after ${maxRetries} attempts`);
    }
}
exports.RetryUtils = RetryUtils;
// Validation utilities
class ValidationUtils {
    /**
     * Validate token amount is positive
     */
    static validatePositiveAmount(amount) {
        if (amount <= 0n) {
            throw new Error('Amount must be positive');
        }
    }
    /**
     * Validate transfer amount doesn't exceed balance
     */
    static validateSufficientBalance(transferAmount, balance) {
        if (transferAmount > balance) {
            throw new Error(`Insufficient balance. Transfer: ${transferAmount}, Balance: ${balance}`);
        }
    }
    /**
     * Validate fee basis points are within valid range
     */
    static validateFeeBasisPoints(basisPoints) {
        if (basisPoints < 0 || basisPoints > 10000) {
            throw new Error('Fee basis points must be between 0 and 10000');
        }
    }
}
exports.ValidationUtils = ValidationUtils;
// Logging utilities
class LogUtils {
    /**
     * Create structured log entry
     */
    static createLogEntry(level, message, data) {
        return {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...(data && { data })
        };
    }
    /**
     * Log with structured format
     */
    static log(level, message, data) {
        const entry = this.createLogEntry(level, message, data);
        console.log(JSON.stringify(entry));
    }
}
exports.LogUtils = LogUtils;
// Rate limiting utilities
class RateLimitUtils {
    /**
     * Ensure minimum delay between calls
     */
    static async enforceDelay(minDelayMs) {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCall;
        if (timeSinceLastCall < minDelayMs) {
            const waitTime = minDelayMs - timeSinceLastCall;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastCall = Date.now();
    }
    /**
     * Create a rate-limited version of a function
     */
    static createRateLimited(fn, minDelayMs) {
        return (async (...args) => {
            await this.enforceDelay(minDelayMs);
            return fn(...args);
        });
    }
}
exports.RateLimitUtils = RateLimitUtils;
RateLimitUtils.lastCall = 0;
