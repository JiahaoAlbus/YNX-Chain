"""Offline controls for the original Go proof-lane stream."""
import importlib.util
import hashlib
import io
import json
import tempfile
import threading
from types import SimpleNamespace
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('live_materials_transport',
    Path(__file__).with_name('pq-live-materials-transport.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
REQUEST = dict(transaction_file='/isolated/原始<&.abci',
               transaction_sha256='a'*64, native_wire_hash='b'*64)


def stats(commands):
    return dict(policySHA256='c'*64, nodeIndex=0, maxOperations=2, commands=commands,
                commandLimit=24, retired=False, closed=False)


def open_lane(stream, receive, **changes):
    ready = dict(version='YNX-PQ-LAB-LIVE-MATERIALS-READY/v1', status='original_static_source_and_anchor_held',
                 startupElapsedNs=400, syntheticOnly=True, authorityGranted=False,
                 currentCheckpointClaim=False, session=stats(0))
    ready.update(changes)
    return transport.Lane(stream, receive, ready, policy_sha256='c'*64, node=0, max_operations=2)


def reply(operation, sequence, **changes):
    result = dict(version='YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1',
                  operation=operation, sequence=str(sequence),
                  outcome='request_published' if operation == 'request' else 'original_result_read',
                  startupElapsedNs=400, calleeElapsedNs=12,
                  syntheticOnly=True, authorityGranted=False, firstCausePresent=False,
                  session=stats(2*sequence - (operation == 'request')))
    result.update(requestPath='/isolated/request' if operation == 'request' else None)
    if operation == 'result':
        del result['requestPath']
        result['result'] = {'sequence': str(sequence)}
    result.update(changes)
    return result


def load_driver():
    driver_spec = importlib.util.spec_from_file_location('live_session_driver',
        Path(__file__).with_name('pq-independent-load.py'))
    driver = importlib.util.module_from_spec(driver_spec)
    driver_spec.loader.exec_module(driver)
    return driver


class Transport(unittest.TestCase):
    def test_go_marshal_order_and_escaping(self):
        request = transport.command('request', 1, **REQUEST).decode()
        self.assertEqual(request, '{"version":"YNX-PQ-LAB-LIVE-MATERIALS-COMMAND/v1",'
            '"operation":"request","sequence":"1","transactionFile":"/isolated/原始'
            r'\u003c\u0026'
            '.abci","transactionSHA256":"' + 'a'*64 + '","nativeWireHash":"' + 'b'*64 + '"}\n')
        self.assertEqual(transport.command('result', 1),
            b'{"version":"YNX-PQ-LAB-LIVE-MATERIALS-COMMAND/v1","operation":"result",'
            b'"sequence":"1","transactionFile":"","transactionSHA256":"","nativeWireHash":""}\n')
        with self.assertRaises(RuntimeError):
            transport.command('result', 1, **REQUEST)

    def test_each_request_must_follow_prior_result(self):
        replies = iter([reply('request', 1), reply('result', 1), reply('request', 2)])
        stream = io.BytesIO()
        lane = open_lane(stream, lambda: next(replies))
        lane.exchange('request', 1, **REQUEST)
        with self.assertRaises(RuntimeError):
            lane.exchange('request', 2, **REQUEST)
        self.assertEqual(lane.exchange('result', 1)['result'], {'sequence': '1'})
        lane.exchange('request', 2, **REQUEST)
        self.assertEqual(len(stream.getvalue().splitlines()), 3)

    def test_ready_cancel_preserves_the_original_resource_failure(self):
        driver = load_driver()
        session = driver.SenderSession.__new__(driver.SenderSession)
        stopped = threading.Event()
        stopped.set()
        def check():
            raise RuntimeError('owned RSS exceeded 4GiB')
        with self.assertRaisesRegex(RuntimeError, 'owned RSS exceeded 4GiB'):
            session.receive(None, stopped, 'original', check=check)

    def test_receive_drains_large_original_even_after_process_exit(self):
        driver = load_driver()
        with tempfile.TemporaryDirectory() as temp:
            session = driver.SenderSession.__new__(driver.SenderSession)
            session.path = Path(temp)/'original.log'
            version = 'YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1'
            body = dict(version=version, result={'proof': 'a'*130000})
            raw = json.dumps(body).encode()+b'\n'
            session.path.write_bytes(raw)
            session.partial = b''
            session.offset = 0
            session.proc = SimpleNamespace(poll=lambda: 0)
            self.assertEqual(session.receive(None, threading.Event(), version), body)
            self.assertEqual(session.offset, len(raw))
            self.assertEqual(list(Path(temp).iterdir()), [session.path])

    def test_driver_launches_private_lane_and_preserves_callee_denominators(self):
        driver = load_driver()
        timings = dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1', clock='monotonic_elapsed_wall_ns',
                       intervalsOverlap=True, stages={'live.publishTotal': dict(calls=1, elapsedNs=12)})
        ready = dict(version='YNX-PQ-LAB-LIVE-MATERIALS-READY/v1',
                     status='original_static_source_and_anchor_held', startupElapsedNs=400,
                     syntheticOnly=True, authorityGranted=False, currentCheckpointClaim=False,
                     session=stats(0), preparationTimings=timings)
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            for directory in ('public', '.private'):
                (work/directory).mkdir()
            policy = work/'.private/policy.json'
            stop = threading.Event()
            stdin = io.BytesIO()
            def launch(name, argv, **options):
                self.assertTrue(options['private_log'] and options['stdin_pipe'])
                self.assertFalse(options.get('persistent', False))
                self.assertEqual(argv[1], 'live-materials-session')
                frames = [ready, reply('request', 1, timings=timings,
                                      requestPath=str(policy.parent/'request-000001.json')),
                          reply('result', 1, timings=timings)]
                (work/'.private'/(name+'.log')).write_text(''.join(json.dumps(frame)+'\n' for frame in frames))
                return SimpleNamespace(stdin=stdin, poll=lambda: None)
            measurements = driver.CalleeMeasurements(2, 2)
            backend = SimpleNamespace(c=SimpleNamespace(bins=work, operations=2, proof_timeout=2,
                                      measurements=measurements), w=SimpleNamespace(work=work, launch=launch),
                                      stop_event=stop)
            lane = dict(policy=policy, pin='c'*64, node=0)
            preparation = driver.prepare_live_materials_session(backend, lane, lambda: None)
            self.assertEqual(preparation['calleeStartupElapsedNs'], 400)
            exchange = driver.NormalBackend.live_materials_command
            exchange(backend, lane, 'request', 'load-00000', 1, stop,
                     path=REQUEST['transaction_file'], tx=dict(abciHash='a'*64, nativeHash='b'*64))
            self.assertEqual(exchange(backend, lane, 'result', 'load-00000', 1, stop),
                             {'sequence': '1'})
            groups = measurements.report()['groups']
            for phase in ('live_publish', 'live_result'):
                self.assertEqual(groups[phase]['calleeElapsed']['observed'], 1)
                self.assertEqual(groups[phase]['calleeElapsed']['denominator'], 2)
            self.assertEqual(len(stdin.getvalue().splitlines()), 2)
            self.assertEqual([p.name for p in (work/'.private').iterdir()], ['load-live-session-0.log'])
            self.assertEqual(sorted(p.name for p in (work/'public').iterdir()),
                ['load-00000-live-result.log', 'load-00000-live-session-request.json',
                 'load-00000-live-session-result.json'])
            original = (work/'.private/load-live-session-0.log').read_bytes().splitlines(keepends=True)[-1]
            self.assertEqual((work/'public/load-00000-live-result.log').read_bytes(), original)

    def test_original_result_retention_failure_poisoned_without_replay(self):
        stream = io.BytesIO()
        def receive(*, include_original=False):
            if include_original:
                return reply('result', 1), b'original frame bytes'
            return reply('request', 1)
        def fail(raw):
            self.assertEqual(raw, b'original frame bytes')
            raise OSError('original frame retention failed')
        lane = open_lane(stream, receive)
        lane.exchange('request', 1, **REQUEST)
        with self.assertRaisesRegex(OSError, 'retention failed'):
            lane.exchange('result', 1, retain_original=fail)
        with self.assertRaisesRegex(RuntimeError, 'preserve original'):
            lane.exchange('result', 1, retain_original=fail)
        self.assertTrue(lane.poisoned)
        self.assertEqual(len(stream.getvalue().splitlines()), 2)

    def test_public_reply_projection_binds_request_and_result_without_private_payloads(self):
        frames=[reply('request',1,requestPath='/private/DO-NOT-EXPORT/request.json'),
                reply('result',1,result={'private': 'DO-NOT-EXPORT', 'nestedPath': '/private/material'})]
        records=[];raws=[];originals=[]
        def receive(*,include_original=False):
            self.assertTrue(include_original)
            frame=frames.pop(0)
            frame['timings']={'private-label-DO-NOT-EXPORT': 'DO-NOT-EXPORT'}
            raw=json.dumps(frame).encode()+b'\n';raws.append(raw)
            return frame,raw
        stream=io.BytesIO();lane=open_lane(stream,receive)
        lane.exchange('request',1,retain_public_reply=records.append,**REQUEST)
        lane.exchange('result',1,retain_public_reply=records.append,retain_original=originals.append)
        self.assertEqual(len(records),2);self.assertEqual(originals,[raws[1]])
        for i,record in enumerate(records):
            self.assertEqual(record['originalReplySHA256'],hashlib.sha256(raws[i]).hexdigest())
            self.assertEqual(record['originalReplyBytes'],len(raws[i]))
            self.assertEqual(record['operation'],('request','result')[i])
            self.assertEqual(record['session'],stats(i+1))
            self.assertNotIn('DO-NOT-EXPORT',json.dumps(record));self.assertNotIn('/private/',json.dumps(record))
            for field in ('authorityGranted','independentFinality','rawReplyIncluded',
                          'pathsAndPayloadsIncluded','timingsIncluded'):
                self.assertIs(record[field],False)
        self.assertFalse(lane.poisoned);self.assertEqual(lane.commands,2)

    def test_public_refusal_projection_preserves_original_outcome_and_no_replay(self):
        for phase in ('request','result'):
            with self.subTest(phase=phase):
                frame=reply(phase,1,outcome='REFUSED_OR_UNKNOWN_NO_RETRY',
                            failureClass='CONTEXT_ENDED',firstCausePresent=True)
                frame.pop('requestPath',None);frame.pop('result',None)
                frame['session']['retired']=True
                raw=json.dumps(frame).encode()+b'\n';records=[]
                def receive(*,include_original=False):
                    return (frame,raw) if include_original else reply('request',1)
                stream=io.BytesIO();lane=open_lane(stream,receive)
                if phase=='result':lane.exchange('request',1,**REQUEST)
                with self.assertRaises(transport.OriginalRefusal) as caught:
                    lane.exchange(phase,1,retain_public_reply=records.append,
                                  **(REQUEST if phase=='request' else {}))
                self.assertEqual(caught.exception.failure_class,'CONTEXT_ENDED')
                self.assertEqual(len(records),1);self.assertEqual(records[0]['outcome'],frame['outcome'])
                self.assertTrue(records[0]['firstCausePresent']);self.assertTrue(lane.poisoned)
                self.assertEqual(lane.commands,int(phase=='result'))
                before=stream.getvalue()
                with self.assertRaises(RuntimeError):lane.exchange(phase,1)
                self.assertEqual(stream.getvalue(),before)

    def test_public_projection_uses_exact_original_file_receiver_bytes(self):
        driver=load_driver();frame=reply('request',1,requestPath='/private/原始/request.json')
        raw=json.dumps(frame,ensure_ascii=False).encode()+b'\n'
        with tempfile.TemporaryDirectory() as temporary:
            receiver=driver.SenderSession.__new__(driver.SenderSession)
            receiver.path=Path(temporary)/'original-private-stream.log';receiver.path.write_bytes(raw)
            receiver.partial=b'';receiver.offset=0;receiver.proc=SimpleNamespace(poll=lambda:None)
            def receive(**options):
                return receiver.receive(None,threading.Event(),frame['version'],**options)
            records=[];lane=open_lane(io.BytesIO(),receive)
            self.assertEqual(lane.exchange('request',1,retain_public_reply=records.append,**REQUEST),frame)
            self.assertEqual(receiver.path.read_bytes(),raw)
            self.assertEqual(receiver.offset,len(raw))
            self.assertEqual(records[0]['originalReplySHA256'],hashlib.sha256(raw).hexdigest())
            self.assertNotIn('/private/',json.dumps(records[0]));self.assertNotIn('原始',json.dumps(records[0],ensure_ascii=False))
            self.assertEqual(list(Path(temporary).iterdir()),[receiver.path])

    def test_public_projection_rejects_unbound_or_unclosed_raw_without_export(self):
        original=reply('request',1)
        raw=json.dumps(original).encode()+b'\n'
        changed=dict(original,calleeElapsedNs=13)
        wrong_stats=dict(original,session=dict(stats(1),policySHA256='e'*64))
        extra=dict(original,privateError='/private/DO-NOT-EXPORT')
        cases=[(original,raw+raw),(changed,raw),(wrong_stats,json.dumps(wrong_stats).encode()+b'\n'),
               (extra,json.dumps(extra).encode()+b'\n'),
               (original,raw.replace(b'"sequence": "1"',b'"sequence": "1", "sequence": "1"'))]
        for frame,data in cases:
            with self.subTest(data=data[:70]):
                records=[];stream=io.BytesIO()
                lane=open_lane(stream,lambda **kw:(frame,data))
                with self.assertRaises(RuntimeError):
                    lane.exchange('request',1,retain_public_reply=records.append,**REQUEST)
                self.assertEqual(records,[]);self.assertTrue(lane.poisoned)
                self.assertEqual(lane.commands,0);self.assertEqual(len(stream.getvalue().splitlines()),1)

    def test_projection_write_failure_keeps_refusal_primary_and_does_not_replay(self):
        frame=reply('request',1,outcome='REFUSED_OR_UNKNOWN_NO_RETRY',
                    failureClass='BUSY',firstCausePresent=True);del frame['requestPath']
        raw=json.dumps(frame).encode()+b'\n';stream=io.BytesIO()
        lane=open_lane(stream,lambda **kw:(frame,raw))
        def fail(_):raise OSError('projection storage unavailable')
        with self.assertRaises(transport.OriginalRefusal) as caught:
            lane.exchange('request',1,retain_public_reply=fail,**REQUEST)
        self.assertEqual(caught.exception.failure_class,'BUSY')
        self.assertIsInstance(caught.exception.__cause__,OSError)
        self.assertTrue(lane.poisoned);self.assertEqual(lane.commands,0)
        with self.assertRaises(RuntimeError):lane.exchange('request',1,**REQUEST)
        self.assertEqual(len(stream.getvalue().splitlines()),1)

    def test_wrong_ready_policy_refuses_before_any_command(self):
        stream = io.BytesIO()
        with self.assertRaises(RuntimeError):
            open_lane(stream, lambda: None, session=dict(stats(0), policySHA256='d'*64))
        self.assertEqual(stream.getvalue(), b'')

    def test_original_refusal_preserves_closed_class_and_poisoned_lane(self):
        stream = io.BytesIO()
        rejected = reply('request', 1, outcome='REFUSED_OR_UNKNOWN_NO_RETRY',
                         failureClass='CONTEXT_ENDED', firstCausePresent=True)
        del rejected['requestPath']
        lane = open_lane(stream, lambda: rejected)
        with self.assertRaises(transport.OriginalRefusal) as caught:
            lane.exchange('request', 1, **REQUEST)
        self.assertEqual(caught.exception.failure_class, 'CONTEXT_ENDED')
        self.assertTrue(lane.poisoned)
        self.assertEqual(lane.sequence, 0)

    def test_lost_or_refused_reply_cannot_trigger_replay(self):
        def lost():
            raise EOFError('lost original reply')
        for receive, error in [(lost, EOFError),
                               (lambda: reply('request', 2), RuntimeError),
                               (lambda: reply('request', 1, outcome='REFUSED_OR_UNKNOWN_NO_RETRY'), RuntimeError),
                               (lambda: reply('request', 1, authorityGranted=True), RuntimeError),
                               (lambda: reply('request', 1, session=stats(2)), RuntimeError)]:
            with self.subTest(error=error):
                stream = io.BytesIO()
                lane = open_lane(stream, receive)
                with self.assertRaises(error):
                    lane.exchange('request', 1, **REQUEST)
                with self.assertRaises(RuntimeError):
                    lane.exchange('request', 1, **REQUEST)
                self.assertEqual(len(stream.getvalue().splitlines()), 1)


if __name__ == '__main__':
    unittest.main()
