// Utility functions for the 1000x Token project

import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen } from "@solana/spl-token";
import bs58 from "bs58";
import * as anchor from "@coral-xyz/anchor";

// Constants
export const WALLET_CAP_TOKENS = 5;
export const DECIMALS = 9;
export const TRANSFER_FEE_BASIS_POINTS = 1000; // 10%
export const TOTAL_SUPPLY_TOKENS = 1000;

// BigInt utility functions
export class TokenMath {
  /**
   * Convert token amount to base units (with decimals)
   */
  static tokensToBaseUnits(tokens: number, decimals: number = DECIMALS): bigint {
    return BigInt(tokens * Math.pow(10, decimals));
  }

  /**
   * Convert base units to token amount (with decimals)
   */
  static baseUnitsToTokens(baseUnits: bigint, decimals: number = DECIMALS): number {
    return Number(baseUnits) / Math.pow(10, decimals);
  }

  /**
   * Calculate fee amount based on transfer amount and fee basis points
   */
  static calculateFee(amount: bigint, feeBasisPoints: number): bigint {
    return (amount * BigInt(feeBasisPoints)) / BigInt(10000);
  }

  /**
   * Calculate net amount after fee deduction
   */
  static calculateNetAmount(amount: bigint, feeBasisPoints: number): bigint {
    const fee = this.calculateFee(amount, feeBasisPoints);
    return amount - fee;
  }

  /**
   * Check if amount exceeds wallet cap
   */
  static exceedsWalletCap(amount: bigint, capTokens: number = WALLET_CAP_TOKENS, decimals: number = DECIMALS): boolean {
    const capBaseUnits = this.tokensToBaseUnits(capTokens, decimals);
    return amount > capBaseUnits;
  }
}

// PDA derivation utilities
export class PDAUtils {
  /**
   * Derive hook config PDA
   */
  static deriveHookConfigPDA(mintAddress: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mintAddress.toBuffer()],
      programId
    );
  }

  /**
   * Derive extra account metas PDA
   */
  static deriveExtraAccountMetasPDA(mintAddress: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintAddress.toBuffer()],
      programId
    );
  }
}

// Account parsing utilities
export class AccountUtils {
  /**
   * Parse and validate mint address
   */
  static validateMintAddress(address: string): PublicKey {
    try {
      return new PublicKey(address);
    } catch (error) {
      throw new Error(`Invalid mint address: ${address}`);
    }
  }

  /**
   * Parse and validate program ID
   */
  static validateProgramId(programId: string): PublicKey {
    try {
      return new PublicKey(programId);
    } catch (error) {
      throw new Error(`Invalid program ID: ${programId}`);
    }
  }

  /**
   * Parse keypair from base58 string
   */
  static parseKeypairFromBase58(base58String: string): Keypair {
    try {
      const secretKey = bs58.decode(base58String);
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      throw new Error(`Invalid keypair format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get required space for mint with extensions
   */
  static getMintAccountSize(extensions: ExtensionType[]): number {
    return getMintLen(extensions);
  }
}

// Environment variable utilities
export class EnvUtils {
  /**
   * Get required environment variable or throw error
   */
  static getRequiredEnv(varName: string): string {
    const value = process.env[varName];
    if (!value) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
    return value;
  }

  /**
   * Get optional environment variable with default
   */
  static getOptionalEnv(varName: string, defaultValue: string): string {
    return process.env[varName] || defaultValue;
  }

  /**
   * Validate all required environment variables
   */
  static validateRequiredEnvVars(requiredVars: string[]): void {
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }
}

// Retry utilities
export class RetryUtils {
  /**
   * Execute function with exponential backoff retry
   */
  static async withExponentialBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000,
    maxDelay: number = 10000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
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
  static async withLinearRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error(`Failed after ${maxRetries} attempts`);
  }
}

// Validation utilities
export class ValidationUtils {
  /**
   * Validate token amount is positive
   */
  static validatePositiveAmount(amount: bigint): void {
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
  }

  /**
   * Validate transfer amount doesn't exceed balance
   */
  static validateSufficientBalance(transferAmount: bigint, balance: bigint): void {
    if (transferAmount > balance) {
      throw new Error(`Insufficient balance. Transfer: ${transferAmount}, Balance: ${balance}`);
    }
  }

  /**
   * Validate fee basis points are within valid range
   */
  static validateFeeBasisPoints(basisPoints: number): void {
    if (basisPoints < 0 || basisPoints > 10000) {
      throw new Error('Fee basis points must be between 0 and 10000');
    }
  }
}

// Logging utilities
export class LogUtils {
  /**
   * Create structured log entry
   */
  static createLogEntry(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
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
  static log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
    const entry = this.createLogEntry(level, message, data);
    console.log(JSON.stringify(entry));
  }
}

// Rate limiting utilities
export class RateLimitUtils {
  private static lastCall = 0;

  /**
   * Ensure minimum delay between calls
   */
  static async enforceDelay(minDelayMs: number): Promise<void> {
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
  static createRateLimited<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    minDelayMs: number
  ): T {
    return (async (...args: Parameters<T>) => {
      await this.enforceDelay(minDelayMs);
      return fn(...args);
    }) as T;
  }
}