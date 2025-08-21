#!/bin/bash

# Quick Health Check Script for 1000x Token System
# Provides rapid assessment of system health for incident response

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/quick_health_$(date +%s).log"

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
status_ok() {
    echo -e "${GREEN}✓${NC} $1"
}

status_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

status_error() {
    echo -e "${RED}✗${NC} $1"
}

echo "=== 1000x Token System Quick Health Check ==="
echo "Time: $(date)"
echo "Host: $(hostname)"
echo ""

# Check 1: Service Status
echo "1. Service Status:"
if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet burner-bot 2>/dev/null; then
        status_ok "Burner bot service is running"
        
        # Check service health
        service_status=$(systemctl status burner-bot --no-pager -l 2>/dev/null || echo "unknown")
        if echo "$service_status" | grep -q "Active: active (running)"; then
            status_ok "Service is active and running"
        else
            status_warning "Service may have issues - check logs"
        fi
    else
        status_error "Burner bot service is not running"
        log "ERROR: Burner bot service is down"
    fi
else
    status_warning "systemctl not available - cannot check service status"
fi

echo ""

# Check 2: SOL Balance
echo "2. SOL Balance:"
if command -v solana >/dev/null 2>&1; then
    if balance_output=$(solana balance --lamports 2>/dev/null); then
        # Extract just the number from the output (remove "lamports" text)
        balance_lamports=$(echo "$balance_output" | grep -o '[0-9]*')
        
        if [ -n "$balance_lamports" ] && [ "$balance_lamports" -gt 0 ]; then
            balance_sol=$(echo "scale=4; $balance_lamports/1000000000" | bc -l 2>/dev/null || echo "unknown")
            
            if [ "$balance_lamports" -gt 10000000 ]; then  # > 0.01 SOL
                status_ok "SOL balance adequate: $balance_sol SOL"
            elif [ "$balance_lamports" -gt 1000000 ]; then  # > 0.001 SOL
                status_warning "SOL balance low: $balance_sol SOL (consider topping up)"
            else
                status_error "SOL balance critical: $balance_sol SOL (immediate action required)"
                log "CRITICAL: SOL balance is $balance_sol SOL"
            fi
        else
            status_error "Invalid balance response: $balance_output"
            log "ERROR: Invalid balance response"
        fi
    else
        status_error "Failed to check SOL balance (wallet/RPC issue)"
        log "ERROR: Cannot check SOL balance"
    fi
else
    status_warning "Solana CLI not available - cannot check balance"
fi

echo ""

# Check 3: RPC Connection
echo "3. RPC Connection:"
if [ -n "${RPC_URL:-}" ]; then
    if response=$(curl -s -m 10 -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null); then
        
        if echo "$response" | grep -q '"result"'; then
            slot=$(echo "$response" | grep -o '"result":[0-9]*' | cut -d':' -f2)
            status_ok "RPC responsive (current slot: $slot)"
        else
            status_error "RPC returned unexpected response"
            log "ERROR: RPC response: $response"
        fi
    else
        status_error "RPC unresponsive or connection failed"
        log "ERROR: Cannot connect to RPC: $RPC_URL"
    fi
else
    status_warning "RPC_URL not configured - cannot test connection"
fi

echo ""

# Check 4: Recent Errors
echo "4. Recent Service Errors:"
if command -v journalctl >/dev/null 2>&1; then
    if error_count=$(journalctl -u burner-bot --since "5 minutes ago" --no-pager 2>/dev/null | grep -i error | wc -l); then
        if [ "$error_count" -eq 0 ]; then
            status_ok "No recent errors in service logs"
        elif [ "$error_count" -lt 5 ]; then
            status_warning "$error_count errors in last 5 minutes (check logs)"
        else
            status_error "$error_count errors in last 5 minutes (high error rate)"
            log "HIGH ERROR RATE: $error_count errors in last 5 minutes"
        fi
    else
        status_warning "Cannot access service logs"
    fi
else
    status_warning "journalctl not available - cannot check recent errors"
fi

echo ""

# Check 5: Program Status
echo "5. Program Status:"
if [ -n "${PROGRAM_ID:-}" ] && command -v solana >/dev/null 2>&1; then
    if program_info=$(solana account "$PROGRAM_ID" 2>/dev/null); then
        if echo "$program_info" | grep -q "Account does not exist"; then
            status_error "Program account does not exist"
            log "CRITICAL: Program $PROGRAM_ID does not exist"
        else
            status_ok "Program account exists and accessible"
        fi
    else
        status_error "Failed to check program status"
        log "ERROR: Cannot check program $PROGRAM_ID"
    fi
else
    status_warning "PROGRAM_ID not configured or Solana CLI unavailable"
fi

echo ""

# Check 6: System Resources
echo "6. System Resources:"

# Disk usage
if disk_usage=$(df "$PROJECT_DIR" 2>/dev/null | awk 'NR==2 {print $5}' | sed 's/%//'); then
    if [ "$disk_usage" -lt 80 ]; then
        status_ok "Disk usage: ${disk_usage}%"
    elif [ "$disk_usage" -lt 90 ]; then
        status_warning "Disk usage: ${disk_usage}% (monitor closely)"
    else
        status_error "Disk usage: ${disk_usage}% (critical)"
        log "CRITICAL: Disk usage is ${disk_usage}%"
    fi
else
    status_warning "Cannot check disk usage"
fi

# Memory usage
if memory_usage=$(free 2>/dev/null | awk 'NR==2{printf "%.0f", $3*100/$2}'); then
    if [ "$memory_usage" -lt 80 ]; then
        status_ok "Memory usage: ${memory_usage}%"
    elif [ "$memory_usage" -lt 90 ]; then
        status_warning "Memory usage: ${memory_usage}% (monitor closely)"
    else
        status_error "Memory usage: ${memory_usage}% (critical)"
        log "CRITICAL: Memory usage is ${memory_usage}%"
    fi
else
    status_warning "Cannot check memory usage"
fi

echo ""

# Check 7: Health Endpoint (if available)
echo "7. Health Endpoint:"
if health_response=$(curl -s -m 5 http://localhost:8080/health 2>/dev/null); then
    if echo "$health_response" | grep -q '"status":"healthy"'; then
        status_ok "Health endpoint reports healthy"
    elif echo "$health_response" | grep -q '"status":"warning"'; then
        status_warning "Health endpoint reports warnings"
    else
        status_error "Health endpoint reports issues"
        log "Health endpoint response: $health_response"
    fi
else
    status_warning "Health endpoint unavailable (service may be down)"
fi

echo ""

# Summary
echo "=== Health Check Summary ==="
echo "Log file: $LOG_FILE"

# Count issues
error_count=$(grep -c "ERROR:" "$LOG_FILE" 2>/dev/null || echo 0)
critical_count=$(grep -c "CRITICAL:" "$LOG_FILE" 2>/dev/null || echo 0)

if [ "$critical_count" -gt 0 ]; then
    echo -e "${RED}Status: CRITICAL${NC} ($critical_count critical issues found)"
    echo "Immediate attention required!"
    exit 2
elif [ "$error_count" -gt 0 ]; then
    echo -e "${YELLOW}Status: WARNING${NC} ($error_count issues found)"
    echo "Investigation recommended"
    exit 1
else
    echo -e "${GREEN}Status: HEALTHY${NC}"
    echo "All systems appear to be functioning normally"
    exit 0
fi