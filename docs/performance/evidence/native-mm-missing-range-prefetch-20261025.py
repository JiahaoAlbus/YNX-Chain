"""Prefetch only absent original public ranges; never qualify or publish members.

Arguments: frozen packet, original run directory, NEW proof JSON.
Run exclusively after the prior cache writer is authoritatively terminal.
Uses the unchanged frozen ExactHTTPRanges and transport, original60s deadline,
aligned64KiB206/ETag/cache caps. Complete frozen recover/verify is still required.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import signal
import stat
import sys
import time


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base, root, output = map(lambda p: Path(p).absolute(), sys.argv[1:4])
reader = base / 'frozen-readers/scripts/loadtest/native-stream-artifact.py'
adapter = base / 'persistent-original-range-recovery.py'
assert hashlib.sha256(reader.read_bytes()).hexdigest() == '302fc2be287d1836471d20985736cfe395d2bce662f1116d9c75c5c2e9d3257e'
assert hashlib.sha256(adapter.read_bytes()).hexdigest() == '7164d9a1c9944c300c90009317a76a46bc2a8b44aaeeb395d017ccf7c901bc3b'
core = load('original_missing_range_core', reader)
transport = load('original_missing_range_transport', adapter)
head = 'd24e97b8d3373e294a9d7992e07b4ef532bd6dcf'
began = time.monotonic()
opener = None
result = dict(schema=1, runId=40113221553, sourceCommit=head,
              consumerSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              fetchedRanges=[], completeArchiveRecovery=False, nativePairQualified=False,
              networkQualified=False, sustainedTPSQualified=False)
signal.signal(signal.SIGALRM, core.recovery_timeout)
signal.setitimer(signal.ITIMER_REAL, 60)
try:
    meta, url = core.original_artifact(12567657516, 40113221553, head, 'network-pair')
    assert meta['size_in_bytes'] == 98811639
    identity = dict(artifactId=meta['id'], name=meta['name'], bytes=meta['size_in_bytes'],
                    runId=40113221553, head=head, digestReportedButNotRecomputed=meta.get('digest'))
    opener = transport.PersistentArtifactOpener(url)
    ranges = core.ExactHTTPRanges(url, identity['bytes'], root / 'range-cache', identity, opener=opener)
    ranges.deadline = began + 60
    archive = core.Archive(core.Blocks(identity['bytes'], ranges.fetch))
    selection = core.Selection('network-pair')
    wanted = set()
    selected_bytes = missing = 0
    for entry in archive.entries():
        relative = selection.select(entry['name'])
        if relative is None:
            continue
        core.need(not stat.S_ISLNK(entry['mode']) and core.integer(entry['size'], 0, core.MAX_MEMBER), 'original member type/size bound')
        selected_bytes += entry['size']
        core.need(selected_bytes <= core.MAX_RECOVERED, 'original selected byte cap')
        target = root / 'capture' / relative
        core.need(target.parent.resolve() == target.parent, 'capture symlink refused')
        if target.exists() or target.is_symlink():
            core.need(not target.is_symlink() and target.is_file(), 'existing member is not regular')
            continue  # No reread/decompression/publication of completed members.
        missing += 1
        result['missingMembersExamined'] = missing
        begin = archive.inspect_member(entry)  # Original exact local-header checks.
        if not entry['packed']:
            continue
        first = begin // core.BLOCK * core.BLOCK
        last = (begin + entry['packed'] - 1) // core.BLOCK * core.BLOCK
        wanted.update(range(first, last + core.BLOCK, core.BLOCK))
    result.update(missingMembers=missing, originalSelectedBytes=selected_bytes,
                  centralDirectorySHA256=archive.central_sha)
    for start in sorted(wanted):
        body = root / 'range-cache' / ('block-%010d.bin' % start)
        pin = body.with_suffix('.json')
        if body.exists() or pin.exists():
            core.need(body.exists() and pin.exists(), 'incomplete original cache; reconcile first')
            continue  # Original completed ranges are not downloaded again.
        ranges.fetch(start, min(core.BLOCK, identity['bytes'] - start))
        result['fetchedRanges'].append(start)
    result['prefetchComplete'] = True
except Exception as error:
    result.update(prefetchComplete=False, firstCause=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
finally:
    if opener is not None:
        opener.close()
    signal.setitimer(signal.ITIMER_REAL, 0)
    result.update(elapsedSeconds=time.monotonic() - began,
                  networkRangeBytes=ranges.network_bytes if 'ranges' in locals() else 0,
                  etag=ranges.etag if 'ranges' in locals() else None,
                  httpRequests=opener.requests if opener else 0,
                  interpretation='Only absent original public aligned ranges fetched with frozen206/ETag/cache caps. Existing members/partials untouched. No original member publication or qualification; unchanged frozen full recovery and verification remain mandatory.')
    with output.open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
print(json.dumps({k: v for k, v in result.items() if k != 'fetchedRanges'}))
sys.exit(0 if result['prefetchComplete'] else 1)
