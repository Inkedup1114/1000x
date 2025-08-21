#!/bin/bash

# Deploy script for 1kx_hook program upgrade
# Updated with correct space allocation for ExtraAccountMetaList (EXTRA_ACCOUNT_META_LIST_SIZE = 128)

set -e  # Exit on any error

# Configuration
PROGRAM_ID="HU8xgmKfWv16e77BX6DEDBCXv8wmdxhYH5TPTSEGu4E2"
PROGRAM_SO_PATH="programs/1kx_hook/target/deploy/one_kx_hook.so"
MIN_SOL_REQUIRED="0.08"
LOG_FILE="deployment_$(date +%Y%m%d_%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Function to check if a command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "Command '$1' not found. Please install it first."
        exit 1
    fi
}

# Function to compare version numbers (for SOL balance check)
version_compare() {
    if awk "BEGIN {exit !($1 >= $2)}"; then
        return 0
    else
        return 1
    fi
}

# Function to check SOL balance
check_sol_balance() {
    log "Checking SOL balance..."
    
    local balance_output
    balance_output=$(solana balance 2>&1) || {
        log_error "Failed to get SOL balance. Is your wallet configured?"
        log_error "Run: solana config set --keypair <path-to-keypair>"
        exit 1
    }
    
    # Extract numeric balance (remove "SOL" suffix)
    local balance=$(echo "$balance_output" | grep -oE '[0-9]+\.?[0-9]*' | head -1)
    
    if [[ -z "$balance" ]]; then
        log_error "Could not parse SOL balance from: $balance_output"
        exit 1
    fi
    
    log "Current SOL balance: $balance SOL"
    
    if version_compare "$balance" "$MIN_SOL_REQUIRED"; then
        log_success "Sufficient SOL balance for deployment"
        return 0
    else
        log_error "Insufficient SOL balance. Required: $MIN_SOL_REQUIRED SOL, Available: $balance SOL"
        log_error "Please fund your wallet with at least $MIN_SOL_REQUIRED SOL"
        exit 1
    fi
}

# Function to verify program build exists
verify_program_build() {
    log "Verifying program build exists..."
    
    if [[ ! -f "$PROGRAM_SO_PATH" ]]; then
        log_error "Program binary not found at: $PROGRAM_SO_PATH"
        log_error "Please build the program first with: anchor build"
        exit 1
    fi
    
    # Check if file is readable and has content
    if [[ ! -r "$PROGRAM_SO_PATH" ]]; then
        log_error "Program binary is not readable: $PROGRAM_SO_PATH"
        exit 1
    fi
    
    local file_size=$(stat -c%s "$PROGRAM_SO_PATH" 2>/dev/null || echo "0")
    if [[ "$file_size" -eq 0 ]]; then
        log_error "Program binary is empty: $PROGRAM_SO_PATH"
        exit 1
    fi
    
    log_success "Program binary found and valid (Size: $file_size bytes)"
    
    # Display file timestamp for verification
    local file_date=$(stat -c %y "$PROGRAM_SO_PATH" 2>/dev/null || echo "unknown")
    log "Program binary last modified: $file_date"
}

# Function to get current program info
get_current_program_info() {
    log "Getting current program information..."
    
    local program_info
    program_info=$(solana program show "$PROGRAM_ID" 2>&1) || {
        log_warning "Could not retrieve current program info. Program might not be deployed yet."
        return 0
    }
    
    log "Current program information:"
    echo "$program_info" | tee -a "$LOG_FILE"
}

# Function to deploy the program
deploy_program() {
    log "Starting program deployment..."
    log "Program ID: $PROGRAM_ID"
    log "Program binary: $PROGRAM_SO_PATH"
    
    # Create deployment command
    local deploy_cmd="solana program deploy $PROGRAM_SO_PATH --program-id $PROGRAM_ID"
    log "Executing: $deploy_cmd"
    
    # Execute deployment with output capture
    local deploy_output
    local deploy_exit_code
    
    deploy_output=$(eval "$deploy_cmd" 2>&1)
    deploy_exit_code=$?
    
    # Log the deployment output
    log "Deployment output:"
    echo "$deploy_output" | tee -a "$LOG_FILE"
    
    if [[ $deploy_exit_code -eq 0 ]]; then
        log_success "Program deployment completed successfully!"
        
        # Extract transaction signature if available
        local tx_sig=$(echo "$deploy_output" | grep -oE '[1-9A-HJ-NP-Za-km-z]{87,88}' | head -1)
        if [[ -n "$tx_sig" ]]; then
            log "Transaction signature: $tx_sig"
            log "View on Solana Explorer: https://explorer.solana.com/tx/$tx_sig"
        fi
        
        return 0
    else
        log_error "Program deployment failed with exit code: $deploy_exit_code"
        return 1
    fi
}

# Function to verify deployment success
verify_deployment() {
    log "Verifying deployment success..."
    
    sleep 3  # Wait a moment for the network to update
    
    local program_info
    program_info=$(solana program show "$PROGRAM_ID" 2>&1) || {
        log_error "Failed to retrieve program info after deployment"
        return 1
    }
    
    log "Updated program information:"
    echo "$program_info" | tee -a "$LOG_FILE"
    
    # Check if the program is now executable
    if echo "$program_info" | grep -q "Executable: Yes"; then
        log_success "Program is executable and deployment verified!"
        return 0
    else
        log_error "Program deployment verification failed - program may not be executable"
        return 1
    fi
}

# Function to cleanup on exit
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Script exited with error code: $exit_code"
        log "Check the log file for details: $LOG_FILE"
    fi
}

# Main execution function
main() {
    log "=== 1kx_hook Program Deployment Script ==="
    log "Starting deployment process..."
    log "Log file: $LOG_FILE"
    
    # Set up cleanup trap
    trap cleanup EXIT
    
    # Pre-deployment checks
    log "=== PRE-DEPLOYMENT CHECKS ==="
    check_command "solana"
    check_command "anchor"
    check_sol_balance
    verify_program_build
    
    # Get current program state
    log "=== CURRENT PROGRAM STATE ==="
    get_current_program_info
    
    # Deployment
    log "=== DEPLOYMENT ==="
    if deploy_program; then
        # Post-deployment verification
        log "=== POST-DEPLOYMENT VERIFICATION ==="
        if verify_deployment; then
            log_success "=== DEPLOYMENT COMPLETED SUCCESSFULLY ==="
            log_success "Program $PROGRAM_ID has been upgraded with new ExtraAccountMetaList space allocation"
        else
            log_error "=== DEPLOYMENT VERIFICATION FAILED ==="
            exit 1
        fi
    else
        log_error "=== DEPLOYMENT FAILED ==="
        exit 1
    fi
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
