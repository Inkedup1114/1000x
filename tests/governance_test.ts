// Example test for governance functionality
// This would be part of the tests/1kx_hook.ts file

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OneKxHook } from "../target/types/one_kx_hook";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("Governance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.OneKxHook as Program<OneKxHook>;
  
  let mint: PublicKey;
  let config: PublicKey;
  let governanceAuthority: Keypair;
  let devWallet: Keypair;

  before(async () => {
    // Setup test accounts
    governanceAuthority = Keypair.generate();
    devWallet = Keypair.generate();
    mint = Keypair.generate().publicKey;
    
    // Fund governance authority
    await provider.connection.requestAirdrop(
      governanceAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );

    // Derive config PDA
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mint.toBuffer()],
      program.programId
    );
  });

  it("Initializes with governance authority", async () => {
    await program.methods
      .initialize(devWallet.publicKey, governanceAuthority.publicKey)
      .accounts({
        payer: governanceAuthority.publicKey,
        config,
        mint,
        systemProgram: SystemProgram.programId,
      })
      .signers([governanceAuthority])
      .rpc();

    const configAccount = await program.account.hookConfig.fetch(config);
    expect(configAccount.governanceAuthority.toString()).to.equal(
      governanceAuthority.publicKey.toString()
    );
    expect(configAccount.walletCapRaw.toString()).to.equal("5000000000");
  });

  it("Proposes wallet cap update", async () => {
    const newCap = new anchor.BN(10_000_000_000); // 10 tokens

    const tx = await program.methods
      .proposeWalletCapUpdate(newCap)
      .accounts({
        config,
        governanceAuthority: governanceAuthority.publicKey,
        mint,
      })
      .signers([governanceAuthority])
      .rpc();

    const configAccount = await program.account.hookConfig.fetch(config);
    expect(configAccount.pendingCapUpdate).to.not.be.null;
    expect(configAccount.pendingCapUpdate.newCap.toString()).to.equal("10000000000");
  });

  it("Fails to execute before timelock expires", async () => {
    try {
      await program.methods
        .executeWalletCapUpdate()
        .accounts({
          config,
          governanceAuthority: governanceAuthority.publicKey,
          mint,
        })
        .signers([governanceAuthority])
        .rpc();
      
      expect.fail("Should have failed due to timelock");
    } catch (error) {
      expect(error.toString()).to.include("TimelockNotExpired");
    }
  });

  it("Cancels pending update", async () => {
    await program.methods
      .cancelWalletCapUpdate()
      .accounts({
        config,
        governanceAuthority: governanceAuthority.publicKey,
        mint,
      })
      .signers([governanceAuthority])
      .rpc();

    const configAccount = await program.account.hookConfig.fetch(config);
    expect(configAccount.pendingCapUpdate).to.be.null;
  });

  it("Fails with unauthorized governance", async () => {
    const unauthorizedSigner = Keypair.generate();
    
    // Fund unauthorized signer
    await provider.connection.requestAirdrop(
      unauthorizedSigner.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );

    try {
      await program.methods
        .proposeWalletCapUpdate(new anchor.BN(8_000_000_000))
        .accounts({
          config,
          governanceAuthority: unauthorizedSigner.publicKey,
          mint,
        })
        .signers([unauthorizedSigner])
        .rpc();
      
      expect.fail("Should have failed due to unauthorized governance");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedGovernance");
    }
  });

  it("Updates governance authority", async () => {
    const newGovernanceAuthority = Keypair.generate();

    await program.methods
      .updateGovernanceAuthority(newGovernanceAuthority.publicKey)
      .accounts({
        config,
        governanceAuthority: governanceAuthority.publicKey,
        mint,
      })
      .signers([governanceAuthority])
      .rpc();

    const configAccount = await program.account.hookConfig.fetch(config);
    expect(configAccount.governanceAuthority.toString()).to.equal(
      newGovernanceAuthority.publicKey.toString()
    );
  });

  it("Validates cap ranges", async () => {
    // Test with cap too high
    try {
      await program.methods
        .proposeWalletCapUpdate(new anchor.BN(200_000_000_000)) // 200 tokens - over limit
        .accounts({
          config,
          governanceAuthority: governanceAuthority.publicKey,
          mint,
        })
        .signers([governanceAuthority])
        .rpc();
      
      expect.fail("Should have failed due to invalid cap");
    } catch (error) {
      expect(error.toString()).to.include("InvalidWalletCap");
    }

    // Test with zero cap
    try {
      await program.methods
        .proposeWalletCapUpdate(new anchor.BN(0))
        .accounts({
          config,
          governanceAuthority: governanceAuthority.publicKey,
          mint,
        })
        .signers([governanceAuthority])
        .rpc();
      
      expect.fail("Should have failed due to zero cap");
    } catch (error) {
      expect(error.toString()).to.include("InvalidWalletCap");
    }
  });
});
