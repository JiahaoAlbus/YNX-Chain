"""Readback controls with synthetic archive metadata only."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('held_readback', Path(__file__).with_name('pq-first100-held-readback.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class HeldReadbackTests(unittest.TestCase):
    controller = 'e' * 40

    def test_pipeline_pressure_uses_sampled_queue_and_active_worker_boundaries(self):
        workers = dict(publish=2, observe=2, finalize=4)
        capacity = dict(publish=4, observe=500, finalize=500)
        load = dict(windowNs=5, pipeline=dict(
            stageWorkers=workers, queueCapacity=capacity, queuePeak=dict(publish=4, observe=0, finalize=1),
            queueAtCutoff=dict(publish=4, observe=0, finalize=1), completedByStage=workers,
            queueSamples=[dict(atNs=at, queued=dict(publish=4, observe=0, finalize=1),
                               activeWorkers=dict(publish=2, observe=0, finalize=4)) for at in (3, 5)]))
        pressure = reader.pipeline_pressure(load)
        self.assertEqual(pressure['stages']['publish']['fullQueueSamplesInWindow'], 1)
        self.assertEqual(pressure['stages']['finalize']['allWorkersActiveSamples'], 2)
        self.assertEqual(pressure['stages']['finalize']['returnedOrRaised'], 4)
        self.assertFalse(pressure['chainSaturationProven'])

    def test_parent_timing_binds_first_failure_to_original_owner_and_clock(self):
        def attempt(owner, returned):
            return dict(ownerIndex=owner, operationId='a'*64, operation='sign', code='UNKNOWN',
                        requestedMonotonicNs=110, streamAcquiredMonotonicNs=120,
                        commandRequestedMonotonicNs=140, replyReceivedMonotonicNs=150,
                        returnedMonotonicNs=returned)

        transport = dict(schema='YNX-PERF-PUBLIC-OWNER-TRANSPORT/v1', clock='parent_monotonic_ns',
                         attempted=3, retained=3, omitted=0, recordLimit=2048, records=[
                             attempt(5, 160), attempt(6, 160), attempt(5, 180)],
                         automaticRetry=False, authorityGranted=False)
        receipt = dict(normalPublicOwnerTransport=transport)
        first = dict(index=1, id='first', atNs=65)
        load = dict(originMonotonicNs='100', firstOperationalFailure=first, rows=[
            dict(index=1, id='first', ownerIndex=5, operationId='a'*64, submittedNs=None,
                 includedNs=None, finalNs=None)])
        timing = reader.public_owner_timing(receipt, load)
        failure = timing['firstOperationalFailure']
        self.assertEqual(len(failure['returnedAttempts']), 1)
        self.assertEqual(failure['returnedAttempts'][0]['stagesNs']['commandToReply'], 10)
        self.assertFalse(failure['submittedObserved'])
        self.assertFalse(failure['qualifiedObserved'])
        self.assertNotIn('confirm', timing['groups'])
        self.assertIsNone(reader.public_owner_timing({}, load))
        with self.assertRaisesRegex(RuntimeError, 'outside the cohort'):
            reader.public_owner_timing(receipt, dict(load, firstOperationalFailure=dict(first, id='other')))

    def test_stopped_proof_failure_requires_bound_request_and_exact_original_bytes(self):
        prefix = 'public/'
        path = 'load-operations/00000/original-live-proof-failure.json'
        failure = dict(Version='YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1', Sequence=1,
                       PolicySHA256='a'*64, Outcome='unknown', FirstCauseSHA256='b'*64)
        raw = encode(failure)
        files = {prefix + path: raw,
                 prefix + 'load-00000-live-session-request.json':
                     encode(dict(node=0, sequence=1, policySHA256='a'*64))}
        record = dict(index=0, node=0, sequence=1, status='RETAINED_AFTER_STOP', path=path, sha256=sha(raw))
        receipt = dict(cleanupComplete=True, stoppedLiveProofFailures=dict(records=[record], altersLoadResult=False))
        load = dict(configuredDemand=500, rows=[dict(index=0, status='unknown')])
        output = reader.stopped_proof_failures(receipt, load, files, prefix)
        self.assertEqual(output['records'][0]['originalFailure'], failure)
        self.assertEqual(output['records'][0]['originalCohortStatus'], 'unknown')
        self.assertIsNone(reader.stopped_proof_failures({}, load, files, prefix))
        with self.assertRaisesRegex(RuntimeError, 'digest differs'):
            reader.stopped_proof_failures(receipt, load, dict(files, **{prefix + path: b'{}'}), prefix)
        record['node'] = 2
        with self.assertRaisesRegex(RuntimeError, 'request binding differs'):
            reader.stopped_proof_failures(receipt, load, files, prefix)

    def test_pre_output_failure_readback_without_publish_ack_preserves_unknown(self):
        path = 'load-operations/00000/original-live-proof-pre-output-failure.json'
        row = dict(index=0, operationId='a'*64, hash='b'*64, nativeHash='c'*64, status='unknown')
        attempt = dict(node=2, sequence=1, policySHA256='d'*64, operationId=row['operationId'],
                       transactionSHA256=row['hash'], nativeWireHash=row['nativeHash'])
        marker = dict(version=reader.proof_readback.PRE_OUTPUT_FAILURE_VERSION, policySHA256='d'*64,
                      sequence=1, phase='current-source', outcome='unknown', firstCauseSHA256='e'*64)
        raw = encode(marker)
        files = {path: raw, 'load-operations/00000/live-proof-attempt.json': encode(attempt)}
        record = dict(index=0, node=2, sequence=1, status='FAILURE_NOT_SUPPLIED',
                      stoppedOutputEntries={}, originalRequestSHA256='f'*64,
                      preOutputFailure=dict(path=path, sha256=sha(raw)))
        receipt = dict(cleanupComplete=True, stoppedLiveProofFailures=dict(records=[record], altersLoadResult=False))
        load = dict(configuredDemand=500, rows=[row])
        actual = reader.stopped_proof_failures(receipt, load, files, '')['records'][0]
        self.assertEqual(actual['originalPreOutputFailure'], marker)
        self.assertEqual(actual['originalCohortStatus'], 'unknown')
        self.assertIsNone(actual['originalFailure'])
        wrong_slot = encode(dict(marker, sequence=2))
        record['preOutputFailure']['sha256'] = sha(wrong_slot)
        with self.assertRaisesRegex(RuntimeError, 'pre-output proof failure record differs'):
            reader.stopped_proof_failures(receipt, load, dict(files, **{path: wrong_slot}), '')

    def test_observation_rpc_preserves_counts_and_keeps_elapsed_intervals_separate(self):
        first = dict(node=0, method='tx', attempted=4, returned=1, raised=2, completed=3, inFlight=1)
        second = dict(node=1, method='tx', attempted=1, returned=1, raised=0, completed=1, inFlight=0)
        receipt = dict(normalObservationRPCTiming=dict(schema='YNX-PERF-PARENT-RPC-ELAPSED/v1',
                       clock='parent_monotonic_ns', groupLimit=12, intervalsOverlap=True,
                       independentFinality=False, businessSuccessInferred=False, groups=[first, second]))
        report = reader.observation_rpc(receipt)
        self.assertEqual(report['countsByMethod']['tx'],
                         dict(attempted=5, returned=2, raised=2, completed=4, inFlight=1))
        self.assertFalse(report['elapsedIntervalsAdded'])
        self.assertEqual(report['original']['groups'], [first, second])
        self.assertIsNone(reader.observation_rpc({}))
        second['node'] = 0
        with self.assertRaisesRegex(RuntimeError, 'duplicate'):
            reader.observation_rpc(receipt)
        second.update(node=1, completed=2)
        with self.assertRaisesRegex(RuntimeError, 'counters differ'):
            reader.observation_rpc(receipt)

    def test_actions_metadata_binds_attempt_job_and_archive_digest(self):
        branch = 'codex/ynx-pq-current75-baseline-20261101'
        run = dict(id=1, event='workflow_dispatch', run_attempt=1, head_sha=self.controller,
                   head_branch=branch, repository=dict(full_name='JiahaoAlbus/YNX-Chain'),
                   path='.github/workflows/pq-normal-process.yml', status='completed', conclusion='failure')
        job = dict(id=2, run_id=1, run_attempt=1, head_sha=self.controller, status='completed',
                   name='Held public-owner normal504 fixture', conclusion='failure',
                   steps=[dict(name='Preserve only original public receipts and streams', conclusion='success')])
        artifacts = dict(artifacts=[dict(id=3, name='pq-first100-held-public-owner-1-1',
                                       digest='sha256:'+'f'*64, size_in_bytes=10,
                                       workflow_run=dict(id=1, head_sha=self.controller, head_branch=branch))])
        origin = reader.verify_archive_origin(run, job, artifacts, self.controller, 'f'*64, 10)
        self.assertEqual(origin['jobConclusion'], 'failure')
        self.assertEqual(origin['artifact'], 3)
        with self.assertRaisesRegex(RuntimeError, 'artifact identity or bytes'):
            reader.verify_archive_origin(run, job, artifacts, self.controller, 'b'*64, 10)
        with self.assertRaisesRegex(RuntimeError, 'job identity'):
            reader.verify_archive_origin(run, dict(job, run_attempt=2), artifacts, self.controller, 'f'*64, 10)

    def test_peak_rss_preserves_overage_and_missing_process_samples(self):
        receipt = dict(peakRSSBytes=12, caps=dict(rssBytes=10), peakRSSSample=dict(rssBytes=12, processes=[
            dict(pid=1, startTicks=10, rssBytes=12), dict(pid=2, startTicks=11, rssBytes=None)]))
        resources = reader.readiness_resources(receipt)
        self.assertEqual(resources['rssHeadroomBytes'], -2)
        self.assertEqual(resources['unmeasuredProcessCount'], 1)
        receipt['peakRSSSample']['rssBytes'] = 13
        with self.assertRaisesRegex(RuntimeError, 'do not reconcile'):
            reader.readiness_resources(receipt)

    def test_resource_comparison_keeps_host_identity_and_business_scope_separate(self):
        hardware = dict(status='OBSERVED', system='Linux', machine='x86_64', cpuModels=['fixture'],
                        kernelRelease='fixture', effectiveAffinity=[0, 1], filesystem=dict(type='ext4'))
        before = dict(status='LOAD_RESULT_MISSING', fullCohort=None, toolchain='go1.26.11',
                      caps=dict(rssBytes=10), conditions=dict(accounts=500), hardware=hardware,
                      readinessResources=dict(readyProofLaneCount=3, peakRSSBytes=12))
        after = dict(before, status='READY_ONLY_OBSERVED',
                     readinessResources=dict(readyProofLaneCount=4, peakRSSBytes=8))
        comparison = reader.compare_readiness(before, after)
        self.assertEqual(comparison['observedPeakDifferenceBytes'], -4)
        self.assertTrue(comparison['sameReportedHostClass'])
        self.assertFalse(comparison['identicalPhysicalHostProven'])
        self.assertFalse(comparison['successfulBusinessComparison'])
        with self.assertRaisesRegex(RuntimeError, 'conditions differ'):
            reader.compare_readiness(before, dict(after, caps=dict(rssBytes=20)))

    def test_business_comparison_preserves_measured_counts_and_condition_differences(self):
        hardware = dict(status='OBSERVED', system='Linux', machine='x86_64', cpuModels=['AMD'],
                        kernelRelease='fixture', effectiveAffinity=[0, 1], hostMemTotalBytes=32,
                        filesystem=dict(type='ext4', fragmentBytes=4096))
        counts = dict(successfulInclusion=dict(windowTPS=0.2), qualifiedReceipt=dict(windowTPS=0.0))
        latencies = dict(submitToInclusionObserved=dict(p95Ns=100), submitToQualifiedReceiptObserved=None)
        cohort = dict(configuredDemand=500, submittedWithinWindow=1, submissionAttemptWindowTPS=0.2,
                      originalCohort=dict(counts=counts, latencies=latencies), terminalCounts=dict(unknown=1),
                      backlogGrowing=True, pipelinePressure=None)
        before = dict(status='OBSERVED', archiveOriginIndependentlyVerified=True, actionsOrigin=dict(run=1),
                      archiveSHA256='a'*64, controller=self.controller, source=dict(commit='b'*40),
                      tools=dict(commit='c'*40), hardware=hardware, toolchain='go1.26.11',
                      caps=dict(rssBytes=10), conditions=dict(accounts=500), fullCohort=cohort,
                      firstCause='original reply missing', peakRSSBytes=8, businessBlockCommitStages=None)
        after = dict(before, actionsOrigin=dict(run=2), archiveSHA256='d'*64)
        same = reader.compare_business(before, after)
        self.assertTrue(same['sameReportedConditions'])
        self.assertFalse(same['identicalPhysicalHostProven'])
        self.assertFalse(same['throughputGainAttributed'])
        self.assertFalse(same['sustainedTPSQualified'])
        self.assertEqual(same['before']['counts'], counts)
        self.assertEqual(same['before']['latencies'], latencies)
        self.assertEqual(same['before']['firstCause'], 'original reply missing')

        changed = dict(after, hardware=dict(hardware, cpuModels=['Intel']), conditions=None)
        difference = reader.compare_business(before, changed)
        self.assertFalse(difference['sameReportedConditions'])
        self.assertEqual(difference['configurationDifferences'], ['conditions'])
        self.assertEqual(difference['hardwareDifferences'], ['cpuModels'])
        with self.assertRaisesRegex(RuntimeError, 'two distinct original'):
            reader.compare_business(before, dict(after, archiveSHA256=before['archiveSHA256']))
        with self.assertRaisesRegex(RuntimeError, 'independently bound'):
            reader.compare_business(before, dict(after, archiveOriginIndependentlyVerified=False))

    def fixture(self, with_receipt=True, accounts=500, prefix='fixture/public/', confirmed=None,
                ready_lanes=None, replaced_node=False):
        source = dict(commit='a' * 40, tree='b' * 40)
        tools = dict(commit='c' * 40, tree='d' * 40)
        config = dict(profile='first100-held-public-owner', nodeCount=4, pressureLevel=1,
                      source=source['commit'], sourceTree=source['tree'],
                      tools=tools['commit'], toolsTree=tools['tree'])
        if ready_lanes is not None:
            config['options'] = dict(held_ready_only=True)
        pin = sha(encode(config))
        plan = dict(configuration=config, configurationSHA256=pin, runtimePlanSHA256=None)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('pq-first100-held-plan.json', encode(plan))
            if with_receipt:
                archive.writestr(prefix + 'FIRST100-HELD-CI.json', encode(dict(plan, controllerCommit=self.controller)))
                receipt = dict(source=source, toolIdentity=tools, loadExecuted=False, firstCause='stopped before release')
                if ready_lanes is not None:
                    census = dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',
                                  configuredLoadAccounts=500, completeFourNodeAccountReadback=True,
                                  normalGoStaticOrCryptoQualification=False, signCommandsIssued=0,
                                  businessPOSTsIssued=0, sourceGrant=False,
                                  nodes=[dict(node=i, height=18, appHash='a'*64,
                                              matchingOriginalLoadAccounts=500, snapshotBytes=1,
                                              snapshotSHA256='b'*64) for i in range(4)])
                    processes = [dict(name=f'{phase}-node-{i}', pid=10+j*4+i, startTicks=100+i,
                                      exited=j == 0, rawReturnCode=0 if j == 0 else None,
                                      exitCode=0 if j == 0 else None, signal=None)
                                 for j, phase in enumerate(('bootstrap', 'pq')) for i in range(4)]
                    boundary = reader.preload.validate(census, processes, [], 100, 5, 30)
                    exited = [dict(row, exited=True, rawReturnCode=0, exitCode=0) for row in processes]
                    if replaced_node:
                        exited[-1]['startTicks'] += 1
                    signer = dict(syntheticOnly=True)
                    archive.writestr(prefix + 'initialized-account-readback.json', encode(census))
                    archive.writestr(prefix + 'preload-initialization.json', encode(boundary))
                    archive.writestr(prefix + 'load-public-owners-ready.json', encode(signer))
                    receipt.update(heldReadyOnlyComplete=True, firstCause=None,
                                   cleanupComplete=True, normalNodeCleanExit=dict(allEightExitZero=True, records=exited),
                                   initializedAccountReadback=census, preloadInitialization=boundary,
                                   preparationUnconfirmedOwners=[], normalPublicOwnerTransport=dict(attempted=0),
                                   preparationOnlyDemandAccounting=dict(configuredDemand=500, notReleased=500,
                                                                        notSubmitted=500, notQualified=500),
                                   senderPoolPreparation=dict(bootstrapLoaded=True, signed=False,
                                       nonceReserved=False, loadClockStarted=False, publicScopeReady=signer,
                                       sourcePreparation=dict(sourceReply='load-public-owners-ready.json',
                                                              sourceReplySHA256=sha(encode(signer))),
                                       liveMaterialsPreparation=[dict(node=node) for node in ready_lanes]))
                if confirmed is not None:
                    extra, load = confirmed
                    receipt.update(loadExecuted=True, firstCause=None, planSHA256=sha(extra['load-plan.json']),
                                   loadResult=load, journalSegments=[dict(path='load-events-00000.jsonl',
                                       bytes=len(extra['load-events-00000.jsonl']), sha256=sha(extra['load-events-00000.jsonl']))])
                    for name, data in extra.items():
                        archive.writestr(prefix + name, data)
                archive.writestr(prefix + 'receipt.json', encode(receipt))
                archive.writestr(prefix + 'requested-load.json', encode(dict(source=source, mode='online',
                    rate=100, seconds=5, accounts=accounts, tailSeconds=30, perAccountCapacity=1, configuredDemand=500)))
        return output.getvalue(), pin

    def test_stopped_before_release_preserves_missing_data(self):
        for has_receipt, status in [(False, 'NO_RUNTIME_RECEIPT'), (True, 'LOAD_RESULT_MISSING')]:
            raw, pin = self.fixture(with_receipt=has_receipt)
            report = reader.inspect(raw, sha(raw), self.controller, pin)
            self.assertEqual(report['status'], status)
            self.assertIsNone(report['fullCohort'])
            if has_receipt:
                self.assertEqual(report['firstCause'], 'stopped before release')

    def test_ready_requires_four_lanes_and_preserves_unreleased_demand(self):
        raw, pin = self.fixture(ready_lanes=range(4))
        report = reader.inspect(raw, sha(raw), self.controller, pin)
        self.assertEqual(report['status'], 'READY_ONLY_OBSERVED')
        self.assertEqual(report['preparationOnlyDemandAccounting']['notReleased'], 500)
        self.assertIsNone(report['fullCohort'])
        raw, pin = self.fixture(ready_lanes=range(3))
        with self.assertRaisesRegex(RuntimeError, 'READY-only boundary'):
            reader.inspect(raw, sha(raw), self.controller, pin)
        raw, pin = self.fixture(ready_lanes=range(4), replaced_node=True)
        with self.assertRaisesRegex(RuntimeError, 'node identities or exits differ'):
            reader.inspect(raw, sha(raw), self.controller, pin)

    def test_full_cohort_counts_one_confirmed_and_rejects_substituted_reply(self):
        fixture = reader.module('test_pq_observed_throughput.py').ObservedThroughputControls()
        ledger = fixture.ledger(500)
        row, _ = ledger.reserve(ledger.plan['windowNs'])
        tx = b'original transaction fixture'
        fixture.event(ledger, row, 'signed', 4_999_999_995, hash=sha(tx), nativeHash='b'*64)
        fixture.event(ledger, row, 'submitted', 4_999_999_996)
        fixture.event(ledger, row, 'ack', 4_999_999_997)
        fixture.event(ledger, row, 'included', 5_000_000_001)
        base = 'load-operations/%05d/' % row['index']
        fixture.event(ledger, row, 'qualified', 5_000_000_002, hash=row['hash'], nativeHash=row['nativeHash'],
                      normalVerifierCode='VERIFIED_TRANSACTION_DATA', executionSuccessful=True, executionCode='0',
                      transactionType='pq_transfer', members=1, nativeGrant=False,
                      normalConfirmCode='PROOF_CONFIRMED_DATA', proofReference=base+'qualified-receipt.json')
        load = ledger.report(5_000_000_003)
        origin = 100_000_000_000
        load['originMonotonicNs'] = str(origin)
        result = dict(transactionHash='0x'+row['hash'], nativeWireHash=row['nativeHash'], included=True,
                      finalized=True, executionSuccessful=True, executionCode='0', nativeGrant=False)
        verifier = dict(code='VERIFIED_TRANSACTION_DATA', result=result)
        confirm = dict(code='PROOF_CONFIRMED_DATA', result=dict(result=result))
        proof = dict(sequence='1')
        stem = 'load-%05d' % row['index']
        originals = {
            'load-plan.json': encode(ledger.plan),
            'load-events-00000.jsonl': b'{}\n',
            base+'transaction.abci': tx,
            base+'submission-intent.json': encode(dict(id=row['id'], operationId=row['operationId'],
                owner=row['ownerIndex'], nonce=str(row['nonce']), transactionHash=sha(tx),
                submissionAttempts=1, qualifiedFinal=False)),
            base+'four-node-inclusion.json': encode(dict(qualifiedFinal=False, rows=[dict(height='19',
                hash=sha(tx), tx=base64.b64encode(tx).decode(), tx_result=dict(code=0))]*4)),
            base+'qualified-receipt.json': encode(dict(id=row['id'], operationId=row['operationId'], mode='online',
                normalConfirm=confirm, normalVerifier=verifier, normalLiveResult=proof)),
            base+'original-confirm-reply.json': encode(confirm),
            stem+'-normal-verifier.log': encode(verifier),
            stem+'-live-result.log': encode(dict(version='YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1',
                outcome='original_result_read', result=proof)),
        }
        raw, pin = self.fixture(confirmed=(originals, load))
        report = reader.inspect(raw, sha(raw), self.controller, pin)
        cohort = report['fullCohort']
        self.assertEqual(report['originalSuccessorAvailability']['observed'], 0)
        self.assertFalse(report['originalSuccessorAvailability']['independentFinality'])
        self.assertEqual(cohort['submissionAttemptWindowTPS'], 0.2)
        self.assertEqual(cohort['originalCohort']['counts']['qualifiedReceipt']['inTail'], 1)
        self.assertEqual(cohort['unresolvedRate'], 499/500)
        self.assertIsNone(cohort['originalCohort']['latencies']['submitToQualifiedReceiptObserved']['p95Ms'])
        self.assertIsNone(report['originalFourNodeInclusion']['records'][0]['fourNodeRepliesObservedOffsetNs'])
        inclusion_path = base+'four-node-inclusion.json'
        original_inclusion = reader.strict(originals[inclusion_path])
        originals[inclusion_path] = encode(dict(original_inclusion, observedMonotonicNs=origin+4_999_999_999))
        raw, pin = self.fixture(confirmed=(originals, load))
        record = reader.inspect(raw, sha(raw), self.controller, pin)['originalFourNodeInclusion']['records'][0]
        self.assertEqual(record['submitToFourNodeRepliesObservedNs'], 3)
        self.assertEqual(record['observationToLedgerEventNs'], 2)
        originals[inclusion_path] = encode(dict(original_inclusion, observedMonotonicNs=origin+5_000_000_002))
        raw, pin = self.fixture(confirmed=(originals, load))
        with self.assertRaisesRegex(RuntimeError, 'outside ledger boundaries'):
            reader.inspect(raw, sha(raw), self.controller, pin)
        originals[inclusion_path] = encode(original_inclusion)
        originals[base+'successor-availability.json'] = encode(dict(
            transactionHeight=19, minimumSuccessorHeight=20,
            observations=[dict(node=i,engineHeight=20,applicationHeight=20) for i in range(4)],
            observedMonotonicNs=origin+5_000_000_001,
            qualifiedFinal=False))
        # The fixture's operation has no successor stage. Reject the unbound
        # timing instead of adopting it into the confirmed cohort.
        raw, pin = self.fixture(confirmed=(originals, load))
        with self.assertRaisesRegex(KeyError, 'successor_availability'):
            reader.inspect(raw, sha(raw), self.controller, pin)
        del originals[base+'successor-availability.json']
        originals[base+'original-confirm-reply.json'] = encode(dict(confirm, code='REFUSED'))
        raw, pin = self.fixture(confirmed=(originals, load))
        with self.assertRaisesRegex(RuntimeError, 'original held proof'):
            reader.inspect(raw, sha(raw), self.controller, pin)

    def test_original_configuration_and_full_demand_are_required(self):
        raw, pin = self.fixture(prefix='public/')
        self.assertEqual(reader.inspect(raw, sha(raw), self.controller, pin)['status'], 'LOAD_RESULT_MISSING')
        raw, pin = self.fixture(accounts=499)
        with self.assertRaisesRegex(RuntimeError, 'original demand differs'):
            reader.inspect(raw, sha(raw), self.controller, pin)
        with self.assertRaisesRegex(RuntimeError, 'configuration digest differs'):
            reader.inspect(raw, sha(raw), self.controller, '0' * 64)


class HeldCheckpointReadbackTests(unittest.TestCase):
    """Synthetic stopped-node originals exercise the real archive reader, not a run."""

    def fixture(self, height=18, app_hash='a'*64, omitted=(), edit=None):
        base = HeldReadbackTests()
        raw, pin = base.fixture(ready_lanes=range(4))
        prefix = 'fixture/public/'
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        receipt = reader.strict(files[prefix+'receipt.json'])
        receipt['processes'] = receipt['normalNodeCleanExit']['records']
        commit_refs, finalize_refs = [], []
        commit_reader = reader.module('pq-commit-observation.py')
        specimen = reader.strict((Path(__file__).with_name('fixtures') /
                                  'commit-observation-public-schema.json').read_bytes())
        for node in range(4):
            process = next(row for row in receipt['processes'] if row['name'] == f'pq-node-{node}')
            commit = copy.deepcopy(specimen['cases']['gap-and-overflow'])
            commit.update(processID=process['pid'], captureBoundary=commit_reader.CAPTURE_BOUNDARY,
                          successNotifications=1, droppedSuccessSamples=0, sampleOverflow=False,
                          unobservedLatest=None, latestTimingAvailable=True,
                          finalCheckpoint=dict(height=height, appHash=app_hash))
            commit['coverage'].update(notificationCaptureComplete=True, observedHeightGaps=[])
            commit['samples'][0].update(height=height, appHash=app_hash)
            commit['samples'][0]['persistence']['height'] = height
            commit_reader.validate_declared_contract(commit, process['pid'], commit['chainID'],
                                                      commit['originalGenesisHash'])
            sample = dict(attempt=1, requestPresent=True, height=height, success=True,
                          appHash=app_hash, failedPhase='', elapsedNs=60,
                          phaseNs=dict.fromkeys(reader.finalize.PHASES, 10),
                          childrenNs={'seal.fee_materialize': 3}, counts={})
            final = dict(version=reader.finalize.VERSION, scope='synthetic-loopback-lab/v1',
                         captureBoundary=reader.finalize.BOUNDARY, processID=process['pid'],
                         chainID=commit['chainID'], originalGenesisHash=commit['originalGenesisHash'],
                         lockWaitIncluded=False, independentFinality=False, unreportedStagesAreUnknown=True,
                         childrenOverlapParentPhases=True, maxSamples=128, captureComplete=True,
                         observation=dict(attempts=1, dropped=0, samples=[sample], latest=copy.deepcopy(sample)))
            cp, fp = (f'{kind}-observation-node-{node}-original.json' for kind in ('commit', 'finalize'))
            c, f = encode(commit), encode(final)
            files[prefix+cp] = c
            if node not in omitted:
                files[prefix+fp] = f
            commit_refs.append(dict(node=node, pid=process['pid'], processName=process['name'], path=cp,
                                    bytes=len(c), sha256=sha(c), sourceStopped=True, usable=True,
                                    rawOriginalObservation=commit))
            finalize_refs.append(dict(node=node, pid=process['pid'], path=fp,
                                      bytes=len(f), sha256=sha(f), complete=True))
        receipt.update(normalCommitObservation=dict(originalSnapshots=commit_refs, errors=[]),
                       normalFinalizeObservation=dict(records=finalize_refs, errors=[], fourComplete=True))
        if edit is not None:
            edit(receipt, files, prefix)
        files[prefix+'receipt.json'] = encode(receipt)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        return output.getvalue(), pin, receipt

    def inspect(self, **kwargs):
        raw, pin, receipt = self.fixture(**kwargs)
        return reader.inspect(raw, sha(raw), HeldReadbackTests.controller, pin), receipt

    def assert_ready_only(self, report):
        self.assertEqual(report['status'], 'READY_ONLY_OBSERVED')
        self.assertIsNone(report['fullCohort'])
        self.assertEqual(report['preparationOnlyDemandAccounting']['notQualified'], 500)
        self.assertFalse(report['stable1000TPSQualified'])

    def test_four_pinned_originals_join_census_without_inventing_missing_timings(self):
        report, receipt = self.inspect()
        self.assert_ready_only(report)
        checkpoint = dict(height=18, appHash='a'*64)
        self.assertEqual(report['finalizeCommitCheckpoints'], dict(common=[checkpoint], partial=[]))
        self.assertEqual(report['readinessCensusCheckpointJoin'], dict(
            status='OBSERVED', checkpoint=checkpoint, observedNodes=['0', '1', '2', '3'],
            missingNodes=[], fourNodeJoinObserved=True, independentFinality=False))
        for node in range(4):
            commit = report['originalCommitCopies']['records'][node]
            final = report['finalizeByNode'][str(node)]
            ref = receipt['normalFinalizeObservation']['records'][node]
            self.assertNotIn('pid', commit)
            self.assertEqual(commit['originalSnapshot']['processID'], ref['pid'])
            self.assertEqual((final['path'], final['sha256']), (ref['path'], ref['sha256']))
            self.assertEqual(final['business']['samples'], {})
            absent = final['retainedSuccessStages']['transaction.clone']
            self.assertEqual((absent['observed'], absent['missingOrCensored']), (0, 1))
            self.assertIsNone(absent['minNs'])
            stage = report['commitStages']['nodes'][str(node)]['byStorage']['atomic-json']['stages']['write']
            self.assertEqual((stage['observed'], stage['missingOrCensored']), (0, 1))
            self.assertIsNone(stage['minNs'])

    def test_missing_fourth_original_keeps_ready_and_partial_checkpoint(self):
        report, _ = self.inspect(omitted=(3,))
        self.assert_ready_only(report)
        self.assertEqual(report['finalizeCommitCheckpoints'], dict(
            common=[], partial=[dict(height=18, observedNodes=['0', '1', '2'])]))
        self.assertEqual(report['readinessCensusCheckpointJoin']['status'], 'NOT_OBSERVED')
        self.assertEqual(report['readinessCensusCheckpointJoin']['missingNodes'], ['3'])
        self.assertFalse(report['readinessCensusCheckpointJoin']['fourNodeJoinObserved'])
        self.assertNotIn('3', report['finalizeByNode'])

    def test_other_common_height_cannot_fill_missing_census_height(self):
        report, _ = self.inspect(height=19)
        self.assert_ready_only(report)
        self.assertEqual(report['finalizeCommitCheckpoints']['common'], [dict(height=19, appHash='a'*64)])
        self.assertEqual(report['readinessCensusCheckpointJoin']['status'], 'NOT_OBSERVED')
        self.assertEqual(report['readinessCensusCheckpointJoin']['missingNodes'], ['0', '1', '2', '3'])

    def test_absent_originals_keep_census_join_unobserved(self):
        raw, pin = HeldReadbackTests().fixture(ready_lanes=range(4))
        report = reader.inspect(raw, sha(raw), HeldReadbackTests.controller, pin)
        self.assert_ready_only(report)
        self.assertEqual(report['finalizeCommitCheckpoints'], dict(common=[], partial=[]))
        self.assertEqual(report['readinessCensusCheckpointJoin']['status'], 'NOT_OBSERVED')
        self.assertEqual(report['readinessCensusCheckpointJoin']['observedNodes'], [])
        self.assertEqual(report['readinessCensusCheckpointJoin']['missingNodes'], ['0', '1', '2', '3'])

    def test_finalize_ref_pid_path_bytes_and_sha_cannot_bypass_original_binding(self):
        for key, value in [('pid', 999), ('path', 'other.json'), ('bytes', 1), ('sha256', 'f'*64)]:
            with self.subTest(key=key):
                def edit(receipt, files, prefix):
                    receipt['normalFinalizeObservation']['records'][3][key] = value
                with self.assertRaisesRegex(RuntimeError, 'Finalize observation receipt pin differs'):
                    self.inspect(edit=edit)

    def test_join_rejects_census_apphash_divergence(self):
        for omitted in ((), (3,)):
            with self.subTest(omitted=omitted):
                with self.assertRaisesRegex(RuntimeError, 'census AppHash differs'):
                    self.inspect(app_hash='b'*64, omitted=omitted)


if __name__ == '__main__':
    unittest.main()
