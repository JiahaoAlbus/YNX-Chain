import os,stat,json,hashlib,sys
file=sys.argv[1];now=int(sys.argv[2]);uid=os.geteuid();assert uid==995
F=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
parts=file.split('/');assert parts[0]=='' and all(x not in ['','..','.']for x in parts[1:])
def directory():
 d=os.open('/',F)
 try:
  for part in parts[1:-1]:
   s=os.fstat(d);assert s.st_uid in [0,uid]and stat.S_IMODE(s.st_mode)&0o022==0
   n=os.open(part,F,dir_fd=d);os.close(d);d=n
  s=os.fstat(d);assert s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o700
  return d
 except:os.close(d);raise
def unique(pairs):
 o={}
 for k,v in pairs:
  assert k not in o;o[k]=v
 return o
def cp(x):
 assert type(x)is dict and set(x)=={'rootVersion','sequence','payloadSha256'}
 assert type(x['rootVersion'])is int and 0<x['rootVersion']<=9007199254740991
 assert type(x['sequence'])is int and 0<=x['sequence']<=9007199254740991
 assert type(x['payloadSha256'])is str and len(x['payloadSha256'])==64 and all(c in '0123456789abcdef'for c in x['payloadSha256'])
 return x
def read(name,missing=False):
 try:f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=d)
 except FileNotFoundError:
  if missing:return None
  raise
 try:
  s=os.fstat(f);assert stat.S_ISREG(s.st_mode)and s.st_uid==uid and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=131072
  with os.fdopen(os.dup(f),'rb')as h:b=h.read(131073)
  a=os.fstat(f);n=os.stat(name,dir_fd=d,follow_symlinks=False)
  assert len(b)==s.st_size and(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns)==(n.st_dev,n.st_ino,n.st_size,n.st_mtime_ns)
  return b
 finally:os.close(f)
d=directory();initial=os.fstat(d);leaf=parts[-1];marker=b'ynx-finance-endpoint-authority-checkpoint/v1\n'
try:
 genesisBytes=read(leaf+'.genesis');assert read(leaf+'.initialized')==marker
 genesis=json.loads(genesisBytes,object_pairs_hook=unique);assert type(genesis)is dict and set(genesis)=={'anchor','schemaVersion','trustedClockHighWaterMs'}and genesis['schemaVersion']=='ynx-finance-endpoint-authority-checkpoint-genesis/v1'and type(genesis['trustedClockHighWaterMs'])is int and genesis['trustedClockHighWaterMs']==0
 current=cp(genesis['anchor']);high=0
 for depth in range(10000):
  digest=hashlib.sha256(json.dumps(current,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();name=leaf+'.from-'+digest
  body=read(name,True);committed=read(name+'.committed',True)
  if body is None:
   assert committed is None;break
  assert committed==marker
  row=json.loads(body,object_pairs_hook=unique);assert type(row)is dict and set(row)=={'schemaVersion','previous','next','trustedClockHighWaterMs'}and row['schemaVersion']=='ynx-finance-endpoint-authority-checkpoint-transition/v1'and cp(row['previous'])==current
  nxt=cp(row['next']);rootOnly=nxt['rootVersion']>current['rootVersion']and nxt['sequence']==current['sequence']and nxt['payloadSha256']==current['payloadSha256'];assert nxt['rootVersion']>=current['rootVersion']and(nxt['sequence']>current['sequence']or rootOnly)
  t=row['trustedClockHighWaterMs'];assert type(t)is int and high<=t<=9007199254740991;high=t;current=nxt
 else:raise ValueError('CHAIN_TOO_LONG')
 assert now>=high and read(leaf+'.genesis')==genesisBytes and read(leaf+'.initialized')==marker
 fresh=directory()
 try:
  s=os.fstat(fresh);assert(s.st_dev,s.st_ino,s.st_uid,s.st_mode)==(initial.st_dev,initial.st_ino,initial.st_uid,initial.st_mode)
 finally:os.close(fresh)
 print(json.dumps(current,sort_keys=True,separators=(',',':')))
finally:os.close(d)
