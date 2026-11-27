#!/usr/bin/env python3
"""Qualify one same-job public getter source proof; never authorize a node."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

SUPPLIER_COMMIT = '5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_TREE = '08747364c24c065bf2b13527c210625d7ec95fba'
PATCHED_SUPPLIER_COMMIT = '28a769cc934ea5bffe971214cabe7285b30d80d2'
PATCHED_SUPPLIER_TREE = 'd1614fd27dedde42da4142648ae7201aeb988036'
SUPPLIER_BY_PRODUCTION = {
    '5a128880d14bfc73de4334cba23218859ad3473c': (SUPPLIER_COMMIT, SUPPLIER_TREE),
    '47d7cfeee7cd178cb897eda57a4674677fac7e67': (SUPPLIER_COMMIT, SUPPLIER_TREE),
    'aadf0831c6b65559065ca82228bab30811d36c67': (PATCHED_SUPPLIER_COMMIT, PATCHED_SUPPLIER_TREE),
}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def strict(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate original evidence field')
            result[key] = value
        return result
    def invalid(value):
        raise RuntimeError('nonfinite original evidence field')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def read(path):
    require(path.is_file() and not path.is_symlink(), 'original evidence missing: ' + path.name)
    raw = path.read_bytes()
    require(0 < len(raw) <= 32 << 20, 'invalid bounded evidence: ' + path.name)
    return raw


def pin(path):
    raw = read(path)
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def qualify(directory, commit, tree, fork, run, attempt, live, budget):
    require(bool(re.fullmatch('[0-9a-f]{40}', commit)) and bool(re.fullmatch('[0-9a-f]{40}', tree)) and bool(re.fullmatch('[0-9a-f]{40}', fork)), 'source pins required')
    require(run.isdecimal() and int(run) > 0 and attempt == '1', 'original first CI attempt required')
    require(fork in SUPPLIER_BY_PRODUCTION, 'getter production fork has no fixed supplier')
    supplier_commit, supplier_tree = SUPPLIER_BY_PRODUCTION[fork]
    source = strict(read(directory / 'SOURCE.json'))
    prepared = source['preparedSourceSelection']
    selection_path = directory / 'composition' / 'SOURCE-SELECTION.json'
    selection = strict(read(selection_path))
    require(source['version'] == 'YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1' and source['sourceCommit'] == commit and source['sourceTree'] == tree and source['productionForkTree'] == fork, 'getter source identity differs')
    require(source['optionalForkCommit'] == supplier_commit and source['optionalForkTree'] == supplier_tree and source['buildTags'] == ['ynx_live_wire_observation'], 'getter fixed supplier differs')
    require(source['sourceOnly'] is True and source['actualPreStartNodeGetter'] is True and type(source['nodeProcessesStarted']) is int and source['nodeProcessesStarted'] == 0 and source['actualRunningWindow'] is False and source['carrierEnabled'] is False and source['publicActivation'] is False, 'getter source scope differs')
    require(selection['originalSourceCommit'] == commit and selection['originalSourceTree'] == tree and selection['originalProductionForkTree'] == fork and selection['selectedOptionalForkCommit'] == supplier_commit and selection['selectedOptionalForkTree'] == supplier_tree and selection['nodeStarted'] is False and selection['carrierEnabled'] is False and selection['publicActivation'] is False, 'getter composition differs')
    selection_pin = pin(selection_path)
    require(prepared['receiptBytes'] == selection_pin['bytes'] and prepared['receiptSHA256'] == selection_pin['sha256'] and prepared['sourceSelection'] == selection, 'getter original selection receipt differs')
    files = {'SOURCE.json': pin(directory/'SOURCE.json'), 'composition/SOURCE-SELECTION.json': selection_pin}
    for label, key, required in (('normal-live-caller', 'normalProducer', live), ('original-peer-budget', 'originalSupplierBudget', budget)):
        paths = {kind: directory/(label+suffix) for kind, suffix in (('stdout','.jsonl'),('stderr','.stderr.log'),('result','.result.json'))}
        # A clean Go invocation may legitimately write zero stderr bytes.
        require(paths['stderr'].is_file() and not paths['stderr'].is_symlink(), 'original stderr missing')
        stdout_raw = read(paths['stdout'])
        stderr_raw = paths['stderr'].read_bytes()
        require(len(stderr_raw) <= 32 << 20, 'original stderr exceeds bound')
        result = strict(read(paths['result']))
        require(result['returnCode'] == 0 and result['timedOut'] is False and result['validationPassed'] is True and result['firstFailure'] is None and set(required) <= set(result['requiredPassed']), 'original getter test result incomplete')
        for kind, raw in (('stdout', stdout_raw), ('stderr', stderr_raw)):
            recorded = result[kind]
            require(recorded['bytes'] == len(raw) and recorded['sha256'] == hashlib.sha256(raw).hexdigest(), 'original getter stream pin differs')
        result_pin = pin(paths['result'])
        aggregate = source[key]
        require(aggregate['bytes'] == len(stdout_raw) and aggregate['sha256'] == hashlib.sha256(stdout_raw).hexdigest() and aggregate['stderr']['bytes'] == len(stderr_raw) and aggregate['stderr']['sha256'] == hashlib.sha256(stderr_raw).hexdigest() and aggregate['result']['bytes'] == result_pin['bytes'] and aggregate['result']['sha256'] == result_pin['sha256'], 'original getter aggregate pin differs')
        rows = [strict(line) for line in stdout_raw.splitlines()]
        require(not any(row.get('Action') in ('fail', 'skip', 'build-fail') for row in rows), 'original getter go stream contains failure or skip')
        package = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet' if key == 'normalProducer' else 'github.com/cometbft/cometbft/mempool'
        terminals = [(i,row.get('Action')) for i,row in enumerate(rows) if row.get('Package') == package and not row.get('Test') and row.get('Action') in ('start','pass','fail','skip')]
        require(len(terminals) == 2 and [v for _,v in terminals] == ['start','pass'], 'original getter package missing, repeated or incomplete')
        start, end = terminals[0][0], terminals[1][0]
        for name in required:
            events = [(i,row) for i,row in enumerate(rows) if row.get('Test') == name and row.get('Action') in ('run','pass','fail','skip')]
            require(len(events)==2 and [row.get('Action') for _,row in events]==['run','pass'] and all(row.get('Package')==package for _,row in events) and start < events[0][0] < events[1][0] < end, 'original getter named test missing, foreign, repeated or outside package: '+name)
        files[label+'.jsonl'] = {'bytes':len(stdout_raw),'sha256':hashlib.sha256(stdout_raw).hexdigest()}
        files[label+'.stderr.log'] = {'bytes':len(stderr_raw),'sha256':hashlib.sha256(stderr_raw).hexdigest()}
        files[label+'.result.json'] = result_pin
    return dict(version='YNX-HELD-OPTIONAL-LIVE-GETTER-CI/v1', sourceCommit=commit, sourceTree=tree, productionForkTree=fork, supplierCommit=supplier_commit, supplierForkTree=supplier_tree, runId=run, runAttempt=attempt, files=files, sourceOnly=True, nodeStarted=False, authorityGranted=False, publicActivation=False, independentFinality=False)


def main():
    root = Path(__file__).resolve().parents[2]
    git = lambda *args: subprocess.check_output(['git','-C',str(root),*args], text=True).strip()
    commit, tree, fork = git('rev-parse','HEAD'), git('rev-parse','HEAD^{tree}'), git('rev-parse','HEAD:third_party/cometbft')
    require(commit == os.environ['GITHUB_SHA'] and not git('status','--porcelain','--untracked-files=normal'), 'original clean exact getter source required')
    dirs = list(Path(os.environ['RUNNER_TEMP']).glob('wire-live-source-*'))
    require(len(dirs) == 1 and dirs[0].is_dir() and not dirs[0].is_symlink(), 'one original getter output required')
    spec = importlib.util.spec_from_file_location('original_wire_helper', root/'scripts/verify/wire-live-matching-source-ci.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    result = qualify(dirs[0],commit,tree,fork,os.environ['GITHUB_RUN_ID'],os.environ['GITHUB_RUN_ATTEMPT'],helper.LIVE,helper.LOSSLESS_BUDGET)
    with (dirs[0]/'GETTER-QUALIFICATION.json').open('x') as f:
        json.dump(result,f,sort_keys=True); f.write('\n')
    print('YNX_HELD_OPTIONAL_LIVE_GETTER_DATA_ONLY '+json.dumps(result,sort_keys=True))


if __name__ == '__main__':
    main()
