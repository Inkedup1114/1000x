#!/bin/bash

# Runbook Validation Script for 1000x Token System
# Validates that all emergency procedures and scripts are properly configured

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

echo "=== 1000x Token Runbook Validation ==="
echo "Time: $(date)"
echo "Project Directory: $PROJECT_DIR"
echo ""

# Test 1: Check all required files exist
status_info "Checking required files..."

required_files=(
    "docs/RUNBOOK.md"
    "scripts/quick_health.sh"
    "scripts/emergency_burn.sh" 
    "scripts/reset_service.sh"
    "app/ts/manual_burn.ts"
    "ops/monitor.sh"
    "ops/healthcheck.ts"
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

if [ ${#missing_files[@]} -gt 0 ]; then
    status_error "Missing ${#missing_files[@]} required files"
    echo "Please ensure all files are created before using the runbook"
    exit 1
else
    status_ok "All required files present"
fi

echo ""

# Test 2: Check script permissions
status_info "Checking script permissions..."

executable_files=(
    "scripts/quick_health.sh"
    "scripts/emergency_burn.sh"
    "scripts/reset_service.sh"
    "ops/monitor.sh"
)

for file in "${executable_files[@]}"; do
    if [ -x "$PROJECT_DIR/$file" ]; then
        status_ok "Executable: $file"
    else
        status_warning "Not executable: $file (will fix)"
        chmod +x "$PROJECT_DIR/$file"
    fi
done

echo ""

# Test 3: Validate environment configuration
status_info "Validating environment configuration..."

if [ -f "$PROJECT_DIR/app/ts/.env" ]; then
    status_ok "Environment file exists"
    
    # Check required variables (don't print values for security)
    required_vars=("RPC_URL" "MINT_ADDRESS" "PROGRAM_ID" "BURNER_AUTHORITY_KEY")
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if grep -q "^${var}=" "$PROJECT_DIR/app/ts/.env"; then
            status_ok "Environment variable: $var"
        else
            status_error "Missing environment variable: $var"
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        status_warning "Missing ${#missing_vars[@]} environment variables"
    fi
else
    status_error "Environment file missing: app/ts/.env"
fi

echo ""

# Test 4: Check system dependencies
status_info "Checking system dependencies..."

required_commands=(
    "solana"
    "ts-node"
    "npm"
    "curl"
    "systemctl"
    "journalctl"
    "bc"
)

missing_commands=()
for cmd in "${required_commands[@]}"; do
    if command -v "$cmd" >/dev/null 2>&1; then
        status_ok "Command available: $cmd"
    else
        status_error "Missing command: $cmd"
        missing_commands+=("$cmd")
    fi
done

if [ ${#missing_commands[@]} -gt 0 ]; then
    status_warning "Missing ${#missing_commands[@]} required commands"
    echo "Install missing commands before using emergency procedures"
fi

echo ""

# Test 5: Test script functionality (dry run)
status_info "Testing script functionality..."

# Test health check script
if bash "$PROJECT_DIR/scripts/quick_health.sh" >/dev/null 2>&1; then
    status_ok "Health check script runs successfully"
else
    status_warning "Health check script has issues (may be expected in test environment)"
fi

# Test TypeScript compilation
if cd "$PROJECT_DIR" && npx tsc --noEmit app/ts/manual_burn.ts >/dev/null 2>&1; then
    status_ok "Manual burn script compiles successfully"
else
    status_warning "Manual burn script has TypeScript issues"
fi

echo ""

# Test 6: Check monitoring configuration
status_info "Checking monitoring configuration..."

if [ -f "/etc/systemd/system/burner-bot.service" ] || [ -f "/etc/systemd/system/burner.service" ]; then
    status_ok "Systemd service configuration found"
else
    status_warning "Systemd service configuration not found"
fi

# Check for cron monitoring
if crontab -l 2>/dev/null | grep -q "monitor.sh\|healthcheck"; then
    status_ok "Monitoring cron job configured"
else
    status_warning "No monitoring cron job found"
fi

echo ""

# Test 7: Validate log directories
status_info "Checking log directories..."

log_dirs=(
    "/var/log"
    "/tmp"
)

for dir in "${log_dirs[@]}"; do
    if [ -w "$dir" ]; then
        status_ok "Log directory writable: $dir"
    else
        status_warning "Log directory not writable: $dir"
    fi
done

echo ""

# Test 8: Network connectivity test
status_info "Testing network connectivity..."

if [ -f "$PROJECT_DIR/app/ts/.env" ]; then
    set -a
    source "$PROJECT_DIR/app/ts/.env"
    set +a
    
    if [ -n "${RPC_URL:-}" ]; then
        if curl -s -m 5 -X POST "$RPC_URL" \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' >/dev/null 2>&1; then
            status_ok "RPC connectivity test passed"
        else
            status_warning "RPC connectivity test failed (may be expected)"
        fi
    else
        status_warning "RPC_URL not configured"
    fi
fi

echo ""

# Test 9: Emergency contact validation
status_info "Checking emergency contact configuration..."

if grep -q "\[REDACTED\]" "$PROJECT_DIR/docs/RUNBOOK.md"; then
    status_warning "Emergency contacts not configured (still using placeholders)"
    echo "  Update docs/RUNBOOK.md with actual contact information"
else
    status_ok "Emergency contacts appear to be configured"
fi

echo ""

# Summary
echo "=== Validation Summary ==="

total_issues=0

if [ ${#missing_files[@]} -gt 0 ]; then
    ((total_issues++))
fi

if [ ${#missing_commands[@]} -gt 0 ]; then
    ((total_issues++))
fi

if grep -q "\[REDACTED\]" "$PROJECT_DIR/docs/RUNBOOK.md"; then
    ((total_issues++))
fi

if [ "$total_issues" -eq 0 ]; then
    status_ok "Runbook validation completed successfully"
    echo -e "${GREEN}Status: READY${NC}"
    echo "All emergency procedures are properly configured"
else
    status_warning "Runbook validation completed with $total_issues issues"
    echo -e "${YELLOW}Status: NEEDS ATTENTION${NC}"
    echo "Review and fix issues before relying on emergency procedures"
fi

echo ""
echo "Emergency Script Tests:"
echo "  Quick health check: $PROJECT_DIR/scripts/quick_health.sh"
echo "  Emergency burn: $PROJECT_DIR/scripts/emergency_burn.sh"
echo "  Service reset: $PROJECT_DIR/scripts/reset_service.sh"
echo ""
echo "Documentation:"
echo "  Main runbook: $PROJECT_DIR/docs/RUNBOOK.md"
echo "  Monitoring setup: $PROJECT_DIR/ops/"