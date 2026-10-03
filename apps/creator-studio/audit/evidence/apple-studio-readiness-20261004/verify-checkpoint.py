import json,subprocess,pathlib,hashlib,tarfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
f=json.loads(subprocess.check_output(['git','show',head+':apps/creator-studio/audit/apple-studio-readiness-checkpoint-20261004.json']))
refs={}
def walk(x):
 if isinstance(x,dict):
  if all(k in x for k in ('path','bytes','sha256')) and x['path'].startswith('apps/'):
   refs[x['path']]=(x['bytes'],x['sha256'])
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
walk(f)
for path,(size,sha) in refs.items():
 b=subprocess.check_output(['git','show',head+':'+path]);assert len(b)==size and hashlib.sha256(b).hexdigest()==sha,path
archive=root/f['sourceArchive']['path'];count=0
with tarfile.open(archive) as t:
 for m in t:
  assert m.isfile();b=t.extractfile(m).read();original=subprocess.check_output(['git','show',f['sourceCommit']+':'+m.name]);assert b==original,m.name;count+=1
assert count==f['sourceArchive']['fileCount']
buildpath=root/'apps/creator-studio/audit/evidence/apple-studio-readiness-20261004/full-native-build-receipt.json'
build=json.loads(buildpath.read_bytes());assert build['sourceCommit']==f['sourceCommit']
for p in build['sourcePins']:
 data=subprocess.check_output(['git','show',f['sourceCommit']+':'+p['path']]);assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256']
for candidate in f['candidates']:
 original=next(c for c in build['candidates'] if c['scheme']==candidate['scheme'])
 with tarfile.open(root/candidate['path']) as tar:
  members=[m for m in tar if m.isfile()];assert len(members)==len(original['files'])==candidate['fileCount']
  for member in members:
   p=next(p for p in original['files'] if p['path']==member.name.split('/',1)[1]);data=tar.extractfile(member).read();assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256']
assert f['checks']['fullGoRacePassEvents']>=447 and f['checks']['fullGoRaceFailures']==0
print(json.dumps({'deliveryCommit':head,'tree':subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip(),'sourceCommit':f['sourceCommit'],'verifiedGitReferences':len(refs),'verifiedSourceArchiveMembers':count,'freezeBytes':len((root/'apps/creator-studio/audit/apple-studio-readiness-checkpoint-20261004.json').read_bytes()),'freezeSHA256':hashlib.sha256((root/'apps/creator-studio/audit/apple-studio-readiness-checkpoint-20261004.json').read_bytes()).hexdigest()}))
