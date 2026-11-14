"""Pure original-file transport controls; synthetic timings are not chain evidence."""
import base64
import copy
import hashlib
import importlib.util
import importlib.machinery
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


m = module('normal_stage_controls', 'pq-normal-leg-stages.py')
pair = module('normal_stage_pair_controls', 'test_pq_normal_pair_gates.py')
r = pair.r


def raw(value):
    return json.dumps(value, separators=(',', ':')).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def success(height=19, attempt=1, app_hash='a'*64):
    return dict(attempt=attempt, requestPresent=True, height=height, success=True, appHash=app_hash,
                failedPhase='', elapsedNs=60, phaseNs=dict.fromkeys(m.finalize.PHASES, 10),
                childrenNs={'seal.fee_materialize': 3}, counts={'requested_transactions': 1})


def fixture(nodes=range(4)):
    leg = pair.bundle(); receipt = leg['receipt']; files = {}
    receipt['originalPlanSHA256'] = '9'*64
    files['create-original.log'] = raw(dict(planSHA256='9'*64, plan=dict(
        chainId='ynx_642399-1', originalGenesisHash='b'*64)))
    receipt['normalCommitObservation'] = dict(originalSnapshots=[], errors=[])
    receipt['normalFinalizeObservation'] = dict(records=[], errors=[], fourComplete=True)
    specimen = json.loads((Path(__file__).with_name('fixtures')/'commit-observation-public-schema.json').read_bytes())
    for node in nodes:
        proc = next(row for row in receipt['processes'] if row['name'] == f'pq-node-{node}')
        snapshot = copy.deepcopy(specimen['cases']['gap-and-overflow'])
        snapshot.update(processID=proc['pid'], originalGenesisHash='b'*64,
                        captureBoundary=m.commit.CAPTURE_BOUNDARY, successNotifications=1,
                        droppedSuccessSamples=0, sampleOverflow=False, unobservedLatest=None)
        snapshot['coverage'].update(observedHeightGaps=[], notificationCaptureComplete=True)
        snapshot['samples'][0].update(height=19, appHash='a'*64)
        snapshot['samples'][0]['persistence']['height'] = 19
        snapshot['finalCheckpoint'] = dict(height=19, appHash='a'*64)
        snapshot['lastFailure'] = None
        cp = f'commit-observation-node-{node}-original.json'
        ref = dict(node=node, processName=proc['name'], pid=proc['pid'], path=cp,
                   sourceStopped=True, usable=True, rawOriginalObservation=snapshot)
        receipt['normalCommitObservation']['originalSnapshots'].append(ref)
        sample = success()
        fp = f'finalize-observation-node-{node}-original.json'
        fin = dict(version=m.finalize.VERSION, scope='synthetic-loopback-lab/v1',
                   captureBoundary=m.finalize.BOUNDARY, processID=proc['pid'], chainID=snapshot['chainID'],
                   originalGenesisHash='b'*64, lockWaitIncluded=False, independentFinality=False,
                   unreportedStagesAreUnknown=True, childrenOverlapParentPhases=True,
                   maxSamples=128, captureComplete=True,
                   observation=dict(attempts=1, dropped=0, samples=[sample], latest=copy.deepcopy(sample)))
        receipt['normalFinalizeObservation']['records'].append(dict(node=node, pid=proc['pid'], path=fp, complete=True))
        files[cp] = raw(snapshot); files[fp] = raw(fin)
    refresh(receipt, files)
    binding = dict(receiptSHA256=sha(raw(receipt)), toolsCommit=leg['toolsCommit'], controller='2'*40,
                   runID='unit-original-1', source=receipt['source'], binaries=receipt['binaries'])
    return leg, files, binding


def refresh(receipt, files):
    for report, field in [('normalCommitObservation', 'originalSnapshots'), ('normalFinalizeObservation', 'records')]:
        for ref in receipt[report][field]:
            body = files[ref['path']]
            ref.update(bytes=len(body), sha256=sha(body))
            if field == 'originalSnapshots':
                ref['rawOriginalObservation'] = json.loads(body)


def change(leg, files, kind, node, edit):
    path = f'{kind}-observation-node-{node}-original.json'; value = json.loads(files[path]); edit(value)
    files[path] = raw(value); refresh(leg['receipt'], files)


class BusinessStageCostControls(unittest.TestCase):
    """Synthetic node originals test cohort selection; no performance evidence."""

    def read(self, leg, files, binding):
        return m.read(leg['receipt'], lambda name, limit: files[name], binding)

    def test_business_costs_use_original_height_denominator_and_keep_fee_counts(self):
        leg, files, binding = fixture([0])
        def edit(snapshot):
            row = snapshot['observation']['samples'][0]
            row['counts'].update({'seal.fee_materialize': 7, 'seal.accounts_materialize': 515})
            snapshot['observation']['latest'] = copy.deepcopy(row)
        change(leg, files, 'finalize', 0, edit)
        report = self.read(leg, files, binding)
        costs = report['nodes']['0']['businessStageCosts']
        self.assertEqual(report['configuredBusinessDenominator'], 4)
        self.assertEqual(costs['heightDenominator'], 4)
        self.assertEqual(costs['missingCommitHeights'], [21, 23, 25])
        self.assertEqual(costs['missingFinalizeCommitHeights'], [21, 23, 25])
        self.assertEqual(costs['records'][0]['finalize']['counts']['seal.fee_materialize'], 7)
        self.assertEqual(costs['records'][0]['commit']['persistence']['stagesNs']['json_encode'], 20)
        self.assertIsNone(costs['records'][1]['commit'])
        self.assertIsNone(costs['records'][1]['finalize'])
        fee = costs['finalizeStages']['children']['seal.fee_materialize']
        self.assertEqual((fee['denominator'], fee['observed'], fee['missingOrCensored']), (4, 1, 3))
        self.assertEqual(fee['observedMedianNs'], 3)
        self.assertIsNone(fee['retainedSampleP95Ns'])
        self.assertTrue(costs['childrenOverlapParentPhases'])
        self.assertFalse(costs['stagesAdded'] or costs['independentFinality'])

    def test_initialization_samples_do_not_enter_business_costs(self):
        leg, files, binding = fixture([0])
        def edit(snapshot):
            initialization = success(18, 1)
            initialization['childrenNs']['seal.fee_materialize'] = 10000
            business = success(19, 2)
            snapshot['observation'].update(attempts=2, samples=[initialization, business], latest=copy.deepcopy(business))
        change(leg, files, 'finalize', 0, edit)
        node = self.read(leg, files, binding)['nodes']['0']
        self.assertEqual(node['finalize']['retainedSuccessStages']['children']['seal.fee_materialize']['observed'], 2)
        self.assertEqual(node['businessStageCosts']['finalizeStages']['children']['seal.fee_materialize']['observedMedianNs'], 3)
        self.assertEqual(node['businessStageCosts']['observedFinalizeCommitHeights'], [19])

    def test_multiple_transactions_in_one_block_do_not_change_business_demand(self):
        leg, files, binding = fixture([0])
        leg['receipt']['functionalCohort'][-1]['height'] = '19'
        report = self.read(leg, files, binding)
        self.assertEqual(report['configuredBusinessDenominator'], 4)
        costs = report['nodes']['0']['businessStageCosts']
        self.assertEqual(costs['heightDenominator'], 3)
        self.assertEqual(costs['heights'], [19, 21, 23])
        self.assertEqual(costs['finalizeStages']['elapsed']['denominator'], 3)
        self.assertFalse(costs['perTransactionCostsInferred'])

    def test_missing_node_keeps_all_business_heights_censored(self):
        leg, files, binding = fixture([0])
        costs = self.read(leg, files, binding)['nodes']['3']['businessStageCosts']
        self.assertEqual(costs['missingCommitHeights'], [19, 21, 23, 25])
        self.assertEqual(costs['missingFinalizeCommitHeights'], [19, 21, 23, 25])
        self.assertEqual(costs['finalizeStages']['elapsed']['observed'], 0)
        self.assertIsNone(costs['finalizeStages']['elapsed']['observedMedianNs'])

    def test_no_referenced_originals_preserves_business_denominator_without_reads(self):
        leg, files, binding = fixture([])
        report = m.read(leg['receipt'], mock.Mock(side_effect=AssertionError('no original reads')), binding)
        self.assertEqual(report['status'], 'NOT_SUPPLIED')
        for value in report['nodes'].values():
            costs = value['businessStageCosts']
            self.assertEqual(costs['heightDenominator'], 4)
            self.assertEqual(costs['finalizeStages']['elapsed']['missingOrCensored'], 4)

    def test_finalize_success_without_commit_does_not_join(self):
        leg, files, binding = fixture([0])
        leg['receipt']['normalCommitObservation']['originalSnapshots'] = []
        costs = self.read(leg, files, binding)['nodes']['0']['businessStageCosts']
        self.assertIsNone(costs['records'][0]['finalize'])
        self.assertEqual(costs['finalizeStages']['retainedSuccessfulAttempts'], 0)
        self.assertEqual(costs['missingFinalizeCommitHeights'], [19, 21, 23, 25])

    def test_missing_count_and_child_are_not_zero_or_per_fee_estimates(self):
        leg, files, binding = fixture([0])
        def edit(snapshot):
            sample = snapshot['observation']['samples'][0]
            sample['counts'] = {}
            sample['childrenNs'] = {}
            snapshot['observation']['latest'] = copy.deepcopy(sample)
        change(leg, files, 'finalize', 0, edit)
        costs = self.read(leg, files, binding)['nodes']['0']['businessStageCosts']
        self.assertEqual(costs['records'][0]['finalize']['counts'], {})
        child = costs['finalizeStages']['children']['seal.fee_materialize']
        self.assertEqual((child['observed'], child['missingOrCensored']), (0, 4))
        self.assertIsNone(child['minNs'])
        self.assertFalse(costs['perTransactionCostsInferred'])

    def test_failed_attempt_and_latest_only_do_not_fill_business_heights(self):
        leg, files, binding = fixture([0])
        failed = dict(attempt=2, requestPresent=True, height=21, success=False, appHash='',
                      failedPhase='preflight', elapsedNs=7, phaseNs={'preflight': 7}, childrenNs={}, counts={})
        def edit(snapshot):
            snapshot['observation'].update(attempts=2, samples=[success(), failed], latest=copy.deepcopy(failed))
        change(leg, files, 'finalize', 0, edit)
        node = self.read(leg, files, binding)['nodes']['0']
        self.assertEqual(node['finalize']['business']['failedAttempts'], [failed])
        self.assertIsNone(node['businessStageCosts']['records'][1]['finalize'])
        samples = [success(i, i) for i in range(1, 129)]
        observation = dict(attempts=129, dropped=1, samples=samples, latest=success(129, 129))
        commit = dict(samples=[dict(height=129, appHash='a'*64, persistence={})])
        costs = m.business_stage_costs(commit, observation, [129])
        self.assertEqual(costs['missingFinalizeCommitHeights'], [129])

    def test_twenty_joined_of_twenty_one_business_heights_has_no_p95(self):
        commits = dict(samples=[dict(height=i, appHash='a'*64, persistence={}) for i in range(1, 22)])
        observed = dict(samples=[success(i, i) for i in range(1, 21)], dropped=0)
        costs = m.business_stage_costs(commits, observed, list(range(1, 22)))
        fee = costs['finalizeStages']['children']['seal.fee_materialize']
        self.assertEqual((fee['observed'], fee['denominator']), (20, 21))
        self.assertIsNone(fee['retainedSampleP95Ns'])

    def test_stage_rows_are_detached_and_keep_per_storage_identity(self):
        leg, files, binding = fixture([0, 1])
        def edit(snapshot):
            sample = copy.deepcopy(snapshot['samples'][0])
            sample['height'] = 21
            sample['persistence'].update(height=21, storage='block-journal-v2')
            snapshot['samples'].append(sample)
            snapshot['successNotifications'] = 2
        change(leg, files, 'commit', 0, edit)
        report = self.read(leg, files, binding)
        rows = report['nodes']['0']['businessStageCosts']['records']
        self.assertEqual([row['commit']['persistence']['storage'] for row in rows[:2]], ['atomic-json', 'block-journal-v2'])
        rows[0]['finalize']['counts'].clear()
        rows[0]['commit']['persistence']['stagesNs'].clear()
        self.assertEqual(report['nodes']['0']['commit']['originalSnapshot']['samples'][0]['persistence']['stagesNs']['json_encode'], 20)
        self.assertEqual(report['nodes']['1']['businessStageCosts']['records'][0]['commit']['persistence']['stagesNs']['json_encode'], 20)
        self.assertEqual(self.read(leg, files, binding)['nodes']['0']['businessStageCosts']['records'][0]['commit']['persistence']['stagesNs']['json_encode'], 20)


class FeeHistoryStageControls(unittest.TestCase):
    """Only scalar metadata controls; no fee algorithm or chain execution."""

    def costs(self, child=3, count=7):
        sample = success()
        if child is None:
            sample['childrenNs'].pop('seal.fee_materialize')
        else:
            sample['childrenNs']['seal.fee_materialize'] = child
        sample['counts'] = {} if count is None else {'seal.fee_materialize': count}
        return m.business_stage_costs(dict(samples=[dict(height=19, appHash='a'*64, persistence={})]),
                                      dict(samples=[sample], dropped=0), [19, 20])['feeHistoryMaterialization']

    def test_fee_history_inventory_is_paired_with_same_height_span_only(self):
        value = self.costs()
        self.assertEqual(value['records'], [dict(height=19, elapsedNs=3, materializedEventCount=7),
                                            dict(height=20, elapsedNs=None, materializedEventCount=None)])
        self.assertEqual(value['pairedObservationCount'], 1)
        self.assertEqual(value['timing']['denominator'], 2)
        self.assertEqual(value['eventCounts'], dict(denominator=2, observed=1, missing=1, minEvents=7, maxEvents=7))
        self.assertIsNone(value['copyOnlyElapsedNs'])
        self.assertIsNone(value['allocationOnlyElapsedNs'])
        self.assertIsNone(value['instrumentationOverheadNs'])
        self.assertFalse(value['overheadSubtracted'] or value['perEventCostInferred'])

    def test_missing_count_and_missing_span_are_independently_unknown(self):
        for child, count, timing_observed, count_observed in [(3, None, 1, 0), (None, 7, 0, 1), (None, None, 0, 0)]:
            with self.subTest(child=child, count=count):
                value = self.costs(child, count)
                self.assertEqual(value['timing']['observed'], timing_observed)
                self.assertEqual(value['eventCounts']['observed'], count_observed)
                self.assertEqual(value['pairedObservationCount'], 0)
                self.assertEqual(value['records'][0]['elapsedNs'], child)
                self.assertEqual(value['records'][0]['materializedEventCount'], count)

    def test_zero_events_and_zero_observed_span_are_preserved_as_original_values(self):
        value = self.costs(child=0, count=0)
        self.assertEqual(value['pairedObservationCount'], 1)
        self.assertEqual(value['timing']['minNs'], 0)
        self.assertEqual(value['eventCounts']['minEvents'], 0)
        self.assertFalse(value['perEventCostInferred'])

    def test_consumed_fee_inventory_must_obey_original_uint64_type(self):
        for count in (-1, True, 1.0, '7', 1 << 64):
            with self.subTest(count=count):
                with self.assertRaisesRegex(RuntimeError, 'fee materialization count'):
                    self.costs(count=count)


class NormalLegStageControls(unittest.TestCase):
    def read(self, leg, files, binding):
        return m.read(leg['receipt'], lambda name, limit: files[name], binding)

    def test_absent_observations_do_not_read_or_invent_zero(self):
        report = m.read({'firstCause': 'original UNKNOWN'}, mock.Mock(side_effect=AssertionError('read')), {})
        self.assertEqual(report['status'], 'NOT_SUPPLIED'); self.assertEqual(report['firstCause'], 'original UNKNOWN')
        self.assertEqual(set(report['nodes']), {'0', '1', '2', '3'})
        self.assertTrue(all(node['commit']['status'] == node['finalize']['status'] == 'NOT_SUPPLIED' for node in report['nodes'].values()))

    def test_all_four_original_snapshots_and_bindings_survive_candidate_output(self):
        leg, files, binding = fixture(); report = self.read(leg, files, binding)
        self.assertEqual(report['binding'], binding); self.assertEqual(report['configuredBusinessDenominator'], 4)
        self.assertEqual(report['commitCheckpoints']['common'], [dict(height=19, appHash='a'*64)])
        self.assertEqual(report['finalizeCommitCheckpoints']['common'], report['commitCheckpoints']['common'])
        for node in range(4):
            row = report['nodes'][str(node)]
            self.assertEqual(row['finalize']['originalSnapshot'], json.loads(files[f'finalize-observation-node-{node}-original.json']))
            self.assertEqual(row['commit']['missingBusinessHeights'], [21, 23, 25])
        other = pair.bundle('b'*64); leg['nodeStageData'] = report; other['nodeStageData'] = copy.deepcopy(report)
        for label, item in [('OFF', leg), ('ON', other)]:
            item['provenance'] = dict(runID=label)
        candidate = r.prepare_paired_candidate(leg, other)
        self.assertEqual(candidate['OFF']['nodeStageData'], report)
        self.assertFalse(candidate['ready'] or candidate['normalWirePairQualified'])

    def test_missing_children_and_missing_commit_stages_remain_censored(self):
        leg, files, binding = fixture([0])
        def edit(snapshot):
            sample = success(20, 2); sample['childrenNs'] = {}
            snapshot['observation'].update(attempts=2, samples=[success(), sample], latest=copy.deepcopy(sample))
        change(leg, files, 'finalize', 0, edit)
        change(leg, files, 'commit', 0, lambda s: s['samples'][0]['persistence']['stagesNs'].pop('file_sync'))
        row = self.read(leg, files, binding)['nodes']['0']
        child = row['finalize']['retainedSuccessStages']['children']['seal.fee_materialize']
        self.assertEqual((child['denominator'], child['observed'], child['missingOrCensored'], child['minNs']), (2, 1, 1, 3))
        self.assertIsNone(child['retainedSampleP95Ns'])
        absent = row['commit']['allRetained']['byStorage']['atomic-json']['stages']['file_sync']
        self.assertEqual(absent['observed'], 0); self.assertIsNone(absent['minNs'])

    def test_partial_nodes_and_unreferenced_files_are_not_adopted(self):
        leg, files, binding = fixture([0]); files['finalize-observation-node-1-original.json'] = b'not referenced'
        report = self.read(leg, files, binding)
        self.assertEqual(report['nodes']['1']['finalize']['status'], 'NOT_SUPPLIED')
        self.assertEqual(report['commitCheckpoints']['partial'], [dict(height=19, observedNodes=['0'])])
        self.assertEqual(report['commitCheckpoints']['common'], [])

    def test_duplicate_reference_or_escaping_path_refused_before_original_reads(self):
        for mode in ('duplicate', 'path'):
            leg, files, binding = fixture([0]); refs = leg['receipt']['normalFinalizeObservation']['records']
            if mode == 'duplicate': refs.append(copy.deepcopy(refs[0]))
            else: refs[0]['path'] = '../foreign.json'
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'unique original'):
                m.read(leg['receipt'], mock.Mock(side_effect=AssertionError('read')), binding)

    def test_wrong_size_hash_and_receipt_copy_refused(self):
        for mode in ('size', 'hash', 'copy'):
            leg, files, binding = fixture([0]); ref = leg['receipt']['normalCommitObservation']['originalSnapshots'][0]
            if mode == 'size': ref['bytes'] += 1
            elif mode == 'hash': ref['sha256'] = '0'*64
            else: ref['rawOriginalObservation']['samples'][0]['appHash'] = 'b'*64
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'pin differs|copies differ'):
                self.read(leg, files, binding)

    def test_foreign_pid_live_process_and_reused_pid_refused(self):
        for mode in ('pid', 'live', 'start', 'reused'):
            leg, files, binding = fixture([0, 1]); procs = [p for p in leg['receipt']['processes'] if p['name'].startswith('pq-node-')]
            if mode == 'pid': leg['receipt']['normalFinalizeObservation']['records'][0]['pid'] += 1
            elif mode == 'live': procs[0]['exited'] = False
            elif mode == 'start': procs[0]['startTicks'] = None
            else: procs[1]['pid'] = procs[0]['pid']
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'identity differs|PID differs'):
                self.read(leg, files, binding)

    def test_plan_chain_and_genesis_are_not_taken_from_timing_file(self):
        for mode in ('plan', 'chain', 'genesis'):
            leg, files, binding = fixture([0])
            if mode == 'plan': leg['receipt']['originalPlanSHA256'] = '8'*64
            else:
                field = 'chainID' if mode == 'chain' else 'originalGenesisHash'
                change(leg, files, 'commit', 0, lambda s: s.update({field: 'different'}))
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'plan binding|identity differs'):
                self.read(leg, files, binding)

    def test_finalize_commit_apphash_mismatch_refused(self):
        leg, files, binding = fixture([0])
        def edit(s):
            s['observation']['samples'][0]['appHash'] = 'c'*64; s['observation']['latest']['appHash'] = 'c'*64
        change(leg, files, 'finalize', 0, edit)
        with self.assertRaisesRegex(RuntimeError, 'AppHash or height differs'): self.read(leg, files, binding)

    def test_same_height_across_nodes_cannot_hide_divergence(self):
        leg, files, binding = fixture([0, 1])
        change(leg, files, 'commit', 1, lambda s: s['samples'][0].update(appHash='c'*64))
        def edit(s):
            s['observation']['samples'][0]['appHash'] = 'c'*64; s['observation']['latest']['appHash'] = 'c'*64
        change(leg, files, 'finalize', 1, edit)
        with self.assertRaisesRegex(RuntimeError, 'node AppHashes differ'): self.read(leg, files, binding)

    def test_failed_attempt_firstcause_and_latest_preserved_without_success(self):
        leg, files, binding = fixture([0]); leg['receipt']['firstCause'] = 'original first cause'
        failed = dict(attempt=2, requestPresent=False, height=0, success=False, appHash='',
                      failedPhase='preflight', elapsedNs=7, phaseNs={'preflight': 7}, childrenNs={}, counts={})
        def edit(s): s['observation'].update(attempts=2, samples=[success(), failed], latest=copy.deepcopy(failed))
        change(leg, files, 'finalize', 0, edit)
        report = self.read(leg, files, binding); fin = report['nodes']['0']['finalize']
        self.assertEqual(report['firstCause'], 'original first cause'); self.assertEqual(fin['business']['failedAttempts'], [failed])
        self.assertEqual(fin['originalSnapshot']['observation']['latest'], failed)
        self.assertEqual(fin['retainedSuccessStages']['retainedSuccessfulAttempts'], 1)

    def test_overflow_latest_is_retained_but_not_added_to_retained_samples(self):
        leg, files, binding = fixture([0]); samples = [success(i, i) for i in range(1, 129)]
        latest = success(129, 129)
        def edit(s):
            s.update(captureComplete=False); s['observation'].update(attempts=129, dropped=1, samples=samples, latest=latest)
        change(leg, files, 'finalize', 0, edit); leg['receipt']['normalFinalizeObservation']['records'][0]['complete'] = False
        fin = self.read(leg, files, binding)['nodes']['0']['finalize']
        self.assertEqual(fin['retainedSuccessStages']['retainedSuccessfulAttempts'], 128)
        self.assertEqual(fin['originalSnapshot']['observation']['latest'], latest)
        self.assertEqual(fin['business']['droppedAttempts'], 1); self.assertNotIn(129, fin['committed']['samples'])

    def test_unusable_commit_original_is_retained_without_promoting_timings(self):
        leg, files, binding = fixture([0]); ref = leg['receipt']['normalCommitObservation']['originalSnapshots'][0]
        ref['usable'] = False; files[ref['path']] = raw({'originalMalformedProducer': True}); refresh(leg['receipt'], files)
        report = self.read(leg, files, binding); node = report['nodes']['0']
        self.assertEqual(node['commit']['status'], 'PRODUCER_UNUSABLE'); self.assertNotIn('allRetained', node['commit'])
        self.assertEqual(node['finalize']['business']['samples'], {}); self.assertEqual(node['finalize']['business']['missingHeights'], [19, 21, 23, 25])

    def test_storage_groups_and_small_samples_are_not_pooled(self):
        leg, files, binding = fixture([0])
        def edit(s):
            sample = copy.deepcopy(s['samples'][0]); sample['height'] = 20; sample['persistence'].update(height=20, storage='block-journal-v2')
            s['samples'].append(sample); s['successNotifications'] = 2
        change(leg, files, 'commit', 0, edit)
        result = self.read(leg, files, binding)['nodes']['0']['commit']['allRetained']['byStorage']
        self.assertEqual(set(result), {'atomic-json', 'block-journal-v2'})
        self.assertTrue(all(v['retainedSuccessCount'] == 1 and v['persistenceElapsed']['retainedSampleP95Ns'] is None for v in result.values()))

    def test_returned_raw_samples_joins_and_bindings_are_owned(self):
        leg, files, binding = fixture([0]); before = copy.deepcopy(leg); report = self.read(leg, files, binding)
        report['binding']['source']['commit'] = 'changed'
        report['nodes']['0']['finalize']['business']['samples'][19]['childrenNs'].clear()
        report['nodes']['0']['commit']['originalSnapshot']['samples'].clear()
        self.assertEqual(leg, before); again = self.read(leg, files, binding)
        self.assertEqual(again['nodes']['0']['finalize']['business']['samples'][19]['childrenNs'], {'seal.fee_materialize': 3})

    def test_false_coverage_and_duplicate_commit_height_refused(self):
        for mode in ('coverage', 'height'):
            leg, files, binding = fixture([0])
            if mode == 'coverage': leg['receipt']['normalFinalizeObservation']['records'][0]['complete'] = False
            else:
                def edit(s): s['samples'].append(copy.deepcopy(s['samples'][0])); s['successNotifications'] = 2
                change(leg, files, 'commit', 0, edit)
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'coverage differs|duplicate/regressed'):
                self.read(leg, files, binding)


    def test_incomplete_child_denominator_with_twenty_samples_has_no_p95(self):
        leg, files, binding = fixture([0]); samples = [success(i, i) for i in range(1, 22)]
        samples[-1]['childrenNs'] = {}
        def edit(s): s['observation'].update(attempts=21, samples=samples, latest=copy.deepcopy(samples[-1]))
        change(leg, files, 'finalize', 0, edit)
        child = self.read(leg, files, binding)['nodes']['0']['finalize']['retainedSuccessStages']['children']['seal.fee_materialize']
        self.assertEqual((child['denominator'], child['observed'], child['missingOrCensored']), (21, 20, 1))
        self.assertIsNone(child['retainedSampleP95Ns'])

    def test_normal_business_reader_consumes_stage_originals_through_its_real_file_reader(self):
        # Only unrelated network arithmetic is stubbed; original receipt/file,
        # stage validators, process joins and normal A/B entry all execute.
        leg, files, binding = fixture(); receipt = leg['receipt']
        for row, body, verified, confirmed, exported in zip(receipt['functionalCohort'], leg['canonicalTransactions'],
                leg['originalVerifiers'], leg['originalConfirms'], leg['originalExports']):
            name = 'functional-owner-' + str(row['owner'])
            files[name+'-intent.json'] = raw(dict(transaction=base64.b64encode(body).decode()))
            files[name+'-normal-verifier.log'] = raw(verified)
            files[name+'-original-confirm.log'] = raw(confirmed)
            files[name+'-original-export.log'] = raw(dict(exported, checkpoint=dict(sha256=sha(leg['stoppedStateBytes']))))
            files[name+'-public-proof/export/committed-state.json'] = leg['stoppedStateBytes']
        network_binding = dict(tools=leg['toolsCommit'], source=receipt['source']['commit'], runID='unit-original-1')
        files['network-binding.json'] = raw(network_binding)
        files['network-accounting.json'] = raw(dict(binding=network_binding, nodes=[
            dict(liveWindow=dict(losslessStatus=dict(start=dict(status='DISABLED'), end=dict(status='DISABLED')))) for _ in range(4)]))
        files['network-hop-accounting.json'] = raw(dict(sourceSocketEndpointBytesSentSum=123,
            sourceSocketEndpointRetransmittedBytesSum=0, directedHops=[]))
        reads = []
        for phase in ('before', 'after'):
            checkpoint = []
            for node in range(4):
                proc = next(p for p in receipt['processes'] if p['name'] == f'pq-node-{node}')
                sample = dict(status='OBSERVED', producerPID=str(proc['pid']), startMonotonicNs=3, endMonotonicNs=4)
                sample_raw = raw(sample)
                ret = dict(status='OBSERVED', identity=dict(pid=str(proc['pid']), startTicks=str(proc['startTicks'])),
                           rawSHA256=sha(sample_raw), startMonotonicNs=2, endMonotonicNs=5)
                prefix = 'network-live-originals/' + proc['name'] + '-' + phase
                bodies = {prefix+'.raw.json': sample_raw, prefix+'.result.json': raw(ret),
                          prefix+'.intent.json': b'{}', prefix+'.data.json': b'{}'}
                files.update(bodies)
                entry = dict(node=proc['name'], phase=phase, status='OBSERVED', noRetry=True,
                             pid=proc['pid'], startTicks=str(proc['startTicks']), rawSHA256=sha(sample_raw),
                             readStartMonotonicNs=1, readEndMonotonicNs=6,
                             originalFiles=[dict(path=name, bytes=len(body), sha256=sha(body)) for name, body in bodies.items()])
                reads.append(entry); files[proc['name']+'-live-'+phase+'-read.json'] = raw(entry)
                checkpoint.append(dict(name=proc['name'], live=dict(raw=sample_raw.decode())))
            files['network-'+('start' if phase == 'before' else 'end')+'.json'] = raw(dict(nodes=checkpoint))
        receipt['liveNetworkReads'] = reads
        receipt['normalLiveBuildSource'] = dict(optionalForkCommit=r.PAIR_SUPPLIER['commit'], optionalForkTree=r.PAIR_SUPPLIER['tree'])
        files['NORMAL-LIVE-BASELINE-CI.json'] = raw(dict(tools=leg['toolsCommit'], goSource=receipt['source']['commit'],
            goTree=receipt['source']['tree'], caps=receipt['caps'], controllerCommit='2'*40))
        files['receipt.json'] = raw(receipt)
        original_spec = importlib.util.spec_from_file_location
        class NetworkArithmeticLoader:
            def create_module(self, spec): return types.ModuleType(spec.name)
            def exec_module(self, value):
                value.account_layers = lambda **kwargs: {}
                value.directional_hops = lambda *args: {}
        def selected_spec(name, path, *args, **kwargs):
            if name in ('pair_original_layers', 'pair_original_hops'):
                return importlib.machinery.ModuleSpec(name, NetworkArithmeticLoader())
            return original_spec(name, path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as temp:
            public = Path(temp).resolve()
            for name, body in files.items():
                target = public/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(body)
            with mock.patch.object(importlib.util, 'spec_from_file_location', side_effect=selected_spec):
                result = r.read_normal_business_leg(public, sha(files['receipt.json']), leg['toolsCommit'])
        observed = result['nodeStageData']
        self.assertEqual(observed['binding']['receiptSHA256'], sha(files['receipt.json']))
        self.assertEqual(observed['binding']['source'], receipt['source'])
        self.assertEqual(observed['binding']['toolsCommit'], leg['toolsCommit'])
        self.assertEqual(observed['nodes']['0']['commit']['originalSnapshot'], json.loads(files['commit-observation-node-0-original.json']))
        read_paths = {Path(p['path']).name for p in result['provenance']['files']}
        self.assertTrue(all(f'finalize-observation-node-{n}-original.json' in read_paths for n in range(4)))


if __name__ == '__main__':
    unittest.main()
