#!/usr/bin/env python3
"""A fixed, low-disk HEAD diagnostic with process-local write restrictions."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import socket
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
EXTERNAL = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113')
SCOPE_DIR = EXTERNAL / 'header-phase-external-only'
TRANSPORT_SHA256 = 'd0e42957e9fb803c097765ef15a808d9630138adf00b356d2d008b6dffb4ed03'
MAX_WRITE = 16384


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verified_transport():
    path = HERE / 'header-phase-control.py'
    if sha(path) != TRANSPORT_SHA256:
        raise RuntimeError('original-transport-pin')
    spec = importlib.util.spec_from_file_location('original_header_control', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cap_process_writes(root, endpoint):
    """Constrain Python writes and socket dials before the fixed observer runs."""
    def is_within_root(value):
        if type(value) is int:
            return False
        return Path(os.fsdecode(value)).resolve().is_relative_to(root)

    def audit(event, args):
        if event == 'open':
            file, _, flags = args
            if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
                if not is_within_root(file):
                    raise PermissionError('write outside isolated external QA case')
        if event in ('os.remove', 'os.rmdir', 'os.mkdir', 'os.chmod', 'os.chown'):
            file, *rest = args
            if not is_within_root(file):
                raise PermissionError('mutation outside isolated external QA case')
        if event in ('os.rename', 'os.symlink', 'os.link'):
            raise PermissionError('filesystem linking and renaming disabled for HEAD')
        if event in ('socket.getaddrinfo', 'socket.gethostbyname', 'socket.gethostbyaddr',
                     'socket.gethostbyname_ex', 'socket.getnameinfo', 'subprocess.Popen', 'os.exec'):
            raise PermissionError('resolution and subprocesses disabled for HEAD')
        if event == 'socket.connect' and args[1] != endpoint:
            raise PermissionError('HEAD dial outside the fixed numeric peer')
    sys.addaudithook(audit)


def read_scope(scope_path, digest, now):
    st = scope_path.lstat()
    if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_nlink != 1
            or stat.S_IMODE(st.st_mode) != 0o600 or st.st_size > 4096
            or not re.fullmatch('[0-9a-f]{64}', digest) or sha(scope_path) != digest):
        raise RuntimeError('external-head-scope-file-pin')
    scope = json.loads(scope_path.read_text())
    keys = {'schema', 'runnerSHA256', 'purpose', 'notBefore', 'latestStart'}
    if (set(scope) != keys or scope['schema'] != 'P05_NYM_EXTERNAL_ONLY_HEAD_SCOPE_V1'
            or scope['runnerSHA256'] != sha(Path(__file__))
            or scope['purpose'] != 'one-official-basic-page-zero-head-external-only'
            or type(scope['notBefore']) is not int or type(scope['latestStart']) is not int
            or not 0 < scope['latestStart'] - scope['notBefore'] <= 900
            or not scope['notBefore'] <= now < scope['latestStart']):
        raise RuntimeError('external-head-scope-time-or-shape')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope-sha256', required=True)
    args = parser.parse_args()

    root = SCOPE_DIR.resolve(strict=True)
    st = root.lstat()
    if (root != SCOPE_DIR or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700
            or root.stat().st_dev == Path('/Users/huangjiahao').stat().st_dev
            or Path.cwd().resolve() != root or os.environ.get('TMPDIR') != str(root)
            or not sys.dont_write_bytecode):
        raise RuntimeError('external-head-case-not-isolated')
    read_scope(root / 'SCOPE.json', args.scope_sha256, time.time())
    fs = os.statvfs(root)
    raw = subprocess.run(['/usr/bin/memory_pressure', '-Q'], capture_output=True, text=True, timeout=3, check=True)
    memory = int(re.search(r'free percentage: (\d+)%', raw.stdout).group(1))
    if fs.f_bavail * fs.f_frsize < 16 * 1024**3 or memory < 35:
        raise RuntimeError('external-head-WD-or-memory-floor')
    transport = verified_transport()
    helper = transport.load_helper()
    context = helper.verified_context()
    if context.cert_store_stats().get('x509_ca', 0) < 1:
        raise RuntimeError('external-head-no-trusted-CA')
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_WRITE, MAX_WRITE))
    case = root / 'one-basic-head'
    case.mkdir(mode=0o700)
    cap_process_writes(case, transport.PEER)
    start = time.monotonic()
    print(json.dumps({'pid': os.getpid(), 'pgid': os.getpgrp(), 'monotonicStart': start,
                      'origin': transport.HOST, 'scopeSHA256': args.scope_sha256}), flush=True)
    result = transport.observe(transport.PEER, context, helper, connect_seconds=8, total_seconds=20)
    result.update(schema='P05_NYM_EXTERNAL_ONLY_HEAD_RESULT_V1', scopeSHA256=args.scope_sha256,
                  method='HEAD', transportSHA256=TRANSPORT_SHA256, approvedOrigin=transport.HOST,
                  tlsContextCheckHostname=context.check_hostname, tlsContextVerifyRequired=True,
                  rawResponsePersisted=False, acceptedDirectory=False, productionAuthority=False,
                  fileSizeCapBytes=MAX_WRITE,
                  ownedProcessPeakRSSBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    encoded = (json.dumps(result, indent=2) + '\n').encode()
    if len(encoded) > 4096:
        raise RuntimeError('external-head-receipt-bound')
    out = case / 'result.json'
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if os.write(fd, encoded) != len(encoded):
            raise OSError('short-receipt-write')
    finally:
        os.close(fd)
    print(json.dumps({'receipt': str(out), 'SHA256': sha(out), 'phaseResult': result}), flush=True)
    return int(bool(result['firstFailure'] or not result['deadlineOwnerJoined'] or not result['socketsClosed']))


if __name__ == '__main__':
    raise SystemExit(main())
