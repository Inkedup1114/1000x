#!/bin/bash

echo "Setting up 1000x Token project on Ubuntu..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install build essentials
sudo apt install -y build-essential pkg-config libssl-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

# Install Solana
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"
export PATH="$HOME/.config/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.config/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Generate keypairs
solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase
solana-keygen new --outfile ~/.config/solana/burner.json --no-bip39-passphrase

# Set config
solana config set --url https://api.devnet.solana.com
solana config set --keypair ~/.config/solana/id.json

# Install dependencies
pnpm install

echo "Setup complete! Next steps:"
echo "1. Fund your wallet: solana airdrop 2"
echo "2. Configure app/ts/.env with your keys"
echo "3. Build program: anchor build"
echo "4. Deploy: anchor deploy"
