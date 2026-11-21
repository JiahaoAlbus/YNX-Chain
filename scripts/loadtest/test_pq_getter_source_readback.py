import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('getter',Path(__file__).with_name('pq-getter-source-readback.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
S='a'*40;T='b'*40;F='c'*40

def enc(value): return (json.dumps(value,sort_keys=True)+'\n').encode()
def fixture(mutate=None):
    selection=dict(originalSourceCommit=S,originalSourceTree=T,originalProductionForkTree=F,
        selectedOptionalForkCommit=g.SUPPLIER_COMMIT,selectedOptionalForkTree=g.SUPPLIER_TREE,
        nodeStarted=False,carrierEnabled=False,publicActivation=False)
    members={'composition/SOURCE-SELECTION.json':enc(selection)}
    ident=dict(version='YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1',sourceCommit=S,sourceTree=T,productionForkTree=F,
        optionalForkCommit=g.SUPPLIER_COMMIT,optionalForkTree=g.SUPPLIER_TREE,buildTags=['ynx_live_wire_observation'],
        sourceOnly=True,actualPreStartNodeGetter=True,nodeProcessesStarted=0,actualRunningWindow=False,carrierEnabled=False,publicActivation=False,
        preparedSourceSelection=dict(receiptBytes=len(members['composition/SOURCE-SELECTION.json']),receiptSHA256=g.pin(members['composition/SOURCE-SELECTION.json'])['sha256'],sourceSelection=selection))
    files={'composition/SOURCE-SELECTION.json':g.pin(members['composition/SOURCE-SELECTION.json'])}
    for label,key,names,pkg in (('normal-live-caller','normalProducer',g.LIVE,'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'),('original-peer-budget','originalSupplierBudget',g.BUDGET,'github.com/cometbft/cometbft/mempool')):
        rows=[dict(Action='start',Package=pkg)]
        for name in names: rows.extend((dict(Action='run',Package=pkg,Test=name),dict(Action='pass',Package=pkg,Test=name)))
        rows.append(dict(Action='pass',Package=pkg))
        if mutate and label=='normal-live-caller': mutate(rows)
        stdout=b''.join(enc(row) for row in rows);stderr=b''
        result=dict(returnCode=0,timedOut=False,validationPassed=True,firstFailure=None,requiredPassed=list(names),stdout=dict(g.pin(stdout),path='/original/stream'),stderr=dict(g.pin(stderr),path='/original/stderr'))
        result_raw=enc(result);members[label+'.jsonl']=stdout;members[label+'.stderr.log']=stderr;members[label+'.result.json']=result_raw
        ident[key]=dict(**g.pin(stdout),stderr=dict(g.pin(stderr),path='/original/stderr'),result=dict(g.pin(result_raw),path='/original/result'))
        for suffix in ('.jsonl','.stderr.log','.result.json'): files[label+suffix]=g.pin(members[label+suffix])
    members['SOURCE.json']=enc(ident);files['SOURCE.json']=g.pin(members['SOURCE.json'])
    members['GETTER-QUALIFICATION.json']=enc(dict(version='YNX-HELD-OPTIONAL-LIVE-GETTER-CI/v1',sourceCommit=S,sourceTree=T,productionForkTree=F,supplierCommit=g.SUPPLIER_COMMIT,supplierForkTree=g.SUPPLIER_TREE,runId='123',runAttempt='1',files=files,sourceOnly=True,nodeStarted=False,authorityGranted=False,publicActivation=False,independentFinality=False))
    return members

def check(members,**kw):
    args=dict(source=S,tree=T,fork=F,run=123,attempt=1,expected_members={k:hashlib.sha256(v).hexdigest() for k,v in members.items()});args.update(kw)
    return g.inspect_getter(members,**args)

class GetterControls(unittest.TestCase):
    def test_full_stream_is_data_only(self):
        out=check(fixture());self.assertFalse(out['sourceQualified'] or out['runtimePermissionGranted'])
    def test_missing_extra_or_wrong_digest_refused(self):
        for mode in ('missing','extra','digest'):
            with self.subTest(mode=mode),self.assertRaises(ValueError):
                m=fixture()
                if mode=='missing':del m['normal-live-caller.stderr.log']
                if mode=='extra':m['foreign']=b'x'
                if mode=='digest':check(m,expected_members={k:'0'*64 for k in m});continue
                check(m)
    def test_skipped_duplicate_and_missing_tests_refused(self):
        for mutate in (lambda rows:rows[2].update(Action='skip'),lambda rows:rows.insert(2,dict(rows[1])),lambda rows:rows.pop(1),
                       lambda rows:rows[1].update(Package='github.com/foreign/package'),
                       lambda rows:rows[1].update(Test=rows[1]['Test']+'/nested')):
            with self.subTest(mutate=mutate),self.assertRaises(ValueError):check(fixture(mutate))
    def test_cross_source_and_attempt_refused(self):
        with self.assertRaises(ValueError):check(fixture(),source='d'*40)
        with self.assertRaises(ValueError):check(fixture(),attempt=2)
    def test_duplicate_json_and_wrong_original_qualification_refused(self):
        with self.assertRaises(ValueError):g.strict(b'{"a":1,"a":2}')
        m=fixture();x=json.loads(m['GETTER-QUALIFICATION.json']);x['runId']='124';m['GETTER-QUALIFICATION.json']=enc(x)
        with self.assertRaises(ValueError):check(m)
    def test_package_terminal_cannot_precede_test(self):
        def move(rows): rows.insert(1,rows.pop())
        with self.assertRaises(ValueError):check(fixture(move))

if __name__=='__main__':unittest.main()
