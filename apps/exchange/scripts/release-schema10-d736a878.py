#!/usr/bin/env python3
"""Exchange-only fixed-source release. No state rollback/copy over live data.

preflight stages immutable source and executes an isolated state COPY as ynx.
deploy is a separate explicit action after preflight: only this service gets an
ExecStart/WorkingDirectory drop-in. Old shared symlinks and Quant stay unchanged.
"""
import hashlib,json,os,pwd,socket,stat,subprocess,sys,tarfile,time,urllib.request
from pathlib import Path

SOURCE='d736a87831fe83249ce7adfeae7a21efbc283b3e'
OLD='443286487e057d78cb6b1a686d14bb37be8b3c23'
RUN='exchange-schema10-d736a87831fe-20260912T113000Z'
ARCHIVE=Path('/tmp/'+RUN+'.tar.gz')
ARCHIVE_SHA='d3e2d89c70f86793a1842dee0cde9864142f03238bfa458e0366c325ee045a40'
ROOT=Path('/opt/ynx/exchange-releases')
RELEASE=ROOT/RUN
STATE=Path('/var/lib/ynx-exchange/state.json')
DROPIN=Path('/etc/systemd/system/ynx-exchange.service.d/zz-'+RUN+'.conf')
ENV=Path('/etc/ynx/exchange.env')
OLD_ROOT='/opt/ynx/releases/financial-owner-reads/ynx-financial-owner-reads-443286487e05/exchange'
HASHES={str(ENV):'409983db6acf881430e64f8a2a767ab6f63ac625f7c0e5413a41c02b88153bc0',
 '/etc/systemd/system/ynx-exchange.service':'7feb4a60f1b9c8e1fc2991fcad3212f0d99e0d30cbd4e96c495d818e672f4532',
 '/etc/systemd/system/ynx-exchange.service.d/public.conf':'89762b0c64f37e3f908c81736401b2ecfce768595d1c6308f8c735a24d66c347',
 '/etc/systemd/system/ynx-exchange.service.d/quant-product-session.conf':'731323a5789016d2ad0bdba8035779b1c5f28834fe89fe3d8df75bcb24ad02d5',
 '/etc/caddy/Caddyfile':'077fe80ea9aab24a32d64ba1fab3584e8aab10304e200e58d976d2c33edfb39f',
 '/etc/caddy/conf.d/ynx-exchange.caddy':'7eca0af0a9f13e0d8a4021063b29cc15234012efd4cef5a9bb1e9f804800c8fb',
 OLD_ROOT+'/bin/ynx-exchanged':'41b9c4854b77b9fc2dd30e3c4471a4b25f54fac949e67a1abf2b908f48838293'}
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def receipt(p):
 p=Path(p)
 if not os.path.lexists(p):return {'path':str(p),'absent':True}
 s=p.lstat();v={'path':str(p),'dev':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'bytes':s.st_size,'type':'file' if stat.S_ISREG(s.st_mode) else 'directory' if stat.S_ISDIR(s.st_mode) else 'symlink'}
 if stat.S_ISREG(s.st_mode):v['sha256']=sha(p.read_bytes())
 if stat.S_ISLNK(s.st_mode):v['target']=os.readlink(p)
 return v
def regular(p,digest=None):
 r=receipt(p);assert r.get('type')=='file' and r['nlink']==1 and Path(p).resolve()==Path(p)
 if digest:assert r['sha256']==digest
 return r
def directory(p):
 r=receipt(p);assert r.get('type')=='directory' and Path(p).resolve()==Path(p) and r['uid']==0 and r['mode']&0o022==0;return r
def absent(p):assert not os.path.lexists(p)
def original_links():
 for p,target in [('/opt/ynx/exchange',OLD_ROOT),('/usr/local/bin/ynx-exchanged',OLD_ROOT+'/bin/ynx-exchanged')]:assert Path(p).is_symlink() and str(Path(p).resolve())==target
def process_executable(pid):return os.readlink('/proc/'+pid+'/exe')
def save(p,raw,mode=0o600,uid=0,gid=986):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),mode);os.fchown(f.fileno(),uid,gid)
 return regular(p,sha(raw))
def remove_exact(p,r):
 assert regular(p)==r;os.unlink(p);absent(p)
def service(name='ynx-exchange.service'):
 keys=['LoadState','ActiveState','SubState','MainPID','NRestarts','User','Group','WorkingDirectory']
 return dict(line.split('=',1) for line in subprocess.check_output(['/usr/bin/systemctl','show',name]+['-p'+k for k in keys],text=True).splitlines())
def ctl(action):subprocess.run(['/usr/bin/systemctl',action,'ynx-exchange.service'],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):raise AssertionError('HTTP_REDIRECT_REFUSED')
def http(url,source=None,digest=None):
 req=urllib.request.Request(url,headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'})
 with urllib.request.build_opener(NoRedirect()).open(req,timeout=2) as r:
  raw=r.read(2*1024*1024+1);assert len(raw)<=2*1024*1024 and r.status==200
  value={'url':url,'status':r.status,'bytes':len(raw),'sha256':sha(raw),'mime':r.headers.get('Content-Type')}
  if source:assert json.loads(raw)['commit']==source
  if digest:assert value['sha256']==digest
  return value
def ready(base,source,proc=None):
 deadline=time.monotonic()+25
 while time.monotonic()<deadline:
  if proc:assert proc.poll() is None
  try:return http(base+'/api/version',source)
  except Exception:time.sleep(.2)
 raise AssertionError('SOURCE_BOUND_READINESS_TIMEOUT')
def verify_baseline():
 assert os.geteuid()==0 and os.uname().machine=='x86_64';u=pwd.getpwnam('ynx');assert (u.pw_uid,u.pw_gid)==(995,986)
 for p,d in HASHES.items():regular(p,d)
 original_links()
 s=service();assert s['ActiveState']=='active' and s['SubState']=='running' and s['MainPID']=='877065' and s['NRestarts']=='0' and s['User']==s['Group']=='ynx'
 assert service('ynx-quant-exchange.service')['MainPID']=='2275763'
 r=regular(STATE,'86d52d7c764030bebc1ae0a06ebbdc030f5a6a33bb4e91177beb9cd8fd364e5e');assert r['bytes']==249623 and json.loads(STATE.read_bytes())['schemaVersion']==10
 for base in ['http://127.0.0.1:18446','https://exchange.ynxweb4.com']:
  http(base+'/api/version',OLD);http(base+'/api/health',digest='bcf22421b76c03b9da4fa401c56405b123a6f8b7eaa49d942391dfec25ee3ee8');http(base+'/',digest='64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde')
 return {'service':s,'state':r,'config':[regular(p,d) for p,d in HASHES.items()],'quant':service('ynx-quant-exchange.service')}
def archive_files(p):
 assert regular(p,ARCHIVE_SHA)['bytes']==4231210
 prefix='ynx-exchange-schema10-'+SOURCE[:12]+'/'
 names=['apps/exchange/web/'+n for n in ['app.js','index.html','styles.css','wallet-auth.js']]+['ynx-exchanged','BUNDLE_MANIFEST.json','SHA256SUMS']
 with tarfile.open(p,'r:gz') as tf:
  members=tf.getmembers();assert {m.name for m in members}=={prefix+n for n in names} and len(members)==len(names)
  assert all(m.isfile() and m.size<=10000000 and m.name.startswith(prefix) for m in members)
  data={m.name[len(prefix):]:tf.extractfile(m).read() for m in members}
 manifest=json.loads(data['BUNDLE_MANIFEST.json']);assert manifest['sourceCommit']==SOURCE and manifest['stateSchema']==10
 assert {e['path'] for e in manifest['entries']}==set(names)-{'BUNDLE_MANIFEST.json','SHA256SUMS'}
 for e in manifest['entries']:assert len(data[e['path']])==e['bytes'] and sha(data[e['path']])==e['sha256']
 binary=data['ynx-exchanged'];assert binary[:6]==b'\x7fELF\x02\x01' and binary[18:20]==b'\x3e\x00' and len(binary)==9568440 and sha(binary)=='01b9398202aec44dc1f9872378728720a6158216f264a07e738f17a8781f3918'
 return data,manifest
def preflight():
 before=verify_baseline();absent(RELEASE);absent(DROPIN);directory(ROOT.parent)
 if not os.path.lexists(ROOT):ROOT.mkdir(mode=0o750);os.chown(ROOT,0,986)
 directory(ROOT);data,manifest=archive_files(ARCHIVE)
 RELEASE.mkdir(mode=0o750);os.chown(RELEASE,0,986)
 for relative in ['apps','apps/exchange','apps/exchange/web']:(RELEASE/relative).mkdir(mode=0o755)
 for name,raw in data.items():save(RELEASE/name,raw,0o755 if name=='ynx-exchanged' else 0o644)
 subprocess.run(['/usr/sbin/runuser','-u','ynx','--','/bin/sh','-c','cd "$1" && test -x ./ynx-exchanged && test -r ./apps/exchange/web/wallet-auth.js','access',str(RELEASE)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 isolated=RELEASE/'.isolated-preflight';isolated.mkdir(mode=0o700);os.chown(isolated,995,986);copy=isolated/'state.json';save(copy,STATE.read_bytes(),0o600,995,986)
 proc=None;runs=[]
 try:
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  env={'PATH':'/usr/bin:/bin','YNX_EXCHANGE_HTTP_ADDR':'127.0.0.1:'+str(port),'YNX_EXCHANGE_STATE_PATH':str(copy),'YNX_EXCHANGE_ADMIN_API_KEY':'isolated-schema10-preflight-fixture-only'}
  for run in range(3):
   proc=subprocess.Popen([str(RELEASE/'ynx-exchanged')],cwd=RELEASE,env=env,user=995,group=986,extra_groups=[986],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   base='http://127.0.0.1:'+str(port);rows=[ready(base,SOURCE,proc),http(base+'/api/health',SOURCE)]
   for e in manifest['entries']:
    if e['path'].startswith('apps/exchange/web/'):
     name=Path(e['path']).name;rows.append(http(base+('/' if name=='index.html' else '/'+name),digest=e['sha256']))
   time.sleep(1.2);assert proc.poll() is None;proc.terminate();proc.wait(timeout=10);proc=None
   assert regular(copy)['sha256']==before['state']['sha256'];runs.append({'launch':run+1,'http':rows,'stateSha256':regular(copy)['sha256']})
 finally:
  if proc and proc.poll() is None:proc.terminate();proc.wait(timeout=10)
  # Only the isolated copy and its own CAS lock may be removed, after stop.
  assert set(p.name for p in isolated.iterdir())<= {'state.json','state.json.lock'}
  for name in ['state.json.lock','state.json']:
   p=isolated/name
   if os.path.lexists(p):r=regular(p);assert r['uid']==995;remove_exact(p,r)
  isolated.rmdir();absent(isolated)
 after=verify_baseline();assert after==before
 evidence={'status':'ISOLATED_LINUX_SCHEMA10_PREFLIGHT_PASS','source':SOURCE,'before':before,'after':after,'runs':runs,'release':receipt(RELEASE),'files':[regular(RELEASE/name) for name in data],'isolatedFinalAbsent':True,'productionMutation':False,'realAccountApproval':False}
 save(RELEASE/'preflight-receipt.json',(json.dumps(evidence,indent=2)+'\n').encode());print(json.dumps(evidence),flush=True)
def deploy():
 pre=json.loads((RELEASE/'preflight-receipt.json').read_bytes());assert pre['status']=='ISOLATED_LINUX_SCHEMA10_PREFLIGHT_PASS' and pre['source']==SOURCE
 for entry in pre['files']:assert regular(entry['path'])==entry
 before=verify_baseline();absent(DROPIN);directory(DROPIN.parent);parent=receipt(DROPIN.parent);old_names=set(p.name for p in DROPIN.parent.iterdir());assert old_names=={'public.conf','quant-product-session.conf'}
 manifest=json.loads((RELEASE/'BUNDLE_MANIFEST.json').read_bytes());drop_bytes=('[Service]\nExecStart=\nExecStart='+str(RELEASE/'ynx-exchanged')+'\nWorkingDirectory='+str(RELEASE)+'\n').encode()
 phase='PRE_SWITCH';placed=None;stopped=False;rollback=False
 try:
  # Stop only canonical Exchange before switching its executable; never run
  # old and new against one file-CAS state. A state backup is never restored.
  ctl('stop');stopped=True;assert service()['MainPID']=='0';assert regular(STATE)==before['state']
  save(RELEASE/'state-before-switch.json',STATE.read_bytes(),0o600)
  phase='DROPIN_INSTALL';assert receipt(DROPIN.parent)==parent and set(p.name for p in DROPIN.parent.iterdir())==old_names;placed=save(DROPIN,drop_bytes,0o644,0,0)
  subprocess.run(['/usr/bin/systemctl','daemon-reload'],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  phase='START_READY';ctl('start');base='http://127.0.0.1:18446';ready(base,SOURCE)
  candidate=service();assert candidate['ActiveState']=='active' and candidate['SubState']=='running' and int(candidate['MainPID'])>0 and candidate['MainPID']!=before['service']['MainPID'] and candidate['NRestarts']=='0' and candidate['WorkingDirectory']==str(RELEASE)
  assert process_executable(candidate['MainPID'])==str(RELEASE/'ynx-exchanged')
  phase='PUBLIC_VERIFY';rows=[]
  for base in ['http://127.0.0.1:18446','https://exchange.ynxweb4.com']:
   rows += [http(base+'/api/version',SOURCE),http(base+'/api/health',SOURCE)]
   for e in manifest['entries']:
    if e['path'].startswith('apps/exchange/web/'):
     name=Path(e['path']).name;rows.append(http(base+('/' if name=='index.html' else '/'+name),digest=e['sha256']))
  for p,d in HASHES.items():regular(p,d)
  assert service('ynx-quant-exchange.service')==before['quant'];assert set(p.name for p in DROPIN.parent.iterdir())==old_names|{DROPIN.name}
  original_links()
  result={'status':'DEPLOYED_SOURCE_BOUND_PUBLIC','source':SOURCE,'service':candidate,'before':before,'http':rows,'stateAfter':regular(STATE),'dropin':regular(DROPIN),'retainedRelease':str(RELEASE),'rollbackPolicy':'stop only canonical service; exact-remove own dropin; daemon-reload; start old service; preserve newest schema10 state; never copy snapshot over it','deployCount':1,'automaticRollbackCount':0,'realAccountApproval':False,'nativeActionSigned':False,'transactionSubmitted':False,'quantUnchanged':True,'caddyUnchanged':True,'originalSymlinksUnchanged':True}
  save(RELEASE/'deployment-receipt.json',(json.dumps(result,indent=2)+'\n').encode());print(json.dumps(result),flush=True)
 except BaseException as error:
  if stopped:
   ctl('stop')
   if placed:remove_exact(DROPIN,placed)
   subprocess.run(['/usr/bin/systemctl','daemon-reload'],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);ctl('start');ready('http://127.0.0.1:18446',OLD)
   for p,d in HASHES.items():regular(p,d)
   for base in ['http://127.0.0.1:18446','https://exchange.ynxweb4.com']:http(base+'/api/version',OLD);http(base+'/api/health',digest='bcf22421b76c03b9da4fa401c56405b123a6f8b7eaa49d942391dfec25ee3ee8');http(base+'/',digest='64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde')
   restored=service();assert restored['ActiveState']=='active' and restored['SubState']=='running' and int(restored['MainPID'])>0 and restored['NRestarts']=='0';original_links()
   assert service('ynx-quant-exchange.service')==before['quant'];rollback=True
  print(json.dumps({'status':'FAILED_CLOSED','phase':phase,'errorClass':type(error).__name__,'automaticRollback':rollback,'stateSnapshotRestored':False,'service':service(),'state':receipt(STATE),'retainedRelease':str(RELEASE)}),flush=True);raise SystemExit(1)
if __name__=='__main__':
 assert len(sys.argv)==2 and sys.argv[1] in ['preflight','deploy']
 if sys.argv[1]=='preflight':preflight()
 else:deploy()
