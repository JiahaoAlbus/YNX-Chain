#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 6 ]]; then
  echo "usage: $0 <signed-carrier-root> <signed-archive-basename> <signed-carrier-stat> <signed-archive-stat> <signed-run-directory> <signed-loopback-port>" >&2
  exit 64
fi

carrier_root=$1
archive_name=$2
carrier_stat=$3
archive_stat=$4
run_dir=$5
port=$6
archive_sha=d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d
binary_sha=cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e
run_root=/opt/ynx/preflight/finance/runs
artifact_root=/opt/ynx/preflight/finance/artifacts
candidate_pid=''
mock_pid=''

case "$carrier_root" in "$artifact_root"/*) ;; *) exit 65;; esac
carrier_name=${carrier_root#"$artifact_root"/}
case "$carrier_name" in p0[0-9][0-9][0-9]|p0[0-9][0-9][0-9][0-9]* ) ;; *) exit 65;; esac
test "$archive_name" = ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz
for signed_stat in "$carrier_stat" "$archive_stat"; do [[ "$signed_stat" =~ ^[0-9]+:[0-9]+:[0-7]{3,4}:[1-9][0-9]*$ ]] || exit 65; done
test -d "$artifact_root" && test ! -L "$artifact_root"
test -d "$carrier_root" && test ! -L "$carrier_root"
artifact_root_real=$(realpath -e "$artifact_root")
carrier_root_real=$(realpath -e "$carrier_root")
test "$carrier_root_real" = "$artifact_root_real/$carrier_name"
test "$(stat -Lc '%u:%g:%a:%h' "$carrier_root")" = "$carrier_stat"
carrier_digest_dir="$carrier_root/sha256-$archive_sha"
test -d "$carrier_digest_dir" && test ! -L "$carrier_digest_dir"
test "$(realpath -e "$carrier_digest_dir")" = "$carrier_root_real/sha256-$archive_sha"
archive="$carrier_digest_dir/$archive_name"
test -f "$archive" && test ! -L "$archive"
test "$(realpath -e "$archive")" = "$carrier_root_real/sha256-$archive_sha/$archive_name"
test "$(stat -Lc '%u:%g:%a:%h' "$archive")" = "$archive_stat"
case "$run_dir" in "$run_root"/*) ;; *) exit 65;; esac
case "$port" in *[!0-9]*|'') exit 65;; esac
test "$port" -ge 1024 && test "$port" -le 65535
test "$(uname -m)" = x86_64
test "$(sha256sum "$archive" | awk '{print $1}')" = "$archive_sha"
test ! -e "$run_dir" && test ! -L "$run_dir"
if command -v ss >/dev/null 2>&1; then
  ! ss -ltn "sport = :$port" | grep -q ":$port"
elif command -v lsof >/dev/null 2>&1; then
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
else
  echo "requires ss or lsof to prove the signed loopback port is free" >&2
  exit 69
fi
mkdir -p "$run_dir"
chmod 0700 "$run_dir"

cleanup() {
  if [[ -n "$candidate_pid" ]]; then kill "$candidate_pid" 2>/dev/null || true; wait "$candidate_pid" 2>/dev/null || true; fi
  if [[ -n "$mock_pid" ]]; then kill "$mock_pid" 2>/dev/null || true; wait "$mock_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

tar -xzf "$archive" -C "$run_dir"
release="$run_dir/ynx-finance-7824af677dd0"
test -d "$release" && test ! -L "$release"
test -x "$release/ynx-finance"
test "$(sha256sum "$release/ynx-finance" | awk '{print $1}')" = "$binary_sha"
(cd "$release" && sha256sum -c SHA256SUMS)

state_path="$run_dir/state/state.json"
receipt_dir="$run_dir/receipts"
mock_port_file="$run_dir/mock-port"
mkdir -p "$receipt_dir" "$run_dir/state"
test ! -e "$state_path" && test ! -L "$state_path"
python3 - "$state_path" "$receipt_dir/pre-switch-absence.json" <<'PY'
import json, os, sys, time
path, out = sys.argv[1:]
if os.path.lexists(path): raise SystemExit(1)
with open(out, 'x', encoding='utf-8') as f: json.dump({'schemaVersion':1,'kind':'pre-switch-absence','path':path,'absent':True,'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}, f, indent=2); f.write('\n')
os.chmod(out, 0o600)
PY

python3 - "$mock_port_file" <<'PY' &
import http.server, json, socketserver, sys
port_file=sys.argv[1]
class Handler(http.server.BaseHTTPRequestHandler):
  def do_POST(self):
    body=json.dumps({'ok':True,'result':{'active':True,'session':{'verifierVersion':'wallet-auth-v1','sessionBinding':'a'*64,'productClientId':'ynx-finance-v1','bundleId':'com.ynxweb4.finance','requestDigest':'b'*64,'account':'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80','scopes':['finance.portfolio.read','finance.profile.write'],'expiresAt':'2099-01-01T00:00:00Z'}}}).encode()
    self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
  do_GET=do_POST
  def log_message(self, *args): pass
with socketserver.TCPServer(('127.0.0.1',0),Handler) as server:
  open(port_file,'w',encoding='utf-8').write(str(server.server_address[1]))
  server.serve_forever()
PY
mock_pid=$!
for _ in $(seq 1 100); do test -s "$mock_port_file" && break; sleep 0.05; done
test -s "$mock_port_file"
mock_port=$(cat "$mock_port_file")
listen=127.0.0.1:$port

YNX_FINANCE_STATE_PATH="$state_path" YNX_EXPLORER_URL="http://127.0.0.1:$mock_port" YNX_FINANCE_DISPUTE_URL="http://127.0.0.1:$mock_port/dispute" YNX_FINANCE_WALLET_GATEWAY_URL="http://127.0.0.1:$mock_port" YNX_FINANCE_INTERNAL_KEY='isolated-proof-internal-key-32-bytes' YNX_FINANCE_HELP_URL="http://127.0.0.1:$mock_port/help" YNX_FINANCE_PRIVACY_URL="http://127.0.0.1:$mock_port/privacy" YNX_FINANCE_CURSOR_SIGNING_KEY='isolated-proof-cursor-key-at-least-32' YNX_FINANCE_OPERATIONS_KEY='isolated-proof-operations-key-32bytes' YNX_FINANCE_WEB_DIR="$release/web" YNX_FINANCE_ALLOWED_ORIGINS="http://$listen" YNX_FINANCE_LISTEN="$listen" "$release/ynx-finance" >"$receipt_dir/candidate.log" 2>&1 &
candidate_pid=$!
for _ in $(seq 1 100); do if curl --fail --silent --max-time 1 "http://$listen/health" >"$receipt_dir/cold-health.json" 2>/dev/null; then break; fi; sleep 0.05; done
test -s "$receipt_dir/cold-health.json"
curl --fail --silent --max-time 2 "http://$listen/version" >"$receipt_dir/cold-version.json"

python3 - "$state_path" "$receipt_dir/post-cold-absence.json" <<'PY'
import json, os, sys, time
path, out = sys.argv[1:]
if os.path.lexists(path): raise SystemExit(1)
with open(out, 'x', encoding='utf-8') as f: json.dump({'schemaVersion':1,'kind':'post-cold-start-absence','path':path,'absent':True,'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}, f, indent=2); f.write('\n')
os.chmod(out, 0o600)
PY

curl --fail --silent --max-time 3 -H "Origin: http://$listen" -H 'Content-Type: application/json' -H 'X-YNX-Product-Session-Proof: isolated-test-proof' --data '{"name":"Linux preflight rollback proof","color":"#002FA7","idempotencyKey":"linux-absence-proof-0001"}' "http://$listen/api/categories" >"$receipt_dir/candidate-write.json"
test -f "$state_path"
python3 - "$state_path" "$receipt_dir/candidate-created-state.json" <<'PY'
import hashlib, json, os, stat, sys, time
path, out = sys.argv[1:]; s=os.lstat(path); raw=open(path,'rb').read()
record={'schemaVersion':1,'kind':'candidate-created-state','path':path,'device':str(s.st_dev),'inode':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':format(stat.S_IMODE(s.st_mode),'o'),'nlink':s.st_nlink,'bytes':s.st_size,'sha256':hashlib.sha256(raw).hexdigest(),'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
with open(out,'x',encoding='utf-8') as f: json.dump(record,f,indent=2); f.write('\n')
os.chmod(out,0o600)
PY

kill "$candidate_pid"; wait "$candidate_pid" 2>/dev/null || true; candidate_pid=''
python3 - "$receipt_dir/candidate-stopped.json" <<'PY'
import json, os, sys, time
with open(sys.argv[1],'x',encoding='utf-8') as f: json.dump({'schemaVersion':1,'kind':'candidate-stopped','stopped':True,'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},f,indent=2); f.write('\n')
os.chmod(sys.argv[1],0o600)
PY
bash "$(dirname "$0")/finance-absent-state-rollback-command.sh" "$state_path" "$receipt_dir/candidate-created-state.json" "$receipt_dir/candidate-stopped.json" "$receipt_dir"

kill "$mock_pid"; wait "$mock_pid" 2>/dev/null || true; mock_pid=''
test ! -e "$state_path" && test ! -L "$state_path"
python3 - "$receipt_dir/cleanup.json" <<'PY'
import json, os, sys, time
with open(sys.argv[1],'x',encoding='utf-8') as f: json.dump({'schemaVersion':1,'kind':'preflight-cleanup','candidateStopped':True,'mockStopped':True,'stateAbsent':True,'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},f,indent=2); f.write('\n')
os.chmod(sys.argv[1],0o600)
PY
echo "PREFLIGHT_OK receipts=$receipt_dir" >"$receipt_dir/result.txt"

# The terminal receipt manifest is deliberately written last.  It covers only
# retained receipt files, never itself or a temporary manifest, and validates
# both every digest and the exact receipt-file set before reporting success.
(
  cd "$receipt_dir"
  find . -xdev -type f ! -name SHA256SUMS ! -name .SHA256SUMS.tmp -print0 \
    | LC_ALL=C sort -z | xargs -0 sha256sum > .SHA256SUMS.tmp
  mv -f .SHA256SUMS.tmp SHA256SUMS
)
python3 "$(dirname "$0")/verify-finance-receipt-manifest.py" "$receipt_dir"
