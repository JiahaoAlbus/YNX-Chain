"""Original-row reduction controls; fixture events supply no chain authority."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

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

    def test_missing_post_release_result_preserves_unknown_and_first_cause(self):
        source=dict(commit=m.SOURCE,tree=m.TREE)
        receipt=dict(source=source,toolIdentity=dict(commit=m.TOOLS),freshResourceAdmission={},
                     loadExecuted=True,firstCause='EOF after original POST; do not resend')
        values={'receipt.json':receipt,'CURRENT703-BASELINE-CI.json':dict(controllerCommit=m.CONTROLLER,
                goSource=m.SOURCE,tools=m.TOOLS,measurementScope='same-window-normal504-initialization-then-first100x5'),
                'requested-load.json':dict(source=source,rate=100,seconds=5,accounts=500,perAccountCapacity=1,configuredDemand=500),
                'fresh-resource-admission.json':{}}
        files={k:json.dumps(v).encode() for k,v in values.items()}
        with mock.patch.object(m.original,'journals',return_value={}),mock.patch.object(m.original,'commit_original_copies',return_value={}),mock.patch.object(m.original,'original_node_startup',return_value={}):
            result=m.inspect(files)
        self.assertIsNone(result['observedBusiness'])
        self.assertEqual(result['businessObservationStatus'],'RELEASE_OBSERVED_RESULT_NOT_SUPPLIED')
        self.assertEqual(result['originalFirstCause'],receipt['firstCause'])
        self.assertFalse(result['stable1000TPSQualified'])

if __name__=='__main__':unittest.main()
