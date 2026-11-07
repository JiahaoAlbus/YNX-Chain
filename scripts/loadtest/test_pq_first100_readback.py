"""Original-row reduction controls; fixture events supply no chain authority."""
import copy
import importlib.util
from pathlib import Path
import unittest

def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=module('first100_reader_controls','pq-first100-readback.py')
controls=module('first100_observed_fixture','test_pq_observed_throughput.py')

class First100ReadbackControls(unittest.TestCase):
    def original_rows(self, count=500):
        c=controls.ObservedThroughputControls();ledger=c.ledger(500)
        for _ in range(count):
            row=c.submitted(ledger);at=ledger.plan['windowNs']+3
            c.event(ledger,row,'included',at);c.final(ledger,row,at+1)
        return ledger.report(ledger.plan['windowNs']+6)

    def test_tail_completion_keeps_window_effective_tps_zero(self):
        result=m.cohort(self.original_rows())
        self.assertEqual(result['counts']['qualifiedReceipt'],dict(total=500,withinWindow=0,inTail=500,windowTPS=0))
        self.assertFalse(result['sustainedTPSQualified'] or result['consensusCommitTimestampMeasured'])

    def test_missing_one_final_confirmation_censors_all_cohort_percentiles(self):
        result=m.cohort(self.original_rows(499))
        for row in result['latencies'].values():
            self.assertEqual(row['censored'],1)
            self.assertTrue(all(row[f'p{p}Ms'] is None for p in (50,95,99)))

    def test_report_cannot_inflate_tps_without_original_rows(self):
        report=self.original_rows();report['observedThroughput']['qualifiedReceiptTPS']=100
        with self.assertRaisesRegex(RuntimeError,'qualified cohort'):m.cohort(report)

    def test_missing_duplicate_rows_cannot_shrink_denominator(self):
        report=self.original_rows()
        for rows in (report['rows'][:-1],report['rows'][:-1]+[report['rows'][0]]):
            changed=copy.deepcopy(report);changed['rows']=rows
            with self.assertRaisesRegex(RuntimeError,'all original500'):m.cohort(changed)

    def test_confirmation_before_inclusion_is_not_valid_latency(self):
        report=self.original_rows();report['rows'][0]['finalNs']=report['rows'][0]['submittedNs']
        with self.assertRaisesRegex(RuntimeError,'same original inclusion'):m.cohort(report)

if __name__=='__main__':unittest.main()
