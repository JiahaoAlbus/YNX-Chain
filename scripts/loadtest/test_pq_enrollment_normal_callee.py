"""Controlled transport/ABI tests. Synthetic Python helpers are NOT verifiers."""
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=module('pq-enrollment-normal-callee.py')
def raw(value):return json.dumps(value,separators=(',',':')).encode()
def b64(value):return base64.b64encode(value).decode()


class EnrollmentNormalCalleeControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
        self.case=self.root/'case';self.case.mkdir(mode=0o700)
        envelope=b'CONTROL envelope, not signed';wire=b'CONTROL native bytes, not signed'
        point=dict(chainId='ynx_control',headerHeight='5',blockHash='b'*64,stateHeight='4',stateAppHash='a'*64)
        funding=dict(block=point,successor=dict(point,headerHeight='6',stateHeight='5'),transactionType='pq_transfer',
            envelope=b64(envelope),nativeWire=b64(wire),transactionHash=m.b.sha(envelope),nativeWireHash=m.b.sha(wire),index='0')
        migration=dict(copy.deepcopy(funding),transactionType='account_migration',index='1')
        trust=dict(consensusGenesisSHA256='e'*64,engineHeight='6',trustingPeriodNanoseconds='3600000000000')
        self.fixture=dict(version='YNX-PQ-ENROLLMENT-PUBLIC-FIXTURE/v1',syntheticOnly=True,
            materials={name:b64(b'CONTROL '+name.encode()) for name in ('funding.tx','migration.tx','genesis.json','migration.json','schedule.json','state.json','trusted.json')},
            trust=trust,pins=dict(fundingSource='UNIT-OWNER'),fundingExpected=funding,migrationExpected=migration,
            fundingProof={'CONTROL':'not a proof'},migrationProof={'CONTROL':'not a proof'})
        for name,data in self.fixture['materials'].items():self.write(self.case/name,base64.b64decode(data))
        self.context=dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-TRUST/v1',lightTrust=dict(trust),pins=self.fixture['pins'],
            fundingExpected=funding,migrationExpected=migration,fundingOriginalFile=str(self.case/'funding.tx'),migrationOriginalFile=str(self.case/'migration.tx'))
        for key,name in [('migrationFile','migration.json'),('genesisFile','genesis.json'),('stateFile','state.json'),('scheduleFile','schedule.json'),('trustedLightBlockFile','trusted.json')]:
            self.context['lightTrust'][key]=str(self.case/name)
        self.write(self.case/'context.json',raw(self.context))
        self.request=raw(dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-REQUEST/v1',fundingProof=self.fixture['fundingProof'],migrationProof=self.fixture['migrationProof']))
        self.write(self.case/'request.json',self.request);self.fixture_path=self.root/'fixture.json';self.write(self.fixture_path,raw(self.fixture))
        self.result=dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-RESULT/v1',code='VERIFIED_HISTORICAL_DATA',
            operationIdentity='UNKNOWN',currentEligibility='UNKNOWN',nativeGrant=False,
            result=dict(classification='data',currentEligibility='UNKNOWN',nativeGrant=False))
        for role in ('funding','migration'):
            target=self.context[role+'Expected'];tx=dict(version='YNX-PQ-TRANSACTION-PROOF/v1',classification='data',
                transactionType=target['transactionType'],transactionHash=target['transactionHash'],nativeWireHash=target['nativeWireHash'],
                height='5',index=target['index'],total='2',executionCode='0',gasWanted='0',gasUsed='1',executionData='',
                included=True,finalized=True,executionSuccessful=True,outcome='succeeded',nativeGrant=False)
            for key in ('block','successor'):
                tx[key]=dict(target[key],version='YNX-PQ-LIGHT-PROOF/v1',classification='data',genesisSha256='e'*64,
                    authorityThroughHeight='6',trustedHeight='3',trustedBlockHash='c'*64,validatorsHash='d'*64,
                    nextValidatorsHash='d'*64,consensusHash='f'*64,commitVerified=True,lightTransitionVerified=True)
            self.result['result'][role]=tx
        self.binary=self.script('import sys\nsys.stdin.buffer.read()\nsys.stdout.buffer.write('+repr(raw(self.result))+')\n')
    def write(self,path,data):path.write_bytes(data);path.chmod(0o600)
    def script(self,body):
        path=self.root/('helper-%d'%len(list(self.root.glob('helper-*'))));path.write_text('#!'+sys.executable+'\n'+body);path.chmod(0o700);return path
    def arguments(self):
        return dict(scope='public-synthetic-offline',enabled=True,source=m.CORE,chain_ci=m.CHAIN_CI,binary=self.binary,
            fixture=self.fixture_path,fixture_sha256=m.b.sha(self.fixture_path.read_bytes()),case_directory=self.case,
            context_sha256=m.b.sha((self.case/'context.json').read_bytes()),request_sha256=m.b.sha(self.request),output=self.root/'evidence',timeout=2)
    def admitted_control(self,**changes):
        args=self.arguments();args.update(changes)
        with mock.patch.object(m,'PUBLIC_FIXTURES',frozenset((m.b.sha(self.fixture_path.read_bytes()),))), \
             mock.patch.dict(m.PUBLIC_BINARIES,{(m.platform.system(),m.platform.machine()):m.b.sha(self.binary.read_bytes())}):
            return m.verify_enrollment(**args)

    def test_production_default_missing_qualification_is_unknown_before_io_or_process(self):
        with mock.patch.object(m,'read',side_effect=AssertionError('closed before reads')),mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('closed before processes')):
            with self.assertRaises(ValueError):m.verify_enrollment()
            result=m.verify_enrollment(enabled=True,source=m.CORE,chain_ci=m.CHAIN_CI,binary='/pretend')
        self.assertEqual(result['status'],'UNKNOWN');self.assertFalse(result['normalVerifierInvoked'])
        self.assertIsNone(m.b.NORMAL_ENROLLMENT_CALLEE)

    def test_source_ci_fixture_and_binary_must_all_match_before_spawn(self):
        for changes in ({'source':'a'*40},{'chain_ci':True},{'chain_ci':m.CHAIN_CI+1},{'fixture_sha256':'a'*64}):
            with self.subTest(changes=changes),mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('no process')):
                with self.assertRaises(ValueError):self.admitted_control(**changes)
        with mock.patch.object(m,'PUBLIC_FIXTURES',frozenset((m.b.sha(self.fixture_path.read_bytes()),))),mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('no process')):
            with self.assertRaisesRegex(ValueError,'binary differs'):m.verify_enrollment(**self.arguments())

    def test_real_helper_transport_preserves_raw_bytes_and_never_grants_authority(self):
        before={p.name:p.read_bytes() for p in self.case.iterdir()};result=self.admitted_control()
        self.assertTrue(result['normalVerifierInvoked']);self.assertTrue(result['process']['processReaped'])
        self.assertTrue(result['historicalCryptographicVerificationObserved']) # injected CONTROL registry, not real proof evidence
        self.assertEqual(result['historicalProofStatus'],'DATA');self.assertEqual(result['status'],'UNKNOWN')
        for key in ('nativeGrant','nonceReleased','resigningAllowed','automaticRetry','accountAdmissionAllowed'):
            self.assertIs(result[key],False)
        self.assertEqual(result['operationIdentity'],result['currentEligibility']);self.assertEqual(result['operationIdentity'],'UNKNOWN')
        self.assertEqual((self.root/'evidence/stdout.log').read_bytes(),raw(self.result))
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.case.iterdir()})
        with self.assertRaises(ValueError):self.admitted_control() # no reuse/retry of original output

    def test_proof_request_context_material_changes_fail_before_callee(self):
        context_pin=m.b.sha((self.case/'context.json').read_bytes())
        for path in (self.case/'request.json',self.case/'context.json',self.case/'trusted.json'):
            original=path.read_bytes();self.write(path,original+b' ')
            with self.subTest(path=path.name),mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('no process')):
                with self.assertRaises(ValueError):self.admitted_control(context_sha256=context_pin)
            self.write(path,original)

    def test_missing_original_material_is_unknown_before_any_process(self):
        args=self.arguments();path=self.case/'trusted.json';path.unlink()
        with mock.patch.object(m,'PUBLIC_FIXTURES',frozenset((args['fixture_sha256'],))),mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('no process')):
            result=m.verify_enrollment(**args)
        self.assertEqual(result['status'],'UNKNOWN');self.assertFalse(result['normalVerifierInvoked'])
        self.assertEqual(result['missingEvidence'],['originalPublicMaterial:trusted.json']);self.assertFalse(path.exists())

    def test_normal_rejection_keeps_exact_failure_stage_and_never_becomes_success(self):
        for stage in sorted(m.PROOF_STAGES):
            rejected=dict(version=self.result['version'],code='PROOF_REJECTED',error=stage+': original bounded failure',
                          operationIdentity='UNKNOWN',currentEligibility='UNKNOWN',nativeGrant=False)
            result=m.classify_result(raw(rejected),1,self.context)
            self.assertEqual(result['classification'],'REJECTED');self.assertEqual(result['proofFailureStage'],stage)
            with self.assertRaises(ValueError):m.classify_result(raw(rejected),0,self.context)
        with self.assertRaises(ValueError):m.classify_result(raw(self.result),1,self.context)

    def test_duplicate_nan_coerced_exit_extra_and_granted_outputs_are_rejected(self):
        valid=raw(self.result)
        for bad in (valid[:-1]+b',"code":"VERIFIED_HISTORICAL_DATA"}',valid.replace(b'"nativeGrant":false',b'"nativeGrant":NaN',1)):
            with self.assertRaises(ValueError):m.classify_result(bad,0,self.context)
        for key,value in (('nativeGrant',True),('operationIdentity','VERIFIED'),('currentEligibility','ELIGIBLE'),('extra',False)):
            changed=copy.deepcopy(self.result);changed[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.classify_result(raw(changed),0,self.context)
        with self.assertRaises(ValueError):m.classify_result(valid,False,self.context)

    def test_each_role_header_wire_execution_and_denominator_are_bound(self):
        for role in ('funding','migration'):
            for key,value in (('transactionHash','a'*64),('nativeWireHash','a'*64),('executionSuccessful',False),('executionCode','1'),('index',0),('total','0'),('finalized',1)):
                changed=copy.deepcopy(self.result);changed['result'][role][key]=value
                with self.subTest(role=role,key=key),self.assertRaises(ValueError):m.classify_result(raw(changed),0,self.context)
            for key,value in (('chainId','different'),('headerHeight','05'),('commitVerified',1),('stateAppHash','d'*64)):
                changed=copy.deepcopy(self.result);changed['result'][role]['successor'][key]=value
                with self.subTest(role=role,header=key),self.assertRaises(ValueError):m.classify_result(raw(changed),0,self.context)

    def test_timeout_and_output_overflow_are_retained_unknown_and_exact_child_reaped(self):
        for code,cause,timeout in [('import time\ntime.sleep(3)\n','TimeoutError',0.1),
                                  ('import os\nos.write(1,b"x"*(2<<20))\n','ValueError',2)]:
            binary=self.script(code);out=self.root/('raw-'+cause)
            with m.held(binary,1<<20,executable=True) as (_,fd):
                start=time.monotonic();result=m._invoke(binary,fd,self.case/'context.json','a'*64,b'{}',out,timeout)
            self.assertLess(time.monotonic()-start,2);self.assertTrue(result['processReaped']);self.assertFalse(result['cleanupDebt'])
            self.assertEqual(result['firstCause']['type'],cause);self.assertFalse(result['outputComplete'])
            self.assertLessEqual((out/'stdout.log').stat().st_size,m.RESULT_LIMIT)

    def test_cancellation_before_and_during_original_process_never_retries(self):
        stop=threading.Event();stop.set()
        with mock.patch.object(m,'read',side_effect=AssertionError('cancel before IO')),mock.patch.object(m.subprocess,'Popen',side_effect=AssertionError('no process')):
            result=m.verify_enrollment(scope='public-synthetic-offline',enabled=True,stop=stop)
        self.assertEqual(result['status'],'UNKNOWN');self.assertFalse(result['normalVerifierInvoked'])
        stop.clear();binary=self.script('import time\ntime.sleep(3)\n')
        timer=threading.Timer(0.05,stop.set);timer.start()
        try:
            with m.held(binary,1<<20,executable=True) as (_,fd):
                result=m._invoke(binary,fd,self.case/'context.json','a'*64,b'{}',self.root/'cancel',2,stop)
        finally:timer.join(timeout=1)
        self.assertTrue(result['processReaped']);self.assertFalse(result['cleanupDebt'])
        self.assertEqual(result['firstCause']['type'],'InterruptedError');self.assertFalse(result['outputComplete'])

    def test_early_stdin_close_retains_original_nonzero_reply(self):
        rejected=dict(version=self.result['version'],code='INVALID_REQUEST',error='exact enrollment proof request required',
                      operationIdentity='UNKNOWN',currentEligibility='UNKNOWN',nativeGrant=False)
        binary=self.script('import os,sys\nos.close(0)\nsys.stdout.buffer.write('+repr(raw(rejected))+')\nsys.exit(1)\n')
        with m.held(binary,1<<20,executable=True) as (_,fd):
            result=m._invoke(binary,fd,self.case/'context.json','a'*64,b'x'*(2<<20),self.root/'early',2)
        self.assertEqual(result['returnCode'],1);self.assertTrue(result['processReaped']);self.assertTrue(result['requestPipeClosedEarly'])
        self.assertEqual(result['stdout'],raw(rejected));self.assertEqual(m.classify_result(result['stdout'],1,self.context)['classification'],'REJECTED')

    def test_failed_original_retention_is_not_complete_and_preserves_prior_timeout(self):
        for timeout in (False,True):
            binary=self.script('import time\ntime.sleep(3)\n') if timeout else self.binary
            with m.held(binary,1<<20,executable=True) as (_,fd),mock.patch.object(m.os,'fsync',side_effect=OSError('CONTROL fsync failed')):
                result=m._invoke(binary,fd,self.case/'context.json','a'*64,b'{}',self.root/('retention-'+str(timeout)),0.1 if timeout else 2)
            self.assertTrue(result['processReaped']);self.assertFalse(result['originalOutputRetained'])
            self.assertTrue(result['retentionErrors']);self.assertEqual(result['firstCause']['type'],'TimeoutError' if timeout else 'OSError')

    def test_post_call_material_change_and_stderr_preserve_unknown(self):
        for mode in ('changed','stderr'):
            if mode=='changed':
                suffix='\nopen('+repr(str(self.case/'state.json'))+',"ab").write(b"changed")\n'
            else:suffix='\nsys.stderr.write("CONTROL diagnostic")\n'
            self.binary=self.script('import sys\nsys.stdin.buffer.read()\nsys.stdout.buffer.write('+repr(raw(self.result))+')'+suffix)
            result=self.admitted_control(output=self.root/mode)
            self.assertEqual(result['historicalProofStatus'],'UNKNOWN');self.assertFalse(result['historicalCryptographicVerificationObserved'])
            self.assertIsNotNone(result['process']['firstCause']);self.assertEqual((self.root/mode/'stdout.log').read_bytes(),raw(self.result))
            self.write(self.case/'state.json',base64.b64decode(self.fixture['materials']['state.json']))

    def test_path_aliases_and_mutation_are_not_original_bytes(self):
        alias=self.root/'alias';alias.symlink_to(self.case,target_is_directory=True)
        with self.assertRaises(OSError):m.read(alias/'context.json',1<<20)
        path=self.case/'request.json';linked=self.case/'linked';os.link(path,linked)
        with self.assertRaises(ValueError):m.read(path,1<<20)
        linked.unlink()
        with self.assertRaises(ValueError):
            with m.held(path,1<<20):self.write(path,b'changed')

    def test_original_sender_identity_join_preserves_unknown_and_rejects_rebinding(self):
        controls=module('test_pq_enrollment_original_bindings.py');original=controls.EnrollmentOriginalBindingControls()
        original.setUp();self.addCleanup(original.doCleanups)
        expected=m.b.decode_expected(raw(original.expected));target={}
        for name in ('Block','Successor'):
            point=expected[name];target[name.lower()]=dict(chainId=point['ChainID'],headerHeight=str(point['HeaderHeight']),
                blockHash=base64.b64decode(point['BlockHash']).hex(),stateHeight=str(point['StateHeight']),stateAppHash=base64.b64decode(point['StateAppHash']).hex())
        target.update(transactionType='pq_transfer',envelope=expected['Envelope'],nativeWire=expected['NativeWire'],
            transactionHash=base64.b64decode(expected['TransactionHash']).hex(),nativeWireHash=base64.b64decode(expected['NativeWireHash']).hex(),index='0')
        context=copy.deepcopy(self.context);context['fundingExpected']=target;data=raw(context)
        before=copy.deepcopy(original.row)
        # A retained proof result for another full target cannot be spliced
        # onto this operation, even when its role/status labels look right.
        with self.assertRaises(ValueError):m.classify_result(raw(self.result),0,context)
        observed=m.bind_operation(data,m.b.sha(data),'funding',original=original.kwargs(),enabled=True)
        self.assertTrue(observed['originalByteBindingsObserved']);self.assertEqual(observed['originalStatus'],'unknown')
        self.assertFalse(observed['nonceReleased']);self.assertEqual(observed['operationIdentity'],'UNKNOWN');self.assertEqual(original.row,before)
        for key,value in (('operationId','b'*64),('nonce','3'),('owner','other')):
            old=original.binding[key];original.binding[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.bind_operation(data,m.b.sha(data),'funding',original=original.kwargs(),enabled=True)
            original.binding[key]=old
        changed=copy.deepcopy(context);changed['fundingExpected']['block']['blockHash']='1'*64;bad=raw(changed)
        with self.assertRaises(ValueError):m.bind_operation(bad,m.b.sha(bad),'funding',original=original.kwargs(),enabled=True)
        missing=m.bind_operation(data,m.b.sha(data),'migration',original=original.kwargs(),enabled=True)
        self.assertIn('normalOriginalOperationProducer',missing['missingEvidence']);self.assertFalse(missing['nonceReleased'])

    def test_durable_original_join_delegates_exact_same_readonly_db_contract(self):
        controls=module('test_pq_enrollment_original_bindings.py');original=controls.EnrollmentOriginalBindingControls()
        original.setUp();self.addCleanup(original.doCleanups)
        context=copy.deepcopy(self.context)
        # Use the same typed expectation as this controlled context, so the
        # original audit receives ALL raw request/outbox/ledger arguments.
        original.expected=m.b.decode_cli_expected(raw(context['fundingExpected']))
        original.binding['expectedSHA256']=m.b.sha(raw(original.expected))
        observed=dict(originalByteBindingsObserved=False,originalStatus='unknown',originalLedgerReadOnly=True,
                      originalPins={},missingEvidence=['originalOperationDirectory'])
        durable=dict(run_raw=b'original run',run_sha256='a'*64,source_tools={'original':'pins'},plan_raw=b'original plan',
                     accounting_raw=b'original sidecar',private_database='/UNSUPPLIED/original.sqlite',index=4)
        data=raw(context)
        with mock.patch.object(m.b,'audit_durable_sender',return_value=observed) as audit:
            result=m.bind_operation(data,m.b.sha(data),'funding',original=original.kwargs(),durable=durable,enabled=True)
        self.assertEqual(audit.call_args.kwargs,dict(durable,**original.kwargs()))
        self.assertTrue(result['originalLedgerReadOnly']);self.assertEqual(result['status'],'UNKNOWN');self.assertFalse(result['nonceReleased'])
        with self.assertRaises(ValueError):m.bind_operation(data,m.b.sha(data),'funding',original=original.kwargs(),durable={'binding':{}},enabled=True)


if __name__=='__main__':unittest.main(verbosity=2)
