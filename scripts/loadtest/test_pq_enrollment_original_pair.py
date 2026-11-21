"""Pure original-pair byte controls, without keys, signing, proof or nodes."""
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
m=module('pq-enrollment-original-pair.py')
def raw(value):return json.dumps(value,separators=(',',':')).encode()
def b64(value):return base64.b64encode(value).decode()
def sha(value):return hashlib.sha256(value).hexdigest()


class EnrollmentPairControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name).resolve()/'sender-public'/'0004';self.parent.mkdir(parents=True)
        self.request=dict(version='YNX-PQ-LAB-ENROLLMENT-REQUEST/v1',fundingOperationId='a'*64,migrationOperationId='b'*64,
            ownerIndex=4,fundingNonce='2',targetOwner='UNIT-TARGET',fundingAmount='3',activationHeight='9',
            pka=b64(b'a'*2592),pkb=b64(b'b'*64))
        self.workload=dict(version='YNX-PQ-LOOPBACK-WORKLOAD/v1',mode='online',syntheticOnly=True,authorityGranted=False,
            nativeChainId='642399',originalGenesisHash='c'*64,owners=[dict(index=4,owner='UNIT-SPONSOR',memberCapacity='100')])
        registration=dict(AlgorithmVersion='UNIT-only',Owner='UNIT-SPONSOR',Purpose='TX-BATCH',PolicyRevision='1',
            ChainID=b64(bytes.fromhex('c'*64)),PKA=b64(b'x'*2592),PKB=b64(b'y'*64),Enabled=True,ActiveFrom=1,RevokedAt=None)
        self.intent=dict(version='YNX-PQ-LAB-ENROLLMENT-INTENT/v1',request=self.request,checkpointHeight='4',checkpointAppHash='d'*64,
                         registration=registration)
        self.result=dict(version='YNX-PQ-LAB-ENROLLMENT-RESULT/v1',status='signed-originals',syntheticOnly=True,authorityGranted=False,
            currentEligibility='UNKNOWN',request=self.request,checkpointHeight='4',checkpointAppHash='d'*64)
        self.files={};self.expected={}
        for role,kind in (('funding','pq_transfer'),('migration','account_migration')):
            wire=('UNIT ONLY '+role+' wire, not a transaction').encode();envelope=b'UNIT envelope '+wire
            self.files[role]={'transaction.wire':wire,'transaction.abci':envelope}
            point=dict(ChainID='ynx_642399-1',HeaderHeight=5,StateHeight=4,BlockHash=b64(b'h'*32),StateAppHash=b64(b's'*32))
            self.expected[role]=dict(Block=point,Successor=dict(point,HeaderHeight=6,StateHeight=5),TransactionType=kind,
                Envelope=b64(envelope),NativeWire=b64(wire),TransactionHash=b64(bytes.fromhex(sha(envelope))),
                NativeWireHash=b64(bytes.fromhex(sha(wire))),Index=0 if role=='funding' else 1)
            for suffix,name in (('Wire','transaction.wire'),('Envelope','transaction.abci')):
                self.result[role+suffix]=dict(path=name,sha256=sha(self.files[role][name]),bytes=str(len(self.files[role][name])))
        self.row=dict(status='unknown',operationId='a'*64,ownerIndex=4,nonce=2,
            hash=sha(self.files['funding']['transaction.abci']),nativeHash=sha(self.files['funding']['transaction.wire']))
        self.account=dict(ownerIndex=4,address='UNIT-SPONSOR')
        self.binding=dict(schema=m.SCHEMA,sourceCommit=m.SOURCE,files={})
        self.update()
    def cli(self,e):
        def point(v):return dict(chainId=v['ChainID'],headerHeight=str(v['HeaderHeight']),stateHeight=str(v['StateHeight']),
            blockHash=base64.b64decode(v['BlockHash']).hex(),stateAppHash=base64.b64decode(v['StateAppHash']).hex())
        return dict(block=point(e['Block']),successor=point(e['Successor']),transactionType=e['TransactionType'],
            envelope=e['Envelope'],nativeWire=e['NativeWire'],transactionHash=base64.b64decode(e['TransactionHash']).hex(),
            nativeWireHash=base64.b64decode(e['NativeWireHash']).hex(),index=str(e['Index']))
    def update(self):
        self.context=dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-TRUST/v1',lightTrust={},
            pins=dict(originalGenesis='c'*64,nativeChainId='642399',fundingSource='UNIT-SPONSOR',owner=self.request['targetOwner'],
                fundingAmount=self.request['fundingAmount'],activationHeight=self.request['activationHeight'],pka=self.request['pka'],pkb=self.request['pkb']),
            fundingExpected=self.cli(self.expected['funding']),migrationExpected=self.cli(self.expected['migration']),
            fundingOriginalFile='/UNIT/funding.abci',migrationOriginalFile='/UNIT/migration.abci')
        for role in m.ROLES:
            directory=self.parent/self.request[role+'OperationId'];directory.mkdir(mode=0o700,exist_ok=True)
            self.files[role].update({'request.json':raw(self.request),
                'INTENT.json':raw(dict(body=b64(raw(self.intent)),mac=b64((b'f' if role=='funding' else b'm')*32))),
                'RESULT.json':raw(dict(body=b64(raw(self.result)),mac=b64((b'F' if role=='funding' else b'M')*32)))})
            self.binding['files'][role]={}
            for name,value in self.files[role].items():self.write(role,name,value)
        self.repin_inputs()
    def repin_inputs(self):
        self.binding.update(requestSHA256=sha(raw(self.request)),workloadSHA256=sha(raw(self.workload)),contextSHA256=sha(raw(self.context)),
                            expectedSHA256={role:sha(raw(e)) for role,e in self.expected.items()})
    def write(self,role,name,value):
        path=self.parent/self.request[role+'OperationId']/name;path.write_bytes(value);path.chmod(0o600)
        self.binding['files'][role][name]=dict(bytes=len(value),sha256=sha(value))
    def args(self):
        return dict(binding=self.binding,parent_directory=self.parent,request_raw=raw(self.request),workload_raw=raw(self.workload),
            context_raw=raw(self.context),expected_raws={k:raw(v) for k,v in self.expected.items()},funding_row=self.row,
            sponsor_account=self.account,enabled=True)
    def inspect(self):return m.inspect_pair(**self.args())

    def test_same_pair_bytes_keep_unknown_and_do_not_export_private_identity(self):
        before={str(p):p.read_bytes() for p in self.parent.glob('*/*')};row=copy.deepcopy(self.row)
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no substitute callee')):out=self.inspect()
        self.assertTrue(out['originalPairByteBindingsObserved']);self.assertEqual(out['status'],'UNKNOWN')
        self.assertEqual(out['operationIdentity'],'UNKNOWN');self.assertEqual(out['originalStatus'],'unknown')
        for name in ('normalProducerInvoked','recordMACAuthenticated','independentTransactionFinality','nonceReleased',
                     'resigningAllowed','accountAdmissionAllowed','targetMigrationLedgerObserved','privateDataExported'):
            self.assertIs(out[name],False)
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.parent.glob('*/*')});self.assertEqual(row,self.row)
        self.assertNotIn('UNIT-SPONSOR',json.dumps(out));self.assertNotIn(str(self.parent),json.dumps(out))
        pin=out['originalPins']['files']['funding']['request.json']['sha256']
        self.binding['files']['funding']['request.json']['sha256']='0'*64
        self.assertEqual(out['originalPins']['files']['funding']['request.json']['sha256'],pin)

    def test_missing_any_original_remains_unknown_without_reconstruction(self):
        for role in m.ROLES:
            for name in m.FILES:
                with self.subTest(role=role,name=name):
                    path=self.parent/self.request[role+'OperationId']/name;value=path.read_bytes();path.unlink()
                    out=self.inspect();self.assertFalse(out['originalPairByteBindingsObserved'])
                    self.assertIn(role+'.'+name,out['missingEvidence']);self.assertFalse(path.exists());self.write(role,name,value)
        for key in ('request_raw','workload_raw','context_raw','expected_raws','parent_directory','funding_row','sponsor_account'):
            args=self.args();args[key]=None;self.assertFalse(m.inspect_pair(**args)['originalPairByteBindingsObserved'])
        for role in m.ROLES:
            args=self.args();args['expected_raws'][role]=None
            out=m.inspect_pair(**args);self.assertIn(role+'.completeExpected',out['missingEvidence'])

    def test_closed_source_pin_default_and_bounded_input(self):
        args=self.args();args.pop('enabled')
        with mock.patch.object(m.c,'held',side_effect=AssertionError('must reject before IO')):
            with self.assertRaises(ValueError):m.inspect_pair(**args)
        for key,value in (('sourceCommit','f'*40),('sourceCommit','5c25ef6b8c6a6b44bc77197b70b42e2d4ab40864'),
                          ('requestSHA256','0'*64),('schema','unexpected')):
            old=self.binding[key];self.binding[key]=value
            with self.assertRaises(ValueError):self.inspect()
            self.binding[key]=old
        self.binding['grant']=True
        with self.assertRaises(ValueError):self.inspect()
        self.binding.pop('grant')
        with mock.patch.object(m,'TOTAL_LIMIT',1),mock.patch.object(m.c,'held',side_effect=AssertionError('bound before IO')):
            with self.assertRaisesRegex(ValueError,'aggregate'):self.inspect()
        self.assertIsNone(m.b.NORMAL_ENROLLMENT_CALLEE)
        args=self.args();args['request_raw']=None;args['funding_row']=dict(status={'private':'never echo'})
        with self.assertRaisesRegex(ValueError,'bounded funding status'):m.inspect_pair(**args)

    def test_request_types_distinct_ids_nonce_capacity_and_target(self):
        changes=[('fundingOperationId','A'*64),('migrationOperationId','a'*64),('ownerIndex',True),('fundingNonce','02'),
                 ('fundingNonce','102'),('fundingAmount','2'),('fundingAmount',str((1<<63)-1)),('targetOwner','UNIT-SPONSOR'),
                 ('activationHeight','5'),('pka',b64(b'a'*2591)),('pkb',b64(b'b'*63))]
        for key,value in changes:
            with self.subTest(key=key,value=str(value)[:30]):
                old=self.request[key];self.request[key]=value;self.update()
                with self.assertRaises(ValueError):self.inspect()
                self.request[key]=old;self.update()

    def test_both_mac_bodies_must_match_but_mac_bytes_are_not_authentication(self):
        # Original path-bound HMACs differ. Neither equal nor unequal bytes prove validity here.
        self.assertTrue(self.inspect()['originalPairByteBindingsObserved'])
        for name in ('INTENT.json','RESULT.json'):
            original=self.files['migration'][name];value=json.loads(original)
            body=json.loads(base64.b64decode(value['body']));body['checkpointHeight']='5';value['body']=b64(raw(body))
            self.write('migration',name,raw(value))
            with self.assertRaisesRegex(ValueError,'record bodies'):self.inspect()
            self.write('migration',name,original)
            value=json.loads(original);value['mac']='';self.write('migration',name,raw(value))
            with self.assertRaises(ValueError):self.inspect()
            self.write('migration',name,original)

    def test_record_checkpoint_policy_shape_and_false_authority(self):
        for key,value in (('authorityGranted',True),('currentEligibility','ELIGIBLE'),('checkpointHeight','5'),
                          ('checkpointAppHash','f'*64),('syntheticOnly',1),('status','confirmed')):
            old=self.result[key];self.result[key]=value;self.update()
            with self.assertRaises(ValueError):self.inspect()
            self.result[key]=old;self.update()
        for key,value in (('Owner','UNIT-TARGET'),('ChainID',b64(b'x'*32)),('Enabled',1),('ActiveFrom',True),('RevokedAt',-1)):
            old=self.intent['registration'][key];self.intent['registration'][key]=value;self.update()
            with self.assertRaises(ValueError):self.inspect()
            self.intent['registration'][key]=old;self.update()

    def test_full_expected_wires_types_height_order_and_hashes_are_bound(self):
        e=self.expected['migration']
        for key,value in (('TransactionType','pq_transfer'),('NativeWire',b64(b'other')),('Index',0),('Index',True),('Index',1<<32)):
            old=e[key];e[key]=value;self.update()
            with self.assertRaises(ValueError):self.inspect()
            e[key]=old;self.update()
        for key,value in (('ChainID','other-chain'),('BlockHash',b64(b'q'*32))):
            old=e['Block'][key];e['Block'][key]=value;self.update()
            with self.assertRaises(ValueError):self.inspect()
            e['Block'][key]=old;self.update()
        e['Block']=dict(self.expected['funding']['Successor'])
        e['Successor']=dict(e['Block'],HeaderHeight=7,StateHeight=6);e['Index']=0;self.update()
        self.assertTrue(self.inspect()['originalPairByteBindingsObserved'])
        e['Block']['BlockHash']=b64(b'z'*32);self.update()
        with self.assertRaisesRegex(ValueError,'same-height'):self.inspect()
        e['Block']['BlockHash']=self.expected['funding']['Successor']['BlockHash'];self.update()
        self.result['migrationWire']=dict(self.result['fundingWire']);self.update()
        with self.assertRaises(ValueError):self.inspect()

    def test_sponsor_row_cannot_be_replaced_with_target_or_second_sponsor_nonce(self):
        for key,value in (('operationId','b'*64),('ownerIndex',5),('ownerIndex',True),('nonce',1),('nonce',3),('nonce',True),('hash','e'*64)):
            old=self.row[key];self.row[key]=value
            with self.assertRaises(ValueError):self.inspect()
            self.row[key]=old
        self.account['address']='UNIT-TARGET'
        with self.assertRaises(ValueError):self.inspect()
        self.account['address']='UNIT-SPONSOR'
        for status in ('unknown','failed','reserved','signed','submitted','included','qualified'):
            self.row['status']=status;out=self.inspect();self.assertEqual(out['originalStatus'],status)
            self.assertFalse(out['nonceReleased'] or out['resigningAllowed'] or out['accountAdmissionAllowed'])

    def test_context_pin_fields_cannot_splice_another_pair(self):
        for key,value in (('fundingSource','OTHER'),('owner','OTHER'),('fundingAmount','4'),('activationHeight','10'),
                          ('originalGenesis','f'*64),('nativeChainId','1'),('pka',b64(b'x'*2592))):
            old=self.context['pins'][key];self.context['pins'][key]=value;self.repin_inputs()
            with self.assertRaises(ValueError):self.inspect()
            self.context['pins'][key]=old;self.repin_inputs()

    def test_file_alias_permissions_changes_and_duplicate_json_are_rejected(self):
        path=self.parent/self.request['fundingOperationId']/'transaction.wire';alias=path.with_name('alias')
        path.rename(alias);path.symlink_to(alias)
        with self.assertRaises(OSError):self.inspect()
        path.unlink();alias.rename(path);os.link(path,alias)
        with self.assertRaises(ValueError):self.inspect()
        alias.unlink();path.chmod(0o644)
        with self.assertRaises(ValueError):self.inspect()
        path.chmod(0o600);path.write_bytes(path.read_bytes()+b'changed')
        with self.assertRaises(ValueError):self.inspect()
        self.update();original=self.files['funding']['request.json']
        self.write('funding','request.json',original+b' ')
        with self.assertRaises(ValueError):self.inspect()
        for value in (raw(self.request)[:-1]+b',"ownerIndex":4}',raw(self.request).replace(b'"ownerIndex":4',b'"ownerIndex":NaN')):
            args=self.args();args['request_raw']=value;self.binding['requestSHA256']=sha(value)
            with self.assertRaises((ValueError,RuntimeError)):m.inspect_pair(**args)

    def test_confirmed_marker_is_never_used_to_release_or_authenticate(self):
        for role in m.ROLES:
            path=self.parent/self.request[role+'OperationId']/'CONFIRMED.json';path.write_bytes(b'{"finalized":true}');path.chmod(0o600)
        out=self.inspect();self.assertFalse(out['nonceReleased'] or out['independentTransactionFinality'] or out['recordMACAuthenticated'])
        self.assertEqual(out['currentEligibility'],'UNKNOWN')

    def test_actual_stopped_driver_funding_row_read_only_and_missing_db(self):
        controls=module('test_pq_durable_load_accounting.py');helper=controls.DurableDriverControls()
        helper.setUp();self.addCleanup(helper.doCleanups)
        root,window,monitor,stop,_,_=helper.case(count=1);a=controls.a
        owners=[dict(ownerIndex=4,address='UNIT-SPONSOR',nextNonce=2,capacity=100)]
        plan=a.staged.configure_durable(a.d.make_plan('a'*64,sha(raw(self.workload)),'online',owners,100,
            1_000_000_000,1_000_000_000,enabled=True),enabled=True)
        original=self
        class OriginalUnknown:
            def publish(self,row,account,notify,cancel):
                original.request['fundingOperationId']=row['operationId'];original.row['operationId']=row['operationId'];original.update()
                notify(dict(kind='signed',hash=original.row['hash'],nativeHash=original.row['nativeHash']))
                notify(dict(kind='submitted'));notify(dict(kind='ack'));return row
            def observe(self,row,notify,cancel):notify(dict(kind='included'));return row
            def finalize(self,row,notify,cancel):cancel.set();raise RuntimeError('UNIT enrollment confirmation UNKNOWN')
            def stop(self):pass
        accounting=a.DriverAccounting(window,monitor,stop,plan)
        outcome=controls.driver.run_load_window(plan,a.StopOnce(OriginalUnknown()),mock.Mock(),monitor,stop,durable_accounting=accounting)
        tools=dict(source=dict(commit=m.SOURCE,tree='2'*40,forkTree='3'*40),
            tools=dict(commit='4'*40,tree='5'*40,driverSHA256='6'*64,resourceGuardSHA256='7'*64))
        plan_raw=raw(a.public_plan(plan));run=dict(schema=a.RUN_SCHEMA,source=tools['source'],toolIdentity=tools['tools'],
            configuredDemand=100,mode='online',requestedOfferedTPS=100,loadConditions=controls.driver.load_conditions(helper.args()),
            loadExecuted=True,loadResult=outcome,firstCause=outcome['firstCause'],planSHA256=sha(plan_raw))
        controls.driver.retain_durable_accounting(accounting,root,run)
        sidecar=(root/'public/durable-accounting.json').read_bytes();run_raw=raw(run)
        args=self.args();args.pop('funding_row');args.pop('sponsor_account')
        args.update(source_tools=tools,plan_raw=plan_raw,accounting_raw=sidecar,private_database=accounting.path,index=0)
        before=accounting.path.read_bytes();out=m.audit_durable_pair(run_raw,sha(run_raw),**args)
        self.assertTrue(out['originalLedgerReadOnly'] and out['originalPairByteBindingsObserved'])
        self.assertEqual(out['originalStatus'],'unknown');self.assertFalse(out['nonceReleased']);self.assertEqual(before,accounting.path.read_bytes())
        self.assertGreaterEqual(a.readback(json.loads(sidecar),plan_raw,private_database=accounting.path)['pendingOriginalCount'],1)
        args['private_database']=None;missing=m.audit_durable_pair(run_raw,sha(run_raw),**args)
        self.assertEqual(missing['status'],'UNKNOWN');self.assertFalse(missing['originalPairByteBindingsObserved'])


if __name__=='__main__':unittest.main()
