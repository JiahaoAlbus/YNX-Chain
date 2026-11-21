"""Run the exact bounded source-evidence controls; missing and skipped are failures."""
import importlib.util
from pathlib import Path
import unittest

CONTROLS=(('test_pq_source_history_readback',10),('test_pq_getter_source_readback',6),('test_pq_source_evidence_archive',4),('test_pq_before59_equivalence_readback',8))

def main():
    suite=unittest.TestSuite()
    for name,count in CONTROLS:
        spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        part=unittest.defaultTestLoader.loadTestsFromModule(module)
        if part.countTestCases()!=count: raise RuntimeError('original source evidence control inventory differs: '+name)
        suite.addTests(part)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    expected=sum(count for _,count in CONTROLS)
    if result.testsRun!=expected or result.skipped or result.expectedFailures or result.unexpectedSuccesses or not result.wasSuccessful():
        raise SystemExit('original source evidence controls did not all execute successfully')
    print('YNX_ORIGINAL_SOURCE_EVIDENCE_CONTROLS tests=%d skipped=0 dataOnly=true'%expected)

if __name__=='__main__':main()
