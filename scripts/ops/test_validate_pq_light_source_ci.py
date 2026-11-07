#!/usr/bin/env python3
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
TOPS = ['TestPQLightSourcePUBLICZeroTransactionExport', 'TestPQLightSourcePUBLICNormalVerifier', 'TestExportLightSourceNormalCommandStrictArguments', 'TestExportLightSourceRejectsPlanBeforeOpeningStoresOrOutput']
PATHS = ['scripts/verify/pq-light-source-check.sh', 'scripts/ops/collect_pq_light_source_tests.py', 'scripts/ops/test_collect_pq_light_source_tests.py', 'scripts/ops/test_validate_pq_light_source_ci.py']


def validate(workflow, recipe):
    for name in PATHS:
        if workflow.count("      - '" + name + "'") != 2:
            raise ValueError('normal push/PR trigger missing or duplicate')
    for name in PATHS[2:]:
        if workflow.count('python3 -B ' + name + ' -v') != 1:
            raise ValueError('pure guard must run once')
    begin = '      - name: Verify original zero-transaction light source and normal verifier\n'
    end = '      - name: Retain original zero-transaction light source public evidence\n'
    if workflow.count(begin) != 1 or workflow.count(end) != 1:
        raise ValueError('mandatory normal execution/evidence step missing')
    step = workflow.split(begin, 1)[1].split(end, 1)[0]
    expected = """        if: ${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}
        timeout-minutes: 4
        env:
          YNX_PQ_LIGHT_SOURCE_EVIDENCE: ${{ runner.temp }}/ynx-pq-light-source-public
        run: timeout -k 5s 205s bash scripts/verify/pq-light-source-check.sh
"""
    if step != expected:
        raise ValueError('execution condition, bound, or actual recipe differs')
    selector = "-run '^(" + '|'.join(TOPS) + ")$'"
    for literal in (selector, 'go test -mod=readonly -json -p 1 -count=1 -timeout=120s -tags=ynx_public_trace_testsupport', './internal/consensus ./cmd/ynx-consensus-proof-verify ./cmd/ynx-comet', 'GOMAXPROCS=2 GOMEMLIMIT=1536MiB', 'scripts/loadtest/fixtures/finalize-1b-public', 'python3 -B scripts/ops/collect_pq_light_source_tests.py "$case_root/GO.jsonl"'):
        if recipe.count(literal) != 1:
            raise ValueError('exact new mandatory package/test/fixture/collector contract differs')
    if recipe.count('\ngo test ') != 1 or '|| true' in recipe or '-skip' in recipe:
        raise ValueError('new execution may not skip, duplicate, or suppress failure')


class LightSourceCIContractTests(unittest.TestCase):
    def setUp(self):
        self.workflow = (ROOT / '.github/workflows/resource-market-ci.yml').read_text()
        self.recipe = (ROOT / PATHS[0]).read_text()

    def test_actual_normal_hook(self):
        validate(self.workflow, self.recipe)

    def test_trigger_and_hook_mutations(self):
        for literal in ("      - '" + PATHS[0] + "'", 'python3 -B ' + PATHS[2] + ' -v', '205s bash scripts/verify/pq-light-source-check.sh'):
            with self.subTest(literal=literal), self.assertRaises(ValueError):
                validate(self.workflow.replace(literal, '', 1), self.recipe)

    def test_required_names_and_bounds(self):
        for literal in (*TOPS, '-p 1', '-timeout=120s', 'GOMEMLIMIT=1536MiB', 'scripts/loadtest/fixtures/finalize-1b-public', './cmd/ynx-consensus-proof-verify'):
            with self.subTest(literal=literal), self.assertRaises(ValueError):
                validate(self.workflow, self.recipe.replace(literal, 'missing'))


if __name__ == '__main__':
    unittest.main()
