import pathlib,subprocess,json,hashlib,tarfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
path='apps/creator-studio/audit/apple-restore-repeat-checkpoint-20261004.json'
checkpoint=json.loads(subprocess.check_output(['git','show',head+':'+path]))
count=0
def verify(value):
 global count
 if isinstance(value,dict):
  if {'path','bytes','sha256'}<=value.keys() and value['path'].startswith('apps/'):
   data=subprocess.check_output(['git','show',head+':'+value['path']]);assert len(data)==value['bytes'] and hashlib.sha256(data).hexdigest()==value['sha256'],value['path'];assert (root/value['path']).read_bytes()==data;count+=1
  for child in value.values():verify(child)
 elif isinstance(value,list):
  for child in value:verify(child)
verify(checkpoint)
qa=checkpoint['qaSourceCommit'];production=checkpoint['productionSourceCommit']
for archive,commit in [(checkpoint['qaSourceArchive'],qa),(checkpoint['inheritedProductionSourceArchive'],production)]:
 with tarfile.open(root/archive['path']) as tar:
  members=[m for m in tar if m.isfile()];assert len(members)==archive['fileCount']
  for member in members:assert tar.extractfile(member).read()==subprocess.check_output(['git','show',commit+':'+member.name]),member.name
build=json.loads((root/checkpoint['inheritedBuildReceipt']['path']).read_bytes());assert build['sourceCommit']==production
for pin in build['sourcePins']:
 for commit in [production,qa]:
  data=subprocess.check_output(['git','show',commit+':'+pin['path']]);assert len(data)==pin['bytes'] and hashlib.sha256(data).hexdigest()==pin['sha256']
for candidate in checkpoint['inheritedCandidates']:
 match=next(c for c in build['candidates'] if c['scheme']==candidate['scheme'])
 with tarfile.open(root/candidate['path']) as tar:
  members=[m for m in tar if m.isfile()];assert len(members)==candidate['fileCount']==len(match['files'])
  for member in members:
   relative=member.name.split('/',1)[1];pin=next(p for p in match['files'] if p['path']==relative);data=tar.extractfile(member).read();assert len(data)==pin['bytes'] and hashlib.sha256(data).hexdigest()==pin['sha256']
changed=subprocess.check_output(['git','diff','--name-only',production,qa,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines();assert sorted(p for p in changed if '/audit/' not in p)==checkpoint['qaChangedPaths']
assert checkpoint['checks']['fullGoRacePassEvents']>=447 and checkpoint['checks']['fullGoRaceFailures']==0
print(json.dumps(dict(deliveryCommit=head,qaSourceCommit=qa,productionSourceCommit=production,referencePins=count,qaArchiveFiles=checkpoint['qaSourceArchive']['fileCount'],productionArchiveFiles=checkpoint['inheritedProductionSourceArchive']['fileCount'],unchangedProductionBuildPins=len(build['sourcePins']),candidateBytesVerified=True,productionUnchanged=True)))
