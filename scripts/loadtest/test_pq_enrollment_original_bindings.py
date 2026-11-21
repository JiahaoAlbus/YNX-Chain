"""Original-format byte controls; no signing, node or cryptographic verification."""
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=module('pq-enrollment-original-bindings.py')
def raw(value):return json.dumps(value,separators=(',',':')).encode()
def b64(value):return base64.b64encode(value).decode()
def sha(value):return hashlib.sha256(value).hexdigest()


class EnrollmentOriginalBindingControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name).resolve()/'sender-public'/'0004'/('a'*64);self.directory.mkdir(mode=0o700,parents=True)
        self.wire=b'UNIT ONLY native wire, not a signed transaction'
        self.envelope=b'UNIT ONLY original envelope, not chain input'
        self.request=dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId='a'*64,ownerIndex=4,firstNonce='2',members=1)
        self.result=dict(version='YNX-PQ-LAB-SENDER-RESULT/v1',status='signed-original',syntheticOnly=True,
            authorityGranted=False,operationId='a'*64,ownerIndex=4,checkpointHeight='4',checkpointAppHash='e'*64,
            transaction=dict(ownerIndex=4,type='pq_transfer',wire=dict(path='transaction.wire',bytes=str(len(self.wire)),sha256=sha(self.wire)),
                envelope=dict(path='transaction.abci',bytes=str(len(self.envelope)),sha256=sha(self.envelope)),nativeHash=sha(self.wire),
                abciHash=sha(self.envelope),firstNonce='2',members='1',amountPerMember='1',feePerMember='1'))
        self.workload=raw(dict(version='YNX-PQ-LOOPBACK-WORKLOAD/v1',mode='online',syntheticOnly=True,authorityGranted=False,
            owners=[dict(index=4,owner='UNIT-OWNER')]))
        point=dict(ChainID='ynx_642399-1',HeaderHeight=5,BlockHash=b64(b'b'*32),StateHeight=4,StateAppHash=b64(b'a'*32))
        self.expected=dict(Block=point,Successor=dict(point,HeaderHeight=6,StateHeight=5),TransactionType='pq_transfer',
            Envelope=b64(self.envelope),NativeWire=b64(self.wire),TransactionHash=b64(bytes.fromhex(sha(self.envelope))),
            NativeWireHash=b64(bytes.fromhex(sha(self.wire))),Index=0)
        self.binding=dict(schema=m.SCHEMA,sourceCommit=m.SOURCE,operationId='a'*64,ownerIndex=4,owner='UNIT-OWNER',nonce='2',
            transactionType='pq_transfer',files={},workloadSHA256=sha(self.workload),expectedSHA256=sha(raw(self.expected)))
        self.row=dict(status='unknown',operationId='a'*64,ownerIndex=4,nonce=2,hash=sha(self.envelope),nativeHash=sha(self.wire))
        self.account=dict(ownerIndex=4,address='UNIT-OWNER')
        self.write_files()
    def write_files(self):
        values={'request.json':raw(self.request),'RESULT.json':raw(dict(body=b64(raw(self.result)),mac=b64(b'x'*32))),
                'transaction.wire':self.wire,'transaction.abci':self.envelope}
        for name,value in values.items():
            path=self.directory/name;path.write_bytes(value);path.chmod(0o600)
            self.binding['files'][name]=dict(bytes=len(value),sha256=sha(value))
    def kwargs(self):
        return dict(binding=self.binding,directory=self.directory,workload_raw=self.workload,expected_raw=raw(self.expected),
                    row=self.row,account=self.account,enabled=True)
    def audit(self):return m.inspect_sender_original(**self.kwargs())

    def test_exact_original_bytes_stay_unknown_without_mac_callee_and_current_state(self):
        before={p.name:p.read_bytes() for p in self.directory.iterdir()};row=copy.deepcopy(self.row)
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no callee substitute')):
            result=self.audit()
        self.assertTrue(result['originalByteBindingsObserved']);self.assertEqual(result['status'],'UNKNOWN')
        self.assertEqual(result['originalStatus'],'unknown');self.assertEqual(self.row,row)
        for key in ('normalVerifierInvoked','normalVerifierAvailable','recordMACAuthenticated','independentTransactionFinality',
                    'nativeGrant','nonceReleased','automaticRetry','resigningAllowed','accountAdmissionAllowed','privateDataExported'):
            self.assertIs(result[key],False)
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.directory.iterdir()})
        self.assertNotIn('UNIT-OWNER',json.dumps(result));self.assertNotIn(str(self.directory),json.dumps(result))
        original_pin=result['originalPins']['files']['request.json']['sha256']
        self.binding['files']['request.json']['sha256']='0'*64
        self.assertEqual(result['originalPins']['files']['request.json']['sha256'],original_pin)

    def test_wrong_request_operation_owner_nonce_and_boolean_are_rejected(self):
        for key,value in (('operationId','b'*64),('ownerIndex',5),('ownerIndex',True),('firstNonce','3'),('members',True)):
            with self.subTest(key=key,value=value):
                old=self.request[key];self.request[key]=value;self.write_files()
                with self.assertRaises(ValueError):self.audit()
                self.request[key]=old
        self.write_files()
        for key,value in (('operationId','b'*64),('ownerIndex',5),('nonce',3),('hash','c'*64)):
            with self.subTest(ledger=key):
                old=self.row[key];self.row[key]=value
                with self.assertRaises(ValueError):self.audit()
                self.row[key]=old

    def test_complete_expected_cannot_rebind_wire_hash_header_or_index(self):
        changes=[('NativeWire',b64(b'other')),('Envelope',b64(b'other')),('TransactionHash',b64(b'z'*32)),
                 ('NativeWireHash',b64(b'z'*32)),('Index',True),('Index',1<<32),('TransactionType','pq_migration'),('Block',{})]
        for key,value in changes:
            with self.subTest(key=key):
                old=self.expected[key];self.expected[key]=value;self.binding['expectedSHA256']=sha(raw(self.expected))
                with self.assertRaises(ValueError):self.audit()
                self.expected[key]=old
        self.binding['expectedSHA256']=sha(raw(self.expected))
        for key,value in (('ChainID','another-chain'),('HeaderHeight',7),('StateHeight',4)):
            with self.subTest(successor=key):
                old=self.expected['Successor'][key];self.expected['Successor'][key]=value
                self.binding['expectedSHA256']=sha(raw(self.expected))
                with self.assertRaisesRegex(ValueError,'original.*(header|H/H)'):
                    self.audit()
                self.expected['Successor'][key]=old
        self.binding['expectedSHA256']=sha(raw(self.expected))

    def test_record_is_original_mac_wrapper_and_not_a_caller_success_projection(self):
        path=self.directory/'RESULT.json'
        for value in (self.result,dict(body=b64(raw(self.result)),mac=''),dict(body=b64(raw(self.result)),mac=b64(b'x'*32),verified=True)):
            with self.subTest(value=tuple(value)):
                encoded=raw(value);path.write_bytes(encoded);self.binding['files']['RESULT.json']=dict(bytes=len(encoded),sha256=sha(encoded))
                with self.assertRaises(ValueError):self.audit()
        self.write_files();self.result['authorityGranted']=True;self.write_files()
        with self.assertRaises(ValueError):self.audit()

    def test_missing_originals_are_unknown_and_never_reconstructed(self):
        for name in m.FILE_LIMITS:
            with self.subTest(name=name):
                original=(self.directory/name).read_bytes();(self.directory/name).unlink()
                result=self.audit();self.assertFalse(result['originalByteBindingsObserved']);self.assertIn(name,result['missingEvidence'])
                self.assertFalse((self.directory/name).exists());(self.directory/name).write_bytes(original);(self.directory/name).chmod(0o600)
        for name in ('workload_raw','expected_raw'):
            args=self.kwargs();args[name]=None
            self.assertFalse(m.inspect_sender_original(**args)['originalByteBindingsObserved'])

    def test_unknown_or_unsigned_observation_does_not_release_original_nonce(self):
        for status in ('unknown','failed','reserved','signed','included','qualified'):
            with self.subTest(status=status):
                self.row['status']=status;self.row['hash']=self.row['nativeHash']=None
                result=self.audit();self.assertEqual(result['originalStatus'],status)
                self.assertFalse(result['nonceReleased'] or result['resigningAllowed'] or result['accountAdmissionAllowed'])
                self.assertEqual(result['currentEligibility'],'UNKNOWN')

    def test_missing_classic_and_migration_normal_producers_never_use_sender_format(self):
        for kind in ('YNX-LAB-LEGACY-FUNDING/v1','pq_migration'):
            self.binding['transactionType']=kind
            with mock.patch.object(m,'original_files',side_effect=AssertionError('unsupported role must not read')):
                result=self.audit()
            self.assertFalse(result['originalByteBindingsObserved']);self.assertIn('normalOriginalOperationProducer',result['missingEvidence'])

    def test_modified_raw_bytes_duplicate_keys_or_nonfinite_input_fail_closed(self):
        path=self.directory/'request.json';original=path.read_bytes();path.write_bytes(original+b' ')
        with self.assertRaises(ValueError):self.audit()
        for value in (original[:-1]+b',"members":1}',original.replace(b'"members":1',b'"members":NaN')):
            path.write_bytes(value);self.binding['files']['request.json']=dict(bytes=len(value),sha256=sha(value))
            with self.assertRaises((RuntimeError,ValueError)):self.audit()
        self.write_files();self.binding['sourceCommit']='f'*40
        with self.assertRaises(ValueError):self.audit()

    def test_original_file_aliases_and_permissions_are_rejected(self):
        path=self.directory/'transaction.wire';alias=self.directory/'alias';path.rename(alias);path.symlink_to(alias)
        with self.assertRaises(OSError):self.audit()
        path.unlink();alias.rename(path);os.link(path,alias)
        with self.assertRaises(ValueError):self.audit()
        alias.unlink();path.chmod(0o644)
        with self.assertRaises(ValueError):self.audit()
        path.chmod(0o600);self.directory.chmod(0o755)
        with self.assertRaises(ValueError):self.audit()

    def test_default_is_closed_and_no_caller_can_supply_source_authority(self):
        self.assertIsNone(m.NORMAL_ENROLLMENT_CALLEE)
        args=self.kwargs();args.pop('enabled')
        with self.assertRaises(ValueError):m.inspect_sender_original(**args)
        self.binding['callee']='/untrusted/pretend-verifier'
        with self.assertRaises(ValueError):self.audit()
        self.binding.pop('callee');self.binding['currentPolicyVerified']=True
        with self.assertRaises(ValueError):self.audit()
        with mock.patch.object(m.accounting,'join_run',side_effect=AssertionError('no private IO without opt-in')):
            with self.assertRaises(ValueError):
                m.audit_durable_sender(None,None,source_tools=None,plan_raw=None,accounting_raw=None,private_database=None,index=0)

    def test_same_original_driver_db_unknown_row_is_audited_without_nonce_release(self):
        controls=module('test_pq_durable_load_accounting.py')
        helper=controls.DurableDriverControls();helper.setUp();self.addCleanup(helper.doCleanups)
        root,window,monitor,stop,_,_=helper.case(count=1)
        a=controls.a
        owners=[dict(ownerIndex=4,address='UNIT-OWNER',nextNonce=2,capacity=100)]
        plan=a.staged.configure_durable(a.d.make_plan('a'*64,sha(self.workload),'online',owners,100,
            1_000_000_000,1_000_000_000,enabled=True),enabled=True)
        original=self
        class OriginalUnknown:
            def publish(self,row,account,notify,cancel):
                original.request['operationId']=row['operationId'];original.result['operationId']=row['operationId']
                original.binding['operationId']=row['operationId']
                notify(dict(kind='signed',hash=sha(original.envelope),nativeHash=sha(original.wire)))
                notify(dict(kind='submitted'));notify(dict(kind='ack'))
                return row
            def observe(self,row,notify,cancel):notify(dict(kind='included'));return row
            def finalize(self,row,notify,cancel):
                cancel.set();raise RuntimeError('UNIT original confirmation UNKNOWN')
            def stop(self):pass
        accounting=a.DriverAccounting(window,monitor,stop,plan)
        outcome=controls.driver.run_load_window(plan,a.StopOnce(OriginalUnknown()),mock.Mock(),monitor,stop,durable_accounting=accounting)
        new=self.directory.with_name(self.binding['operationId']);self.directory.rename(new);self.directory=new
        self.write_files()
        source_tools=dict(source=dict(commit=m.SOURCE,tree='2'*40,forkTree='3'*40),
            tools=dict(commit='4'*40,tree='5'*40,driverSHA256='6'*64,resourceGuardSHA256='7'*64))
        plan_raw=raw(a.public_plan(plan))
        run=dict(schema=a.RUN_SCHEMA,source=source_tools['source'],toolIdentity=source_tools['tools'],configuredDemand=100,
            mode='online',requestedOfferedTPS=100,loadConditions=controls.driver.load_conditions(helper.args()),
            loadExecuted=True,loadResult=outcome,firstCause=outcome['firstCause'],planSHA256=sha(plan_raw))
        controls.driver.retain_durable_accounting(accounting,root,run)
        sidecar=(root/'public/durable-accounting.json').read_bytes();run_raw=raw(run)
        arguments=dict(source_tools=source_tools,plan_raw=plan_raw,accounting_raw=sidecar,private_database=accounting.path,
            index=0,binding=self.binding,directory=self.directory,workload_raw=self.workload,expected_raw=raw(self.expected),enabled=True)
        before=accounting.path.read_bytes()
        result=m.audit_durable_sender(run_raw,sha(run_raw),**arguments)
        self.assertTrue(result['originalLedgerReadOnly'] and result['originalByteBindingsObserved'])
        self.assertEqual(result['originalStatus'],'unknown');self.assertFalse(result['nonceReleased'])
        self.assertEqual(before,accounting.path.read_bytes())
        self.assertGreaterEqual(a.readback(json.loads(sidecar),plan_raw,private_database=accounting.path)['pendingOriginalCount'],1)
        arguments['private_database']=None
        missing=m.audit_durable_sender(run_raw,sha(run_raw),**arguments)
        self.assertEqual(missing['status'],'UNKNOWN');self.assertFalse(missing['originalByteBindingsObserved'])
        arguments['private_database']=accounting.path
        self.binding['nonce']='3'
        with self.assertRaises(ValueError):m.audit_durable_sender(run_raw,sha(run_raw),**arguments)
        self.assertEqual(before,accounting.path.read_bytes())

    def test_candidate_normal_cli_targets_bind_both_originals_but_never_invoke_or_admit(self):
        migration=copy.deepcopy(self.expected);migration['TransactionType']='pq_migration'
        expected={'funding':dict(raw=raw(self.expected),sha256=sha(raw(self.expected))),
                  'migration':dict(raw=raw(migration),sha256=sha(raw(migration)))}
        # This is the normal transactionExpected CLI ABI from Core f59, not
        # the Go type's default JSON. Public proof/trust files are NOT supplied.
        block=dict(chainId='ynx_642399-1',headerHeight='5',blockHash=(b'b'*32).hex(),stateHeight='4',stateAppHash=(b'a'*32).hex())
        target=dict(block=block,successor=dict(block,headerHeight='6',stateHeight='5'),transactionType='pq_transfer',
            envelope=b64(self.envelope),nativeWire=b64(self.wire),transactionHash=sha(self.envelope),nativeWireHash=sha(self.wire),index='0')
        context=dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-TRUST/v1',lightTrust={},pins={},
            fundingExpected=target,migrationExpected=dict(copy.deepcopy(target),transactionType='pq_migration'),
            fundingOriginalFile='/UNSUPPLIED/funding.abci',migrationOriginalFile='/UNSUPPLIED/migration.abci')
        original=raw(context)
        with mock.patch('subprocess.Popen',side_effect=AssertionError('candidate CLI cannot execute')):
            result=m.bind_normal_cli_expectations(original,sha(original),expected,enabled=True)
        self.assertTrue(result['normalCLIExpectedByteBindingsObserved']);self.assertEqual(result['status'],'UNKNOWN')
        self.assertFalse(result['normalVerifierInvoked'] or result['nativeGrant'] or result['accountAdmissionAllowed'])
        self.assertIsNone(m.NORMAL_ENROLLMENT_CALLEE);self.assertEqual(raw(context),original)
        for role,key,value in (('fundingExpected','index',0),('fundingExpected','nativeWire',b64(b'other')),
                               ('migrationExpected','transactionType','pq_transfer'),('migrationExpected','transactionHash','d'*64)):
            with self.subTest(role=role,key=key):
                changed=copy.deepcopy(context);changed[role][key]=value;encoded=raw(changed)
                with self.assertRaises(ValueError):m.bind_normal_cli_expectations(encoded,sha(encoded),expected,enabled=True)
        with self.assertRaises(ValueError):m.bind_normal_cli_expectations(original,sha(original),expected)
        with self.assertRaises(ValueError):m.bind_normal_cli_expectations(original,'0'*64,expected,enabled=True)
        with self.assertRaises(ValueError):m.bind_normal_cli_expectations(original,sha(original),{'funding':expected['funding']},enabled=True)


if __name__=='__main__':unittest.main(verbosity=2)
