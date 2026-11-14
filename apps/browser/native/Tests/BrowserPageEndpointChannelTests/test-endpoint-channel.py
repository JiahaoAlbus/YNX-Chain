#!/usr/bin/env python3
"""Only new PUBLIC embedded endpoint-custody delta; original Auth/Root NOT_RUN."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[1] / 'Sources/YNXBrowserNative'
MODES = ['normal', 'cancel-before', 'wrong-peer', 'late-reply', 'loss', 'current-loss']
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output
    if not output.is_absolute() or output.exists(): parser.error('Fresh absolute external output required')
    machine = platform.machine()
    if platform.system() != 'Darwin' or machine not in ('arm64', 'x86_64'): parser.error('Native macOS required')
    output.mkdir(mode=0o700)
    alias = Path(tempfile.mkdtemp(prefix='ynx-endpoint-', dir='/private/tmp'))
    alias.rmdir(); alias.symlink_to(output, target_is_directory=True)
    files = [NATIVE / name for name in ['BrowserPageProtectedIPC.swift', 'BrowserOriginalPageSourceMount.swift', 'BrowserOriginalPageEndpointChannel.swift']] + [HERE / 'Probe.swift']
    inputs = {str(path): sha(path) for path in files}
    copies = []
    for path in files:
        destination = output / 'source' / path.name
        destination.parent.mkdir(exist_ok=True)
        shutil.copy2(path, destination); copies.append(alias / 'source' / path.name)
    sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
    cache = output.parent / 'C-module-cache'; cache.mkdir(exist_ok=True)
    receipt = {'schema': 'P05_PUBLIC_ENDPOINT_CHANNEL_DELTA_V1', 'inputs': inputs, 'sdk': sdk,
               'RootOrAuthQualification': 'NOT_RUN', 'old14GroupsRerun': False, 'commands': [], 'alias': str(alias)}
    def save(): (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    def run(command, label):
        receipt['commands'].append(command); save()
        result = subprocess.run(command, capture_output=True, text=True)
        (output / (label + '.stdout')).write_text(result.stdout)
        (output / (label + '.stderr')).write_text(result.stderr)
        receipt[label + 'Exit'] = result.returncode; save()
        result.check_returncode()
    compile_command = ['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '6', '-sdk', sdk,
                       '-target', machine + '-apple-macosx14.0', '-module-cache-path', str(cache), '-framework', 'Foundation', '-framework', 'Security']
    process = None
    try:
        run(compile_command + list(map(str, copies)) + ['-o', str(alias / 'host')], 'compile-host')
        run(compile_command + ['-D', 'PUBLIC_ENDPOINT_SERVICE'] + list(map(str, copies)) + ['-o', str(alias / 'service')], 'compile-service')
        app = output / 'Host.app'
        executable = app / 'Contents/MacOS/PUBLICPageEndpointProbe'
        executable.parent.mkdir(parents=True); shutil.copy2(output / 'host', executable)
        for mode in MODES:
            directory = output / mode; directory.mkdir()
            service = app / ('Contents/XPCServices/com.ynx.public.endpoint.' + mode + '.xpc')
            binary = service / 'Contents/MacOS/PUBLICPageEndpointProbe'
            binary.parent.mkdir(parents=True); shutil.copy2(output / 'service', binary)
            info = {'CFBundleExecutable': 'PUBLICPageEndpointProbe', 'CFBundleIdentifier': 'com.ynx.public.endpoint.' + mode,
                    'CFBundlePackageType': 'XPC!', 'CFBundleVersion': '1', 'XPCService': {'ServiceType': 'Application', 'RunLoopType': 'dispatch_main'},
                    'PUBLICMode': mode, 'PUBLICDirectory': str(directory), 'PUBLICHostExecutable': str(executable), 'PUBLICRootQualified': False}
            (service / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            run(['/usr/bin/codesign', '--force', '--sign', '-', str(service)], 'sign-' + mode)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': 'PUBLICPageEndpointProbe', 'CFBundleIdentifier': 'com.ynx.public.endpoint.host',
                'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'LSBackgroundOnly': True, 'PUBLICRootQualified': False}))
        run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], 'sign-host')
        run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], 'verify-bundle')
        receipt['sourceDrift'] = inputs != {str(path): sha(path) for path in files}; save()
        if receipt['sourceDrift']: raise RuntimeError('Source drift before runtime')
        with (output / 'runtime.stdout').open('w') as stdout, (output / 'runtime.stderr').open('w') as stderr:
            process = subprocess.Popen([str(executable), str(output)], stdout=stdout, stderr=stderr)
            receipt['ownedHostPID'] = process.pid; save()
            try: receipt['runExit'] = process.wait(timeout=70)
            except subprocess.TimeoutExpired: receipt['timedOut'] = True; raise
        if receipt['runExit'] != 0: raise RuntimeError('Owned PUBLIC host exit ' + str(receipt['runExit']))
        results = [json.loads((output / mode / 'result.json').read_text()) for mode in MODES]
        receipt['newCases'] = results
        if receipt['runExit'] != 0 or any(row['status'] != 'PASS' for row in results): raise RuntimeError('New endpoint cases failed')
    except Exception as error:
        receipt['firstFailure'] = str(error)
        raise
    finally:
        for mode in MODES:
            directory = output / mode
            if directory.is_dir(): (directory / 'shutdown').write_text('close')
        if process is not None and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        known = []
        for mode in MODES:
            service = output / mode / 'service.json'
            if service.exists(): known.append(json.loads(service.read_text())['pid'])
        def alive(pid):
            try: os.kill(pid, 0); return True # Observation only, never signal discovered service.
            except ProcessLookupError: return False
        deadline = time.monotonic() + 6
        while any(alive(pid) for pid in known) and time.monotonic() < deadline: time.sleep(.02)
        receipt.update(ownedHostReaped=process is None or process.poll() is not None, knownServicePIDs=known,
                       knownServicesExited=all(not alive(pid) for pid in known), inFlightUnknown=any(alive(pid) for pid in known))
        save()
    if receipt['inFlightUnknown']: raise RuntimeError('Owned service shutdown not confirmed')
    print(json.dumps({'receipt': str(output / 'receipt.json'), 'newCases': len(MODES), 'RootOrAuthQualification': 'NOT_RUN'}))

if __name__ == '__main__': main()
