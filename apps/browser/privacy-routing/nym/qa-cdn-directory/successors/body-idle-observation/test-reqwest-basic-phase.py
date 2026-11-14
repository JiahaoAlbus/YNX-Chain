"""Exercise the cached Reqwest connector observer using owned numeric TLS sockets."""
import hashlib
import json
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = Path.cwd()
HOST = 'cdn1.media-platform.net'
ROUTE = '/api/v2/unstable/nym-nodes/skimmed?page=0&per_page=250'
BINARY = ROOT / 'reqwest-basic-phase-control'
BINARY_SHA = '60fb738c5be8813e3976e0efbaed64b2d2153219c830ba1f936bb9f3929486b5'
if hashlib.sha256(BINARY.read_bytes()).hexdigest() != BINARY_SHA:
    raise RuntimeError('fixture-executable-pin')


def serve(context, listener, mode, exchange):
    with listener.accept()[0] as raw:
        raw.settimeout(1.5)
        if mode == 'stall-handshake':
            time.sleep(.55)
            return
        with context.wrap_socket(raw, server_side=True) as tls:
            with tls.makefile('rb') as handle:
                request = handle.readline(512)
                if request != f'GET {ROUTE} HTTP/1.1\r\n'.encode():
                    raise AssertionError('wrong method/path in owned TLS request')
                accept = None
                for _ in range(20):
                    line = handle.readline(1024)
                    if not line or line == b'\r\n':
                        break
                    if line.lower().startswith(b'accept-encoding:'):
                        accept = line.split(b':', 1)[1].strip().decode('ascii')
                exchange.update(expectedMethodPath=True, acceptEncoding=accept)
            if mode == 'stall-headers':
                time.sleep(1.1)
                return
            tls.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 16384\r\nConnection: close\r\n\r\n'+b'x'*16384)


report = {}
with tempfile.TemporaryDirectory(dir=ROOT) as directory:
    ca, key, der = (Path(directory) / name for name in ('ca.pem','key.pem','ca.der'))
    subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                    '-subj','/CN='+HOST,'-addext','subjectAltName=DNS:'+HOST,'-keyout',str(key),'-out',str(ca)],
                   check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=8)
    subprocess.run(['/usr/bin/openssl','x509','-in',str(ca),'-outform','DER','-out',str(der)],
                   check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(ca, key)
    for mode in ('stall-handshake','stall-headers','success'):
        exchange = {}
        error = []
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0)); listener.listen(1); listener.settimeout(2)

            def session():
                try:
                    serve(ctx, listener, mode, exchange)
                except Exception as exc:
                    error.append(type(exc).__name__)

            address, port = listener.getsockname()
            thread = threading.Thread(target=session); thread.start()
            with subprocess.Popen([str(BINARY),'fixture',f'{address}:{port}',str(der)],stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, start_new_session=True) as process:
                print(json.dumps({'fixture':mode,'pid':process.pid,'pgid':process.pid}),flush=True)
                try:
                    out, err = process.communicate(timeout=4)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=2)
                    thread.join(2)
                assert not thread.is_alive() and not error and not err, (mode,error,err)
                event = json.loads(out)
                assert event['connectorCalls'] == event['numericResolverCalls'] == 1, event
                if mode == 'stall-handshake':
                    assert process.returncode == 2 and event['verifiedTlsConnectorMs'] is None, event
                    assert event['firstFailure']['error']['isConnect'] is True, event
                elif mode == 'stall-headers':
                    assert process.returncode == 2 and event['verifiedTlsConnectorMs'] is not None, event
                    assert event['finalHeadersMs'] is None and event['firstFailure']['phase'] == 'final-headers', event
                else:
                    assert process.returncode == 0 and event['httpStatus'] == 200, event
                    assert event['observedBodyBytes'] == 4096 and event['retainedBodyBytes'] == 0, event
                report[mode] = dict(result=event,fixtureTLS=exchange,pid=process.pid,originalWait=process.returncode)

summary={'schema':'P05_NYM_REQWEST_BASIC_LOCAL_TLS_V1','cases':report,'publicNetwork':False,'exactBinarySHA256':BINARY_SHA}
path=Path('FIXTURE_RESULT.json')
with path.open('x') as fd:
    json.dump(summary,fd,indent=2)
    fd.write('\n')
print(json.dumps({'result':str(path.resolve()),'SHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'cases':report}))
