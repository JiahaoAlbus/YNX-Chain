#!/usr/bin/env python3
"""Prepare the exact Native bootstrap component cohort; never compile or launch.

The caller supplies its genuine built Core static product. CI's existing bounded
runner executes recipe.compileArgv then recipe.testArgv. No stub SDK/authority.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-products', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    tests = Path(__file__).resolve().parent
    browser = tests.parents[2]
    native = browser / 'native/Sources/YNXBrowserNative'
    runtime = native / 'NymPublicSearchRuntime.swift'
    protected = native / 'NymProtectedRouteProvider.swift'
    test = tests / 'NymPublicBootstrapControls.swift'
    core = args.core_products.resolve(strict=True)
    archive, module = core/'libYNXBrowserCore.a', core/'YNXBrowserCore.swiftmodule'
    if not archive.is_file() or not module.is_dir():
        parser.error('genuine built Core static archive and module directory required')
    output = args.output.absolute()
    output.mkdir(mode=0o700)  # Fresh output required; preserve every old cohort.
    inputs = output/'input'; inputs.mkdir(mode=0o700)
    copied = inputs/'Core'; copied.mkdir(mode=0o700)
    shutil.copy2(archive, copied/archive.name)
    shutil.copytree(module, copied/module.name)
    real_core = [archive] + sorted(path for path in module.rglob('*') if path.is_file())
    core_pins = {}
    for path in real_core:
        destination = copied/path.relative_to(core)
        before = digest(path)
        if before != digest(destination) or before != digest(path):
            raise RuntimeError('genuine-Core-snapshot-drift')
        core_pins[str(path)] = before
    texts = {path: path.read_bytes() for path in [runtime, protected, test]}
    runtime_text = texts[runtime].decode()
    boundary = '@MainActor final class NymPublicOwnedProcess'
    if runtime_text.count(boundary) != 1:
        raise RuntimeError('actual-runtime-component-boundary')
    protected_text = texts[protected].decode()
    marker_start = 'final class NymObservedStartupLine {'
    marker_end = '/// Restricted background role'
    if protected_text.count(marker_start) != 1 or protected_text.count(marker_end) != 1:
        raise RuntimeError('actual-marker-component-boundary')
    marker = marker_start + protected_text.split(marker_start, 1)[1].split(marker_end, 1)[0]
    components = inputs/'ActualNativeComponents.swift'
    components.write_text(runtime_text.split(boundary, 1)[0] + '\n' + marker + '\n#endif\n')
    shutil.copy2(test, inputs/test.name)
    compiler = subprocess.check_output(['/usr/bin/xcrun','--find','swiftc'], text=True, timeout=5).strip()
    sdk = subprocess.check_output(['/usr/bin/xcrun','--sdk','macosx','--show-sdk-path'], text=True, timeout=5).strip()
    architecture = subprocess.check_output(['/usr/bin/uname','-m'], text=True, timeout=5).strip()
    if architecture not in ['arm64','x86_64']:
        raise RuntimeError('unsupported-architecture')
    executable = output/'native-public-bootstrap-controls'
    recipe = {
        'schema': 'YNX_NYM_PUBLIC_BOOTSTRAP_COMPONENT_RECIPE_V1',
        'compileArgv': [compiler,'-swift-version','6','-DYNX_PRIVACY_ACCEPTANCE','-sdk',sdk,
            '-target',architecture+'-apple-macosx14.0','-module-cache-path',str(output/'module-cache'),
            '-I',str(copied),'-L',str(copied),'-lYNXBrowserCore',str(components),str(inputs/test.name),'-o',str(executable)],
        'testArgv': [str(executable)],
        'sourcePins': {str(path): hashlib.sha256(data).hexdigest() for path,data in texts.items()},
        'genuineCorePins': core_pins,
        'snapshotPins': {str(path): digest(path) for path in [components,inputs/test.name]},
        'compilerSHA256': digest(Path(compiler)),
        'expectedStdoutPrefix': 'PASS NativePublicBootstrap',
        'runnerContract': 'Existing CI bounded owner: compile<=30s, controls<=5s, whole<=60s including15s cleanup. Per-output logs bounded; original Popen/group wait/reap. Local macOS TMPDIR must be ASCII path or ASCII symlink to owned output tmp; do not change global environment. Local original floors/resource guards still apply.',
        'boundary': 'Only exact Native bootstrap configuration/output/marker components with genuine Core. No full Native Runtime typecheck, SDK/client/process/socket/GUI/network/keys/authority.'
    }
    for path,data in texts.items():
        if path.read_bytes() != data:
            raise RuntimeError('source-snapshot-drift')
    target = output/'recipe.json'
    target.write_text(json.dumps(recipe, indent=2)+'\n')
    print(json.dumps({'recipe': str(target),'SHA256': digest(target)}))

if __name__ == '__main__':
    main()
