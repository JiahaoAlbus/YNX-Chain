#!/usr/bin/python3
"""NEW successor candidate-admission + cleanup UNKNOWN process controls only.
Parent bounded resource guard owns all descendants. No dependency supply/network.
"""
import argparse, hashlib, json, os, subprocess, time
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--frozen-source',type=Path,required=True);p.add_argument('--gomodcache',type=Path,required=True);p.add_argument('--gocache',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 a=p.parse_args();s=a.frozen_source.resolve();out=a.output.resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
 manifest=json.loads((s/'SOURCE-INPUTS.json').read_text());pins=manifest['files']
 def drift():return [n for n,h in pins.items() if not (s/n).is_file() or sha(s/n)!=h]
 if drift():raise ValueError('frozen-source drift')
 env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='off',GOSUMDB='off',CGO_ENABLED='0',GOMAXPROCS='1',GOMODCACHE=str(a.gomodcache.resolve()),GOCACHE=str(a.gocache.resolve()))
 env.pop('P05_SYNTHETIC_UNKNOWN_CHILD',None);env.pop('P05_SYNTHETIC_LOCK',None)
 go='/opt/homebrew/bin/go';base=[go,'test','-trimpath','-buildvcs=false','-mod=readonly','-p=1','-tags=ynx_public_entry_qa','-count=1','-timeout=12s','-v']
 steps=[('new-actual-candidate-admission',base+['./internal/publicentry','-run','^TestQA(ActualPionRemoteCandidateAdmission|RemoteCandidateClosedVocabularyAndBounds)$'],45),('new-actual-cleanup-failstop',base+['./cmd/lyrebird','-run','^TestQABoundedCleanupUnknownProcess$'],40)]
 result={'schema':'P05_CANDIDATE_FAILSTOP_NEW_DELTA_V1','status':'FAIL','sourceInputsSHA256':sha(s/'SOURCE-INPUTS.json'),'stages':[],'network':'NOT_RUN','oldHelper23':'UNCHANGED','normalPrivacyAdmission':'UNCHANGED_BLOCKED'}
 for name,argv,budget in steps:
  start=time.monotonic();c=subprocess.Popen(argv,cwd=s/'root',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:stdout,stderr=c.communicate(timeout=budget);timed=False
  except subprocess.TimeoutExpired:
   timed=True;c.terminate()
   try:stdout,stderr=c.communicate(timeout=2)
   except subprocess.TimeoutExpired:c.kill();stdout,stderr=c.communicate(timeout=2)
  (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
  result['stages'].append(dict(stage=name,argv=argv,pid=c.pid,exit=c.returncode,reaped=c.poll() is not None,timeout=timed,seconds=time.monotonic()-start))
  if c.returncode or timed:result['firstCause']=name;break
 else:result['status']='PASS'
 result['sourceDrift']=drift()
 if result['sourceDrift']:result['status']='FAIL'
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'network':'NOT_RUN','stages':len(result['stages'])}))
 return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
