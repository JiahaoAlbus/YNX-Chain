"""Actual Z/ESRCH regression and Linux group-lifetime proof; no chain load."""
import errno
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('group_exit_lab',Path(__file__).with_name('consensus-linux-cohort.py'))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


def stat(pid=42,ticks=100,state='Z',threads=6):
    f=[state]+['0']*45;f[1]='1';f[2]='42';f[17]=str(threads);f[19]=str(ticks)
    return (str(pid)+' (original compiler) '+' '.join(f)).encode()


class ThreadGroupExitControls(unittest.TestCase):
    def test_pidfd_guard_only_compatibility_preserves_original_functional_before(self):
        def load(name,file):
            s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
        h=load('pidfd_height','pq-height-vectors.py');f=load('pidfd_height_fixtures','test_pq_height_vectors.py')
        import json
        with tempfile.TemporaryDirectory() as temporary:
            a,b=Path(temporary).resolve()/'a',Path(temporary).resolve()/'b';f.fixture(a);f.fixture(b)
            for root in (a,b):
                receipt=json.loads((root/'receipt.json').read_bytes());receipt.update(toolsCommit=h.FUNCTIONAL_BASE,heightVectorLeafSHA256=h.FUNCTIONAL_LEAF,caps=h.lab.CAPS);f.save(root,'receipt.json',receipt)
            receipt=json.loads((b/'receipt.json').read_bytes());receipt.update(toolsCommit='e'*40,compatibleFunctionalToolsCommit=h.FUNCTIONAL_BASE,resourceObserverVersion='same-process-rss-v3-pidfd');f.save(b,'receipt.json',receipt)
            result=h.compare(a,b);self.assertTrue(result['guardOnlyFunctionalCompatibility']);self.assertFalse(result['performanceComparisonQualified']);self.assertFalse(result['optimizedPressureAuthorized'])
            receipt['heightVectorLeafSHA256']='f'*64;f.save(b,'receipt.json',receipt)
            with self.assertRaisesRegex(RuntimeError,'observer/tool versions differ'):h.compare(a,b)

    def probe(self,mask=1,fd_pid=42,ticks_after=100):
        calls=[];poller=mock.Mock();poller.poll.return_value=[] if not mask else [(17,mask)]
        def kernel(path,limit=65536):
            if str(path).startswith('/proc/self/fdinfo/'):return ('Pid:\t%d\n'%fd_pid).encode()
            calls.append(str(path));return stat(ticks=100 if len(calls)==1 else ticks_after)
        with mock.patch.object(lab.os,'pidfd_open',return_value=17,create=True) as opened,mock.patch.object(lab.os,'close') as closed,mock.patch.object(lab.select,'poll',return_value=poller,create=True),mock.patch.object(lab.guard,'bounded',side_effect=kernel):
            result=lab.process_group_exit_probe(42,dict(startTicks=100))
            opened.assert_called_once_with(42,0);poller.poll.assert_called_once_with(0);closed.assert_called_once_with(17)
        return result

    def test_original_six_Z_esrch_observations_are_not_zero_without_group_proof(self):
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'original'),stat()]*6),mock.patch.object(lab,'same_process_rss_alternative',return_value=None),mock.patch.object(lab,'process_group_exit_probe',return_value=dict(state='not-exited',pidfdFlags=0,pollMask=0)),mock.patch.object(lab.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'RSS unreadable.*"threads":6'):lab.owned_rss(42,dict(startTicks=100))

    def test_only_kernel_whole_group_exit_can_retire_multi_thread_Z(self):
        proof=self.probe();self.assertEqual(proof['state'],'group-exited');self.assertTrue(proof['nonConsuming']);self.assertEqual(proof['pidfdFlags'],0)
        events=[]
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'original'),stat()]),mock.patch.object(lab,'process_group_exit_probe',return_value=proof):
            self.assertEqual(lab.owned_rss(42,dict(startTicks=100),retired=events.append),0)
        self.assertEqual(events[0]['reason'],'same-identity-pidfd-group-exited');self.assertEqual(events[0]['groupExitProof'],proof)

    def test_unready_pidfd_does_not_override_real_live_thread_RSS(self):
        self.assertEqual(self.probe(mask=0)['state'],'not-exited')
        events=[]
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'original'),stat()]),mock.patch.object(lab,'process_group_exit_probe',return_value=dict(state='not-exited')),mock.patch.object(lab,'same_process_rss_alternative',return_value=(8192,dict(sampleKind='same-thread-group-smaps',retired=False))):
            self.assertEqual(lab.owned_rss(42,dict(startTicks=100),fallback=events.append),8192)
        self.assertFalse(events[0]['retired'])

    def test_wrong_binding_reused_identity_and_poll_errors_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError,'binding unavailable'):self.probe(fd_pid=43)
        with self.assertRaisesRegex(RuntimeError,'identity changed'):self.probe(ticks_after=101)
        with self.assertRaisesRegex(RuntimeError,'unexpected pidfd'):self.probe(mask=0x008)
        self.assertEqual(self.probe(mask=0x011,fd_pid=-1)['state'],'group-exited')

    @unittest.skipUnless(sys.platform=='linux','real Linux pidfd/main-thread-exit counterexample requires CORE')
    def test_actual_main_thread_Z_is_not_group_exit_until_live_worker_exits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.private').mkdir();(root/'public').mkdir();w=lab.Window(Path(__file__).resolve().parents[2],root)
            ready=root/'.private/ready';release=root/'.private/release'
            # Raw SYS_exit terminates ONLY the leader; worker keeps real RSS.
            script="""import ctypes,os,pathlib,sys,threading,time
ready,release=map(pathlib.Path,sys.argv[1:])
def worker():
 b=bytearray(8<<20)
 for i in range(0,len(b),4096):b[i]=1
 ready.write_text(str(threading.get_native_id()))
 while not release.exists():time.sleep(.01)
 os._exit(0)
threading.Thread(target=worker).start()
while not ready.exists():time.sleep(.001)
number={'x86_64':60,'aarch64':93}[os.uname().machine]
ctypes.CDLL(None).syscall(number,0)
"""
            p=w.launch('actual-thread-group-lifetime',[sys.executable,'-I','-c',script,str(ready),str(release)])
            try:
                deadline=lab.time.monotonic()+4
                while lab.time.monotonic()<deadline:
                    before=lab.guard.parse_stat(lab.guard.bounded(Path('/proc')/str(p.pid)/'stat'),p.pid)
                    if ready.exists() and before['state']=='Z':break
                    lab.time.sleep(.01)
                self.assertEqual(before['state'],'Z');self.assertGreater(before['threads'],1)
                self.assertEqual(lab.process_group_exit_probe(p.pid,before)['state'],'not-exited')
                # Unknown RSS may stop the run, but can NEVER become zero from Z.
                try:self.assertGreater(lab.owned_rss(p.pid,before),0)
                except RuntimeError as error:self.assertIn('RSS unreadable',str(error))
                release.write_text('original worker may exit')
                deadline=lab.time.monotonic()+4;proof={}
                while lab.time.monotonic()<deadline:
                    proof=lab.process_group_exit_probe(p.pid,before)
                    if proof['state']=='group-exited':break
                    lab.time.sleep(.01)
                self.assertEqual(proof['state'],'group-exited');self.assertEqual(proof['pidfdFlags'],0)
                self.assertEqual(lab.owned_rss(p.pid,before),0)
                self.assertEqual(p.wait(timeout=2),0)
            finally:
                release.write_text('cleanup');self.assertTrue(w.stop())


if __name__=='__main__':unittest.main()
