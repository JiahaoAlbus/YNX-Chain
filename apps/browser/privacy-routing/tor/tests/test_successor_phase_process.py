#!/usr/bin/env python3
"""One NEW helper process, actual FS loader/main installer, zero backend sockets.

Uses the original pinned producer with explicit synthetic public numeric DATA.
The exact helper's -checkPhaseSinkOnly returns before PT initialization, listeners
or any real HTTP transport. Never calls the normal network entry point.
"""
import argparse,hashlib,importlib.util,json,os,secrets,string,subprocess,time,uuid
from pathlib import Path
PRODUCER_SHA='c1014a081ad8207bb9a97f64bb5171c10cacf439988405fbb0b8582588c3a675'
SOURCE_SHA='2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407'
def H(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for key in ['helper','producer','reviewed-source','swift-probe','output']:p.add_argument('--'+key,required=True,type=Path)
 p.add_argument('--helper-sha256',required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
 if H(a.helper)!=a.helper_sha256 or H(a.producer)!=PRODUCER_SHA or H(a.reviewed_source)!=SOURCE_SHA:raise ValueError('fixed source/helper pin mismatch; nothing executed')
 spec=importlib.util.spec_from_file_location('actual_pinned_producer',a.producer);producer=importlib.util.module_from_spec(spec);spec.loader.exec_module(producer)
 fronts,stun=producer.reviewed_hosts(a.reviewed_source)
 scratch=out/('ynx-public-search-'+''.join(secrets.choice(string.ascii_letters+string.digits)for _ in range(8)));scratch.mkdir(mode=0o700)
 profile=scratch/'YNX Browser Route State/Tor';profile.mkdir(parents=True,mode=0o700);profile=profile.resolve();state=profile/'phase-control-state';state.mkdir(mode=0o700)
 # Synthetic numeric map is DATA; the tested flag never passes it to a socket API.
 maps={h:['8.8.8.8']for h in fronts+stun};now=time.time_ns();producer.prepare(profile,a.reviewed_source,maps,str(uuid.uuid4()),now+90_000_000_000,now+90_000_000_000)
 env=dict(os.environ);env.update(YNX_PUBLIC_ENTRY_QA_PROFILE_HOME=str(profile),YNX_PUBLIC_ENTRY_QA_ROLE='tor-fixed-public-backend',TOR_PT_STATE_LOCATION=str(state),TOR_PT_CLIENT_TRANSPORTS='snowflake',TOR_PT_SERVER_TRANSPORTS='',TOR_PT_PROXY='',TOR_PT_EXIT_ON_STDIN_CLOSE='1')
 argv=[str(a.helper.resolve()),'-checkPhaseSinkOnly'];start=time.monotonic();child=subprocess.Popen(argv,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 timed=False
 try:stdout,stderr=child.communicate(timeout=8)
 except subprocess.TimeoutExpired:
  timed=True;child.terminate()
  try:stdout,stderr=child.communicate(timeout=2)
  except subprocess.TimeoutExpired:child.kill();stdout,stderr=child.communicate(timeout=2)
 for n,raw in [('helper.stdout',stdout),('helper.stderr',stderr)]:f=out/n;f.write_bytes(raw);f.chmod(0o600)
 response=json.loads(stdout)if child.returncode==0 else {};stats=response.get('phaseSink',{})
 ok=not timed and child.returncode==0 and response.get('schema')=='P05_PUBLIC_PHASE_SINK_CONTROL_V1'and response.get('syntheticControl')is True and response.get('network')=='NOT_RUN'and response.get('PTSetup')=='NOT_RUN'and response.get('actualSFExchangeCalls')==2 and stats.get('outputFailed')is False
 for token in [b'synthetic.invalid',b'synthetic-front.invalid',b'u:p',b'fd00',b'secret',b'SDP']:ok=ok and token not in stderr
 probe=subprocess.Popen([str(a.swift_probe.resolve()),str(out/'helper.stderr'),'--process-control'],stdout=subprocess.PIPE,stderr=subprocess.PIPE);po,pe=probe.communicate(timeout=5);(out/'swift-probe.stdout').write_bytes(po);(out/'swift-probe.stderr').write_bytes(pe)
 result={'schema':'P05_ACTUAL_PHASE_HELPER_PROCESS_V1','status':'PASS'if ok and probe.returncode==0 else'FAIL','helperSHA256':a.helper_sha256,'helperPID':child.pid,'helperWait':child.returncode,'helperReaped':True,'probePID':probe.pid,'probeWait':probe.returncode,'probeReaped':True,'seconds':time.monotonic()-start,'actualLoaderAndMainInstaller':True,'stderrTransport':'direct os.Stderr into parent pipe; exact Arti ipc source separately proves inherited stderr','stderrSHA256':H(out/'helper.stderr'),'stdoutResponse':response,'PTSetup':'NOT_RUN','network':'NOT_RUN','RootQualification':'NOT_SUPPLIED','normalPrivacyAdmission':'UNCHANGED_BLOCKED'}
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'helperPID':child.pid,'network':'NOT_RUN'}));raise SystemExit(0 if result['status']=='PASS'else 1)
if __name__=='__main__':main()
