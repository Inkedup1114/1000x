#!/bin/bash

# Integration Test Runner for 1000x Token
# This script sets up a local validator and runs the integration tests

set -e

echo "🚀 Starting 1000x Token Integration Tests"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI not found. Please install Solana CLI first.${NC}"
    exit 1
fi

# Check if anchor is installed
if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Anchor CLI not found. Please install Anchor CLI first.${NC}"
    exit 1
fi

# Function to cleanup
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    pkill -f solana-test-validator || true
    exit $1
}

# Trap to ensure cleanup on exit
trap 'cleanup $?' EXIT

# Check if validator is already running
if pgrep -f solana-test-validator > /dev/null; then
    echo -e "${YELLOW}⚠️ Solana test validator is already running${NC}"
    USE_EXISTING_VALIDATOR=true
else
    echo "🔧 Starting local Solana test validator..."
    
    # Start test validator in background
    solana-test-validator \
        --reset \
        --quiet \
        --ledger /tmp/test-ledger &
    
    VALIDATOR_PID=$!
    USE_EXISTING_VALIDATOR=false
    
    # Wait for validator to start
    echo "⏳ Waiting for validator to start..."
    sleep 5
    
    # Check if validator started successfully
    if ! pgrep -f solana-test-validator > /dev/null; then
        echo -e "${RED}❌ Failed to start test validator${NC}"
        echo "📋 Check validator manually with: solana-test-validator --help"
        exit 1
    fi
fi

# Configure Solana CLI to use local validator
echo "⚙️ Configuring Solana CLI..."
solana config set --url localhost > /dev/null

# Wait a bit more for validator to be fully ready
sleep 3

# Check validator health
echo "🔍 Checking validator health..."
if ! solana cluster-version > /dev/null 2>&1; then
    echo -e "${RED}❌ Validator is not healthy${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Validator is running and healthy${NC}"

# Build the program
echo "🔨 Building Anchor program..."
if ! anchor build; then
    echo -e "${RED}❌ Failed to build program${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Program built successfully${NC}"

# Run the integration tests
echo "🧪 Running integration tests..."

# Set environment variables for tests
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"

# Run tests with npm
if npm run test:integration; then
    echo -e "${GREEN}✅ All integration tests passed!${NC}"
    TEST_EXIT_CODE=0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    TEST_EXIT_CODE=1
fi

# Only kill validator if we started it
if [ "$USE_EXISTING_VALIDATOR" = false ]; then
    echo "🛑 Stopping test validator..."
    kill $VALIDATOR_PID || true
    sleep 2
fi

echo -e "${GREEN}🎉 Integration test run complete${NC}"
exit $TEST_EXIT_CODE