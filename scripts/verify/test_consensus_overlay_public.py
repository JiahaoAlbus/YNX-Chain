#!/usr/bin/env python3
"""Public normal producer and real verifier functions; no network or keys."""
import ast
import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('overlay_public',Path(__file__).with_name('consensus_overlay_public.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class OverlayPublicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work=tempfile.TemporaryDirectory(prefix='ynx-overlay-public-controls-')
        cls.root=Path(cls.work.name).resolve();records=cls.root/'records';records.mkdir();cls.records=records
        for i,role in enumerate(m.ROLES):
            value={'version':1,'purpose':'ynx-consensus-private-overlay-public-keys-only','role':role,
                   'publicEndpoint':'198.51.100.'+str(i+1),'overlayAddress':m.ADDRESSES[role],
                   'listenPort':51820,'wireGuardPublicKey':base64.b64encode(bytes([i+1])*32).decode(),
                   'custodyBoundary':'owner-controlled-host-local'}
            (records/(role+'.json')).write_text(json.dumps(value))
        cls.normal=cls.root/'normal-package'
        subprocess.run(['node',str(ROOT/'scripts/deploy/build-consensus-overlay-package.mjs'),str(records),str(cls.normal)],check=True,capture_output=True,timeout=5)
    @classmethod
    def tearDownClass(cls):cls.work.cleanup()
    def setUp(self):
        self.case=tempfile.TemporaryDirectory(prefix='ynx-overlay-public-case-',dir=self.root)
        self.package=Path(self.case.name)/'package';shutil.copytree(self.normal,self.package)
    def tearDown(self):self.case.cleanup()
    def pin(self):return hashlib.sha256((self.package/'package-manifest.json').read_bytes()).hexdigest()
    def expected(self):return m.load_expectations(str(self.package),self.pin(),'primary')
    def mutate_role(self,role,change):
        file=self.package/'roles'/role/'role-manifest.json';value=json.loads(file.read_bytes());change(value);file.write_text(json.dumps(value))
        manifest=self.package/'package-manifest.json';value=json.loads(manifest.read_bytes());value['files'][str(file.relative_to(self.package))]=hashlib.sha256(file.read_bytes()).hexdigest();manifest.write_text(json.dumps(value))
    def rows(self,expected,stamp=100):return ''.join(p['wireGuardPublicKey']+' '+str(stamp)+'\n' for p in expected['peers']).encode()
    def test_normal_public_producer_four_roles_and_exact_peer_sources(self):
        e=self.expected();self.assertEqual(len(e['peers']),3);self.assertEqual([p['role'] for p in e['peers']],m.ROLES[1:])
    def test_missing_or_foreign_independent_manifest_pin_refused(self):
        for value in ('','0'*64,'1'*64):
            with self.subTest(value=value),self.assertRaises(AssertionError):m.load_expectations(str(self.package),value,'primary')
    def test_changed_role_bytes_without_manifest_update_refused(self):
        with (self.package/'roles/primary/role-manifest.json').open('ab') as f:f.write(b'\n')
        with self.assertRaises(AssertionError):self.expected()
    def test_duplicate_or_foreign_peer_even_rehashed_refused(self):
        self.mutate_role('primary',lambda v:v['peers'].__setitem__(1,copy.deepcopy(v['peers'][0])))
        with self.assertRaises(AssertionError):self.expected()
    def test_unknown_private_field_even_rehashed_refused(self):
        self.mutate_role('primary',lambda v:v['node'].__setitem__('privateKey','PUBLIC-TEST-ONLY-NONKEY'))
        with self.assertRaises(AssertionError):self.expected()
    def test_symlink_role_refused(self):
        f=self.package/'roles/primary/role-manifest.json';held=Path(self.case.name)/'held-public.json';f.rename(held);f.symlink_to(held)
        with self.assertRaises(AssertionError):self.expected()
    def test_hardlink_alias_refused(self):
        f=self.package/'roles/primary/role-manifest.json';held=Path(self.case.name)/'held-public.json';held.hardlink_to(f)
        with self.assertRaises(AssertionError):self.expected()
    def test_wrong_set_of_three_nonzero_handshakes_refused(self):
        e=self.expected();rows=self.rows(e).replace(e['peers'][0]['wireGuardPublicKey'].encode(),base64.b64encode(b'Z'*32))
        with self.assertRaises(AssertionError):m.parse_handshakes(rows,e['peers'],200)
    def test_extra_missing_duplicate_zero_malformed_handshakes_refused(self):
        e=self.expected();rows=self.rows(e);first=rows.splitlines(keepends=True)[0]
        cases=[rows+base64.b64encode(b'Z'*32)+b' 100\n',b''.join(rows.splitlines(keepends=True)[:2]),rows+first,self.rows(e,0),rows.replace(b' 100',b' -1',1)]
        for i,value in enumerate(cases):
            with self.subTest(case=i),self.assertRaises(AssertionError):m.parse_handshakes(value,e['peers'],200)
    def test_original_nonzero_rule_preserved_age_diagnostic_only(self):
        e=self.expected();value=m.parse_handshakes(self.rows(e,1),e['peers'],1000000)
        self.assertEqual(value['agesSeconds'],[999999]*3);self.assertFalse(value['recencyThresholdApplied'])
        future=m.parse_handshakes(self.rows(e,1000001),e['peers'],1000000);self.assertEqual(future['futureTimestampCount'],3)
    def test_wrong_route_device_or_destination_refused(self):
        for value in ([{'dst':'10.77.42.2','dev':'eth0'}],[{'dst':'10.77.42.9','dev':'ynxwg0'}],[]):
            with self.subTest(value=value),self.assertRaises(AssertionError):m.parse_route(json.dumps(value).encode(),'10.77.42.2')
    def run_remote(self,fail=None):
        expected=self.expected();calls=[]
        def actual(argv,**kwargs):
            calls.append(argv)
            if fail and argv[0]==fail:return SimpleNamespace(returncode=2,stdout=b'',stderr=b'bounded public tool failure')
            if argv[0]=='wg':data=self.rows(expected)
            elif argv[:4]==['ip','-j','route','get']:data=json.dumps([{'dst':argv[4],'dev':'ynxwg0'}]).encode()
            else:data=b''
            return SimpleNamespace(returncode=0,stdout=data,stderr=b'')
        out=io.StringIO()
        with patch.object(m.os,'getuid',return_value=0),patch.object(m.os,'geteuid',return_value=0),patch.object(m.subprocess,'run',side_effect=actual),contextlib.redirect_stdout(out):m.remote_run(expected)
        return expected,calls,out.getvalue()
    def test_normal_live_ping_exact_original_flags_and_safe_receipt(self):
        expected,calls,raw=self.run_remote();value=m.check_receipt(expected,raw.encode())
        self.assertEqual([v for v in calls if v[0]=='ping'],[['ping','-c','2','-W','2',p['overlayAddress']] for p in expected['peers']])
        self.assertTrue(value['exactIndependentPeerSet']);self.assertFalse(value['nodeOrSignerReady'])
        for peer in expected['peers']:self.assertNotIn(peer['wireGuardPublicKey'],raw)
    def test_live_ping_and_wg_read_failure_cannot_pass(self):
        for name in ('ping','wg','ip','systemctl'):
            with self.subTest(command=name),self.assertRaises(AssertionError):self.run_remote(name)
    def test_receipt_foreign_pin_and_unknown_handshake_field_refused(self):
        expected,_,raw=self.run_remote();value=json.loads(raw);value['manifestSHA256']='1'*64
        with self.assertRaises(AssertionError):m.check_receipt(expected,json.dumps(value).encode())
        value=json.loads(raw);value['handshakes']['extra']='PUBLIC-TEST-ONLY'
        with self.assertRaises(AssertionError):m.check_receipt(expected,json.dumps(value).encode())
    def test_emitted_normal_program_is_valid_and_has_no_private_wg_query(self):
        program=m.emit_remote(self.expected());tree=ast.parse(program)
        strings=[n.value for n in ast.walk(tree) if isinstance(n,ast.Constant) and isinstance(n.value,str)]
        self.assertNotIn('dump',strings);self.assertNotIn('showconf',strings);self.assertNotIn('private-key',strings)
        self.assertIn('latest-handshakes',strings)
    def shell_entry(self,pin):
        directory=Path(self.case.name);envfile=directory/'normal.env';rows=[]
        for prefix in ('PRIMARY','SG','SILICON_VALLEY','SEOUL'):
            rows.extend([prefix+'_NODE_HOST=198.51.100.1',prefix+'_NODE_USER=root',prefix+'_NODE_SSH_KEY=/dev/null'])
        envfile.write_text('\n'.join(rows)+'\n');bin_dir=directory/'bin';bin_dir.mkdir()
        shim=bin_dir/'python3';shim.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' "$@"\n');shim.chmod(0o700)
        env=os.environ.copy();env.update({'PATH':str(bin_dir)+os.pathsep+env['PATH'],'ENV_FILE':str(envfile),'DEPLOY_DRY_RUN':'1',
            'CONSENSUS_OVERLAY_PACKAGE':str(self.package),'CONSENSUS_OVERLAY_PACKAGE_MANIFEST_SHA256':pin})
        return subprocess.run(['bash',str(ROOT/'scripts/verify/verify-consensus-overlay.sh')],env=env,capture_output=True,timeout=10)
    def test_normal_shell_dryrun_validates_public_source_without_network_claim(self):
        value=self.shell_entry(self.pin());self.assertEqual(value.returncode,0,value.stderr.decode())
        self.assertEqual(value.stdout.count(b'DRY RUN ['),4);self.assertIn(b'no remote reachability evidence',value.stdout)
        for peer in self.expected()['peers']:self.assertNotIn(peer['wireGuardPublicKey'].encode(),value.stdout)
    def test_normal_shell_foreign_public_pin_refuses_before_transport(self):
        value=self.shell_entry('1'*64);self.assertNotEqual(value.returncode,0);self.assertNotIn(b'DRY RUN [',value.stdout)
    def deploy_environment(self):
        directory=Path(self.case.name);envfile=directory/'deploy.env';rows=[]
        for prefix in ('PRIMARY','SG','SILICON_VALLEY','SEOUL'):
            rows.extend([prefix+'_NODE_HOST=198.51.100.1',prefix+'_NODE_USER=root',prefix+'_NODE_SSH_KEY=/dev/null'])
        envfile.write_text('\n'.join(rows)+'\n');bin_dir=directory/'deploy-bin';bin_dir.mkdir()
        shim=bin_dir/'python3';shim.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' "$@"\n');shim.chmod(0o700)
        env=os.environ.copy();env.update({'PATH':str(bin_dir)+os.pathsep+env['PATH'],'ENV_FILE':str(envfile),'DEPLOY_DRY_RUN':'1',
            'CONSENSUS_OVERLAY_PUBLIC_RECORDS':str(self.records),'CONSENSUS_OVERLAY_WORK_ROOT':str(directory/'deploy-work')})
        return env
    def run_deploy(self,pin,existing=False):
        env=self.deploy_environment();env['CONSENSUS_OVERLAY_PACKAGE_MANIFEST_SHA256']=pin
        work=Path(env['CONSENSUS_OVERLAY_WORK_ROOT'])
        if existing:
            work.mkdir();(work/'original.UNKNOWN').write_bytes(b'PUBLIC original unknown, retain unchanged\n')
        result=subprocess.run(['bash',str(ROOT/'scripts/deploy/deploy-consensus-overlay.sh')],env=env,capture_output=True,timeout=15)
        return result,work
    def test_normal_deployment_producer_passes_independent_public_tuple_to_verifier(self):
        result,work=self.run_deploy(self.pin())
        self.assertEqual(result.returncode,0,result.stderr.decode())
        self.assertEqual(hashlib.sha256((work/'package/package-manifest.json').read_bytes()).hexdigest(),self.pin())
        self.assertIn(b'no interface was created and no reachability is claimed',result.stdout)
    def test_normal_deployment_missing_pin_refuses_before_work_or_transport(self):
        result,work=self.run_deploy('')
        self.assertNotEqual(result.returncode,0);self.assertFalse(work.exists());self.assertNotIn(b'DRY RUN [',result.stdout)
    def test_normal_deployment_foreign_pin_refuses_before_transport_and_keeps_case(self):
        result,work=self.run_deploy('1'*64)
        self.assertNotEqual(result.returncode,0);self.assertTrue((work/'package/package-manifest.json').exists())
        self.assertNotIn(b'DRY RUN [',result.stdout)
    def test_normal_deployment_preserves_original_unknown_work(self):
        result,work=self.run_deploy(self.pin(),existing=True)
        self.assertNotEqual(result.returncode,0);self.assertNotIn(b'DRY RUN [',result.stdout)
        self.assertEqual((work/'original.UNKNOWN').read_bytes(),b'PUBLIC original unknown, retain unchanged\n')
        self.assertEqual(list(work.iterdir()),[work/'original.UNKNOWN'])
    def test_original_package_check_overlay_producer_and_caller_fragment(self):
        env=self.deploy_environment();directory=Path(self.case.name)
        # Execute the unchanged normal producer/caller statements themselves;
        # the full package check retains its separate Linux/ELF/Go gates.
        source=(ROOT/'scripts/verify/consensus-production-package-check.sh').read_text()
        start=source.index('mkdir -p "$tmp/overlay-records"')
        end=source.index('\nmkdir -p "$tmp/validator-records"',start)
        program='set -eu\ntmp='+shlex.quote(str(directory))+'\n'+source[start:end]+'\n'
        result=subprocess.run(['bash','-c',program],cwd=ROOT,env=env,capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        output=(directory/'overlay-deploy.out').read_bytes()
        self.assertIn(b'no interface was created and no reachability is claimed',output)

if __name__=='__main__':unittest.main(verbosity=2)
