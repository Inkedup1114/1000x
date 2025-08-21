#!/bin/bash

# 1000x Burner Bot Monitoring Script
# This script should be run via cron every 5 minutes
# Example cron entry: */5 * * * * /home/ubuntu/1000x/ops/monitor.sh

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/burner-bot-monitor.log"
ALERT_FILE="/tmp/burner-bot-alert.flag"
MAX_ALERT_INTERVAL=3600  # Don't send alerts more than once per hour

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Alert function (placeholder - replace with your alerting mechanism)
send_alert() {
    local severity="$1"
    local message="$2"
    
    # Check if we've sent an alert recently
    if [[ -f "$ALERT_FILE" ]]; then
        local last_alert=$(stat -c %Y "$ALERT_FILE" 2>/dev/null || echo 0)
        local now=$(date +%s)
        if (( now - last_alert < MAX_ALERT_INTERVAL )); then
            log "Suppressing alert (sent recently): $severity - $message"
            return
        fi
    fi
    
    # Create alert flag file
    touch "$ALERT_FILE"
    
    log "ALERT: $severity - $message"
    
    # Multiple alerting mechanisms - configure via environment variables
    local alert_message="[1000x Burner Bot] $severity: $message"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local hostname=$(hostname)
    local full_message="$alert_message (Host: $hostname, Time: $timestamp)"
    
    # 1. Email alerting (requires ALERT_EMAIL environment variable)
    if [[ -n "${ALERT_EMAIL:-}" ]] && command -v mail >/dev/null 2>&1; then
        echo "$full_message" | mail -s "Burner Bot Alert: $severity" "$ALERT_EMAIL" || \
            log "Failed to send email alert to $ALERT_EMAIL"
    fi
    
    # 2. Slack webhook (requires SLACK_WEBHOOK_URL environment variable)
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]] && command -v curl >/dev/null 2>&1; then
        local slack_payload=$(cat <<EOF
{
    "text": "$alert_message",
    "username": "Burner Bot Monitor",
    "icon_emoji": ":warning:",
    "attachments": [
        {
            "color": "$([[ "$severity" == "CRITICAL" ]] && echo "danger" || echo "warning")",
            "fields": [
                {"title": "Severity", "value": "$severity", "short": true},
                {"title": "Host", "value": "$hostname", "short": true},
                {"title": "Time", "value": "$timestamp", "short": true}
            ]
        }
    ]
}
EOF
        )
        curl -X POST -H 'Content-type: application/json' \
            --data "$slack_payload" \
            "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || \
            log "Failed to send Slack alert"
    fi
    
    # 3. Discord webhook (requires DISCORD_WEBHOOK_URL environment variable)
    if [[ -n "${DISCORD_WEBHOOK_URL:-}" ]] && command -v curl >/dev/null 2>&1; then
        local discord_payload=$(cat <<EOF
{
    "username": "Burner Bot Monitor",
    "content": "$full_message",
    "embeds": [
        {
            "title": "Burner Bot Alert",
            "description": "$message",
            "color": $([[ "$severity" == "CRITICAL" ]] && echo "16711680" || echo "16776960"),
            "fields": [
                {"name": "Severity", "value": "$severity", "inline": true},
                {"name": "Host", "value": "$hostname", "inline": true},
                {"name": "Time", "value": "$timestamp", "inline": true}
            ]
        }
    ]
}
EOF
        )
        curl -X POST -H 'Content-type: application/json' \
            --data "$discord_payload" \
            "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || \
            log "Failed to send Discord alert"
    fi
    
    # 4. System notification (desktop environments)
    if command -v notify-send >/dev/null 2>&1; then
        notify-send "Burner Bot Alert" "$full_message" -u critical 2>/dev/null || true
    fi
    
    # 5. Write to dedicated alert log file
    local alert_log="/var/log/burner-bot-alerts.log"
    echo "[$timestamp] $severity: $message (Host: $hostname)" >> "$alert_log" 2>/dev/null || true
    
    # 6. PagerDuty integration (requires PAGERDUTY_INTEGRATION_KEY environment variable)
    if [[ -n "${PAGERDUTY_INTEGRATION_KEY:-}" ]] && command -v curl >/dev/null 2>&1; then
        local event_action="trigger"
        local dedup_key="burner-bot-${severity,,}-$(echo "$message" | md5sum | cut -d' ' -f1)"
        
        local pagerduty_payload=$(cat <<EOF
{
    "routing_key": "$PAGERDUTY_INTEGRATION_KEY",
    "event_action": "$event_action",
    "dedup_key": "$dedup_key",
    "payload": {
        "summary": "$alert_message",
        "source": "$hostname",
        "severity": "$([[ "$severity" == "CRITICAL" ]] && echo "critical" || echo "warning")",
        "component": "burner-bot",
        "group": "1000x-token",
        "custom_details": {
            "host": "$hostname",
            "timestamp": "$timestamp",
            "message": "$message"
        }
    }
}
EOF
        )
        curl -X POST -H 'Content-type: application/json' \
            --data "$pagerduty_payload" \
            "https://events.pagerduty.com/v2/enqueue" >/dev/null 2>&1 || \
            log "Failed to send PagerDuty alert"
    fi
}

# Main monitoring function
main() {
    log "Starting burner bot monitoring check"
    
    # Check if burner bot service is running
    if ! systemctl is-active --quiet burner-bot 2>/dev/null; then
        send_alert "CRITICAL" "Burner bot service is not running"
        return 1
    fi
    
    # Check service status
    local service_status=$(systemctl status burner-bot --no-pager -l)
    local restart_count=$(echo "$service_status" | grep -o "restarts.*" || echo "0 restarts")
    
    if [[ "$restart_count" =~ ([0-9]+) ]] && (( ${BASH_REMATCH[1]} > 10 )); then
        send_alert "WARNING" "Burner bot has restarted ${BASH_REMATCH[1]} times"
    fi
    
    # Run health check
    cd "$PROJECT_DIR"
    
    if ! command -v ts-node >/dev/null 2>&1; then
        log "ERROR: ts-node not found, installing..."
        npm install -g ts-node || {
            send_alert "CRITICAL" "Failed to install ts-node for health checks"
            return 1
        }
    fi
    
    # Run the health check script
    local health_output
    local health_exit_code
    
    health_output=$(ts-node ops/healthcheck.ts 2>&1) || health_exit_code=$?
    
    case "${health_exit_code:-0}" in
        0)
            log "Health check passed"
            # Remove alert flag on successful check
            rm -f "$ALERT_FILE"
            ;;
        1)
            log "Health check warnings detected"
            send_alert "WARNING" "Burner bot health check warnings: $health_output"
            ;;
        2)
            log "Health check critical errors detected"
            send_alert "CRITICAL" "Burner bot health check failed: $health_output"
            ;;
        *)
            log "Health check script error (exit code: ${health_exit_code:-unknown})"
            send_alert "CRITICAL" "Health check script failed: $health_output"
            ;;
    esac
    
    # Check disk space
    local disk_usage=$(df "$PROJECT_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
    if (( disk_usage > 90 )); then
        send_alert "WARNING" "Disk usage is ${disk_usage}% on burner bot server"
    fi
    
    # Check memory usage
    local memory_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if (( memory_usage > 90 )); then
        send_alert "WARNING" "Memory usage is ${memory_usage}% on burner bot server"
    fi
    
    # Check recent log entries for errors
    local recent_errors=$(journalctl -u burner-bot --since "5 minutes ago" --no-pager | grep -i error | wc -l)
    if (( recent_errors > 5 )); then
        send_alert "WARNING" "High error rate in burner bot logs: $recent_errors errors in last 5 minutes"
    fi
    
    log "Monitoring check completed successfully"
}

# Run main function and capture exit code
main
exit_code=$?

# Rotate log file if it gets too large (> 10MB)
if [[ -f "$LOG_FILE" ]] && (( $(stat -c%s "$LOG_FILE") > 10485760 )); then
    log "Rotating log file"
    mv "$LOG_FILE" "${LOG_FILE}.old"
    touch "$LOG_FILE"
fi

exit $exit_code
