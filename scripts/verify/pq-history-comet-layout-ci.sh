#!/usr/bin/env bash
set -e
YNX_HISTORY_EVENT_CASE=comet-layout
source scripts/verify/pq-history-events-ci.sh
YNX_COMET_LAYOUT_CASE="$RUNNER_TEMP/ynx-comet-layout-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
umask 077
mkdir "$YNX_COMET_LAYOUT_CASE"
cp cmd/ynx-comet/runtime_upgrade.go "$YNX_COMET_LAYOUT_CASE/fixed-operator.go"
trap 'cp "$YNX_COMET_LAYOUT_CASE/fixed-operator.go" cmd/ynx-comet/runtime_upgrade.go' EXIT
python3 -B - <<'PY'
from pathlib import Path
path = Path('cmd/ynx-comet/runtime_upgrade.go')
text = path.read_text()
start = '\tvar app *consensus.Application\n'
end = '\n\tif err == nil {\n\t\terr = app.ValidateNormalRuntime()'
assert text.count(start) == 1 and text.count(end) == 1
a, b = text.index(start), text.index(end)
assert 'switch options.applicationLayout()' in text[a:b]
original = '''\tvar app *consensus.Application
\t_ = invoice // Historical atomic-only counterexample intentionally ignores this feature.
\tif runtime != nil {
\t\tapp, err = consensus.NewPersistentApplicationWithRuntimeUpgrade(migration, path, bootstrap, pq, runtime)
\t} else if pq != nil {
\t\tapp, err = consensus.NewPersistentApplicationWithEngineAuthorization(migration, path, bootstrap, pq)
\t} else {
\t\tapp, err = consensus.NewPersistentApplicationWithBootstrap(migration, path, bootstrap)
\t}'''
path.write_text(text[:a] + original + text[b:])
PY
set +e
go test -p 1 -count=1 -timeout=90s -v -run '^TestCometJournalOperatorApplicationRealRegistryScheduleColdContinuation$' ./cmd/ynx-comet > "$YNX_COMET_LAYOUT_CASE/original-red.log" 2>&1
YNX_COMET_LAYOUT_RED_STATUS=$?
set -e
cp "$YNX_COMET_LAYOUT_CASE/fixed-operator.go" cmd/ynx-comet/runtime_upgrade.go
trap - EXIT
cat "$YNX_COMET_LAYOUT_CASE/original-red.log"
test "$YNX_COMET_LAYOUT_RED_STATUS" -ne 0
test "$(grep -c 'normal helper silently used another storage layout' "$YNX_COMET_LAYOUT_CASE/original-red.log")" -eq 2
test "$(grep -c 'wrong layout silently selected another decoder' "$YNX_COMET_LAYOUT_CASE/original-red.log")" -eq 1
grep -F 'normalOperatorLayout=atomic-json actualCommitAndColdRecovery=true' "$YNX_COMET_LAYOUT_CASE/original-red.log"
go test -p 1 -count=1 -timeout=90s -v -run '^TestCometJournal' ./cmd/ynx-comet

test "$YNX_HISTORY_EVENT_INDEX" -eq 2
test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
