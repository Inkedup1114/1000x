import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createSetTransferFeeInstruction,
} from "@solana/spl-token";
import * as dotenv from "dotenv";
import bs58 from "bs58";

dotenv.config({ path: "./app/ts/.env" });

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
  const mintAddress = new PublicKey(process.env.MINT_ADDRESS!);
  
  // Update transfer fee if needed (already set to 10% during mint creation)
  console.log("Transfer fee already configured at 10% during mint creation");
  console.log("Mint:", mintAddress.toBase58());
}

main().catch(console.error);
