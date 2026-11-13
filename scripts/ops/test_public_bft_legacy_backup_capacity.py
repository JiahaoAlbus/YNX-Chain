"""Closed synthetic filesystem controls; never reads a host key or runs a node."""
import ast
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SCRIPT=HERE/'remote/public-bft-scoped-backup.sh'

def functions():
    raw=SCRIPT.read_text().split("<<'PY_NATIVE_BACKUP_CAPACITY'\n",1)[1].split('\nPY_NATIVE_BACKUP_CAPACITY',1)[0]
    tree=ast.parse(raw);namespace={}
    # Definitions only. No operation is dispatched by the test importer.
    exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef,ast.Assign))],type_ignores=[]),str(SCRIPT),'exec'),namespace)
    return namespace

class LegacyBackupCapacity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='ynx-legacy-backup-public-')
        self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
        self.source=self.root/'source';self.source.mkdir(mode=0o700)
        for path,body in [('etc/ynx/public.env',b'PUBLIC synthetic config\n'),('etc/systemd/system/ynx-chaind.service',b'PUBLIC synthetic unit\n'),('var/lib/ynx-chain/testnet/state.json',b'PUBLIC synthetic state\n')]:
            p=self.source/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body);p.chmod(0o600)
        self.paths=['etc/ynx','etc/systemd/system/ynx-chaind.service','var/lib/ynx-chain/testnet']
        self.backup=self.root/'new-parent/transaction-public'
        self.bin=self.root/'bin';self.bin.mkdir()
        interpreter=self.bin/'python3';interpreter.write_text('#!/bin/sh\nexec '+shlex_quote(sys.executable)+' "$@"\n');interpreter.chmod(0o700)
        if not shutil.which('sha256sum'):
            digest=self.bin/'sha256sum';digest.write_text('#!'+sys.executable+'\nimport hashlib,sys\nfrom pathlib import Path\nprint(hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()+"  "+sys.argv[1])\n');digest.chmod(0o700)
        self.env=dict(os.environ,PATH=str(self.bin)+':'+os.environ['PATH']);self.env.pop('TAR_OPTIONS',None);self.env.pop('GZIP',None)
        # The production destination is Linux. Suppress only macOS tar's
        # synthesized AppleDouble members in this public filesystem fixture.
        self.env['COPYFILE_DISABLE']='1'
    def invoke(self,native=True):
        args=['bash',str(SCRIPT),'public-transaction-0001','primary','b'*12,'ynx-chain-'+('a'*12 if native else 'b'*12),'ynx-bft-gateway-'+'b'*12,str(self.backup),'false',str(self.source)]
        if native:args+=['a'*40]
        return subprocess.run(args,env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
    def test_capacity_refusal_precedes_native_root_reservation(self):
        # Deliberately failed measurement subprocess, not a fake free-byte
        # success. Old native code did not invoke any capacity check at all.
        interpreter=self.bin/'python3';interpreter.write_text('#!/bin/sh\nprintf "CONTROLLED_NO_CAPACITY\\n" >&2\nexit 73\n');interpreter.chmod(0o700)
        r=self.invoke();self.assertNotEqual(r.returncode,0,r.stdout)
        self.assertIn(b'CONTROLLED_NO_CAPACITY',r.stderr);self.assertFalse(self.backup.exists())
    def test_original_scope_counts_all_links_without_reading_bodies(self):
        n=functions();first=self.source/'var/lib/ynx-chain/testnet/state.json';os.link(first,first.with_name('state-copy.json'))
        actual_open=os.open;opened=[]
        def directory_only(path,flags,*args,**kwargs):
            self.assertTrue(flags&os.O_DIRECTORY);opened.append(str(path));return actual_open(path,flags,*args,**kwargs)
        with patch('os.open',directory_only),patch('builtins.open',side_effect=AssertionError('no body read')):
            measured=n['measured'](self.source,self.paths)
        self.assertTrue(opened);self.assertEqual(measured['regularBytes'],sum(p.stat().st_size for p in self.source.rglob('*') if p.is_file()))
        self.assertGreater(measured['archiveCeilingBytes'],measured['regularBytes'])
        self.assertEqual(n['RESERVE'],2<<30)
    def test_alias_special_and_foreign_scope_rejected(self):
        n=functions();entry=self.source/'etc/ynx/alias';entry.symlink_to(self.source/'var/lib/ynx-chain/testnet/state.json')
        with self.assertRaisesRegex(ValueError,'alias or special'):n['measured'](self.source,self.paths)
        entry.unlink();os.mkfifo(entry)
        with self.assertRaisesRegex(ValueError,'alias or special'):n['measured'](self.source,self.paths)
        with self.assertRaisesRegex(ValueError,'closed backup scope'):n['measured'](self.source,self.paths+['etc/foreign'])
    def test_actual_target_filesystem_low_capacity_rejected(self):
        n=functions();m=n['measured'](self.source,self.paths)
        class FS:
            f_frsize=1
            f_bavail=m['archiveCeilingBytes']+n['RESERVE']
        with patch('os.statvfs',return_value=FS()):
            with self.assertRaisesRegex(ValueError,'insufficient'):n['space'](self.backup,m)
            self.assertFalse(self.backup.exists())
            FS.f_bavail+=1;result=n['space'](self.backup,m)
        self.assertEqual(result['availableBytes'],result['requiredBytes']+1)
    def test_native_real_tar_original_bytes_and_exclusive_retention(self):
        r=self.invoke();self.assertEqual(r.returncode,0,r.stderr);self.assertIn(b'validated=true',r.stdout)
        archive=self.backup/'primary.tar.gz';before=archive.read_bytes()
        with tarfile.open(archive,'r:gz') as t:
            for member in t.getmembers():
                if member.isfile():self.assertEqual(t.extractfile(member).read(),(self.source/member.name).read_bytes())
        cap=json.loads((self.backup/'primary-backup-capacity.json').read_text())
        self.assertIsNone(cap['actualCompressedBytes']);self.assertFalse(cap['fullFirstImportReady']);self.assertFalse(cap['privateBodyReadForMeasurement'])
        self.assertLessEqual(len(before),cap['archiveCeilingBytes']);self.assertEqual(archive.stat().st_mode&0o777,0o600)
        again=self.invoke();self.assertNotEqual(again.returncode,0);self.assertEqual(archive.read_bytes(),before)
    def test_kernel_ceiling_preserves_partial_and_prevents_publish(self):
        n=functions();self.backup.mkdir(parents=True,mode=0o700)
        (self.source/'var/lib/ynx-chain/testnet/state.json').write_bytes(os.urandom(8192))
        measured=n['measured'](self.source,self.paths);measured['archiveCeilingBytes']=128
        partial=self.backup/'.primary.tar.gz.partial'
        with self.assertRaisesRegex(ValueError,'retain partial'):
            n['create'](self.backup,self.source,'primary',partial,self.paths,measured)
        self.assertTrue(partial.exists());self.assertLessEqual(partial.stat().st_size,128)
        self.assertTrue((self.backup/'primary-backup-capacity.json').exists());self.assertFalse((self.backup/'primary.tar.gz').exists())
        before=partial.read_bytes()
        with self.assertRaises(FileExistsError):n['create'](self.backup,self.source,'primary',partial,self.paths,measured)
        self.assertEqual(partial.read_bytes(),before)
    def test_old_eight_argument_reuse_is_unchanged(self):
        first=self.invoke(native=False);self.assertEqual(first.returncode,0,first.stderr)
        second=self.invoke(native=False);self.assertEqual(second.returncode,0,second.stderr);self.assertIn(b'reused=true',second.stdout)
        self.assertFalse((self.backup/'primary-backup-capacity.json').exists())
    def test_native_partial_appearing_after_preflight_is_retained(self):
        # Controlled interleaving after the real metadata/space check. This is
        # an uncertain existing output, never an instruction to retry it.
        interpreter=self.bin/'python3'
        interpreter.write_text('#!/bin/sh\n'+shlex_quote(sys.executable)+' "$@" || exit "$?"\n'
            +'if [ "$2" = check ]; then\nmkdir -p '+shlex_quote(str(self.backup))+'\nchmod 700 '+shlex_quote(str(self.backup))+'\n'
            +'printf "ORIGINAL UNKNOWN\\n" > '+shlex_quote(str(self.backup/'.primary.tar.gz.partial'))+'\nfi\n')
        interpreter.chmod(0o700)
        result=self.invoke();self.assertNotEqual(result.returncode,0)
        self.assertEqual((self.backup/'.primary.tar.gz.partial').read_bytes(),b'ORIGINAL UNKNOWN\n')
        self.assertFalse((self.backup/'primary.tar.gz').exists())
    def test_existing_parent_soft_limit_is_never_raised(self):
        n=functions();self.backup.mkdir(parents=True,mode=0o700)
        measured=n['measured'](self.source,self.paths)
        with patch.object(n['resource'],'getrlimit',return_value=(128,n['resource'].RLIM_INFINITY)):
            with self.assertRaisesRegex(ValueError,'existing file limit'):
                n['create'](self.backup,self.source,'primary',self.backup/'.primary.tar.gz.partial',self.paths,measured)
        self.assertEqual(list(self.backup.iterdir()),[])

def shlex_quote(value):
    import shlex
    return shlex.quote(value)

class LegacySnapshotCapacity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='ynx-snapshot-capacity-public-')
        self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
        self.script=HERE/'remote/public-bft-final-snapshot.sh'
        self.raw=self.script.read_text().split("<<'PY'\n",1)[1].rsplit('\nPY',1)[0]
        tree=ast.parse(self.raw);self.n={}
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef,ast.Assign))],type_ignores=[]),str(self.script),'exec'),self.n)
    def test_normal_ci_runs_closed_controls_with_existing_budget(self):
        workflow=(HERE.parent.parent/'.github/workflows/resource-market-ci.yml').read_text()
        invoke='timeout 25s python3 -B scripts/ops/test_public_bft_legacy_backup_capacity.py -v'
        self.assertEqual(workflow.count(invoke),1)
        block=workflow.split('      - name: Verify original-state operator transition preserves custody and uncertain attempts\n',1)[1].split('      - name:',1)[0]
        self.assertIn('timeout-minutes: 3',block);self.assertIn(invoke,block)
        self.assertIn('bash scripts/verify/public-bft-operator-transition-check.sh',block)
        self.assertIn('timeout 45s python3 -B scripts/ops/test_public_bft_transition_payload.py -v',block)
        for event,next_event in [('  push:','  pull_request:'),('  pull_request:','\npermissions:')]:
            paths=workflow.split(event,1)[1].split(next_event,1)[0]
            for leaf in ['remote/public-bft-final-snapshot.sh','remote/public-bft-scoped-backup.sh','test_public_bft_legacy_backup_capacity.py']:
                self.assertIn("'scripts/ops/"+leaf+"'",paths)
    def test_end_to_end_existing_one_gib_limit_and_guard_order(self):
        root=HERE.parent.parent
        self.assertEqual(self.n['SNAPSHOT_MAX_BYTES'],1<<30);self.assertEqual(self.n['SNAPSHOT_RESERVE_BYTES'],2<<30)
        for leaf,literal in [('scripts/ops/public-bft-linux-public-tools.py','MAX_FILE = 1 << 30'),('scripts/verify/public-bft-candidate-binding.mjs','const input = hashOriginalFile(file, 1 << 30, true);'),('cmd/ynx-consensus-package/migration_public_summary.go','const migrationPublicSummaryMaximum = 1 << 30'),('internal/consensus/genesis_migration_reference.go','const maxCometMigrationBytes = 1 << 30')]:
            self.assertIn(literal,(root/leaf).read_text())
        main=next(n for n in ast.parse(self.raw).body if isinstance(n,ast.FunctionDef) and n.name=='main')
        calls=list(ast.walk(main))
        check=next(n for n in calls if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='snapshot_capacity')
        reserve=next(n for n in calls if isinstance(n,ast.Call) and ast.unparse(n.func)=='os.mkdir' and ast.unparse(n.args[0])=='attempt')
        self.assertLess(check.lineno,reserve.lineno)
        self.assertIn("preexec_fn=snapshot_file_limit if label == 'export' else None",self.raw)
    def test_capacity_insufficient_and_existing_kernel_bound_do_not_write(self):
        n=self.n
        class FS:
            f_frsize=1
            f_bavail=3<<30
        with patch('os.statvfs',return_value=FS()):
            with self.assertRaisesRegex(ValueError,'insufficient'):n['snapshot_capacity'](self.root)
            self.assertEqual(list(self.root.iterdir()),[])
            FS.f_bavail+=1
            with patch.object(n['resource'],'getrlimit',return_value=(128,128)):
                with self.assertRaisesRegex(ValueError,'existing file limit'):n['snapshot_capacity'](self.root)
            with patch.object(n['resource'],'getrlimit',return_value=(128,n['resource'].RLIM_INFINITY)):
                with self.assertRaisesRegex(ValueError,'existing file limit'):n['snapshot_capacity'](self.root)
            result=n['snapshot_capacity'](self.root)
        self.assertIsNone(result['exportedMigrationBytes']);self.assertFalse(result['fullFirstImportReady'])
        self.assertEqual(list(self.root.iterdir()),[])
    def test_original_export_file_limit_is_child_only_and_retains_uncertain_file(self):
        n=self.n;original=n['resource'].getrlimit(n['resource'].RLIMIT_FSIZE)
        n['SNAPSHOT_MAX_BYTES']=128  # Private test seam, no production option.
        target=self.root/'original-export.json'
        child=subprocess.run([sys.executable,'-B','-c',
            'import os,sys\nf=open(sys.argv[1],"xb",buffering=0)\nraw=b"PUBLIC"*1024\nwhile raw:\n n=f.write(raw)\n if not n: raise OSError("short write")\n raw=raw[n:]\nf.close()',str(target)],
            preexec_fn=n['snapshot_file_limit'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,timeout=10)
        self.assertNotEqual(child.returncode,0);self.assertTrue(target.exists());self.assertLessEqual(target.stat().st_size,128)
        self.assertEqual(n['resource'].getrlimit(n['resource'].RLIMIT_FSIZE),original)
        self.assertFalse((self.root/'final-migration-state.evidence.json').exists())

if __name__=='__main__':unittest.main()
