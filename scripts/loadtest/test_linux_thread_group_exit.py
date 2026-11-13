"""Actual Z/ESRCH regression and Linux group-lifetime proof; no chain load."""
import errno
import hashlib
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


def terminal_stat(raw=None):
    # Linux do_task_stat leaves these defaults when lock_task_sighand fails.
    prefix, separator, suffix=(stat() if raw is None else raw).rpartition(b') ')
    fields=suffix.split();fields[1:4]=[b'0',b'-1',b'-1'];fields[17]=b'0'
    return prefix+separator+b' '.join(fields)


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

    def probe(self,mask=1,fd_pid=42,ticks_after=100,stat_reads=None,owned=False):
        calls=[];events=[];poller=mock.Mock();poller.poll.return_value=[] if not mask else [(17,mask)]
        def kernel(path,limit=65536):
            if str(path).endswith('/smaps_rollup'):
                raise ProcessLookupError(errno.ESRCH,'original private7c')
            if str(path).startswith('/proc/self/fdinfo/'):return ('Pid:\t%d\n'%fd_pid).encode()
            calls.append(str(path))
            return stat_reads[len(calls)-1] if stat_reads is not None else stat(ticks=100 if len(calls)==1 else ticks_after)
        with mock.patch.object(lab.os,'pidfd_open',return_value=17,create=True) as opened,mock.patch.object(lab.os,'close') as closed,mock.patch.object(lab.select,'poll',return_value=poller,create=True),mock.patch.object(lab.guard,'bounded',side_effect=kernel):
            result=(lab.owned_rss(42,dict(startTicks=100),retired=events.append) if owned
                    else lab.process_group_exit_probe(42,dict(startTicks=100)))
            opened.assert_called_once_with(42,0);poller.poll.assert_called_once_with(20);closed.assert_called_once_with(17)
        return (result,events) if owned else result

    def test_private7c_final_stat_sentinel_requires_bound_positive_pidfd(self):
        original=terminal_stat()
        with self.assertRaisesRegex(RuntimeError,'invalid proc stat fields'):
            lab.guard.parse_stat(original,42)
        value,events=self.probe(stat_reads=[stat(),stat(),stat(),original],owned=True)
        self.assertEqual(value,0);self.assertEqual(len(events),1)
        proof=events[0]['groupExitProof']
        self.assertEqual(proof['state'],'group-exited')
        self.assertEqual(proof['lastThreads'],0)
        self.assertEqual(proof['terminalStat'],dict(
            reason='same-identity-sighand-unavailable-after-pidfd-exit',
            pid=42,startTicks=100,parent=0,group=-1,session=-1,threads=0,
            state='Z',rawSHA256=hashlib.sha256(original).hexdigest()))
        self.assertEqual(events[0]['rssError'],errno.ESRCH)
        self.assertEqual(events[0]['groupExitProof']['terminalStat'],proof['terminalStat'])

    def test_terminal_sentinel_cannot_establish_identity_or_replace_exit_event(self):
        sentinel=terminal_stat()
        for rows,mask in (([sentinel,stat(),stat()],1),([stat(),sentinel,stat()],1),
                          ([stat(),stat(),sentinel],0)):
            with self.subTest(rows=rows,mask=mask),self.assertRaises(RuntimeError):
                self.probe(mask=mask,stat_reads=rows)
        # Ordinary inventory and successful RSS sampling keep the strict parser.
        with mock.patch.object(lab.guard,'bounded',side_effect=[b'Rss: 12 kB\n',sentinel]):
            with self.assertRaisesRegex(RuntimeError,'invalid proc stat fields'):
                lab.owned_rss(42,dict(startTicks=100))

    def test_terminal_stat_reuse_malformed_or_other_negative_fields_fail_closed(self):
        sentinel=terminal_stat();prefix,separator,suffix=sentinel.rpartition(b') ')
        invalid=[b'',b'42 (short) Z',terminal_stat(stat(pid=43)),terminal_stat(stat(ticks=101)),
                 terminal_stat(stat(ticks=-1))]
        for index,value in ((1,b'-1'),(2,b'-2'),(3,b'0'),(17,b'-1'),(17,b'1'),(19,b'not-a-tick')):
            fields=suffix.split();fields[index]=value;invalid.append(prefix+separator+b' '.join(fields))
        for raw in invalid:
            with self.subTest(raw=raw),self.assertRaises((RuntimeError,ValueError)):
                self.probe(stat_reads=[stat(),stat(),raw])

    @unittest.skipUnless(sys.platform=='linux','real Linux pidfd exit with controlled terminal stat projection')
    def test_actual_owned_pidfd_exit_with_terminal_stat_projection(self):
        # Real child, /proc identities, fdinfo and whole-group poll. Only the
        # leader ESRCH and documented terminal stat fields are injected; this
        # is not a claim that this run naturally reproduced the kernel race.
        process=lab.subprocess.Popen([sys.executable,'-I','-c','import os; os.read(0,1)'],
                                     stdin=lab.subprocess.PIPE)
        try:
            directory=Path('/proc')/str(process.pid);original=lab.guard.bounded
            before=lab.guard.parse_stat(original(directory/'stat'),process.pid)
            reads=0;events=[];projection=None
            def kernel(path,limit=65536):
                nonlocal reads,projection
                if path==directory/'smaps_rollup':
                    raise ProcessLookupError(errno.ESRCH,'controlled leader RSS transition')
                raw=original(path,limit)
                if path==directory/'stat':
                    reads+=1
                    if reads==4:
                        projection=terminal_stat(raw);return projection
                elif path.parent==Path('/proc/self/fdinfo'):
                    process.stdin.write(b'x');process.stdin.flush()
                    exited=lab.select.poll();exited.register(int(path.name),1|16)
                    self.assertTrue(exited.poll(2000),'owned child did not exit in test bound')
                return raw
            with mock.patch.object(lab.guard,'bounded',side_effect=kernel):
                self.assertEqual(lab.owned_rss(process.pid,before,retired=events.append),0)
            self.assertIsNotNone(projection);self.assertEqual(reads,4)
            proof=events[0]['groupExitProof'];self.assertTrue(proof['pollMask']&(1|16))
            self.assertEqual(proof['pid'],process.pid);self.assertEqual(proof['startTicks'],before['startTicks'])
            self.assertEqual(proof['terminalStat']['rawSHA256'],hashlib.sha256(projection).hexdigest())
            self.assertTrue(proof['nonConsuming']);self.assertIsNone(process.returncode)
            self.assertEqual(process.wait(timeout=2),0)
        finally:
            if process.poll() is None:process.kill();process.wait(timeout=2)
            process.stdin.close()

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
