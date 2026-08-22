#!/usr/bin/env bash
# Single-use preparation only: creates a leased carrier and freezes candidate
# env/archive metadata. It has no service, symlink, Caddy, state, or HTTP path.
set -euo pipefail
if [[ $# -ne 1 ]]; then echo 'usage: preparation <central-signed-preparation-lease.json>' >&2; exit 64; fi
lease=$1
case "$lease" in /opt/ynx/leases/finance-preparation/*.json) ;; *) exit 65;; esac
test -f "$lease" && test ! -L "$lease"; command -v jq >/dev/null || exit 69
get(){ jq -r "$1" "$lease"; }; test "$(get '.lease.signed')" = true; test "$(get '.lease.kind')" = FINANCE_CANDIDATE_ENV_PREPARATION
lease_id=$(get '.lease.id'); parent=$(get '.paths.parent.path'); carrier=$(get '.paths.carrier'); parent_tuple=$(get '.paths.parent.tuple')
test "$parent" = /opt/ynx/stage/finance; test "$carrier" = "$parent/$lease_id"; test -d "$parent" && test ! -L "$parent" && test "$(realpath -e "$parent")" = "$parent"; test "$(stat -Lc '%d:%i:%u:%g:%a:%h' "$parent")" = "$parent_tuple"; test -d "$carrier" && test ! -L "$carrier"; test "$(stat -Lc '%d:%i:%u:%g:%a:%h' "$carrier")" = "$(get '.placement.carrierTuple')"
env=/etc/ynx/finance.env; test -f "$env" && test ! -L "$env"; test "$(sha256sum "$env" | awk '{print $1}')" = "$(get '.fresh.env.sha256')"; test "$(wc -c < "$env" | tr -d ' ')" = "$(get '.fresh.env.bytes')"; test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$env")" = 1
input=$(get '.archive.input.path'); archive=$(get '.archive.carrier.path'); test "$archive" = "$carrier/$(get '.archive.carrierBasename')"; test -f "$input" && test ! -L "$input"; test "$(sha256sum "$input" | awk '{print $1}')" = "$(get '.archive.sha256')"; test "$(wc -c < "$input" | tr -d ' ')" = "$(get '.archive.bytes')"
generator=$(get '.generator.path'); test -f "$generator" && test ! -L "$generator"; test "$(sha256sum "$generator" | awk '{print $1}')" = "$(get '.generator.sha256')"; test "$(wc -c < "$generator" | tr -d ' ')" = "$(get '.generator.bytes')"
test -f "$archive" && test ! -L "$archive"; test "$(sha256sum "$archive" | awk '{print $1}')" = "$(get '.archive.sha256')"; test "$(wc -c < "$archive" | tr -d ' ')" = "$(get '.archive.bytes')"; test ! -e "$carrier/finance.env" && test ! -L "$carrier/finance.env"
"$generator" "$env" "$carrier/finance.env" "$(get '.candidate.releaseWebDir')" >/dev/null
candidate="$carrier/finance.env"; test -f "$candidate" && test ! -L "$candidate"
printf 'carrier=%s\ncarrierTuple=%s\narchive=%s\narchiveBytes=%s\narchiveSha256=%s\ncandidateEnv=%s\ncandidateEnvBytes=%s\ncandidateEnvSha256=%s\ncandidateEnvTuple=%s\n' "$carrier" "$(stat -Lc '%d:%i:%u:%g:%a:%h' "$carrier")" "$archive" "$(wc -c < "$archive" | tr -d ' ')" "$(sha256sum "$archive" | awk '{print $1}')" "$candidate" "$(wc -c < "$candidate" | tr -d ' ')" "$(sha256sum "$candidate" | awk '{print $1}')" "$(stat -Lc '%d:%i:%u:%g:%a:%h' "$candidate")"
