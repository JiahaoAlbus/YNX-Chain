#!/usr/bin/env python3
"""Only the new actual root logger/SF→safe sink→Swift classifier integration.

Caller must supply a frozen full source cohort and already verified offline cache.
This script starts no PT/backend/network and performs no dependency download.
"""
import argparse,hashlib,json,os,platform,subprocess,time
from pathlib import Path

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--frozen-source',required=True,type=Path)
 p.add_argument('--gomodcache',required=True,type=Path)
 p.add_argument('--gocache',required=True,type=Path)
 p.add_argument('--output',required=True,type=Path)
 p.add_argument('--swift-module-cache',required=True,type=Path)
 a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
 frozen=a.frozen_source.resolve();manifest=json.loads((frozen/'SOURCE-INPUTS.json').read_text());pins=manifest['files']
 for n,h in pins.items():
  if digest(frozen/n)!=h:raise ValueError('frozen source changed before compiler')
 env=dict(os.environ);env.update(GOTOOLCHAIN='local',GOPROXY='off',GOSUMDB='off',CGO_ENABLED='0',GOMAXPROCS='1',GOFLAGS='',GOWORK='off',GOMODCACHE=str(a.gomodcache.resolve()),GOCACHE=str(a.gocache.resolve()),YNX_PUBLIC_PHASE_CONTROL_CAPTURE=str(out/'actual-sf-canonical.stderr'))
 core=['/opt/homebrew/bin/go','test','-trimpath','-buildvcs=false','-timeout=12s','-json','-mod=readonly','-p=1','-parallel=1','-count=1','-vet=off','-tags=ynx_public_entry_qa','-run=^TestQA(PhaseCanonicalPrivacyAndFraming|PhaseBudgetsAndOutputFailure|PhaseBlockedStderrCannotDelayOwnerFence|MainInstallerActualSFStandardLogger)$','./internal/publicentry/phasesink','./cmd/lyrebird']
 recorder=frozen/'receiver/SnowflakeSafePhaseRecorder.swift';probe=frozen/'receiver/SnowflakeProducerPhaseDeltaProbe.swift';events=[]
 def run(label,argv,budget,cwd):
  start=time.monotonic();child=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  timed=False
  try:stdout,stderr=child.communicate(timeout=budget)
  except subprocess.TimeoutExpired:
   timed=True;child.terminate()
   try:stdout,stderr=child.communicate(timeout=2)
   except subprocess.TimeoutExpired:child.kill();stdout,stderr=child.communicate(timeout=2)
  (out/(label+'.stdout')).write_bytes(stdout);(out/(label+'.stderr')).write_bytes(stderr)
  events.append({'stage':label,'pid':child.pid,'wait':child.returncode,'reaped':True,'timeout':timed,'seconds':time.monotonic()-start,'argv':argv})
  if timed or child.returncode:raise ValueError(label+' failed; preserve original result')
 try:
  run('actual-go-logger-sink',core,45,frozen/'root')
  sdk=subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'],text=True).strip()
  swift=['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-sdk',sdk,'-j','1','-module-cache-path',str(a.swift_module_cache.resolve()),'-DYNX_PRIVACY_ACCEPTANCE','-parse-as-library',str(recorder),str(probe),'-o',str(out/'PhaseProducerProbe')]
  run('compile-actual-swift-classifier',swift,30,out)
  run('go-capture-to-swift-classifier',[str(out/'PhaseProducerProbe'),str(out/'actual-sf-canonical.stderr')],5,out)
  state='PASS';first=None
 except Exception as e:state='FAIL';first=str(e)
 drift=[n for n,h in pins.items()if digest(frozen/n)!=h]
 result={'schema':'P05_SUCCESSOR_SAFE_PHASE_INTEGRATION_V1','status':state,'firstCause':first,'events':events,'sourceInputsSHA256':digest(frozen/'SOURCE-INPUTS.json'),'sourceDrift':drift,'network':'NOT_RUN','PTSetup':'NOT_RUN','normalPrivacyAdmission':'UNCHANGED_BLOCKED'}
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':state,'firstCause':first,'stages':len(events),'network':'NOT_RUN'}));raise SystemExit(0 if state=='PASS'and not drift else 1)
if __name__=='__main__':main()
