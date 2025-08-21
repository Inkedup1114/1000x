# 1000x Token Incident Response Runbook

## 🚨 Critical Contacts

### Primary Response Team
- **Program Upgrade Authority**: [REDACTED - Insert contact info]
- **Burner Authority Holder**: [REDACTED - Insert contact info]  
- **Dev Team Lead**: [REDACTED - Insert contact info]
- **Operations Team**: [REDACTED - Insert contact info]

### Emergency Escalation
- **Security Team**: [REDACTED - Insert contact info]
- **Audit Partner**: [REDACTED - Insert contact info]
- **Legal Counsel**: [REDACTED - Insert contact info]

### External Partners
- **RPC Provider Support**: [REDACTED - Insert contact info]
- **Exchange Contacts**: [REDACTED - Insert contact info]
- **Community Manager**: [REDACTED - Insert contact info]

---

## 🚨 Incident Classification

### 🔴 CRITICAL (P0) - Immediate Response Required
- Key compromise with active exploitation
- Program exploit with funds at risk
- Complete system failure affecting all operations
- Security vulnerability being actively exploited

### 🟡 HIGH (P1) - Response Within 15 Minutes
- Burner bot complete failure
- RPC connection total loss
- Withheld fees stuck with accumulation
- Monitoring system failure

### 🟠 MEDIUM (P2) - Response Within 1 Hour
- Partial burner bot degradation
- Intermittent RPC issues
- Fee processing delays
- Configuration issues

### 🟢 LOW (P3) - Response Within 24 Hours
- Performance degradation
- Non-critical monitoring alerts
- Documentation updates needed

---

## 🔴 CRITICAL INCIDENTS

### A. Key Compromise (P0)

#### 🔍 Detection Signs
- Unauthorized transactions from dev wallet
- Unexpected program upgrades or authority changes
- Unknown addresses gaining permissions
- Unusual token movements or burns
- Alerts from monitoring systems

#### ⚡ Immediate Response (< 2 minutes)

**1. EMERGENCY SHUTDOWN**
```bash
# Stop all automated operations immediately
sudo systemctl stop burner-bot
sudo systemctl stop monitor

# Kill any running bot processes
pkill -f "burner_bot"
pkill -f "ts-node.*burner"
```

**2. ASSET PROTECTION**
```bash
# Check current SOL balance
solana balance

# Transfer remaining SOL to emergency wallet (if still controlled)
solana transfer $EMERGENCY_WALLET_ADDRESS ALL --from $COMPROMISED_WALLET

# Document the emergency transfer
echo "$(date): Emergency SOL transfer due to key compromise - TX: $TX_SIGNATURE" >> /var/log/emergency.log
```

**3. AUTHORITY REVOCATION** 
```bash
# Set program upgrade authority to null (IRREVERSIBLE!)
# Only do this if compromise is confirmed
solana program set-upgrade-authority $PROGRAM_ID --new-upgrade-authority null

# Log the action
echo "$(date): Program upgrade authority revoked due to compromise" >> /var/log/emergency.log
```

#### 🔧 Recovery Procedures (< 30 minutes)

**1. Generate New Keypairs**
```bash
# Generate new burner authority
solana-keygen new --outfile /secure/new-burner-authority.json

# Generate new dev wallet
solana-keygen new --outfile /secure/new-dev-wallet.json

# Backup old keys for investigation
mv ~/.config/solana/id.json /secure/compromised-$(date +%s).json
```

**2. Update System Configuration**
```bash
# Update environment variables
sed -i 's/BURNER_AUTHORITY_KEY=.*/BURNER_AUTHORITY_KEY='"$NEW_BURNER_KEY"'/' /home/ink/1000x/app/ts/.env

# Update systemd service files
sudo sed -i 's/Environment=BURNER_AUTHORITY_KEY=.*/Environment=BURNER_AUTHORITY_KEY='"$NEW_BURNER_KEY"'/' /etc/systemd/system/burner-bot.service

# Reload systemd
sudo systemctl daemon-reload
```

**3. Deploy Emergency Program** (if needed)
```bash
# Deploy new program with emergency fixes
cd /home/ink/1000x
anchor build
solana program deploy target/deploy/one_kx_hook.so --program-id $PROGRAM_ID --upgrade-authority $NEW_AUTHORITY
```

### B. Program Exploit Detected (P0)

#### 🔍 Detection Signs
- Unexpected token mints or burns
- Bypass of transfer fee mechanism
- Wallet cap violations
- Unusual transaction patterns
- Security researcher reports

#### ⚡ Immediate Response (< 5 minutes)

**1. DOCUMENT EXPLOIT**
```bash
# Create incident log
INCIDENT_ID="exploit-$(date +%s)"
mkdir -p /var/log/incidents/$INCIDENT_ID

# Gather transaction evidence
echo "Exploit detected at $(date)" > /var/log/incidents/$INCIDENT_ID/timeline.log
echo "Suspicious transactions:" >> /var/log/incidents/$INCIDENT_ID/timeline.log
```

**2. ASSESS IMPACT**
```bash
# Check total supply
solana-tokens supply $MINT_ADDRESS

# Check fee account balances
solana balance $FEE_ACCOUNT_ADDRESS

# Check withheld token amounts
ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
// Add script to check withheld tokens across all accounts
"
```

**3. PREPARE EMERGENCY UPGRADE**
```bash
# Switch to emergency branch with exploit fix
git checkout emergency-exploit-fix

# Quick build and test
anchor build
anchor test --skip-deploy

# Prepare deployment
solana program deploy target/deploy/one_kx_hook.so --program-id $PROGRAM_ID --upgrade-authority $UPGRADE_AUTHORITY --buffer
```

#### 🛠️ Recovery Procedures

**1. Deploy Fix**
```bash
# Deploy the emergency fix
solana program deploy $BUFFER_ADDRESS --program-id $PROGRAM_ID

# Verify fix deployment
solana program show $PROGRAM_ID
```

**2. Validate System**
```bash
# Run integration tests
npm run test:integration

# Check all components working
npm run health:check
```

---

## 🟡 HIGH PRIORITY INCIDENTS

### C. Burner Bot Complete Failure (P1)

#### 🔍 Detection Signs
- Service status shows stopped/failed
- Health check endpoint unreachable
- No burn transactions for > 2 hours
- Withheld fees accumulating rapidly
- Monitoring alerts firing

#### ⚡ Immediate Response (< 15 minutes)

**1. DIAGNOSE FAILURE**
```bash
# Check service status
sudo systemctl status burner-bot --no-pager -l

# Check recent logs for errors
sudo journalctl -u burner-bot -n 100 --no-pager

# Check resource usage
top -p $(pgrep -f burner_bot)
df -h /home/ink/1000x
free -h
```

**2. IDENTIFY ROOT CAUSE**
```bash
# Common failure reasons:
# Insufficient SOL balance
solana balance $BURNER_AUTHORITY_ADDRESS

# RPC connection issues
curl -X POST $RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}'

# Program account issues
solana account $PROGRAM_ID

# Environment issues
grep -v "^#" /home/ink/1000x/app/ts/.env | grep -v "^$"
```

**3. QUICK FIXES**

```bash
# SOL balance too low
if [ $(solana balance --lamports) -lt 10000000 ]; then
    echo "SOL balance critical - requesting airdrop"
    solana airdrop 1
fi

# Restart with clean state
sudo systemctl stop burner-bot
sudo systemctl reset-failed burner-bot
sudo systemctl start burner-bot
sudo systemctl status burner-bot
```

#### 🔧 Recovery Procedures

**1. Manual Operation Mode**
```bash
# If automatic restart fails, run manual burn cycle
cd /home/ink/1000x
ts-node app/ts/manual_burn.ts

# Monitor manual operation
tail -f /var/log/manual-burn.log
```

**2. Service Recovery**
```bash
# Clean restart process
sudo systemctl stop burner-bot
sudo journalctl --vacuum-time=1h  # Clean old logs
sudo systemctl daemon-reload
sudo systemctl start burner-bot

# Verify health
curl http://localhost:8080/health | jq
```

### D. Stuck Withheld Fees (P1)

#### 🔍 Detection Signs
- `withdrawWithheldTokensFromAccounts` failing repeatedly
- Large accumulation in fee accounts (> 1M tokens)
- Fee processing errors in logs
- User complaints about missing fee distributions

#### ⚡ Immediate Response (< 15 minutes)

**1. ASSESS ACCUMULATION**
```bash
# Check withheld fee balances across accounts
ts-node -e "
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAccount } from '@solana/spl-token';

async function checkWithheldFees() {
    const connection = new Connection(process.env.RPC_URL!);
    const mint = new PublicKey(process.env.MINT_ADDRESS!);
    
    // Get all token accounts for this mint
    const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        filters: [
            { dataSize: 182 }, // Token Account size
            { memcmp: { offset: 0, bytes: mint.toBase58() } }
        ]
    });
    
    console.log('Found', accounts.length, 'token accounts');
    
    for (const account of accounts) {
        const accountInfo = await getAccount(connection, account.pubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
        console.log('Account:', account.pubkey.toBase58(), 'Balance:', accountInfo.amount.toString());
    }
}

checkWithheldFees().catch(console.error);
" > /tmp/withheld_check.ts && ts-node /tmp/withheld_check.ts
```

**2. IDENTIFY PROBLEMATIC ACCOUNTS**
```bash
# Check burner bot logs for specific failing accounts
grep -i "withdrawWithheldTokens" /var/log/burner.log | tail -20

# Look for specific error patterns
grep -i "error.*withdraw" /var/log/burner.log | grep -o "[A-Za-z0-9]{32,}" | sort | uniq
```

**3. MANUAL WITHDRAWAL**
```bash
# Create manual withdrawal script
cat > /tmp/manual_withdraw.ts << 'EOF'
import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createWithdrawWithheldTokensFromAccountsInstruction } from "@solana/spl-token";
import bs58 from "bs58";

async function manualWithdraw() {
    const connection = new Connection(process.env.RPC_URL!);
    const mint = new PublicKey(process.env.MINT_ADDRESS!);
    const burnerAuthority = Keypair.fromSecretKey(bs58.decode(process.env.BURNER_AUTHORITY_KEY!));
    
    // Process in chunks to avoid transaction size limits
    const CHUNK_SIZE = 10;
    const problematicAccounts = [
        // Add specific account addresses here
        new PublicKey("ACCOUNT_1"),
        new PublicKey("ACCOUNT_2"),
    ];
    
    for (let i = 0; i < problematicAccounts.length; i += CHUNK_SIZE) {
        const chunk = problematicAccounts.slice(i, i + CHUNK_SIZE);
        
        const ix = createWithdrawWithheldTokensFromAccountsInstruction(
            mint,
            burnerAuthority.publicKey,
            [],
            chunk,
            TOKEN_2022_PROGRAM_ID
        );
        
        const tx = new Transaction().add(ix);
        const signature = await connection.sendTransaction(tx, [burnerAuthority]);
        console.log('Withdrawal TX:', signature);
        
        // Wait between chunks
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

manualWithdraw().catch(console.error);
EOF

# Run manual withdrawal
ts-node /tmp/manual_withdraw.ts
```

---

## 🟠 MONITORING ALERTS RESPONSE

### Alert: Burner Bot Service Down
```bash
# Response checklist:
1. Check service status: sudo systemctl status burner-bot
2. Check resource usage: htop, df -h
3. Check logs: sudo journalctl -u burner-bot -n 50
4. Restart if needed: sudo systemctl restart burner-bot
5. Verify recovery: curl http://localhost:8080/health
```

### Alert: SOL Balance Low (< 0.01 SOL)
```bash
# Response checklist:
1. Check current balance: solana balance
2. Request airdrop (devnet): solana airdrop 1
3. Transfer from backup wallet (mainnet): solana transfer $BURNER_ADDRESS 0.1 --from $BACKUP_WALLET
4. Update balance threshold if needed
5. Verify burner can continue: sudo systemctl status burner-bot
```

### Alert: High Error Rate
```bash
# Response checklist:
1. Check error patterns: grep -i error /var/log/burner.log | tail -20
2. Check RPC health: curl -X POST $RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
3. Check program status: solana account $PROGRAM_ID
4. Restart burner if errors persist: sudo systemctl restart burner-bot
5. Escalate if errors continue
```

### Alert: Withheld Tokens Accumulating
```bash
# Response checklist:
1. Check accumulation amount: [Run withheld fee check script]
2. Check burner processing: grep "withdraw" /var/log/burner.log | tail -10
3. Manual burn if needed: ts-node app/ts/manual_burn.ts
4. Check for stuck accounts: [Run problematic account identification]
5. Manual withdrawal if needed: [Use manual withdrawal script]
```

---

## 🛠️ RECOVERY PROCEDURES

### System Recovery Checklist

After any incident, verify all systems are healthy:

- [ ] **Service Status**: `sudo systemctl status burner-bot`
- [ ] **Health Check**: `curl http://localhost:8080/health | jq`
- [ ] **SOL Balance**: `solana balance` (> 0.01 SOL)
- [ ] **RPC Connection**: `curl -X POST $RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}'`
- [ ] **Program Status**: `solana account $PROGRAM_ID`
- [ ] **Recent Transactions**: Check last 10 transactions processed
- [ ] **Monitoring**: All alerts cleared
- [ ] **Logs**: No error patterns in recent logs

### Environment Validation
```bash
# Validate all required environment variables are set
cd /home/ink/1000x
cat > /tmp/env_check.sh << 'EOF'
#!/bin/bash
required_vars=(
    "RPC_URL"
    "MINT_ADDRESS" 
    "PROGRAM_ID"
    "BURNER_AUTHORITY_KEY"
    "DEV_WALLET_ADDRESS"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "ERROR: $var is not set"
        exit 1
    else
        echo "✓ $var is set"
    fi
done
echo "All environment variables validated"
EOF

chmod +x /tmp/env_check.sh && /tmp/env_check.sh
```

### Performance Validation
```bash
# Run performance test
cd /home/ink/1000x
npm run test:integration

# Check system resources
echo "=== System Resources ==="
echo "CPU Usage: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')"
echo "Memory Usage: $(free | grep Mem | awk '{printf("%.1f%%", $3/$2 * 100.0)}')"
echo "Disk Usage: $(df -h /home/ink/1000x | awk 'NR==2{print $5}')"
```

---

## 📞 COMMUNICATION PROTOCOLS

### Internal Communication

**Incident Declaration (< 2 minutes)**
```
INCIDENT ALERT - [P0/P1/P2/P3]
Title: [Brief description]
Status: INVESTIGATING
Impact: [User/System impact]
ETA: [Estimated resolution time]
Responder: [Primary responder name]
```

**Status Updates (Every 15 minutes for P0/P1)**
```
INCIDENT UPDATE - [Incident ID]
Status: [INVESTIGATING/IDENTIFIED/RESOLVING/RESOLVED]
Progress: [What has been done]
Next Steps: [What is being done next]
ETA: [Updated ETA]
```

**Resolution Notification**
```
INCIDENT RESOLVED - [Incident ID]
Duration: [Total incident time]
Root Cause: [Brief explanation]
Actions Taken: [Summary of resolution]
Follow-up: [Any ongoing monitoring/actions]
```

### External Communication

**User-Facing Issues (Within 30 minutes)**
- Update status page: [Status page URL]
- Twitter/Discord announcement if needed
- Documentation updates

**Partner Notification (Within 10 minutes for critical)**
- Email to exchange partners
- Notification to audit partners
- Regulatory reporting if required

---

## 🚨 EMERGENCY SCRIPTS

### Quick Health Check
```bash
#!/bin/bash
# Save as: /home/ink/1000x/scripts/quick_health.sh

echo "=== Quick Health Check ==="
echo "Time: $(date)"
echo ""

echo "1. Service Status:"
sudo systemctl is-active burner-bot && echo "✓ Service running" || echo "✗ Service down"

echo ""
echo "2. SOL Balance:"
balance=$(solana balance --lamports)
if [ $balance -gt 10000000 ]; then
    echo "✓ SOL balance adequate: $(echo "scale=4; $balance/1000000000" | bc) SOL"
else
    echo "⚠ SOL balance low: $(echo "scale=4; $balance/1000000000" | bc) SOL"
fi

echo ""
echo "3. RPC Connection:"
curl -s -X POST $RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' > /dev/null && echo "✓ RPC responsive" || echo "✗ RPC unresponsive"

echo ""
echo "4. Recent Errors:"
error_count=$(sudo journalctl -u burner-bot --since "5 minutes ago" | grep -i error | wc -l)
if [ $error_count -eq 0 ]; then
    echo "✓ No recent errors"
else
    echo "⚠ $error_count errors in last 5 minutes"
fi

echo ""
echo "=== Health Check Complete ==="
```

### Emergency Burn
```bash
#!/bin/bash
# Save as: /home/ink/1000x/scripts/emergency_burn.sh

echo "=== Emergency Manual Burn ==="
echo "Starting manual burn process..."

cd /home/ink/1000x

# Run manual burn
ts-node app/ts/manual_burn.ts

echo "Manual burn completed"
echo "Check logs: tail -f /var/log/manual-burn.log"
```

### Reset Service
```bash
#!/bin/bash
# Save as: /home/ink/1000x/scripts/reset_service.sh

echo "=== Emergency Service Reset ==="

# Stop service
sudo systemctl stop burner-bot

# Clear failed state
sudo systemctl reset-failed burner-bot

# Clean logs (keep last hour)
sudo journalctl --vacuum-time=1h

# Reload systemd
sudo systemctl daemon-reload

# Start service
sudo systemctl start burner-bot

# Check status
sleep 2
sudo systemctl status burner-bot --no-pager

echo "Service reset complete"
```

---

## 📋 POST-INCIDENT PROCEDURES

### Immediate (< 2 hours)

1. **Document Timeline**
   ```bash
   # Create incident report
   INCIDENT_ID="incident-$(date +%Y%m%d-%H%M%S)"
   mkdir -p /var/log/incidents/$INCIDENT_ID
   
   cat > /var/log/incidents/$INCIDENT_ID/report.md << EOF
   # Incident Report: $INCIDENT_ID
   
   ## Timeline
   - [Time] Initial detection
   - [Time] Response initiated
   - [Time] Root cause identified
   - [Time] Resolution implemented
   - [Time] Full recovery confirmed
   
   ## Impact
   - Users affected: [Number]
   - Duration: [Time]
   - Financial impact: [Amount]
   
   ## Root Cause
   [Detailed explanation]
   
   ## Resolution
   [Steps taken to resolve]
   
   ## Prevention
   [What will prevent recurrence]
   EOF
   ```

2. **Collect Evidence**
   ```bash
   # Gather logs
   sudo journalctl -u burner-bot --since "2 hours ago" > /var/log/incidents/$INCIDENT_ID/service.log
   
   # Gather transaction data
   solana transaction-history $BURNER_ADDRESS --limit 50 > /var/log/incidents/$INCIDENT_ID/transactions.log
   
   # System state
   df -h > /var/log/incidents/$INCIDENT_ID/disk.log
   free -h > /var/log/incidents/$INCIDENT_ID/memory.log
   ps aux > /var/log/incidents/$INCIDENT_ID/processes.log
   ```

### Short-term (< 24 hours)

1. **Root Cause Analysis**
   - Technical analysis of failure
   - Timeline reconstruction
   - Impact assessment
   - Contributing factors

2. **Immediate Fixes**
   - Code fixes if needed
   - Configuration updates
   - Monitoring improvements
   - Alert threshold adjustments

3. **Team Post-mortem**
   - What went well
   - What went wrong
   - Action items
   - Process improvements

### Long-term (< 1 week)

1. **System Improvements**
   - Architecture changes
   - Redundancy improvements
   - Monitoring enhancements
   - Documentation updates

2. **Process Updates**
   - Runbook improvements
   - Training updates
   - Testing procedures
   - Incident drills

---

## 🧪 TESTING PROCEDURES

### Monthly Incident Response Drill

**Preparation**
- Schedule drill with team
- Prepare test scenarios
- Set up isolated test environment
- Notify stakeholders

**Drill Scenarios**
1. **Key Compromise Simulation**
   - Practice key rotation
   - Test communication protocols
   - Verify backup procedures

2. **Service Failure Simulation**
   - Stop burner service
   - Practice diagnostic procedures
   - Test recovery scripts

3. **Communication Drill**
   - Practice incident notifications
   - Test escalation procedures
   - Review external communications

**Post-Drill Review**
- Response time analysis
- Procedure effectiveness
- Communication clarity
- Improvement opportunities

### Runbook Validation

**Weekly Checklist**
- [ ] Verify all contact information is current
- [ ] Test emergency scripts functionality
- [ ] Validate environment configurations
- [ ] Review and update procedures
- [ ] Check monitoring alert thresholds

---

## 📚 REFERENCE INFORMATION

### Key Addresses
```bash
# Environment-specific addresses (update per deployment)
PROGRAM_ID="HookLdnPWxLiV9KWJqwFkgFoXCjhFnNK8EYXCEqzh2Nk"
MINT_ADDRESS="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
DEV_WALLET_ADDRESS="DevWallet1111111111111111111111111111111111"
BURNER_AUTHORITY_ADDRESS="BurnerAuth1111111111111111111111111111111"
```

### Important File Locations
```bash
# Service files
/etc/systemd/system/burner-bot.service

# Configuration
/home/ink/1000x/app/ts/.env

# Logs
/var/log/burner.log
/var/log/burner-bot-monitor.log
/var/log/burner-bot-alerts.log

# Scripts
/home/ink/1000x/scripts/
/home/ink/1000x/ops/
```

### Useful Commands Reference
```bash
# Service management
sudo systemctl start|stop|restart|status burner-bot
sudo journalctl -u burner-bot -f

# Solana operations
solana balance [address]
solana account [address]
solana transaction-history [address]
solana program show [program-id]

# Health and monitoring
curl http://localhost:8080/health
ts-node ops/healthcheck.ts
npm run test:integration

# Emergency operations
ts-node app/ts/manual_burn.ts
npm run distribute-fees
```

---

## 📝 VERSION HISTORY

- **v2.0** (2025-08-20): Comprehensive runbook enhancement with detailed procedures
- **v1.0** (2025-08-18): Initial runbook creation

---

## 📞 EMERGENCY CONTACT CARD

**Print and keep accessible:**

```
┌─────────────────────────────────────────┐
│           🚨 EMERGENCY CONTACTS          │
├─────────────────────────────────────────┤
│ Primary Dev: [PHONE] [EMAIL]            │
│ Ops Team: [PHONE] [EMAIL]               │
│ Security: [PHONE] [EMAIL]               │
├─────────────────────────────────────────┤
│          EMERGENCY PROCEDURES            │
├─────────────────────────────────────────┤
│ 1. Stop burner: sudo systemctl stop     │
│    burner-bot                           │
│ 2. Quick health: ./scripts/quick_health  │
│ 3. Emergency burn: ./scripts/emergency_  │
│    burn.sh                              │
│ 4. Reset service: ./scripts/reset_      │
│    service.sh                           │
└─────────────────────────────────────────┘
```

**Remember: Stay calm, follow procedures, document everything.**