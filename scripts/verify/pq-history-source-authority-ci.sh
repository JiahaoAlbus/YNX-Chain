#!/usr/bin/env bash
set -e
YNX_HISTORY_EVENT_CASE=source-authority
source scripts/verify/pq-history-events-ci.sh
YNX_PRESERVE_CASE="$RUNNER_TEMP/ynx-migration-preservation-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
umask 077
mkdir "$YNX_PRESERVE_CASE"
cp internal/consensus/application.go "$YNX_PRESERVE_CASE/fixed-application.go"
cp internal/consensus/runtime_upgrade.go "$YNX_PRESERVE_CASE/fixed-runtime-upgrade.go"
trap 'cp "$YNX_PRESERVE_CASE/fixed-application.go" internal/consensus/application.go; cp "$YNX_PRESERVE_CASE/fixed-runtime-upgrade.go" internal/consensus/runtime_upgrade.go' EXIT
python3 -B - <<'PY'
from pathlib import Path
for name in ('application.go', 'runtime_upgrade.go'):
    path = Path('internal/consensus') / name
    text = path.read_text()
    fixed = 'validateMigrationPreservationClosure(migration)'
    assert text.count(fixed) == 1
    path.write_text(text.replace(fixed, 'validateMigrationExecutionClosure(migration)'))
PY
set +e
go test -p 1 -count=1 -timeout=90s -v -run '^TestMigrationPreservationFactoryKeepsSourceAndIndependentExecution$' ./internal/consensus > "$YNX_PRESERVE_CASE/original-red.log" 2>&1
YNX_PRESERVE_RED_STATUS=$?
set -e
cp "$YNX_PRESERVE_CASE/fixed-application.go" internal/consensus/application.go
cp "$YNX_PRESERVE_CASE/fixed-runtime-upgrade.go" internal/consensus/runtime_upgrade.go
trap - EXIT
cat "$YNX_PRESERVE_CASE/original-red.log"
test "$YNX_PRESERVE_RED_STATUS" -ne 0
grep -Fq '=== RUN   TestMigrationPreservationFactoryKeepsSourceAndIndependentExecution' "$YNX_PRESERVE_CASE/original-red.log"
grep -Eq '^--- FAIL: TestMigrationPreservationFactoryKeepsSourceAndIndependentExecution' "$YNX_PRESERVE_CASE/original-red.log"
grep -F 'MIGRATION_PRESERVATION_FACTORY_BLOCKED' "$YNX_PRESERVE_CASE/original-red.log"
go test -p 1 -count=1 -timeout=90s -v -run '^(TestMigrationPreservation|TestMigrationPaySourceDoesNotInventMerchantAuthority$)' ./internal/consensus

test "$YNX_HISTORY_EVENT_INDEX" -eq 2
test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
