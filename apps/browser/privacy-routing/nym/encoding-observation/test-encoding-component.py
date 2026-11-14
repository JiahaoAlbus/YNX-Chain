#!/usr/bin/env python3
"""Explicit cached Rust component delta; never cargo, protected policy, vendor or public GET."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--cached-receipt', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    assert args.output.is_absolute() and not args.output.exists()
    for path, minimum in [(Path('/'), 2*1024**3), (args.output.parent, 16*1024**3)]:
        volume = os.statvfs(path)
        assert volume.f_bavail*volume.f_frsize >= minimum, 'Insufficient disk budget'
    prior = json.loads(args.cached_receipt.read_text())
    assert prior['schema'] == 'P05_NYM_ENCODING_COMPONENT_RUN_V1'
    pin = json.loads((HERE/'source-pin.json').read_text())
    sources = {name: sha(args.source_root/name) for name in pin['files']}
    assert sources == {name: value['after'] for name, value in pin['files'].items()}
    support = {name: sha(args.source_root/name) for name in pin['supportSources']}
    assert support == pin['supportSources']
    command = prior['records'][0]['command'].copy()
    dependencies = {}
    for i, value in enumerate(command):
        if value == '--extern':
            path = Path(command[i+1].split('=', 1)[1])
            dependencies[str(path)] = sha(path)
            assert dependencies[str(path)] == prior['dependenciesSHA256'][str(path)]
    args.output.mkdir(mode=0o700, parents=True)
    fixture = (HERE/'encoding-controls.rs.in').read_text()
    for token, name in [('@NETWORK@', 'common/http-api-client/src/reviewed_network.rs'),
                        ('@REVIEWED@', 'clients/socks5/src/commands/reviewed.rs'),
                        ('@DIAGNOSTICS@', 'clients/socks5/src/commands/directory_diagnostics.rs')]:
        fixture = fixture.replace(token, str(args.source_root/name))
    (args.output/'encoding-controls.rs').write_text(fixture)
    for i, value in enumerate(command):
        if value.endswith('/encoding-controls.rs'):
            command[i] = str(args.output/'encoding-controls.rs')
    command[command.index('-o')+1] = str(args.output/'encoding-controls')
    start = time.monotonic(); records = []; peak = 0
    (args.output/'tmp').mkdir()
    with tempfile.TemporaryDirectory(prefix='ynx-nym-encoding.', dir='/tmp') as alias:
        os.symlink(args.output/'tmp', Path(alias)/'tmp')
        env = {'PATH': '/usr/bin:/bin', 'TMPDIR': str(Path(alias)/'tmp')+'/', 'NO_PROXY': '*'}
        for name, argv, budget in [('compile', command, 30), ('runtime', [str(args.output/'encoding-controls')], 12)]:
            with (args.output/(name+'.stdout')).open('wb') as stdout, (args.output/(name+'.stderr')).open('wb') as stderr:
                child = subprocess.Popen(argv, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
                phase_start = time.monotonic(); reason = None
                while child.poll() is None:
                    rss = 0
                    for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,rss='], text=True).splitlines():
                        fields = line.split()
                        if len(fields) == 3 and int(fields[1]) == child.pid:
                            rss += int(fields[2])*1024
                    peak = max(peak, rss)
                    physical = sum(p.stat().st_size for p in args.output.rglob('*') if p.is_file())
                    if rss > 512*1024**2 or physical > 64*1024**2:
                        reason = 'bounded resources'
                    elif time.monotonic()-phase_start > budget or time.monotonic()-start > 55:
                        reason = 'bounded deadline'
                    if reason:
                        try:
                            os.killpg(child.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        try:
                            child.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=2)
                        break
                    try:
                        child.wait(timeout=.15)
                    except subprocess.TimeoutExpired:
                        pass
                records.append({'name': name, 'command': argv, 'pid': child.pid, 'exit': child.wait(),
                                'reaped': True, 'stopReason': reason})
                (args.output/'commands.json').write_text(json.dumps(records, indent=2)+'\n')
                if child.returncode:
                    break
    receipt = {'schema': 'P05_NYM_ENCODING_COMPONENT_REPLAY_V1', 'records': records,
               'dependenciesSHA256': dependencies, 'sourceSHA256': sources, 'supportSourceSHA256': support, 'elapsed': time.monotonic()-start,
               'peakTreeRSS': peak, 'scope': 'SDKdecoder ownedloopbackHTTP, no protectedconstructor or publicnetwork'}
    (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    assert all(r['exit'] == 0 for r in records) and len(records) == 2, receipt
    assert {name: sha(args.source_root/name) for name in sources} == sources
    print(json.dumps({'receipt': str(args.output/'receipt.json')}))

if __name__ == '__main__':
    main()
