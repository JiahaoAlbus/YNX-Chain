#!/usr/bin/python3
"""Ensure SwiftPM Native and standalone QA probes consume the same bounded parser.

Native's target includes only native/Sources; the external tests copy is never
added to that target. No compile, network, bundle mutation or authority involved.
"""
import argparse
import hashlib
import json
from pathlib import Path


def verify(native, probe):
    left, right = native.read_bytes(), probe.read_bytes()
    if left != right:
        raise ValueError('Native and standalone Snowflake phase parser drift')
    text = left.decode('utf-8')
    if not text.startswith('#if YNX_PRIVACY_ACCEPTANCE\n') or not text.endswith('#endif\n'):
        raise ValueError('Native recorder must be wholly QA-only')
    if text.count('struct SnowflakeSafePhaseRecorder {') != 1:
        raise ValueError('unexpected recorder declaration count')
    return hashlib.sha256(left).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path)
    a = p.parse_args()
    browser = Path(__file__).resolve().parents[3]
    native = browser/'native/Sources/YNXBrowserNative/SnowflakeSafePhaseRecorder.swift'
    probe = Path(__file__).with_name('SnowflakeSafePhaseRecorder.swift')
    sha = verify(native, probe)
    declarations = []
    for source in sorted((browser/'native/Sources/YNXBrowserNative').glob('*.swift')):
        if 'struct SnowflakeSafePhaseRecorder {' in source.read_text(): declarations.append(str(source.relative_to(browser)))
    if declarations != ['native/Sources/YNXBrowserNative/SnowflakeSafePhaseRecorder.swift']:
        raise ValueError('duplicate or missing recorder in real Native target')
    # Negative DATA control proves drift is rejected, without rewriting either source.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='p05-recorder-sync-', dir=a.output.parent if a.output else None) as directory:
        altered = Path(directory)/'altered.swift'
        altered.write_bytes(probe.read_bytes()+b'// SYNTHETIC DRIFT\n')
        rejected = False
        try: verify(native, altered)
        except ValueError: rejected = True
        if not rejected: raise ValueError('sync gate accepted a changed parser')
    result = dict(schema='P05_NATIVE_SNOWFLAKE_PHASE_SOURCE_SYNC_V1', status='PASS', sourceSHA256=sha,
                  nativeTargetDeclarations=declarations, syntheticDriftRejected=True,
                  normalExposure='wholly compileflag-gated', compile='NOT_RUN', network='NOT_RUN')
    raw = json.dumps(result, indent=2)+'\n'
    if a.output:
        with a.output.open('x') as f: f.write(raw)
    print(raw, end='')


if __name__ == '__main__': main()
