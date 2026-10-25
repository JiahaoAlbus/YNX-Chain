#!/usr/bin/env bash
set -Eeuo pipefail

# Source-only Linux fixtures. The actual helper runs against a new private
# root and synthetic /proc files. Every service/HTTP command is a local stub;
# these controls confer no running-source, public ingress or Root authority.
repo="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
base_path="$PATH"
fixture_number=0
fail() { echo "gateway ingress source fixture failed: $*" >&2; exit 1; }
hash() { sha256sum "$1" | awk '{print $1}'; }

write_config() {
  local port="$1" target="$2"
  cat >"$target" <<EOF
# Keep native example 127.0.0.1:6420 and candidate example 127.0.0.1:27620.
rpc.test.invalid, legacy-rpc.test.invalid, evm.test.invalid {
	reverse_proxy 127.0.0.1:$port # original RPC alias comment
}
api.test.invalid, ide.test.invalid {
  handle_path /indexer/* { reverse_proxy 127.0.0.1:6426 }
  handle_path /explorer/* { reverse_proxy 127.0.0.1:6427 }
  reverse_proxy 127.0.0.1:$port
}
unrelated.test.invalid {
  reverse_proxy 127.0.0.1:64201 # comment 127.0.0.1:6420
}
faucet.test.invalid {
  reverse_proxy 127.0.0.1:6428
}
ai.test.invalid {
  reverse_proxy 127.0.0.1:6429
}
pay.test.invalid {
  reverse_proxy 127.0.0.1:6430
}
trust.test.invalid {
  reverse_proxy 127.0.0.1:6431
}
resource.test.invalid {
  reverse_proxy 127.0.0.1:6432
}
EOF
}

new_fixture() {
  export PATH="$base_path"
  fixture_number=$((fixture_number+1))
  root="$tmp/case-$fixture_number"
  mkdir -m 0700 "$root"
  export FIX_ROOT="$root" FIX_LOG="$root/commands.log"
  unset FIX_DROPIN FIX_FOREIGN_EXEC FIX_PROC_DENIED FIX_PID_RACE FIX_RESTART_TIMEOUT FIX_RESTART_WRONG_ARGV FIX_RELOAD_FAILURE FIX_HEALTH_WRONG FIX_CADDY_INVALID
  unset FIX_CADDY_DROPIN FIX_CADDY_START FIX_CADDY_RELOAD FIX_CADDY_PID_RACE FIX_CADDY_ADMIN_FAILURE FIX_CADDY_ADAPT_INVALID FIX_CADDY_SECOND_READ
  unset FIX_CADDY_JSON FIX_JSON_SECOND_READ
  tx=protocol-gateway-ingress-fixture
  runtime_commit=0123456789abcdef0123456789abcdef01234567
  commit="${runtime_commit:0:12}"; release="ynx-bft-gateway-$commit"
  operator_pin="$(printf 'a%.0s' {1..64})"; runtime_pin="$(printf 'b%.0s' {1..64})"
  block_hash="$(printf 'c%.0s' {1..64})"
  evidence="$root/backups/public-bft-cutover/$tx"
  ingress="$evidence/ingress"
  env_root="$root/etc/ynx/public-bft-cutover/$tx"
  dependency="$root/var/lib/ynx-chain/public-bft-cutover/$tx/dependencies"
  attempt="$dependency/gateway-start-attempt"
  gateway="$root/var/lib/ynx-chain/consensus-candidate/bin/ynx-bft-gatewayd"
  unit="$root/etc/systemd/system/ynx-bft-gateway-candidate.service"
  launcher="$dependency/start-gateway.sh"
  candidate_env="$env_root/candidate.env"
  config="$root/etc/caddy/ynx-chain.caddy"; master="$root/etc/caddy/Caddyfile"
  mkdir -p "$root/test-bin" "$evidence" "$env_root" "$attempt" "$(dirname "$gateway")" "$(dirname "$unit")" "$root/etc/caddy" "$root/proc/4242" "$root/proc/6000" "$root/paused" "$root/usr/bin" "$root/usr/lib/systemd/system"
  chmod 0700 "$env_root" "$attempt"
  : >"$FIX_LOG"
  printf '4242\n' >"$root/pid"
  printf 'synthetic binary, never executed\n' >"$gateway"
  gateway_pin="$(hash "$gateway")"
  printf 'original gateway launcher snapshot\n' >"$launcher"
  printf '[Service]\nExecStart=/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash %s\n' "$launcher" >"$unit"
  printf 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false\nRETAIN_ORIGINAL_ENV=unchanged\n' >"$candidate_env"
  chmod 0640 "$candidate_env"
  cp "$launcher" "$attempt/start-gateway.sh"; cp "$unit" "$attempt/gateway.service"; cp "$candidate_env" "$attempt/candidate.env"
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","operatorPlanSHA256":"%s","runtimeCommit":"%s","runtimeSOURCEsha256":"%s","gatewaySHA256":"%s","status":"unknown","automaticRetry":false}\n' "$tx" "$commit" "$release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" >"$attempt/intent.json"
  chmod 0600 "$attempt/intent.json"
  ln -s "$gateway" "$root/proc/4242/exe"
  printf '%s\0' "$gateway" --http 127.0.0.1:27620 --comet-rpc http://127.0.0.1:27757 --migration-height 17 --migration-block-hash "$block_hash" --public-cutover-authorized=false >"$root/proc/4242/cmdline"
  printf '%s\0' PATH=/usr/bin:/bin "YNX_MUTATION_FREEZE_FILE=$root/var/lib/ynx-chain/mutation-freeze.json" >"$root/proc/4242/environ"
  printf '{"version":"YNX-SINGLE-APP-GATEWAY-START/v1","transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","migrationHeight":17,"migrationBlockHash":"%s","operatorPlanSHA256":"%s","runtimeCommit":"%s","runtimeSOURCEsha256":"%s","gatewaySHA256":"%s","unitSHA256":"%s","launcherSHA256":"%s","environmentSHA256":"%s","mainPid":"4242","runningExecutableSHA256":"%s","runningExecutableDeviceInode":"%s","dependenciesActive":true,"parallelCandidateOnly":true,"publicIngressChanged":false,"pqActivationVerified":false,"reused":false}\n' "$tx" "$commit" "$release" "$block_hash" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$(hash "$unit")" "$(hash "$launcher")" "$(hash "$candidate_env")" "$gateway_pin" "$(stat -Lc '%d:%i' "$root/proc/4242/exe")" >"$evidence/primary-dependencies-start.json"
  cp "$evidence/primary-dependencies-start.json" "$env_root/ownership.json"
  chmod 0600 "$evidence/primary-dependencies-start.json" "$env_root/ownership.json"
  write_config 6420 "$config"; write_config 27620 "$root/expected.caddy"
  printf '# original master, preserved exactly\nimport %s\n' "$config" >"$master"
  cp "$config" "$root/original.caddy"; cp "$master" "$root/original.master"; cp "$candidate_env" "$root/original.env"
  printf 'synthetic Caddy binary, never executed\n' >"$root/usr/bin/caddy"
  printf '[Service]\nUser=caddy\nGroup=caddy\nExecStart=%s run --environ --config %s\nExecReload=%s reload --config %s --force\n' "$root/usr/bin/caddy" "$master" "$root/usr/bin/caddy" "$master" >"$root/usr/lib/systemd/system/caddy.service"
  ln -s "$root/usr/bin/caddy" "$root/proc/6000/exe"
  printf '%s\0' "$root/usr/bin/caddy" run --environ --config "$master" >"$root/proc/6000/cmdline"
  for name in ai pay trust resource faucet indexer explorer HRS ledger UNKNOWN; do printf 'retained-%s-original\n' "$name" >"$root/paused/$name"; done
  printf 'original mutation freeze\n' >"$root/var/lib/ynx-chain/mutation-freeze.json"
  printf 'original writer pause\n' >"$root/var/lib/ynx-chain/block-production-pause.json"
  sha256sum "$root/paused/"* "$root/var/lib/ynx-chain/"*.json "$evidence/primary-dependencies-start.json" "$env_root/ownership.json" "$attempt/"* "$root/usr/lib/systemd/system/caddy.service" "$root/usr/bin/caddy" >"$root/preserved.sha256"
  cat >"$root/test-bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >>"$FIX_LOG"
tx=protocol-gateway-ingress-fixture
dep="$FIX_ROOT/var/lib/ynx-chain/public-bft-cutover/$tx/dependencies"
unit=ynx-bft-gateway-candidate.service
case "$1" in
  is-active) [[ "${*: -1}" == caddy || "${*: -1}" == "$unit" ]] ;;
  show)
    [[ "$#" == 5 && "$2" == -p && "$4" == --value ]]
    if [[ "$5" == caddy.service ]]; then
      binary="$FIX_ROOT/usr/bin/caddy"; master="$FIX_ROOT/etc/caddy/Caddyfile"
      [[ "${FIX_CADDY_JSON:-}" != yes ]] || master="$FIX_ROOT/etc/caddy/ynx-chain.json"
      case "$3" in
        FragmentPath) printf '%s\n' "$FIX_ROOT/usr/lib/systemd/system/caddy.service" ;;
        DropInPaths) if [[ "${FIX_CADDY_DROPIN:-}" == yes ]]; then echo /unapproved/caddy-dropin.conf; elif [[ "${FIX_CADDY_JSON:-}" == yes ]]; then echo "$FIX_ROOT/etc/systemd/system/caddy.service.d/ynx-chain-json.conf"; fi ;;
        User|Group) echo caddy ;;
        ExecStart) if [[ "${FIX_CADDY_START:-}" == yes ]]; then printf '{ path=%s ; argv[]=%s run --resume ; ignore_errors=no ; }\n' "$binary" "$binary"; else printf '{ path=%s ; argv[]=%s run --environ --config %s ; ignore_errors=no ; }\n' "$binary" "$binary" "$master"; fi ;;
        ExecReload) if [[ "${FIX_CADDY_RELOAD:-}" == yes ]]; then master="$FIX_ROOT/etc/caddy/foreign-master"; fi; printf '{ path=%s ; argv[]=%s reload --config %s --force ; ignore_errors=no ; }\n' "$binary" "$binary" "$master" ;;
        MainPID) if [[ "${FIX_CADDY_PID_RACE:-}" == yes && -f "$FIX_ROOT/caddy-pid-read" ]]; then echo 6001; else echo 6000; : >"$FIX_ROOT/caddy-pid-read"; fi ;;
        *) exit 91 ;;
      esac
      exit 0
    fi
    [[ "$5" == "$unit" ]]
    case "$3" in
      FragmentPath) printf '%s\n' "$FIX_ROOT/etc/systemd/system/$unit" ;;
      DropInPaths) [[ "${FIX_DROPIN:-}" != yes ]] || echo /unapproved/dropin.conf ;;
      ExecStart) if [[ "${FIX_FOREIGN_EXEC:-}" == yes ]]; then echo '{ path=/unapproved ; argv[]=/unapproved ; }'; else printf '{ path=/usr/bin/env ; argv[]=/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash %s/start-gateway.sh ; ignore_errors=no ; }\n' "$dep"; fi ;;
      MainPID) if [[ "${FIX_PID_RACE:-}" == yes && -f "$FIX_ROOT/pid-read" ]]; then echo 4243; else cat "$FIX_ROOT/pid"; : >"$FIX_ROOT/pid-read"; fi ;;
      *) exit 91 ;;
    esac ;;
  restart)
    [[ "$#" == 2 && "$2" == "$unit" ]]
    pid=$(( $(cat "$FIX_ROOT/pid")+1 )); printf '%s\n' "$pid" >"$FIX_ROOT/pid"
    mkdir "$FIX_ROOT/proc/$pid"
    binary="$FIX_ROOT/var/lib/ynx-chain/consensus-candidate/bin/ynx-bft-gatewayd"
    ln -s "$binary" "$FIX_ROOT/proc/$pid/exe"
    auth="$(sed -n 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=//p' "$FIX_ROOT/etc/ynx/public-bft-cutover/$tx/candidate.env")"
    [[ "${FIX_RESTART_WRONG_ARGV:-}" != yes ]] || auth=false
    printf '%s\0' "$binary" --http 127.0.0.1:27620 --comet-rpc http://127.0.0.1:27757 --migration-height 17 --migration-block-hash "$(printf 'c%.0s' {1..64})" "--public-cutover-authorized=$auth" >"$FIX_ROOT/proc/$pid/cmdline"
    cp "$FIX_ROOT/proc/4242/environ" "$FIX_ROOT/proc/$pid/environ"
    [[ "${FIX_RESTART_TIMEOUT:-}" != yes ]] || exit 124 ;;
  reload)
    [[ "$#" == 2 && "$2" == caddy ]]; [[ "${FIX_RELOAD_FAILURE:-}" != yes ]] || exit 77
    if [[ "${FIX_CADDY_JSON:-}" == yes ]]; then cp "$FIX_ROOT/etc/caddy/ynx-chain.json" "$FIX_ROOT/caddy-loaded.json.new"; else "$FIX_ROOT/test-bin/fixture-caddy-adapt" >"$FIX_ROOT/caddy-loaded.json.new"; fi
    mv "$FIX_ROOT/caddy-loaded.json.new" "$FIX_ROOT/caddy-loaded.json" ;;
  *) exit 92 ;;
esac
SH
  cat >"$root/test-bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl-stub %s\n' "$*" >>"$FIX_LOG"
if [[ "$*" == '--disable --request GET --noproxy * --max-redirs 0 --connect-timeout 5 --max-time 10 --max-filesize 16777216 -fsS http://127.0.0.1:2019/config/' ]]; then
  [[ "${FIX_CADDY_ADMIN_FAILURE:-}" != yes ]] || exit 22
  if [[ "${FIX_CADDY_JSON:-}" == yes ]]; then
    count=0; [[ ! -f "$FIX_ROOT/json-admin-count" ]] || read -r count <"$FIX_ROOT/json-admin-count"
    count=$((count+1)); printf '%s\n' "$count" >"$FIX_ROOT/json-admin-count"
    if [[ "$count" == 2 ]]; then
      case "${FIX_JSON_SECOND_READ:-}" in
        loaded) printf '{"apps":{"http":{"servers":{"foreign":{"routes":[]}}}}}\n' >"$FIX_ROOT/caddy-loaded.json" ;;
        config) printf '\n ' >>"$FIX_ROOT/etc/caddy/ynx-chain.json" ;;
        dropin) printf '# foreign retained\n' >>"$FIX_ROOT/etc/systemd/system/caddy.service.d/ynx-chain-json.conf" ;;
      esac
    fi
  fi
  cat "$FIX_ROOT/caddy-loaded.json"
  exit 0
fi
[[ "$*" == '--noproxy * --max-time 5 -fsS http://127.0.0.1:27620/health' ]]
auth="$(sed -n 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=//p' "$FIX_ROOT/etc/ynx/public-bft-cutover/protocol-gateway-ingress-fixture/candidate.env")"
commit=0123456789ab
[[ "${FIX_HEALTH_WRONG:-}" != yes ]] || commit=ffffffffffff
printf '{"ok":true,"service":"ynx-bft-gatewayd","mode":"cometbft-backed","publicCutoverReady":%s,"build":{"commit":"%s","release":"ynx-bft-gateway-0123456789ab"},"migrationHeight":17,"migrationBlockHash":"%s"}\n' "$auth" "$commit" "$(printf 'c%.0s' {1..64})"
SH
  cat >"$root/test-bin/caddy" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'caddy-stub %s\n' "$*" >>"$FIX_LOG"
if [[ "${FIX_CADDY_JSON:-}" == yes ]]; then
  [[ "$#" == 3 && "$1" == validate && "$2" == --config && "$3" == "$FIX_ROOT/"*.json ]]
  [[ "${FIX_CADDY_INVALID:-}" != yes ]] || exit 76
  exit 0
fi
[[ "$#" == 5 && "$2" == --config && "$3" == "$FIX_ROOT/"* && "$4" == --adapter && "$5" == caddyfile ]]
case "$1" in
  adapt)
    [[ "$3" == "$FIX_ROOT/etc/caddy/Caddyfile" ]]
    count=0; [[ ! -f "$FIX_ROOT/caddy-adapt-count" ]] || read -r count <"$FIX_ROOT/caddy-adapt-count"
    count=$((count+1)); printf '%s\n' "$count" >"$FIX_ROOT/caddy-adapt-count"
    if [[ "$count" == 2 ]]; then
      case "${FIX_CADDY_SECOND_READ:-}" in
        loaded) printf '{"apps":{"http":{"servers":{"unrelated":{"listen":[":443"],"routes":[]}}}}}\n' >"$FIX_ROOT/caddy-loaded.json" ;;
        managed) printf '# external writer preserved\n' >>"$FIX_ROOT/etc/caddy/ynx-chain.caddy" ;;
        unit) printf '# external unit writer preserved\n' >>"$FIX_ROOT/usr/lib/systemd/system/caddy.service" ;;
      esac
    fi
    if [[ "${FIX_CADDY_ADAPT_INVALID:-}" == yes ]]; then printf '{"apps":'; else "$FIX_ROOT/test-bin/fixture-caddy-adapt"; fi ;;
  validate) [[ "${FIX_CADDY_INVALID:-}" != yes ]] || exit 76 ;;
  *) exit 94 ;;
esac
SH
  # This fixture adapter derives a JSON route graph from the actual independent
  # disk inputs. The loaded admin body is a separate snapshot, never an equality
  # flag. It implements only the public fixture grammar, not Caddy validation.
  cat >"$root/test-bin/fixture-caddy-adapt" <<'SH'
#!/usr/bin/env python3
import json,os,re
root=os.environ['FIX_ROOT']
config=root+'/etc/caddy/ynx-chain.caddy'
with open(root+'/etc/caddy/Caddyfile') as f: master=f.read()
imports=[line.split('#',1)[0].split() for line in master.splitlines()]
if ['import',config] not in imports:
    servers={'stub':{'listen':[':80'],'routes':[{'handle':[{'handler':'file_server'}]}]}}
else:
    routes=[]; current=None
    with open(config) as f:
        for line in f:
            line=line.split('#',1)[0].strip()
            match=re.fullmatch(r'([A-Za-z0-9., -]+)\s+\{',line)
            if match:
                current={'match':[{'host':[x.strip() for x in match[1].split(',')]}],'handle':[]}
                routes.append(current)
            elif line=='}': current=None
            elif current is not None:
                upstreams=re.findall(r'127\.0\.0\.1:[0-9]+',line)
                if upstreams:
                    handler={'handler':'reverse_proxy','upstreams':[{'dial':x} for x in upstreams]}
                    prefix=re.search(r'handle_path\s+(\S+)',line)
                    if prefix: current['handle'].append({'handler':'subroute','routes':[{'match':[{'path':[prefix[1]]}],'handle':[handler]}]})
                    else: current['handle'].append(handler)
    servers={'srv0':{'listen':[':443'],'routes':routes}}
print(json.dumps({'apps':{'http':{'servers':servers}}},sort_keys=True))
SH
  cat >"$root/test-bin/timeout" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == 30s && "$2" == systemctl ]]
shift
exec "$FIX_ROOT/test-bin/systemctl" "${@:2}"
SH
  cat >"$root/test-bin/install" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'install-stub %s\n' "$*" >>"$FIX_LOG"
args=()
while (($#)); do case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done
[[ "${args[2]}" == "$FIX_ROOT/"* && "${args[3]}" == "$FIX_ROOT/"* ]]
exec /usr/bin/install "${args[@]}"
SH
  cat >"$root/test-bin/stat" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${FIX_PROC_DENIED:-}" == yes && "${*: -1}" == "$FIX_ROOT/proc/"* ]]; then echo 'fixture /proc identity permission denied' >&2; exit 13; fi
exec /usr/bin/stat "$@"
SH
  printf '#!/usr/bin/env bash\nexit 0\n' >"$root/test-bin/sleep"
  printf '#!/usr/bin/env bash\nexit 93 # no chown is expected\n' >"$root/test-bin/chown"
  chmod 0755 "$root/test-bin/"*
  export PATH="$root/test-bin:$base_path"
  "$root/test-bin/fixture-caddy-adapt" >"$root/caddy-loaded.json"
}

run_helper() {
  local operation="$1"
  set +e
  PUBLIC_BFT_INGRESS_SOURCE_TEST_ONLY=yes bash "$repo/scripts/ops/remote/public-bft-ingress.sh" "$operation" "$tx" "$commit" "$release" "$evidence" single-app-gateway "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$root" >"$root/result.out" 2>"$root/result.err"
  status=$?
  set -e
}
preserved() { sha256sum --strict -c "$root/preserved.sha256" >/dev/null || fail 'original source/paused data/freeze/HRS changed'; }
no_mutations() { ! grep -Eq '^systemctl (restart|reload)|^install-stub ' "$FIX_LOG" || fail 'preflight failure performed a mutation'; }
must_fail() { [[ "$status" != 0 ]] || fail "expected refusal: $1"; grep -Fq "$1" "$root/result.err" || { cat "$root/result.err" >&2; fail "missing first-cause: $1"; }; preserved; }
refresh_loaded() { "$root/test-bin/fixture-caddy-adapt" >"$root/caddy-loaded.json"; }
private_guard_output() { ! grep -Fq 'PRIVATE_LOADED_BODY_CANARY' "$root/result.out" "$root/result.err" || fail 'guard exposed loaded configuration body'; }

# Actual helper: switch changes only two exact RPC lines, and only this gateway
# restarts. Alias/comment/64201/product blocks and original receipts stay exact.
new_fixture
# Whitespace/key ordering of an independently loaded object is not a route
# change. Only the original Caddy adapter output supplies the disk graph.
python3 - "$root/caddy-loaded.json" <<'PY'
import json,sys
p=sys.argv[1]
with open(p) as f: v=json.load(f)
with open(p,'w') as f: json.dump(v,f,indent=3,sort_keys=False)
PY
run_helper switch
[[ "$status" == 0 ]] || { cat "$root/result.err" >&2; fail 'normal source-only switch'; }
cmp "$config" "$root/expected.caddy" && cmp "$master" "$root/original.master" || fail 'non-RPC Caddy bytes changed'
"$root/test-bin/fixture-caddy-adapt" >"$root/expected-loaded.json"
cmp "$root/caddy-loaded.json" "$root/expected-loaded.json" || fail 'reload did not retain the complete disk route graph'
cmp "$ingress/backups/ynx-chain.caddy" "$root/original.caddy" && cmp "$ingress/backups/candidate.env" "$root/original.env" || fail 'original backups changed'
grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true' "$candidate_env" || fail 'gateway was not explicitly authorized'
python3 - "$ingress/switch.json" "$root/original.env" "$candidate_env" <<'PY'
import hashlib,json,sys
v=json.load(open(sys.argv[1]))
assert v['rpcOnly'] is True and v['ecosystemContinuityVerified'] is False
assert v['sourceTestOnly'] is True and v['publicIngressChanged'] is False
assert v['publicCutoverReady'] is True and v['mainPid']=='4243'
assert v['originalEnvironmentSHA256']==hashlib.sha256(open(sys.argv[2],'rb').read()).hexdigest()
assert v['activatedEnvironmentSHA256']==hashlib.sha256(open(sys.argv[3],'rb').read()).hexdigest()
PY
preserved
[[ "$(grep -Ec '^systemctl restart ynx-bft-gateway-candidate.service$' "$FIX_LOG")" == 1 && "$(grep -Ec '^systemctl reload caddy$' "$FIX_LOG")" == 1 ]] || fail 'wrong service mutations'
run_helper switch; must_fail 'original ingress attempt exists'
[[ "$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")" == 2 ]] || fail 'repeated switch resent service mutation'
run_helper rollback
[[ "$status" == 0 ]] || { cat "$root/result.err" >&2; fail 'explicit original-config rollback'; }
cmp "$config" "$root/original.caddy" && cmp "$candidate_env" "$root/original.env" && cmp "$master" "$root/original.master" || fail 'rollback did not restore exact original config/env'
preserved
[[ -d "$ingress/rollback-attempt" && -f "$ingress/switch.json" && -f "$ingress/rollback.json" ]] || fail 'rollback erased original evidence'
count="$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")"
run_helper rollback
[[ "$status" != 0 && "$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")" == "$count" ]] || fail 'rollback was silently resent'

# The observed production hazard: a normal active multi-site admin config and
# a default on-disk master with no managed import. Refuse the actual semantic
# mismatch before the old missing-import check, without a reload or restart.
new_fixture
printf '# independently retained default master\n:80 {\n file_server\n}\n' >"$master"
cp "$master" "$root/default-master"
cp "$root/caddy-loaded.json" "$root/retained-loaded.json"
run_helper switch; must_fail CADDY_LOADED_DISK_CONFIG_MISMATCH; no_mutations
! grep -Fq 'does not import' "$root/result.err" || fail 'old import refusal masked the loaded/disk regression'
[[ ! -e "$ingress" ]] || fail 'loaded/disk preflight mismatch created an attempt'
cmp "$master" "$root/default-master" && cmp "$config" "$root/original.caddy" && cmp "$root/caddy-loaded.json" "$root/retained-loaded.json" || fail 'mismatch refusal changed loaded/disk originals'
[[ "$(grep -Ec '^curl-stub .*http://127.0.0.1:2019/config/$' "$FIX_LOG")" == 1 ]] || fail 'mismatch did not read the actual admin interface'

for scenario in other-route empty-object duplicate partial shape nonfinite overbound admin-failure disk-invalid caddy-dropin caddy-resume caddy-reload-master caddy-unit-source caddy-argv caddy-executable caddy-pid; do
  new_fixture
  case "$scenario" in
    other-route)
      python3 - "$root/caddy-loaded.json" <<'PY'
import json,sys
p=sys.argv[1]
with open(p) as f: v=json.load(f)
v['apps']['http']['servers']['srv0']['routes'][-1]['handle'][0]['upstreams'][0]['dial']='127.0.0.1:29999'
v['apps']['private_app']={'retained':'PRIVATE_LOADED_BODY_CANARY'}
with open(p,'w') as f: json.dump(v,f)
PY
      expected=CADDY_LOADED_DISK_CONFIG_MISMATCH ;;
    empty-object) printf '{}\n' >"$root/caddy-loaded.json"; expected=CADDY_LOADED_DISK_CONFIG_MISMATCH ;;
    duplicate) printf '{"apps":{},"apps":{"private":"PRIVATE_LOADED_BODY_CANARY"}}\n' >"$root/caddy-loaded.json"; expected=CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID ;;
    partial) printf '{"apps":{"private":"PRIVATE_LOADED_BODY_CANARY"' >"$root/caddy-loaded.json"; expected=CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID ;;
    shape) printf '{"apps":{"http":{"servers":[]}},"private":"PRIVATE_LOADED_BODY_CANARY"}\n' >"$root/caddy-loaded.json"; expected=CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID ;;
    nonfinite) printf '{"apps":{},"private":NaN}\n' >"$root/caddy-loaded.json"; expected=CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID ;;
    overbound) python3 - "$root/caddy-loaded.json" <<'PY'
import sys
with open(sys.argv[1],'wb') as f: f.write(b'{"private":"'+b'x'*(16<<20)+b'"}')
PY
      expected=CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID ;;
    admin-failure) export FIX_CADDY_ADMIN_FAILURE=yes; expected=CADDY_LOADED_CONFIG_UNAVAILABLE_OR_INVALID ;;
    disk-invalid) export FIX_CADDY_ADAPT_INVALID=yes; expected=CADDY_DISK_CONFIG_INVALID ;;
    caddy-dropin) export FIX_CADDY_DROPIN=yes; expected=CADDY_ORIGINAL_UNIT_MISMATCH ;;
    caddy-resume) export FIX_CADDY_START=yes; expected=CADDY_ORIGINAL_START_MISMATCH ;;
    caddy-reload-master) export FIX_CADDY_RELOAD=yes; expected=CADDY_ORIGINAL_RELOAD_MISMATCH ;;
    caddy-unit-source)
      # systemd's cached properties stay original, but its on-disk unit points
      # at another master. The helper must inspect both, retain the foreign
      # source and refuse, rather than trusting the cached show values alone.
      sed -i 's/ reload --config / reload --config=foreign /' "$root/usr/lib/systemd/system/caddy.service"
      sha256sum "$root/paused/"* "$root/var/lib/ynx-chain/"*.json "$evidence/primary-dependencies-start.json" "$env_root/ownership.json" "$attempt/"* "$root/usr/lib/systemd/system/caddy.service" "$root/usr/bin/caddy" >"$root/preserved.sha256"
      expected=CADDY_ORIGINAL_UNIT_CONTENT_MISMATCH ;;
    caddy-argv) printf '%s\0' "$root/usr/bin/caddy" run --resume >"$root/proc/6000/cmdline"; expected=CADDY_ORIGINAL_ARGV_MISMATCH ;;
    caddy-executable) printf 'foreign Caddy executable\n' >"$root/foreign-caddy"; rm "$root/proc/6000/exe"; ln -s "$root/foreign-caddy" "$root/proc/6000/exe"; expected=CADDY_ORIGINAL_EXECUTABLE_MISMATCH ;;
    caddy-pid) export FIX_CADDY_PID_RACE=yes; expected=CADDY_ORIGINAL_RUNNING_IDENTITY_CHANGED ;;
  esac
  cp "$root/caddy-loaded.json" "$root/retained-loaded.json"
  run_helper switch; must_fail "$expected"; no_mutations; private_guard_output
  [[ ! -e "$ingress" ]] || fail 'Caddy preflight refusal created an ingress attempt'
  cmp "$config" "$root/original.caddy" && cmp "$master" "$root/original.master" && cmp "$candidate_env" "$root/original.env" && cmp "$root/caddy-loaded.json" "$root/retained-loaded.json" || fail 'Caddy preflight refusal changed original bytes'
done

# A previously consistent first read is insufficient: the real caller repeats
# the body and raw-file checks immediately before authorizing gateway restart.
for scenario in loaded managed; do
  new_fixture
  export FIX_CADDY_SECOND_READ="$scenario"
  if [[ "$scenario" == loaded ]]; then expected=CADDY_LOADED_DISK_CONFIG_MISMATCH; else expected=CADDY_ORIGINAL_CONFIG_CHANGED_DURING_READBACK; fi
  run_helper switch; must_fail "$expected"; no_mutations
  [[ -f "$ingress/intent.json" && ! -e "$ingress/switch.json" ]] || fail 'readback race lost the staged UNKNOWN'
  cmp "$candidate_env" "$root/original.env" || fail 'readback race authorized/restarted the gateway'
  if [[ "$scenario" == managed ]]; then grep -Fxq '# external writer preserved' "$config" || fail 'external original edit was restored'; fi
  count="$(wc -l <"$FIX_LOG")"
  run_helper switch; must_fail 'original ingress attempt exists'; no_mutations
  [[ "$(wc -l <"$FIX_LOG")" == "$count" ]] || fail 'UNKNOWN repeated admin requests or service work'
done

for scenario in pin snapshot dropin exec proc binary argv env pid receipt health; do
  new_fixture
  case "$scenario" in
    pin) operator_pin="$(printf 'd%.0s' {1..64})"; expected='gateway source differs' ;;
    snapshot) printf 'changed original unit\n' >>"$attempt/gateway.service"; expected='snapshot differs'; sha256sum "$root/paused/"* "$root/var/lib/ynx-chain/"*.json >"$root/preserved.sha256" ;;
    dropin) export FIX_DROPIN=yes; expected='unit source/drop-ins differ' ;;
    exec) export FIX_FOREIGN_EXEC=yes; expected='loaded ExecStart differs' ;;
    proc) export FIX_PROC_DENIED=yes; expected=CADDY_ORIGINAL_EXECUTABLE_UNAVAILABLE ;;
    binary) printf 'wrong running binary, same inode\n' >>"$gateway"; expected='running gateway executable differs' ;;
    argv) printf 'unapproved\0' >>"$root/proc/4242/cmdline"; expected='running gateway argv differs' ;;
    env) printf 'UNAPPROVED=1\0' >>"$root/proc/4242/environ"; expected='running gateway environment differs' ;;
    pid) export FIX_PID_RACE=yes; expected='running identity changed' ;;
    receipt) printf ' ' >>"$env_root/ownership.json"; expected='exact original completion receipt'; sha256sum "$root/paused/"* "$root/var/lib/ynx-chain/"*.json >"$root/preserved.sha256" ;;
    health) export FIX_HEALTH_WRONG=yes; expected='authorization readback did not reach' ;;
  esac
  run_helper switch; must_fail "$expected"; no_mutations
  [[ ! -e "$ingress" ]] || fail 'preflight refusal created ingress attempt'
  cmp "$config" "$root/original.caddy" && cmp "$candidate_env" "$root/original.env" || fail 'preflight refusal changed original files'
done

for kind in directory dangling-link; do
  new_fixture
  if [[ "$kind" == directory ]]; then mkdir "$ingress"; printf 'retain-original-UNKNOWN\n' >"$ingress/intent.json"; else ln -s "$root/missing-original" "$ingress"; fi
  run_helper switch; must_fail 'original ingress attempt exists'; no_mutations
  if [[ "$kind" == directory ]]; then grep -Fxq 'retain-original-UNKNOWN' "$ingress/intent.json" || fail 'old UNKNOWN overwritten'; else [[ -L "$ingress" && "$(readlink "$ingress")" == "$root/missing-original" ]] || fail 'old dangling attempt removed'; fi
done

for scenario in pre-switched unsupported no-rpc invalid-caddy; do
  new_fixture
  case "$scenario" in
    pre-switched) cp "$root/expected.caddy" "$config"; expected='pre-existing candidate RPC mapping' ;;
    unsupported) printf 'extra.test.invalid {\n reverse_proxy 127.0.0.1:6432 127.0.0.1:6420\n}\n' >>"$config"; expected='unsupported native RPC directive' ;;
    no-rpc) printf 'other.test.invalid {\n reverse_proxy 127.0.0.1:64201\n}\n' >"$config"; expected='no exact original native RPC directive' ;;
    invalid-caddy) export FIX_CADDY_INVALID=yes; expected='SINGLE_APP_GATEWAY_INGRESS_UNKNOWN' ;;
  esac
  # These original negative controls start from a deliberately changed but
  # consistently loaded graph, so they still reach their original first cause.
  refresh_loaded
  cp "$config" "$root/before-config"
  run_helper switch; must_fail "$expected"; no_mutations
  [[ -f "$ingress/intent.json" && ! -e "$ingress/switch.json" ]] || fail 'staged UNKNOWN was not preserved'
  cmp "$config" "$root/before-config" && cmp "$candidate_env" "$root/original.env" || fail 'configuration refusal changed live files'
  run_helper switch; must_fail 'original ingress attempt exists'; no_mutations
done

for scenario in restart-timeout wrong-restarted-argv reload-failure; do
  new_fixture
  case "$scenario" in
    restart-timeout) export FIX_RESTART_TIMEOUT=yes; expected_status=124; expected='SINGLE_APP_GATEWAY_INGRESS_UNKNOWN' ;;
    wrong-restarted-argv) export FIX_RESTART_WRONG_ARGV=yes; expected_status=1; expected='running gateway argv differs' ;;
    reload-failure) export FIX_RELOAD_FAILURE=yes; expected_status=77; expected='SINGLE_APP_GATEWAY_INGRESS_UNKNOWN' ;;
  esac
  run_helper switch; must_fail "$expected"
  [[ "$status" == "$expected_status" ]] || fail 'first failing command status was lost'
  [[ -f "$ingress/intent.json" && ! -e "$ingress/switch.json" ]] || fail 'write UNKNOWN lost'
  grep -Fxq 'YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=true' "$candidate_env" || fail 'unknown write was silently restored'
  cmp "$ingress/backups/candidate.env" "$root/original.env" || fail 'original environment backup lost'
  count="$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")"
  run_helper switch; must_fail 'original ingress attempt exists'
  run_helper rollback; must_fail 'completed original RPC switch is required'
  [[ "$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")" == "$count" ]] || fail 'UNKNOWN dispatched another mutation'
done

new_fixture
run_helper switch
[[ "$status" == 0 ]] || fail 'foreign-edit fixture switch failed'
printf '# foreign post-switch change\n' >>"$config"
cp "$config" "$root/foreign-config"
count="$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")"
run_helper rollback; must_fail 'foreign ingress config must not be overwritten'
cmp "$config" "$root/foreign-config" || fail 'rollback overwrote foreign config'
[[ "$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")" == "$count" ]] || fail 'foreign rollback touched a service'

new_fixture
run_helper switch
[[ "$status" == 0 ]] || fail 'manifest tamper fixture switch failed'
printf 'forged\n' >>"$ingress/original-checksums.txt"
count="$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")"
run_helper rollback; must_fail 'original checksum manifest changed'
[[ "$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")" == "$count" ]] || fail 'tampered rollback touched a service'

# New explicit JSON mode runs the real ingress caller and shared helper. Only
# systemd/Caddy/HTTP transports are synthetic; no real service is exercised.
new_json_fixture() {
  new_fixture
  export FIX_CADDY_JSON=yes
  json_manifest="$root/caddy-source.json"
  python3 - "$repo" "$root" "$tx" "$commit" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" <<'PY'
import hashlib,importlib.util,json,os,sys
from pathlib import Path
repo,root,tx,commit,operator,runtime,source,gateway=sys.argv[1:]
spec=importlib.util.spec_from_file_location('public_json_fixture',repo+'/scripts/verify/test_public_bft_caddy_json.py')
fixture=importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
h=fixture.module
def write(path,body,mode):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(body); p.chmod(mode)
raw=json.dumps(fixture.fixture_config(),indent=2).encode()+b'\n'
folder=root+'/retained-json'; os.mkdir(folder,0o700)
reads=[]
for name in ['read1.json','read2.json']:
    path=folder+'/'+name; write(path,raw,0o600)
    reads.append(dict(path=path,bytes=str(len(raw)),sha256=hashlib.sha256(raw).hexdigest(),witness=h.file_witness(os.stat(path))))
candidate=h.project_rpc_config(h.parse_config(raw),fixture.rpc_records())
unit=root+h.UNIT_PATH
manifest=dict(version=h.VERSION,transactionId=tx,commit=commit,operatorPlanSHA256=operator,runtimeCommit=runtime,runtimeSOURCEsha256=source,gatewaySHA256=gateway,source=reads[0],secondRead=reads[1],originalProcess=dict(pid='6000',startTicks='123456',argv=h.OLD_ARGV),originalUnit=dict(path=h.UNIT_PATH,sha256=hashlib.sha256(Path(unit).read_bytes()).hexdigest()),baseline=dict(configPath=h.CONFIG_PATH,configSHA256=hashlib.sha256(raw).hexdigest(),semanticSHA256=h.semantic_hash(h.parse_config(raw)),candidateSemanticSHA256=h.semantic_hash(candidate),dropInPath=h.DROP_IN_PATH,dropInSHA256=hashlib.sha256(h.render_dropin()).hexdigest()),rpcUpstreams=fixture.rpc_records())
write(root+'/caddy-source.json',h.canonical_config(manifest),0o600)
write(root+h.CONFIG_PATH,raw,0o600)
write(root+h.DROP_IN_PATH,h.render_dropin(),0o644)
write(root+'/caddy-loaded.json',raw,0o600)
write(root+'/original.json',raw,0o600)
write(root+'/expected.json',h.canonical_config(candidate),0o600)
write(root+'/proc/6000/stat',('6000 (caddy) S '+' '.join(['0']*18+['123456','0'])+'\n').encode(),0o600)
PY
  json_pin="$(hash "$json_manifest")"
  sha256sum "$root/retained-json/"* "$json_manifest" >"$root/json-retained.sha256"
}
run_json_helper() {
  set +e
  PUBLIC_BFT_INGRESS_SOURCE_TEST_ONLY=yes bash "$repo/scripts/ops/remote/public-bft-ingress.sh" "$1" "$tx" "$commit" "$release" "$evidence" single-app-gateway-json "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$json_manifest" "$json_pin" "$root" >"$root/result.json" 2>"$root/result.err"
  status=$?
  set -e
  if grep -Eq 'SYNTHETIC-PRIVATE-CANARY|NOT-A-REAL-KEY' "$root/result.json" "$root/result.err"; then fail 'JSON body leaked into public diagnostic'; fi
}

# The original Caddyfile caller cannot consume a persistent JSON baseline.
# Its actual rejection is retained; the new mode never feeds JSON to adapt.
new_json_fixture
run_helper switch; must_fail CADDY_ORIGINAL_UNIT_MISMATCH; no_mutations
[[ ! -e "$ingress" ]] || fail 'old JSON-incompatible caller created attempt'
run_json_helper switch
[[ "$status" == 0 ]] || fail 'normal explicit JSON switch failed'
cmp "$root/etc/caddy/ynx-chain.json" "$root/expected.json" || fail 'JSON switch is not exact three-leaf projection'
cmp "$master" "$root/original.master" && cmp "$config" "$root/original.caddy" || fail 'JSON switch touched Caddyfile/stub'
preserved
sha256sum --strict -c "$root/json-retained.sha256" >/dev/null || fail 'JSON switch changed pinned original retained sources'
python3 - "$root/result.json" "$json_manifest" "$json_pin" "$root/etc/caddy/ynx-chain.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1])); m=json.load(open(sys.argv[2]))
assert len(m['rpcUpstreams'])==3 and {item['host'] for item in m['rpcUpstreams']}=={'rpc-testnet.ynxweb4.com','rpc.ynxweb4.com','evm.ynxweb4.com'}
active=json.load(open(sys.argv[4]))
for item in m['rpcUpstreams']:
    node=active
    for key in item['pointer'][1:].split('/'): node=node[int(key)] if isinstance(node,list) else node[key]
    assert node=='127.0.0.1:27620'
assert v['mode']=='single-app-gateway-json' and v['caddySourceManifestSHA256']==sys.argv[3]
assert v['sourceSHA256']==m['source']['sha256'] and v['baselineSemanticSHA256']==m['baseline']['semanticSHA256']
assert v['candidateSemanticSHA256']==m['baseline']['candidateSemanticSHA256'] and v['dropInSHA256']==m['baseline']['dropInSHA256']
assert v['publicIngressChanged'] is False and v['sourceTestOnly'] is True and v['rpcOnly'] is True
assert v['caddyRestartVerified'] is False and v['ecosystemContinuityVerified'] is False
PY
[[ "$(grep -c '^systemctl restart ynx-bft-gateway-candidate.service$' "$FIX_LOG")" == 1 && "$(grep -c '^systemctl reload caddy$' "$FIX_LOG")" == 1 ]] || fail 'JSON switch operated wrong services'
! grep -q -- '--adapter\|systemctl restart caddy' "$FIX_LOG" || fail 'JSON switch used Caddyfile adapter or restart'
run_json_helper rollback
[[ "$status" == 0 ]] || fail 'normal JSON rollback failed'
cmp "$root/etc/caddy/ynx-chain.json" "$root/original.json" && cmp "$candidate_env" "$root/original.env" || fail 'JSON rollback did not restore complete original bytes'
preserved
sha256sum --strict -c "$root/json-retained.sha256" >/dev/null || fail 'JSON rollback changed pinned original retained sources'
run_json_helper rollback; must_fail 'original rollback attempt exists'

for scenario in missing-baseline missing-dropin missing-evm wrong-pin loaded foreign-dropin old-start old-reload wrong-startticks wrong-source; do
  new_json_fixture
  case "$scenario" in
    missing-baseline) rm "$root/etc/caddy/ynx-chain.json" ;;
    missing-dropin) rm "$root/etc/systemd/system/caddy.service.d/ynx-chain-json.conf" ;;
    missing-evm)
      python3 - "$json_manifest" <<'PY'
import json,sys
p=sys.argv[1]
with open(p) as f: v=json.load(f)
v['rpcUpstreams']=[item for item in v['rpcUpstreams'] if item['host']!='evm.ynxweb4.com']
with open(p,'w') as f: json.dump(v,f,separators=(',',':'))
PY
      json_pin="$(hash "$json_manifest")" ;;
    wrong-pin) json_pin="$(printf 'd%.0s' {1..64})" ;;
    loaded) cp "$root/expected.json" "$root/caddy-loaded.json" ;;
    foreign-dropin) export FIX_CADDY_DROPIN=yes ;;
    old-start) export FIX_CADDY_START=yes ;;
    old-reload) export FIX_CADDY_RELOAD=yes ;;
    wrong-startticks) sed -i 's/123456/123457/' "$root/proc/6000/stat" ;;
    wrong-source) printf ' ' >>"$root/retained-json/read1.json" ;;
  esac
  run_json_helper switch
  [[ "$status" != 0 && ! -e "$ingress" ]] || fail "JSON preflight $scenario accepted or staged"
  no_mutations
  cmp "$candidate_env" "$root/original.env" || fail 'JSON refusal changed gateway authorization'
done

for scenario in loaded config dropin; do
  new_json_fixture
  export FIX_JSON_SECOND_READ="$scenario"
  run_json_helper switch; must_fail CADDY_JSON_PERSISTENT_SOURCE_OR_LOADED_CONFIG_MISMATCH; no_mutations
  [[ -f "$ingress/intent.json" && ! -e "$ingress/switch.json" ]] || fail 'JSON race did not retain UNKNOWN'
  cmp "$candidate_env" "$root/original.env" || fail 'JSON race restarted gateway'
  count="$(wc -l <"$FIX_LOG")"
  run_json_helper switch; must_fail 'original ingress attempt exists'
  [[ "$(wc -l <"$FIX_LOG")" == "$count" ]] || fail 'JSON UNKNOWN resent service/admin action'
done

new_json_fixture
run_json_helper switch
[[ "$status" == 0 ]] || fail 'JSON foreign rollback fixture switch failed'
printf ' ' >>"$root/etc/caddy/ynx-chain.json"
cp "$root/etc/caddy/ynx-chain.json" "$root/foreign-json"
count="$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")"
run_json_helper rollback; must_fail CADDY_JSON_PERSISTENT_SOURCE_OR_LOADED_CONFIG_MISMATCH
cmp "$root/etc/caddy/ynx-chain.json" "$root/foreign-json" || fail 'JSON rollback overwrote foreign config'
[[ "$(grep -Ec '^systemctl (restart|reload)' "$FIX_LOG")" == "$count" ]] || fail 'JSON foreign rollback operated service'

printf 'SINGLE_APP_GATEWAY_RPC_INGRESS_SOURCE_CONTROLS_PASS networkRequests=0 servicesStarted=0 publicIngressChanged=false jsonProfile=true\n'
