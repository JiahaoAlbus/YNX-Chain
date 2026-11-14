#!/usr/bin/env python3
"""New routed-file lifetime delta; actual local WebKit, no route/NE authority or GUI."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import threading


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--reuse-core', type=Path)
parser.add_argument('--retirement-only', action='store_true')
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(mode=0o700, parents=True, exist_ok=False)
browser = Path(__file__).resolve().parents[3]
page = browser / 'native/Sources/YNXBrowserNative/RoutedBrowserPage.swift'
core = browser / 'native/Sources/YNXBrowserCore/DownloadPersistence.swift'
probe = Path(__file__).with_name('Probe.swift')
fixture = browser / 'test/ordinary-native-fixture.py'
source = page.read_text()
marker = '@MainActor final class RoutedDownloadRetirement {'
assert source.count(marker) == 1
lease = 'import Foundation\nimport WebKit\nimport YNXBrowserCore\n' + source[source.index(marker):]
(output / 'ActualRoutedDownloadFileLease.swift').write_text(lease)
pins = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [page, core, probe, fixture]}
(output / 'inputs.json').write_text(json.dumps(pins, indent=2) + '\n')
target = platform.machine() + '-apple-macos14.0'
commands = [
    ['xcrun', 'swiftc', '-swift-version', '6', '-target', target, '-module-cache-path', str(output / 'module-cache'),
     '-emit-library', '-emit-module', '-module-name', 'YNXBrowserCore', str(core),
     '-emit-module-path', str(output / 'YNXBrowserCore.swiftmodule'), '-o', str(output / 'libYNXBrowserCore.dylib')],
    ['xcrun', 'swiftc', '-swift-version', '6', '-target', target, '-module-cache-path', str(output / 'module-cache'),
     '-I', str(output), '-L', str(output), '-lYNXBrowserCore', '-Xlinker', '-rpath', '-Xlinker', str(output),
     str(output / 'ActualRoutedDownloadFileLease.swift'), str(probe), '-o', str(output / 'probe')],
]
events = []
reused_core = None
if args.reuse_core:
    reuse = args.reuse_core.resolve()
    previous = json.loads((reuse / 'inputs.json').read_text())
    assert previous[str(core)] == pins[str(core)]
    for file in list(reuse.glob('YNXBrowserCore.*')) + [reuse / 'libYNXBrowserCore.dylib']:
        assert file.is_file() and not file.is_symlink()
        shutil.copy2(file, output / file.name)
    reused_core = {'directory': str(reuse), 'sourceSHA256': pins[str(core)],
                   'librarySHA256': hashlib.sha256((output / 'libYNXBrowserCore.dylib').read_bytes()).hexdigest()}
    commands = commands[1:]


def run(command, name, timeout):
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.terminate()
        stdout, stderr = process.communicate(timeout=5)
        (output / (name + '.stdout')).write_bytes(stdout)
        (output / (name + '.stderr')).write_bytes(stderr)
        raise
    (output / (name + '.stdout')).write_bytes(stdout)
    (output / (name + '.stderr')).write_bytes(stderr)
    events.append({'name': name, 'PID': process.pid, 'exit': process.returncode, 'reaped': True})
    if process.returncode:
        (output / 'failure.json').write_text(json.dumps({'failed': name, 'processes': events}, indent=2) + '\n')
        raise RuntimeError(name + ' failed: see preserved stderr')
    return stdout


for index, command in enumerate(commands):
    run(command, 'compile-' + str(index), 90)
spec = importlib.util.spec_from_file_location('owned_routed_file_fixture', fixture)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
server = module.ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
server.daemon_threads = True
worker = threading.Thread(target=server.serve_forever, daemon=True)
worker.start()
try:
    command = [str(output / 'probe'), 'http://127.0.0.1:' + str(server.server_port), str(output)]
    if args.retirement_only:
        command.append('--retirement-only')
    raw = run(command, 'new-delta', 40)
    result = json.loads(raw)
    assert result['status'] == 'PASS'
finally:
    server.shutdown()
    server.server_close()
    worker.join(timeout=2)
drift = [name for name, pin in pins.items() if hashlib.sha256(Path(name).read_bytes()).hexdigest() != pin]
receipt = {'status': 'FAIL' if drift else 'PASS', 'sourceDrift': drift, 'processes': events,
           'reusedCore': reused_core,
           'actual': result, 'fixtureStopped': not worker.is_alive(), 'GUIUsed': False,
           'signedGateNEWholeWindowLeakSafe': 'NOT_RUN', 'extractedProductionFileLease': True}
(output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
raise SystemExit(1 if drift else 0)
