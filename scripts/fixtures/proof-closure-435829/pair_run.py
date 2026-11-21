#!/usr/bin/env python3
"""Fixed historical PUBLIC proof A/B; no signer, node, transaction or replay."""
import argparse, hashlib, importlib.util, json, os, pathlib, platform, runpy, shutil, subprocess, sys, time

BEFORE='415f4ee427874eccfaee926aa54cf99d4b27c019'
AFTER='b95721b119ef1ffdd2dec8e004b30354fc1d52df'
TREES={'before':'52f9ec44d3f4c7a52ef942bf8a1923064a3b67b3','after':'450cfd2c964d892bbd920bae99e1f15eec900e92'}
FORK='47d7cfeee7cd178cb897eda57a4674677fac7e67'
SUPPLIER='5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_TREE='08747364c24c065bf2b13527c210625d7ec95fba'
EXPECTED_DIFF=(('A','internal/chain/canonical_state_compare_test.go'),('M','internal/chain/canonical_state_json.go'),('M','internal/consensus/genesis_migration_reference.go'),('A','internal/consensus/pq_bootstrap_canonical_reuse_test.go'),('M','internal/consensus/validated_migration.go'))
HERE=pathlib.Path(__file__).resolve().parent

def git(root,*args):
 return subprocess.check_output(['git','-C',str(root),*args])
def sha(raw):return hashlib.sha256(raw).hexdigest()
def pin(path):
 h=hashlib.sha256();size=0
 with path.open('rb') as f:
  while True:
   b=f.read(1<<20)
   if not b:break
   h.update(b);size+=len(b)
 return {'bytes':size,'sha256':h.hexdigest()}
def dump(path,value):
 with path.open('x') as f:json.dump(value,f,indent=2,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
def verify_pair(before,after):
 for side,root,commit in [('before',before,BEFORE),('after',after,AFTER)]:
  assert git(root,'rev-parse','HEAD').decode().strip()==commit
  assert git(root,'rev-parse','HEAD^{tree}').decode().strip()==TREES[side]
  assert git(root,'rev-parse','HEAD:third_party/cometbft').decode().strip()==FORK
  assert not git(root,'status','--porcelain','--untracked-files=normal').strip()
 assert git(after,'rev-parse',AFTER+'^').decode().strip()==BEFORE
 actual=tuple((x.split('\t',1)[0],x.split('\t',1)[1]) for x in git(after,'diff','--name-status',BEFORE,AFTER).decode().splitlines())
 assert actual==EXPECTED_DIFF
 for p in ['go.mod','go.sum','third_party/cometbft/go.mod','third_party/cometbft/go.sum','scripts/verify/wire-live-matching-source-ci.py']:
  assert git(before,'show',BEFORE+':'+p)==git(after,'show',AFTER+':'+p)
 assert git(after,'rev-parse',SUPPLIER+':third_party/cometbft').decode().strip()==SUPPLIER_TREE
 return dict(before=BEFORE,after=AFTER,trees=TREES,fork=FORK,supplier=SUPPLIER,supplierTree=SUPPLIER_TREE,diff=[list(x) for x in EXPECTED_DIFF],composerSHA256=sha(git(after,'show',AFTER+':scripts/verify/wire-live-matching-source-ci.py')),onlineFinalityQualified=False,transactionReplayed=False)

def verify_composed(root,commit,source,composer):
 expected={}
 for row in git(root,'ls-tree','-rz',commit,'--','go.mod','go.sum','cmd','internal','contracts','third_party').split(b'\0'):
  if not row:continue
  head,path=row.split(b'\t',1);mode,kind,blob=head.decode().split();assert kind=='blob' and mode in ('100644','100755');expected[path.decode()]=(mode,blob)
 # The normal composer overlays exactly its closed optional transport delta,
 # while preserving the existing 47d7 signer and observer leaves.
 for p in composer['DIFF']:
  name='third_party/cometbft/'+p
  row=git(root,'ls-tree',SUPPLIER_TREE,'--',p).decode().strip()
  header, selected_path=row.split('\t',1);mode,kind,blob=header.split()
  assert selected_path==p and kind=='blob' and mode in ('100644','100755')
  raw=git(root,'show',SUPPLIER_TREE+':'+p)
  assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==blob
  expected[name]=(mode,blob)
 actual={p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
 assert actual==set(expected), (len(actual),len(expected))
 ledger=[]
 for name,(mode,blob) in sorted(expected.items()):
  p=source/name;raw=p.read_bytes();actual_blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest();assert actual_blob==blob
  ledger.append(dict(path=name,mode=mode,gitBlob=blob,bytes=len(raw),sha256=sha(raw)))
 return ledger

PHASE='not-started'
ACTIVE_STAGE=None

def mark(phase,stage_name=None):
 global PHASE,ACTIVE_STAGE
 PHASE=phase;ACTIVE_STAGE=stage_name
 root=pathlib.Path(os.environ['YNX_PAIR_PHASE_ROOT'])
 with (root/'PAIR-PHASES.jsonl').open('a') as f:
  f.write(json.dumps({'phase':phase,'stage':stage_name},sort_keys=True)+'\n');f.flush();os.fsync(f.fileno())

def stage(case,name,argv,cwd,env):
 # All subprocesses inherit the *single outer* supervised process session.
 # Never use start_new_session here: that would escape its cleanup/RSS scope.
 if os.environ.get('YNX_PAIR_SUPERVISED')=='1':mark('subprocess-'+name,name)
 logs=case/'results';logs.mkdir(exist_ok=True)
 start=time.monotonic();code=None;failure=None
 try:
  with (logs/(name+'.stdout')).open('xb') as stdout,(logs/(name+'.stderr')).open('xb') as stderr:
   code=subprocess.run(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,check=False).returncode
  if code!=0:failure='CHILD_EXIT_NONZERO'
 except BaseException as error:
  failure=type(error).__name__;raise
 finally:
  dump(logs/(name+'.result.json'),dict(command=name,argv=argv,exitCode=code,firstCause=failure,elapsedSeconds=time.monotonic()-start,outerSupervisorRequired=True,onlineFinalityQualified=False))
 if failure:raise RuntimeError(name+' failed; retain original output')
 return dict(command=name,exitCode=code,elapsedSeconds=time.monotonic()-start,outerSupervisorRequired=True)

def main():
 mark('parse-arguments')
 p=argparse.ArgumentParser();p.add_argument('--original-root',required=True);p.add_argument('--before-root',required=True);p.add_argument('--after-root',required=True);p.add_argument('--case',required=True);a=p.parse_args()
 mark('resolve-roots')
 original=pathlib.Path(a.original_root).resolve(strict=True);before=pathlib.Path(a.before_root).resolve(strict=True);after=pathlib.Path(a.after_root).resolve(strict=True);case=pathlib.Path(a.case)
 mark('supervised-platform-check')
 assert os.environ.get('YNX_PAIR_SUPERVISED')=='1'
 assert platform.system()=='Linux' and platform.machine()=='x86_64'
 assert case.is_absolute() and case.parent.resolve(strict=True)==case.parent and case.is_dir()
 assert pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True)==pathlib.Path('/home/runner/work/_temp')
 mark('original-source-identity')
 assert git(original,'rev-parse','HEAD').decode().strip()=='763b7f8f422f38f39e747a4f7f6cfb6405a0b96d' and not git(original,'status','--porcelain').strip()
 mark('pair-source-identities')
 pair=verify_pair(before,after)
 mark('load-collector')
 spec=importlib.util.spec_from_file_location('original_diagnostic',HERE/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 mark('go-toolchain-identity')
 version=subprocess.check_output(['go','version']).decode().strip();assert version=='go version go1.26.11 linux/amd64'
 mark('create-private-evidence')
 (case/'evidence').mkdir();(case/'tmp').mkdir();dump(case/'PAIR-SOURCE.json',pair)
 shutil.copyfile(HERE/'ORIGINAL-JOB.json',case/'evidence/JOB.json')
 env=os.environ.copy();env.update(GOMAXPROCS='2',GOMEMLIMIT='1536MiB',GOGC='50',CGO_ENABLED='1',GOTOOLCHAIN='local',GOTMPDIR=str(case/'tmp'),TMPDIR=str(case/'tmp'),YNX_PROOF_CLOSURE_CASE=str(case))
 for endpoint,name in [('repos/JiahaoAlbus/YNX-Chain/actions/artifacts/14108709609','ARTIFACTS.json'),('repos/JiahaoAlbus/YNX-Chain/actions/artifacts/14108709609/zip','COMPLETE-ORIGINAL.zip')]:
  mark('download-'+name)
  with (case/'evidence'/name).open('xb') as f:subprocess.run(['gh','api',endpoint],stdout=f,check=True,timeout=180,env=env)
 mark('prepare-original-evidence')
 subprocess.run([sys.executable,str(HERE/'prepare.py'),'--source-root',str(original),'--case',str(case)],check=True,env=env,timeout=180)
 mark('restore-original-paths')
 subprocess.run([sys.executable,str(HERE/'restore_linux_originals.py')],check=True,env=env,timeout=90)
 results={}
 for side,root,commit in [('before',before,BEFORE),('after',after,AFTER)]:
  mark('compose-'+side)
  composer=runpy.run_path(str(root/'scripts/verify/wire-live-matching-source-ci.py'))
  selected=composer['prepare_wire_live_source'](root,case/('pair-'+side),commit,TREES[side]);source=pathlib.Path(selected['sourceDirectory'])
  mark('verify-composed-'+side)
  ledger=verify_composed(root,commit,source,composer);dump(case/('PAIR-SOURCE-LEDGER-'+side+'.json'),ledger)
  binary=case/('proof-verifier-'+side)
  build=stage(case,'PAIR-BUILD-'+side,['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-o',str(binary),'./cmd/ynx-consensus-proof-verify'],source,env)
  mark('record-binary-'+side)
  dump(case/('PAIR-BINARY-'+side+'.json'),dict(sourceCommit=commit,sourceTree=TREES[side],actual=pin(binary),build=build,original763Binary=False))
  env['YNX_PROOF_AB_SIDE']=side
  mark('prepare-instrumentation-'+side)
  subprocess.run([sys.executable,str(HERE/'pair_observer.py')],check=True,env=env,timeout=30)
  shutil.copyfile(HERE/'proof_closure_diagnostic_test.go',source/'cmd/ynx-consensus-proof-verify/proof_closure_diagnostic_test.go')
  values=[]
  for index in ['00000','00001']:
   env.update(YNX_PROOF_CLOSURE_INDEX=index,YNX_PROOF_CLOSURE_OUTPUT=str(case/('profile-'+side+'-'+index)))
   command='PAIR-PROFILE-'+side+'-'+index
   result=stage(case,command,['go','test','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-overlay',str(case/('OBSERVATION-OVERLAY-'+side+'.json')),'-tags','ynx_proof_closure_diagnostic','-count=1','-timeout=120s','-json','-run','^TestProofClosure435829HistoricalOriginal$','./cmd/ynx-consensus-proof-verify'],source,env)
   mark('collect-'+side+'-'+index)
   events=m.collect(case/'results'/(command+'.stdout'));dump(case/('STAGES-'+side+'-'+index+'.json'),events)
   profile=case/('profile-'+side+'-'+index);values.append(dict(index=index,execution=result,profile=pin(profile/'CPU.pprof'),result=json.loads((profile/'PROFILE-RESULT.json').read_text())))
  results[side]=values
 for index in ['00000','00001']:
  mark('compare-normal-output-'+index)
  left=case/('profile-before-'+index)/'NORMAL-CLI-RESULT.json';right=case/('profile-after-'+index)/'NORMAL-CLI-RESULT.json'
  assert left.read_bytes()==right.read_bytes(), 'independently verified normal result bytes differ'
 mark('write-comparison')
 dump(case/'PAIR-COMPARISON.json',dict(version='YNX-PROOF-INTEGRATION-PAIR-COMPARISON/v1',before=BEFORE,after=AFTER,clockMode='historical-test-only',execution='instrumented go test calling run(); hashed production ELFs not executed',executionOrder='before-00000,before-00001,after-00000,after-00001',fixedOrderMayBiasTiming=True,independentInvocations=results,normalResultBytesEqual=True,onlineFinalityQualified=False,originalUnknownReplaced=False,transactionReplayed=False,nodeStarted=False))
 print('PAIR_DATA_ONLY originalUNKNOWNunchanged=true onlineFinalityQualified=false')
if __name__=='__main__':
 try:main()
 except BaseException as error:
  root=pathlib.Path(os.environ['YNX_PAIR_PHASE_ROOT'])
  child=dict(phase=PHASE,kind=type(error).__name__,exitCode=(error.returncode if isinstance(error,subprocess.CalledProcessError) else None),stage=ACTIVE_STAGE,originalStderr='results/PAIR-WHOLE.stderr',stageStderr=('results/'+ACTIVE_STAGE+'.stderr' if ACTIVE_STAGE else None),stageResult=('results/'+ACTIVE_STAGE+'.result.json' if ACTIVE_STAGE else None),onlineFinalityQualified=False)
  dump(root/'PAIR-CHILD-FAILURE.json',child)
  raise
