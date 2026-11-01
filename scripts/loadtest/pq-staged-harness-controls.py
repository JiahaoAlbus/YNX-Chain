"""Original CI hook for the staged harness's pure functional controls only."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import unittest

GROUPS=[
 ('test_pq_lossless_source_data.py',None,4),
 ('test_pq_commit_observation.py',None,12),
 ('test_pq_normal_pair_gates.py',None,12),
 ('test_pq_height_vectors.py',['HeightVectorControls.test_committed_time_and_complete_history_cannot_hide_behind_equal_balances'],1),
 ('test_pq_load_escalation_conditions.py',None,4),
 ('test_resource_guard_sampling.py',None,9),
 ('test_pq_normal_clean_exit.py',None,4),
 ('test_pq_normal_parent_measurements.py',None,7),
 ('test_pq_normal_live_source_data.py',None,5),
 ('test_pq_normal_live_build_source.py',None,4),
 ('test_pq_normal_network_baseline.py',None,5),
 ('test_pq_normal_live_reader.py',None,15),
 ('test_pq_initialization_readback.py',None,14),
 ('test_pq_cold_readiness.py',None,12),
 ('test_pq_live_source_qualification.py',None,7),
 ('test_pq_initialization_measurements.py',None,30),
 ('test_pq_completion_diagnostics.py',None,20),
 ('test_pq_staged_independent_scheduler.py',None,16),
 ('test_pq_bounded_sender_backend.py',None,19),
 ('test_pq_owned_header_capture.py',['OwnedNamespaceIdentityControls','OwnedHeaderCaptureControls.test_unknown_namespace_fails_before_socket_creation'],4),
 ('test_pq_independent_load.py',['IndependentLoadControls.test_nearly_complete500_still_censors_every_full_cohort_percentile','ProofExportStageControls'],2),
]

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False);parser.add_argument('--run',action='store_true');args=parser.parse_args(argv)
    if not args.run:
        print(json.dumps(dict(kind='PURE_HARNESS_CONTROLS_ONLY',executed=False,expectedCases=sum(n for _,_,n in GROUPS),normalGoOrChainEvidence=False,pressureAuthorized=False)));return 0
    here=Path(__file__).resolve().parent;total=0
    for name,selectors,count in GROUPS:
        spec=importlib.util.spec_from_file_location('staged_ci_'+name.removesuffix('.py'),here/name);module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
        loader=unittest.defaultTestLoader
        suite=loader.loadTestsFromModule(module) if selectors is None else unittest.TestSuite(loader.loadTestsFromName(selector,module) for selector in selectors)
        result=unittest.TextTestRunner(verbosity=2).run(suite)
        if result.testsRun!=count or result.skipped or not result.wasSuccessful():raise RuntimeError('all declared pure controls must actually run without skips: '+name)
        total+=result.testsRun
    print(json.dumps(dict(kind='PURE_HARNESS_CONTROLS_ONLY',executed=True,passed=total,skipped=0,normalGoOrChainEvidence=False,pressureAuthorized=False)));return 0

if __name__=='__main__':raise SystemExit(main())
