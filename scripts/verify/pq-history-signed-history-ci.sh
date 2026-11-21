#!/usr/bin/env bash
set -e
YNX_HISTORY_EVENT_CASE=signed-history
source scripts/verify/pq-history-events-ci.sh
set -euo pipefail
YNX_HISTORY_SCRIPT_CASE="$RUNNER_TEMP/ynx-history-scripts-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
umask 077
mkdir "$YNX_HISTORY_SCRIPT_CASE"
cp internal/consensus/production.go "$YNX_HISTORY_SCRIPT_CASE/fixed-production.go"
cp scripts/ops/rollback-consensus-candidate.sh "$YNX_HISTORY_SCRIPT_CASE/fixed-rollback.sh"
trap 'cp "$YNX_HISTORY_SCRIPT_CASE/fixed-production.go" internal/consensus/production.go; cp "$YNX_HISTORY_SCRIPT_CASE/fixed-rollback.sh" scripts/ops/rollback-consensus-candidate.sh' EXIT
python3 -B - <<'PY'
import re, subprocess
from pathlib import Path
path = Path('internal/consensus/production.go')
fixed = path.read_text()
old = subprocess.check_output(['git', 'show', '3a72627aae36a94b61d3c771ad14e313f3510361:internal/consensus/production.go'], text=True)
def span(text):
    start = re.search(r'^func writeProductionRoleScripts\(', text, re.M)
    if start is None:
        raise RuntimeError('original script generator missing')
    following = re.search(r'^func ', text[start.end():], re.M)
    return start.start(), len(text) if following is None else start.end() + following.start()
a, b = span(fixed)
c, d = span(old)
path.write_text(fixed[:a] + old[c:d] + fixed[b:])
PY
set +e
go test -p 1 -count=1 -timeout=60s -v -run '^TestProductionRoleScriptsPreserveSignedStateAndUnknownResults$/^existing-signed-install$' ./internal/consensus > "$YNX_HISTORY_SCRIPT_CASE/original-install-red.log" 2>&1
YNX_HISTORY_INSTALL_RED=$?
set -e
cp "$YNX_HISTORY_SCRIPT_CASE/fixed-production.go" internal/consensus/production.go
cat "$YNX_HISTORY_SCRIPT_CASE/original-install-red.log"
test "$YNX_HISTORY_INSTALL_RED" -ne 0
grep -Fq 'PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED' "$YNX_HISTORY_SCRIPT_CASE/original-install-red.log"
git show 3a72627aae36a94b61d3c771ad14e313f3510361:scripts/ops/rollback-consensus-candidate.sh > scripts/ops/rollback-consensus-candidate.sh
set +e
go test -p 1 -count=1 -timeout=60s -v -run '^TestProductionRollbackCallerRefusesBeforeTransport$/^without-archive$' ./internal/consensus > "$YNX_HISTORY_SCRIPT_CASE/original-rollback-red.log" 2>&1
YNX_HISTORY_ROLLBACK_RED=$?
set -e
cp "$YNX_HISTORY_SCRIPT_CASE/fixed-rollback.sh" scripts/ops/rollback-consensus-candidate.sh
cat "$YNX_HISTORY_SCRIPT_CASE/original-rollback-red.log"
test "$YNX_HISTORY_ROLLBACK_RED" -ne 0
grep -Fq 'PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED' "$YNX_HISTORY_SCRIPT_CASE/original-rollback-red.log"
go test -p 1 -count=1 -timeout=60s -v -run '^TestProduction(RoleScriptsPreserveSignedStateAndUnknownResults|RollbackCallerRefusesBeforeTransport)$/^(existing-signed-install|without-archive)$' ./internal/consensus

test "$YNX_HISTORY_EVENT_INDEX" -eq 3
test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
