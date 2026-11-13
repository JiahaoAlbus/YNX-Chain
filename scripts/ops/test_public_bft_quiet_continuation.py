#!/usr/bin/env python3
"""Pure public state-machine controls; no node, key or cryptographic fixture."""
import base64
import copy
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import tarfile
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
    def test_metadata_only_inventory_keeps_original_remote_checks(self):
        # The Linux bridge returns public SOURCE/operator files, not a local
        # executable. Observation construction must still measure the actual
        # installed remote files and process, without opening an ELF on Mac.
        source_raw=(self.f.runtime/'SOURCE.json').read_bytes()
        self.f.transition()
        for package in (self.f.package,self.f.current_package):
            for role in q.ROLES:
                role_root=package/'roles'/role
                for name in ('scripts/start-operator.sh','systemd/ynx-consensus-operator-candidate.service','config/genesis.json'):
                    write(role_root/name,dict(syntheticPublicOnly=True,role=role,name=name))
        for packet in (False,True):
            package=self.f.current_package if packet else self.f.package
            for role in q.ROLES:
                with self.subTest(phase='pq' if packet else 'quiet',role=role):
                    command=q.observation_command(str(self.f.root),str(package),str(self.f.runtime),str(self.f.plan_path),self.f.plan_pin,role,
                        str(self.f.packet_path) if packet else None,self.f.packet_pin if packet else None)
                    argv=shlex.split(command)
                    self.assertEqual(argv[:10],['sudo','-n','/usr/bin/timeout','--signal=TERM','--kill-after=5','60','/usr/bin/env','-i','PATH=/usr/bin:/bin','/usr/bin/python3'])
                    self.assertEqual(argv[10:12],['-B','-c']);self.assertEqual(argv[12],q.REMOTE_OBSERVE)
                    value=q.decode(base64.b64decode(argv[13],validate=True))
                    self.assertEqual(value['role'],role)
                    self.assertEqual(value['headerHeight'],'116' if packet else None)
                    self.assertEqual(value['blockHash'],'6'*64 if packet else None)
                    self.assertEqual(value['cometSHA256'],self.f.source['binaries']['ynx-comet']['sha256'])
                    for binary in ('ynx-comet','ynx-consensus-keycheck'):
                        self.assertFalse((self.f.runtime/binary).exists())
                        self.assertEqual(value['files']['/var/lib/ynx-chain/consensus-candidate/bin/'+binary],self.f.source['binaries'][binary]['sha256'])
                    self.assertEqual(value['files']['/var/lib/ynx-chain/consensus-candidate/config/genesis.json'],q.sha((package/'roles'/role/'config/genesis.json').read_bytes()))
                    self.assertEqual(value['freezeSHA256'],self.f.freeze[role])
                    self.assertEqual(value['pauseSHA256'],self.f.pause_pin)
        self.assertEqual((self.f.runtime/'SOURCE.json').read_bytes(),source_raw)
        # The original checks are sent intact, not executed by this pure test.
        self.assertIn('check_files(); before=process()',q.REMOTE_OBSERVE)
        self.assertIn('check_files();after=process();assert before==after',q.REMOTE_OBSERVE)
    def proof_args(self,evidence):
        return subprocess.run([sys.executable,'-B',str(HERE/'public-bft-quiet-continuation.py'),'proof-args',
            '--transaction',str(self.f.root),'--plan',str(self.f.plan_path),'--plan-sha256',self.f.plan_pin,
            '--input',str(self.f.packet_path),'--input-sha256',self.f.packet_pin,'--evidence',str(evidence)],
            capture_output=True,timeout=10)
    def test_proof_arguments_keep_exact_public_originals_without_local_math(self):
        self.f.transition()
        proof=self.f.packet['proof'];context=Path(proof['trustContext']);request=Path(proof['request'])
        original_context=context.read_bytes();original_request=request.read_bytes()
        evidence=self.f.root/'public-proof-args';evidence.mkdir(mode=0o700)
        result=self.proof_args(evidence)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stderr,b'')
        retained=evidence/'light.proof-request.json'
        self.assertEqual(result.stdout.decode().splitlines(),[str(context),proof['trustContextSHA256'],str(retained),proof['requestSHA256']])
        self.assertEqual(retained.read_bytes(),original_request);self.assertEqual(retained.stat().st_mode&0o777,0o600)
        self.assertEqual(context.read_bytes(),original_context);self.assertEqual(request.read_bytes(),original_request)
        self.assertFalse((self.f.runtime/'ynx-consensus-proof-verify').exists())
        self.assertEqual({p.name for p in evidence.iterdir()},{'light.proof-request.json'})
        # A retained input is not a VERIFIED_DATA result. No proof math, new
        # clock, activation claim or continuation publication occurred here.
        self.assertFalse((self.f.root/'pq-continuation-attempt').exists())
        again=self.proof_args(evidence)
        self.assertNotEqual(again.returncode,0);self.assertEqual(again.stdout,b'')
        self.assertEqual(retained.read_bytes(),original_request)
    def test_proof_arguments_unknown_and_changed_original_refuse(self):
        self.f.transition()
        evidence=self.f.root/'public-proof-args';evidence.mkdir(mode=0o700)
        retained=evidence/'light.proof-request.json';retained.write_bytes(b'original partial UNKNOWN')
        failed=self.proof_args(evidence)
        self.assertNotEqual(failed.returncode,0);self.assertEqual(failed.stdout,b'')
        self.assertEqual(retained.read_bytes(),b'original partial UNKNOWN')
        clean=self.f.root/'other-public-proof-args';clean.mkdir(mode=0o700)
        request=Path(self.f.packet['proof']['request']);original=request.read_bytes();request.write_bytes(original+b' ')
        failed=self.proof_args(clean)
        self.assertNotEqual(failed.returncode,0);self.assertEqual(failed.stdout,b'')
        self.assertEqual(request.read_bytes(),original+b' ');self.assertEqual(list(clean.iterdir()),[])
        self.assertEqual(retained.read_bytes(),b'original partial UNKNOWN')
    def test_normal_transaction_tail_is_not_initialization_replay(self):
        src=(HERE/'public-bft-cutover-transaction.sh').read_text()
        self.assertIn('continue-pq-native',src)
        tail='run_phase verify_pq_continuation'+src.rsplit('if [[ "$mode" == continue-pq-native ]]; then\n  run_phase verify_pq_continuation',1)[1]
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


class OriginalLightCaptureTests(unittest.TestCase):
    """Synthetic public control objects only; never exporter/math/service success."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.parent=Path(self.temp.name).resolve();self.f=Fixture(self.parent);self.f.transition()
        f=self.f
        f.source['platform']='linux/amd64'
        f.source['binaries'].update({k:dict(sha256='e'*64) for k in ('ynx-consensus-package','ynx-consensus-pq-remote-signer')})
        f.source_pin=write(f.runtime/'SOURCE.json',f.source)
        f.current['heightHaltSessionId']='9'*64
        for r in f.current['roles']:
            r['heightHaltControlPath']=str(Path(r['abciState']).parent/('operator-height-halt-'+'9'*64+'.json'))
            r['hostBinding']=dict(SignerStatePath='/custody/'+r['role']+'/pq-hrs.json',Policy=dict(ChainID=f.current['chainId']))
            r['remoteSigner']='tcp://127.0.0.1:27900'
        planpin=write(f.current_package/'common/operator-plan.json',f.current)
        approval=json.loads(Path(f.packet['transitionApproval']).read_bytes())
        approval.update(nextOperatorPlanSHA256=planpin,runtimeManifestSHA256=f.source_pin,oldRuntimeManifestSHA256=f.source_pin)
        apin=write(Path(f.packet['transitionApproval']),approval)
        f.packet.update(currentOperatorPlanSHA256=planpin,runtimeManifestSHA256=f.source_pin,transitionApprovalSHA256=apin)
        for role in q.ROLES:
            for phase in ('quiesce','install','start'):
                p=f.transition_root/(phase+'-attempt')/(role+'.result.json');r=json.loads(p.read_bytes())
                r.update(nextOperatorPlanSHA256=planpin,runtimeManifestSHA256=f.source_pin,approvalSHA256=apin)
                write(p,r)
                if phase=='start':
                    binding={k:v for k,v in r.items() if k not in ('status','process')};binding.update(version='YNX-OPERATOR-TRANSITION-BINDING/v1',checkpoint=approval['checkpoint'])
                    write(f.transition_root/'start-attempt'/(role+'.binding.json'),binding)
        migration=b'{"syntheticPublicControl":true}\n'
        write(f.current_package/'roles/primary/config/bound-migration.json',dict(syntheticPublicControl=True))
        migration=(f.current_package/'roles/primary/config/bound-migration.json').read_bytes()
        r=f.current['roles'][0];config='/var/lib/ynx-chain/consensus-candidate/config/'
        self.source=dict(version='YNX-PQ-LIGHT-SOURCE-PLAN/v1',chainId=f.current['chainId'],headerHeight='116',
            migrationFile=config+'bound-migration.json',migrationSHA256=q.sha(migration),genesisFile=config+'genesis.json',
            consensusGenesisSHA256=f.current['consensusGenesisSHA256'],originalGenesisHash=f.current['originalGenesisHash'],migrationStateHash=f.current['migrationStateHash'],
            stateFile=r['abciState'],stateLayout=f.current['stateLayout'],cometDataDirectory=r['home']+'/data',
            signingStatePath=r['hostBinding']['SignerStatePath'],signingLockKind='pq-signer',scheduleFile=config+'pq-engine-schedule.json',
            scheduleHash=f.current['pqScheduleHash'],scheduleSHA256=q.sha(f.schedule_raw),runtimePlanFile='',runtimePlanHash='',runtimePlanSHA256='',
            engineHeight='116',engineAppHash='7'*64,trustedHeight='114',trustedBlockHash='8'*64,trustingPeriodNanoseconds='3600000000000',
            maxClockDriftNanoseconds='5000000000',trustLevelNumerator='1',trustLevelDenominator='3')
        self.source_path=self.parent/'source-plan.json';sourcepin=write(self.source_path,self.source)
        f.packet['proof']=dict(version=q.SOURCE_PROFILE,role='primary',sourcePlan=str(self.source_path),sourcePlanSHA256=sourcepin,
                              output='/var/tmp/ynx-public-light-'+f.root.name+'-primary/delivery')
        f.packet_pin=write(f.packet_path,f.packet)
        self.approval=dict(version='YNX-OPERATOR-LIGHT-CAPTURE-APPROVAL/v1',phase='capture',approved=True,transitionId=f.root.name,
            cutoverTransactionId=f.root.name,role='primary',operatorPlanSHA256=planpin,runtimeCommit=f.packet['runtimeCommit'],
            runtimeManifestSHA256=f.source_pin,inputSHA256=f.packet_pin,sourcePlanSHA256=sourcepin,output=f.packet['proof']['output'],
            expiresAt=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat(),captureSHA256=None)
        self.approval_path=self.parent/'capture-approval.json';self.approval_pin=write(self.approval_path,self.approval)
    def tearDown(self):self.temp.cleanup()
    def binding(self,phase='capture'):
        return q.capture_binding(*self.f.args(),str(self.approval_path),self.approval_pin,phase,str(self.f.runtime))
    def test_normal_source_plan_and_explicit_capture_binding(self):
        data=q.continuation(*self.f.args());self.assertEqual(data['stateHeight'],'115')
        b=self.binding();self.assertEqual(b['originalRole']['hostBinding']['SignerStatePath'],self.source['signingStatePath'])
        self.assertEqual(b['originalStartSHA256'],q.sha((self.f.transition_root/'start-attempt/primary.result.json').read_bytes()))
        command=[sys.executable,'-B',str(HERE/'public-bft-quiet-continuation.py'),'export-args','--transaction',str(self.f.root),
                 '--plan',str(self.f.plan_path),'--plan-sha256',self.f.plan_pin,'--input',str(self.f.packet_path),'--input-sha256',self.f.packet_pin]
        result=subprocess.run(command,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.splitlines(),[self.f.packet['proof'][k] for k in ('role','sourcePlan','sourcePlanSHA256','output')])
        self.assertFalse((self.f.transition_root/'capture-attempt').exists())
    def test_capture_source_scope_height_signer_and_expiry_refuse(self):
        original=copy.deepcopy(self.source)
        for key,value in [('headerHeight','114'),('engineHeight','115'),('signingStatePath','/original/primary/hrs'),
                          ('stateFile','/peer/private/app'),('scheduleSHA256','f'*64),('runtimePlanFile','/private/not-public')]:
            with self.subTest(key=key):
                self.source=copy.deepcopy(original);self.source[key]=value
                self.f.packet['proof']['sourcePlanSHA256']=write(self.source_path,self.source);self.f.packet_pin=write(self.f.packet_path,self.f.packet)
                with self.assertRaises(ValueError):q.continuation(*self.f.args())
        self.source=original;self.f.packet['proof']['sourcePlanSHA256']=write(self.source_path,self.source);self.f.packet_pin=write(self.f.packet_path,self.f.packet)
        for key,value in [('role','seoul'),('inputSHA256','f'*64),('runtimeCommit','f'*40),('approved',False),('expiresAt','2000-01-01T00:00:00Z')]:
            with self.subTest(key=key):
                a=copy.deepcopy(self.approval);a[key]=value;self.approval_pin=write(self.approval_path,a)
                with self.assertRaises(ValueError):self.binding()
    def test_source_profile_cannot_use_arbitrary_context_or_missing_capture(self):
        data=q.continuation(*self.f.args())
        private=self.parent/'private-key.json';private.write_text('NO_REAL_KEY');private.chmod(0o600)
        with self.assertRaises((ValueError,OSError)):q.received_source_proof(self.f.root,data,str(self.parent))
        self.assertEqual(private.read_text(),'NO_REAL_KEY')
        with self.assertRaises(ValueError):self.binding('resume')
    def public_capture(self):
        spec=importlib.util.spec_from_file_location('bridge_test',HERE/'public-bft-linux-public-tools.py')
        bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge);self.bridge=bridge
        f=self.f;d=q.continuation(*f.args());remote=f.packet['proof']['output']
        parent=self.parent/'external';parent.mkdir(mode=0o700);data_root=parent/f.root.name;data_root.mkdir(mode=0o700)
        work=data_root/'linux-public-tools';work.mkdir(mode=0o700);public=data_root/'public';public.mkdir(mode=0o700)
        delivery=public/'delivery';delivery.mkdir(mode=0o700)
        st=parent.stat();write(f.root/'linux-public-data-root.json',dict(version='YNX-PUBLIC-LINUX-DATA-ROOT/v1',transaction=str(f.root),parent=str(parent),parentDevice=str(st.st_dev),parentInode=str(st.st_ino),dataRoot=str(data_root)))
        context={k:'' for k in q.CONTEXT_FIELDS}
        context.update(version='YNX-CONSENSUS-PROOF-TRUST/v1',chainId=f.current['chainId'],scheduleHash=f.current['pqScheduleHash'],
            consensusGenesisSHA256=f.current['consensusGenesisSHA256'],originalGenesisHash=f.current['originalGenesisHash'],migrationStateHash=f.current['migrationStateHash'],
            engineHeight='116',engineAppHash='7'*64,expectedHeaderHeight='116',expectedBlockHash='6'*64,expectedStateHeight='115',expectedStateAppHash='7'*64,
            trustingPeriodNanoseconds=self.source['trustingPeriodNanoseconds'],maxClockDriftNanoseconds=self.source['maxClockDriftNanoseconds'],trustLevelNumerator='1',trustLevelDenominator='3')
        for role,name,field in bridge.LIGHT_NAMES:
            if role=='runtime':continue
            if field:context[field]=remote+'/'+name
            if role not in ('context','request'):write(delivery/name,dict(syntheticPublicControlOnly=True,role=role))
        context['trustedLightBlockSHA256']=q.sha((delivery/'trusted-light-block.json').read_bytes())
        verification=dict(version='YNX-PQ-LIGHT-PROOF/v1',classification='data',chainId=f.current['chainId'],genesisSha256=f.current['consensusGenesisSHA256'],
            authorityThroughHeight='116',trustedHeight='114',trustedBlockHash='8'*64,headerHeight='116',blockHash='6'*64,stateHeight='115',stateAppHash='7'*64,
            validatorsHash='9'*64,nextValidatorsHash='a'*64,consensusHash='b'*64,commitVerified=True,lightTransitionVerified=True)
        contextpin=write(delivery/'trust-context.json',context)
        requestpin=write(delivery/'request.json',dict(version='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1',expected=dict(chainId=f.current['chainId'],headerHeight='116',blockHash='6'*64,stateHeight='115',stateAppHash='7'*64),proof=dict(syntheticControlOnly=True)))
        entries=[dict(role=r,name=n,bytes=str((delivery/n).stat().st_size),sha256=q.sha((delivery/n).read_bytes())) for r,n,_ in bridge.LIGHT_NAMES if r!='runtime']
        deliverypin=write(delivery/'delivery.json',dict(version='YNX-PQ-LIGHT-SOURCE-DELIVERY/v1',planSHA256=f.packet['proof']['sourcePlanSHA256'],engineHeight='116',engineAppHash='7'*64,verification=verification,files=entries,publicDataOnly=True))
        export=dict(version='YNX-PQ-LIGHT-SOURCE-EXPORT/v1',planSHA256=f.packet['proof']['sourcePlanSHA256'],manifestPath=remote+'/delivery.json',manifestSHA256=deliverypin,
            contextPath=remote+'/trust-context.json',contextSHA256=contextpin,requestPath=remote+'/request.json',requestSHA256=requestpin,engineHeight='116',engineAppHash='7'*64,
            verification=verification,publicDataOnly=True,sourceReadOnly=True,nativeRootAuthorized=False,deploymentVerified=False)
        exportpin=write(public/'export-receipt.json',export);(public/'source-plan.json').write_bytes(self.source_path.read_bytes());(public/'source-plan.json').chmod(0o600)
        cap=dict(version='YNX-OPERATOR-LIGHT-CAPTURE-RESULT/v1',phase='capture',status='stopped_exported',transitionId=f.root.name,cutoverTransactionId=f.root.name,
            role='primary',runtimeCommit=f.packet['runtimeCommit'],runtimeManifestSHA256=f.source_pin,operatorPlanSHA256=f.packet['currentOperatorPlanSHA256'],
            inputSHA256=f.packet_pin,sourcePlanSHA256=f.packet['proof']['sourcePlanSHA256'],captureApprovalSHA256=self.approval_pin,engineHeight='116',engineAppHash='7'*64,
            headerHeight='116',stateHeight='115',captureRoot='/var/lib/ynx-chain/operator-transitions/'+f.root.name+'/primary/capture-attempt',output=remote,
            checkpointSHA256='c'*64,haltRequestSHA256='d'*64,signingStateIdentity={k:'1' for k in ('device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs')},
            exportReceiptSHA256=exportpin,deliverySHA256=deliverypin,originalMaterialRetained=True,sourceReadOnly=True,nativeRootAuthorized=False,deploymentVerified=False)
        cappin=write(f.transition_root/'capture-attempt/primary.result.json',cap);write(public/'capture-receipt.json',cap)
        resume=dict(cap,phase='resume',status='resumed_activation_unproven',captureSHA256=cappin,resumeApprovalSHA256='f'*64,currentProcess=dict(mainPid='200',startTicks='300'),signerProcess=dict(mainPid='201',startTicks='301'))
        write(f.transition_root/'resume-attempt/primary.result.json',resume)
        request=dict(version=bridge.VERSION,transaction=f.root.name,role='primary',runtime='/var/tmp/ynx-pq-runtime-original-primary-actual/verified',commit=f.packet['runtimeCommit'],sourceSHA256=f.source_pin,
            operation='light-files',arguments=dict(captureRoot=cap['captureRoot'],captureReceiptSHA256=cappin,sourcePlanSHA256=cap['sourcePlanSHA256']),inputs=[],phase='verify_pq_continuation',
            transportSources={n:dict(bytes=1,sha256='f'*64) for n in ('controller.py','runtime-validator.sh','exporter-validator.sh')},destination=str(public))
        reqraw=bridge.encode(request);reqsha=q.sha(reqraw);case=work/reqsha;case.mkdir(mode=0o700)
        (case/'request.json').write_bytes(reqraw);(case/'request.json').chmod(0o600)
        import shutil
        received=case/'received';received.mkdir(mode=0o700);shutil.copytree(public,received/'outputs')
        result=dict(version=bridge.VERSION,requestSHA256=reqsha,role='primary',commit=f.packet['runtimeCommit'],sourceSHA256=f.source_pin,operation='light-files',exitCode=0,
            outputs=bridge.catalog(received/'outputs'),sourceGrant=False,deployment=False,runtimeStarted=False,mathStartedUnixNanoseconds=None,mathFinishedUnixNanoseconds=None)
        # Match the final source helper clock schema, never drop unexpected stdout.
        resultpin=write(received/'RESULT.json',result)
        write(case/'PUBLISHED.json',dict(requestSHA256=reqsha,resultSHA256=resultpin,received='received',destination=str(public),exitCode=0,reconciled=False,mathReexecuted=False))
        return d,case,public,cap
    def test_actual_publication_contract_keeps_exact_bytes_and_explicit_resume(self):
        d,case,public,cap=self.public_capture()
        got=q.received_source_proof(self.f.root,d,str(case));self.assertEqual(got['context']['expectedHeaderHeight'],'116')
        self.assertEqual(got['proof']['requestSHA256'],q.sha((public/'delivery/request.json').read_bytes()))
        self.assertEqual(got['exportSelection']['directory'],str(case))
        self.assertFalse((self.f.root/'pq-continuation-attempt').exists())
        resume=self.f.transition_root/'resume-attempt/primary.result.json';old=resume.read_bytes();resume.unlink()
        with self.assertRaises(OSError):q.received_source_proof(self.f.root,d,str(case))
        resume.write_bytes(old);resume.chmod(0o600)
        (case/'PUBLISHED.json').unlink()
        with self.assertRaises(ValueError):q.received_source_proof(self.f.root,d,str(case))
    def test_capture_transport_source_role_or_public_bytes_change_refuses(self):
        d,case,public,cap=self.public_capture()
        material=public/'delivery/migration.json';before=material.read_bytes();material.write_bytes(b'changed')
        with self.assertRaises(ValueError):q.received_source_proof(self.f.root,d,str(case))
        material.write_bytes(before)
        capfile=self.f.transition_root/'capture-attempt/primary.result.json';cap['role']='seoul';write(capfile,cap)
        with self.assertRaises(ValueError):q.received_source_proof(self.f.root,d,str(case))
    def test_resume_requires_exact_cold_checkpoint_and_retains_unknown(self):
        b=self.binding();p=self.parent/'halt.json';p.write_bytes(b'ORIGINAL_PUBLIC_REQUEST');p.chmod(0o600)
        b['phase']='resume';b['heightHaltControlPath']=str(p)
        target=p.with_name(p.name+'.consumed-'+b['transitionId']);target.write_bytes(b'PRIOR_UNKNOWN')
        before=p.read_bytes()
        with self.assertRaises(ValueError):q.retain_consumed_halt(b,{},str(self.parent/'missing-checkpoint'))
        self.assertEqual(p.read_bytes(),before);self.assertEqual(target.read_bytes(),b'PRIOR_UNKNOWN')
    def test_normal_remote_scope_is_one_role_and_no_old_start_replay(self):
        script=(HERE/'remote/public-bft-operator-transition.sh').read_text();capture=script.split('operator_light_capture_remote() {',1)[1]
        self.assertEqual(capture.count('"$stage/bin/ynx-comet" export-light-source'),1)
        self.assertIn('operator_transition_wait_height_halt',capture)
        self.assertIn("q.retain_consumed_halt",capture)
        self.assertNotIn('operator_transition_publish',capture)
        self.assertNotIn('systemctl reset-failed',capture)
        self.assertNotIn('systemctl stop "$unit"',capture)
        self.assertIn('ExecMainStatus --value "$signer_unit")" == 0',capture)
        local=(HERE/'public-bft-operator-transition.sh').read_text().split('operator_light_capture_driver() {',1)[1]
        self.assertIn('[[ "$selected" == "$role" ]] || return 0',local)
        self.assertIn('public_bft_package_call',local);self.assertIn('public_bft_linux_stage "$role" "transition-$phase"',local)

    def test_normal_bridge_refuses_private_24field_context_before_any_material_read(self):
        from unittest import mock
        (self.parent/'legacy').mkdir(mode=0o700);f=Fixture(self.parent/'legacy');f.transition()
        proof=f.packet['proof'];context=json.loads(Path(proof['trustContext']).read_bytes())
        private=self.parent/'priv_validator_key.json';private.write_bytes(b'NO_REAL_PRIVATE_KEY');private.chmod(0o600)
        context['scheduleFile']=str(private);proof['trustContextSHA256']=write(Path(proof['trustContext']),context)
        f.packet_pin=write(f.packet_path,f.packet)
        reads=[];original=q.original
        def watched(path,*args,**kwargs):
            reads.append(str(path));return original(path,*args,**kwargs)
        with mock.patch.dict(os.environ,{'PUBLIC_BFT_LINUX_TOOL_ROLE':'primary'}),mock.patch.object(q,'original',side_effect=watched):
            with self.assertRaisesRegex(ValueError,'before material reads'):q.continuation(*f.args())
        self.assertNotIn(str(private),reads)
        self.assertEqual(private.read_bytes(),b'NO_REAL_PRIVATE_KEY')
    def cold_control(self):
        b=self.binding();attempt=self.parent/'capture';attempt.mkdir(mode=0o700)
        hrs=self.parent/'synthetic-HRS';hrs.write_bytes(b'NO_REAL_HRS');hrs.chmod(0o600)
        halt=self.parent/'halt-request.json';halt.write_bytes(b'ORIGINAL_PUBLIC_HALT');halt.chmod(0o600)
        (attempt/'halt-request.json').write_bytes(halt.read_bytes());(attempt/'halt-request.json').chmod(0o600)
        b['sourcePlan']['signingStatePath']=str(hrs);b['heightHaltControlPath']=str(halt)
        output=self.parent/'export';output.mkdir(mode=0o700);b['output']=str(output)
        s=b['sourcePlan'];cp=dict(version='YNX-OPERATOR-CHECKPOINT/v1',height='116',appHash='7'*64,
            committedScheduleHash=s['scheduleHash'],nextScheduleHash=None,readOnly=True,sourceReadOnly=True,
            writerExcluded=True,signingWriterExcluded=True,engineCheckpointVerified=True,pqActivationVerified=False,
            **{k:s[k] for k in ('chainId','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','stateLayout')})
        write(attempt/'checkpoint.json',cp);write(attempt/'checkpoint-after.json',cp)
        write(attempt/'signing-metadata.json',q.signing_metadata(str(hrs)))
        v=dict(classification='data',commitVerified=True,lightTransitionVerified=True,headerHeight='116',stateHeight='115')
        r=dict(version='YNX-PQ-LIGHT-SOURCE-EXPORT/v1',planSHA256=b['sourcePlanSHA256'],engineHeight='116',engineAppHash='7'*64,
               verification=v,publicDataOnly=True,sourceReadOnly=True,nativeRootAuthorized=False,deploymentVerified=False)
        for kind,name in (('manifest','delivery.json'),('context','trust-context.json'),('request','request.json')):
            r[kind+'Path']=str(output/name);r[kind+'SHA256']=write(output/name,dict(syntheticPublicControlOnly=True,name=name))
        write(attempt/'export-receipt.json',r)
        return b,attempt,hrs,halt
    def test_capture_uses_actual_original_checkpoint_and_signing_metadata(self):
        b,attempt,hrs,halt=self.cold_control();r=q.finish_capture(b,attempt)
        self.assertEqual(r['signingStateIdentity'],q.signing_metadata(str(hrs)))
        self.assertEqual(r['exportReceiptSHA256'],q.sha((attempt/'export-receipt.json').read_bytes()))
        self.assertFalse(r['nativeRootAuthorized']);self.assertFalse(r['deploymentVerified'])
        before=hrs.read_bytes();hrs.write_bytes(before+b'CHANGED')
        with self.assertRaisesRegex(ValueError,'signing metadata changed'):q.finish_capture(b,attempt)
        self.assertEqual(halt.read_bytes(),b'ORIGINAL_PUBLIC_HALT')
    def test_cold_resume_preserves_request_on_changed_state_and_uses_noreplace(self):
        b,attempt,hrs,halt=self.cold_control();capture=q.finish_capture(b,attempt);b['phase']='resume'
        checkpoint=attempt/'checkpoint-after.json';cp=json.loads(checkpoint.read_bytes());cp['appHash']='f'*64;write(checkpoint,cp)
        with self.assertRaises(ValueError):q.retain_consumed_halt(b,capture,str(checkpoint))
        self.assertEqual(halt.read_bytes(),b'ORIGINAL_PUBLIC_HALT')
        checkpoint.write_bytes((attempt/'checkpoint.json').read_bytes())
        if sys.platform.startswith('linux'):
            target=Path(q.retain_consumed_halt(b,capture,str(checkpoint)))
            self.assertFalse(halt.exists());self.assertEqual(target.read_bytes(),b'ORIGINAL_PUBLIC_HALT')
            with self.assertRaises(ValueError):q.retain_consumed_halt(b,capture,str(checkpoint))
            self.assertEqual(target.read_bytes(),b'ORIGINAL_PUBLIC_HALT')
        else:
            with self.assertRaisesRegex(ValueError,'Linux NOREPLACE'):q.retain_consumed_halt(b,capture,str(checkpoint))
            self.assertEqual(halt.read_bytes(),b'ORIGINAL_PUBLIC_HALT')

    def republish_control(self,case,public,cap,operation='light-files'):
        # Re-pin only synthetic public DATA so the path negative reaches the
        # real closed-path validator, not an earlier incidental hash failure.
        import shutil
        bridge=self.bridge;req=json.loads((case/'request.json').read_bytes())
        cappin=write(self.f.transition_root/'capture-attempt/primary.result.json',cap);write(public/'capture-receipt.json',cap)
        rp=self.f.transition_root/'resume-attempt/primary.result.json';resume=json.loads(rp.read_bytes())
        resume.update({k:v for k,v in cap.items() if k not in ('phase','status')});resume['captureSHA256']=cappin;write(rp,resume)
        req['operation']=operation;req['arguments']['captureReceiptSHA256']=cappin
        reqraw=bridge.encode(req);reqsha=q.sha(reqraw);new=case.with_name(reqsha)
        if new!=case:case.rename(new)
        case=new;(case/'request.json').write_bytes(reqraw)
        shutil.rmtree(case/'received/outputs');shutil.copytree(public,case/'received/outputs')
        result=json.loads((case/'received/RESULT.json').read_bytes());result.update(requestSHA256=reqsha,operation=operation,outputs=bridge.catalog(case/'received/outputs'))
        resultpin=write(case/'received/RESULT.json',result)
        published=json.loads((case/'PUBLISHED.json').read_bytes());published.update(requestSHA256=reqsha,resultSHA256=resultpin);write(case/'PUBLISHED.json',published)
        return case
    def test_metadata_capture_is_closed_without_moving_large_state(self):
        d,case,public,cap=self.public_capture()
        for name in ('migration.json','genesis.json','committed-state.json','schedule.json'):(public/'delivery'/name).unlink()
        case=self.republish_control(case,public,cap,'light-metadata')
        got=q.received_source_proof(self.f.root,d,str(case))
        self.assertEqual(got['stateHeight'],'115');self.assertFalse((public/'delivery/committed-state.json').exists())
        self.assertEqual(got['proof']['trustContextSHA256'],q.sha((public/'delivery/trust-context.json').read_bytes()))
    def test_recomputed_complete_metadata_private_context_rejected_before_read(self):
        from unittest import mock
        d,case,public,cap=self.public_capture();delivery=public/'delivery'
        private=self.parent/'private-key-not-proof.json';private.write_bytes(b'NO_REAL_KEY');private.chmod(0o600)
        context=json.loads((delivery/'trust-context.json').read_bytes());context['migrationFile']=str(private)
        contextpin=write(delivery/'trust-context.json',context)
        manifest=json.loads((delivery/'delivery.json').read_bytes())
        for item in manifest['files']:
            if item['name']=='trust-context.json':item.update(bytes=str((delivery/'trust-context.json').stat().st_size),sha256=contextpin)
        cap['deliverySHA256']=write(delivery/'delivery.json',manifest)
        export=json.loads((public/'export-receipt.json').read_bytes());export.update(manifestSHA256=cap['deliverySHA256'],contextSHA256=contextpin)
        cap['exportReceiptSHA256']=write(public/'export-receipt.json',export)
        case=self.republish_control(case,public,cap)
        original_open=os.open;seen=[]
        def guarded(path,*args,**kwargs):
            if str(path)==str(private):seen.append(path);raise AssertionError('private body was opened before closure')
            return original_open(path,*args,**kwargs)
        with mock.patch.object(os,'open',side_effect=guarded):
            with self.assertRaisesRegex(ValueError,'outside the actual original PUBLIC export'):q.received_source_proof(self.f.root,d,str(case))
        self.assertEqual(seen,[])

    def test_normal_cli_receives_only_completed_metadata_and_retains_request(self):
        d,case,public,cap=self.public_capture()
        for name in ('migration.json','genesis.json','committed-state.json','schedule.json'):(public/'delivery'/name).unlink()
        case=self.republish_control(case,public,cap,'light-metadata')
        attempt=self.f.root/'pq-continuation-attempt';attempt.mkdir(mode=0o700)
        evidence=attempt/'evidence';evidence.mkdir(mode=0o700)
        command=[sys.executable,'-B',str(HERE/'public-bft-quiet-continuation.py'),'proof-args','--transaction',str(self.f.root),
                 '--plan',str(self.f.plan_path),'--plan-sha256',self.f.plan_pin,'--input',str(self.f.packet_path),'--input-sha256',self.f.packet_pin,
                 '--export-receipt-dir',str(case),'--evidence',str(evidence)]
        env=dict(os.environ,PUBLIC_BFT_LINUX_TOOL_ROLE='primary')
        child=subprocess.run(command,capture_output=True,text=True,env=env,timeout=10)
        self.assertEqual(child.returncode,0,child.stderr);values=child.stdout.splitlines();self.assertEqual(len(values),4)
        self.assertEqual(Path(values[2]).read_bytes(),(public/'delivery/request.json').read_bytes())
        self.assertEqual(values[3],q.sha(Path(values[2]).read_bytes()))
        self.assertEqual(json.loads((attempt/'export-selection.json').read_bytes())['directory'],str(case))
        for role in q.ROLES:
            block=dict(block=dict(header=dict(height='116')),block_id=dict(hash='6'*64))
            write(evidence/(role+'.json'),self.f.observation(role,height=116,block=block))
            (evidence/(role+'.binding.json')).write_bytes((self.f.transition_root/'start-attempt'/(role+'.binding.json')).read_bytes())
        exported=json.loads((public/'export-receipt.json').read_bytes())
        write(evidence/'light.proof-result.json',dict(version='YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1',code='VERIFIED_DATA',result=exported['verification']))
        result=q.verify_results(*self.f.args(),str(evidence))
        self.assertEqual(result['stateHeight'],'115');self.assertFalse(result['authorityGranted'])
        saved=(evidence/'light.proof-request.json').read_bytes()
        child=subprocess.run(command,capture_output=True,text=True,env=env,timeout=10)
        self.assertNotEqual(child.returncode,0);self.assertEqual((evidence/'light.proof-request.json').read_bytes(),saved)

    def test_lost_ack_same_original_result_is_retained_without_reexecution(self):
        d,case,public,cap=self.public_capture();b=self.binding()
        binding=self.parent/'binding.json';write(binding,b)
        received=self.parent/'received.raw';received.write_bytes(raw(cap));received.chmod(0o600)
        target=self.parent/'completed.json'
        q.retain_capture_result(str(binding),str(received),str(target))
        st=target.stat();self.assertEqual(target.read_bytes(),received.read_bytes());self.assertEqual(st.st_mode&0o777,0o600)
        q.retain_capture_result(str(binding),str(received),str(target))
        self.assertEqual(target.stat().st_ino,st.st_ino)
        self.assertEqual(target.read_bytes(),received.read_bytes())
        different=dict(cap,checkpointSHA256='e'*64);write(received,different)
        with self.assertRaisesRegex(ValueError,'preserve UNKNOWN'):q.retain_capture_result(str(binding),str(received),str(target))
        self.assertEqual(target.read_bytes(),raw(cap))
        changed=dict(cap,runtimeCommit='f'*40);write(received,changed)
        with self.assertRaisesRegex(ValueError,'correlation changed'):q.retain_capture_result(str(binding),str(received),str(self.parent/'wrong-source.json'))
        self.assertFalse((self.parent/'wrong-source.json').exists())
        received.write_bytes(raw(cap)[:-3])
        with self.assertRaises(ValueError):q.retain_capture_result(str(binding),str(received),str(self.parent/'partial.json'))
        self.assertFalse((self.parent/'partial.json').exists());self.assertEqual(target.read_bytes(),raw(cap))
    def test_actual_remote_phase_projection_rechecks_approval_source_and_start(self):
        b=self.binding();binding=self.parent/'binding.json';write(binding,b)
        args=[str(binding),str(self.approval_path),str(self.f.runtime/'SOURCE.json'),str(self.f.current_package),
              str(self.source_path),str(self.f.transition_root/'start-attempt/primary.result.json'),str(self.f.root/'approval.json')]
        self.assertEqual(q.remote_capture_inputs(*args),b)
        before=Path(args[-2]).read_bytes();v=json.loads(before);v['role']='seoul';write(Path(args[-2]),v)
        with self.assertRaises(ValueError):q.remote_capture_inputs(*args)
        Path(args[-2]).write_bytes(before)
        old=self.source_path.read_bytes();self.source_path.write_bytes(old+b' ')
        with self.assertRaises(ValueError):q.remote_capture_inputs(*args)
        self.source_path.write_bytes(old)
        a=dict(self.approval,expiresAt='2000-01-01T00:00:00Z');b['expiresAt']=a['expiresAt'];b['approvalSHA256']=write(self.approval_path,a);write(binding,b)
        with self.assertRaisesRegex(ValueError,'expired'):q.remote_capture_inputs(*args)
        self.approval_pin=write(self.approval_path,self.approval);b['approvalSHA256']=self.approval_pin;b['expiresAt']=self.approval['expiresAt']
        cutover=dict(self.f.a,expiresAt='2000-01-01T00:00:00Z');b['cutoverApprovalSHA256']=write(self.f.root/'approval.json',cutover);b['cutoverExpiresAt']=cutover['expiresAt'];write(binding,b)
        with self.assertRaisesRegex(ValueError,'original cutover approval expired'):q.remote_capture_inputs(*args)
    def test_portable_local_fsync_and_readonly_reconcile_never_dispatch_math(self):
        file=self.parent/'durable.raw';file.write_bytes(b'ORIGINAL PUBLIC BYTES');file.chmod(0o600)
        env=dict(os.environ);env['PATH']=str(Path(sys.executable).parent)+os.pathsep+env['PATH']
        script=HERE/'public-bft-operator-transition.sh'
        result=subprocess.run(['bash','-c','source "$1"; operator_transition_sync "$2" "$3"','test',str(script),str(file),str(self.parent)],env=env,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(file.read_bytes(),b'ORIGINAL PUBLIC BYTES')
        link=self.parent/'alias';link.symlink_to(file)
        result=subprocess.run(['bash','-c','source "$1"; operator_transition_sync "$2"','test',str(script),str(link)],env=env,capture_output=True,timeout=10)
        self.assertNotEqual(result.returncode,0);self.assertEqual(file.read_bytes(),b'ORIGINAL PUBLIC BYTES')
        text=script.read_text();self.assertNotIn('sync -f',text)
        reconcile=text.split('operator_light_reconcile_driver() {',1)[1].split('if [[ "${BASH_SOURCE[0]}" == "$0" ]]',1)[0]
        for forbidden in ('systemctl','export-light-source','public_bft_package_call','public_bft_linux_tool','operator_light_capture_remote'):
            self.assertNotIn(forbidden,reconcile)
        self.assertIn('q.retain_capture_result',reconcile);self.assertIn('os.O_NOFOLLOW',reconcile)
        self.assertIn('phase-attempt/result.json',reconcile)

class TerminalIncarnationTests(unittest.TestCase):
    """Actual shell functions; synthetic systemd/proc only, never a service."""
    def run_control(self,case,helper=None,conditional=False):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name).resolve();root.chmod(0o700)
        process=root/'original-process.json';write(process,dict(mainPid='100',startTicks='200',runningExecutableSHA256='e'*64))
        script=r'''
set -Eeuo pipefail
source "$1"
attempt="$2";unit=ynx-consensus-operator-candidate.service;control="$3";conditional="${4:-0}";phase=running
systemctl() {
  [[ "$#" == 5 && "$1" == show && "$2" == --property && "$4" == --value && "$5" == "$unit" ]] || { printf 'unexpected systemctl action\n' >&2;return 90; }
  printf '%s\n' "$3" >>"$attempt/observed-properties"
  case "$3" in
    ActiveState) if [[ "$phase" == terminal && "$control" == failed-state ]];then echo failed;else [[ "$phase" == running ]] && echo active || echo inactive;fi ;;
    MainPID) [[ "$phase" == running ]] && echo 100 || echo 0 ;;
    ControlGroup) printf '\n' ;;
    ExecMainPID) if [[ "$phase" == terminal && "$control" == wrong-pid ]];then echo 300;else echo 100;fi ;;
    InvocationID) if [[ "$phase" == terminal && "$control" == wrong-invocation ]];then printf '22222222222222222222222222222222\n';elif [[ "$phase" == terminal && "$control" == empty-invocation ]];then printf '\n';else printf '11111111111111111111111111111111\n';fi ;;
    ExecMainStartTimestampMonotonic) if [[ "$phase" == terminal && "$control" == wrong-start ]];then echo 2010000;else echo 2000000;fi ;;
    Result) echo success ;;
    ExecMainCode) echo 1 ;;
    ExecMainStatus) [[ "$control" == failed-exit ]] && echo 1 || echo 0 ;;
    *) return 91 ;;
  esac
}
cat() {
  if [[ "$#" == 1 && "$1" == /proc/100/stat ]];then
    printf '100 (ynx-comet) S';for n in {1..18};do printf ' 0';done
    if [[ "$control" == wrong-live-ticks ]];then printf ' 201\n';else printf ' 200\n';fi
  else command cat "$@";fi
}
if [[ "$control" == preexisting ]];then printf 'PRIOR UNKNOWN\n' >"$attempt/halt-incarnation.json";fi
if declare -F operator_transition_record_halt_identity >/dev/null;then operator_transition_record_halt_identity;fi
phase=terminal
case "$control" in
 missing) rm "$attempt/halt-incarnation.json" ;;
 partial) printf '{"version":' >"$attempt/halt-incarnation.json" ;;
 changed-original) printf '{"mainPid":"100","startTicks":"201","runningExecutableSHA256":"changed"}' >"$attempt/original-process.json" ;;
esac
if [[ "$control" == stopped-initial-failure || "$control" == stopped-final-failure ]];then
  # Deliberate return-path fault injection only: no claimed real cgroup state.
  stopped_calls=0
  operator_transition_stopped() {
    stopped_calls=$((stopped_calls+1))
    if [[ "$control" == stopped-initial-failure && "$stopped_calls" == 1 ]] || [[ "$control" == stopped-final-failure && "$stopped_calls" == 2 ]];then
      printf 'SYNTHETIC_STOPPED_HELPER_FAILURE\n' >&2;return 73
    fi
    return 0
  }
fi
if [[ "$conditional" == 1 ]];then
  if operator_transition_wait_height_halt;then :;else status="$?";exit "$status";fi
else
  operator_transition_wait_height_halt
fi
printf 'ORIGINAL_TERMINAL_ACCEPTED\n'
'''
        env=dict(os.environ);env['PATH']=str(Path(sys.executable).parent)+os.pathsep+env['PATH']
        result=subprocess.run(['bash','-c',script,'terminal-control',str(helper or HERE/'remote/public-bft-operator-transition.sh'),str(root),case,'1' if conditional else '0'],env=env,capture_output=True,text=True,timeout=10)
        return result,root
    def test_original_incarnation_success_has_durable_prepublication_binding(self):
        r,root=self.run_control('same');self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout,'ORIGINAL_TERMINAL_ACCEPTED\n')
        v=json.loads((root/'halt-incarnation.json').read_bytes())
        self.assertEqual(set(v),{'version','mainPid','startTicks','invocationId','execMainStartTimestampMonotonic','originalProcessSHA256'})
        self.assertEqual(v['mainPid'],'100');self.assertEqual(v['startTicks'],'200')
        self.assertEqual(v['invocationId'],'1'*32);self.assertEqual(v['execMainStartTimestampMonotonic'],'2000000')
        self.assertEqual(v['originalProcessSHA256'],q.sha((root/'original-process.json').read_bytes()))
        self.assertEqual((root/'halt-incarnation.json').stat().st_mode&0o777,0o600)
        text=(HERE/'remote/public-bft-operator-transition.sh').read_text().split('operator_transition_request_height_halt() {',1)[1].split('operator_transition_wait_height_halt() {',1)[0]
        self.assertLess(text.index('operator_transition_record_halt_identity'),text.index('request-height-halt \\\n'))
    def test_other_terminal_and_partial_original_remain_unknown(self):
        for case in ('wrong-pid','wrong-start','wrong-invocation','empty-invocation','failed-exit','missing','partial','changed-original'):
            with self.subTest(case=case):
                r,root=self.run_control(case);self.assertNotEqual(r.returncode,0,r.stdout)
                self.assertNotIn('ORIGINAL_TERMINAL_ACCEPTED',r.stdout)
                if case in ('wrong-pid','wrong-start','wrong-invocation','empty-invocation'):self.assertIn('terminal incarnation differs',r.stderr)
                self.assertTrue((root/'original-process.json').exists())
                self.assertFalse((root/'result.json').exists())
    def test_prepublication_reused_pid_or_existing_attempt_never_rebinds(self):
        r,root=self.run_control('wrong-live-ticks');self.assertNotEqual(r.returncode,0)
        self.assertFalse((root/'halt-incarnation.json').exists());self.assertNotIn('ORIGINAL_TERMINAL_ACCEPTED',r.stdout)
        r,root=self.run_control('preexisting');self.assertNotEqual(r.returncode,0)
        self.assertEqual((root/'halt-incarnation.json').read_bytes(),b'PRIOR UNKNOWN\n')
        self.assertNotIn('ORIGINAL_TERMINAL_ACCEPTED',r.stdout)

    def test_conditional_wait_propagates_both_stopped_failures_and_terminal_guards(self):
        for case in ('stopped-initial-failure','stopped-final-failure','wrong-pid','wrong-invocation','wrong-start','failed-state','failed-exit'):
            with self.subTest(case=case):
                r,root=self.run_control(case,conditional=True)
                self.assertEqual(r.returncode,73 if case.startswith('stopped-') else 1,r.stdout+r.stderr)
                self.assertNotIn('ORIGINAL_TERMINAL_ACCEPTED',r.stdout)
                self.assertTrue((root/'halt-incarnation.json').exists());self.assertFalse((root/'result.json').exists())
                if case.startswith('stopped-'):self.assertIn('SYNTHETIC_STOPPED_HELPER_FAILURE',r.stderr)
        r,root=self.run_control('same',conditional=True);self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout,'ORIGINAL_TERMINAL_ACCEPTED\n')

class CaptureStageOwnershipTests(unittest.TestCase):
    """Original staging command, PUBLIC synthetic archive, no privilege/SSH.

    The sudo test double executes GNU tar with its documented superuser
    ownership default explicitly, since this suite also runs without root.
    All actual mkdir/tar/SHA/chmod operations stay in this test's directory.
    This is a caller regression, not evidence of a live host capture.
    """
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='quiet-stage-owner-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.tar=shutil.which('gtar') or shutil.which('tar')
        self.assertIsNotNone(self.tar,'normal GNU tar required by remote Linux control')
        version=subprocess.run([self.tar,'--version'],capture_output=True,text=True,timeout=5)
        self.assertEqual(version.returncode,0,version.stderr)
        self.assertIn('GNU tar',version.stdout)
        caller=(HERE/'public-bft-operator-transition.sh').read_text()
        body=caller.split('  capture_selected_role() {\n',1)[1].split('\n  }\n',1)[0]
        lines=[line for line in body.splitlines() if 'ynx_ops_ssh ' in line and 'sudo tar ' in line]
        self.assertEqual(len(lines),1,'one original fixed public stage extractor required')
        self.command=lines[0]
        # A different sender UID/GID represents a Darwin controller archive,
        # without any actual key/config/DB/runtime content or real username.
        self.sender_uid=os.geteuid()+10000;self.sender_gid=os.getegid()+10000
        self.payload={'binding.json':b'{"syntheticPublicOnly":true}\n',
                      'bin/ynx-comet':b'PUBLIC NONEXECUTABLE standin\n',
                      'source-plan.json':b'{"source":"PUBLIC fixture"}\n'}
        self.archive=self.root/'source.tar.gz'
        with tarfile.open(self.archive,'w:gz',format=tarfile.USTAR_FORMAT) as out:
            for name in ('.','./bin'):
                info=tarfile.TarInfo(name);info.type=tarfile.DIRTYPE;info.mode=0o700
                info.uid=self.sender_uid;info.gid=self.sender_gid;out.addfile(info)
            for name,body in self.payload.items():
                info=tarfile.TarInfo('./'+name);info.size=len(body);info.mode=0o600
                info.uid=self.sender_uid;info.gid=self.sender_gid;out.addfile(info,io.BytesIO(body))
        with tarfile.open(self.archive,'r:gz') as archive:
            members=archive.getmembers()
            self.assertEqual({m.uid for m in members},{self.sender_uid})
            self.assertEqual({m.gid for m in members},{self.sender_gid})
            self.assertEqual(members[0].name,'.')

    def stage(self,phase,pin=None):
        directory=self.root/phase;directory.mkdir(mode=0o700,exist_ok=True)
        destination=directory/'source'
        script=r'''set -Eeuo pipefail
role=primary;user=synthetic;host=synthetic.invalid;key=NOT_READ
upload="$1";extracted="$2";archive_pin="$3";phase_root="$4";test_tar="$5"
sudo() {
  if [[ "$1" == tar ]]; then
    shift
    case " $* " in
      *' --no-same-owner '*) "$test_tar" "$@" ;;
      *) "$test_tar" --same-owner "$@" ;;
    esac
  else command "$@"; fi
}
ynx_ops_ssh() {
  [[ "$#" == 5 && "$1" == primary && "$2" == synthetic && "$3" == synthetic.invalid && "$4" == NOT_READ ]]
  eval "$5"
}
'''+self.command+'\n'
        env=dict(os.environ,LC_ALL='C',LANG='C');env.pop('TAR_OPTIONS',None)
        result=subprocess.run(['bash','-c',script,'PUBLIC-stage-control',str(self.archive),str(destination),
            pin or q.sha(self.archive.read_bytes()),str(directory),self.tar],capture_output=True,text=True,env=env,timeout=10)
        return result,destination

    def test_capture_and_resume_preserve_receiver_owner_and_all_public_bytes(self):
        original=self.archive.read_bytes()
        for phase in ('capture','resume'):
            with self.subTest(phase=phase):
                result,destination=self.stage(phase)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                for path in [destination,destination/'bin',*[destination/name for name in self.payload]]:
                    st=path.lstat()
                    self.assertFalse(stat.S_ISLNK(st.st_mode))
                    self.assertEqual(st.st_uid,os.geteuid())
                    self.assertNotEqual(st.st_gid,self.sender_gid)
                    self.assertEqual(stat.S_IMODE(st.st_mode),0o700 if path.is_dir() else 0o600)
                for name,body in self.payload.items():self.assertEqual((destination/name).read_bytes(),body)
                self.assertEqual(self.archive.read_bytes(),original)
                # This remains a strict root-owned stage on the real root
                # receiver; no change to the production stage guard.
                remote=(HERE/'remote/public-bft-operator-transition.sh').read_text()
                self.assertIn('"$(stat -c %u:%a "$stage")" == 0:700',remote)

    def test_wrong_archive_pin_and_existing_stage_preserve_original_refusals(self):
        original=self.archive.read_bytes()
        result,destination=self.stage('bad-pin','f'*64)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(destination.exists())
        result,destination=self.stage('retained')
        self.assertEqual(result.returncode,0,result.stderr)
        marker=destination/'retained.UNKNOWN';marker.write_bytes(b'original UNKNOWN')
        result,same=self.stage('retained')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(same,destination)
        self.assertEqual(marker.read_bytes(),b'original UNKNOWN')
        self.assertEqual(self.archive.read_bytes(),original)
        for name,body in self.payload.items():self.assertEqual((destination/name).read_bytes(),body)

class NativeSnapshotStopTests(unittest.TestCase):
    """PUBLIC transport-state controls; actual approval validation is in the shell checker."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name).resolve();self.root=self.parent/'original-snapshot-transaction';self.root.mkdir(mode=0o700)
        self.prep=dict(custodyProfile=q.SAME_OWNER,preparationOnly=True,approved=True,transactionId=self.root.name,
                      commit='a'*12,release='ynx-bft-gateway-'+'a'*12,exporterManifestSha256='b'*64,
                      sameOwnerEvidence=dict(sourceCommit='a'*40),expiresAt=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat())
        write(self.root/'preparation-approval.json',self.prep)
        self.snap={**self.prep,'snapshotOnly':True,'snapshotSourceSha256':'c'*64};self.snap.pop('preparationOnly')
        write(self.root/'snapshot-approval.json',self.snap);write(self.root/'snapshot-approval.original.json',self.snap)
        write(self.root/'snapshot-export-attempt/intent.json',dict(status='unknown',automaticRetry=False))
        self.terminal=dict(transactionId=self.root.name,commit=self.prep['commit'],bftRelease=self.prep['release'],
                           snapshotSourceSha256='c'*64,exporterManifestSha256='b'*64,exporterCommit='a'*40,sha256='d'*64,
                           pauseVerified=True,mutationFreezeVerified=True,sourceUnchanged=True,validated=True,
                           reused=False,deployment=False,runtimeStarted=False)
        write(self.root/'final-snapshot/remote-evidence.json',self.terminal)
        self.lines=q.snapshot_prefix();self.save_journal(self.lines)
    def save_journal(self,lines):
        self.root.joinpath('journal.jsonl').write_bytes(b''.join(raw(dict(phase=p,status=s,at='2026-11-13T00:00:00Z')) for p,s in lines))
    def complete(self):return q.snapshot_complete(str(self.root))
    def final(self):
        a={**self.prep,'operatorPlanSha256':'e'*64,'snapshotSourceSha256':'c'*64};a.pop('preparationOnly');write(self.root/'approval.json',a)
    def test_durable_snapshot_stop_and_exact_prefix_survive_later_bootstrap(self):
        before=self.root.joinpath('journal.jsonl').read_bytes();result=self.complete()
        self.assertEqual(set(result),q.SNAPSHOT_FIELDS);self.assertEqual(result['journalSHA256'],q.sha(before))
        self.assertEqual(q.snapshot_record(self.root),result)
        self.assertEqual(q.native_boundary(str(self.root)),q.SAME_OWNER)
        self.final();prefix=q.expected_prefix(self.root);self.assertEqual(prefix,self.lines+q.pairs(q.BOOTSTRAP[1:]))
        self.save_journal(prefix+[('bootstrap','awaiting_pq_activation')]);self.assertEqual(q.snapshot_record(self.root),result)
        self.assertEqual(self.root.joinpath('journal.jsonl').read_bytes()[:len(before)],before)
        original=(self.root/'snapshot-export-attempt/result.json').read_bytes()
        with self.assertRaises((ValueError,FileExistsError)):self.complete()
        self.assertEqual((self.root/'snapshot-export-attempt/result.json').read_bytes(),original)
    def test_export_start_and_legacy_continuation_remain_disjoint(self):
        with self.assertRaises(ValueError):q.native_boundary(str(self.root),True)
        with self.assertRaises(FileNotFoundError):q.native_boundary(str(self.root))
        for name in ['snapshot-approval.json','snapshot-approval.original.json']:(self.root/name).unlink()
        shutil.rmtree(self.root/'snapshot-export-attempt');shutil.rmtree(self.root/'final-snapshot');self.save_journal(q.preparation_prefix())
        self.assertEqual(q.native_boundary(str(self.root),True),q.SAME_OWNER)
        with self.assertRaises(FileNotFoundError):q.native_boundary(str(self.root))
        legacy={**self.prep,'custodyProfile':'single-app-gateway/v1'};write(self.root/'preparation-approval.json',legacy)
        self.assertEqual(q.native_boundary(str(self.root)),'single-app-gateway/v1')
        with self.assertRaises(ValueError):q.native_boundary(str(self.root),True)
    def test_partial_unknown_and_wrong_terminal_never_publish_success(self):
        for key,val in [('transactionId','other-original'),('snapshotSourceSha256','e'*64),('exporterCommit','f'*40),('validated',False),('reused',True),('runtimeStarted',True)]:
            with self.subTest(key=key):
                write(self.root/'final-snapshot/remote-evidence.json',{**self.terminal,key:val})
                with self.assertRaises(ValueError):self.complete()
                self.assertFalse((self.root/'snapshot-export-attempt/result.json').exists())
        write(self.root/'final-snapshot/remote-evidence.json',self.terminal)
        for suffix in [b'{',raw(dict(phase='transaction',status='unknown',at='2026-11-13T00:00:00Z'))]:
            self.save_journal(self.lines);p=self.root/'journal.jsonl';p.write_bytes(p.read_bytes()+suffix)
            with self.assertRaises(ValueError):self.complete()
            self.assertFalse((self.root/'snapshot-export-attempt/result.json').exists())
    def test_receipt_original_raw_source_and_journal_cannot_be_rebound(self):
        self.complete()
        for name in ['preparation-approval.json','snapshot-approval.original.json','snapshot-approval.json','final-snapshot/remote-evidence.json']:
            with self.subTest(name=name):
                p=self.root/name;before=p.read_bytes();p.write_bytes(before+b' ')
                with self.assertRaises(ValueError):q.snapshot_record(self.root)
                self.assertEqual(p.read_bytes(),before+b' ');p.write_bytes(before)
        for name in ['snapshot-export-attempt/intent.json','snapshot-export-attempt/result.json']:
            p=self.root/name;before=p.read_bytes();value=json.loads(before);value['automaticRetry']=0;write(p,value)
            with self.assertRaises(ValueError):q.snapshot_record(self.root)
            p.write_bytes(before)
        p=self.root/'journal.jsonl';before=p.read_bytes();p.write_bytes(before.replace(b'00:00:00Z',b'00:00:01Z',1))
        with self.assertRaises(ValueError):q.snapshot_record(self.root)
        p.write_bytes(before);self.final();a=json.loads((self.root/'approval.json').read_bytes());a['snapshotSourceSha256']='f'*64;write(self.root/'approval.json',a)
        with self.assertRaises(ValueError):q.expected_prefix(self.root)
    def test_snapshot_completion_does_not_authorize_marker_alias_or_unknown(self):
        self.complete()
        marker=self.root/'retained.UNKNOWN';marker.write_bytes(b'original first cause')
        with self.assertRaises(ValueError):q.native_boundary(str(self.root))
        self.assertEqual(marker.read_bytes(),b'original first cause');marker.unlink()
        alias=self.root/'alias';alias.symlink_to(self.root/'snapshot-approval.json')
        with self.assertRaises(ValueError):q.native_boundary(str(self.root))
        alias.unlink();write(self.root/'continuation-attempt/intent.json',{'status':'unknown','automaticRetry':False})
        with self.assertRaises(ValueError):q.native_boundary(str(self.root))

if __name__=='__main__':
    if len(sys.argv)==5 and sys.argv[1]=='--fixture':
        normal_caller_fixture(sys.argv[2],sys.argv[3],sys.argv[4])
    else:unittest.main()
