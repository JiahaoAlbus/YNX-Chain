"""Verify pinned original serial-control CI bytes as DATA only; never authorize a run."""
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timezone

_VERSION = 'YNX-SERIAL-VERIFIER-CONTROLS/v1'
_WORKFLOW = '.github/workflows/pq-serial-verifier-source-controls.yml'
_STEP = 'Run staged, Linux verifier, and synthetic header DATA controls'
_REPO = 'JiahaoAlbus/YNX-Chain'
_REPO_ID = 1285041796
_HEX40 = re.compile(r'[0-9a-f]{40}\Z')
_HEX64 = re.compile(r'[0-9a-f]{64}\Z')
_GROUP = re.compile(r'[a-z][a-z0-9-]{0,63}\Z')
_TEST = re.compile(r'(test_[A-Za-z0-9_]+) \(original_serial_ci_([a-z0-9-]+)\.([A-Za-z_][A-Za-z0-9_]*)\.(test_[A-Za-z0-9_]+)\)\Z')
_RUNNER = re.compile(rb'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d{1,9})?Z (.*)\n$')

def _require(ok, why):
    if not ok:
        raise ValueError(why)

def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('malformed JSON') from exc

def _sha(raw):
    return hashlib.sha256(raw).hexdigest()

def _time(value):
    try:
        _require(type(value) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value) is not None, 'bad official timestamp')
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError('bad official timestamp') from exc

def _text_log(raw, group, tests):
    try:
        lines = raw.decode('utf-8').splitlines()
    except UnicodeDecodeError as exc:
        raise ValueError('non UTF-8 control log') from exc
    _require(raw.endswith(b'\n'), 'truncated control log')
    wanted = [x + ' ... ok' for x in tests]
    _require(lines[:len(wanted)] == wanted, 'control tests missing, duplicated, reordered or failed')
    tail = lines[len(wanted):]
    _require(len(tail) == 5 and tail[0] == '' and tail[1] == '-' * 70 and
             re.fullmatch(r'Ran ' + str(len(tests)) + r' tests? in [0-9]+\.[0-9]{3}s', tail[2]) is not None and
             tail[3:] == ['', 'OK'], 'control terminal malformed or skipped')
    for name in tests:
        match = _TEST.fullmatch(name)
        _require(match is not None and match.group(1) == match.group(4) and match.group(2) == group,
                 'test identity not bound to group')

def validate_pin(pin):
    required = {'sourceCommit', 'sourceTree', 'forkTree', 'branch', 'runId', 'jobId',
                'artifactId', 'artifactName', 'artifactBytes', 'artifactSha256', 'jobLogSha256', 'stepName', 'groups'}
    _require(type(pin) is dict and set(pin) == required, 'pin fields differ')
    for key in ('sourceCommit', 'sourceTree', 'forkTree'):
        _require(type(pin[key]) is str and _HEX40.fullmatch(pin[key]) is not None, 'invalid source identity')
    for key in ('artifactSha256', 'jobLogSha256'):
        _require(type(pin[key]) is str and _HEX64.fullmatch(pin[key]) is not None, 'invalid digest')
    for key in ('runId', 'jobId', 'artifactId', 'artifactBytes'):
        _require(type(pin[key]) is int and pin[key] > 0, 'invalid integer identity')
    _require(type(pin['branch']) is str and pin['branch'].startswith('codex/') and len(pin['branch']) <= 200, 'invalid push branch')
    _require(pin['stepName'] == _STEP, 'invalid original controls step')
    expected_name = 'ynx-serial-verifier-%s-%s-1' % (pin['sourceCommit'], pin['runId'])
    _require(pin['artifactName'] == expected_name and pin['artifactBytes'] <= 4 << 20, 'invalid artifact pin')
    groups = pin['groups']
    _require(type(groups) is list and 1 <= len(groups) <= 32, 'invalid group inventory')
    seen_groups, seen_tests = set(), set()
    for group in groups:
        _require(type(group) is dict and set(group) == {'name', 'tests'} and type(group['name']) is str and
                 _GROUP.fullmatch(group['name']) is not None and group['name'] not in seen_groups and
                 type(group['tests']) is list and 1 <= len(group['tests']) <= 500, 'invalid group')
        seen_groups.add(group['name'])
        for test in group['tests']:
            _require(type(test) is str and len(test) <= 512 and test not in seen_tests, 'invalid or duplicate test')
            seen_tests.add(test)
            match = _TEST.fullmatch(test)
            _require(match is not None and match.group(1) == match.group(4) and match.group(2) == group['name'], 'invalid test group binding')
    return None

def validate_metadata(pin, run, job, artifact_inventory):
    validate_pin(pin)
    _require(type(run) is dict and type(run.get('id')) is int and run.get('id') == pin['runId'] and run.get('head_sha') == pin['sourceCommit'] and
             run.get('head_branch') == pin['branch'] and run.get('event') == 'push' and type(run.get('run_attempt')) is int and run.get('run_attempt') == 1 and
             run.get('status') == 'completed' and run.get('conclusion') == 'success' and run.get('path') == _WORKFLOW and
             type(run.get('repository')) is dict and type(run.get('head_repository')) is dict and
             run['repository'].get('full_name') == _REPO and run['repository'].get('id') == _REPO_ID and
             run['head_repository'].get('full_name') == _REPO and run['head_repository'].get('id') == _REPO_ID,
             'official run identity or conclusion differs')
    _require(type(job) is dict and type(job.get('id')) is int and job.get('id') == pin['jobId'] and type(job.get('run_id')) is int and job.get('run_id') == pin['runId'] and
             job.get('head_sha') == pin['sourceCommit'] and job.get('head_branch') == pin['branch'] and type(job.get('run_attempt')) is int and job.get('run_attempt') == 1 and
             job.get('workflow_name') == 'Serial Original Verifier Source Controls' and job.get('name') == 'controls' and
             job.get('status') == 'completed' and job.get('conclusion') == 'success', 'official job differs')
    steps = job.get('steps')
    _require(type(steps) is list, 'missing original job steps')
    found = [s for s in steps if type(s) is dict and s.get('name') == pin['stepName']]
    _require(len(found) == 1 and found[0].get('status') == 'completed' and found[0].get('conclusion') == 'success', 'original step absent or not successful')
    start, end = _time(found[0].get('started_at')), _time(found[0].get('completed_at'))
    _require(start <= end, 'invalid step window')
    _require(type(artifact_inventory) is dict and type(artifact_inventory.get('artifacts')) is list and
             type(artifact_inventory.get('total_count')) is int and artifact_inventory['total_count'] == len(artifact_inventory['artifacts']) and
             all(type(a) is dict for a in artifact_inventory['artifacts']), 'artifact inventory incomplete')
    selected = [a for a in artifact_inventory['artifacts'] if type(a) is dict and (a.get('id') == pin['artifactId'] or a.get('name') == pin['artifactName'])]
    _require(len(selected) == 1, 'artifact ID/name not unique')
    a = selected[0]
    _require(type(a.get('id')) is int and a.get('id') == pin['artifactId'] and a.get('name') == pin['artifactName'] and type(a.get('size_in_bytes')) is int and a.get('size_in_bytes') == pin['artifactBytes'] and
             a.get('digest') == 'sha256:' + pin['artifactSha256'] and a.get('expired') is False and
             type(a.get('workflow_run')) is dict and a['workflow_run'].get('id') == pin['runId'] and a['workflow_run'].get('head_sha') == pin['sourceCommit'] and
             a['workflow_run'].get('head_branch') == pin['branch'] and a['workflow_run'].get('repository_id') == _REPO_ID and
             a['workflow_run'].get('head_repository_id') == _REPO_ID, 'artifact metadata differs')
    return None

def inspect_serial_controls(pin, run, job, artifact_inventory, job_log_bytes, archive_bytes):
    """Inspect pinned original CI bytes as DATA, without authorizing runtime."""
    validate_metadata(pin, run, job, artifact_inventory)
    groups = pin['groups']
    seen_tests = {test for group in groups for test in group['tests']}
    found = [step for step in job['steps'] if type(step) is dict and step.get('name') == pin['stepName']]
    start, end = _time(found[0]['started_at']), _time(found[0]['completed_at'])
    _require(type(job_log_bytes) is bytes and 0 < len(job_log_bytes) <= 8 << 20 and _sha(job_log_bytes) == pin['jobLogSha256'], 'original job log pin differs')
    _require(type(archive_bytes) is bytes and len(archive_bytes) == pin['artifactBytes'] and _sha(archive_bytes) == pin['artifactSha256'], 'original archive pin differs')
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as z:
            items = z.infolist()
            expected = {g['name'] + '.log' for g in groups} | {'metadata.json'}
            _require(len(items) == len(expected) and {i.filename for i in items} == expected and
                     all(not i.is_dir() and not (i.flag_bits & 1) and i.file_size <= 1 << 20 for i in items), 'archive inventory differs')
            members = {i.filename: z.read(i) for i in items}
    except (zipfile.BadZipFile, RuntimeError, OSError, EOFError) as exc:
        raise ValueError('invalid original ZIP or CRC') from exc
    metadata = _json(members['metadata.json'])
    _require(type(metadata) is dict and set(metadata) == {'version', 'sourceCommit', 'sourceTree', 'forkTree', 'eventName', 'pullRequestHead',
             'pullRequestBase', 'runId', 'attempt', 'job', 'platform', 'kernel', 'groups', 'runtimeAuthorized', 'independentFinalityVerified'} and
             type(metadata.get('kernel')) is str and bool(metadata['kernel']) and len(metadata['kernel']) <= 256 and
             metadata.get('version') == _VERSION and metadata.get('sourceCommit') == pin['sourceCommit'] and
             metadata.get('sourceTree') == pin['sourceTree'] and metadata.get('forkTree') == pin['forkTree'] and
             metadata.get('eventName') == 'push' and metadata.get('runId') == str(pin['runId']) and metadata.get('attempt') == '1' and
             metadata.get('job') == 'controls' and metadata.get('platform') == 'linux' and metadata.get('pullRequestHead') == '' and
             metadata.get('pullRequestBase') == '' and metadata.get('runtimeAuthorized') is False and metadata.get('independentFinalityVerified') is False,
             'original metadata identity differs')
    entries = metadata.get('groups')
    _require(type(entries) is list and len(entries) == len(groups), 'original group metadata differs')
    for group, entry in zip(groups, entries):
        raw = members[group['name'] + '.log']
        _require(type(entry) is dict and all(type(entry.get(k)) is int for k in ('testsRun', 'skipped', 'bytes')) and entry == {'name': group['name'], 'testsRun': len(group['tests']), 'skipped': 0,
                                                   'bytes': len(raw), 'sha256': _sha(raw)}, 'group metadata differs')
        _text_log(raw, group['name'], group['tests'])
    # Frames must be unique, ordered and byte-identical to ZIP leaves. Runner
    # timestamps are retained only for step-window attribution, not test time.
    runner = []
    for line in job_log_bytes.splitlines(keepends=True):
        m = _RUNNER.fullmatch(line)
        if m:
            runner.append((_time(m.group(1).decode() + 'Z'), m.group(2) + b'\n'))
        else:
            # Preserve unmatched physical lines so an injected/truncated line
            # inside a frame cannot disappear during timestamp extraction.
            runner.append((None, line))
    frames = []
    for group in groups:
        name = group['name']
        frames.append(('YNX-SERIAL-CONTROLS-BEGIN/v1 group=%s source=%s run=%s attempt=1\n' % (name, pin['sourceCommit'], pin['runId'])).encode())
        frames.extend(members[name + '.log'].splitlines(keepends=True))
        frames.append(('YNX-SERIAL-CONTROLS-END/v1 group=%s\n' % name).encode())
    metadata_frame = b'YNX-SERIAL-CONTROLS-METADATA/v1 ' + members['metadata.json']
    frames.append(metadata_frame)
    markers = [i for i, (_, line) in enumerate(runner) if line.startswith((b'YNX-SERIAL-CONTROLS-BEGIN/v1 ', b'YNX-SERIAL-CONTROLS-END/v1 ', b'YNX-SERIAL-CONTROLS-METADATA/v1 '))]
    _require(len(markers) == 2 * len(groups) + 1 and markers[0] + len(frames) <= len(runner), 'original frames missing or duplicated')
    actual = runner[markers[0]:markers[0] + len(frames)]
    _require([line for _, line in actual] == frames and all(when is not None and start <= when <= end for when, _ in actual), 'original framed bytes or step differ')
    return {'classification': 'DATA_ONLY', 'sourceCommit': pin['sourceCommit'], 'runId': pin['runId'],
            'jobId': pin['jobId'], 'groupCount': len(groups), 'testCount': len(seen_tests),
            'runtimeAuthorized': False, 'independentFinalityVerified': False}
