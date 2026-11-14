#!/usr/bin/env python3
"""Check the seal-only to offline-plan handoff with inert fixture receipts."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from record_r2_offline_preparation import OUTPUT_NAME, STAGES
from run_r2_adjacent_cli import preparation_for_launch, verified_argv


def write(path, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(json.dumps(data)+'\n')
    return path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture(out, case):
    app = out/'R2TorCLI.app'
    exe = write(app/'Contents/MacOS/R2TorCLI', 'inert fixture; no execution')
    exe.chmod(0o700)
    info = write(app/'Contents/Info.plist', 'inert app metadata')
    resources = write(app/'Contents/_CodeSignature/CodeResources', 'inert seal data')
    hashes = {str(p): sha(p) for p in (exe, info, resources)}
    prep = write(out/'PREPARATION.json', dict(status='SEALED_OFFLINE_PREPARE_NOT_RUN', runCommand=None,
                  sourceAndSupplyPins=hashes, sealedExecutableSHA256=hashes[str(exe)], sourceDrift=[], offlinePrepareStages=[]))
    now = datetime.now(timezone.utc)
    verdict = dict(schema='P05_ORIGINAL_PAIR_MACOS_EXECUTION_ASSESSMENT_V1', status='ADMITTED', originalWait=0,
                   argv=['/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=4', str(app)],
                   reaped=True, timeout=False, qaExecutableStarted=False, artifactSHA256=sha(exe),
                   artifactBefore=hashes, artifactAfter=hashes, terminalUTC=(now-timedelta(seconds=3)).isoformat())
    if case == 'rejected-platform':
        verdict.update(status='EXECUTION_ASSESSMENT_REJECTED', originalWait=3)
    if case == 'different-artifact':
        verdict['artifactSHA256'] = '0'*64
    assessment = write(out/'fixture-assessment.json', verdict)
    plan_body = dict(schema='P05_R2_TOR_ADJACENT_CLI_PLAN_V1', createdAt=(now-timedelta(seconds=1)).timestamp())
    plan = write(out/'CLI-PLAN.json', plan_body)
    stdout = write(out/'offline-plan.stdout', plan_body if case!='different-plan' else dict(plan_body, unexpected=True))
    stderr = out/'offline-plan.stderr'
    stages = STAGES if case != 'incomplete-stages' else STAGES[:-1]
    stderr.write_text(''.join('P05_R2_TOR_PREPARE_'+stage+'\n' for stage in stages))
    offline = write(out/'fixture-offline-receipt.json', dict(name='offline-plan', argv=[str(exe), '--prepare-only', str(out)],
        pid=os.getpid(), returncode=0, reaped=True, timeout=False, stdoutSHA256=sha(stdout), stderrSHA256=sha(stderr),
        dispatchUTC=(now-timedelta(seconds=2)).isoformat(), terminalObservedUTC=now.isoformat()))
    return prep, assessment, offline, plan, exe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    binder = Path(__file__).with_name('record_r2_offline_preparation.py')
    runner = Path(__file__).with_name('run_r2_adjacent_cli.py')
    inputs = {p.name: sha(p) for p in (binder, runner, Path(__file__))}
    results = []
    for case in ('coherent', 'rejected-platform', 'different-artifact', 'different-plan', 'incomplete-stages'):
        root = output/case
        prep, assessment, offline, plan, exe = fixture(root, case)
        before = {str(p): sha(p) for p in (prep, assessment, offline, plan, exe)}
        command = [sys.executable, '-B', str(binder), str(root), '--assessment', str(assessment),
                   '--offline-process-receipt', str(offline)]
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            stdout, stderr = child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            stdout, stderr = child.communicate(timeout=2)
        (root/'binder.stdout').write_bytes(stdout)
        (root/'binder.stderr').write_bytes(stderr)
        accepted = (root/OUTPUT_NAME).is_file()
        argv_correct, edited_plan_rejected = False, False
        if accepted and case == 'coherent':
            loaded = preparation_for_launch(root)
            argv_correct = verified_argv(root, loaded) == [str(exe), '--run-prepared', str(root)]
        no_changes = before == {str(p): sha(p) for p in (prep, assessment, offline, plan, exe)}
        if accepted and case == 'coherent':
            plan.write_text('{}\n')
            try: preparation_for_launch(root)
            except ValueError: edited_plan_rejected = True
        results.append(dict(case=case, pythonChildPID=child.pid, originalWait=child.returncode,
                            reaped=child.poll() is not None, inputsPreserved=no_changes, saved=accepted,
                            fixedArgv=argv_correct, editedPlanRejected=edited_plan_rejected))
    positive, *negative = results
    passed = (positive['saved'] and positive['originalWait'] == 0 and positive['fixedArgv'] and positive['editedPlanRejected']
              and all(not row['saved'] and row['originalWait'] == 2 for row in negative)
              and all(row['inputsPreserved'] and row['reaped'] for row in results))
    write(output/'RESULT.json', dict(status='PASS' if passed else 'FAIL', results=results, sourceInputs=inputs,
          scope='Inert receipt fixtures only. No OS assessment, bundle execution, backend or network.'))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
