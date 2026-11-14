#!/usr/bin/env python3
"""Check the actual fixed Go emitter/Swift receiver contract without compiling.

Supply the reviewed successor Go source explicitly; this is source consistency,
not source provenance, callback execution, route readiness, or authorization.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def inspect(writer, receiver, receiver_copy):
    if receiver != receiver_copy:
        raise ValueError('Native/test recorder byte mismatch')
    go = writer.decode('utf-8')
    swift = receiver.decode('utf-8')
    regex = re.search(r'match\(#"(YNX_PUBLIC_ATTEMPT_V1 [^"\n]+)"#, message\)', swift)
    if regex is None:
        raise ValueError('exact attempt receiver grammar missing')
    groups = re.findall(r'\(([^()]*)\)', regex.group(1))
    if len(groups) != 14:
        raise ValueError('attempt field count changed')
    enum_positions = {'phase': 2, 'wait': 3, 'ice': 4, 'dtls': 5,
                      'sdp': 6, 'origin': 10, 'code': 11}
    enums = {}
    for name, position in enum_positions.items():
        found = re.findall(r'!oneOf\(' + name + r',\s*([^)]*)\)', go)
        if len(found) != 1:
            raise ValueError('ambiguous Go enum: ' + name)
        values = json.loads('[' + found[0] + ']')
        if len(values) != len(set(values)) or set(values) != set(groups[position].split('|')):
            raise ValueError('writer/receiver enum mismatch: ' + name)
        enums[name] = values
    # Fixed reviewed numeric bounds, not an executable parser substituted for
    # either product. A changed bound requires an explicit new contract review.
    for fragment in ['peer > 1024', 'seen > 7', 'id < 1 || id > 1024',
                     'elapsed > 650000', 'status < 100 || status > 599',
                     'kept < 0 || dropped < 0 || kept+dropped > 256']:
        if fragment not in go:
            raise ValueError('Go numeric contract changed')
    for fragment in ['(1...1024).contains(attempt)', 'elapsed <= 650000',
                     'status == 0 || (100...599).contains(status)',
                     'kept + dropped <= 256', 'peer <= 1024']:
        if fragment not in swift:
            raise ValueError('Swift numeric contract changed')
    for position, expected in {0: '[0-9]{1,4}', 1: '[0-9]{1,6}',
                               7: '[0-9]{1,3}', 8: '[0-9]{1,3}',
                               9: '[0-9]{1,3}', 12: '[0-7]',
                               13: '[0-9]{1,4}'}.items():
        if groups[position] != expected:
            raise ValueError('Swift integer grammar changed')
    return {'schema': 'P05_ATTEMPT_SOURCE_CONSISTENCY_V1', 'status': 'PASS',
            'writerSHA256': digest(writer), 'receiverSHA256': digest(receiver),
            'receiverCopySHA256': digest(receiver_copy), 'enums': enums,
            'fieldCount': len(groups), 'boundsUnchanged': True,
            'runtimeCallbacks': 'NOT_RUN', 'network': 'NOT_RUN',
            'notSourceProvenanceOrAuthority': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--go-attempt-writer', type=Path, required=True)
    parser.add_argument('--native-recorder', type=Path, required=True)
    parser.add_argument('--receiver-copy', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.go_attempt_writer.read_bytes(), args.native_recorder.read_bytes(),
                     args.receiver_copy.read_bytes())
    with args.output.open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
    print(json.dumps({'status': result['status'], 'fieldCount': result['fieldCount'],
                      'network': 'NOT_RUN'}))


if __name__ == '__main__':
    main()
