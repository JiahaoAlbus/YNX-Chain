#!/usr/bin/env bash
set -e
YNX_HISTORY_EVENT_CASE=journal
source scripts/verify/pq-history-events-ci.sh
YNX_READ_CASE="$RUNNER_TEMP/ynx-pq-state-read-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
umask 077
mkdir "$YNX_READ_CASE"
cp internal/consensus/pq_engine_file_source.go "$YNX_READ_CASE/fixed-source.go"
trap 'cp "$YNX_READ_CASE/fixed-source.go" internal/consensus/pq_engine_file_source.go' EXIT
python3 -B - <<'PY'
from pathlib import Path
path = Path('internal/consensus/pq_engine_file_source.go')
text = path.read_text()
fixed = 'readPQEngineCommittedStateOwned(statePath, witness, authorization, runtime, capture)'
assert text.count(fixed) == 1
path.write_text(text.replace(fixed, 'loadCommittedStateOwned(statePath, witness)'))
PY
set +e
go test -p 1 -count=1 -timeout=90s -v -run '^TestPQEngineStateReadActualLayoutsRegistryRotationRevocation$' ./internal/consensus > "$YNX_READ_CASE/original-red.log" 2>&1
YNX_READ_RED_STATUS=$?
set -e
cp "$YNX_READ_CASE/fixed-source.go" internal/consensus/pq_engine_file_source.go
trap - EXIT
cat "$YNX_READ_CASE/original-red.log"
test "$YNX_READ_RED_STATUS" -ne 0
test "$(grep -c 'actual fresh signing source rejected the complete layout' "$YNX_READ_CASE/original-red.log")" -eq 2
grep -F -- '--- PASS: TestPQEngineStateReadActualLayoutsRegistryRotationRevocation/atomic-json' "$YNX_READ_CASE/original-red.log"
go test -p 1 -count=1 -timeout=120s -v -run '^TestPQEngineStateRead' ./internal/consensus

test "$YNX_HISTORY_EVENT_INDEX" -eq 2
test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
