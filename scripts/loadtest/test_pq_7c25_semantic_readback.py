"""Negative transport/process controls; these never qualify a fabricated run."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('own7c25_semantic_ci_reader', Path(__file__).with_name('pq-7c25-semantic-readback.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def stages():
    commands = [dict(name=n, argv=[n]) for n in m.COMMANDS]
    processes = [dict(name=n, command=[n], pid=i+1, startTicks=123, rawReturnCode=0,
                      exitCode=0, signal=None, exited=True, observedLaunchToExitNs=123456789)
                 for i, n in enumerate(m.COMMANDS)]
    return dict(actualCommands=commands, processes=processes)


class SemanticOriginalControls(unittest.TestCase):
    def test_missing_after_stage_cannot_be_pair(self):
        r = stages(); r['processes'].pop()
        with self.assertRaises(RuntimeError): m.stage_times(r)

    def test_nonzero_signal_unfinished_missing_duration_refused(self):
        for delta in [dict(rawReturnCode=1, exitCode=1), dict(signal=9), dict(exited=False),
                      dict(observedLaunchToExitNs=None), dict(exitCode=False)]:
            r = stages(); r['processes'][-1].update(delta)
            with self.subTest(delta=delta), self.assertRaises(RuntimeError): m.stage_times(r)

    def test_pid_reuse_needs_distinct_start_identity(self):
        r = stages(); r['processes'][1].update(pid=1)
        with self.assertRaises(RuntimeError): m.stage_times(r)
        r['processes'][1]['startTicks'] = 124
        self.assertEqual(m.stage_times(r)['after-replay'], .123456789)

    def test_reported_command_cannot_replace_actual_child_command(self):
        r = stages(); r['actualCommands'][-1]['argv'] = ['different']
        with self.assertRaises(RuntimeError): m.stage_times(r)

    def test_selected_zip_pin_refuses_partial_before_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp).resolve() / 'partial.zip'; p.write_bytes(b'PK partial')
            with self.assertRaisesRegex(RuntimeError, 'artifact size/SHA'): m.read_zip(p, 100, '0'*64)

    def test_inventory_duplicate_scope_and_hash_tamper_refused(self):
        row = dict(path='cmd/x.go', bytes=1, sha256='a'*64)
        for rows in [[row, copy.deepcopy(row)], [dict(row, path='../x')],
                     [dict(row, path='third_party/unselected/x')], [dict(row, sha256='bad')]]:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError): m.inventory(rows)

    def test_exact_successful_normal_workflow_identity(self):
        controller='a'*40
        run=dict(id=17,head_sha=controller,event='workflow_dispatch',run_attempt=1,
                 path='.github/workflows/pq-source-compare.yml',head_branch='codex/ynx-pq-current75-baseline-20261101',
                 status='completed',conclusion='success',repository=dict(full_name='JiahaoAlbus/YNX-Chain',fork=False),
                 head_repository=dict(full_name='JiahaoAlbus/YNX-Chain',fork=False))
        job=dict(id=19,run_id=17,head_sha=controller,name='finalize-7c25-semantic',status='completed',conclusion='success')
        m.validate_ci(run,job,controller,17,19)
        for delta in [dict(head_sha='b'*40),dict(run_attempt=2),dict(event='push'),dict(status='in_progress'),dict(conclusion='failure')]:
            with self.subTest(delta=delta),self.assertRaises(RuntimeError):m.validate_ci(dict(run,**delta),job,controller,17,19)
        with self.assertRaises(RuntimeError):m.validate_ci(run,dict(job,name='finalize-1695-semantic'),controller,17,19)

    def test_every_raw_state_and_cold_record_required_not_only_terminal_state(self):
        import hashlib,json
        spec=importlib.util.spec_from_file_location('height_state',Path(__file__).with_name('pq-semantic-height-state.py'))
        h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
        files={}; rows=[];cold=[]
        for n in range(4,13):
            raw=json.dumps(dict(height=n,appHash='a'*64,accounts=[dict(balance=n,nonce=n)]),separators=(',',':')).encode()
            digest=hashlib.sha256(raw).hexdigest();height=str(n)
            files['height-states/'+height+'.json']=raw
            rows.append(dict(height=height,stateBytes=str(len(raw)),stateSHA256=digest,appHash='a'*64))
            cold.append(dict(height=height,stateBytes=str(len(raw)),stateSHA256=digest,appHash='a'*64,
                             coldStateBytes=str(len(raw)),coldStateSHA256=digest,coldAppHash='a'*64,bytesEqual=True))
        files['cold-reconstruction.jsonl']=b''.join(json.dumps(r).encode()+b'\n' for r in cold)
        report=h.compare_height_states(files,files,rows)
        self.assertTrue(report['completePerHeightRawStateBytesEqual'])
        self.assertFalse(report['coldReconstructionIndependentlyExecutedByReader'])
        for name in ['height-states/4.json','height-states/11.json','cold-reconstruction.jsonl']:
            wrong=dict(files);wrong[name]=wrong[name]+b' '
            with self.subTest(name=name),self.assertRaises(RuntimeError):h.compare_height_states(files,wrong,rows)
        wrong=dict(files);del wrong['height-states/4.json']
        with self.assertRaises(RuntimeError):h.compare_height_states(files,wrong,rows)
        wrong=dict(files);cold[0]['bytesEqual']=False
        wrong['cold-reconstruction.jsonl']=b''.join(json.dumps(r).encode()+b'\n' for r in cold)
        with self.assertRaises(RuntimeError):h.compare_height_states(files,wrong,rows)

    def test_failed_original_keeps_first_cause_without_granting_success(self):
        import json
        result=dict(profile='finalize-7c25-vs-f27',controllerCommit='a'*40,afterCommit=m.AFTER,
                    semanticQualified=False,firstCause='actual replay mismatch height 5',cleanupComplete=True,
                    processes=[dict(name='after-replay',rawReturnCode=1)])
        report=m.inspect_failure({'SEMANTIC-RESULT.json':json.dumps(result).encode()},'a'*40,'b'*64,17,19)
        self.assertEqual(report['firstCause'],'actual replay mismatch height 5')
        self.assertFalse(report['limitedOriginalTrajectoryQualified'])
        self.assertFalse(report['runtimePressureAuthorized'])
        self.assertIsNone(report['effectiveBusinessTPS'])


if __name__ == '__main__':
    unittest.main()
