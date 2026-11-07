"""Stream isolation and uncertain acknowledgement controls; no signer or nodes."""
import importlib.util
import io
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=module('public_owner_transport','pq-public-owner-transport.py')
n=module('public_owner_normal','pq-normal-process-lab.py')
d=module('public_owner_driver','pq-independent-load.py')
b=module('public_owner_backend','pq-public-owner-backend.py')


def require(value,message):
    if not value:raise RuntimeError(message)


class Receiver:
    def receive(self,*args):return self.reply()


Session=m.session_class(Receiver,n,SimpleNamespace(require=require))


def command(owner=4,identity='a'*64,phase='sign'):
    request=dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId=identity,
                 ownerIndex=owner,firstNonce='2',members=1)
    return n.sender_command_data(phase,request,1,'b'*64)


def session(reply):
    value=Session.__new__(Session)
    value.ready={};value.owners=(4,5);value.lock=threading.Lock();value.poisoned=False
    value.trace_lock=threading.Lock();value.traces=[];value.attempts=0
    value.proc=SimpleNamespace(stdin=io.BytesIO(),poll=lambda:None)
    value.records=[]
    value.c=SimpleNamespace(measurements=SimpleNamespace(record=lambda *a,**kw:value.records.append((a,kw))))
    value.reply=reply
    return value


def response(owner=4,identity='a'*64,code='ORIGINAL_SAVED'):
    return dict(version='YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1',ownerIndex=owner,operationId=identity,code=code)


class TransportControls(unittest.TestCase):
    def test_unknown_is_retained_and_next_independent_owner_can_proceed(self):
        replies=iter([response(code='UNKNOWN'),response(5,'c'*64)])
        s=session(lambda:next(replies));stop=threading.Event()
        self.assertEqual(s.exchange(command(),None,stop)['code'],'UNKNOWN')
        s.exchange(command(5,'c'*64),None,stop)
        self.assertEqual([v[1]['owner'] for v in s.records],[4,5])
        self.assertEqual(len(s.proc.stdin.getvalue().splitlines()),2)

    def test_wrong_owner_operation_and_success_kind_poison_stream(self):
        for reply in (response(5),response(identity='c'*64),response(code='PROOF_CONFIRMED_DATA'),response(True)):
            with self.subTest(reply=reply):
                s=session(lambda:reply)
                with self.assertRaises(RuntimeError):s.exchange(command(),None,threading.Event())
                self.assertTrue(s.poisoned)
                original=s.proc.stdin.getvalue()
                with self.assertRaises(RuntimeError):s.exchange(command(),None,threading.Event())
                self.assertEqual(s.proc.stdin.getvalue(),original)
                self.assertEqual(s.records,[])

    def test_lost_ack_never_causes_implicit_retry(self):
        def lost():raise RuntimeError('cutoff original UNKNOWN')
        s=session(lost)
        with self.assertRaises(RuntimeError):s.exchange(command(),None,threading.Event())
        original=s.proc.stdin.getvalue()
        with self.assertRaises(RuntimeError):s.exchange(command(5,'c'*64),None,threading.Event())
        self.assertEqual(s.proc.stdin.getvalue(),original)
        report=s.transport_report()
        self.assertEqual(report['attempted'],2)
        self.assertNotIn('replyReceivedMonotonicNs',report['records'][0])
        self.assertFalse(report['automaticRetry'])

    def test_concurrent_call_cannot_write_before_previous_reply(self):
        entered=threading.Event();release=threading.Event();second=threading.Event();errors=[]
        def reply():
            if not entered.is_set():
                entered.set();require(release.wait(2),'test release deadline');return response()
            second.set();return response(5,'c'*64)
        s=session(reply)
        def run(cmd):
            try:s.exchange(cmd,None,threading.Event())
            except BaseException as error:errors.append(error)
        a=threading.Thread(target=run,args=(command(),));b=threading.Thread(target=run,args=(command(5,'c'*64),))
        a.start();self.assertTrue(entered.wait(2));b.start()
        try:
            self.assertFalse(second.wait(.05))
            self.assertEqual(len(s.proc.stdin.getvalue().splitlines()),1)
        finally:
            release.set();a.join(2);b.join(2)
        self.assertFalse(a.is_alive() or b.is_alive());self.assertEqual(errors,[])
        self.assertEqual(len(s.records),2)
        rows=s.transport_report()['records']
        self.assertEqual(len(rows),2)
        self.assertGreaterEqual(rows[1]['streamAcquiredMonotonicNs'],rows[0]['replyReceivedMonotonicNs'])

    def test_cancel_before_write_and_unknown_owner_do_not_send(self):
        s=session(lambda:response());stop=threading.Event();stop.set()
        with self.assertRaises(RuntimeError):s.exchange(command(),None,stop)
        with self.assertRaises(RuntimeError):s.exchange(command(6),None,threading.Event())
        self.assertEqual(s.proc.stdin.getvalue(),b'');self.assertFalse(s.poisoned)

    def test_retirement_does_not_claim_confirmation_or_release_a_nonce(self):
        s=session(lambda:response(identity='',code='OWNER_RETIRED'))
        s.exchange(command(identity='',phase='close-owner'),None,threading.Event())
        self.assertEqual(s.records,[])

    def test_checkpoint_preparation_runs_inside_stream_lock_without_changing_request(self):
        s=session(lambda:response());calls=[]
        def prepare():
            self.assertTrue(s.lock.locked());calls.append(True)
            return n.sender_command_data('sign',command()['request'],22,'c'*64)
        s.exchange(command(),None,threading.Event(),prepare_command=prepare)
        self.assertEqual(calls,[True]);self.assertIn(b'"checkpointHeight":"22"',s.proc.stdin.getvalue())
        s=session(lambda:response())
        with self.assertRaises(RuntimeError):
            s.exchange(command(),None,threading.Event(),prepare_command=lambda:command(5))
        self.assertEqual(s.proc.stdin.getvalue(),b'')

    def test_real_backend_preserves_shared_process_and_original_proof_arguments(self):
        class Callee:
            def __init__(self,ceremony,indices):self.owners=indices;self.calls=[]
            def wait_ready(self,*args):return dict(bootstrapLoaded=False)
            def exchange(self,cmd,path,stop,prepare_command=None):
                self.calls.append(prepare_command() if prepare_command else cmd)
                return dict(code='ORIGINAL_SAVED')
        Backend=b.backend_class(d.NormalBackend,Callee,n,d.lab)
        c=SimpleNamespace(mode='online',workload=dict(transactions=None),live=[],w=SimpleNamespace(),proof_timeout=30)
        backend=Backend(c,[dict(ownerIndex=4),dict(ownerIndex=5)],threading.Event())
        ready=backend.prepare(lambda:None)
        self.assertFalse(ready['bootstrapLoaded']);self.assertEqual(ready['readyCount'],1)
        self.assertLessEqual(ready['maximumOwnedRuntimePIDs'],d.lab.guard.CAPS['ownedProcesses'])
        backend.checkpoint=lambda stop:dict(height=22,appHash='c'*64)
        backend.sign_original({},command()['request'],None,Path('/public'),lambda event:None,threading.Event())
        proof=dict(materials=dict(path='/public/materials',sha256='d'*64),proof=dict(path='/public/proof'))
        backend.confirm_original({},command()['request'],proof,Path('/public'),lambda event:None,threading.Event())
        sign,confirm=backend.public_session.calls
        self.assertEqual(sign['checkpointHeight'],'22')
        self.assertEqual(confirm['request'],sign['request'])
        self.assertEqual(confirm['checkpointHeight'],'0')
        self.assertEqual((confirm['materialsFile'],confirm['materialsSHA256'],confirm['proofFile']),
                         ('/public/materials','d'*64,'/public/proof'))


if __name__=='__main__':unittest.main()
