#!/usr/bin/env python3
"""Launch the official, unmodified WsgiDAV CLI in an isolated external dir."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.request

def isolated_root(value):
    try:
        target = Path(value).resolve()
        if str(target).startswith('/Volumes/'):
            return True
        runner_value = os.environ.get('RUNNER_TEMP', '')
        if os.environ.get('CI') != 'true' or not runner_value or not Path(runner_value).is_absolute():
            return False
        runner = Path(runner_value).resolve()
        return runner != Path('/') and runner.is_dir() and runner in target.parents
    except (OSError, ValueError, RuntimeError):
        return False

if len(sys.argv) == 2 and sys.argv[1] in ('--help', '-h'):
    print('Usage: webdav-interop-wsgidav.py ISOLATION_ROOT [--resume]\nLocal: /Volumes/...; CI: CI=true and a strict descendant of absolute existing RUNNER_TEMP. No production tenants.')
    raise SystemExit(0)

if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != '--resume') or not isolated_root(sys.argv[1]):
    raise SystemExit('Require /Volumes/... or CI=true with a strict child of absolute existing RUNNER_TEMP')
root = Path(sys.argv[1]).resolve()
site = root.parent / 'upstream' / 'wsgidav-site'
for name in ('data', 'cache', 'evidence'):
    (root / name).mkdir(parents=True, exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
username, password = 'p08-synthetic', secrets.token_hex(24)
config = {
    'host': '127.0.0.1', 'port': port, 'server': 'cheroot', 'verbose': 0,
    'provider_mapping': {'/': str(root / 'data')},
    'http_authenticator': {'domain_controller': None, 'accept_basic': True, 'accept_digest': False, 'default_to_digest': False},
    'simple_dc': {'user_mapping': {'*': {username: {'password': password, 'roles': ['admin']}}}},
    'dir_browser': {'enable': False}, 'logging': {'enable': False},
}
config_path = root / 'config.private.json'
if len(sys.argv) == 3:
    config = json.loads(config_path.read_text())
    previous = json.loads((root / 'connection.private.json').read_text())
    port, username, password = config['port'], previous['username'], previous['password']
    assert config['host'] == '127.0.0.1'
    assert config['provider_mapping'] == {'/': str(root / 'data')}
else:
    if config_path.exists():
        raise SystemExit('Existing upstream configuration: use --resume to preserve credentials and port')
    config_path.write_text(json.dumps(config)); config_path.chmod(0o600)
env = dict(os.environ, PYTHONPATH=str(site), PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(root / 'cache'))
cmd = [sys.executable, str(site / 'bin/wsgidav'), '--config', str(config_path)]
log = open(root / 'evidence/upstream.log', 'ab', buffering=0)
child = subprocess.Popen(cmd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
url = 'http://127.0.0.1:%d/' % port
auth = 'Basic ' + base64.b64encode((username + ':' + password).encode()).decode()
ready = False
for _ in range(100):
    if child.poll() is not None:
        break
    try:
        req = urllib.request.Request(url, method='OPTIONS', headers={'Authorization': auth})
        with urllib.request.urlopen(req, timeout=1) as response:
            ready = response.status == 200
        if ready:
            break
    except Exception:
        time.sleep(.1)
if not ready:
    child.terminate()
    raise SystemExit('Official WsgiDAV failed; inspect isolated evidence/upstream.log')
connection = {'url': url, 'username': username, 'password': password, 'pid': child.pid, 'launcherPid': os.getpid(), 'dataRoot': str(root / 'data'), 'version': 'WsgiDAV 4.3.3 / cheroot 10.0.1', 'binarySha256': None}
private = root / 'connection.private.json'
private.write_text(json.dumps(connection, indent=2)); private.chmod(0o600)
public = {k: v for k, v in connection.items() if k not in ('username', 'password')}
public.update(command=cmd, startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), server='unmodified official WsgiDAV wheel and cheroot CLI', installedManifest=str(root.parent / 'evidence/wsgidav-provenance.json'))
(root / 'evidence/upstream-live.json').write_text(json.dumps(public, indent=2))
with open(root / 'evidence/upstream-lifecycle.jsonl', 'a') as history:
    history.write(json.dumps(public) + '\n')
print(json.dumps(dict(ready=True, url=url, pid=child.pid, privateConnection=str(private))), flush=True)
stop_signal = None
def stop_owned_upstream(signum, frame):
    global stop_signal
    stop_signal = signum
    # The official server has no controlling terminal. Forwarding SIGINT can
    # leave it running; terminate only this already-owned child with SIGTERM.
    if child.poll() is None:
        child.terminate()

for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, stop_owned_upstream)
code = child.wait()
(root / 'evidence/upstream-exit.json').write_text(json.dumps({'code': code, 'requestedSignal': stop_signal, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
# Normalize only the explicitly requested SIGTERM of this synthetic child;
# unexpected server failure keeps its original status and evidence.
sys.exit(0 if stop_signal is not None and code == -signal.SIGTERM else code)
