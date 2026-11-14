#!/usr/bin/env python3
"""Supply pinned official Go modules, then run the isolated backend guard tests."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


MODULES = {
    'transport': ('github.com/pion/transport/v4@v4.0.1', 'h1:sdROELU6BZ63Ab7FrOLn13M6YdJLY20wldXW2Cu2k8o='),
    'ice': ('github.com/pion/ice/v4@v4.2.0', 'h1:jJC8S+CvXCCvIQUgx+oNZnoUpt6zwc34FhjWwCU4nlw='),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--supply-only', action='store_true', help='Verify module supply without rerunning guard tests')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    go = shutil.which('go')
    supplier = out / 'supplier'
    supplier.mkdir()
    (supplier / 'go.mod').write_text('module ynx.local/guard-ci-supply\n\ngo 1.22\n')
    cache = out / 'gomodcache'
    env = dict(os.environ, GOWORK='off', GOTOOLCHAIN='local', GOFLAGS='',
               GOPROXY='https://proxy.golang.org', GOSUMDB='sum.golang.org',
               GOPRIVATE='', GONOSUMDB='', GONOPROXY='', GOMODCACHE=str(cache))
    receipt = {'privacyNetworkTest': 'NOT_RUN', 'modules': {}, 'tests': 'NOT_RUN'}
    try:
        if not go:
            raise RuntimeError('Go toolchain missing; no tests ran')
        for role, (module, expected) in MODULES.items():
            result = subprocess.run([go, 'mod', 'download', '-json', module], cwd=supplier,
                                    env=env, text=True, capture_output=True, timeout=60)
            (out / (role + '-download.json')).write_text(result.stdout)
            (out / (role + '-download.stderr')).write_text(result.stderr)
            if result.returncode:
                raise RuntimeError(role + ' module supply failed: exit ' + str(result.returncode))
            info = json.loads(result.stdout)
            source = Path(info['Dir']).resolve()
            if info.get('Error') or info.get('Sum') != expected or cache.resolve() not in source.parents:
                raise RuntimeError(role + ' module identity mismatch')
            receipt['modules'][role] = {'module': module, 'sum': expected, 'source': str(source)}
        if args.supply_only:
            receipt['status'] = 'PASS_SUPPLY_ONLY'
            return
        script = Path(__file__).resolve().parents[1] / 'privacy-routing/tor/tests/test_public_egress_guard.py'
        command = [sys.executable, str(script), '--go', go,
                   '--transport-source', receipt['modules']['transport']['source'],
                   '--ice-source', receipt['modules']['ice']['source'], '--output', str(out / 'tests')]
        result = subprocess.run(command, timeout=90)
        receipt['tests'] = {'exit': result.returncode, 'result': str(out / 'tests/RESULT.json')}
        if result.returncode:
            raise RuntimeError('candidate guard tests failed: exit ' + str(result.returncode))
        receipt['status'] = 'PASS'
    except Exception as error:
        receipt.update(status='FAIL', firstCause=str(error))
        raise
    finally:
        (out / 'RESULT.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
