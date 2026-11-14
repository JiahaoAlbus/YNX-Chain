#!/usr/bin/env python3
"""Local-only real TCP and TLS stalls through the directory HEAD phase helper."""
import argparse
import importlib.util
import json
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(mode=0o700, exist_ok=False)
    spec = importlib.util.spec_from_file_location('header_phase', Path(__file__).with_name('header-phase-control.py'))
    control = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(control)
    helper = control.load_helper()
    contexts = []
    with tempfile.TemporaryDirectory(dir=args.output) as temp:
        cert, key = Path(temp) / 'cert.pem', Path(temp) / 'key.pem'
        subprocess.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=' + control.HOST, '-addext', 'subjectAltName=DNS:' + control.HOST,
                        '-keyout', str(key), '-out', str(cert)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
        server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server.load_cert_chain(cert, key)
        client = ssl.create_default_context(cafile=str(cert))
        contexts.extend((server, client))
    server, client = contexts

    def probe(kind):
        received = []
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            listener.settimeout(2)
            peer = listener.getsockname()

            def serve():
                with listener.accept()[0] as sock:
                    sock.settimeout(1)
                    if kind == 'tls_stall':
                        time.sleep(.4)
                        return
                    with server.wrap_socket(sock, server_side=True) as tls:
                        with tls.makefile('rb') as reader:
                            for _ in range(6):
                                line = reader.readline(512)
                                if line == b'\r\n':
                                    break
                                received.append(line)
                        if kind == 'header_stall':
                            time.sleep(.7)
                            return
                        tls.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n')
            thread = threading.Thread(target=serve)
            thread.start()
            result = control.observe(peer, client, helper, connect_seconds=.2, total_seconds=.5)
            thread.join(timeout=2)
            assert not thread.is_alive() and result['socketsClosed'] and result['deadlineOwnerJoined']
            if received:
                assert received[0] == control.REQUEST.splitlines(keepends=True)[0]
            assert not result['bodyRead']
            return result

    tls_stall = probe('tls_stall')
    assert tls_stall['firstFailure'] == {'phase': 'tls_handshake', 'reason': 'DEADLINE'}, tls_stall
    assert 'tcpConnected' in tls_stall['phasesMilliseconds'] and 'tlsVerified' not in tls_stall['phasesMilliseconds']
    header_stall = probe('header_stall')
    assert header_stall['firstFailure'] == {'phase': 'http_response_headers', 'reason': 'DEADLINE'}, header_stall
    assert 'tlsVerified' in header_stall['phasesMilliseconds'] and 'responseHeaders' not in header_stall['phasesMilliseconds']
    head_ok = probe('head_ok')
    assert head_ok['httpStatus'] == 200 and head_ok['firstFailure'] is None
    result = {'localTLSStall': tls_stall, 'localHeaderStall': header_stall, 'localHeadNoBody': head_ok,
              'localFixtureCAOnly': True, 'publicNetwork': False, 'fixtureSHA256': control.sha(Path(__file__)),
              'helperSHA256': control.sha(Path(control.__file__))}
    with (args.output / 'RESULT.json').open('x') as receipt:
        json.dump(result, receipt, indent=2)
        receipt.write('\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
