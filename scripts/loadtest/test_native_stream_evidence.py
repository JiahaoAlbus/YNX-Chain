"""Cross-language checks use one original Go public unit fixture, no network."""
import base64,copy,gzip,hashlib,importlib.util,json,os,shutil,tempfile,unittest
from pathlib import Path
FILE=Path(__file__).with_name('native-stream-evidence.py')
spec=importlib.util.spec_from_file_location('stream_evidence',FILE);evidence=importlib.util.module_from_spec(spec);spec.loader.exec_module(evidence)

class NativeStreamEvidenceTests(unittest.TestCase):
    def setUp(self):
        original=os.environ.get('YNX_NATIVE_STREAM_PUBLIC_FIXTURE_DIR')
        self.assertTrue(original,'required original Go public fixture was not selected; do not count a skip as proof')
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()/'capture';shutil.copytree(original,self.root)
        self.meta=evidence.strict_json((self.root/'PUBLIC_FIXTURE_SCOPE.json').read_bytes())
        self.assertEqual(self.meta['kind'],'native_stream_public_unit_fixture_not_network');self.assertIs(self.meta['independentBFTProof'],False)
        self.initial=evidence.strict_json((self.root/'transactions.json').read_bytes())['transactions']
    def verify(self,budget=4<<20):
        d=self.meta
        return evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),self.initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],budget)
    def test_optional_submission_join_preserves_complete_original_identity(self):
        class CountJoin:
            def __init__(self):self.count=0
            def add(self,row):self.count+=1
            def result(self):return dict(records=self.count)
        d=self.meta;join=CountJoin();base=self.verify()
        proof=evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),self.initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],4<<20,submission_trace_join=join)
        self.assertEqual(proof['submissionTraceJoin'],dict(records=102))
        self.assertEqual({k:v for k,v in proof.items() if k!='submissionTraceJoin'},base)
        spec=importlib.util.spec_from_file_location('unit_trace_join',Path(__file__).with_name('native-stream-submission-trace.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        spec=importlib.util.spec_from_file_location('trace_unit_controller',Path(__file__).with_name('supply-linux-window.py'));controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
        with self.assertRaisesRegex(RuntimeError,'HTTP trace absent'):
            evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),self.initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],4<<20,submission_trace_join=module.SubmissionTraceJoin(102,controller.validate_submission_phases))

    def test_original_go_client_clock_has_exact_full_coverage(self):
        d=self.meta;timeline=d['boundedSummary']['timeSeries']
        clock=evidence.client_clock_measurements(timeline,d['terminalStream']['records'],True)
        self.assertTrue(clock['valid']);self.assertEqual(clock['samples'],3*d['terminalStream']['records'])
        self.assertEqual(clock,timeline['clock'])
        stats=evidence.current_input_reuse_measurements(d["durableReadback"],True)
        self.assertTrue(stats["enabled"])
    def test_original_go_certificate_publish_has_nested_actual_costs(self):
        phases=self.meta['durableReadback']['prefixReplay']['workPhases']
        self.assertIn('certificatePublishDetails',phases)
        details=phases['certificatePublishDetails'];parent=phases['certificatePublish']
        self.assertEqual(details['payloadCopy']['calls'],parent['calls'])
        self.assertEqual(details['strictJSON']['calls'],parent['calls'])
        self.assertEqual(details['nativeClone']['calls'],parent['calls'])
        self.assertGreater(details['payloadBytes'],0);self.assertGreater(details['prefixBytesHashed'],0)
        self.assertLessEqual(sum(details[k]['durationNs'] for k in ('payloadCopy','strictJSON','nativeClone')),parent['durationNs'])
        self.assertEqual(evidence.certificate_publish_measurements(phases,32<<20,True,True),details)
    def test_real_go_unit_fixture_cannot_invent_missing_network_node_identity(self):
        endpoints,phases,timeline,_=NodeCompletionJoinTests().fixture()
        records=self.meta['terminalStream']['records'];timeline['clock']['samples']=3*records
        join=evidence.NodeCompletionJoin(endpoints,phases,timeline,records)
        d=self.meta
        with self.assertRaisesRegex(RuntimeError,'terminal endpoint outside original node set'):
            evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),self.initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],4<<20,node_completion_join=join)
    def test_complete_original_latencies_match_go_bounded_summary(self):
        d=self.meta
        proof=evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),self.initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],4<<20,measure_latency=True)
        got=evidence.verify_bounded_latency(proof['rowMetrics'],d['boundedSummary'])
        self.assertEqual(got['records'],102)
        self.assertEqual(set(got['stageGapIntervalsNs']),{'queue','checkTx','checkToObservedInclusion','observedInclusionToFinal'})
        for name in evidence.LatencyFold.names:self.assertEqual(got['latencyIntervalsNs'][name]['samples'],102)
        bad=copy.deepcopy(d['boundedSummary']);bad['latencyIntervalsNs']['final']['p95']['upperNs']+=1
        with self.assertRaisesRegex(RuntimeError,'intervals differ'):evidence.verify_bounded_latency(got,bad)
        bad=copy.deepcopy(d['boundedSummary']);bad['terminalRecords']=3
        with self.assertRaisesRegex(RuntimeError,'coverage differs'):evidence.verify_bounded_latency(got,bad)
    def test_actual_go_supply_counters_cover_all_nonce_cycles_and_terminal_writes(self):
        ready=self.meta['readySenders'];total=self.meta['senders']*self.meta['rounds']
        self.assertEqual(ready['completed'],total);self.assertEqual(ready['quarantinedAccounts'],0)
        self.assertEqual(ready['supply']['journalDurableBytes'],self.meta['intents']['bytes'])
        for key in ('signAttempts','encodeAttempts','signedSuccessors'):self.assertEqual(ready['supply'][key],total-self.meta['senders'])
        for key in ('journalDurableEnvelopes','terminalSinkAttempts'):self.assertEqual(ready['supply'][key],total)
        for key in ('signNs','encodeNs','journalAppendNs','terminalSinkNs','journalSetupNs','journalDurableBytes'):self.assertGreater(ready['supply'][key],0)

    def test_latency_fold_has_go_rounding_overflow_and_no_lifetime_rows(self):
        fold=evidence.LatencyFold()
        for q,c in ((0.0000005,0.0000005),(60001.,60002.)):
            fold.add(dict(queueDelayMs=q,checkTxMs=0.,inclusionMs=0.,confirmationMs=c))
        got=fold.result();self.assertEqual(got['latencyIntervalsNs']['queue']['minNs'],1)
        self.assertEqual(got['latencyIntervalsNs']['offerToFinal']['minNs'],1)
        self.assertTrue(got['latencyIntervalsNs']['offerToFinal']['p95']['overflow'])
        self.assertEqual(len(fold.bins),9);self.assertEqual(sum(len(b) for b in fold.bins),9*60001)
        for value in (None,True,float('nan'),float('inf'),-1):
            with self.subTest(value=value),self.assertRaises(RuntimeError):
                evidence.LatencyFold().add(dict(queueDelayMs=value,checkTxMs=0,inclusionMs=1,confirmationMs=2))

    def terminal_file(self):return self.root/'transactions-result.json.terminal-stream'/'terminal-000000.jsonl'
    def rewrite_terminal(self,mutate):
        chain='0'*64;size=0
        for number in range(self.meta['terminalStream']['segments']):
            path=self.root/'transactions-result.json.terminal-stream'/('terminal-%06d.jsonl'%number)
            lines=[evidence.strict_json(l) for l in gzip.decompress(path.read_bytes()).splitlines()]
            header=lines[0];header['previousSha256']=chain;encoded=[json.dumps(header,separators=(',',':')).encode()]
            for row in lines[1:-1]:
                mutate(row['result']);row['previousSha256']=chain
                raw=json.dumps(row,separators=(',',':')).encode();chain=hashlib.sha256(raw).hexdigest();encoded.append(raw)
            seal=lines[-1];seal['chainSha256']=chain;encoded.append(json.dumps(seal,separators=(',',':')).encode())
            raw=gzip.compress(b'\n'.join(encoded)+b'\n',mtime=0);path.write_bytes(raw);size+=len(raw)
        self.meta['terminalStream']['bytes']=size;self.meta['terminalStream']['chainSha256']=chain
    def test_original_go_stream_joins_all_real_signed_identities_and_latest_slots(self):
        got=self.verify();self.assertEqual(got['validatedRecords'],102);self.assertEqual(got['matchedLatestSlots'],3)
        self.assertLessEqual(got['peakPendingIdentities'],3+64);self.assertFalse(got['networkQualified']);self.assertFalse(got['sustainedTPSQualified'])
        self.assertEqual(got['originalPublicMemberManifest']['members'],self.meta['intents']['segments']+self.meta['terminalStream']['segments'])
        self.assertRegex(got['originalPublicMemberManifest']['sha256'],r'^[0-9a-f]{64}$')
        self.assertEqual({p.name for p in self.root.iterdir()},{'network-manifest.json','transactions.json','transactions-result.json.streaming-plan.json','PUBLIC_FIXTURE_SCOPE.json','sender-ready-intents','transactions-result.json.terminal-stream'})
        print('YNX_NATIVE_STREAM_PUBLIC_IDENTITY '+json.dumps(got,sort_keys=True),flush=True)
    def test_missing_original_segment_is_not_reconstructed(self):
        self.terminal_file().unlink()
        with self.assertRaisesRegex(RuntimeError,'missing|inventory'):self.verify()
        self.assertFalse(self.terminal_file().exists())
    def test_extra_or_symlink_member_refuses_without_following(self):
        path=self.root/'sender-ready-intents'/'intent-999999.jsonl';path.symlink_to(self.root/'transactions.json')
        with self.assertRaisesRegex(RuntimeError,'inventory'):self.verify()
    def test_gzip_crc_corruption_retains_failed_raw(self):
        path=self.terminal_file();raw=bytearray(path.read_bytes());raw[-5]^=1;path.write_bytes(raw);before=path.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'gzip'):self.verify()
        self.assertEqual(before,path.read_bytes())
    def test_concatenated_gzip_or_hidden_tail_is_not_accepted(self):
        path=self.terminal_file();extra=gzip.compress(b'\n',mtime=0);path.write_bytes(path.read_bytes()+extra);self.meta['terminalStream']['bytes']+=len(extra)
        with self.assertRaisesRegex(RuntimeError,'gzip'):self.verify()
    def test_latest_slot_must_equal_original_terminal(self):
        self.meta['latest'][0]['height']+=1
        with self.assertRaisesRegex(RuntimeError,'latest slot'):self.verify()
    def test_unknown_with_recomputed_hash_chain_still_refuses_business_final(self):
        self.rewrite_terminal(lambda r:r.update(status='submission_unknown') if r['index']==0 else None)
        with self.assertRaisesRegex(RuntimeError,'reported qualified business final'):self.verify()
    def test_wrong_nonce_with_recomputed_chain_still_refuses(self):
        self.rewrite_terminal(lambda r:r.update(round=2) if r['index']==0 else None)
        with self.assertRaisesRegex(RuntimeError,'nonce coverage'):self.verify()
    def test_signed_envelope_substitution_cannot_borrow_original_intent(self):
        def replace(row):
            if row['index']!=0:return
            tx=evidence.strict_json(base64.b64decode(row['signedTransaction']));tx['signature']='00'+tx['signature'][2:]
            row['signedTransaction']=base64.b64encode(json.dumps(tx,separators=(',',':')).encode()).decode()
            row['bytes']=len(base64.b64decode(row['signedTransaction']))
        self.rewrite_terminal(replace)
        with self.assertRaisesRegex(RuntimeError,'signed envelope changed'):self.verify()
    def test_receipt_types_and_budget_are_strict(self):
        original=copy.deepcopy(self.meta)
        for target,key,value in [('intents','records',True),('intents','bytes',False),('terminalStream','durableRecords',101),('terminalStream','poisoned',0),('terminalStream','segments',True)]:
            self.meta=copy.deepcopy(original);self.meta[target][key]=value
            with self.subTest(target=target,key=key),self.assertRaises(RuntimeError):self.verify()
        self.meta=original
        with self.assertRaisesRegex(RuntimeError,'combined byte budget'):self.verify(original['intents']['bytes']+original['terminalStream']['bytes']-1)
    def test_fixture_manifest_hash_change_is_not_normalized(self):
        path=self.root/'network-manifest.json';path.write_bytes(path.read_bytes()+b'\n')
        with self.assertRaisesRegex(RuntimeError,'fixture'):self.verify()
    def test_remote_or_other_manifest_scope_is_not_promoted(self):
        path=self.root/'network-manifest.json';original=path.read_bytes()
        for field,value in (('purpose','remote-production'),('chainId','other-chain'),('version',True)):
            changed=evidence.strict_json(original);changed[field]=value;path.write_text(json.dumps(changed))
            with self.subTest(field=field),self.assertRaisesRegex(RuntimeError,'ephemeral manifest scope'):self.verify()
        path.write_bytes(original)

    def test_reported_runtime_escape_is_not_used_as_capture_path(self):
        self.meta['intents']['directory']='/tmp/unrelated-input'
        with self.assertRaisesRegex(RuntimeError,'runtime scope'):self.verify()
    def test_duplicate_json_fields_and_nonfinite_values_rejected(self):
        for raw in (b'{"index":0,"index":1}',b'{"duration":NaN}'):
            with self.subTest(raw=raw),self.assertRaises(RuntimeError):evidence.strict_json(raw)

class ReaderGateMeasurementTests(unittest.TestCase):
    def test_original_gate_coverage_maxima_and_copy(self):
        gate=dict(acquisitions=3,waitNs=100,maxWaitNs=70,holdNs=200,maxHoldNs=90)
        reader=dict(attempts=2,readerGate=gate)
        actual=evidence.reader_gate_measurements(reader,required=True)
        self.assertEqual(actual,gate);actual['acquisitions']=99
        self.assertEqual(gate['acquisitions'],3)
        self.assertIsNone(evidence.reader_gate_measurements(dict(attempts=1)))
        with self.assertRaises(RuntimeError):evidence.reader_gate_measurements(dict(attempts=1),required=True)
        empty=dict(acquisitions=0,waitNs=0,maxWaitNs=0,holdNs=0,maxHoldNs=0)
        self.assertEqual(evidence.reader_gate_measurements(dict(attempts=0,readerGate=empty),True),empty)

    def test_missing_fabricated_or_mistyped_gate_totals_rejected(self):
        gate=dict(acquisitions=3,waitNs=100,maxWaitNs=70,holdNs=200,maxHoldNs=90)
        changes=[dict(acquisitions=1),dict(acquisitions=True),dict(waitNs=-1),dict(holdNs=0),dict(maxWaitNs=101),dict(maxHoldNs=201),dict(maxHoldNs=1.0),dict(acquisitions=0)]
        for changed in changes:
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):
                evidence.reader_gate_measurements(dict(attempts=2,readerGate=dict(gate,**changed)),True)
        with self.assertRaises(RuntimeError):evidence.reader_gate_measurements(dict(attempts=2,readerGate=dict(gate,unknown=1)),True)
        with self.assertRaises(RuntimeError):evidence.reader_gate_measurements(dict(attempts=2,readerGate=gate),required='true')

class ClientClockMeasurementTests(unittest.TestCase):
    def test_exact_clock_coverage_and_drift_are_retained(self):
        clock=dict(originUnixNs='1800000000000000001',samples=6,invalidSamples=0,maximumAbsWallDriftNs=100,valid=True,driftWithin1ms=True)
        self.assertEqual(evidence.client_clock_measurements(dict(clock=clock),2,True),clock)
        jumped=dict(clock,maximumAbsWallDriftNs=2000000,driftWithin1ms=False)
        self.assertFalse(evidence.client_clock_measurements(dict(clock=jumped),2,True)['driftWithin1ms'])
        self.assertIsNone(evidence.client_clock_measurements({},2))
        with self.assertRaises(RuntimeError):evidence.client_clock_measurements({},2,True)
    def test_precision_loss_false_coverage_and_false_drift_claims_are_rejected(self):
        clock=dict(originUnixNs='1800000000000000001',samples=6,invalidSamples=0,maximumAbsWallDriftNs=100,valid=True,driftWithin1ms=True)
        for changes in (dict(originUnixNs=1800000000000000001),dict(samples=5),dict(samples=True),dict(valid=False),dict(maximumAbsWallDriftNs=2000000),dict(invalidSamples=1)):
            with self.subTest(changes=changes),self.assertRaises(RuntimeError):evidence.client_clock_measurements(dict(clock=dict(clock,**changes)),2,True)

class CurrentInputReuseMeasurementTests(unittest.TestCase):
    def test_actual_reuse_work_and_original_retained_budget_are_bound(self):
        stats=dict(enabled=True,attempts=4,errors=0,hits=3,misses=1,comparedBytes=9000,lookupNs=123,retainedInputBytes=12000)
        reader=dict(currentInputReuse=stats,snapshotValidations=1,snapshotCacheHits=4,readerBudget=dict(cachedInputBytes=12000,cacheInputByteBudget=64<<20))
        self.assertEqual(evidence.current_input_reuse_measurements(reader,True),stats)
        self.assertIsNone(evidence.current_input_reuse_measurements({}))
        for changed in (dict(hits=5),dict(misses=2),dict(attempts=3),dict(lookupNs=0),dict(retainedInputBytes=12001),dict(enabled=False)):
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):evidence.current_input_reuse_measurements(dict(reader,currentInputReuse=dict(stats,**changed)),True)
        with self.assertRaises(RuntimeError):evidence.current_input_reuse_measurements(reader,False)

class NativeCanonicalClientFixtureTests(unittest.TestCase):
    def setUp(self):
        original=os.environ.get('YNX_NATIVE_CANONICAL_PUBLIC_FIXTURE_DIR')
        self.assertTrue(original,'required original canonical Go public fixture was not selected')
        self.root=Path(original).resolve()
        self.meta=evidence.strict_json((self.root/'PUBLIC_FIXTURE_SCOPE.json').read_bytes())
        self.assertEqual(self.meta['kind'],'native_stream_public_unit_fixture_not_network')
        self.assertIs(self.meta['independentBFTProof'],False)
    def test_actual_config_plan_and_publication_branch_match(self):
        stats=self.meta['durableReadback']['prefixReplay']
        plan=evidence.strict_json((self.root/'transactions-result.json.streaming-plan.json').read_bytes())['nativePrefix']
        self.assertIs(stats['canonicalCertificate'],True)
        self.assertIs(plan['canonicalCertificate'],True)
        self.assertIs(plan['originalSuffixSetup'],True)
        self.assertNotIn('nativeSuffixSetup',stats)
        parts=evidence.certificate_publish_measurements(stats['workPhases'],32<<20,True,True,True)
        self.assertEqual(parts['canonicalNative']['calls'],102)
        self.assertEqual(parts['canonicalNativeAccepted'],102)
        self.assertEqual(parts['strictJSON']['calls'],0)
        with self.assertRaises(RuntimeError):evidence.certificate_publish_measurements(stats['workPhases'],32<<20,True,True)
    def test_complete_real_signed_stream_and_latest_slots_remain_valid(self):
        d=self.meta;initial=evidence.strict_json((self.root/'transactions.json').read_bytes())['transactions']
        result=evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],4<<20)
        self.assertEqual(result['validatedRecords'],102)
        self.assertEqual(result['matchedLatestSlots'],3)

class NativeSuffixClientFixtureTests(unittest.TestCase):
    def setUp(self):
        original=os.environ.get('YNX_NATIVE_SUFFIX_PUBLIC_FIXTURE_DIR')
        self.assertTrue(original,'required original suffix Go public fixture was not selected')
        self.root=Path(original).resolve()
        self.meta=evidence.strict_json((self.root/'PUBLIC_FIXTURE_SCOPE.json').read_bytes())
        self.assertEqual(self.meta['kind'],'native_stream_public_unit_fixture_not_network')
        self.assertIs(self.meta['independentBFTProof'],False)
    def test_actual_private_suffix_selection_retains_full_validation_and_original_certificate(self):
        prefix=self.meta['durableReadback']['prefixReplay']
        plan=evidence.strict_json((self.root/'transactions-result.json.streaming-plan.json').read_bytes())['nativePrefix']
        self.assertIs(prefix['nativeSuffixSetup'],True)
        self.assertIs(plan['originalSuffixSetup'],False)
        self.assertNotIn('canonicalCertificate',prefix);self.assertNotIn('canonicalCertificate',plan)
        self.assertEqual(prefix['canonicalByteLimit'],32<<20)
        phases=prefix['workPhases']
        self.assertGreater(phases['suffixSetup']['calls'],0)
        self.assertEqual(phases['suffixSetup']['calls'],phases['privateValidate']['calls'])
        parts=evidence.certificate_publish_measurements(phases,32<<20,True,True)
        self.assertNotIn('canonicalNative',parts)
        self.assertEqual(parts['strictJSON']['calls'],102)
        self.assertEqual(self.meta['durableReadback']['transactionVerifications'],102)
    def test_complete_real_signed_stream_and_recovered_latest_slots(self):
        d=self.meta;initial=evidence.strict_json((self.root/'transactions.json').read_bytes())['transactions']
        result=evidence.verify_streams(self.root,d['runtimeNetworkRoot'],d['runtimeOutput'],(self.root/'network-manifest.json').read_bytes(),initial,d['intents'],d['terminalStream'],d['latest'],d['rounds'],4<<20)
        self.assertEqual(result['validatedRecords'],102);self.assertEqual(result['matchedLatestSlots'],3)

class CertificatePublishMeasurementTests(unittest.TestCase):
    def fixture(self):
        return dict(certificatePublish=dict(calls=2,errors=0,durationNs=100),certificatePublishDetails=dict(payloadCopy=dict(calls=2,errors=0,durationNs=10),strictJSON=dict(calls=2,errors=0,durationNs=60),nativeClone=dict(calls=2,errors=0,durationNs=20),payloadBytes=200,prefixBytesHashed=120))
    def test_canonical_candidate_requires_selection_and_conserves_fallbacks(self):
        for accepted in (0,1,2):
            phases=self.fixture();parts=phases['certificatePublishDetails']
            parts['canonicalNative']=dict(calls=2,errors=0,durationNs=5)
            if accepted:parts['canonicalNativeAccepted']=accepted
            parts['strictJSON']=dict(calls=2-accepted,errors=0,durationNs=10*(2-accepted))
            result=evidence.certificate_publish_measurements(phases,1024,True,True,True)
            result['canonicalNative']['calls']=999
            self.assertEqual(parts['canonicalNative']['calls'],2)
            with self.assertRaises(RuntimeError):evidence.certificate_publish_measurements(phases,1024,True,True)
            for change in ('accepted','attempts','missing','errors'):
                bad=copy.deepcopy(phases);child=bad['certificatePublishDetails']
                if change=='accepted':child['canonicalNativeAccepted']=3
                if change=='attempts':child['canonicalNative']['calls']=1
                if change=='missing':del child['canonicalNative']
                if change=='errors':child['canonicalNative']['errors']=1
                with self.subTest(accepted=accepted,change=change),self.assertRaises(RuntimeError):evidence.certificate_publish_measurements(bad,1024,True,True,True)
    def test_nested_costs_are_copied_and_not_added_twice(self):
        phases=self.fixture();result=evidence.certificate_publish_measurements(phases,1024,True,True)
        result['strictJSON']['calls']=999
        self.assertEqual(phases['certificatePublishDetails']['strictJSON']['calls'],2)
        self.assertIsNone(evidence.certificate_publish_measurements({},1024))
        with self.assertRaises(RuntimeError):evidence.certificate_publish_measurements({},1024,True,True)
        for key in ('strictJSON','nativeClone'):phases['certificatePublishDetails'][key]=dict(calls=0,errors=0,durationNs=0)
        self.assertIsNotNone(evidence.certificate_publish_measurements(phases,1024,True,False))
    def test_missing_extra_mistyped_or_impossible_children_refuse(self):
        for change in ('missing','extra','bool','time','calls','errors','bytes','zero_bytes'):
            phases=self.fixture();parts=phases['certificatePublishDetails']
            if change=='missing':del parts['strictJSON']
            if change=='extra':parts['unknown']=0
            if change=='bool':parts['nativeClone']['calls']=True
            if change=='time':parts['strictJSON']['durationNs']=101
            if change=='calls':parts['nativeClone']['calls']=3
            if change=='errors':parts['strictJSON']['errors']=1
            if change=='bytes':parts['payloadBytes']=2049
            if change=='zero_bytes':parts['prefixBytesHashed']=0
            with self.subTest(change=change),self.assertRaises(RuntimeError):evidence.certificate_publish_measurements(phases,1024,True,True)

class NodeCompletionJoinTests(unittest.TestCase):
    """Synthetic correlation counterexamples only, no network/finality claim."""
    def fixture(self):
        origin=evidence.utc_nanoseconds('2026-10-24T00:00:00Z')
        clock=dict(originUnixNs=str(origin),samples=3,invalidSamples=0,maximumAbsWallDriftNs=20,valid=True,driftWithin1ms=True)
        point=dict(height=3,blockHash='a'*64,appHash='b'*64,transactions=2,codeZeroTransactions=2)
        for name,offset in [('finalizeReturned',2000000000),('commitReturned',2100000000)]:
            point[name]=dict(unixNs=str(origin+offset),elapsedNs=offset,wallDriftNs=0)
        phases=[dict(blockExecutionClock=dict(originUnixNs=str(origin),maximumAbsWallDriftNs=30,driftWithin1ms=True,completeCommitCoverage=True,completeBlockHashCoverage=True,blocks=[copy.deepcopy(point)])) for _ in range(4)]
        row=dict(status='confirmed',checkTxCode=0,executionCode=0,checkTxIdentityVerified=True,quorumVerified=True,transactionProofVerified=True,durableStateVerified=True,durableInfoVerified=True,height=3,durableStateHeight=3,durableInfoHeight=3,endpoint='node0',blockHash='A'*64,durableStateAppHash='B'*64,durableInfoAppHash='B'*64,headerAppHash='c'*64,blockTxTotal=2,blockTxIndex=0,offeredAt='2026-10-24T00:00:01.000000001Z',submittedAt='2026-10-24T00:00:01.1Z',confirmedObservedAt='2026-10-24T00:00:02.2Z')
        return ['node'+str(i) for i in range(4)],phases,dict(clock=clock),row
    def test_exact_nanoseconds_and_current_post_state_not_prior_header(self):
        endpoints,phases,timeline,row=self.fixture()
        join=evidence.NodeCompletionJoin(endpoints,phases,timeline,1);join.add(row);result=join.result()
        self.assertEqual(result['maximumCalibrationErrorBoundNs'],50)
        d=result['nodeCompletionLatencyIntervalsNs']['offerToNodeFinalizeReturn']
        self.assertEqual(d['minimumLowerBoundNs'],999999949);self.assertEqual(d['p95']['upperNs'],1000000049)
        self.assertFalse(result['independentBFTVerification']);self.assertFalse(result['networkQualified'])
        self.assertFalse(result['bftQuorumFormationInstantMeasured'])
        self.assertEqual(evidence.utc_nanoseconds('2026-10-24T00:00:00.000000001Z')-evidence.utc_nanoseconds('2026-10-24T00:00:00Z'),1)
    def test_unqualified_identity_clock_and_node_coverage_refuse(self):
        for field,value in [('endpoint','foreign'),('blockHash','c'*64),('durableStateAppHash','c'*64),('durableInfoAppHash','c'*64),('height',4),('blockTxTotal',3),('blockTxIndex',2),('quorumVerified',False),('executionCode',1),('confirmedObservedAt','2026-10-24T00:00:02Z')]:
            endpoints,phases,timeline,row=self.fixture();row[field]=value
            with self.subTest(field=field),self.assertRaises(RuntimeError):evidence.NodeCompletionJoin(endpoints,phases,timeline,1).add(row)
        for field,value in [('completeBlockHashCoverage',False),('completeCommitCoverage',False),('maximumAbsWallDriftNs',1000001),('driftWithin1ms',False)]:
            endpoints,phases,timeline,row=self.fixture();phases[0]['blockExecutionClock'][field]=value
            with self.subTest(field=field),self.assertRaises(RuntimeError):evidence.NodeCompletionJoin(endpoints,phases,timeline,1)
        endpoints,phases,timeline,row=self.fixture();timeline['clock']['maximumAbsWallDriftNs']=1000001;timeline['clock']['driftWithin1ms']=False
        with self.assertRaises(RuntimeError):evidence.NodeCompletionJoin(endpoints,phases,timeline,1)
    def test_empty_blocks_allowed_but_missing_or_duplicate_business_height_refuses(self):
        endpoints,phases,timeline,row=self.fixture()
        for phase in phases:
            empty=copy.deepcopy(phase['blockExecutionClock']['blocks'][0]);empty.update(height=2,transactions=0,codeZeroTransactions=0)
            phase['blockExecutionClock']['blocks'].insert(0,empty)
        join=evidence.NodeCompletionJoin(endpoints,phases,timeline,1)
        with self.assertRaises(RuntimeError):join.result()
        join.add(row);self.assertEqual(join.result()['records'],1)
        with self.assertRaises(RuntimeError):join.add(row)
        phases[0]['blockExecutionClock']['blocks'].append(copy.deepcopy(phases[0]['blockExecutionClock']['blocks'][0]))
        with self.assertRaises(RuntimeError):evidence.NodeCompletionJoin(endpoints,phases,timeline,1)
    def test_invalid_calendar_float_timestamp_or_node_calibration_refuses(self):
        for at in (0,1.7e18,'2026-02-30T00:00:00Z','2026-10-24T00:00:00.0000000001Z','2026-10-24T00:00:00+00:00'):
            with self.subTest(at=at),self.assertRaises(RuntimeError):evidence.utc_nanoseconds(at)
        endpoints,phases,timeline,row=self.fixture();phases[0]['blockExecutionClock']['blocks'][0]['commitReturned']['elapsedNs']+=1
        with self.assertRaises(RuntimeError):evidence.NodeCompletionJoin(endpoints,phases,timeline,1)
    def test_advanced_info_and_state_match_their_own_node_height_hash(self):
        endpoints,phases,timeline,row=self.fixture();origin=int(timeline['clock']['originUnixNs'])
        for phase in phases:
            point=copy.deepcopy(phase['blockExecutionClock']['blocks'][0])
            point.update(height=4,blockHash='e'*64,appHash='d'*64,transactions=0,codeZeroTransactions=0)
            for name,offset in [('finalizeReturned',2150000000),('commitReturned',2160000000)]:point[name]=dict(unixNs=str(origin+offset),elapsedNs=offset,wallDriftNs=0)
            phase['blockExecutionClock']['blocks'].append(point)
        row.update(durableInfoHeight=4,durableInfoAppHash='D'*64)
        join=evidence.NodeCompletionJoin(endpoints,phases,timeline,1);join.add(row)
        self.assertEqual(join.result()['publishedInfoAheadRows'],1)
        for changed in (dict(durableInfoHeight=2),dict(durableInfoAppHash='B'*64),dict(durableInfoHeight=True)):
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):evidence.NodeCompletionJoin(endpoints,phases,timeline,1).add(dict(row,**changed))
        row.update(durableStateHeight=4,durableStateAppHash='D'*64)
        join=evidence.NodeCompletionJoin(endpoints,phases,timeline,1);join.add(row)
        self.assertEqual(join.result()['durableStateAheadRows'],1)

class SubmissionTraceJoinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('trace_join_test',Path(__file__).with_name('native-stream-submission-trace.py'));cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)
        spec=importlib.util.spec_from_file_location('trace_controller_test',Path(__file__).with_name('supply-linux-window.py'));cls.controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.controller)
    def join(self,total=1):return self.module.SubmissionTraceJoin(total,self.controller.validate_submission_phases)
    def row(self):return dict(checkTxMs=.00006,signedTransaction='unused-payload',submissionPhases=dict(getConnCalls=1,gotConnCalls=1,wroteRequestCalls=1,firstByteCalls=1,writeErrors=0,firstGetConnNs=0,firstGotConnNs=10,firstWroteRequestNs=20,firstResponseByteNs=50,firstConnReused=True,callbackReturnNs=70))
    def test_exact_intervals_and_owned_thin_facts(self):
        join=self.join();row=self.row();join.add(row);row['submissionPhases']['gotConnCalls']=99
        self.assertEqual(set(join.rows[0]),{'submissionPhases','checkTxMs'})
        got=join.result();self.assertEqual(got['samples'],1);self.assertEqual(got['reusedConnections'],1)
        for key,value in dict(beforeGetConnMs=0,connectionAcquireMs=10,connectionToWriteMs=10,writeToFirstByteMs=30,firstByteToReturnMs=20,callbackReturnMs=70).items():
            self.assertEqual(got['intervalTotalsNs'][key]['totalNs'],value)
            self.assertAlmostEqual(got['durationsMs'][key]['p95'],value/1e6)
        got['intervalTotalsNs']['callbackReturnMs']['totalNs']=999
        self.assertEqual(join.result()['intervalTotalsNs']['callbackReturnMs']['totalNs'],70)
    def test_reused_and_new_connection_denominators_are_exact(self):
        join=self.join(2);join.add(self.row());row=self.row();row['submissionPhases']['firstConnReused']=False;row['submissionPhases']['firstGotConnNs']=15;join.add(row);got=join.result()['connectionAcquireByReuse']
        self.assertEqual(got['reused']['samples'],1);self.assertEqual(got['reused']['meanNs'],10)
        self.assertEqual(got['new']['samples'],1);self.assertEqual(got['new']['p95Ns'],15)
        join=self.join();join.add(self.row());self.assertIsNone(join.result()['connectionAcquireByReuse']['new']['p95Ns'])

    def test_original_poll_occurrences_preserved_separately_from_business(self):
        row=self.row();row['errors']=[dict(stage='block_scan_wait',count=3),dict(stage='block_results_query',count=1)]
        join=self.join();join.add(row);got=join.result()
        self.assertEqual(got['errorOccurrences'],4)
        self.assertEqual(got['errorOccurrencesByStage'],dict(block_scan_wait=3,block_results_query=1))
        for value in (0,True,-1):
            row=self.row();row['errors']=[dict(stage='block_scan_wait',count=value)];join=self.join()
            with self.subTest(value=value),self.assertRaises(RuntimeError):join.add(row)

    def test_overlap_keeps_missing_denominator_and_no_negative_wait(self):
        row=self.row();row['submissionPhases']['firstResponseByteNs']=15;join=self.join();join.add(row);got=join.result()
        self.assertEqual(got['writeFirstByteHookOverlaps'],1)
        self.assertEqual(got['durationsMs']['writeToFirstByteMs']['samples'],0)
        self.assertIsNone(got['durationsMs']['writeToFirstByteMs']['p95'])
        self.assertIsNone(got['intervalTotalsNs']['writeToFirstByteMs']['meanNs'])
    def test_incomplete_bounds_and_missing_hooks_refuse(self):
        for count in (True,0,8193):
            with self.subTest(count=count),self.assertRaises(RuntimeError):self.join(count)
        with self.assertRaises(RuntimeError):self.join().add({})
        join=self.join(2);join.add(self.row())
        with self.assertRaises(RuntimeError):join.result()
        join=self.join();join.add(self.row())
        with self.assertRaises(RuntimeError):join.add(self.row())
        for key,value in (('gotConnCalls',2),('writeErrors',1),('firstGetConnNs',True),('firstGotConnNs',51),('callbackReturnNs',1)):
            row=self.row();row['submissionPhases'][key]=value;join=self.join();join.add(row)
            with self.subTest(key=key),self.assertRaises(RuntimeError):join.result()
        row=self.row();del row['submissionPhases']['firstResponseByteNs'];join=self.join();join.add(row)
        with self.assertRaises(RuntimeError):join.result()

if __name__=='__main__':unittest.main()
