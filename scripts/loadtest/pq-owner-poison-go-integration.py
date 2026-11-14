"""Local test-only cross-language bridge; no nodes, release or credential output."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from types import SimpleNamespace


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def main():
    d=module('pq-independent-load');t=module('pq-public-owner-transport');n=module('pq-normal-process-lab')
    test_binary=Path(os.environ['YNX_POISON_GO_TEST_BINARY'])
    work=Path(os.environ['YNX_POISON_TEST_WORK']);public=work/'public';public.mkdir(mode=0o700)
    log=public/'real-go-sender.log'
    with log.open('wb') as output:
        env=dict(os.environ);env['YNX_POISON_GO_CHILD']='1'
        helper=os.environ.get('YNX_POISON_GO_HELPER_TEST','TestPQLabExperimentalPoisonGoHelper')
        child=subprocess.Popen([str(test_binary),'-test.run=^'+helper+'$', '-test.timeout=20s'],
                               stdin=subprocess.PIPE,stdout=output,stderr=output,env=env,pass_fds=(3,))
        try:
            Session=t.session_class(d.SenderSession,n,d.lab);s=Session.__new__(Session)
            s.c=SimpleNamespace(w=SimpleNamespace(work=work),measurements=SimpleNamespace(record=lambda *a,**k:None))
            s.name='real-go-sender';s.owners=(0,1);s.offset=0;s.partial=b'';s.ready=None;s.prepare_source=False
            s.path=log;s.proc=child;s.lock=threading.Lock();s.poisoned=False;s.poison_retirement=True
            s.trace_lock=threading.Lock();s.traces=[];s.attempts=0
            stop=threading.Event();ready=s.wait_ready(stop,time.monotonic()+15,lambda:None)
            assert ready['signed'] is False and ready['nonceReserved'] is False
            request=dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId='b'*64,ownerIndex=0,firstNonce='2',members=1)
            current=json.loads(os.environ['YNX_POISON_CHECKPOINT'])
            command=n.sender_command_data('sign',request,current['height'],current['appHash'])
            real_receive=s.receive
            def cut(path,*args,**kwargs):
                if path is not None and path.name=='original-sign-reply.json':raise TimeoutError('original sign reply lost')
                return real_receive(path,*args,**kwargs)
            s.receive=cut
            try:
                s.exchange(command,public/'original-sign-reply.json',stop,
                           prepare_command=lambda:command,prepare_owner_path=public/'prepare-owner.json')
                raise AssertionError('lost reply did not fail')
            except TimeoutError as e:
                assert str(e)=='original sign reply lost'
            assert s.poisoned and child.poll() is not None
            trace=s.traces[0]['poisonRetirement']
            assert trace['stdinCut'] and trace['eofExitObserved'] and not trace['terminateRequested'] and not trace['killRequested']
            assert not trace['lateRepliesRead'] and not trace['originalOperationReplayed'] and not trace['wipeProven']
            assert not (public/'original-sign-reply.json').exists()
            try:s.exchange(command,public/'replayed.json',stop);raise AssertionError('poisoned stream accepted retry')
            except RuntimeError as e:assert 'recover originals, never replay' in str(e)
            assert not (public/'replayed.json').exists()
            print(json.dumps(dict(originalReady=True,originalOwnerPrepared=True,originalLostReply=True,
                                  originalProcessReaped=True,gracefulEOF=True,lateReplyRead=False,
                                  replayed=False,physicalWipeProven=False,returnCode=child.returncode)))
        finally:
            if child.poll() is None:child.kill();child.wait()
            if child.stdin is not None and not child.stdin.closed:child.stdin.close()

if __name__=='__main__':main()
