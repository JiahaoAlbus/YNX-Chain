"""Launch a separately scoped, directory-only recheck via the frozen QA consumer."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

HERE = Path(__file__).resolve().parent
PARENT = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113')
CASE = PARENT / 'full-directory-fresh-recheck-20261114'
ORIGINAL = HERE / 'run-directory-once.py'
ORIGINAL_SHA = '9523d50320992f0a377d06047ed7fd90a2842cbd152b24aa0579c6f1ca495722'
BUILD_SHA = '842f5ae703082b8a1c0cda5a715cc8e74b4369ed9a09473f52a8564b6ab41906'
BINARY_SHA = '855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--scope-sha256', required=True)
    args = cli.parse_args()
    scope = CASE / 'SCOPE.json'
    launch = CASE / 'LAUNCH_BINDING.json'
    if (not sys.dont_write_bytecode or Path.cwd() != CASE or CASE.resolve() != CASE
            or CASE.stat().st_dev == Path('/Users/huangjiahao').stat().st_dev
            or os.environ.get('TMPDIR') != str(CASE)
            or CASE.stat().st_uid != os.getuid() or stat.S_IMODE(CASE.stat().st_mode) != 0o700):
        raise RuntimeError('external-private-output')
    st = scope.lstat()
    if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_nlink != 1
            or stat.S_IMODE(st.st_mode) != 0o600 or not 0 < st.st_size <= 4096
            or sha(scope) != args.scope_sha256):
        raise RuntimeError('scope-pin')
    value = json.loads(scope.read_text())
    if (value.get('purpose') != 'fresh-empty-profile-directory-body-only'
            or value.get('runnerSHA256') != ORIGINAL_SHA or sha(ORIGINAL) != ORIGINAL_SHA):
        raise RuntimeError('strict-directory-only-runner')
    spec = importlib.util.spec_from_file_location('original_directory_recheck', ORIGINAL)
    runner = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runner
    spec.loader.exec_module(runner)
    source_sha = runner.verified_build(BUILD_SHA, BINARY_SHA)
    runner.WORK = CASE
    g = runner.module(runner.GUARD)
    decoder = runner.module(runner.GLUE / 'qa_capability_directory_capture.py')
    observer = runner.module(runner.GLUE / 'qa_directory_body_failure.py')
    r2 = runner.module(runner.R2)
    runner.save(launch, {'scopeSHA256': args.scope_sha256, 'wrapperSHA256': sha(Path(__file__)),
                         'originalRunnerSHA256': ORIGINAL_SHA, 'immutableBuildReceiptSHA256': BUILD_SHA,
                         'binarySHA256': BINARY_SHA, 'sourceManifestSHA256': source_sha,
                         'supervisorPID': os.getpid(), 'supervisorPGID': os.getpgrp()})
    return runner.fetch(g, decoder, observer, r2, BUILD_SHA, BINARY_SHA, source_sha, scope, args.scope_sha256)


if __name__ == '__main__':
    raise SystemExit(main())
