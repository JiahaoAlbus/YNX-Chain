import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

P=Path(__file__).parent
spec=importlib.util.spec_from_file_location('getter',P/'qualify_held_optional_live_getter.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
C='a'*40; T='b'*40
F='47d7cfeee7cd178cb897eda57a4674677fac7e67'
OLD_OBSERVER_FORK='5a128880d14bfc73de4334cba23218859ad3473c'
PATCHED_FORK='aadf0831c6b65559065ca82228bab30811d36c67'

def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes((json.dumps(obj,sort_keys=True)+'\n').encode())

def rec(path):
    data=path.read_bytes();return {'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}

def fixture(d, fork=F, supplier=None):
    supplier_commit, supplier_tree = supplier or m.SUPPLIER_BY_PRODUCTION[fork]
    sel={'originalSourceCommit':C,'originalSourceTree':T,'originalProductionForkTree':fork,'selectedOptionalForkCommit':supplier_commit,'selectedOptionalForkTree':supplier_tree,'nodeStarted':False,'carrierEnabled':False,'publicActivation':False}
    write(d/'composition/SOURCE-SELECTION.json',sel)
    source=dict(version='YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1',sourceCommit=C,sourceTree=T,productionForkTree=fork,optionalForkCommit=supplier_commit,optionalForkTree=supplier_tree,buildTags=['ynx_live_wire_observation'],sourceOnly=True,actualPreStartNodeGetter=True,nodeProcessesStarted=0,actualRunningWindow=False,carrierEnabled=False,publicActivation=False,preparedSourceSelection={'sourceSelection':sel,'receiptBytes':rec(d/'composition/SOURCE-SELECTION.json')['bytes'],'receiptSHA256':rec(d/'composition/SOURCE-SELECTION.json')['sha256']})
    for label,key,name in [('normal-live-caller','normalProducer','TestLive'),('original-peer-budget','originalSupplierBudget','TestBudget')]:
        out=d/(label+'.jsonl');pkg='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet' if key=='normalProducer' else 'github.com/cometbft/cometbft/mempool';out.write_text(''.join(json.dumps(e)+'\n' for e in [{'Package':pkg,'Action':'start'},{'Package':pkg,'Test':name,'Action':'run'},{'Package':pkg,'Test':name,'Action':'pass'},{'Package':pkg,'Action':'pass'}]))
        err=d/(label+'.stderr.log');err.write_text('')
        result=d/(label+'.result.json');write(result,dict(returnCode=0,timedOut=False,validationPassed=True,firstFailure=None,requiredPassed=[name],stdout=rec(out),stderr=rec(err)))
        source[key]=dict(**rec(out),stderr=rec(err),result=rec(result))
    write(d/'SOURCE.json',source)

class Controls(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.d=Path(self.t.name);fixture(self.d)
    def tearDown(self):self.t.cleanup()
    def run_qualify(self):return m.qualify(self.d,C,T,F,'123','1',['TestLive'],['TestBudget'])
    def test_valid_data_not_authority(self):
        q=self.run_qualify();self.assertFalse(q['authorityGranted']);self.assertFalse(q['publicActivation'])
    def test_each_fixed_fork_qualifies_only_its_original_supplier(self):
        for fork in (F, OLD_OBSERVER_FORK, PATCHED_FORK):
            with self.subTest(fork=fork):
                fixture(self.d, fork)
                result=m.qualify(self.d,C,T,fork,'123','1',['TestLive'],['TestBudget'])
                self.assertEqual((result['supplierCommit'],result['supplierForkTree']),m.SUPPLIER_BY_PRODUCTION[fork])
                self.assertFalse(result['authorityGranted'])
                self.assertFalse(result['independentFinality'])
    def test_crossed_or_unknown_fork_supplier_rejected_with_consistent_pins(self):
        old=(m.SUPPLIER_COMMIT,m.SUPPLIER_TREE)
        new=(m.PATCHED_SUPPLIER_COMMIT,m.PATCHED_SUPPLIER_TREE)
        for fork,supplier in ((F,new),(OLD_OBSERVER_FORK,new),(PATCHED_FORK,old),
                              (PATCHED_FORK,(new[0],old[1])),(PATCHED_FORK,(old[0],new[1])),
                              ('c'*40,old)):
            with self.subTest(fork=fork,supplier=supplier):
                fixture(self.d,fork,supplier)
                with self.assertRaises(RuntimeError):
                    m.qualify(self.d,C,T,fork,'123','1',['TestLive'],['TestBudget'])
    def test_mixed_selection_rejected_even_when_receipt_pin_is_updated(self):
        fixture(self.d,PATCHED_FORK)
        selection_path=self.d/'composition/SOURCE-SELECTION.json'
        selection=json.loads(selection_path.read_text())
        selection['selectedOptionalForkCommit']=m.SUPPLIER_COMMIT
        selection['selectedOptionalForkTree']=m.SUPPLIER_TREE
        write(selection_path,selection)
        source_path=self.d/'SOURCE.json';source=json.loads(source_path.read_text())
        source['preparedSourceSelection'].update(sourceSelection=selection,receiptBytes=rec(selection_path)['bytes'],receiptSHA256=rec(selection_path)['sha256'])
        write(source_path,source)
        with self.assertRaises(RuntimeError):
            m.qualify(self.d,C,T,PATCHED_FORK,'123','1',['TestLive'],['TestBudget'])
    def test_missing_each_file(self):
        for name in ['SOURCE.json','composition/SOURCE-SELECTION.json','normal-live-caller.jsonl','normal-live-caller.stderr.log','normal-live-caller.result.json','original-peer-budget.jsonl','original-peer-budget.stderr.log','original-peer-budget.result.json']:
            with self.subTest(name=name):
                path=self.d/name; raw=path.read_bytes(); path.unlink()
                with self.assertRaises((RuntimeError,KeyError)):self.run_qualify()
                path.write_bytes(raw)
    def test_modified_stream_rejected(self):
        (self.d/'normal-live-caller.jsonl').write_text('{"Test":"TestLive","Action":"skip"}\n')
        with self.assertRaises(RuntimeError):self.run_qualify()
    def test_bad_supplier_rejected(self):
        p=self.d/'SOURCE.json';s=json.loads(p.read_text());s['optionalForkCommit']='d'*40;write(p,s)
        with self.assertRaises(RuntimeError):self.run_qualify()
    def test_wrong_run_attempt_rejected(self):
        with self.assertRaises(RuntimeError):m.qualify(self.d,C,T,F,'123','2',['TestLive'],['TestBudget'])
    def test_skip_rejected_even_with_consistent_hashes(self):
        p=self.d/'normal-live-caller.jsonl';p.write_text('{"Package":"github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet","Test":"TestLive","Action":"skip"}\n{"Package":"github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet","Action":"pass"}\n')
        result=self.d/'normal-live-caller.result.json';r=json.loads(result.read_text());r['stdout']=rec(p);write(result,r)
        source=self.d/'SOURCE.json';s=json.loads(source.read_text());s['normalProducer'].update(rec(p));s['normalProducer']['result']=rec(result);write(source,s)
        with self.assertRaises(RuntimeError):self.run_qualify()
    def test_missing_run_foreign_or_outside_package_rejected_with_valid_pins(self):
        for kind in ('missing_run','foreign','outside','child_skip'):
            fixture(self.d)
            out=self.d/'normal-live-caller.jsonl'
            rows=[json.loads(line) for line in out.read_text().splitlines()]
            if kind=='missing_run': rows.pop(1)
            if kind=='foreign': rows[1]['Package']='other'
            if kind=='outside': rows.append(rows.pop(1))
            if kind=='child_skip': rows.insert(2,dict(Package=rows[0]['Package'],Test='TestLive/child',Action='skip'))
            out.write_text(''.join(json.dumps(row)+'\n' for row in rows))
            result=self.d/'normal-live-caller.result.json';r=json.loads(result.read_text());r['stdout']=rec(out);write(result,r)
            source=self.d/'SOURCE.json';v=json.loads(source.read_text());v['normalProducer'].update(rec(out));v['normalProducer']['result']=rec(result);write(source,v)
            with self.subTest(kind=kind), self.assertRaises(RuntimeError): self.run_qualify()
    def test_workflow_contract(self):
        workflow=(P.parents[1]/'.github/workflows/resource-market-ci.yml').read_text();job=workflow.split('  held-optional-live-source:\n',1)[1].split('  focused-go:\n',1)[0]
        for value in [m.PATCHED_SUPPLIER_COMMIT,m.PATCHED_SUPPLIER_TREE,'persist-credentials: false','Verify strict source availability','Acquire only the immutable optional supplier object','Verify exact optional live getter composition','Qualify complete original getter source','if-no-files-found: error','GETTER-QUALIFICATION.json']:
            self.assertIn(value,job)
        for name in ['wire-live-matching-source-ci.py','test_wire_live_matching_source_ci.py','qualify_held_optional_live_getter.py']:
            self.assertGreaterEqual(workflow.count("      - 'scripts/verify/"+name+"'"),2)
        self.assertIn("github.event_name == 'push'",job)
        self.assertNotIn('needs: contract-tooling-scope',job)

if __name__=='__main__':unittest.main()
