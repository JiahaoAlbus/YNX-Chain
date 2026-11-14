"""One fixed RFC1928 byte-range GET through SOCKS5 and verified TLS."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import time

from nym_https_stage_probe import HOST, PATH, PhaseFailure, ResponseSocket, SocketDeadlines, verified_context

RANGE_HEADER = 'bytes=0-1023'
CONTENT_RANGE = 'bytes 0-1023/19741'
BODY_BYTES = 1024
BODY_SHA256 = 'c00eedb7616f7522dccba16588a8f60fb0df4b24edd41363d6503fb6d00bf58b'


def read_range(tls, emit, begin_body):
    tls.sendall(f'GET {PATH} HTTP/1.1\r\nHost: {HOST}\r\nRange: {RANGE_HEADER}\r\nAccept: text/plain\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n'.encode('ascii'))
    wrapper = ResponseSocket(tls)
    response = http.client.HTTPResponse(wrapper, method='GET')
    try:
        response.begin()
        wrapper.reader.header_done = True
        emit('http_status', status=response.status, headerBytes=wrapper.reader.header_bytes)
        if response.status != 206:
            raise PhaseFailure('HTTP_RANGE_STATUS_NOT_206')
        if response.headers.get_all('Content-Range', []) != [CONTENT_RANGE]:
            raise PhaseFailure('HTTP_CONTENT_RANGE_MISMATCH')
        if (response.headers.get_all('Content-Length', []) != [str(BODY_BYTES)]
                or response.headers.get_all('Transfer-Encoding', [])
                or response.length != BODY_BYTES):
            raise PhaseFailure('HTTP_RANGE_FRAMING_MISMATCH')
        if response.headers.get_all('Content-Encoding', []) not in ([], ['identity']):
            raise PhaseFailure('UNEXPECTED_CONTENT_ENCODING')
        begin_body()
        body = bytearray()
        while len(body) < BODY_BYTES:
            chunk = response.read1(BODY_BYTES - len(body))
            if not chunk:
                raise PhaseFailure('HTTP_RANGE_BODY_TRUNCATED')
            body.extend(chunk)
        digest = hashlib.sha256(body).hexdigest()
        if response.length != 0 or digest != BODY_SHA256:
            raise PhaseFailure('HTTP_RANGE_BODY_PIN_MISMATCH')
        return dict(httpStatus=206, contentRange=CONTENT_RANGE, bodyBytes=BODY_BYTES,
                    bodySHA256=digest, documentRangeVerified=True,
                    tlsHandshakeVerified=True, followedRedirect=False)
    finally:
        response.close()


def over_connected_proxy(sock, emit, deadline):
    phase = 'socks_greeting'
    tls = None
    tls_verified = False
    guard = SocketDeadlines(sock, deadline)

    def timeout(cap):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise PhaseFailure('ABSOLUTE_REQUEST_DEADLINE')
        (tls if tls is not None else sock).settimeout(min(cap, remaining))

    def exact(size):
        data = bytearray()
        while len(data) < size:
            timeout(8)
            chunk = sock.recv(size - len(data))
            if not chunk:
                raise PhaseFailure('SOCKS_EOF')
            data.extend(chunk)
        return bytes(data)

    try:
        guard.begin_stage(8)
        timeout(8)
        emit(phase)
        sock.sendall(b'\x05\x01\x00')
        if exact(2) != b'\x05\x00':
            raise PhaseFailure('SOCKS_AUTH_REJECTED')
        phase = 'socks_domain_connect'
        guard.begin_stage(8)
        emit(phase, ATYP=3, port=443)
        host = HOST.encode('ascii')
        sock.sendall(b'\x05\x01\x00\x03' + bytes([len(host)]) + host + b'\x01\xbb')
        head = exact(4)
        if head[:3] != b'\x05\x00\x00':
            raise PhaseFailure('SOCKS_CONNECT_REJECTED')
        if head[3] == 1:
            exact(4)
        elif head[3] == 4:
            exact(16)
        elif head[3] == 3:
            exact(exact(1)[0])
        else:
            raise PhaseFailure('SOCKS_REPLY_ATYP')
        exact(2)
        emit('socks_local_ack', remoteTCPOrDNSProven=False)
        phase = 'tls_handshake'
        emit(phase, certificateRequired=True, hostnameCheck=True)
        guard.begin_stage(35)
        context = verified_context()
        timeout(35)
        tls = context.wrap_socket(sock, server_hostname=HOST, do_handshake_on_connect=False)
        guard.set_socket(tls)
        timeout(35)
        tls.do_handshake()
        tls_verified = True
        emit('tls_verified', protocol=tls.version(), NoProductionAuthority=True)
        phase = 'http_headers'
        guard.begin_stage(20)
        timeout(20)
        emit(phase, method='GET', requestedRange=RANGE_HEADER)

        def begin_body():
            nonlocal phase
            phase = 'http_body'
            guard.begin_stage(20)
            timeout(20)

        result = read_range(tls, emit, begin_body)
        emit('range_body_verified', **result)
        return result
    except BaseException as error:
        if guard.expired:
            code = guard.expired
        elif isinstance(error, PhaseFailure):
            code = str(error)
        elif isinstance(error, ssl.SSLCertVerificationError):
            code = 'TLS_CERTIFICATE_REJECTED'
        elif isinstance(error, ssl.SSLError):
            code = 'TLS_NEGOTIATION_FAILED'
        elif isinstance(error, (socket.timeout, TimeoutError)):
            code = 'STAGE_TIMEOUT'
        elif isinstance(error, http.client.HTTPException):
            code = 'HTTP_PROTOCOL_ERROR'
        elif isinstance(error, OSError):
            code = 'SOCKET_IO_FAILED'
        else:
            code = 'UNEXPECTED_STAGE_FAILURE'
        emit('first_failure', phase=phase, code=code, exceptionType=type(error).__name__,
             tlsHandshakeVerified=tls_verified,
             tlsSuccessProof='VERIFIED_HANDSHAKE_ONLY' if tls_verified else 'NO_TLS_SUCCESS_PROOF')
        raise PhaseFailure(phase + ':' + code) from None
    finally:
        stopped = guard.finish()
        if tls is not None:
            tls.close()
        sock.close()
        if not stopped:
            emit('socket_deadline_owner_unknown', NoProductionAuthority=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--local-port', type=int, required=True)
    parser.add_argument('--expires-at', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.port != 63781 or args.local_port != 63801 or not time.time() < args.expires_at <= time.time() + 110:
        raise SystemExit('fixed-rfc-range-stage-scope-rejected')
    args.output.mkdir(mode=0o700, exist_ok=False)
    started = time.monotonic()
    deadline = started + min(85, args.expires_at - time.time())
    events = []
    failure = result = None

    def emit(event, **values):
        if len(events) >= 24:
            raise PhaseFailure('EVENT_LIMIT')
        entry = dict(event=event, elapsedMilliseconds=int((time.monotonic()-started)*1000), **values)
        events.append(entry)
        print(json.dumps(entry), flush=True)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            emit('local_proxy_tcp')
            sock.settimeout(min(8, deadline-time.monotonic()))
            sock.bind(('127.0.0.1', 63801))
            sock.connect(('127.0.0.1', 63781))
            if sock.getpeername() != ('127.0.0.1', 63781):
                raise PhaseFailure('LOCAL_PROXY_PEER_MISMATCH')
            result = over_connected_proxy(sock, emit, deadline)
        except BaseException as error:
            failure = dict(type=type(error).__name__, fixedReason=str(error) if isinstance(error, PhaseFailure) else 'LOCAL_PROXY_CONNECT_FAILED')
    value = dict(schema='YNX_NYM_PUBLIC_RFC_RANGE_RESULT_V1', events=events, firstFailure=failure,
                 result=result, elapsedSeconds=time.monotonic()-started, normalProductionAuthority=False)
    with (args.output/'result.json').open('x') as result_file:
        json.dump(value, result_file, indent=2)
        result_file.write('\n')
    return 1 if failure else 0

if __name__ == '__main__':
    raise SystemExit(main())
