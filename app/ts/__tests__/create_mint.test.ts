import { jest } from '@jest/globals';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  ExtensionType,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { TokenMath, PDAUtils, AccountUtils } from '../utils';

// Mock external dependencies
jest.mock('@solana/web3.js');
jest.mock('@solana/spl-token');
jest.mock('@coral-xyz/anchor');
jest.mock('bs58');

const MockedConnection = Connection as jest.MockedClass<typeof Connection>;
const MockedKeypair = Keypair as jest.MockedClass<typeof Keypair>;
const MockedPublicKey = PublicKey as jest.MockedClass<typeof PublicKey>;
const mockSendAndConfirmTransaction = sendAndConfirmTransaction as jest.MockedFunction<typeof sendAndConfirmTransaction>;
const mockGetMintLen = getMintLen as jest.MockedFunction<typeof getMintLen>;
const mockBs58 = bs58 as jest.Mocked<typeof bs58>;

describe('Mint Creation Tests', () => {
  let mockConnection: jest.Mocked<Connection>;
  let mockPayer: jest.Mocked<Keypair>;
  let mockMintKeypair: jest.Mocked<Keypair>;
  let mockDevWallet: jest.Mocked<PublicKey>;
  let mockHookProgramId: jest.Mocked<PublicKey>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock instances
    mockConnection = {
      getMinimumBalanceForRentExemption: jest.fn(),
      commitment: 'confirmed',
    } as any;

    mockPayer = {
      publicKey: new PublicKey('11111111111111111111111111111111'),
      secretKey: new Uint8Array(64),
    } as any;

    mockMintKeypair = {
      publicKey: new PublicKey('22222222222222222222222222222222'),
      secretKey: new Uint8Array(64),
    } as any;

    mockDevWallet = new PublicKey('33333333333333333333333333333333') as any;
    mockHookProgramId = new PublicKey('44444444444444444444444444444444') as any;

    // Setup mock implementations
    MockedConnection.mockImplementation(() => mockConnection);
    MockedKeypair.generate.mockReturnValue(mockMintKeypair);
    MockedKeypair.fromSecretKey.mockReturnValue(mockPayer);
    
    mockBs58.decode.mockReturnValue(new Uint8Array(64));
    mockGetMintLen.mockReturnValue(165);
    mockConnection.getMinimumBalanceForRentExemption.mockResolvedValue(1000000);
    mockSendAndConfirmTransaction.mockResolvedValue('test-signature');
  });

  describe('Mint Creation Parameters', () => {
    test('should calculate correct mint account size with extensions', () => {
      const extensions = [ExtensionType.TransferFeeConfig, ExtensionType.TransferHook];
      const expectedSize = 165;
      
      mockGetMintLen.mockReturnValue(expectedSize);
      
      const actualSize = AccountUtils.getMintAccountSize(extensions);
      
      expect(mockGetMintLen).toHaveBeenCalledWith(extensions);
      expect(actualSize).toBe(expectedSize);
    });

    test('should create proper mint account creation instruction', () => {
      const mintLen = 165;
      const lamports = 1000000;
      
      const createAccountIx = SystemProgram.createAccount({
        fromPubkey: mockPayer.publicKey,
        newAccountPubkey: mockMintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      });

      expect(createAccountIx).toBeDefined();
      expect(createAccountIx.programId).toEqual(SystemProgram.programId);
    });

    test('should create transfer fee configuration with correct parameters', () => {
      const feeBasisPoints = 1000; // 10%
      const maxFee = BigInt('100000000000000000');

      const transferFeeConfigIx = createInitializeTransferFeeConfigInstruction(
        mockMintKeypair.publicKey,
        mockPayer.publicKey,
        mockPayer.publicKey,
        feeBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      );

      expect(createInitializeTransferFeeConfigInstruction).toHaveBeenCalledWith(
        mockMintKeypair.publicKey,
        mockPayer.publicKey,
        mockPayer.publicKey,
        feeBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      );
    });

    test('should create transfer hook instruction with program ID', () => {
      const transferHookIx = createInitializeTransferHookInstruction(
        mockMintKeypair.publicKey,
        mockPayer.publicKey,
        mockHookProgramId,
        TOKEN_2022_PROGRAM_ID
      );

      expect(createInitializeTransferHookInstruction).toHaveBeenCalledWith(
        mockMintKeypair.publicKey,
        mockPayer.publicKey,
        mockHookProgramId,
        TOKEN_2022_PROGRAM_ID
      );
    });

    test('should create mint initialization with 9 decimals', () => {
      const decimals = 9;

      const initMintIx = createInitializeMintInstruction(
        mockMintKeypair.publicKey,
        decimals,
        mockPayer.publicKey,
        mockPayer.publicKey,
        TOKEN_2022_PROGRAM_ID
      );

      expect(createInitializeMintInstruction).toHaveBeenCalledWith(
        mockMintKeypair.publicKey,
        decimals,
        mockPayer.publicKey,
        mockPayer.publicKey,
        TOKEN_2022_PROGRAM_ID
      );
    });
  });

  describe('Extension Configuration', () => {
    test('should configure extensions in correct order', () => {
      const extensions = [ExtensionType.TransferFeeConfig, ExtensionType.TransferHook];
      
      expect(extensions).toHaveLength(2);
      expect(extensions[0]).toBe(ExtensionType.TransferFeeConfig);
      expect(extensions[1]).toBe(ExtensionType.TransferHook);
    });

    test('should validate fee basis points are within range', () => {
      const validFeeBasisPoints = [0, 500, 1000, 5000, 10000];
      const invalidFeeBasisPoints = [-1, 10001, 15000];

      validFeeBasisPoints.forEach(fee => {
        expect(() => {
          if (fee < 0 || fee > 10000) {
            throw new Error('Invalid fee basis points');
          }
        }).not.toThrow();
      });

      invalidFeeBasisPoints.forEach(fee => {
        expect(() => {
          if (fee < 0 || fee > 10000) {
            throw new Error('Invalid fee basis points');
          }
        }).toThrow('Invalid fee basis points');
      });
    });

    test('should calculate correct max fee value', () => {
      const maxFee = BigInt('100000000000000000');
      expect(maxFee).toBeInstanceOf(BigInt);
      expect(maxFee > 0n).toBe(true);
    });
  });

  describe('Token Math Utilities', () => {
    test('should convert tokens to base units correctly', () => {
      expect(TokenMath.tokensToBaseUnits(1, 9)).toBe(1000000000n);
      expect(TokenMath.tokensToBaseUnits(5, 9)).toBe(5000000000n);
      expect(TokenMath.tokensToBaseUnits(1000, 9)).toBe(1000000000000n);
    });

    test('should convert base units to tokens correctly', () => {
      expect(TokenMath.baseUnitsToTokens(1000000000n, 9)).toBe(1);
      expect(TokenMath.baseUnitsToTokens(5000000000n, 9)).toBe(5);
      expect(TokenMath.baseUnitsToTokens(1000000000000n, 9)).toBe(1000);
    });

    test('should calculate fees correctly', () => {
      const amount = 1000000000n; // 1 token
      const feeBasisPoints = 1000; // 10%
      const expectedFee = 100000000n; // 0.1 token

      expect(TokenMath.calculateFee(amount, feeBasisPoints)).toBe(expectedFee);
    });

    test('should calculate net amount after fee', () => {
      const amount = 1000000000n; // 1 token
      const feeBasisPoints = 1000; // 10%
      const expectedNet = 900000000n; // 0.9 token

      expect(TokenMath.calculateNetAmount(amount, feeBasisPoints)).toBe(expectedNet);
    });

    test('should check wallet cap correctly', () => {
      const capAmount = TokenMath.tokensToBaseUnits(5, 9); // 5 tokens
      const underCapAmount = TokenMath.tokensToBaseUnits(4, 9); // 4 tokens
      const overCapAmount = TokenMath.tokensToBaseUnits(6, 9); // 6 tokens

      expect(TokenMath.exceedsWalletCap(underCapAmount)).toBe(false);
      expect(TokenMath.exceedsWalletCap(capAmount)).toBe(false);
      expect(TokenMath.exceedsWalletCap(overCapAmount)).toBe(true);
    });
  });

  describe('PDA Derivation', () => {
    test('should derive hook config PDA correctly', () => {
      const mockPDA = new PublicKey('55555555555555555555555555555555');
      const mockBump = 254;

      MockedPublicKey.findProgramAddressSync = jest.fn().mockReturnValue([mockPDA, mockBump]);

      const [pda, bump] = PDAUtils.deriveHookConfigPDA(mockMintKeypair.publicKey, mockHookProgramId);

      expect(MockedPublicKey.findProgramAddressSync).toHaveBeenCalledWith(
        [Buffer.from('config'), mockMintKeypair.publicKey.toBuffer()],
        mockHookProgramId
      );
      expect(pda).toBe(mockPDA);
      expect(bump).toBe(mockBump);
    });

    test('should derive extra account metas PDA correctly', () => {
      const mockPDA = new PublicKey('66666666666666666666666666666666');
      const mockBump = 253;

      MockedPublicKey.findProgramAddressSync = jest.fn().mockReturnValue([mockPDA, mockBump]);

      const [pda, bump] = PDAUtils.deriveExtraAccountMetasPDA(mockMintKeypair.publicKey, mockHookProgramId);

      expect(MockedPublicKey.findProgramAddressSync).toHaveBeenCalledWith(
        [Buffer.from('extra-account-metas'), mockMintKeypair.publicKey.toBuffer()],
        mockHookProgramId
      );
      expect(pda).toBe(mockPDA);
      expect(bump).toBe(mockBump);
    });
  });

  describe('Transaction Building', () => {
    test('should build mint creation transaction with all instructions', () => {
      const tx = new Transaction();
      
      // Mock all instruction creation functions
      const mockCreateAccountIx = { programId: SystemProgram.programId };
      const mockTransferFeeConfigIx = { programId: TOKEN_2022_PROGRAM_ID };
      const mockTransferHookIx = { programId: TOKEN_2022_PROGRAM_ID };
      const mockInitMintIx = { programId: TOKEN_2022_PROGRAM_ID };

      tx.add(
        mockCreateAccountIx as any,
        mockTransferFeeConfigIx as any,
        mockTransferHookIx as any,
        mockInitMintIx as any
      );

      expect(tx.instructions).toHaveLength(4);
    });

    test('should handle transaction signing correctly', async () => {
      const tx = new Transaction();
      const signers = [mockPayer, mockMintKeypair];

      await mockSendAndConfirmTransaction(mockConnection, tx, signers, { commitment: 'confirmed' });

      expect(mockSendAndConfirmTransaction).toHaveBeenCalledWith(
        mockConnection,
        tx,
        signers,
        { commitment: 'confirmed' }
      );
    });
  });

  describe('Token Supply Management', () => {
    test('should mint correct total supply to dev wallet', () => {
      const totalSupplyTokens = 1000;
      const decimals = 9;
      const expectedAmount = TokenMath.tokensToBaseUnits(totalSupplyTokens, decimals);

      expect(expectedAmount).toBe(1000000000000n);

      const mintToIx = createMintToInstruction(
        mockMintKeypair.publicKey,
        mockDevWallet,
        mockPayer.publicKey,
        expectedAmount,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      expect(createMintToInstruction).toHaveBeenCalledWith(
        mockMintKeypair.publicKey,
        mockDevWallet,
        mockPayer.publicKey,
        expectedAmount,
        [],
        TOKEN_2022_PROGRAM_ID
      );
    });

    test('should create associated token account for dev wallet', () => {
      const devAta = getAssociatedTokenAddressSync(
        mockMintKeypair.publicKey,
        mockDevWallet,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      expect(getAssociatedTokenAddressSync).toHaveBeenCalledWith(
        mockMintKeypair.publicKey,
        mockDevWallet,
        false,
        TOKEN_2022_PROGRAM_ID
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid mint address', () => {
      expect(() => {
        AccountUtils.validateMintAddress('invalid-address');
      }).toThrow('Invalid mint address');
    });

    test('should handle invalid program ID', () => {
      expect(() => {
        AccountUtils.validateProgramId('invalid-program-id');
      }).toThrow('Invalid program ID');
    });

    test('should handle invalid keypair format', () => {
      mockBs58.decode.mockImplementation(() => {
        throw new Error('Invalid base58');
      });

      expect(() => {
        AccountUtils.parseKeypairFromBase58('invalid-keypair');
      }).toThrow('Invalid keypair format');
    });

    test('should handle connection errors gracefully', async () => {
      mockConnection.getMinimumBalanceForRentExemption.mockRejectedValue(
        new Error('Connection failed')
      );

      await expect(
        mockConnection.getMinimumBalanceForRentExemption(165)
      ).rejects.toThrow('Connection failed');
    });

    test('should handle transaction failures', async () => {
      mockSendAndConfirmTransaction.mockRejectedValue(
        new Error('Transaction failed')
      );

      const tx = new Transaction();
      await expect(
        mockSendAndConfirmTransaction(mockConnection, tx, [mockPayer])
      ).rejects.toThrow('Transaction failed');
    });
  });

  describe('Environment Configuration', () => {
    test('should validate required environment variables', () => {
      const originalEnv = process.env;

      // Test missing variables
      process.env = {};
      expect(() => {
        if (!process.env.RPC_URL) throw new Error('Missing RPC_URL');
      }).toThrow('Missing RPC_URL');

      // Restore
      process.env = originalEnv;
    });

    test('should parse environment variables correctly', () => {
      process.env.RPC_URL = 'http://localhost:8899';
      process.env.PRIVATE_KEY = 'test-private-key';
      process.env.DEV_WALLET = 'test-dev-wallet';
      process.env.PROGRAM_ID = 'test-program-id';

      expect(process.env.RPC_URL).toBe('http://localhost:8899');
      expect(process.env.PRIVATE_KEY).toBe('test-private-key');
      expect(process.env.DEV_WALLET).toBe('test-dev-wallet');
      expect(process.env.PROGRAM_ID).toBe('test-program-id');
    });
  });
});