#!/usr/bin/env bash
set -Eeuo pipefail

# Source/transport fixture only: every service, HTTP response and /proc record
# below is synthetic inside a new private root. This test never starts a
# daemon, performs network I/O or establishes actual running-source authority.
repo="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fixture_number=0

fail() { echo "gateway dependency source fixture failed: $*" >&2; exit 1; }
hash() { sha256sum "$1" | awk '{print $1}'; }

new_fixture() {
  fixture_number=$((fixture_number + 1))
  root="$tmp/case-$fixture_number"
  mkdir -m 0700 "$root"
  export FIX_ROOT="$root" FIX_COMMAND_LOG="$root/commands.log" FIX_GATEWAY_STATE="$root/gateway.state"
  export FIX_SYSTEMD="$root/etc/systemd/system" FIX_PROC="$root/proc"
  unset FIX_LEGACY_ACTIVE FIX_OPERATOR_INACTIVE FIX_DROPIN FIX_START_FAILURE FIX_RUNNING_MISMATCH FIX_PROC_DENIED FIX_ARGV_MISMATCH FIX_ENV_MISMATCH FIX_FOREIGN_EXEC
  tx=protocol-gateway-source-fixture
  full_commit=0123456789abcdef0123456789abcdef01234567
  short_commit="${full_commit:0:12}"
  release="ynx-bft-gateway-$short_commit"
  operator_pin="$(printf 'a%.0s' {1..64})"
  migration_hash="$(printf 'b%.0s' {1..64})"
  stage="$root/gateway-runtime"
  installed="$root/var/lib/ynx-chain/consensus-candidate"
  evidence="$root/backups/public-bft-cutover/$tx"
  dependencies="$root/var/lib/ynx-chain/public-bft-cutover/$tx/dependencies"
  environment="$root/etc/ynx/public-bft-cutover/$tx"
  launcher="$dependencies/start-gateway.sh"
  mkdir -p "$root/fake-bin" "$FIX_SYSTEMD" "$FIX_PROC/12345" "$stage/package/roles/primary/"{systemd,scripts,config} "$installed/"{bin,scripts,config} "$evidence"
  chmod 0700 "$stage"
  : >"$FIX_COMMAND_LOG"
  printf '0\n' >"$FIX_GATEWAY_STATE"
  printf 'retained original source backup\n' >"$evidence/primary.tar.gz"
  printf 'normal verified original operator unit\n' >"$stage/package/roles/primary/systemd/ynx-consensus-operator-candidate.service"
  cp "$stage/package/roles/primary/systemd/ynx-consensus-operator-candidate.service" "$FIX_SYSTEMD/ynx-consensus-operator-candidate.service"
  printf 'original primary role manifest\n' >"$stage/package/roles/primary/role-manifest.json"
  printf 'original fixed env-i operator launcher\n' >"$stage/package/roles/primary/scripts/start-operator.sh"
  printf 'original complete bound migration\n' >"$stage/package/roles/primary/config/bound-migration.json"
  printf 'original exact genesis\n' >"$stage/package/roles/primary/config/genesis.json"
  cp "$stage/package/roles/primary/role-manifest.json" "$installed/role-manifest.json"
  cp "$stage/package/roles/primary/scripts/start-operator.sh" "$installed/scripts/start-operator.sh"
  cp "$stage/package/roles/primary/config/"* "$installed/config/"
  printf '#!/usr/bin/env bash\nexit 97 # gateway fixture is never executed\n' >"$stage/ynx-bft-gatewayd"
  cat >"$stage/ynx-consensus-package" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf 'normal-package-verifier %s\\n' "\$*" >>'$FIX_COMMAND_LOG'
test "\$#" = 4
test "\$1" = -verify-package
test "\$2" = '$stage/package'
test "\$3" = -operator-plan-hash
test "\$4" = '$operator_pin'
EOF
  chmod 0755 "$stage/ynx-bft-gatewayd" "$stage/ynx-consensus-package"
  gateway_pin="$(hash "$stage/ynx-bft-gatewayd")"
  verifier_pin="$(hash "$stage/ynx-consensus-package")"
  backup_pin="$(hash "$evidence/primary.tar.gz")"
  printf '{"binaries":{"ynx-bft-gatewayd":{"bytes":%s,"sha256":"%s"},"ynx-consensus-package":{"bytes":%s,"sha256":"%s"}},"commit":"%s","platform":"linux/amd64","version":"YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2"}\n' "$(stat -c %s "$stage/ynx-bft-gatewayd")" "$gateway_pin" "$(stat -c %s "$stage/ynx-consensus-package")" "$verifier_pin" "$full_commit" >"$stage/runtime-SOURCE.json"
  runtime_pin="$(hash "$stage/runtime-SOURCE.json")"
  for marker in mutation-freeze.json block-production-pause.json; do
    printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s"}\n' "$tx" "$short_commit" "$release" >"$root/var/lib/ynx-chain/$marker"
  done
  # Paused services, signer files and index/explorer/faucet state are sentinels,
  # not fixture dependencies. Their original bytes must survive every action.
  mkdir -p "$root/paused"
  for name in ai pay trust resource faucet indexer explorer; do printf 'retain-%s-key-data-UNKNOWN\n' "$name" >"$root/paused/$name"; done
  (cd "$root/paused" && sha256sum *) >"$root/paused-before.sha256"
  cat >"$root/fake-bin/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == -c && "${2:-}" == %U ]]; then echo root; exit 0; fi
if [[ "${FIX_PROC_DENIED:-}" == 1 && "${*: -1}" == "$FIX_PROC/12345/exe" ]]; then echo 'fixture protected /proc permission denied' >&2; exit 1; fi
exec /usr/bin/stat "$@"
EOF
  cat >"$root/fake-bin/chown" <<'EOF'
#!/usr/bin/env bash
printf 'chown %s\n' "$*" >>"$FIX_COMMAND_LOG"
EOF
  cat >"$root/fake-bin/install" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'install %s\n' "$*" >>"$FIX_COMMAND_LOG"
args=()
while (($#)); do case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done
exec /usr/bin/install "${args[@]}"
EOF
  cat >"$root/fake-bin/runuser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'runuser %s\n' "$*" >>"$FIX_COMMAND_LOG"
test "$1" = -u && test "$2" = ynx && test "$3" = --
shift 3
exec "$@"
EOF
  cat >"$root/fake-bin/ss" <<'EOF'
#!/usr/bin/env bash
printf 'ss %s\n' "$*" >>"$FIX_COMMAND_LOG"
printf 'State Recv-Q Send-Q Local_Address:Port Peer_Address:Port\n'
EOF
  cat >"$root/fake-bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >>"$FIX_COMMAND_LOG"
[[ "${*: -1}" == http://127.0.0.1:27620/health ]]
printf '{"ok":true,"sourceFixtureOnly":true}\n'
EOF
  cat >"$root/fake-bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >>"$FIX_COMMAND_LOG"
action="$1"; shift
unit="${*: -1}"
case "$action" in
show)
  property="$2"
  case "$property" in
  FragmentPath)
    if [[ "$unit" == ynx-consensus-operator-candidate.service || -e "$FIX_SYSTEMD/$unit" ]]; then echo "$FIX_SYSTEMD/$unit"; fi ;;
  DropInPaths) if [[ "${FIX_DROPIN:-}" == "$unit" ]]; then echo /unapproved/dropin.conf; fi ;;
  MainPID) echo 12345 ;;
  ExecStart)
    if [[ "${FIX_FOREIGN_EXEC:-}" == 1 ]]; then echo '{ path=/bin/sh ; argv[]=/bin/sh unapproved ; ignore_errors=no ; }'
    else printf '{ path=/usr/bin/env ; argv[]=/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash %s ; ignore_errors=no ; source_fixture_only=yes ; }\n' "$FIX_ROOT/var/lib/ynx-chain/public-bft-cutover/protocol-gateway-source-fixture/dependencies/start-gateway.sh"; fi ;;
  *) exit 1 ;;
  esac ;;
is-active)
  case "$unit" in
  ynx-consensus-operator-candidate.service) [[ "${FIX_OPERATOR_INACTIVE:-}" != 1 ]] ;;
  ynx-consensus-abci-candidate.service|ynx-consensus-comet-candidate.service) [[ "${FIX_LEGACY_ACTIVE:-}" == "$unit" ]] ;;
  ynx-bft-gateway-candidate.service) [[ "$(cat "$FIX_GATEWAY_STATE")" == 1 ]] ;;
  *) echo 'fixture forbidden unrelated service access' >&2; exit 88 ;;
  esac ;;
start)
  [[ "$unit" == ynx-bft-gateway-candidate.service ]]
  if [[ "${FIX_START_FAILURE:-}" == 1 ]]; then exit 124; fi
  printf '1\n' >"$FIX_GATEWAY_STATE"
  cp "$FIX_ROOT/gateway-runtime/ynx-bft-gatewayd" "$FIX_PROC/12345/exe"
  if [[ "${FIX_RUNNING_MISMATCH:-}" == 1 ]]; then printf 'different running inode\n' >"$FIX_PROC/12345/exe"; fi
  printf '%s\0' "$FIX_ROOT/var/lib/ynx-chain/consensus-candidate/bin/ynx-bft-gatewayd" --http 127.0.0.1:27620 --comet-rpc http://127.0.0.1:27757 --migration-height 91 --migration-block-hash "$(printf 'b%.0s' {1..64})" --public-cutover-authorized=false >"$FIX_PROC/12345/cmdline"
  printf '%s\0' PATH=/usr/bin:/bin "YNX_MUTATION_FREEZE_FILE=$FIX_ROOT/var/lib/ynx-chain/mutation-freeze.json" >"$FIX_PROC/12345/environ"
  if [[ "${FIX_ARGV_MISMATCH:-}" == 1 ]]; then printf 'unapproved\0argv\0' >"$FIX_PROC/12345/cmdline"; fi
  if [[ "${FIX_ENV_MISMATCH:-}" == 1 ]]; then printf 'UNAPPROVED_SECRET=fixture-only\0' >>"$FIX_PROC/12345/environ"; fi ;;
stop) [[ "$unit" == ynx-bft-gateway-candidate.service ]]; printf '0\n' >"$FIX_GATEWAY_STATE" ;;
disable) [[ "$unit" == ynx-bft-gateway-candidate.service ]] ;;
daemon-reload) test "$#" = 0 ;;
*) exit 1 ;;
esac
EOF
  chmod 0755 "$root/fake-bin/"*
  # Only fixed filesystem roots are mapped; the helper's production control
  # flow, exact argv checks, byte comparisons and failure fences are unchanged.
  sed -e "s#/var/lib/ynx-chain#$root/var/lib/ynx-chain#g" -e "s#/etc/ynx#$root/etc/ynx#g" -e "s#/etc/systemd/system#$FIX_SYSTEMD#g" -e "s#/proc/#$FIX_PROC/#g" "$repo/scripts/ops/remote/public-bft-dependencies.sh" >"$root/helper.sh"
  chmod 0700 "$root/helper.sh"
  args=(start "$tx" "$short_commit" "$release" 91 "$migration_hash" "$evidence" '' '' '' '' '' '' '' '' '' '' single-app-gateway "$operator_pin" "$full_commit" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$stage" "$backup_pin")
}

invoke() { PATH="$root/fake-bin:$PATH" bash "$root/helper.sh" "${args[@]}"; }
assert_untouched() {
  (cd "$root/paused" && sha256sum -c "$root/paused-before.sha256" >/dev/null) || fail 'paused original data changed'
  ! grep -Eq 'systemctl .*ynx-(ai|pay|trust|resource|faucet|indexer|explorer)|systemctl .*ynx-bft-(ai|pay|trust|resource|faucet|indexer|explorer)|consensus-signers|indexer-db|:2762[6-9]|:2763[0-2]' "$FIX_COMMAND_LOG" || fail 'gateway-only path touched unrelated services, keys or index database'
}
assert_no_start() { ! grep -q '^systemctl start ' "$FIX_COMMAND_LOG" || fail 'rejected gateway attempted service start'; }

new_fixture
invoke >"$root/start.stdout" 2>"$root/start.stderr"
receipt="$evidence/primary-dependencies-start.json"
grep -Fq '"version":"YNX-SINGLE-APP-GATEWAY-START/v1"' "$receipt"
grep -Fq '"mode":"single-app-gateway"' "$receipt"
grep -Fq "\"runningExecutableSHA256\":\"$gateway_pin\"" "$receipt"
grep -Fq '"mainPid":"12345"' "$receipt"
grep -Fq '"publicIngressChanged":false' "$receipt"
grep -Fq '"pqActivationVerified":false' "$receipt"
cmp "$receipt" "$environment/ownership.json"
grep -Fxq 'Requires=ynx-consensus-operator-candidate.service' "$FIX_SYSTEMD/ynx-bft-gateway-candidate.service"
! grep -q 'ynx-consensus-comet-candidate.service' "$FIX_SYSTEMD/ynx-bft-gateway-candidate.service"
grep -Fq 'exec env -i PATH=/usr/bin:/bin YNX_MUTATION_FREEZE_FILE=' "$launcher"
! grep -q 'ynx-chaind.env\|consensus-signers' "$launcher"
unit_hash="$(hash "$FIX_SYSTEMD/ynx-bft-gateway-candidate.service")"
if invoke >"$root/repeat.stdout" 2>"$root/repeat.stderr"; then fail 'repeated start accepted'; fi
[[ "$(hash "$FIX_SYSTEMD/ynx-bft-gateway-candidate.service")" == "$unit_hash" ]]
[[ "$(grep -c '^systemctl start ' "$FIX_COMMAND_LOG")" == 1 ]]
args[0]=rollback
invoke >"$root/rollback.stdout" 2>"$root/rollback.stderr"
grep -Fq '"originalMaterialRetained":true' "$evidence/primary-dependencies-rollback.json"
grep -Fq '"migrationHeight":91' "$evidence/primary-dependencies-rollback.json"
test -f "$receipt" && test -f "$installed/bin/ynx-bft-gatewayd" && test -f "$launcher" && test -f "$FIX_SYSTEMD/ynx-bft-gateway-candidate.service"
if invoke >"$root/rollback-repeat.stdout" 2>"$root/rollback-repeat.stderr"; then fail 'repeated rollback accepted'; fi
[[ "$(grep -c '^systemctl stop ' "$FIX_COMMAND_LOG")" == 1 ]]
assert_untouched

for failure in missing-pin legacy-unit-active operator-absent wrong-unit dropin runtime-mismatch runtime-source-association old-attempt; do
  new_fixture
  case "$failure" in
  missing-pin) args[18]='' ;;
  legacy-unit-active) export FIX_LEGACY_ACTIVE=ynx-consensus-comet-candidate.service ;;
  operator-absent) export FIX_OPERATOR_INACTIVE=1 ;;
  wrong-unit) printf 'foreign old unit\n' >"$FIX_SYSTEMD/ynx-consensus-operator-candidate.service" ;;
  dropin) export FIX_DROPIN=ynx-consensus-operator-candidate.service ;;
  runtime-mismatch) printf 'changed staged bytes\n' >>"$stage/ynx-bft-gatewayd" ;;
  runtime-source-association)
    sed "s/$gateway_pin/$(printf 'c%.0s' {1..64})/" "$stage/runtime-SOURCE.json" >"$root/changed-source"
    cp "$root/changed-source" "$stage/runtime-SOURCE.json"
    args[20]="$(hash "$stage/runtime-SOURCE.json")" ;;
  old-attempt) mkdir -p "$dependencies"; printf 'retain UNKNOWN\n' >"$dependencies/UNKNOWN" ;;
  esac
  if invoke >"$root/negative.stdout" 2>"$root/negative.stderr"; then fail "negative accepted: $failure"; fi
  assert_no_start
  test ! -e "$evidence/primary-dependencies-start.json"
  if [[ "$failure" == old-attempt ]]; then grep -Fxq 'retain UNKNOWN' "$dependencies/UNKNOWN"; fi
  assert_untouched
done

for failure in start-timeout running-inode-mismatch protected-proc wrong-running-argv inherited-environment foreign-loaded-exec; do
  new_fixture
  case "$failure" in
  start-timeout) export FIX_START_FAILURE=1 ;;
  running-inode-mismatch) export FIX_RUNNING_MISMATCH=1 ;;
  protected-proc) export FIX_PROC_DENIED=1 ;;
  wrong-running-argv) export FIX_ARGV_MISMATCH=1 ;;
  inherited-environment) export FIX_ENV_MISMATCH=1 ;;
  foreign-loaded-exec) export FIX_FOREIGN_EXEC=1 ;;
  esac
  if invoke >"$root/negative.stdout" 2>"$root/negative.stderr"; then fail "uncertain source accepted: $failure"; fi
  test -f "$dependencies/gateway-start-attempt/intent.json"
  test -f "$FIX_SYSTEMD/ynx-bft-gateway-candidate.service"
  test ! -e "$evidence/primary-dependencies-start.json" && test ! -e "$environment/ownership.json"
  if [[ "$failure" == protected-proc ]]; then grep -Fq 'fixture protected /proc permission denied' "$root/negative.stderr"; fi
  if invoke >"$root/negative-repeat.stdout" 2>"$root/negative-repeat.stderr"; then fail "uncertain start was resent: $failure"; fi
  [[ "$(grep -c '^systemctl start ' "$FIX_COMMAND_LOG")" == 1 ]]
  assert_untouched
done

printf 'single-App gateway dependency source/transport fixture passed; no real service, network, running-inode proof or activation was performed\n'
