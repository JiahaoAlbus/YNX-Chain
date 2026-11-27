#!/usr/bin/env python3
"""Controls for the original synthetic stream cost Go-event reader."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
PATH = HERE / 'qualify_synthetic_stream_cost.py'
spec = importlib.util.spec_from_file_location('synthetic_stream_cost', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE = 'a' * 40
HASH = 'b' * 64


def set_receipt_raw(record, raw):
    record['receiptBytes'] = len(raw)
    record['receiptSHA256'] = hashlib.sha256(raw).hexdigest()
    record['receiptBase64'] = base64.b64encode(raw).decode('ascii')


def set_receipt(record, receipt):
    set_receipt_raw(record, (json.dumps(receipt, separators=(',', ':')) + '\n').encode())


def set_stream(record, raw):
    record['streamBytes'] = len(raw)
    record['streamSHA256'] = hashlib.sha256(raw).hexdigest()
    record['streamBase64'] = base64.b64encode(raw).decode('ascii')
    receipt = json.loads(base64.b64decode(record['receiptBase64']))
    receipt.update(bytes=len(raw), sha256=record['streamSHA256'])
    set_receipt(record, receipt)


def set_event(record, event):
    set_stream(record, m.STREAM_HEADER + b'\n' +
               json.dumps(event, separators=(',', ':')).encode() + b'\n')


def originals(round_number):
    event = dict(height=1, headerHash=HASH, appHash=HASH, captureEpoch=1,
                 attempt=1, monotonicNs=str(10000 + round_number))
    stream = m.STREAM_HEADER + b'\n' + json.dumps(event, separators=(',', ':')).encode() + b'\n'
    stream_hash = hashlib.sha256(stream).hexdigest()
    receipt = dict(version='YNX-SYNTHETIC-HEADER-STREAM-RECEIPT/v1', classification='DATA_ONLY',
                   status='UNKNOWN', streamStatus='OBSERVED_DATA', enqueued=1, written=1,
                   bytes=len(stream), sha256=stream_hash, streamDurable=True, streamCleanupDebt=False,
                   firstCauseBytes=0, firstCauseTruncated=False, startupCoverageComplete=False,
                   walReplayExcluded=False, nodeBindingVerified=False, receiptPublicationVerified=False,
                   runtimeAuthorized=False, independentFinality=False)
    record = dict(streamBytes=len(stream), streamSHA256=stream_hash,
                  streamBase64=base64.b64encode(stream).decode('ascii'))
    set_receipt(record, receipt)
    return record


def metric():
    records = []
    for round_number in range(10):
        for enabled in (round_number % 2 == 0, round_number % 2 != 0):
            record = dict(round=round_number, warmup=round_number < 2, enabled=enabled,
                          engineFixtureNs=100 + round_number * 10 + int(enabled),
                          probeAndStreamStopNs=200 + round_number * 10 + int(enabled),
                          observerCloseNs=5 if enabled else 0,
                          allocatedBytes=4096 + round_number, streamBytes=0)
            if enabled:
                record.update(originals(round_number))
            records.append(record)
    result = dict(version='YNX-SYNTHETIC-STREAM-ONLY-AB/v1', source=SOURCE,
                  testBinarySHA256=HASH, inputSHA256=HASH, pid=123,
                  bootID='12345678-1234-1234-1234-123456789abc', timeNamespace='4:4026531834',
                  clock='CLOCK_MONOTONIC', height=1, blockHash=HASH, appHash=HASH,
                  records=records, processMaxRSSKiBSharedLifetime=4096,
                  nodeStarted=False, runtimeAuthorized=False, independentFinality=False,
                  **m.MEANINGS)
    for arm, suffix in ((False, 'Off'), (True, 'On')):
        for field, prefix in (('engineFixtureNs', 'medianEngineFixtureNs'),
                              ('probeAndStreamStopNs', 'medianProbeAndStreamStopNs')):
            values = sorted(r[field] for r in records if r['enabled'] is arm and not r['warmup'])
            result[prefix + suffix] = values[3] + (values[4] - values[3]) // 2
    return result


def events(data=None, *, payload=None, prefix='    before59_stream_cost_test.go:280: '):
    data = metric() if data is None else data
    payload = json.dumps(data, separators=(',', ':'), sort_keys=True) if payload is None else payload
    output = prefix + m.MARKER + payload + '\n'
    chunks = [output[i:i + 1024] for i in range(0, len(output), 1024)]
    def row(action, test=None, **kwargs):
        item = {'Time': '2026-11-28T00:00:00Z', 'Action': action, 'Package': m.PACKAGE}
        if test is not None:
            item['Test'] = test
        return dict(item, **kwargs)
    return [row('start'), row('run', m.TEST)] + [row('output', m.TEST, Output=chunk) for chunk in chunks] + [row('pass', m.TEST), row('pass')]


def encode(rows):
    return b''.join((json.dumps(row, separators=(',', ':')) + '\n').encode() for row in rows)


class Controls(unittest.TestCase):
    def assert_rejected(self, rows, source=SOURCE):
        with self.assertRaises((ValueError, UnicodeError)):
            m.qualify(encode(rows), source)

    def test_real_shape_long_output_in_1024_character_fragments(self):
        data = metric()
        rows = events(data)
        chunks = [r['Output'] for r in rows if r['Action'] == 'output']
        self.assertGreater(len(chunks), 2)
        self.assertTrue(all(len(chunk) == 1024 for chunk in chunks[:-1]))
        self.assertEqual(json.loads(m.qualify(encode(rows), SOURCE)), data)

    def test_marker_itself_crosses_fragment_boundary(self):
        rows = events(prefix='x' * 1019)
        chunks = [r['Output'] for r in rows if r['Action'] == 'output']
        self.assertIn('YNX_', chunks[0])
        self.assertEqual(json.loads(m.qualify(encode(rows), SOURCE)), metric())

    def test_foreign_package_test_and_failure_events_rejected(self):
        for name in ('foreign_package', 'foreign_test', 'fail', 'skip', 'build-fail', 'unknown'):
            rows = events()
            if name == 'foreign_package': rows[2]['Package'] = 'other/package'
            if name == 'foreign_test': rows[2]['Test'] = 'OtherTest'
            if name in ('fail', 'skip', 'build-fail'): rows[2]['Action'] = name
            if name == 'unknown': rows[2]['Action'] = 'pause'
            with self.subTest(name=name): self.assert_rejected(rows)

    def test_missing_duplicate_and_out_of_order_lifecycles_rejected(self):
        for name in ('package_start', 'package_pass', 'test_run', 'test_pass',
                     'duplicate_package', 'duplicate_run', 'package_pass_early',
                     'output_before_run', 'output_after_pass'):
            rows = events()
            if name == 'package_start': rows.pop(0)
            if name == 'package_pass': rows.pop()
            if name == 'test_run': rows.pop(1)
            if name == 'test_pass': rows.pop(-2)
            if name == 'duplicate_package': rows.insert(1, copy.deepcopy(rows[0]))
            if name == 'duplicate_run': rows.insert(2, copy.deepcopy(rows[1]))
            if name == 'package_pass_early': rows.insert(1, rows.pop())
            if name == 'output_before_run': rows.insert(1, rows.pop(2))
            if name == 'output_after_pass': rows.insert(-1, rows.pop(2))
            with self.subTest(name=name): self.assert_rejected(rows)

    def test_missing_fragment_duplicate_marker_truncation_and_non_json_rejected(self):
        rows = events(); rows.pop(3); self.assert_rejected(rows)
        rows = events(); rows.insert(-2, copy.deepcopy(rows[2])); self.assert_rejected(rows)
        rows = events(); last_output = next(row for row in reversed(rows) if row['Action'] == 'output')
        self.assertTrue(last_output['Output'].endswith('\n'))
        last_output['Output'] = last_output['Output'][:-1]
        self.assert_rejected(rows)
        with self.assertRaises(ValueError): m.qualify(encode(events())[:-1], SOURCE)
        with self.assertRaises(ValueError): m.qualify(b'not json\n', SOURCE)
        with self.assertRaises(ValueError): m.qualify(b'{}\n' * (m.MAX_EVENTS_BYTES // 3 + 1), SOURCE)

    def test_metric_marker_outside_test_and_output_on_nonoutput_rejected(self):
        rows = events()
        rows.insert(1, {'Action':'output','Package':m.PACKAGE,'Output':m.MARKER+'{}\n'})
        self.assert_rejected(rows)
        rows = events()
        rows.insert(1, {'Action':'output','Package':m.PACKAGE,'Output':m.MARKER[:8]})
        rows.insert(2, {'Action':'output','Package':m.PACKAGE,'Output':m.MARKER[8:]+'{}\n'})
        self.assert_rejected(rows)
        for index in (0, 1, -2, -1):
            rows = events(); rows[index]['Output'] = m.MARKER + '{}\n'
            with self.subTest(index=index): self.assert_rejected(rows)

    def test_source_clock_identity_and_scope_are_strict(self):
        for key, value in (('source', 'c' * 40), ('testBinarySHA256', 'b' * 63),
                           ('inputSHA256', '0' * 64), ('blockHash', 'B' * 64),
                           ('appHash', 'd' * 63), ('bootID', 'bad'),
                           ('timeNamespace', 'time:[42]'), ('timeNamespace', '4:0'),
                           ('clock', 'CLOCK_REALTIME'), ('pid', 0), ('height', True),
                           ('processMaxRSSKiBSharedLifetime', 0), ('nodeStarted', True),
                           ('runtimeAuthorized', 0), ('independentFinality', True),
                           ('stopMeaning', 'Node.Stop')):
            data = metric(); data[key] = value
            with self.subTest(key=key,value=value): self.assert_rejected(events(data))
        with self.assertRaises(ValueError): m.qualify(encode(events()), 'not-a-source')

    def test_sample_count_order_fields_and_types_rejected(self):
        mutations = ('missing', 'extra', 'swap', 'wrong_round', 'wrong_warmup', 'wrong_enabled',
                     'negative_ns', 'bool_allocation', 'overflow_allocation', 'disabled_stream',
                     'disabled_hash', 'enabled_no_hash', 'enabled_bad_hash', 'enabled_empty_stream',
                     'enabled_oversize_stream', 'disabled_close', 'unknown_field')
        for name in mutations:
            data=metric(); records=data['records']
            if name == 'missing': records.pop()
            if name == 'extra': records.append(copy.deepcopy(records[-1]))
            if name == 'swap': records[4],records[5]=records[5],records[4]
            if name == 'wrong_round': records[0]['round']=1
            if name == 'wrong_warmup': records[4]['warmup']=True
            if name == 'wrong_enabled': records[0]['enabled']=False
            if name == 'negative_ns': records[0]['engineFixtureNs']=-1
            if name == 'bool_allocation': records[0]['allocatedBytes']=True
            if name == 'overflow_allocation': records[0]['allocatedBytes']=1 << 64
            if name == 'disabled_stream': records[1]['streamBytes']=1
            if name == 'disabled_hash': records[1]['streamSHA256']=HASH
            if name == 'enabled_no_hash': del records[0]['streamSHA256']
            if name == 'enabled_bad_hash': records[0]['streamSHA256']='bad'
            if name == 'enabled_empty_stream': records[0]['streamBytes']=0
            if name == 'enabled_oversize_stream': records[0]['streamBytes']=m.MAX_STREAM_BYTES+1
            if name == 'disabled_close': records[1]['observerCloseNs']=1
            if name == 'unknown_field': records[0]['extra']='false'
            with self.subTest(name=name): self.assert_rejected(events(data))

    def test_original_stream_and_receipt_bytes_require_canonical_base64_and_pins(self):
        for name in ('stream_tamper', 'stream_bad_base64', 'stream_length', 'stream_hash',
                     'receipt_tamper', 'receipt_bad_base64', 'receipt_length', 'receipt_hash',
                     'missing_stream', 'missing_receipt', 'receipt_too_large', 'crossed_receipt'):
            data=metric();record=data['records'][0]
            if name=='stream_tamper': record['streamBase64']='A'+record['streamBase64'][1:]
            if name=='stream_bad_base64': record['streamBase64']='!'+record['streamBase64'][1:]
            if name=='stream_length': record['streamBytes']+=1
            if name=='stream_hash': record['streamSHA256']='c'*64
            if name=='receipt_tamper': record['receiptBase64']='A'+record['receiptBase64'][1:]
            if name=='receipt_bad_base64': record['receiptBase64']='!'+record['receiptBase64'][1:]
            if name=='receipt_length': record['receiptBytes']+=1
            if name=='receipt_hash': record['receiptSHA256']='c'*64
            if name=='missing_stream': del record['streamBase64']
            if name=='missing_receipt': del record['receiptBase64']
            if name=='receipt_too_large': record['receiptBytes']=(512<<10)+1
            if name=='crossed_receipt':
                other=data['records'][3]
                for key in ('receiptBase64','receiptSHA256','receiptBytes'):record[key]=other[key]
            with self.subTest(name=name): self.assert_rejected(events(data))

    def test_noncanonical_base64_pad_bits_rejected_even_if_bytes_match(self):
        alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        for label in ('stream','receipt'):
            data=metric();record=data['records'][0];key=label+'Base64';original=record[key]
            self.assertTrue(original.endswith('='))
            position=-3 if original.endswith('==') else -2
            index=alphabet.index(original[position]);replacement=alphabet[index ^ 1]
            record[key]=original[:position]+replacement+original[position+1:]
            self.assertEqual(base64.b64decode(original,validate=True),base64.b64decode(record[key],validate=True))
            with self.subTest(label=label):self.assert_rejected(events(data))

    def test_stream_event_and_framing_rejected_even_after_all_pins_recomputed(self):
        for name in ('header', 'truncated', 'extra_line', 'height', 'header_hash', 'app_hash',
                     'epoch', 'attempt', 'ns_zero', 'ns_leading_zero', 'ns_overflow',
                     'missing_field', 'extra_field', 'duplicate_field'):
            data=metric();record=data['records'][0]
            raw=base64.b64decode(record['streamBase64']);parts=raw.split(b'\n')
            if name=='header': parts[0]=b'{}'
            if name=='truncated': parts.pop()
            if name=='extra_line': parts.insert(-1,b'{}')
            if name in ('header','truncated','extra_line'):set_stream(record,b'\n'.join(parts))
            elif name=='duplicate_field':
                parts[1]=parts[1].replace(b'"height":1',b'"height":2,"height":1',1);set_stream(record,b'\n'.join(parts))
            else:
                event=json.loads(parts[1])
                if name=='height': event['height']=2
                if name=='header_hash': event['headerHash']='c'*64
                if name=='app_hash': event['appHash']='c'*64
                if name=='epoch': event['captureEpoch']=0
                if name=='attempt': event['attempt']=True
                if name=='ns_zero': event['monotonicNs']='0'
                if name=='ns_leading_zero': event['monotonicNs']='01'
                if name=='ns_overflow': event['monotonicNs']=str(1<<63)
                if name=='missing_field': del event['height']
                if name=='extra_field': event['source']='fabricated'
                set_event(record,event)
            with self.subTest(name=name): self.assert_rejected(events(data))

    def test_receipt_semantics_rejected_even_after_receipt_pin_recomputed(self):
        mutations=(('version','other'),('classification','AUTHORIZED'),('status','COMPLETE'),
                   ('streamStatus','UNKNOWN'),('enqueued',2),('written',True),('bytes',1),
                   ('sha256','c'*64),('streamDurable',False),('streamCleanupDebt',True),
                   ('firstCauseBytes',1),('firstCauseTruncated',True),('startupCoverageComplete',True),
                   ('walReplayExcluded',True),('nodeBindingVerified',True),
                   ('receiptPublicationVerified',True),('runtimeAuthorized',True),('independentFinality',True))
        for key,value in mutations:
            data=metric();record=data['records'][0];receipt=json.loads(base64.b64decode(record['receiptBase64']))
            receipt[key]=value;set_receipt(record,receipt)
            with self.subTest(key=key):self.assert_rejected(events(data))
        for kind in ('missing','extra','duplicate','truncated'):
            data=metric();record=data['records'][0];raw=base64.b64decode(record['receiptBase64']);receipt=json.loads(raw)
            if kind=='missing':del receipt['runtimeAuthorized'];set_receipt(record,receipt)
            if kind=='extra':receipt['firstCauseBase64']='';set_receipt(record,receipt)
            if kind=='duplicate':set_receipt_raw(record,raw.replace(b'"status":"UNKNOWN"',b'"status":"bad","status":"UNKNOWN"',1))
            if kind=='truncated':set_receipt_raw(record,raw[:-1])
            with self.subTest(kind=kind):self.assert_rejected(events(data))

    def test_each_median_is_recomputed(self):
        for field in ('medianEngineFixtureNsOff', 'medianEngineFixtureNsOn',
                      'medianProbeAndStreamStopNsOff', 'medianProbeAndStreamStopNsOn'):
            data=metric();data[field]+=1
            with self.subTest(field=field): self.assert_rejected(events(data))

    def test_duplicate_metric_key_and_extra_fields_rejected(self):
        payload=json.dumps(metric(),separators=(',', ':'),sort_keys=True)
        self.assert_rejected(events(payload=payload.replace('"version":', '"version":"forged","version":',1)))
        data=metric();data['nodeStartedExtra']=False;self.assert_rejected(events(data))

    def test_cli_returns_original_metric_and_rejects_wrong_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'events.jsonl';path.write_bytes(encode(events()))
            result=subprocess.run([sys.executable,str(PATH),str(path),SOURCE],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertTrue(result.stdout.startswith(m.MARKER))
            self.assertEqual(json.loads(result.stdout[len(m.MARKER):]),metric())
            result=subprocess.run([sys.executable,str(PATH),str(path),'c'*40],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(result.stdout,'')


if __name__ == '__main__':
    unittest.main(verbosity=2)
