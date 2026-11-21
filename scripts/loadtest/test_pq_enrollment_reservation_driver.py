"""Original driver/FD/socket controls; no Core cryptography or real custody."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

t=module('test_pq_enrollment_reservation_transport.py');m=t.m
driver=module('pq-independent-load.py');raw=m.original.canonical;sha=m.b.sha


class EnrollmentReservationDriverControls(unittest.TestCase):
    def setUp(self):
        self.fixture=t.EnrollmentReservationTransportControls();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.root=self.fixture.root;self.base=self.fixture.base
        self.source=self.base/'source';(self.source/'internal/consensus').mkdir(parents=True)
        (self.root/'workload/private-senders').mkdir(mode=0o700)
        self.credential=self.root/'workload/private-senders/recovery.raw';self.credential.write_bytes(b'U'*32);self.credential.chmod(0o600)
        self.fd=os.open(self.credential,os.O_RDONLY);self.addCleanup(os.close,self.fd)
        self.cli=self.base/'original-control-cli';self.cli.write_bytes(b'#!/bin/sh\nexit 91\n');self.cli.chmod(0o700)
        self.calls=0;self.resources=[]

    def binary(self,*,before='',after=''):
        self.calls+=1;path=self.base/('control-test-'+str(self.calls))
        text='''import os,sys,socket,json,hashlib,base64
env=os.environ
assert sys.argv[1:]==['-test.run','^TestPQLabEnrollmentOriginalCLIConfirmAndRestart$','-test.count=1','-test.timeout=240s','-test.v']
credential=int(env['YNX_PQ_ENROLLMENT_CREDENTIAL_FD']);cli=int(env['YNX_PQ_ENROLLMENT_CLI_FD']);channel=int(env['YNX_PQ_ENROLLMENT_RESERVATION_FD'])
assert len({credential,cli,channel})==3
assert os.pread(credential,32,0)==b'U'*32
assert hashlib.sha256(os.pread(cli,100,0)).hexdigest()==env['YNX_PQ_ENROLLMENT_CLI_SHA256']
assert env['YNX_PQ_ENROLLMENT_PRIVATE_FIXTURE_MODE']=='synthetic-perf-handshake'
root=env['YNX_PQ_ENROLLMENT_PRIVATE_FIXTURE_ROOT'];source=env['YNX_PQ_ENROLLMENT_SOURCE_COMMIT']
print('=== RUN   TestPQLabEnrollmentOriginalCLIConfirmAndRestart',flush=True)
s=socket.socket(fileno=channel);s.settimeout(4)
def encode(v):return json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()
def recv():
 b=bytearray()
 while not b.endswith(b'\\n'):
  p=s.recv(1)
  if not p:raise EOFError('original parent closed')
  b.extend(p)
 return json.loads(b)
'''+before+'''
ready=dict(version='YNX-PQ-ENROLLMENT-RESERVE-READY/v1',sourceCommit=source,root=root,planPath=root+'/network-plan.json',planSHA256=env['YNX_PQ_ENROLLMENT_PLAN_SHA256'],workloadPath=root+'/workload/PUBLIC-WORKLOAD.json',workloadSHA256=env['YNX_PQ_ENROLLMENT_WORKLOAD_SHA256'],ownerIndex=4,ownerAddress='UNIT-OWNER-4',nextNonce='2')
s.sendall(encode(ready)+b'\\n');i=recv()
r=dict(version='YNX-PQ-LAB-ENROLLMENT-REQUEST/v1',fundingOperationId=i['fundingOperationId'],migrationOperationId='c'*64,ownerIndex=4,fundingNonce='2',targetOwner='UNIT-TARGET',fundingAmount='3',activationHeight='9',pka=base64.b64encode(b'a'*2592).decode(),pkb=base64.b64encode(b'b'*64).decode())
f=dict(version='YNX-PQ-ENROLLMENT-RESERVE-REQUEST/v1',sourceCommit=source,index=i['index'],planSHA256=ready['planSHA256'],workloadSHA256=ready['workloadSHA256'],requestSHA256=hashlib.sha256(encode(r)).hexdigest(),request=r)
s.sendall(encode(f)+b'\\n');a=recv()
assert a['requestSHA256']==f['requestSHA256'] and a['signingAuthorized'] is False
s.close()
'''+(after or "print('--- PASS: TestPQLabEnrollmentOriginalCLIConfirmAndRestart (0.01s)\\nPASS',flush=True)\n")
        path.write_text('#!'+sys.executable+'\n'+text);path.chmod(0o700);return path

    def args(self,binary,**changes):
        value=dict(enabled=True,source=m.INSPECTED_SYNTHETIC_HANDSHAKE,source_directory=self.source,
            test_binary=binary,cli_binary=self.cli,root=self.root,plan_sha256=self.fixture.plan_pin,
            workload_sha256=self.fixture.workload_pin,credential_fd=self.fd,output=self.base/('output-'+str(self.calls)),
            check_resources=lambda:self.resources.append(time.monotonic_ns()),timeout=2)
        value.update(changes);return value

    @contextlib.contextmanager
    def bound(self,binary,*,test_pin=None):
        registry={(m.INSPECTED_SYNTHETIC_HANDSHAKE,m.original.platform.system(),m.original.platform.machine()):
                  dict(testSHA256=test_pin or sha(binary.read_bytes()),cliSHA256=sha(self.cli.read_bytes()))}
        source_check=mock.Mock(return_value=dict(commit=m.INSPECTED_SYNTHETIC_HANDSHAKE,tree='1'*40,forkTree='2'*40))
        loader=m.module
        def load(name):
            if name=='pq-normal-process-lab.py':return SimpleNamespace(lab=SimpleNamespace(check_source=source_check))
            return loader(name)
        with mock.patch.object(m,'SYNTHETIC_FIXTURE_BINARIES',registry),mock.patch.object(m,'module',side_effect=load):yield source_check

    def test_real_original_invoke_connects_three_fds_and_full_sqlite_before_ack(self):
        binary=self.binary();before=self.credential.read_bytes()
        with self.bound(binary) as source_check:out=m.run_synthetic_fixture(**self.args(binary))
        self.assertIsNone(out['firstCause']);self.assertTrue(out['normalFixtureProcessInvoked'] and out['normalFixtureTestPassed'])
        self.assertTrue(out['originalProcess']['processReaped'] and out['reservation']['reservationReturnObserved'])
        self.assertFalse(out['nonceReleased'] or out['normalCoreCLIProcessProof'] or out['sourceCIQualified'])
        self.assertEqual(self.credential.read_bytes(),before);self.assertGreater(len(self.resources),1)
        self.assertEqual(source_check.call_count,2);self.assertTrue(Path(out['database']['path']).is_file())

    def test_default_driver_dispatch_refuses_before_reading_private_inputs_or_spawning(self):
        args=['enrollment-reserve-synthetic','--synthetic','--execute','--source',m.INSPECTED_SYNTHETIC_HANDSHAKE,
            '--source-directory','/not-supplied','--test-binary','/not-supplied','--cli-binary','/not-supplied',
            '--root','/not-supplied','--plan-sha256','a'*64,'--workload-sha256','b'*64,'--output','/not-supplied','--credential-fd','99']
        result=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('pq-independent-load.py')),*args],capture_output=True,timeout=5)
        self.assertEqual(result.returncode,2,result.stderr);out=json.loads(result.stdout)
        self.assertFalse(out['normalFixtureProcessInvoked']);self.assertEqual(out['missingEvidence'],['ownerPinnedSameSourceSyntheticTestAndCLIBinaries'])

    def test_actual_driver_dispatch_uses_original_resource_callback_and_control_process(self):
        binary=self.binary();args=self.args(binary)
        argv=['enrollment-reserve-synthetic','--synthetic','--execute']
        for key in ('source','source_directory','test_binary','cli_binary','root','plan_sha256','workload_sha256','credential_fd','output','timeout'):
            argv.extend(['--'+key.replace('_','-'),str(args[key])])
        loader=driver.module
        with self.bound(binary),mock.patch.object(driver,'module',side_effect=lambda name,file:m if file=='pq-enrollment-reservation-transport.py' else loader(name,file)),contextlib.redirect_stdout(io.StringIO()) as stdout:
            code=driver.main(argv,enrollment_resource_observer=args['check_resources'])
        out=json.loads(stdout.getvalue());self.assertEqual(code,2);self.assertTrue(out['normalFixtureTestPassed'])
        self.assertNotIn(str(self.root),stdout.getvalue());self.assertGreater(len(self.resources),1)

    def test_known_binary_without_actual_resource_owner_stays_closed(self):
        binary=self.binary()
        with self.bound(binary),mock.patch('subprocess.Popen',side_effect=AssertionError('no resource guard')):
            out=m.run_synthetic_fixture(**self.args(binary,check_resources=None))
        self.assertFalse(out['normalFixtureProcessInvoked']);self.assertEqual(out['missingEvidence'],['actualOriginalOwningResourceObserver'])

    def test_wrong_binary_and_existing_attempt_cannot_start_or_replace_original(self):
        binary=self.binary()
        with self.bound(binary,test_pin='f'*64),mock.patch('subprocess.Popen',side_effect=AssertionError('wrong executable')):
            out=m.run_synthetic_fixture(**self.args(binary))
        self.assertFalse(out['normalFixtureProcessInvoked']);self.assertIn('executable bytes',out['firstCause']['message'])
        marker=self.root/'SYNTHETIC-ENROLLMENT-ATTEMPT.json';marker.write_bytes(b'UNKNOWN')
        with self.bound(binary),mock.patch('subprocess.Popen',side_effect=AssertionError('no replay')):
            with self.assertRaisesRegex(ValueError,'never retry'):m.run_synthetic_fixture(**self.args(binary))
        self.assertEqual(marker.read_bytes(),b'UNKNOWN')

    def test_stdout_backpressure_is_drained_while_waiting_for_ready(self):
        binary=self.binary(before="sys.stdout.write('x'*200000+'\\n');sys.stdout.flush()")
        with self.bound(binary):out=m.run_synthetic_fixture(**self.args(binary))
        self.assertIsNone(out['firstCause']);self.assertTrue(out['normalFixtureTestPassed'])
        self.assertGreater((self.base/('output-'+str(self.calls))/'process/stdout.log').stat().st_size,200000)

    def test_timeout_or_truncation_preserves_original_phase_and_reaps_same_child(self):
        for before,kind in (("import time;time.sleep(30)",'TimeoutError'),("sys.stdout.write('x'*(2<<20));sys.stdout.flush()",'ValueError')):
            binary=self.binary(before=before)
            with self.bound(binary):out=m.run_synthetic_fixture(**self.args(binary,timeout=.15 if kind=='TimeoutError' else 2))
            self.assertEqual(out['firstCause']['type'],kind);self.assertTrue(out['originalProcess']['processReaped'])
            self.assertFalse(out['normalFixtureTestPassed'] or out['nonceReleased'])

    def test_guard_failure_after_output_eof_does_not_wait_unobserved_for_child(self):
        signal=self.base/'closed-pipes';binary=self.binary(after="from pathlib import Path\nPath("+repr(str(signal))+").write_text('closed')\nos.close(1);os.close(2)\nimport time;time.sleep(30)\n")
        def guard():
            if signal.exists():raise RuntimeError('UNIT original resource observer refusal')
        with self.bound(binary):out=m.run_synthetic_fixture(**self.args(binary,check_resources=guard))
        self.assertTrue(out['reservation']['ackSendCompleted']);self.assertIn('resource observer refusal',out['firstCause']['message'])
        self.assertTrue(out['originalProcess']['processReaped']);self.assertFalse(out['normalFixtureTestPassed'])


if __name__=='__main__':unittest.main()
