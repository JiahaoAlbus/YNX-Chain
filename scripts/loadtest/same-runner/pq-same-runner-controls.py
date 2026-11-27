"""Single original CI hook for pure pair reader/producer controls; no runtime."""
import importlib.util
from pathlib import Path
import unittest


def suite():
    result = unittest.TestSuite()
    for name in ('test_pq_same_runner_pair_readback', 'test_pq_same_runner_pair_producer',
                 'test_pq_same_runner_original_adapter', 'test_pq_same_runner_controller',
                 'test_pq_same_runner_workflow', 'test_pq_pair_clock_readback',
                 'test_pq_pair_confirmation_bound', 'test_pq_serial_controls_readback'):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        result.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
    if result.countTestCases() != 149:
        raise RuntimeError('all 149 pair controls must be selected')
    return result


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(suite())
    if result.testsRun != 149 or result.skipped or not result.wasSuccessful():
        raise SystemExit('all 149 pair controls must execute and pass without skips')
