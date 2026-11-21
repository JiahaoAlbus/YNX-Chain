#!/usr/bin/env bash
set -euo pipefail
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
if ! go test -mod=readonly -json -p 1 -count=1 -timeout=90s -run '^TestPQLabEnrollmentOriginalCommandColdRecoveryAndRefusals$' ./cmd/ynx-consensus-pq-lab > "$RUNNER_TEMP/ynx-enrollment-command-tests.jsonl"; then
  cat "$RUNNER_TEMP/ynx-enrollment-command-tests.jsonl"
  exit 1
fi
cat "$RUNNER_TEMP/ynx-enrollment-command-tests.jsonl"
python3 -B - <<'PY'
import json, os
from pathlib import Path
events = [json.loads(line) for line in (Path(os.environ['RUNNER_TEMP']) / 'ynx-enrollment-command-tests.jsonl').read_text().splitlines()]
package = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab'
command_name = 'TestPQLabEnrollmentOriginalCommandColdRecoveryAndRefusals'
if any(e.get('Action') in ('skip', 'fail', 'build-fail') for e in events) or [e['Action'] for e in events if e.get('Package') == package and not e.get('Test') and e.get('Action') in ('start', 'pass', 'fail', 'skip')] != ['start', 'pass'] or [(e.get('Package'), e['Action']) for e in events if e.get('Test') == command_name and e.get('Action') in ('run', 'pass', 'skip', 'fail')] != [(package, 'run'), (package, 'pass')]:
    raise RuntimeError('original enrollment command incomplete, skipped or foreign')
PY
