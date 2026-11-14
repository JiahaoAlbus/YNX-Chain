#!/usr/bin/env python3
"""Only new cancelled/concurrent owned-stop delta; no fake NE/Source or vendor run."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[3] / 'native'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute external output required')
    architecture = platform.machine()
    if platform.system() != 'Darwin' or architecture not in ('arm64', 'x86_64'): parser.error('Native macOS required')
    args.output.mkdir(mode=0o700)
    output = args.output
    alias = Path(tempfile.mkdtemp(prefix='ynx-stop-delta-', dir='/private/tmp'))
    alias.rmdir(); alias.symlink_to(output, target_is_directory=True)
    core = sorted((NATIVE / 'Sources/YNXBrowserCore').glob('*.swift'))
    if not core: raise RuntimeError('Actual Core sources missing')
    canonical = HERE / 'OwnedBackendStartGate.swift'
    actual = NATIVE / 'Sources/YNXBrowserCore/OwnedBackendStartGate.swift'
    if canonical.read_bytes() != actual.read_bytes(): raise RuntimeError('Canonical/Core Gate mismatch')
    inputs = {str(path): sha(path) for path in core + [canonical, HERE / 'StopCancellationSelfTest.swift', Path(__file__).resolve()]}
    copied = []
    for path in core + [HERE / 'StopCancellationSelfTest.swift']:
        directory = output / 'source'; directory.mkdir(exist_ok=True)
        destination = directory / path.name; shutil.copy2(path, destination); copied.append(alias / 'source' / path.name)
    sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
    common = ['xcrun', 'swiftc', '-swift-version', '6', '-sdk', sdk, '-target', architecture + '-apple-macosx14.0',
              '-module-cache-path', str(output.parent / 'C-module-cache'), '-module-name', 'YNXBrowserCore', '-parse-as-library']
    receipt = {'schema': 'P05_OWNED_STOP_CANCELLATION_BUILD_V1', 'inputs': inputs, 'commands': [], 'alias': str(alias),
               'actualNE': 'NOT_RUN', 'actualSignedGateOrBackend': 'NOT_RUN', 'productionRouteAdmission': False,
               'oldHelper7OrProviderGroupsRerun': False, 'scope': 'Actual production stop scheduling primitive with exact owned /bin/sleep fixture processes; no authority/preparation/ACK fabricated'}
    def save(): (output / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    def command(argv, label, timeout=90):
        receipt['commands'].append(argv); save()
        try: result = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            receipt[label + 'Timeout'] = True
            (output / (label + '.stdout')).write_bytes(error.stdout or b''); (output / (label + '.stderr')).write_bytes(error.stderr or b'')
            save(); raise
        (output / (label + '.stdout')).write_text(result.stdout); (output / (label + '.stderr')).write_text(result.stderr)
        receipt[label + 'Exit'] = result.returncode; save(); result.check_returncode()
    def run_probe(arguments, label, expected):
        process = subprocess.Popen([str(alias / 'StopCancellationProbe')] + arguments, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        receipt[label + 'PID'] = process.pid; save()
        try: stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            receipt[label + 'Timeout'] = True; process.kill(); stdout, stderr = process.communicate(timeout=5)
        (output / (label + '.stdout')).write_text(stdout); (output / (label + '.stderr')).write_text(stderr)
        receipt[label + 'Exit'] = process.returncode; receipt[label + 'OwnedReaped'] = process.returncode is not None; save()
        if process.returncode != expected or receipt.get(label + 'Timeout'): raise RuntimeError(label + ' unexpected exit')
        return json.loads(stdout)
    try:
        command(common + list(map(str, copied)) + ['-o', str(alias / 'StopCancellationProbe')], 'normal-core-and-probe')
        command(common + ['-D', 'YNX_PRIVACY_ACCEPTANCE', '-typecheck'] + list(map(str, copied[:-1])), 'qa-core-typecheck')
        receipt['sourceDrift'] = inputs != {path: sha(Path(path)) for path in inputs}
        if receipt['sourceDrift']: raise RuntimeError('Source drift')
        receipt['firstCauseReproduction'] = run_probe(['--legacy-cancelled-sleep'], 'legacy-cancelled-loop', 1)
        result = run_probe([], 'new-stop-delta', 0)
        if len(result['cases']) != 3 or any(not row['ownedReaped'] for row in result['cases']): raise RuntimeError('Owned stop case mismatch')
        receipt['newCases'] = result['cases']; receipt['actualGateStopScheduler'] = result['actualGateStopScheduler']
    except Exception as error: receipt['firstFailure'] = str(error); raise
    finally: save()
    print(json.dumps({'receipt': str(output / 'receipt.json'), 'newCases': len(receipt['newCases']), 'actualNE': 'NOT_RUN'}))

if __name__ == '__main__': main()
