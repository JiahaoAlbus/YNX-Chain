#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib.sh
source scripts/deploy/lib.sh

ynx_load_env

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-}}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-${SERVER_USER:-}}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-}}"
SG_NODE_HOST="${SG_NODE_HOST:-43.134.23.58}"
SILICON_VALLEY_NODE_HOST="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
SEOUL_NODE_HOST="${SEOUL_NODE_HOST:-43.164.132.81}"
YNX_VALIDATOR_SET="${YNX_VALIDATOR_SET:-ynx_validator_primary|ynx-primary|${PRIMARY_NODE_HOST}|primary validator|primary-${PRIMARY_NODE_HOST};ynx_validator_singapore|ynx-singapore|${SG_NODE_HOST}|bonded validator / recovery node|sg-${SG_NODE_HOST};ynx_validator_silicon_valley|ynx-silicon-valley|${SILICON_VALLEY_NODE_HOST}|bonded validator|sv-${SILICON_VALLEY_NODE_HOST};ynx_validator_seoul|ynx-seoul|${SEOUL_NODE_HOST}|bonded validator / read replica candidate|seoul-${SEOUL_NODE_HOST}}"
YNX_EXPECTED_VALIDATOR_COUNT="${YNX_EXPECTED_VALIDATOR_COUNT:-4}"

required=(
  TESTNET_DOMAIN WEBSITE_DOMAIN EXPLORER_DOMAIN RPC_DOMAIN EVM_RPC_DOMAIN
  FAUCET_DOMAIN API_DOMAIN AI_GATEWAY_DOMAIN TRUST_API_DOMAIN PAY_API_DOMAIN IDE_DOMAIN
  SERVER_HOST SERVER_USER SSH_KEY_PATH DEPLOY_TARGET CHAIN_ID CHAIN_NAME
  NATIVE_COIN_NAME NATIVE_SYMBOL GENESIS_VALIDATOR_NAME VALIDATOR_KEY_PATH
  FAUCET_PRIVATE_KEY DEPLOYER_PRIVATE_KEY TREASURY_ADDRESS FOUNDATION_ADDRESS
  TEAM_VESTING_ADDRESS POSTGRES_URL REDIS_URL WEBHOOK_SECRET JWT_SECRET
  SESSION_SECRET RATE_LIMIT_SECRET PAY_MERCHANT_SECRET TRUST_REPORT_SIGNING_KEY
  OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY
  OPENAI_API_KEY AI_MODEL_NAME EMAIL_PROVIDER EMAIL_API_KEY MONITORING_ADMIN_PASSWORD
  BACKUP_STORAGE_PATH SSL_EMAIL NGINX_SERVER_NAME GITHUB_REPO_TOKEN
  PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY SG_NODE_HOST
  SILICON_VALLEY_NODE_HOST SEOUL_NODE_HOST YNX_VALIDATOR_SET YNX_EXPECTED_VALIDATOR_COUNT
)
ynx_require_env "${required[@]}"
ynx_reject_unsafe_env_values "${required[@]}"
[[ "$NATIVE_SYMBOL" == "YNXT" ]] || { echo "NATIVE_SYMBOL must be YNXT"; exit 1; }
[[ "$NATIVE_COIN_NAME" == "YNXT" ]] || { echo "NATIVE_COIN_NAME must be YNXT"; exit 1; }
[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || { echo "CHAIN_ID must be numeric"; exit 1; }

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${commit}"
work="tmp/deploy/${release}"
rm -rf "$work"
mkdir -p "$work/bin" "$work/config" "$work/systemd" "$work/nginx" "$work/docs"

echo "building YNX Chain binary for linux/amd64"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$work/bin/ynx-chaind" ./cmd/ynx-chaind
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$work/bin/ynx-indexerd" ./cmd/ynx-indexerd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$work/bin/ynx-explorerd" ./cmd/ynx-explorerd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$work/bin/ynx-faucetd" ./cmd/ynx-faucetd

ynx_write_kv_env "$work/config/ynx-chaind.env" \
  CHAIN_ID CHAIN_NAME NATIVE_COIN_NAME NATIVE_SYMBOL TESTNET_DOMAIN RPC_DOMAIN EVM_RPC_DOMAIN \
  FAUCET_DOMAIN API_DOMAIN AI_GATEWAY_DOMAIN TRUST_API_DOMAIN PAY_API_DOMAIN IDE_DOMAIN \
  GENESIS_VALIDATOR_NAME TREASURY_ADDRESS FOUNDATION_ADDRESS TEAM_VESTING_ADDRESS \
  POSTGRES_URL REDIS_URL WEBHOOK_SECRET JWT_SECRET SESSION_SECRET RATE_LIMIT_SECRET \
  PAY_MERCHANT_SECRET TRUST_REPORT_SIGNING_KEY OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET \
  OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY OPENAI_API_KEY AI_MODEL_NAME \
  EMAIL_PROVIDER EMAIL_API_KEY MONITORING_ADMIN_PASSWORD BACKUP_STORAGE_PATH GITHUB_REPO_TOKEN \
  PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY SG_NODE_HOST SILICON_VALLEY_NODE_HOST SEOUL_NODE_HOST YNX_VALIDATOR_SET YNX_EXPECTED_VALIDATOR_COUNT
cat >> "$work/config/ynx-chaind.env" <<EOF
YNX_NETWORK=testnet
YNX_HTTP_ADDR=127.0.0.1:6420
YNX_DATA_DIR=/var/lib/ynx-chain/testnet
YNX_BLOCK_INTERVAL=2s
YNX_INDEXER_RPC_URL=http://127.0.0.1:6420
YNX_INDEXER_HTTP_ADDR=127.0.0.1:6426
YNX_INDEXER_DB_PATH=/var/lib/ynx-chain/indexer/indexer-db.json
YNX_INDEXER_POLL_INTERVAL=2s
YNX_EXPLORER_RPC_URL=http://127.0.0.1:6420
YNX_EXPLORER_INDEXER_URL=http://127.0.0.1:6426
YNX_EXPLORER_HTTP_ADDR=127.0.0.1:6427
YNX_EXPLORER_PUBLIC_RPC_URL=https://${RPC_DOMAIN}
YNX_EXPLORER_PUBLIC_URL=https://${EXPLORER_DOMAIN}
YNX_FAUCET_RPC_URL=http://127.0.0.1:6420
YNX_FAUCET_HTTP_ADDR=127.0.0.1:6428
YNX_FAUCET_REQUEST_LOG=/var/log/ynx-chain/faucet-requests.jsonl
YNX_FAUCET_DEFAULT_AMOUNT=100
YNX_FAUCET_MAX_AMOUNT=100
YNX_FAUCET_RATE_LIMIT_WINDOW=1h
YNX_FAUCET_RATE_LIMIT_MAX=1
EOF

cat > "$work/systemd/ynx-chaind.service" <<'EOF'
[Unit]
Description=YNX Chain testnet node and public API
After=network-online.target
Wants=network-online.target

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
ExecStart=/usr/local/bin/ynx-chaind
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ynx-chain /var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cat > "$work/systemd/ynx-indexerd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet indexer
After=network-online.target ynx-chaind.service
Wants=network-online.target ynx-chaind.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
ExecStart=/usr/local/bin/ynx-indexerd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ynx-chain /var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cat > "$work/systemd/ynx-explorerd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet explorer
After=network-online.target ynx-chaind.service ynx-indexerd.service
Wants=network-online.target ynx-chaind.service ynx-indexerd.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
ExecStart=/usr/local/bin/ynx-explorerd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ynx-chain /var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cat > "$work/systemd/ynx-faucetd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet faucet
After=network-online.target ynx-chaind.service
Wants=network-online.target ynx-chaind.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
ExecStart=/usr/local/bin/ynx-faucetd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ynx-chain /var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cat > "$work/nginx/ynx-chain.conf" <<EOF
server {
  listen 80;
  server_name ${EXPLORER_DOMAIN};
  client_max_body_size 2m;
  location / {
    proxy_pass http://127.0.0.1:6427;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${FAUCET_DOMAIN};
  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:6428;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${NGINX_SERVER_NAME} ${RPC_DOMAIN} ${EVM_RPC_DOMAIN} ${API_DOMAIN} ${FAUCET_DOMAIN} ${AI_GATEWAY_DOMAIN} ${TRUST_API_DOMAIN} ${PAY_API_DOMAIN} ${IDE_DOMAIN};
  client_max_body_size 2m;
  location / {
    proxy_pass http://127.0.0.1:6420;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location /indexer/ {
    rewrite ^/indexer/(.*)\$ /\$1 break;
    proxy_pass http://127.0.0.1:6426;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location /explorer/ {
    rewrite ^/explorer/(.*)\$ /\$1 break;
    proxy_pass http://127.0.0.1:6427;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

cp README.md REQUIRED_INPUTS.md ENV_INTAKE_FORM.md "$work/docs/"
tarball="tmp/deploy/${release}.tar.gz"
tar -C "$work" -czf "$tarball" .
sha256sum "$tarball" > "${tarball}.sha256" 2>/dev/null || shasum -a 256 "$tarball" > "${tarball}.sha256"

echo "release bundle: $tarball"
echo "release checksum: $(cat "${tarball}.sha256")"

remote_release="/tmp/${release}.tar.gz"
remote_dir="/opt/ynx-chain/releases/${release}"
ynx_scp "$tarball" "$remote_release"
ynx_ssh "id -u ynx >/dev/null 2>&1 || sudo useradd --system --home /var/lib/ynx-chain --shell /usr/sbin/nologin ynx"
ynx_ssh "sudo install -d -o root -g root /opt/ynx-chain/releases /etc/ynx /usr/local/bin && sudo install -d -o ynx -g ynx /var/lib/ynx-chain/testnet /var/lib/ynx-chain/indexer /var/log/ynx-chain"
ynx_ssh "sudo rm -rf '$remote_dir' && sudo mkdir -p '$remote_dir' && sudo tar -xzf '$remote_release' -C '$remote_dir'"
ynx_ssh "sudo install -m 0755 '$remote_dir/bin/ynx-chaind' /usr/local/bin/ynx-chaind"
ynx_ssh "sudo install -m 0755 '$remote_dir/bin/ynx-indexerd' /usr/local/bin/ynx-indexerd"
ynx_ssh "sudo install -m 0755 '$remote_dir/bin/ynx-explorerd' /usr/local/bin/ynx-explorerd"
ynx_ssh "sudo install -m 0755 '$remote_dir/bin/ynx-faucetd' /usr/local/bin/ynx-faucetd"
ynx_ssh "sudo install -m 0600 '$remote_dir/config/ynx-chaind.env' /etc/ynx/ynx-chaind.env"
ynx_ssh "sudo install -m 0644 '$remote_dir/systemd/ynx-chaind.service' /etc/systemd/system/ynx-chaind.service"
ynx_ssh "sudo install -m 0644 '$remote_dir/systemd/ynx-indexerd.service' /etc/systemd/system/ynx-indexerd.service"
ynx_ssh "sudo install -m 0644 '$remote_dir/systemd/ynx-explorerd.service' /etc/systemd/system/ynx-explorerd.service"
ynx_ssh "sudo install -m 0644 '$remote_dir/systemd/ynx-faucetd.service' /etc/systemd/system/ynx-faucetd.service"
ynx_ssh "if command -v nginx >/dev/null 2>&1; then sudo install -m 0644 '$remote_dir/nginx/ynx-chain.conf' /etc/nginx/conf.d/ynx-chain.conf && sudo nginx -t && sudo systemctl reload nginx; fi"
ynx_ssh "sudo systemctl daemon-reload && sudo systemctl enable ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd && sudo systemctl restart ynx-chaind && sudo systemctl restart ynx-indexerd && sudo systemctl restart ynx-explorerd && sudo systemctl restart ynx-faucetd && sudo systemctl --no-pager --full status ynx-chaind && sudo systemctl --no-pager --full status ynx-indexerd && sudo systemctl --no-pager --full status ynx-explorerd && sudo systemctl --no-pager --full status ynx-faucetd"

echo "deployment command path completed for $release"
echo "run make verify-testnet with YNX_PUBLIC_RPC_URL or against the deployed RPC domain after DNS/TLS is live"
