#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

deploy_source="scripts/deploy/deploy-testnet.sh"
shop_staging_source="deploy/shop/install-staging-routes.py"
deploy_entries=("$deploy_source" "$shop_staging_source")

if grep -En '127\.0\.0\.1:(36657|38545|38546|39090|31317|3808[0-9]|3809[01])|ynx_9102-1|0x238e' "${deploy_entries[@]}"; then
  echo "executable deployment entrypoint still references the retired 9102 chain" >&2
  exit 1
fi

grep -Fq 'bridge.${WEBSITE_DOMAIN} {' "$deploy_source"
grep -Fq 'reverse_proxy 127.0.0.1:6433' "$deploy_source"
grep -Fq 'redir https://www.${WEBSITE_DOMAIN}{uri} 302' "$deploy_source"
grep -Fq 'respond "YNX Testnet 6423 gRPC endpoint is not available" 503' "$deploy_source"
grep -Fq 'respond "YNX Testnet 6423 EVM WebSocket endpoint is not available" 503' "$deploy_source"

grep -Fq 'import /etc/caddy/shop-staging.routes' "$shop_staging_source"
grep -Fq 'redir https://www.ynxweb4.com{uri} 302' "$shop_staging_source"

echo "CHAIN_6423_INGRESS_SOURCE_CHECK_PASS"
