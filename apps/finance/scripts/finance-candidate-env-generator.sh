#!/usr/bin/env bash
# Generates only a hash/metadata receipt. It never prints environment content.
set -euo pipefail
if [[ $# -ne 3 ]]; then echo 'usage: generator <existing-env> <absent-candidate-env> <release-web-dir>' >&2; exit 64; fi
source_env=$1; candidate_env=$2; release_web_dir=$3
case "$source_env" in /etc/ynx/finance.env) ;; *) exit 65;; esac
case "$candidate_env" in /opt/ynx/stage/finance/*/finance.env) ;; *) exit 65;; esac
case "$release_web_dir" in
  /opt/ynx/releases/finance/ynx-finance-*/web|/opt/ynx/releases/finance/finance-combined-*/ynx-finance-*/web) ;;
  *) exit 65;;
esac
test -f "$source_env" && test ! -L "$source_env" && test -r "$source_env"
test ! -e "$candidate_env" && test ! -L "$candidate_env"
test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$source_env")" = 1
mkdir -p -m 0700 "$(dirname "$candidate_env")"
tmp=$(mktemp "$(dirname "$candidate_env")/.finance.env.candidate.XXXXXX")
trap 'rm -f "$tmp"' EXIT
cp --preserve=mode,ownership "$source_env" "$tmp"
awk -v target="$release_web_dir" 'BEGIN{count=0} /^YNX_FINANCE_WEB_DIR=/{print "YNX_FINANCE_WEB_DIR=" target; count++; next} {print} END{exit(count == 1 ? 0 : 65)}' "$source_env" > "$tmp.derived"
chown --reference="$source_env" "$tmp.derived"
chmod --reference="$source_env" "$tmp.derived"
mv -Tf "$tmp.derived" "$tmp"
test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$tmp")" = 1
test "$(grep '^YNX_FINANCE_WEB_DIR=' "$tmp")" = "YNX_FINANCE_WEB_DIR=$release_web_dir"
mv -Tf "$tmp" "$candidate_env"
trap - EXIT
sha=$(sha256sum "$candidate_env" | awk '{print $1}')
bytes=$(wc -c < "$candidate_env" | tr -d ' ')
tuple=$(stat -Lc '%u:%g:%a:%h' "$candidate_env")
printf 'path=%s\nbytes=%s\nsha256=%s\ntuple=%s\nreleaseWebDir=%s\n' "$candidate_env" "$bytes" "$sha" "$tuple" "$release_web_dir"
