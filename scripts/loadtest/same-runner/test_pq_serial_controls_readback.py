import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('serial_controls_readback', Path(__file__).with_name('pq-serial-controls-readback.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def fixture():
    source, tree, fork, branch = 'a' * 40, 'b' * 40, 'c' * 40, 'codex/serial-control'
    groups = [{'name': 'staged', 'tests': ['test_one (original_serial_ci_staged.Staged.test_one)', 'test_two (original_serial_ci_staged.Staged.test_two)']},
              {'name': 'serial', 'tests': ['test_child (original_serial_ci_serial.Serial.test_child)']}]
    leaves = {}
    metadata = dict(version='YNX-SERIAL-VERIFIER-CONTROLS/v1', sourceCommit=source, sourceTree=tree, forkTree=fork,
                    eventName='push', pullRequestHead='', pullRequestBase='', runId='7', attempt='1', job='controls',
                    platform='linux', kernel='synthetic', groups=[], runtimeAuthorized=False, independentFinalityVerified=False)
    lines = []
    for g in groups:
        raw = (''.join(x + ' ... ok\n' for x in g['tests']) + '\n' + '-' * 70 + '\nRan %d test%s in 0.001s\n\nOK\n' % (len(g['tests']), '' if len(g['tests']) == 1 else 's')).encode()
        leaves[g['name'] + '.log'] = raw
        metadata['groups'].append(dict(name=g['name'], testsRun=len(g['tests']), skipped=0, bytes=len(raw), sha256=digest(raw)))
        lines.append(('YNX-SERIAL-CONTROLS-BEGIN/v1 group=%s source=%s run=7 attempt=1\n' % (g['name'], source)).encode())
        lines.extend(raw.splitlines(keepends=True))
        lines.append(('YNX-SERIAL-CONTROLS-END/v1 group=%s\n' % g['name']).encode())
    manifest = dict(version='YNX-SERIAL-VERIFIER-TEST-MANIFEST/v1',sourceCommit=source,groups=[])
    for group in groups:
        ids=[]
        for test in group['tests']:
            match=m._TEST.fullmatch(test)
            ids.append('original_serial_ci_'+match.group(2)+'.'+match.group(3)+'.'+match.group(4))
        manifest['groups'].append(dict(name=group['name'],file=m._GROUP_FILES[group['name']],tests=sorted(ids)))
    leaves['test-manifest.json']=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
    metadata['testManifestSHA256']=digest(leaves['test-manifest.json'])
    leaves['metadata.json'] = (json.dumps(metadata, sort_keys=True, separators=(',', ':')) + '\n').encode()
    lines.append(b'YNX-SERIAL-TEST-MANIFEST/v1 ' + leaves['test-manifest.json'])
    lines.append(b'YNX-SERIAL-CONTROLS-METADATA/v1 ' + leaves['metadata.json'])
    log = b''.join(b'2026-11-27T16:31:31.5441750Z ' + line for line in lines)
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, raw in leaves.items():
            z.writestr(name, raw)
    archive = b.getvalue()
    pin = dict(sourceCommit=source, sourceTree=tree, forkTree=fork, branch=branch, runId=7, jobId=8, artifactId=9,
               artifactName='ynx-serial-verifier-%s-7-1' % source, artifactBytes=len(archive), artifactSha256=digest(archive),
               jobLogSha256=digest(log), stepName=m._STEP, groups=groups)
    run = dict(id=7, head_sha=source, head_branch=branch, event='push', run_attempt=1, status='completed', conclusion='success',
               path=m._WORKFLOW, repository={'full_name':m._REPO, 'id':m._REPO_ID}, head_repository={'full_name':m._REPO, 'id':m._REPO_ID})
    job = dict(id=8, run_id=7, head_sha=source, head_branch=branch, run_attempt=1, workflow_name='Serial Original Verifier Source Controls', name='controls', status='completed', conclusion='success',
               steps=[dict(name=m._STEP, status='completed', conclusion='success',
                           started_at='2026-11-27T16:31:17Z', completed_at='2026-11-27T16:31:31Z')])
    artifact = dict(id=9, name=pin['artifactName'], size_in_bytes=len(archive), digest='sha256:' + digest(archive), expired=False,
                    workflow_run=dict(id=7, head_sha=source, head_branch=branch, repository_id=m._REPO_ID, head_repository_id=m._REPO_ID))
    return pin, run, job, dict(total_count=1, artifacts=[artifact]), log, archive


class SerialControlsReadback(unittest.TestCase):
    def test_actual_framed_bytes_and_full_identity(self):
        args = fixture()
        m.validate_pin(args[0])
        m.validate_metadata(*args[:4])
        result = m.inspect_serial_controls(*args)
        self.assertEqual((result['classification'], result['testCount']), ('DATA_ONLY', 3))
        self.assertFalse(result['runtimeAuthorized'])
        self.assertFalse(result['independentFinalityVerified'])

    def test_invalid_pins_and_official_metadata_rejected(self):
        for field, value in [('sourceCommit', 'z'*40), ('runId', True), ('artifactSha256', 'd'*63), ('branch', 'main'), ('artifactBytes', 0), ('stepName', 'Other successful step')]:
            args = list(fixture()); args[0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): m.validate_pin(args[0])
        for index, field, value in [(1,'head_sha','d'*40),(1,'run_attempt',2),(1,'event','workflow_dispatch'),(2,'id',10),(2,'run_id',99),(2,'conclusion','failure')]:
            args = list(fixture()); args[index][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): m.validate_metadata(*args[:4])
        args = list(fixture()); args[3]['artifacts'].append(copy.deepcopy(args[3]['artifacts'][0])); args[3]['total_count'] = 2
        with self.assertRaises(ValueError): m.validate_metadata(*args[:4])

    def test_cross_group_duplicate_and_wrong_order_rejected(self):
        for change in ('duplicate', 'cross', 'order'):
            args = list(fixture()); p = args[0]
            if change == 'duplicate': p['groups'][0]['tests'][1] = p['groups'][0]['tests'][0]
            if change == 'cross': p['groups'][1]['tests'][0] = 'test_one (original_serial_ci_staged.Staged.test_one)'
            if change == 'order': p['groups'][0]['tests'].reverse()
            with self.subTest(change=change), self.assertRaises(ValueError): m.inspect_serial_controls(*args)

    def test_raw_bytes_truncation_duplicates_and_wrong_step_rejected(self):
        for change in ('truncated', 'duplicate_frame', 'wrong_attempt', 'wrong_hash', 'wrong_step', 'unframed_line'):
            args = list(fixture())
            if change == 'truncated': args[4] = args[4][:-1]
            if change == 'duplicate_frame': args[4] += args[4].splitlines(keepends=True)[0]
            if change == 'wrong_attempt': args[4] = args[4].replace(b'attempt=1', b'attempt=2', 1)
            if change == 'wrong_hash': args[5] += b'x'; args[0]['artifactBytes'] += 1
            if change == 'wrong_step': args[2]['steps'][0]['completed_at'] = '2026-11-27T16:31:30Z'
            if change == 'unframed_line': args[4] = args[4].replace(b'\n', b'\nunframed injected line\n', 1)
            if change != 'wrong_hash': args[0]['jobLogSha256'] = digest(args[4])
            with self.subTest(change=change), self.assertRaises(ValueError): m.inspect_serial_controls(*args)

    def test_terminal_skip_fail_and_duplicate_json_rejected(self):
        for raw in [b'test_x (original_serial_ci_staged.S.test_x) ... skipped\n', b'test_x (original_serial_ci_staged.S.test_x) ... FAIL\n']:
            with self.assertRaises(ValueError): m._text_log(raw, 'staged', ['test_x (original_serial_ci_staged.S.test_x)'])
        with self.assertRaises(ValueError): m._json(b'{"a":1,"a":2}')

    def test_archive_leaf_mismatch_and_duplicate_after_repin_rejected(self):
        for change in ('mutate_leaf', 'duplicate_leaf', 'extra_leaf', 'wrong_metadata', 'wrong_manifest'):
            args = list(fixture())
            original = zipfile.ZipFile(io.BytesIO(args[5]))
            leaves = [(i.filename, original.read(i)) for i in original.infolist()]
            if change == 'mutate_leaf':
                leaves[0] = (leaves[0][0], leaves[0][1].replace(b' ... ok', b' ... no', 1))
            elif change == 'duplicate_leaf':
                leaves.append(leaves[0])
            elif change == 'extra_leaf':
                leaves.append(('extra.log', b'extra\n'))
            elif change == 'wrong_metadata':
                leaves[-1] = (leaves[-1][0], leaves[-1][1].replace(b'"skipped":0', b'"skipped":false', 1))
            else:
                values=dict(leaves);old_manifest=values['test-manifest.json'];old_metadata=values['metadata.json']
                manifest=json.loads(old_manifest);manifest['groups'][0]['tests'][0]='original_serial_ci_staged.Staged.test_other'
                values['test-manifest.json']=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
                metadata=json.loads(old_metadata);metadata['testManifestSHA256']=digest(values['test-manifest.json'])
                values['metadata.json']=(json.dumps(metadata,sort_keys=True,separators=(',',':'))+'\n').encode()
                args[4]=args[4].replace(old_manifest,values['test-manifest.json']).replace(old_metadata,values['metadata.json'])
                args[0]['jobLogSha256']=digest(args[4]);leaves=[(name,values[name]) for name,_ in leaves]
            out = io.BytesIO()
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
                    for name, raw in leaves:
                        z.writestr(name, raw)
            args[5] = out.getvalue()
            args[0]['artifactBytes'], args[0]['artifactSha256'] = len(args[5]), digest(args[5])
            artifact = args[3]['artifacts'][0]
            artifact['size_in_bytes'], artifact['digest'] = len(args[5]), 'sha256:' + digest(args[5])
            expected='original test manifest inventory differs' if change=='wrong_manifest' else ''
            with self.subTest(change=change), self.assertRaisesRegex(ValueError,expected):
                m.inspect_serial_controls(*args)

    def test_metadata_boolean_attempt_and_group_order_fail(self):
        args = list(fixture()); args[1]['run_attempt'] = True
        with self.assertRaises(ValueError): m.validate_metadata(*args[:4])
        args = list(fixture()); args[2]['run_attempt'] = True
        with self.assertRaises(ValueError): m.validate_metadata(*args[:4])
        args = list(fixture()); args[0]['groups'].reverse()
        with self.assertRaises(ValueError): m.inspect_serial_controls(*args)

if __name__ == '__main__':
    unittest.main()
