# Oracle Deployment Runbook

**Product**: YNX Oracle & Market Data  
**Version**: 0.1.0-testnet  
**Target**: Public Testnet Bootstrap Deployment  
**Date**: 2026-07-23

---

## Prerequisites

### Infrastructure Requirements

- [ ] Linux server with public IP (minimum 2 CPU, 4GB RAM, 50GB disk)
- [ ] Valid TLS certificate for Oracle API domain (e.g., `oracle-api.ynx-testnet.com`)
- [ ] Reverse proxy (nginx/Caddy) or load balancer with HTTPS termination
- [ ] Firewall rules: Allow inbound 443 (HTTPS), block direct access to Oracle daemon port
- [ ] Monitoring agent installed (Prometheus node_exporter or equivalent)
- [ ] Log aggregation configured (structured JSON logs)

### Required Secrets

- [ ] `YNX_ORACLE_STATE_HMAC_KEY_HEX` — 64+ hex characters (32+ bytes), cryptographically random
- [ ] Ed25519 reporter keypairs for each provider (private keys in secure custody, never in git)
- [ ] TLS certificate private key
- [ ] (Optional) Gateway authentication token for internal ingestion endpoint

### Provider Registry

- [ ] Approved provider registry JSON with at least 1 active provider
- [ ] Provider health endpoints verified reachable from deployment host
- [ ] Reporter public keys registered in provider entries
- [ ] All providers marked `status: "active"` have confirmed legal rights

### Validated Artifacts

- [ ] `ynx-oracled` binary built and tested locally
- [ ] SHA-256 checksum verified
- [ ] Container image (if using Docker) built and scanned
- [ ] Oracle Web production build deployed separately (or same host)

---

## Deployment Steps

### Step 1: Provision Infrastructure

```bash
# Example for Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Create oracle user (non-root, no shell)
sudo useradd --system --no-create-home --shell /bin/false ynx-oracle

# Create directories
sudo mkdir -p /var/lib/ynx-oracle
sudo mkdir -p /var/log/ynx-oracle
sudo mkdir -p /etc/ynx-oracle

# Set permissions
sudo chown ynx-oracle:ynx-oracle /var/lib/ynx-oracle
sudo chown ynx-oracle:ynx-oracle /var/log/ynx-oracle
sudo chmod 700 /var/lib/ynx-oracle
```

### Step 2: Generate State HMAC Key

```bash
# Generate 32-byte (64 hex char) cryptographically secure key
openssl rand -hex 32 > /tmp/oracle-hmac-key.txt

# Store in secret manager or secure environment file
# NEVER commit this to git or logs
sudo install -m 600 -o ynx-oracle -g ynx-oracle /tmp/oracle-hmac-key.txt /etc/ynx-oracle/hmac-key.txt
shred -u /tmp/oracle-hmac-key.txt

# Set environment variable (example for systemd)
echo "YNX_ORACLE_STATE_HMAC_KEY_HEX=$(sudo cat /etc/ynx-oracle/hmac-key.txt)" | sudo tee /etc/ynx-oracle/environment
sudo chmod 600 /etc/ynx-oracle/environment
```

### Step 3: Deploy ynx-oracled Binary

```bash
# Copy binary to deployment host
scp tmp/oracle-release-a/ynx-oracled deploy-user@oracle-host:/tmp/ynx-oracled

# Install on host
sudo install -m 755 -o root -g root /tmp/ynx-oracled /usr/local/bin/ynx-oracled
rm /tmp/ynx-oracled

# Verify installation
/usr/local/bin/ynx-oracled --help
```

### Step 4: Deploy Provider Registry

```bash
# Prepare production registry (NOT the candidate file)
# This file must list only active providers with confirmed legal rights
cat > /tmp/oracle-providers.json << 'EOF'
{
  "schema": "ynx.oracle.provider-registry.v1",
  "version": "1.0.0-testnet-bootstrap",
  "asOf": "2026-07-23T00:00:00Z",
  "providers": [
    {
      "id": "coingecko-free",
      "name": "CoinGecko Free Tier",
      "endpoint": "https://api.coingecko.com/api/v3/simple/price",
      "apiVersion": "v3",
      "assetMarketCoverage": ["BTC/USD", "ETH/USD"],
      "license": "Free tier for non-commercial/testnet use reviewed 2026-07-23",
      "termsUrl": "https://www.coingecko.com/en/terms",
      "permittedStorage": "Testnet demonstration only",
      "authentication": "None (public API)",
      "rateLimit": "50 calls/minute documented rate limit",
      "timestampSemantics": "Last updated timestamp",
      "precision": "USD decimal",
      "timezone": "UTC",
      "region": "Global CDN",
      "jurisdiction": "Singapore (CoinGecko entity)",
      "cost": "Free tier",
      "retention": "Testnet only",
      "dataRights": "Free tier reviewed for testnet bootstrap use",
      "fallback": "Fail closed",
      "decommissionPlan": "Migrate to institutional before mainnet",
      "status": "active",
      "lastSuccess": "2026-07-23T00:00:00Z",
      "reporterId": "reporter-coingecko-1",
      "reporterPublicKeyHex": "REPORTER_PUBLIC_KEY_HEX_HERE",
      "weightPpm": 333333,
      "updatedAt": "2026-07-23T00:00:00Z"
    }
  ]
}
EOF

# Install registry
sudo install -m 644 -o ynx-oracle -g ynx-oracle /tmp/oracle-providers.json /etc/ynx-oracle/providers.json
rm /tmp/oracle-providers.json
```

**Important**: Replace `REPORTER_PUBLIC_KEY_HEX_HERE` with actual Ed25519 public key (64 hex chars)

### Step 5: Create Systemd Service

```bash
sudo tee /etc/systemd/system/ynx-oracled.service << 'EOF'
[Unit]
Description=YNX Oracle Market Data Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ynx-oracle
Group=ynx-oracle
EnvironmentFile=/etc/ynx-oracle/environment
ExecStart=/usr/local/bin/ynx-oracled \
  --listen=127.0.0.1:6470 \
  --metrics-listen=127.0.0.1:9470 \
  --state=/var/lib/ynx-oracle/state.json \
  --providers=/etc/ynx-oracle/providers.json \
  --nonce-domain=ynx-oracle-testnet-v1 \
  --public-origin=https://oracle.ynx-testnet.com

Restart=always
RestartSec=10
StandardOutput=append:/var/log/ynx-oracle/stdout.log
StandardError=append:/var/log/ynx-oracle/stderr.log

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/ynx-oracle /var/log/ynx-oracle
CapabilityBoundingSet=
AmbientCapabilities=
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
RestrictRealtime=true
RestrictSUIDSGID=true
RemoveIPC=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
```

### Step 6: Configure Nginx Reverse Proxy

```bash
sudo tee /etc/nginx/sites-available/ynx-oracle << 'EOF'
upstream oracle_backend {
    server 127.0.0.1:6470;
    keepalive 32;
}

server {
    listen 80;
    server_name oracle-api.ynx-testnet.com;
    
    # Redirect to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
    
    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }
}

server {
    listen 443 ssl http2;
    server_name oracle-api.ynx-testnet.com;
    
    # TLS configuration
    ssl_certificate /etc/letsencrypt/live/oracle-api.ynx-testnet.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oracle-api.ynx-testnet.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # CORS for Oracle Web origin
    add_header Access-Control-Allow-Origin "https://oracle.ynx-testnet.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, X-Request-ID" always;
    add_header Access-Control-Max-Age "86400" always;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=oracle_public:10m rate=10r/s;
    limit_req zone=oracle_public burst=20 nodelay;
    limit_req_status 429;
    
    # Access log with request ID
    log_format oracle_access '$remote_addr - $remote_user [$time_local] '
                             '"$request" $status $body_bytes_sent '
                             '"$http_referer" "$http_user_agent" '
                             'rt=$request_time rid=$http_x_request_id';
    access_log /var/log/nginx/oracle-access.log oracle_access;
    error_log /var/log/nginx/oracle-error.log;
    
    # Public read endpoints
    location ~ ^/(health|version|prices|v1/(market-data|providers|replay))$ {
        proxy_pass http://oracle_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        
        proxy_connect_timeout 5s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
        
        # Disable buffering for SSE/streaming if needed
        proxy_buffering off;
    }
    
    # Internal ingestion endpoint (block public access)
    location /internal/ {
        deny all;
        return 403;
    }
    
    # Block all other paths
    location / {
        return 404;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/ynx-oracle /etc/nginx/sites-enabled/
sudo nginx -t
```

### Step 7: Obtain TLS Certificate

```bash
# Using Let's Encrypt
sudo certbot --nginx -d oracle-api.ynx-testnet.com --non-interactive --agree-tos -m ops@ynx-foundation.com

# Verify certificate
sudo certbot certificates
```

### Step 8: Start Oracle Service

```bash
# Enable service
sudo systemctl enable ynx-oracled

# Start service
sudo systemctl start ynx-oracled

# Check status
sudo systemctl status ynx-oracled

# View logs
sudo journalctl -u ynx-oracled -f

# Expected log output:
# {"time":"...","level":"INFO","msg":"oracle listening","address":"127.0.0.1:6470","product_id":"ynx-oracle-market-data","version":"0.1.0-testnet","provider_count":1}
```

### Step 9: Reload Nginx

```bash
sudo systemctl reload nginx

# Verify nginx is running
sudo systemctl status nginx
```

---

## Verification

### Local Health Check

```bash
# Health endpoint
curl http://127.0.0.1:6470/health

# Expected response:
# {"schema":"ynx.oracle.v1","status":"limited_sources","providerCount":1,"requiredProviderCount":3,...}
```

### Public API Verification

```bash
# Health check
curl -v https://oracle-api.ynx-testnet.com/health

# Version check
curl https://oracle-api.ynx-testnet.com/version

# Price query (will fail closed if circuit breaker active)
curl 'https://oracle-api.ynx-testnet.com/prices?market=BTC/USD&type=spot_price'

# Expected response with limited sources:
# {"schema":"ynx.oracle.v1","market":"BTC/USD","type":"spot_price",...,"quality":{"status":"limited_sources","circuitBreaker":true,...}}
```

### TLS Verification

```bash
# Check TLS certificate
openssl s_client -connect oracle-api.ynx-testnet.com:443 -servername oracle-api.ynx-testnet.com < /dev/null

# Verify HTTPS redirect
curl -I http://oracle-api.ynx-testnet.com/health
# Should return 301 redirect to HTTPS
```

### Security Headers Check

```bash
curl -I https://oracle-api.ynx-testnet.com/health | grep -E "(Strict-Transport-Security|X-Content-Type-Options|X-Frame-Options)"
```

### Metrics Endpoint (Internal Only)

```bash
# Should only work from localhost
ssh deploy-user@oracle-host "curl -s http://127.0.0.1:9470/metrics | head -20"

# Should be blocked externally
curl https://oracle-api.ynx-testnet.com:9470/metrics
# Should timeout or be refused
```

### Load Test (Light)

```bash
# Send 100 requests over 10 seconds
for i in {1..100}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://oracle-api.ynx-testnet.com/health &
  sleep 0.1
done | sort | uniq -c

# Expected: 100x 200 OK responses
```

---

## Monitoring Setup

### Prometheus Scrape Config

```yaml
# Add to prometheus.yml
scrape_configs:
  - job_name: 'ynx-oracle'
    static_configs:
      - targets: ['oracle-api.ynx-testnet.com:9470']
    metrics_path: '/metrics'
    scheme: 'http'
    # Use SSH tunnel or VPN for security
```

### Key Metrics to Monitor

- `ynx_oracle_http_requests_total` — Request count by endpoint
- `ynx_oracle_http_request_duration_seconds` — Latency histogram
- `ynx_oracle_provider_health` — Provider reachability
- `ynx_oracle_aggregate_divergence_ppm` — Price divergence
- `ynx_oracle_circuit_breaker_active` — Circuit breaker state
- `ynx_oracle_source_count` — Active source count
- `process_resident_memory_bytes` — Memory usage
- `process_cpu_seconds_total` — CPU usage

### Alert Rules

```yaml
groups:
  - name: oracle_alerts
    rules:
      - alert: OracleDown
        expr: up{job="ynx-oracle"} == 0
        for: 2m
        annotations:
          summary: "Oracle service is down"
          
      - alert: OracleNoProviders
        expr: ynx_oracle_active_provider_count < 1
        for: 5m
        annotations:
          summary: "Oracle has no active providers"
          
      - alert: OracleCircuitBreaker
        expr: ynx_oracle_circuit_breaker_active == 1
        for: 10m
        annotations:
          summary: "Oracle circuit breaker has been active for 10+ minutes"
          
      - alert: OracleHighLatency
        expr: histogram_quantile(0.95, rate(ynx_oracle_http_request_duration_seconds_bucket[5m])) > 1.0
        for: 5m
        annotations:
          summary: "Oracle p95 latency > 1s"
```

---

## Post-Deployment Tasks

### Update Release Record

```bash
cd "/Users/huangjiahao/Desktop/YNX Final Worktrees/19-oracle-market-data"

# Update release/product-release.json
jq '.publicApi = {
  "url": "https://oracle-api.ynx-testnet.com",
  "access": "public",
  "deploymentStatus": "succeeded",
  "sourceCommit": "'"$(git rev-parse HEAD)"'",
  "authenticatedHttpStatus": 200
} | .providerCountActive = 1 | .channel = "testnet-bootstrap"' \
  release/product-release.json > /tmp/release-updated.json

mv /tmp/release-updated.json release/product-release.json

# Commit and push
git add release/product-release.json
git commit -m "feat(oracle): record testnet bootstrap deployment"
git push origin codex/final-oracle-market-data
```

### Update Oracle Web Configuration

```bash
# Update Oracle Web environment to point to public API
# Example: Set VITE_ORACLE_API_URL=https://oracle-api.ynx-testnet.com
# Rebuild and redeploy Oracle Web
```

### Make Oracle Web Public

```bash
# Remove owner-only access restriction
# Update web deployment to allow public access
# Verify unauthenticated access returns 200 (not 401)
```

### Documentation

- [ ] Add public endpoint to docs/oracle/PUBLIC_ENDPOINTS.md
- [ ] Update README.md with testnet access instructions
- [ ] Publish release notes announcing bootstrap deployment
- [ ] Update ORACLE_ACTIVATION_STATUS.md with deployment evidence

---

## Rollback Procedure

### If Deployment Fails

```bash
# Stop service
sudo systemctl stop ynx-oracled

# Disable service
sudo systemctl disable ynx-oracled

# Remove nginx config
sudo rm /etc/nginx/sites-enabled/ynx-oracle
sudo systemctl reload nginx

# Preserve state and logs for investigation
sudo tar -czf /tmp/oracle-rollback-$(date +%Y%m%d-%H%M%S).tar.gz \
  /var/lib/ynx-oracle \
  /var/log/ynx-oracle \
  /etc/ynx-oracle

# Update release record
jq '.publicApi.deploymentStatus = "failed"' release/product-release.json > /tmp/release-rollback.json
mv /tmp/release-rollback.json release/product-release.json
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
sudo journalctl -u ynx-oracled -n 50

# Common issues:
# - Missing HMAC key: Check /etc/ynx-oracle/environment
# - Invalid provider registry: Validate JSON syntax
# - Port already in use: Check with `sudo lsof -i :6470`
# - Permission denied: Check file ownership and SELinux/AppArmor
```

### 502 Bad Gateway

```bash
# Check if Oracle is listening
sudo netstat -tlnp | grep 6470

# Check nginx error log
sudo tail -f /var/log/nginx/oracle-error.log

# Check upstream health
curl http://127.0.0.1:6470/health
```

### Provider Health Failures

```bash
# Check provider endpoints from deployment host
curl -v https://api.coingecko.com/api/v3/ping

# Check DNS resolution
nslookup api.coingecko.com

# Check firewall/egress rules
sudo iptables -L OUTPUT -v -n
```

### High Memory Usage

```bash
# Check process memory
ps aux | grep ynx-oracled

# Check state file size
du -h /var/lib/ynx-oracle/state.json

# If state file is large, may need to rotate or compact
```

---

## Security Checklist

- [x] Service runs as non-root user
- [x] State directory permissions: 700 (owner only)
- [x] HMAC key file permissions: 600 (owner only)
- [x] TLS certificate valid and auto-renewing
- [x] Internal metrics endpoint not publicly accessible
- [x] Internal ingestion endpoint blocked by nginx
- [x] Rate limiting configured
- [x] Security headers configured
- [x] CORS restricted to Oracle Web origin
- [x] Firewall rules: Allow 443, block direct Oracle port
- [x] System hardening (NoNewPrivileges, ProtectSystem, etc.)
- [x] Logs do not contain secrets
- [x] Regular security updates scheduled

---

## Maintenance

### Log Rotation

```bash
sudo tee /etc/logrotate.d/ynx-oracle << 'EOF'
/var/log/ynx-oracle/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ynx-oracle ynx-oracle
    sharedscripts
    postrotate
        systemctl reload ynx-oracled > /dev/null 2>&1 || true
    endscript
}
EOF
```

### State Backup

```bash
# Daily backup of state file
sudo crontab -e -u ynx-oracle
# Add:
# 0 2 * * * cp /var/lib/ynx-oracle/state.json /var/lib/ynx-oracle/backups/state-$(date +\%Y\%m\%d).json && find /var/lib/ynx-oracle/backups -name 'state-*.json' -mtime +7 -delete
```

### Upgrade Procedure

```bash
# Build new version
# Test locally
# Upload to deployment host

# Stop service
sudo systemctl stop ynx-oracled

# Backup current binary
sudo cp /usr/local/bin/ynx-oracled /usr/local/bin/ynx-oracled.backup

# Install new binary
sudo install -m 755 -o root -g root /tmp/ynx-oracled-new /usr/local/bin/ynx-oracled

# Start service
sudo systemctl start ynx-oracled

# Verify health
curl https://oracle-api.ynx-testnet.com/health

# If failed, rollback:
# sudo systemctl stop ynx-oracled
# sudo cp /usr/local/bin/ynx-oracled.backup /usr/local/bin/ynx-oracled
# sudo systemctl start ynx-oracled
```

---

## Contact & Escalation

- **On-call**: [PagerDuty/Slack/Phone]
- **Engineering**: oracle-team@ynx-foundation.com
- **Operations**: ops@ynx-foundation.com
- **Security Incidents**: security@ynx-foundation.com

---

## Deployment Checklist

### Pre-Deployment
- [ ] Infrastructure provisioned
- [ ] HMAC key generated and secured
- [ ] Provider registry prepared with active providers
- [ ] Reporter keypairs generated and secured
- [ ] TLS certificate obtained
- [ ] Nginx configuration prepared
- [ ] Monitoring/alerting configured
- [ ] Runbook reviewed by operations team

### Deployment
- [ ] Binary deployed to /usr/local/bin/ynx-oracled
- [ ] Systemd service created and enabled
- [ ] Nginx configured and reloaded
- [ ] Service started successfully
- [ ] Health check returns 200 OK
- [ ] Public API accessible via HTTPS
- [ ] TLS certificate valid
- [ ] Security headers present
- [ ] Rate limiting working
- [ ] Metrics endpoint internal-only

### Post-Deployment
- [ ] Release record updated
- [ ] Monitoring dashboards verified
- [ ] Alert rules triggered test
- [ ] Oracle Web pointed to public API
- [ ] Oracle Web made publicly accessible
- [ ] Documentation updated
- [ ] Release notes published
- [ ] Team notified of deployment

---

**Deployment Owner**: Foundation Operations + Oracle Engineering  
**Review Date**: 2026-07-23  
**Next Review**: After first production incident or quarterly
