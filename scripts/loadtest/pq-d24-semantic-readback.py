"""Independent readback of the selected d24 Linux semantic original; never launches nodes.

Binary/archive bytes were private to CI. Their producer hashes are retained, not
represented as independently rehashed binaries. Source inventories are checked
against both complete immutable Git trees, including the explicit caller overlay.
"""
import argparse
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('semantic_trace', Path(__file__).with_name('pq-finalize-trace-readback.py'))
trace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trace)
require = trace.require
sha = trace.sha
CONTROLLER = '3bd9e82ac1761246a699efeff77a34feaa77138f'
AFTER = 'd24ad7e422583906d9823789b049ef2251a09e2c'
BEFORE = 'd6ff40c8e2603d2ef4086fcca6bafc276fd710b1'
BASE = 'f27e07df6dd96114135aceace20a9413bba94649'
ZIP_SHA = '58cd27e15fc6e36c83ce19405b38acbaa965e15a3433e0277873ce8d976ab2c5'
TRACE_SHA = '11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6'
ROOTS = ('go.mod', 'go.sum', 'cmd', 'internal', 'third_party/cometbft')
COMMANDS = ('go-version', 'fetch-original-source-objects', 'prepare-fixed-two-source-trees',
            'before-build', 'before-buildinfo', 'before-replay', 'after-build', 'after-buildinfo', 'after-replay')


def selected(path):
    p = PurePosixPath(path)
    require(not p.is_absolute() and '..' not in p.parts and str(p) == path, 'unsafe inventory path')
    return any(path == root or path.startswith(root + '/') for root in ROOTS)


def inventory(rows):
    require(type(rows) is list and 0 < len(rows) <= 20000, 'bounded source inventory required')
    result = {}
    for row in rows:
        path = row['path']
        require(selected(path) and path not in result, 'duplicate or out-of-scope source path')
        require(type(row['bytes']) is int and 0 <= row['bytes'] <= 16 << 20, 'source size bound')
        trace.digest(row['sha256'])
        result[path] = {k: row[k] for k in ('path', 'bytes', 'sha256')}
    require(sum(r['bytes'] for r in result.values()) <= 256 << 20, 'source total bound')
    return result


def read_zip(path):
    raw = trace.io.read_original(Path(path), 8 << 20)
    require(len(raw) == 6663972 and sha(raw) == ZIP_SHA, 'selected original artifact size/SHA differs')
    files = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        require(len(z.infolist()) <= 100 and sum(i.file_size for i in z.infolist()) <= 64 << 20, 'artifact bounds')
        for member in z.infolist():
            p = PurePosixPath(member.filename)
            require(not p.is_absolute() and '..' not in p.parts and str(p) == member.filename.rstrip('/'), 'unsafe artifact member')
            require((member.external_attr >> 16) & 0o170000 != 0o120000, 'artifact symlink refused')
            if member.is_dir():
                continue
            require(member.filename not in files, 'duplicate artifact member')
            files[member.filename] = z.read(member)  # Includes CRC verification.
    return files


def git_inventory(repo, revision):
    def git(*args, **kw):
        return subprocess.run(['git', '-C', str(repo), *args], check=True, stdout=subprocess.PIPE, **kw).stdout
    expected_tree = BEFORE if revision == BEFORE else 'a28f61f83be9a6e11d0121ea0f40f9bdd3de3b59'
    require(revision in (BEFORE, AFTER), 'unselected source revision')
    require(git('rev-parse', revision + '^{tree}').strip().decode() == expected_tree, 'selected Git tree differs')
    entries = []
    for entry in git('ls-tree', '-rz', revision, '--', *ROOTS).split(b'\0'):
        if not entry:
            continue
        header, name = entry.split(b'\t', 1)
        mode, kind, blob = header.split()
        require(kind == b'blob' and mode in (b'100644', b'100755'), 'source must be regular Git blobs')
        entries.append((name.decode(), blob))
    require(0 < len(entries) <= 20000, 'Git source denominator bound')
    data = git('cat-file', '--batch', input=b''.join(blob + b'\n' for _, blob in entries))
    stream = io.BytesIO(data)
    rows = []
    for name, blob in entries:
        actual, kind, size = stream.readline().split()
        require(actual == blob and kind == b'blob' and int(size) <= 16 << 20, 'Git blob binding differs')
        body = stream.read(int(size))
        require(len(body) == int(size) and stream.read(1) == b'\n', 'truncated Git blob')
        rows.append(dict(path=name, bytes=len(body), sha256=sha(body)))
    require(not stream.read(), 'extra Git blob data')
    return inventory(rows)


def stage_times(result):
    commands, processes = result['actualCommands'], result['processes']
    require([r['name'] for r in commands] == list(COMMANDS), 'complete ordered original commands required')
    require([r['name'] for r in processes] == list(COMMANDS), 'complete ordered original process exits required')
    identities, times = set(), {}
    for command, process in zip(commands, processes):
        require(process['command'] == command['argv'], 'actual process argv differs')
        identity = (process['pid'], process['startTicks'])
        require(identity not in identities, 'reused original process identity')
        identities.add(identity)
        require(process['exited'] is True and type(process['rawReturnCode']) is int and process['rawReturnCode'] == 0
                and type(process['exitCode']) is int and process['exitCode'] == 0 and process['signal'] is None, 'nonzero/unfinished original stage')
        ns = process['observedLaunchToExitNs']
        require(type(ns) is int and ns > 0, 'actual parent launch-to-exit duration required')
        times[command['name']] = ns / 1e9
    return times


def inspect(files, source_before, source_after, fixture):
    result = trace.io.strict(files['SEMANTIC-RESULT.json'])
    require(result['version'] == 'YNX-FINALIZE-D24-SEMANTIC-CI/v1' and result['profile'] == 'finalize-d24-vs-f27', 'selected semantic schema/profile differs')
    for field, expected in [('controllerCommit', CONTROLLER), ('afterCommit', AFTER), ('beforeProductionBase', BASE),
                            ('beforeComposedTree', BEFORE), ('traceSHA256', TRACE_SHA), ('buildTarget', 'linux/amd64')]:
        require(result[field] == expected, 'selected semantic identity differs: ' + field)
    require(result['firstCause'] is None and result['cleanupComplete'] is True and result['semanticQualified'] is True, 'semantic failure/cleanup incomplete')
    require(all(result[k] is False for k in ('throughputMeasured', 'nodeStarted', 'liveNetworkPairQualified', 'reusedDarwinBinary')), 'semantic scope expanded')
    caps = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30, newBytes=8 << 30,
                initialMemoryBytes=6 << 30, initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2, processes=16)
    require(result['caps'] == caps and 0 < result['elapsedSeconds'] <= 900
            and 0 < result['peakRSSBytes'] <= caps['rssBytes'] and 0 < result['peakNewBytes'] <= caps['newBytes'], 'original resource cap exceeded/changed')
    require(result['actualMachine']['machine'] == 'x86_64' and result['actualMachine']['actualAffinity'] == [0, 1], 'actual Linux affinity differs')
    require(result['executionEnvironment'] == dict(CGO_ENABLED='0', GOMAXPROCS='2', GOMEMLIMIT='1024MiB', GOGC='75', GOTOOLCHAIN='local'), 'paired environment differs')
    require(result['toolsCommit'] == 'd0e0889afb7f171ce568c07ea0d6a7e9206083f2' and result['toolsTree'] == '64bee8a254880c700d23a1b1158367053d61fa4a', 'qualified original tools differ')
    require(result['beforeForkTree'] == '54e88e6aba735eaceeb2d00bb40731248c673bd7' and result['afterForkTree'] == '5a128880d14bfc73de4334cba23218859ad3473c', 'fixed original fork pair differs')
    times = stage_times(result)
    source = trace.io.strict(files['SOURCE.json'])
    require(source['beforeTree'] == BEFORE and source['afterCommit'] == AFTER and source['afterTree'] == 'a28f61f83be9a6e11d0121ea0f40f9bdd3de3b59', 'source selection differs')
    require(source['beforeForkTree'] == result['beforeForkTree'] and source['afterForkTree'] == result['afterForkTree'], 'original source/fork receipts differ')
    require(source['sameFourTraceBlobs'] is True and source['sameFiveCallerBlobs'] is False and source['afterMainOverwritten'] is False, 'caller overlay scope differs')
    require(files['go-version.log'].strip() == b'go version go1.26.10 linux/amd64', 'actual toolchain differs')
    original = trace.read_bundle(Path(fixture), TRACE_SHA, 'trace')
    material_raw = files['FIXTURE-MATERIALIZATION.json']
    require(result['fixtureMaterialization'] == dict(bytes=len(material_raw), sha256=sha(material_raw)), 'private fixture receipt pin differs')
    material = trace.io.strict(material_raw)
    require(material['privateDirectoryMode'] == '0700' and material['privateFileMode'] == '0600'
            and material['originalBytesUnchanged'] is True and material['normalizationApplied'] is False
            and material['traceSHA256'] == TRACE_SHA, 'private immutable fixture scope differs')
    require(sorted(material['files'], key=lambda r: r['name']) == sorted(original['files'], key=lambda r: r['name']), 'all nine immutable input pins required')
    commands = {r['name']: r for r in result['actualCommands']}
    for arm, expected in [('before', source_before), ('after', source_after)]:
        raw = files[arm + '-source-inventory.json']
        ref = source['arms'][arm]
        require(ref['inventory'] == dict(bytes=len(raw), sha256=sha(raw)), 'CI source inventory receipt differs')
        require(inventory(trace.io.strict(raw)) == expected, 'complete immutable source inventory differs: ' + arm)
        require(ref['files'] == len(expected) and ref['bytes'] == sum(r['bytes'] for r in expected.values()), 'source denominator differs')
        build, replay = commands[arm + '-build'], commands[arm + '-replay']
        binary = build['argv'][-2]
        private_root = PurePosixPath(binary).parent.parent
        require(build['cwd'] == replay['cwd'] == commands[arm + '-buildinfo']['cwd'] == str(private_root / arm), 'normal build/replay source directory differs')
        require(material['privateDirectory'] == str(private_root / 'trace'), 'replay input differs from private original')
        require(build['argv'] == ['go', 'build', '-mod=readonly', '-trimpath', '-buildvcs=false', '-p', '1', '-o', binary, './cmd/ynx-consensus-pq-lab'], 'normal binary build differs')
        require(commands[arm + '-buildinfo']['argv'] == ['go', 'version', '-m', binary], 'normal BuildInfo command differs')
        require(replay['argv'] == [binary, 'finalize-trace', 'replay', '--synthetic', '--trace', str(PurePosixPath(binary).parent.parent / 'trace'), '--trace-sha256', TRACE_SHA, '--output', str(PurePosixPath(binary).parent.parent.parent / 'public' / (arm + '-replay'))], 'normal replay command differs')
        info = files[arm + '-buildinfo.log']
        require(info.startswith((binary + ': go1.26.10\n').encode()) and all(s in info for s in (b'\tbuild\tCGO_ENABLED=0', b'\tbuild\tGOARCH=amd64', b'\tbuild\tGOOS=linux')) and b'\tvcs.' not in info, 'actual binary BuildInfo differs')
        for name, expected_raw in [('replay.jsonl', original['_records']), ('final-state.json', original['_final'])]:
            require(files[arm + '-replay/' + name] == expected_raw, 'complete original replay bytes differ: ' + arm + '/' + name)
        for name in ('replay.jsonl', 'final-state.json', 'result.json', 'intent.json'):
            require(files['before-replay/' + name] == files['after-replay/' + name], 'two complete replay outputs differ')
        require(files[arm + '-replay/result.json'].strip() == files[arm + '-replay.log'].strip(), 'durable replay receipt/stdout differs')
        require(sha(files[arm + '-replay/result.json']) == 'e787b349efac338c7358353b86e937a119c961d556aec165e8c964ea3cc8ed88'
                and sha(files[arm + '-replay/intent.json']) == '32d388da6f4a52e854cea31ee69d346d75a09c2a0f33e4ccf51e3d015b3e81f7', 'original complete replay receipt/intent differs')
    return dict(schema='YNX-PERF-D24-LINUX-SEMANTIC-ORIGINAL-READBACK/v1', artifactID=13570369292, runID=42363486390,
                artifactSHA256=ZIP_SHA, controllerCommit=CONTROLLER, afterCommit=AFTER, toolsCommit=result['toolsCommit'], toolsTree=result['toolsTree'], beforeForkTree=result['beforeForkTree'], afterForkTree=result['afterForkTree'],
                limitedOriginalTrajectoryQualified=True, heights=original['retainedHeights'],
                stageParentWallSeconds=times, originalElapsedSeconds=result['elapsedSeconds'],
                timingMeaning='Parent observed launch-to-exit wall time; sequential builds share cache. Not paired performance improvement or business latency.',
                peakRSSBytes=result['peakRSSBytes'], peakNewBytes=result['peakNewBytes'],
                sourceInventoryFiles=dict(before=len(source_before), after=len(source_after)),
                binaryHashesProducerReported=result['binaries'], binaryBytesIndependentlyRehashed=False,
                intermediateFullStateBytesIndependentlyReconstructed=False, liveNetworkPairQualified=False,
                effectiveBusinessTPS=None, inclusionLatency=None, finalConfirmationLatency=None,
                runtimePressureAuthorized=False, cleanupComplete=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--zip', required=True)
    p.add_argument('--source-repo', required=True)
    p.add_argument('--trace', required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    files = read_zip(a.zip)
    report = inspect(files, git_inventory(a.source_repo, BEFORE), git_inventory(a.source_repo, AFTER), a.trace)
    with Path(a.output).open('x') as out:
        json.dump(report, out, sort_keys=True, indent=2)
        out.write('\n')


if __name__ == '__main__':
    main()
