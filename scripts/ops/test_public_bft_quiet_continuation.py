#!/usr/bin/env python3
"""Pure public state-machine controls; no node, key or cryptographic fixture."""
import base64
import copy
import datetime
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('quiet', HERE / 'public-bft-quiet-continuation.py')
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)

def raw(value):
    return (json.dumps(value, separators=(',', ':')) + '\n').encode()

def write(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(raw(value))
    path.chmod(0o600)
    return q.sha(path.read_bytes())

class Fixture:
    def __init__(self, parent):
        self.parent = parent
        self.root = parent / 'transaction-original'
        self.root.mkdir(mode=0o700)
        self.genesis = dict(chain_id='ynx_6423-1', initial_height='100', syntheticOnly=True)
        self.plan = dict(version='YNX-PRODUCTION-OPERATOR/v1', chainId='ynx_6423-1', validatorManifestSHA256='a'*64,
                         consensusGenesis=base64.b64encode(raw(self.genesis)).decode(), consensusGenesisSHA256=q.sha(raw(self.genesis)),
                         originalGenesisHash='b'*64, migrationStateHash='c'*64, stateLayout='atomic-json', runtimePlan=None,
                         runtimePlanHash='', pqSchedule=None, pqScheduleHash='', bootstrapRegistrationMode=q.QUIET,
                         roles=[dict(role=r, home='/original/'+r, abciState='/original/'+r+'/app', legacyKeyPath='/original/'+r+'/ed',
                                     legacyStatePath='/original/'+r+'/hrs', nodeKeyPath='/original/'+r+'/node') for r in q.ROLES])
        self.plan_path = parent / 'bootstrap-plan.json'
        self.plan_pin = write(self.plan_path, self.plan)
        self.package = parent / 'bootstrap-package'
        self.runtime = parent / 'runtime'
        self.runtime.mkdir()
        self.source = dict(commit='d'*40, binaries={name:dict(sha256='e'*64) for name in ('ynx-comet','ynx-consensus-keycheck')})
        self.source_pin = write(self.runtime/'SOURCE.json',self.source)
        self.a = dict(approved=True,custodyProfile='single-app-gateway/v1',authoritativeCommit='f'*40,
                      operatorPreparationPlanSha256='2'*64,operatorPlanSha256=self.plan_pin,
                      expiresAt=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat())
        write(self.root/'approval.json',self.a)
        self.root.joinpath('continuation-attempt').mkdir()
        lines=[dict(phase=p,status=s,at='2026-01-01T00:00:00Z') for p,s in q.expected_prefix()]
        self.root.joinpath('journal.jsonl').write_bytes(b''.join(raw(v) for v in lines))
        self.evidence = self.root/'candidate/quiet-ready-attempt'
        self.evidence.mkdir(parents=True)
        self.nodes={r:dict(nodeId=str(i+1)*40,consensusAddress=str(i+1)*40,role=r) for i,r in enumerate(q.ROLES)}
        self.freeze={}
        for role in q.ROLES:
            write(self.package/'roles'/role/'role-manifest.json',dict(node=self.nodes[role]))
            self.freeze[role]=write(self.root/'candidate/start-attempt'/role/'marker.json',dict(transactionId=self.root.name,role=role,frozenAt='original'))
            write(self.evidence/(role+'.json'),self.observation(role))
        self.pause_pin=write(self.root/'candidate/start-attempt/primary/pause-marker.json',dict(transactionId=self.root.name,pausedAt='original'))

    def observation(self,role,height=100,block=None):
        return dict(version='YNX-PQ-CUTOVER-ROLE-OBSERVATION/v1',role=role,transactionId=self.root.name,
                    process=dict(mainPid='1001',startTicks='999',runningExecutableSHA256='e'*64,invocationId='f'*32),
                    status=dict(node_info=dict(network='ynx_6423-1',id=self.nodes[role]['nodeId']),
                                validator_info=dict(address=self.nodes[role]['consensusAddress']),
                                sync_info=dict(latest_block_height=str(height),catching_up=False)),
                    abciInfo=dict(response=dict(last_block_height=str(height),last_block_app_hash=base64.b64encode(b'h'*32).decode(),data='ynx-chain-abci')),
                    netInfo=dict(n_peers='3',peers=[dict(node_info=dict(id=self.nodes[r]['nodeId'])) for r in q.ROLES if r!=role]),
                    block=block,installedFilesVerified=True,originalFreezePreserved=True,originalNativePausePreserved=role=='primary',sourceReadOnly=True)

    def pause(self):
        q.ready(str(self.root),str(self.plan_path),self.plan_pin,str(self.package),str(self.evidence))
        return q.pause(str(self.root),str(self.plan_path),self.plan_pin)

    def transition(self, pause_first=True):
        if pause_first:self.pause()
        self.transition_root=self.parent/'transitions'/self.root.name
        self.transition_root.mkdir(mode=0o700,parents=True)
        schedule=dict(registryHeight=110,registryRoot='1'*64,registryEventCount=4,authorizedAt=111,paramsUpdateHeight=111,validatorUpdateHeight=112,activationHeight=114)
        self.schedule_raw=raw(schedule)
        self.current=copy.deepcopy(self.plan);self.current.pop('bootstrapRegistrationMode')
        self.current.update(pqSchedule=base64.b64encode(self.schedule_raw).decode(),pqScheduleHash='3'*64)
        self.current_package=self.parent/'pq-package'
        current_pin=write(self.current_package/'common/operator-plan.json',self.current)
        cp=dict(height='110',appHash='4'*64,registryRoot=schedule['registryRoot'],registryEventCount='4')
        a=dict(version='YNX-OPERATOR-TRANSITION-APPROVAL/v1',approved=True,phase='start',transitionId=self.root.name,
               cutoverTransactionId=self.root.name,oldOperatorPlanSHA256=self.plan_pin,nextOperatorPlanSHA256=current_pin,
               runtimeCommit='d'*40,runtimeManifestSHA256=self.source_pin,oldRuntimeCommit='d'*40,oldRuntimeManifestSHA256=self.source_pin,checkpoint=cp,freezeSHA256=self.freeze,
               nativePauseSHA256=self.pause_pin,backups={r:'5'*64 for r in q.ROLES})
        a_path=self.parent/'transition-approval.json';a_pin=write(a_path,a)
        proofs={}
        for role in q.ROLES:
            write(self.current_package/'roles'/role/'role-manifest.json',dict(node=self.nodes[role]))
            for phase,status in [('quiesce','stopped'),('install','installed_not_started'),('start','started_activation_unproven')]:
                entry=dict(version='YNX-OPERATOR-TRANSITION-RESULT/v1',role=role,phase=phase,status=status,transitionId=self.root.name,
                           cutoverTransactionId=self.root.name,oldOperatorPlanSHA256=self.plan_pin,nextOperatorPlanSHA256=current_pin,
                           originalMaterialRetained=True,pqActivationVerified=False,independentFinalityVerified=False,runtimeCommit='d'*40,runtimeManifestSHA256=self.source_pin,
                           checkpoint={**cp,'version':'YNX-OPERATOR-CHECKPOINT/v1','sourceReadOnly':True},backupSHA256='5'*64,approvalSHA256=a_pin,scheduleHash='3'*64,schedule=schedule,
                           freezeSHA256=self.freeze[role],nativePauseSHA256=self.pause_pin,cometSHA256='e'*64,
                           process=dict(mainPid='1001',startTicks='999',runningExecutableSHA256='e'*64))
                write(self.transition_root/(phase+'-attempt')/(role+'.result.json'),entry)
                if phase=='start':
                    binding={k:v for k,v in entry.items() if k not in ('status','process')};binding['version']='YNX-OPERATOR-TRANSITION-BINDING/v1';binding['checkpoint']=cp
                    write(self.transition_root/'start-attempt'/(role+'.binding.json'),binding)
            material=self.parent/'public'/role;material.mkdir(parents=True)
            (material/'schedule.json').write_bytes(self.schedule_raw)
            context={k:'' for k in q.CONTEXT_FIELDS}
            context.update(version='YNX-CONSENSUS-PROOF-TRUST/v1',chainId=self.current['chainId'],scheduleHash='3'*64,
                           consensusGenesisSHA256=self.current['consensusGenesisSHA256'],originalGenesisHash=self.current['originalGenesisHash'],
                           migrationStateHash=self.current['migrationStateHash'],runtimePlanHash='',scheduleFile=str(material/'schedule.json'),
                           expectedHeaderHeight='116',expectedBlockHash='6'*64,expectedStateHeight='115',expectedStateAppHash='7'*64,
                           engineHeight='116')
            context_path=material/'context.json';context_pin=write(context_path,context)
            request=dict(version='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1',expected=dict(chainId=self.current['chainId'],headerHeight='116',blockHash='6'*64,stateHeight='115',stateAppHash='7'*64),proof={'syntheticControlOnly':True})
            request_path=material/'request.json';request_pin=write(request_path,request)
            proofs[role]=dict(trustContext=str(context_path),trustContextSHA256=context_pin,request=str(request_path),requestSHA256=request_pin)
        self.packet=dict(version='YNX-QUIET-PQ-CONTINUATION-INPUT/v1',transactionId=self.root.name,bootstrapPlanSHA256=self.plan_pin,
                         transitionId=self.root.name,transitionRoot=str(self.transition_root),transitionApproval=str(a_path),transitionApprovalSHA256=a_pin,
                         currentPackage=str(self.current_package),currentOperatorPlanSHA256=current_pin,runtimeCommit='d'*40,
                         runtimeManifestSHA256=self.source_pin,proof=proofs['primary'])
        self.packet_path=self.parent/'continuation-input.json';self.packet_pin=write(self.packet_path,self.packet)

    def args(self):
        return str(self.root),str(self.plan_path),self.plan_pin,str(self.packet_path),self.packet_pin

    def verified_control(self, existing_attempt=False):
        if not existing_attempt:q.resume_check(*self.args())
        attempt=self.root/'pq-continuation-attempt';attempt.mkdir(mode=0o700,exist_ok=existing_attempt)
        if not existing_attempt:
            write(attempt/'intent.json',dict(inputSHA256=self.packet_pin))
            write(attempt/'input.json',self.packet)
        evidence=attempt/'evidence';evidence.mkdir()
        for role in q.ROLES:
            block=dict(block=dict(header=dict(height='116')),block_id=dict(hash='6'*64))
            write(evidence/(role+'.json'),self.observation(role,height=116,block=block))
            (evidence/(role+'.binding.json')).write_bytes((Path(self.packet['transitionRoot'])/'start-attempt'/(role+'.binding.json')).read_bytes())
            if role!='primary':continue
            (evidence/'light.proof-request.json').write_bytes(Path(self.packet['proof']['request']).read_bytes())
            result=dict(version='YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1',code='VERIFIED_DATA',result=dict(classification='data',chainId=self.current['chainId'],
                        version='YNX-PQ-LIGHT-PROOF/v1',authorityThroughHeight='116',trustedHeight='114',trustedBlockHash='8'*64,validatorsHash='9'*64,nextValidatorsHash='a'*64,consensusHash='b'*64,genesisSha256=self.current['consensusGenesisSHA256'],headerHeight='116',blockHash='6'*64,stateHeight='115',stateAppHash='7'*64,
                        commitVerified=True,lightTransitionVerified=True))
            write(evidence/'light.proof-result.json',result)
        return evidence

class QuietContinuationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.parent=Path(self.temp.name).resolve();self.f=Fixture(self.parent)
    def tearDown(self):
        self.temp.cleanup()
    def test_actual_pause_durable_and_lost_stdout_can_continue(self):
        self.f.transition()
        result=q.resume_check(*self.f.args())
        self.assertFalse(result['activationVerified'])
        self.assertEqual(json.loads((self.f.root/'continuation-attempt/result.json').read_bytes())['status'],'awaiting_pq_activation')
        self.assertFalse((self.f.root/'dependencies').exists());self.assertFalse((self.f.root/'ingress').exists())
        before=(self.f.root/'journal.jsonl').read_bytes()
        with self.assertRaises(ValueError):q.pause(str(self.f.root),str(self.f.plan_path),self.f.plan_pin)
        self.assertEqual((self.f.root/'journal.jsonl').read_bytes(),before)
    def test_resume_incomplete_unknown_and_late_residual_refused(self):
        self.f.transition()
        for name in ('pq-continuation-attempt','dependencies','ingress'):
            with self.subTest(name=name):
                target=self.f.root/name;target.mkdir()
                with self.assertRaises(ValueError):q.resume_check(*self.f.args())
                target.rmdir() # only this isolated synthetic negative fixture
        p=self.f.root/'journal.jsonl';before=p.read_bytes();p.write_bytes(before+raw(dict(phase='transaction',status='unknown',at='2026-01-01T00:00:00Z')))
        with self.assertRaises(ValueError):q.resume_check(*self.f.args())
    def test_changed_original_expiry_plan_context_and_receipt_refused(self):
        self.f.transition()
        changes=[(self.f.root/'approval.json',lambda v:v.update(expiresAt='2000-01-01T00:00:00Z')),
                 (self.f.current_package/'common/operator-plan.json',lambda v:v.update(bootstrapRegistrationMode=q.QUIET)),
                 (self.f.transition_root/'start-attempt/primary.result.json',lambda v:v.update(status='installed_not_started')),
                 (self.f.transition_root/'quiesce-attempt/primary.result.json',lambda v:v['checkpoint'].update(registryRoot='9'*64)),
                 (Path(self.f.packet['proof']['trustContext']),lambda v:v.update(expectedHeaderHeight='114')),
                 (self.f.root/'candidate/start-attempt/primary/marker.json',lambda v:v.update(frozenAt='replacement'))]
        for path,change in changes:
            with self.subTest(path=path.name):
                before=path.read_bytes();value=json.loads(before);change(value);write(path,value)
                with self.assertRaises(ValueError):q.resume_check(*self.f.args())
                path.write_bytes(before)
    def test_source_qualified_role_and_complete_proof_gate(self):
        self.f.transition();evidence=self.f.verified_control()
        with self.assertRaises(FileNotFoundError):q.forward_gate(str(self.f.root),str(self.f.plan_path),self.f.plan_pin)
        result=q.verify_results(*self.f.args(),str(evidence));self.assertTrue(result['pqCommitVerified']);self.assertFalse(result['authorityGranted'])
        q.forward_gate(str(self.f.root),str(self.f.plan_path),self.f.plan_pin)
        p=evidence/'light.proof-result.json';before=p.read_bytes();p.write_bytes(before+b' ')
        with self.assertRaises(ValueError):q.forward_gate(str(self.f.root),str(self.f.plan_path),self.f.plan_pin)
    def test_exit_zero_partial_rejected_proof_and_restart_do_not_qualify(self):
        self.f.transition();evidence=self.f.verified_control()
        for name,change in [
            ('light.proof-result.json',lambda v:v.update(code='PROOF_REJECTED')),
            ('light.proof-result.json',lambda v:v['result'].update(commitVerified=False)),
            ('light.proof-result.json',lambda v:v.pop('result')),
            ('light.proof-result.json',lambda v:v['result'].pop('validatorsHash')),
            ('primary.json',lambda v:v['process'].update(runningExecutableSHA256='0'*64)),
            ('primary.json',lambda v:v['block']['block_id'].update(hash='9'*64)),
        ]:
            with self.subTest(name=name,change=change):
                p=evidence/name;before=p.read_bytes();v=json.loads(before);change(v);write(p,v)
                with self.assertRaises((ValueError,KeyError)):q.verify_results(*self.f.args(),str(evidence))
                self.assertFalse((self.f.root/'pq-continuation-attempt/verified.json').exists());p.write_bytes(before)
    def test_forward_tail_requires_exact_original_journal_order(self):
        self.f.transition();evidence=self.f.verified_control();q.verify_results(*self.f.args(),str(evidence))
        args=(str(self.f.root),str(self.f.plan_path),self.f.plan_pin)
        with self.assertRaises(ValueError):q.forward_gate(*args,phase='start_dependencies')
        path=self.f.root/'journal.jsonl'
        prefix=path.read_bytes()
        tail=q.pairs(['verify_pq_continuation'])+[('start_dependencies','started')]
        path.write_bytes(prefix+b''.join(raw(dict(phase=p,status=s,at='2026-01-01T00:00:00Z')) for p,s in tail))
        q.forward_gate(*args,phase='start_dependencies')
        with self.assertRaises(ValueError):q.forward_gate(*args,phase='switch_ingress')
        with self.assertRaises(ValueError):q.forward_gate(*args,phase='verify_candidate')
    def test_recomputed_input_pin_does_not_allow_changed_authority_or_coordinates(self):
        self.f.transition()
        value=copy.deepcopy(self.f.packet);value['runtimeCommit']='d'*39
        self.f.packet_pin=write(self.f.packet_path,value)
        with self.assertRaises(ValueError):q.resume_check(*self.f.args())
        self.f.packet_pin=write(self.f.packet_path,self.f.packet)
        proof=self.f.packet['proof'];p=Path(proof['trustContext']);c=json.loads(p.read_bytes());c['expectedHeaderHeight']='0116'
        proof['trustContextSHA256']=write(p,c);self.f.packet_pin=write(self.f.packet_path,self.f.packet)
        with self.assertRaises(ValueError):q.resume_check(*self.f.args())
    def test_same_installed_source_normal_cold_restart_has_new_current_incarnation(self):
        self.f.transition();evidence=self.f.verified_control()
        p=evidence/'primary.json';v=json.loads(p.read_bytes());v['process'].update(mainPid='2002',startTicks='2000',invocationId='a'*32);write(p,v)
        result=q.verify_results(*self.f.args(),str(evidence))
        self.assertTrue(result['roles']['primary']['restartedSinceTransition'])
        self.assertEqual(result['roles']['primary']['originalStartProcess']['mainPid'],'1001')
        self.assertEqual(result['roles']['primary']['process']['mainPid'],'2002')
        self.assertFalse(result['authorityGranted'])
    def test_quiet_ready_never_claims_commit_and_requires_all_four(self):
        p=self.f.evidence/'seoul.json';v=json.loads(p.read_bytes());v['abciInfo']['response']['last_block_height']='101';write(p,v)
        with self.assertRaises(ValueError):q.ready(str(self.f.root),str(self.f.plan_path),self.f.plan_pin,str(self.f.package),str(self.f.evidence))
        self.assertFalse((self.f.root/'candidate/verify-result.json').exists())
    def test_normal_transaction_tail_is_not_initialization_replay(self):
        src=(HERE/'public-bft-cutover-transaction.sh').read_text()
        self.assertIn('continue-pq-native',src)
        tail=src.split('mutation_started=1\nif [[ "$mode" == continue-pq-native ]]',1)[1]
        branch=tail.split('else\n',1)[0]
        self.assertIn('run_phase verify_pq_continuation',branch)
        for p in q.BOOTSTRAP:self.assertNotIn('run_phase '+p,branch)
        self.assertIn('quiet bootstrap pauses',src)
        driver=(HERE/'public-bft-production-driver.sh').read_text()
        self.assertIn('quiet_forward_gate\n    return',driver)
        self.assertIn('verify_pq_continuation) verify_pq_continuation_phase',driver)
        self.assertIn('--trust-context-sha256 "$context_pin"',driver)
        self.assertNotIn('systemctl start',q.REMOTE_OBSERVE)
        self.assertNotIn('priv_validator_key',q.REMOTE_OBSERVE)

def normal_caller_fixture(action, root_path, plan_path):
    """Existing transaction check's DATA driver, never a node/proof verifier.

    The shell calls the real transaction and original approval validators;
    only the already-isolated remote driver boundary supplies these public
    state-machine fixtures. No production caller can select this code.
    """
    f=Fixture.__new__(Fixture)
    f.root=Path(root_path).resolve(strict=True)
    f.parent=f.root.parent/('quiet-control-'+f.root.name)
    f.plan_path=Path(plan_path).resolve(strict=True)
    f.plan=json.loads(f.plan_path.read_bytes());f.plan_pin=q.sha(f.plan_path.read_bytes())
    f.package=f.parent/'bootstrap-package';f.runtime=f.parent/'runtime'
    f.evidence=f.root/'candidate/quiet-ready-attempt'
    f.nodes={r:dict(nodeId=str(i+1)*40,consensusAddress=str(i+1)*40,role=r) for i,r in enumerate(q.ROLES)}
    if action=='ready':
        f.parent.mkdir(mode=0o700);f.runtime.mkdir();f.evidence.mkdir()
        f.source=dict(commit='d'*40,binaries={name:dict(sha256='e'*64) for name in ('ynx-comet','ynx-consensus-keycheck')})
        f.source_pin=write(f.runtime/'SOURCE.json',f.source);f.freeze={}
        for role in q.ROLES:
            write(f.package/'roles'/role/'role-manifest.json',dict(node=f.nodes[role]))
            f.freeze[role]=write(f.root/'candidate/start-attempt'/role/'marker.json',dict(transactionId=f.root.name,role=role,frozenAt='synthetic-control'))
            write(f.evidence/(role+'.json'),f.observation(role))
        f.pause_pin=write(f.root/'candidate/start-attempt/primary/pause-marker.json',dict(transactionId=f.root.name,pausedAt='synthetic-control'))
        q.ready(str(f.root),str(f.plan_path),f.plan_pin,str(f.package),str(f.evidence))
    else:
        f.source_pin=q.sha((f.runtime/'SOURCE.json').read_bytes())
        f.freeze={r:q.sha((f.root/'candidate/start-attempt'/r/'marker.json').read_bytes()) for r in q.ROLES}
        f.pause_pin=q.sha((f.root/'candidate/start-attempt/primary/pause-marker.json').read_bytes())
        if action=='transition':
            f.transition(pause_first=False)
            print(f.packet_path);print(f.packet_pin)
        elif action=='verify':
            f.packet_path=f.parent/'continuation-input.json';f.packet_pin=q.sha(f.packet_path.read_bytes())
            f.packet=json.loads(f.packet_path.read_bytes());f.current=json.loads((Path(f.packet['currentPackage'])/'common/operator-plan.json').read_bytes())
            evidence=f.verified_control(existing_attempt=True)
            q.verify_results(*f.args(),str(evidence))
        else:raise ValueError('unknown isolated driver action')

if __name__=='__main__':
    if len(sys.argv)==5 and sys.argv[1]=='--fixture':
        normal_caller_fixture(sys.argv[2],sys.argv[3],sys.argv[4])
    else:unittest.main()
