#!/usr/bin/env bash
# Finance-only production executor. It accepts only a Central-signed lease
# carrier and rechecks every signed fresh baseline before the first write.
set -euo pipefail
if [[ $# -ne 2 || ( "$1" != deploy && "$1" != rollback ) ]]; then
  echo "usage: $0 <deploy|rollback> <central-signed-finance-lease.json>" >&2; exit 64
fi
mode=$1; lease=$2
case "$lease" in /opt/ynx/leases/finance/*.json) ;; *) exit 65;; esac
test -f "$lease" && test ! -L "$lease"
command -v jq >/dev/null || { echo 'jq required for signed lease object' >&2; exit 69; }
signed=$(jq -er '.lease.signed' "$lease"); test "$signed" = true
get(){ jq -er "$1" "$lease"; }
LEASE_ID=$(get '.lease.id')
hash(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
http_hash(){ curl --fail --silent --show-error --max-time 10 "$1" | sha256sum | awk '{print $1}'; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
archive=$(get '.candidate.archive.path'); archive_sha=$(get '.candidate.archive.sha256'); archive_bytes=$(get '.candidate.archive.bytes')
binary_bytes=$(get '.candidate.binary.bytes')
binary_sha=$(get '.candidate.binary.sha256'); current=$(get '.fresh.currentLink'); old=$(get '.fresh.activeRelease'); old_binary=$(get '.fresh.binary.path'); old_binary_sha=$(get '.fresh.binary.sha256')
env=$(get '.fresh.env.path'); env_sha=$(get '.fresh.env.sha256'); unit=$(get '.fresh.unit.path'); unit_sha=$(get '.fresh.unit.sha256'); caddy=$(get '.fresh.caddy.path'); caddy_sha=$(get '.fresh.caddy.sha256'); service=$(get '.fresh.service.name')
stage=$(get '.paths.stage'); backup=$(get '.paths.backup'); release=$(get '.paths.release'); new_env=$(get '.candidate.env.path'); new_env_sha=$(get '.candidate.env.sha256'); state=$(get '.fresh.state.path'); state_absent=$(get '.fresh.state.absent')
for value in "$archive" "$new_env"; do case "$value" in /opt/ynx/stage/finance/$LEASE_ID/*) ;; *) exit 65;; esac; done
for value in "$stage" "$backup" "$release"; do case "$value" in /opt/ynx/*/$LEASE_ID/*) ;; *) exit 65;; esac; parent=$(dirname "$value"); test -d "$parent" && test ! -L "$parent"; test "$(realpath -e "$parent")" = "$parent"; done
loop_health=$(get '.fresh.verifier.loopbackHealth'); loop_version=$(get '.fresh.verifier.loopbackVersion'); public_health=$(get '.fresh.verifier.publicHealth'); public_version=$(get '.fresh.verifier.publicVersion')
old_loop_health_sha=$(get '.fresh.verifier.sha256.loopbackHealth'); old_loop_version_sha=$(get '.fresh.verifier.sha256.loopbackVersion'); old_public_health_sha=$(get '.fresh.verifier.sha256.publicHealth'); old_public_version_sha=$(get '.fresh.verifier.sha256.publicVersion')
verify_old_live(){ test "$(http_hash "$loop_health")" = "$old_loop_health_sha"; test "$(http_hash "$loop_version")" = "$old_loop_version_sha"; test "$(http_hash "$public_health")" = "$old_public_health_sha"; test "$(http_hash "$public_version")" = "$old_public_version_sha"; }
verify_candidate_live(){ test "$(http_hash "$loop_health")" = "$(get '.candidate.verifier.sha256.loopbackHealth')"; test "$(http_hash "$loop_version")" = "$(get '.candidate.verifier.sha256.loopbackVersion')"; test "$(http_hash "$public_health")" = "$(get '.candidate.verifier.sha256.publicHealth')"; test "$(http_hash "$public_version")" = "$(get '.candidate.verifier.sha256.publicVersion')"; jq -e '.candidate.assets|length>0' "$lease" >/dev/null; }
assert_fresh(){
  test "$(readlink -f "$current")" = "$old"; test "$(hash "$old_binary")" = "$old_binary_sha"; file "$old_binary" | grep -q 'ELF 64-bit.*x86-64'
  test "$(hash "$env")" = "$env_sha"; test "$(hash "$unit")" = "$unit_sha"; test "$(hash "$caddy")" = "$caddy_sha"; systemctl is-active --quiet "$service"
  jq -e '.fresh.verifier.loopbackHealth and .fresh.verifier.loopbackVersion and .fresh.verifier.publicHealth and .fresh.verifier.publicVersion and .fresh.verifier.sha256' "$lease" >/dev/null; verify_old_live
}
restore(){
  systemctl stop "$service" || true; test "$(hash "$backup/env")" = "$env_sha"; tmp=$(mktemp "$(dirname "$env")/.finance.env.restore.XXXXXX"); cp --preserve=mode,ownership "$backup/env" "$tmp"; mv -Tf "$tmp" "$env"; if [[ "$state_absent" = true ]]; then test -f "$backup/state-absent"; if test -e "$state"; then test -f "$state" && test ! -L "$state"; stat -Lc '%u:%g:%a:%h:%s' "$state" >"$backup/candidate-state-stat"; rm -- "$state"; fi; test ! -e "$state" && test ! -L "$state"; else test "$(hash "$backup/state")" = "$(get '.fresh.state.sha256')"; cp --preserve=mode,ownership "$backup/state" "$state"; fi
  link="$current.rollback"; absent "$link"; ln -s "$old" "$link"; mv -Tf "$link" "$current"; systemctl start "$service"; assert_fresh
}
if [[ "$mode" == rollback ]]; then restore; exit 0; fi
absent "$stage"; absent "$backup"; absent "$release"; assert_fresh
test "$(bytes "$archive")" = "$archive_bytes"; test "$(hash "$archive")" = "$archive_sha"; test "$(hash "$new_env")" = "$new_env_sha"
mkdir -p -m 0700 "$stage" "$backup"; cp --preserve=mode,ownership "$env" "$backup/env"; if [[ "$state_absent" = true ]]; then test ! -e "$state" && test ! -L "$state"; : >"$backup/state-absent"; else cp --preserve=mode,ownership "$state" "$backup/state"; fi; tar -xzf "$archive" -C "$stage"
candidate="$stage/$(basename "$release")"; test -x "$candidate/ynx-finance"; test "$(hash "$candidate/ynx-finance")" = "$binary_sha"; test "$(bytes "$candidate/ynx-finance")" = "$binary_bytes"; file "$candidate/ynx-finance" | grep -q 'ELF 64-bit.*x86-64'
trap 'restore' EXIT
mv "$candidate" "$release"; tmp=$(mktemp "$(dirname "$env")/.finance.env.next.XXXXXX"); cp --preserve=mode,ownership "$new_env" "$tmp"; mv -Tf "$tmp" "$env"
link="$current.next"; absent "$link"; ln -s "$release" "$link"; mv -Tf "$link" "$current"; systemctl restart "$service"
get '.candidate.sourceCommit' | grep -qx '7824af677dd052d20321431381523ab302614d98'; verify_candidate_live
trap - EXIT
