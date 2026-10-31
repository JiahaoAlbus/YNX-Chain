#!/usr/bin/env python3
"""Root-owned phase lifecycle for the unchanged f27 source intake and Perf tools.

The only execution difference is explicit waitpid for previously observed,
owned, adopted and already exited heavy children at a completed phase boundary.
Actual admission, source/proofs, input artifacts and comparisons are unchanged.
"""
import ctypes
import json
import os
from pathlib import Path
import shutil
import sys
import time


def reap_adopted_heavy_zombies(lab, window, record=None):
    lab.require(all(c['process'].poll() is not None for c in window.children),
                'previous managed source phase has not completed')
    direct = {c['process'].pid for c in window.children}
    rows, vanished = lab.guard.proc_inventory()
    owned = lab.guard.owned_set(rows, os.getpid(), known=window.known)
    observed = lab.heavy_processes(rows)
    if record is None:
        record = {}
    record.update(originalHeavySelection=observed, originalInventoryVanished=vanished,
                  waited=[], retained=[], noSignalSent=True)
    for item in observed:
        pid = item['pid']
        first = rows.get(pid)
        if (not first or pid in direct or pid not in owned or first['parent'] != os.getpid()
                or first['state'] != 'Z'):
            record['retained'].append(dict(item, reason='not an owned adopted zombie'))
            continue
        lab.require(window.known.get(pid) == first['startTicks'],
                    'adopted child not previously observed by original Window')
        second = lab.guard.parse_stat(lab.guard.bounded(Path('/proc') / str(pid) / 'stat'), pid)
        lab.require(second['startTicks'] == first['startTicks'] and second['parent'] == os.getpid()
                    and second['state'] == 'Z', 'adopted child identity/state changed before waitpid')
        waited, status = os.waitpid(pid, os.WNOHANG)
        lab.require(waited == pid and (os.WIFEXITED(status) or os.WIFSIGNALED(status)),
                    'adopted exited child was not actually reaped')
        record['waited'].append(dict(item, originalStat=first, secondStat=second,
                                    waitpid=waited, rawWaitStatus=status,
                                    exitCode=os.waitstatus_to_exitcode(status)))
        lab.require(os.waitstatus_to_exitcode(status) == 0,
                    'adopted source-tool child had a nonzero terminal status')
    return record


def run_scope(base, args):
    # Reuse the byte-pinned original intake, complete validation and Window.
    require, git, original_lab = base.require, base.git, base.original_lab
    SCOPES, OLD_ARTIFACT, FDC, MULTI_TOOLS, B8_INPUT = base.SCOPES, base.OLD_ARTIFACT, base.FDC, base.MULTI_TOOLS, base.B8_INPUT
    nonoverlapping_roots, set_output, actual_machine = base.nonoverlapping_roots, base.set_output, base.actual_machine
    download_artifact, validate_in_window = base.download_artifact, base.validate_in_window
    normalize_digest, read_json, public_from_entry = base.normalize_digest, base.read_json, base.public_from_entry
    hardware_qualification, write_new = base.hardware_qualification, base.write_new
    require(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'only the admitted fresh hosted Linux job can execute')
    require(os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'do not automatically rerun a consumed source scope')
    tools_commit, owner_commit, profile = SCOPES[args.scope]
    tools, owner, controller, operation = map(Path, (args.tools, args.owner, args.controller, args.operation))
    for path in (tools, owner, controller):
        require(path.is_absolute() and path.resolve(strict=True) == path, 'canonical actual checkout required')
    parent = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    require(operation.is_absolute() and operation.parent == parent and not operation.exists() and not operation.is_symlink(), 'fresh job-owned counted operation required')
    require(git(controller, 'rev-parse', 'HEAD') == os.environ['GITHUB_SHA'] and not git(controller, 'status', '--porcelain', '--untracked-files=normal'), 'exact clean current controller source required')
    lab = original_lab(tools, tools_commit)
    lab.check_source(owner, owner_commit)
    require(len(os.sched_getaffinity(0)) >= 2, 'two actual CPU affinity slots required')
    rows, _ = lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(), shutil.disk_usage(parent).free, lab.heavy_processes(rows))
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(36, 1, 0, 0, 0) == 0, 'original Linux subreaper required')
    operation.mkdir(mode=0o700); (operation / '.private').mkdir(mode=0o700); (operation / 'public').mkdir(mode=0o700)
    window = lab.Window(owner, operation, additional_storage=(parent, workspace, Path(shutil.which('go')).resolve(strict=True).parent.parent))
    # Count EVERY job temporary/setup/download/cache/source root exactly once.
    # This only normalizes nested roots; it never removes an uncovered root or
    # changes original Window limits/sampling/process ownership.
    window.storage_roots = nonoverlapping_roots(window.storage_roots)
    window.env.update(RUNNER_TEMP=str(operation), GOMAXPROCS='1', PYTHONDONTWRITEBYTECODE='1')
    window.env.pop('GH_TOKEN', None); window.env.pop('GITHUB_TOKEN', None)
    record = dict(version='YNX-ROOT-SOURCE-COMPARE-CONTROLLER/v2', scope=args.scope, toolsCommit=tools_commit, sourceCommit=owner_commit,
        workflowCommit=os.environ['GITHUB_SHA'], runId=os.environ['GITHUB_RUN_ID'], job=os.environ['GITHUB_JOB'],
        firstCause=None, cleanupComplete=False, comparisonComplete=False, beforeRecord=False,
        configuration=dict(performanceComparisonQualified=False, samePhysicalHostClaim=False, reason='not-yet-qualified'),
        storageRoots=[str(p) for p in window.storage_roots], caps=lab.CAPS, chainMetrics='UNMEASURED', samePhysicalHostClaim=False)
    public = None; validated = None; machine = None; intake_destination = None
    set_output('diagnostics', str(operation / 'public'))
    try:
        window.sample()
        machine = actual_machine(window)
        prepared = operation / 'prepared'
        window.wait(window.launch('prepare-original-source', [sys.executable, '-B', str(tools / 'scripts/loadtest/prepare-pq-baseline.py'), '--owner', str(owner), '--commit', owner_commit, '--output', str(prepared)]))
        inputs = prepared / '.inputs'; inputs.mkdir(mode=0o700)
        window.sample(); shutil.move(str(tools), inputs / 'tools'); shutil.move(str(owner), inputs / 'owner')
        tools, owner = inputs / 'tools', inputs / 'owner'; window.source = owner
        before = None; before_machine = None; expected_input = None
        if args.scope == 'b8':
            record['beforeArtifact'] = dict(OLD_ARTIFACT)
            intake_destination = inputs / 'original'
            before = download_artifact(OLD_ARTIFACT, intake_destination, profile, window.sample)
            validate_in_window(window, 'verify-original-eight-public', before, profile, FDC, B8_INPUT); expected_input = B8_INPUT
        elif args.scope != 'multi-before':
            require(all(os.environ.get(key) for key in ('MULTI_BEFORE_ARTIFACT_ID', 'MULTI_BEFORE_RUN_ID', 'MULTI_BEFORE_ARTIFACT_NAME', 'MULTI_BEFORE_ARTIFACT_DIGEST', 'MULTI_BEFORE_INPUT_SHA256')), 'actual successful before job outputs required')
            expected = dict(artifactId=int(os.environ['MULTI_BEFORE_ARTIFACT_ID']), runId=int(os.environ['MULTI_BEFORE_RUN_ID']),
                name=os.environ['MULTI_BEFORE_ARTIFACT_NAME'], digest=normalize_digest(os.environ['MULTI_BEFORE_ARTIFACT_DIGEST']), size=None,
                workflowCommit=os.environ['GITHUB_SHA'])
            require(str(expected['runId']) == os.environ['GITHUB_RUN_ID'] and expected['name'] == 'pq-source-multi-before-' + os.environ['GITHUB_RUN_ID'], 'same original workflow before artifact required')
            record['beforeArtifact'] = dict(expected)
            intake_destination = inputs / 'original-before-public'
            before = download_artifact(expected, intake_destination, profile, window.sample)
            expected_input = normalize_digest(os.environ['MULTI_BEFORE_INPUT_SHA256'])
            validate_in_window(window, 'verify-original-four-public', before, profile, FDC, expected_input)
            original_controller = read_json(before / 'SOURCE-COMPARE-CONTROLLER.json', 4 << 20)
            require(original_controller.get('scope') == 'multi-before' and original_controller.get('toolsCommit') == MULTI_TOOLS and original_controller.get('sourceCommit') == FDC and original_controller.get('cleanupComplete') is True and original_controller.get('firstCause') is None and original_controller.get('beforeRecord') is True and original_controller.get('workflowCommit') == os.environ['GITHUB_SHA'] and original_controller.get('runId') == os.environ['GITHUB_RUN_ID'], 'actual complete original before controller receipt required')
            before_machine = read_json(before / 'HOST-MACHINE.json', 1 << 20)
        command = [sys.executable, '-B', str(tools / 'scripts/loadtest/run-pq-baseline.py'), '--prepared', str(prepared / 'prepared.json')]
        if profile == 'multi-whole':
            command += ['--profile', 'multi-whole']  # Never pass --profile to old b6 runner.
        command += ['--mode', 'record' if args.scope == 'multi-before' else 'replay']
        if before is not None:
            command += ['--input', str(before / 'baseline-input.json'), '--input-sha256', expected_input]
        command += ['--execute']
        window.sample()
        record['adoptedChildFinalization'] = {}
        reap_adopted_heavy_zombies(lab, window, record['adoptedChildFinalization'])
        fresh_rows, _ = lab.guard.proc_inventory()
        lab.admit(lab.guard.memory_available(), shutil.disk_usage(parent).free, lab.heavy_processes(fresh_rows))
        window.wait(window.launch('original-source-entry', command))
        public = public_from_entry(operation / 'public/original-source-entry.log', operation)
        validated = validate_in_window(window, 'verify-actual-source-public', public, profile, owner_commit, expected_input, raw_runner=True)
        if before is not None:
            diff_name = 'B8-complete-differential.json' if args.scope == 'b8' else 'MULTI-complete-differential.json'
            window.wait(window.launch('original-full-state-compare', [sys.executable, '-B', str(tools / 'scripts/loadtest/compare-pq-baseline.py'), '--before', str(before), '--after', str(public), '--output', str(public / diff_name)]))
            record['comparisonComplete'] = True
            record['configuration'] = hardware_qualification(before_machine, machine, allow_missing=args.scope == 'b8')
        else:
            record['beforeRecord'] = True
            record['configuration'] = dict(performanceComparisonQualified=False, samePhysicalHostClaim=False,
                reason='actual-before-record-only-no-after-pair-yet')
        window.sample()
    except BaseException as error:
        record['firstCause'] = str(error)
        if public is None:
            try:
                public = public_from_entry(operation / 'public/original-source-entry.log', operation)
            except BaseException:
                pass
    finally:
        try:
            record['cleanupComplete'] = window.stop()
        except BaseException as error:
            record['cleanupError'] = str(error)
        if not record['cleanupComplete'] and record['firstCause'] is None:
            record['firstCause'] = record.get('cleanupError', 'original Window cleanup incomplete')
        if intake_destination is not None:
            # Retain bounded PUBLIC provenance even if a network/CRC/source
            # failure prevented the original runner from producing any output.
            # Never upload the old ZIP again or include signed URLs/credentials.
            record['artifactIntake'] = dict(completeZipVerified=False)
            try:
                zip_path = intake_destination / 'artifact.zip'
                if zip_path.is_file() and not zip_path.is_symlink():
                    record['artifactIntake']['downloadedZipBytes'] = zip_path.stat().st_size
                if (intake_destination / 'intake.json').is_file():
                    observed = read_json(intake_destination / 'intake.json', 1 << 20)
                    record['artifactIntake'].update(observed, completeZipVerified=True)
                if (intake_destination / 'metadata.json').is_file():
                    metadata = read_json(intake_destination / 'metadata.json', 1 << 20)
                    record['artifactIntake']['official'] = {key: metadata[key] for key in ('id', 'name', 'size_in_bytes', 'digest')}
                observed = record['artifactIntake']
                if observed['completeZipVerified']:
                    expected = record['beforeArtifact']; official = observed.get('official', {})
                    require(observed.get('artifactId') == expected['artifactId'] and observed.get('runId') == expected['runId'] and observed.get('CRCClosedPublic') is True and observed.get('zipSHA256') == normalize_digest(expected['digest']) and observed.get('zipBytes') == official.get('size_in_bytes') and official.get('id') == expected['artifactId'] and official.get('name') == expected['name'] and normalize_digest(official.get('digest')) == normalize_digest(expected['digest']), 'original artifact readback provenance differs')
            except BaseException as error:
                record['artifactIntakeEvidenceError'] = str(error)
                record['artifactIntake']['completeZipVerified'] = False
            if record['firstCause'] is None and (not record['artifactIntake']['completeZipVerified'] or 'official' not in record['artifactIntake']):
                record['firstCause'] = 'complete original artifact intake provenance missing'
        record.update(elapsedSeconds=time.monotonic()-window.started, peakRSSBytes=window.peak_rss, peakNewBytes=window.peak_bytes,
            resourceSamples=window.samples, processes=window.process_receipt(), retiredSamplingEvidence=window.retired_samples)
        write_new(operation / 'public/SOURCE-COMPARE-CONTROLLER.json', record)
        if machine is not None:
            write_new(operation / 'public/HOST-MACHINE.json', machine)
        if public is not None:
            # Only the original runner's PUBLIC subtree is ever uploaded.
            if machine is not None:
                write_new(public / 'HOST-MACHINE.json', machine)
            write_new(public / 'SOURCE-COMPARE-CONTROLLER.json', record)
            set_output('public', str(public))
        print(json.dumps(dict(scope=args.scope, firstCause=record['firstCause'], cleanupComplete=record['cleanupComplete'], public=str(public) if public else None, comparisonComplete=record['comparisonComplete'])))
    require(record['firstCause'] is None and record['cleanupComplete'] and validated is not None and (record['beforeRecord'] or record['comparisonComplete']), 'source scope failed; preserve original first cause and partial PUBLIC evidence')
    set_output('input_sha256', validated['inputSha256'])
    set_output('run_id', os.environ['GITHUB_RUN_ID'])
    return record
