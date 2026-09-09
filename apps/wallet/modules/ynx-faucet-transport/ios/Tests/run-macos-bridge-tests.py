#!/usr/bin/env python3
"""Compile actual Foundation bridge+engine; only synthetic loopback HTTP.
This excludes Expo/UIKit and cannot establish iOS SDK/runtime acceptance.
"""
import argparse, pathlib, subprocess, threading, http.server, json, time, hashlib, os
parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); args = parser.parse_args()
out = pathlib.Path(args.output); out.mkdir(parents=True, exist_ok=True)
assert not (out / 'result.json').exists(), 'Use a fresh audit directory; keep prior evidence'
ios = pathlib.Path(__file__).resolve().parents[1]
requests = []; guard = threading.Lock(); observed = out / 'wire-observed.json'
observed.write_text('{}')
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version = 'HTTP/1.1'
 def log_message(self, *args): pass
 def do_POST(self):
  size = int(self.headers.get('Content-Length', '0')); assert 0 < size <= 1024
  body = self.rfile.read(size).decode('ascii')
  with guard:
   requests.append({'path': self.path, 'body': body, 'headers': dict(self.headers)})
   counts = {p: sum(item['path'] == p for item in requests) for p in {item['path'] for item in requests}}
   temporary = observed.with_suffix('.tmp'); temporary.write_text(json.dumps(counts)); temporary.replace(observed)
  if self.path.startswith('/slow-'): time.sleep(.55)
  response = (json.dumps({'jsonrpc': '2.0', 'id': json.loads(body)['id'], 'result': '0x1917'}, separators=(',', ':')).encode() if self.path == '/rpc' else b'{"ok":true}')
  try:
   self.send_response(200 if self.path == '/rpc' else 201); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(response))); self.send_header('Connection', 'close'); self.end_headers(); self.wfile.write(response)
  except (BrokenPipeError, ConnectionResetError): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler); server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
inputs = [ios/'BoundedFaucetHttpEngine.swift', ios/'YnxFaucetTransportModule.swift', ios/'Tests/BridgeHarness/main.swift', pathlib.Path(__file__)]
binary = out/'bridge-tests'
compile_argv = ['xcrun', 'swiftc', '-swift-version', '5', '-strict-concurrency=complete', '-D', 'YNX_FAUCET_HOST_TESTS', '-D', 'YNX_FAUCET_BRIDGE_TESTS', *map(str, inputs[:3]), '-o', str(binary)]
try:
 with (out/'compile.log').open('w') as log: compiled = subprocess.run(compile_argv, stdout=log, stderr=subprocess.STDOUT)
 if compiled.returncode: raise SystemExit(compiled.returncode)
 sandbox = out/'loopback-only.sb'; sandbox.write_text('(version 1)\n(allow default)\n(deny network*)\n(allow network* (local ip "localhost:*") (remote ip "localhost:*"))\n(allow network* (local unix-socket) (remote unix-socket))\n')
 run_argv = ['/usr/bin/sandbox-exec', '-f', str(sandbox), str(binary)]
 env = {**os.environ, 'QA_LOOPBACK_BASE': f'http://127.0.0.1:{server.server_port}', 'QA_WIRE_OBSERVED': str(observed), 'QA_BRIDGE_RESULT': str(out/'swift-result.json')}
 with (out/'run.log').open('w') as log: completed = subprocess.run(run_argv, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=35)
finally:
 server.shutdown(); server.server_close()
swift = json.loads((out/'swift-result.json').read_text()) if (out/'swift-result.json').exists() else None
counts = {p: sum(item['path'] == p for item in requests) for p in {item['path'] for item in requests}}
expected_routes = ['/ok', '/rpc', '/slow-resign', '/slow-foreground', '/slow-background', '/slow-close', '/slow-deadline']
canonical = '{"requestId":"0123456789abcdefghijklmnopqrstuv","address":"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80","amount":100}'
checks = {'exactSevenRoutesOnePOSTEach': counts == {p: 1 for p in expected_routes},
 'allAdmissionBytesExact': all(item['body'] == canonical for item in requests if item['path'] != '/rpc'),
 'noCredentials': all(not any(k.lower() in ('cookie','authorization','proxy-authorization') for k in item['headers']) for item in requests),
 'rpcEnvelopeExact': all(set(json.loads(item['body'])) == {'jsonrpc','id','method','params'} and json.loads(item['body'])['method'] == 'eth_chainId' and json.loads(item['body'])['params'] == [] for item in requests if item['path'] == '/rpc')}
result = {'passed': completed.returncode == 0 and swift and swift['passed'] and all(checks.values()), 'swiftCases': swift['cases'] if swift else 0, 'wireChecks': checks, 'requestCounts': counts, 'compileArgv': compile_argv, 'runArgv': run_argv,
 'inputs': [{'path': str(p), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs],
 'macOSFoundationOnly': True, 'expoUIKitAdapterCompiled': False, 'iosNativeAcceptanceVerified': False, 'productionEnabled': False, 'publicEndpointUsed': False}
(out/'wire-requests.json').write_text(json.dumps(requests, indent=2)+'\n'); (out/'result.json').write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps(result, indent=2))
raise SystemExit(0 if result['passed'] else 1)
