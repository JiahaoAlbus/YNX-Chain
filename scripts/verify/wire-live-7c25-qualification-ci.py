#!/usr/bin/env python3
"""Exact CI-only qualification for the existing 7c25 optional live getter.

This does not build a provider, start a node, enable a carrier, or authorize a
window. The normal existing composer/test job owns all actual Go execution.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

REF = 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'
BASE = '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
BASE_TREE = '8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a'
ROOTS = {'go.mod': '711fee87261c833a6e4cae5c9706d9fd32e9aed4', 'go.sum': '940892c107fd2facdd222a07d11f227bb0963473', 'cmd': 'd1c925ece2fbeacbf09085f452b70256dacf3317', 'internal': '012ef00081033b3b11c7fd1ccdfabdeb12ef4595', 'contracts': 'cf38ed42bfdc26b461c21eb48be33891132aaa04', 'third_party': 'c3570c029c238fad229aeac09b68d712472a6fab'}
COMPOSER_SHA = 'e35ff39c10090e9200bdabf7b265c1fd211fd2ae4d227ffaae52054c6dbc2fac'
ORIGINAL_WORKFLOW_SHA = 'c3b7c8e942ca36222adaa45b35bd61deb3fdf46b20ec505880fc8d6a58d974f2'
TRANSFORMS = [['      - codex/v5-link-native-ci\n', '      - codex/v5-link-native-ci\n      - codex/ynx-pq-wire-live-7c25-qualification-20261108\n', 1], ['      - "scripts/verify/test_wire_live_matching_source_ci.py"\n', '      - "scripts/verify/test_wire_live_matching_source_ci.py"\n      - "scripts/verify/wire-live-7c25-qualification-ci.py"\n', 2], ["    if: github.event_name == 'push' && github.ref == 'refs/heads/codex/ynx-pq-perf-integration'\n", "    if: github.event_name == 'push' && (github.ref == 'refs/heads/codex/ynx-pq-perf-integration' || github.ref == 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108')\n", 1], ['          BEFORE: ${{ github.event.before }}\n          AFTER: ${{ github.sha }}\n', '          BEFORE: ${{ github.event.before }}\n          AFTER: ${{ github.sha }}\n          QUALIFICATION_REF: ${{ github.ref }}\n', 1], ['          [[ "$BEFORE" =~ ^[0-9a-f]{40}$ && "$AFTER" =~ ^[0-9a-f]{40}$ ]]\n', '          [[ "$BEFORE" =~ ^[0-9a-f]{40}$ && "$AFTER" =~ ^[0-9a-f]{40}$ ]]\n          if [[ "$QUALIFICATION_REF" == "refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108" ]]; then\n            printf \'changed=false\\nclient_changed=true\\nintegration_changed=false\\n\' >> "$GITHUB_OUTPUT"\n            exit 0\n          fi\n', 1], ["      !(github.event_name == 'pull_request' && github.base_ref == 'codex/ynx-pq-perf-integration')\n", "      !(github.event_name == 'pull_request' && github.base_ref == 'codex/ynx-pq-perf-integration') &&\n      github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n", 1], ['lossless-default-source', "    if: needs.contract-tooling-scope.outputs.client_changed == 'true'\n", "    if: needs.contract-tooling-scope.outputs.client_changed == 'true' && github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n"], ['distributed-pq-source', "    if: needs.contract-tooling-scope.outputs.client_changed == 'true'\n", "    if: needs.contract-tooling-scope.outputs.client_changed == 'true' && github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n"], ['lossless-matching-source', "    if: needs.contract-tooling-scope.outputs.client_changed == 'true'\n", "    if: needs.contract-tooling-scope.outputs.client_changed == 'true' && github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n"], ['  link-scope:\n    name: Select actual LINK changed closure\n', "  link-scope:\n    name: Select actual LINK changed closure\n    if: github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n", 1], ['client-depth', '          fetch-depth: 1\n', "          fetch-depth: ${{ github.ref == 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108' && 4 || 1 }}\n"], ['client-cache', '          cache: true\n', "          cache: ${{ github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108' }}\n"], ['      - name: Verify normal PQ lab producers and the original proof caller\n', "      - name: Verify normal PQ lab producers and the original proof caller\n        if: github.ref != 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n", 1]]
NEW_STEPS = ["      - name: Verify exact 7c25 CI-only source and route\n        if: github.ref == 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n        run: |\n          python3 -B scripts/verify/wire-live-7c25-qualification-ci.py --self-test\n          python3 -B scripts/verify/wire-live-7c25-qualification-ci.py --source-ledger\n", "      - name: Bind actual tagged evidence to the unchanged 7c25 Go roots\n        if: github.ref == 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n        run: python3 -B scripts/verify/wire-live-7c25-qualification-ci.py --seal-evidence\n", "      - name: Preserve exact 7c25 qualification with original tagged streams\n        if: always() && github.ref == 'refs/heads/codex/ynx-pq-wire-live-7c25-qualification-20261108'\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n        with:\n          name: normal-live-wire-7c25-qualification-${{ github.sha }}\n          path: |\n            ${{ runner.temp }}/wire-live-7c25-controller.json\n            ${{ runner.temp }}/wire-live-7c25-qualification.json\n            ${{ runner.temp }}/wire-live-source-*/SOURCE.json\n            ${{ runner.temp }}/wire-live-source-*/normal-live-caller.jsonl\n            ${{ runner.temp }}/wire-live-source-*/normal-live-caller.stderr.log\n            ${{ runner.temp }}/wire-live-source-*/normal-live-caller.result.json\n            ${{ runner.temp }}/wire-live-source-*/original-peer-budget.jsonl\n            ${{ runner.temp }}/wire-live-source-*/original-peer-budget.stderr.log\n            ${{ runner.temp }}/wire-live-source-*/original-peer-budget.result.json\n            ${{ runner.temp }}/wire-live-source-*/composition/SOURCE-SELECTION.json\n          if-no-files-found: error\n          retention-days: 14\n"]
UPLOAD_LINES = []
PREREQUISITE_PARENT = 'e440e439e07b001d286830c89f4324d55be53490'
PREREQUISITE_PARENT_TREE = 'd416e02c7fb32a0138c3f5def581bdea1b68364d'
CACHE_PARENT = 'c5786c9250858951b7d91103434cd2e467b4ce13'
CACHE_PARENT_TREE = '5e9d1c0c1894ab2cf58d611f0e5cb387cba20b77'
SCRIPT = 'scripts/verify/wire-live-7c25-qualification-ci.py'
WORKFLOW = '.github/workflows/chain-core.yml'
ALLOWED = {SCRIPT, WORKFLOW}
FORK = '5a128880d14bfc73de4334cba23218859ad3473c'
SUPPLIER = '5a49f5c91452604dffb910df736702b3b9df2562'
OPTIONAL = '08747364c24c065bf2b13527c210625d7ec95fba'
ORIGINAL_OFF_TREE = '3cae5a04f26e17cffcfb9c253ea9013231881725'
COMPOSER = 'scripts/verify/wire-live-matching-source-ci.py'
LIVE = ['TestOperatorWireLivePrivateControlTwoEndpointsAndNoReplay',
        'TestOperatorWireLiveUnknownPreservesOriginalAndRetires',
        'TestOperatorWireLiveCloseJoinsOriginalCaptureWithoutNodeQuit',
        'TestOperatorWireLivePermissionsIdentityAndResiduals',
        'TestOperatorWireLiveRequesterUnknownAndProducerIdentity',
        'TestOperatorWireLiveSelfProcParsingAndDefaultOff',
        'TestOperatorWireLiveTypedNormalNodeBeforeStartIsUnknown']


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'duplicate public evidence field')
        out[key] = value
    return out


def load(path):
    return json.loads(path.read_bytes(), object_pairs_hook=unique)


def pin(path):
    raw = path.read_bytes()
    return dict(bytes=len(raw), sha256=digest(raw))


def write_once(path, data):
    with path.open('x') as out:
        out.write(json.dumps(data, sort_keys=True, indent=2) + '\n')


def source_ledger(root, environment, read_git=git):
    require(environment.get('GITHUB_EVENT_NAME') == 'push' and environment.get('GITHUB_REF') == REF,
            'only the exact normal qualification push is accepted')
    head = read_git(root, 'rev-parse', 'HEAD').decode().strip()
    require(re.fullmatch('[0-9a-f]{40}', head) and head != BASE and head == environment.get('GITHUB_SHA'),
            'actual CI controller/head differs')
    parent = read_git(root, 'show', '-s', '--format=%P', 'HEAD').decode().strip()
    require(parent in (BASE, CACHE_PARENT, PREREQUISITE_PARENT),
            'qualification controller requires the exact original or explicitly known qualification parent')
    if parent == PREREQUISITE_PARENT:
        require(read_git(root, 'show', '-s', '--format=%P', PREREQUISITE_PARENT).decode().strip() == CACHE_PARENT and
                read_git(root, 'rev-parse', PREREQUISITE_PARENT + '^{tree}').decode().strip() == PREREQUISITE_PARENT_TREE,
                'known prerequisite-only parent ancestry/tree differs')
    if parent in (CACHE_PARENT, PREREQUISITE_PARENT):
        require(read_git(root, 'show', '-s', '--format=%P', CACHE_PARENT).decode().strip() == BASE and
                read_git(root, 'rev-parse', CACHE_PARENT + '^{tree}').decode().strip() == CACHE_PARENT_TREE,
                'known cache-fix parent ancestry/tree differs')
    require(not read_git(root, 'status', '--porcelain', '--untracked-files=normal').strip(),
            'CI-only source checkout is not clean')
    changes = read_git(root, 'diff', '--name-only', BASE, 'HEAD').decode().splitlines()
    require(len(changes) == 2 and set(changes) == ALLOWED,
            'changes outside the exact two CI leaves')
    roots = {}
    for path, expected in ROOTS.items():
        actual = read_git(root, 'rev-parse', 'HEAD:' + path).decode().strip()
        require(actual == expected, 'original build root changed: ' + path)
        roots[path] = actual
    require(digest((root / COMPOSER).read_bytes()) == COMPOSER_SHA, 'original composer bytes changed')
    for path in ALLOWED:
        row = read_git(root, 'ls-tree', 'HEAD', '--', path).decode()
        require(row.startswith('100644 blob ') and row.rstrip().endswith('\t' + path),
                'CI leaf mode or path changed')
    tree = read_git(root, 'rev-parse', 'HEAD^{tree}').decode().strip()
    require(re.fullmatch('[0-9a-f]{40}', tree), 'actual controller tree missing')
    run, attempt = environment.get('GITHUB_RUN_ID', ''), environment.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch('[1-9][0-9]*', run) and re.fullmatch('[1-9][0-9]*', attempt), 'actual CI run identity missing')
    return dict(schema='YNX-WIRE-LIVE-7C25-CI-CONTROLLER/v1', ciControllerCommit=head,
                ciControllerTree=tree, ciRef=REF, ciRun=run, ciAttempt=attempt,
                frozenProductionCommit=BASE, frozenProductionTree=BASE_TREE,
                unchangedBuildRoots=roots, originalComposerSHA256=COMPOSER_SHA,
                productionForkTree=FORK, optionalSupplierCommit=SUPPLIER,
                optionalForkTree=OPTIONAL, frozenProductionOffComposedTree=ORIGINAL_OFF_TREE,
                actualGoTestsPassed=False, sourceOnly=True, pressureAuthorized=False,
                nodeStarted=False, authorityGranted=False)


def strict_stream(path, required, package):
    rows = [json.loads(line, object_pairs_hook=unique) for line in path.read_bytes().splitlines()]
    require(rows and all(isinstance(r, dict) and isinstance(r.get('Action'), str) for r in rows),
            'missing original Go event stream')
    require(not any(r['Action'] in ('fail', 'build-fail', 'skip') for r in rows),
            'original Go failure/skip cannot qualify')
    started = False
    for row in rows:
        if 'Test' in row:
            require(row.get('Package') == package, 'test event lacks its exact original package')
        if 'Package' in row:
            require(row['Package'] == package, 'foreign Go package')
        if row.get('Action') == 'build-output':
            require(not started and set(row) == {'ImportPath', 'Action', 'Output'} and
                    row['ImportPath'] == package + '.test' and type(row['Output']) is str and row['Output'],
                    'foreign build diagnostic')
        else:
            started = True
    names = {r['Test'] for r in rows if r['Action'] == 'run' and 'Test' in r and '/' not in r['Test']}
    require(names == set(required) and len(required) == len(set(required)), 'unexpected/missing top-level Go test')
    all_names = {r['Test'] for r in rows if 'Test' in r}
    for name in all_names:
        runs = [r for r in rows if r.get('Test') == name and r['Action'] == 'run']
        outcomes = [r['Action'] for r in rows if r.get('Test') == name and r['Action'] in ('pass', 'fail', 'skip')]
        require(len(runs) == 1 and outcomes == ['pass'], 'Go test was not uniquely run/pass')
    require([r['Action'] for r in rows if 'Test' not in r and r.get('Package') == package and
             r['Action'] in ('pass', 'fail', 'skip')] == ['pass'], 'Go package did not uniquely pass')
    return dict(requiredPassed=required, topCases=len(names), childCases=len(all_names)-len(names), **pin(path))


def seal(root, temp, environment):
    ledger = load(temp / 'wire-live-7c25-controller.json')
    require(ledger == source_ledger(root, environment), 'controller source changed during original tests')
    candidates = list(temp.glob('wire-live-source-*/SOURCE.json'))
    require(len(candidates) == 1, 'one original normal composer result required')
    source_path = candidates[0]
    source = load(source_path)
    require(source.get('version') == 'YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1' and
            source.get('sourceCommit') == ledger['ciControllerCommit'] and
            source.get('sourceTree') == ledger['ciControllerTree'] and
            source.get('productionForkTree') == FORK and source.get('optionalForkCommit') == SUPPLIER and
            source.get('optionalForkTree') == OPTIONAL and source.get('buildTags') == ['ynx_live_wire_observation'],
            'actual normal tagged source identity differs')
    for key in ('sourceOnly', 'actualKernelAndPrivateControlTests', 'actualPreStartNodeGetter'):
        require(source.get(key) is True, 'normal source check is absent')
    for key in ('actualRunningWindow', 'physicalBytesMeasured', 'carrierEnabled', 'productionForkModified', 'publicActivation'):
        require(source.get(key) is False, 'unexpected runtime or carrier claim')
    require(source.get('nodeProcessesStarted') == 0, 'node process was started')
    selection_path = source_path.parent / 'composition/SOURCE-SELECTION.json'
    selection = load(selection_path)
    prepared = source.get('preparedSourceSelection', {})
    require(prepared.get('sourceSelection') == selection and
            prepared.get('receiptSHA256') == pin(selection_path)['sha256'] and
            prepared.get('receiptBytes') == pin(selection_path)['bytes'],
            'original source-selection bytes differ from the composer result')
    expected_selection = dict(version='YNX-WIRE-LIVE-EXACT-SOURCE-SELECTION/v1',
        originalSourceCommit=ledger['ciControllerCommit'], originalSourceTree=ledger['ciControllerTree'],
        originalProductionForkTree=FORK, selectedOptionalForkCommit=SUPPLIER,
        selectedOptionalForkTree=OPTIONAL, buildTags=['ynx_live_wire_observation'],
        fakeVCSIdentity=False, originalCheckoutWritten=False, originalModuleDescriptorsChanged=False,
        sourceOnly=True, nodeStarted=False, carrierEnabled=False, publicActivation=False)
    require(all(type(selection.get(key)) is type(value) and selection[key] == value
                for key, value in expected_selection.items()), 'original selection contract differs')
    spec = importlib.util.spec_from_file_location('original_composer', root / COMPOSER)
    composer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(composer)
    require(composer.LIVE == LIVE and len(composer.LOSSLESS_BUDGET) == 24, 'original mandatory names differ')
    output = source_path.parent
    checks = {}
    for name, required, package in (
            ('normal-live-caller', LIVE, 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'),
            ('original-peer-budget', composer.LOSSLESS_BUDGET, 'github.com/cometbft/cometbft/mempool')):
        checks[name] = strict_stream(output / (name + '.jsonl'), required, package)
        result = load(output / (name + '.result.json'))
        require(type(result.get('returnCode')) is int and result['returnCode'] == 0 and result.get('timedOut') is False and
                result.get('validationPassed') is True and result.get('firstFailure') is None and
                set(result.get('requiredPassed', [])) == set(required), 'original Go result did not pass')
        require(result['stdout']['sha256'] == checks[name]['sha256'] and
                result['stdout']['bytes'] == checks[name]['bytes'], 'original result/stream pin differs')
    # The original SOURCE and selection remain unchanged and identify the real
    # CI controller, never an invented run at the frozen production commit.
    return dict(schema='YNX-WIRE-LIVE-7C25-EXACT-ROOTS-QUALIFICATION/v1',
                controller=ledger, normalSource=pin(source_path),
                sourceSelection=pin(output / 'composition/SOURCE-SELECTION.json'),
                streams=checks, sameFrozenProductionBuildRoots=True,
                qualifiedOptionalSourceOnly=True, actual7cCommitRun=False,
                actualRunningWindow=False, carrierEnabled=False,
                pressureAuthorized=False, authorityGranted=False)


def job_text(workflow, name):
    start = workflow.index('  ' + name + ':\n')
    match = re.search(r'^  [A-Za-z0-9_-]+:\n', workflow[start+3:], re.M)
    return workflow[start:start+3+match.start()] if match else workflow[start:]


def original_projection(workflow):
    text = workflow
    for step in NEW_STEPS:
        require(text.count(step) == 1, 'exact qualification step missing/duplicated')
        text = text.replace(step, '')
    for line in UPLOAD_LINES:
        require(text.count(line) == 1, 'exact qualification artifact missing/duplicated')
        text = text.replace(line, '')
    for change in reversed(TRANSFORMS):
        if isinstance(change[2], int):
            old, new, count = change
            require(text.count(new) == count, 'exact routing transform differs')
            text = text.replace(new, old)
        else:
            name, old, new = change
            section = job_text(text, 'client-observations' if name in ('client-depth', 'client-cache') else name)
            require(section.count(new) == 1, 'exact owned job guard differs')
            text = text.replace(section, section.replace(new, old), 1)
    require(digest(text.encode()) == ORIGINAL_WORKFLOW_SHA, 'pre-existing workflow bytes changed')
    return text


def condition(workflow, job):
    text = job_text(workflow, job)
    match = re.search(r'^    if: (.*)\n', text, re.M)
    if not match:
        return 'true'
    if match[1] != '>-':
        return match[1]
    return ' '.join(re.findall(r'^      (.*)$', text[match.end():].split('    runs-on:', 1)[0], re.M))


def evaluate(expression, event, ref, base, changed=True):
    values = {'github.event_name':event, 'github.ref':ref, 'github.base_ref':base,
              'needs.contract-tooling-scope.outputs.client_changed':'true' if changed else 'false',
              'needs.contract-tooling-scope.outputs.changed':'false',
              'needs.contract-tooling-scope.outputs.integration_changed':'false'}
    for key, value in values.items(): expression=expression.replace(key,repr(value))
    expression=expression.replace('&&',' and ').replace('||',' or ')
    expression=re.sub(r'!(?!=)', ' not ', expression).strip()
    if expression == 'true': return True
    return bool(eval(expression, {'__builtins__':{}}, {}))


class QualificationControls(unittest.TestCase):
    workflow = None

    def test_exact_legacy_projection(self):
        original_projection(self.workflow)
        for changed in (self.workflow.replace('timeout-minutes: 8','timeout-minutes: 9',1),
                        self.workflow.replace('run: python3 -B scripts/verify/wire-live-matching-source-ci.py',
                                              'run: true',1),
                        self.workflow.replace(REF, REF+'-foreign',1)):
            with self.assertRaises(RuntimeError): original_projection(changed)

    def test_old_routes_and_closed_new_ref(self):
        original = original_projection(self.workflow)
        jobs=['contract-tooling-scope','verify','client-observations','lossless-default-source',
              'distributed-pq-source','lossless-matching-source','commit-observation','link-scope']
        old_refs=['refs/heads/codex/ynx-pq-perf-integration','refs/heads/codex/final-chain-core',
                  'refs/heads/codex/v5-link-native-ci','refs/heads/main','refs/heads/foreign']
        for event in ('push','pull_request','workflow_dispatch'):
            for ref in old_refs:
                for base in ('main','codex/ynx-pq-perf-integration'):
                    for changed in (True,False):
                        for name in jobs:
                            self.assertEqual(evaluate(condition(original,name),event,ref,base,changed),
                                             evaluate(condition(self.workflow,name),event,ref,base,changed))
        for event in ('push','pull_request','workflow_dispatch'):
            scope=evaluate(condition(self.workflow,'contract-tooling-scope'),event,REF,'main')
            self.assertEqual(scope,event=='push')
            for name in ('verify','lossless-default-source','distributed-pq-source',
                         'lossless-matching-source','commit-observation','link-scope'):
                self.assertFalse(evaluate(condition(self.workflow,name),event,REF,'main'))
        self.assertFalse(evaluate(condition(self.workflow,'contract-tooling-scope'),'push',REF+'-foreign','main'))

    def fake_source(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name);(root/COMPOSER).parent.mkdir(parents=True);(root/COMPOSER).write_bytes(b'composer')
        head='a'*40
        table={('rev-parse','HEAD'):head,('show','-s','--format=%P','HEAD'):BASE,
               ('status','--porcelain','--untracked-files=normal'):'',
               ('diff','--name-only',BASE,'HEAD'):'\n'.join(sorted(ALLOWED)),
               ('rev-parse','HEAD^{tree}'):'b'*40}
        table.update({('rev-parse','HEAD:'+p):v for p,v in ROOTS.items()})
        table.update({('ls-tree','HEAD','--',p):'100644 blob '+'c'*40+'\t'+p for p in ALLOWED})
        environment=dict(GITHUB_EVENT_NAME='push',GITHUB_REF=REF,GITHUB_SHA=head,GITHUB_RUN_ID='1',GITHUB_RUN_ATTEMPT='1')
        return root,table,environment

    def test_source_ledger_and_refusals(self):
        root,table,env=self.fake_source()
        read=lambda _,*args:(table[args]+'\n').encode()
        with patch.dict(globals(),COMPOSER_SHA=digest(b'composer')):
            result=source_ledger(root,env,read)
            self.assertFalse(result['actualGoTestsPassed']);self.assertFalse(result['authorityGranted'])
            for key,value in [('GITHUB_REF',REF+'-foreign'),('GITHUB_EVENT_NAME','workflow_dispatch'),
                              ('GITHUB_SHA',BASE),('GITHUB_RUN_ID','0')]:
                with self.subTest(key=key),self.assertRaises(RuntimeError):source_ledger(root,dict(env,**{key:value}),read)
            for key,value in [(('show','-s','--format=%P','HEAD'),'d'*40),
                              (('diff','--name-only',BASE,'HEAD'),'\n'.join(ALLOWED)+'\ninternal/consensus/state.go'),
                              (('status','--porcelain','--untracked-files=normal'),' M go.mod'),
                              (('rev-parse','HEAD:cmd'),'d'*40),
                              (('ls-tree','HEAD','--',SCRIPT),'100755 blob '+'c'*40+'\t'+SCRIPT)]:
                old=table[key];table[key]=value
                with self.subTest(key=key),self.assertRaises(RuntimeError):source_ledger(root,env,read)
                table[key]=old
        with self.assertRaises(RuntimeError):source_ledger(root,env,read)

    def test_cache_disabled_only_for_exact_qualification_ref(self):
        client=job_text(self.workflow,'client-observations')
        expected="          cache: ${{ github.ref != '"+REF+"' }}\n"
        self.assertEqual(client.count(expected),1)
        self.assertEqual(client.count('    timeout-minutes: 8\n'),1)
        self.assertIn("fetch-depth: ${{ github.ref == '"+REF+"' && 4 || 1 }}",client)
        for ref in (REF,REF+'-foreign','refs/heads/main','refs/heads/codex/ynx-pq-perf-integration'):
            self.assertEqual(evaluate("github.ref != '"+REF+"'",'push',ref,'main'),ref!=REF)
        with self.assertRaises(RuntimeError):
            original_projection(self.workflow.replace(expected,'          cache: false\n',1))
        with self.assertRaises(RuntimeError):
            original_projection(self.workflow.replace('&& 4 || 1','&& 3 || 1',1))

    def test_known_cache_successor_and_only_exact_ancestry(self):
        root,table,env=self.fake_source()
        table[('show','-s','--format=%P','HEAD')]=CACHE_PARENT
        table[('show','-s','--format=%P',CACHE_PARENT)]=BASE
        table[('rev-parse',CACHE_PARENT+'^{tree}')]=CACHE_PARENT_TREE
        read=lambda _,*args:(table[args]+'\n').encode()
        with patch.dict(globals(),COMPOSER_SHA=digest(b'composer')):
            result=source_ledger(root,env,read)
            self.assertEqual(result['frozenProductionCommit'],BASE)
            self.assertFalse(result['actualGoTestsPassed'])
            for key,value in [(('show','-s','--format=%P','HEAD'),'d'*40),
                              (('show','-s','--format=%P','HEAD'),BASE+' '+CACHE_PARENT),
                              (('show','-s','--format=%P',CACHE_PARENT),'d'*40),
                              (('rev-parse',CACHE_PARENT+'^{tree}'),'d'*40),
                              (('diff','--name-only',BASE,'HEAD'),SCRIPT),
                              (('rev-parse','HEAD:third_party'),'d'*40)]:
                old=table[key];table[key]=value
                with self.subTest(key=key),self.assertRaises(RuntimeError):source_ledger(root,env,read)
                table[key]=old

    def test_reused_pq_lab_prerequisite_has_no_downstream_live_input(self):
        client=job_text(self.workflow,'client-observations')
        marker='      - name: Verify normal PQ lab producers and the original proof caller\n'
        block=client.split(marker,1)[1].split('      - name:',1)[0]
        self.assertTrue(block.startswith("        if: github.ref != '"+REF+"'\n"))
        for ref in (REF,REF+'-foreign','refs/heads/main','refs/heads/codex/ynx-pq-perf-integration'):
            self.assertEqual(evaluate("github.ref != '"+REF+"'",'push',ref,'main'),ref!=REF)
        later=client.split(marker,1)[1].split('      - name:',1)[1]
        for name in ('YNX_PQ_LAB_PROOF_FIXTURE_OUT','YNX_PQ_LAB_STOPPED_FIXTURE_ROOT',
                     'YNX_PQ_LAB_LIVE_FIXTURE_ROOT','pq-lab-core-tests.jsonl','pq-lab-live-tests.jsonl',
                     'pq-lab-command-tests.jsonl','pq-proof-history-tests.jsonl'):
            self.assertIn(name,block)
            self.assertNotIn(name,later)
        self.assertNotIn('GITHUB_ENV',block)
        self.assertNotIn('GITHUB_OUTPUT',block)
        self.assertIn('      - name: Verify exact optional live getter composition without enabling a carrier\n        run:',client)
        with self.assertRaises(RuntimeError):
            original_projection(self.workflow.replace(marker+"        if: github.ref != '"+REF+"'\n",marker+'        if: false\n',1))

    def test_known_prerequisite_successor_keeps_complete_ancestry(self):
        root,table,env=self.fake_source()
        table[('show','-s','--format=%P','HEAD')]=PREREQUISITE_PARENT
        table[('show','-s','--format=%P',PREREQUISITE_PARENT)]=CACHE_PARENT
        table[('rev-parse',PREREQUISITE_PARENT+'^{tree}')]=PREREQUISITE_PARENT_TREE
        table[('show','-s','--format=%P',CACHE_PARENT)]=BASE
        table[('rev-parse',CACHE_PARENT+'^{tree}')]=CACHE_PARENT_TREE
        read=lambda _,*args:(table[args]+'\n').encode()
        with patch.dict(globals(),COMPOSER_SHA=digest(b'composer')):
            result=source_ledger(root,env,read)
            self.assertEqual(result['frozenProductionCommit'],BASE)
            for key,value in [(('show','-s','--format=%P','HEAD'),'d'*40),
                              (('show','-s','--format=%P',PREREQUISITE_PARENT),BASE),
                              (('show','-s','--format=%P',PREREQUISITE_PARENT),CACHE_PARENT+' '+BASE),
                              (('rev-parse',PREREQUISITE_PARENT+'^{tree}'),'d'*40),
                              (('show','-s','--format=%P',CACHE_PARENT),'d'*40),
                              (('rev-parse',CACHE_PARENT+'^{tree}'),'d'*40),
                              (('diff','--name-only',BASE,'HEAD'),SCRIPT),
                              (('rev-parse','HEAD:internal'),'d'*40)]:
                old=table[key];table[key]=value
                with self.subTest(key=key),self.assertRaises(RuntimeError):source_ledger(root,env,read)
                table[key]=old

    def test_go_stream_rejects_missing_duplicate_child_failure_skip_foreign(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'original.jsonl';p='example/pkg';names=['TestOne','TestTwo']
            rows=[dict(Action='start',Package=p)]
            for name in ('TestOne','TestOne/child','TestTwo'):
                rows.extend([dict(Action='run',Package=p,Test=name),dict(Action='pass',Package=p,Test=name)])
            rows.append(dict(Action='pass',Package=p))
            def write(rs):path.write_text(''.join(json.dumps(r)+'\n' for r in rs))
            write(rows);self.assertEqual(strict_stream(path,names,p)['childCases'],1)
            variants=[rows[:-1],rows+rows[1:3],rows[0:1]+rows[3:],
                      [dict(r,Action='fail') if r.get('Test')=='TestOne/child' and r['Action']=='pass' else r for r in rows],
                      [dict(r,Action='skip') if r.get('Test')=='TestTwo' and r['Action']=='pass' else r for r in rows],
                      rows+[dict(Action='build-fail',ImportPath=p)],rows+[dict(Action='pass',Package='foreign')],
                      [dict(Action=r['Action'],Test=r['Test']) if 'Test' in r else r for r in rows],
                      rows+[dict(Action='build-output',ImportPath=p+'.test',Output='diagnostic')]]
            for rs in variants:
                write(rs)
                with self.assertRaises(RuntimeError):strict_stream(path,names,p)



    def test_seal_binds_actual_controller_not_frozen_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);temp=root/'runner';temp.mkdir()
            output=temp/'wire-live-source-public';output.mkdir();(output/'composition').mkdir()
            ledger=dict(ciControllerCommit='a'*40,ciControllerTree='b'*40)
            write_once(temp/'wire-live-7c25-controller.json',ledger)
            source=dict(version='YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1',
                        sourceCommit=ledger['ciControllerCommit'],sourceTree=ledger['ciControllerTree'],
                        productionForkTree=FORK,optionalForkCommit=SUPPLIER,optionalForkTree=OPTIONAL,
                        buildTags=['ynx_live_wire_observation'],sourceOnly=True,
                        actualKernelAndPrivateControlTests=True,actualPreStartNodeGetter=True,
                        actualRunningWindow=False,physicalBytesMeasured=False,carrierEnabled=False,
                        productionForkModified=False,publicActivation=False,nodeProcessesStarted=0)
            budget=['TestBudgetPure'+str(i) for i in range(24)]
            for name, required, package in [('normal-live-caller',LIVE,'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'),
                                            ('original-peer-budget',budget,'github.com/cometbft/cometbft/mempool')]:
                events=[dict(Action='start',Package=package)]
                for test in required:
                    events += [dict(Action='run',Package=package,Test=test),dict(Action='pass',Package=package,Test=test)]
                events += [dict(Action='pass',Package=package)]
                path=output/(name+'.jsonl');path.write_text(''.join(json.dumps(e)+'\n' for e in events))
                write_once(output/(name+'.result.json'),dict(returnCode=0,timedOut=False,validationPassed=True,
                                                           firstFailure=None,requiredPassed=required,stdout=pin(path)))
            selection=dict(version='YNX-WIRE-LIVE-EXACT-SOURCE-SELECTION/v1',
                originalSourceCommit=ledger['ciControllerCommit'],originalSourceTree=ledger['ciControllerTree'],
                originalProductionForkTree=FORK,selectedOptionalForkCommit=SUPPLIER,selectedOptionalForkTree=OPTIONAL,
                buildTags=['ynx_live_wire_observation'],fakeVCSIdentity=False,originalCheckoutWritten=False,
                originalModuleDescriptorsChanged=False,sourceOnly=True,nodeStarted=False,carrierEnabled=False,publicActivation=False)
            selection_path=output/'composition/SOURCE-SELECTION.json';selection_path.write_text(json.dumps(selection))
            source['preparedSourceSelection']=dict(sourceSelection=selection,receiptSHA256=pin(selection_path)['sha256'],
                                                   receiptBytes=pin(selection_path)['bytes'])
            source_path=output/'SOURCE.json';source_path.write_text(json.dumps(source))
            module=SimpleNamespace(LIVE=LIVE,LOSSLESS_BUDGET=budget)
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _:None))
            with patch(__name__+'.source_ledger',return_value=ledger), \
                 patch('importlib.util.spec_from_file_location',return_value=spec), \
                 patch('importlib.util.module_from_spec',return_value=module):
                result=seal(root,temp,{})
                self.assertTrue(result['qualifiedOptionalSourceOnly'])
                self.assertFalse(result['actual7cCommitRun'])
                self.assertFalse(result['pressureAuthorized'])
                for key,value in [('sourceCommit',BASE),('optionalForkTree',FORK),
                                  ('buildTags',['ynx_live_wire_observation','ynx_lossless_hex']),
                                  ('carrierEnabled',True),('actualRunningWindow',True)]:
                    source_path.write_text(json.dumps(dict(source,**{key:value})))
                    with self.subTest(key=key),self.assertRaises(RuntimeError):seal(root,temp,{})
                source_path.write_text(json.dumps(source))
                result_path=output/'normal-live-caller.result.json'
                original=load(result_path);result_path.write_text(json.dumps(dict(original,returnCode=False)))
                with self.assertRaises(RuntimeError):seal(root,temp,{})


def main():
    parser=argparse.ArgumentParser(allow_abbrev=False)
    modes=parser.add_mutually_exclusive_group(required=True)
    for name in ('self-test','source-ledger','seal-evidence'):modes.add_argument('--'+name,action='store_true')
    parser.add_argument('--workflow',type=Path)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    if args.self_test:
        QualificationControls.workflow=(args.workflow or root/WORKFLOW).read_text()
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(QualificationControls)
        result=unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    temp=Path(os.environ['RUNNER_TEMP'])
    require(temp.is_absolute() and temp.resolve(strict=True)==temp, 'original canonical runner temp required')
    if args.source_ledger:
        write_once(temp/'wire-live-7c25-controller.json',source_ledger(root,os.environ))
    else:
        write_once(temp/'wire-live-7c25-qualification.json',seal(root,temp,os.environ))
    print('YNX_WIRE_LIVE_7C25_SOURCE_ONLY no_window=true carrier=false authority=false')

if __name__=='__main__':main()
