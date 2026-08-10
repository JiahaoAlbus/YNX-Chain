#!/bin/sh
set -eu

region=${1:?region is required}
samples=${2:-100}
parallel=${3:-32}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for service in wallet exchange quant; do
  case "$service" in
    wallet) url=https://wallet-auth.ynxweb4.com/health ;;
    exchange) url=https://exchange.ynxweb4.com/api/health ;;
    quant) url=https://quant.ynxweb4.com/api/v1/snapshot ;;
  esac
  export region service url
  seq 1 "$samples" | xargs -P "$parallel" -I{} sh -c '
    if [ "$service" = quant ]; then
      tenant=$(printf "%s-%s" "$region" "{}" | sha256sum | awk "{print \$1}")
      code=$(curl -sS --max-time 15 -o /dev/null -w "%{http_code}" -H "X-YNX-Tenant-ID: $tenant" "$url")
    else
      code=$(curl -sS --max-time 15 -o /dev/null -w "%{http_code}" "$url")
    fi
    printf "%s\n" "$code"
  ' > "$work/$service"
  ok=$(grep -c '^200$' "$work/$service" || true)
  test "$ok" = "$samples"
  printf '%s=%s/%s ' "$service" "$ok" "$samples"
done
printf '\n'
