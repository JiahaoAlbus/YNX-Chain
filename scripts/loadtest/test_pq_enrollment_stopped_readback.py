"""Actual SQLite/socket/filesystem controls; deliberately invalid crypto bytes."""
import base64
import copy
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=module('pq-enrollment-stopped-readback.py');r=module('test_pq_enrollment_reservation_transport.py')
commands=module('test_pq_enrollment_original_command.py')
raw=m.o.canonical;sha=m.b.sha
def b64(value):return base64.b64encode(value).decode()


class StoppedEnrollmentControls(unittest.TestCase):
    def setUp(self):
        self.reservation=r.EnrollmentReservationTransportControls();self.reservation.setUp()
        self.addCleanup(self.reservation.doCleanups)
        self.exchange,self.handshake,self.request=self.reservation.audit_case();self.root=self.reservation.root
        self.handshake.pop('pins');self.handshake.pop('enabled')
        self.handshake['originalLaunch']=dict(root=self.root,source=self.reservation.source,
            planSHA256=self.reservation.plan_pin,workloadSHA256=self.reservation.workload_pin)
        self.binary_pins=dict(testSHA256='1'*64,cliSHA256='2'*64)
        self.stopped=dict(originalProcessReaped=True,ownedDescendantsRetired=True,cleanupDebt=False,firstCause=None)
        self.command=commands.EnrollmentOriginalCommandControls();self.command.setUp();self.addCleanup(self.command.doCleanups)
        pair=self.command.pair;pair.parent=self.root/'workload/sender-public/0004'
        pair.request.clear();pair.request.update(self.request)
        pair.workload=copy.deepcopy(self.reservation.workload)
        pair.intent['registration'].update(Owner='UNIT-OWNER-4',ChainID=b64(bytes.fromhex('a'*64)))
        pair.update()
        self.material_bytes={field:('UNIT invalid '+field).encode() for field in m.MATERIAL_FILES}
        self.command.prepare_confirmation_controls(dict(consensusGenesisSHA256=sha(self.material_bytes['genesis']),
            originalGenesisHash='a'*64,migrationStateHash='b'*64,trustedLightBlockSHA256=sha(self.material_bytes['trustedLightBlock'])))
        self.layout=m.file_layout(self.exchange.pins,self.request);self.files={}
        common=dict(version='YNX-PQ-LOOPBACK-PROOF-MATERIALS/v1',**{k:b64(v) for k,v in self.material_bytes.items()},
            pins=dict(CometGenesisSHA256=sha(self.material_bytes['genesis']),OriginalGenesisHash='a'*64,MigrationStateHash='b'*64),
            scheduleHash='1'*64,engineHeight='6',engineAppHash=b64(bytes.fromhex('3'*64)),
            trustingPeriodNanoseconds='3600000000000',maxClockDriftNanoseconds='1000000000',trustNumerator='1',trustDenominator='3')
        inputs={}
        for role in m.o.ROLES:
            self.files[role+'/materials']=raw(dict(common,expected=pair.expected[role]))
            self.files[role+'/proof']=self.command.proofs[role]
            for name,value in pair.files[role].items():self.files[role+'/'+name]=value
            for name,value in self.command.retained[role].items():self.files[role+'/'+name]=value
            for field,name in m.MATERIAL_FILES.items():self.files[role+'/confirmation-proof/'+name]=self.material_bytes[field]
            inputs[role]=dict(materialsFile=str(self.layout[role+'/materials'][0]),materialsSHA256=sha(self.files[role+'/materials']),
                proofFile=str(self.layout[role+'/proof'][0]),proofSHA256=sha(self.files[role+'/proof']))
        request_raw=raw(self.request);request_pin=sha(request_raw)
        for operation in ('confirm','recover'):
            self.files['fixture-'+operation+'-command.json']=m.o.command(operation,request_raw,request_pin,root=self.root,
                proof_inputs=inputs if operation=='confirm' else None)[:-1]
            self.files['fixture-'+operation+'-reply.json']=raw(self.command.reply(operation))
        identity=dict(version='YNX-PRIVATE-SYNTHETIC-ENROLLMENT-FIXTURE/v1',sourceCommit=self.exchange.pins.source,
            binarySHA256=self.binary_pins['cliSHA256'],cliSourceBinding='EMBEDDED_VCS',testBinarySHA256=self.binary_pins['testSHA256'],
            testSourceBinding='NOT_ATTESTED',planSHA256=self.reservation.plan_pin,workloadSHA256=self.reservation.workload_pin,
            requestSHA256=request_pin,proofTrustExpiresAt='2001-01-01T00:00:00Z',testOutcome='NOT_ATTESTED',
            currentEligibility='UNKNOWN',syntheticOnly=True,preSignPerfReservation=False,authorityGranted=False)
        self.files['fixture-public-identity.json']=raw(identity)
        self.pins={}
        for name,value in self.files.items():self.write(name,value)
        self.before=self.exchange.ledger.path.read_bytes();self.resources=0

    def write(self,name,value,repin=True):
        path=self.layout[name][0];path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        path.write_bytes(value);path.chmod(0o600)
        if repin:self.pins[name]=dict(bytes=len(value),sha256=sha(value))

    def guard(self):self.resources+=1
    def inspect(self,**changes):
        args=dict(handshake=self.handshake,binary_pins=self.binary_pins,stopped=self.stopped,
            evidence_pins=self.pins,check_resources=self.guard,enabled=True)
        args.update(changes);return m.inspect_stopped(**args)

    def assert_unknown(self,out):
        self.assertEqual(out['status'],'UNKNOWN')
        for key in ('sourceCIQualified','normalCalleeInvoked','recordMACAuthenticated','independentProofVerified',
                    'nativeGrant','nonceReleased','automaticRetry','privateDataExported','resourceCapsQualified','normalReplyExitStatusObserved'):
            self.assertIs(out[key],False,key)
        self.assertEqual(self.before,self.exchange.ledger.path.read_bytes())

    def test_original_dual_confirmed_full_proof_and_cold_reply_join_never_release_pending(self):
        with mock.patch('subprocess.Popen',side_effect=AssertionError('readback cannot launch')):
            captured=m.capture_stopped_manifest(handshake=self.handshake,stopped=self.stopped,check_resources=self.guard,enabled=True)
            self.assertEqual(captured['evidencePins'],self.pins);self.assertEqual(captured['missingEvidence'],[])
            out=self.inspect(evidence_pins=captured['evidencePins'])
        self.assertTrue(out['bothConfirmationByteBindingsObserved'],out)
        self.assertTrue(out['originalPendingPreserved'] and out['bothOutboxByteBindingsObserved'] and out['coldRecoveryReplyBytesMatch'])
        self.assertGreater(self.resources,5);self.assert_unknown(out)
        # Even an expired stored fixture timestamp does not become current verification.
        self.assertEqual(out['trustProvenance'],'RETAINED_CORE_FIXTURE_FILES_ONLY_NOT_AUTHENTICATED')
        text=json.dumps(out);self.assertNotIn(str(self.root),text);self.assertNotIn('UNIT-OWNER-4',text)
        self.assertNotIn('UNIT invalid',text);self.assertNotIn('body',out)
        self.assertEqual(out['sourceCommit'],self.reservation.source)
        self.assertEqual(out['originalReservationPins']['database']['sha256'],self.handshake['database_pin']['sha256'])

    def test_capture_then_consume_entry_uses_originals_without_callee_or_authority(self):
        with mock.patch('subprocess.Popen',side_effect=AssertionError('stopped audit cannot launch')):
            out=m.audit_stopped_originals(handshake=self.handshake,binary_pins=self.binary_pins,
                stopped=self.stopped,check_resources=self.guard,enabled=True)
        self.assertTrue(out['bothConfirmationByteBindingsObserved'],out)
        self.assertTrue(out['originalPendingPreserved']);self.assert_unknown(out)

    def test_capture_close_failure_does_not_retry_and_body_first_cause_survives_close(self):
        original=m.c.held;target=self.layout['fixture-public-identity.json'][0];closed=[]
        @contextmanager
        def close_report_failure(path,limit,**kw):
            try:
                with original(path,limit,**kw) as value:yield value
            finally:
                if Path(path)==target:
                    closed.append(str(path));raise OSError('UNIT actual close succeeded, report failed')
        with mock.patch.object(m.c,'held',close_report_failure),mock.patch.object(m,'inspect_stopped',side_effect=AssertionError('no retry')):
            out=m.audit_stopped_originals(handshake=self.handshake,binary_pins=self.binary_pins,
                stopped=self.stopped,check_resources=self.guard,enabled=True)
        self.assertEqual(closed,[str(target)]);self.assertTrue(out['cleanupDebt'])
        self.assertEqual(out['firstCauseType'],'OSError');self.assertFalse(out['bothConfirmationByteBindingsObserved'])
        self.assert_unknown(out);closed.clear()
        with mock.patch.object(m.c,'held',close_report_failure),mock.patch.object(m,'_identity',side_effect=RuntimeError('UNIT primary body refusal')):
            out=self.inspect()
        self.assertEqual(closed,[str(target)]);self.assertTrue(out['cleanupDebt'])
        self.assertEqual(out['firstCauseType'],'RuntimeError')
        self.assertEqual(out['firstCauseSHA256'],sha(b'UNIT primary body refusal'))
        self.assertEqual(out['retentionErrors'],[dict(type='OSError',sha256=sha(b'UNIT actual close succeeded, report failed'))])
        self.assertFalse(out['bothConfirmationByteBindingsObserved']);self.assert_unknown(out)

    def test_missing_retirement_or_guard_refuses_before_private_reads(self):
        for key in ('originalProcessReaped','ownedDescendantsRetired','cleanupDebt'):
            stopped=dict(self.stopped);stopped[key]=key=='cleanupDebt'
            with mock.patch.object(m.r,'audit_private_reservation',side_effect=AssertionError('no private IO')):out=self.inspect(stopped=stopped)
            self.assertFalse(out['bothConfirmationByteBindingsObserved']);self.assertTrue(out['missingEvidence'])
        with mock.patch.object(m.r,'audit_private_reservation',side_effect=AssertionError('no IO')):out=self.inspect(check_resources=None)
        self.assertEqual(out['missingEvidence'],['originalReadScopeResourceObserver'])

    def test_partial_confirmation_and_partial_reply_keep_original_files_and_unknown(self):
        name='migration/CONFIRMED.json';path=self.layout[name][0];path.unlink()
        out=self.inspect();self.assertEqual(out['confirmedFilesObserved'],dict(funding=True,migration=False))
        self.assertIn(name,out['missingEvidence']);self.assertFalse(path.exists());self.assert_unknown(out)
        captured=m.capture_stopped_manifest(handshake=self.handshake,stopped=self.stopped,check_resources=self.guard,enabled=True)
        self.assertIn(name,captured['missingEvidence']);self.assertNotIn(name,captured['evidencePins'])
        self.assertFalse(path.exists())
        self.write(name,b'{"body":',repin=True)
        out=self.inspect();self.assertFalse(out['bothConfirmationByteBindingsObserved']);self.assertIsNotNone(out['firstCauseType'])
        self.assertEqual(path.read_bytes(),b'{"body":');self.assert_unknown(out)

    def test_request_dual_id_expected_or_full_proof_cannot_be_spliced(self):
        for name,change in (
            ('fixture-confirm-command.json',lambda v:v['request'].__setitem__('migrationOperationId','f'*64)),
            ('migration/confirmation-proof/request.json',lambda v:v['expected'].__setitem__('index','9')),
            ('fixture-confirm-reply.json',lambda v:v['result']['migrationConfirmed'].__setitem__('sha256','f'*64))):
            original=self.files[name];v=json.loads(original);change(v);self.write(name,raw(v))
            out=self.inspect();self.assertFalse(out['bothConfirmationByteBindingsObserved']);self.assertIsNotNone(out['firstCauseType'])
            self.assert_unknown(out);self.write(name,original)

    def test_same_source_binary_and_not_attested_fixture_flags_are_not_caller_authority(self):
        name='fixture-public-identity.json'
        for key,value in (('sourceCommit','f'*40),('binarySHA256','f'*64),('preSignPerfReservation',True),('testOutcome','PASS')):
            v=json.loads(self.files[name]);v[key]=value;self.write(name,raw(v))
            out=self.inspect();self.assertFalse(out['fixtureIdentityBytesMatch']);self.assert_unknown(out)
        self.write(name,self.files[name])

    def test_original_snapshot_pin_and_private_mode_links_remain_closed(self):
        name='funding/CONFIRMED.json';path=self.layout[name][0]
        self.write(name,self.files[name]+b' ',repin=False)
        self.assertFalse(self.inspect()['bothConfirmationByteBindingsObserved'])
        self.write(name,self.files[name]);path.chmod(0o644)
        self.assertFalse(self.inspect()['bothConfirmationByteBindingsObserved']);path.chmod(0o600)
        original=path.with_name('retained-confirmed');path.rename(original);path.symlink_to(original)
        self.assertFalse(self.inspect()['bothConfirmationByteBindingsObserved']);self.assert_unknown(self.inspect())

    def test_resource_failure_preserves_original_error_digest_and_database(self):
        self.stopped['firstCause']=dict(type='BrokenPipeError',message='UNIT first ACK unknown')
        def fail():raise RuntimeError('UNIT read resource refusal')
        out=self.inspect(check_resources=fail)
        self.assertEqual(out['originalFirstCauseSHA256'],sha(raw(self.stopped['firstCause'])))
        self.assertEqual(out['firstCauseType'],'RuntimeError');self.assert_unknown(out)

    def test_aggregate_bound_and_closed_file_manifest_refuse_without_following_extra_paths(self):
        self.pins['private-senders/recovery.raw']=dict(bytes=32,sha256='a'*64)
        out=self.inspect();self.assertFalse(out['bothConfirmationByteBindingsObserved']);self.assertIsNotNone(out['firstCauseType'])
        del self.pins['private-senders/recovery.raw']
        with mock.patch.object(m,'TOTAL_LIMIT',1):out=self.inspect()
        self.assertEqual(out['observedBytes'],0);self.assert_unknown(out)

    def test_actual_writer_crash_after_one_durable_confirmation_remains_readonly_unknown(self):
        for role in m.o.ROLES:self.layout[role+'/CONFIRMED.json'][0].unlink()
        destination=self.layout['funding/CONFIRMED.json'][0]
        code="""import os,sys
path=sys.argv[1];raw=sys.stdin.buffer.read(2<<20)
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
 while raw:
  n=os.write(fd,raw);assert n>0;raw=raw[n:]
 os.fsync(fd)
finally:os.close(fd)
folder=os.open(os.path.dirname(path),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
os.fsync(folder);os.close(folder)
os._exit(17)
"""
        child=subprocess.Popen([sys.executable,'-I','-c',code,str(destination)],stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        stdout,stderr=child.communicate(self.files['funding/CONFIRMED.json'],timeout=3)
        self.assertEqual(child.returncode,17,(stdout,stderr))
        self.stopped['firstCause']=dict(type='ControlledProcessExit',message='original control exited 17 after first record')
        original=destination.read_bytes();before=self.exchange.ledger.path.read_bytes()
        for _ in range(2):
            out=self.inspect() # Same read-only originals; no callee/retry/second write.
            self.assertEqual(out['confirmedFilesObserved'],dict(funding=True,migration=False))
            self.assertIn('migration/CONFIRMED.json',out['missingEvidence']);self.assert_unknown(out)
            self.assertEqual(out['originalFirstCauseSHA256'],sha(raw(self.stopped['firstCause'])))
        self.assertEqual(before,self.exchange.ledger.path.read_bytes());self.assertEqual(original,destination.read_bytes())
        self.assertFalse(self.layout['migration/CONFIRMED.json'][0].exists())

    def test_readonly_close_failure_keeps_debt_and_cannot_promote_complete_binding(self):
        original=m.d.open_readonly;calls=[]
        def opening(*args,**kwargs):
            value=original(*args,**kwargs);calls.append(value)
            if len(calls)==2:
                close=value.close
                def failed():close();raise OSError('UNIT original readonly close reporting failed')
                value.close=failed
            return value
        with mock.patch.object(m.d,'open_readonly',side_effect=opening):out=self.inspect()
        self.assertEqual(len(calls),2);self.assertTrue(out['cleanupDebt'])
        self.assertEqual(out['firstCauseType'],'OSError');self.assertFalse(out['bothConfirmationByteBindingsObserved'])
        self.assert_unknown(out)


if __name__=='__main__':unittest.main(verbosity=2)
