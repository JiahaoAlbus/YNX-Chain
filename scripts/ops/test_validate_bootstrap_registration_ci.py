"""Normal public plan/transition callers; no transport, key or service action."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODE = 'quiet-first-registration-v1'
ROLES = ('primary', 'singapore', 'silicon-valley', 'seoul')
def sha(b):
    return hashlib.sha256(b).hexdigest()
def raw(v):
    return json.dumps(v, separators=(',', ':')).encode()

class BootstrapRegistrationCallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ynx-quiet-public-')
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name).resolve()
        self.dir.chmod(0o700)
        self.seq = 0
        self.plan = dict(version='YNX-PRODUCTION-OPERATOR/v1', chainId='ynx_6423-1', validatorManifestSHA256='1'*64,
                         originalGenesisHash='2'*64, stateLayout='atomic-json', runtimePlan=None, runtimePlanHash='',
                         pqSchedule=None, pqScheduleHash='', roles=[dict(role=r, home='/srv/'+r+'/home', abciState='/srv/'+r+'/app/state',
                         legacyKeyPath='/srv/'+r+'/keys/pv', legacyStatePath='/srv/'+r+'/keys/hrs', nodeKeyPath='/srv/'+r+'/keys/node') for r in ROLES])
    def save(self, name, value):
        p=self.dir/name; p.parent.mkdir(parents=True, exist_ok=True)
        data=raw(value)
        with p.open('xb') as f:
            os.chmod(p,0o600); f.write(data)
        return p,sha(data)
    def continuation(self, before, after, accepted):
        self.seq+=1
        p,pp=self.save(f'p{self.seq}.json',dict(before,preparationOnly=True))
        data=b'PUBLIC synthetic original genesis bytes for projection only'
        after=dict(after,consensusGenesis=base64.b64encode(data).decode(),consensusGenesisSHA256=sha(data),migrationStateHash='3'*64)
        q,qp=self.save(f'q{self.seq}.json',after)
        result=subprocess.run(['node',str(ROOT/'scripts/verify/public-bft-candidate-binding.mjs'),'--operator-continuation',str(p),pp,str(q),qp],capture_output=True,timeout=15)
        self.assertEqual(result.returncode==0,accepted,result.stderr.decode())
        self.assertEqual(sha(p.read_bytes()),pp);self.assertEqual(sha(q.read_bytes()),qp)
    def test_pinned_quiet_preparation_preserves_mode(self):
        p=dict(self.plan,bootstrapRegistrationMode=MODE)
        self.continuation(p,p,True)
        self.continuation(self.plan,self.plan,True)
        for before,after in ((p,self.plan),(self.plan,p)):
            self.continuation(before,after,False)
    def test_invalid_or_halt_mode_is_refused(self):
        for mode in ('','unknown',True,None):
            p=dict(self.plan,bootstrapRegistrationMode=mode)
            self.continuation(p,p,False)
        p=dict(self.plan,bootstrapRegistrationMode=MODE,heightHaltSessionId='4'*64)
        self.continuation(p,p,False)
    def transition(self, oldmode, newmode, accepted, halt=False):
        self.seq+=1
        prefix=f't{self.seq}'
        old=copy.deepcopy(self.plan)
        old.update(consensusGenesis=base64.b64encode(b'public original').decode(),consensusGenesisSHA256='4'*64,migrationStateHash='5'*64)
        if oldmode is not None:old['bootstrapRegistrationMode']=oldmode
        if halt:
            old['heightHaltSessionId']='f'*64
            for r in old['roles']:r['heightHaltControlPath']=str(Path(r['abciState']).parent/('operator-height-halt-'+'f'*64+'.json'))
        new=copy.deepcopy(old);new.pop('bootstrapRegistrationMode',None);new.pop('heightHaltSessionId',None)
        for r in new['roles']:r.pop('heightHaltControlPath',None)
        if newmode is not None:new['bootstrapRegistrationMode']=newmode
        schedule=dict(registryHeight=10,registryRoot='6'*64,registryEventCount=4,authorizedAt=11,paramsUpdateHeight=11,validatorUpdateHeight=12,activationHeight=14)
        new.update(pqSchedule=base64.b64encode(raw(schedule)).decode(),pqScheduleHash='7'*64)
        op,oh=self.save(prefix+'/old/common/operator-plan.json',old)
        np,nh=self.save(prefix+'/new/common/operator-plan.json',new)
        names=('internal/consensus/pq_light_proof.go','cmd/ynx-consensus-proof-verify/main.go','cmd/ynx-consensus-proof-verify/trust.go','cmd/ynx-consensus-proof-verify/portable_import.go')
        src=dict(version='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v3',platform='linux/amd64',commit='8'*40,proofVerifierContract='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1',proofVerifierSources={n:dict(bytes=1,sha256='9'*64) for n in names},binaries={n:dict(sha256='a'*64) for n in ('ynx-comet','ynx-consensus-package','ynx-consensus-keycheck')})
        sp,sh=self.save(prefix+'/SOURCE.json',src)
        approval=dict(version='YNX-OPERATOR-TRANSITION-APPROVAL/v1',transitionId='public-quiet-fixture',phase='install',approved=True,oldOperatorPlanSHA256=oh,oldRuntimeCommit=src['commit'],oldRuntimeManifestSHA256=sh,nextOperatorPlanSHA256=nh,runtimeCommit=src['commit'],runtimeManifestSHA256=sh,cutoverTransactionId='public-fixture-original',freezeSHA256={r:'b'*64 for r in ROLES},nativePauseSHA256='c'*64,checkpoint=dict(height='10',appHash='d'*64,registryRoot='6'*64,registryEventCount='4'),backups={r:'e'*64 for r in ROLES})
        ap,ah=self.save(prefix+'/approval.json',approval)
        source=(ROOT/'scripts/ops/remote/public-bft-operator-transition.sh').read_text()
        marker='operator_transition_binding() {\n  python3 -B - "$@" <<\'PY\'\n'
        self.assertEqual(source.count(marker),1)
        body=source.split(marker,1)[1].split('\nPY\n}',1)[0]
        args=['install','public-quiet-fixture','primary',str(ap),ah,str(op.parent.parent),oh,str(sp),src['commit'],sh,str(np.parent.parent),nh,str(sp),src['commit'],sh]
        result=subprocess.run([sys.executable,'-B','-',*args],input=body.encode(),capture_output=True,timeout=10)
        self.assertEqual(result.returncode==0,accepted,result.stderr.decode())
        for p,h in ((op,oh),(np,nh),(ap,ah),(sp,sh)):self.assertEqual(sha(p.read_bytes()),h)
        if accepted:
            r=json.loads(result.stdout);self.assertEqual(r['quiesceMode'],'parallel-stop');self.assertEqual(r['checkpoint']['height'],'10')
    def test_same_version_quiet_to_pq_restores_normal(self):
        self.transition(MODE,None,True)
        self.transition(None,None,True)
        self.transition(MODE,MODE,False)
        self.transition('unknown',None,False)
        self.transition(MODE,None,False,halt=True)

class BootstrapRegistrationCIContractTests(unittest.TestCase):
    def test_existing_go_streams_and_exact_collector(self):
        workflow=(ROOT/'.github/workflows/resource-market-ci.yml').read_text()
        begin='          # BOOTSTRAP_QUIET_COLLECTOR_BEGIN\n';end='          # BOOTSTRAP_QUIET_COLLECTOR_END'
        self.assertEqual(workflow.count(begin),1)
        body=workflow.split(begin,1)[1].split(end,1)[0]
        body='\n'.join(line[10:] for line in body.splitlines())
        namespace={};exec(compile(body,'actual-workflow-collector','exec'),namespace)
        collect=namespace['qualify_bootstrap_quiet'];names=namespace['quiet_core_required']
        package='github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
        good=[dict(Package=package,Action='start')]
        for n in names:
            good.extend([dict(Package=package,Test=n,Action='run'),dict(Package=package,Test=n+'/actual',Action='run'),dict(Package=package,Test=n+'/actual',Action='pass'),dict(Package=package,Test=n,Action='pass')])
        good.append(dict(Package=package,Action='pass'))
        self.assertEqual(collect(good,package,names),names)
        cases=[]
        cases.append([e for e in good if e.get('Test')!=names[0]])
        cases.append(good+[copy.deepcopy(good[1])])
        foreign=copy.deepcopy(good);foreign[1]['Package']='foreign';cases.append(foreign)
        for action in ('fail','skip'):
            bad=copy.deepcopy(good);bad[3]['Action']=action;cases.append(bad)
        cases.append([e for e in good if e is not good[3]])
        cases.append(good[:-1]);cases.append(good+[dict(Package=package,Action='pass')])
        for bad in cases:
            with self.assertRaises(RuntimeError):collect(bad,package,names)
        for name in names:self.assertIn('func '+name+'(', (ROOT/'internal/consensus/production_operator_registration_test.go').read_text())
        for name in namespace['quiet_cli_required']:self.assertIn('func '+name+'(', (ROOT/'cmd/ynx-comet/bootstrap_registration_test.go').read_text())
        self.assertIn("-timeout=180s -run '^TestProduction' ./internal/consensus > \"$RUNNER_TEMP/ynx-production-operator-state-tests.jsonl\"", workflow)
        self.assertIn('go test -json -p 1 -count=1 -timeout=90s ./cmd/ynx-abci ./cmd/ynx-comet ',workflow)
        self.assertEqual(workflow.count('python3 -B scripts/ops/test_validate_bootstrap_registration_ci.py -v'),1)
        self.assertIn("- 'scripts/ops/test_validate_bootstrap_registration_ci.py'",workflow)

if __name__=='__main__':unittest.main()
