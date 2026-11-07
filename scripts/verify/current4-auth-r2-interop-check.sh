#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd -P)
out=${1:?absolute fresh evidence directory required}
exec "${PYTHON:-python3}" - "$repo" "$out" <<'PY'
from pathlib import Path
import hashlib,json,os,resource,signal,subprocess,sys,time
repo=Path(sys.argv[1]);out=Path(sys.argv[2])
if not out.is_absolute() or out.exists():raise SystemExit('fresh absolute evidence directory required')
out.mkdir(mode=0o700);(out/'tmp').mkdir(mode=0o700)
inputs=repo/'internal/consensus/testdata/current4_auth_r2'
manifest=json.loads((inputs/'PROVENANCE.json').read_text())
if manifest.get('activeAuthRevision')!='r3' or manifest.get('authHSHA256')!='52488824f04819023067605d87b1ed20c8a1182c6567cdb76ad1a13372f2918c':raise SystemExit('active Auth r3 provenance required; r2 path is legacy only')
fixed={'Current4WireClient.cpp':'be8b52c00654f325f116d6113158ea4df2ec88c6e65e085337270a669acf6dec','Current4WireClient.hpp':'4dcf71a0e059c0bfcf7393ce38104144f7fd1cd694bf917212774d1bbc28ffaf','network-consent-policy-current-wire-v1.h':'1197965ac26958a39f65b0314c2779f6046bafbe583a9959c78b6a335b460487'}
def pin(p):
 b=p.read_bytes();return {'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
seen=set()
for entry in manifest['foreignSources']:
 name=entry['file'];p=inputs/name
 if Path(name).name!=name or name in seen or not entry['verbatim']:raise SystemExit('foreign source role differs')
 seen.add(name);actual=pin(p)
 if any(actual[k]!=entry[k] for k in ('bytes','sha256')) or (name in fixed and actual['sha256']!=fixed[name]):raise SystemExit('original Auth/SDK source changed: '+name)
if len(seen)!=7 or not set(fixed)<=seen or {p.name for p in inputs.iterdir()}!=seen|{'PROVENANCE.json','interop.cpp'}:raise SystemExit('foreign source closed catalogue differs')
fixture=repo/'scripts/loadtest/fixtures/finalize-1b-public'
if pin(fixture/'result.json')['sha256']!='11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6':raise SystemExit('fixed PUBLIC observer original differs')
env=os.environ.copy();env.update(GOMAXPROCS='2',GOMEMLIMIT='1536MiB',GOTOOLCHAIN='local',CGO_ENABLED='0',GOFLAGS='-p=1 -trimpath -mod=readonly',GOPROXY='off',GOSUMDB='off',GOTMPDIR=str(out/'tmp'),TMPDIR=str(out/'tmp'),YNX_PUBLIC_REGISTERED_OBSERVER_TRACE=str(fixture),YNX_CURRENT4_AUTH_R2_INTEROP_BINARY=str(out/'auth-r2-interop'))
records=[]
def run(name,args,timeout):
 started=time.monotonic()
 with (out/(name+'.stdout')).open('xb') as stdout,(out/(name+'.stderr')).open('xb') as stderr:
  p=subprocess.Popen(args,cwd=repo,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
  print(name+' ownedPID='+str(p.pid),flush=True)
  timedout=False
  try:code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   timedout=True;os.killpg(p.pid,signal.SIGTERM)
   try:code=p.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);code=p.wait()
 r={'name':name,'command':args,'pid':p.pid,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-started,'ownedProcessReaped':True,'stdout':pin(out/(name+'.stdout')),'stderr':pin(out/(name+'.stderr'))};records.append(r)
 (out/(name+'.result.json')).write_text(json.dumps(r,indent=2)+'\n')
 if code!=0 or timedout:
  print((out/(name+'.stderr')).read_text()[-4000:],file=sys.stderr)
  raise RuntimeError(name+' failed; original evidence retained')
 return r
def qualify_cleanup(rows,binary_sha):
 pkg='github.com/JiahaoAlbus/YNX-Chain/internal/consensus';name='TestPQCurrent4WirePUBLICAuthR3CleanupFence'
 if not rows or any(not isinstance(e,dict) or e.get('Package')!=pkg or e.get('Action') not in ('start','run','pause','cont','output','pass') for e in rows):raise RuntimeError('cleanup stream failed/skipped/foreign/malformed')
 if any('Test' in e and (not isinstance(e['Test'],str) or e['Test'].split('/')[0]!=name) for e in rows):raise RuntimeError('different test in cleanup stream')
 if [e['Action'] for e in rows if e.get('Test')==name and e['Action']=='run']!=['run'] or [e['Action'] for e in rows if e.get('Test')==name and e['Action'] in ('pass','fail','skip')]!=['pass']:raise RuntimeError('cleanup test did not run/pass uniquely')
 if [e['Action'] for e in rows if 'Test' not in e and e['Action'] in ('pass','fail','skip')]!=['pass']:raise RuntimeError('cleanup package did not pass once')
 marker='YNX_CURRENT4_AUTH_R3_CLEANUP_INTEROP '
 receipts=[json.loads(e['Output'].split(marker,1)[1]) for e in rows if e.get('Action')=='output' and e.get('Test')==name and marker in e.get('Output','')]
 if len(receipts)!=1:raise RuntimeError('actual cleanup receipt absent/duplicate')
 r=receipts[0];flags={'PUBLIC':True,'distinctProcesses':True,'cleanupAcknowledged':True,'sameParentAfterCleanup':True,'RootQualifiedPeer':False,'NativeCurrent':False,'formalP09Slot':False}
 if not isinstance(r,dict) or set(r)!=set(flags)|{'activeAuthRevision','parentPID','cppPID','cppSHA256','coreOps','clientProducingCallsDenied','sourceNodesStarted'}:raise RuntimeError('cleanup receipt fields differ')
 if r['activeAuthRevision']!='r3' or any(r[k] is not v for k,v in flags.items()):raise RuntimeError('cleanup active BODY/scope differs')
 if any(type(r[k]) is not int or r[k]!=v for k,v in {'coreOps':4,'clientProducingCallsDenied':4,'sourceNodesStarted':0}.items()):raise RuntimeError('producing operation escaped cleanup fence')
 if any(type(r[k]) is not int or r[k]<=0 for k in ('parentPID','cppPID')) or r['parentPID']==r['cppPID']:raise RuntimeError('cleanup processes differ')
 if not isinstance(r['cppSHA256'],str) or r['cppSHA256']!=binary_sha:raise RuntimeError('actual cleanup binary differs')
 return r

def qualify_joint(rows,binary_sha):
 allowed={'TestPQCurrent4WirePUBLICAuthR2CrossProcessInterop','TestPQCurrent4WirePUBLICAuthR3CleanupFence'}
 if any(not isinstance(e,dict) or ('Test' in e and (not isinstance(e['Test'],str) or e['Test'].split('/')[0] not in allowed)) for e in rows):raise RuntimeError('normal matching stream has foreign test')
 cleanup_rows=[e for e in rows if 'Test' not in e or e['Test'].split('/')[0]=='TestPQCurrent4WirePUBLICAuthR3CleanupFence']
 qualify_cleanup(cleanup_rows,binary_sha)
 rows=[e for e in rows if 'Test' not in e or e['Test'].split('/')[0]=='TestPQCurrent4WirePUBLICAuthR2CrossProcessInterop']
 pkg='github.com/JiahaoAlbus/YNX-Chain/internal/consensus';name='TestPQCurrent4WirePUBLICAuthR2CrossProcessInterop'
 if not rows or any(not isinstance(e,dict) or e.get('Package')!=pkg or e.get('Action') not in ('start','run','pause','cont','output','pass') for e in rows):raise RuntimeError('joint stream failed/skipped/foreign/malformed')
 if any('Test' in e and (not isinstance(e['Test'],str) or e['Test'].split('/')[0]!=name) for e in rows):raise RuntimeError('different test in joint stream')
 if [e['Action'] for e in rows if e.get('Test')==name and e['Action']=='run']!=['run'] or [e['Action'] for e in rows if e.get('Test')==name and e['Action'] in ('pass','fail','skip')]!=['pass']:raise RuntimeError('exact joint test did not execute/pass uniquely')
 if [e['Action'] for e in rows if 'Test' not in e and e['Action'] in ('pass','fail','skip')]!=['pass']:raise RuntimeError('joint package did not pass exactly once')
 marker='YNX_CURRENT4_AUTH_R2_PUBLIC_INTEROP '
 receipts=[json.loads(e['Output'].split(marker,1)[1]) for e in rows if e.get('Action')=='output' and e.get('Test')==name and marker in e.get('Output','')]
 if len(receipts)!=1:raise RuntimeError('actual cross-process receipt absent/duplicate')
 r=receipts[0]
 flags={'PUBLIC':True,'distinctProcesses':True,'RootQualifiedPeer':False,'NativeCurrent':False,'formalP09Slot':False,'positiveAndPartialCleanupAcknowledged':True}
 if not isinstance(r,dict) or set(r)!=set(flags)|{'activeAuthRevision','parentPID','cppPID','positiveOps','deniedOps','sourceNodesStarted','policyBytes','policySHA256','executionHeight','cppSHA256'}:raise RuntimeError('joint receipt fields differ')
 if r['activeAuthRevision']!='r3' or any(r[k] is not v for k,v in flags.items()):raise RuntimeError('joint DATA/no-grant scope differs')
 if any(type(r[k]) is not int or r[k]!=v for k,v in {'positiveOps':6,'deniedOps':4,'sourceNodesStarted':0}.items()):raise RuntimeError('actual operation/Node lifecycle count differs')
 if any(type(r[k]) is not int or r[k]<=0 for k in ('parentPID','cppPID')) or r['parentPID']==r['cppPID']:raise RuntimeError('not two actual process identities')
 if type(r['policyBytes']) is not int or not 0<r['policyBytes']<=8388608:raise RuntimeError('complete PUBLIC policy bound differs')
 h=r['executionHeight']
 if not isinstance(h,str) or not h.isascii() or not h.isdigit() or str(int(h))!=h or not 0<int(h)<2**64:raise RuntimeError('lossless execution height differs')
 for k in ('policySHA256','cppSHA256'):
  if not isinstance(r[k],str) or len(r[k])!=64 or any(c not in '0123456789abcdef' for c in r[k]):raise RuntimeError('exact public hash absent')
 if r['cppSHA256']!=binary_sha:raise RuntimeError('executed C++ binary differs from actual compiled output')
 return r
try:
 compiler=os.environ.get('CXX','clang++')
 run('COMPILE',[compiler,'-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-fno-omit-frame-pointer','-g0','-O1','-pthread','-I',str(inputs),str(inputs/'Current4WireClient.cpp'),str(inputs/'interop.cpp'),'-o',str(out/'auth-r2-interop')],60)
 go=os.environ.get('GO','go')
 run('GO',[go,'test','-json','-p','1','-count=1','-timeout=120s','-tags=ynx_public_trace_testsupport,ynx_current4_auth_interop','-run','^(TestPQCurrent4WirePUBLICAuthR2CrossProcessInterop|TestPQCurrent4WirePUBLICAuthR3CleanupFence)$','./internal/consensus'],210)
 rows=[json.loads(line) for line in (out/'GO.stdout').read_text().splitlines()]
 receipt=qualify_joint(rows,pin(out/'auth-r2-interop')['sha256'])
 result={'activeAuthRevision':'r3','normalMatchingCleanupFenceVerified':True,'status':'PASS','sourcePins':[pin(inputs/p) for p in sorted(seen|{'PROVENANCE.json','interop.cpp'})],'producerSourcePins':[pin(repo/'internal/consensus'/p) for p in ['pq_current4_wire.go','pq_current4_peer_darwin.go','pq_current4_peer_linux.go','pq_wallet_policy_live.go']],'binary':pin(out/'auth-r2-interop'),'steps':records,'publicInteropReceipt':receipt,'maximumChildRSSBytes':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'productionLauncherQualified':False,'oldMatrixRerun':False,'newPQKeysOrSignatures':0,'archiveBuilds':0}
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
except Exception as e:
 (out/'FAILURE.json').write_text(json.dumps({'status':'FAIL','firstCause':str(e),'steps':records},indent=2)+'\n');raise
PY
