#!/bin/bash

# Governance Tools for 1000x Token System
# Provides utilities for upgrade authority management and governance operations

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/governance-operations.log"

# Load environment if available
if [ -f "$PROJECT_DIR/app/ts/.env" ]; then
    set -a
    source "$PROJECT_DIR/app/ts/.env"
    set +a
fi

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $*" | tee -a "$LOG_FILE"
}

# Status functions
status_info() {
    echo -e "${BLUE}ℹ${NC} $1"
    log "INFO: $1"
}

status_ok() {
    echo -e "${GREEN}✓${NC} $1"
    log "SUCCESS: $1"
}

status_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    log "WARNING: $1"
}

status_error() {
    echo -e "${RED}✗${NC} $1"
    log "ERROR: $1"
}

# Help function
show_help() {
    cat << EOF
1000x Token Governance Tools

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    check-authority         Check current program upgrade authority
    rotate-authority        Rotate upgrade authority to new keypair
    transfer-authority      Transfer authority to specified address
    revoke-authority        Permanently revoke upgrade authority (IRREVERSIBLE)
    prepare-multisig        Prepare for multisig transition
    validate-governance     Validate governance configuration
    emergency-transfer      Emergency authority transfer

Options:
    --program-id PROGRAM_ID     Program ID to manage (default: from .env)
    --authority KEYPAIR_FILE    Current authority keypair file
    --new-authority ADDRESS     New authority address
    --dry-run                   Show what would be done without executing
    --help                      Show this help message

Examples:
    $0 check-authority
    $0 rotate-authority --authority current-key.json
    $0 transfer-authority --new-authority 2xF...Kx9 --authority current-key.json
    $0 revoke-authority --authority current-key.json --dry-run

For more information, see docs/GOVERNANCE.md
EOF
}

# Check current program authority
check_authority() {
    local program_id="${PROGRAM_ID:-$1}"
    
    if [ -z "$program_id" ]; then
        status_error "Program ID not specified. Set PROGRAM_ID environment variable or pass as argument."
        return 1
    fi
    
    status_info "Checking upgrade authority for program: $program_id"
    
    if program_info=$(solana program show "$program_id" 2>/dev/null); then
        authority=$(echo "$program_info" | grep "Upgrade Authority" | awk '{print $3}')
        
        if [ -n "$authority" ] && [ "$authority" != "null" ]; then
            status_ok "Current upgrade authority: $authority"
            
            # Check if it's a known authority
            if [ "$authority" = "${DEV_WALLET:-}" ]; then
                status_info "Authority matches configured dev wallet"
            fi
            
            return 0
        else
            status_warning "Upgrade authority is null (immutable program)"
            return 2
        fi
    else
        status_error "Failed to retrieve program information"
        return 1
    fi
}

# Generate new authority keypair
generate_new_authority() {
    local output_file="$1"
    
    status_info "Generating new upgrade authority keypair..."
    
    if solana-keygen new --outfile "$output_file" --no-bip39-passphrase; then
        local new_pubkey=$(solana-keygen pubkey "$output_file")
        status_ok "New authority keypair generated: $new_pubkey"
        echo "$new_pubkey"
    else
        status_error "Failed to generate new keypair"
        return 1
    fi
}

# Rotate authority to new keypair
rotate_authority() {
    local program_id="${PROGRAM_ID:-}"
    local current_authority="$1"
    local dry_run="${2:-false}"
    
    if [ -z "$program_id" ]; then
        status_error "Program ID not specified"
        return 1
    fi
    
    if [ ! -f "$current_authority" ]; then
        status_error "Current authority keypair file not found: $current_authority"
        return 1
    fi
    
    status_info "Starting authority rotation for program: $program_id"
    
    # Generate new authority
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local new_authority_file="new-upgrade-authority-$timestamp.json"
    local backup_file="backup-upgrade-authority-$timestamp.json"
    
    if ! new_pubkey=$(generate_new_authority "$new_authority_file"); then
        return 1
    fi
    
    # Backup current authority
    status_info "Backing up current authority..."
    cp "$current_authority" "$backup_file"
    status_ok "Backup created: $backup_file"
    
    if [ "$dry_run" = "true" ]; then
        status_info "DRY RUN: Would transfer authority from $(solana-keygen pubkey "$current_authority") to $new_pubkey"
        rm -f "$new_authority_file"
        return 0
    fi
    
    # Transfer authority
    status_info "Transferring upgrade authority..."
    if solana program set-upgrade-authority "$program_id" \
        --new-upgrade-authority "$new_pubkey" \
        --upgrade-authority "$current_authority"; then
        
        status_ok "Authority successfully rotated to: $new_pubkey"
        status_info "New authority keypair: $new_authority_file"
        status_info "Backup of old authority: $backup_file"
        
        # Verify the transfer
        if check_authority "$program_id" | grep -q "$new_pubkey"; then
            status_ok "Authority rotation verified"
        else
            status_error "Authority rotation verification failed"
            return 1
        fi
        
        log "AUTHORITY_ROTATION: $program_id from $(solana-keygen pubkey "$current_authority") to $new_pubkey"
        
    else
        status_error "Failed to transfer upgrade authority"
        rm -f "$new_authority_file"
        return 1
    fi
}

# Transfer authority to specific address
transfer_authority() {
    local program_id="${PROGRAM_ID:-}"
    local current_authority="$1"
    local new_authority_address="$2"
    local dry_run="${3:-false}"
    
    if [ -z "$program_id" ]; then
        status_error "Program ID not specified"
        return 1
    fi
    
    if [ ! -f "$current_authority" ]; then
        status_error "Current authority keypair file not found: $current_authority"
        return 1
    fi
    
    if [ -z "$new_authority_address" ]; then
        status_error "New authority address not specified"
        return 1
    fi
    
    status_info "Transferring authority for program: $program_id"
    status_info "From: $(solana-keygen pubkey "$current_authority")"
    status_info "To: $new_authority_address"
    
    if [ "$dry_run" = "true" ]; then
        status_info "DRY RUN: Would transfer authority to $new_authority_address"
        return 0
    fi
    
    # Backup current authority
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="backup-upgrade-authority-$timestamp.json"
    cp "$current_authority" "$backup_file"
    status_ok "Backup created: $backup_file"
    
    # Transfer authority
    if solana program set-upgrade-authority "$program_id" \
        --new-upgrade-authority "$new_authority_address" \
        --upgrade-authority "$current_authority"; then
        
        status_ok "Authority successfully transferred to: $new_authority_address"
        
        # Verify the transfer
        sleep 2
        if check_authority "$program_id" | grep -q "$new_authority_address"; then
            status_ok "Authority transfer verified"
        else
            status_error "Authority transfer verification failed"
            return 1
        fi
        
        log "AUTHORITY_TRANSFER: $program_id to $new_authority_address"
        
    else
        status_error "Failed to transfer upgrade authority"
        return 1
    fi
}

# Revoke authority (make program immutable)
revoke_authority() {
    local program_id="${PROGRAM_ID:-}"
    local current_authority="$1"
    local dry_run="${2:-false}"
    local confirm="${3:-false}"
    
    if [ -z "$program_id" ]; then
        status_error "Program ID not specified"
        return 1
    fi
    
    if [ ! -f "$current_authority" ]; then
        status_error "Current authority keypair file not found: $current_authority"
        return 1
    fi
    
    status_warning "🚨 IMMUTABILITY WARNING 🚨"
    status_warning "This action will make the program immutable and cannot be reversed"
    status_warning "Program: $program_id"
    status_warning "Current authority: $(solana-keygen pubkey "$current_authority")"
    
    if [ "$dry_run" = "true" ]; then
        status_info "DRY RUN: Would revoke upgrade authority (make immutable)"
        return 0
    fi
    
    if [ "$confirm" != "true" ]; then
        echo -n "Type 'MAKE_IMMUTABLE' to confirm: "
        read -r confirmation
        if [ "$confirmation" != "MAKE_IMMUTABLE" ]; then
            status_info "Operation cancelled by user"
            return 0
        fi
    fi
    
    # Final backup
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local final_backup="final-authority-backup-$timestamp.json"
    cp "$current_authority" "$final_backup"
    status_ok "Final backup created: $final_backup"
    
    # Revoke authority
    status_warning "Revoking upgrade authority..."
    if solana program set-upgrade-authority "$program_id" \
        --new-upgrade-authority null \
        --upgrade-authority "$current_authority"; then
        
        status_ok "✅ Upgrade authority successfully revoked"
        status_ok "🔒 Program is now immutable"
        
        # Verify revocation
        sleep 2
        if check_authority "$program_id" | grep -q "null"; then
            status_ok "Immutability verified"
        else
            status_error "Immutability verification failed"
            return 1
        fi
        
        log "AUTHORITY_REVOKED: $program_id made immutable"
        
    else
        status_error "Failed to revoke upgrade authority"
        return 1
    fi
}

# Prepare for multisig transition
prepare_multisig() {
    local program_id="${PROGRAM_ID:-}"
    
    status_info "Preparing for multisig governance transition..."
    
    # Check current state
    check_authority "$program_id"
    
    # Validate multisig requirements
    status_info "Validating multisig requirements..."
    
    # Check if Squads CLI is available
    if command -v sqds >/dev/null 2>&1; then
        status_ok "Squads CLI available"
    else
        status_warning "Squads CLI not found - install from https://github.com/Squads-Protocol/v4"
    fi
    
    # Check signer keypairs
    local signers_dir="multisig-signers"
    if [ -d "$signers_dir" ]; then
        status_info "Checking multisig signer keypairs..."
        for signer in "$signers_dir"/*.json; do
            if [ -f "$signer" ]; then
                local pubkey=$(solana-keygen pubkey "$signer")
                status_ok "Signer found: $pubkey ($(basename "$signer"))"
            fi
        done
    else
        status_warning "Multisig signers directory not found: $signers_dir"
        status_info "Create directory and add signer keypairs for multisig setup"
    fi
    
    # Generate multisig setup script
    cat > multisig-setup.sh << 'EOF'
#!/bin/bash
# Multisig Setup Script for 1000x Token
# Generated by governance_tools.sh

echo "Setting up Squads multisig for 1000x Token governance..."

# Configuration
THRESHOLD=3
MEMBERS=("signer1.json" "signer2.json" "signer3.json" "signer4.json" "signer5.json")

# Create multisig vault
echo "Creating Squads vault with 3-of-5 threshold..."
VAULT_ADDRESS=$(sqds vault create \
    --threshold $THRESHOLD \
    --members "${MEMBERS[@]}" \
    --name "1000x-upgrade-authority" \
    --output json | jq -r '.vault_address')

echo "Multisig vault created: $VAULT_ADDRESS"

# Store vault address for reference
echo "MULTISIG_VAULT_ADDRESS=$VAULT_ADDRESS" >> .env.multisig

echo "Next steps:"
echo "1. Verify all signers have access to the vault"
echo "2. Test multisig operations"
echo "3. Transfer program authority using: ./governance_tools.sh transfer-authority --new-authority $VAULT_ADDRESS"
EOF
    
    chmod +x multisig-setup.sh
    status_ok "Multisig setup script created: multisig-setup.sh"
}

# Validate governance configuration
validate_governance() {
    local program_id="${PROGRAM_ID:-}"
    
    status_info "Validating governance configuration..."
    
    # Check program exists and is upgradeable
    if ! check_authority "$program_id"; then
        status_error "Program authority check failed"
        return 1
    fi
    
    # Check required tools
    local tools=("solana" "solana-keygen")
    for tool in "${tools[@]}"; do
        if command -v "$tool" >/dev/null 2>&1; then
            status_ok "Tool available: $tool"
        else
            status_error "Required tool missing: $tool"
            return 1
        fi
    done
    
    # Check keypair access
    if [ -n "${DEV_WALLET:-}" ]; then
        local wallet_path="$HOME/.config/solana/id.json"
        if [ -f "$wallet_path" ]; then
            local current_pubkey=$(solana-keygen pubkey "$wallet_path")
            if [ "$current_pubkey" = "$DEV_WALLET" ]; then
                status_ok "Current wallet matches configured dev wallet"
            else
                status_warning "Current wallet ($current_pubkey) does not match configured dev wallet ($DEV_WALLET)"
            fi
        else
            status_warning "Default wallet not found at $wallet_path"
        fi
    fi
    
    # Check documentation
    local docs=("docs/GOVERNANCE.md" "docs/RUNBOOK.md")
    for doc in "${docs[@]}"; do
        if [ -f "$PROJECT_DIR/$doc" ]; then
            status_ok "Documentation found: $doc"
        else
            status_warning "Documentation missing: $doc"
        fi
    done
    
    status_ok "Governance validation completed"
}

# Emergency authority transfer
emergency_transfer() {
    local program_id="${PROGRAM_ID:-}"
    local current_authority="$1"
    local emergency_authority="$2"
    
    status_warning "🚨 EMERGENCY AUTHORITY TRANSFER 🚨"
    
    if [ -z "$emergency_authority" ]; then
        status_error "Emergency authority address not specified"
        return 1
    fi
    
    # Create emergency log
    local emergency_log="emergency-transfer-$(date +%Y%m%d_%H%M%S).log"
    {
        echo "EMERGENCY AUTHORITY TRANSFER"
        echo "Timestamp: $(date)"
        echo "Program ID: $program_id"
        echo "From: $(solana-keygen pubkey "$current_authority" 2>/dev/null || echo "UNKNOWN")"
        echo "To: $emergency_authority"
        echo "Operator: $(whoami)"
        echo "Reason: Emergency governance action"
    } | tee "$emergency_log"
    
    # Perform transfer
    if transfer_authority "$current_authority" "$emergency_authority" "false"; then
        status_ok "Emergency transfer completed successfully"
        echo "Emergency transfer completed" >> "$emergency_log"
    else
        status_error "Emergency transfer failed"
        echo "Emergency transfer FAILED" >> "$emergency_log"
        return 1
    fi
    
    # Notify stakeholders
    status_info "Emergency transfer logged: $emergency_log"
    status_warning "NOTIFY ALL STAKEHOLDERS IMMEDIATELY"
}

# Main function
main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi
    
    local command="$1"
    shift
    
    # Parse options
    local dry_run=false
    local authority_file=""
    local new_authority=""
    local program_id=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                dry_run=true
                shift
                ;;
            --authority)
                authority_file="$2"
                shift 2
                ;;
            --new-authority)
                new_authority="$2"
                shift 2
                ;;
            --program-id)
                program_id="$2"
                PROGRAM_ID="$program_id"
                shift 2
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                break
                ;;
        esac
    done
    
    # Execute command
    case "$command" in
        check-authority)
            check_authority "$program_id"
            ;;
        rotate-authority)
            if [ -z "$authority_file" ]; then
                status_error "Authority file required. Use --authority option."
                exit 1
            fi
            rotate_authority "$authority_file" "$dry_run"
            ;;
        transfer-authority)
            if [ -z "$authority_file" ] || [ -z "$new_authority" ]; then
                status_error "Authority file and new authority address required."
                exit 1
            fi
            transfer_authority "$authority_file" "$new_authority" "$dry_run"
            ;;
        revoke-authority)
            if [ -z "$authority_file" ]; then
                status_error "Authority file required. Use --authority option."
                exit 1
            fi
            revoke_authority "$authority_file" "$dry_run"
            ;;
        prepare-multisig)
            prepare_multisig
            ;;
        validate-governance)
            validate_governance
            ;;
        emergency-transfer)
            if [ -z "$authority_file" ] || [ -z "$new_authority" ]; then
                status_error "Authority file and emergency authority address required."
                exit 1
            fi
            emergency_transfer "$authority_file" "$new_authority"
            ;;
        *)
            status_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"