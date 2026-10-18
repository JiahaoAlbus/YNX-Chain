#!/usr/bin/env python3
"""Continue only from the exact same-run public upstream artifact; no rebuild."""
import hashlib,json,pathlib,subprocess,sys,time,traceback
HERE=pathlib.Path(__file__).resolve().parent
OUT=pathlib.Path(sys.argv[1]).resolve();OUT.mkdir(parents=True,exist_ok=False)
events=[];start=time.monotonic();state='NOT_COMPILED';cause=None
def digest(p):
 p=pathlib.Path(p);b=p.read_bytes();return {'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def save(n,d):(OUT/n).write_text(json.dumps(d,indent=2)+'\n')
def run(label,argv,timeout=600):
 with (OUT/(label+'.raw')).open('xb') as raw:
  t=time.time();p=subprocess.run(argv,stdout=raw,stderr=subprocess.STDOUT,timeout=timeout,check=False)
 e={'label':label,'argv':argv,'actualExit':p.returncode,'startUTCUnix':t,'endUTCUnix':time.time(),'raw':digest(OUT/(label+'.raw'))};events.append(e);save('COMMANDS.json',events)
 if p.returncode:raise RuntimeError('first failing command: '+label+' exit '+str(p.returncode))
try:
 m=json.loads((HERE/'SOURCE_INPUTS.json').read_text())
 for row in m['files']:
  actual=digest(HERE/row['path']);assert actual['bytes']==row['bytes'] and actual['sha256']==row['sha256'],row
 run('RECOVER_ORIGINAL_R2_ARTIFACT',['gh','run','download','39107580077','--repo','JiahaoAlbus/YNX-Chain','--name','social-linux-crypto-r1-39107580077-1','--dir',str(OUT/'retained-r2')],120)
 prior=OUT/'retained-r2/crypto-build'
 inputs=json.loads((HERE/'RETAINED_UPSTREAM_INPUTS.json').read_text());assert len(inputs['files'])==126
 for row in inputs['files']:
  p=(prior/row['relative']).resolve();assert p.is_relative_to(prior.resolve()) and p.is_file() and not p.is_symlink(),row
  actual=digest(p);assert actual['bytes']==row['bytes'] and actual['sha256']==row['sha256'],row
 save('RECOVERED_UPSTREAM_126_EXACT.json',{'run':39107580077,'artifactId':12128618204,'all126Exact':True,'files':[digest(prior/r['relative']) for r in inputs['files']],'noDownloadOrBuildOfOfficialSource':True})
 run('FIXED_MAIN_R3_CONTINUE',['/bin/bash','-x',str(HERE/'continue-linux-crypto.sh'),str(prior),str(HERE),str(OUT/'new-output')],600)
 save('LINUX_CRYPTO_OUTPUTS.json',[digest(OUT/'new-output'/n) for n in ['libynx_social_custodian_linux.a','crypto-source-control']])
 state='R3_RETAINED_UPSTREAM_LINUX_CRYPTO_COMPILE_LINK_MATH_CONTROLS_PASS_NOT_SOURCE_GRANT'
except BaseException as e:
 cause=repr(e);save('FIRST_FAILURE.json',{'firstCause':cause,'traceback':traceback.format_exc()})
finally:
 save('RESULT.json',{'state':state,'firstCause':cause,'elapsedSeconds':time.monotonic()-start,'sourceManifest':digest(HERE/'SOURCE_INPUTS.json'),'commands':events,'officialUpstreamRebuilt':False,'oldR50ControlsRepeated':False,'tpmExecuted':False,'serviceChanged':False,'sourceRootQualified':False,'issued':False,'deployed':False})
if cause:sys.exit(1)
