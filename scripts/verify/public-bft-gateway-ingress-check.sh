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
  mkdir -p "$root/test-bin" "$evidence" "$env_root" "$attempt" "$(dirname "$gateway")" "$(dirname "$unit")" "$root/etc/caddy" "$root/proc/4242" "$root/paused"
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
  for name in ai pay trust resource faucet indexer explorer HRS ledger UNKNOWN; do printf 'retained-%s-original\n' "$name" >"$root/paused/$name"; done
  printf 'original mutation freeze\n' >"$root/var/lib/ynx-chain/mutation-freeze.json"
  printf 'original writer pause\n' >"$root/var/lib/ynx-chain/block-production-pause.json"
  sha256sum "$root/paused/"* "$root/var/lib/ynx-chain/"*.json "$evidence/primary-dependencies-start.json" "$env_root/ownership.json" "$attempt/"* >"$root/preserved.sha256"
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
    [[ "$#" == 5 && "$2" == -p && "$4" == --value && "$5" == "$unit" ]]
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
  reload) [[ "$#" == 2 && "$2" == caddy ]]; [[ "${FIX_RELOAD_FAILURE:-}" != yes ]] || exit 77 ;;
  *) exit 92 ;;
esac
SH
  cat >"$root/test-bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl-stub %s\n' "$*" >>"$FIX_LOG"
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
[[ "$#" == 5 && "$1" == validate && "$2" == --config && "$3" == "$FIX_ROOT/"* && "$4" == --adapter && "$5" == caddyfile ]]
[[ "${FIX_CADDY_INVALID:-}" != yes ]] || exit 76
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

# Actual helper: switch changes only two exact RPC lines, and only this gateway
# restarts. Alias/comment/64201/product blocks and original receipts stay exact.
new_fixture
run_helper switch
[[ "$status" == 0 ]] || { cat "$root/result.err" >&2; fail 'normal source-only switch'; }
cmp "$config" "$root/expected.caddy" && cmp "$master" "$root/original.master" || fail 'non-RPC Caddy bytes changed'
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

for scenario in pin snapshot dropin exec proc binary argv env pid receipt health; do
  new_fixture
  case "$scenario" in
    pin) operator_pin="$(printf 'd%.0s' {1..64})"; expected='gateway source differs' ;;
    snapshot) printf 'changed original unit\n' >>"$attempt/gateway.service"; expected='snapshot differs'; sha256sum "$root/paused/"* "$root/var/lib/ynx-chain/"*.json >"$root/preserved.sha256" ;;
    dropin) export FIX_DROPIN=yes; expected='unit source/drop-ins differ' ;;
    exec) export FIX_FOREIGN_EXEC=yes; expected='loaded ExecStart differs' ;;
    proc) export FIX_PROC_DENIED=yes; expected='fixture /proc identity permission denied' ;;
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

printf 'SINGLE_APP_GATEWAY_RPC_INGRESS_SOURCE_CONTROLS_PASS networkRequests=0 servicesStarted=0 publicIngressChanged=false\n'
