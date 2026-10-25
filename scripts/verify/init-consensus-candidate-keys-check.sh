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
cat >"$tmp/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 && $1 == rev-parse && $2 == --short=12 && $3 == HEAD ]]
printf 'abcdef012345\n'
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
  *) printf 'unexpected fixture transport command\n' >&2; exit 95 ;;
esac
if [[ $stage == preflight ]]; then
  [[ $command != *'cat '* && $command != *'sha256sum '* && $command != *'head '* && $command != *'tail '* && $command != *'dd '* ]]
fi
# The original conditionals, loops and metadata tests execute as written.
# No command can touch a real /etc custody directory or /var/tmp stage.
command=${command//\/etc\/ynx\/consensus-candidate/$FIXTURE_ROOT/remote/$role}
command=${command//\/var\/tmp\/ynx-consensus-key-ceremony-/$FIXTURE_ROOT/remote/$role/stage/ynx-consensus-key-ceremony-}
[[ $command != *'/etc/ynx/'* && $command != *'/var/tmp/ynx-'* ]]
bash -c "$command"
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

printf 'INIT_CONSENSUS_CANDIDATE_KEYS_CONTROLS_DATA_ONLY: original caller; stub build/JSON/transport, no real keys, SSH or deployment\n'
