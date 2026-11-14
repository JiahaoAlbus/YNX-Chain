"""Pure original-format controls. Synthetic callbacks/ZIPs are NOT a live run."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


reader = module('pq-same-runner-pair-readback')
fixtures = module('test_pq_first100_held_readback')
scheduler = module('pq-independent-scheduler')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as target:
        for name, raw in files.items():
            target.writestr(name, raw)
    return output.getvalue()


class PairFixture:
    """Use original Ledger, held archive fixture and real stage validators."""
    controller = 'e' * 40

    def __init__(self):
        self.pair = dict(schema=reader.SCHEMA, pairID='f'*64, controllerCommit=self.controller,
            runID=1, jobID=2, runAttempt=1, runnerID=9, runnerName='synthetic-hosted-runner',
            clock=dict(kind='CLOCK_MONOTONIC', bootIDSHA256='9'*64,
                       coordinatorPID=100, coordinatorStartTicks=200), arms=[])
        self.files, self.markers, self.expected, self.prefixes = {}, {}, {}, {}
        for j, arm in enumerate(reader.ARMS):
            work_name = 'pq-independent-load-' + arm + '001'
            prefix = self.prefixes[arm] = work_name + '/public/'
            raw = fixtures.HeldCheckpointReadbackTests().fixture(height=19)[0]
            with zipfile.ZipFile(io.BytesIO(raw)) as source:
                files = {name.replace('fixture/public/', prefix): source.read(name) for name in source.namelist()}
            self.files[arm] = files
            start = 1_000_000_000_000 + j * 100_000_000_000
            self.markers[arm] = dict(schema=reader.MARKER, arm=arm, workDirectoryName=work_name,
                **{k: copy.deepcopy(self.pair[k]) for k in
                   ('pairID', 'runID', 'jobID', 'runAttempt', 'controllerCommit', 'clock')},
                startedMonotonicNs=start, cleanupCompletedMonotonicNs=start+10_000_000_000)
            source = dict(commit=str(j+1)*40, tree=str(j+3)*40, forkTree='a'*40)
            tools = dict(commit=str(j+5)*40, tree=str(j+7)*40,
                         driverSHA256='b'*64, resourceGuardSHA256='c'*64)
            config = dict(profile='first100-held-public-owner', nodeCount=4, pressureLevel=1,
                source=source['commit'], sourceTree=source['tree'], tools=tools['commit'], toolsTree=tools['tree'],
                go='go1.26.11', options=dict(held_ready_only=False))
            config_pin = sha(encode(config))
            configuration = dict(configuration=config, configurationSHA256=config_pin, runtimePlanSHA256=None)
            files['pq-first100-held-plan.json'] = encode(configuration)
            self.put(arm, 'FIRST100-HELD-CI.json', dict(configuration, controllerCommit=self.controller))
            self.expected[arm] = dict(source=source['commit'], tools=tools['commit'], configurationSHA256=config_pin)
            self.pair['arms'].append(dict(arm=arm, source=source, tools=tools, configurationSHA256=config_pin))
            plan = scheduler.make_plan(str(j+1)*64, str(j+3)*64, 'online',
                [dict(ownerIndex=i+4, address=f'CONTROL-{arm}-{i}', nextNonce=2, capacity=1)
                 for i in range(500)], 100, 5_000_000_000, 30_000_000_000)
            events = []
            ledger = scheduler.Ledger(plan, events.append)
            ledger.release(0)
            row, _ = ledger.reserve(0)
            tx = ('SYNTHETIC-CONTROL-' + arm).encode()
            for at, stage in enumerate(('signed', 'submitted', 'ack', 'included', 'unknown'), 1):
                ledger.event(dict(kind=stage, index=row['index'], id=row['id'], atNs=at,
                    hash=sha(tx), nativeHash='c'*64, error='original fixture UNKNOWN'))
            load = ledger.report(10, 'original fixture cutoff')
            load['originMonotonicNs'] = str(start+100)
            load['pipeline'] = dict(stageWorkers=dict(publish=2, observe=2, finalize=4),
                queueCapacity=dict(publish=4, observe=500, finalize=500),
                queuePeak=dict(publish=0, observe=0, finalize=0),
                queueAtCutoff=dict(publish=0, observe=0, finalize=0),
                completedByStage=dict(publish=0, observe=0, finalize=0),
                queueSamples=[], workerThreadsRetired=True)
            self.put(arm, 'load-plan.json', plan)
            journal = b''.join(encode(e)+b'\n' for e in events)
            files[prefix+'load-events-00000.jsonl'] = journal
            base = 'load-operations/00000/'
            files[prefix+base+'transaction.abci'] = tx
            self.put(arm, base+'submission-intent.json', dict(id=row['id'], operationId=row['operationId'],
                owner=row['ownerIndex'], nonce=str(row['nonce']), transactionHash=sha(tx),
                submissionAttempts=1, qualifiedFinal=False))
            self.put(arm, base+'four-node-inclusion.json', dict(qualifiedFinal=False, rows=[dict(
                height='19', hash=sha(tx), tx=base64.b64encode(tx).decode(), tx_result=dict(code=0))]*4))
            receipt = self.get(arm, 'receipt.json')
            for key in ('heldReadyOnlyComplete', 'preparationOnlyDemandAccounting'):
                receipt.pop(key, None)
            receipt.update(source=source, toolIdentity=tools, loadExecuted=True, normalLiveCalleeUsed=True,
                firstCause='original fixture cutoff', planSHA256=sha(encode(plan)), loadResult=load,
                journalSegments=[dict(path='load-events-00000.jsonl', bytes=len(journal), sha256=sha(journal))],
                loadConditions=dict(accounts=500, rate=100, seconds=5, tailSeconds=30),
                caps=dict(rssBytes=4 << 30), normalHelperLifecycle=dict(cleanupDebt=[]))
            for group in (receipt['processes'], receipt['normalNodeCleanExit']['records']):
                for proc in group:
                    proc['startTicks'] += j * 1000
            hardware = dict(status='OBSERVED', system='Linux', machine='x86_64', cpuModels=['CONTROL-CPU'],
                kernelRelease='CONTROL-KERNEL', effectiveAffinity=[0, 1], hostMemTotalBytes=16 << 30,
                filesystem=dict(type='ext4', fragmentBytes=4096))
            admission = dict(observedMonotonicNs=start+1, availableMemoryBytes=8 << 30,
                freeDiskBytes=16 << 30, conflictingHeavyProcesses=[], caps=receipt['caps'])
            receipt.update(runtimeHardware=hardware, freshResourceAdmission=admission)
            self.put(arm, 'runtime-hardware.json', hardware)
            self.put(arm, 'fresh-resource-admission.json', admission)
            self.put(arm, 'receipt.json', receipt)
            request = self.get(arm, 'requested-load.json')
            request['source'] = source
            self.put(arm, 'requested-load.json', request)

    def get(self, arm, name):
        return json.loads(self.files[arm][self.prefixes[arm]+name])

    def put(self, arm, name, value):
        self.files[arm][self.prefixes[arm]+name] = encode(value)

    def package(self):
        raws = {}
        for declaration in self.pair['arms']:
            arm = declaration['arm']
            files, marker = self.files[arm], self.markers[arm]
            prefix = self.prefixes[arm]
            for field, name in (('receipt', 'receipt.json'), ('loadPlan', 'load-plan.json')):
                path = prefix+name
                marker[field] = dict(path=path, sha256=sha(files[path]), bytes=len(files[path]))
            self.put(arm, 'SAME-RUNNER-ARM.json', marker)
            raw_marker = files[prefix+'SAME-RUNNER-ARM.json']
            declaration['marker'] = dict(path=prefix+'SAME-RUNNER-ARM.json',
                                         sha256=sha(raw_marker), bytes=len(raw_marker))
            raws[arm] = archive(files)
            declaration['archive'] = dict(sha256=sha(raws[arm]), bytes=len(raws[arm]))
        raws['manifest'] = archive({'same-runner-pair.json': encode(self.pair)})
        run = dict(id=1, event='workflow_dispatch', run_attempt=1, head_sha=self.controller,
            head_branch=reader.BRANCH, repository=dict(full_name='JiahaoAlbus/YNX-Chain'),
            path='.github/workflows/pq-normal-process.yml', status='completed', conclusion='failure')
        job = dict(id=2, run_id=1, run_attempt=1, head_sha=self.controller, name=reader.JOB,
            status='completed', conclusion='failure', runner_id=9, runner_name='synthetic-hosted-runner',
            steps=[dict(name='Preserve same-runner '+arm+' originals', conclusion='success') for arm in raws])
        artifacts = dict(artifacts=[dict(id=10+i, name=f'pq-first100-same-runner-1-1-{arm}',
            expired=False, digest='sha256:'+sha(raw), size_in_bytes=len(raw),
            workflow_run=dict(id=1, head_sha=self.controller, head_branch=reader.BRANCH))
            for i, (arm, raw) in enumerate(raws.items())])
        return raws, [run, job, artifacts]

    def read(self):
        raws, metadata = self.package()
        return read(raws, metadata, self.expected)


def read(raws, metadata, expected):
    return reader.inspect(raws['manifest'], raws['before'], raws['after'], metadata=metadata,
        controller=PairFixture.controller, manifest_sha256=sha(raws['manifest']), expected=expected)


class SameRunnerPairReadbackTests(unittest.TestCase):
    def test_real_reducers_keep_unknown_full500_missing_timings_and_four_node_separation(self):
        result = PairFixture().read()
        self.assertTrue(result['sameActionsJobAndRunnerBound'])
        self.assertTrue(result['sameReportedConditions'])
        self.assertFalse(result['throughputGainAttributed'])
        self.assertFalse(result['pressureAuthorized'])
        self.assertFalse(result['canonicalInputEqualityProven'])
        self.assertEqual(result['actionsOrigin']['jobConclusion'], 'failure')
        for arm in reader.ARMS:
            report = result[arm]
            load = report['originalLoadResult']
            self.assertEqual((load['configuredDemand'], load['submitted'], load['qualified']), (500, 1, 0))
            self.assertEqual(load['rows'][0]['status'], 'unknown')
            self.assertEqual(load['accountState'][0]['pending'], 0)
            self.assertEqual(load['accountState'][0]['nextNonce'], 2)
            self.assertIsNone(load['submitToQualifiedReceiptObserved']['p95Ms'])
            self.assertEqual(report['firstCause'], 'original fixture cutoff')
            self.assertFalse(report['archiveOriginIndependentlyVerified'])
            self.assertEqual(set(report['businessStageCostsByNode']), set(map(str, range(4))))
            for node in report['businessStageCostsByNode'].values():
                fee = node['feeHistoryMaterialization']
                self.assertEqual(fee['timing']['observedMedianNs'], 3)
                self.assertIsNone(fee['timing']['retainedSampleP95Ns'])
                self.assertIsNone(fee['records'][0]['materializedEventCount'])
                self.assertIsNone(fee['copyOnlyElapsedNs'])

    def test_wrong_actions_bindings_reject_before_any_arm_parser(self):
        fixture = PairFixture()
        raws, original = fixture.package()
        mutations = [lambda m: m[0].update(run_attempt=2), lambda m: m[0].update(head_sha='0'*40),
            lambda m: m[1].update(run_id=2), lambda m: m[1].update(name='ordinary held job'),
            lambda m: m[1]['steps'][0].update(conclusion='failure'),
            lambda m: m[2]['artifacts'][0].update(digest='sha256:'+'0'*64),
            lambda m: m[2]['artifacts'][0]['workflow_run'].update(id=2),
            lambda m: m[2]['artifacts'][0].update(expired=True),
            lambda m: m[2]['artifacts'][0].update(id=m[2]['artifacts'][1]['id'])]
        for mutation in mutations:
            metadata = copy.deepcopy(original)
            mutation(metadata)
            with self.subTest(mutation=mutation), mock.patch.object(reader.held, 'inspect') as arm_parser:
                with self.assertRaises(RuntimeError): read(raws, metadata, fixture.expected)
                arm_parser.assert_not_called()

    def test_substituted_manifest_or_expected_source_does_not_pass(self):
        fixture = PairFixture()
        raws, metadata = fixture.package()
        with self.assertRaisesRegex(RuntimeError, 'externally pinned'):
            reader.inspect(raws['manifest'], raws['before'], raws['after'], metadata=metadata,
                controller=fixture.controller, manifest_sha256='0'*64, expected=fixture.expected)
        fixture.expected['after']['source'] = '0'*40
        with self.assertRaisesRegex(RuntimeError, 'source/tools'): fixture.read()

    def test_full_original_source_and_driver_identity_cannot_be_stripped(self):
        for name, key in (('source', 'forkTree'), ('tools', 'driverSHA256'), ('tools', 'resourceGuardSHA256')):
            fixture = PairFixture()
            fixture.pair['arms'][1][name].pop(key)
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'business arm receipt'):
                fixture.read()

    def test_arm_clock_order_boot_runner_and_coordinator_binding(self):
        changes = [lambda f: f.markers['after'].update(startedMonotonicNs=f.markers['before']['cleanupCompletedMonotonicNs']),
            lambda f: f.markers['after']['clock'].update(bootIDSHA256='0'*64),
            lambda f: f.markers['after']['clock'].update(coordinatorPID=101),
            lambda f: f.pair.update(runnerID=10),
            lambda f: f.markers['after'].update(arm='before')]
        for change in changes:
            fixture = PairFixture(); change(fixture)
            with self.subTest(change=change), self.assertRaises(RuntimeError): fixture.read()

    def test_accounts_and_network_plan_cannot_be_shared(self):
        for key in ('accounts', 'networkPlanSHA256', 'workloadSHA256'):
            fixture = PairFixture()
            plan = fixture.get('after', 'load-plan.json')
            plan[key] = fixture.get('before', 'load-plan.json')[key]
            fixture.put('after', 'load-plan.json', plan)
            receipt = fixture.get('after', 'receipt.json')
            receipt['planSHA256'] = sha(encode(plan))
            fixture.put('after', 'receipt.json', receipt)
            with self.subTest(key=key), self.assertRaises(RuntimeError): fixture.read()

    def test_directory_reuse_private_files_and_missing_arm_cannot_be_bound(self):
        fixture = PairFixture()
        before, after = (fixture.prefixes[a] for a in reader.ARMS)
        fixture.files['after'] = {n.replace(after, before): raw for n, raw in fixture.files['after'].items()}
        fixture.prefixes['after'] = before
        fixture.markers['after']['workDirectoryName'] = fixture.markers['before']['workDirectoryName']
        with self.assertRaisesRegex(RuntimeError, 'directory reused'): fixture.read()
        fixture = PairFixture()
        fixture.files['before']['.private/recovery.raw'] = b'SYNTHETIC-NOT-A-KEY'
        with self.assertRaisesRegex(RuntimeError, 'public subtree'): fixture.read()
        fixture = PairFixture()
        fixture.pair['arms'].pop()
        raws, metadata = PairFixture().package()
        # Preserve two arm bytes but independently authenticate a partial manifest.
        raws['manifest'] = archive({'same-runner-pair.json': encode(fixture.pair)})
        manifest = next(a for a in metadata[2]['artifacts'] if a['name'].endswith('-manifest'))
        manifest.update(digest='sha256:'+sha(raws['manifest']), size_in_bytes=len(raws['manifest']))
        with self.assertRaisesRegex(RuntimeError, 'two complete'): read(raws, metadata, fixture.expected)

    def test_cleanup_debt_exit_failure_and_reused_process_cannot_start_a_pair(self):
        for kind in ('cleanup', 'debt', 'cold_debt', 'worker', 'node', 'process', 'reused'):
            fixture = PairFixture()
            arm = 'after' if kind == 'reused' else 'before'
            receipt = fixture.get(arm, 'receipt.json')
            if kind == 'cleanup': receipt['cleanupComplete'] = False
            elif kind == 'debt': receipt['normalHelperLifecycle']['cleanupDebt'] = ['original debt']
            elif kind == 'cold_debt': receipt['boundedColdSenderLifecycle'] = dict(cleanupDebt=['original debt'])
            elif kind == 'worker': receipt['loadResult']['pipeline']['workerThreadsRetired'] = False
            elif kind == 'node': receipt['processes'][0]['rawReturnCode'] = -9
            elif kind == 'process': receipt['processes'][0]['exited'] = False
            else:
                before = fixture.get('before', 'receipt.json')
                receipt['processes'] = before['processes']
                receipt['normalNodeCleanExit'] = before['normalNodeCleanExit']
            fixture.put(arm, 'receipt.json', receipt)
            with self.subTest(kind=kind), self.assertRaises(RuntimeError): fixture.read()

    def test_unknown_operation_cannot_be_imported_into_second_arm(self):
        fixture = PairFixture()
        operation = fixture.get('before', 'receipt.json')['loadResult']['rows'][0]['operationId']
        receipt = fixture.get('after', 'receipt.json')
        receipt['loadResult']['rows'][0]['operationId'] = operation
        fixture.put('after', 'receipt.json', receipt)
        intent = fixture.get('after', 'load-operations/00000/submission-intent.json')
        intent['operationId'] = operation
        fixture.put('after', 'load-operations/00000/submission-intent.json', intent)
        with self.assertRaisesRegex(RuntimeError, 'operation reused across arms'): fixture.read()

    def test_original_copies_and_full_demand_are_still_strict(self):
        for name, key, value in [('requested-load.json', 'accounts', 499),
            ('runtime-hardware.json', 'hostMemTotalBytes', 1),
            ('fresh-resource-admission.json', 'observedMonotonicNs', 1)]:
            fixture = PairFixture(); data = fixture.get('after', name); data[key] = value
            fixture.put('after', name, data)
            with self.subTest(name=name), self.assertRaises(RuntimeError): fixture.read()

    def test_same_job_different_cpu_or_config_never_becomes_same_conditions(self):
        fixture = PairFixture()
        receipt = fixture.get('after', 'receipt.json')
        receipt['runtimeHardware']['cpuModels'] = ['OTHER-CONTROL-CPU']
        receipt['loadConditions']['changed'] = True
        fixture.put('after', 'runtime-hardware.json', receipt['runtimeHardware'])
        fixture.put('after', 'receipt.json', receipt)
        report = fixture.read()
        self.assertFalse(report['sameReportedConditions'])
        self.assertEqual(report['hardwareDifferences'], ['cpuModels'])
        self.assertEqual(report['configurationDifferences'], ['conditions'])

    def test_mutated_original_stage_is_rejected_by_existing_validator(self):
        fixture = PairFixture()
        original = fixture.get('before', 'finalize-observation-node-0-original.json')
        original['observation']['samples'][0]['childrenNs']['seal.fee_materialize'] = -1
        fixture.put('before', 'finalize-observation-node-0-original.json', original)
        with self.assertRaises(RuntimeError): fixture.read()

    def test_legacy_single_arm_origin_does_not_accept_pair_metadata(self):
        fixture = PairFixture(); raws, metadata = fixture.package()
        with self.assertRaises(RuntimeError):
            reader.held.verify_archive_origin(*metadata, fixture.controller, sha(raws['before']), len(raws['before']))

    def test_cli_reads_local_originals_and_does_not_modify_inputs(self):
        fixture = PairFixture(); raws, metadata = fixture.package()
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            for arm, raw in raws.items(): (root/(arm+'.zip')).write_bytes(raw)
            for key, value in zip(('RUN.json', 'JOB.json', 'ARTIFACTS.json'), metadata):
                (root/key).write_bytes(encode(value))
            args = ['--manifest', str(root/'manifest.zip'), '--manifest-sha256', sha(raws['manifest']),
                    '--controller', fixture.controller, '--actions-metadata', str(root)]
            for arm in reader.ARMS:
                args += ['--'+arm+'-archive', str(root/(arm+'.zip'))]
                for flag, key in [('source', 'source'), ('tools', 'tools'), ('configuration-sha256', 'configurationSHA256')]:
                    args += ['--'+arm+'-'+flag, fixture.expected[arm][key]]
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            result = reader.main(args)
            self.assertEqual(result['status'], 'PAIRED_ORIGINALS_BOUND')
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})


if __name__ == '__main__':
    unittest.main()
