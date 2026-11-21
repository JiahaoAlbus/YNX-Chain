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
with (Path(os.environ['RUNNER_TEMP']) / 'ynx-clock-ab-tests.jsonl').open('rb') as stream:
    raw = stream.read(8 * 1024 * 1024 + 1)
if len(raw) > 8 * 1024 * 1024:
    raise RuntimeError('synthetic A/B original event stream oversized')
events = [json.loads(line) for line in raw.splitlines()]
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
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise RuntimeError('synthetic A/B exact source identity malformed')
    package_events = [(i, e.get('Action')) for i, e in enumerate(rows) if e.get('Package') == package and not e.get('Test') and e.get('Action') in ('start', 'pass', 'fail', 'skip')]
    test_events = [(i, e.get('Action')) for i, e in enumerate(rows) if e.get('Package') == package and e.get('Test') == name and e.get('Action') in ('run', 'pass', 'fail', 'skip')]
    if [a for _, a in package_events] != ['start', 'pass'] or [a for _, a in test_events] != ['run', 'pass']:
        raise RuntimeError('synthetic A/B original event boundaries missing')
    package_start, package_end = package_events[0][0], package_events[1][0]
    test_start, test_end = test_events[0][0], test_events[1][0]
    if not package_start < test_start < test_end < package_end:
        raise RuntimeError('synthetic A/B test outside original package execution')
    output_events = [(i, e) for i, e in enumerate(rows) if e.get('Test') == name and e.get('Action') == 'output']
    if any(e.get('Package') != package or not test_start < i < test_end for i, e in output_events):
        raise RuntimeError('synthetic A/B output outside original test execution')
    chunks = [e.get('Output') for _, e in output_events]
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
