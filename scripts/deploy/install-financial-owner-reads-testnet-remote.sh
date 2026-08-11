#!/usr/bin/env bash
set -euo pipefail

release_root="${1:?missing release root}"
source_commit="${2:?missing source commit}"
exchange_sha="${3:?missing Exchange digest}"
quant_sha="${4:?missing Quant digest}"
[[ "$(id -u)" == "0" ]] || { echo "installer must run as root" >&2; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source commit" >&2; exit 1; }
[[ "$exchange_sha" =~ ^[0-9a-f]{64}$ && "$quant_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid binary digest" >&2; exit 1; }
[[ -d "$release_root" && ! -L "$release_root" ]] || { echo "unsafe release root" >&2; exit 1; }
for command in curl node runuser sha256sum systemctl; do command -v "$command" >/dev/null; done
id -u ynx >/dev/null
(
  cd "$release_root"
  sha256sum -c SHA256SUMS
)
[[ "$(sha256sum "$release_root/exchange/bin/ynx-exchanged" | awk '{print $1}')" == "$exchange_sha" ]]
[[ "$(sha256sum "$release_root/quant/ynx-quant" | awk '{print $1}')" == "$quant_sha" ]]

exchange_env=/etc/ynx/exchange.env
quant_env=/etc/ynx/ynx-quant.env
finance_env=/etc/ynx/finance.env
for file in "$exchange_env" "$quant_env" "$finance_env"; do [[ -s "$file" && ! -L "$file" ]] || { echo "missing or unsafe environment: $file" >&2; exit 1; }; done
set -a
# shellcheck disable=SC1090
. "$exchange_env"
# shellcheck disable=SC1090
. "$quant_env"
set +a
for key in YNX_EXCHANGE_ADMIN_API_KEY YNX_EXCHANGE_FINANCE_READ_KEY YNX_QUANT_FINANCE_READ_KEY; do [[ -n "${!key:-}" ]] || { echo "$key is missing" >&2; exit 1; }; done

verify_owner_read() {
  OWNER="$1" PORT="$2" KEY="$3" COMMIT="$source_commit" node <<'NODE'
const http=require('http'),crypto=require('crypto');
const owner=process.env.OWNER,path='/v1/integrations/finance/account';
const account='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
const timestamp=new Date().toISOString(),nonce=crypto.randomBytes(16).toString('hex');
const canonical=['YNX_READ_INTEGRATION_V1','finance',owner,'GET',path,account,timestamp,nonce].join('\n');
const signature=crypto.createHmac('sha256',process.env.KEY).update(canonical).digest('hex');
const req=http.get({hostname:'127.0.0.1',port:Number(process.env.PORT),path,headers:{'X-YNX-Read-Consumer':'finance','X-YNX-Read-Account':account,'X-YNX-Read-Timestamp':timestamp,'X-YNX-Read-Nonce':nonce,'X-YNX-Read-Signature':signature}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{try{const value=JSON.parse(body);if(res.statusCode!==200||value.sourceId!==owner||value.authorizedAccount!==account||value.readOnly!==true||value.payload?.buildCommit!==process.env.COMMIT)process.exit(1)}catch{process.exit(1)}})});
req.setTimeout(5000,()=>req.destroy(new Error('timeout')));req.on('error',()=>process.exit(1));
NODE
}

preflight_dir="$(mktemp -d /var/lib/ynx-exchange/.financial-preflight.XXXXXX)"
exchange_log=/tmp/ynx-exchange-financial-preflight.log
quant_log=/tmp/ynx-quant-financial-preflight.log
exchange_state="$preflight_dir/exchange.json"
quant_state="$preflight_dir/quant.json"
if [[ -s /var/lib/ynx-exchange/state.json ]]; then cp -a /var/lib/ynx-exchange/state.json "$exchange_state"; fi
if [[ -s /var/lib/ynx-quant/quant.json ]]; then cp -a /var/lib/ynx-quant/quant.json "$quant_state"; fi
if [[ -d /var/lib/ynx-quant/quant.json.tenants ]]; then
  mkdir -p "$quant_state.tenants"
  cp -a /var/lib/ynx-quant/quant.json.tenants/. "$quant_state.tenants/"
fi
chown -R ynx:ynx "$preflight_dir"
cleanup() {
  for pid in "${quant_pid:-}" "${exchange_pid:-}"; do [[ -z "$pid" ]] || { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }; done
  rm -rf "$preflight_dir" "$exchange_log" "$quant_log"
}
trap cleanup EXIT

export YNX_EXCHANGE_HTTP_ADDR=127.0.0.1:17446 YNX_EXCHANGE_STATE_PATH="$exchange_state" YNX_EXCHANGE_DEPLOYED_PUBLIC=true
runuser -u ynx --preserve-environment -- bash -c 'cd "$1" && exec "$2"' _ "$release_root/exchange" "$release_root/exchange/bin/ynx-exchanged" >"$exchange_log" 2>&1 &
exchange_pid=$!
exchange_ok=0
for _ in $(seq 1 30); do
  if health="$(curl -fsS --max-time 2 http://127.0.0.1:17446/api/health 2>/dev/null)" && ready="$(curl -fsS --max-time 2 http://127.0.0.1:17446/api/ready 2>/dev/null)" && HEALTH="$health" READY="$ready" COMMIT="$source_commit" node -e 'const h=JSON.parse(process.env.HEALTH),r=JSON.parse(process.env.READY);if(h.commit!==process.env.COMMIT||h.productId!=="ynx-exchange"||r.status!=="ready_public_testnet"||r.deployedPublic!==true||r.stateIntegrity!==true)process.exit(1)' 2>/dev/null; then exchange_ok=1; break; fi
  sleep 1
done
[[ "$exchange_ok" == 1 ]] || { tail -80 "$exchange_log" >&2; exit 1; }
verify_owner_read exchange 17446 "$YNX_EXCHANGE_FINANCE_READ_KEY"

export YNX_QUANT_HTTP_ADDR=127.0.0.1:17444 YNX_QUANT_STATE_PATH="$quant_state" YNX_QUANT_EXCHANGE_URL=http://127.0.0.1:17446/api
runuser -u ynx --preserve-environment -- bash -c 'cd "$1" && exec "$2"' _ "$release_root/quant" "$release_root/quant/ynx-quant" >"$quant_log" 2>&1 &
quant_pid=$!
quant_ok=0
for _ in $(seq 1 30); do
  if health="$(curl -fsS --max-time 2 http://127.0.0.1:17444/api/health 2>/dev/null)" && HEALTH="$health" COMMIT="$source_commit" node -e 'const h=JSON.parse(process.env.HEALTH);if(h.commit!==process.env.COMMIT||h.productId!=="ynx-quant-lab"||h.ready!==true||h.liveFundsEnabled!==false)process.exit(1)' 2>/dev/null; then quant_ok=1; break; fi
  sleep 1
done
[[ "$quant_ok" == 1 ]] || { tail -80 "$quant_log" >&2; exit 1; }
verify_owner_read quant 17444 "$YNX_QUANT_FINANCE_READ_KEY"
cleanup
trap - EXIT

exchange_current=/opt/ynx/exchange
exchange_binary=/usr/local/bin/ynx-exchanged
quant_current=/opt/ynx-quant/current
old_exchange_target="$(readlink -f "$exchange_current")"
old_quant_target="$(readlink -f "$quant_current")"
backup="/var/backups/ynx-financial-owner-reads/$(date -u +%Y%m%dT%H%M%SZ)-${source_commit:0:12}"
install -d -o root -g root -m 0700 "$backup"
cp -a "$exchange_binary" "$backup/ynx-exchanged"
cp -a "$exchange_env" "$backup/exchange.env"
cp -a "$quant_env" "$backup/ynx-quant.env"
cp -a "$finance_env" "$backup/finance.env"
printf '%s\n' "$old_exchange_target" >"$backup/exchange-target"
printf '%s\n' "$old_quant_target" >"$backup/quant-target"

rollback_required=1
rollback() {
  if [[ "$rollback_required" == 1 ]]; then
    ln -sfn "$old_exchange_target" "$exchange_current.rollback"; mv -Tf "$exchange_current.rollback" "$exchange_current"
    ln -sfn "$old_quant_target" "$quant_current.rollback"; mv -Tf "$quant_current.rollback" "$quant_current"
    install -m 0755 "$backup/ynx-exchanged" "$exchange_binary"
    cp -a "$backup/exchange.env" "$exchange_env"
    cp -a "$backup/ynx-quant.env" "$quant_env"
    cp -a "$backup/finance.env" "$finance_env"
    systemctl restart ynx-exchange.service ynx-quant.service ynx-finance.service || true
  fi
}
trap rollback EXIT

ln -sfn "$release_root/exchange" "$exchange_current.next"; mv -Tf "$exchange_current.next" "$exchange_current"
ln -sfn "$release_root/exchange/bin/ynx-exchanged" "$exchange_binary.next"; mv -Tf "$exchange_binary.next" "$exchange_binary"
ln -sfn "$release_root/quant" "$quant_current.next"; mv -Tf "$quant_current.next" "$quant_current"
systemctl restart ynx-exchange.service
systemctl restart ynx-quant.service
systemctl restart ynx-finance.service

runtime_ok=0
for _ in $(seq 1 40); do
  exchange_health="$(curl -fsS --max-time 3 http://127.0.0.1:18446/api/health 2>/dev/null || true)"
  quant_health="$(curl -fsS --max-time 3 http://127.0.0.1:18444/api/health 2>/dev/null || true)"
  finance_version="$(curl -fsS --max-time 3 http://127.0.0.1:6483/version 2>/dev/null || true)"
  if EXCHANGE="$exchange_health" QUANT="$quant_health" FINANCE="$finance_version" COMMIT="$source_commit" node -e 'const e=JSON.parse(process.env.EXCHANGE),q=JSON.parse(process.env.QUANT),f=JSON.parse(process.env.FINANCE);if(e.commit!==process.env.COMMIT||q.commit!==process.env.COMMIT||f.commit.length!==40||!q.ready)process.exit(1)' 2>/dev/null; then runtime_ok=1; break; fi
  sleep 1
done
[[ "$runtime_ok" == 1 ]] || { systemctl status ynx-exchange.service ynx-quant.service ynx-finance.service --no-pager -l >&2 || true; exit 1; }
verify_owner_read exchange 18446 "$YNX_EXCHANGE_FINANCE_READ_KEY"
verify_owner_read quant 18444 "$YNX_QUANT_FINANCE_READ_KEY"
rollback_required=0
trap - EXIT
printf 'financialOwnerReadDeploy=passed\nsourceCommit=%s\nexchangeSha256=%s\nquantSha256=%s\nbackup=%s\n' "$source_commit" "$exchange_sha" "$quant_sha" "$backup"
