#!/usr/bin/env python3
"""Read the original synthetic stream-only Go test events; grant no authority."""
import argparse
import base64
import binascii
import hashlib
import json
from pathlib import Path
import re
import sys

PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'
TEST = 'TestBefore59SyntheticStreamOnlyCost'
MARKER = 'YNX_SYNTHETIC_STREAM_ONLY_AB '
MAX_EVENTS_BYTES = 8 << 20
MAX_STREAM_BYTES = 16 << 20
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
NAMESPACE = re.compile(r'(?:0|[1-9][0-9]*):[1-9][0-9]*\Z')
FIELDS = {
    'version', 'source', 'testBinarySHA256', 'inputSHA256', 'pid', 'bootID',
    'timeNamespace', 'clock', 'height', 'blockHash', 'appHash', 'records',
    'medianEngineFixtureNsOff', 'medianEngineFixtureNsOn',
    'medianProbeAndStreamStopNsOff', 'medianProbeAndStreamStopNsOn',
    'engineFixtureMeaning', 'stopMeaning', 'allocatedBytesMeaning',
    'processMaxRSSKiBSharedLifetime', 'nodeStarted', 'runtimeAuthorized',
    'independentFinality',
}
RECORD_FIELDS = {'round', 'warmup', 'enabled', 'engineFixtureNs',
                 'probeAndStreamStopNs', 'observerCloseNs', 'allocatedBytes',
                 'streamBytes'}
ON_FIELDS = {'streamSHA256', 'streamBase64', 'receiptBytes', 'receiptSHA256', 'receiptBase64'}
STREAM_HEADER = b'{"version":"YNX-SYNTHETIC-HEADER-STREAM/v1","classification":"DATA_ONLY"}'
EVENT_FIELDS = {'height', 'headerHash', 'appHash', 'captureEpoch', 'attempt', 'monotonicNs'}
RECEIPT_FIELDS = {'version', 'classification', 'status', 'streamStatus', 'enqueued',
                  'written', 'bytes', 'sha256', 'streamDurable', 'streamCleanupDebt',
                  'firstCauseBytes', 'firstCauseTruncated', 'startupCoverageComplete',
                  'walReplayExcluded', 'nodeBindingVerified', 'receiptPublicationVerified',
                  'runtimeAuthorized', 'independentFinality'}
MEANINGS = {
    'engineFixtureMeaning': 'local proxy, state and in-memory database setup plus original BlockExecutor and proxy stop',
    'stopMeaning': 'synthetic stop probe plus actual stream worker and durable receipt; not actual Node.Stop',
    'allocatedBytesMeaning': 'process-wide allocation delta from before engine fixture through probe and stream stop; excludes readback and observer close',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key: ' + key)
            result[key] = value
        return result

    def invalid(value):
        raise ValueError('invalid JSON constant: ' + value)

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def integer(value, label, maximum=(1 << 63) - 1, minimum=0):
    require(type(value) is int and minimum <= value <= maximum, 'invalid integer: ' + label)


def digest(value, pattern, label):
    require(type(value) is str and pattern.fullmatch(value) is not None and
            any(char != '0' for char in value), 'invalid digest: ' + label)


def original_bytes(encoded, length, expected_hash, maximum, label):
    integer(length, label + ' bytes', maximum=maximum, minimum=1)
    digest(expected_hash, HEX64, label + ' SHA256')
    require(type(encoded) is str and len(encoded) == 4 * ((length + 2) // 3),
            label + ' base64 length differs')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError(label + ' base64 is invalid') from error
    require(base64.b64encode(raw).decode('ascii') == encoded and len(raw) == length and
            hashlib.sha256(raw).hexdigest() == expected_hash,
            label + ' original bytes, base64 or digest differ')
    return raw


def verify_stream_and_receipt(record, cost):
    stream = original_bytes(record['streamBase64'], record['streamBytes'],
                            record['streamSHA256'], MAX_STREAM_BYTES, 'stream')
    receipt_raw = original_bytes(record['receiptBase64'], record['receiptBytes'],
                                 record['receiptSHA256'], 512 << 10, 'receipt')
    lines = stream.split(b'\n')
    require(len(lines) == 3 and lines[0] == STREAM_HEADER and lines[1] and lines[2] == b'',
            'original stream framing differs')
    event = strict_json(lines[1].decode('utf-8'))
    require(type(event) is dict and set(event) == EVENT_FIELDS, 'stream event fields differ')
    integer(event['height'], 'stream height', minimum=1)
    require(event['height'] == cost['height'] and event['headerHash'] == cost['blockHash'] and
            event['appHash'] == cost['appHash'], 'stream block identity differs')
    for field in ('captureEpoch', 'attempt'):
        integer(event[field], 'stream ' + field, maximum=(1 << 64) - 1, minimum=1)
    ns = event['monotonicNs']
    require(type(ns) is str and re.fullmatch(r'[1-9][0-9]*', ns) is not None and
            int(ns) < 1 << 63, 'stream monotonic time differs')
    require(receipt_raw.endswith(b'\n') and receipt_raw.count(b'\n') == 1,
            'original receipt framing differs')
    receipt = strict_json(receipt_raw.decode('utf-8'))
    require(type(receipt) is dict and set(receipt) == RECEIPT_FIELDS, 'receipt fields differ')
    require(receipt['version'] == 'YNX-SYNTHETIC-HEADER-STREAM-RECEIPT/v1' and
            receipt['classification'] == 'DATA_ONLY' and receipt['status'] == 'UNKNOWN' and
            receipt['streamStatus'] == 'OBSERVED_DATA', 'receipt status differs')
    for field, expected in (('enqueued', 1), ('written', 1), ('bytes', len(stream)), ('firstCauseBytes', 0)):
        require(type(receipt[field]) is int and receipt[field] == expected, 'receipt count differs: ' + field)
    require(receipt['sha256'] == record['streamSHA256'] and receipt['streamDurable'] is True,
            'receipt stream digest or durability differs')
    for field in ('streamCleanupDebt', 'firstCauseTruncated', 'startupCoverageComplete',
                  'walReplayExcluded', 'nodeBindingVerified', 'receiptPublicationVerified',
                  'runtimeAuthorized', 'independentFinality'):
        require(receipt[field] is False, 'receipt scope or cleanup differs: ' + field)


def qualify(events_raw, expected_source):
    """Validate original go test -json bytes and return its unmodified metric JSON."""
    digest(expected_source, HEX40, 'expected source')
    require(type(events_raw) is bytes and 0 < len(events_raw) <= MAX_EVENTS_BYTES and
            events_raw.endswith(b'\n'), 'missing, truncated or oversized Go event stream')
    rows = []
    for line in events_raw.splitlines():
        require(bool(line), 'empty Go event line')
        row = strict_json(line.decode('utf-8'))
        require(type(row) is dict and row.get('Package') == PACKAGE, 'foreign or missing Go package')
        require(row.get('Action') in ('start', 'run', 'output', 'pass'),
                'Go failure, skip, build failure or unsupported action')
        require(not row.get('Test') or row.get('Test') == TEST, 'foreign Go test')
        rows.append(row)

    package = [(i, row['Action']) for i, row in enumerate(rows)
               if not row.get('Test') and row['Action'] in ('start', 'pass')]
    require(len(package) == 2 and [a for _, a in package] == ['start', 'pass'] and
            package[0][0] == 0 and package[1][0] == len(rows) - 1,
            'Go package lifecycle missing, repeated or out of order')
    test = [(i, row['Action']) for i, row in enumerate(rows)
            if row.get('Test') == TEST and row['Action'] in ('run', 'pass')]
    require(len(test) == 2 and [a for _, a in test] == ['run', 'pass'] and
            package[0][0] < test[0][0] < test[1][0] < package[1][0],
            'Go test lifecycle missing, repeated or outside package')
    output = []
    all_output = []
    for i, row in enumerate(rows):
        if row['Action'] != 'output':
            require('Output' not in row, 'non-output Go event contains output')
        else:
            require(type(row.get('Output')) is str, 'Go output is not text')
            all_output.append(row['Output'])
        if row.get('Test') == TEST:
            require(row['Action'] in ('run', 'output', 'pass'), 'invalid Go test action')
            if row['Action'] == 'output':
                require(test[0][0] < i < test[1][0] and type(row.get('Output')) is str,
                        'test output outside run/pass or not text')
                output.append(row['Output'])
        else:
            require(row['Action'] in ('start', 'output', 'pass'), 'invalid package action')
            if row['Action'] == 'output':
                require(type(row.get('Output')) is str, 'package output is not text')
    combined = ''.join(output)
    require(combined.count(MARKER) == 1 and ''.join(all_output).count(MARKER) == 1,
            'unique original metric marker required in the complete Go output')
    metric_start = combined.index(MARKER) + len(MARKER)
    metric_end = combined.find('\n', metric_start)
    require(metric_end >= 0, 'original metric line is truncated')
    metric_raw = combined[metric_start:metric_end]
    data = strict_json(metric_raw)
    require(type(data) is dict and set(data) == FIELDS, 'metric field set differs')
    require(data['version'] == 'YNX-SYNTHETIC-STREAM-ONLY-AB/v1' and
            data['source'] == expected_source and data['clock'] == 'CLOCK_MONOTONIC',
            'metric version, source or clock differs')
    for name in ('testBinarySHA256', 'inputSHA256', 'blockHash', 'appHash'):
        digest(data[name], HEX64, name)
    require(type(data['bootID']) is str and UUID.fullmatch(data['bootID']) is not None and
            data['bootID'] != '00000000-0000-0000-0000-000000000000', 'invalid boot identity')
    require(type(data['timeNamespace']) is str and NAMESPACE.fullmatch(data['timeNamespace']) is not None,
            'invalid time namespace identity')
    for name in ('pid', 'height', 'processMaxRSSKiBSharedLifetime'):
        integer(data[name], name, minimum=1)
    for name in ('nodeStarted', 'runtimeAuthorized', 'independentFinality'):
        require(data[name] is False, 'synthetic scope differs: ' + name)
    for name, value in MEANINGS.items():
        require(data[name] == value, 'measurement meaning differs: ' + name)
    records = data['records']
    require(type(records) is list and len(records) == 20, 'twenty original records required')
    for i, record in enumerate(records):
        require(type(record) is dict, 'record must be an object')
        enabled = (i // 2) % 2 == 0 if i % 2 == 0 else (i // 2) % 2 != 0
        require(set(record) == RECORD_FIELDS | (ON_FIELDS if enabled else set()),
                'record fields differ')
        require(type(record['round']) is int and record['round'] == i // 2 and
                record['warmup'] is (i // 2 < 2) and record['enabled'] is enabled,
                'record order, arm or warmup differs')
        for name in ('engineFixtureNs', 'probeAndStreamStopNs', 'observerCloseNs', 'streamBytes'):
            integer(record[name], name)
        integer(record['allocatedBytes'], 'allocatedBytes', maximum=(1 << 64) - 1)
        if enabled:
            require(0 < record['streamBytes'] <= MAX_STREAM_BYTES, 'enabled stream size differs')
            verify_stream_and_receipt(record, data)
        else:
            require(record['streamBytes'] == 0 and record['observerCloseNs'] == 0,
                    'disabled arm contains stream or observer close')
    for arm, suffix in ((False, 'Off'), (True, 'On')):
        for field, prefix in (('engineFixtureNs', 'medianEngineFixtureNs'),
                              ('probeAndStreamStopNs', 'medianProbeAndStreamStopNs')):
            values = sorted(r[field] for r in records if r['enabled'] is arm and not r['warmup'])
            require(len(values) == 8, 'eight measured samples required')
            median = values[3] + (values[4] - values[3]) // 2
            integer(data[prefix + suffix], prefix + suffix)
            require(data[prefix + suffix] == median, 'original median differs from paired samples')
    return metric_raw


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('events', type=Path, help='original bounded go test -json file')
    parser.add_argument('source', help='independent exact 40-character source commit')
    args = parser.parse_args(argv)
    try:
        with args.events.open('rb') as handle:
            raw = handle.read(MAX_EVENTS_BYTES + 1)
        print(MARKER + qualify(raw, args.source))
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        print('synthetic stream cost evidence rejected: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
