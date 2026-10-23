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

if __name__=='__main__':unittest.main()
