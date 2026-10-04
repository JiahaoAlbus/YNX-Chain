import pathlib,json,hashlib,subprocess,tarfile
root=pathlib.Path.cwd();f=json.loads((root/'apps/video/audit/playlist-operations-recovery-checkpoint-20261004.json').read_bytes());source=f['sourceCommit'];sha=lambda b:hashlib.sha256(b).hexdigest();refs=0
for pin in f['evidence']+[f['inheritedCheckpoint'],f['sourceArchive'],f['webRuntime']]+[x['receipt'] for x in f['unchangedNativeBuildPins']]:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path'];refs+=1
assert subprocess.check_output(['git','rev-parse',source+'^{tree}']).decode().strip()==f['sourceTree']
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 names=set()
 for m in tar:
  assert m.isfile() and m.name not in names and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts;names.add(m.name);b=tar.extractfile(m).read();assert b==subprocess.check_output(['git','show',source+':'+m.name]);mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644)
 assert len(names)==f['sourceArchive']['fileCount']
base=root/'apps/video/audit/evidence/playlist-operations-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['inputPins'])==f['checks']['compositionInputs'] and all(x['exitCode']==0 for x in r['results'])
def exact(pin):
 b=subprocess.check_output(['git','show',source+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path']
for pin in r['inputPins']:
 if pin['owner'].startswith('Media'):exact(pin)
for key in ['appleCompiledSource','appleCreatorCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for pin in r[key]['sourcePins']:exact(pin)
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];assert sum(e.get('Action')=='pass' for e in events)==f['checks']['fullGoRacePassEvents'];assert not any(e.get('Action')=='fail' for e in events)
assert any(e.get('Action')=='pass' and e.get('Test')=='TestVideoCreatorProtectedBrowserAndOriginalBusiness/video' for e in events)
for entry in f['unchangedNativeBuildPins']:
 build=json.loads((root/entry['receipt']['path']).read_bytes());assert entry['recompiledThisBatch']==False
 for pin in build['sourcePins']:exact(pin)
prior=json.loads((root/f['inheritedCheckpoint']['path']).read_bytes());nativePrior=json.loads((root/prior['inheritedCheckpoint']['path']).read_bytes())
for pin in [nativePrior['androidCandidate']]+nativePrior['appleUnsignedCandidates']:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256']
with tarfile.open(root/f['webRuntime']['path']) as tar:
 members=list(tar);namesWeb=[m.name for m in members];assert len(set(namesWeb))==len(namesWeb)
 assert all(m.name.startswith('runtime') and '..' not in pathlib.PurePosixPath(m.name).parts and (m.isfile() or m.isdir()) for m in members)
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==source
 for name,pin in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
 assert {'playlist-journal.js','playlist-recovery.js'}<=set(manifest['files'])
journal=json.loads((base/'chromium-indexeddb-22.txt').read_bytes());assert len(journal['passed'])==22 and journal['actualIndexedDB'] and journal['actualPrivateSDK']==False
for pin in journal['sourcePins']:exact(pin)
assert 'pass 171' in (base/'web-final-171.txt').read_text();assert 'source commit must be a lowercase 40-character SHA' in (base/'runtime-first-short-SHA-rejection.txt').read_text()
focus=json.loads((base/'focused-combined-source-receipt.json').read_bytes());assert all(row['exitCode']==0 for row in focus['results'])
for name in ['qa-video-web-remove-lost-success-390.png','qa-video-web-delete-lost-success-390.png','qa-video-web-original-playlists-complete-1440.png']:assert (base/name).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
assert all(f['checks'][key]==False for key in ['actualWalletConsent','actualFormalHostCurrentActor','productionPublished']);assert f['checks']['earlierCreatorTimeoutCause']=='NOT_CONFIRMED'
print(json.dumps({'independentVerify':'PASS','sourceCommit':source,'deliveryCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'references':refs,'sourceArchiveMembers':len(names),'webRuntimeSourceFiles':len(manifest['files']),'fullGoRacePassEvents':f['checks']['fullGoRacePassEvents'],'fullGoRaceFailures':0,'actualWalletConsent':False,'productionPublished':False}))
