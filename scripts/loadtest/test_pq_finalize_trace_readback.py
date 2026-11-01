"""Complete trace DATA transport controls, no codec/replay/build or live nodes."""
import base64,copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('finalize_trace_controls',Path(__file__).with_name('pq-finalize-trace-readback.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def raw(value):return json.dumps(value,separators=(',',':')).encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def fixture(root,change=None):
    root.mkdir();final=raw(dict(height=2,appHash='a'*64));row=dict(height='1',block='AQ==',lightBlock='Ag==',request='Aw==',response='BA==',stateBytes=str(len(final)),stateSHA256=sha(final),appHash='a'*64,executionSuccessorBound=True);rows=[row,dict(row,height='2')]
    if change:change(rows)
    bodies={role:b'{}' for role in m.FILES};bodies.update(records=b'\n'.join(raw(r) for r in rows)+b'\n',finalState=final)
    result=dict(version=m.TRACE_VERSION,firstHeight='1',lastHeight='2',sourceReadOnly=True,syntheticOnly=True,nodeStarted=False,authorityGranted=False,requestSource=m.REQUEST_SOURCE,stateEncoding=m.STATE_ENCODING,stoppedNodes=4,coldReopened=True,publicNetwork=False,runtimePlan=None,runtimePlanHash='',engineAppHash='a'*64,pins=dict(CometGenesisSHA256=sha(bodies['genesis'])))
    for role,name in m.FILES.items():(root/name).write_bytes(bodies[role]);result[role]=dict(name=name,bytes=str(len(bodies[role])),sha256=sha(bodies[role]))
    (root/'intent.json').write_bytes(b'{}');(root/'result.json').write_bytes(raw(result));return sha(raw(result))
def replay(root,trace,mutation=None):
    root.mkdir();records=trace['_records'];final=trace['_final']
    if mutation:records=mutation(records)
    r=dict(version=m.REPLAY_VERSION,traceSHA256=trace['resultSHA256'],firstHeight=str(trace['firstHeight']),lastHeight=str(trace['lastHeight']),completeStateBytesReconstructed=True,fullResponsesCompared=True,normalizationApplied=False,sourceReadOnly=True,syntheticOnly=True,nodeStarted=False,authorityGranted=False,liveNetworkPairQualified=False)
    for role,name,body in [('records','replay.jsonl',records),('finalState','final-state.json',final)]:r[role]=dict(name=name,bytes=str(len(body)),sha256=sha(body));(root/name).write_bytes(body)
    (root/'result.json').write_bytes(raw(r));return m.read_bundle(root,sha(raw(r)),'replay')
class CompleteTraceControls(unittest.TestCase):
    def test_complete_original_bytes_match_but_no_source_binary_or_live_grant(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Path(tmp).resolve();pin=fixture(b/'trace');t=m.read_bundle(b/'trace',pin,'trace');before=replay(b/'before',t);after=replay(b/'after',t);r=m.compare(t,before,after)
            self.assertEqual(r['status'],'MATCHED_ORIGINAL_REPLAY_DATA_ONLY');self.assertEqual(t['retainedHeights'],2);self.assertFalse(r['qualified'] or r['commonOriginalFinalizeTrajectoryQualified'] or r['normalWirePairQualified'] or r['independentReplayExecutionsObserved']);self.assertFalse(t['RPCWireCaptured'] or t['protobufReverifiedByThisReader'])
    def test_missing_duplicate_height_missing_packet_or_extra_projection_refused(self):
        changes=[lambda r:r.pop(),lambda r:r[1].update(height='1'),lambda r:r[0].pop('request'),lambda r:r[0].update(projected=True),lambda r:r[0].update(request='%%%')]
        for i,change in enumerate(changes):
            with tempfile.TemporaryDirectory() as tmp:
                b=Path(tmp).resolve();pin=fixture(b/'trace',change)
                with self.subTest(i=i),self.assertRaises((RuntimeError,ValueError)):m.read_bundle(b/'trace',pin,'trace')
    def test_external_pin_tamper_and_symlink_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Path(tmp).resolve();pin=fixture(b/'trace')
            with self.assertRaises(RuntimeError):m.read_bundle(b/'trace','0'*64,'trace')
            p=b/'trace/records.jsonl';body=p.read_bytes();p.write_bytes(body+b' ')
            with self.assertRaises(RuntimeError):m.read_bundle(b/'trace',pin,'trace')
            p.unlink();(b/'elsewhere').write_bytes(body);p.symlink_to(b/'elsewhere')
            with self.assertRaises(RuntimeError):m.read_bundle(b/'trace',pin,'trace')
    def test_response_change_never_hidden_by_same_state_or_apphash(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Path(tmp).resolve();t=m.read_bundle(b/'trace',fixture(b/'trace'),'trace')
            def changed(records):
                lines=records.splitlines();row=json.loads(lines[0]);row['response']='BQ==';return raw(row)+b'\n'+lines[1]+b'\n'
            r=replay(b/'replay',t,changed)
            with self.assertRaisesRegex(RuntimeError,'complete original replay'):m.compare(t,r)
    def test_single_or_same_original_replay_cannot_be_two_source_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Path(tmp).resolve();t=m.read_bundle(b/'trace',fixture(b/'trace'),'trace');r=replay(b/'replay',t)
            self.assertEqual(m.compare(t,r)['status'],'TRACE_ORIGINALS_READ');report=m.compare(t,r,r);self.assertTrue(any('Same original replay' in x for x in report['missing']));self.assertFalse(report['qualified'])
    def test_actual_candidate_cli_accepts_complete_trace_data_without_execution(self):
        sp=importlib.util.spec_from_file_location('complete_trace_candidate_driver',Path(__file__).with_name('pq-normal-process-lab.py'));d=importlib.util.module_from_spec(sp);sp.loader.exec_module(d)
        with tempfile.TemporaryDirectory() as tmp:
            b=Path(tmp).resolve();pin=fixture(b/'trace');r=d.paired_candidate_main(['--finalize-trace',str(b/'trace'),'--trace-sha256',pin]);self.assertEqual(r['replayGate']['trace']['retainedHeights'],2);self.assertFalse(r['ready'] or r['pressureAuthorized'])
            with self.assertRaises(RuntimeError):d.paired_candidate_main(['--before-replay',str(b/'trace'),'--before-replay-sha256',pin])
if __name__=='__main__':unittest.main()
