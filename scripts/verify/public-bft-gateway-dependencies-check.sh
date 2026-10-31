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
  local runtime_profile="${1:-v2}"
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
  python3 -B - "$stage" "$full_commit" "$runtime_profile" "$gateway_pin" "$verifier_pin" <<'PY_SOURCE_FIXTURE'
import json,os,pathlib,sys
stage=pathlib.Path(sys.argv[1]); commit,version,gateway_pin,verifier_pin=sys.argv[2:]
assert version in ('v2','v3'),'closed synthetic public runtime fixture version required'
names=['internal/consensus/pq_light_proof.go','cmd/ynx-consensus-proof-verify/main.go','cmd/ynx-consensus-proof-verify/trust.go']
if version=='v3': names.append('cmd/ynx-consensus-proof-verify/portable_import.go')
source=dict(version='YNX-PQ-LINUX-RUNTIME-CANDIDATE/'+version,platform='linux/amd64',commit=commit,
            proofVerifierContract='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1',
            proofVerifierSources={name:dict(bytes=1,sha256='d'*64) for name in names},
            binaries={name:dict(bytes=(stage/name).stat().st_size,sha256=pin) for name,pin in
                      [('ynx-bft-gatewayd',gateway_pin),('ynx-consensus-package',verifier_pin)]})
with (stage/'runtime-SOURCE.json').open('x') as f:
    os.chmod(stage/'runtime-SOURCE.json',0o600)
    json.dump(source,f,separators=(',',':'),sort_keys=True); f.write('\n')
PY_SOURCE_FIXTURE
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

# Independently execute only the original metadata callee. The actual shell's
# separate external SOURCE/binary checksum guard is exercised by the normal
# full fixture below; PYRUNTIME itself must never be credited with that check.
python3 -B - "$tmp/runtime-source-controls" "$repo/scripts/ops/remote/public-bft-dependencies.sh" "$repo/scripts/verify/public-bft-gateway-dependencies-check.sh" <<'PY_RUNTIME_SOURCE_CONTROLS'
import copy,hashlib,os,pathlib,subprocess,sys
root,helper,test=map(pathlib.Path,sys.argv[1:]); root.mkdir(mode=0o700)
source=helper.read_text(); fixture_source=test.read_text()
prefix='  if ! python3 -B - "$stage/runtime-SOURCE.json" "$runtime_commit" <<\'PYRUNTIME\'\n'
assert source.count(prefix)==1,'one original gateway runtime callee required'
start=source.index(prefix)+len(prefix); end=source.index('\nPYRUNTIME\n',start); callee=source[start:end]
prefix='  python3 -B - "$stage" "$full_commit" "$runtime_profile" "$gateway_pin" "$verifier_pin" <<\'PY_SOURCE_FIXTURE\'\n'
assert fixture_source.count(prefix)==1,'one actual public source fixture generator required'
start=fixture_source.index(prefix)+len(prefix); end=fixture_source.index('\nPY_SOURCE_FIXTURE\n',start); fixture=fixture_source[start:end]
commit='0123456789abcdef0123456789abcdef01234567'; portable='cmd/ynx-consensus-proof-verify/portable_import.go'
cases=0
def pin(raw): return hashlib.sha256(raw).hexdigest()
def identity(path):
    s=path.lstat(); return s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns
def invoke(label,version,accepted,mutate=None,cause=None):
    global cases
    case=root/label; case.mkdir(mode=0o700)
    binaries={}
    for name in ('ynx-bft-gatewayd','ynx-consensus-package'):
        raw=('inert PUBLIC metadata fixture '+name+'\n').encode(); path=case/name
        with path.open('xb') as f: os.chmod(path,0o600); f.write(raw)
        binaries[name]=pin(raw)
    result=subprocess.run([sys.executable,'-B','-',str(case),commit,version,binaries['ynx-bft-gatewayd'],binaries['ynx-consensus-package']],
                          input=fixture,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    assert result.returncode==0,(label,result.stderr)
    source_file=case/'runtime-SOURCE.json'
    if mutate is not None:
        import json
        value=json.loads(source_file.read_bytes()); mutate(value)
        source_file.write_text(json.dumps(value,separators=(',',':'),sort_keys=True)+'\n')
    before=(identity(source_file),source_file.read_bytes())
    result=subprocess.run([sys.executable,'-B','-',str(source_file),commit],input=callee,text=True,
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    assert (identity(source_file),source_file.read_bytes())==before,'metadata reader changed original SOURCE bytes/inode/mode'
    assert (result.returncode==0)==accepted,(label,result.returncode,result.stderr)
    assert not result.stdout,(label,'metadata reader unexpectedly emitted a receipt')
    if not accepted:
        assert 'gateway runtime SOURCE rejected:' in result.stderr,(label,result.stderr)
        if cause: assert cause in result.stderr,(label,result.stderr)
    cases+=1
invoke('qualified-v2-three','v2',True)
invoke('qualified-v3-four','v3',True)
invoke('mixed-v2-four','v2',False,lambda v:v['proofVerifierSources'].update({portable:dict(bytes=1,sha256='d'*64)}),'version-specific gateway proof verifier sources differ')
invoke('missing-v3-portable','v3',False,lambda v:v['proofVerifierSources'].pop(portable),'version-specific gateway proof verifier sources differ')
invoke('unknown-source','v3',False,lambda v:v['proofVerifierSources'].update({'unapproved.go':dict(bytes=1,sha256='d'*64)}),'version-specific gateway proof verifier sources differ')
invoke('wrong-contract','v3',False,lambda v:v.update(proofVerifierContract='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v2'),'version-specific gateway proof verifier sources differ')
for label,field,value in [('string-bytes','bytes','1'),('boolean-bytes','bytes',True),('zero-bytes','bytes',0),
                          ('overflow-bytes','bytes',(16<<20)+1),('uppercase-sha','sha256','A'*64),('zero-sha','sha256','0'*64)]:
    invoke(label,'v3',False,lambda v,f=field,x=value:v['proofVerifierSources'][portable].update({f:x}),'original gateway proof verifier source pin differs')
invoke('extra-pin-field','v3',False,lambda v:v['proofVerifierSources'][portable].update(unapproved=True),'original gateway proof verifier source pin differs')
print('GATEWAY_RUNTIME_SOURCE_METADATA_DATA_ONLY cases='+str(cases)+' sourceGrant=false rootGrant=false binaryExecuted=false externalSOURCEPinVerifiedByThisCallee=false')
PY_RUNTIME_SOURCE_CONTROLS

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

new_fixture v3
invoke >"$root/v3-start.stdout" 2>"$root/v3-start.stderr"
grep -Fq "\"runtimeSOURCEsha256\":\"$runtime_pin\"" "$evidence/primary-dependencies-start.json"
[[ "$(grep -c '^systemctl start ' "$FIX_COMMAND_LOG")" == 1 ]]
assert_untouched

for source_failure in v2-mixed-four v3-missing-portable unknown-source malformed-portable-pin original-source-pin-tamper; do
  if [[ "$source_failure" == v2-mixed-four ]]; then new_fixture v2; else new_fixture v3; fi
  python3 -B - "$stage/runtime-SOURCE.json" "$source_failure" <<'PY_SOURCE_NEGATIVE'
import json,pathlib,sys
path=pathlib.Path(sys.argv[1]); failure=sys.argv[2]; source=json.loads(path.read_bytes())
portable='cmd/ynx-consensus-proof-verify/portable_import.go'
if failure=='v2-mixed-four': source['proofVerifierSources'][portable]=dict(bytes=1,sha256='d'*64)
elif failure=='v3-missing-portable': del source['proofVerifierSources'][portable]
elif failure=='unknown-source': source['proofVerifierSources']['unapproved.go']=dict(bytes=1,sha256='d'*64)
elif failure=='malformed-portable-pin': source['proofVerifierSources'][portable]['bytes']='1'
elif failure=='original-source-pin-tamper': source['proofVerifierSources'][portable]['bytes']=2
else: raise AssertionError('unknown synthetic SOURCE negative')
path.write_text(json.dumps(source,separators=(',',':'),sort_keys=True)+'\n')
PY_SOURCE_NEGATIVE
  # Only the last case deliberately keeps the ORIGINAL independent byte pin.
  # Repinning the other malformed fixtures reaches the strict metadata reader;
  # it does not authenticate source leaves against a repository checkout.
  if [[ "$source_failure" != original-source-pin-tamper ]]; then args[20]="$(hash "$stage/runtime-SOURCE.json")"; fi
  source_before="$(hash "$stage/runtime-SOURCE.json")"
  if invoke >"$root/source-negative.stdout" 2>"$root/source-negative.stderr"; then fail "runtime SOURCE negative accepted: $source_failure"; fi
  assert_no_start
  [[ "$(hash "$stage/runtime-SOURCE.json")" == "$source_before" ]]
  test ! -e "$evidence/primary-dependencies-start.json"
  if [[ "$source_failure" == original-source-pin-tamper ]]; then grep -Fq 'gateway original runtime bytes differ from independent pins' "$root/source-negative.stderr"; fi
  assert_untouched
done

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
