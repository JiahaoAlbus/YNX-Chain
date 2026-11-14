#!/usr/bin/python3
"""Parent resource-guard pipeline: NEW groups -> actual Swift -> new helper.
No network/PT/bootstrap/GUI. Frozen25/helper23/native29 are never written.
"""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for n in ['frozen-source','gomodcache','gocache','qa-core-products','module-cache','output']:p.add_argument('--'+n,type=Path,required=True)
 p.add_argument('--reuse-results',type=Path)
 a=p.parse_args();s=a.frozen_source.resolve();out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
 pins=json.loads((s/'SOURCE-INPUTS.json').read_text())['files']
 def drift():return [n for n,h in pins.items() if not (s/n).is_file() or sha(s/n)!=h]
 if drift():raise ValueError('frozen source mismatch')
 control=s/'controls'
 steps=[('new-go-delta',['/usr/bin/python3',str(control/'test_successor_candidate_failstop.py'),'--frozen-source',str(s),'--gomodcache',str(a.gomodcache.resolve()),'--gocache',str(a.gocache.resolve()),'--output',str(out/'go')],90,s),
 ('new-native-delta',['/usr/bin/python3',str(control/'test_snowflake_policy_fatal.py'),'--native-source',str(s/'native'),'--qa-core-products',str(a.qa_core_products.resolve()),'--module-cache',str(a.module_cache.resolve()),'--output',str(out/'native'),'--producer-capture',str(out/'go/new-actual-cleanup-failstop.stdout')],90,s)]
 reuse = None
 if a.reuse_results:
  prior=a.reuse_results.resolve();oldGo=json.loads((prior/'go/RESULT.json').read_text())
  if oldGo['status']!='PASS' or oldGo['sourceDrift']:raise ValueError('old actual Go groups not PASS')
  oldSource=Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/r2-20261107/tor/qa-successor-freeze-v11-candidate-failstop')
  if sha(oldSource/'SOURCE-INPUTS.json')!=oldGo['sourceInputsSHA256']:raise ValueError('old Go source receipt binding')
  oldPins=json.loads((oldSource/'SOURCE-INPUTS.json').read_text())['files']
  for name,h in pins.items():
   if name.startswith(('root/','overlays/')) and oldPins.get(name)!=h:raise ValueError('changed Go source would require new affected control '+name)
  nativeStep=list(steps[1]);nativeStep[1]=list(nativeStep[1])
  index=nativeStep[1].index('--producer-capture')+1;nativeStep[1][index]=str(prior/'go/new-actual-cleanup-failstop.stdout')
  nativeStep[1]+= ['--reuse-previous-native',str(prior/'native')]
  steps=[tuple(nativeStep)]
  reuse={'GoResult':str(prior/'go/RESULT.json'),'GoResultSHA256':sha(prior/'go/RESULT.json'),'sameRootAndOverlayBytes':True,'notRerun':True}
 env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='off',GOSUMDB='off',CGO_ENABLED='0',GOMAXPROCS='1',GOMODCACHE=str(a.gomodcache.resolve()),GOCACHE=str(a.gocache.resolve()))
 binary=out/'LyrebirdPublicEntryQA-candidate-failstop-v1'
 steps.append(('new-helper-build',['/opt/homebrew/bin/go','build','-trimpath','-buildvcs=false','-mod=readonly','-p=1','-tags=ynx_public_entry_qa','-ldflags=-X main.lyrebirdVersion=0.9.0-ynx-public-entry-qa-candidate-failstop-v1','-o',str(binary),'./cmd/lyrebird'],45,s/'root'))
 result={'schema':'P05_CANDIDATE_FATAL_FAILSTOP_PIPELINE_V1','status':'FAIL','stages':[],'sourceInputsSHA256':sha(s/'SOURCE-INPUTS.json'),'reuseEvidence':reuse,'network':'NOT_RUN','GUI':'NOT_RUN','normalPrivacyAdmission':'UNCHANGED_BLOCKED'}
 for name,argv,budget,cwd in steps:
  if drift():result['firstCause']='source drift before '+name;break
  started=time.monotonic();c=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:stdout,stderr=c.communicate(timeout=budget);timed=False
  except subprocess.TimeoutExpired:
   timed=True;c.terminate()
   try:stdout,stderr=c.communicate(timeout=2)
   except subprocess.TimeoutExpired:c.kill();stdout,stderr=c.communicate(timeout=2)
  (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
  result['stages'].append(dict(stage=name,argv=argv,pid=c.pid,exit=c.returncode,timeout=timed,reaped=c.poll() is not None,seconds=time.monotonic()-started))
  if c.returncode or timed:result['firstCause']=name;break
  if name!='new-helper-build':
   child=json.loads((out/('go' if name=='new-go-delta' else 'native')/'RESULT.json').read_text())
   if child['status']!='PASS':result['firstCause']=name+' receipt';break
 else:result['status']='PASS';result['helper']={'path':str(binary),'sha256':sha(binary)}
 result['sourceDrift']=drift()
 if result['sourceDrift']:result['status']='FAIL'
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'stages':len(result['stages']),'network':'NOT_RUN'}))
 return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
