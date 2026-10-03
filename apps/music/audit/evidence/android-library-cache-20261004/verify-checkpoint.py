import json,subprocess,pathlib,hashlib,tarfile,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
f=json.loads(subprocess.check_output(['git','show',head+':apps/music/audit/android-library-cache-checkpoint-20261004.json']))
refs={}
def walk(x):
 if isinstance(x,dict):
  if all(k in x for k in ('path','bytes','sha256')) and x['path'].startswith('apps/'):refs[x['path']]=(x['bytes'],x['sha256'])
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
walk(f)
for path,(size,sha) in refs.items():
 b=subprocess.check_output(['git','show',head+':'+path]);assert len(b)==size and hashlib.sha256(b).hexdigest()==sha,path
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 members=[m for m in tar if m.isfile()];assert len(members)==f['sourceArchive']['fileCount']
 for m in members:assert tar.extractfile(m).read()==subprocess.check_output(['git','show',f['sourceCommit']+':'+m.name]),m.name
base=root/'apps/music/audit/evidence/android-library-cache-20261004'
receipt=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
def exact(p):
 b=subprocess.check_output(['git','show',f['sourceCommit']+':'+p['path']]);assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256'],p['path']
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
android=json.loads((base/'android-build-receipt.json').read_bytes());apple=json.loads((base/'inherited-apple-build-receipt.json').read_bytes())
assert android['sourceCommit']==f['sourceCommit'] and android['lint']=='PASS full lintDebug'
assert apple['sourceCommit']==f['appleCandidateSourceCommit']
for build in [android,apple]:
 for p in build['sourcePins']:exact(p)
assert f['androidCandidate']['bytes']==android['apk']['bytes'] and f['androidCandidate']['sha256']==android['apk']['sha256']
with zipfile.ZipFile(root/f['androidCandidate']['path']) as z:
 for p in android['sourcePins']:
  if '/assets/native-session/' in p['path']:
   b=z.read('assets/'+p['path'].split('/assets/')[1]);assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256']
pixelbin='/tmp/ynx-music-library-brand-independent-20261004';subprocess.run(['xcrun','swiftc',str(base/'compiled-brand-pixel-check.swift'),'-o',pixelbin],check=True)
for candidate in f['appleCandidates']:
 original=next(c for c in apple['candidates'] if c['scheme']==candidate['scheme'])
 with tarfile.open(root/candidate['path']) as tar:
  members=[m for m in tar if m.isfile()];assert len(members)==candidate['fileCount']==len(original['files'])
  for m in members:
   p=next(p for p in original['files'] if p['path']==m.name.split('/',1)[1]);b=tar.extractfile(m).read();assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256']
  brand=tar.extractfile(next(m for m in members if m.name.endswith('/ynx-brand-original.png'))).read()
 with tempfile.TemporaryDirectory(prefix='ynx-music-brand-check-') as tmp:
  raw=pathlib.Path(tmp)/'raw.png';built=pathlib.Path(tmp)/'built.png';raw.write_bytes(subprocess.check_output(['git','show',f['sourceCommit']+':apps/music/ios/YNXMusic/ynx-brand-original.png']));built.write_bytes(brand)
  assert subprocess.check_output([pixelbin,str(raw),str(built)])==(base/(candidate['scheme']+'-brand-pixels.txt')).read_bytes()
with tempfile.TemporaryDirectory(prefix='ynx-music-android-brand-check-') as tmp:
 raw=pathlib.Path(tmp)/'raw.png';built=pathlib.Path(tmp)/'built.png';raw.write_bytes(subprocess.check_output(['git','show',f['sourceCommit']+':apps/music/android/app/src/main/res/drawable-nodpi/ynx_brand_original.png']))
 with zipfile.ZipFile(root/f['androidCandidate']['path']) as z:built.write_bytes(z.read('res/drawable-nodpi-v4/ynx_brand_original.png'))
 assert subprocess.check_output([pixelbin,str(raw),str(built)])==(base/'android-brand-pixels.txt').read_bytes()
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')]
passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed==f['checks']['fullGoRacePassEvents'] and passed>=450 and failed==f['checks']['fullGoRaceFailures']==0
assert any(e.get('Test')=='TestMusicNativeConsumerAndOriginalBusiness/android' and e.get('Action')=='pass' for e in events)
p=root/'apps/music/audit/android-library-cache-checkpoint-20261004.json'
print(json.dumps(dict(deliveryCommit=head,tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip(),sourceCommit=f['sourceCommit'],verifiedGitReferences=len(refs),verifiedSourceArchiveMembers=f['sourceArchive']['fileCount'],fullPassEvents=passed,fullFailEvents=failed,freezeBytes=len(p.read_bytes()),freezeSHA256=hashlib.sha256(p.read_bytes()).hexdigest())))
