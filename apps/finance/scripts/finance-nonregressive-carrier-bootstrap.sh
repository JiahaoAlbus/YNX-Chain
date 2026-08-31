#!/usr/bin/env bash
# Finance-only atomic carrier preparation. The signed lease is a base64 argv;
# stdin is exactly the deterministic candidate archive.
set -euo pipefail
if [[ $# -ne 1 ]]; then exit 64; fi
lease_json=$(printf '%s' "$1" | base64 -d) || exit 65
get(){ printf '%s' "$lease_json" | jq -er "$1"; }
test "$(get '.lease.signed')" = true
test "$(get '.lease.kind')" = FINANCE_NONREGRESSIVE_CARRIER_PREPARATION
id=$(get '.lease.id')
case "$id" in finance-combined-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9TtZz-]*) ;; *) exit 65;; esac
case "$id" in *..*|*/*|*[!A-Za-z0-9-]*) exit 65;; esac
expires=$(get '.lease.expiresAt'); test "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '<' "$expires"
dt(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
ft(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
identity(){ stat -Lc '%d:%i' "$1"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
root=/opt/ynx; stage="$root/stage/finance"; env=/etc/ynx/finance.env
carrier="$stage/$id"; archive="$carrier/candidate.tgz"; archive_pending="$archive.pending"; candidate_env="$carrier/finance.env"; env_pending="$candidate_env.pending"
test "$carrier" = "$(get '.paths.carrier')"
test "$(dt "$root")" = "$(get '.fresh.rootTuple')"
test "$(dt "$stage")" = "$(get '.fresh.stageTuple')"
test -f "$env" && test ! -L "$env"
test "$(ft "$env")" = "$(get '.fresh.env.tuple')"
test "$(bytes "$env")" = "$(get '.fresh.env.bytes')"
test "$(sha "$env")" = "$(get '.fresh.env.sha256')"
release_web=$(get '.candidate.releaseWebDir')
case "$release_web" in /opt/ynx/releases/finance/*/ynx-finance-*/web) ;; *) exit 65;; esac
case "$release_web" in *..*|*//*) exit 65;; esac
test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$env")" = 1
for path in "$carrier" "$archive" "$archive_pending" "$candidate_env" "$env_pending"; do absent "$path"; done
carrier_created=false; archive_pending_created=false; archive_created=false; env_pending_created=false; env_created=false
cleanup(){
  local rc=$? cleanup_rc=0
  set +e
  if [[ "$env_created" = true ]]; then test -f "$candidate_env" && test ! -L "$candidate_env" && test "$(identity "$candidate_env")" = "$env_identity" && test "$(sha "$candidate_env")" = "$env_sha" && rm -f -- "$candidate_env" || cleanup_rc=74; fi
  if [[ "$env_pending_created" = true ]]; then test -f "$env_pending" && test ! -L "$env_pending" && test "$(identity "$env_pending")" = "$env_pending_identity" && rm -f -- "$env_pending" || cleanup_rc=74; fi
  if [[ "$archive_created" = true ]]; then test -f "$archive" && test ! -L "$archive" && test "$(identity "$archive")" = "$archive_identity" && test "$(sha "$archive")" = "$archive_sha" && rm -f -- "$archive" || cleanup_rc=74; fi
  if [[ "$archive_pending_created" = true ]]; then test -f "$archive_pending" && test ! -L "$archive_pending" && test "$(identity "$archive_pending")" = "$archive_pending_identity" && rm -f -- "$archive_pending" || cleanup_rc=74; fi
  if [[ "$carrier_created" = true ]]; then test "$(identity "$carrier")" = "$carrier_identity" && test -z "$(find "$carrier" -mindepth 1 -print -quit)" && rmdir -- "$carrier" || cleanup_rc=74; fi
  set -e
  trap - EXIT
  [[ "$cleanup_rc" = 0 ]] || exit "$cleanup_rc"
  exit "$rc"
}
trap cleanup EXIT
mkdir -m 0700 -- "$carrier"; carrier_created=true; carrier_identity=$(identity "$carrier")
test "$(stat -Lc '%u:%g:%a' "$carrier")" = "$(get '.candidate.carrierOwnerMode')" || exit 65
umask 077
set -C; exec 3> "$archive_pending"; set +C; archive_pending_created=true; archive_pending_identity=$(identity "$archive_pending")
cat >&3; exec 3>&-
test "$(identity "$archive_pending")" = "$archive_pending_identity"
test "$(bytes "$archive_pending")" = "$(get '.candidate.archive.bytes')"
test "$(sha "$archive_pending")" = "$(get '.candidate.archive.sha256')"
chmod 0600 "$archive_pending"; mv -T -- "$archive_pending" "$archive"; archive_pending_created=false; archive_created=true; archive_identity=$(identity "$archive"); test "$archive_identity" = "$archive_pending_identity"; archive_sha=$(sha "$archive")
test -f "$archive" && test ! -L "$archive" && test "$(bytes "$archive")" = "$(get '.candidate.archive.bytes')" && test "$archive_sha" = "$(get '.candidate.archive.sha256')"
set -C; exec 4> "$env_pending"; set +C; env_pending_created=true; env_pending_identity=$(identity "$env_pending")
awk -v value="$release_web" 'BEGIN{count=0} /^YNX_FINANCE_WEB_DIR=/{print "YNX_FINANCE_WEB_DIR=" value;count++;next} {print} END{if(count!=1)exit 65}' "$env" >&4
exec 4>&-
test "$(identity "$env_pending")" = "$env_pending_identity"
chown "$(stat -Lc '%u:%g' "$env")" "$env_pending"; chmod "$(stat -Lc '%a' "$env")" "$env_pending"
test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$env_pending")" = 1
mv -T -- "$env_pending" "$candidate_env"; env_pending_created=false; env_created=true; env_identity=$(identity "$candidate_env"); test "$env_identity" = "$env_pending_identity"; env_sha=$(sha "$candidate_env")
test -f "$candidate_env" && test ! -L "$candidate_env"
expected=$(printf '%s\n%s\n' "$archive" "$candidate_env" | LC_ALL=C sort)
observed=$(find "$carrier" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort)
test "$observed" = "$expected"
printf 'phase=carrier-preparation\ncarrier=%s\ncarrierTuple=%s\narchive=%s\narchiveTuple=%s\narchiveBytes=%s\narchiveSha256=%s\ncandidateEnv=%s\ncandidateEnvTuple=%s\ncandidateEnvBytes=%s\ncandidateEnvSha256=%s\n' "$carrier" "$(dt "$carrier")" "$archive" "$(ft "$archive")" "$(bytes "$archive")" "$archive_sha" "$candidate_env" "$(ft "$candidate_env")" "$(bytes "$candidate_env")" "$env_sha"
trap - EXIT
