"""Pure local reduction controls. Fixture callbacks grant no chain authority."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest import mock


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = module('first100_stage_summary_controls', 'pq-first100-stage-summary.py')
fixtures = module('first100_stage_original_ledger_fixture', 'test_pq_observed_throughput.py')


class First100StageSummaryControls(unittest.TestCase):
    def setUp(self):
        for name in ('subprocess.Popen', 'urllib.request.urlopen', 'socket.create_connection'):
            patch = mock.patch(name, side_effect=AssertionError('local readback must not execute or use network'))
            patch.start()
            self.addCleanup(patch.stop)

    def load(self, count=2, final=False):
        c = fixtures.ObservedThroughputControls()
        ledger = c.ledger(500)
        window = ledger.plan['windowNs']
        for _ in range(count):
            row = c.submitted(ledger)
            c.event(ledger, row, 'normal_stage', window+3, stage='inclusion')
            c.event(ledger, row, 'included', window+4)
            c.event(ledger, row, 'normal_stage', window+5, stage='live_publish')
            if final:
                c.final(ledger, row, window+6)
            else:
                c.event(ledger, row, 'unknown', window+7, error='original confirm unavailable; preserve pending')
        return ledger.report(window+8)

    def commits(self, count=8):
        records = []
        for node in range(4):
            records.append(dict(node=node, sha256=str(node)*64, producerReportedUsable=True,
                                originalSnapshot=dict(processID=100+node, successNotifications=count,
                                errorNotifications=0, droppedSuccessSamples=0,
                                coverage=dict(allCommitAttemptsCovered=False), lastFailure=None,
                                samples=[dict(height=i+1, persistence=dict(height=i+1, storage='atomic-json',
                                elapsedNs=1000+node*100+i, stagesNs={name: node*100+i+1 for name in m.COMMIT_STAGES}))
                                for i in range(count)])))
        return dict(originalCommitCopies=dict(records=records))

    def test_real_original_cohort_reducer_retains_full500_and_tail_only_inclusion(self):
        load = self.load()
        original = copy.deepcopy(load)
        with mock.patch.object(m.original, 'cohort', wraps=m.original.cohort) as reducer:
            result = m.business(load)
        reducer.assert_called_once_with(load)
        self.assertEqual(load, original)
        self.assertEqual((result['configuredDemand'], result['submitted'], result['notSubmitted']), (500, 2, 498))
        counts = result['originalCohort']['counts']
        self.assertEqual(counts['successfulInclusion'], dict(total=2, withinWindow=0, inTail=2, windowTPS=0))
        self.assertEqual(counts['qualifiedReceipt']['total'], 0)
        latency = result['observedLatencySamples']['submitToInclusionObserved']
        self.assertEqual((latency['observed'], latency['missingOrCensored'], latency['minNs'], latency['maxNs']), (2, 498, 2, 2))
        self.assertEqual(len(latency['observations']), 2)
        self.assertIsNone(latency['fullCohort']['p95Ms'])
        self.assertIsNone(result['actualConsensusCommitLatency'])

    def test_shrunk_demand_or_missing_original_row_is_rejected(self):
        for change in ('denominator', 'row'):
            load = self.load()
            if change == 'denominator':
                load['configuredDemand'] = 2
            else:
                load['rows'].pop()
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                m.business(load)

    def test_unreturned_last_stage_stays_unknown_not_zero_duration(self):
        result = m.business(self.load())
        stage = result['stages']['live_publish']
        self.assertEqual((stage['denominator'], stage['reached'], stage['observed'], stage['unresolvedReached']), (500, 2, 0, 2))
        self.assertEqual(stage['missingOrCensored'], 500)
        self.assertIsNone(stage['minNs'])
        self.assertIsNone(stage['maxNs'])
        self.assertIsNone(stage['retainedSampleP95Ns'])

    def test_backfilled_zero_stage_or_changed_stage_denominator_is_rejected(self):
        for change in ('zero', 'denominator', 'percentile'):
            load = self.load()
            if change == 'zero':
                load['rows'][0]['completedStageDurations'].append(dict(stage='live_publish', durationNs=0))
            elif change == 'denominator':
                load['completedStageIntervals']['inclusion']['denominator'] = 2
            else:
                load['completedStageIntervals']['inclusion']['fullDemandPercentilesMs']['p95'] = 1
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                m.business(load)

    def test_499_confirmations_still_censor_all_full_cohort_percentiles(self):
        result = m.business(self.load(499, final=True))
        final = result['observedLatencySamples']['submitToQualifiedReceiptObserved']
        self.assertEqual((final['observed'], final['denominator'], final['missingOrCensored']), (499, 500, 1))
        self.assertIsNone(final['retainedSampleP95Ns'])
        self.assertTrue(all(final['fullCohort'][key] is None for key in ('p50Ms', 'p95Ms', 'p99Ms')))

    def test_four_nodes_with_eight_samples_cannot_pool_into_32_sample_p95(self):
        result = m.commit_stages(self.commits())
        self.assertFalse(result['pooledAcrossNodes'])
        for node in range(4):
            stages = result['nodes'][str(node)]['byStorage']['atomic-json']['stages']
            for name in m.COMMIT_STAGES:
                self.assertEqual(stages[name]['denominator'], 8)
                self.assertEqual(stages[name]['observedMedianNs'], node*100+4.5)
                self.assertIsNone(stages[name]['retainedSampleP95Ns'])
        self.assertNotIn('pooled', result)

    def test_missing_commit_stage_is_not_inserted_as_zero(self):
        readback = self.commits()
        del readback['originalCommitCopies']['records'][0]['originalSnapshot']['samples'][0]['persistence']['stagesNs']['write']
        stage = m.commit_stages(readback)['nodes']['0']['byStorage']['atomic-json']['stages']['write']
        self.assertEqual((stage['observed'], stage['denominator'], stage['missingOrCensored'], stage['minNs']), (7, 8, 1, 2))
        self.assertIsNone(stage['retainedSampleP95Ns'])

    def test_duplicate_commit_node_or_process_cannot_cross_node_pool(self):
        for field in ('node', 'processID'):
            data = self.commits()
            records = data['originalCommitCopies']['records']
            if field == 'node':
                records[1]['node'] = 0
            else:
                records[1]['originalSnapshot']['processID'] = 100
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                m.commit_stages(data)

    def test_p95_requires_at_least20_complete_samples_and_invalid_timing_is_refused(self):
        self.assertIsNone(m.samples(list(range(19)), 19)['retainedSampleP95Ns'])
        self.assertEqual(m.samples(list(range(20)), 20)['retainedSampleP95Ns'], 18)
        self.assertIsNone(m.samples(list(range(20)), 21)['retainedSampleP95Ns'])
        self.assertIsNone(m.samples([None], 1)['minNs'])
        for bad in (True, -1, 1.5, float('nan')):
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                m.samples([bad], 1)

    def test_initialization_retains_requested_unfinished_stage_and_real_record(self):
        first = dict(index=0, stage='quiet', identity=None, requestedMonotonicNs=1,
                     startedMonotonicNs=2, returnedMonotonicNs=12, elapsedNs=10)
        request = dict(index=1, stage='quiet', identity=None, requestedMonotonicNs=13)
        data = dict(originalInitializationStages=dict(records=[first], attempted=2, omitted=0),
                    initializationJournals=dict(events=[dict(first, kind='initialization_stage_requested'),
                    dict(request, kind='initialization_stage_requested')], status='PARTIAL_OR_FAILED', returned=1,
                    errors=[], unfinished=[dict(request, elapsedNs=None)]))
        result = m.initialization(data)
        self.assertEqual(result['records'], [first])
        self.assertEqual((result['stages']['quiet']['observed'], result['stages']['quiet']['denominator']), (1, 2))
        self.assertEqual(result['stages']['quiet']['minNs'], 10)
        first['elapsedNs'] = 0
        with self.assertRaisesRegex(RuntimeError, 'boundaries'):
            m.initialization(data)

    def test_startup_begin_elapsed_zero_does_not_count_as_returned(self):
        stage = dict(stage='startup.nodeStart', elapsedNs=0, pairingAmbiguous=False)
        data = dict(originalNodeStartup=dict(nodes=[dict(name='pq-node-0', pid=123,
                    originalStages=dict(status='PARTIAL_OR_FAILED', errors=[], records=[stage]))]))
        result = m.node_startup(data)['nodes']['pq-node-0']['stages']['startup.nodeStart']
        self.assertEqual(result['observed'], 0)
        self.assertEqual(result['missingOrCensored'], 1)
        self.assertIsNone(result['minNs'])

    def test_callee_foreign_source_denominator_and_zero_fill_are_rejected(self):
        elapsed = dict(observed=0, denominator=500, censoredOrNotReached=500,
                       observedMinNs=None, observedMaxNs=None,
                       fullDemandPercentilesMs=dict(p50=None, p95=None, p99=None))
        original = dict(source='D24', originalCalleeMeasurements=dict(source='D24',
                        groups=dict(confirm=dict(calleeElapsed=elapsed, stages={}))))
        self.assertIsNone(m.callee_stages(original)['groups']['confirm']['calleeElapsed']['minNs'])
        for change in ('source', 'denominator', 'zero'):
            data = copy.deepcopy(original)
            group = data['originalCalleeMeasurements']
            if change == 'source': group['source'] = '1b'
            if change == 'denominator': group['groups']['confirm']['calleeElapsed']['denominator'] = 0
            if change == 'zero': group['groups']['confirm']['calleeElapsed']['observedMinNs'] = 0
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                m.callee_stages(data)

    def test_preparation_foreign_source_cannot_join_business_source(self):
        data = dict(source='D24', originalPreparationSenderMeasurements=[dict(source='1b')])
        with self.assertRaisesRegex(RuntimeError, 'source'):
            m.preparation(data)

    def test_guard_nested_totals_are_preserved_without_addition_or_subtraction(self):
        stage = dict(calls=3, timedCalls=2, failedCalls=1, minNs=20, maxNs=80, totalNs=100)
        data = dict(originalResources=dict(resourceGuardStageElapsed=dict(status='OBSERVED',
                    stages=dict(sampleIncludingLockWait=stage, storageInventory=copy.deepcopy(stage)))))
        result = m.resources(data)
        self.assertFalse(result['stagesAdded'])
        self.assertFalse(result['overheadSubtractedFromCallee'])
        self.assertTrue(result['intervalsOverlap'])
        self.assertNotIn('totalNs', result)
        for value in result['stages'].values():
            self.assertEqual((value['denominator'], value['observed'], value['missingOrCensored']), (3, 2, 1))
            self.assertEqual(value['originalAggregate']['totalNs'], 100)
            self.assertIsNone(value['observedMedianNs'])

    def test_rpc_nodes_keep_attempted_and_inflight_denominators_separate(self):
        rows = [dict(node=n, method='status', attempted=3, completed=2, minNs=n+1, maxNs=n+2, inFlight=1) for n in range(4)]
        result = m.rpc_stages(dict(originalObservationRPCTiming=dict(groups=rows)))
        self.assertEqual(len(result['nodes']), 4)
        for node in result['nodes'].values():
            self.assertEqual(node['status']['denominator'], 3)
            self.assertEqual(node['status']['missingOrCensored'], 1)
        self.assertFalse(result['pooledAcrossNodes'])

    def test_tcp_endpoint_bytes_are_not_divided_by_inclusions_or_called_physical(self):
        data = dict(originalNetworkAccounting=dict(tcp=dict(status='OBSERVED_ENDPOINT_DELTA',
                    coverage='MATCHED_ENDPOINT_SOCKETS_ONLY'), captureScope='includes drain',
                    perHopTCPAccounting=dict(sourceSocketEndpointBytesSentSum='10000',
                    sourceSocketEndpointRetransmittedBytesSum='100', denominators=dict(configuredDemand=500, submitted=2, qualified=0))))
        result = m.tcp_scope(data)
        self.assertEqual(result['sourceSocketEndpointBytesSentSum'], '10000')
        self.assertIsNone(result['physicalBytes'])
        self.assertIsNone(result['actualPerTransactionHopBytes'])
        self.assertFalse(result['totalTrafficComplete'] or result['exactOfferedWindowCapture'] or result['gainsQualified'])

    def test_unpinned_archive_refused_before_any_stage_or_cohort_reduction(self):
        with mock.patch.object(m, 'diagnostic') as diagnostic:
            with self.assertRaisesRegex(RuntimeError, 'artifact identity or digest'):
                m.summarize(dict(archiveSHA256='0'*64), b'not the original ZIP')
            diagnostic.assert_not_called()

    def test_fixed_artifact_identity_cannot_be_relabelled_before_archive_read(self):
        identity = dict(runID=m.d24.RUN_ID, jobID=m.d24.JOB_ID,
                        artifactID=m.d24.ARTIFACT_ID, archiveSHA256=m.d24.ARCHIVE_SHA256)
        for key in identity:
            changed = dict(identity)
            changed[key] = 'wrong'
            with self.subTest(key=key), mock.patch.object(m.d24.original, 'public_archive') as extract:
                with self.assertRaisesRegex(RuntimeError, 'artifact identity or digest'):
                    m.summarize(changed, b'')
                extract.assert_not_called()

    def test_claim_ack_and_logical_arrival_keep_original500_missing_boundaries(self):
        load = self.load()
        result = m.business(load)['observedLatencySamples']
        self.assertEqual(result['releaseToAccountClaim']['observed'], 2)
        self.assertEqual(result['releaseToAccountClaim']['missingOrCensored'], 498)
        for key in ('submitToCheckTxAckObserved', 'endToEndLogicalArrivalToQualified'):
            self.assertEqual(result[key]['denominator'], 500)
            self.assertEqual(result[key]['missingOrCensored'], 500)
            self.assertIsNone(result[key]['minNs'])
            self.assertIsNone(result[key]['maxNs'])
        load['releaseToAccountClaim']['denominator'] = 2
        with self.assertRaisesRegex(RuntimeError, 'boundary denominator'):
            m.business(load)


if __name__ == '__main__':
    unittest.main()
