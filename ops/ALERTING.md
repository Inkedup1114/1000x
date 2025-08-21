# Burner Bot Alerting Configuration

The monitoring script (`ops/monitor.sh`) supports multiple alerting mechanisms to ensure you're notified when issues occur with the burner bot service. Configure one or more of the following alerting methods based on your operational needs.

## Alerting Methods

### 1. Email Alerts

**Setup Requirements:**

- `mail` command installed (`sudo apt install mailutils` on Ubuntu)
- SMTP server configured on the system

**Configuration:**

```bash
export ALERT_EMAIL="admin@example.com"
```

**Multiple Recipients:**

```bash
export ALERT_EMAIL="admin1@example.com,admin2@example.com"
```

### 2. Slack Webhook

**Setup Requirements:**

1. Create a Slack app in your workspace
2. Enable incoming webhooks
3. Get the webhook URL

**Configuration:**

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
```

**Features:**

- Rich message formatting with color-coded severity
- Structured fields (severity, host, timestamp)
- Custom username and emoji

### 3. Discord Webhook

**Setup Requirements:**

1. Go to your Discord server settings
2. Navigate to Integrations → Webhooks
3. Create a new webhook and copy the URL

**Configuration:**

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK"
```

**Features:**

- Embedded messages with color coding
- Structured field layout
- Critical/Warning severity distinction

### 4. PagerDuty Integration

**Setup Requirements:**

1. Create a PagerDuty service
2. Get the integration key from the service

**Configuration:**

```bash
export PAGERDUTY_INTEGRATION_KEY="your_integration_key_here"
```

**Features:**

- Automatic incident creation
- Deduplication based on message content
- Severity mapping (CRITICAL → critical, WARNING → warning)
- Custom details with host and timestamp information

### 5. System Notifications

**Setup Requirements:**

- Desktop environment with `notify-send` support
- Useful for development/testing environments

**Configuration:**
No additional configuration required - works automatically if `notify-send` is available.

### 6. Dedicated Alert Log

**Setup Requirements:**
None - writes to `/var/log/burner-bot-alerts.log` automatically

**Features:**

- Persistent log of all alerts
- Timestamped entries
- No external dependencies

## Configuration Methods

### Method 1: Environment Variables (Recommended for Production)

Add alerting variables to your environment file (e.g., `/etc/systemd/system/burner-bot.service.d/override.conf`):

```ini
[Service]
Environment="ALERT_EMAIL=admin@example.com"
Environment="SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
Environment="PAGERDUTY_INTEGRATION_KEY=your_integration_key_here"
```

### Method 2: Shell Profile

Add to `/etc/profile.d/burner-bot-alerts.sh`:

```bash
#!/bin/bash
export ALERT_EMAIL="admin@example.com"
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK"
export PAGERDUTY_INTEGRATION_KEY="your_integration_key_here"
```

### Method 3: Cron Environment

For cron-based monitoring, add to the crontab:

```bash
# Environment variables for alerting
ALERT_EMAIL=admin@example.com
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# Monitor every 5 minutes
*/5 * * * * /home/ubuntu/1000x/ops/monitor.sh
```

## Alert Severity Levels

### CRITICAL Alerts

- Service not running
- Health check failures
- Script execution errors
- Infrastructure failures

### WARNING Alerts

- High restart counts (>10 restarts)
- Health check warnings
- High resource usage (>90% disk/memory)
- Elevated error rates (>5 errors per 5 minutes)

## Alert Throttling

The system prevents alert spam by:

- Maximum one alert per hour per issue type
- Alert flag file tracking (`/tmp/burner-bot-alert.flag`)
- Automatic flag cleanup on successful health checks

## Testing Alerts

Test your alerting configuration:

```bash
# Test all configured alerting methods
cd /home/ubuntu/1000x
./ops/monitor.sh

# Force a test alert by temporarily stopping the service
sudo systemctl stop burner-bot
./ops/monitor.sh
sudo systemctl start burner-bot
```

## Troubleshooting

### Email Alerts Not Working

```bash
# Check if mail command is available
which mail

# Test mail configuration
echo "Test message" | mail -s "Test Subject" your-email@example.com

# Install mail utilities if missing
sudo apt install mailutils
```

### Webhook Alerts Not Working

```bash
# Test webhook manually
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test message"}' \
  "$SLACK_WEBHOOK_URL"

# Check curl availability
which curl

# Install curl if missing
sudo apt install curl
```

### PagerDuty Alerts Not Working

```bash
# Verify integration key format
echo "Integration key: $PAGERDUTY_INTEGRATION_KEY"

# Test PagerDuty API connectivity
curl -X POST -H 'Content-type: application/json' \
  --data '{"routing_key":"'$PAGERDUTY_INTEGRATION_KEY'","event_action":"trigger","payload":{"summary":"Test alert","source":"test","severity":"info"}}' \
  "https://events.pagerduty.com/v2/enqueue"
```

## Security Considerations

1. **Webhook URLs**: Treat as secrets - don't commit to version control
2. **Email Configuration**: Ensure SMTP credentials are secure
3. **Environment Variables**: Use restricted file permissions
4. **Log Files**: Alert logs may contain sensitive information

## Production Recommendations

1. **Configure Multiple Methods**: Use at least 2 alerting methods for redundancy
2. **Test Regularly**: Verify alerts work during maintenance windows
3. **Monitor the Monitor**: Ensure the monitoring script itself is working
4. **Log Rotation**: Configure logrotate for alert log files
5. **Access Control**: Restrict access to alerting configuration files

## Example Production Configuration

```bash
# /etc/systemd/system/burner-bot.service.d/alerts.conf
[Service]
Environment="ALERT_EMAIL=ops-team@company.com"
Environment="SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX"
Environment="PAGERDUTY_INTEGRATION_KEY=1234567890abcdef1234567890abcdef"

# Reload systemd after changes
sudo systemctl daemon-reload
sudo systemctl restart burner-bot
```
