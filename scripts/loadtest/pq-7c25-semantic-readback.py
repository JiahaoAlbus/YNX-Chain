"""Independent readback of the selected7c25 Linux semantic original; never launches nodes.

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
AFTER_TREE = '8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a'
AFTER = '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
BEFORE = 'd6ff40c8e2603d2ef4086fcca6bafc276fd710b1'
BASE = 'f27e07df6dd96114135aceace20a9413bba94649'
TRACE_SHA = '11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6'
BEFORE_EXECUTION_TREE = '0397f75ec55db6a89b46e2e6d051ce960c36827d'
AFTER_EXECUTION_TREE = '96d91aed6a015f7243bb18b5d7a375bddf51483a'
EVIDENCE_OVERLAY = [{'path': 'internal/consensus/pq_lab_finalize_trace.go', 'mode': '100644', 'bytes': 39737, 'sha256': '0aa9b4e00a6c9f249ddc57063a3e9e37b4325f41a6014f0da3e571efb2eed61e', 'gitBlob': '72e4d368a9fc225a621e24f65ab9a281d9282645'}, {'path': 'internal/consensus/pq_lab_finalize_trace_test.go', 'mode': '100644', 'bytes': 23962, 'sha256': 'ff8908b58ee3a77900429bd3ca5d417564e3bbfcd87f969c8bcddf5f1f0923b5', 'gitBlob': 'a71ec1d82e1bb9bda22544dad4fa247b62ae80b3'}]

ROOTS = ('go.mod', 'go.sum', 'cmd', 'internal', 'third_party/cometbft')
COMMANDS = ('go-version', 'fetch-original-source-objects', 'prepare-fixed-two-source-trees',
            'before-build', 'before-buildinfo', 'before-replay', 'after-build', 'after-buildinfo', 'after-height-evidence-tests', 'after-replay')


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


def read_zip(path, expected_bytes, expected_sha):
    raw = trace.io.read_original(Path(path), 32 << 20)
    trace.digest(expected_sha)
    require(type(expected_bytes) is int and 0 < expected_bytes <= 32 << 20, 'artifact byte bound')
    require(len(raw) == expected_bytes and sha(raw) == expected_sha, 'selected original artifact size/SHA differs')
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
    require(revision in (BEFORE_EXECUTION_TREE, AFTER_EXECUTION_TREE), 'unselected evidence execution tree')
    require(git('rev-parse', revision + '^{tree}').strip().decode() == revision, 'selected execution Git tree differs')
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
        row = dict(path=name, bytes=len(body), sha256=sha(body))
        overlay = next((r for r in EVIDENCE_OVERLAY if r['path'] == name), None)
        require(overlay is None or (row['bytes'],row['sha256']) == (overlay['bytes'],overlay['sha256']), 'exact evidence overlay source bytes differ')
        rows.append(row)
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


def inspect(files, source_before, source_after, fixture, controller, artifact_sha, run_id, job_id):
    result = trace.io.strict(files['SEMANTIC-RESULT.json'])
    require(result['version'] == 'YNX-FINALIZE-7C25-SEMANTIC-CI/v1' and result['profile'] == 'finalize-7c25-vs-f27', 'selected semantic schema/profile differs')
    for field, expected in [('controllerCommit', controller), ('afterCommit', AFTER), ('beforeProductionBase', BASE),
                            ('beforeComposedTree', BEFORE), ('traceSHA256', TRACE_SHA), ('buildTarget', 'linux/amd64')]:
        require(result[field] == expected, 'selected semantic identity differs: ' + field)
    require(result['firstCause'] is None and result['cleanupComplete'] is True and result['semanticQualified'] is True, 'semantic failure/cleanup incomplete')
    require(all(result[k] is False for k in ('throughputMeasured', 'nodeStarted', 'liveNetworkPairQualified', 'reusedDarwinBinary')), 'semantic scope expanded')
    caps = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30, newBytes=8 << 30,
                initialMemoryBytes=6 << 30, initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2, processes=16)
    require(result['caps'] == caps and 0 < result['elapsedSeconds'] <= 900
            and 0 < result['peakRSSBytes'] <= caps['rssBytes'] and 0 < result['peakNewBytes'] <= caps['newBytes'], 'original resource cap exceeded/changed')
    affinity = result['actualMachine']['actualAffinity']
    require(result['actualMachine']['machine'] == 'x86_64' and type(affinity) is list and len(affinity) == 2
            and all(type(v) is int and v >= 0 for v in affinity) and sorted(set(affinity)) == affinity, 'actual Linux two-CPU affinity differs')
    require(result['executionEnvironment'] == dict(CGO_ENABLED='0', GOMAXPROCS='2', GOMEMLIMIT='1024MiB', GOGC='75', GOTOOLCHAIN='local'), 'paired environment differs')
    require(result['toolsCommit'] == '478bf2ee60c19dcbdb67872184f9e1f500511746' and result['toolsTree'] == '3f6457276cdea84467917e763e6e3fb8b42701db', 'qualified original tools differ')
    require(result['beforeForkTree'] == '54e88e6aba735eaceeb2d00bb40731248c673bd7' and result['afterForkTree'] == '5a128880d14bfc73de4334cba23218859ad3473c', 'fixed original fork pair differs')
    times = stage_times(result)
    source = trace.io.strict(files['SOURCE.json'])
    require(source['beforeTree'] == BEFORE and source['afterCommit'] == AFTER and source['afterTree'] == '8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a', 'source selection differs')
    require(source['beforeForkTree'] == result['beforeForkTree'] and source['afterForkTree'] == result['afterForkTree'], 'original source/fork receipts differ')
    require(source['executionTrees'] == dict(before=BEFORE_EXECUTION_TREE, after=AFTER_EXECUTION_TREE)
            and source['commonEvidenceOverlay'] == EVIDENCE_OVERLAY
            and source['evidenceOverlayControllerCommit'] == controller
            and source['evidenceOverlayCarrierPrefix'] == 'scripts/loadtest/testdata/finalize-height-evidence/', 'actual common evidence source binding differs')
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
        binary_pin = result['binaries'][arm]
        trace.digest(binary_pin['sha256'])
        require(type(binary_pin['bytes']) is int and 0 < binary_pin['bytes'] <= 256 << 20, 'bounded actual binary hash required')
        info = files[arm + '-buildinfo.log']
        require(info.startswith((binary + ': go1.26.10\n').encode()) and all(s in info for s in (b'\tbuild\tCGO_ENABLED=0', b'\tbuild\tGOARCH=amd64', b'\tbuild\tGOOS=linux')) and b'\tvcs.' not in info, 'actual binary BuildInfo differs')
        for name, expected_raw in [('replay.jsonl', original['_records']), ('final-state.json', original['_final'])]:
            require(files[arm + '-replay/' + name] == expected_raw, 'complete original replay bytes differ: ' + arm + '/' + name)
        for name in ('replay.jsonl', 'final-state.json', 'result.json', 'intent.json'):
            require(files['before-replay/' + name] == files['after-replay/' + name], 'two complete replay outputs differ')
        require(files[arm + '-replay/result.json'].strip() == files[arm + '-replay.log'].strip(), 'durable replay receipt/stdout differs')
        require(sha(files[arm + '-replay/result.json']) == 'e787b349efac338c7358353b86e937a119c961d556aec165e8c964ea3cc8ed88'
                and sha(files[arm + '-replay/intent.json']) == '32d388da6f4a52e854cea31ee69d346d75a09c2a0f33e4ccf51e3d015b3e81f7', 'original complete replay receipt/intent differs')
    spec = importlib.util.spec_from_file_location('semantic_height_states', Path(__file__).with_name('pq-semantic-height-state.py'))
    height_reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(height_reader)
    arms = [{name[len(arm) + 8:]: raw for name, raw in files.items() if name.startswith(arm + '-replay/')} for arm in ('before', 'after')]
    rows = [trace.io.strict(line) for line in original['_records'].splitlines()]
    height_report = height_reader.compare_height_states(*arms, rows)
    test_raw = files['after-height-evidence-tests.log']
    test_result = height_reader.verify_go_tests(test_raw)
    test_receipt = result['heightEvidenceTests']
    require(test_receipt == dict(originalStream=dict(bytes=len(test_raw), sha256=sha(test_raw)),
                result=test_result, inputEnvironment={'YNX_PUBLIC_REGISTERED_OBSERVER_TRACE': material['privateDirectory']},
                traceSHA256=TRACE_SHA), 'actual height-evidence Go test result/input binding differs')
    test_command = commands['after-height-evidence-tests']
    require(test_command['cwd'] == commands['after-build']['cwd'] and test_command['argv'] ==
            ['go','test','-mod=readonly','-json','-count=1','-p','1','-timeout=90s',
             '-run=^TestPQLabFinalizeTraceHeightEvidencePUBLIC(NineStatesAndCold|ColdRefusals)$','./internal/consensus'],
            'necessary original Linux height-evidence test command/source differs')

    return dict(schema='YNX-PERF-7C25-LINUX-SEMANTIC-ORIGINAL-READBACK/v1', runID=run_id, jobID=job_id,
                artifactSHA256=artifact_sha, controllerCommit=controller, afterCommit=AFTER, toolsCommit=result['toolsCommit'], toolsTree=result['toolsTree'], beforeForkTree=result['beforeForkTree'], afterForkTree=result['afterForkTree'],
                afterTree=AFTER_TREE, traceSHA256=TRACE_SHA, beforeProductionBase=BASE, beforeOriginalCallerTree=BEFORE, beforeExecutionTree=BEFORE_EXECUTION_TREE, afterExecutionTree=AFTER_EXECUTION_TREE,
                commonEvidenceOverlay=EVIDENCE_OVERLAY, perHeightEvidence=height_report, afterSourceGoHeightTests=test_result, completePerHeightTxResultsEqual=True,
                completePerHeightBalanceNonceStateEqual=True, completePerHeightAppHashEqual=True,
                equalityMeaning='Full responses and all per-height raw canonical state bytes compared against fixed original length/SHA/AppHash and between arms; Go executes cold reconstruction, reader does not execute loader.',
                limitedOriginalTrajectoryQualified=True, heights=original['retainedHeights'],
                stageParentWallSeconds=times, originalElapsedSeconds=result['elapsedSeconds'],
                timingMeaning='Parent observed launch-to-exit wall time; sequential builds share cache. Not paired performance improvement or business latency.',
                peakRSSBytes=result['peakRSSBytes'], peakNewBytes=result['peakNewBytes'],
                sourceInventoryFiles=dict(before=len(source_before), after=len(source_after)),
                binaryHashesProducerReported=result['binaries'], binaryBytesIndependentlyRehashed=False,
                intermediateFullStateBytesIndependentlyReconstructed=False, completePerHeightRawStateBytesEqual=True,
                coldReconstructionProducerRecordsVerified=True, liveNetworkPairQualified=False,
                effectiveBusinessTPS=None, inclusionLatency=None, finalConfirmationLatency=None,
                runtimePressureAuthorized=False, cleanupComplete=True)


def validate_ci(run, job, controller, run_id, job_id, failure=False):
    require(len(controller) == 40 and all(c in '0123456789abcdef' for c in controller), 'full controller SHA required')
    require((run.get('id'), run.get('head_sha'), run.get('event'), run.get('run_attempt'))
            == (run_id, controller, 'workflow_dispatch', 1), 'actual semantic controller/run identity differs')
    require(run.get('path') == '.github/workflows/pq-source-compare.yml'
            and run.get('head_branch') == 'codex/ynx-pq-current75-baseline-20261101'
            and run.get('status') == 'completed' and run.get('conclusion') in (('failure', 'cancelled') if failure else ('success',)), 'complete normal semantic CI required')
    for name in ('repository', 'head_repository'):
        require(run.get(name, {}).get('full_name') == 'JiahaoAlbus/YNX-Chain'
                and run[name].get('fork') is False, 'canonical original semantic repository required')
    require((job.get('id'), job.get('run_id'), job.get('head_sha'), job.get('name'))
            == (job_id, run_id, controller, 'finalize-7c25-semantic')
            and job.get('status') == 'completed' and job.get('conclusion') in (('failure', 'cancelled') if failure else ('success',)), 'complete exact semantic job required')


def inspect_failure(files, controller, artifact_sha, run_id, job_id):
    result = trace.io.strict(files['SEMANTIC-RESULT.json'])
    require(result.get('profile') == 'finalize-7c25-vs-f27' and result.get('semanticQualified') is False,
            'actual unqualified semantic failure required')
    # Admission failure has no source execution identity; preserve that narrower scope.
    require(result.get('controllerCommit', controller) == controller and result.get('afterCommit', AFTER) == AFTER,
            'failure source identity differs')
    return dict(schema='YNX-PERF-7C25-SEMANTIC-FAILURE-READBACK/v1', controllerCommit=controller,
                artifactSHA256=artifact_sha, runID=run_id, jobID=job_id,
                firstCause=result.get('firstCause'), cleanupComplete=result.get('cleanupComplete'),
                originalProcessRecords=result.get('processes', []), originalCommands=result.get('actualCommands', []),
                originalElapsedSeconds=result.get('elapsedSeconds'),
                retainedFiles={name: dict(bytes=len(raw),sha256=sha(raw)) for name,raw in sorted(files.items())},
                limitedOriginalTrajectoryQualified=False, semanticQualified=False, runtimePressureAuthorized=False,
                effectiveBusinessTPS=None, inclusionLatency=None, finalConfirmationLatency=None)


def main():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--zip', required=True)
    p.add_argument('--artifact-sha256', required=True)
    p.add_argument('--artifact-bytes', type=int, required=True)
    p.add_argument('--controller-commit', required=True)
    p.add_argument('--run-id', type=int, required=True)
    p.add_argument('--job-id', type=int, required=True)
    p.add_argument('--run-json', required=True)
    p.add_argument('--job-json', required=True)
    p.add_argument('--source-repo', required=True)
    p.add_argument('--trace', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--read-failure', action='store_true')
    a = p.parse_args()
    run, job = (trace.io.strict(trace.io.read_original(Path(f), 4 << 20)) for f in (a.run_json, a.job_json))
    validate_ci(run, job, a.controller_commit, a.run_id, a.job_id, failure=a.read_failure)
    files = read_zip(a.zip, a.artifact_bytes, a.artifact_sha256)
    if a.read_failure:
        report = inspect_failure(files, a.controller_commit, a.artifact_sha256, a.run_id, a.job_id)
    else:
        report = inspect(files, git_inventory(a.source_repo, BEFORE_EXECUTION_TREE), git_inventory(a.source_repo, AFTER_EXECUTION_TREE), a.trace,
                         a.controller_commit, a.artifact_sha256, a.run_id, a.job_id)
    with Path(a.output).open('x') as out:
        json.dump(report, out, sort_keys=True, indent=2)
        out.write('\n')


if __name__ == '__main__':
    main()
