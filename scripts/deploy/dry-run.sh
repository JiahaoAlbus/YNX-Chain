#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/deploy.env" <<EOF
TESTNET_DOMAIN=testnet.ynx.test
WEBSITE_DOMAIN=www.ynx.test
EXPLORER_DOMAIN=explorer.ynx.test
REST_DOMAIN=rest.ynx.test
INDEXER_DOMAIN=indexer.ynx.test
RPC_DOMAIN=rpc.ynx.test
EVM_RPC_DOMAIN=evm-rpc.ynx.test
FAUCET_DOMAIN=faucet.ynx.test
API_DOMAIN=api.ynx.test
AI_GATEWAY_DOMAIN=ai.ynx.test
TRUST_API_DOMAIN=trust.ynx.test
RESOURCE_API_DOMAIN=resource.ynx.test
PAY_API_DOMAIN=pay.ynx.test
IDE_DOMAIN=ide.ynx.test
SERVER_HOST=127.0.0.1
SERVER_USER=ynx
SSH_KEY_PATH=$tmp/ynx_deploy_key
PRIMARY_NODE_HOST=127.0.0.1
PRIMARY_NODE_USER=ynx
PRIMARY_NODE_SSH_KEY=$tmp/ynx_deploy_key
SG_NODE_HOST=43.134.23.58
SG_NODE_USER=root
SG_NODE_SSH_KEY=$tmp/ynx_deploy_key
SG_OBSERVER_FILE=/var/lib/ynx-ops-observer/latest.json
SILICON_VALLEY_NODE_HOST=43.162.100.54
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$tmp/ynx_deploy_key
SEOUL_NODE_HOST=43.164.132.81
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$tmp/ynx_deploy_key
DEPLOY_TARGET=testnet-dry-run
CHAIN_ID=6423
CHAIN_NAME='YNX Testnet'
NATIVE_COIN_NAME=YNXT
NATIVE_SYMBOL=YNXT
YNX_COSMOS_CHAIN_ID=ynx_6423-1
YNX_EVM_CHAIN_ID=6423
YNX_EVM_CHAIN_ID_HEX=0x1917
YNX_NATIVE_COIN_NAME=YNXT
YNX_NATIVE_COIN_SYMBOL=YNXT
YNX_EXPECTED_VALIDATOR_COUNT=4
YNX_NODE_HTTP_ADDR=0.0.0.0:6420
YNX_REPLICATION_KEY=dry-run-replication-key-0123456789abcdef
YNX_REPLICATION_INTERVAL=2s
GENESIS_VALIDATOR_NAME=ynx-validator-dry-run
VALIDATOR_KEY_PATH=$tmp/validator_key
FAUCET_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000642
DEPLOYER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000643
TREASURY_ADDRESS=0x0000000000000000000000000000000000000642
FOUNDATION_ADDRESS=0x0000000000000000000000000000000000000643
TEAM_VESTING_ADDRESS=0x0000000000000000000000000000000000000645
POSTGRES_URL=postgres://ynx:ynx@127.0.0.1:5432/ynx
REDIS_URL=redis://127.0.0.1:6379/0
OBJECT_STORAGE_ENDPOINT=https://storage.ynx.test
OBJECT_STORAGE_BUCKET=ynx-testnet
OBJECT_STORAGE_ACCESS_KEY=dry-run-access
OBJECT_STORAGE_SECRET_KEY=dry-run-secret
OPENAI_API_KEY=dry-run-openai-key
AI_MODEL_NAME=gpt-4.1-mini
YNX_AI_GATEWAY_API_KEY=dry-run-ai-gateway-access-key
YNX_AI_GATEWAY_UPSTREAM_KEY=dry-run-ai-gateway-upstream-key
YNX_AI_PROVIDER_URL=https://api.openai.com/v1
YNX_AI_GATEWAY_HTTP_ADDR=127.0.0.1:6429
YNX_AI_GATEWAY_CHAIN_URL=http://127.0.0.1:6420
YNX_AI_GATEWAY_AUDIT_LOG=/var/log/ynx-chain/ai-gateway-audit.jsonl
YNX_AI_GATEWAY_RATE_LIMIT_WINDOW=1m
YNX_AI_GATEWAY_RATE_LIMIT_MAX=30
YNX_PAY_MERCHANT_ID=dry-run-merchant
YNX_PAY_API_KEY=dry-run-pay-api-key
YNX_PAY_GATEWAY_UPSTREAM_KEY=dry-run-pay-upstream-key
YNX_PAY_WEBHOOK_SIGNING_KEY=dry-run-pay-webhook-key
YNX_PAY_GATEWAY_HTTP_ADDR=127.0.0.1:6430
YNX_PAY_GATEWAY_CHAIN_URL=http://127.0.0.1:6420
YNX_PAY_GATEWAY_AUDIT_LOG=/var/log/ynx-chain/pay-gateway-audit.jsonl
YNX_PAY_GATEWAY_RATE_LIMIT_WINDOW=1m
YNX_PAY_GATEWAY_RATE_LIMIT_MAX=60
YNX_TRUST_API_KEY=dry-run-trust-api-key
YNX_TRUST_GATEWAY_UPSTREAM_KEY=dry-run-trust-upstream-key
YNX_TRUST_GATEWAY_HTTP_ADDR=127.0.0.1:6431
YNX_TRUST_GATEWAY_CHAIN_URL=http://127.0.0.1:6420
YNX_TRUST_GATEWAY_AUDIT_LOG=/var/log/ynx-chain/trust-gateway-audit.jsonl
YNX_TRUST_GATEWAY_RATE_LIMIT_WINDOW=1m
YNX_TRUST_GATEWAY_RATE_LIMIT_MAX=60
YNX_RESOURCE_API_KEY=dry-run-resource-api-key
YNX_RESOURCE_GATEWAY_UPSTREAM_KEY=dry-run-resource-upstream-key
YNX_RESOURCE_GATEWAY_HTTP_ADDR=127.0.0.1:6432
YNX_RESOURCE_GATEWAY_CHAIN_URL=http://127.0.0.1:6420
YNX_RESOURCE_GATEWAY_AUDIT_LOG=/var/log/ynx-chain/resource-gateway-audit.jsonl
YNX_RESOURCE_GATEWAY_RATE_LIMIT_WINDOW=1m
YNX_RESOURCE_GATEWAY_RATE_LIMIT_MAX=60
EMAIL_PROVIDER=dry-run-mail
EMAIL_API_KEY=dry-run-email-key
WEBHOOK_SECRET=dry-run-webhook-secret
JWT_SECRET=dry-run-jwt-secret
SESSION_SECRET=dry-run-session-secret
RATE_LIMIT_SECRET=dry-run-rate-limit-secret
PAY_MERCHANT_SECRET=dry-run-pay-secret
TRUST_REPORT_SIGNING_KEY=dry-run-trust-signing-key
MONITORING_ADMIN_PASSWORD=dry-run-monitoring-password
BACKUP_STORAGE_PATH=/var/backups/ynx-chain
SSL_EMAIL=ops@ynx.test
NGINX_SERVER_NAME=ynx.test
GITHUB_REPO_TOKEN=dry-run-github-token
EOF
touch "$tmp/ynx_deploy_key" "$tmp/validator_key"

dry_run_out="$tmp/deploy-dry-run.out"
ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 ./scripts/deploy/deploy-testnet.sh | tee "$dry_run_out"

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-chain-${commit}"
release_dir="tmp/deploy/${release}"
local_ldflags="-X main.buildCommit=${commit} -X main.buildRelease=${release} -X main.buildTime=dry-run-check"
grep -Fq "FAUCET_PRIVATE_KEY=" "$release_dir/config/ynx-faucetd.env" || { echo "faucet env missing FAUCET_PRIVATE_KEY"; exit 1; }
grep -Fq "YNX_BLOCK_PRODUCTION_ENABLED=true" "$release_dir/config/ynx-chaind-primary.env" || { echo "primary env must enable block production"; exit 1; }
grep -Fq "YNX_REPLICATION_SOURCE_URL=" "$release_dir/config/ynx-chaind-primary.env" || { echo "primary env missing empty replication source"; exit 1; }
for role in singapore silicon-valley seoul; do
  grep -Fq "YNX_BLOCK_PRODUCTION_ENABLED=false" "$release_dir/config/ynx-chaind-${role}.env" || { echo "$role env must disable block production"; exit 1; }
  grep -Fq "YNX_REPLICATION_SOURCE_URL=http://127.0.0.1:6420" "$release_dir/config/ynx-chaind-${role}.env" || { echo "$role env missing authoritative replication source"; exit 1; }
done
grep -Fq "OPENAI_API_KEY=" "$release_dir/config/ynx-ai-gatewayd.env" || { echo "AI Gateway env missing provider key"; exit 1; }
grep -Fq "YNX_AI_GATEWAY_API_KEY=" "$release_dir/config/ynx-ai-gatewayd.env" || { echo "AI Gateway env missing access key"; exit 1; }
grep -Fq "YNX_AI_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-ai-gatewayd.env" || { echo "AI Gateway env missing upstream key"; exit 1; }
grep -Fq "YNX_AI_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-chaind.env" || { echo "chain env missing AI Gateway upstream key"; exit 1; }
grep -Fq "YNX_PAY_API_KEY=" "$release_dir/config/ynx-payd.env" || { echo "Pay env missing API key"; exit 1; }
grep -Fq "YNX_PAY_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-payd.env" || { echo "Pay env missing upstream key"; exit 1; }
grep -Fq "YNX_PAY_WEBHOOK_SIGNING_KEY=" "$release_dir/config/ynx-payd.env" || { echo "Pay env missing webhook signing key"; exit 1; }
grep -Fq "YNX_PAY_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-chaind.env" || { echo "chain env missing Pay Gateway upstream key"; exit 1; }
grep -Fq "YNX_TRUST_API_KEY=" "$release_dir/config/ynx-trustd.env" || { echo "Trust env missing API key"; exit 1; }
grep -Fq "YNX_TRUST_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-trustd.env" || { echo "Trust env missing upstream key"; exit 1; }
grep -Fq "YNX_TRUST_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-chaind.env" || { echo "chain env missing Trust Gateway upstream key"; exit 1; }
grep -Fq "YNX_RESOURCE_API_KEY=" "$release_dir/config/ynx-resourced.env" || { echo "Resource env missing API key"; exit 1; }
grep -Fq "YNX_RESOURCE_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-resourced.env" || { echo "Resource env missing upstream key"; exit 1; }
grep -Fq "YNX_RESOURCE_GATEWAY_UPSTREAM_KEY=" "$release_dir/config/ynx-chaind.env" || { echo "chain env missing Resource Gateway upstream key"; exit 1; }
if grep -Fq "FAUCET_PRIVATE_KEY=" "$release_dir/config/ynx-chaind.env"; then
  echo "shared chain env must not contain FAUCET_PRIVATE_KEY"
  exit 1
fi
if grep -Eq '^(OPENAI_API_KEY|YNX_AI_GATEWAY_API_KEY)=' "$release_dir/config/ynx-chaind.env"; then
  echo "shared chain env must not contain AI provider or gateway access keys"
  exit 1
fi
if grep -Eq '^(YNX_PAY_API_KEY|YNX_PAY_WEBHOOK_SIGNING_KEY)=' "$release_dir/config/ynx-chaind.env"; then
  echo "shared chain env must not contain Pay merchant access or webhook signing keys"
  exit 1
fi
if grep -Eq '^YNX_TRUST_API_KEY=' "$release_dir/config/ynx-chaind.env"; then
  echo "shared chain env must not contain Trust client access key"
  exit 1
fi
if grep -Eq '^YNX_RESOURCE_API_KEY=' "$release_dir/config/ynx-chaind.env"; then
  echo "shared chain env must not contain Resource client access key"
  exit 1
fi
grep -Fq "YNX_RELEASE_COMMIT=${commit}" "$release_dir/config/release.env" || { echo "release env missing commit"; exit 1; }
grep -Fq "YNX_RELEASE_NAME=${release}" "$release_dir/config/release.env" || { echo "release env missing name"; exit 1; }
grep -a -Fq "$commit" "$release_dir/bin/ynx-chaind" || { echo "ynx-chaind binary missing release commit"; exit 1; }
grep -a -Fq "$release" "$release_dir/bin/ynx-chaind" || { echo "ynx-chaind binary missing release name"; exit 1; }
for binary in ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  grep -a -Fq "$commit" "$release_dir/bin/$binary" || { echo "$binary binary missing release commit"; exit 1; }
  grep -a -Fq "$release" "$release_dir/bin/$binary" || { echo "$binary binary missing release name"; exit 1; }
done
grep -Fq "REST_DOMAIN=rest.ynx.test" "$release_dir/config/ynx-chaind.env" || { echo "chain env missing REST_DOMAIN"; exit 1; }
grep -Fq "INDEXER_DOMAIN=indexer.ynx.test" "$release_dir/config/ynx-chaind.env" || { echo "chain env missing INDEXER_DOMAIN"; exit 1; }
node scripts/verify/release-manifest-check.mjs "$release_dir" "$commit" "$release"
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./config/release-manifest.json" || { echo "release tarball missing release manifest"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./caddy/ynx-chain.caddy" || { echo "release tarball missing Caddy ingress snippet"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./scripts/install-caddy-ingress.sh" || { echo "release tarball missing Caddy ingress install script"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./scripts/check-local-services.sh" || { echo "release tarball missing local service check script"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./bin/ynx-ai-gatewayd" || { echo "release tarball missing AI Gateway binary"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./config/ynx-ai-gatewayd.env" || { echo "release tarball missing AI Gateway env"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./bin/ynx-payd" || { echo "release tarball missing Pay Gateway binary"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./config/ynx-payd.env" || { echo "release tarball missing Pay Gateway env"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./bin/ynx-trustd" || { echo "release tarball missing Trust Gateway binary"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./config/ynx-trustd.env" || { echo "release tarball missing Trust Gateway env"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./bin/ynx-resourced" || { echo "release tarball missing Resource Gateway binary"; exit 1; }
tar -tzf "tmp/deploy/${release}.tar.gz" | grep -Fq "./config/ynx-resourced.env" || { echo "release tarball missing Resource Gateway env"; exit 1; }
grep -Fq "server_name ai.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing dedicated AI Gateway domain block"; exit 1; }
grep -Fq "server_name pay.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing dedicated Pay Gateway domain block"; exit 1; }
grep -Fq "server_name trust.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing dedicated Trust Gateway domain block"; exit 1; }
grep -Fq "server_name resource.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing dedicated Resource Gateway domain block"; exit 1; }
grep -Fq "server_name rest.ynx.test api.ynx.test ide.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing REST/API domain server block"; exit 1; }
grep -Fq "server_name indexer.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing indexer domain server block"; exit 1; }
grep -Fq "server_name explorer.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing explorer domain server block"; exit 1; }
grep -Fq "server_name faucet.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing faucet domain server block"; exit 1; }
grep -Fq "server_name ynx.test testnet.ynx.test rpc.ynx.test evm-rpc.ynx.test;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing RPC/EVM domain server block"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6426;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing indexer proxy target"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6427;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing explorer proxy target"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6428;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing faucet proxy target"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6429;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing AI Gateway proxy target"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6430;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing Pay Gateway proxy target"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6431;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing Trust Gateway proxy target"; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:6432;" "$release_dir/nginx/ynx-chain.conf" || { echo "nginx config missing Resource Gateway proxy target"; exit 1; }
grep -Fq "ai.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing AI Gateway domain"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6429" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing AI Gateway proxy target"; exit 1; }
grep -Fq "pay.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing Pay Gateway domain"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6430" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing Pay Gateway proxy target"; exit 1; }
grep -Fq "trust.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing Trust Gateway domain"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6431" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing Trust Gateway proxy target"; exit 1; }
grep -Fq "resource.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing Resource Gateway domain"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6432" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing Resource Gateway proxy target"; exit 1; }
grep -Fq "rest.ynx.test, api.ynx.test, ide.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing REST/API domain block"; exit 1; }
grep -Fq "indexer.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing indexer domain block"; exit 1; }
grep -Fq "explorer.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing explorer domain block"; exit 1; }
grep -Fq "faucet.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing faucet domain block"; exit 1; }
grep -Fq "ynx.test, testnet.ynx.test, rpc.ynx.test, evm-rpc.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing RPC/EVM domain block"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6420" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing chain API proxy target"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6426" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing indexer proxy target"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6427" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing explorer proxy target"; exit 1; }
grep -Fq "reverse_proxy 127.0.0.1:6428" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet missing faucet proxy target"; exit 1; }
grep -Fq "bridge.www.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet must preserve bridge route"; exit 1; }
grep -Fq "web4.www.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet must preserve Web4 route"; exit 1; }
grep -Fq "grpc.www.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet must preserve gRPC route"; exit 1; }
grep -Fq "evm-ws.www.ynx.test" "$release_dir/caddy/ynx-chain.caddy" || { echo "Caddy ingress snippet must preserve EVM WebSocket route"; exit 1; }
grep -Fq "BEGIN YNX_CHAIN_MANAGED_INGRESS" "$release_dir/scripts/install-caddy-ingress.sh" || { echo "Caddy install script missing managed block marker"; exit 1; }
grep -Fq "import \${dest}" "$release_dir/scripts/install-caddy-ingress.sh" || { echo "Caddy install script missing managed import"; exit 1; }

caddy_check_dir="$tmp/caddy-install-check"
mkdir -p "$caddy_check_dir/bin" "$caddy_check_dir/etc"
cat > "$caddy_check_dir/bin/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat > "$caddy_check_dir/bin/caddy" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "validate" && "${2:-}" == "--config" && -n "${3:-}" && "${4:-}" == "--adapter" && "${5:-}" == "caddyfile" ]] || { echo "unexpected caddy command: $*" >&2; exit 1; }
grep -Fq "legacy.example" "$3" || { echo "candidate Caddyfile lost existing routes" >&2; exit 1; }
grep -Fq "# BEGIN YNX_CHAIN_MANAGED_INGRESS" "$3" || { echo "candidate Caddyfile missing managed begin marker" >&2; exit 1; }
grep -Fq "import " "$3" || { echo "candidate Caddyfile missing import" >&2; exit 1; }
EOF
cat > "$caddy_check_dir/bin/systemctl" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == "reload" && "\${2:-}" == "caddy" ]] || { echo "unexpected systemctl command: \$*" >&2; exit 1; }
printf '%s\n' "\$*" >> "$caddy_check_dir/systemctl.log"
EOF
chmod +x "$caddy_check_dir/bin/sudo" "$caddy_check_dir/bin/caddy" "$caddy_check_dir/bin/systemctl"
cat > "$caddy_check_dir/Caddyfile" <<'EOF'
legacy.example {
  reverse_proxy 127.0.0.1:9000
}

# BEGIN YNX_CHAIN_MANAGED_INGRESS
import /tmp/old-ynx-chain.caddy
# END YNX_CHAIN_MANAGED_INGRESS

other.example {
  reverse_proxy 127.0.0.1:9001
}
EOF
PATH="$caddy_check_dir/bin:$PATH" bash "$release_dir/scripts/install-caddy-ingress.sh" \
  "$release_dir/caddy/ynx-chain.caddy" \
  "$caddy_check_dir/Caddyfile" \
  "$caddy_check_dir/ynx-chain.caddy" \
  "$release"
grep -Fq "legacy.example" "$caddy_check_dir/Caddyfile" || { echo "Caddy installer removed existing route"; exit 1; }
grep -Fq "other.example" "$caddy_check_dir/Caddyfile" || { echo "Caddy installer removed trailing existing route"; exit 1; }
grep -Fq "import $caddy_check_dir/ynx-chain.caddy" "$caddy_check_dir/Caddyfile" || { echo "Caddy installer missing managed import"; exit 1; }
if grep -Fq "old-ynx-chain.caddy" "$caddy_check_dir/Caddyfile"; then
  echo "Caddy installer left stale managed import"
  exit 1
fi
managed_count="$(grep -Fc "# BEGIN YNX_CHAIN_MANAGED_INGRESS" "$caddy_check_dir/Caddyfile")"
[[ "$managed_count" == "1" ]] || { echo "Caddy installer wrote duplicate managed blocks"; exit 1; }
cmp "$release_dir/caddy/ynx-chain.caddy" "$caddy_check_dir/ynx-chain.caddy" >/dev/null || { echo "Caddy installer wrote wrong snippet"; exit 1; }
[[ -r "$caddy_check_dir/Caddyfile.pre-ynx-${release}" ]] || { echo "Caddy installer missing backup"; exit 1; }
grep -Fq "reload caddy" "$caddy_check_dir/systemctl.log" || { echo "Caddy installer did not reload caddy"; exit 1; }
bash "$release_dir/scripts/check-local-services.sh" --self-test

ynx_check_role_env() {
  local role="$1" role_env="$2"
  local check_output
  (
    set -a
    # shellcheck disable=SC1090
    source "$role_env"
    set +a
    go run -ldflags "$local_ldflags" ./cmd/ynx-chaind --check-config
  ) >"$tmp/check-${role}.out" || { echo "ynx-chaind config check failed for $role env: $role_env"; exit 1; }
  check_output="$(cat "$tmp/check-${role}.out")"
  printf '%s\n' "$check_output" | grep -Fq "buildCommit=${commit}" || { echo "$role config check missing build commit"; exit 1; }
  printf '%s\n' "$check_output" | grep -Fq "release=${release}" || { echo "$role config check missing release name"; exit 1; }
  echo "ynx-chaind config check passed for $role env"
}

for role_validator in \
  "primary:ynx_validator_primary" \
  "singapore:ynx_validator_singapore" \
  "silicon-valley:ynx_validator_silicon_valley" \
  "seoul:ynx_validator_seoul"
do
  role="${role_validator%%:*}"
  validator="${role_validator#*:}"
  role_env="$release_dir/config/ynx-chaind-${role}.env"
  [[ -r "$role_env" ]] || { echo "missing role env: $role_env"; exit 1; }
  grep -Fq "YNX_LOCAL_VALIDATOR_ADDRESS=${validator}" "$role_env" || { echo "$role env missing local validator $validator"; exit 1; }
  grep -Fq "YNX_PEER_RPC_URLS=" "$role_env" || { echo "$role env missing peer RPC urls"; exit 1; }
  peer_line="$(grep -E '^YNX_PEER_RPC_URLS=' "$role_env" | tail -1)"
  if [[ "$peer_line" == *"${validator}|"* ]]; then
    echo "$role peer RPC urls must not include its own validator address"
    exit 1
  fi
  ynx_check_role_env "$role" "$role_env"
  grep -Fq "ynx-chaind-${role}.env" "$dry_run_out" || { echo "dry-run output missing install command for ynx-chaind-${role}.env"; exit 1; }
done
check_config_count="$(grep -Fc "ynx-chaind\\ --check-config" "$dry_run_out" || true)"
if [[ "$check_config_count" -lt 4 ]]; then
  echo "dry-run output missing per-node remote ynx-chaind --check-config commands"
  exit 1
fi
grep -Fq "EnvironmentFile=/etc/ynx/ynx-faucetd.env" "$release_dir/systemd/ynx-faucetd.service" || { echo "faucet service missing secret env file"; exit 1; }
grep -Fq "EnvironmentFile=/etc/ynx/ynx-ai-gatewayd.env" "$release_dir/systemd/ynx-ai-gatewayd.service" || { echo "AI Gateway service missing secret env file"; exit 1; }
grep -Fq "ExecStart=/usr/local/bin/ynx-ai-gatewayd" "$release_dir/systemd/ynx-ai-gatewayd.service" || { echo "AI Gateway service missing executable"; exit 1; }
grep -Fq "EnvironmentFile=/etc/ynx/ynx-payd.env" "$release_dir/systemd/ynx-payd.service" || { echo "Pay Gateway service missing secret env file"; exit 1; }
grep -Fq "ExecStart=/usr/local/bin/ynx-payd" "$release_dir/systemd/ynx-payd.service" || { echo "Pay Gateway service missing executable"; exit 1; }
grep -Fq "EnvironmentFile=/etc/ynx/ynx-trustd.env" "$release_dir/systemd/ynx-trustd.service" || { echo "Trust Gateway service missing secret env file"; exit 1; }
grep -Fq "ExecStart=/usr/local/bin/ynx-trustd" "$release_dir/systemd/ynx-trustd.service" || { echo "Trust Gateway service missing executable"; exit 1; }
grep -Fq "EnvironmentFile=/etc/ynx/ynx-resourced.env" "$release_dir/systemd/ynx-resourced.service" || { echo "Resource Gateway service missing secret env file"; exit 1; }
grep -Fq "ExecStart=/usr/local/bin/ynx-resourced" "$release_dir/systemd/ynx-resourced.service" || { echo "Resource Gateway service missing executable"; exit 1; }
grep -Fq "scripts/install-caddy-ingress.sh" "$dry_run_out" || { echo "dry-run output missing Caddy managed install script command"; exit 1; }
grep -Fq "caddy/ynx-chain.caddy" "$dry_run_out" || { echo "dry-run output missing Caddy ingress snippet command"; exit 1; }
grep -Fq "scripts/check-local-services.sh" "$dry_run_out" || { echo "dry-run output missing local service check command"; exit 1; }
grep -Eq "check-local-services\\.sh.*primary.*${commit}.*${release}.*6423.*full" "$dry_run_out" || { echo "dry-run output missing primary full local service check"; exit 1; }
grep -Eq "check-local-services\\.sh.*singapore.*${commit}.*${release}.*6423.*validator" "$dry_run_out" || { echo "dry-run output missing singapore local service check"; exit 1; }
grep -Eq "check-local-services\\.sh.*silicon-valley.*${commit}.*${release}.*6423.*validator" "$dry_run_out" || { echo "dry-run output missing silicon-valley local service check"; exit 1; }
grep -Eq "check-local-services\\.sh.*seoul.*${commit}.*${release}.*6423.*validator" "$dry_run_out" || { echo "dry-run output missing seoul local service check"; exit 1; }
if grep -Fq "/home/ubuntu/.ynx-v2" "$dry_run_out" || grep -Fq "/root/.ynx-v2" "$dry_run_out" || grep -Fq "/var/lib/ynx-ops-observer" "$dry_run_out"; then
  echo "scoped YNX Chain predeploy backup must not copy unrelated legacy runtime data"
  exit 1
fi
grep -Fq "/var/lib/ynx-chain" "$dry_run_out" || { echo "YNX Chain state path missing from predeploy backup"; exit 1; }
