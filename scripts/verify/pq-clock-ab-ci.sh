#!/usr/bin/env bash
set -euo pipefail
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
if ! go test -mod=readonly -tags=ynx_clock_diagnostic -json -p 1 -count=1 -timeout=90s -run '^(TestSyntheticClockFinalizeOverheadIndependent|TestSyntheticClockMedianPreservesPairedOrder)$' ./cmd/ynx-comet > "$RUNNER_TEMP/ynx-clock-ab-tests.jsonl"; then
  cat "$RUNNER_TEMP/ynx-clock-ab-tests.jsonl"
  exit 1
fi
cat "$RUNNER_TEMP/ynx-clock-ab-tests.jsonl"
python3 -B - <<'PY'
import json, os, re
from pathlib import Path
events = [json.loads(line) for line in (Path(os.environ['RUNNER_TEMP']) / 'ynx-clock-ab-tests.jsonl').read_text().splitlines()]
package = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'
name = 'TestSyntheticClockFinalizeOverheadIndependent'
if any(e.get('Action') in ('skip', 'fail', 'build-fail') for e in events):
    raise RuntimeError('synthetic A/B test failed or skipped')
if [e['Action'] for e in events if e.get('Package') == package and not e.get('Test') and e.get('Action') in ('start', 'pass', 'fail', 'skip')] != ['start', 'pass']:
    raise RuntimeError('synthetic A/B package did not pass exactly once')
if [(e.get('Package'), e['Action']) for e in events if e.get('Test') == name and e.get('Action') in ('run', 'pass', 'fail', 'skip')] != [(package, 'run'), (package, 'pass')]:
    raise RuntimeError('synthetic A/B test missing, foreign or repeated')
order_name = 'TestSyntheticClockMedianPreservesPairedOrder'
if [(e.get('Package'), e['Action']) for e in events if e.get('Test') == order_name and e.get('Action') in ('run', 'pass', 'fail', 'skip')] != [(package, 'run'), (package, 'pass')]:
    raise RuntimeError('synthetic paired sample preservation test missing, foreign or repeated')
def qualify_result(rows, source):
    chunks = [e.get('Output') for e in rows if e.get('Package') == package and e.get('Test') == name and e.get('Action') == 'output']
    if any(not isinstance(chunk, str) for chunk in chunks) or sum(len(chunk.encode('utf-8')) for chunk in chunks) > 65536:
        raise RuntimeError('synthetic A/B original output malformed or oversized')
    output = ''.join(chunks)
    marker = 'SYNTHETIC_CLOCK_FINALIZE_AB/v1'
    lines = [line for line in output.splitlines() if marker in line]
    if output.count(marker) != 1 or len(lines) != 1:
        raise RuntimeError('synthetic A/B result marker missing or repeated')
    fields = re.findall(r'(?<!\S)(source|independentFinality)=([^\s]+)', lines[0])
    if fields.count(('source', source)) != 1 or sum(k == 'source' for k, _ in fields) != 1 or fields.count(('independentFinality', 'false')) != 1 or sum(k == 'independentFinality' for k, _ in fields) != 1:
        raise RuntimeError('synthetic same-source A/B result missing')
    return lines[0]
qualify_result(events, os.environ['GITHUB_SHA'])  # independentFinality=false
PY
