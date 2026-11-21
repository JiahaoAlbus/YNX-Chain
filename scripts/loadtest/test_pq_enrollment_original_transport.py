"""Actual bounded child/FD controls, never a crypto or Core CLI substitute."""
import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
t=module('test_pq_enrollment_original_command.py');m=t.m
raw=m.canonical;sha=m.b.sha


class EnrollmentOriginalTransportControls(unittest.TestCase):
    def setUp(self):
        self.abi=t.EnrollmentOriginalCommandControls();self.abi.setUp();self.addCleanup(self.abi.doCleanups)
        self.pair=self.abi.pair;self.root=self.pair.parent.parents[1];(self.root/'workload').mkdir()
        (self.root/'sender-public').rename(self.root/'workload/sender-public');self.pair.parent=self.root/'workload/sender-public/0004'
        self.pair.binding['sourceCommit']=m.INSPECTED_CLI
        self.plan_raw=b'{"UNIT":"controlled original network plan"}';self.plan_pin=sha(self.plan_raw)
        self.write(self.root/'network-plan.json',self.plan_raw)
        self.write(self.root/'workload/PUBLIC-WORKLOAD.json',raw(self.pair.workload))
        credentials=self.root/'workload/private-senders';credentials.mkdir(mode=0o700)
        self.credential=credentials/'recovery.raw';self.write(self.credential,b'U'*32)
        self.fd=os.open(self.credential,os.O_RDONLY);self.addCleanup(os.close,self.fd)
        self.original=self.pair.args()
        for key in ('funding_row','sponsor_account','enabled'):self.original.pop(key)
        self.durable=dict(plan_raw=raw(dict(plan=dict(networkPlanSHA256=self.plan_pin))))
        self.reply=self.abi.reply();self.reply['result']=self.pair.result
        self.observed=dict(originalPairByteBindingsObserved=True,originalPairReservationObserved=True,
                           originalLedgerReadOnly=True,originalFirstCauseSHA256='f'*64,missingEvidence=[])
    def write(self,path,data):path.write_bytes(data);path.chmod(0o600)
    def script(self,body):
        path=self.root/('control-'+str(len(list(self.root.glob('control-*')))))
        path.write_text('#!'+sys.executable+'\n'+body);path.chmod(0o700);return path
    def helper(self,body=''):
        # Real descriptor and original command are consumed by a CONTROL child.
        # None of this asserts Core custody/HMAC/cryptography was executed.
        return self.script("import os,sys,json\na=sys.argv\nassert a[1:3]==['enrollment-original','--synthetic']\nfd=int(a[a.index('--credential-fd')+1])\nassert os.pread(fd,32,0)==b'U'*32\nline=sys.stdin.buffer.readline()\nr=json.loads(line)\nassert r['requestSHA256']=="+repr(self.abi.pin)+"\n"+body)
    def call(self,binary,*,real_audit=False,frozen_binary_pin=None,**changes):
        args=dict(enabled=True,source=m.INSPECTED_CLI,binary=binary,root=self.root,plan_sha256=self.plan_pin,
            workload_sha256=sha(raw(self.pair.workload)),credential_fd=self.fd,operation='recover',durable=self.durable,
            original=self.original,output=self.root/('evidence-'+str(len(list(self.root.glob('evidence-*'))))),timeout=2)
        args.update(changes)
        gate=dict(source=m.INSPECTED_CLI,chainCI=1001,resourceCI=1002,
            binaries={(m.platform.system(),m.platform.machine()):frozen_binary_pin or sha(binary.read_bytes())})
        with mock.patch.object(m,'NORMAL_ORIGINAL_CALLEE',gate):
            if real_audit:return m.normal_original(**args)
            with mock.patch.object(m.p,'audit_durable_pair',return_value=self.observed):return m.normal_original(**args)

    def test_original_credential_fd_read_normal_argv_and_raw_reply_retained(self):
        child=self.helper('sys.stdout.buffer.write('+repr(raw(self.reply))+')\n')
        before=self.credential.read_bytes();out=self.call(child)
        self.assertTrue(out['normalCalleeInvoked'] and out['process']['processReaped'] and out['credentialFDPassed'])
        self.assertFalse(out['credentialBytesReadByParent'] or out['nonceReleased'] or out['recordMACAuthenticated'])
        self.assertTrue(out['originalReplyByteBindingsObserved']);self.assertIsNone(out['firstCause'])
        self.assertEqual(out['originalFirstCauseSHA256'],'f'*64);self.assertEqual(self.credential.read_bytes(),before)
        self.assertEqual((self.root/'evidence-0/stdout.log').read_bytes(),raw(self.reply))
        self.assertTrue((self.root/'evidence-0/readback.json').is_file());self.assertEqual(os.pread(self.fd,32,0),before)

    def test_default_missing_frozen_source_fails_before_fd_read_or_process(self):
        with mock.patch.object(m.os,'dup',side_effect=AssertionError('no credential')),mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):
            out=m.normal_original(enabled=True,source=m.INSPECTED_CLI,credential_fd=self.fd)
        self.assertFalse(out['normalCalleeInvoked']);self.assertIsNone(m.NORMAL_ORIGINAL_CALLEE)
        child=self.helper()
        with self.assertRaisesRegex(ValueError,'exact original source'):self.call(child,source='f'*40)
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):out=self.call(child,frozen_binary_pin='0'*64)
        self.assertFalse(out['normalCalleeInvoked']);self.assertIn('binary differs',out['firstCause']['message'])

    def test_missing_pair_reservation_and_wrong_original_pins_cannot_spawn(self):
        child=self.helper();self.observed['originalPairReservationObserved']=False;self.observed['missingEvidence']=['originalPairReservation']
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):out=self.call(child)
        self.assertEqual(out['missingEvidence'],['originalPairReservation'])
        self.observed['originalPairReservationObserved']=True
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):
            with self.assertRaises(ValueError):self.call(child,plan_sha256='e'*64)

    def test_wrong_credential_inode_and_mode_are_refused_without_consumption(self):
        child=self.helper();other=self.root/'other.raw';self.write(other,b'U'*32);fd=os.open(other,os.O_RDONLY)
        try:
            with mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):out=self.call(child,credential_fd=fd)
            self.assertFalse(out['normalCalleeInvoked']);self.assertIn('credential identity',out['firstCause']['message'])
        finally:os.close(fd)
        self.credential.chmod(0o644)
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):out=self.call(child)
        self.assertFalse(out['normalCalleeInvoked'])

    def test_actual_exclusive_lease_conflict_is_retained_without_retry(self):
        import fcntl
        lock=self.pair.parent/'.writer.lock';self.write(lock,b'');held=os.open(lock,os.O_RDWR)
        fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.addCleanup(os.close,held)
        child=self.helper("import fcntl\nf=os.open("+repr(str(lock))+",os.O_RDWR)\ntry:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError:\n sys.stderr.write('UNIT original lease busy')\n sys.exit(7)\nraise AssertionError('lease was not held')\n")
        out=self.call(child);self.assertEqual(out['process']['returnCode'],7)
        self.assertFalse(out['nonceReleased']);self.assertEqual(out['originalFirstCauseSHA256'],'f'*64)
        self.assertEqual((self.root/'evidence-0/stderr.log').read_bytes(),b'UNIT original lease busy')

    def test_truncated_reply_and_nonzero_exit_never_become_success(self):
        for body in ("sys.stdout.write('{\"version\":')\n",'sys.stdout.buffer.write('+repr(raw(self.reply))+');sys.exit(4)\n'):
            out=self.call(self.helper(body));self.assertIsNotNone(out['firstCause']);self.assertFalse(out['nonceReleased'])
            self.assertTrue(out['process']['processReaped']);self.assertEqual(out['status'],'UNKNOWN')

    def test_timeout_and_cancellation_reap_only_original_child_and_keep_first_cause(self):
        child=self.helper('import time\ntime.sleep(30)\n');started=time.monotonic();out=self.call(child,timeout=.1)
        self.assertLess(time.monotonic()-started,3);self.assertEqual(out['firstCause']['type'],'TimeoutError')
        self.assertTrue(out['process']['processReaped']);self.assertFalse(out['process']['cleanupDebt'])
        stop=threading.Event();timer=threading.Timer(.1,stop.set);timer.start()
        try:out=self.call(child,stop=stop)
        finally:timer.join()
        self.assertEqual(out['firstCause']['type'],'InterruptedError');self.assertFalse(out['nonceReleased'])

    def test_reply_output_bound_retains_original_prefix_and_unknown(self):
        out=self.call(self.helper("sys.stdout.write('x'*(2<<20));sys.stdout.flush()\n"))
        self.assertTrue(out['process']['outputTruncated']);self.assertFalse(out['process']['outputComplete'])
        self.assertEqual((self.root/'evidence-0/stdout.log').stat().st_size,1<<20);self.assertFalse(out['nonceReleased'])

    def test_partial_confirm_and_unknown_reply_preserve_phase_without_reconstructing_file(self):
        inputs={};partial=self.pair.parent/self.pair.request['fundingOperationId']/'CONFIRMED.json'
        for role in m.ROLES:
            material=self.root/(role+'-materials.json');proof=self.root/(role+'-proof.json')
            self.write(material,b'{"UNIT":"material"}');self.write(proof,self.abi.proofs[role])
            inputs[role]=dict(materialsFile=str(material),materialsSHA256=sha(material.read_bytes()),
                proofFile=str(proof),proofSHA256=sha(proof.read_bytes()))
        failure=dict(version='YNX-PQ-LAB-ENROLLMENT-REPLY/v1',code='UNKNOWN',result=None,syntheticOnly=True,
            authorityGranted=False,currentEligibility='UNKNOWN',requestSHA256=self.abi.pin,failureStage='confirmation',proofFailureCode='commit_invalid')
        child=self.helper("from pathlib import Path\nPath("+repr(str(partial))+ ").write_bytes(b'UNIT partial original')\nsys.stdout.buffer.write("+repr(raw(failure))+")\n")
        out=self.call(child,operation='confirm',proof_inputs=inputs)
        self.assertEqual(out['failureStage'],'confirmation');self.assertEqual(out['proofFailureCode'],'commit_invalid')
        self.assertEqual(out['firstCause']['type'],'OriginalOperationUnknown');self.assertFalse(out['nonceReleased'])
        self.assertEqual(partial.read_bytes(),b'UNIT partial original')
        self.assertFalse((self.pair.parent/self.pair.request['migrationOperationId']/'CONFIRMED.json').exists())

    def test_real_control_child_dual_confirm_files_join_without_authenticating_mock_proof(self):
        inputs={};retained={}
        self.original['context_raw']=raw(self.abi.context)
        self.original['binding']['contextSHA256']=sha(self.original['context_raw'])
        for role in m.ROLES:
            material=self.root/(role+'-materials.json');proof=self.root/(role+'-proof.json')
            self.write(material,b'{"UNIT":"material"}');self.write(proof,self.abi.proofs[role])
            inputs[role]=dict(materialsFile=str(material),materialsSHA256=sha(material.read_bytes()),
                proofFile=str(proof),proofSHA256=sha(proof.read_bytes()))
            directory=self.pair.parent/self.pair.request[role+'OperationId']/'confirmation-proof'
            ctx=json.loads(self.abi.retained[role]['confirmation-proof/trust-context.json'])
            for key in ('migrationFile','genesisFile','stateFile','scheduleFile','trustedLightBlockFile'):
                ctx['lightTrust'][key]=str(directory/Path(ctx['lightTrust'][key]).name)
            context_raw=raw(ctx);export=copy.deepcopy(self.abi.confirm[role])
            export['context']=self.abi.file('trust-context.json',context_raw)
            export['verifierArguments']=['--trust-context',str(directory/'trust-context.json'),'--trust-context-sha256',sha(context_raw)]
            confirmed=raw(dict(body=base64.b64encode(raw(dict(export,version='YNX-PQ-LAB-ENROLLMENT-CONFIRMED/v1'))).decode(),
                               mac=base64.b64encode(b'U'*32).decode())) # CONTROL, never authenticated.
            values=dict(self.abi.retained[role]);values.update({'CONFIRMED.json':confirmed,
                'confirmation-proof/trust-context.json':context_raw,'confirmation-proof/PUBLIC-PROOF-INPUTS.json':raw(export)})
            retained.update({str(directory.parent/name):value for name,value in values.items()})
            self.abi.confirm[role]=export;self.abi.confirm[role+'Confirmed']=self.abi.file('CONFIRMED.json',confirmed)
        body="from pathlib import Path\nfiles="+repr(retained)+"\nfor name,data in files.items():\n p=Path(name);p.parent.mkdir(parents=True,exist_ok=True)\n f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n with os.fdopen(f,'wb') as o:o.write(data)\n"
        body+='sys.stdout.buffer.write('+repr(raw(self.abi.reply('confirm')))+')\n'
        out=self.call(self.helper(body),operation='confirm',proof_inputs=inputs)
        self.assertIsNone(out['firstCause']);self.assertTrue(out['normalCalleeInvoked'] and out['originalReplyByteBindingsObserved'])
        self.assertEqual(out['normalReplyCode'],'PROOF_CONFIRMED_DATA');self.assertEqual(out['status'],'UNKNOWN')
        self.assertFalse(out['recordMACAuthenticated'] or out['independentProofVerified'] or out['nonceReleased'])
        for name,data in retained.items():self.assertEqual(Path(name).read_bytes(),data)

    def test_output_retention_failure_cannot_replace_original_timeout(self):
        child=self.helper('import time\ntime.sleep(30)\n')
        with mock.patch.object(m.c.os,'fsync',side_effect=OSError('UNIT original fsync failure')):
            out=self.call(child,timeout=.1)
        self.assertEqual(out['firstCause']['type'],'TimeoutError');self.assertFalse(out['process']['originalOutputRetained'])
        self.assertTrue(out['process']['retentionErrors']);self.assertEqual(out['readbackRetention'],'NOT_RETAINED')
        import stat
        sync=m.c.os.fsync;root_info=self.root.stat();hit=[]
        def parent_failure(fd):
            info=os.fstat(fd)
            if stat.S_ISDIR(info.st_mode) and (info.st_dev,info.st_ino)==(root_info.st_dev,root_info.st_ino):
                hit.append(fd);raise OSError('UNIT new evidence parent directory barrier failed')
            return sync(fd)
        with mock.patch.object(m.c.os,'fsync',side_effect=parent_failure):
            out=self.call(self.helper('sys.stdout.buffer.write('+repr(raw(self.reply))+')\n'))
        self.assertEqual(len(hit),1);self.assertIn('parent directory barrier',out['firstCause']['message'])
        self.assertFalse(out['process']['originalOutputRetained']);self.assertFalse(out['nonceReleased'])

    def test_output_close_failure_preserves_timeout_original_child_and_cleanup_debt(self):
        child=self.script('import time\ntime.sleep(30)\n');fdopen=m.c.os.fdopen;closed=[]
        class CloseFailure:
            def __init__(self,stream):self.stream=stream
            def __getattr__(self,name):return getattr(self.stream,name)
            def close(self):
                self.stream.close();closed.append(True)
                raise OSError('UNIT original output close failed')
        def failing_output(fd,*args,**kwargs):
            stream=fdopen(fd,*args,**kwargs)
            # _invoke owns two unbuffered evidence writers. Popen's binary
            # pipes are constructed separately and remain the real streams.
            if args and args[0]=='wb':return CloseFailure(stream)
            return stream
        with mock.patch.object(m.c.os,'fdopen',side_effect=failing_output):out=self.call(child,timeout=.1)
        self.assertEqual(out['firstCause']['type'],'TimeoutError')
        self.assertTrue(out['normalCalleeInvoked'] and out['process']['processReaped'])
        self.assertTrue(out['process']['cleanupDebt']);self.assertEqual(len(closed),2)
        self.assertEqual(len(out['process']['cleanupErrors']),2)
        self.assertFalse(out['process']['originalOutputRetained'] or out['nonceReleased'])
        self.assertTrue((self.root/'evidence-0/readback.json').is_file())

    def test_actual_original_driver_stopped_db_to_real_fd_child_and_reply_join(self):
        pair_controls=t.t;driver_controls=pair_controls.module('test_pq_durable_load_accounting.py')
        original_module=pair_controls.module;make_plan=driver_controls.a.d.make_plan
        audit=pair_controls.m.audit_durable_pair;captured=[]
        def actual_plan(network,*args,**kwargs):return make_plan(self.plan_pin,*args,**kwargs)
        def actual_audit(*args,**kwargs):
            out=audit(*args,**kwargs)
            if out['originalPairReservationObserved']:captured.append((args,dict(kwargs)))
            return out
        def imported(name):return driver_controls if name=='test_pq_durable_load_accounting.py' else original_module(name)
        with mock.patch.object(pair_controls,'module',side_effect=imported),mock.patch.object(pair_controls.m,'SOURCE',m.INSPECTED_CLI), \
             mock.patch.object(driver_controls.a.d,'make_plan',side_effect=actual_plan),mock.patch.object(pair_controls.m,'audit_durable_pair',side_effect=actual_audit):
            self.pair.test_actual_stopped_driver_funding_row_read_only_and_missing_db()
        positional,kwargs=captured[0];self.durable=dict(run_raw=positional[0],run_sha256=positional[1])
        for name in ('source_tools','plan_raw','accounting_raw','private_database','index'):self.durable[name]=kwargs.pop(name)
        self.original=kwargs;self.abi.request=kwargs['request_raw'];self.abi.pin=sha(self.abi.request)
        self.reply=self.abi.reply();before=Path(self.durable['private_database']).read_bytes()
        child=self.helper('sys.stdout.buffer.write('+repr(raw(self.reply))+')\n')
        out=self.call(child,real_audit=True)
        self.assertTrue(out['normalCalleeInvoked'] and out['originalReplyByteBindingsObserved'] and out['originalPairReservationObserved'])
        self.assertIsNone(out['firstCause']);self.assertFalse(out['nonceReleased'] or out['recordMACAuthenticated'])
        self.assertEqual(before,Path(self.durable['private_database']).read_bytes())


if __name__=='__main__':unittest.main()
