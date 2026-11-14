#!/usr/bin/env python3
"""One explicitly reviewed PUBLIC Snowflake backend QA; no WebKit or production gate."""
import argparse,hashlib,json,os,signal,subprocess,time
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('prepared',type=Path);a=p.parse_args();out=a.prepared.resolve()
 prep=json.loads((out/'PREPARATION.json').read_text());plan=json.loads((out/'CLI-PLAN.json').read_text());scope=json.loads((out/'scope.json').read_text())
 assert prep['status']=='PREPARED_NO_NETWORK'and plan['schema']=='P05_REVIEWED_SNOWFLAKE_QA_PLAN_V1'
 assert plan['chosenLineSHA256']=='9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f'and scope['attempts']==1
 assert scope['normalPrivacyAdmission']is False and scope['ReleaseApproved']is False
 assert not(out/'RUN-ONCE').exists()and not(out/'NETWORK-SUPERVISOR.json').exists()
 assert all(sha(Path(n))==h for n,h in prep['sourceAndSupplyPins'].items())
 profile=Path(plan['scratch']);before_bytes=sum(f.stat().st_size for f in out.rglob('*')if f.is_file())
 start=time.monotonic();reason=None;peak=0;samples=0;cancelled=False
 with(out/'network-cli.stdout').open('xb')as stdout,(out/'network-cli.stderr').open('xb')as stderr:
  child=subprocess.Popen(prep['runCommand'],stdout=stdout,stderr=stderr,start_new_session=True)
  record={'schema':'P05_REVIEWED_SNOWFLAKE_QA_SUPERVISOR_V1','pid':child.pid,'pgid':os.getpgid(child.pid),'session':os.getsid(child.pid),'startUnix':time.time(),'scopeSHA256':sha(out/'scope.json'),'actualOnlyReviewedLineSHA256':plan['chosenLineSHA256'],'argv':prep['runCommand'],'globalSecondsIncludingCleanup':650,'memoryBudgetBytes':1024**3,'newPhysicalBudgetBytes':256*1024**2,'status':'RUNNING'}
  def save(): (out/'NETWORK-SUPERVISOR.json').write_text(json.dumps(record,indent=2)+'\n')
  save();print(json.dumps({'event':'started','pid':child.pid,'pgid':record['pgid'],'case':str(out),'remainingNetworkTargets':'reviewed transport categories only, no addresses persisted'}),flush=True)
  while child.poll()is None and time.monotonic()-start<650:
   elapsed=time.monotonic()-start
   q=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss='],capture_output=True,text=True,timeout=3)
   table={}
   for line in q.stdout.splitlines():
    words=line.split()
    if len(words)==3 and all(v.isdigit()for v in words):table[int(words[0])]=(int(words[1]),int(words[2]))
   owned={child.pid};changed=True
   while changed:
    more={pid for pid,(ppid,rss)in table.items()if ppid in owned};changed=not more.issubset(owned);owned|=more
   rss=sum(table.get(pid,(0,0))[1]for pid in owned)*1024;peak=max(peak,rss);samples+=1
   physical=sum(f.stat().st_size for root in[out,profile]if root.exists()for f in root.rglob('*')if f.is_file());growth=physical-before_bytes
   if rss>1024**3:reason='memory-budget'
   elif growth>256*1024**2:reason='new-physical-budget'
   elif elapsed>=625:reason=reason or'observation-deadline-reserving25scleanup'
   if reason and not cancelled:
    child.send_signal(signal.SIGINT);cancelled=True;record['cancelRequestedAtSeconds']=elapsed;record['stopReason']=reason
   record.update(elapsedSeconds=elapsed,peakOwnedTreeRSSBytes=peak,RSSSamples=samples,newPhysicalBytes=max(0,growth));save()
   time.sleep(.25)
  if child.poll()is None:
   record.update(status='CLEANUP_UNKNOWN_OWNER_RETAINED',effectState='UNKNOWN; do not kill root/replace backend',elapsedSeconds=time.monotonic()-start);save();print(json.dumps({'status':record['status'],'pid':child.pid,'case':str(out)}));raise SystemExit(2)
  child.wait(timeout=2)
 record.update(status='EXIT_OBSERVED',returncode=child.returncode,reaped=True,elapsedSecondsIncludingCleanup=time.monotonic()-start,peakOwnedTreeRSSBytes=peak,RSSSamples=samples);save();print(json.dumps({'status':record['status'],'pid':child.pid,'returncode':child.returncode,'elapsed':record['elapsedSecondsIncludingCleanup'],'peakOwnedRSS':peak,'case':str(out)}));raise SystemExit(child.returncode or 0)
if __name__=='__main__':main()
