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
SG_NODE_USER="${SG_NODE_USER:-root}"
SG_NODE_SSH_KEY="${SG_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-}}"
SILICON_VALLEY_NODE_HOST="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
SILICON_VALLEY_NODE_USER="${SILICON_VALLEY_NODE_USER:-ubuntu}"
SILICON_VALLEY_NODE_SSH_KEY="${SILICON_VALLEY_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-}}"
SEOUL_NODE_HOST="${SEOUL_NODE_HOST:-43.164.132.81}"
SEOUL_NODE_USER="${SEOUL_NODE_USER:-root}"
SEOUL_NODE_SSH_KEY="${SEOUL_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-}}"
YNX_VALIDATOR_SET="${YNX_VALIDATOR_SET:-ynx_validator_primary|ynx-primary|${PRIMARY_NODE_HOST}|primary validator|primary-${PRIMARY_NODE_HOST};ynx_validator_singapore|ynx-singapore|${SG_NODE_HOST}|bonded validator / recovery node|sg-${SG_NODE_HOST};ynx_validator_silicon_valley|ynx-silicon-valley|${SILICON_VALLEY_NODE_HOST}|bonded validator|sv-${SILICON_VALLEY_NODE_HOST};ynx_validator_seoul|ynx-seoul|${SEOUL_NODE_HOST}|bonded validator / read replica candidate|seoul-${SEOUL_NODE_HOST}}"
YNX_BOOTSTRAP_PEERS="${YNX_BOOTSTRAP_PEERS:-ynx_validator_primary|primary-${PRIMARY_NODE_HOST}|${PRIMARY_NODE_HOST}|${PRIMARY_NODE_HOST}:26656|primary validator;ynx_validator_singapore|sg-${SG_NODE_HOST}|${SG_NODE_HOST}|${SG_NODE_HOST}:26656|bonded validator / recovery node;ynx_validator_silicon_valley|sv-${SILICON_VALLEY_NODE_HOST}|${SILICON_VALLEY_NODE_HOST}|${SILICON_VALLEY_NODE_HOST}:26656|bonded validator;ynx_validator_seoul|seoul-${SEOUL_NODE_HOST}|${SEOUL_NODE_HOST}|${SEOUL_NODE_HOST}:26656|bonded validator / read replica candidate}"
YNX_EXPECTED_VALIDATOR_COUNT="${YNX_EXPECTED_VALIDATOR_COUNT:-4}"
YNX_LOCAL_VALIDATOR_ADDRESS="${YNX_LOCAL_VALIDATOR_ADDRESS:-ynx_validator_primary}"
YNX_PEER_RPC_URLS="${YNX_PEER_RPC_URLS:-ynx_validator_singapore|http://${SG_NODE_HOST}:6420;ynx_validator_silicon_valley|http://${SILICON_VALLEY_NODE_HOST}:6420;ynx_validator_seoul|http://${SEOUL_NODE_HOST}:6420}"
YNX_PEER_SYNC_INTERVAL="${YNX_PEER_SYNC_INTERVAL:-5s}"

required=(
  TESTNET_DOMAIN WEBSITE_DOMAIN EXPLORER_DOMAIN REST_DOMAIN INDEXER_DOMAIN RPC_DOMAIN EVM_RPC_DOMAIN
  FAUCET_DOMAIN API_DOMAIN AI_GATEWAY_DOMAIN TRUST_API_DOMAIN PAY_API_DOMAIN IDE_DOMAIN
  SERVER_HOST SERVER_USER SSH_KEY_PATH DEPLOY_TARGET CHAIN_ID CHAIN_NAME
  NATIVE_COIN_NAME NATIVE_SYMBOL GENESIS_VALIDATOR_NAME VALIDATOR_KEY_PATH
  FAUCET_PRIVATE_KEY DEPLOYER_PRIVATE_KEY TREASURY_ADDRESS FOUNDATION_ADDRESS
  TEAM_VESTING_ADDRESS POSTGRES_URL REDIS_URL WEBHOOK_SECRET JWT_SECRET
  SESSION_SECRET RATE_LIMIT_SECRET PAY_MERCHANT_SECRET TRUST_REPORT_SIGNING_KEY
  OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY
  OPENAI_API_KEY AI_MODEL_NAME YNX_AI_GATEWAY_API_KEY YNX_AI_GATEWAY_UPSTREAM_KEY YNX_AI_PROVIDER_URL YNX_AI_GATEWAY_HTTP_ADDR
  YNX_AI_GATEWAY_CHAIN_URL YNX_AI_GATEWAY_AUDIT_LOG YNX_AI_GATEWAY_RATE_LIMIT_WINDOW YNX_AI_GATEWAY_RATE_LIMIT_MAX
  YNX_PAY_MERCHANT_ID YNX_PAY_API_KEY YNX_PAY_GATEWAY_UPSTREAM_KEY YNX_PAY_WEBHOOK_SIGNING_KEY YNX_PAY_GATEWAY_HTTP_ADDR
  YNX_PAY_GATEWAY_CHAIN_URL YNX_PAY_GATEWAY_AUDIT_LOG YNX_PAY_GATEWAY_RATE_LIMIT_WINDOW YNX_PAY_GATEWAY_RATE_LIMIT_MAX
  YNX_TRUST_API_KEY YNX_TRUST_GATEWAY_UPSTREAM_KEY YNX_TRUST_GATEWAY_HTTP_ADDR YNX_TRUST_GATEWAY_CHAIN_URL
  YNX_TRUST_GATEWAY_AUDIT_LOG YNX_TRUST_GATEWAY_RATE_LIMIT_WINDOW YNX_TRUST_GATEWAY_RATE_LIMIT_MAX
  EMAIL_PROVIDER EMAIL_API_KEY MONITORING_ADMIN_PASSWORD
  BACKUP_STORAGE_PATH SSL_EMAIL NGINX_SERVER_NAME GITHUB_REPO_TOKEN
  PRIMARY_NODE_HOST PRIMARY_NODE_USER PRIMARY_NODE_SSH_KEY SG_NODE_HOST SG_NODE_USER SG_NODE_SSH_KEY
  SILICON_VALLEY_NODE_HOST SILICON_VALLEY_NODE_USER SILICON_VALLEY_NODE_SSH_KEY
  SEOUL_NODE_HOST SEOUL_NODE_USER SEOUL_NODE_SSH_KEY YNX_VALIDATOR_SET YNX_BOOTSTRAP_PEERS YNX_EXPECTED_VALIDATOR_COUNT
)
ynx_require_env "${required[@]}"
ynx_reject_unsafe_env_values "${required[@]}"
[[ "$NATIVE_SYMBOL" == "YNXT" ]] || { echo "NATIVE_SYMBOL must be YNXT"; exit 1; }
[[ "$NATIVE_COIN_NAME" == "YNXT" ]] || { echo "NATIVE_COIN_NAME must be YNXT"; exit 1; }
[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || { echo "CHAIN_ID must be numeric"; exit 1; }

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  node scripts/verify/deploy-readiness-gate.mjs
fi

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${commit}"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
chaind_ldflags="-s -w -X main.buildCommit=${commit} -X main.buildRelease=${release} -X main.buildTime=${build_time}"
service_ldflags="-s -w -X main.buildCommit=${commit} -X main.buildRelease=${release} -X main.buildTime=${build_time}"
work="tmp/deploy/${release}"
rm -rf "$work"
mkdir -p "$work/bin" "$work/config" "$work/systemd" "$work/nginx" "$work/caddy" "$work/scripts" "$work/docs"

echo "building YNX Chain binary for linux/amd64"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$chaind_ldflags" -o "$work/bin/ynx-chaind" ./cmd/ynx-chaind
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/ynx-indexerd" ./cmd/ynx-indexerd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/ynx-explorerd" ./cmd/ynx-explorerd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/ynx-faucetd" ./cmd/ynx-faucetd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/ynx-ai-gatewayd" ./cmd/ynx-ai-gatewayd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/ynx-payd" ./cmd/ynx-payd
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$service_ldflags" -o "$work/bin/ynx-trustd" ./cmd/ynx-trustd
cat > "$work/config/release.env" <<EOF
YNX_RELEASE_COMMIT=${commit}
YNX_RELEASE_NAME=${release}
YNX_RELEASE_BUILD_TIME=${build_time}
EOF

ynx_write_kv_env "$work/config/ynx-chaind.env" \
  CHAIN_ID CHAIN_NAME NATIVE_COIN_NAME NATIVE_SYMBOL TESTNET_DOMAIN RPC_DOMAIN EVM_RPC_DOMAIN \
  REST_DOMAIN INDEXER_DOMAIN FAUCET_DOMAIN API_DOMAIN AI_GATEWAY_DOMAIN TRUST_API_DOMAIN PAY_API_DOMAIN IDE_DOMAIN \
  GENESIS_VALIDATOR_NAME TREASURY_ADDRESS FOUNDATION_ADDRESS TEAM_VESTING_ADDRESS \
  POSTGRES_URL REDIS_URL WEBHOOK_SECRET JWT_SECRET SESSION_SECRET RATE_LIMIT_SECRET YNX_AI_GATEWAY_UPSTREAM_KEY YNX_PAY_GATEWAY_UPSTREAM_KEY YNX_TRUST_GATEWAY_UPSTREAM_KEY \
  PAY_MERCHANT_SECRET TRUST_REPORT_SIGNING_KEY OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET \
  OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY \
  EMAIL_PROVIDER EMAIL_API_KEY MONITORING_ADMIN_PASSWORD BACKUP_STORAGE_PATH GITHUB_REPO_TOKEN \
  PRIMARY_NODE_HOST PRIMARY_NODE_USER SG_NODE_HOST SG_NODE_USER \
  SILICON_VALLEY_NODE_HOST SILICON_VALLEY_NODE_USER SEOUL_NODE_HOST SEOUL_NODE_USER \
  YNX_VALIDATOR_SET YNX_BOOTSTRAP_PEERS YNX_EXPECTED_VALIDATOR_COUNT \
  YNX_LOCAL_VALIDATOR_ADDRESS YNX_PEER_RPC_URLS YNX_PEER_SYNC_INTERVAL
ynx_write_kv_env "$work/config/ynx-faucetd.env" FAUCET_PRIVATE_KEY
ynx_write_kv_env "$work/config/ynx-ai-gatewayd.env" \
  OPENAI_API_KEY AI_MODEL_NAME YNX_AI_GATEWAY_API_KEY YNX_AI_GATEWAY_UPSTREAM_KEY YNX_AI_PROVIDER_URL YNX_AI_GATEWAY_HTTP_ADDR \
  YNX_AI_GATEWAY_CHAIN_URL YNX_AI_GATEWAY_AUDIT_LOG YNX_AI_GATEWAY_RATE_LIMIT_WINDOW YNX_AI_GATEWAY_RATE_LIMIT_MAX
ynx_write_kv_env "$work/config/ynx-payd.env" \
  YNX_PAY_MERCHANT_ID YNX_PAY_API_KEY YNX_PAY_GATEWAY_UPSTREAM_KEY YNX_PAY_WEBHOOK_SIGNING_KEY YNX_PAY_GATEWAY_HTTP_ADDR \
  YNX_PAY_GATEWAY_CHAIN_URL YNX_PAY_GATEWAY_AUDIT_LOG YNX_PAY_GATEWAY_RATE_LIMIT_WINDOW YNX_PAY_GATEWAY_RATE_LIMIT_MAX
ynx_write_kv_env "$work/config/ynx-trustd.env" \
  YNX_TRUST_API_KEY YNX_TRUST_GATEWAY_UPSTREAM_KEY YNX_TRUST_GATEWAY_HTTP_ADDR YNX_TRUST_GATEWAY_CHAIN_URL \
  YNX_TRUST_GATEWAY_AUDIT_LOG YNX_TRUST_GATEWAY_RATE_LIMIT_WINDOW YNX_TRUST_GATEWAY_RATE_LIMIT_MAX
cat >> "$work/config/ynx-chaind.env" <<EOF
YNX_NETWORK=testnet
YNX_HTTP_ADDR=127.0.0.1:6420
YNX_DATA_DIR=/var/lib/ynx-chain/testnet
YNX_BLOCK_INTERVAL=2s
EOF
printf 'YNX_LOCAL_VALIDATOR_ADDRESS=%q\n' "$YNX_LOCAL_VALIDATOR_ADDRESS" >> "$work/config/ynx-chaind.env"
printf 'YNX_PEER_RPC_URLS=%q\n' "$YNX_PEER_RPC_URLS" >> "$work/config/ynx-chaind.env"
printf 'YNX_PEER_SYNC_INTERVAL=%q\n' "$YNX_PEER_SYNC_INTERVAL" >> "$work/config/ynx-chaind.env"
cat >> "$work/config/ynx-chaind.env" <<EOF
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

ynx_peer_rpc_urls_for_role() {
  local role="$1"
  case "$role" in
    primary)
      printf 'ynx_validator_singapore|http://%s:6420;ynx_validator_silicon_valley|http://%s:6420;ynx_validator_seoul|http://%s:6420' "$SG_NODE_HOST" "$SILICON_VALLEY_NODE_HOST" "$SEOUL_NODE_HOST"
      ;;
    singapore)
      printf 'ynx_validator_primary|http://%s:6420;ynx_validator_silicon_valley|http://%s:6420;ynx_validator_seoul|http://%s:6420' "$PRIMARY_NODE_HOST" "$SILICON_VALLEY_NODE_HOST" "$SEOUL_NODE_HOST"
      ;;
    silicon-valley)
      printf 'ynx_validator_primary|http://%s:6420;ynx_validator_singapore|http://%s:6420;ynx_validator_seoul|http://%s:6420' "$PRIMARY_NODE_HOST" "$SG_NODE_HOST" "$SEOUL_NODE_HOST"
      ;;
    seoul)
      printf 'ynx_validator_primary|http://%s:6420;ynx_validator_singapore|http://%s:6420;ynx_validator_silicon_valley|http://%s:6420' "$PRIMARY_NODE_HOST" "$SG_NODE_HOST" "$SILICON_VALLEY_NODE_HOST"
      ;;
    *)
      return 1
      ;;
  esac
}

ynx_write_node_env() {
  local role="$1" validator="$2" peer_urls
  peer_urls="$(ynx_peer_rpc_urls_for_role "$role")"
  cp "$work/config/ynx-chaind.env" "$work/config/ynx-chaind-${role}.env"
  printf 'YNX_LOCAL_VALIDATOR_ADDRESS=%q\n' "$validator" >> "$work/config/ynx-chaind-${role}.env"
  printf 'YNX_PEER_RPC_URLS=%q\n' "$peer_urls" >> "$work/config/ynx-chaind-${role}.env"
  printf 'YNX_PEER_SYNC_INTERVAL=%q\n' "$YNX_PEER_SYNC_INTERVAL" >> "$work/config/ynx-chaind-${role}.env"
}

ynx_write_node_env primary ynx_validator_primary
ynx_write_node_env singapore ynx_validator_singapore
ynx_write_node_env silicon-valley ynx_validator_silicon_valley
ynx_write_node_env seoul ynx_validator_seoul

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
EnvironmentFile=/etc/ynx/ynx-faucetd.env
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

cat > "$work/systemd/ynx-ai-gatewayd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet AI Gateway
After=network-online.target ynx-chaind.service
Wants=network-online.target ynx-chaind.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
EnvironmentFile=/etc/ynx/ynx-ai-gatewayd.env
ExecStart=/usr/local/bin/ynx-ai-gatewayd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cat > "$work/systemd/ynx-payd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet Pay merchant gateway
After=network-online.target ynx-chaind.service
Wants=network-online.target ynx-chaind.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
EnvironmentFile=/etc/ynx/ynx-payd.env
ExecStart=/usr/local/bin/ynx-payd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/log/ynx-chain

[Install]
WantedBy=multi-user.target
EOF

cat > "$work/systemd/ynx-trustd.service" <<'EOF'
[Unit]
Description=YNX Chain testnet Trust and Chain Law gateway
After=network-online.target ynx-chaind.service
Wants=network-online.target ynx-chaind.service

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
EnvironmentFile=/etc/ynx/ynx-trustd.env
ExecStart=/usr/local/bin/ynx-trustd
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/log/ynx-chain

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
  server_name ${INDEXER_DOMAIN};
  client_max_body_size 2m;
  location / {
    proxy_pass http://127.0.0.1:6426;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${NGINX_SERVER_NAME} ${TESTNET_DOMAIN} ${RPC_DOMAIN} ${EVM_RPC_DOMAIN};
  client_max_body_size 2m;
  location / {
    proxy_pass http://127.0.0.1:6420;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${AI_GATEWAY_DOMAIN};
  client_max_body_size 2m;
  proxy_read_timeout 120s;
  proxy_buffering off;
  location / {
    proxy_pass http://127.0.0.1:6429;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${PAY_API_DOMAIN};
  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:6430;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${TRUST_API_DOMAIN};
  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:6431;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 80;
  server_name ${REST_DOMAIN} ${API_DOMAIN} ${IDE_DOMAIN};
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

cat > "$work/caddy/ynx-chain.caddy" <<EOF
${EXPLORER_DOMAIN} {
  reverse_proxy 127.0.0.1:6427
}

${FAUCET_DOMAIN} {
  reverse_proxy 127.0.0.1:6428
}

${INDEXER_DOMAIN} {
  reverse_proxy 127.0.0.1:6426
}

${AI_GATEWAY_DOMAIN} {
  reverse_proxy 127.0.0.1:6429
}

${PAY_API_DOMAIN} {
  reverse_proxy 127.0.0.1:6430
}

${TRUST_API_DOMAIN} {
  reverse_proxy 127.0.0.1:6431
}

${NGINX_SERVER_NAME}, ${TESTNET_DOMAIN}, ${RPC_DOMAIN}, ${EVM_RPC_DOMAIN} {
  reverse_proxy 127.0.0.1:6420
}

${REST_DOMAIN}, ${API_DOMAIN}, ${IDE_DOMAIN} {
  handle_path /indexer/* {
    reverse_proxy 127.0.0.1:6426
  }
  handle_path /explorer/* {
    reverse_proxy 127.0.0.1:6427
  }
  reverse_proxy 127.0.0.1:6420
}
EOF

cat > "$work/scripts/install-caddy-ingress.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

src="${1:?missing source snippet path}"
caddyfile="${2:-/etc/caddy/Caddyfile}"
dest="${3:-/etc/caddy/ynx-chain.caddy}"
release="${4:-unknown}"
begin="# BEGIN YNX_CHAIN_MANAGED_INGRESS"
end="# END YNX_CHAIN_MANAGED_INGRESS"
import_line="import ${dest}"

[[ -r "$src" ]] || { echo "missing readable Caddy ingress snippet: $src"; exit 1; }
command -v caddy >/dev/null 2>&1 || { echo "caddy binary not found"; exit 1; }

sudo install -d -m 0755 "$(dirname "$caddyfile")" "$(dirname "$dest")"
sudo install -m 0644 "$src" "$dest"
sudo touch "$caddyfile"

candidate="$(mktemp)"
trap 'rm -f "$candidate"' EXIT
sudo awk -v begin="$begin" -v end="$end" '
  $0 == begin { skip=1; next }
  $0 == end { skip=0; next }
  skip != 1 { print }
' "$caddyfile" > "$candidate"

{
  printf '\n%s\n' "$begin"
  printf '%s\n' "$import_line"
  printf '%s\n' "$end"
} >> "$candidate"

sudo caddy validate --config "$candidate"
sudo cp "$caddyfile" "${caddyfile}.pre-ynx-${release}"
sudo install -m 0644 "$candidate" "$caddyfile"
sudo systemctl reload caddy
EOF
chmod +x "$work/scripts/install-caddy-ingress.sh"
cp scripts/deploy/check-local-services.sh "$work/scripts/check-local-services.sh"
chmod +x "$work/scripts/check-local-services.sh"

cp README.md REQUIRED_INPUTS.md ENV_INTAKE_FORM.md "$work/docs/"
node scripts/deploy/write-release-manifest.mjs "$work" "$release" "$commit" "$build_time" "$DEPLOY_TARGET" "$CHAIN_ID" "$CHAIN_NAME"
tarball="tmp/deploy/${release}.tar.gz"
tar -C "$work" -czf "$tarball" .
sha256sum "$tarball" > "${tarball}.sha256" 2>/dev/null || shasum -a 256 "$tarball" > "${tarball}.sha256"

echo "release bundle: $tarball"
echo "release checksum: $(cat "${tarball}.sha256")"

remote_release="/tmp/${release}.tar.gz"
remote_dir="/opt/ynx-chain/releases/${release}"

ynx_node_remote() {
  local user="$1" host="$2"
  printf '%s@%s' "$user" "$host"
}

ynx_node_ssh() {
  local role="$1" user="$2" host="$3" key="$4"
  shift 4
  local remote
  remote="$(ynx_node_remote "$user" "$host")"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN [%s] ssh -i %q %q' "$role" "$key" "$remote"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  ssh -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$remote" "$@"
}

ynx_node_scp() {
  local role="$1" user="$2" host="$3" key="$4" src="$5" dest="$6"
  local remote
  remote="$(ynx_node_remote "$user" "$host")"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN [%s] scp -i %q %q %q:%q\n' "$role" "$key" "$src" "$remote" "$dest"
    return 0
  fi
  scp -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$src" "$remote:$dest"
}

ynx_capture_predeploy_state() {
  local role="$1" user="$2" host="$3" key="$4"
  local marker="/var/log/ynx-chain/deploy/predeploy-${release}-${role}.txt"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -d -o ynx -g ynx /var/log/ynx-chain/deploy 2>/dev/null || sudo install -d /var/log/ynx-chain/deploy; { date -u; hostname; uname -a; echo '--- services'; systemctl list-units --type=service --all 'ynx-*' 2>/dev/null || true; systemctl is-active ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd 2>/dev/null || true; echo '--- local status'; curl -fsS http://127.0.0.1:6420/status 2>/dev/null || true; curl -fsS http://127.0.0.1:6426/health 2>/dev/null || true; curl -fsS http://127.0.0.1:6427/health 2>/dev/null || true; curl -fsS http://127.0.0.1:6428/health 2>/dev/null || true; curl -fsS http://127.0.0.1:6429/health 2>/dev/null || true; curl -fsS http://127.0.0.1:6430/health 2>/dev/null || true; curl -fsS http://127.0.0.1:6431/health 2>/dev/null || true; echo '--- ingress'; sudo test -f /etc/nginx/conf.d/ynx-chain.conf && sudo sed -n '1,340p' /etc/nginx/conf.d/ynx-chain.conf || true; sudo test -f /etc/caddy/Caddyfile && sudo sed -n '1,340p' /etc/caddy/Caddyfile || true; echo '--- data dirs'; sudo find /var/lib/ynx-chain -maxdepth 3 -type f 2>/dev/null | sort | head -200 || true; } | sudo tee '$marker' >/dev/null && sudo ls -lh '$marker'"
}

ynx_backup_node() {
  local role="$1" user="$2" host="$3" key="$4"
  local backup_name="ynx-chain-predeploy-${release}-${role}.tar.gz"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -d -m 0700 '$BACKUP_STORAGE_PATH' && sudo tar --ignore-failed-read -czf '$BACKUP_STORAGE_PATH/$backup_name' /etc/ynx /etc/systemd/system/ynx-chaind.service /etc/systemd/system/ynx-indexerd.service /etc/systemd/system/ynx-explorerd.service /etc/systemd/system/ynx-faucetd.service /etc/systemd/system/ynx-ai-gatewayd.service /etc/systemd/system/ynx-payd.service /etc/systemd/system/ynx-trustd.service /etc/systemd/system/ynx-v2-node.service /etc/systemd/system/ynx-v2-indexer.service /etc/systemd/system/ynx-v2-explorer.service /etc/systemd/system/ynx-v2-faucet.service /etc/systemd/system/ynx-v2-ai-gateway.service /etc/systemd/system/ynx-v2-web4-hub.service /etc/systemd/system/ynx-v2-bridge-service.service /etc/systemd/system/ynx-v2-peer.service /etc/systemd/system/caddy.service /etc/nginx/conf.d/ynx-chain.conf /etc/caddy/Caddyfile /home/ubuntu/.ynx-v2 /root/.ynx-v2 /var/lib/ynx-chain /var/log/ynx-chain /var/lib/ynx-ops-observer 2>/dev/null || true; sudo test -f '$BACKUP_STORAGE_PATH/$backup_name' && sudo ls -lh '$BACKUP_STORAGE_PATH/$backup_name' || true"
}

ynx_precheck_node_access() {
  local role="$1" user="$2" host="$3" key="$4"
  [[ -r "$key" ]] || { echo "SSH key for $role is not readable: $key"; exit 1; }
  ynx_node_ssh "$role" "$user" "$host" "$key" "hostname >/dev/null && command -v systemctl >/dev/null"
}

ynx_prepare_release_on_node() {
  local role="$1" user="$2" host="$3" key="$4"
  ynx_node_scp "$role" "$user" "$host" "$key" "$tarball" "$remote_release"
  ynx_node_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null 2>&1 || sudo useradd --system --home /var/lib/ynx-chain --shell /usr/sbin/nologin ynx"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -d -o root -g root /opt/ynx-chain/releases /etc/ynx /usr/local/bin && sudo install -d -o ynx -g ynx /var/lib/ynx-chain/testnet /var/lib/ynx-chain/indexer /var/log/ynx-chain"
  ynx_capture_predeploy_state "$role" "$user" "$host" "$key"
  ynx_backup_node "$role" "$user" "$host" "$key"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo rm -rf '$remote_dir' && sudo mkdir -p '$remote_dir' && sudo tar -xzf '$remote_release' -C '$remote_dir'"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -m 0755 '$remote_dir/bin/ynx-chaind' /usr/local/bin/ynx-chaind && sudo install -m 0600 '$remote_dir/config/ynx-chaind-${role}.env' /etc/ynx/ynx-chaind.env && sudo install -m 0644 '$remote_dir/systemd/ynx-chaind.service' /etc/systemd/system/ynx-chaind.service"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo bash -lc 'set -a; source /etc/ynx/ynx-chaind.env; set +a; /usr/local/bin/ynx-chaind --check-config >/dev/null'"
}

ynx_install_primary_node() {
  local role="$1" user="$2" host="$3" key="$4"
  ynx_prepare_release_on_node "$role" "$user" "$host" "$key"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -m 0755 '$remote_dir/bin/ynx-indexerd' /usr/local/bin/ynx-indexerd && sudo install -m 0755 '$remote_dir/bin/ynx-explorerd' /usr/local/bin/ynx-explorerd && sudo install -m 0755 '$remote_dir/bin/ynx-faucetd' /usr/local/bin/ynx-faucetd && sudo install -m 0755 '$remote_dir/bin/ynx-ai-gatewayd' /usr/local/bin/ynx-ai-gatewayd && sudo install -m 0755 '$remote_dir/bin/ynx-payd' /usr/local/bin/ynx-payd && sudo install -m 0755 '$remote_dir/bin/ynx-trustd' /usr/local/bin/ynx-trustd"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -m 0644 '$remote_dir/systemd/ynx-indexerd.service' /etc/systemd/system/ynx-indexerd.service && sudo install -m 0644 '$remote_dir/systemd/ynx-explorerd.service' /etc/systemd/system/ynx-explorerd.service && sudo install -m 0644 '$remote_dir/systemd/ynx-faucetd.service' /etc/systemd/system/ynx-faucetd.service && sudo install -m 0644 '$remote_dir/systemd/ynx-ai-gatewayd.service' /etc/systemd/system/ynx-ai-gatewayd.service && sudo install -m 0644 '$remote_dir/systemd/ynx-payd.service' /etc/systemd/system/ynx-payd.service && sudo install -m 0644 '$remote_dir/systemd/ynx-trustd.service' /etc/systemd/system/ynx-trustd.service"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo install -m 0600 '$remote_dir/config/ynx-faucetd.env' /etc/ynx/ynx-faucetd.env && sudo install -m 0600 '$remote_dir/config/ynx-ai-gatewayd.env' /etc/ynx/ynx-ai-gatewayd.env && sudo install -m 0600 '$remote_dir/config/ynx-payd.env' /etc/ynx/ynx-payd.env && sudo install -m 0600 '$remote_dir/config/ynx-trustd.env' /etc/ynx/ynx-trustd.env"
  ynx_node_ssh "$role" "$user" "$host" "$key" "if command -v nginx >/dev/null 2>&1; then sudo install -m 0644 '$remote_dir/nginx/ynx-chain.conf' /etc/nginx/conf.d/ynx-chain.conf && sudo nginx -t && sudo systemctl reload nginx; fi"
  ynx_node_ssh "$role" "$user" "$host" "$key" "if command -v caddy >/dev/null 2>&1; then sudo bash '$remote_dir/scripts/install-caddy-ingress.sh' '$remote_dir/caddy/ynx-chain.caddy' /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy '$release'; fi"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo systemctl daemon-reload && sudo systemctl enable ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd && sudo systemctl restart ynx-chaind && sudo systemctl restart ynx-indexerd && sudo systemctl restart ynx-explorerd && sudo systemctl restart ynx-faucetd && sudo systemctl restart ynx-ai-gatewayd && sudo systemctl restart ynx-payd && sudo systemctl restart ynx-trustd && sudo systemctl --no-pager --full status ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd"
  ynx_node_ssh "$role" "$user" "$host" "$key" "bash '$remote_dir/scripts/check-local-services.sh' '$role' '$commit' '$release' '$CHAIN_ID' full"
}

ynx_install_validator_node() {
  local role="$1" user="$2" host="$3" key="$4"
  ynx_prepare_release_on_node "$role" "$user" "$host" "$key"
  ynx_node_ssh "$role" "$user" "$host" "$key" "sudo systemctl daemon-reload && sudo systemctl enable ynx-chaind && sudo systemctl restart ynx-chaind && sudo systemctl --no-pager --full status ynx-chaind"
  ynx_node_ssh "$role" "$user" "$host" "$key" "bash '$remote_dir/scripts/check-local-services.sh' '$role' '$commit' '$release' '$CHAIN_ID' validator"
}

ynx_precheck_node_access "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY"
ynx_precheck_node_access "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY"
ynx_precheck_node_access "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY"
ynx_precheck_node_access "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY"

ynx_install_primary_node "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY"
ynx_install_validator_node "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY"
ynx_install_validator_node "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY"
ynx_install_validator_node "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY"

echo "deployment command path completed for $release"
echo "primary full stack plus validator nodes install path completed; run make verify-testnet against the deployed public domains"
