#!/usr/bin/env python3
"""PUBLIC synthetic filesystem controls; no SSH, runtime, keys or initializer."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('capacity', ROOT / 'scripts/ops/public-bft-candidate-capacity.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class CandidateCapacity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='candidate-capacity-public-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.runtime = self.root / 'runtime'
        self.runtime.mkdir()
        binaries = {}
        for name in ('ynx-comet', 'ynx-consensus-package', 'ynx-consensus-keycheck'):
            data = b'PUBLIC DATA' * 110000
            (self.runtime/name).write_bytes(data)
            binaries[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.source = self.runtime/'SOURCE.json'
        self.source.write_text(json.dumps({'binaries': binaries}))
        self.pin = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.release = 'ynx-consensus-candidate-' + '1'*12
        self.stage = self.root/'stage'; self.stage.mkdir()
        self.archive = self.root/'input.tar.gz'

    def prepare(self, phase='deploy', bridge=False):
        files = {'role/config/genesis.json': b'PUBLIC GENESIS',
                 'role/config/bound-migration.json': b'PUBLIC migration'*900,
                 'role/config/config.toml': b'PUBLIC CONFIG',
                 'role/role-manifest.json': b'PUBLIC MANIFEST',
                 'role/scripts/start-operator.sh': b'PUBLIC START',
                 'role/scripts/install-candidate.sh': b'PUBLIC INSTALL',
                 'role/systemd/ynx-consensus-operator-candidate.service': b'PUBLIC UNIT'}
        if phase == 'initialize':
            files = {'genesis.json': b'PUBLIC GENESIS', 'bound-migration.json': b'PUBLIC migration'*900,
                     'operator-plan.json': b'PUBLIC PLAN'}
        for name, data in files.items():
            p = self.stage/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
        names = ('ynx-comet', 'ynx-consensus-package' if phase == 'initialize' else 'ynx-consensus-keycheck')
        if phase == 'deploy': (self.stage/'bin').mkdir()
        if not bridge:
            for name in names:
                target = self.stage/name if phase == 'initialize' else self.stage/'bin'/name
                target.write_bytes((self.runtime/name).read_bytes())
        self.pack()
        return M.build_plan(phase, 'primary', self.release, self.stage, self.archive,
                            self.hash, self.source, self.pin, bridge)

    def pack(self):
        with tarfile.open(self.archive, 'w:gz') as f: f.add(self.stage, arcname='.')
        self.hash = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def test_actual_tar_and_retained_install_copies(self):
        plan = self.prepare()
        self.assertEqual(plan['items'][0]['bytes'], self.archive.stat().st_size)
        migration = [v for v in plan['items'] if v['target'].endswith('/bound-migration.json')]
        self.assertEqual(len(migration), 2)
        self.assertEqual({v['bytes'] for v in migration}, {len(b'PUBLIC migration'*900)})
        self.assertTrue(any(v['target'].startswith('/etc/systemd/') for v in plan['items']))
        with patch.object(M, 'existing_anchor', return_value=(7,4096,100<<30,10000)):
            result = M.measure(plan)
        self.assertEqual(len(result['filesystems']), 1)
        fs = result['filesystems'][0]
        self.assertEqual(int(fs['requiredBytes'])-int(fs['writeBytes']), 2<<30)
        self.assertTrue(result['capacityAvailable']); self.assertFalse(result['sourceGrant'])

    def test_tar_metadata_is_counted_but_not_promoted_to_install_input(self):
        self.prepare()
        import io
        with tarfile.open(self.archive,'w:gz') as t:
            t.add(self.stage,arcname='.')
            for name in ('._.','./role/config/._genesis.json'):
                v=tarfile.TarInfo(name);v.size=5000;t.addfile(v,io.BytesIO(b'PUBLIC'+b'x'*4994))
        self.hash=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        plan=M.build_plan('deploy','primary',self.release,self.stage,self.archive,self.hash,self.source,self.pin,False)
        extra=[v for v in plan['items'] if '/._' in v['target']]
        self.assertEqual(sum(v['bytes'] for v in extra),10000)
        self.assertTrue(all(v['target'].startswith('/opt/') for v in extra))

    def test_init_bridge_exact_binary_sizes_and_journal(self):
        plan = self.prepare('initialize', True)
        self.assertFalse(any('/var/lib/' in v['target'] for v in plan['items']))
        self.assertEqual(sum(v['bytes'] for v in plan['items'] if v['target'].endswith(('ynx-comet','ynx-consensus-package'))), 2 * len(b'PUBLIC DATA') * 110000)
        self.assertEqual([v['bytes'] for v in plan['items'] if v['target']=='/var/tmp'], [150<<20])

    def test_bridge_deploy_counts_both_stage_and_install(self):
        plan = self.prepare('deploy', True)
        for name in ('ynx-comet', 'ynx-consensus-keycheck'):
            copies = [v for v in plan['items'] if v['target'].endswith('/'+name)]
            self.assertEqual(len(copies), 2)
            self.assertTrue(all(v['bytes'] == (self.runtime/name).stat().st_size for v in copies))
        self.assertEqual(sum(v['bytes'] for v in plan['items'] if v['kind']=='allowance'),150<<20)

    def test_ci_hook_is_mandatory(self):
        text=(ROOT/'scripts/verify/public-bft-production-driver-check.sh').read_text()
        call='timeout 30s python3 -B scripts/ops/test_public_bft_candidate_capacity.py -v'
        self.assertEqual(text.count(call),1)
        self.assertNotIn(call+' ||',text)

    def test_target_filesystems_and_exact_margin_reject(self):
        plan = self.prepare()
        def probes(path): return (2 if path.startswith('/etc') else 1,4096,100<<30,10000)
        with patch.object(M, 'existing_anchor', side_effect=probes): high=M.measure(plan)
        self.assertEqual(len(high['filesystems']), 2)
        limits={int(v['device']):int(v['requiredBytes']) for v in high['filesystems']}
        def low(path):
            dev,block,_,inos=probes(path)
            return dev,block,limits[dev] if dev==2 else 100<<30,inos
        with patch.object(M, 'existing_anchor', side_effect=low): result=M.measure(plan)
        self.assertFalse(result['capacityAvailable'])
        self.assertFalse(result['filesystems'][1]['capacityAvailable'])
        with patch.object(M, 'existing_anchor', return_value=(1,4096,100<<30,1)):
            self.assertFalse(M.measure(plan)['capacityAvailable'])

    def test_archive_stage_change_pin_and_links_refused(self):
        self.prepare()
        (self.stage/'role/config/config.toml').write_bytes(b'changed length')
        with self.assertRaisesRegex(ValueError, 'byte count'): M.build_plan('deploy','primary',self.release,self.stage,self.archive,self.hash,self.source,self.pin,False)
        self.pack()
        with self.assertRaisesRegex(ValueError, 'pin differs'): M.build_plan('deploy','primary',self.release,self.stage,self.archive,'0'*64,self.source,self.pin,False)
        with self.assertRaisesRegex(ValueError, 'SOURCE pin'): M.build_plan('deploy','primary',self.release,self.stage,self.archive,self.hash,self.source,'0'*64,True)
        (self.stage/'alias').symlink_to(self.source)
        with self.assertRaisesRegex(ValueError, 'link'): M.inventory(self.stage)

    def test_original_fs_probe_and_no_side_effect_on_low_space(self):
        target=self.root/'not-created'/'target'
        device,block,available,inodes=M.existing_anchor(target)
        self.assertGreater(block,0); self.assertEqual(device,self.root.stat().st_dev)
        self.assertFalse(target.parent.exists())
        link=self.root/'link';link.symlink_to(self.runtime)
        with self.assertRaisesRegex(ValueError, 'link'): M.existing_anchor(link/'new')
        plan=self.prepare()
        cmd=M.command(plan); args=shlex.split(cmd)
        self.assertEqual(args[:3], ['sudo','/usr/bin/python3','-c'])
        # Run the real generated remote Python, changing only OS capacity in the
        # child. Its real exit73 prevents the shell's subsequent reserve marker.
        body="import os,types\nos.fstatvfs=lambda fd:types.SimpleNamespace(f_frsize=4096,f_bsize=4096,f_bavail=1,f_favail=10000)\n"+args[3]
        # Root paths are stat-only; patch the probe anchor to this real temp dir
        # because this public test runs on Darwin, not the deployment host.
        body=body.replace("anchor = Path('/')", 'anchor = Path('+repr(str(self.root))+')')
        marker=self.root/'reserve-marker'
        shell=shlex.quote(sys.executable)+' -c '+shlex.quote(body)+' && touch '+shlex.quote(str(marker))
        r=subprocess.run(['/bin/bash','-c',shell],capture_output=True,text=True,timeout=10)
        self.assertEqual(r.returncode,73,r.stderr)
        self.assertFalse(marker.exists())
        self.assertFalse(json.loads(r.stdout)['capacityAvailable'])

    def test_normal_callers_guard_precedes_first_remote_reserve(self):
        for phase in ('initialize','deploy'):
            with self.subTest(phase=phase): self.caller_probe(phase)

    def caller_probe(self, phase):
        d=self.root/phase;d.mkdir()
        package=d/'package'; role=package/'roles/primary'
        for rel in ('config/genesis.json','config/bound-migration.json','role-manifest.json','scripts/start-operator.sh','systemd/ynx-consensus-operator-candidate.service'):
            p=role/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('PUBLIC')
        plan=d/'plan.json';plan.write_text('PUBLIC PLAN')
        work=d/'work';(work/'roles').mkdir(parents=True);(work/'bin').mkdir()
        for name in ('ynx-comet','ynx-consensus-keycheck'):(work/'bin'/name).write_bytes((self.runtime/name).read_bytes())
        (work/'runtime-SOURCE.json').write_bytes(self.source.read_bytes())
        (d/'primary').mkdir()
        if phase=='initialize':
            text=(ROOT/'scripts/ops/public-bft-production-driver.sh').read_text()
            body=text.split('  initialize_operator_role() {',1)[1].split('\n  }\n  ynx_ops_each_node',1)[0]
            function='initialize_operator_role() {'+body+'\n}\n'; invoke='initialize_operator_role'
        else:
            text=(ROOT/'scripts/deploy/deploy-consensus-candidate.sh').read_text()
            body=text.split('deploy_candidate_role() {',1)[1].split('\n}\n',1)[0]
            function='deploy_candidate_role() {'+body+'\n}\n';invoke='deploy_candidate_role'
        capture=d/'command'
        variables={'candidate_guard_root':str(d),'candidate_release':self.release,'candidate_package':str(package),
                   'candidate_operator_plan':str(plan),'candidate_operator_pin':'1'*64,'public_package_verifier':str(self.runtime/'ynx-consensus-package'),
                   'CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256':self.pin,'package_root':str(package),'work':str(work),'release':self.release,'operator_package':'1'}
        script='set -Eeuo pipefail\n'+''.join(k+'='+shlex.quote(v)+'\n' for k,v in variables.items())
        script+='python3(){ '+shlex.quote(sys.executable)+' "$@"; }\nnode(){ printf true; }\npublic_bft_linux_tools_enabled(){ return 1; }\ncandidate_original_guard_command(){ printf true; }\n'
        script+='ynx_ops_ssh(){ printf "%s" "$5" >'+shlex.quote(str(capture))+'; return 77; }\n'+function+'\n'+invoke+' primary PUBLIC PUBLIC PUBLIC validator\n'
        r=subprocess.run(['/bin/bash','-c',script],cwd=ROOT,capture_output=True,text=True,timeout=10)
        if r.returncode != 77:
            archive = d/'primary/original-inputs.tar.gz' if phase=='initialize' else work/(self.release+'-primary.tar.gz')
            with tarfile.open(archive) as t:
                public_names = [v.name for v in t]
            self.fail(r.stderr + '\nPUBLIC synthetic tar names: '+repr(public_names))
        command=capture.read_text()
        self.assertIn('YNX-CANDIDATE-STAGE-CAPACITY/v1',command,'normal caller reserved without capacity gate')
        self.assertLess(command.index('YNX-CANDIDATE-STAGE-CAPACITY/v1'),command.index('sudo mkdir'))
        self.assertFalse('rm -' in command)


if __name__=='__main__': unittest.main()
