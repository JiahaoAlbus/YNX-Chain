#!/usr/bin/python3
"""New correlated attempt observability only; parent resource guardian required.
No Arti/PT/network/GUI. Go uses exact fixed cache, no resolver/toolchain download.
The default CI path executes the new fixtures without private prior receipts.
--reuse-copy-result is only the pinned local continuation of the first v13 run.
"""
import argparse,hashlib,json,os,platform,re,shutil,subprocess,time
from pathlib import Path
from test_worker_ownership import segment

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['frozen-source','gomodcache','gocache','module-cache','output']:p.add_argument('--'+name,type=Path,required=True)
 p.add_argument('--go',type=Path,default=shutil.which('go'),help='Explicit pinned Go1.25.7 executable (otherwise resolved from PATH); macOS runner only')
 p.add_argument('--reuse-copy-result',type=Path,help='Optional local-only pinned original v13 successful copy/producer receipt; CI runs the new copy fixture directly')
 a=p.parse_args();s=a.frozen_source.resolve();out=a.output.resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
 manifest=json.loads((s/'SOURCE-INPUTS.json').read_text());pins=manifest['files']
 def drift():return [n for n,h in pins.items() if not(s/n).is_file() or sha(s/n)!=h]
 if drift():raise ValueError('frozen source drift')
 if a.go is None:raise ValueError('pinned Go executable not supplied or available on PATH')
 go_tool=a.go.resolve(strict=True)
 if not go_tool.is_file() or not os.access(go_tool,os.X_OK):raise ValueError('Go executable missing')
 env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='off',GOSUMDB='off',CGO_ENABLED='0',GOMAXPROCS='1',GOMODCACHE=str(a.gomodcache.resolve()),GOCACHE=str(a.gocache.resolve()))
 go=[str(go_tool),'test','-trimpath','-buildvcs=false','-mod=readonly','-p=1','-tags=ynx_public_entry_qa','-count=1','-timeout=15s','-v']
 reused=None
 if a.reuse_copy_result is not None:
  prior=a.reuse_copy_result.resolve();capture=prior.parent/'new-actual-copy-and-producer.stdout'
  if sha(prior)!='06cdd8cca6bef9b424603741193ee2eb15939d3cdff146b91943d3bdc75bb0be' or sha(capture)!='4b218aa7b887b2027eb3af1c89d8121390bcdc0450c2d776b2d395314452c085':raise ValueError('original actual copy evidence drift')
  previous=json.loads(prior.read_text());old_source=s.parent/'qa-successor-freeze-v13-attempt-observation';old_pins=json.loads((old_source/'SOURCE-INPUTS.json').read_text())['files']
  if sha(old_source/'SOURCE-INPUTS.json')!='2e4c08ae5e0cc11d0e282e644f1d25a2bb50ba76550cbd3b4475b5418dad434c':raise ValueError('original source manifest drift')
  if {n:h for n,h in pins.items() if n.startswith(('root/','overlays/')) and n!='overlays/snowflake/client/lib/attempt_observation_qa_test.go'}!={n:h for n,h in old_pins.items() if n.startswith(('root/','overlays/')) and n!='overlays/snowflake/client/lib/attempt_observation_qa_test.go'}:raise ValueError('reuse requires identical actual Go inputs compiled by original root copy fixture; only separate SF callback test may change')
  if previous.get('sourceDrift')!=[] or previous.get('sourceInputsSHA256')!=sha(old_source/'SOURCE-INPUTS.json') or previous.get('network')!='NOT_RUN':raise ValueError('original evidence boundary mismatch')
  old_steps=previous.get('stages',[])
  if not old_steps or old_steps[0].get('stage')!='new-actual-copy-and-producer' or old_steps[0].get('exit')!=0 or old_steps[0].get('reaped') is not True or old_steps[0].get('timeout') is not False:raise ValueError('original actual copy stage not successful/reaped')
  (out/'new-actual-copy-and-producer.stdout').write_bytes(capture.read_bytes())
  reused=dict(resultPath=str(prior),resultSHA256=sha(prior),captureSHA256=sha(capture),originalStage=old_steps[0],notReexecuted=True)
 # Go compiles all package test files even with -run. Only the new no-network
 # SDK fixture is in scope: overlay the two untouched upstream test files,
 # never non-test SF/Pion code, to avoid unrelated goconvey source downloads.
 empty=out/'ExcludedUnselectedUpstreamTests.go';empty.write_text('package snowflake_client\n')
 excluded=['overlays/snowflake/client/lib/lib_test.go','overlays/snowflake/client/lib/rendezvous_test.go']
 actual_tests=sorted(str(x.relative_to(s)) for x in (s/'overlays/snowflake/client/lib').glob('*_test.go'))
 if actual_tests!=sorted(excluded+['overlays/snowflake/client/lib/attempt_observation_qa_test.go']):raise ValueError('unexpected SF package test compilation set')
 overlay=out/'selected-test-overlay.json';overlay.write_text(json.dumps({'Replace':{str(s/n):str(empty) for n in excluded}},sort_keys=True)+'\n')
 steps=[('new-actual-pion-callbacks',go+['-overlay',str(overlay),'gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/snowflake/v2/client/lib','-run','^TestQAAttemptActualStateCallbacksNoNetwork$'],45)]
 if reused is None:steps.insert(0,('new-actual-copy-and-producer',go+['./cmd/lyrebird','-run','^TestQA(ActualCopyOriginBeforeClose|AttemptProducerRejectsUnknownFields)$'],50))
 steps.insert(0,('pinned-go-version',[str(go_tool),'version'],5))
 sdk=subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'],text=True,timeout=5).strip()
 sanitizer=out/'ActualStderrSanitizer.swift';sanitizer.write_text('import Foundation\nimport CryptoKit\n'+segment((s/'native/PrivacyTorPlatform.swift').read_text(),'enum TorPublicStderrSanitizer {')+'\n')
 swift=['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-sdk',sdk,'-j','1','-module-cache-path',str(a.module_cache.resolve()),'-parse-as-library','-DYNX_PRIVACY_ACCEPTANCE',str(s/'native/SnowflakeSafePhaseRecorder.swift'),str(sanitizer),str(s/'controls/AttemptObservationDeltaProbe.swift'),'-o',str(out/'AttemptObservationProbe')]
 steps += [('compile-actual-swift-receiver',swift,30),('actual-producer-to-receiver',[str(out/'AttemptObservationProbe'),str(out/'new-actual-copy-and-producer.stdout')],8)]
 binary=out/'LyrebirdPublicEntryQA-attempt-observation-v1'
 steps += [('new-helper-build',[str(go_tool),'build','-trimpath','-buildvcs=false','-mod=readonly','-p=1','-tags=ynx_public_entry_qa','-ldflags=-X main.lyrebirdVersion=0.9.0-ynx-public-entry-qa-attempt-observation-v1','-o',str(binary),'./cmd/lyrebird'],45)]
 result=dict(schema='P05_ATTEMPT_OBSERVATION_ACTUAL_NEW_PIPELINE_V1',status='FAIL',sourceInputsSHA256=sha(s/'SOURCE-INPUTS.json'),stages=[],network='NOT_RUN',GUI='NOT_RUN',normalPrivacyAdmission='UNCHANGED_BLOCKED',originalGuardAndTimerChanges=False)
 result['executedPipelineSHA256']=sha(Path(__file__).resolve())
 result['toolchain']=dict(goExecutable=str(go_tool),goExecutableSHA256=sha(go_tool),actualVersion='NOT_RUN')
 result['reusedCopyStage']=reused
 result['selectedTestCompilation']=dict(goOverlaySHA256=sha(overlay),replacementSHA256=sha(empty),excludedUnselectedUpstreamTests={n:pins[n] for n in excluded},actualFixture=pins['overlays/snowflake/client/lib/attempt_observation_qa_test.go'],productSourcesUnchanged=True,notAnUpstreamTestSuitePass=True)
 for label,argv,budget in steps:
  if drift():result['firstCause']='source drift before '+label;break
  start=time.monotonic();process=subprocess.Popen(argv,cwd=s/'root',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:stdout,stderr=process.communicate(timeout=budget);timed=False
  except subprocess.TimeoutExpired:
   timed=True;process.terminate()
   try:stdout,stderr=process.communicate(timeout=2)
   except subprocess.TimeoutExpired:process.kill();stdout,stderr=process.communicate(timeout=2)
  (out/(label+'.stdout')).write_bytes(stdout);(out/(label+'.stderr')).write_bytes(stderr)
  result['stages'].append(dict(stage=label,argv=argv,pid=process.pid,exit=process.returncode,reaped=process.poll() is not None,timeout=timed,seconds=time.monotonic()-start))
  if process.returncode or timed:result['firstCause']=label;break
  if label=='pinned-go-version':
   version=stdout.decode('utf-8','strict').strip();result['toolchain']['actualVersion']=version
   if re.fullmatch(r'go version go1\.25\.7 darwin/(arm64|amd64)',version) is None:result['firstCause']='pinned Go1.25.7 macOS toolchain required';break
 else:result['status']='PASS';result['helper']=dict(path=str(binary),sha256=sha(binary))
 result['sourceDrift']=drift();result['generatedSanitizerSHA256']=sha(sanitizer)
 if result['sourceDrift']:result['status']='FAIL'
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status=result['status'],stages=len(result['stages']),network='NOT_RUN')))
 return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
