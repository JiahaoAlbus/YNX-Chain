#!/usr/bin/env python3
"""Bind the held-session first100 workload to its original controller."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import urllib.request

PROFILE = 'first100-held-public-owner'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
REPOSITORY = 'JiahaoAlbus/YNX-Chain'
SOURCE = '3412fd1527cd43ba7ef63ffe4a3f7baa9e333ca8'
SOURCE_TREE = '409cbd6d1e815e5a613a41c7f65c7108792ae6a5'
TOOLS = '4922b31a705b14526ac869437d5b290784442fe4'
TOOLS_TREE = '3c59fd9bcdf25fef6c70394377663811826be806'
TOOLS_RUN = 43435585757
TOOLS_JOB_NAME = "Chain Core source and release gate"
SUPPLIER = '5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_TREE = '08747364c24c065bf2b13527c210625d7ec95fba'
GO = 'go1.26.11'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=10, text=True).strip()


def checkout(root, commit, tree=None):
    require(root == root.resolve(strict=True) and git(root, 'rev-parse', 'HEAD') == commit
            and not git(root, 'status', '--porcelain', '--untracked-files=all'),
            'exact clean controller/source/tools checkout required')
    if tree is not None:
        require(git(root, 'rev-parse', 'HEAD^{tree}') == tree, 'fixed checkout tree differs')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_inputs(source, tools):
    driver = load_module('held_first100_driver', tools / 'scripts/loadtest/pq-independent-load.py')
    intake = load_module('held_first100_intake', source / 'scripts/loadtest/pq-source-artifact-intake.py')
    return driver, intake


def options(source, execute):
    return argparse.Namespace(
        source=str(source), commit=SOURCE, mode='online', rate=100, seconds=5,
        tail_seconds=30, accounts=500, per_account=1, proof_timeout=30,
        first_trial_profile='held-first100', sender_backend='public-owner',
        initialize_before_load=True, initialization_only=False, staged_publication=True,
        startup_timings=True, wire_observation=True, commit_observation=True,
        network_accounting=True, owned_storage_accounting=True, header_hop_capture=False,
        prior_result=None, prior_result_sha256=None, held_ready_only=True, execute=execute)


def plan():
    value = dict(profile=PROFILE, ref=REF, workflow=WORKFLOW, source=SOURCE, sourceTree=SOURCE_TREE,
                 tools=TOOLS, toolsTree=TOOLS_TREE, toolsRun=TOOLS_RUN, toolsJobName=TOOLS_JOB_NAME, go=GO,
                 supplier=SUPPLIER, supplierTree=SUPPLIER_TREE, options=vars(options('source', False)),
                 nodeCount=4, pressureLevel=1)
    pin = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return dict(configuration=value, configurationSHA256=pin, runtimePlanSHA256=None)


def host(environment, platform):
    expected = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                    GITHUB_REPOSITORY=REPOSITORY, GITHUB_EVENT_NAME='workflow_dispatch',
                    GITHUB_JOB=PROFILE, GITHUB_REF=REF, GITHUB_RUN_ATTEMPT='1',
                    GITHUB_WORKFLOW_REF=f'{REPOSITORY}/{WORKFLOW}@{REF}')
    require(platform == 'linux' and all(environment.get(k) == v for k, v in expected.items()),
            'held first100 requires the original first-attempt hosted dispatch')
    require(environment.get('GITHUB_SHA') and environment.get('GITHUB_WORKFLOW_SHA') == environment['GITHUB_SHA'],
            'actual controller commit required')


def tools_ci(token):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise RuntimeError('exact tools CI metadata redirect refused')
    opener = urllib.request.build_opener(NoRedirect)
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': PROFILE}
    if token:
        headers['Authorization'] = 'Bearer ' + token

    def read(suffix):
        url = f'https://api.github.com/repos/{REPOSITORY}/actions/runs/{TOOLS_RUN}{suffix}'
        with opener.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
            raw = response.read((1 << 20) + 1)
            require(response.url == url and response.status == 200 and len(raw) <= 1 << 20,
                    'exact bounded tools CI metadata required')
        return json.loads(raw)

    run = read('')
    require(run.get('id') == TOOLS_RUN and run.get('head_sha') == TOOLS
            and run.get('head_branch') == 'codex/chain-batch-v01-performance'
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('path') == '.github/workflows/chain-core.yml' and run.get('workflow_id') == 322083952
            and run.get('event') == 'push' and run.get('run_attempt') == 1
            and run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'fixed held first100 tools CI must pass before execution')
    jobs = [job for job in read('/attempts/1/jobs')['jobs']
            if job['name'] == TOOLS_JOB_NAME]
    require(len(jobs) == 1 and type(jobs[0].get('id')) is int and jobs[0]['id'] > 0
            and jobs[0].get('run_id') == TOOLS_RUN and jobs[0].get('run_attempt') == 1
            and jobs[0].get('head_sha') == TOOLS and jobs[0].get('status') == 'completed'
            and jobs[0].get('conclusion') == 'success',
            'exact tools CI job did not pass')
    required = ('Verify optional held public input footprint and original readiness metrics',
                'Verify normal public owner stream isolation and lost acknowledgements')
    for name in required:
        steps = [step for step in jobs[0]['steps'] if step['name'] == name]
        require(len(steps) == 1 and steps[0].get('status') == 'completed'
                and steps[0].get('conclusion') == 'success', 'original held tools CI step did not pass: ' + name)
    return dict(run=TOOLS_RUN, job=jobs[0]['id'], source=TOOLS, requiredSteps=list(required), conclusion='success')


def execute():
    host(os.environ, sys.platform)
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    parent = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    source, tools, controller = (workspace / name for name in ('source', 'tools', 'controller'))
    require(Path(__file__).resolve().parents[2] == controller, 'original controller path required')
    checkout(controller, os.environ['GITHUB_SHA'])
    checkout(source, SOURCE, SOURCE_TREE)
    checkout(tools, TOOLS, TOOLS_TREE)
    require(git(source, 'rev-parse', SUPPLIER + ':third_party/cometbft') == SUPPLIER_TREE,
            'immutable supplier object absent or differs')
    go = shutil.which('go')
    require(go and subprocess.check_output([go, 'env', 'GOVERSION'], cwd=source,
                                            timeout=10, text=True).strip() == GO,
            'fixed Go toolchain differs')
    ci = tools_ci(os.environ.get('GH_TOKEN'))
    driver, intake = load_inputs(source, tools)
    original = driver.lab.Window
    calls = []

    def counted_window(source, work, additional_storage=()):
        require(not calls, 'held first100 may open only one original Window')
        # The driver has consumed the Actions metadata before calling Window.
        # Do not inherit either credential in the original child environment.
        os.environ.pop('GH_TOKEN', None)
        os.environ.pop('GITHUB_TOKEN', None)
        window = original(source, work, additional_storage=tuple(intake.nonoverlapping_roots(
            [*additional_storage, workspace, parent, Path(go).resolve(strict=True).parent.parent])))
        window.storage_roots = intake.nonoverlapping_roots(window.storage_roots)
        calls.append(window)
        driver.lab.write_new(work / 'public/FIRST100-HELD-CI.json',
                             dict(plan(), controllerCommit=os.environ['GITHUB_SHA'], toolsCI=ci))
        return window

    driver.lab.Window = counted_window
    try:
        result = driver.run(options(source, True))
    finally:
        driver.lab.Window = original
    require(len(calls) == 1, 'exactly one original held first100 Window required')
    require(result.get('firstCause') is None and result.get('cleanupComplete') is True
            and result.get('normalNodeCleanExit', {}).get('allEightExitZero') is True
            and result.get('heldReadyOnlyComplete') is True and result.get('loadExecuted') is False
            and 'loadResult' not in result and result.get('peakRSSBytes', 1 << 63) <= 4 << 30
            and result.get('preparationOnlyDemandAccounting', {}).get('notReleased') == 500
            and result.get('normalFinalizeObservation', {}).get('fourComplete') is True,
            'held readiness incomplete; retain the original first cause and full demand')


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--execute', action='store_true')
    if parser.parse_args().execute:
        def interrupted(signum, frame):
            raise RuntimeError(f'held first100 interrupted by signal {signum}')
        signal.signal(signal.SIGINT, interrupted)
        signal.signal(signal.SIGTERM, interrupted)
        execute()
    else:
        print(json.dumps(plan(), sort_keys=True))


if __name__ == '__main__':
    main()
