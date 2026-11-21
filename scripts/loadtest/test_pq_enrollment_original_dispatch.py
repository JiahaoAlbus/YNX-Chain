"""Original driver CLI dispatch; CONTROL children are not Core qualification."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import signal
import unittest
from unittest import mock

import importlib.util
def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
t=module('test_pq_enrollment_original_transport.py');m=t.m
driver=module('pq-independent-load.py');raw=m.canonical;sha=m.b.sha


class EnrollmentOriginalDispatchControls(unittest.TestCase):
    def setUp(self):
        self.control=t.EnrollmentOriginalTransportControls();self.control.setUp();self.addCleanup(self.control.doCleanups)
        self.root=self.control.root;self.count=0
    def bundle(self,operation='recover',proof_inputs=None):
        self.count+=1;directory=self.root/('dispatch-inputs-'+str(self.count));directory.mkdir(mode=0o700)
        d=self.control.durable;o=self.control.original
        values=dict(runReceipt=d.get('run_raw',b'{}'),plan=d['plan_raw'],accounting=d.get('accounting_raw',b'{}'),
            binding=raw(o['binding']),request=o['request_raw'],workload=o['workload_raw'],context=o['context_raw'],
            fundingExpected=o['expected_raws']['funding'],migrationExpected=o['expected_raws']['migration'])
        files={}
        for name,data in values.items():
            path=directory/(name+'.json');self.control.write(path,data)
            files[name]=dict(path=str(path),bytes=len(data),sha256=sha(data))
        source_tools=d.get('source_tools',dict(source=dict(commit=m.INSPECTED_CLI,tree='1'*40,forkTree='2'*40),
            tools=dict(commit='3'*40,tree='4'*40,driverSHA256='5'*64,resourceGuardSHA256='6'*64)))
        value=dict(schema=m.INPUT_SCHEMA,sourceCommit=m.INSPECTED_CLI,operation=operation,root=str(self.root),
            index=d.get('index',0),sourceTools=source_tools,privateDatabase=str(d.get('private_database',self.root/'missing.sqlite')),
            originalDirectory=str(o['parent_directory']),files=files,proofInputs=proof_inputs)
        path=directory/'inputs.json';self.control.write(path,raw(value));return path,value
    def argv(self,path,binary,output,execute=True):
        return (['--execute'] if execute else [])+['--inputs',str(path),'--inputs-sha256',sha(path.read_bytes()),
            '--binary',str(binary),'--output',str(output),'--credential-fd',str(self.control.fd),'--timeout','2']
    def dispatch(self,argv):
        original=driver.module
        def route(name,file):return m if file=='pq-enrollment-original-command.py' else original(name,file)
        output=io.StringIO()
        with mock.patch.object(driver,'module',side_effect=route),mock.patch.object(driver,'run',side_effect=AssertionError('no new load')), \
             mock.patch.object(driver.lab,'Window',side_effect=AssertionError('no Window')),contextlib.redirect_stdout(output):
            code=driver.main(['enrollment-original']+argv)
        return code,json.loads(output.getvalue())
    def gate(self,binary):return dict(source=m.INSPECTED_CLI,chainCI=1001,resourceCI=1002,
        binaries={(m.platform.system(),m.platform.machine()):sha(binary.read_bytes())})
    def through_cli(self,binary,*,real_audit=False,**changes):
        path,_=self.bundle(changes.get('operation','recover'),changes.get('proof_inputs'))
        output=self.root/('dispatch-output-'+str(self.count))
        with mock.patch.object(m,'NORMAL_ORIGINAL_CALLEE',self.gate(binary)):
            if real_audit:code,public=self.dispatch(self.argv(path,binary,output))
            else:
                with mock.patch.object(m.p,'audit_durable_pair',return_value=self.control.observed):
                    code,public=self.dispatch(self.argv(path,binary,output))
        self.assertEqual(code,2);self.assertEqual(public['status'],'UNKNOWN');self.assertFalse(public['nonceReleased'])
        self.assertNotIn(str(self.root),json.dumps(public));self.assertTrue(public['inputManifestObserved'])
        dispatch=json.loads((output/'dispatch.json').read_bytes())
        self.assertEqual(dispatch['inputManifestSHA256'],sha(path.read_bytes()))
        return dispatch['result']

    def test_actual_normal_driver_command_defaults_closed_before_io_or_new_window(self):
        path,_=self.bundle();binary=self.control.helper();out=self.root/'never-created'
        with mock.patch.object(m.c,'read',side_effect=AssertionError('no input IO')),mock.patch('subprocess.Popen',side_effect=AssertionError('no process')):
            code,value=self.dispatch(self.argv(path,binary,out))
        self.assertEqual(code,2);self.assertFalse(value['normalCalleeInvoked'] or value['inputManifestObserved']);self.assertFalse(out.exists())
        self.assertIsNone(m.NORMAL_ORIGINAL_CALLEE)

    def test_explicit_execute_required_even_with_control_source_gate(self):
        path,_=self.bundle();binary=self.control.helper()
        with mock.patch.object(m,'NORMAL_ORIGINAL_CALLEE',self.gate(binary)),mock.patch.object(m.c,'read',side_effect=AssertionError('no IO')):
            code,value=self.dispatch(self.argv(path,binary,self.root/'none',execute=False))
        self.assertEqual(code,2);self.assertEqual(value['missingEvidence'],['explicitOriginalRecoveryOptIn'])

    def test_real_driver_cli_subprocess_cannot_open_gate_from_environment(self):
        path,_=self.bundle();binary=self.control.helper();output=self.root/'never-opened'
        env=dict(os.environ,NORMAL_ORIGINAL_CALLEE='qualified',YNX_ENROLLMENT_SOURCE=m.INSPECTED_CLI)
        result=subprocess.run([sys.executable,'-B',str(Path(driver.__file__)),'enrollment-original']+self.argv(path,binary,output),
            env=env,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,2);self.assertEqual(result.stderr,b'')
        value=json.loads(result.stdout);self.assertEqual(value['status'],'UNKNOWN');self.assertFalse(value['normalCalleeInvoked']);self.assertFalse(output.exists())

    def test_complete_private_manifest_preserves_original_pin_and_byte_inputs(self):
        path,value=self.bundle();args=m.load_original_inputs(path,sha(path.read_bytes()))
        self.assertEqual(args['source'],m.INSPECTED_CLI);self.assertEqual(args['original']['request_raw'],self.control.original['request_raw'])
        self.assertEqual(args['original']['expected_raws'],self.control.original['expected_raws'])
        self.assertEqual(args['durable']['private_database'],value['privateDatabase'])
        for changes in ({'sourceCommit':'f'*40},{'index':True},{'extra':1}):
            changed=dict(value,**changes);self.control.write(path,raw(changed))
            with self.assertRaises(ValueError):m.load_original_inputs(path,sha(path.read_bytes()))

    def test_changed_missing_and_symlink_inputs_are_unknown_without_process(self):
        binary=self.control.helper()
        for mode in ('digest','missing','symlink','duplicate','public-mode'):
            with self.subTest(mode=mode):
                path,value=self.bundle();request=Path(value['files']['request']['path'])
                if mode=='digest':self.control.write(request,b'{}')
                elif mode=='missing':request.unlink()
                elif mode=='symlink':
                    request.rename(request.with_suffix('.saved'));request.symlink_to(request.with_suffix('.saved'))
                elif mode=='duplicate':self.control.write(path,raw(value)[:-1]+b',"index":0}')
                else:path.chmod(0o644)
                with mock.patch.object(m,'NORMAL_ORIGINAL_CALLEE',self.gate(binary)),mock.patch('subprocess.Popen',side_effect=AssertionError('no child')):
                    code,public=self.dispatch(self.argv(path,binary,self.root/('none-'+mode)))
                self.assertEqual(code,2);self.assertFalse(public['normalCalleeInvoked']);self.assertIsNotNone(public['firstCauseType'])

    def test_original_driver_stopped_sqlite_through_actual_cli_fd_child(self):
        self.control.call=self.through_cli
        self.control.test_actual_original_driver_stopped_db_to_real_fd_child_and_reply_join()

    def test_normal_cli_partial_confirmation_keeps_unknown_and_original_failure(self):
        self.control.call=self.through_cli
        self.control.test_partial_confirm_and_unknown_reply_preserve_phase_without_reconstructing_file()

    def test_actual_cli_signal_preserves_unknown_and_retires_original_child(self):
        # Signal directly after this CONTROL child has read the original FD
        # and command. Polling an external-disk marker can arrive after the
        # real process deadline and would correctly preserve TimeoutError.
        body='import signal,time\nos.kill(os.getppid(),signal.SIGTERM)\ntime.sleep(30)\n'
        child=self.control.helper(body);before=signal.getsignal(signal.SIGTERM)
        out=self.through_cli(child)
        self.assertEqual(out['firstCause']['type'],'InterruptedError')
        self.assertTrue(out['normalCalleeInvoked'] and out['process']['processReaped'])
        self.assertFalse(out['nonceReleased']);self.assertEqual(signal.getsignal(signal.SIGTERM),before)

    def test_existing_finite_cli_still_calls_original_run_with_same_options(self):
        argv=['--source','/UNIT','--commit','1'*40,'--mode','online','--seconds','1','--accounts','1','--per-account','1']
        output=io.StringIO()
        with mock.patch.object(driver,'run',return_value={'UNIT':'original finite prepared result'}) as run, \
             mock.patch.object(driver.signal,'signal'),contextlib.redirect_stdout(output):
            self.assertEqual(driver.main(argv),0)
        args=run.call_args.args[0];self.assertEqual((args.source,args.mode,args.seconds,args.accounts,args.per_account),('/UNIT','online',1,1,1))
        self.assertFalse(args.execute or args.durable_accounting);self.assertEqual(json.loads(output.getvalue()),{'UNIT':'original finite prepared result'})


if __name__=='__main__':unittest.main()
