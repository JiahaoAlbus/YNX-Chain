#!/usr/bin/env bash
set -e
YNX_HISTORY_EVENT_CASE=ceremony
source scripts/verify/pq-history-events-ci.sh
set -euo pipefail
umask 077
YNX_KEY_CEREMONY_CASE="$RUNNER_TEMP/ynx-original-key-ceremony-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
export YNX_KEY_CEREMONY_CASE
mkdir "$YNX_KEY_CEREMONY_CASE"
cp internal/consensus/key_ceremony.go "$YNX_KEY_CEREMONY_CASE/fixed.go"
git show df4c9717c6cedda089c4a350b36cb09240e6b919:internal/consensus/key_ceremony.go > "$YNX_KEY_CEREMONY_CASE/original.go"
trap 'cp "$YNX_KEY_CEREMONY_CASE/fixed.go" internal/consensus/key_ceremony.go' EXIT
python3 -B - <<'PY'
import os, re
from pathlib import Path
root = Path(os.environ['YNX_KEY_CEREMONY_CASE'])
pattern = r'(?ms)^func InitializeProductionKeyFiles\(.*?^}\n'
fixed = (root / 'fixed.go').read_text()
old = re.findall(pattern, (root / 'original.go').read_text())
if len(old) != 1:
    raise SystemExit('original key ceremony function is ambiguous')
replaced, count = re.subn(pattern, lambda _: old[0], fixed)
if count != 1:
    raise SystemExit('fixed key ceremony function is ambiguous')
# Only the new intent encoder uses this standard-library import.
# Replaying the old function must compile before its real overwrite
# can qualify as the expected assertion failure.
unused = '\t"encoding/json"\n'
if replaced.count(unused) != 1:
    raise SystemExit('new intent-only import is ambiguous')
replaced = replaced.replace(unused, '')
Path('internal/consensus/key_ceremony.go').write_text(replaced)
PY
set +e
go test -v -p 1 -count=1 -timeout=60s -run '^TestProductionKeyCeremonyPublicPathCannotReplaceGeneratedPrivateKey$' ./internal/consensus > "$YNX_KEY_CEREMONY_CASE/original-red.log" 2>&1
YNX_KEY_CEREMONY_RED_STATUS=$?
set -e
cp "$YNX_KEY_CEREMONY_CASE/fixed.go" internal/consensus/key_ceremony.go
trap - EXIT
cat "$YNX_KEY_CEREMONY_CASE/original-red.log"
test "$YNX_KEY_CEREMONY_RED_STATUS" -ne 0
grep -F 'public output replaced generated custody or hid the failure: <nil>' "$YNX_KEY_CEREMONY_CASE/original-red.log"
go test -v -p 1 -count=1 -timeout=90s -run '^TestProductionKeyCeremony' ./internal/consensus
go test -v -p 1 -count=1 -timeout=60s ./cmd/ynx-consensus-key-init
bash scripts/verify/init-consensus-candidate-keys-check.sh

test "$YNX_HISTORY_EVENT_INDEX" -eq 3
test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
