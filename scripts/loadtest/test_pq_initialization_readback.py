"""Original archive/journal readback controls. No Go, source CI or real nodes."""
import contextlib,copy,hashlib,importlib.util,io,json,unittest,zipfile
from pathlib import Path
from unittest import mock
sp=importlib.util.spec_from_file_location('init_readback',Path(__file__).with_name('pq-initialization-readback.py'));m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
C='a'*40;S='b'*40;T='c'*40;TOOLS='d'*40

def artifact(mode='complete'):
    begin=dict(kind='initialization_stage_requested',index=0,stage='create_original',identity='all504',requestedMonotonicNs=10,elapsedNs=None,completed=False,missingReturnIsUnknown=True)
    row=dict(index=0,stage='create_original',identity='all504',requestedMonotonicNs=10,startedMonotonicNs=12,returnedMonotonicNs=22,elapsedNs=10,requestJournalElapsedNs=2,outcome='RETURNED',errorType=None)
    end=dict(row,kind='initialization_stage_returned',completed=True)
    journal=(json.dumps(begin)+'\n'+(json.dumps(end)+'\n' if mode!='unfinished' else '')).encode()
    if mode=='truncated':journal=json.dumps(begin).encode()+b'\n{"partial"'
    source=dict(commit=S,tree=T);census=dict(configuredLoadAccounts=500,completeFourNodeAccountReadback=True,nodes=[dict(node=i,height=18,appHash='f'*64,matchingOriginalLoadAccounts=500) for i in range(4)])
    r=dict(source=source,initializationOnlyRequested=True,loadExecuted=False,freshResourceAdmission={},initializedAccountReadback=census,initializationStages=dict(records=[row] if mode!='unfinished' else []),initializationJournalSegments=[dict(path='initialization-events-00000.jsonl',bytes=len(journal),sha256=hashlib.sha256(journal).hexdigest())],initializationDataValidation=dict(completeNormalInitializationObserved=mode=='complete'),firstCause=None if mode=='complete' else 'original source first cause',cleanupComplete=True)
    f={'public/receipt.json':json.dumps(r).encode(),'public/CURRENT703-BASELINE-CI.json':json.dumps(dict(controllerCommit=C,goSource=S,tools=TOOLS,measurementScope='normal-initialization-only')).encode(),'public/requested-load.json':json.dumps(dict(source=source,accounts=500,perAccountCapacity=1,configuredDemand=500)).encode(),'public/fresh-resource-admission.json':b'{}','public/initialized-account-readback.json':json.dumps(census).encode(),'public/initialization-events-00000.jsonl':journal}
    return f

def packed(files):
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w') as z:
        for name,body in files.items():z.writestr(name,body)
    raw=buf.getvalue();return raw,hashlib.sha256(raw).hexdigest()

def read(files):
    raw,pin=packed(files);return m.inspect(raw,pin,C,S,T,TOOLS)

class InitializationArchiveControls(unittest.TestCase):
    def test_default_inert_does_not_open_archive(self):
        with mock.patch.object(m.Path,'read_bytes',side_effect=AssertionError('read')),contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(m.main([]),0)
        self.assertFalse(json.loads(out.getvalue())['archiveRead'])
    def test_complete_original_four_node_data_is_not_business_or_pressure(self):
        r=read(artifact());self.assertTrue(r['completeInitializationDataObserved']);self.assertEqual(r['journals']['requested'],1);self.assertEqual(r['journals']['returned'],1);self.assertFalse(r['pressureAuthorized'] or r['sourceGrant'] or r['businessLoadExecuted']);self.assertIsNone(r['businessTPS'])
    def test_missing_return_keeps_unknown_duration_and_original_failure(self):
        r=read(artifact('unfinished'));self.assertFalse(r['completeInitializationDataObserved']);self.assertEqual(r['originalFirstCause'],'original source first cause');self.assertIsNone(r['journals']['unfinished'][0]['elapsedNs']);self.assertEqual(r['journals']['status'],'PARTIAL_OR_FAILED')
    def test_truncated_journal_retains_first_cause_and_does_not_backfill(self):
        r=read(artifact('truncated'));self.assertEqual(r['originalFirstCause'],'original source first cause');self.assertFalse(r['completeInitializationDataObserved']);self.assertTrue(r['journals']['errors']);self.assertIsNone(r['journals']['unfinished'][0]['elapsedNs'])
    def test_wrong_digest_path_escape_or_journal_pin_is_refused(self):
        raw,pin=packed(artifact())
        with self.assertRaises(RuntimeError):m.inspect(raw,'0'*64,C,S,T,TOOLS)
        f=artifact();f['../outside']=b'not extracted'
        with self.assertRaises(RuntimeError):read(f)
        f=artifact();f['public/initialization-events-00000.jsonl']+=b'changed'
        with self.assertRaises(RuntimeError):read(f)
    def test_duplicate_node_cannot_become_full_four_node_census(self):
        f=artifact();r=json.loads(f['public/receipt.json']);census=r['initializedAccountReadback'];census['nodes'][3]['node']=0;f['public/receipt.json']=json.dumps(r).encode();f['public/initialized-account-readback.json']=json.dumps(census).encode();self.assertFalse(read(f)['completeInitializationDataObserved'])
    def test_changed_receipt_span_not_reconciled_from_journal(self):
        f=artifact();r=json.loads(f['public/receipt.json']);r['initializationStages']['records'][0]['elapsedNs']=11;f['public/receipt.json']=json.dumps(r).encode();d=read(f);self.assertFalse(d['completeInitializationDataObserved']);self.assertEqual(d['originalStages']['records'][0]['elapsedNs'],11);self.assertTrue(d['journals']['errors'])
    def test_source_or_business_scope_cannot_be_relabelled(self):
        f=artifact();r=json.loads(f['public/receipt.json']);r['loadExecuted']=True;f['public/receipt.json']=json.dumps(r).encode()
        with self.assertRaises(RuntimeError):read(f)
        raw,pin=packed(artifact())
        with self.assertRaises(RuntimeError):m.inspect(raw,pin,'0'*40,S,T,TOOLS)

if __name__=='__main__':unittest.main()
