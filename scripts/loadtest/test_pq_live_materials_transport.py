"""Offline controls for the original Go proof-lane stream."""
import importlib.util
import io
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
                  syntheticOnly=True, authorityGranted=False,
                  session=stats(2*sequence - (operation == 'request')))
    result.update(requestPath='/isolated/request' if operation == 'request' else None)
    if operation == 'result':
        del result['requestPath']
        result['result'] = {'sequence': str(sequence)}
    result.update(changes)
    return result


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

    def test_wrong_ready_policy_refuses_before_any_command(self):
        stream = io.BytesIO()
        with self.assertRaises(RuntimeError):
            open_lane(stream, lambda: None, session=dict(stats(0), policySHA256='d'*64))
        self.assertEqual(stream.getvalue(), b'')

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
