#!/usr/bin/env python3
"""Actual Foundation streamed-upload loopback tests; never iOS acceptance.
Run with a new --output audit directory. No public URL or QA account is used.
"""
import argparse, pathlib, subprocess, threading, http.server, json, time, socket, hashlib, os
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
assert not (out/'result.json').exists(), 'Preserve existing evidence; choose a new output directory'
ios=pathlib.Path(__file__).resolve().parents[1]
requests=[];lock=threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def do_POST(self):
  n=int(self.headers.get('Content-Length','0'));body=self.rfile.read(n)
  with lock:requests.append({'path':self.path,'body':body.decode('ascii'),'headers':dict(self.headers)})
  path=self.path
  if path=='/drop':self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
  status=int(path.rsplit('/',1)[1]) if path.startswith(('/status/','/redirect/')) else 503 if path=='/retry-after' else 401 if path=='/auth' else 200 if path=='/rpc' else 201
  response=b'{"ok":true}'
  if path=='/exact-cap':response=b'"'+b'a'*16382+b'"'
  if path=='/oversized-chunked':response=b'a'*16385
  if path=='/invalid-utf8':response=b'\xc3('
  if path=='/unicode':response='{"message":"测试钱包"}'.encode()
  if path=='/drip':response=b'a'*100
  self.send_response(status)
  self.send_header('Content-Type','text/plain' if path=='/wrong-content-type' else 'application/json; charset=utf-8')
  if path=='/duplicate-content-type':self.send_header('Content-Type','application/json')
  if path!='/missing-no-store':self.send_header('Cache-Control','x'*257 if path=='/large-header' else 'no-store')
  if path.startswith('/redirect/'):self.send_header('Location',f'http://127.0.0.1:{self.server.server_port}/redirect-target')
  if path=='/cookie':self.send_header('Set-Cookie','ynx_synthetic_test=1; Path=/')
  if path=='/auth':self.send_header('WWW-Authenticate','Basic realm="synthetic loopback only"')
  if path=='/retry-after':self.send_header('Retry-After','0')
  if path=='/gzip':self.send_header('Content-Encoding','gzip')
  chunked=path in ['/exact-cap','/oversized-chunked','/drip','/conflicting-framing']
  if path=='/unknown-transfer-encoding':self.send_header('Transfer-Encoding','gzip')
  elif path=='/identity-transfer-encoding':self.send_header('Transfer-Encoding','identity')
  elif chunked:self.send_header('Transfer-Encoding','chunked')
  else:self.send_header('Content-Length',str(16385 if path=='/oversized-length' else 200 if path=='/partial' else len(response)))
  if path=='/conflicting-framing':self.send_header('Content-Length',str(len(response)))
  self.send_header('Connection','close');self.end_headers();self.close_connection=True
  try:
   if path in ['/slow','/concurrent']:time.sleep(.5 if path=='/slow' else .1)
   if chunked:
    step=1 if path=='/drip' else 4096
    for i in range(0,len(response),step):
     b=response[i:i+step];self.wfile.write(f'{len(b):x}\r\n'.encode()+b+b'\r\n');self.wfile.flush()
     if path=='/drip':time.sleep(.03)
    self.wfile.write(b'0\r\n\r\n')
   else:self.wfile.write(response)
  except (BrokenPipeError,ConnectionResetError):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
engine=ios/'BoundedFaucetHttpEngine.swift';main=ios/'Tests/HostHarness/main.swift';binary=out/'host-tests'
compile_argv=['xcrun','swiftc','-swift-version','5','-D','YNX_FAUCET_HOST_TESTS',str(engine),str(main),'-o',str(binary)]
with (out/'compile.log').open('w') as log:r=subprocess.run(compile_argv,stdout=log,stderr=subprocess.STDOUT)
if r.returncode:server.shutdown();raise SystemExit(r.returncode)
# This outer sandbox restricts IP traffic to the newly created loopback server.
# It is a test harness boundary, not the iOS application's production sandbox.
profile=out/'loopback-only.sb';profile.write_text('(version 1)\n(allow default)\n(deny network*)\n(allow network* (local ip "localhost:*") (remote ip "localhost:*"))\n(allow network* (local unix-socket) (remote unix-socket))\n')
env={**os.environ,'QA_LOOPBACK_BASE':f'http://127.0.0.1:{server.server_port}','QA_HOST_RESULT':str(out/'swift-result.json')}
run_argv=['/usr/bin/sandbox-exec','-f',str(profile),str(binary)]
with (out/'run.log').open('w') as log:r=subprocess.run(run_argv,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=45)
server.shutdown();server.server_close()
checks={}
counts={p:sum(x['path']==p for x in requests) for p in {x['path'] for x in requests}}
checks['noInvalidOrRedirectTargetPOST']=counts.get('/must-not-arrive',0)==0 and counts.get('/redirect-target',0)==0
checks['concurrentTaskOnlyOnePOST']=counts.get('/concurrent',0)==1
checks['dropResponseNoAutomaticReplay']=counts.get('/drop',0)==1
checks['authNoCredentialRetry']=counts.get('/auth',0)==1
checks['retryAfterZeroNoBodyReplay']=counts.get('/retry-after',0)==1
checks['noCookieOrAuthorizationHeaders']=all(not any(k.lower() in ('cookie','authorization','proxy-authorization') for k in x['headers']) for x in requests)
checks['exactAdmissionBytes']=all(x['body']=='{"requestId":"0123456789abcdefghijklmnopqrstuv","address":"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80","amount":100}' for x in requests if x['path']!='/rpc')
checks['identityEncodingRequested']=all(next((v for k,v in x['headers'].items() if k.lower()=='accept-encoding'),None)=='identity' for x in requests)
checks['rpcOnlyAllowedMethods']=len([x for x in requests if x['path']=='/rpc'])==5
swift=json.loads((out/'swift-result.json').read_text()) if (out/'swift-result.json').exists() else None
result={'passed':r.returncode==0 and all(checks.values()),'swiftExit':r.returncode,'swiftCases':swift['cases'] if swift else 0,'wireChecks':checks,'requestCounts':counts,'compileArgv':compile_argv,'runArgv':run_argv,'macOSFoundationOnly':True,'iosNativeAcceptanceVerified':False,'productionEnabled':False,'publicEndpointUsed':False,'wireExactlyOnceClaimed':False,'inputs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [engine,main,pathlib.Path(__file__)]]}
(out/'wire-requests.json').write_text(json.dumps(requests,indent=2)+'\n');(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));raise SystemExit(0 if result['passed'] else 1)
