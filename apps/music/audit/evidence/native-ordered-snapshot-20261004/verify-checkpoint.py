import json,subprocess,pathlib,hashlib,tarfile,tempfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
f=json.loads(subprocess.check_output(['git','show',head+':apps/music/audit/native-ordered-snapshot-checkpoint-20261004.json']))
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
base=root/'apps/music/audit/evidence/native-ordered-snapshot-20261004'
apple=json.loads((base/'apple-build-receipt.json').read_bytes());android=json.loads((base/'android-build-receipt.json').read_bytes())
for build in [apple,android]:
 assert build['sourceCommit']==f['sourceCommit']
 for p in build['sourcePins']:
  data=subprocess.check_output(['git','show',f['sourceCommit']+':'+p['path']]);assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256'],p['path']
pixelbin='/tmp/ynx-music-ordered-brand-independent-check-20261004'
subprocess.run(['xcrun','swiftc',str(base/'compiled-brand-pixel-check.swift'),'-o',pixelbin],check=True)
for candidate in f['appleCandidates']:
 original=next(c for c in apple['candidates'] if c['scheme']==candidate['scheme'])
 with tarfile.open(root/candidate['path']) as tar:
  members=[m for m in tar if m.isfile()];assert len(members)==candidate['fileCount']==len(original['files'])
  for member in members:
   p=next(p for p in original['files'] if p['path']==member.name.split('/',1)[1]);data=tar.extractfile(member).read();assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256']
 with tempfile.TemporaryDirectory(prefix='ynx-music-original-brand-') as tmp:
  original=pathlib.Path(tmp)/'original.png';built=pathlib.Path(tmp)/'built.png'
  original.write_bytes(subprocess.check_output(['git','show',f['sourceCommit']+':apps/music/ios/YNXMusic/ynx-brand-original.png']))
  with tarfile.open(root/candidate['path']) as t:
   m=next(m for m in t if m.name.endswith('/ynx-brand-original.png'));built.write_bytes(t.extractfile(m).read())
  result=subprocess.check_output([pixelbin,str(original),str(built)])
  assert result==(base/(candidate['scheme']+'-brand-pixels.txt')).read_bytes()
assert f['androidCandidate']['bytes']==android['apk']['bytes'] and f['androidCandidate']['sha256']==android['apk']['sha256']
for p in android['sourcePins']:
 if '/assets/native-session/' in p['path']:
  data=subprocess.check_output(['unzip','-p',str(root/f['androidCandidate']['path']),'assets/'+p['path'].split('/assets/')[1]]);assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256']
receipt=json.loads((base/'combined-source-receipt.json').read_bytes())
assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):
  data=subprocess.check_output(['git','show',f['sourceCommit']+':'+p['path']]);assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256'],p['path']
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:
  data=subprocess.check_output(['git','show',f['sourceCommit']+':'+p['path']]);assert len(data)==p['bytes'] and hashlib.sha256(data).hexdigest()==p['sha256'],p['path']
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')]
passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events)
assert passed==f['checks']['fullGoRacePassEvents'] and passed>=450 and failed==f['checks']['fullGoRaceFailures']==0
for case in ['TestAdmissionRateLimitKeepsOriginalWriteRecoverable/legacy-complete-false','TestAdmissionRateLimitKeepsOriginalWriteRecoverable/legacy-complete-true']:
 assert any(e.get('Action')=='pass' and e.get('Test')==case for e in events),case
print(json.dumps({'deliveryCommit':head,'tree':subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip(),'sourceCommit':f['sourceCommit'],'verifiedGitReferences':len(refs),'verifiedSourceArchiveMembers':count,'freezeBytes':len((root/'apps/music/audit/native-ordered-snapshot-checkpoint-20261004.json').read_bytes()),'freezeSHA256':hashlib.sha256((root/'apps/music/audit/native-ordered-snapshot-checkpoint-20261004.json').read_bytes()).hexdigest()}))
