#!/usr/bin/env python3
"""No eval/shell. Production uses fixed paths/argv; fixtures virtualize host IO.
No SSH is implemented here. The caller uses the locally verified transport plan.
"""
import argparse,fcntl,hashlib,json,os,pathlib,re,shutil,stat,subprocess,sys,tarfile,time,urllib.request,urllib.error
_HERE=pathlib.Path(__file__).resolve()
CLI=(_HERE.parents[4]/'scripts/ops/finance-lease-v2/cli.mjs') if len(_HERE.parents)>4 else _HERE.parent/'cli.mjs'
NODE='/usr/bin/node'
CONTROL='/var/lib/ynx-finance-release-control-v2'
TRUST='/etc/ynx/finance-release-trust-v2.json'
LEASES='/opt/ynx/leases/finance-v2'
ENV='/etc/ynx/finance.env'
CURRENT='/opt/ynx/finance-current'
STATE='/var/lib/ynx/finance/state.json'
UNIT='/etc/systemd/system/ynx-finance.service'
CADDY='/etc/caddy/Caddyfile'
SERVICE='ynx-finance.service'
class Blocked(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise Blocked('HTTP_REDIRECT')
def need(ok,code):
 if not ok:raise Blocked(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def fsyncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def durable_mkdir(p,mode=0o700):
 p=pathlib.Path(p)
 if p.exists():need(p.is_dir() and not p.is_symlink(),'DIRECTORY');return
 durable_mkdir(p.parent,mode)
 try:p.mkdir(mode=mode)
 except FileExistsError:need(p.is_dir() and not p.is_symlink(),'DIRECTORY')
 fsyncdir(p.parent)
def read_regular(p,limit=64*1024*1024):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_size<=limit,'UNSAFE_FILE')
  with os.fdopen(os.dup(fd),'rb') as f:b=f.read(limit+1)
  need(len(b)==st.st_size,'CHANGING_FILE');return b,st
 finally:os.close(fd)
def atomic(p,data,mode=0o600,exclusive=False):
 p=pathlib.Path(p);tmp=p.with_name(p.name+'.tmp-'+os.urandom(12).hex());fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  if exclusive:
   os.link(tmp,p,follow_symlinks=False);os.unlink(tmp)
  else:os.replace(tmp,p)
  fsyncdir(p.parent)
 finally:
  if tmp.exists():tmp.unlink()
def decode(raw):
 def pairs(items):
  out={}
  for k,v in items:need(k not in out,'DUPLICATE_JSON_KEY');out[k]=v
  return out
 return json.loads(raw,object_pairs_hook=pairs)
def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
class Host:
 def __init__(self,fixture=None):
  self.fixture=pathlib.Path(fixture).resolve() if fixture else None
  if self.fixture:need(self.fixture!=pathlib.Path('/') and self.fixture.is_dir() and (self.fixture/'FIXTURE_ONLY').is_file(),'FIXTURE_MARKER')
  else:need(sys.platform=='linux' and os.geteuid()==0,'ROOT_LINUX_REQUIRED')
 def p(self,p):
  need(p.startswith('/') and '..' not in pathlib.PurePosixPath(p).parts,'PATH')
  q=self.fixture/p.lstrip('/') if self.fixture else pathlib.Path(p)
  # Every existing parent must be a real directory, never a mutable symlink.
  for parent in [q.parent,*q.parent.parents]:
   if self.fixture and parent==self.fixture.parent:break
   if parent.exists():need(not parent.is_symlink() and parent.is_dir(),'SYMLINK_PARENT')
  return q
 def protected(self,p,private=False):
  if self.fixture:return
  _,st=read_regular(p);need(st.st_uid==0 and stat.S_IMODE(st.st_mode)&(0o077 if private else 0o022)==0,'PROTECTED_FILE')
  for parent in pathlib.Path(p).parents:
   st=parent.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and stat.S_IMODE(st.st_mode)&0o022==0,'PROTECTED_PARENT')
 def info(self):
  if self.fixture:return decode(read_regular(self.fixture/'host.json')[0])
  mid=read_regular('/etc/machine-id',4096)[0].strip();key=read_regular('/etc/ssh/ssh_host_ed25519_key.pub',4096)[0].decode().split()[1]
  import base64
  fp='SHA256:'+base64.b64encode(hashlib.sha256(base64.b64decode(key)).digest()).decode().rstrip('=')
  return {'host':'43.153.202.237','machineIdSha256':sha(mid),'sshHostFingerprint':fp,'service':SERVICE}
 def service(self,action):
  need(action in ['show','stop','start'],'COMMAND')
  if self.fixture:
   p=self.fixture/'service.json';j=decode(read_regular(p)[0])
   if action=='stop':
    if j.get('stopError'):raise Blocked('FIXTURE_STOP_TIMEOUT')
    j.update(active=False,pid=0)
   elif action=='start':
    if j.get('startError'):raise Blocked('FIXTURE_START_TIMEOUT')
    j.update(active=True,pid=j.get('nextPID',100)+1,nextPID=j.get('nextPID',100)+1)
    if 'onStartState' in j:atomic(self.p(STATE),encode(j['onStartState']))
   if action!='show':atomic(p,encode(j))
   return j
  if action!='show':
   r=subprocess.run(['/usr/bin/systemctl',action,SERVICE],capture_output=True,timeout=90);need(r.returncode==0,'SERVICE_COMMAND')
  if action=='show':
   # Named output avoids systemd property-order assumptions.
   r=subprocess.run(['/usr/bin/systemctl','show',SERVICE,'-p','MainPID','-p','ActiveState','-p','NRestarts'],capture_output=True,text=True,timeout=10);need(r.returncode==0,'SERVICE_READ');j=dict(x.split('=',1) for x in r.stdout.splitlines());return {'pid':int(j['MainPID']),'active':j['ActiveState']=='active','nrestarts':int(j['NRestarts'])}
 def http(self,url):
  if self.fixture:
   j=decode(read_regular(self.fixture/'http.json')[0]);v=j[url]
   if 'byRelease' in v:v=v['byRelease'].get(self.link(),{'status':503,'body':'unknown release'})
   return v['status'],v['body'].encode()
  try:r=urllib.request.build_opener(NoRedirect()).open(url,timeout=10)
  except urllib.error.HTTPError as e:r=e
  # No redirects, insecure TLS, custom headers, POST, account or provider actions.
  need(r.geturl()==url,'HTTP_REDIRECT');body=r.read(131073);need(len(body)<=131072,'HTTP_SIZE');return r.status,body
 def fingerprint(self,p,optional=False):
  q=self.p(p)
  if not q.exists():need(optional and not q.is_symlink(),'MISSING_FILE');return {'absent':True,'sha256':None,'uid':0,'gid':0,'mode':0}
  b,s=read_regular(q);return {'absent':False,'sha256':sha(b),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
 def link(self):
  p=self.p(CURRENT);need(p.is_symlink(),'CURRENT_LINK');target=os.readlink(p);need(re.fullmatch(r'/opt/ynx/releases/finance(?:-v2)?/[a-zA-Z0-9_./-]+',target) and '..' not in target,'CURRENT_TARGET');return target
 def switch(self,target):
  p=self.p(CURRENT);tmp=p.with_name(p.name+'.lease-v2-'+os.urandom(12).hex());os.symlink(target,tmp);os.replace(tmp,p);fsyncdir(p.parent)
 def verify_signature(self,lease_path,minimum_root=0,expected_sha=None):
  self.protected(CLI);self.protected(CLI.parent/'lease.mjs');self.protected(pathlib.Path(__file__))
  self.protected(lease_path)
  lease_raw=read_regular(lease_path,262144)[0];need(expected_sha is None or sha(lease_raw)==expected_sha,'LEASE_CHANGED')
  trust=self.p(TRUST);self.protected(trust);raw,st=read_regular(trust,262144);r=decode(raw);need(r['mode']==('fixture' if self.fixture else 'production'),'MODE');need((self.fixture or st.st_uid==0) and stat.S_IMODE(st.st_mode)&0o022==0,'TRUST_OWNER')
  context={'host':self.info(),'minimumRootVersion':minimum_root}
  # Context is public and transmitted on stdin to a fixed Node wrapper; no temp
  # trust replacement, shell evaluation, external signer or environment overrides.
  script="import fs from 'node:fs';import {verifyLease,sha} from './lease.mjs';import {verifierDigest} from './cli.mjs';const x=JSON.parse(fs.readFileSync(0,'utf8'));const l=verifyLease(x.lease,x.root,{...x.context,nowMs:Date.now()});if(l.tooling.verifierSha256!==verifierDigest())throw Error('TOOLING');console.log(JSON.stringify({rootVersion:x.root.rootVersion,digest:l.signature.payloadSha256}));"
  node=shutil.which('node') if self.fixture else NODE
  r=subprocess.run([node,'--input-type=module','-e',script],cwd=str(CLI.parent),input=encode({'lease':decode(lease_raw),'root':r,'context':context}),capture_output=True,timeout=15)
  need(r.returncode==0,'SIGNATURE_OR_POLICY');return decode(r.stdout)
 def admission(self,l):
  need(self.fingerprint(CADDY)==l['baseline']['caddy'],'CADDY_DRIFT');status,body=self.http(l['admission']['url']);need(status==503 and sha(body)==l['admission']['bodySha256'],'ADMISSION_NOT_CLOSED')
  self.caddy_inventory(l)
  receipt=self.p(LEASES+'/'+l['leaseId']+'/admission.json');self.protected(receipt);raw,_=read_regular(receipt,131072);need(sha(raw)==l['admission']['receiptSha256'],'ADMISSION_RECEIPT')
  j=decode(raw);need(j=={'schema':'ynx-finance-admission/v2','allFinanceIngressClosed':True,'activeRequests':0,'caddySha256':l['baseline']['caddy']['sha256'],'caddyFiles':l['baseline']['caddyFiles'],'leaseId':l['leaseId']},'ADMISSION_POLICY')
 def caddy_inventory(self,l):
  root=self.p('/etc/caddy');paths=[]
  for folder,dirs,files in os.walk(root,followlinks=False):
   for name in dirs:need(not (pathlib.Path(folder)/name).is_symlink(),'CADDY_SYMLINK')
   for name in files:
    q=pathlib.Path(folder)/name;p='/etc/caddy/'+q.relative_to(root).as_posix()
    if p!=CADDY:paths.append(p)
  expected=l['baseline']['caddyFiles'];need(sorted(paths)==sorted(x['path'] for x in expected),'CADDY_INCLUDE_SET')
  for x in expected:need(self.fingerprint(x['path'])==x['file'],'CADDY_INCLUDE_DRIFT')
 def baseline(self,l):
  self.protected(self.p(ENV),True)
  b=l['baseline'];need(self.link()==b['currentRelease'],'CURRENT_DRIFT')
  for key,p in [('binary',b['currentRelease']+'/ynx-finance'),('env',ENV),('unit',UNIT),('caddy',CADDY),('state',STATE)]:need(self.fingerprint(p,key=='state')==b[key],'BASELINE_'+key.upper())
  d=self.p(UNIT+'.d');names=sorted(x.name for x in d.iterdir()) if d.exists() else [];need(names==sorted(x['name'] for x in b['dropins']),'DROPIN_SET')
  for row in b['dropins']:need(self.fingerprint(UNIT+'.d/'+row['name'])==row['file'],'DROPIN_DRIFT')
  s=self.service('show');need(s['active']==b['active'] and s['pid']==b['pid'] and s['nrestarts']==b['nrestarts'],'PROCESS_DRIFT');self.admission(l)
  if b['active'] and not self.fixture:
   with open('/proc/'+str(s['pid'])+'/exe','rb') as f:need(sha(f.read(64*1024*1024+1))==b['binary']['sha256'],'BASELINE_PROCESS_BINARY')
 def retained_rollback(self,l):
  rollback,oldmanifest=self.bundle(l,'rollback')
  # Every retained rollback byte is checked before service stop, including web.
  oldroot=l['baseline']['currentRelease'];expected={x['path'] for x in oldmanifest['files']};actual=set()
  for folder,dirs,files in os.walk(self.p(oldroot),followlinks=False):
   for name in dirs:need(not (pathlib.Path(folder)/name).is_symlink(),'ROLLBACK_LINK')
   for name in files:actual.add((pathlib.Path(folder)/name).relative_to(self.p(oldroot)).as_posix())
  need(actual==expected,'ROLLBACK_FILE_SET')
  for f in oldmanifest['files']:
   self.protected(self.p(oldroot+'/'+f['path']));raw,st=read_regular(self.p(oldroot+'/'+f['path']));need(sha(raw)==f['sha256'] and len(raw)==f['bytes'] and stat.S_IMODE(st.st_mode)==f['mode'],'ROLLBACK_BYTES')
  self.archive(rollback,oldmanifest);return rollback
 def candidate(self,l):
  data,manifest=self.bundle(l,'candidate');rollback=self.retained_rollback(l);need(rollback['candidate.env']==read_regular(self.p(ENV))[0],'ROLLBACK_ENV');self.archive(data,manifest)
  c=l['candidate']
  # Env is private. Preserve every old value except exact release web directory.
  old=read_regular(self.p(ENV))[0];new=data['candidate.env']
  def parse(raw):
   out={}
   for line in raw.decode().splitlines():
    if not line.strip() or line.lstrip().startswith('#'):continue
    need(re.fullmatch(r'[A-Z][A-Z0-9_]*=.*',line) is not None,'ENV_FORMAT');k,v=line.split('=',1);need(k not in out and '\x00' not in v and '\\' not in v,'ENV_FORMAT');out[k]=v
   return out
  a,b=parse(old),parse(new);web='/opt/ynx/releases/finance-v2/'+c['releaseId']+'/web';need(b.get('YNX_FINANCE_WEB_DIR')==web,'WEB_PATH');a.pop('YNX_FINANCE_WEB_DIR',None);b.pop('YNX_FINANCE_WEB_DIR',None);need(a==b,'SECRET_OR_CONFIG_CHANGE')
  for k,v in {'YNX_CHAIN_ENV':'testnet','FINANCE_TRADING_ENV':'sandbox','FINANCE_TRADING_ENABLED':'false','FINANCE_LIVE_ENABLED':'false','FINANCE_SANDBOX_WRITES_ENABLED':'false'}.items():need(b.get(k)==v,'WRITE_FLAGS')
  return data,manifest
 def bundle(self,l,which):
  c=l[which];carrier=self.p(LEASES+'/'+l['leaseId']);data={}
  for name,field in [('candidate.tar','artifactSha256'),('manifest.json','manifestSha256'),('sbom.json','sbomSha256'),('candidate.env','envSha256')]:
   filename=name if which=='candidate' else {'candidate.tar':'rollback.tar','manifest.json':'rollback-manifest.json','sbom.json':'rollback-sbom.json','candidate.env':'rollback.env'}[name]
   self.protected(carrier/filename,name=='candidate.env');raw,st=read_regular(carrier/filename,128*1024*1024);need(sha(raw)==c[field],'CANDIDATE_'+field.upper());need(self.fixture or (st.st_uid==0 and stat.S_IMODE(st.st_mode)&0o022==0),'CARRIER_OWNER');data[name]=raw
  manifest=decode(data['manifest.json']);need(set(manifest)=={'schema','source','tree','releaseId','statePolicy','files'} and manifest['schema']=='ynx-finance-release-inventory/v2' and all(manifest[k]==c[k] for k in ['source','tree','releaseId']) and manifest['statePolicy']=='preserve-existing-no-migration','MANIFEST')
  sbom=decode(data['sbom.json']);need(sbom.get('bomFormat')=='CycloneDX' and sbom.get('metadata',{}).get('component',{}).get('version')==c['source'],'SBOM')
  files=manifest['files'];need(isinstance(files,list) and 1<=len(files)<=1024,'FILES');seen=set();total=0
  for f in files:
   need(set(f)=={'path','sha256','bytes','mode'} and re.fullmatch(r'[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)*',f['path']) and '..' not in pathlib.PurePosixPath(f['path']).parts and f['path'] not in seen,'MEMBER_PATH');seen.add(f['path']);need(re.fullmatch('[a-f0-9]{64}',f['sha256']) and isinstance(f['bytes'],int) and 0<=f['bytes']<=64*1024*1024 and f['mode'] in [0o644,0o755],'MEMBER');total+=f['bytes']
  need(total<=128*1024*1024 and any(f['path']=='ynx-finance' and f['sha256']==c['binarySha256'] and f['mode']==0o755 for f in files),'BINARY')
  return data,manifest
 def archive(self,data,manifest):
  import io
  with tarfile.open(fileobj=io.BytesIO(data['candidate.tar']),mode='r:') as tar:
   members=tar.getmembers();expected={x['path']:x for x in manifest['files']};need(len(members)==len(expected),'ARCHIVE_SET');got=set();result=[]
   for member in members:
    need(member.isfile() and not member.pax_headers and member.name in expected and member.name not in got,'ARCHIVE_MEMBER');got.add(member.name);e=expected[member.name];need(member.size==e['bytes'] and member.mode==e['mode'],'ARCHIVE_METADATA');raw=tar.extractfile(member).read();need(sha(raw)==e['sha256'],'ARCHIVE_HASH');result.append((member.name,member.mode,raw))
   return result
 def extract(self,l,data,manifest):
  entries=self.archive(data,manifest);dest=self.p('/opt/ynx/releases/finance-v2/'+l['candidate']['releaseId']);need(not dest.exists() and not dest.is_symlink(),'RELEASE_EXISTS');durable_mkdir(dest.parent,0o755);dest.mkdir(mode=0o755);fsyncdir(dest.parent)
  for name,mode,raw in entries:
   p=dest/name;durable_mkdir(p.parent,0o755);atomic(p,raw,mode,True)
  for folder,_,_ in os.walk(dest,topdown=False):fsyncdir(folder)
  return dest
 def unit_inventory(self,l):
  need(self.fingerprint(UNIT)==l['baseline']['unit'],'UNIT_DRIFT');d=self.p(UNIT+'.d');expected=l['baseline']['dropins'];names=sorted(x.name for x in d.iterdir()) if d.exists() else [];need(names==sorted(x['name'] for x in expected),'DROPIN_SET')
  for row in expected:need(self.fingerprint(UNIT+'.d/'+row['name'])==row['file'],'DROPIN_DRIFT')
 def verify_running(self,l,rollback=False):
  c=l['rollback' if rollback else 'candidate'];v=l['rollbackVerification' if rollback else 'verification'];target=l['baseline']['currentRelease'] if rollback else '/opt/ynx/releases/finance-v2/'+c['releaseId']
  s=self.service('show');need(s['active'] and s['pid']>0 and s['nrestarts']==0,'NOT_RUNNING');need(self.link()==target,'RUNNING_LINK')
  need(self.fingerprint(target+'/ynx-finance')['sha256']==c['binarySha256'] and self.fingerprint(ENV)['sha256']==c['envSha256'],'RUNNING_BYTES')
  if not self.fixture:
   # /proc exe is deliberately kernel-owned symlink: open then hash its pinned fd.
   with open('/proc/'+str(s['pid'])+'/exe','rb') as f:need(sha(f.read(64*1024*1024+1))==c['binarySha256'],'PROCESS_BINARY')
  self.unit_inventory(l)
  code,raw=self.http(v['url']);need(code==200 and sha(raw)==v['versionSha256'],'VERSION_BYTES');j=decode(raw);need(j.get('commit')==c['source'],'VERSION_SOURCE');need(self.fingerprint(STATE,True)==l['baseline']['state'],'STATE_CHANGED');self.admission(l)

def execute(host,lease_id,mode,crash=None):
 need(re.fullmatch(r'[a-z][a-z0-9-]{7,95}',lease_id),'LEASE_ID');lease_path=host.p(LEASES+'/'+lease_id+'/lease.json');raw,_=read_regular(lease_path,262144);l=decode(raw);need(l.get('leaseId')==lease_id,'LEASE_ID_MISMATCH')
 verified=host.verify_signature(lease_path,expected_sha=sha(raw));need(l['tooling']['executorSha256']==sha(pathlib.Path(__file__).read_bytes()),'EXECUTOR_IDENTITY')
 control=host.p(CONTROL)
 if mode=='dry-run':
  if (control/'ledger.json').exists():ledger=decode(read_regular(control/'ledger.json')[0]);check_ledger(ledger,l,verified)
  host.baseline(l);host.candidate(l);return {'status':'DRY_RUN_VERIFIED_NOT_CONSUMED','leaseId':lease_id,'mutations':False}
 need(mode=='execute','MODE');durable_mkdir(control,0o700);need(not control.is_symlink() and (host.fixture or control.stat().st_uid==0) and stat.S_IMODE(control.stat().st_mode)==0o700,'CONTROL_OWNER')
 lock=os.open(control/'lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  need(os.fstat(lock).st_nlink==1,'LOCK_LINK')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Blocked('BUSY')
  ledger_path=control/'ledger.json'
  if ledger_path.exists():host.protected(ledger_path,True)
  ledger=decode(read_regular(ledger_path)[0]) if ledger_path.exists() else {'schema':'ynx-finance-consumed/v2','rootVersion':0,'lastClockMs':0,'leases':{}}
  verified=host.verify_signature(lease_path,ledger['rootVersion'],sha(raw));check_ledger(ledger,l,verified)
  host.baseline(l);data,manifest=host.candidate(l)
  need(l['candidate']['releaseId']!=l['rollback']['releaseId'],'SAME_RELEASE')
  dest=host.p('/opt/ynx/releases/finance-v2/'+l['candidate']['releaseId']);need(not dest.exists() and not dest.is_symlink(),'RELEASE_EXISTS')
  # Irreversible authorization consumption is one atomic durable ledger replace.
  entry={'nonce':l['nonce'],'payloadSha256':verified['digest'],'state':'CONSUMED','phase':'PREPARED','operation':l['operation'],'candidateSource':l['candidate']['source']};ledger['leases'][lease_id]=entry
  if l['recoveryOf'] is not None:ledger['leases'][l['recoveryOf']].update(state='RECOVERY_AUTHORIZED',recoveryLeaseId=lease_id)
  ledger['rootVersion']=verified['rootVersion'];ledger['lastClockMs']=int(time.time()*1000);atomic(ledger_path,encode(ledger))
  def phase(name):
   entry['phase']=name;ledger['lastClockMs']=max(ledger['lastClockMs'],int(time.time()*1000));atomic(ledger_path,encode(ledger))
   if host.fixture and crash==name:os._exit(77)
  phase('CONSUMED');backup=control/lease_id;backup.mkdir(mode=0o700);fsyncdir(control);atomic(backup/'env',read_regular(host.p(ENV))[0],exclusive=True);atomic(backup/'baseline.json',encode(l['baseline']),exclusive=True)
  stopped=False;command_uncertain=False
  try:
   host.extract(l,data,manifest);phase('STAGED');host.baseline(l)
   # Expiry/host/root are checked again directly before affecting the service.
   host.verify_signature(lease_path,ledger['rootVersion'],sha(raw));need(int(time.time()*1000)>=ledger['lastClockMs'],'CLOCK_ROLLBACK');phase('STOPPING')
   if l['baseline']['active']:
    command_uncertain=True;host.service('stop')
   need(not host.service('show')['active'] and host.service('show')['pid']==0,'WRITER_STILL_ACTIVE');command_uncertain=False;stopped=True;phase('STOPPED')
   need(host.fingerprint(STATE,True)==l['baseline']['state'],'STATE_CHANGED');
   if not l['baseline']['state']['absent']:atomic(backup/'state',read_regular(host.p(STATE))[0],exclusive=True)
   host.verify_signature(lease_path,ledger['rootVersion'],sha(raw));need(int(time.time()*1000)>=ledger['lastClockMs'],'CLOCK_ROLLBACK')
   phase('SWITCHING');e=host.p(ENV);oldstat=e.stat();atomic(e,data['candidate.env'],stat.S_IMODE(oldstat.st_mode));os.chown(e,oldstat.st_uid,oldstat.st_gid);host.switch('/opt/ynx/releases/finance-v2/'+l['candidate']['releaseId']);phase('SWITCHED');host.verify_signature(lease_path,ledger['rootVersion'],sha(raw));need(int(time.time()*1000)>=ledger['lastClockMs'],'CLOCK_ROLLBACK');command_uncertain=True;host.service('start');command_uncertain=False;phase('STARTED');host.verify_running(l);phase('VERIFIED');entry['state']='SUCCEEDED';atomic(ledger_path,encode(ledger));return {'status':'SUCCEEDED_ADMISSION_REMAINS_CLOSED','leaseId':lease_id,'operation':l['operation'],'source':l['candidate']['source'],'stateRestored':False}
  except Exception:
   # Never overwrite state, retry uncertain commands or guess after a crash. If
   # stopped with unchanged state, binary/env rollback can preserve all records.
   try:
    need(not command_uncertain,'UNCERTAIN_COMMAND');host.admission(l);need(host.fingerprint(STATE,True)==l['baseline']['state'],'RECOVERY_STATE_CHANGED')
    if stopped:
     host.retained_rollback(l);need(sha(read_regular(backup/'env')[0])==l['rollback']['envSha256'],'ROLLBACK_BACKUP');host.service('stop');need(host.service('show')['pid']==0,'RECOVERY_WRITER');need(host.link() in [l['baseline']['currentRelease'],'/opt/ynx/releases/finance-v2/'+l['candidate']['releaseId']],'RECOVERY_LINK');oldstat=host.p(ENV).stat();atomic(host.p(ENV),read_regular(backup/'env')[0],stat.S_IMODE(oldstat.st_mode));os.chown(host.p(ENV),oldstat.st_uid,oldstat.st_gid);host.switch(l['baseline']['currentRelease'])
     if l['baseline']['active']:host.service('start');host.verify_running(l,True)
    entry['state']=('FAILED_ROLLED_BACK' if l['baseline']['active'] else 'FAILED_RESTORED_INACTIVE') if stopped else 'FAILED_BEFORE_SWITCH'
   except Exception:entry['state']='AMBIGUOUS_REQUIRES_NEW_RECOVERY_LEASE'
   atomic(ledger_path,encode(ledger));raise Blocked(entry['state'])
 finally:os.close(lock)
def check_ledger(ledger,l,verified):
 need(ledger.get('schema')=='ynx-finance-consumed/v2' and isinstance(ledger.get('leases'),dict) and len(ledger['leases'])<10000,'LEDGER_SCHEMA');need(int(time.time()*1000)>=ledger['lastClockMs'],'CLOCK_ROLLBACK');need(verified['rootVersion']>=ledger['rootVersion'],'ROOT_ROLLBACK');need(l['leaseId'] not in ledger['leases'] and all(x['nonce']!=l['nonce'] for x in ledger['leases'].values()),'ALREADY_CONSUMED')
 unresolved=[k for k,v in ledger['leases'].items() if v.get('state') in ['CONSUMED','AMBIGUOUS_REQUIRES_NEW_RECOVERY_LEASE']]
 if l['recoveryOf'] is not None:need(l['operation']=='rollback' and unresolved==[l['recoveryOf']],'RECOVERY_RECEIPT')
 else:need(not unresolved,'UNRESOLVED_EXECUTION_REQUIRES_RECOVERY_LEASE')
def doctor(host):
 # All observations are hashes/metadata. No environment, state records or keys.
 observations={}
 for name,fn in [('service',lambda:host.service('show')),('currentRelease',host.link),('env',lambda:host.fingerprint(ENV)),('state',lambda:host.fingerprint(STATE,True)),('unit',lambda:host.fingerprint(UNIT)),('caddy',lambda:host.fingerprint(CADDY))]:
  try:observations[name]=fn()
  except Exception:observations[name]={'status':'UNAVAILABLE'}
 p=host.p(CONTROL)/'ledger.json'
 if not p.exists():return {'status':'NO_EXECUTION_LEDGER','mutations':False,'observations':observations}
 j=decode(read_regular(p)[0]);return {'status':'READ_ONLY','rootVersion':j['rootVersion'],'leases':[{'leaseId':k,'state':v['state'],'phase':v['phase']} for k,v in j['leases'].items()],'observations':observations,'mutations':False,'recovery':'Any CONSUMED/ambiguous entry is spent; inspect exact link/env/service/state and obtain a new recovery lease. Never resume the old ID.'}

def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['doctor','dry-run','execute']);p.add_argument('--lease-id');p.add_argument('--fixture-root');p.add_argument('--fixture-crash',choices=['CONSUMED','STAGED','STOPPING','STOPPED','SWITCHING','SWITCHED','STARTED','VERIFIED']);a=p.parse_args();need(not a.fixture_crash or a.fixture_root,'NO_PRODUCTION_FAULT_INJECTION');host=Host(a.fixture_root)
 if not host.fixture:
  global CLI
  CLI=pathlib.Path('/opt/ynx/finance-release-v2/cli.mjs')
 result=doctor(host) if a.mode=='doctor' else execute(host,a.lease_id,a.mode,a.fixture_crash);print(json.dumps(result))
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'status':'BLOCKED','code':str(e) if isinstance(e,Blocked) else 'INPUT_OR_OPERATION_FAILURE','secretsPrinted':False}));sys.exit(1)
