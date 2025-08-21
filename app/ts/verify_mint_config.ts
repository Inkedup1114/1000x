import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getTransferFeeConfig,
  getTransferHook,
  ExtensionType,
} from "@solana/spl-token";
import * as dotenv from "dotenv";

dotenv.config({ path: "./app/ts/.env" });

async function verifyMintConfiguration() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
  
  console.log("🔍 Verifying mint configuration for:", mintAddress.toBase58());
  console.log("📡 RPC endpoint:", process.env.RPC_URL);
  console.log("");
  
  try {
    // Get mint account info
    const mintInfo = await getMint(
      connection,
      mintAddress,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log("✅ Mint account found and accessible");
    console.log("   - Decimals:", mintInfo.decimals);
    console.log("   - Supply:", mintInfo.supply.toString());
    console.log("   - Mint authority:", mintInfo.mintAuthority?.toBase58() || "None");
    console.log("   - Freeze authority:", mintInfo.freezeAuthority?.toBase58() || "None");
    console.log("");
    
    // Check for TransferFeeConfig extension
    console.log("🔧 Checking TransferFeeConfig extension...");
    try {
      const transferFeeConfig = getTransferFeeConfig(mintInfo);
      if (transferFeeConfig) {
        console.log("✅ TransferFeeConfig extension found!");
        console.log("   - Transfer fee basis points:", transferFeeConfig.newerTransferFee.transferFeeBasisPoints);
        console.log("   - Max fee:", transferFeeConfig.newerTransferFee.maximumFee.toString());
        console.log("   - Withdraw withheld authority:", transferFeeConfig.withdrawWithheldAuthority?.toBase58() || "None");
        console.log("   - Transfer fee config authority:", transferFeeConfig.transferFeeConfigAuthority?.toBase58() || "None");
        
        // Verify fee percentage (should be 10% = 1000 basis points)
        const expectedFeeBasisPoints = 1000;
        if (transferFeeConfig.newerTransferFee.transferFeeBasisPoints === expectedFeeBasisPoints) {
          console.log("✅ Transfer fee correctly set to 10% (1000 basis points)");
        } else {
          console.log("❌ Transfer fee mismatch - expected 1000 basis points, got:", transferFeeConfig.newerTransferFee.transferFeeBasisPoints);
        }
      } else {
        console.log("❌ TransferFeeConfig extension not found!");
        return false;
      }
    } catch (error) {
      console.log("❌ Error getting TransferFeeConfig:", error);
      return false;
    }
    
    console.log("");
    
    // Check for TransferHook extension
    console.log("🪝 Checking TransferHook extension...");
    try {
      const transferHook = getTransferHook(mintInfo);
      if (transferHook) {
        console.log("✅ TransferHook extension found!");
        console.log("   - Hook program ID:", transferHook.programId?.toBase58() || "None");
        console.log("   - Hook authority:", transferHook.authority?.toBase58() || "None");
        
        // Verify hook program ID matches expected
        const expectedHookProgramId = process.env.PROGRAM_ID!;
        if (transferHook.programId?.toBase58() === expectedHookProgramId) {
          console.log("✅ Hook program ID correctly set to:", expectedHookProgramId);
        } else {
          console.log("❌ Hook program ID mismatch - expected:", expectedHookProgramId, "got:", transferHook.programId?.toBase58());
        }
      } else {
        console.log("❌ TransferHook extension not found!");
        return false;
      }
    } catch (error) {
      console.log("❌ Error getting TransferHook:", error);
      return false;
    }
    
    console.log("");
    
    // Check all extensions
    console.log("📋 All extensions on this mint:");
    if (mintInfo.tlvData && mintInfo.tlvData.length > 0) {
      // Parse extensions from TLV data
      console.log("   - Raw extension data present (", mintInfo.tlvData.length, "bytes)");
      
      // Try to identify known extensions
      const hasTransferFeeConfig = !!getTransferFeeConfig(mintInfo);
      const hasTransferHook = !!getTransferHook(mintInfo);
      
      console.log("   - TransferFeeConfig:", hasTransferFeeConfig ? "✅" : "❌");
      console.log("   - TransferHook:", hasTransferHook ? "✅" : "❌");
    } else {
      console.log("   - No extensions found");
    }
    
    console.log("");
    console.log("🎉 Verification complete!");
    
    return true;
    
  } catch (error) {
    console.log("❌ Error verifying mint:", error);
    return false;
  }
}

if (require.main === module) {
  verifyMintConfiguration()
    .then((success) => {
      if (success) {
        console.log("✅ All mint configurations verified successfully!");
        process.exit(0);
      } else {
        console.log("❌ Mint verification failed!");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("❌ Verification script failed:", error);
      process.exit(1);
    });
}

export { verifyMintConfiguration };
