"""Exercise the external-only HEAD runtime budget without external requests."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import socket
import sys
import threading

base = Path(__file__).resolve().parent
src = base / 'external-header-phase-control.py'
spec = importlib.util.spec_from_file_location('control', src)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path.cwd()
home = Path('/Users/huangjiahao')
assert sys.dont_write_bytecode and root.stat().st_dev != home.stat().st_dev
assert os.environ.get('TMPDIR') == str(root)
resource.setrlimit(resource.RLIMIT_FSIZE, (module.MAX_WRITE, module.MAX_WRITE))
errors = []
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)
    listener.settimeout(1)
    peer = listener.getsockname()
    module.cap_process_writes(root, peer)

    def denied_write():
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        fd = os.open(home / 'ynx-head-must-not-exist', flags, 0o600)
        os.close(fd)

    def denied_peer():
        with socket.socket() as client:
            client.connect(('127.0.0.1', 1))

    refused = []
    cases = [('internal-write', denied_write),
             ('subprocess', lambda: os.execve('/usr/bin/true', ['true'], {})),
             ('resolver', lambda: socket.getaddrinfo('localhost', 443)),
             ('wrong-peer', denied_peer)]
    for name, action in cases:
        try:
            action()
        except PermissionError:
            refused.append(name)
        else:
            raise AssertionError(name)

    def serve():
        try:
            with listener.accept()[0] as other:
                other.sendall(b'x')
        except OSError as error:
            errors.append(type(error).__name__)

    server = threading.Thread(target=serve)
    server.start()
    with socket.socket() as client:
        client.settimeout(1)
        client.connect(peer)
        assert client.recv(1) == b'x'
    server.join(2)
    assert not server.is_alive() and not errors

transport = module.verified_transport()
context = transport.load_helper().verified_context()
value = dict(schema='P05_NYM_EXTERNAL_HEAD_LOCAL_BUDGET_V1', controlsRefused=refused,
             oneOwnedLoopbackConnect=True, hostnameRequired=context.check_hostname, CA=context.cert_store_stats(),
             interpreterNoBytecode=sys.dont_write_bytecode, currentDirectoryExternal=True,
             fileSizeCap=resource.getrlimit(resource.RLIMIT_FSIZE)[0],
             processPeakRSSBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             sourceSHA256=hashlib.sha256(src.read_bytes()).hexdigest(), publicNetwork=False)
path = root / 'RESULT.json'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
encoded = (json.dumps(value, indent=2) + '\n').encode()
try:
    assert os.write(fd, encoded) == len(encoded)
finally:
    os.close(fd)
print(json.dumps(dict(result=str(path), SHA256=module.sha(path), bytes=path.stat().st_size,
                      allocated=path.stat().st_blocks * 512, **value)))
