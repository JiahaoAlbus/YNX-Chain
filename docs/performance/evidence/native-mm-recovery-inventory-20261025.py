"""Read-only original central-directory/cache inventory, no network or recovery.

Arguments: exact frozen source packet, original run directory, NEW JSON output.
Only run after the original cache writer is authoritatively terminal.
Does not rerun priority recovery, node parsing or transaction qualification.
"""
from pathlib import Path
import datetime
import hashlib
import importlib.util
import json
import os
import signal
import sys

base, root, output = map(lambda p: Path(p).absolute(), sys.argv[1:4])
reader = base / 'frozen-readers/scripts/loadtest/native-stream-artifact.py'
raw = reader.read_bytes()
reader_sha = hashlib.sha256(raw).hexdigest()
assert reader_sha == '302fc2be287d1836471d20985736cfe395d2bce662f1116d9c75c5c2e9d3257e'
spec = importlib.util.spec_from_file_location('original_inventory_core', reader)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
identity = json.loads((root / 'range-cache/identity.json').read_bytes())
assert identity['artifactId'] == 12567657516 and identity['bytes'] == 98811639
assert identity['runId'] == 40113221553 and identity['head'] == 'd24e97b8d3373e294a9d7992e07b4ef532bd6dcf'


class NoNetwork:
    def open(self, *args, **kwargs):
        raise RuntimeError('inventory metadata absent; no network permitted')


signal.signal(signal.SIGALRM, core.recovery_timeout)
signal.setitimer(signal.ITIMER_REAL, 60)
try:
    ranges = core.ExactHTTPRanges('https://artifact.blob.core.windows.net/original-no-network', identity['bytes'], root / 'range-cache', identity, opener=NoNetwork())
    archive = core.Archive(core.Blocks(identity['bytes'], ranges.fetch))
    selection = core.Selection('network-pair')
    complete, missing, partials = [], [], []
    for entry in archive.entries():
        relative = selection.select(entry['name'])
        if relative is None:
            continue
        target = root / 'capture' / relative
        if target.exists():
            own = core.file_identity(target)
            assert own['bytes'] == entry['size'] and own['crc32'] == entry['crc']
            complete.append(dict(path=relative, **own))
        else:
            missing.append(dict(path=relative, bytes=entry['size'], packed=entry['packed'], zipOffset=entry['offset']))
            partial = target.with_name(target.name + '.recover-partial')
            if partial.exists():
                partials.append(dict(path=str(partial), bytes=partial.stat().st_size))
    assert ranges.network_bytes == 0 and sum(p['bytes'] for p in complete + missing) <= core.MAX_RECOVERED
    bodies = list((root / 'range-cache').glob('*.bin'))
    orphans = [p.name for p in bodies if not p.with_suffix('.json').exists()]
    assert not orphans
    result = dict(schema=1, observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), runId=40113221553,
                  originalReaderSHA256=reader_sha, totalOriginalSelectedMembers=len(complete)+len(missing),
                  completeMembers=len(complete), completeBytes=sum(p['bytes'] for p in complete),
                  missingMembers=len(missing), missingBytes=sum(p['bytes'] for p in missing), complete=complete,
                  missing=missing, partials=partials, validatedCacheBlocks=len(bodies), orphanBodies=orphans,
                  networkBytes=0, fullIndependentQualified=False,
                  interpretation='Existing member CRC/size versus original cached ZIP central metadata; local SHA retained. Missing original members/ranges listed, no claim of full original range SHA replay or business qualification.')
    with output.open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({k: v for k, v in result.items() if k not in ('complete', 'missing', 'partials')}))
    print(json.dumps(dict(output=str(output), bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest())))
finally:
    signal.setitimer(signal.ITIMER_REAL, 0)
