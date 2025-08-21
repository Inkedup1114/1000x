#!/bin/bash

# Quick deployment status checker for 1kx_hook program

PROGRAM_ID="HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2"

echo "=== 1kx_hook Program Status ==="
echo "Program ID: $PROGRAM_ID"
echo ""

echo "Current SOL Balance:"
solana balance
echo ""

echo "Program Information:"
solana program show "$PROGRAM_ID"
echo ""

echo "Recent Program Deployments:"
solana transaction-history --limit 5 | grep -A5 -B5 "program deploy" || echo "No recent program deployments found"
