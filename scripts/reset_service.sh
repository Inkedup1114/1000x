#!/bin/bash

# Service Reset Script for 1000x Token System
# Performs complete service reset with diagnostic information

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
LOG_FILE="/var/log/service-reset.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Ensure log file exists and is writable
sudo touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/tmp/service-reset.log"
sudo chmod 666 "$LOG_FILE" 2>/dev/null || true

# Logging function
log() {
    echo "[$TIMESTAMP] $*" | tee -a "$LOG_FILE"
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

echo "=== 1000x Token Service Reset ==="
echo "Time: $(date)"
echo "Host: $(hostname)"
echo ""

# Pre-reset diagnostics
status_info "Gathering pre-reset diagnostics..."

# Check current service status
if systemctl is-active --quiet burner-bot 2>/dev/null; then
    status_info "Service is currently running"
    
    # Get service details
    service_status=$(systemctl status burner-bot --no-pager -l 2>/dev/null || echo "unknown")
    echo "$service_status" >> "$LOG_FILE"
    
    # Check for restarts
    restart_count=$(echo "$service_status" | grep -o "restarts.*" || echo "0 restarts")
    status_info "Service restart history: $restart_count"
    
else
    status_warning "Service is not currently running"
fi

# Check for failed state
if systemctl is-failed --quiet burner-bot 2>/dev/null; then
    status_warning "Service is in failed state"
fi

# Capture recent logs before reset
status_info "Capturing recent logs..."
if command -v journalctl >/dev/null 2>&1; then
    {
        echo "=== PRE-RESET LOGS ==="
        journalctl -u burner-bot --since "1 hour ago" --no-pager
        echo "=== END PRE-RESET LOGS ==="
    } >> "$LOG_FILE" 2>/dev/null || status_warning "Could not capture service logs"
fi

# Check system resources
status_info "Checking system resources..."
{
    echo "=== SYSTEM RESOURCES ==="
    echo "Disk usage:"
    df -h "$PROJECT_DIR" || echo "Could not check disk usage"
    echo ""
    echo "Memory usage:"
    free -h || echo "Could not check memory usage"
    echo ""
    echo "Load average:"
    uptime || echo "Could not check load average"
    echo "=== END SYSTEM RESOURCES ==="
} >> "$LOG_FILE" 2>/dev/null

echo ""

# Begin reset process
status_info "Starting service reset process..."

# Step 1: Stop the service
status_info "Stopping burner-bot service..."
if sudo systemctl stop burner-bot 2>/dev/null; then
    status_ok "Service stopped successfully"
else
    status_warning "Service stop command completed (may have already been stopped)"
fi

# Step 2: Kill any remaining processes
status_info "Checking for remaining processes..."
if pgrep -f "burner_bot" >/dev/null 2>&1; then
    status_warning "Found running burner processes, terminating..."
    sudo pkill -f "burner_bot" || true
    sleep 2
    
    # Force kill if still running
    if pgrep -f "burner_bot" >/dev/null 2>&1; then
        status_warning "Force killing remaining processes..."
        sudo pkill -9 -f "burner_bot" || true
    fi
    
    status_ok "Processes terminated"
else
    status_ok "No remaining processes found"
fi

# Step 3: Clear failed state
status_info "Clearing failed state..."
if sudo systemctl reset-failed burner-bot 2>/dev/null; then
    status_ok "Failed state cleared"
else
    status_info "No failed state to clear"
fi

# Step 4: Clean logs (optional, keep recent)
status_info "Cleaning old logs..."
if command -v journalctl >/dev/null 2>&1; then
    if sudo journalctl --vacuum-time=24h 2>/dev/null; then
        status_ok "Old logs cleaned (kept last 24 hours)"
    else
        status_warning "Could not clean old logs"
    fi
fi

# Step 5: Reload systemd configuration
status_info "Reloading systemd configuration..."
if sudo systemctl daemon-reload 2>/dev/null; then
    status_ok "Systemd configuration reloaded"
else
    status_error "Failed to reload systemd configuration"
fi

# Step 6: Validate environment
status_info "Validating environment configuration..."
cd "$PROJECT_DIR"

if [ -f "app/ts/.env" ]; then
    # Check required variables exist (don't print values for security)
    required_vars=("RPC_URL" "MINT_ADDRESS" "PROGRAM_ID" "BURNER_AUTHORITY_KEY")
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" app/ts/.env; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -eq 0 ]; then
        status_ok "Environment variables validated"
    else
        status_error "Missing environment variables: ${missing_vars[*]}"
        echo "Please check app/ts/.env file"
    fi
else
    status_error "Environment file not found: app/ts/.env"
fi

# Step 7: Test basic connectivity
if [ -f "app/ts/.env" ]; then
    set -a
    source app/ts/.env
    set +a
    
    status_info "Testing RPC connectivity..."
    if curl -s -m 10 -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' >/dev/null 2>&1; then
        status_ok "RPC connection successful"
    else
        status_warning "RPC connection failed - service may have issues"
    fi
fi

echo ""

# Step 8: Start the service
status_info "Starting burner-bot service..."
if sudo systemctl start burner-bot 2>/dev/null; then
    status_ok "Service start command issued"
else
    status_error "Failed to start service"
    exit 1
fi

# Step 9: Wait for service to stabilize
status_info "Waiting for service to stabilize..."
sleep 5

# Step 10: Verify service status
status_info "Verifying service status..."
if systemctl is-active --quiet burner-bot 2>/dev/null; then
    status_ok "Service is running"
    
    # Get detailed status
    if service_status=$(systemctl status burner-bot --no-pager -l 2>/dev/null); then
        if echo "$service_status" | grep -q "Active: active (running)"; then
            status_ok "Service is active and healthy"
        else
            status_warning "Service is running but may have issues"
        fi
    fi
else
    status_error "Service failed to start properly"
    
    # Show recent failure logs
    status_info "Recent failure logs:"
    journalctl -u burner-bot --since "2 minutes ago" --no-pager | tail -20
    exit 1
fi

# Step 11: Test health endpoint
status_info "Testing health endpoint..."
sleep 2  # Give service time to initialize

attempt=0
max_attempts=6
health_ok=false

while [ $attempt -lt $max_attempts ]; do
    if health_response=$(curl -s -m 5 http://localhost:8080/health 2>/dev/null); then
        if echo "$health_response" | grep -q '"status"'; then
            status=$(echo "$health_response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            
            case "$status" in
                "healthy")
                    status_ok "Health endpoint reports healthy"
                    health_ok=true
                    break
                    ;;
                "warning")
                    status_warning "Health endpoint reports warnings"
                    health_ok=true
                    break
                    ;;
                *)
                    status_warning "Health endpoint reports status: $status"
                    ;;
            esac
        else
            status_warning "Health endpoint returned unexpected response"
        fi
    else
        status_info "Health endpoint not ready, retrying... (attempt $((attempt + 1))/$max_attempts)"
    fi
    
    attempt=$((attempt + 1))
    sleep 5
done

if [ "$health_ok" = false ]; then
    status_warning "Health endpoint not responding properly after $max_attempts attempts"
fi

echo ""

# Final diagnostics
status_info "Gathering post-reset diagnostics..."

# Service info
{
    echo "=== POST-RESET SERVICE STATUS ==="
    systemctl status burner-bot --no-pager -l 2>/dev/null || echo "Could not get service status"
    echo "=== END POST-RESET SERVICE STATUS ==="
} >> "$LOG_FILE"

# Process info
if pgrep -f "burner_bot" >/dev/null 2>&1; then
    status_ok "Burner process is running"
    
    # Get process details
    {
        echo "=== PROCESS INFORMATION ==="
        ps aux | grep burner_bot | grep -v grep || echo "No process details available"
        echo "=== END PROCESS INFORMATION ==="
    } >> "$LOG_FILE"
else
    status_warning "No burner process found (service may use different process name)"
fi

echo ""
echo "=== Service Reset Summary ==="

if systemctl is-active --quiet burner-bot 2>/dev/null; then
    status_ok "Service reset completed successfully"
    echo -e "${GREEN}Status: Service is running${NC}"
    
    if [ "$health_ok" = true ]; then
        echo -e "${GREEN}Health: Endpoint responding${NC}"
    else
        echo -e "${YELLOW}Health: Endpoint issues detected${NC}"
    fi
else
    status_error "Service reset failed"
    echo -e "${RED}Status: Service is not running${NC}"
    exit 1
fi

echo ""
echo "Log file: $LOG_FILE"
echo "Timestamp: $(date)"
echo ""
echo "Monitoring commands:"
echo "  Service status: sudo systemctl status burner-bot"
echo "  Live logs: sudo journalctl -u burner-bot -f"
echo "  Health check: curl http://localhost:8080/health | jq"
echo "  Quick health: $SCRIPT_DIR/quick_health.sh"