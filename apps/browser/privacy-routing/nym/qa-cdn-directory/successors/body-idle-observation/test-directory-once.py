#!/usr/bin/env python3
"""A real harmless child checks terminal stderr capture and one-attempt fencing."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time


def load(path):
    spec = importlib.util.spec_from_file_location('runner_test_target', path)
    runner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runner
    spec.loader.exec_module(runner)
    return runner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-directory', type=Path, required=True)
    options = parser.parse_args()
    entry = Path(__file__).with_name('run-directory-once.py')
    runner = load(entry)
    guard = runner.module(runner.GUARD)
    decoder = runner.module(runner.GLUE / 'qa_capability_directory_capture.py')
    observer = runner.module(runner.GLUE / 'qa_directory_body_failure.py')
    original = runner.module(runner.R2)
    # This uses only the real subprocess/pipe/custody path, with a harmless shell
    # executable that prints a pinned, synthetic terminal failure and exits.
    # No release provenance, network, TLS, profile, or post-directory execution.
    root = Path(tempfile.mkdtemp(prefix='local-owned-runner.', dir=options.output_directory))
    runner.WORK = root
    runner.ARTIFACT = root / 'owned-failure'
    runner.ARTIFACT.write_text("""#!/bin/sh
printf '%s\n' 'An error occurred: qa-directory-body-idle'
printf '%s%s%s\n' 'YNX_NYM_QA_BODY_FAILURE_V1 {"schema":"YNX_NYM_QA_BODY_FAILURE_V1","runID":"' "$8" '","resource":"described","page":0,"reason":"qa-directory-body-idle","expectedBodyBytes":12,"receivedBodyBytes":2,"sessionBodyBytes":6,"nonemptyChunks":1}' >&2
exit 1
""")
    runner.ARTIFACT.chmod(0o500)
    runner.__file__ = str(entry)
    sha = runner.sha(runner.ARTIFACT)
    receipt = '0' * 64
    scope = root / 'scope.json'
    now = int(time.time())
    runner.save(scope, {'schema': 'P05_NYM_BODY_DIAGNOSTIC_SCOPE_V1', 'runnerSHA256': runner.sha(entry),
                        'buildReceiptSHA256': receipt, 'binarySHA256': sha, 'notBefore': now - 1,
                        'latestStart': now + 60, 'purpose': 'fresh-directory-then-one-fixed-ddg'})
    scope_sha = runner.sha(scope)
    args = (guard, decoder, observer, original, receipt, sha, '1' * 64, scope, scope_sha)
    if runner.fetch(*args) != 1:
        raise AssertionError('failed original process accepted')
    case = root / 'once-fresh-directory'
    value = json.loads((case / 'receipt.json').read_text())
    assert value['firstFailure']['cause'] == 'directory-original-exit:1'
    assert value['fixedErrorLabels'] == ['qa-directory-body-idle']
    assert value['bodyFailure'] == {'resource': 'described', 'page': 0, 'reason': 'qa-directory-body-idle',
                                    'expectedBodyBytes': 12, 'receivedBodyBytes': 2, 'sessionBodyBytes': 6,
                                    'nonemptyChunks': 1}
    assert value['capturedEOF'] == ['stderr', 'stdout'] and value['FDClosed']
    assert not value['remainingOwned'] and value['processes'][0]['exit'] == 1 and value['processes'][0]['reaped']
    assert value['freshQAProfileRemainsEmpty'] and not (case / 'route').exists()
    # The second invocation never starts a child; the first durable receipt stays put.
    original_receipt = runner.sha(case / 'receipt.json')
    try:
        runner.fetch(*args)
    except FileExistsError:
        assert runner.sha(case / 'receipt.json') == original_receipt
    else:
        raise AssertionError('already consumed scope accepted')
    print(json.dumps({'fixture': str(case / 'receipt.json'), 'SHA256': original_receipt,
                      'realOriginalChildWaitAndEOF': True, 'firstCauseAndFrame': True,
                      'oneAttemptAndNoRouteOnDirectoryFailure': True, 'publicNetwork': False}))


if __name__ == '__main__':
    main()
