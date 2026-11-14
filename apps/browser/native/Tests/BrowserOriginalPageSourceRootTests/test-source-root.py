#!/usr/bin/env python3
"""New real original-Auth Root0 bridge delta; reuses exact pinned original objects."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
IPC = HERE.parents[1] / 'IPC'
R3_HANDOFF_SHA256 = '5a6a5ab748786b1f11346156a2cd8d729d45a85ad034f7cc7dbb7d463d24f6ae'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--auth-handoff', type=Path, required=True, help='Exact original frozen-r3/HANDOFF.json')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists(): parser.error('Fresh absolute external output required')
    if not args.auth_handoff.is_absolute() or sha(args.auth_handoff) != R3_HANDOFF_SHA256: parser.error('Exact frozen original Auth r3 handoff required')
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        parser.error('This original frozen object cohort is macOS arm64 only; do not relabel it x86_64')
    args.output.mkdir(mode=0o700)
    output = args.output
    alias = Path(tempfile.mkdtemp(prefix='ynx-original-root-', dir='/private/tmp'))
    alias.rmdir(); alias.symlink_to(output, target_is_directory=True)
    handoff = json.loads(args.auth_handoff.read_text())
    for item in handoff['production'] + [handoff['sourcefiles']]:
        path = Path(item['path'])
        if sha(path) != item['sha256'] or path.stat().st_size != item['bytes']: raise RuntimeError('Frozen original source drift: ' + str(path))
    original_receipt = next(row for row in handoff['evidence'] if '/root-zero-' in row['path'] and row['path'].endswith('/RESULT.json'))
    original_path = Path(original_receipt['path'])
    if sha(original_path) != original_receipt['sha256']: raise RuntimeError('Original root object receipt drift')
    original = json.loads(original_path.read_text())
    link = next(row for row in original['steps'] if row['name'] == 'normal-strong-link-no-dynamic-lookup')
    if link['status'] != 0 or 'dynamic_lookup' in link['args']: raise RuntimeError('Strong actual original link required')
    originals = {item['path']: item for item in original['inputs']}
    output_index = link['args'].index('-o') + 1
    original_output = link['args'][output_index]
    for item in originals.values():
        path = Path(item['path'])
        if sha(path) != item['sha256'] or path.stat().st_size != item['bytes']: raise RuntimeError('Original object/input drift: ' + str(path))
    sources = [IPC / 'BrowserOriginalPageSourceRoot.h', IPC / 'BrowserOriginalPageSourceRoot.mm', HERE / 'Probe.mm', HERE / 'InteropProbe.swift', Path(__file__).resolve()]
    inputs = {str(path): sha(path) for path in sources}
    for path in sources:
        (output / 'source').mkdir(exist_ok=True)
        shutil.copy2(path, output / 'source' / path.name)
    sdk = subprocess.check_output(['xcodebuild', '-version', '-sdk', 'macosx', 'Path'], text=True).strip()
    receipt = {'schema': 'P05_REAL_ORIGINAL_AUTH_ROOT_BRIDGE_BUILD_V1', 'authHandoff': str(args.auth_handoff),
               'authHandoffSHA256': R3_HANDOFF_SHA256, 'originalObjectReceipt': str(original_path),
               'originalObjectReceiptSHA256': original_receipt['sha256'], 'sourceInputs': inputs,
               'reusedOriginalInputs': originals, 'commands': [], 'sdk': sdk, 'SourceAdmission': False,
               'RootAdmission': False, 'old11Root0Rerun': False, 'oldEndpoint6OrMount12Rerun': False, 'alias': str(alias)}
    def save(): (output / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    def run(command, label, timeout=60):
        receipt['commands'].append(command); save()
        try: result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            receipt[label + 'TimedOut'] = True
            (output / (label + '.stdout')).write_bytes(error.stdout or b'')
            (output / (label + '.stderr')).write_bytes(error.stderr or b'')
            save(); raise
        (output / (label + '.stdout')).write_text(result.stdout)
        (output / (label + '.stderr')).write_text(result.stderr)
        receipt[label + 'Exit'] = result.returncode; save()
        result.check_returncode()
    try:
        r3 = args.auth_handoff.parent / 'source'
        # Dependencies are those actually pinned by the original r3 handoff.
        component_handoff = Path(next(item['path'] for item in handoff['dependencies'] if '/component-r1/HANDOFF.json' in item['path']))
        request_handoff = Path(next(item['path'] for item in handoff['dependencies'] if '/frozen-r2/HANDOFF.json' in item['path']))
        compile_command = ['xcrun', 'clang++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-fobjc-arc',
                           '-target', 'arm64-apple-macosx14.0', '-isysroot', sdk,
                           '-I', str(r3), '-I', str(request_handoff.parent / 'source'), '-I', str(component_handoff.parent / 'source'),
                           '-I', str(alias / 'source'), '-c']
        run(compile_command + [str(alias / 'source/BrowserOriginalPageSourceRoot.mm'), '-o', str(alias / 'bridge.o')], 'compile-bridge')
        run(compile_command + [str(alias / 'source/Probe.mm'), '-o', str(alias / 'probe.o')], 'compile-probe')
        run(['xcrun', 'swiftc', '-swift-version', '6', '-typecheck', '-sdk', sdk, '-target', 'arm64-apple-macosx14.0',
             '-module-cache-path', str(output.parent / 'C-module-cache'), '-import-objc-header',
             str(alias / 'source/BrowserOriginalPageSourceRoot.h'), str(alias / 'source/InteropProbe.swift')], 'swift-interop')
        arguments = list(link['args'])
        arguments[output_index] = str(alias / 'RootBridgeProbe')
        actual_main = str(original_path.parent / 'main.o')
        if arguments.count(actual_main) != 1: raise RuntimeError('Expected sole original test main replacement')
        arguments[arguments.index(actual_main)] = str(alias / 'probe.o')
        arguments.append(str(alias / 'bridge.o'))
        run([link['cmd']] + arguments, 'link-actual-original-component')
        receipt['sourceDrift'] = inputs != {str(path): sha(path) for path in sources}
        if receipt['sourceDrift']: raise RuntimeError('New bridge source drift')
        # No key/profile/network is reached: actual production-reviewed row list is
        # empty, and this new probe calls the actual original Root0 constructor.
        process = subprocess.Popen([str(alias / 'RootBridgeProbe')], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        receipt['ownedPID'] = process.pid; save()
        try: stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            receipt['timedOut'] = True; process.kill(); stdout, stderr = process.communicate(timeout=5)
        (output / 'probe-result.json').write_text(stdout)
        (output / 'probe.stderr').write_text(stderr)
        receipt.update(runExit=process.returncode, ownedReaped=process.returncode is not None)
        if process.returncode or receipt.get('timedOut'): raise RuntimeError('New bridge actual Root0 probe failed')
        probe = json.loads(stdout)
        if probe['checks'] != 10 or probe['SourceAdmission'] or probe['RootAdmission']: raise RuntimeError('Incorrect bridge result')
        receipt['newChecks'] = probe['checks']
    except Exception as error:
        receipt['firstFailure'] = str(error); raise
    finally: save()
    print(json.dumps({'receipt': str(output / 'receipt.json'), 'newBridgeChecks': 10, 'SourceAdmission': False}))

if __name__ == '__main__': main()
