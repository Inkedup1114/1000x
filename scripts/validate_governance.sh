#!/bin/bash

# Governance Documentation Validation Script
# Validates that governance documentation is complete and accurate

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

# Status functions
status_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

status_ok() {
    echo -e "${GREEN}✓${NC} $1"
}

status_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

status_error() {
    echo -e "${RED}✗${NC} $1"
}

echo "=== 1000x Token Governance Documentation Validation ==="
echo "Time: $(date)"
echo "Project Directory: $PROJECT_DIR"
echo ""

# Test 1: Check required governance files exist
status_info "Checking required governance files..."

required_files=(
    "docs/GOVERNANCE.md"
    "governance.md"
    "scripts/governance_tools.sh"
)

missing_files=()
for file in "${required_files[@]}"; do
    if [ -f "$PROJECT_DIR/$file" ]; then
        status_ok "Found: $file"
    else
        status_error "Missing: $file"
        missing_files+=("$file")
    fi
done

echo ""

# Test 2: Validate governance documentation content
status_info "Validating governance documentation content..."

governance_file="$PROJECT_DIR/docs/GOVERNANCE.md"
if [ -f "$governance_file" ]; then
    # Check for required sections
    required_sections=(
        "Current Upgrade Authority"
        "Key Rotation Schedule"
        "Multisig Setup"
        "Upgrade Process"
        "Future Governance Plans"
        "Immutability Timeline"
    )
    
    for section in "${required_sections[@]}"; do
        if grep -q "$section" "$governance_file"; then
            status_ok "Section found: $section"
        else
            status_warning "Section missing or not properly titled: $section"
        fi
    done
    
    # Check for placeholders that need to be filled
    if grep -q "\[CONTACT_INFO_REDACTED\]" "$governance_file"; then
        status_warning "Contact information placeholders need to be updated"
    else
        status_ok "Contact information appears to be configured"
    fi
    
    if grep -q "\[EMERGENCY_CONTACT_REDACTED\]" "$governance_file"; then
        status_warning "Emergency contact placeholders need to be updated"
    fi
    
else
    status_error "Main governance documentation not found"
fi

echo ""

# Test 3: Check governance tools functionality
status_info "Testing governance tools..."

governance_tools="$PROJECT_DIR/scripts/governance_tools.sh"
if [ -x "$governance_tools" ]; then
    status_ok "Governance tools script is executable"
    
    # Test help functionality
    if "$governance_tools" --help >/dev/null 2>&1; then
        status_ok "Governance tools help function works"
    else
        status_warning "Governance tools help function has issues"
    fi
    
    # Test validation function
    if "$governance_tools" validate-governance >/dev/null 2>&1; then
        status_ok "Governance validation function works"
    else
        status_warning "Governance validation function has issues"
    fi
    
else
    status_error "Governance tools script not found or not executable"
fi

echo ""

# Test 4: Check environment configuration
status_info "Checking environment configuration..."

if [ -f "$PROJECT_DIR/app/ts/.env" ]; then
    set -a
    source "$PROJECT_DIR/app/ts/.env"
    set +a
    
    # Check required variables for governance
    governance_vars=("PROGRAM_ID" "DEV_WALLET")
    missing_vars=()
    
    for var in "${governance_vars[@]}"; do
        if [ -n "${!var:-}" ]; then
            status_ok "Environment variable set: $var"
        else
            status_error "Missing environment variable: $var"
            missing_vars+=("$var")
        fi
    done
    
    # Validate program ID format
    if [ -n "${PROGRAM_ID:-}" ]; then
        if [[ ${#PROGRAM_ID} -eq 44 ]] && [[ $PROGRAM_ID =~ ^[A-Za-z0-9]+$ ]]; then
            status_ok "Program ID format appears valid"
        else
            status_warning "Program ID format may be invalid"
        fi
    fi
    
else
    status_error "Environment file not found"
fi

echo ""

# Test 5: Check program authority status
status_info "Checking current program authority status..."

if [ -n "${PROGRAM_ID:-}" ] && command -v solana >/dev/null 2>&1; then
    if program_info=$(solana program show "$PROGRAM_ID" 2>/dev/null); then
        authority=$(echo "$program_info" | grep "Upgrade Authority" | awk '{print $3}' || echo "not found")
        
        if [ "$authority" != "not found" ] && [ "$authority" != "null" ]; then
            status_ok "Program has upgrade authority: $authority"
            
            # Check if it matches documented authority
            if [ "$authority" = "${DEV_WALLET:-}" ]; then
                status_ok "Authority matches documented dev wallet"
            else
                status_warning "Authority differs from documented dev wallet"
            fi
        elif [ "$authority" = "null" ]; then
            status_warning "Program is immutable (no upgrade authority)"
        else
            status_error "Could not determine upgrade authority"
        fi
    else
        status_warning "Could not retrieve program information (may not be deployed)"
    fi
else
    status_warning "Cannot check program authority (missing PROGRAM_ID or solana CLI)"
fi

echo ""

# Test 6: Check multisig preparation
status_info "Checking multisig preparation..."

multisig_dir="$PROJECT_DIR/multisig-signers"
if [ -d "$multisig_dir" ]; then
    signer_count=$(find "$multisig_dir" -name "*.json" | wc -l)
    
    if [ "$signer_count" -ge 3 ]; then
        status_ok "Multisig signers directory has $signer_count keypairs"
    else
        status_warning "Multisig signers directory has only $signer_count keypairs (recommend 5 for 3-of-5)"
    fi
else
    status_info "Multisig signers directory not yet created (expected for development phase)"
fi

# Check for Squads CLI
if command -v sqds >/dev/null 2>&1; then
    status_ok "Squads CLI available for multisig operations"
else
    status_info "Squads CLI not installed (needed for Phase 2 governance)"
fi

echo ""

# Test 7: Check documentation consistency
status_info "Checking documentation consistency..."

# Check if program ID is consistent across files
if [ -n "${PROGRAM_ID:-}" ]; then
    config_files=(
        "docs/GOVERNANCE.md"
        "TECH_SPEC.md"
        "README.md"
    )
    
    for config_file in "${config_files[@]}"; do
        if [ -f "$PROJECT_DIR/$config_file" ]; then
            if grep -q "$PROGRAM_ID" "$PROJECT_DIR/$config_file"; then
                status_ok "Program ID found in: $config_file"
            else
                status_warning "Program ID not found in: $config_file"
            fi
        fi
    done
fi

echo ""

# Test 8: Check upgrade process requirements
status_info "Checking upgrade process requirements..."

# Check for test scripts
test_scripts=(
    "npm run test:all"
    "npm run test:integration"
    "npm run test:jest"
    "npm run test:property"
)

if [ -f "$PROJECT_DIR/package.json" ]; then
    for script in "${test_scripts[@]}"; do
        script_name=$(echo "$script" | awk '{print $3}')
        if grep -q "\"$script_name\"" "$PROJECT_DIR/package.json"; then
            status_ok "Test script available: $script_name"
        else
            status_warning "Test script missing: $script_name"
        fi
    done
else
    status_warning "package.json not found"
fi

# Check for deployment scripts
deployment_scripts=(
    "scripts/deploy_program_upgrade.sh"
    "scripts/check_deployment_status.sh"
)

for script in "${deployment_scripts[@]}"; do
    if [ -f "$PROJECT_DIR/$script" ]; then
        status_ok "Deployment script found: $script"
    else
        status_warning "Deployment script missing: $script"
    fi
done

echo ""

# Summary
echo "=== Governance Validation Summary ==="

total_issues=0

if [ ${#missing_files[@]} -gt 0 ]; then
    ((total_issues++))
    status_error "Missing ${#missing_files[@]} required files"
fi

if grep -q "\[CONTACT_INFO_REDACTED\]" "$PROJECT_DIR/docs/GOVERNANCE.md" 2>/dev/null; then
    ((total_issues++))
    status_warning "Contact information placeholders need updating"
fi

if [ ${#missing_vars[@]} -gt 0 ]; then
    ((total_issues++))
    status_error "Missing ${#missing_vars[@]} environment variables"
fi

if [ "$total_issues" -eq 0 ]; then
    status_ok "Governance documentation validation completed successfully"
    echo -e "${GREEN}Status: READY FOR GOVERNANCE OPERATIONS${NC}"
else
    status_warning "Governance documentation validation completed with $total_issues issues"
    echo -e "${YELLOW}Status: NEEDS ATTENTION BEFORE PRODUCTION${NC}"
fi

echo ""
echo "Next Steps:"
if grep -q "\[CONTACT_INFO_REDACTED\]" "$PROJECT_DIR/docs/GOVERNANCE.md" 2>/dev/null; then
    echo "  1. Update contact information in docs/GOVERNANCE.md"
fi
if [ ! -d "$multisig_dir" ]; then
    echo "  2. Prepare multisig signers for Phase 2 governance"
fi
if ! command -v sqds >/dev/null 2>&1; then
    echo "  3. Install Squads CLI for multisig operations"
fi
echo "  4. Review and customize governance procedures for your organization"
echo "  5. Test governance tools in safe environment before production use"

echo ""
echo "Documentation: $PROJECT_DIR/docs/GOVERNANCE.md"
echo "Tools: $PROJECT_DIR/scripts/governance_tools.sh"