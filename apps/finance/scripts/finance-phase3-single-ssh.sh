#!/usr/bin/env bash
# Local one-attempt transport wrapper. The signed lease supplies the literal
# SSH argv; this wrapper only preserves stdin/stdout/stderr and the real rc.
set -euo pipefail
if [[ $# -lt 5 ]]; then exit 64; fi
stdin=$1; stdout=$2; stderr=$3; receipt=$4; shift 4
for path in "$stdin" "$stdout" "$stderr" "$receipt"; do case "$path" in /tmp/*) ;; *) exit 65;; esac; done
test -f "$stdin" || exit 65
test ! -L "$stdin" || exit 65
test ! -e "$receipt" || exit 65
test ! -L "$receipt" || exit 65
set +e
"$@" <"$stdin" >"$stdout" 2>"$stderr"
ssh_rc=$?
set -e
pending="$receipt.pending"
test ! -e "$pending" || exit 65
test ! -L "$pending" || exit 65
set -C; printf '%s\n' "$ssh_rc" >"$pending"; set +C
test -f "$pending" || exit 74
test ! -L "$pending" || exit 74
mv -T -- "$pending" "$receipt"
exit "$ssh_rc"
