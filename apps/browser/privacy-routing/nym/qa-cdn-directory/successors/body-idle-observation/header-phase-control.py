#!/usr/bin/env python3
"""Optional one HEAD phase control, requiring a separate exact external scope."""

import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import time

BASE = Path(__file__).resolve().parent
HOST = 'cdn1.media-platform.net'
PEER = ('172.104.178.252', 443)
PATH = '/api/v2/unstable/nym-nodes/skimmed?page=0&per_page=250'
REQUEST = f'HEAD {PATH} HTTP/1.1\r\nHost: {HOST}\r\nAccept: */*\r\nConnection: close\r\n\r\n'.encode('ascii')
PIN = 'a14cf0f3a1e1c5ffda4a0a18053890f93f1cec23535124b2109517bddca0aedc'
SCOPE = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113/header-phase-public/SCOPE.json')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_helper():
    path = BASE.parents[2] / 'qa-glue/nym_https_stage_probe.py'
    if sha(path) != PIN:
        raise ValueError('owned-socket-helper-pin')
    spec = importlib.util.spec_from_file_location('owned_socket', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def observe(peer, context, helper, *, connect_seconds, total_seconds):
    """Return finite milestones; tests inject only local sockets and a local trust CA."""
    if not context.check_hostname or context.verify_mode != ssl.CERT_REQUIRED:
        raise ValueError('strict-TLS-required')
    started = time.monotonic()
    overall = started + total_seconds
    connect_until = min(overall, started + connect_seconds)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    guard = helper.SocketDeadlines(sock, overall)
    phase = 'tcp_connect'
    tls = response = None
    result = {'phasesMilliseconds': {}, 'firstFailure': None}

    def timeout(deadline):
        value = deadline - time.monotonic()
        if value <= 0:
            raise helper.PhaseFailure('DEADLINE')
        (tls if tls is not None else sock).settimeout(value)

    def mark(name):
        result['phasesMilliseconds'][name] = round(1000 * (time.monotonic() - started))

    try:
        guard.begin_stage(connect_until - time.monotonic())
        timeout(connect_until)
        sock.connect(peer)
        mark('tcpConnected')
        phase = 'tls_handshake'
        tls = context.wrap_socket(sock, server_hostname=HOST, do_handshake_on_connect=False)
        guard.set_socket(tls)
        timeout(connect_until)
        tls.do_handshake()
        mark('tlsVerified')
        result['tlsProtocol'] = tls.version()
        phase = 'http_request_write'
        guard.begin_stage(overall - time.monotonic())
        timeout(overall)
        tls.sendall(REQUEST)
        mark('requestWritten')
        phase = 'http_response_headers'
        wrapper = helper.ResponseSocket(tls)
        response = http.client.HTTPResponse(wrapper, method='HEAD')
        response.begin()
        if not 200 <= response.status <= 599:
            raise helper.PhaseFailure('HTTP_FINAL_STATUS_REQUIRED')
        mark('responseHeaders')
        result.update(httpStatus=response.status, headerBytes=wrapper.reader.header_bytes)
    except (OSError, helper.PhaseFailure, http.client.HTTPException) as error:
        phase_deadline = connect_until if phase in ('tcp_connect', 'tls_handshake') else overall
        if guard.expired or isinstance(error, (socket.timeout, TimeoutError)) or time.monotonic() >= phase_deadline:
            reason = 'DEADLINE'
        elif isinstance(error, ssl.SSLCertVerificationError):
            reason = 'TLS_CERTIFICATE_REJECTED'
        elif isinstance(error, ssl.SSLError):
            reason = 'TLS_NEGOTIATION_FAILED'
        elif isinstance(error, http.client.HTTPException):
            reason = 'HTTP_RESPONSE_INVALID_OR_EOF'
        elif isinstance(error, helper.PhaseFailure):
            reason = 'DEADLINE' if str(error) == 'DEADLINE' else 'HTTP_HEADER_BOUND_OR_STATUS'
        else:
            reason = 'SOCKET_IO_FAILED'
        result['firstFailure'] = {'phase': phase, 'reason': reason}
    finally:
        result['deadlineOwnerJoined'] = guard.finish()
        if response is not None:
            response.close()
        if tls is not None:
            tls.close()
        sock.close()
        result.update(socketsClosed=sock.fileno() == -1 and (tls is None or tls.fileno() == -1),
                      totalMilliseconds=round(1000 * (time.monotonic() - started)), bodyRead=False)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope-sha256', required=True)
    options = parser.parse_args()
    if SCOPE.is_symlink() or sha(SCOPE) != options.scope_sha256:
        raise RuntimeError('header-control-scope-pin')
    scope = json.loads(SCOPE.read_text())
    fields = {'schema', 'sourceSHA256', 'purpose', 'notBefore', 'latestStart'}
    if (set(scope) != fields or scope['schema'] != 'P05_NYM_HEADER_PHASE_CONTROL_SCOPE_V1'
            or scope['sourceSHA256'] != sha(Path(__file__)) or scope['purpose'] != 'one-basic-page-zero-head'
            or type(scope['notBefore']) is not int or type(scope['latestStart']) is not int
            or not 0 < scope['latestStart'] - scope['notBefore'] <= 900
            or not scope['notBefore'] <= time.time() < scope['latestStart']):
        raise RuntimeError('header-control-scope-window-or-shape')
    helper = load_helper()
    home, wd = os.statvfs('/Users/huangjiahao'), os.statvfs(SCOPE.parent)
    memory = subprocess.run(['/usr/bin/memory_pressure', '-Q'], check=True, capture_output=True, text=True, timeout=3)
    pressure = int(re.search(r'free percentage: (\d+)%', memory.stdout).group(1))
    capacity = {'homeFreeBytes': home.f_bavail * home.f_frsize, 'WDFreeBytes': wd.f_bavail * wd.f_frsize,
                'memoryFreePercent': pressure}
    if capacity['homeFreeBytes'] < int(2.25 * 1024**3) or capacity['WDFreeBytes'] < 16 * 1024**3 or pressure < 35:
        raise RuntimeError('fresh-resource-floor-before-header-control')
    case = SCOPE.parent / 'one-basic-head'
    case.mkdir(mode=0o700)
    print(json.dumps({'pid': os.getpid(), 'pgid': os.getpgrp(), 'monotonicStart': time.monotonic(),
                      'scopeSHA256': options.scope_sha256, 'capacity': capacity}), flush=True)
    result = observe(PEER, helper.verified_context(), helper, connect_seconds=8, total_seconds=20)
    result.update(scopeSHA256=options.scope_sha256, method='HEAD', productionAuthority=False,
                  rawResponsePersisted=False, acceptedDirectory=False)
    with (case / 'result.json').open('x') as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(result, output, indent=2)
        output.write('\n')
    print(json.dumps(result), flush=True)
    return int(bool(result['firstFailure'] or not result['deadlineOwnerJoined'] or not result['socketsClosed']))


if __name__ == '__main__':
    raise SystemExit(main())
