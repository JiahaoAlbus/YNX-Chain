#!/usr/bin/env python3
"""One fixed Linux offline evidence diagnostic; never a network/load runner."""
import argparse, hashlib, json, os, pathlib, platform, shutil, signal, subprocess, sys, time

SOURCE='763b7f8f422f38f39e747a4f7f6cfb6405a0b96d'
SUPPLIER='5a49f5c91452604dffb910df736702b3b9df2562'
BINARY_SHA='6f1633033727073511d71db98224f31e297f1dabe9a89ce68d42e96117328d0e'
HERE=pathlib.Path(__file__).resolve().parent
ADMISSION_DISK_FREE=None
ADMISSION_STARTED=None
TERM_SECONDS=10
KILL_SECONDS=5
REAP_SECONDS=2

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while b:=f.read(1<<20):h.update(b)
 return dict(bytes=path.stat().st_size,sha256=h.hexdigest())

def proc_row(pid):
 path=pathlib.Path('/proc')/str(pid)/'stat'
 try:
  with path.open() as f:raw=f.read(65537)
 except (FileNotFoundError,ProcessLookupError):return None
 # An empty read is not a valid identity or proof of exit. Only subsequent
 # disappearance permits retirement; a still-present empty/malformed stat
 # fails closed and is handled by the supervisor's finally cleanup.
 if not raw:
  try:path.stat()
  except (FileNotFoundError,ProcessLookupError):return None
 head,sep,tail=raw.rpartition(')')
 fields=tail.split()
 if len(raw)>65536 or not sep or not head.startswith(str(pid)+' (') or len(fields)<22:
  raise ValueError('invalid proc stat shape')
 try:session=int(fields[3]);ticks=int(fields[19]);pages=int(fields[21])
 except ValueError:raise ValueError('invalid proc stat numbers') from None
 if session<0 or ticks<0 or pages<0:raise ValueError('invalid proc stat identity')
 return session,ticks,pages*os.sysconf('SC_PAGE_SIZE')

def owned(pid):
 out=[]
 for d in pathlib.Path('/proc').iterdir():
  if not d.name.isdecimal():continue
  row=proc_row(int(d.name))
  if row is not None and row[0]==pid:
   if row[1]==0:raise ValueError('unbound owned proc start ticks')
   out.append((int(d.name),row[1],row[2]))
 return out

def child_exited(p):
 # Do not poll()/reap before group cleanup: the unreaped direct child keeps
 # this session leader PID reserved, so killpg cannot target a reused PID.
 if p.returncode is not None:raise RuntimeError('owned child reaped before cleanup')
 result=os.waitid(os.P_PID,p.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT)
 return result is not None

def bounded(case,name,argv,cwd,env,seconds,cpus):
 logs=case/'results';logs.mkdir(exist_ok=True)
 start=time.monotonic();peak=0;maxpids=0;reason=None;failure_type=None;p=None;code=None
 cleanup_errors=[];actions=[];identities={};reaped=False;gone=False;reservation=True
 def issue(value):
  if value not in cleanup_errors:cleanup_errors.append(value)
 def failure(error):
  nonlocal reason,failure_type
  if reason is None:reason='SUPERVISION_EXCEPTION';failure_type=type(error).__name__
 def sample():
  nonlocal peak,maxpids
  group=owned(p.pid)
  for pid,ticks,rss in group:
   if pid in identities and identities[pid]!=ticks:raise ValueError('owned PID identity changed')
   identities[pid]=ticks
  peak=max(peak,sum(row[2] for row in group));maxpids=max(maxpids,len(group))
  return group
 def snapshot():
  try:return [row for row in sample() if row[0]!=p.pid]
  except BaseException as error:failure(error);issue('OWNED_SAMPLE_UNAVAILABLE');return None
 def exited():
  nonlocal reservation
  try:return child_exited(p)
  except BaseException as error:
   reservation=False;failure(error);issue('CHILD_EXIT_OBSERVATION_UNAVAILABLE');return False
 def send(sig):
  # Popen created this session and no wait/poll has consumed its leader.
  # Cleanup cannot use a public PID/pgid or proceed after an outside reap.
  if p.returncode is not None:
   issue('CHILD_REAPED_BEFORE_GROUP_CLEANUP');return
  # In particular ECHILD must not authorize killing a possibly reused PID.
  # Re-observe our own unreaped child immediately before each group signal.
  exited()
  if not reservation:issue('OWNED_SESSION_RESERVATION_UNCONFIRMED');return
  try:
   if os.getsid(p.pid)!=p.pid:issue('OWNED_SESSION_IDENTITY_CHANGED');return
   os.killpg(p.pid,sig);actions.append(signal.Signals(sig).name)
  except ProcessLookupError:pass
  except BaseException:issue('SESSION_SIGNAL_FAILED')
 def drain(seconds):
  until=time.monotonic()+seconds
  while True:
   done=exited();left=snapshot()
   if done and left==[]:return True
   # A sampler failure cannot turn into success or an unbounded cleanup
   # loop. Still complete the owned child's TERM/KILL/reap sequence below.
   if done and left is None:return False
   if time.monotonic()>=until:return False
   time.sleep(.05)
 try:
  with (logs/(name+'.stdout')).open('xb') as stdout,(logs/(name+'.stderr')).open('xb') as stderr:
   p=subprocess.Popen(['taskset','--cpu-list',','.join(map(str,cpus)),*argv],cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
   while not child_exited(p):
    group=sample();rss=sum(row[2] for row in group)
    if rss>4<<30:reason='OWNED_RSS_BOUND'
    elif len(group)>32:reason='OWNED_PROCESS_BOUND'
    elif time.monotonic()-start>seconds:reason='WALL_BOUND'
    elif ADMISSION_STARTED is not None and time.monotonic()-ADMISSION_STARTED>720:reason='TOTAL_DIAGNOSTIC_BOUND'
    elif ADMISSION_DISK_FREE is not None and ADMISSION_DISK_FREE-shutil.disk_usage(case.parent).free>8<<30:reason='NEW_DISK_BOUND'
    elif sum(x.stat().st_size for x in logs.iterdir() if x.is_file() and x.suffix in ('.stdout','.stderr'))>4<<20:reason='LOG_BOUND'
    if reason:break
    time.sleep(.2)
 except BaseException as error:
  failure(error)
 finally:
  # Every path after launch, including a broken sampler or cancellation,
  # retains the first cause, attempts bounded cleanup and records a result.
  if p is not None:
   try:
    left=snapshot();done=exited()
    if reason or not done or left!=[]:
     reason=reason or 'OWNED_PROCESS_DEBT'
     send(signal.SIGTERM)
     if not drain(TERM_SECONDS):
      send(signal.SIGKILL)
      if not drain(KILL_SECONDS):issue('OWNED_DRAIN_UNCONFIRMED')
    # Last group observation occurs before wait releases the PID reservation.
    done=exited();left=snapshot();gone=done and left==[]
   except BaseException:issue('CLEANUP_EXCEPTION');gone=False
   finally:
    try:code=p.wait(timeout=REAP_SECONDS);reaped=reservation
    except subprocess.TimeoutExpired:
     issue('CHILD_REAP_TIMEOUT');gone=False
    except BaseException:issue('CHILD_REAP_FAILED');gone=False
  else:gone=True
  if code not in (None,0):reason=reason or 'CHILD_EXIT_NONZERO'
  if cleanup_errors:reason=reason or 'CLEANUP_INCOMPLETE'
  result=dict(command=name,argv=argv,exitCode=code,firstCause=reason,firstCauseType=failure_type,elapsedSeconds=time.monotonic()-start,peakOwnedRSSBytes=peak,peakOwnedProcesses=maxpids,ownedGone=gone and (p is None or reaped),childReaped=reaped,cleanupErrors=cleanup_errors,cleanupSignals=actions,cpuAffinity=cpus,onlineFinalityQualified=False)
  with (logs/(name+'.result.json')).open('x') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 if code!=0 or reason or not result['ownedGone']:raise RuntimeError(name+' failed; original output and partial profiles retained') from None
 return result

def collect(path):
 rows=[json.loads(line) for line in path.read_text().splitlines()]
 pkg='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-proof-verify'
 test='TestProofClosure435829HistoricalOriginal'
 allowed_build=True; events=[]
 for row in rows:
  if row.get('Action')=='build-output':
   assert allowed_build and set(row)=={'ImportPath','Action','Output'} and row['ImportPath']==pkg+'.test' and isinstance(row['Output'],str) and row['Output']
   continue
  allowed_build=False
  assert row.get('Package')==pkg and row.get('Action') not in ('fail','skip','build-fail')
  if row.get('Test'):assert row['Test']==test
  if row.get('Action')=='output':
   output=row.get('Output','').strip()
   if output.startswith('{"version":"YNX-PROOF-CLOSURE-OFFLINE-OBSERVATION/v1"'):
    events.append(json.loads(output))
 assert [r['Action'] for r in rows if r.get('Test')==test and r.get('Action') in ('run','pass')]==['run','pass']
 assert [r['Action'] for r in rows if not r.get('Test') and r.get('Action') in ('pass','fail','skip')]==['pass']
 stages={'migration.read','migration.strictShape','migration.typedRead','bootstrap.validate','schedule.validate','state.sourceConstruction','state.committedAuthority','trust.lightBlockDecode','request.trustContextDecode','request.proofDecode','trust.load','transaction.verify','light.block','light.successor'}
 assert {e['stage'] for e in events}==stages and len(events)==2*len(stages)
 keys={'version','component','stage','event','elapsedNs','rejected','allocatedBytes','heapAllocBytes','heapInuseBytes','peakRSSBytes','peakRSSAvailable'}
 for event in events:
  assert set(event)==keys and event['version']=='YNX-PROOF-CLOSURE-OFFLINE-OBSERVATION/v1'
  assert event['component']==('consensus' if event['stage'].startswith('light.') else 'main')
  for key in ['elapsedNs','allocatedBytes','heapAllocBytes','heapInuseBytes','peakRSSBytes']:assert type(event[key]) is int and event[key]>=0
  assert type(event['rejected']) is bool and type(event['peakRSSAvailable']) is bool
 for stage in stages:
  selected=[e for e in events if e['stage']==stage]
  assert [e['event'] for e in selected]==['BEGIN','END'] and not selected[-1]['rejected'] and selected[-1]['elapsedNs']>=0 and selected[-1]['peakRSSAvailable']
 return events

def main():
 global ADMISSION_DISK_FREE,ADMISSION_STARTED
 p=argparse.ArgumentParser();p.add_argument('--source-root',required=True);p.add_argument('--case',required=True);a=p.parse_args()
 assert platform.system()=='Linux' and platform.machine()=='x86_64', 'Linux amd64 only; no cross-platform result substitution'
 root=pathlib.Path(a.source_root).resolve(strict=True);case=pathlib.Path(a.case)
 assert case.is_absolute() and case.parent.resolve(strict=True)==case.parent and not case.exists()
 assert pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True)==pathlib.Path('/home/runner/work/_temp')
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()==SOURCE
 assert not subprocess.check_output(['git','-C',str(root),'status','--porcelain']).strip()
 version=subprocess.check_output(['go','version']).decode().strip()
 assert version=='go version go1.26.11 linux/amd64'
 mem={s.split(':')[0]:int(s.split()[1])*1024 for s in pathlib.Path('/proc/meminfo').read_text().splitlines()}
 assert mem['MemAvailable']>=6<<30 and shutil.disk_usage(case.parent).free>=16<<30
 ADMISSION_DISK_FREE=shutil.disk_usage(case.parent).free;ADMISSION_STARTED=time.monotonic()
 cpus=sorted(os.sched_getaffinity(0))[:2];assert len(cpus)==2
 case.mkdir(mode=0o700);(case/'evidence').mkdir();(case/'tmp').mkdir()
 with (case/'RESOURCE-ADMISSION.json').open('x') as f:json.dump(dict(platform=platform.platform(),go=version,availableMemoryBytes=mem['MemAvailable'],availableDiskBytes=ADMISSION_DISK_FREE,cpuAffinity=cpus,ownedRSSCapBytes=4<<30,newDiskCapBytes=8<<30,wholeDiagnosticSeconds=720,onlineFinalityQualified=False),f,indent=2)
 shutil.copyfile(HERE/'ORIGINAL-JOB.json',case/'evidence/JOB.json')
 env=os.environ.copy();env.update(GOMAXPROCS='2',GOMEMLIMIT='1536MiB',GOGC='50',CGO_ENABLED='1',GOTOOLCHAIN='local',GOTMPDIR=str(case/'tmp'),TMPDIR=str(case/'tmp'),YNX_PROOF_CLOSURE_CASE=str(case))
 # Only the official Actions token and immutable artifact ID are accepted.
 # Token stays in process environment; no headers/credential text is logged.
 for endpoint,name in [('repos/JiahaoAlbus/YNX-Chain/actions/artifacts/14108709609','ARTIFACTS.json'),('repos/JiahaoAlbus/YNX-Chain/actions/artifacts/14108709609/zip','COMPLETE-ORIGINAL.zip')]:
  with (case/'evidence'/name).open('xb') as f:subprocess.run(['gh','api',endpoint],stdout=f,check=True,timeout=180,env=env)
 subprocess.run([sys.executable,str(HERE/'prepare.py'),'--source-root',str(root),'--case',str(case)],check=True,env=env,timeout=180)
 subprocess.run([sys.executable,str(HERE/'restore_linux_originals.py')],check=True,env=env,timeout=90)
 source=case/'composition/source'
 # First build the unchanged original executable using its exact normal argv.
 binary=case/'ynx-consensus-proof-verify'
 baseline=bounded(case,'BASELINE-BUILD',['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-o',str(binary),'./cmd/ynx-consensus-proof-verify'],source,env,240,cpus)
 binary_pin=digest(binary)
 with (case/'BASELINE-BINARY.json').open('x') as f:json.dump(dict(actual=binary_pin,originalSHA256=BINARY_SHA,byteIdentical=binary_pin['sha256']==BINARY_SHA,build=baseline),f,indent=2)
 # A different build is retained as such; it cannot be called the original
 # same-binary timeout reproduction. Do not silently relax that prerequisite.
 assert binary_pin['sha256']==BINARY_SHA, 'normal rebuilt verifier differs from original binary; retain first cause, no profiling qualification'
 subprocess.run([sys.executable,str(HERE/'make_observation_overlay.py')],check=True,env=env,timeout=30)
 shutil.copyfile(HERE/'proof_closure_diagnostic_test.go',source/'cmd/ynx-consensus-proof-verify/proof_closure_diagnostic_test.go')
 outcomes=[]
 for index in ['00000','00001']:
  env.update(YNX_PROOF_CLOSURE_INDEX=index,YNX_PROOF_CLOSURE_OUTPUT=str(case/('profile-'+index)))
  result=bounded(case,'PROFILE-'+index,['go','test','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-overlay',str(case/'OBSERVATION-OVERLAY.json'),'-tags','ynx_proof_closure_diagnostic','-count=1','-timeout=120s','-json','-run','^TestProofClosure435829HistoricalOriginal$','./cmd/ynx-consensus-proof-verify'],source,env,240,cpus)
  events=collect(case/'results'/('PROFILE-'+index+'.stdout'))
  with (case/('STAGES-'+index+'.json')).open('x') as f:json.dump(events,f,indent=2)
  outcomes.append(dict(index=index,result=result,profile=digest(case/('profile-'+index)/'CPU.pprof')))
 with (case/'DIAGNOSTIC-RESULT.json').open('x') as f:json.dump(dict(version='YNX-PROOF-CLOSURE-OFFLINE-DIAGNOSTIC/v1',source=SOURCE,originalRun=43582982073,binary=binary_pin,invocations=outcomes,historicalClock='2026-11-14T10:06:52Z',clockSource='original JOB completed_at; not original verifier clock sample',onlineFinalityQualified=False,originalUnknownReplaced=False,transactionReplayed=False,nodeStarted=False),f,indent=2)
 print('YNX_PROOF_CLOSURE_435829_OFFLINE_DIAGNOSTIC_DATA_ONLY originalUNKNOWNunchanged=true onlineFinalityQualified=false')

if __name__=='__main__':main()
