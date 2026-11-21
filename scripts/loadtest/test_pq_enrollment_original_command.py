"""Pure normal ABI/byte controls; no credential, signer, proof or node."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=module('pq-enrollment-original-command.py')
t=module('test_pq_enrollment_original_pair.py')
raw=m.canonical
sha=m.b.sha


class EnrollmentOriginalCommandControls(unittest.TestCase):
    def setUp(self):
        self.pair=t.EnrollmentPairControls();self.pair.setUp();self.addCleanup(self.pair.doCleanups)
        self.request=raw(self.pair.request);self.pin=sha(self.request);self.context=copy.deepcopy(self.pair.context)
        self.context['lightTrust']=dict(version='YNX-CONSENSUS-PROOF-TRUST/v1',chainId='ynx_642399-1',scheduleHash='1'*64,
            consensusGenesisSHA256='e'*64,originalGenesisHash='c'*64,migrationStateHash='2'*64,runtimePlanFile='',runtimePlanHash='',
            engineHeight='6',engineAppHash='3'*64,trustedLightBlockSHA256='4'*64,trustingPeriodNanoseconds='3600000000000',
            maxClockDriftNanoseconds='1000000000',trustLevelNumerator='1',trustLevelDenominator='3')
        self.proofs={r:raw({'UNIT':'not cryptographic proof','role':r}) for r in m.ROLES}
        self.proof_pins={r:sha(v) for r,v in self.proofs.items()};self.retained={};historical=dict(classification='data',currentEligibility='UNKNOWN',nativeGrant=False)
        self.confirm=dict(historical=historical,currentEligibility='UNKNOWN',authorityGranted=False)
        for role in m.ROLES:
            e=self.context[role+'Expected'];tx=dict(version='YNX-PQ-TRANSACTION-PROOF/v1',classification='data',
                transactionType=e['transactionType'],transactionHash=e['transactionHash'],nativeWireHash=e['nativeWireHash'],
                height='5',index=e['index'],total='2',executionCode='0',gasWanted='0',gasUsed='1',executionData='',
                included=True,finalized=True,executionSuccessful=True,outcome='succeeded',nativeGrant=False)
            for name in ('block','successor'):
                tx[name]=dict(e[name],version='YNX-PQ-LIGHT-PROOF/v1',classification='data',genesisSha256='e'*64,
                    authorityThroughHeight='6',trustedHeight='3',trustedBlockHash='c'*64,validatorsHash='d'*64,
                    nextValidatorsHash='d'*64,consensusHash='f'*64,commitVerified=True,lightTransitionVerified=True)
            historical[role]=tx;directory=self.pair.parent/self.pair.request[role+'OperationId']/'confirmation-proof'
            light=dict(self.context['lightTrust'])
            for key,name in {'migrationFile':'migration.json','genesisFile':'genesis.json','stateFile':'committed-state.json',
                             'scheduleFile':'schedule.json','trustedLightBlockFile':'trusted-light-block.json'}.items():light[key]=str(directory/name)
            for key,name in {'expectedHeaderHeight':'headerHeight','expectedBlockHash':'blockHash',
                             'expectedStateHeight':'stateHeight','expectedStateAppHash':'stateAppHash'}.items():light[key]=e['block'][name]
            ctx=raw(dict(version='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',lightTrust=light,expectedTransaction=e))
            request=raw(dict(version='YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1',expected=e,proof=json.loads(self.proofs[role])))
            export=dict(version='YNX-PQ-LOOPBACK-PROOF-EXPORT/v1',syntheticOnly=True,authorityGranted=False,
                actualNetworkExecutionClaim=False,context=self.file('trust-context.json',ctx),request=self.file('request.json',request),
                result=tx,verifierArguments=['--trust-context',str(directory/'trust-context.json'),'--trust-context-sha256',sha(ctx)])
            confirmed=raw(dict(body=base64.b64encode(raw(dict(export,version='YNX-PQ-LAB-ENROLLMENT-CONFIRMED/v1'))).decode(),
                               mac=base64.b64encode(b'U'*32).decode())) # Deliberately not an authenticated MAC.
            self.retained[role]={'CONFIRMED.json':confirmed,'confirmation-proof/request.json':request,
                'confirmation-proof/trust-context.json':ctx,'confirmation-proof/PUBLIC-PROOF-INPUTS.json':raw(export)}
            self.confirm[role]=export;self.confirm[role+'Confirmed']=self.file('CONFIRMED.json',confirmed)

    def file(self,name,data):return dict(path=name,sha256=sha(data),bytes=str(len(data)))
    def reply(self,operation='recover'):
        return dict(version='YNX-PQ-LAB-ENROLLMENT-REPLY/v1',code='ORIGINAL_RECOVERED' if operation=='recover' else 'PROOF_CONFIRMED_DATA',
            result=self.pair.result if operation=='recover' else self.confirm,syntheticOnly=True,authorityGranted=False,
            currentEligibility='UNKNOWN',requestSHA256=self.pin,fundingOperationId=self.pair.request['fundingOperationId'],
            migrationOperationId=self.pair.request['migrationOperationId'])
    def inspect(self,operation='recover',**changes):
        args=dict(operation=operation,request_raw=self.request,request_sha256=self.pin,
            result_original_raw=self.pair.files['funding']['RESULT.json'],context_raw=raw(self.context),proof_raws=self.proofs,
            proof_sha256=self.proof_pins,retained=self.retained,parent_directory=self.pair.parent,enabled=True)
        args.update(changes);return m.inspect_reply(raw(self.reply(operation)),0,**args)

    def test_default_gate_does_not_read_or_inherit_credentials_or_spawn(self):
        with mock.patch.object(m.c,'read',side_effect=AssertionError('no IO')),mock.patch('subprocess.Popen',side_effect=AssertionError('no callee')):
            with self.assertRaises(ValueError):m.normal_original()
            out=m.normal_original(enabled=True,credential_fd=9,source=m.INSPECTED_CLI,binary='/UNIT')
        self.assertIsNone(m.NORMAL_ORIGINAL_CALLEE);self.assertEqual(out['status'],'UNKNOWN');self.assertFalse(out['normalCalleeInvoked'])

    def test_recover_command_is_original_canonical_order_and_single_frame(self):
        value=m.command('recover',self.request,self.pin,root='/UNIT')
        decoded=json.loads(value);self.assertEqual(list(decoded),['version','operation','request','requestSHA256',
            'fundingMaterialsFile','fundingMaterialsSHA256','fundingProofFile','migrationMaterialsFile','migrationMaterialsSHA256','migrationProofFile'])
        self.assertEqual(raw(decoded['request']),self.request);self.assertEqual(value.count(b'\n'),1)
        self.assertEqual(decoded['fundingMaterialsFile'],decoded['migrationProofFile']);self.assertEqual(decoded['migrationProofFile'],'')
        with self.assertRaises(ValueError):m.command('recover',self.request,self.pin,root='/UNIT',proof_inputs={})

    def test_confirm_command_preserves_independent_proof_pin_outside_original_wire(self):
        inputs={r:dict(materialsFile='/UNIT/'+r+'/materials.json',materialsSHA256='1'*64,
                       proofFile='/UNIT/'+r+'/proof.json',proofSHA256=self.proof_pins[r]) for r in m.ROLES}
        result=m.command('confirm',self.request,self.pin,root='/UNIT',proof_inputs=inputs)
        self.assertNotIn(b'proofSHA256',result);self.assertEqual(json.loads(result)['fundingProofFile'],inputs['funding']['proofFile'])
        for value in ('/foreign/proof.json','/UNIT/../proof.json','/UNIT/private-senders/credential','/UNIT/custody/key'):
            broken=copy.deepcopy(inputs);broken['migration']['proofFile']=value
            with self.assertRaises(ValueError):m.command('confirm',self.request,self.pin,root='/UNIT',proof_inputs=broken)

    def test_wrong_request_digest_id_or_noncanonical_encoding_is_refused(self):
        for data,pin in ((self.request,'f'*64),(self.request+b' ',sha(self.request+b' ')),
                         (self.request.replace(b'"migrationOperationId":"'+b'b'*64,b'"migrationOperationId":"'+b'a'*64),None)):
            with self.assertRaises(ValueError):m.command('recover',data,pin or sha(data),root='/UNIT')
        for role in m.ROLES:
            value=self.reply();value[role+'OperationId']='f'*64
            with self.assertRaises(ValueError):m.inspect_reply(raw(value),0,operation='recover',request_raw=self.request,
                request_sha256=self.pin,result_original_raw=self.pair.files['funding']['RESULT.json'],enabled=True)

    def test_recovered_reply_is_bytes_only_and_cannot_release_nonce(self):
        out=self.inspect();self.assertTrue(out['originalReplyByteBindingsObserved']);self.assertEqual(out['status'],'UNKNOWN')
        for key in ('normalCalleeInvoked','recordMACAuthenticated','independentProofVerified','nonceReleased','resigningAllowed'):
            self.assertFalse(out[key])
        changed=copy.deepcopy(self.pair.result);changed['checkpointHeight']='5';self.pair.result=changed
        with self.assertRaises(ValueError):self.inspect()

    def test_unknown_failure_stage_and_original_error_class_are_preserved(self):
        for op,stage,code in (('recover','original-recovery',None),('confirm','funding-proof-input',None),
                              ('confirm','confirmation','expired_trust'),('confirm','request-identity',None)):
            value=dict(version='YNX-PQ-LAB-ENROLLMENT-REPLY/v1',code='UNKNOWN',result=None,syntheticOnly=True,
                authorityGranted=False,currentEligibility='UNKNOWN',requestSHA256='' if stage=='request-identity' else self.pin,failureStage=stage)
            if code:value['proofFailureCode']=code
            args=dict(operation=op,request_raw=self.request,request_sha256=self.pin,result_original_raw=None,enabled=True)
            out=m.inspect_reply(raw(value),0,**args);self.assertEqual(out['failureStage'],stage);self.assertEqual(out['proofFailureCode'],code)
            with self.assertRaises(ValueError):m.inspect_reply(raw(value),1,**args)
            value['failureStage']='sign'
            with self.assertRaises(ValueError):m.inspect_reply(raw(value),0,**args)

    def test_malformed_duplicate_nonfinite_extra_and_grants_refused(self):
        original=raw(self.reply())
        for value in (original[:-1]+b',"code":"UNKNOWN"}',b'{"code":NaN}',raw(dict(self.reply(),extra=True)),
                      raw(dict(self.reply(),authorityGranted=True)),raw(dict(self.reply(),currentEligibility='ACTIVE'))):
            with self.assertRaises((ValueError,KeyError)):m.inspect_reply(value,0,operation='recover',request_raw=self.request,
                request_sha256=self.pin,result_original_raw=self.pair.files['funding']['RESULT.json'],enabled=True)
        with self.assertRaises(ValueError):m.inspect_reply(original,False,operation='recover',request_raw=self.request,
            request_sha256=self.pin,result_original_raw=self.pair.files['funding']['RESULT.json'],enabled=True)

    def test_dual_confirmation_requires_full_originals_and_never_authenticates_mock_mac(self):
        out=self.inspect('confirm');self.assertTrue(out['originalReplyByteBindingsObserved']);self.assertEqual(out['status'],'UNKNOWN')
        self.assertFalse(out['recordMACAuthenticated'] or out['independentProofVerified'] or out['nonceReleased'])
        for name in ('context_raw','proof_raws','proof_sha256','retained','parent_directory'):
            out=self.inspect('confirm',**{name:None});self.assertFalse(out['originalReplyByteBindingsObserved']);self.assertTrue(out['missingEvidence'])

    def test_bare_proof_sha_or_changed_expected_cannot_replace_full_request(self):
        for role in m.ROLES:
            before=copy.deepcopy(self.confirm)
            self.confirm[role]['request']['sha256']=sha(self.proofs[role])
            with self.assertRaises(ValueError):self.inspect('confirm')
            self.confirm=before
            old=self.retained[role]['confirmation-proof/request.json'];changed=json.loads(old)
            changed['expected']['index']='9';self.retained[role]['confirmation-proof/request.json']=raw(changed)
            with self.assertRaises(ValueError):self.inspect('confirm')
            self.retained[role]['confirmation-proof/request.json']=old
            pins=dict(self.proof_pins);pins[role]='0'*64
            with self.assertRaises(ValueError):self.inspect('confirm',proof_sha256=pins)

    def test_partial_confirmed_changed_body_or_swapped_roles_are_refused(self):
        for role in m.ROLES:
            old=self.retained[role]['CONFIRMED.json'];self.retained[role]['CONFIRMED.json']=b'{}'
            with self.assertRaises(ValueError):self.inspect('confirm')
            self.retained[role]['CONFIRMED.json']=old
        with self.assertRaises(ValueError):self.inspect('confirm',retained={'funding':self.retained['migration'],'migration':self.retained['funding']})
        changed=copy.deepcopy(self.confirm);changed['migration']['result']['executionCode']='1';self.confirm=changed
        with self.assertRaises(ValueError):self.inspect('confirm')

    def test_context_and_verifier_paths_cannot_splice_other_originals(self):
        before=copy.deepcopy(self.confirm);self.confirm['funding']['verifierArguments'][1]='/foreign/context.json'
        with self.assertRaises(ValueError):self.inspect('confirm')
        self.confirm=before
        context=copy.deepcopy(self.context);context['lightTrust']['originalGenesisHash']='0'*64
        with self.assertRaises(ValueError):self.inspect('confirm',context_raw=raw(context))
        original=copy.deepcopy(self.pair.result);original['fundingWire']['sha256']='0'*64
        forged=raw(dict(body=base64.b64encode(raw(original)).decode(),mac=base64.b64encode(b'F'*32).decode()))
        with self.assertRaisesRegex(ValueError,'file bytes differ'):self.inspect('confirm',result_original_raw=forged)

    def test_audit_stops_at_missing_original_reservation_and_preserves_first_cause(self):
        missing=dict(originalLedgerReadOnly=True,originalPairReservationObserved=False,originalPairByteBindingsObserved=True,
                     originalFirstCauseSHA256='a'*64,missingEvidence=['originalPairReservation'])
        with mock.patch.object(m.p,'audit_durable_pair',return_value=missing),mock.patch.object(m.c,'read',side_effect=AssertionError('no later file IO')):
            out=m.audit_reply(raw(self.reply()),0,operation='recover',durable={},original={},enabled=True)
        self.assertEqual(out['originalFirstCauseSHA256'],'a'*64);self.assertEqual(out['missingEvidence'],['originalPairReservation'])
        self.assertFalse(out['nonceReleased'] or out['normalCalleeInvoked'])

    def test_original_driver_stopped_database_and_original_outbox_feed_recovery_join(self):
        self.original_driver_join(t.m.SOURCE)

    def test_integrated_source_is_preserved_without_borrowing_predecessor_provenance(self):
        controls=module('test_pq_durable_enrollment_reservation.py')
        helper=controls.DurableEnrollmentReservationControls();helper.setUp();self.addCleanup(helper.doCleanups)
        ledger,row,_,_=helper.fresh();request=helper.request(row)
        out=ledger.prepare_enrollment_pair(row['index'],request,sha(request),m.INSPECTED_CLI,40_000_002,enabled=True)
        self.assertEqual(out['sourceCommit'],m.INSPECTED_CLI);self.assertFalse(out['signingAuthorized'])
        reopened,before=helper.reopen(ledger);saved=reopened.read_enrollment_pair(row['index'],sha(request))
        self.assertEqual(saved['sourceCommit'],m.INSPECTED_CLI)
        self.assertEqual(saved['requestRaw'],request);self.assertFalse(saved['nonceReleased'])
        self.assertEqual(before,reopened.path.read_bytes())
        self.pair.binding['sourceCommit']=m.INSPECTED_CLI
        joined=self.pair.inspect();self.assertEqual(joined['sourceCommit'],m.INSPECTED_CLI)
        self.assertEqual(joined['requestABICommit'],m.p.contract.SOURCE);self.assertFalse(joined['sourceDeploymentQualified'])

    def original_driver_join(self,source):
        captured=[];audit=t.m.audit_durable_pair
        def original(*args,**kwargs):
            value=audit(*args,**kwargs)
            if value['originalPairReservationObserved']:captured.append((args,dict(kwargs)))
            return value
        # Reuse the actual small original driver/SQLite fixture, not a substitute
        # database report. Its controlled backend invokes no native producer.
        with mock.patch.object(t.m,'audit_durable_pair',side_effect=original):
            self.pair.test_actual_stopped_driver_funding_row_read_only_and_missing_db()
        positional,kwargs=captured[0]
        durable=dict(run_raw=positional[0],run_sha256=positional[1])
        for name in ('source_tools','plan_raw','accounting_raw','private_database','index'):durable[name]=kwargs.pop(name)
        request=kwargs['request_raw'];value=self.reply();value.update(result=self.pair.result,requestSHA256=sha(request),
            fundingOperationId=self.pair.request['fundingOperationId'],migrationOperationId=self.pair.request['migrationOperationId'])
        before=Path(durable['private_database']).read_bytes()
        out=m.audit_reply(raw(value),0,operation='recover',durable=durable,original=kwargs,enabled=True)
        self.assertTrue(out['originalLedgerReadOnly'] and out['originalPairReservationObserved'] and out['originalReplyByteBindingsObserved'])
        self.assertEqual(out['status'],'UNKNOWN');self.assertFalse(out['normalCalleeInvoked'] or out['nonceReleased'])
        self.assertEqual(before,Path(durable['private_database']).read_bytes())
        # An inspected ABI is not permission to relabel the original run or
        # the pre-sign SQLite reservation as a different producer source.
        changed=copy.deepcopy(kwargs);changed['binding']['sourceCommit']=('0a3a44f80159df800eeec8b54d200d982c5af762'
            if source==m.INSPECTED_CLI else m.INSPECTED_CLI)
        with self.assertRaisesRegex(ValueError,'source differs'):
            m.audit_reply(raw(value),0,operation='recover',durable=durable,original=changed,enabled=True)
        forged_durable=copy.deepcopy(durable);forged_durable['source_tools']['source']['commit']=changed['binding']['sourceCommit']
        run=json.loads(durable['run_raw']);run['source']=forged_durable['source_tools']['source']
        forged_durable['run_raw']=raw(run);forged_durable['run_sha256']=sha(raw(run))
        with self.assertRaisesRegex(ValueError,'request/source differs'):
            m.audit_reply(raw(value),0,operation='recover',durable=forged_durable,original=changed,enabled=True)
        self.assertEqual(before,Path(durable['private_database']).read_bytes())


if __name__=='__main__':unittest.main()
