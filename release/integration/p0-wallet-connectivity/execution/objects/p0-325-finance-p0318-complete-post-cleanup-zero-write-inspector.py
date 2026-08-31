#!/usr/bin/env python3
import hashlib,json,os,stat,subprocess,sys,urllib.error,urllib.request
PARENT="/opt/ynx/leases/finance"
SIBLINGS=[
{"name":"p0300-finance-phase3-20260824t210000z.executor.sh","tuple":"64770:4620810:0:0:700:1:20058:regular file","sha256":"fe124f17ead7120a7737efc104ce2f9ce6d14340f8be595bd85f9ffde1350682"},
{"name":"p0300-finance-phase3-20260824t210000z.json","tuple":"64770:4620811:0:0:600:1:10685:regular file","sha256":"8433c91ac315743cd577c549231cc683b2a38b5a6e9918bb2d8123d6158c8506"},
{"name":"p0302-finance-phase3-20260823t211500z.executor.sh","tuple":"64770:4620861:0:0:700:1:25790:regular file","sha256":"a42d4a85c8ba98d55ea890e5978ccc14acd2a4aacb7931ebcbfc51daafdffe8c"},
{"name":"p0302-finance-phase3-20260823t211500z.json","tuple":"64770:4620862:0:0:600:1:11072:regular file","sha256":"512f129861c6ae5db100f467c4ed52ef3785b32fa3309daae21a21250a4322b0"}]
ABSENT=[
f"{PARENT}/finance-combined-4f7fba323a89-20260831t041500z.executor.sh",f"{PARENT}/finance-combined-4f7fba323a89-20260831t041500z.json",
f"{PARENT}/.p0322-finance-p0318-retained-control-cleanup-20260831t063800z.executor.owned",f"{PARENT}/.p0322-finance-p0318-retained-control-cleanup-20260831t063800z.signedLease.owned",
"/opt/ynx/stage/finance/finance-combined-4f7fba323a89-20260831t041500z-deploy","/opt/ynx/stage/finance/finance-combined-4f7fba323a89-20260831t041500z-deploy/stage",
"/var/backups/ynx-finance/finance-combined-4f7fba323a89-20260831t041500z","/var/backups/ynx-finance/finance-combined-4f7fba323a89-20260831t041500z/backup",
"/opt/ynx/releases/finance/finance-combined-4f7fba323a89-20260831t041500z","/opt/ynx/releases/finance/finance-combined-4f7fba323a89-20260831t041500z/ynx-finance-4f7fba323a89",
"/opt/ynx/finance-current.next","/opt/ynx/finance-current.rollback"]
def kind(m):
 if stat.S_ISREG(m):return"regular file"
 if stat.S_ISDIR(m):return"directory"
 if stat.S_ISLNK(m):return"symbolic link"
 return"other"
def tup(s):return f"{s.st_dev}:{s.st_ino}:{s.st_uid}:{s.st_gid}:{stat.S_IMODE(s.st_mode):o}:{s.st_nlink}:{s.st_size}:{kind(s.st_mode)}"
def stable(s):return f"{s.st_dev}:{s.st_ino}:{s.st_uid}:{s.st_gid}:{stat.S_IMODE(s.st_mode):o}:directory"
def sha(p):
 h=hashlib.sha256()
 with open(p,"rb")as f:
  while True:
   b=f.read(1048576)
   if not b:break
   h.update(b)
 return h.hexdigest()
def fact(p):
 try:s=os.lstat(p)
 except FileNotFoundError:return{"path":p,"classification":"absent"}
 r={"path":p,"classification":kind(s.st_mode),"tuple":tup(s)}
 if stat.S_ISREG(s.st_mode):r["sha256"]=sha(p)
 if stat.S_ISLNK(s.st_mode):r["target"]=os.readlink(p)
 return r
def inv(p):
 s=os.lstat(p);c=[]
 for n in sorted(os.listdir(p),key=os.fsencode):
  q=os.path.join(p,n);x=os.lstat(q);c.append({"name":n,"tuple":tup(x),"sha256":sha(q)if stat.S_ISREG(x.st_mode)else None})
 raw=json.dumps(c,separators=(",",":"),sort_keys=True).encode()
 return{"fullTuple":tup(s),"stableIdentity":stable(s),"directChildren":len(c),"inventorySha256":hashlib.sha256(raw).hexdigest(),"children":c}
def get(u):
 q=urllib.request.Request(u,headers={"User-Agent":"central-p0325-zero-write/1"})
 try:
  with urllib.request.urlopen(q,timeout=15)as r:b=r.read();s=r.status;t=r.headers.get("Content-Type","")
 except urllib.error.HTTPError as r:b=r.read();s=r.code;t=r.headers.get("Content-Type","")
 return{"url":u,"status":s,"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest(),"contentType":t}
def req(v,n):
 if not v:raise RuntimeError(n)
def main():
 absence={p:fact(p)for p in ABSENT};req(all(x["classification"]=="absent"for x in absence.values()),"LEASE_PATH_ABSENCE")
 parent=inv(PARENT);req(parent["stableIdentity"]=="64770:4594822:0:0:750:directory"and parent["directChildren"]==4 and parent["inventorySha256"]=="deb186c19791039c1074c279f667004250e78992fea703bcd513abff58604607"and parent["children"]==SIBLINGS,"PARENT_OR_SIBLINGS")
 carrier=inv("/opt/ynx/stage/finance/finance-combined-4f7fba323a89-20260831t041500z");req(carrier["fullTuple"]=="64770:4594824:0:0:700:2:4096:directory"and carrier["directChildren"]==2 and carrier["inventorySha256"]=="1a921cd16c549d3aa78d8b7a22c1f984597278e7a84cdb6946cba0bb73826f95","CARRIER")
 req(carrier["children"]==[{"name":"candidate.tgz","tuple":"64770:4594825:0:0:600:1:3938517:regular file","sha256":"55e8d98317eab27248644e6c1168e5ef9f72221a9708a8b80c0ee6502760147d"},{"name":"finance.env","tuple":"64770:4594832:0:986:640:1:1592:regular file","sha256":"06d54c7c930c1d9af7dad9cc4322bf23b9755b521101e18e3574be4ae83aaed7"}],"CARRIER_CHILDREN")
 runtime={"current":fact("/opt/ynx/finance-current"),"currentResolved":os.path.realpath("/opt/ynx/finance-current"),"binary":fact("/opt/ynx/finance-current/ynx-finance"),"environment":fact("/etc/ynx/finance.env"),"unit":fact("/etc/systemd/system/ynx-finance.service"),"caddy":fact("/etc/caddy/conf.d/ynx-finance.caddy"),"state":fact("/var/lib/ynx/finance/state.json")}
 req(runtime["current"]["tuple"]=="64770:1330149:0:0:777:1:50:symbolic link"and runtime["current"]["target"]=="/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a","CURRENT")
 req(runtime["binary"].get("sha256")=="0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f"and runtime["environment"].get("sha256")=="854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252"and runtime["unit"].get("sha256")=="2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b"and runtime["caddy"].get("sha256")=="dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282"and runtime["state"]["classification"]=="absent","RUNTIME")
 service={k:subprocess.check_output(["/usr/bin/systemctl","show","ynx-finance.service","-p",k,"--value"],text=True).strip()for k in["LoadState","ActiveState","SubState","MainPID","NRestarts","User","Group"]};req(service=={"LoadState":"loaded","ActiveState":"active","SubState":"running","MainPID":"2818779","NRestarts":"0","User":"ynx","Group":"ynx"},"SERVICE")
 urls=["http://127.0.0.1:6483/","http://127.0.0.1:6483/health","http://127.0.0.1:6483/version","https://finance.ynxweb4.com/","https://finance.ynxweb4.com/health","https://finance.ynxweb4.com/version","https://finance.ynxweb4.com/app.js","https://finance.ynxweb4.com/read-sources.js","https://finance.ynxweb4.com/styles.css","https://finance.ynxweb4.com/manifest.webmanifest","https://finance.ynxweb4.com/ynx-logo.png","https://finance.ynxweb4.com/wallet-auth.js","https://finance.ynxweb4.com/build-identity.json","https://finance.ynxweb4.com/wallet-connect.js"]
 expected=[(200,11427,"c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53"),(200,485,"d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1"),(200,130,"39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226"),(200,11427,"c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53"),(200,485,"d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1"),(200,130,"39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226"),(200,17371,"a1ed94de08fc5b73f075cf35c1b17481e24b6046732ad92d82209959b694c6d6"),(200,10920,"e19b7b266c14b181a4d88b10c6e1975398bdafb77660272f37ba22b48fc18c70"),(200,13935,"bd01b920fee3693204a63aed364c27becf4c9c84f3ee1ed9dd3e2d35a39b5d9f"),(200,241,"3f7bec35f54aad6a095151e9d4d553e7ea10cbbbcc9e16f0f3fe7abd242b6d05"),(200,104171,"df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d"),(200,66997,"be5c90e938e5d5b6e181199f2e1e3949b8f343c4e1af4d8aceab27b1ed41bf6d"),(404,19,"b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793"),(404,19,"b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793")]
 http=[get(u)for u in urls];req([(x["status"],x["bytes"],x["sha256"])for x in http]==expected,"HTTP")
 print(json.dumps({"inspection":"FINANCE_P0318_COMPLETE_POST_CLEANUP_ZERO_WRITE","absence":absence,"parent":parent,"carrier":carrier,"runtime":runtime,"service":service,"http":http,"verificationComplete":True,"cleanupComplete":True,"mutationCount":0},separators=(",",":"),sort_keys=True))
if __name__=="__main__":
 try:main()
 except Exception as e:print(f"p0325-zero-write-fail:{type(e).__name__}:{e}",file=sys.stderr);raise SystemExit(65)
