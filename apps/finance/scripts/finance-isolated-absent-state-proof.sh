#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <host-native-finance-binary> <web-directory> <output-directory>" >&2
  exit 64
fi

binary=$1
web_dir=$2
output_dir=$3
state_dir="$output_dir/state"
state_path="$state_dir/state.json"
mock_port_file="$output_dir/mock-port"
candidate_pid=''
mock_pid=''

cleanup() {
  if [[ -n "$candidate_pid" ]]; then kill "$candidate_pid" 2>/dev/null || true; wait "$candidate_pid" 2>/dev/null || true; fi
  if [[ -n "$mock_pid" ]]; then kill "$mock_pid" 2>/dev/null || true; wait "$mock_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

test -x "$binary"
test -d "$web_dir"
mkdir -p "$state_dir"
test ! -e "$state_path" && test ! -L "$state_path"

node - "$state_path" "$output_dir/pre-switch-absence.json" <<'NODE'
const fs=require('fs');
const [path,out]=process.argv.slice(2);
if(fs.existsSync(path)) process.exit(1);
fs.writeFileSync(out,JSON.stringify({schemaVersion:1,kind:'pre-switch-absence',path,absent:true,observedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
NODE

node - "$mock_port_file" <<'NODE' &
const fs=require('fs'),http=require('http');
const portFile=process.argv[2];
const body=JSON.stringify({ok:true,result:{active:true,session:{verifierVersion:'wallet-auth-v1',sessionBinding:'a'.repeat(64),productClientId:'ynx-finance-v1',bundleId:'com.ynxweb4.finance',requestDigest:'b'.repeat(64),account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',scopes:['finance.portfolio.read','finance.profile.write'],expiresAt:'2099-01-01T00:00:00Z'}}});
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(body)}).listen(0,'127.0.0.1',function(){fs.writeFileSync(portFile,String(this.address().port))});
NODE
mock_pid=$!
for _ in {1..100}; do [[ -s "$mock_port_file" ]] && break; sleep 0.05; done
test -s "$mock_port_file"
mock_port=$(cat "$mock_port_file")
listen_port=6497

YNX_FINANCE_STATE_PATH="$state_path" \
YNX_EXPLORER_URL="http://127.0.0.1:$mock_port" \
YNX_FINANCE_DISPUTE_URL="http://127.0.0.1:$mock_port/dispute" \
YNX_FINANCE_WALLET_GATEWAY_URL="http://127.0.0.1:$mock_port" \
YNX_FINANCE_INTERNAL_KEY='isolated-proof-internal-key-32-bytes' \
YNX_FINANCE_HELP_URL="http://127.0.0.1:$mock_port/help" \
YNX_FINANCE_PRIVACY_URL="http://127.0.0.1:$mock_port/privacy" \
YNX_FINANCE_CURSOR_SIGNING_KEY='isolated-proof-cursor-key-at-least-32' \
YNX_FINANCE_OPERATIONS_KEY='isolated-proof-operations-key-32bytes' \
YNX_FINANCE_WEB_DIR="$web_dir" \
YNX_FINANCE_ALLOWED_ORIGINS="http://127.0.0.1:$listen_port" \
YNX_FINANCE_LISTEN="127.0.0.1:$listen_port" \
"$binary" >"$output_dir/candidate.log" 2>&1 &
candidate_pid=$!

for _ in {1..100}; do
  if curl --fail --silent --show-error --max-time 1 "http://127.0.0.1:$listen_port/health" >"$output_dir/cold-health.json" 2>/dev/null; then break; fi
  sleep 0.05
done
test -s "$output_dir/cold-health.json"
curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$listen_port/version" >"$output_dir/cold-version.json"

node - "$state_path" "$output_dir/post-cold-absence.json" <<'NODE'
const fs=require('fs'); const [path,out]=process.argv.slice(2);
if(fs.existsSync(path)) process.exit(1);
fs.writeFileSync(out,JSON.stringify({schemaVersion:1,kind:'post-cold-start-absence',path,absent:true,observedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
NODE

curl --fail --silent --show-error --max-time 3 \
  -H "Origin: http://127.0.0.1:$listen_port" \
  -H 'Content-Type: application/json' \
  -H 'X-YNX-Product-Session-Proof: isolated-test-proof' \
  --data '{"name":"Isolated rollback proof","color":"#002FA7","idempotencyKey":"isolated-absence-proof-0001"}' \
  "http://127.0.0.1:$listen_port/api/categories" >"$output_dir/candidate-write.json"

test -f "$state_path"
node - "$state_path" "$output_dir/candidate-created-state.json" <<'NODE'
const fs=require('fs'),crypto=require('crypto'); const [path,out]=process.argv.slice(2),s=fs.lstatSync(path),raw=fs.readFileSync(path);
fs.writeFileSync(out,JSON.stringify({schemaVersion:1,kind:'candidate-created-state',path,device:String(s.dev),inode:String(s.ino),uid:s.uid,gid:s.gid,mode:(s.mode&0o777).toString(8),nlink:s.nlink,bytes:s.size,sha256:crypto.createHash('sha256').update(raw).digest('hex'),observedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
NODE

kill "$candidate_pid"
wait "$candidate_pid" 2>/dev/null || true
candidate_pid=''

node - "$output_dir/candidate-stopped.json" <<'NODE'
const fs=require('fs'); const out=process.argv[2];
fs.writeFileSync(out,JSON.stringify({schemaVersion:1,kind:'candidate-stopped',stopped:true,observedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
NODE
bash "$(dirname "$0")/finance-absent-state-rollback-command.sh" "$state_path" "$output_dir/candidate-created-state.json" "$output_dir/candidate-stopped.json" "$output_dir"

node - "$output_dir" <<'NODE'
const fs=require('fs'),crypto=require('crypto'),path=require('path'); const dir=process.argv[2];
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')).sort();
const items=files.map(file=>{const raw=fs.readFileSync(path.join(dir,file));return {file,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
fs.writeFileSync(path.join(dir,'receipt-manifest.json'),JSON.stringify({schemaVersion:1,classification:'isolated-host-native-source-equivalent-cold-start',files:items},null,2)+'\n',{mode:0o600});
NODE
