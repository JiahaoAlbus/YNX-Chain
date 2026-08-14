#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  printf 'run as root\n' >&2
  exit 1
fi

snippet="${1:-}"
[[ -f "$snippet" ]] || {
  printf 'usage: %s /path/to/ynx-evm-rpc.caddy\n' "$0" >&2
  exit 1
}

source_config="/etc/caddy/ynx-chain.caddy"
root_config="/etc/caddy/Caddyfile"
work_dir="$(mktemp -d /tmp/ynx-evm-cors.XXXXXX)"
chmod 0700 "$work_dir"
trap 'rm -rf "$work_dir"' EXIT

candidate="$work_dir/ynx-chain.caddy"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/var/backups/ynx-chain/caddy/ynx-chain.caddy-pre-evm-cors-$timestamp"

old_header='testnet.ynxweb4.com, testnet.ynxweb4.com, rpc.ynxweb4.com, evm.ynxweb4.com {'
[[ "$(grep -Fxc "$old_header" "$source_config")" == "1" ]] || {
  printf 'expected shared RPC block header exactly once\n' >&2
  exit 1
}

awk -v old_header="$old_header" -v snippet="$snippet" '
  $0 == old_header {
    print "testnet.ynxweb4.com, testnet.ynxweb4.com, rpc.ynxweb4.com {"
    print "  reverse_proxy 127.0.0.1:6420"
    print "}"
    print ""
    while ((getline line < snippet) > 0) print line
    close(snippet)
    skip = 2
    next
  }
  skip > 0 { skip--; next }
  { print }
' "$source_config" >"$candidate"

caddy validate --config "$candidate" --adapter caddyfile
install -d -o root -g root -m 0700 "$(dirname "$backup")"
install -o root -g root -m 0600 "$source_config" "$backup"

rollback() {
  install -o root -g root -m 0644 "$backup" "$source_config"
  caddy validate --config "$root_config"
  systemctl reload caddy
}

install -o root -g root -m 0644 "$candidate" "$source_config"
if ! caddy validate --config "$root_config" || ! systemctl reload caddy; then
  rollback
  printf 'deployment failed; rollback restored %s\n' "$backup" >&2
  exit 1
fi

probe() {
  curl --silent --show-error --max-time 15 --resolve evm.ynxweb4.com:443:127.0.0.1 "$@" https://evm.ynxweb4.com/
}

official_headers="$work_dir/official.headers"
official_status="$(probe --dump-header "$official_headers" --output /dev/null --request OPTIONS \
  --header 'Origin: https://www.ynxweb4.com' \
  --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: Content-Type' \
  --write-out '%{http_code}')"
hostile_status="$(probe --output /dev/null --request OPTIONS \
  --header 'Origin: https://hostile.invalid' \
  --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: Content-Type' \
  --write-out '%{http_code}')"
rpc_body="$work_dir/rpc.json"
rpc_status="$(probe --dump-header "$work_dir/rpc.headers" --output "$rpc_body" --request POST \
  --header 'Origin: https://www.ynxweb4.com' \
  --header 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  --write-out '%{http_code}')"

if [[ "$official_status" != "204" ]] ||
   [[ "$hostile_status" != "403" ]] ||
   [[ "$rpc_status" != "200" ]] ||
   ! grep -Fqi 'access-control-allow-origin: https://www.ynxweb4.com' "$official_headers" ||
   ! grep -Fq '"result":"0x1917"' "$rpc_body"; then
  rollback
  printf 'post-reload gate failed; rollback restored %s\n' "$backup" >&2
  exit 1
fi

printf 'deployment=passed backup=%s official_preflight=%s hostile_preflight=%s rpc_status=%s chain_id=0x1917 source_sha256=' \
  "$backup" "$official_status" "$hostile_status" "$rpc_status"
sha256sum "$source_config" | cut -d' ' -f1
