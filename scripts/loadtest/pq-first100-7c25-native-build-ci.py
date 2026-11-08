#!/usr/bin/env python3
"""Normal CI: compile the original F2 private CGO view; never run its binaries."""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

F2 = '91caff35a141889a4a8de6b2f4ba533c69b64550'
F2_TREE = '4bece71b095b6983e0f22ec63537ef4a7bf6c47b'
SOURCE = '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
TAG = 'ynx_live_wire_observation'
BINS = ('ynx-consensus-pq-lab', 'ynx-comet', 'ynx-consensus-proof-verify')


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def pin(path):
    raw = path.read_bytes()
    return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def write(path, value):
    with path.open('x') as out:
        json.dump(value, out, sort_keys=True, indent=2)
        out.write('\n')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def capture_context():
    require(sys.platform == 'linux' and os.environ.get('GITHUB_JOB') == 'first100-7c25-native-build'
            and os.environ.get('CGO_ENABLED') == '1', 'capture belongs only to original hosted CGO build job')


def capture(work, name, command):
    """A Window-owned child preserves separate streams and the actual Go exit."""
    capture_context()
    require(command and command[0] in ('go', sys.executable), 'only original Go/prepare helper commands')
    public = work / 'public'
    started = time.monotonic_ns()
    with (public / (name + '.stdout')).open('xb') as out, (public / (name + '.stderr')).open('xb') as err:
        result = subprocess.run(command, stdout=out, stderr=err, check=False)
    write(public / (name + '.result.json'), dict(argv=command, cwd=str(Path.cwd()),
        returnCode=result.returncode, elapsedNs=time.monotonic_ns() - started,
        stdout=pin(public / (name + '.stdout')), stderr=pin(public / (name + '.stderr'))))
    return result.returncode


def execute(source, tools, work):
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    controller = Path(__file__).resolve().parents[2]
    require(controller == workspace / 'controller' and source == workspace / 'source'
            and tools == workspace / 'tools', 'only original three checkout locations allowed')
    require(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('GITHUB_EVENT_NAME') == 'push'
            and os.environ.get('GITHUB_JOB') == 'first100-7c25-native-build'
            and os.environ.get('GITHUB_REF') == 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
            and os.environ.get('CGO_ENABLED') == '1', 'exact first-attempt hosted CGO build job required')
    entry = module('original_c2_adapter', controller / 'scripts/loadtest/pq-first100-7c25-ci.py')
    require(entry.TOOLS == F2 and entry.TOOLS_TREE == F2_TREE and entry.GO_SOURCE == SOURCE,
            'only original F2/C2 and frozen7c source allowed')
    entry.verify_tools(tools)
    entry.checked_source(source, entry.GO_SOURCE, entry.GO_TREE)
    for path, expected in entry.SOURCE_PINS.items():
        entry.pinned_bytes(source / path, expected)
    require(work == Path(os.environ['RUNNER_TEMP']).resolve(strict=True) / 'pq-first100-7c25-native-build',
            'fresh fixed private build operation required')
    work.mkdir(mode=0o700)
    (work / 'public').mkdir(mode=0o700)
    (work / '.private').mkdir(mode=0o700)
    public = work / 'public'
    tools_ci = entry.read_tools_ci()
    write(public / 'runtime-tools-ci.json', tools_ci)
    os.environ.pop('GH_TOKEN', None)
    os.environ.pop('GITHUB_TOKEN', None)
    driver = entry.pinned_module('original_f2_driver', tools / 'scripts/loadtest/pq-independent-load.py',
                                entry.TOOL_PINS['pq-independent-load.py'])
    entry.validate_driver(driver)
    lab = driver.lab
    rows, _ = lab.guard.proc_inventory()
    admission = dict(availableMemoryBytes=lab.guard.memory_available(),
        freeDiskBytes=shutil.disk_usage(work).free, conflictingHeavyProcesses=lab.heavy_processes(rows),
        caps=lab.CAPS, ownedPIDLimit=lab.guard.CAPS['ownedProcesses'])
    write(public / 'fresh-resource-admission.json', admission)
    lab.admit(admission['availableMemoryBytes'], admission['freeDiskBytes'], admission['conflictingHeavyProcesses'])
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'original Linux subreaper required')
    go = Path(shutil.which('go')).resolve(strict=True)
    w = lab.Window(source, work, additional_storage=(workspace, go.parent.parent))
    result = dict(schema='YNX-FIRST100-SAME-VIEW-CGO-BUILD/v1', controller=os.environ['GITHUB_SHA'],
        tools=F2, toolsTree=F2_TREE, source=SOURCE, cgoEnabled='1', binaryExecutionRequested=False,
        nodeStarted=False, keysCreated=False, loadExecuted=False, pressureAuthorized=False,
        qualified=False, firstCause=None, cleanupComplete=False, binaries={})

    def run(name, command):
        proc = w.launch(name, [sys.executable, '-I', '-B', str(Path(__file__).resolve()),
                             '--capture', str(work), name, *command])
        while proc.poll() is None:
            w.sample()
            for suffix in ('.stdout', '.stderr'):
                output = public / (name + suffix)
                require(not output.exists() or output.stat().st_size <= lab.CAPS['logBytes'], 'original4MiB stream cap')
            time.sleep(.2)
        code = w.wait(proc, allow_failure=True)
        require(code == 0, 'actual command failed: ' + name + ' exit=' + str(code) + '; retain original streams')
        record = json.loads((public / (name + '.result.json')).read_bytes())
        require(record['returnCode'] == 0, 'original child command failed')
        return (public / (name + '.stdout')).read_bytes()

    try:
        view = work / '.private/fresh-normal-cgo-view'
        prepared = json.loads(run('prepare-normal-live-source', [sys.executable, '-I', '-B',
            str(tools / 'scripts/loadtest/pq-normal-live-reader.py'), '--prepare-source', str(source),
            '--destination', str(view)]))
        require(prepared['buildSource'] == str(view / 'source') and prepared['carrierEnabled'] is False,
                'original actual private build source required')
        write(public / 'prepare-normal-live-source.json', prepared)
        for name in ('SOURCE-SELECTION.json', 'SOURCE-NATIVE-DEPENDENCIES.json'):
            with (public / name).open('xb') as out:
                out.write((view / name).read_bytes())
        dependencies = prepared['originalNativeSourceDependencies']['sourceDependencies']
        require(dependencies['fileCount'] == 11 and dependencies['sourceBytes'] == 35651,
                'all original eleven CGO source leaves required')
        w.source = view / 'source'
        before = json.loads(run('go-env-before', ['go', 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'CC', 'CXX']))
        require(before['GOVERSION'] == 'go1.26.10' and before['GOOS'] == 'linux'
                and before['GOARCH'] == 'amd64' and before['CGO_ENABLED'] == '1'
                and before['CC'] and before['CXX'], 'actual pinned Linux CGO toolchain required')
        package = json.loads(run('sourceparentprofile-go-list', ['go', 'list', '-mod=readonly', '-json',
            'github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/sourceparentprofile']))
        require(package['Dir'] == str(w.source / 'packages/wallet-auth/go/sourceparentprofile')
                and package['CgoFiles'] == ['profile.go']
                and sorted(package['CXXFiles']) == ['canonical.cpp', 'inventory.cpp', 'original.cpp'],
                'original real private CGO/CXX source selection required')
        for name in BINS:
            binary = work / '.private/bin' / name
            argv = ['go', 'build', '-mod=readonly', '-p', '1', '-trimpath', '-buildvcs=false']
            if name == 'ynx-comet':
                argv += ['-tags', TAG]
            run('build-' + name, argv + ['-o', str(binary), './cmd/' + name])
            info = run('buildinfo-' + name, ['go', 'version', '-m', str(binary)]).decode()
            require('go1.26.10' in info and 'CGO_ENABLED=1' in info and 'GOOS=linux' in info
                    and 'GOARCH=amd64' in info and ((TAG in info) == (name == 'ynx-comet')),
                    'actual binary CGO/tag BuildInfo differs')
            result['binaries'][name] = dict(**pin(binary), buildArgv=argv + ['-o', str(binary), './cmd/' + name],
                buildCwd=str(w.source), buildInfo=pin(public / ('buildinfo-' + name + '.stdout')),
                sourceSelection=pin(public / 'SOURCE-SELECTION.json'),
                nativeDependencies=pin(public / 'SOURCE-NATIVE-DEPENDENCIES.json'))
        after = json.loads(run('go-env-after', ['go', 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'CC', 'CXX']))
        require(before == after, 'toolchain changed during actual build')
        for path, expected in dependencies['moduleDescriptorSHA256'].items():
            require(pin(w.source / path)['sha256'] == expected, 'original module descriptor changed')
        entry.checked_source(source, entry.GO_SOURCE, entry.GO_TREE)
        result['qualified'] = True
    except BaseException as error:
        result['firstCause'] = str(error)
        raise
    finally:
        try:
            result['cleanupComplete'] = w.stop()
        finally:
            result.update(processes=w.process_receipt(), peakRSSBytes=w.peak_rss,
                peakNewBytes=w.peak_bytes, elapsedSeconds=time.monotonic() - w.started,
                resourceSamples=w.samples, resourceGuardStages=w.sample_stage_report())
            if not result['cleanupComplete']:
                result['qualified'] = False
            write(public / 'BUILD-RESULT.json', result)
    require(result['qualified'] and result['cleanupComplete'], 'actual build/cleanup incomplete')


def main():
    if len(sys.argv) >= 5 and sys.argv[1] == '--capture':
        return capture(Path(sys.argv[2]), sys.argv[3], sys.argv[4:])
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--tools', type=Path, required=True)
    parser.add_argument('--operation', type=Path, required=True)
    args = parser.parse_args()
    execute(args.source.resolve(strict=True), args.tools.resolve(strict=True), args.operation)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
