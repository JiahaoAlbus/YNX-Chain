"""Stream isolation and uncertain acknowledgement controls; no signer or nodes."""
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import threading
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


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


def ready_v1():
    return dict(version='YNX-PQ-LAB-PUBLIC-OWNER-READY/v1',status='original_public_scope_held',
                owners=[4,5],startupElapsedNs=100,signed=False,nonceReserved=False,
                bootstrapLoaded=False,syntheticOnly=True,authorityGranted=False)


def ready_v2(retained=True):
    # Offline contract fixture, not an actual Go run or source qualification.
    value=ready_v1()
    stages={name:dict(calls=1,elapsedNs=10) for name in
            ('lab.migrationFullRead','lab.migrationFullDecode','lab.validatedMigrationOwnerBuild',
             'lab.bootstrapFullValidation','lab.loadStaticTotal','checkpoint.prepareStaticTotal',
             'publicOwner.prepareSource',
             'lab.staticOwnerHitRevalidateSources' if retained else 'live.heldStaticWitnessCurrent')}
    size=4096 if retained else (32<<20)+1
    source=dict(scope='YNX-PQ-LAB-HELD-PUBLIC-INPUTS/v1',state='CACHE_ENTRY' if retained else 'INVOCATION_HELD',
                staticOriginalFiles=12,staticOriginalBytes=size,activationOriginalFiles=0,
                activationOriginalBytes=0,cacheRetained=retained,
                cacheAdmissionReason='WITHIN_BOUNDS' if retained else 'BYTE_BOUND',
                cacheMaxBytes=32<<20,cacheMaxFiles=16,snapshotOnly=True)
    cache=dict(scope='YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1',entries=int(retained),
               heldFiles=12 if retained else 0,originalBytes=size if retained else 0,
               hits=int(retained),misses=1,bypasses=int(not retained),closed=False)
    value.update(version='YNX-PQ-LAB-PUBLIC-OWNER-READY/v2',status='original_public_static_source_held',
                 bootstrapLoaded=True,preparationTimings=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',
                 clock='monotonic_elapsed_wall_ns',intervalsOverlap=True,stages=stages),
                 session=dict(allowedOwners=2,openedOwners=0,commands=0,commandLimit=40,
                              retired=False,closed=False,staticCache=cache,sourceInputs=source))
    return value


class TransportControls(unittest.TestCase):
    def receive_ready(self, raw, opted, *, reject=False):
        RealSession=m.session_class(d.SenderSession,n,d.lab)
        s=RealSession.__new__(RealSession)
        s.__dict__.update(session(lambda:None).__dict__)
        s.prepare_source=opted;s.offset=0;s.partial=b'';s.ready=None;s.name='ready-contract'
        with tempfile.TemporaryDirectory() as tmp:
            work=Path(tmp);(work/'public').mkdir();s.path=work/'input.jsonl';s.path.write_bytes(raw)
            s.c.w=SimpleNamespace(work=work)
            path=work/'public'/'ready-contract-ready.json'
            if reject:
                with self.assertRaises((RuntimeError,ValueError,TypeError,KeyError)):
                    s.wait_ready(threading.Event(),None,lambda:None)
                self.assertIsNone(s.ready)
                with self.assertRaises(RuntimeError):s.exchange(command(),None,threading.Event())
            else:
                ready=s.wait_ready(threading.Event(),None,lambda:None)
                self.assertEqual(ready,json.loads(raw))
                with self.assertRaises(RuntimeError):s.wait_ready(threading.Event(),None,lambda:None)
            self.assertEqual(path.read_bytes(),raw)
            self.assertEqual(s.proc.stdin.getvalue(),b'')
            self.assertEqual(s.records,[])
            self.assertEqual(s.transport_report()['attempted'],0)

    def test_prepare_source_flag_is_keyword_only_boolean_and_opt_in(self):
        calls=[]
        window=SimpleNamespace(work=Path('/offline'),
            launch=lambda *args,**kw:calls.append((args,kw)) or SimpleNamespace(stdin=io.BytesIO()))
        ceremony=SimpleNamespace(root=Path('/offline'),bins=Path('/offline/bin'),w=window,
                                 pin='a'*64,activation_pin='b'*64,workload_pin='c'*64)
        Constructor=m.session_class(Receiver,SimpleNamespace(fd3_command=lambda args,fd:args),
                                    SimpleNamespace(require=require))
        info=SimpleNamespace(st_mode=0o100600,st_size=32,st_nlink=1)
        with patch.object(m.os,'open',return_value=91),patch.object(m.os,'fstat',return_value=info),\
             patch.object(m.os,'close'):
            Constructor(ceremony,[4,5])
            Constructor(ceremony,[4,5],prepare_source=False)
            Constructor(ceremony,[4,5],prepare_source=True)
            for invalid in (None,0,1,'true'):
                with self.subTest(invalid=invalid),self.assertRaises(RuntimeError):
                    Constructor(ceremony,[4,5],prepare_source=invalid)
            with self.assertRaises(TypeError):Constructor(ceremony,[4,5],'name',True)
        self.assertEqual(len(calls),3)
        for i,(args,kw) in enumerate(calls):
            self.assertEqual(args[1].count('--prepare-source'),int(i==2))
            self.assertIn('--ready',args[1]);self.assertIn('--timings',args[1])
            self.assertEqual(kw['pass_fds'],(91,));self.assertTrue(kw['stdin_pipe'])

    def test_prepared_ready_keeps_raw_line_and_preparation_out_of_command_metrics(self):
        self.receive_ready(json.dumps(ready_v1()).encode()+b'\n',False)
        for retained in (True,False):
            with self.subTest(retained=retained):
                self.receive_ready(json.dumps(ready_v2(retained)).encode()+b'\n',True)

    def test_prepared_ready_accepts_static_subspans_and_observational_cache_counters(self):
        ready=ready_v2()
        ready['preparationTimings']['stages']['lab.staticSubspan']=dict(calls=2,elapsedNs=3)
        ready['session']['staticCache'].update(hits=3,misses=4,bypasses=2)
        self.receive_ready(json.dumps(ready).encode()+b'\n',True)
        held=ready_v2(False)
        held['session']['sourceInputs'].update(staticOriginalBytes=4096,
                                               cacheAdmissionReason='NOT_RETAINED_WITHIN_BOUNDS')
        self.receive_ready(json.dumps(held).encode()+b'\n',True)

    def test_ready_version_cannot_opt_in_or_fall_back(self):
        self.receive_ready(json.dumps(ready_v1()).encode()+b'\n',True,reject=True)
        self.receive_ready(json.dumps(ready_v2()).encode()+b'\n',False,reject=True)

    def test_prepared_ready_rejects_wrong_closed_shape_types_and_authority_before_commands(self):
        cases=[(('extra',),False),(('status',),'original_public_scope_held'),
               (('owners',),[4,6]),(('owners',),[True,5]),(('startupElapsedNs',),True),
               (('startupElapsedNs',),-1),(('startupElapsedNs',),1<<63),
               (('signed',),True),(('nonceReserved',),True),(('bootstrapLoaded',),False),
               (('syntheticOnly',),False),(('authorityGranted',),True),
               (('preparationTimings','extra'),0),(('preparationTimings','intervalsOverlap'),False),
               (('preparationTimings','clock'),'wall_clock'),
               (('preparationTimings','stages','sender.signTotal'),dict(calls=1,elapsedNs=1)),
               (('preparationTimings','stages','checkpoint.captureCurrentBytes'),dict(calls=1,elapsedNs=1)),
               (('preparationTimings','stages','publicOwner.prepareSource','calls'),2),
               (('preparationTimings','stages','publicOwner.prepareSource','calls'),True),
               (('preparationTimings','stages','publicOwner.prepareSource','elapsedNs'),-1),
               (('preparationTimings','stages','publicOwner.prepareSource','extra'),0),
               (('session','extra'),False),(('session','allowedOwners'),3),
               (('session','openedOwners'),1),(('session','openedOwners'),False),
               (('session','commands'),1),(('session','commandLimit'),0),
               (('session','retired'),True),(('session','closed'),True),
               (('session','staticCache','extra'),0),(('session','staticCache','closed'),True),
               (('session','staticCache','entries'),True),(('session','staticCache','misses'),True),
               (('session','staticCache','originalBytes'),4097),
               (('session','sourceInputs','extra'),False),
               (('session','sourceInputs','state'),'NOT_LOADED'),
               (('session','sourceInputs','cacheMaxBytes'),64<<20),
               (('session','sourceInputs','cacheMaxFiles'),17),
               (('session','sourceInputs','staticOriginalFiles'),17),
               (('session','sourceInputs','snapshotOnly'),False),
               (('session','sourceInputs','activationOriginalFiles'),1),
               (('session','sourceInputs','activationOriginalBytes'),1),
               (('session','sourceInputs','cacheRetained'),False)]
        for path,value in cases:
            with self.subTest(path=path,value=value):
                bad=ready_v2();target=bad
                for key in path[:-1]:target=target[key]
                target[path[-1]]=value
                self.receive_ready(json.dumps(bad).encode()+b'\n',True,reject=True)
        for path in [('preparationTimings',),('session',),
                     ('preparationTimings','stages','lab.bootstrapFullValidation')]:
            bad=ready_v2();target=bad
            for key in path[:-1]:target=target[key]
            del target[path[-1]]
            with self.subTest(missing=path):
                self.receive_ready(json.dumps(bad).encode()+b'\n',True,reject=True)

    def test_prepared_ready_rejects_duplicate_and_nonfinite_original_json(self):
        raw=json.dumps(ready_v2(),separators=(',',':')).encode()+b'\n'
        for malformed in (raw.replace(b'"signed":false',b'"signed":true,"signed":false'),
                          raw.replace(b'"calls":1',b'"calls":2,"calls":1',1),
                          raw.replace(b'"startupElapsedNs":100',b'"startupElapsedNs":NaN'),
                          raw.replace(b'"elapsedNs":10',b'"elapsedNs":Infinity',1)):
            with self.subTest(raw=malformed[:100]):self.receive_ready(malformed,True,reject=True)

    def test_sign_failure_detail_uses_only_closed_cli_fields(self):
        reply = dict(code='REJECTED', result=None)
        self.assertEqual(d.owner_failure_detail(reply, 'sign'), '')
        reply['failure'] = dict(version='YNX-PQ-LAB-PUBLIC-OWNER-FAILURE/v1',
                                failurePhase='SIGN', errorClass='CHECKPOINT_REJECTED',
                                firstCausePresent=True)
        self.assertEqual(d.owner_failure_detail(reply, 'sign'), ' (SIGN/CHECKPOINT_REJECTED)')
        reply['code'] = 'UNKNOWN'
        self.assertEqual(d.owner_failure_detail(reply, 'sign'), ' (unqualified failure diagnostic)')
        self.assertEqual(reply['code'], 'UNKNOWN')

    def test_actual_go_stream_through_original_reader_and_callee_collector(self):
        fixture=Path(__file__).with_name('fixtures')/'public-owner-original-go.jsonl'
        raw=fixture.read_bytes()
        self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),
                         (14737,'57411342e3eaae744cbb3a351a9174b66b6a88d0670e309f0e89ed09e6a88020'))
        rows=[json.loads(line) for line in raw.splitlines()]
        self.assertEqual(len(rows),7)
        # Read ORIGINAL producer output using the real file-stream reader. No
        # process or command is executed in this offline cross-language case.
        RealSession=m.session_class(d.SenderSession,n,d.lab)
        s=RealSession.__new__(RealSession)
        s.__dict__.update(session(lambda:None).__dict__)
        s.owners=(0,1);s.offset=0;s.partial=b'';s.ready=None;s.name='original-go-fixture';s.path=fixture
        with tempfile.TemporaryDirectory() as tmp:
            work=Path(tmp);(work/'public').mkdir()
            s.c=SimpleNamespace(w=SimpleNamespace(work=work),
                                measurements=d.CalleeMeasurements(3,2,source='ORIGINAL_GO_FIXTURE_ONLY'))
            stop=threading.Event();ready=s.wait_ready(stop,None,lambda:None)
            self.assertFalse(ready['bootstrapLoaded'])
            commands=[command(0),command(0,'c'*64),command(0,'',phase='close-owner'),
                      command(1),command(1,phase='recover')]
            commands[2]['request'].update(firstNonce='0',members=0)
            for i,cmd in enumerate(commands):
                received=s.exchange(cmd,work/'public'/('%d.json'%i),stop)
                self.assertEqual(received,rows[i+1])
            # The original sixth reply is an intentional out-of-scope refusal;
            # it cannot be relabelled as a reply to an allowed owner command.
            self.assertEqual(json.loads(s.partial)['code'],'REJECTED')
            report=s.c.measurements.report()['groups']['sign']
            self.assertEqual(report['outcomes'],dict(ORIGINAL_SAVED=2,UNKNOWN=1))
            self.assertEqual(report['calleeElapsed']['observed'],3)
            self.assertEqual(report['stages']['lab.bootstrapFullValidation']['calls'],1)
            self.assertEqual(set(report['lastHeldInputFootprintByOwner']),{'0','1'})
            self.assertEqual(s.transport_report()['attempted'],5)

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

    def test_original_receiver_rejects_duplicate_and_nonfinite_reply_before_sign(self):
        for malformed in (b'{"version":"YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1","code":"REJECTED","code":"OWNER_PREPARED"}\n',
                          b'{"version":"YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1","value":NaN}\n'):
            with self.subTest(malformed=malformed), tempfile.TemporaryDirectory() as tmp:
                RealSession=m.session_class(d.SenderSession,n,d.lab)
                s=RealSession.__new__(RealSession)
                s.__dict__.update(session(lambda:None).__dict__)
                s.offset=0;s.partial=b'';s.path=Path(tmp)/'original-process.log';s.path.write_bytes(malformed)
                original=Path(tmp)/'original-prepare-owner-reply.json'
                checkpoint=unittest.mock.Mock()
                with self.assertRaises(RuntimeError):
                    s.exchange(command(),None,threading.Event(),prepare_command=checkpoint,
                               prepare_owner_path=original)
                self.assertEqual(original.read_bytes(),malformed)
                self.assertTrue(s.poisoned)
                checkpoint.assert_not_called()
                self.assertEqual(len(s.proc.stdin.getvalue().splitlines()),1)

    def test_real_truncated_reply_preserves_bytes_and_refuses_recovery_on_poisoned_stream(self):
        RealSession=m.session_class(d.SenderSession,n,d.lab)
        s=RealSession.__new__(RealSession)
        s.__dict__.update(session(lambda:None).__dict__)
        s.offset=0;s.partial=b''
        # The first poll is before the write. The child exits after retaining
        # only a prefix of its original reply; no process is started here.
        polls=iter((None,1))
        s.proc.poll=lambda:next(polls,1)
        original=command()
        complete=json.dumps(response()).encode()+b'\n';prefix=complete[:-12]
        with tempfile.TemporaryDirectory() as tmp:
            s.path=Path(tmp)/'original-process.log';s.path.write_bytes(prefix)
            reply_path=Path(tmp)/'original-reply.json'
            with self.assertRaisesRegex(RuntimeError,'exited without one exact reply'):
                s.exchange(original,reply_path,threading.Event())
            self.assertTrue(s.poisoned);self.assertEqual(s.partial,prefix)
            self.assertEqual(s.path.read_bytes(),prefix);self.assertFalse(reply_path.exists())
            self.assertEqual(s.records,[])
            written=s.proc.stdin.getvalue();offset=s.offset
            # Late complete bytes cannot be assigned to another command, even
            # if an outside process-liveness observation later says "running".
            with s.path.open('ab') as output:output.write(complete[len(prefix):])
            s.proc.poll=lambda:None
            recover=n.sender_command_data('recover',original['request'])
            self.assertEqual(recover['checkpointHeight'],'0')
            for next_command in (recover,command(5,'c'*64)):
                with self.assertRaisesRegex(RuntimeError,'recover originals, never replay'):
                    s.exchange(next_command,Path(tmp)/'next-reply.json',threading.Event())
            self.assertEqual(s.proc.stdin.getvalue(),written)
            self.assertEqual((s.offset,s.partial),(offset,prefix))
            self.assertEqual(json.loads(written),original)
            self.assertEqual(s.path.read_bytes(),complete)
            self.assertFalse((Path(tmp)/'next-reply.json').exists())

    def test_real_broken_pipe_write_never_reads_or_retries_an_ack(self):
        reader,writer=os.pipe();os.close(reader)
        stream=os.fdopen(writer,'wb')
        def unexpected_reply():self.fail('broken command write must not consume a reply')
        s=session(unexpected_reply);s.proc.stdin=stream
        try:
            with self.assertRaises(BrokenPipeError):
                s.exchange(command(),None,threading.Event())
            self.assertTrue(s.poisoned);self.assertEqual(s.records,[])
            for next_command in (command(),n.sender_command_data('recover',command()['request'])):
                with self.assertRaisesRegex(RuntimeError,'recover originals, never replay'):
                    s.exchange(next_command,None,threading.Event())
            first=s.transport_report()['records'][0]
            self.assertEqual(first['errorType'],'BrokenPipeError')
            self.assertNotIn('replyReceivedMonotonicNs',first)
        finally:
            try:stream.close()
            except BrokenPipeError:pass

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

    def test_owner_preparation_precedes_checkpoint_and_sign_under_same_stream_lock(self):
        replies=iter([dict(response(identity='',code='OWNER_PREPARED'),result=None), response()])
        s=session(lambda:next(replies))
        selected=[]
        def checkpoint():
            self.assertTrue(s.lock.locked())
            self.assertEqual(len(s.proc.stdin.getvalue().splitlines()),1)
            selected.append(True)
            return n.sender_command_data('sign',command()['request'],22,'c'*64)
        stages=[]
        result=s.exchange(command(),None,threading.Event(),prepare_command=checkpoint,
                          prepare_owner_path=Path('/PUBLIC-TEST'),on_owner_prepare=lambda:stages.append('owner_prepare'))
        self.assertEqual(stages,['owner_prepare'])
        self.assertEqual(result['code'],'ORIGINAL_SAVED')
        self.assertEqual(selected,[True])
        first,second=map(json.loads,s.proc.stdin.getvalue().splitlines())
        self.assertEqual(first,n.sender_command_data('prepare-owner',dict(
            version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId='',ownerIndex=4,firstNonce='0',members=0)))
        self.assertEqual(second['checkpointHeight'],'22')
        self.assertEqual(second['request'],command()['request'])

    def test_uncertain_owner_preparation_poisoned_without_checkpoint_or_sign(self):
        for bad in (dict(response(identity='',code='OWNER_PREPARED'),result={'unexpected':1}),
                    dict(response(identity='',code='UNKNOWN'),result=None,failure={'failurePhase':'PREPARE_OWNER'}),
                    dict(response(owner=5,identity='',code='OWNER_PREPARED'),result=None),
                    dict(response(identity='',code='OWNER_PREPARED'),result=None,failure={})):
            with self.subTest(bad=bad):
                s=session(lambda:bad)
                checkpoint=unittest.mock.Mock()
                with self.assertRaises(RuntimeError):
                    s.exchange(command(),None,threading.Event(),prepare_command=checkpoint,
                               prepare_owner_path=Path('/PUBLIC-TEST'))
                checkpoint.assert_not_called()
                self.assertTrue(s.poisoned)
                self.assertEqual(len(s.proc.stdin.getvalue().splitlines()),1)
                with self.assertRaisesRegex(RuntimeError,'never replay'):
                    s.exchange(command(),None,threading.Event())

    def test_malformed_owner_preparation_timing_stops_before_checkpoint(self):
        prepared = dict(response(identity='',code='OWNER_PREPARED'),result=None,calleeElapsedNs=-1,
                        timings=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',clock='monotonic_elapsed_wall_ns',
                                     intervalsOverlap=True,stages={}))
        s=session(lambda:prepared)
        s.c.measurements=d.CalleeMeasurements(2,2,source=n.PREPARED_OWNER_SOURCE)
        checkpoint=unittest.mock.Mock()
        with self.assertRaises(RuntimeError):
            s.exchange(command(),None,threading.Event(),prepare_command=checkpoint,
                       prepare_owner_path=Path('/PUBLIC-TEST'))
        checkpoint.assert_not_called()
        self.assertTrue(s.poisoned)
        self.assertEqual(len(s.proc.stdin.getvalue().splitlines()),1)
        self.assertEqual(s.c.measurements.record_failures['owner_prepare'],1)

    def test_prepared_owner_uses_the_normal_staged_ledger_entry(self):
        controls=module('staged_owner_integration_controls','test_pq_staged_independent_scheduler.py')
        prepared=dict(response(identity='',code='OWNER_PREPARED'),result=None)
        holder={}
        def next_reply():
            sent=json.loads(holder['session'].proc.stdin.getvalue().splitlines()[-1])
            if sent['operation']=='prepare-owner':
                return prepared
            return response(owner=sent['request']['ownerIndex'],identity=sent['request']['operationId'])
        stream=session(next_reply)
        holder['session']=stream
        Backend=b.backend_class(d.NormalBackend,Session,n,d.lab)
        adapter=Backend.__new__(Backend)
        adapter.c=SimpleNamespace(consumer_source='59f7885d11bd3eeb5d27dce7232779aae480a806')
        adapter.public_session=stream
        adapter.checkpoint=lambda stop:dict(height=22,appHash='c'*64)
        class PreparedBackend(controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                request=dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId=row['operationId'],
                             ownerIndex=row['ownerIndex'],firstNonce=str(row['nonce']),members=1)
                with tempfile.TemporaryDirectory() as directory:
                    adapter.sign_original(row,request,None,Path(directory),notify,stop)
                return super().publish(row,account,notify,stop)
        result=controls.staged.run(controls.plan(1,1),PreparedBackend(),lambda _event:None,
                                   lambda:None,threading.Event())
        self.assertIsNone(result['firstCause'])
        self.assertEqual(result['qualified'],1)
        self.assertEqual([json.loads(line)['operation'] for line in stream.proc.stdin.getvalue().splitlines()],
                         ['prepare-owner','sign'])
        names=[name for name,_ in result['rows'][0]['stageTimes']]
        self.assertLess(names.index('owner_prepare'),names.index('sender_ready_checkpoint'))

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

    def confirmation_path(self, change=None, *, lost_ack=False):
        # Exercise the real stream reader, metrics collector, public backend
        # and finalizer. Proof DATA below is an offline boundary fixture only;
        # it does not execute or stand in for the Go signature verifier.
        result=dict(included=True,finalized=True,executionSuccessful=True,executionCode='0',
                    nativeGrant=False,transactionHash='b'*64,nativeWireHash='c'*64,
                    transactionType='pq_transfer')
        reply=response(code='PROOF_CONFIRMED_DATA')
        reply.update(result=dict(result=dict(result)),calleeElapsedNs=10,
                     timings=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',
                                  clock='monotonic_elapsed_wall_ns',intervalsOverlap=True,
                                  stages={'confirm.total':dict(calls=1,elapsedNs=9)}))
        if change is not None:change(reply)
        raw=json.dumps(reply,separators=(',',':')).encode()+b'\n'
        RealSession=m.session_class(d.SenderSession,n,d.lab)
        s=RealSession.__new__(RealSession);s.__dict__.update(session(lambda:None).__dict__)
        s.offset=0;s.partial=b''
        if lost_ack:
            polls=iter((None,1));s.proc.poll=lambda:next(polls,1)
        with tempfile.TemporaryDirectory() as temporary:
            work=Path(temporary);case=work/'public'/'case';case.mkdir(parents=True)
            s.path=work/'public'/'original-confirm-stream.log'
            original=raw[:-12] if lost_ack else raw;s.path.write_bytes(original)
            window=SimpleNamespace(work=work)
            s.c=SimpleNamespace(w=window,mode='online',
                                measurements=d.CalleeMeasurements(1,2,source='OFFLINE_CONFIRM_BOUNDARY_ONLY'))
            Backend=b.backend_class(d.NormalBackend,RealSession,n,d.lab)
            backend=Backend.__new__(Backend);backend.c=s.c;backend.w=window;backend.public_session=s
            request=command()['request'];row=dict(id='d'*64,operationId=request['operationId'],ownerIndex=4)
            tx=dict(abciHash='b'*64,nativeHash='c'*64,members='1')
            proof=dict(materials=dict(path='/offline/materials',sha256='e'*64),proof=dict(path='/offline/proof'))
            backend.live_proof=lambda *a:(proof,dict(code='VERIFIED_TRANSACTION_DATA',result=result),{})
            handle=dict(row=row,account=dict(ownerIndex=4),case=case,started=d.time.monotonic_ns(),
                        tx=tx,path=case/'transaction.abci',request=request)
            events=[];error=None
            with patch.object(d.proof_readback,'finalize_portable_catalog') as exported:
                try:backend.finalize(handle,events.append,threading.Event())
                except RuntimeError as caught:error=caught
            sent=json.loads(s.proc.stdin.getvalue())
            self.assertEqual(sent,n.sender_command_data('confirm',request,materials='/offline/materials',
                                                       materials_sha='e'*64,proof='/offline/proof'))
            self.assertEqual(s.path.read_bytes(),original)
            retained=case/'original-confirm-reply.json'
            self.assertEqual(retained.exists(),not lost_ack)
            if retained.exists():self.assertEqual(retained.read_bytes(),raw)
            if error is None:
                self.assertTrue((case/'qualified-receipt.json').exists())
                self.assertEqual([e['kind'] for e in events].count('qualified'),1)
                exported.assert_called_once()
            else:
                self.assertFalse((case/'qualified-receipt.json').exists())
                self.assertNotIn('qualified',[e['kind'] for e in events]);exported.assert_not_called()
            if lost_ack:
                written=s.proc.stdin.getvalue();self.assertTrue(s.poisoned)
                with self.assertRaisesRegex(RuntimeError,'recover originals, never replay'):
                    s.exchange(n.sender_command_data('recover',request),None,threading.Event())
                self.assertEqual(s.proc.stdin.getvalue(),written)
            return error,s.c.measurements.report()['groups']['confirm'],s.transport_report()

    def test_finalizer_requires_full_confirm_result_beyond_transport_success_code(self):
        error,metrics,trace=self.confirmation_path()
        self.assertIsNone(error);self.assertEqual(metrics['outcomes'],{'PROOF_CONFIRMED_DATA':1})
        self.assertEqual(trace['records'][0]['operation'],'confirm')
        for field,value in (('included',False),('finalized',False),('executionSuccessful',False),
                            ('executionCode','1'),('nativeGrant',True),
                            ('transactionHash','f'*64),('nativeWireHash','f'*64)):
            with self.subTest(field=field):
                error,metrics,trace=self.confirmation_path(lambda reply:reply['result']['result'].update({field:value}))
                self.assertIsNotNone(error)
                # Retain the original producer claim as DATA, never turn its
                # observed successful code/timing into a qualified receipt.
                self.assertEqual(metrics['outcomes'],{'PROOF_CONFIRMED_DATA':1})
                self.assertEqual(trace['records'][0]['code'],'PROOF_CONFIRMED_DATA')

    def test_finalizer_preserves_confirm_unknown_rejection_and_truncated_ack(self):
        for code in ('UNKNOWN','REJECTED'):
            with self.subTest(code=code):
                error,metrics,trace=self.confirmation_path(lambda reply:reply.update(code=code,result=None))
                self.assertIsNotNone(error);self.assertEqual(metrics['outcomes'],{code:1})
                self.assertEqual(trace['records'][0]['code'],code)
        error,metrics,trace=self.confirmation_path(lost_ack=True)
        self.assertIn('exited without one exact reply',str(error))
        self.assertEqual(metrics['calleeElapsed']['observed'],0)
        self.assertEqual(metrics['replyTimingCoverage']['notReachedOrReplyNotSupplied'],1)
        self.assertNotIn('replyReceivedMonotonicNs',trace['records'][0])
        self.assertFalse(trace['automaticRetry'])

    def test_actual_broken_pipe_close_uses_original_cleanup_path(self):
        reader,writer=os.pipe();os.close(reader)
        stream=os.fdopen(writer,'wb');stream.write(b'buffered original command')
        class Callee:
            def __init__(self,ceremony,indices):self.owners=indices;self.proc=SimpleNamespace(stdin=stream)
        Backend=b.backend_class(d.NormalBackend,Callee,n,d.lab)
        window=SimpleNamespace(lock=threading.RLock(),children=[],stopping=False)
        c=SimpleNamespace(mode='online',workload=dict(transactions=None),live=[],w=window,proof_timeout=30)
        stop=threading.Event();backend=Backend(c,[dict(ownerIndex=4)],stop)
        try:
            backend.stop()
            self.assertTrue(stop.is_set());self.assertTrue(window.stopping)
            self.assertTrue(stream.closed)
        finally:
            if not stream.closed:
                try:stream.close()
                except BrokenPipeError:pass


if __name__=='__main__':unittest.main()
