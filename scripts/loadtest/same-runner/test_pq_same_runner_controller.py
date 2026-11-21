"""Bounded controller contracts with synthetic metadata, never a window/source grant."""
from contextlib import ExitStack
import copy
import errno
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock
import urllib.request


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


c = module('pq-same-runner-controller')
original = module('pq-independent-load')


def arm():
    return dict(source='1'*40, sourceTree='2'*40, tools='3'*40, toolsTree='4'*40,
        go='go1.26.11', supplier='5'*40, supplierTree='6'*40,
        toolsCI=dict(run=100, job=101, source='3'*40, branch='codex/CONTROL-source-ci', event='workflow_dispatch'),
        toolPins={name:'a'*64 for name in c.REQUIRED_TOOL_PINS},
        sourceQualification=dict(source='1'*40, sourceTree='2'*40, run=200, job=201,
            requiredSteps=['CONTROL original source validation'], sourceOnlyQualified=True, runtimePermissionGranted=False))


def argparse_namespace(config, root):
    return types.SimpleNamespace(**dict(config['options'],source=str(root),execute=True))


def tools_metadata(binding):
    run = dict(id=binding['run'], head_sha=binding['source'], head_branch=binding['branch'],
        event=binding['event'], run_attempt=1, workflow_id=c.TOOL_CI_WORKFLOW_ID,
        repository=dict(full_name=c.REPOSITORY), path=c.TOOL_CI_WORKFLOW, status='completed', conclusion='success')
    job = dict(id=binding['job'], run_id=binding['run'], run_attempt=1, head_sha=binding['source'],
        name=c.TOOL_CI_JOB, status='completed', conclusion='success',
        steps=[dict(name=name,status='completed',conclusion='success') for name in c.REQUIRED_TOOL_STEPS])
    return run, job


def source_metadata(gate):
    """Synthetic three-endpoint shape; never queried or used as a source grant."""
    run = dict(id=gate.RUN, head_sha=gate.SOURCE, head_branch=gate.BRANCH,
        status='completed', conclusion='success', event='push', run_attempt=1,
        workflow_id=322643672, repository=dict(full_name=gate.REPOSITORY),
        path='.github/workflows/resource-market-ci.yml')
    focused = dict(run, id=gate.JOB, run_id=gate.RUN, name='focused-go',
        steps=[dict(name=name,status='completed',conclusion='success') for name in gate.REQUIRED_STEPS])
    delivery = dict(run, id=gate.JOB+1, run_id=gate.RUN, name='protocol-delivery',
        steps=[dict(name=name,status='completed',conclusion='success') for name in gate.DELIVERY_STEPS])
    return run, focused, dict(total_count=2, jobs=[focused,delivery])


class ControllerControls(unittest.TestCase):
    def setUp(self):
        no_network = mock.patch.object(urllib.request.OpenerDirector, 'open',
            side_effect=AssertionError('synthetic controller controls may not access network'))
        no_network.start(); self.addCleanup(no_network.stop)

    def test_exact_isolated_controller_root_without_importing_legacy_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            for suffix in ('scripts/loadtest/pq-same-runner-controller.py',
                           'scripts/loadtest/same-runner/pq-same-runner-controller.py'):
                self.assertEqual(c.controller_root(root/suffix),root)
            for suffix in ('scripts/other/same-runner/controller.py',
                           'scripts/loadtest/other/controller.py','other/controller.py'):
                with self.subTest(suffix=suffix),self.assertRaises(RuntimeError):c.controller_root(root/suffix)

    def test_default_cli_refuses_before_metadata_host_import_or_process(self):
        with mock.patch.object(c.bridge, 'QUALIFIED_PAIR_BINDING', None), \
                mock.patch.object(c, 'prepare') as prepare, mock.patch.object(c, 'ActionsMetadata') as api, \
                mock.patch.object(c.subprocess, 'Popen') as child:
            for arguments in ([], ['--execute']):
                if arguments:
                    with self.assertRaisesRegex(RuntimeError, 'NOT_SUPPLIED'): c.main(arguments)
                else:
                    plan = c.main(arguments)
                    self.assertFalse(plan['configured']); self.assertFalse(plan['runtimePermissionGranted'])
            prepare.assert_not_called(); api.assert_not_called(); child.assert_not_called()

    def test_configuration_full500_and_no_external_binding_override(self):
        value = arm(); config = c.configuration(value)
        self.assertEqual((config['options']['rate'],config['options']['seconds'],config['options']['accounts']), (100,5,500))
        self.assertIsNone(config['options']['prior_result']); self.assertFalse(config['options']['execute'])
        value['options'] = {'accounts':1}
        with self.assertRaisesRegex(RuntimeError, 'fields differ'): c.configuration(value)
        with mock.patch.object(c.bridge, 'QUALIFIED_PAIR_BINDING', None), \
                mock.patch.dict(os.environ, YNX_PAIR_BINDING='CONTROL', YNX_HELD_DISPATCH_PROFILE=c.PROFILE):
            with self.assertRaisesRegex(RuntimeError, 'NOT_SUPPLIED'): c.execute()

    def test_frozen_pair_keeps_supplier_toolchain_and_source_qualification(self):
        binding=dict(schema='YNX-PERF-ORIGINAL-PAIR-BINDING/v1',arms=dict(before=arm(),after=arm()))
        binding['arms']['after']['tools'] = '7'*40
        binding['arms']['after']['toolsCI']['source'] = '7'*40
        self.assertEqual(set(c.validate_binding(binding)), {'before','after'})
        for key, value in (('go','go1.26.10'),('supplierTree','b'*40),('supplier','c'*40)):
            changed=copy.deepcopy(binding);changed['arms']['after'][key]=value
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'conditions differ'):
                c.validate_binding(changed)
        changed=copy.deepcopy(binding);changed['arms']['after']['sourceQualification']['runtimePermissionGranted']=True
        with self.assertRaisesRegex(RuntimeError, 'source-only'):c.validate_binding(changed)

    def test_tools_ci_matches_exact_frozen_event_branch_run_job_and_steps(self):
        binding=arm()['toolsCI'];run,job=tools_metadata(binding)
        result=c.verify_tools_ci(binding,run,job)
        self.assertEqual(result['source'],binding['source'])
        mutations=[('run','head_sha','f'*40),('run','head_branch','codex/chain-batch-v01-performance'),
            ('run','event','push'),('run','run_attempt',True),('run','conclusion','failure'),
            ('run','workflow_id',1),('job','run_id',200),('job','head_sha','f'*40),
            ('job','id',102),('job','run_attempt',2),('job','conclusion',None)]
        for target,key,value in mutations:
            changed=[copy.deepcopy(run),copy.deepcopy(job)];changed[target=='job'][key]=value
            with self.subTest(target=target,key=key),self.assertRaises(RuntimeError):
                c.verify_tools_ci(binding,*changed)
        for mutation in ('missing','duplicate','skipped'):
            changed=copy.deepcopy(job)
            if mutation=='missing':changed['steps'].pop()
            elif mutation=='duplicate':changed['steps'].append(changed['steps'][0])
            else:changed['steps'][0]['conclusion']='skipped'
            with self.subTest(mutation=mutation),self.assertRaisesRegex(RuntimeError,'step incomplete'):
                c.verify_tools_ci(binding,run,changed)

    def test_tool_pins_read_real_files_reject_changes_links_and_missing_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();folder=root/'scripts/loadtest';folder.mkdir(parents=True)
            pins={}
            for name in c.REQUIRED_TOOL_PINS:
                raw=('# CONTROL '+name+'\n').encode();(folder/name).write_bytes(raw);pins[name]=c.reader.digest(raw)
            c.verify_tool_files(root,pins)
            changed=dict(pins);changed.pop('pq-staged-harness-controls.py')
            with self.assertRaisesRegex(RuntimeError,'TOOL_PINS required'):c.verify_tool_files(root,changed)
            path=folder/'pq-independent-load.py';path.write_bytes(b'# mutated CONTROL\n')
            with self.assertRaisesRegex(RuntimeError,'TOOL_PINS differs'):c.verify_tool_files(root,pins)
            path.unlink();path.symlink_to(folder/'consensus-linux-cohort.py')
            with self.assertRaises((RuntimeError,OSError)):c.verify_tool_files(root,pins)

    def test_checkout_real_git_rejects_dirty_and_wrong_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()
            subprocess.run(['git','init','-q',str(root)],check=True)
            (root/'CONTROL.txt').write_text('synthetic checkout only\n')
            subprocess.run(['git','-C',str(root),'add','CONTROL.txt'],check=True)
            subprocess.run(['git','-C',str(root),'-c','user.name=CONTROL','-c','user.email=control@example.invalid',
                            'commit','-qm','Synthetic local checkout control'],check=True)
            commit,tree=c.git(root,'rev-parse','HEAD'),c.git(root,'rev-parse','HEAD^{tree}')
            c.checkout(root,commit,tree)
            with self.assertRaisesRegex(RuntimeError,'tree differs'):c.checkout(root,commit,'f'*40)
            (root/'untracked-CONTROL').write_text('dirty must be preserved')
            with self.assertRaisesRegex(RuntimeError,'clean original'):c.checkout(root,commit,tree)
            self.assertTrue((root/'untracked-CONTROL').exists())

    def test_original_fresh_admission_uses_retained_physical_bytes_and_owned_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();(parent/'retained').mkdir();(parent/'retained/original-UNKNOWN').write_bytes(b'control')
            lab=original.lab;pid=os.getpid()
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                    mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                    mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                    mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                    mock.patch.object(c,'probe_original_ports'):
                admission=c.FreshAdmission(lab,parent);admission((parent,parent/'retained'))
                self.assertEqual(admission.samples[0]['roots'],[str(parent)])
                self.assertGreaterEqual(admission.samples[0]['retainedPhysicalBytes'],7)
                with mock.patch.object(lab,'private_bytes',return_value=(8<<30)+1):
                    with self.assertRaisesRegex(RuntimeError,'unchanged cap'):admission((parent,))
                with mock.patch.object(lab,'owned_rss',return_value=(4<<30)+1):
                    with self.assertRaisesRegex(RuntimeError,'unchanged cap'):admission((parent,))
                rows[pid+1]=dict(pid=pid+1,parent=pid,startTicks=2,state='S',threads=1,comm='python')
                with self.assertRaisesRegex(RuntimeError,'owned child remains'):admission((parent,))
                self.assertTrue((parent/'retained/original-UNKNOWN').exists())

    def test_original_port_probe_checks_exact_twelve_ports_and_closes_them(self):
        made=[]
        class Probe:
            def __init__(self):self.address=None;self.closed=False;made.append(self)
            def bind(self,address):self.address=address
            def close(self):self.closed=True
        with mock.patch.object(c.socket,'socket',side_effect=Probe):c.probe_original_ports()
        self.assertEqual([p.address for p in made],
                         [('127.0.0.1',base+i) for base in (31656,31757,31858) for i in range(4)])
        self.assertTrue(all(p.closed for p in made))

    def test_failed_port_probe_closes_the_failed_socket_too(self):
        made=[];error=OSError(errno.EADDRINUSE,'original port busy')
        class Probe:
            def __init__(self):self.closed=False;made.append(self)
            def bind(self,address):
                if len(made)==4:raise error
            def close(self):self.closed=True
        with mock.patch.object(c.socket,'socket',side_effect=Probe):
            with self.assertRaises(OSError) as caught:c.probe_original_ports()
        self.assertIs(caught.exception,error);self.assertEqual(len(made),4)
        self.assertTrue(all(p.closed for p in made))

    def test_port_probe_cleanup_failure_closes_other_sockets_and_refuses(self):
        made=[];busy=OSError(errno.EADDRINUSE,'original port busy')
        class Probe:
            def __init__(self):self.closed=False;self.index=len(made);made.append(self)
            def bind(self,address):
                if self.index==3:raise busy
            def close(self):
                self.closed=True
                if self.index==1:raise OSError('original close failure')
        with mock.patch.object(c.socket,'socket',side_effect=Probe):
            with self.assertRaisesRegex(RuntimeError,'socket cleanup failed') as caught:c.probe_original_ports()
        self.assertIs(caught.exception.__cause__,busy)
        self.assertTrue(all(p.closed for p in made))

    def test_port_wait_probes_original_listener_until_it_is_released(self):
        with tempfile.TemporaryDirectory() as tmp, socket.socket() as listener:
            parent=Path(tmp).resolve(); lab=original.lab; pid=os.getpid()
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            listener.bind(('127.0.0.1',0)); listener.listen(); port=listener.getsockname()[1]
            attempts=[]; now=[0.0]
            def ports():
                attempts.append(port)
                with socket.socket() as probe: probe.bind(('127.0.0.1',port))
            def sleep(seconds):
                listener.close();now[0]+=seconds
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=ports), \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]),mock.patch.object(c.time,'sleep',side_effect=sleep):
                admission=c.FreshAdmission(lab,parent);admission((parent,))
                self.assertEqual(len(attempts),2)
                self.assertEqual(admission.samples[-1]['portReadinessAttempts'],2)
                self.assertGreater(admission.samples[-1]['portWaitNs'],0)

    def test_port_wait_preserves_busy_error_on_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid();now=[0.0]
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            error=OSError(errno.EADDRINUSE,'original port busy')
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=error), \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]), \
                 mock.patch.object(c.time,'sleep',side_effect=lambda seconds:now.__setitem__(0,now[0]+seconds)):
                admission=c.FreshAdmission(lab,parent)
                with self.assertRaises(OSError) as caught: admission((parent,))
                self.assertIs(caught.exception,error);self.assertFalse(admission.samples)
                self.assertLessEqual(now[0],65.0)

    def test_port_wait_does_not_retry_other_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid()
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            error=OSError(errno.EACCES,'original permission failure')
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=error) as ports, mock.patch.object(c.time,'sleep') as sleep:
                with self.assertRaises(OSError) as caught:c.FreshAdmission(lab,parent)((parent,))
                self.assertIs(caught.exception,error);ports.assert_called_once();sleep.assert_not_called()

    def test_port_wait_rechecks_original_memory_floor(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid()
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',side_effect=[8<<30,5<<30]), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=OSError(errno.EADDRINUSE,'busy')),mock.patch.object(c.time,'sleep'):
                with self.assertRaisesRegex(RuntimeError,'MemAvailable'):c.FreshAdmission(lab,parent)((parent,))

    def test_port_wait_rejects_if_resource_scan_crosses_absolute_deadline(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid();now=[0.0];calls=[0]
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            error=OSError(errno.EADDRINUSE,'original port busy')
            def memory():
                calls[0]+=1
                if calls[0]==2:now[0]=66.0
                return 8<<30
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',side_effect=memory), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=[error,None]) as ports, \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]), \
                 mock.patch.object(c.time,'sleep',side_effect=lambda seconds:now.__setitem__(0,now[0]+seconds)):
                admission=c.FreshAdmission(lab,parent)
                with self.assertRaises(OSError) as caught:admission((parent,))
                self.assertIs(caught.exception,error);self.assertEqual(ports.call_count,1)
                self.assertFalse(admission.samples)

    def test_port_wait_rejects_if_successful_probe_crosses_absolute_deadline(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid();now=[0.0];calls=[0]
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            error=OSError(errno.EADDRINUSE,'original port busy')
            def ports():
                calls[0]+=1
                if calls[0]==1:raise error
                now[0]=66.0
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=ports), \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]), \
                 mock.patch.object(c.time,'sleep',side_effect=lambda seconds:now.__setitem__(0,now[0]+seconds)):
                admission=c.FreshAdmission(lab,parent)
                with self.assertRaises(OSError) as caught:admission((parent,))
                self.assertIs(caught.exception,error);self.assertEqual(calls[0],2)
                self.assertFalse(admission.samples)

    def test_first_resource_scan_past_deadline_cannot_admit(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid();now=[0.0]
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            def memory():now[0]=66.0;return 8<<30
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',side_effect=memory), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports') as ports, \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]):
                admission=c.FreshAdmission(lab,parent)
                with self.assertRaises(TimeoutError):admission((parent,))
                ports.assert_not_called();self.assertFalse(admission.samples)
                self.assertEqual(admission.port_observations[-1]['status'],'ADMISSION_TIMEOUT')

    def test_first_successful_probe_past_deadline_cannot_admit(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid();now=[0.0]
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=lambda:now.__setitem__(0,66.0)), \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]):
                admission=c.FreshAdmission(lab,parent)
                with self.assertRaises(TimeoutError):admission((parent,))
                self.assertFalse(admission.samples)
                self.assertEqual(admission.port_observations[-1]['status'],'ADMISSION_TIMEOUT')

    def test_port_log_failure_does_not_replace_original_busy_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab;pid=os.getpid();now=[0.0]
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            error=OSError(errno.EADDRINUSE,'original port busy')
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                 mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                 mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                 mock.patch.object(lab,'owned_rss',return_value=100),mock.patch.object(lab,'heavy_processes',return_value=[]), \
                 mock.patch.object(c,'probe_original_ports',side_effect=error), \
                 mock.patch.object(c.time,'monotonic',side_effect=lambda:now[0]), \
                 mock.patch.object(c.time,'sleep',side_effect=lambda seconds:now.__setitem__(0,now[0]+seconds)), \
                 mock.patch('builtins.print',side_effect=BrokenPipeError()):
                admission=c.FreshAdmission(lab,parent)
                with self.assertRaises(OSError) as caught:admission((parent,))
                self.assertIs(caught.exception,error)
                self.assertEqual(admission.port_observations[-1]['status'],'BUSY_TIMEOUT')

    def test_original_floors_and_resource_errors_are_not_converted_to_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();lab=original.lab
            with mock.patch.object(lab.guard,'proc_inventory',return_value=({},None)), \
                    mock.patch.object(lab.guard,'memory_available',return_value=5<<30), \
                    mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                    mock.patch.object(lab,'heavy_processes',return_value=[]):
                with self.assertRaisesRegex(RuntimeError,'MemAvailable'):c.FreshAdmission(lab,parent)((parent,))
            error=OSError('CONTROL original proc inventory failure')
            with mock.patch.object(lab.guard,'proc_inventory',side_effect=error):
                with self.assertRaises(OSError) as raised:c.FreshAdmission(lab,parent)((parent,))
                self.assertIs(raised.exception,error)

    def active(self):
        environment=dict(YNX_HELD_DISPATCH_PROFILE=c.PROFILE,GITHUB_RUN_ID='10',GITHUB_SHA='e'*40,RUNNER_NAME='CONTROL-runner')
        run=dict(id=10,head_sha='e'*40,head_branch=c.reader.BRANCH,event='workflow_dispatch',run_attempt=1,
            path=c.WORKFLOW,status='in_progress',repository=dict(full_name=c.REPOSITORY))
        job=dict(id=20,run_id=10,run_attempt=1,head_sha='e'*40,name=c.reader.JOB,status='in_progress',runner_name='CONTROL-runner',runner_id=30)
        return environment,run,dict(total_count=1,jobs=[job])

    def test_pair_context_is_original_active_job_not_caller_asserted_runner(self):
        environment,run,jobs=self.active()
        def read(suffix):return run if suffix=='runs/10' else jobs
        api=types.SimpleNamespace(read=read)
        with mock.patch.object(c.producer,'identity',return_value={'CONTROL':'clock'}),mock.patch.object(c.producer,'hosted') as host:
            pair=c.active_pair(environment,api,{})
            self.assertEqual((pair['runID'],pair['jobID'],pair['runnerID']),(10,20,30));host.assert_called_once()
            for field,value in (('runner_name','foreign'),('head_sha','f'*40),('status','completed'),('run_attempt',True)):
                changed=copy.deepcopy(jobs);changed['jobs'][0][field]=value
                with self.subTest(field=field),self.assertRaises(RuntimeError):
                    c.active_pair(environment,types.SimpleNamespace(read=lambda s:run if s=='runs/10' else changed),{})
            jobs['total_count']=2
            with self.assertRaisesRegex(RuntimeError,'complete bounded'):c.active_pair(environment,api,{})

    def test_old_single_arm_profile_and_duplicate_job_cannot_become_pair(self):
        environment,run,jobs=self.active();api=types.SimpleNamespace(read=lambda s:run if s=='runs/10' else jobs)
        environment['YNX_HELD_DISPATCH_PROFILE']='first100-held-public-owner-business'
        with self.assertRaisesRegex(RuntimeError,'sequential-pair profile'):c.active_pair(environment,api,{})
        environment['YNX_HELD_DISPATCH_PROFILE']=c.PROFILE;jobs['jobs'].append(copy.deepcopy(jobs['jobs'][0]));jobs['total_count']=2
        with self.assertRaisesRegex(RuntimeError,'one original'):c.active_pair(environment,api,{})

    def test_real_host_validator_rejects_wrong_job_key_profile_ref_and_attempt(self):
        environment,run,jobs=self.active()
        environment.update(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY=c.REPOSITORY,
            GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_JOB='first100-held-public-owner',
            GITHUB_REF='refs/heads/'+c.reader.BRANCH,GITHUB_RUN_ATTEMPT='1',GITHUB_WORKFLOW_SHA='e'*40,
            GITHUB_WORKFLOW_REF=c.REPOSITORY+'/'+c.WORKFLOW+'@refs/heads/'+c.reader.BRANCH)
        clock=dict(kind='CLOCK_MONOTONIC',bootIDSHA256='a'*64,coordinatorPID=1,coordinatorStartTicks=2)
        api=types.SimpleNamespace(read=lambda s:run if s=='runs/10' else jobs)
        with mock.patch.object(c.producer,'identity',return_value=clock),mock.patch.object(c.producer.sys,'platform','linux'):
            self.assertEqual(c.active_pair(environment,api,{})['jobID'],20)
            for key,value in (('GITHUB_JOB','other'),('GITHUB_REF','refs/heads/main'),
                              ('GITHUB_RUN_ATTEMPT','2'),('GITHUB_WORKFLOW_SHA','f'*40),
                              ('YNX_HELD_DISPATCH_PROFILE','first100-held-public-owner-business')):
                changed=dict(environment);changed[key]=value
                with self.subTest(key=key),self.assertRaises(RuntimeError):c.active_pair(changed,api,{})

    def test_metadata_client_is_bounded_get_only_and_rejects_redirect(self):
        api=c.ActionsMetadata('CONTROL-token')
        with self.assertRaisesRegex(RuntimeError,'endpoint'):api.read('runs/1/rerun')
        opener=mock.Mock();response=mock.MagicMock();response.__enter__.return_value=response
        url='https://api.github.com/repos/'+c.REPOSITORY+'/actions/runs/10'
        response.status=200;response.url=url;response.read.return_value=b'{"id":10}'
        opener.open.return_value=response
        with mock.patch.object(c.urllib.request,'build_opener',return_value=opener) as factory:
            self.assertEqual(api.read('runs/10'),{'id':10})
            request=opener.open.call_args.args[0]
            self.assertEqual(request.get_method(),'GET');self.assertEqual(request.full_url,url)
            self.assertEqual(response.read.call_args.args,((1<<20)+1,))
            handler=factory.call_args.args[0]
            with self.assertRaisesRegex(RuntimeError,'redirect refused'):handler.redirect_request(None)
            response.url='https://other.example.invalid/actions/runs/10'
            with self.assertRaisesRegex(RuntimeError,'bounded original'):api.read('runs/10')
            response.url=url
            response.read.return_value=b'x'*((1<<20)+1)
            with self.assertRaisesRegex(RuntimeError,'bounded original'):api.read('runs/10')

    def test_actual_factory_binds_both_original_callbacks_without_constructing_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace=Path(tmp).resolve();parent=workspace/'tmp';parent.mkdir()
            for name in ('controller','source-before','source-after','tools-before','tools-after','go/bin'):
                (workspace/name).mkdir(parents=True)
            go=workspace/'go/bin/go';go.write_text('CONTROL only')
            binding=dict(schema='YNX-PERF-ORIGINAL-PAIR-BINDING/v1',arms=dict(before=arm(),after=arm()))
            environment=dict(GITHUB_WORKSPACE=str(workspace),RUNNER_TEMP=str(parent))
            pair=dict(controllerCommit='e'*40,runID=10,jobID=20)
            run,job=tools_metadata(arm()['toolsCI'])
            api=types.SimpleNamespace(token=None,read=lambda suffix:run if suffix=='runs/100' else job if suffix=='jobs/101' else {'CONTROL':suffix})
            source_gate=types.SimpleNamespace(SOURCE='1'*40,TREE='2'*40,validate=mock.Mock(),
                qualification=mock.Mock(return_value=arm()['sourceQualification']))
            source_gate.qualification.__signature__=c.inspect.signature(original.held_first_trial_source.qualification)
            # The REAL bridge and original Window class are supplied. This
            # factory/qualification control never calls adapter.execute.
            driver=types.SimpleNamespace(run=mock.Mock(),lab=original.lab,HELD_TRIAL_SOURCE='1'*40,
                HELD_TRIAL_TREE='2'*40,held_first_trial_source=source_gate)
            driver.run.__signature__=c.inspect.signature(original.run)
            with ExitStack() as stack:
                stack.enter_context(mock.patch.object(c,'__file__',str(workspace/'controller/scripts/loadtest/pq-same-runner-controller.py')))
                stack.enter_context(mock.patch.object(c,'active_pair',return_value=pair))
                checks=stack.enter_context(mock.patch.object(c,'checkout'))
                pins=stack.enter_context(mock.patch.object(c,'verify_tool_files'))
                stack.enter_context(mock.patch.object(c.shutil,'which',return_value=str(go)))
                stack.enter_context(mock.patch.object(c,'module',return_value=driver))
                stack.enter_context(mock.patch.object(c,'git',return_value='6'*40))
                stack.enter_context(mock.patch.object(c.subprocess,'check_output',return_value='go1.26.11\n'))
                stack.enter_context(mock.patch.object(original.lab,'check_source',return_value={'tree':'2'*40}))
                constructor=stack.enter_context(mock.patch.object(original.lab.Window,'__init__',side_effect=AssertionError('no Window in qualification')))
                prepared=c.prepare(binding,environment,api)
                for label,adapter in prepared['adapters'].items():
                    self.assertEqual(adapter.qualify(),adapter.qualification_record())
                    self.assertEqual(adapter.options.source,str(workspace/('source-'+label)))
                    self.assertEqual(adapter.options.accounts,500)
                    self.assertEqual(adapter.storage_roots,(workspace,))
                self.assertEqual(source_gate.qualification.call_args_list,
                    [mock.call(metadata_reader=api.read),mock.call(metadata_reader=api.read)])
                source_gate.validate.assert_not_called();constructor.assert_not_called();driver.run.assert_not_called()
                self.assertGreaterEqual(checks.call_count,11);self.assertEqual(pins.call_count,4)
                source_gate.qualification.return_value=dict(arm()['sourceQualification'],runtimePermissionGranted=True)
                with self.assertRaisesRegex(RuntimeError,'source qualification failed'):prepared['adapters']['before'].qualify()
                self.assertFalse(prepared['adapters']['before'].qualified)
                self.assertFalse(prepared['output'].exists())

    def test_each_driver_gate_uses_private_metadata_reader_without_process_credentials(self):
        values=[]
        def driver_gate(adapter, register):
            values.append(adapter._source_metadata_reader('runs/10'))
            self.assertNotIn('GH_TOKEN',os.environ)
            return 'CONTROL'
        arms=[object.__new__(c.RevalidatedArm) for _ in range(2)]
        for value in arms:
            value._source_metadata_reader=lambda path: {'CONTROL':path};value.retained_roots=('/CONTROL',)
            value._deadline_check=mock.Mock()
        with mock.patch.dict(os.environ,{},clear=False), \
                mock.patch.object(c.RevalidatedArm,'qualify'),mock.patch.object(c.RevalidatedArm,'admit'), \
                mock.patch.object(c.bridge.OriginalDriverAdapter,'execute',driver_gate):
            os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
            for value in arms:
                self.assertEqual(value.execute(None),'CONTROL')
                self.assertNotIn('GH_TOKEN',os.environ);self.assertNotIn('GITHUB_TOKEN',os.environ)
            self.assertEqual(values,[{'CONTROL':'runs/10'}]*2)
            error=OSError('CONTROL source gate failed before Window')
            with mock.patch.object(c.bridge.OriginalDriverAdapter,'execute',side_effect=error):
                with self.assertRaises(OSError) as raised:arms[0].execute(None)
                self.assertIs(raised.exception,error)
            self.assertNotIn('GH_TOKEN',os.environ);self.assertNotIn('GITHUB_TOKEN',os.environ)

    def test_pre_window_qualification_subprocess_never_inherits_metadata_credential(self):
        value=object.__new__(c.RevalidatedArm)
        value._source_metadata_reader=c.ActionsMetadata('CONTROL-metadata-token').read
        value.retained_roots=('/CONTROL',)
        value._deadline_check=mock.Mock()
        def probe():
            result=subprocess.run([sys.executable,'-I','-c',
                'import os,sys;sys.exit(int(any(k in os.environ for k in ("GH_TOKEN","GITHUB_TOKEN"))))'],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
            self.assertEqual(result.returncode,0,'metadata credential reached actual qualification subprocess')
        with mock.patch.dict(os.environ,{},clear=False):
            os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
            with mock.patch.object(value,'qualify',side_effect=probe),mock.patch.object(value,'admit'), \
                    mock.patch.object(c.bridge.OriginalDriverAdapter,'execute',return_value=None):
                value.execute(None)

    def test_late_source_or_ci_failure_prevents_second_driver_without_reusing_old_admission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();value=arm();config=c.configuration(value)
            record=dict(configuration=config,configurationSHA256=c.reader.digest(c.producer.encode(config)),
                runtimePlanSHA256=None,controllerCommit='e'*40,toolsCI=c.verify_tools_ci(value['toolsCI'],*tools_metadata(value['toolsCI'])))
            driver=types.SimpleNamespace(run=mock.Mock(),lab=original.lab)
            verify=mock.Mock(return_value=record);admission=mock.Mock(return_value=None)
            adapter=c.RevalidatedArm(driver,argparse_namespace(config,root),record,source_metadata_reader=mock.Mock(),
                verify_qualification=verify,admit=admission,storage_roots=(root,),deadline_check=mock.Mock())
            adapter.qualify();adapter.admit((root,))
            for error in (RuntimeError('CONTROL source checkout changed after first arm'),
                          OSError('CONTROL original CI unavailable after first arm')):
                verify.side_effect=error
                with mock.patch.dict(os.environ,{},clear=False):
                    with self.assertRaises(type(error)) as raised:adapter.execute(mock.Mock())
                    self.assertIs(raised.exception,error)
                    self.assertNotIn('GH_TOKEN',os.environ)
                self.assertFalse(adapter.qualified);self.assertFalse(adapter.admitted)
                driver.run.assert_not_called()
            self.assertEqual(admission.call_count,1)

    def test_unknown_rss_and_changed_original_stat_cannot_admit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();lab=original.lab;pid=os.getpid()
            rows={pid:dict(pid=pid,parent=0,startTicks=1,state='S',threads=1,comm='python')}
            with mock.patch.object(lab.guard,'proc_inventory',return_value=(rows,None)), \
                    mock.patch.object(lab.guard,'memory_available',return_value=8<<30), \
                    mock.patch.object(c.shutil,'disk_usage',return_value=types.SimpleNamespace(free=32<<30)), \
                    mock.patch.object(lab,'heavy_processes',return_value=[]):
                for value in (None,RuntimeError('CONTROL original PID/startTicks changed')):
                    with self.subTest(value=type(value).__name__),mock.patch.object(lab,'owned_rss',
                            side_effect=value if isinstance(value,Exception) else None,return_value=value):
                        admission=c.FreshAdmission(lab,root)
                        with self.assertRaises((RuntimeError,TypeError)):admission((root,))
                        self.assertEqual(admission.samples,[])

    def test_signal_handler_raises_for_original_producer_cleanup_and_is_restored(self):
        fake=dict(pair={},plans={},adapters={},output=Path('/CONTROL-not-created'))
        handlers={};old={c.signal.SIGINT:object(),c.signal.SIGTERM:object()}
        def configured(factory):return factory({})
        def run(*args,**kwargs):handlers[c.signal.SIGTERM](c.signal.SIGTERM,None)
        with mock.patch.object(c.bridge,'configured_adapters',side_effect=configured), \
                mock.patch.object(c,'prepare',return_value=fake),mock.patch.object(c,'ActionsMetadata'), \
                mock.patch.object(c.signal,'getsignal',side_effect=lambda s:old[s]), \
                mock.patch.object(c.signal,'signal',side_effect=lambda s,h:handlers.update({s:h})), \
                mock.patch.object(c.producer,'run_pair',side_effect=run):
            with self.assertRaisesRegex(RuntimeError,'interrupted by signal'):c.execute()
        self.assertEqual(handlers,old)

    def test_execute_strips_credentials_before_real_qualification_subprocess_even_on_error(self):
        error=OSError('CONTROL qualification failed')
        def prepare(binding,environment,api):
            self.assertNotIn('GH_TOKEN',environment);self.assertNotIn('GITHUB_TOKEN',environment)
            self.assertEqual(api.token,'CONTROL-token')
            result=subprocess.run([sys.executable,'-I','-c',
                'import os,sys;sys.exit(int(any(k in os.environ for k in ("GH_TOKEN","GITHUB_TOKEN"))))'],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
            self.assertEqual(result.returncode,0)
            raise error
        with mock.patch.dict(os.environ,GH_TOKEN='CONTROL-token',GITHUB_TOKEN='CONTROL-second'), \
                mock.patch.object(c.bridge,'configured_adapters',side_effect=lambda factory:factory({})), \
                mock.patch.object(c,'prepare',side_effect=prepare):
            with self.assertRaises(OSError) as raised:c.execute()
            self.assertIs(raised.exception,error)
            self.assertNotIn('GH_TOKEN',os.environ);self.assertNotIn('GITHUB_TOKEN',os.environ)
        for token in (None,'',False):
            with self.subTest(token=token),self.assertRaisesRegex(RuntimeError,'no unauthenticated'):
                c.ActionsMetadata(token)

    def test_source_metadata_transport_keeps_original_validator_and_no_exception_fallback(self):
        gate=original.held_first_trial_source
        run,job,inventory=source_metadata(gate)
        expected=gate.validate_successor(run,job,inventory['jobs'])
        reader=mock.Mock(side_effect=[run,job,inventory])
        with mock.patch.object(gate.urllib.request,'build_opener') as opened:
            self.assertEqual(gate.qualification(metadata_reader=reader),expected)
            self.assertEqual(reader.call_args_list,[mock.call('runs/'+str(gate.RUN)),
                mock.call('jobs/'+str(gate.JOB)),mock.call('runs/'+str(gate.RUN)+'/jobs?per_page=100')])
            self.assertEqual(expected['delivery']['job'],gate.JOB+1)
            self.assertFalse(expected['delivery']['runtimePermissionGranted'])
            for changed in (dict(run,head_sha='f'*40),dict(run,id=gate.RUN+1),dict(run,conclusion='failure')):
                with self.assertRaises(RuntimeError):gate.qualification(metadata_reader=mock.Mock(side_effect=[changed,job,inventory]))
            error=OSError('CONTROL metadata failure; no fallback')
            with self.assertRaises(OSError) as raised:gate.qualification(metadata_reader=mock.Mock(side_effect=error))
            self.assertIs(raised.exception,error);opened.assert_not_called()

    def test_injected_reader_requires_same_run_delivery_and_complete_inventory(self):
        gate=original.held_first_trial_source
        run,job,inventory=source_metadata(gate)
        mutations=[dict(total_count=3,jobs=inventory['jobs']),dict(total_count=True,jobs=inventory['jobs']),
            dict(total_count=1,jobs=[job]),dict(total_count=3,jobs=inventory['jobs']+[inventory['jobs'][1]]),
            dict(total_count=101,jobs=[job]*101),dict(total_count=2,jobs=tuple(inventory['jobs']))]
        for key,value in (('run_id',gate.RUN+1),('head_sha','f'*40),('run_attempt',2),('conclusion','failure')):
            changed=copy.deepcopy(inventory);changed['jobs'][1][key]=value;mutations.append(changed)
        changed=copy.deepcopy(inventory);changed['jobs'][0]['id']+=5;mutations.append(changed)
        for change in ('missing','duplicate','skipped'):
            changed=copy.deepcopy(inventory);steps=changed['jobs'][1]['steps']
            if change=='missing':steps.pop()
            elif change=='duplicate':steps.append(copy.deepcopy(steps[0]))
            else:steps[0]['conclusion']='skipped'
            mutations.append(changed)
        with mock.patch.object(gate.urllib.request,'build_opener') as opened:
            for index,changed in enumerate(mutations):
                with self.subTest(index=index),self.assertRaises(RuntimeError):
                    gate.qualification(metadata_reader=mock.Mock(side_effect=[run,job,changed]))
            opened.assert_not_called()

    def test_injected_reader_endpoint_failures_propagate_without_environment_fallback(self):
        gate=original.held_first_trial_source;values=source_metadata(gate)
        with mock.patch.object(gate.urllib.request,'build_opener') as opened, \
                mock.patch.dict(os.environ,GH_TOKEN='CONTROL ambient must not be consulted'):
            for index in range(3):
                error=OSError('CONTROL metadata endpoint '+str(index))
                read=mock.Mock(side_effect=[*values[:index],error])
                with self.subTest(endpoint=index),self.assertRaises(OSError) as raised:
                    gate.qualification(metadata_reader=read)
                self.assertIs(raised.exception,error);self.assertEqual(read.call_count,index+1)
            for value in (False,{},'CONTROL'):
                with self.assertRaisesRegex(RuntimeError,'metadata reader required'):
                    gate.qualification(metadata_reader=value)
            opened.assert_not_called()

    def test_metadata_inventory_routes_remain_exact_bounded_gets(self):
        api=c.ActionsMetadata('CONTROL only')
        opener=mock.Mock();response=mock.MagicMock();response.__enter__.return_value=response
        response.status=200;response.read.return_value=b'{"total_count":0,"jobs":[]}'
        opener.open.return_value=response
        with mock.patch.object(c.urllib.request,'build_opener',return_value=opener):
            for suffix in ('runs/10/jobs?per_page=100','runs/10/attempts/1/jobs?per_page=100'):
                response.url='https://api.github.com/repos/'+c.REPOSITORY+'/actions/'+suffix
                self.assertEqual(api.read(suffix),{'total_count':0,'jobs':[]})
                request=opener.open.call_args.args[0]
                self.assertEqual(request.full_url,response.url);self.assertEqual(request.get_method(),'GET')
            opener.open.reset_mock()
            for suffix in ('runs/10/jobs','runs/10/jobs?per_page=99','runs/10/jobs?per_page=100&page=2',
                           'runs/10/attempts/2/jobs?per_page=100','runs/010/jobs?per_page=100',
                           'https://other.example.invalid/runs/10','runs/10/../jobs?per_page=100'):
                with self.subTest(suffix=suffix),self.assertRaisesRegex(RuntimeError,'endpoint'):
                    api.read(suffix)
            opener.open.assert_not_called()

    def test_original_driver_passes_reader_to_source_gate_before_runtime_children(self):
        gate=original.held_first_trial_source
        args=argparse_namespace(c.configuration(arm()),Path('/CONTROL'))
        args.commit=gate.SOURCE
        error=OSError('CONTROL gate transport stop')
        metadata=mock.Mock(side_effect=error)
        with mock.patch.object(original,'validate_options',return_value=500), \
                mock.patch.object(original,'sender_backend_kind',return_value='public-owner'), \
                mock.patch.object(original.lab,'check_source',return_value={'tree':gate.TREE}), \
                mock.patch.dict(os.environ,GITHUB_JOB='first100-held-public-owner',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_RUN_ATTEMPT='1'), \
                mock.patch.object(original.subprocess,'Popen') as child,mock.patch.object(original.lab,'Window') as window:
            with self.assertRaises(OSError) as raised:original.run(args,source_metadata_reader=metadata)
            self.assertIs(raised.exception,error)
            metadata.assert_called_once_with('runs/'+str(gate.RUN));child.assert_not_called();window.assert_not_called()


if __name__ == '__main__':
    unittest.main()
