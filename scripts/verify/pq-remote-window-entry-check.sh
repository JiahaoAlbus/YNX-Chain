#!/usr/bin/env bash
set -Eeuo pipefail

# Pure shell controls for the real read-only entry callee. No daemon, node,
# compiler, runtime window, network, key, deployment or approval is involved.
[[ "$#" -eq 0 ]] || { printf '%s\n' 'entry controls accept no arguments' >&2; exit 1; }
entry_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
entry_callee="$entry_repo/scripts/ops/validate-pq-remote-window-entry.sh"
entry_sha='a123456789abcdef0123456789abcdef01234567'
entry_other_sha='b123456789abcdef0123456789abcdef01234567'
entry_ref='refs/heads/codex/ynx-pq-remote-a12345678'
entry_positive_count=0
entry_negative_count=0

check_entry() {
  local expected="$1" label="$2" output status
  shift 2
  local original=("$@")
  if output="$(bash "$entry_callee" "$@" 2>&1)"; then status=0; else status="$?"; fi
  if [[ "$expected" == 'accept' ]]; then
    [[ "$status" -eq 0 && "$output" == 'YNX_REMOTE_WINDOW_ENTRY_VALIDATED_DATA_ONLY' ]] || {
      printf 'entry positive control failed: %s (status %s)\n' "$label" "$status" >&2; exit 1;
    }
    entry_positive_count=$((entry_positive_count + 1))
  else
    [[ "$status" -ne 0 && "$output" == YNX_REMOTE_WINDOW_ENTRY_REJECTED:* && "$output" != *'YNX_REMOTE_WINDOW_ENTRY_VALIDATED_DATA_ONLY'* ]] || {
      printf 'entry negative control failed: %s (status %s)\n' "$label" "$status" >&2; exit 1;
    }
    entry_negative_count=$((entry_negative_count + 1))
  fi
  [[ "$#" -eq "${#original[@]}" ]] || { printf '%s\n' 'entry callee changed original argument count' >&2; exit 1; }
  local index=0
  for entry_argument in "$@"; do
    [[ "$entry_argument" == "${original[$index]}" ]] || { printf '%s\n' 'entry callee changed original argument bytes' >&2; exit 1; }
    index=$((index + 1))
  done
}

check_entry accept explicit-false workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false false
check_entry accept github-empty-defaults workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true '' '' '' ''
check_entry accept mixed-false-and-empty workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false '' false ''
check_entry accept complete-frozen-suffix workflow_dispatch "refs/heads/codex/ynx-pq-remote-$entry_sha" "$entry_sha" "$entry_sha" true false false false false

check_entry reject no-arguments
check_entry reject missing-last-argument workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false
check_entry reject extra-argument workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false false extra
for entry_bad_event in '' push pull_request workflow_call workflow_dispatch_extra; do
  check_entry reject wrong-event "$entry_bad_event" "$entry_ref" "$entry_sha" "$entry_sha" true false false false false
done
for entry_bad_ref in '' codex/ynx-pq-remote-a12345678 refs/tags/codex/ynx-pq-remote-a12345678 refs/heads/codex/ynx-pq-perf-integration refs/heads/codex/ynx-pq-remote-a1234567 refs/heads/codex/ynx-pq-remote-A12345678 refs/heads/codex/ynx-pq-remote-a12345678-extra refs/heads/codex/ynx-pq-remote-a123456789abcdef0123456789abcdef012345678 refs/heads/codex/ynx-pq-remote-b12345678; do
  check_entry reject wrong-frozen-ref workflow_dispatch "$entry_bad_ref" "$entry_sha" "$entry_sha" true false false false false
done
check_entry reject ref-prefix-of-other-commit workflow_dispatch "$entry_ref" "$entry_other_sha" "$entry_other_sha" true false false false false
check_entry reject mismatched-candidate workflow_dispatch "$entry_ref" "$entry_sha" "$entry_other_sha" true false false false false
for entry_bad_sha in '' 0000000000000000000000000000000000000000 a12345678 A123456789abcdef0123456789abcdef01234567 a123456789abcdef0123456789abcdef012345678 z123456789abcdef0123456789abcdef01234567 ' a123456789abcdef0123456789abcdef01234567'; do
  check_entry reject wrong-source-sha workflow_dispatch "$entry_ref" "$entry_bad_sha" "$entry_sha" true false false false false
  check_entry reject wrong-candidate-sha workflow_dispatch "$entry_ref" "$entry_sha" "$entry_bad_sha" true false false false false
done
check_entry reject both-zero workflow_dispatch refs/heads/codex/ynx-pq-remote-000000000 0000000000000000000000000000000000000000 0000000000000000000000000000000000000000 true false false false false
for entry_bad_mode in '' false True TRUE 1 true_extra; do
  check_entry reject wrong-remote-mode workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" "$entry_bad_mode" false false false false
done
for entry_bad_other in true False FALSE 0 unknown; do
  check_entry reject paired-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true "$entry_bad_other" false false false
  check_entry reject local-e2e-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false "$entry_bad_other" false false
  check_entry reject local-retained-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false "$entry_bad_other" false
  check_entry reject remote-process-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false "$entry_bad_other"
done

printf 'YNX_REMOTE_WINDOW_ENTRY_CONTROLS_DATA_ONLY positive=%s negative=%s\n' "$entry_positive_count" "$entry_negative_count"

# Exercise the ACTUAL workflow caller, not another copy of its authorization
# logic. Only its identity if-block is executed, in an environment containing
# public control inputs. Job predicates below are static source assertions;
# they are explicitly not proof of GitHub's scheduler or window execution.
python3 -B - "$entry_repo" <<'PY'
from pathlib import Path
import subprocess
import sys

repo = Path(sys.argv[1]).resolve(strict=True)
workflow = repo / '.github/workflows/resource-market-ci.yml'
callee = repo / 'scripts/ops/validate-pq-remote-window-entry.sh'
control = repo / 'scripts/verify/pq-remote-window-entry-check.sh'
originals = {path: path.read_bytes() for path in (workflow, callee, control)}
text = originals[workflow].decode('utf8')
start_marker = '          if [ "$YNX_ENTRY_EVENT" = \'workflow_dispatch\' ]; then\n'
def extract_caller(source, historical=False):
    if source.count(start_marker) != 1:
        raise RuntimeError('exact original workflow identity caller block required')
    start = source.index(start_marker)
    end = source.index('\n      - name:', start)
    lines = source[start:end].splitlines()
    if not lines or lines[-1] != '          fi' or any(line and not line.startswith('          ') for line in lines):
        raise RuntimeError('workflow identity caller boundary changed')
    result = '\n'.join(line[10:] if line else '' for line in lines) + '\n'
    if result.count('bash scripts/ops/validate-pq-remote-window-entry.sh') != 1 or not historical and '${{' in result:
        raise RuntimeError('caller must consume the original explicit env fields and actual callee')
    return result
body = extract_caller(text)

def job_if(name):
    begin = text.index('\n  ' + name + ':\n')
    tail = text[begin + 1:]
    found = [line[len('    if: '):] for line in tail.splitlines() if line.startswith('    if: ')]
    if not found:
        raise RuntimeError('original job predicate missing: ' + name)
    return ' '.join(found[0].split())

expected_verify = "github.ref != 'refs/heads/codex/ynx-pq-public-upgrade' && github.ref != 'refs/heads/codex/ynx-pq-perf-integration' && !startsWith(github.ref, 'refs/heads/codex/ynx-pq-remote-') && !(github.event_name == 'workflow_dispatch' && inputs.consensus_remote_e2e_retained_history)"
expected_focused = "((github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || github.ref == 'refs/heads/codex/ynx-pq-perf-integration') && (github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.candidate_sha == github.sha))) || (github.event_name == 'workflow_dispatch' && (startsWith(github.ref, 'refs/heads/codex/ynx-pq-remote-') || inputs.consensus_remote_e2e_retained_history))"
sha = 'a123456789abcdef0123456789abcdef01234567'
other_sha = 'b123456789abcdef0123456789abcdef01234567'
frozen = 'refs/heads/codex/ynx-pq-remote-' + sha[:9]
main = 'refs/heads/codex/ynx-pq-perf-integration'
public = 'refs/heads/codex/ynx-pq-public-upgrade'
fields = ('YNX_ENTRY_EVENT', 'YNX_ENTRY_REF', 'YNX_ENTRY_GITHUB_SHA', 'YNX_ENTRY_CANDIDATE_SHA',
          'YNX_ENTRY_REMOTE_RETAINED', 'YNX_ENTRY_PAIRED', 'YNX_ENTRY_LOCAL',
          'YNX_ENTRY_LOCAL_RETAINED', 'YNX_ENTRY_REMOTE_PROCESS')
counts = dict(positive=0, negative=0)

def invoke(label, accepted, ref=frozen, source=sha, candidate=sha, remote='true',
           paired='false', local='false', retained='false', process='false', marker=True):
    values = ('workflow_dispatch', ref, source, candidate, remote, paired, local, retained, process)
    inputs = dict(zip(fields, values))
    before = dict(inputs)
    # No inherited credentials, BASH_ENV, key/Host modes, or production input.
    environment = dict(PATH='/usr/bin:/bin', **inputs)
    result = subprocess.run(['bash', '-c', 'set -Eeuo pipefail\n' + body],
        cwd=repo, env=environment, capture_output=True, check=False, timeout=5)
    token = b'YNX_REMOTE_WINDOW_ENTRY_VALIDATED_DATA_ONLY\n'
    if accepted:
        if result.returncode != 0 or result.stderr or result.stdout != (token if marker else b''):
            raise RuntimeError('actual workflow caller rejected original positive control: ' + label)
        counts['positive'] += 1
    else:
        if result.returncode == 0 or token in result.stdout + result.stderr:
            raise RuntimeError('actual workflow caller bypassed negative control: ' + label)
        counts['negative'] += 1
    if inputs != before:
        raise RuntimeError('actual caller changed original public control inputs')

# Read the fixed pre-repair Git object; never rewrite the old if-condition.
# Rendering only these five booleans reproduces their actual GitHub expansion
# inside the old quoted for-list. No unknown expression or arbitrary evaluator
# is accepted. The same nine public inputs then exercise both original bodies.
historical_revision = '8586f1a12333d750ca59c99989eec8520407bf09'
historical_read = subprocess.run(['git', '-C', str(repo), 'show',
    historical_revision + ':.github/workflows/resource-market-ci.yml'],
    env=dict(PATH='/usr/bin:/bin', GIT_OPTIONAL_LOCKS='0'), capture_output=True,
    check=False, timeout=15)
if historical_read.returncode != 0 or historical_read.stderr or not 0 < len(historical_read.stdout) <= 1 << 20:
    raise RuntimeError('fixed original historical workflow object unavailable')
historical_body = extract_caller(historical_read.stdout.decode('utf8'), historical=True)
historical_inputs = dict(zip(fields, ('workflow_dispatch', main, sha, sha,
    'true', 'false', 'false', 'false', 'false')))
historical_before = dict(historical_inputs)
render_inputs = {'paired_n1': 'YNX_ENTRY_PAIRED', 'consensus_e2e': 'YNX_ENTRY_LOCAL',
    'consensus_e2e_retained_history': 'YNX_ENTRY_LOCAL_RETAINED',
    'consensus_remote_e2e_retained_history': 'YNX_ENTRY_REMOTE_RETAINED',
    'remote_signer_process': 'YNX_ENTRY_REMOTE_PROCESS'}
if historical_body.count('${{') != len(render_inputs):
    raise RuntimeError('historical caller contains an unknown or missing GitHub expression')
for name, field in render_inputs.items():
    token = '${{ inputs.' + name + ' }}'
    value = historical_inputs[field]
    if historical_body.count(token) != 1 or value not in ('true', 'false', ''):
        raise RuntimeError('only the original five public boolean expressions may be rendered')
    historical_body = historical_body.replace(token, value)
if '${{' in historical_body or '}}' in historical_body:
    raise RuntimeError('unknown historical GitHub expression refused')
historical_environment = dict(PATH='/usr/bin:/bin', **historical_inputs)
historical_result = subprocess.run(['bash', '-c', 'set -Eeuo pipefail\n' + historical_body],
    cwd=repo, env=historical_environment, capture_output=True, check=False, timeout=5)
if historical_result.returncode != 0 or historical_result.stdout or historical_result.stderr:
    raise RuntimeError('original historical caller did not reproduce the wrong main-ref acceptance')
repaired_result = subprocess.run(['bash', '-c', 'set -Eeuo pipefail\n' + body],
    cwd=repo, env=historical_environment, capture_output=True, check=False, timeout=5)
if (repaired_result.returncode != 1 or repaired_result.stdout
        or repaired_result.stderr != b'YNX_REMOTE_WINDOW_ENTRY_REJECTED: exact frozen remote branch ref required\n'):
    raise RuntimeError('repaired actual caller did not reject the same main-ref input at the real callee')
if historical_inputs != historical_before:
    raise RuntimeError('historical caller controls changed original public inputs')

invoke('frozen-remote', True)
invoke('full-frozen-suffix', True, ref='refs/heads/codex/ynx-pq-remote-' + sha)
invoke('main-original-local-e2e', True, ref=main, remote='false', local='true', marker=False)
invoke('public-original-retained-local', True, ref=public, remote='false', retained='true', marker=False)
invoke('main-remote-ref-bypass', False, ref=main)
invoke('other-ref-must-reach-rejection', False, ref='refs/heads/codex/other')
invoke('public-remote-ref-bypass', False, ref=public)
invoke('frozen-without-remote-mode', False, remote='false')
invoke('frozen-mixed-paired', False, paired='true')
invoke('frozen-mixed-local', False, local='true')
invoke('frozen-mixed-local-retained', False, retained='true')
invoke('frozen-mixed-process', False, process='true')
invoke('frozen-candidate-mismatch', False, candidate=other_sha)
invoke('frozen-other-source-prefix', False, source=other_sha, candidate=other_sha)
invoke('frozen-empty-candidate', False, candidate='')
invoke('frozen-short-ref', False, ref='refs/heads/codex/ynx-pq-remote-' + sha[:8])
invoke('main-wrong-candidate-must-reach-rejection', False, ref=main, candidate=other_sha)
invoke('main-original-local-mixed-modes', False, ref=main, remote='false', paired='true', local='true')

if job_if('verify') != expected_verify or job_if('focused-go') != expected_focused:
    raise RuntimeError('wrong-ref remote selection must enter identity and never the unrelated generic job')
if any(path.read_bytes() != raw for path, raw in originals.items()):
    raise RuntimeError('readonly actual-caller controls changed original source bytes')
print('YNX_REMOTE_WINDOW_CALLER_CONTROLS_DATA_ONLY positive=' + str(counts['positive'])
    + ' negative=' + str(counts['negative']) + ' historicalCallerReproduced=true historicalRevision='
    + historical_revision + ' originalCallerExit=0 repairedCallerExit=1 routeSourceChecked=true githubSchedulerExecuted=false')
PY
