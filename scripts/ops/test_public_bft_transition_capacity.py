#!/usr/bin/env python3
"""Synthetic filesystem/command controls only; no SSH, service, keygen or Go."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
HELPER=ROOT/'scripts/ops/remote/public-bft-operator-transition.sh'
TEXT=HELPER.read_text()
BODY=TEXT.split("<<'PYCAPACITY'\n",1)[1].split('\nPYCAPACITY\n',1)[0]
def load():
    m=types.ModuleType('original_capacity');exec(compile(BODY,str(HELPER), 'exec'),m.__dict__);return m

def raw(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def digest(v):return hashlib.sha256(v).hexdigest()

class Fixture:
    def __init__(self,path):
        self.root=path.resolve();self.m=load();m=self.m
        m.installed_uid=lambda:os.geteuid() # Synthetic fixture owns its public role file; no real ynx lookup.
        for name,rel in [('CANDIDATE','var/lib/candidate'),('UNIT','etc/systemd/system/operator.service'),('CAPBASE','opt/operator-transitions'),('BACKUPBASE','var/lib'),('BRIDGEBASE','var/tmp')]:
            p=self.root/rel;setattr(m,name,p);(p.parent if name=='UNIT' else p).mkdir(parents=True,exist_ok=True,mode=0o700)
        self.stage=m.CAPBASE/'transition-original'/'primary'/'capacity';self.stage.mkdir(parents=True,mode=0o700)
        self.role=dict(role='primary',home=str(self.root/'data/home'),abciState=str(self.root/'data/app/state'),legacyKeyPath=str(self.root/'custody/validator-key'),legacyStatePath=str(self.root/'custody/hrs'),nodeKeyPath=str(self.root/'custody/node-key'))
        self.write(Path(self.role['home'])/'data/block.db',b'original synthetic public block bytes')
        self.write(Path(self.role['abciState']),b'synthetic complete App original')
        for k in ('legacyKeyPath','legacyStatePath','nodeKeyPath'):self.write(Path(self.role[k]),b'NEVER_OPEN_PRIVATE_BODY_'+k.encode())
        for p in (self.role['abciState']+'.writer.lock',self.role['legacyStatePath']+'.writer.lock'):self.write(Path(p),b'')
        plan=dict(pqSchedule='',pqScheduleHash='',roles=[self.role]);self.write(self.stage/'old-package/common/operator-plan.json',raw(plan));oldpin=digest(raw(plan))
        migration=b'synthetic canonical migration';self.write(m.CANDIDATE/'config/bound-migration.json',migration);(m.CANDIDATE/'bin').mkdir(mode=0o700)
        self.write(self.stage/'old-package/package-manifest.json',raw(dict(operatorPlanHash=oldpin,files={'common/operator-plan.json':oldpin,'roles/primary/config/bound-migration.json':digest(migration)})))
        self.b=dict(version='YNX-OPERATOR-TRANSITION-BINDING/v1',phase='quiesce',transitionId='transition-original',role='primary',approvalSHA256='a'*64,oldOperatorPlanSHA256=oldpin,oldRuntimeCommit='b'*40,oldRuntimeManifestSHA256='',runtimeCommit='c'*40,runtimeManifestSHA256='',originalRole=self.role,chainId='synthetic-only',migrationStateHash='d'*64,stateLayout='atomic-json',oldCometSHA256='e'*64)
        names=('ynx-abci','ynx-comet','ynx-bft-gatewayd','ynx-consensus-pq-remote-signer','ynx-consensus-pq-key-init','ynx-consensus-proof-verify','ynx-consensus-package','ynx-consensus-keycheck')
        for name,commit,key in [('SOURCE.json','c'*40,'runtimeManifestSHA256'),('old-SOURCE.json','b'*40,'oldRuntimeManifestSHA256')]:
            value=dict(version='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v3',commit=commit,platform='linux/amd64',binaries={n:dict(bytes=2<<20,sha256='e'*64) for n in names})
            self.write(self.stage/name,raw(value));self.b[key]=digest(raw(value))
        rolemanifest=dict(node=dict(role='primary'),chainId='synthetic-only',migrationStateHash='d'*64,privateValidatorKeyPath=self.role['legacyKeyPath'],nodeKeyPath=self.role['nodeKeyPath'])
        for name,target,value in [('role-manifest.json',m.CANDIDATE/'role-manifest.json',raw(rolemanifest)),('scripts/start-operator.sh',m.CANDIDATE/'scripts/start-operator.sh',b'original launcher'),('systemd/'+m.UNIT.name,m.UNIT,b'original unit')]:
            self.write(self.stage/'old-role'/name,value);self.write(target,value)
        self.r=dict(version='YNX-OPERATOR-TRANSITION-CAPACITY-REQUEST/v1',**{k:self.b[k] for k in m.IDENTITY},quiesceStageBytesBound=str(2<<30),futureStageBytesBound=str(4<<30),oldPackageBytes=str(5*len(migration)),currentMigrationBytes=str(len(migration)),currentMigrationSHA256=digest(migration),bridgeMode=True)
        self.process=dict(mainPid='100',startTicks='200',runningExecutableSHA256='e'*64)
        self.save()
    def write(self,p,value):
        p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_bytes(value);p.chmod(0o600)
    def save(self):self.write(self.stage/'request.json',raw(self.r));self.pin=digest(raw(self.r))
    def measure(self,mode='observe',receipt='-',available=1<<50):
        # Only filesystem free accounting is synthetic; all original paths,
        # held directory traversal, public bytes and private stat calls are real.
        fs=types.SimpleNamespace(f_frsize=4096,f_bavail=available//4096)
        with patch.object(self.m.os,'fstatvfs',return_value=fs):
            return self.m.measure(str(self.stage),self.b,self.pin,self.process,mode,str(receipt))

class CapacityTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.f=Fixture(Path(self.tmp.name))
    def test_original_metadata_only_complete_scope_and_overlap(self):
        f=self.f;m=f.m
        opened=[];original=m.os.open
        def opening(path,flags,*args,**kwargs):
            opened.append((str(path),flags))
            return original(path,flags,*args,**kwargs)
        with patch.object(m.os,'open',side_effect=opening):v=f.measure()
        private=[Path(f.role[k]).name for k in ('legacyKeyPath','legacyStatePath','nodeKeyPath','abciState')]
        self.assertFalse(any(n in private and not flags&os.O_DIRECTORY for n,flags in opened))
        self.assertTrue(v['capacityAvailable']);self.assertTrue(v['sampleOnly']);self.assertFalse(v['growthReserved']);self.assertFalse(v['firstNativeImport']);self.assertFalse(v['sourceGrant'])
        self.assertEqual(v['groups']['committed']['files'],'7')
        text=raw(v);self.assertNotIn(b'NEVER_OPEN',text);self.assertNotIn(str(f.root).encode(),text)
        a=m.inventory([f.role['home']]);b=m.inventory([f.role['home'],str(Path(f.role['home'])/'data/block.db')]);self.assertEqual(a,b)
    def test_old_public_only_guard_accepts_but_complete_numeric_budget_refuses(self):
        f=self.f;v=f.measure();old_required=2*int(f.r['quiesceStageBytesBound'])+(1<<30)
        free=old_required+(1<<20)
        # Actual old caller predicate, exact shell arithmetic from its stage
        # reserve. Synthetic free bytes are intentionally not host evidence.
        p=subprocess.run(['bash','-c','test "$1" -gt "$2"','_',str(free),str(old_required)],capture_output=True)
        self.assertEqual(p.returncode,0)
        self.assertFalse(f.measure(available=free)['capacityAvailable'])
        self.assertGreater(int(v['bounds']['backupBytesBound']),0)
        self.assertGreater(int(v['bounds']['bridgeBytesBound']),0)
    def test_zero_margin_refused_and_distinct_filesystems_cannot_borrow(self):
        f=self.f;v=f.measure();needed=int(v['filesystems'][0]['requiredBytes'])
        # Exact equality, not allocation rounding below the requested byte.
        with patch.object(f.m.os,'fstatvfs',return_value=types.SimpleNamespace(f_frsize=1,f_bavail=needed)):
            equal=f.m.measure(str(f.stage),f.b,f.pin,f.process,'observe')
        self.assertEqual(equal['filesystems'][0]['availableBytes'],str(needed))
        self.assertFalse(equal['capacityAvailable'])
        actual=f.m.os.fstatvfs;count=0
        def fs(_):
            nonlocal count;count+=1;return types.SimpleNamespace(f_frsize=4096,f_bavail=(1 if count==4 else 1<<40))
        with patch.object(f.m.os,'fstatvfs',side_effect=fs):v=f.m.measure(str(f.stage),f.b,f.pin,f.process,'observe')
        self.assertFalse(v['capacityAvailable'])
    def test_only_selected_original_tool_role_carries_bulk_bridge_operations(self):
        f=self.f
        f.r['version']='YNX-OPERATOR-TRANSITION-CAPACITY-REQUEST/v2'
        f.r['bridgeToolRole']='primary'
        f.save()
        producer=f.measure()['bounds']
        f.r['bridgeToolRole']='singapore'
        f.save()
        peer=f.measure()['bounds']
        self.assertEqual(int(peer['bridgeBytesBound']),3*(2*3+144+256)*(1<<20))
        self.assertGreater(int(producer['bridgeBytesBound']),int(peer['bridgeBytesBound']))
        self.assertEqual({k:v for k,v in producer.items() if k!='bridgeBytesBound'},
                         {k:v for k,v in peer.items() if k!='bridgeBytesBound'})
        for bad in ('', 'outside'):
            f.r['bridgeToolRole']=bad;f.save()
            with self.assertRaisesRegex(ValueError,'bridge tool role'):f.measure()
    def test_all_original_journal_locks_counted_and_missing_refused(self):
        f=self.f
        for layout in ('snapshot-journal','block-journal'):
            with self.subTest(layout=layout):
                f.b['stateLayout']=layout
                for suffix in ('.lock','.read.lock'):f.write(Path(f.role['abciState']+suffix),b'')
                self.assertEqual(f.measure()['groups']['committed']['files'],'9')
                Path(f.role['abciState']+'.read.lock').unlink()
                with self.assertRaises(OSError):f.measure()
    def test_symlink_special_unknown_and_directory_alias_refused_before_open(self):
        f=self.f;state=Path(f.role['home'])/'data'
        for kind in ('link','fifo','UNKNOWN','partial'):
            with self.subTest(kind=kind):
                p=state/('retained.UNKNOWN' if kind=='UNKNOWN' else 'retained.partial' if kind=='partial' else kind)
                if kind=='link':p.symlink_to(f.role['legacyKeyPath'])
                elif kind=='fifo':os.mkfifo(p)
                else:p.write_bytes(b'preserve')
                with self.assertRaises((OSError,ValueError)):f.measure()
                p.unlink()
        real=Path(f.role['home']);moved=real.with_name('original-home');real.rename(moved);real.symlink_to(moved,target_is_directory=True)
        with self.assertRaises((OSError,ValueError)):f.measure()
    def test_sparse_private_logical_size_no_compression_credit(self):
        f=self.f;p=Path(f.role['home'])/'data/sparse';p.touch();p.chmod(0o600)
        with p.open('r+b') as out:out.truncate(32<<20)
        v=f.measure();g=v['groups']['committed'];self.assertGreaterEqual(int(g['rawBytes']),32<<20);self.assertGreater(int(g['archiveBytesBound']),2*(32<<20))
    def test_growing_replacing_source_and_retained_ceiling_refused(self):
        f=self.f;v=f.measure();receipt=f.root/'capacity-result.json';f.write(receipt,raw(v));self.assertTrue(f.measure('remeasure',receipt)['capacityAvailable'])
        target=Path(f.role['home'])/'data/block.db';target.write_bytes(target.read_bytes()+b'growth')
        with self.assertRaisesRegex(ValueError,'grew beyond'):f.measure('remeasure',receipt)
        original=f.m.Inventory.result
        # Change a source between the actual two metadata inventories.
        done=False;walk=f.m.Inventory.walk
        def changing(obj,path):
            nonlocal done
            result=walk(obj,path)
            if not done:done=True;target.write_bytes(target.read_bytes()+b'changed')
            return result
        with patch.object(f.m.Inventory,'walk',changing):
            with self.assertRaisesRegex(ValueError,'changed between'):f.measure()
    def test_public_binding_changed_duplicate_and_wrong_phase_reject(self):
        f=self.f
        for field,value in [('role','seoul'),('runtimeCommit','f'*40),('currentMigrationSHA256','1'*64),('oldPackageBytes','1'),('quiesceStageBytesBound','1'),('bridgeMode','true')]:
            with self.subTest(field=field):
                old=f.r[field];f.r[field]=value;f.save()
                with self.assertRaises((ValueError,KeyError)):f.measure()
                f.r[field]=old;f.save()
        p=f.stage/'request.json';data=p.read_bytes();data=data[:-1]+b',"role":"primary"}';p.write_bytes(data);f.pin=digest(data)
        with self.assertRaisesRegex(ValueError,'duplicate'):f.measure()
        f.save();f.b['phase']='install'
        with self.assertRaises(ValueError):f.measure()
    def test_current_native_is_not_installed_bootstrap_fallback(self):
        f=self.f;(f.m.CANDIDATE/'role-manifest.json').unlink()
        with self.assertRaises(OSError):f.measure()
        self.assertNotIn('devnet-state.json',BODY)
    def test_future_or_installed_identity_changes_refused(self):
        f=self.f;file=f.stage/'old-package/common/operator-plan.json';plan=json.loads(file.read_bytes());plan['pqSchedule']='actualschedule';f.write(file,raw(plan));f.b['oldOperatorPlanSHA256']=digest(raw(plan));f.r['oldOperatorPlanSHA256']=f.b['oldOperatorPlanSHA256'];f.save()
        with self.assertRaisesRegex(ValueError,'bootstrap'):f.measure()
    def test_unknown_output_is_generic_no_private_paths_and_no_mutation(self):
        f=self.f;before={str(p):p.read_bytes() for p in f.root.rglob('*') if p.is_file()};module=BODY
        p=subprocess.run([os.sys.executable,'-B','-','observe',str(f.stage),json.dumps(f.b),f.pin,json.dumps(f.process),'-'],input=module,text=True,capture_output=True)
        self.assertNotEqual(p.returncode,0);self.assertNotIn(str(f.root),p.stderr);self.assertNotIn('NEVER_OPEN',p.stderr)
        self.assertEqual(before,{str(p):p.read_bytes() for p in f.root.rglob('*') if p.is_file()})
    def test_normal_remote_has_explicit_prefreeze_and_stopped_rechecks(self):
        remote=TEXT.split('operator_transition_remote() {',1)[1].split('operator_light_',1)[0]
        self.assertEqual(remote.count('operator_transition_capacity_remeasure || return $?'),2)
        self.assertLess(remote.index('operator_transition_capacity_remeasure || return $?'),remote.index('operator_transition_freeze'))
        stopped=remote.index('    operator_transition_stopped\n')
        self.assertLess(stopped,remote.rindex('operator_transition_capacity_remeasure || return $?'))
        self.assertLess(remote.rindex('operator_transition_capacity_remeasure || return $?'),remote.index('operator_transition_inspect "$attempt/checkpoint-before.json"'))
        self.assertIn('new_package=-',remote);self.assertIn('"$phase" == quiesce ]] || new_package=',remote)

    def test_parallel_sibling_churn_preserves_ancestor_identity(self):
        # Real directory operations in a second thread, not fabricated stat
        # tuples. The child exists across the selected check, so the old
        # nlink/full-stat ancestor checks fail deterministically.
        f=self.f;m=f.m
        middle=f.root/'ancestor-controls/middle'
        target=middle/'leaf/public.json';f.write(target,b'original public bytes')
        for phase in ('open','held'):
            with self.subTest(phase=phase):
                begin=threading.Event();created=threading.Event();finish=threading.Event();errors=[]
                sibling=middle/'unrelated-sibling'
                def churn():
                    try:
                        if not begin.wait(5):raise AssertionError('reader did not reach ancestor')
                        sibling.mkdir();created.set()
                        if not finish.wait(5):raise AssertionError('reader did not finish')
                        sibling.rmdir()
                    except BaseException as exc:errors.append(exc);created.set()
                worker=threading.Thread(target=churn);worker.start()
                original=m.os.open;triggered=False
                def opening(path,flags,*args,**kwargs):
                    nonlocal triggered
                    if phase=='open' and path=='middle' and not triggered:
                        triggered=True;begin.set();self.assertTrue(created.wait(5));self.assertFalse(errors)
                    return original(path,flags,*args,**kwargs)
                try:
                    with patch.object(m.os,'open',side_effect=opening):
                        with m.held(target) as (fd,before):
                            if phase=='held':
                                begin.set();self.assertTrue(created.wait(5));self.assertFalse(errors)
                            self.assertEqual(os.read(fd,64),b'original public bytes')
                finally:
                    finish.set();worker.join(6)
                self.assertFalse(worker.is_alive());self.assertFalse(errors)

    def test_ancestor_replacement_alias_and_mode_changes_still_refuse(self):
        f=self.f;m=f.m
        for change in ('replace','symlink','mode'):
            with self.subTest(change=change):
                middle=f.root/change/'middle';target=middle/'leaf/public.json';f.write(target,b'original')
                with self.assertRaises((ValueError,OSError)):
                    with m.held(target):
                        if change=='mode':middle.chmod(0o750)
                        else:
                            moved=middle.with_name('retained-original');middle.rename(moved)
                            if change=='replace':middle.mkdir(mode=0o700)
                            else:middle.symlink_to(moved,target_is_directory=True)
                # Preserve originals throughout the refusal; no repair/retry.
                original=middle if change=='mode' else middle.with_name('retained-original')
                self.assertEqual((original/'leaf/public.json').read_bytes(),b'original')

    def test_target_file_and_inventory_directory_changes_still_refuse(self):
        f=self.f;m=f.m
        for change in ('body','replace','mode','directory-content'):
            with self.subTest(change=change):
                target=f.root/'targets'/change/'public.json';f.write(target,b'original')
                directory=change=='directory-content'
                with self.assertRaisesRegex(ValueError,'original changed while held'):
                    with m.held(target.parent if directory else target,directory):
                        if change=='body':target.write_bytes(b'modified')
                        elif change=='replace':
                            replacement=target.with_name('replacement');f.write(replacement,b'original');replacement.replace(target)
                        elif change=='mode':target.chmod(0o640)
                        else:(target.parent/'new-entry').mkdir()

    def test_complete_measure_while_shared_parent_has_parallel_churn(self):
        # Match the CI incident: another test creates temporary directories in
        # the shared parent, outside every privately enumerated source root.
        f=self.f;parent=f.root.parent
        running=threading.Event();stop=threading.Event();errors=[];count=[0]
        churn_root=parent/(f.root.name+'-sibling-churn')
        def churn():
            try:
                while not stop.is_set():
                    churn_root.mkdir();(churn_root/'unrelated').write_bytes(b'synthetic')
                    running.set();(churn_root/'unrelated').unlink();churn_root.rmdir();count[0]+=1
            except BaseException as exc:errors.append(exc);running.set()
        worker=threading.Thread(target=churn);worker.start()
        try:
            self.assertTrue(running.wait(5));self.assertFalse(errors)
            receipt=f.measure()
            self.assertTrue(receipt['capacityAvailable'])
            self.assertGreater(count[0],0)
        finally:stop.set();worker.join(6)
        self.assertFalse(worker.is_alive());self.assertFalse(errors)

    def test_actual_source_binary_bound_and_installed_owner(self):
        f=self.f;f.r['quiesceStageBytesBound']=str(int(f.r['oldPackageBytes'])+6*(1<<20));f.save()
        self.assertTrue(f.measure()['capacityAvailable'])
        f.m.installed_uid=lambda:os.geteuid()+1
        with self.assertRaisesRegex(ValueError,'public input'):f.measure()
    def test_remeasure_no_double_quiesce_upload_and_malformed_receipt_refused(self):
        f=self.f;v=f.measure();p=f.root/'receipt.json';f.write(p,raw(v));remaining=f.measure('remeasure',p)
        self.assertEqual(int(v['bounds']['publicStagesBytesBound'])-int(remaining['bounds']['publicStagesBytesBound']),2*int(f.r['quiesceStageBytesBound']))
        for change in ('negative','wrongtype','duplicatefs','grant'):
            with self.subTest(change=change):
                bad=copy.deepcopy(v)
                if change=='negative':bad['groups']['committed']['rawBytes']='-1'
                elif change=='wrongtype':bad['groups']['committed']['rawBytes']=int(bad['groups']['committed']['rawBytes'])
                elif change=='duplicatefs':bad['filesystems'].append(copy.deepcopy(bad['filesystems'][0]))
                else:bad['sourceGrant']=0
                f.write(p,raw(bad))
                with self.assertRaises(ValueError):f.measure('remeasure',p)
    def test_remeasure_failure_survives_shell_conditional_context(self):
        f=self.f;folder=f.root/'fullstage/capacity-receipts';folder.mkdir(parents=True)
        receipts={};v=f.measure()
        for role in f.m.ROLES:
            row=dict(v,role=role);data=raw(row);f.write(folder/(role+'.json'),data)
            receipts[role]=dict(requestSHA256=f.pin,receiptSHA256=digest(data))
        f.write(folder/'manifest.json',raw(dict(version='YNX-OPERATOR-TRANSITION-CAPACITY-SET/v1',transitionId=f.b['transitionId'],runtimeCommit=f.b['runtimeCommit'],runtimeManifestSHA256=f.b['runtimeManifestSHA256'],roles=receipts)))
        f.write(f.root/'binding.json',raw(f.b));f.write(f.root/'original-process.json',raw(f.process))
        script='''set -Eeuo pipefail
source "$1"
stage="$2/fullstage"; binding="$2/binding.json"; attempt="$2"; tx=transition-original; role=primary; commit="$3"; manifest="$4"
# Fault injection only into the numeric getter and public digest; no host or
# service is called. Original set-reader and actual Bash condition execute.
operator_transition_sha() { printf '%064d\\n' 1; }
operator_transition_capacity_measure() { return 73; }
if operator_transition_capacity_remeasure; then echo WRONGLY_ACCEPTED; exit 99; else rc=$?; fi
test "$rc" = 73
printf 'RETAINED_UNKNOWN_EXACT_73\\n'
'''
        p=subprocess.run(['bash','-c',script,'_',str(HELPER),str(f.root),f.b['runtimeCommit'],f.b['runtimeManifestSHA256']],capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,'RETAINED_UNKNOWN_EXACT_73\n')

if __name__=='__main__':unittest.main()
