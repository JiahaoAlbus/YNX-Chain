"""Single original CI hook for pure pair reader/producer controls; no runtime."""
import importlib.util
from pathlib import Path
import unittest


def suite():
    result = unittest.TestSuite()
    for name in ('test_pq_same_runner_pair_readback', 'test_pq_same_runner_pair_producer'):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        result.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
    if result.countTestCases() == 0:
        raise RuntimeError('pair controls must not silently select zero tests')
    return result


if __name__ == '__main__':
    raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite()).wasSuccessful())
