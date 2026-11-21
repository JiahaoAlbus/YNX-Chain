"""Original Window sampling and bounded evidence controls; no node or workload."""
import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


fixture = module('process_rss_original_resource_fixture', 'test_resource_guard_sampling.py')
lab = fixture.lab
reader = module('process_rss_original_stage_reader', 'pq-first100-stage-summary.py')


class ProcessRSSObservationControls(unittest.TestCase):
    def setUp(self):
        for name in ('subprocess.Popen', 'urllib.request.urlopen', 'socket.create_connection'):
            patch = mock.patch(name, side_effect=AssertionError('metadata control must not launch or connect'))
            patch.start(); self.addCleanup(patch.stop)

    def window(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        return fixture.ResourceGuardSamplingControls().window(Path(temporary.name))

    def rows(self, child=False):
        return fixture.ResourceGuardSamplingControls().rows(child)

    def reduce(self, report):
        return reader.process_rss_observations(dict(processRSSObservation=report))

    def test_same_original_values_capture_peak_outside_global_peak_without_extra_reads(self):
        window = self.window(); calls = {os.getpid(): 0, 987654: 0}
        values = {os.getpid(): [200, 10], 987654: [100, 250]}
        def sample(pid, *_):
            value = values[pid][calls[pid]]; calls[pid] += 1; return value
        with mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(True), [])) as inventory, \
             mock.patch.object(lab, 'owned_rss', side_effect=sample) as rss:
            window.sample(); window.sample()
        self.assertEqual(inventory.call_count, 2)
        self.assertEqual(rss.call_count, 4)
        self.assertEqual(window.peak_rss, 300)
        peak = next(r for r in window.peak_rss_sample['processes'] if r['pid'] == 987654)
        self.assertEqual(peak['rssBytes'], 100)
        report = window.process_rss_report()
        row = next(r for r in self.reduce(report)['records'] if r['pid'] == 987654)
        self.assertEqual((row['observedCount'], row['observedMaxRSSBytes']), ('2', 250))
        self.assertIsNone(row['allTimePeakRSSBytes'])
        self.assertEqual(report['observations'], '4')
        self.assertEqual(window.sample_stage_report()['stages']['processRSSRetention']['calls'], 4)

    def test_original_cap_failure_retains_same_sample_before_raising(self):
        window = self.window()
        with mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(), [])), \
             mock.patch.object(lab, 'owned_rss', return_value=lab.CAPS['rssBytes']+1) as rss:
            with self.assertRaisesRegex(RuntimeError, 'owned RSS exceeded 4GiB') as caught: window.sample()
        self.assertIs(window.launch_guard_failure, caught.exception)
        self.assertTrue(window.launches_closed)
        rss.assert_called_once()
        row = self.reduce(window.process_rss_report())['records'][0]
        self.assertEqual(row['observedMaxRSSBytes'], lab.CAPS['rssBytes']+1)

    def test_original_owned_rss_exception_is_not_replaced_or_counted_as_zero(self):
        window = self.window(); error = RuntimeError('original proc refusal')
        with mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(), [])), \
             mock.patch.object(lab, 'owned_rss', side_effect=error):
            with self.assertRaises(RuntimeError) as caught: window.sample()
        self.assertIs(caught.exception, error)
        self.assertIs(window.launch_guard_failure, error)
        report = window.process_rss_report()
        self.assertEqual(report['observations'], '0')
        self.assertFalse(report['failedOwnedRSSCallsMeasured'])
        self.assertEqual(self.reduce(report)['records'], [])

    def test_unavailable_return_and_real_zero_remain_distinct_original_observations(self):
        window = self.window()
        with mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(), [])), \
             mock.patch.object(lab, 'owned_rss', side_effect=[None, 0]) as rss:
            window.sample(); window.sample()
        self.assertEqual(rss.call_count, 2)
        row = self.reduce(window.process_rss_report())['records'][0]
        self.assertEqual((row['observedCount'], row['missingCount']), ('1', '1'))
        self.assertEqual(row['observedMaxRSSBytes'], 0)

    def test_original_vmsize_fallback_is_separate_from_measured_rss(self):
        window = self.window()
        def sample(pid, before, retired, fallback):
            fallback(dict(pid=pid, startTicks=before['startTicks'], sampleKind='same-thread-group-VmSize-upper-bound',
                          sampledBytes=500, retired=False, reason='same-thread-group-VmSize-upper-bound'))
            return 500
        with mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(), [])), \
             mock.patch.object(lab, 'owned_rss', side_effect=sample) as rss:
            window.sample()
        rss.assert_called_once()
        self.assertEqual(window.peak_rss, 500)  # Original conservative cap accounting unchanged.
        self.assertEqual(len(window.rss_fallback_samples), 1)
        row = self.reduce(window.process_rss_report())['records'][0]
        self.assertEqual((row['observedCount'], row['upperBoundCount']), ('0', '1'))
        self.assertIsNone(row['observedMaxRSSBytes'])
        self.assertEqual(row['observedMaxVirtualUpperBoundBytes'], 500)

    def test_new_descendant_and_reused_pid_start_ticks_have_separate_records(self):
        sink = lab.ProcessRSSObservation()
        sink.retain(101, 7, 100, at_ns=1)
        sink.retain(101, 8, 900, at_ns=2)
        rows = self.reduce(sink.report())['records']
        self.assertEqual([(r['startTicks'], r['observedMaxRSSBytes']) for r in rows], [(7, 100), (8, 900)])

    def test_kernel_retirement_zero_is_not_relabelled_as_a_measured_rss_zero(self):
        window = self.window()
        def sample(pid, before, retired, fallback):
            retired(dict(pid=pid, startTicks=before['startTicks'], reason='same-identity-zombie', rssError=3))
            return 0
        with mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(), [])), \
             mock.patch.object(lab, 'owned_rss', side_effect=sample):
            window.sample()
        row = self.reduce(window.process_rss_report())['records'][0]
        self.assertEqual((row['observedCount'], row['retiredZeroCount']), ('0', '1'))
        self.assertIsNone(row['observedMaxRSSBytes'])
        self.assertEqual(window.peak_rss, 0)

    def test_distinct_record_limit_omits_new_keys_but_keeps_existing_observations(self):
        sink = lab.ProcessRSSObservation()
        for i in range(lab.ProcessEvidence.LIMIT): sink.retain(i+1, i, 1, at_ns=i)
        sink.retain(900001, 1, 2, at_ns=5000)
        sink.retain(900001, 1, 3, at_ns=5001)
        sink.retain(1, 0, 8, at_ns=5002)
        report = sink.report()
        self.assertEqual(len(report['records']), 4096)
        self.assertEqual((report['observations'], report['omittedObservations']), ('4099', '2'))
        result = self.reduce(report)
        self.assertEqual(result['records'][0]['observedMaxRSSBytes'], 8)
        self.assertTrue(result['records'][0]['omittedObservationsCouldAffectIdentity'])

    def test_clock_retention_error_does_not_short_circuit_original_cap(self):
        window = self.window()
        with mock.patch.object(lab.time, 'monotonic_ns', side_effect=OSError('clock unavailable')), \
             mock.patch.object(lab.guard, 'proc_inventory', return_value=(self.rows(), [])), \
             mock.patch.object(lab, 'owned_rss', return_value=lab.CAPS['rssBytes']+1) as rss:
            with self.assertRaisesRegex(RuntimeError, 'owned RSS exceeded 4GiB'): window.sample()
        rss.assert_called_once()
        report = window.process_rss_report()
        self.assertEqual((report['status'], report['retentionErrors'], report['omittedObservations']), ('PARTIAL', '1', '1'))
        self.assertEqual(report['firstRetentionErrorType'], 'OSError')
        self.assertEqual(self.reduce(report)['records'], [])

    def test_retention_first_error_and_omitted_counts_survive_later_success(self):
        sink = lab.ProcessRSSObservation()
        with mock.patch.object(sink.evidence, 'retain', side_effect=[OSError('first'), RuntimeError('second')]):
            sink.retain(101, 7, 10); sink.retain(101, 7, 20)
        sink.retain(101, 7, 30, at_ns=3)
        report = sink.report()
        self.assertEqual((report['retentionErrors'], report['firstRetentionErrorType']), ('2', 'OSError'))
        self.assertEqual((report['observations'], report['omittedObservations']), ('3', '2'))
        self.assertEqual(self.reduce(report)['records'][0]['observedMaxRSSBytes'], 30)

    def test_counter_overflow_reports_unknown_instead_of_wrapping_or_reusing_samples(self):
        sink = lab.ProcessRSSObservation(); sink.observations = lab.ProcessEvidence.MAX_COUNT
        sink.retain(101, 7, 30, at_ns=1)
        report = sink.report()
        self.assertEqual(report['status'], 'UNKNOWN')
        self.assertIsNone(report['observations'])
        self.assertEqual(self.reduce(report)['status'], 'UNKNOWN')

    def test_report_lock_refusal_is_bounded_and_does_not_fabricate_empty_success(self):
        window = SimpleNamespace(lock=mock.Mock())
        window.lock.acquire.return_value = False
        report = lab.Window.process_rss_report(window)
        window.lock.acquire.assert_called_once_with(timeout=1)
        window.lock.release.assert_not_called()
        self.assertEqual(self.reduce(report)['status'], 'UNKNOWN')
        self.assertIsNone(report['observations'])

    def test_published_report_is_independent_of_later_mutation_and_no_sampler_called(self):
        sink = lab.ProcessRSSObservation(); sink.retain(101, 7, 30, at_ns=1)
        with mock.patch.object(lab, 'owned_rss', side_effect=AssertionError('extra read')):
            report = sink.report()
            report['records'][0]['maxSampledBytes'] = 999
            report['records'][0]['firstEvent']['sampledBytes'] = 999
            self.assertEqual(sink.report()['records'][0]['maxSampledBytes'], 30)


if __name__ == '__main__':
    unittest.main()
