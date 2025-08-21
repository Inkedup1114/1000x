# 1kx Hook - Incident Response Runbook

## Overview

This runbook provides step-by-step procedures for responding to critical incidents with the 1kx Hook system. Follow these procedures to ensure rapid resolution and minimal impact to token launches.

## Emergency Contacts

- **Primary Dev**: [Contact information needed]
- **Backup Dev**: [Contact information needed] 
- **Operations Team**: [Contact information needed]

## Critical Incident Types

### 1. Key Compromise

#### Detection

- Unauthorized transactions from dev wallet
- Unexpected program upgrades
- Unusual hook configuration changes

#### Immediate Response (< 5 minutes)

1. **STOP ALL OPERATIONS**

   ```bash
   # Disable the burner bot immediately
   sudo systemctl stop burner
   
   # Check recent transactions
   solana transaction-history <compromised-wallet-address> --limit 50
   ```

2. **Secure Remaining Assets**

   ```bash
   # Transfer remaining SOL to secure backup wallet
   solana transfer <backup-wallet> ALL --from <compromised-wallet>
   
   # Document all asset movements
   echo "$(date): Emergency transfer due to key compromise" >> incident.log
   ```

3. **Revoke Program Authority**

   ```bash
   # Set program authority to null (irreversible!)
   solana program set-upgrade-authority <program-id> --new-upgrade-authority null
   ```

#### Recovery (< 30 minutes)

1. Generate new keypairs for all affected accounts
2. Update all configuration files with new addresses
3. Redeploy program with new authority if needed
4. Update monitoring systems with new addresses

### 2. Halted Burner Bot

#### Bot Detection

- Bot stops processing transactions
- Health check failures
- Manual halt via monitoring

#### Immediate Response (< 2 minutes)

1. **Check Bot Status**

   ```bash
   # Check service status
   sudo systemctl status burner
   
   # Check recent logs
   sudo journalctl -u burner -n 50 --no-pager
   
   # Check health endpoint
   curl http://localhost:8080/health
   ```

2. **Identify Halt Reason**

   ```bash
   # Check for common issues
   grep -i "error\|fail\|panic" /var/log/burner.log | tail -20
   
   # Check SOL balance
   solana balance
   
   # Check program account status
   solana account <program-id>
   ```

#### Resolution (Burner Bot)

- **Insufficient SOL**: Request airdrop or transfer funds
- **Program errors**: Check for recent program changes, rollback if needed
- **Network issues**: Wait for network recovery or switch RPC endpoint
- **Configuration errors**: Fix config and restart service

#### Restart Procedure

```bash
# After fixing the issue
sudo systemctl restart burner
sudo systemctl status burner

# Verify health
curl http://localhost:8080/health
```

### 3. Stuck Withheld Fees

#### Fee Detection

- Fees accumulating but not being processed
- Balance discrepancies in fee accounts
- User complaints about missing fee distributions

#### Investigation

1. **Check Fee Account Balances**

   ```bash
   # Check withheld fee balance
   solana balance <fee-account-address>
   
   # Check recent fee transactions
   solana transaction-history <fee-account-address> --limit 20
   ```

2. **Verify Processing Logic**

   ```bash
   # Check if burner is processing fees
   grep "fee.*process" /var/log/burner.log | tail -10
   
   # Check for any stuck transactions
   solana pending-transactions
   ```

#### Resolution (Withheld Fees)

1. **Manual Fee Distribution**

   ```bash
   # If automated distribution fails, manual intervention:
   cd /home/ink/1000x
   npm run distribute-fees -- --amount <amount> --recipient <address>
   ```

2. **Restart Fee Processing**

   ```bash
   # Restart the specific fee processing component
   sudo systemctl restart burner
   
   # Monitor for successful processing
   tail -f /var/log/burner.log | grep "fee"
   ```

## Communication Protocols

### Internal Communication

1. Post in #alerts channel immediately upon incident detection
2. Update incident status every 15 minutes during active resolution
3. Post resolution summary when incident is resolved

### External Communication

- **Token Launch Partners**: Notify within 10 minutes if incident affects ongoing launches
- **Users**: Status page update within 30 minutes for user-facing issues
- **Auditors**: Notify within 24 hours for security-related incidents

## Post-Incident Procedures

### Immediate (< 2 hours)

1. Document timeline of events in incident.log
2. Collect all relevant logs and transaction signatures
3. Assess financial impact and user impact
4. Begin root cause analysis

### Short-term (< 24 hours)

1. Complete root cause analysis
2. Implement immediate fixes to prevent recurrence
3. Update monitoring to detect similar issues earlier
4. Conduct team post-mortem

### Long-term (< 1 week)

1. Update system architecture if needed
2. Enhance testing procedures
3. Update this runbook based on lessons learned
4. Schedule follow-up review

## System Recovery Checklist

After any incident, verify all systems are healthy:

- [ ] Burner bot is running and processing transactions
- [ ] Health checks are passing
- [ ] SOL balances are adequate
- [ ] Program is deployed and functional
- [ ] Monitoring systems are operational
- [ ] Fee processing is working correctly
- [ ] No pending stuck transactions

## Monitoring & Alerting

### Key Metrics to Monitor

- Burner bot health status
- SOL balance thresholds
- Transaction success rates
- Fee processing latency
- Program account changes

### Alert Thresholds

- SOL balance < 0.1 SOL
- Health check failures > 2 consecutive
- Transaction failures > 5% rate
- Fee processing delay > 1 hour

## Testing Procedures

### Monthly Incident Response Drill

1. Simulate key compromise scenario
2. Test burner halt and restart procedures
3. Verify communication channels work
4. Update contact information
5. Review and update runbook

## Version History

- v1.0 (2025-08-18): Initial runbook creation
- [Future versions will be documented here]
