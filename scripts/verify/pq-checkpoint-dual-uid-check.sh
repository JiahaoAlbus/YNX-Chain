#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
unset BASH_ENV ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH

# Source-only Linux CI regression. Execute only the normal, independently
# pinned consensus.test selector below. No daemon, node, service, actual
# custody, original checkpoint, credential, deployment or activation is used.
refuse() { printf 'PQ_CHECKPOINT_DUAL_UID_CHECK_REFUSED:%s\n' "$1" >&2; exit 1; }
[[ $# == 8 ]] || refuse 'four explicit option/value pairs are required'
binary= pin= engine_uid= signer_uid=
while [[ $# != 0 ]]; do
  case "$1" in
    --test-binary) [[ -z $binary ]] || refuse duplicate; binary=$2 ;;
    --test-binary-sha256) [[ -z $pin ]] || refuse duplicate; pin=$2 ;;
    --engine-uid) [[ -z $engine_uid ]] || refuse duplicate; engine_uid=$2 ;;
    --signer-uid) [[ -z $signer_uid ]] || refuse duplicate; signer_uid=$2 ;;
    *) refuse 'unknown or abbreviated option' ;;
  esac
  shift 2
done
[[ $(uname -s) == Linux && $binary =~ ^/[A-Za-z0-9_./-]+$ && ${binary##*/} == consensus.test &&
   $pin =~ ^[0-9a-f]{64}$ && $pin != 0000000000000000000000000000000000000000000000000000000000000000 ]] || refuse 'Linux normal binary and independent SHA required'
for uid in "$engine_uid" "$signer_uid"; do
  [[ $uid =~ ^[1-9][0-9]{0,9}$ ]] && (( 10#$uid <= 4294967295 )) || refuse 'canonical nonroot uint32 UID required'
  record=$(getent passwd "$uid") || refuse 'both original CI identities must already exist'
  [[ $record != *$'\n'* ]] || refuse 'ambiguous CI identity'
  IFS=: read -r account unused actual_uid rest <<<"$record"
  [[ -n $account && $actual_uid == "$uid" ]] || refuse 'CI identity differs from independent UID'
done
[[ $engine_uid != "$signer_uid" ]] || refuse 'two different nonroot identities required'
[[ $(realpath -e -- "$binary") == "$binary" && -f $binary && ! -L $binary && -r $binary && -x $binary &&
   $(stat -c '%h' -- "$binary") == 1 ]] || refuse 'normal single-link canonical executable required'
mode=$(stat -c '%a' -- "$binary")
(( (8#$mode & 0022) == 0 )) || refuse 'compiled input must not be group or other writable'
[[ $(od -An -tx1 -N7 -- "$binary" | tr -d ' \n') == 7f454c46020101 &&
   $(od -An -tx1 -j18 -N2 -- "$binary" | tr -d ' \n') == 3e00 ]] || refuse 'normal Linux amd64 ELF required'
actual=$(sha256sum -- "$binary"); [[ ${actual%% *} == "$pin" ]] || refuse 'compiled test binary SHA mismatch'
bytes=$(stat -c '%s' -- "$binary")
(( bytes > 0 && bytes <= 536870912 )) || refuse 'compiled binary exceeds fixed input bound'

if [[ $EUID != 0 ]]; then
  # Only this root coordinator changes credentials. It will spawn the SAME
  # normal test binary as the two explicitly pinned nonroot helpers.
  exec sudo -n -- /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C /bin/bash "$(realpath -e -- "${BASH_SOURCE[0]}")" \
    --test-binary "$binary" --test-binary-sha256 "$pin" --engine-uid "$engine_uid" --signer-uid "$signer_uid"
fi

source_identity=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$binary")
case_dir=$(mktemp -d /tmp/ynx-pq-checkpoint-dual-uid.XXXXXXXX)
[[ $(stat -c '%u:%a' -- "$case_dir") == 0:700 ]] || refuse 'exclusive root synthetic staging required'
finished=false
finish() {
  local status=$?
  trap - EXIT
  if [[ $status == 0 && $finished == true ]]; then
    rm -- "$case_dir/consensus.test" "$case_dir/stdout" "$case_dir/stderr" "$case_dir/summary.json"
    rmdir -- "$case_dir"
  else
    printf 'PQ_CHECKPOINT_DUAL_UID_CHECK_EVIDENCE_RETAINED:%s exit=%s\n' "$case_dir" "$status" >&2
    [[ ! -f $case_dir/stdout ]] || tail -c 32768 -- "$case_dir/stdout" >&2
    [[ ! -f $case_dir/stderr ]] || tail -c 8192 -- "$case_dir/stderr" >&2
  fi
  exit "$status"
}
trap finish EXIT
install -m 0555 -o root -g root -- "$binary" "$case_dir/consensus.test"
[[ $(stat -c '%u:%g:%a:%h:%s' -- "$case_dir/consensus.test") == "0:0:555:1:$bytes" ]] || refuse 'staged compiled binary metadata mismatch'
actual=$(sha256sum -- "$case_dir/consensus.test"); [[ ${actual%% *} == "$pin" ]] || refuse 'staged compiled binary SHA mismatch'
# Expose only this public normal-binary copy; do not chmod the original private
# build tree or any original source, key, HRS, account or checkpoint path.
chmod 0755 -- "$case_dir"
for uid in "$engine_uid" "$signer_uid"; do
  runuser -u "$(getent passwd "$uid" | cut -d: -f1)" -- /usr/bin/test -x "$case_dir/consensus.test" || refuse 'helper cannot execute the public staged copy'
done
: > "$case_dir/stdout"; : > "$case_dir/stderr"
set +e
/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \
  YNX_PQ_CHECKPOINT_DUAL_UID=authorized-source-only-two-uid \
  YNX_PQ_CHECKPOINT_ENGINE_UID="$engine_uid" YNX_PQ_CHECKPOINT_SIGNER_UID="$signer_uid" \
  YNX_PQ_CHECKPOINT_TEST_BINARY="$case_dir/consensus.test" \
  "$case_dir/consensus.test" -test.run='^TestPQCheckpointAccessTwoUIDOriginalStateLayouts$' -test.count=1 -test.timeout=180s -test.v \
  > "$case_dir/stdout" 2> "$case_dir/stderr" < /dev/null
status=$?
set -e
[[ $status == 0 && ! -s $case_dir/stderr ]] || refuse 'normal compiled two-UID regression failed'
[[ $(stat -c '%s' -- "$case_dir/stdout") -le 4194304 ]] || refuse 'unexpectedly large public regression log'
[[ $(grep -Fxc '=== RUN   TestPQCheckpointAccessTwoUIDOriginalStateLayouts' "$case_dir/stdout") == 1 &&
   $(grep -Ec '^--- PASS: TestPQCheckpointAccessTwoUIDOriginalStateLayouts \(' "$case_dir/stdout") == 1 &&
   $(tail -n1 -- "$case_dir/stdout") == PASS ]] || refuse 'actual selector did not pass exactly once'
if grep -Eq '(^|[[:space:]])--- (SKIP|FAIL):|^FAIL($|[[:space:]])|^panic:' "$case_dir/stdout"; then refuse 'skip or failure is not successful evidence'; fi
[[ $(grep -c 'PQ_CHECKPOINT_DUAL_UID_SOURCE_PASS ' "$case_dir/stdout") == 1 &&
   $(grep -Ec '^[[:space:]]+pq_checkpoint_access_linux_test\.go:[1-9][0-9]*: PQ_CHECKPOINT_DUAL_UID_SOURCE_PASS ' "$case_dir/stdout") == 1 ]] || refuse 'missing or duplicate actual two-UID summary'
sed -En 's/^[[:space:]]+pq_checkpoint_access_linux_test\.go:[1-9][0-9]*: PQ_CHECKPOINT_DUAL_UID_SOURCE_PASS //p' "$case_dir/stdout" > "$case_dir/summary.json"
jq -e --arg engine "$engine_uid" --arg signer "$signer_uid" '
  keys == (["version","engineUID","signerUID","nodeStarted","layouts"] | sort) and
  .version == "YNX-PQ-CHECKPOINT-DUAL-UID/v1" and .engineUID == $engine and .signerUID == $signer and .nodeStarted == false and
  (.layouts | type == "array") and ([.layouts[].layout] == ["atomic-json","snapshot-journal","block-journal"]) and
  (.layouts | all(keys == (["layout","directSourceDenied","engineCustodyDenied","readonlyFD","exactCheckpoint",
    "replacementReadable","originalReadLock","staleAndCorruptRejected"] | sort) and
    .directSourceDenied == true and .engineCustodyDenied == true and .readonlyFD == true and .exactCheckpoint == true and
    .replacementReadable == true and .staleAndCorruptRejected == true and
    .originalReadLock == (.layout != "atomic-json")))
' "$case_dir/summary.json" >/dev/null || refuse 'actual two-UID summary does not prove every required assertion'
actual=$(sha256sum -- "$binary"); [[ ${actual%% *} == "$pin" && $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$binary") == "$source_identity" ]] || refuse 'original compiled input changed'
actual=$(sha256sum -- "$case_dir/consensus.test"); [[ ${actual%% *} == "$pin" ]] || refuse 'staged binary changed during regression'
cat -- "$case_dir/stdout"
printf 'YNX_PQ_CHECKPOINT_DUAL_UID_CHECK_PASS sourceBinarySHA256=%s stagedBinarySHA256=%s engineUID=%s signerUID=%s nodeStarted=false publicDeployment=false\n' "$pin" "$pin" "$engine_uid" "$signer_uid"
finished=true
