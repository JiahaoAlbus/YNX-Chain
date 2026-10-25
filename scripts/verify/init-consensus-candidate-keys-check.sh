#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
tmp="$(mktemp -d)"
case_root=''
finish_controls() {
  local original_status="$1" path case_name="${case_root##*/}" count=0
  trap - EXIT
  # A diagnostic read/write failure cannot replace the original test status.
  set +e
  [[ -n "$case_name" ]] || case_name=setup
  if [[ "$original_status" == 0 ]]; then
    rm -rf -- "$tmp"
  else
    # Diagnostics are only this check's synthetic caller/transport fixture.
    # Never dump custody files, public records or the complete fixture tree.
    # Failed evidence remains at its original path for the CI owner.
    printf 'INIT_CONSENSUS_CANDIDATE_KEYS_CONTROLS_FAILED: exit=%s case=%s fixtureRetained=%s\n' \
      "$original_status" "$case_name" "$tmp" >&2
    if [[ -n "$case_root" && "$case_root" == "$tmp/"* && -d "$case_root" && ! -L "$case_root" ]]; then
      if [[ -f "$case_root/stderr" && ! -L "$case_root/stderr" ]]; then
        printf '%s\n' '--- synthetic caller stderr (first 4096 bytes) ---' >&2
        head -c 4096 -- "$case_root/stderr" >&2 || :
        printf '\n' >&2
      fi
      for path in "$case_root"/work/*.stderr; do
        [[ -f "$path" && ! -L "$path" ]] || continue
        (( count < 24 )) || break
        printf '%s\n' "--- synthetic ${path##*/} (first 1024 bytes) ---" >&2
        head -c 1024 -- "$path" >&2 || :
        printf '\n' >&2
        count=$((count + 1))
      done
      if [[ -f "$case_root/events" && ! -L "$case_root/events" ]]; then
        printf '%s\n' '--- synthetic transport events (last 4096 bytes) ---' >&2
        tail -c 4096 -- "$case_root/events" >&2 || :
        printf '\n' >&2
      fi
    fi
  fi
  exit "$original_status"
}
trap 'finish_controls "$?"' EXIT
mkdir -p "$tmp/repo/scripts/ops" "$tmp/repo/scripts/deploy" "$tmp/bin"
# Execute the original caller and BOTH original transport libraries. Only the
# build, JSON reader and remote boundary are doubles; no real Go/keygen/SSH or
# service is exercised. Remote paths are mapped into this disposable fixture.
cp "$repo/scripts/ops/init-consensus-candidate-keys.sh" "$tmp/repo/scripts/ops/"
cp "$repo/scripts/ops/lib.sh" "$tmp/repo/scripts/ops/"
cp "$repo/scripts/deploy/lib.sh" "$tmp/repo/scripts/deploy/"
cp "$repo/scripts/deploy/deploy-consensus-candidate.sh" "$tmp/repo/scripts/deploy/"
cat >"$tmp/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ $# == 3 && $1 == rev-parse && $2 == --short=12 && $3 == HEAD ]]; then
  printf 'abcdef012345\n'
elif [[ $# == 2 && $1 == rev-parse && $2 == HEAD ]]; then
  printf 'abcdef0123456789abcdef0123456789abcdef01\n'
else exit 90; fi
SH
cat >"$tmp/bin/uname" <<'SH'
#!/usr/bin/env bash
# The PQ caller only transports Linux bytes. The real portable DATA readers
# must work from the original Mac operator, with no local ELF execution.
[[ $# == 1 ]] || exit 90
case "$1" in -s) printf 'Darwin\n' ;; -m) printf 'arm64\n' ;; *) exit 90 ;; esac
SH
cat >"$tmp/bin/go" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 5 && $1 == build && $2 == -trimpath && $3 == -o && $5 == ./cmd/ynx-consensus-key-init ]]
[[ $4 == "$FIXTURE_ROOT"/* && $GOOS == linux && $GOARCH == amd64 && $CGO_ENABLED == 0 ]]
printf 'BUILD\n' >>"$FIXTURE_EVENTS"
if [[ ${FIXTURE_BUILD_FAIL:-} == yes ]]; then printf 'fixture build failure\n' >&2; exit 9; fi
cat >"$4" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail
mode='' role='' directory='' record=''
while (( $# )); do
  case "$1" in
    -mode) mode=$2; shift 2 ;;
    -role) role=$2; shift 2 ;;
    -key-dir) directory=$2; shift 2 ;;
    -public-record) record=$2; shift 2 ;;
    -owner-controlled) shift ;;
    *) exit 91 ;;
  esac
done
[[ $directory == "$FIXTURE_ROOT/remote/$role/$role" && $record == "$FIXTURE_ROOT/remote/$role/stage/"*/public-record.json ]]
printf 'KEY|%s|%s\n' "$mode" "$role" >>"$FIXTURE_EVENTS"
case "$mode" in
  create)
    mkdir -m 0700 "$directory"
    for name in priv_validator_key.json priv_validator_state.json node_key.json; do
      (set -o noclobber; printf 'SYNTHETIC SERIALIZER DATA, NOT A PRIVATE KEY: %s\n' "$name" >"$directory/$name")
      chmod 0600 "$directory/$name"
    done ;;
  inspect)
    [[ -d $directory ]]
    for name in priv_validator_key.json priv_validator_state.json node_key.json; do [[ -s $directory/$name ]]; done ;;
  *) exit 92 ;;
esac
case "$role" in
  primary) validator=ynx_validator_primary ;;
  singapore) validator=ynx_validator_singapore ;;
  silicon-valley) validator=ynx_validator_silicon_valley ;;
  seoul) validator=ynx_validator_seoul ;;
  *) exit 93 ;;
esac
(set -o noclobber; printf '{"version":1,"purpose":"ynx-production-bft-candidate-public-keys-only","role":"%s","validatorAddress":"%s","consensusKeyType":"tendermint/PubKeyEd25519","consensusPubKey":"synthetic-data-only","consensusAddress":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","nodeId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","custodyBoundary":"owner-controlled-host-local"}\n' "$role" "$validator" >"$record")
CLI
chmod 0700 "$4"
SH
cat >"$tmp/bin/node" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 4 && $1 == -e && $3 == "$FIXTURE_ROOT/work/public/$4.json.partial" ]]
grep -Fq 'v.role!==r' <<<"$2"
grep -Fq "\"role\":\"$4\"" "$3"
grep -Fq '"custodyBoundary":"owner-controlled-host-local"' "$3"
printf 'VALIDATE|%s\n' "$4" >>"$FIXTURE_EVENTS"
SH
cat >"$tmp/bin/id" <<'SH'
#!/usr/bin/env bash
if [[ $# == 2 && $1 == -u && $2 == ynx ]]; then printf '1000\n'; else exec /usr/bin/id "$@"; fi
SH
cat >"$tmp/bin/sudo" <<'SH'
#!/usr/bin/env bash
exec "$@"
SH
cat >"$tmp/bin/systemctl" <<'SH'
#!/usr/bin/env bash
[[ $# == 2 && $1 == is-active && $2 == ynx-chaind ]]
SH
cat >"$tmp/bin/stat" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 && $1 == -c && $3 == "$FIXTURE_ROOT/remote/"* ]]
case "$2" in
  %U:%a) printf '%s:%s\n' "${FIXTURE_METADATA_OWNER:-ynx}" "$(/usr/bin/stat -c %a "$3")" ;;
  %U:%a:%h) printf '%s:%s\n' "${FIXTURE_METADATA_OWNER:-ynx}" "$(/usr/bin/stat -c %a:%h "$3")" ;;
  *) exit 94 ;;
esac
SH
cat >"$tmp/bin/chown" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 && $1 == -R && $2 == ynx:ynx && $3 == "$FIXTURE_ROOT/remote/"* ]]
printf 'CUSTODY_CHOWN|%s\n' "$3" >>"$FIXTURE_EVENTS"
SH
cat >"$tmp/bin/install" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 8 && $1 == -d && $2 == -m && $3 == 0750 && $4 == -o && $5 == root && $6 == -g && $7 == ynx && $8 == "$FIXTURE_ROOT/remote/"* ]]
mkdir -p "$8"
chmod 0750 "$8"
SH
cat >"$tmp/bin/ssh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
role='' command=''
for arg in "$@"; do
  case "$arg" in
    fixture@fixture-primary.invalid) role=primary ;;
    fixture@fixture-singapore.invalid) role=singapore ;;
    fixture@fixture-silicon-valley.invalid) role=silicon-valley ;;
    fixture@fixture-seoul.invalid) role=seoul ;;
  esac
  command=$arg
done
[[ -n $role ]]
printf 'SSH|%s|%s\n' "$role" "$command" >>"$FIXTURE_EVENTS"
case "$command" in
  'id -u ynx >'*) stage=preflight ;;
  'umask 077; mkdir -m 0700 '*) stage=reserve ;;
  'umask 077; cat > '*) stage=copy ;;
  'chmod 0755 '*) stage=ceremony ;;
  'sudo /bin/bash -s -- '*) stage=pq ;;
  'sudo -u ynx /usr/bin/head -c 262145 -- '*) stage=pq-wire ;;
  *) printf 'unexpected fixture transport command\n' >&2; exit 95 ;;
esac
if [[ $stage == preflight ]]; then
  [[ $command != *'cat '* && $command != *'sha256sum '* && $command != *'head '* && $command != *'tail '* && $command != *'dd '* ]]
fi
# The original conditionals, loops and metadata tests execute as written.
# No command can touch a real /etc custody directory or /var/tmp stage.
command=${command//\/etc\/ynx\/consensus-candidate/$FIXTURE_ROOT/remote/$role}
command=${command//\/var\/tmp\/ynx-consensus-key-ceremony-/$FIXTURE_ROOT/remote/$role/stage/ynx-consensus-key-ceremony-}
command=${command//\/var\/tmp\/ynx-consensus-pq-ceremony-/$FIXTURE_ROOT/remote/$role/stage/ynx-consensus-pq-ceremony-}
[[ $command != *'/etc/ynx/'* && $command != *'/var/tmp/ynx-'* ]]
if [[ $stage == pq ]]; then
  # Only the remote host boundary is a model. The ORIGINAL caller, portable
  # public pin reader, full original runtime parser and public receipt reader
  # execute unchanged. Inert ELF DATA is never run on this operator.
  cat >"$FIXTURE_ROOT/remote-body.sh"
  grep -Fq "owner=ynx-pq-signer" "$FIXTURE_ROOT/remote-body.sh"
  grep -Fq 'exec 3<"$1"' "$FIXTURE_ROOT/remote-body.sh"
  grep -Fq 'exec 3<&0; exec 0</dev/null' "$FIXTURE_ROOT/remote-body.sh"
  grep -Fq 'set -Eeuo pipefail' "$FIXTURE_ROOT/remote-body.sh"
  grep -Fq 'decrypt --name=ynx-pq-recovery' "$FIXTURE_ROOT/remote-body.sh"
  grep -Fq -- '--state-dir "$state"' "$FIXTURE_ROOT/remote-body.sh"
  grep -Fq -- '--legacy-key-fd 3' "$FIXTURE_ROOT/remote-body.sh"
  ! grep -Eq 'chown -R|priv_validator_state|rm -|systemctl (start|stop)|broadcast_tx' "$FIXTURE_ROOT/remote-body.sh"
  # The command comes from this original controlled caller; eval only unquotes
  # its printf-%q argv. Nothing here executes the remote root source or ELF.
  eval "set -- $command"
  [[ $1 == sudo && $2 == /bin/bash && $3 == -s && $4 == -- ]]
  shift 4
  phase=$1; selected=$2; remote_stage=$3; binary=$4; binary_pin=$5
  out=$6; state_path=$7; approval=$8; input_pin=$9; genesis_pin=${10}; credential_pin=${11}
  [[ $# == 11 && $selected == "$role" && $role == primary && $remote_stage == "$FIXTURE_ROOT/remote/$role/stage/"* ]]
  [[ $(sha256sum "$remote_stage/$binary" | cut -d ' ' -f 1) == "$binary_pin" ]]
  [[ $out == '' || $out == "$FIXTURE_ROOT/remote/$role/"* ]]
  [[ $state_path == '' || $state_path == "$FIXTURE_ROOT/remote/$role/"* ]]
  [[ $approval == '' || $approval == "$FIXTURE_ROOT/remote/$role/"* ]]
  if [[ $phase != pq-inspect ]]; then
    [[ $(sha256sum "$remote_stage/public-input.json" | cut -d ' ' -f 1) == "$input_pin" ]]
    [[ $(sha256sum "$remote_stage/genesis.json" | cut -d ' ' -f 1) == "$genesis_pin" ]]
  fi
  case "$phase" in
    pq-new-epoch)
      [[ $binary == ynx-consensus-pq-key-init && -n $credential_pin && ! -e $out && ! -e $state_path ]]
      mkdir -m 0700 "$out" "$state_path"
      printf 'SYNTHETIC INERT VAULT; NOT KEY MATERIAL\n' >"$out/validator.encrypted"
      printf 'SYNTHETIC INERT HRS; NO SIGNER\n' >"$state_path/original-sign-state.json"
      printf 'PQ|new-epoch|%s|signer-uid|anonymous-fd3\n' "$role" >>"$FIXTURE_EVENTS"
      python3 - "$out" "$state_path" <<'PY'
import json, sys
out, state = sys.argv[1:]
print(json.dumps(dict(format='YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1', status='new_epoch_files_durable_registration_not_authorized', paths=dict(directory=out, state=state+'/original-sign-state.json'), binding=dict(SignerStatePath=state+'/original-sign-state.json'))))
PY
      # Simulate the original pipefail result after a consumer wrote a public
      # response: this MUST NOT publish a formal caller receipt or replay.
      [[ ${FIXTURE_PQ_LATE_FAILURE:-} != yes ]] || exit 7 ;;
    pq-inspect)
      [[ $binary == ynx-consensus-pq-key-init && $input_pin == '' && $genesis_pin == '' && $credential_pin == '' && -d $out && -d $state_path ]]
      printf 'PQ|inspect|%s|signer-uid|no-credential\n' "$role" >>"$FIXTURE_EVENTS"
      printf '{"status":"incomplete_or_uncertain_original_result","readOnly":true,"privateMaterialOpened":false,"registrationAuthorized":false}\n' ;;
    pq-approve-first-registration)
      [[ $binary == ynx-comet && $out == '' && $state_path == '' && $credential_pin == '' && ! -e $approval ]]
      [[ -f $FIXTURE_ROOT/remote/$role/$role/priv_validator_key.json ]]
      mkdir -m 0700 "$approval"
      printf 'SYNTHETIC PUBLIC COMPLETE REGISTRATION; NOT CRYPTO AUTHORITY\n' >"$approval/registration.wire"
      printf 'PQ|approve-first|%s|original-ynx-uid|regular-fd3\n' "$role" >>"$FIXTURE_EVENTS"
      python3 - "$approval" "$input_pin" "$genesis_pin" <<'PY'
import hashlib, json, sys
from pathlib import Path
directory, source, genesis = sys.argv[1:]
print(json.dumps(dict(version='YNX-FIRST-VALIDATOR-APPROVAL/v1', publicRecordSHA256=source, genesisSHA256=genesis, registrationSHA256=hashlib.sha256((Path(directory)/'registration.wire').read_bytes()).hexdigest(), authorizationSigned=True, broadcast=False, committed=False, pqActivated=False)))
PY
      ;;
    *) exit 96 ;;
  esac
elif [[ $stage == pq-wire ]]; then
  [[ $command == "sudo -u ynx /usr/bin/head -c 262145 -- '$FIXTURE_ROOT/remote/primary/approval/registration.wire'" ]]
  cat "$FIXTURE_ROOT/remote/primary/approval/registration.wire"
else
  bash -c "$command"
fi
if [[ ${FIXTURE_REMOTE_FAIL:-} == "$stage:$role" ]]; then
  # A lost ACK is injected AFTER the real fixture command took effect.
  printf 'fixture lost SSH acknowledgement after %s\n' "$stage" >&2
  exit 255
fi
SH
chmod 0700 "$tmp/bin/"*

fail() { printf 'key ceremony caller controls failed: %s\n' "$1" >&2; exit 1; }
new_case() {
  case_root="$tmp/$1"
  mkdir -m 0700 "$case_root"
  : >"$case_root/events"
  : >"$case_root/transport-reference"
  for role in primary singapore silicon-valley seoul; do mkdir -p "$case_root/remote/$role/stage"; done
  cat >"$case_root/deploy.env" <<ENV
PRIMARY_NODE_HOST=fixture-primary.invalid
PRIMARY_NODE_USER=fixture
PRIMARY_NODE_SSH_KEY=$case_root/transport-reference
SG_NODE_HOST=fixture-singapore.invalid
SG_NODE_USER=fixture
SG_NODE_SSH_KEY=$case_root/transport-reference
SILICON_VALLEY_NODE_HOST=fixture-silicon-valley.invalid
SILICON_VALLEY_NODE_USER=fixture
SILICON_VALLEY_NODE_SSH_KEY=$case_root/transport-reference
SEOUL_NODE_HOST=fixture-seoul.invalid
SEOUL_NODE_USER=fixture
SEOUL_NODE_SSH_KEY=$case_root/transport-reference
ENV
  build_fail='' remote_fail='' metadata_owner=ynx dry_run=0
}
run_caller() {
  env -i PATH="$tmp/bin:/usr/bin:/bin" ENV_FILE="$case_root/deploy.env" \
    FIXTURE_ROOT="$case_root" FIXTURE_EVENTS="$case_root/events" \
    FIXTURE_BUILD_FAIL="$build_fail" FIXTURE_REMOTE_FAIL="$remote_fail" \
    FIXTURE_METADATA_OWNER="$metadata_owner" \
    DEPLOY_DRY_RUN="$dry_run" CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED=yes \
    CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME="$1" \
    CONSENSUS_CANDIDATE_KEY_WORK_ROOT="$case_root/work" \
    YNX_SSH_CONTROL_DIR="$case_root/ssh-control" YNX_DEPLOY_CONNECTION_ATTEMPTS=5 \
    YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS=0 \
    bash "$tmp/repo/scripts/ops/init-consensus-candidate-keys.sh" >"$case_root/stdout" 2>"$case_root/stderr"
}
refused() { if run_caller "$1"; then fail "$2"; fi; }
count_events() { awk -v prefix="$1" 'index($0,prefix)==1 {n++} END {print n+0}' "$case_root/events"; }
seed_custody() {
  for role in primary singapore silicon-valley seoul; do
    mkdir -m 0700 "$case_root/remote/$role/$role"
    for name in priv_validator_key.json priv_validator_state.json node_key.json; do
      printf 'SYNTHETIC ORIGINAL DATA %s %s\n' "$role" "$name" >"$case_root/remote/$role/$role/$name"
      chmod 0600 "$case_root/remote/$role/$role/$name"
    done
  done
}
custody_digest() { find "$case_root/remote" -type f \( -name '*key.json' -o -name priv_validator_state.json \) | sort | xargs sha256sum; }

new_case existing-work
mkdir -p "$case_root/work/public"
printf 'UNKNOWN original intent\n' >"$case_root/work/intent.txt"
printf 'original public bytes\n' >"$case_root/work/public/primary.json.partial"
before="$(sha256sum "$case_root/work/intent.txt" "$case_root/work/public/primary.json.partial")"
refused yes 'existing work was replaced'
[[ $before == "$(sha256sum "$case_root/work/intent.txt" "$case_root/work/public/primary.json.partial")" && ! -s $case_root/events ]] || fail 'existing work evidence changed or reached build/transport'

new_case dangling-work
ln -s "$case_root/missing-original" "$case_root/work"
refused no 'dangling work symlink accepted'
[[ -L $case_root/work && ! -s $case_root/events ]] || fail 'dangling work evidence changed'

for missing in directory priv_validator_key.json priv_validator_state.json node_key.json; do
  new_case "resume-missing-$missing"
  if [[ $missing != directory ]]; then seed_custody; rm "$case_root/remote/primary/primary/$missing"; fi
  refused yes "resume accepted missing $missing"
  [[ $(count_events 'KEY|') == 0 && -s $case_root/work/intent.txt && -f $case_root/work/primary.preflight.stderr ]] || fail 'missing custody resume reached a key operation or lost intent'
  [[ $(count_events 'SSH|') == 1 ]] || fail 'failed preflight retried or reached later hosts'
done

for invalid in permissive symlink wrong-owner; do
  new_case "resume-$invalid"
  seed_custody
  path="$case_root/remote/primary/primary/priv_validator_state.json"
  case "$invalid" in
    permissive) chmod 0644 "$path" ;;
    symlink) mv "$path" "$path.original"; ln -s "$path.original" "$path" ;;
    wrong-owner) metadata_owner=root ;;
  esac
  refused yes "resume accepted $invalid original HRS"
  [[ $(count_events 'KEY|') == 0 ]] || fail 'invalid custody reached key operation'
done

new_case fresh
run_caller no
[[ $(count_events 'KEY|create|') == 4 && $(count_events 'KEY|inspect|') == 0 && $(count_events 'VALIDATE|') == 4 ]] || fail 'fresh mode did not create exactly once per original role'
for role in primary singapore silicon-valley seoul; do
  [[ $(count_events "KEY|create|$role") == 1 && -s $case_root/work/public/$role.json && -s $case_root/work/public/$role.json.partial ]] || fail 'fresh public evidence incomplete'
done
[[ $(find "$case_root/remote" -name public-record.json | wc -l) == 4 ]] || fail 'successful public remote evidence was deleted'

new_case resume
seed_custody
before="$(custody_digest)"
run_caller yes
[[ $(count_events 'KEY|inspect|') == 4 && $(count_events 'KEY|create|') == 0 && $(count_events 'CUSTODY_CHOWN|') == 0 && $before == "$(custody_digest)" ]] || fail 'resume generated identity, modified custody or skipped inspection'
for role in primary singapore silicon-valley seoul; do [[ $(count_events "KEY|inspect|$role") == 1 && -s $case_root/work/public/$role.json ]] || fail 'resume missing a role'; done

new_case build-failure
build_fail=yes
refused no 'build failure accepted'
[[ -s $case_root/work/intent.txt && -s $case_root/work/build.stderr && $(count_events 'SSH|') == 0 ]] || fail 'build failure evidence lost or dispatched'

for stage in copy ceremony; do
  new_case "lost-ack-$stage"
  remote_fail="$stage:primary"
  refused no 'lost SSH reply accepted'
  [[ -s $case_root/work/intent.txt && $(count_events 'SSH|primary|') == 3 && ! -e $case_root/work/public/primary.json ]] || {
    # Ceremony has one extra SSH call after reservation and copy.
    [[ $stage == ceremony && -s $case_root/work/intent.txt && $(count_events 'SSH|primary|') == 4 && ! -e $case_root/work/public/primary.json ]] || fail 'lost ACK retried or published a false result'
  }
  if [[ $stage == ceremony ]]; then
    [[ $(count_events 'KEY|create|primary') == 1 && -s $case_root/work/public/primary.json.partial && $(find "$case_root/remote/primary/stage" -name public-record.json | wc -l) == 1 ]] || fail 'post-create UNKNOWN lost original public/custody evidence'
  else
    [[ $(count_events 'KEY|') == 0 && -s $case_root/work/primary.copy.stderr && $(find "$case_root/remote/primary/stage" -name ynx-consensus-key-init | wc -l) == 1 ]] || fail 'copy UNKNOWN was not retained'
  fi
  events_before="$(sha256sum "$case_root/events")"
  refused no 'UNKNOWN work was reused'
  [[ $events_before == "$(sha256sum "$case_root/events")" ]] || fail 'UNKNOWN attempt was automatically retried'
done

new_case invalid-mode
refused typo 'unknown resume spelling silently selected create'
[[ ! -e $case_root/work && ! -s $case_root/events ]] || fail 'unknown mode reserved or dispatched work'

new_case dry-run
dry_run=1
run_caller no
grep -Fq 'no keys were generated' "$case_root/stdout"
[[ $(count_events 'KEY|') == 0 && $(count_events 'SSH|') == 0 ]] || fail 'dry run executed transport or keys'

# The existing full runtime validator reads these inert ELF/header fixtures.
# They cannot run as a CLI; no ELF/compiler or genuine key is used by this test.
python3 -B - "$tmp/pq-runtime" <<'PQ_RUNTIME_DATA'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1]); root.mkdir(mode=0o700); (root/'operator').mkdir(mode=0o700)
names = ('ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', 'ynx-consensus-pq-remote-signer', 'ynx-consensus-pq-key-init', 'ynx-consensus-proof-verify', 'ynx-consensus-package', 'ynx-consensus-keycheck')
operators = ('ynx-consensus-pq-remote-signer.service.in', 'ynx-consensus-pq-remote-signer-launch.sh', 'ynx-consensus-pq-remote-signer.conf.in')
def pin(raw): return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
header = bytearray(64); header[:7] = b'\x7fELF\x02\x01\x01'; header[16:18] = b'\x02\x00'; header[18:24] = b'\x3e\x00\x01\x00\x00\x00'
raw = bytes(header) + b'INERT ELF DATA; NEVER EXECUTE\n' + b'\0' * (1 << 20)
binaries, operator = {}, {}
for name in names: (root/name).write_bytes(raw); binaries[name] = pin(raw)
for name in operators:
    body = ('INERT PUBLIC TEMPLATE DATA '+name+'\n').encode()
    (root/'operator'/name).write_bytes(body); operator[name] = pin(body)
record = dict(version='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2', commit='abcdef0123456789abcdef0123456789abcdef01', runId='1', platform='linux/amd64', cometForkTree='b'*40, goMod=pin(b'data'), goSum=pin(b'data'), proofVerifierContract='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1', proofVerifierSources={name:pin(b'data') for name in ('internal/consensus/pq_light_proof.go', 'cmd/ynx-consensus-proof-verify/main.go', 'cmd/ynx-consensus-proof-verify/trust.go')}, binaries=binaries, operator=operator, runtimeStarted=False, publicDeployment=False, pqActivation=False, purpose='normal entrypoint binaries and operator configuration only; no keys, credentials, ledger or signing history')
(root/'SOURCE.json').write_bytes(json.dumps(record, separators=(',', ':')).encode())
PQ_RUNTIME_DATA
runtime_pin="$(sha256sum "$tmp/pq-runtime/SOURCE.json" | cut -d ' ' -f 1)"
new_pq_case() {
  new_case "$1"
  printf '{"purpose":"PUBLIC EPOCH REQUEST DATA; NO KEY OR AUTHORITY"}' >"$case_root/request.json"
  printf '{"purpose":"ORIGINAL PUBLIC GENESIS INPUT DATA; NO AUTHORITY"}' >"$case_root/genesis.json"
  pq_phase=pq-new-epoch; pq_role=primary; pq_resume=''; pq_late_failure=''
  pq_input="$case_root/request.json"; pq_input_pin="$(sha256sum "$pq_input" | cut -d ' ' -f 1)"
  pq_genesis="$case_root/genesis.json"; pq_genesis_pin="$(sha256sum "$pq_genesis" | cut -d ' ' -f 1)"
  pq_out="$case_root/remote/primary/new-custody"; pq_state="$case_root/remote/primary/new-history"
  pq_approval=''; pq_public=''; pq_public_pin=''; pq_credential_pin="$(printf 'c%.0s' {1..64})"; pq_runtime_pin=$runtime_pin
}
run_pq_caller() {
  env -i PATH="$tmp/bin:/usr/bin:/bin" ENV_FILE="$case_root/deploy.env" \
    FIXTURE_ROOT="$case_root" FIXTURE_EVENTS="$case_root/events" \
    FIXTURE_REMOTE_FAIL="$remote_fail" FIXTURE_PQ_LATE_FAILURE="$pq_late_failure" \
    CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED=yes CONSENSUS_CANDIDATE_KEY_PHASE="$pq_phase" \
    CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME="$pq_resume" CONSENSUS_CANDIDATE_KEY_ROLE="$pq_role" \
    CONSENSUS_CANDIDATE_KEY_WORK_ROOT="$case_root/work" \
    CONSENSUS_CANDIDATE_RUNTIME_BUNDLE="$tmp/pq-runtime" \
    CONSENSUS_CANDIDATE_RUNTIME_COMMIT=abcdef0123456789abcdef0123456789abcdef01 \
    CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256="$pq_runtime_pin" \
    CONSENSUS_PQ_EPOCH_REQUEST="$pq_input" CONSENSUS_PQ_EPOCH_REQUEST_SHA256="$pq_input_pin" \
    CONSENSUS_PQ_CONSENSUS_GENESIS="$pq_genesis" CONSENSUS_PQ_CONSENSUS_GENESIS_SHA256="$pq_genesis_pin" \
    CONSENSUS_PQ_KEY_DIRECTORY="$pq_out" CONSENSUS_PQ_STATE_DIRECTORY="$pq_state" \
    CONSENSUS_PQ_APPROVAL_DIRECTORY="$pq_approval" CONSENSUS_PQ_PUBLIC_RECORD="$pq_public" \
    CONSENSUS_PQ_PUBLIC_RECORD_SHA256="$pq_public_pin" CONSENSUS_PQ_ENCRYPTED_CREDENTIAL_SHA256="$pq_credential_pin" \
    YNX_SSH_CONTROL_DIR="$case_root/ssh-control" YNX_DEPLOY_CONNECTION_ATTEMPTS=5 \
    YNX_DEPLOY_CONNECTION_RETRY_DELAY_SECONDS=0 \
    bash "$tmp/repo/scripts/ops/init-consensus-candidate-keys.sh" >"$case_root/stdout" 2>"$case_root/stderr"
}

for invalid in phase role resume input-pin genesis-pin runtime-pin contained-path; do
  new_pq_case "pq-refuse-$invalid"
  case "$invalid" in
    phase) pq_phase=pq-auto-activate ;;
    role) pq_role=all ;;
    resume) pq_resume=yes ;;
    input-pin) pq_input_pin="$(printf 'e%.0s' {1..64})" ;;
    genesis-pin) pq_genesis_pin="$(printf 'e%.0s' {1..64})" ;;
    runtime-pin) pq_runtime_pin="$(printf 'e%.0s' {1..64})" ;;
    contained-path) pq_state="$pq_out/history" ;;
  esac
  if run_pq_caller; then fail "PQ accepted $invalid"; fi
  [[ ! -e $case_root/work && $(count_events 'SSH|') == 0 && $(count_events 'BUILD') == 0 ]] || fail 'bad PQ input reached transport/build or reserved a false attempt'
done

new_pq_case pq-new-selected-primary
seed_custody
before="$(custody_digest)"
run_pq_caller
[[ $(count_events 'PQ|new-epoch|primary|') == 1 && $(count_events 'PQ|approve-first|') == 0 && $(count_events 'BUILD') == 0 && $(count_events 'KEY|') == 0 ]] || fail 'PQ creation expanded to approval/legacy or local build'
[[ -s $case_root/work/public/primary.json && -s $pq_out/validator.encrypted && -s $pq_state/original-sign-state.json && $before == "$(custody_digest)" ]] || fail 'PQ creation lost public evidence or changed original custody'
[[ $(count_events 'SSH|primary|') == 5 && $(count_events 'SSH|singapore|') == 0 && $(count_events 'SSH|silicon-valley|') == 0 && $(count_events 'SSH|seoul|') == 0 ]] || fail 'PQ creation contacted an unselected original role'

new_pq_case pq-inspect-original-paths
mkdir -m 0700 "$pq_out" "$pq_state"
printf 'UNKNOWN original immutable marker\n' >"$pq_out/new-epoch-intent.json"
printf 'UNKNOWN original history\n' >"$pq_state/original-sign-state.json"
before="$(sha256sum "$pq_out/new-epoch-intent.json" "$pq_state/original-sign-state.json")"
pq_phase=pq-inspect; pq_credential_pin=''; pq_input=''; pq_input_pin=''; pq_genesis=''; pq_genesis_pin=''
run_pq_caller
[[ $(count_events 'PQ|inspect|primary|') == 1 && $(count_events 'PQ|new-epoch|') == 0 && $(count_events 'PQ|approve-first|') == 0 ]] || fail 'PQ inspect created a new epoch or approval'
[[ $before == "$(sha256sum "$pq_out/new-epoch-intent.json" "$pq_state/original-sign-state.json")" && -s $case_root/work/public/primary.json ]] || fail 'PQ inspect changed original state or discarded incomplete readback'

new_pq_case pq-explicit-original-approval
seed_custody
before="$(custody_digest)"
pq_phase=pq-approve-first-registration; pq_out=''; pq_state=''; pq_credential_pin=''
pq_approval="$case_root/remote/primary/approval"; pq_public="$pq_input"; pq_public_pin="$pq_input_pin"
run_pq_caller
[[ $(count_events 'PQ|approve-first|primary|original-ynx-uid|regular-fd3') == 1 && $(count_events 'PQ|new-epoch|') == 0 && $(count_events 'BUILD') == 0 ]] || fail 'original approval used new key lane or built locally'
[[ $before == "$(custody_digest)" && -s $case_root/work/public/primary.registration.wire && -s $case_root/work/public/primary.json ]] || fail 'approval changed original keys/HRS or omitted public complete wire'

for failure in transport late-decrypt; do
  new_pq_case "pq-unknown-$failure"
  if [[ $failure == transport ]]; then remote_fail=pq:primary; else pq_late_failure=yes; fi
  if run_pq_caller; then fail 'PQ UNKNOWN was accepted'; fi
  [[ $(count_events 'PQ|new-epoch|primary|') == 1 && -s $pq_out/validator.encrypted && -s $case_root/work/public/primary.json.partial && ! -e $case_root/work/public/primary.json ]] || fail 'PQ UNKNOWN was retried or falsely published'
  before="$(sha256sum "$case_root/events" "$pq_out/validator.encrypted" "$pq_state/original-sign-state.json")"
  if run_pq_caller; then fail 'PQ UNKNOWN work replayed'; fi
  [[ $before == "$(sha256sum "$case_root/events" "$pq_out/validator.encrypted" "$pq_state/original-sign-state.json")" ]] || fail 'PQ UNKNOWN originals changed or transport replayed'
done

printf 'INIT_CONSENSUS_CANDIDATE_KEYS_CONTROLS_DATA_ONLY: original callers and portable full runtime parser; inert ELF/public DATA with explicit remote-boundary models; no real keys, SSH, approval or deployment\n'
