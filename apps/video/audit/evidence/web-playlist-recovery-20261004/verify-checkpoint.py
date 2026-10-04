import pathlib,json,hashlib,subprocess,tarfile
root=pathlib.Path.cwd();p=root/'apps/video/audit/web-playlist-recovery-checkpoint-20261004.json';f=json.loads(p.read_bytes());source=f['sourceCommit'];sha=lambda b:hashlib.sha256(b).hexdigest();refs=0
for pin in f['evidence']+[f['inheritedCheckpoint']]+[x['receipt'] for x in f['unchangedNativeBuildPins']]:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path'];refs+=1
assert subprocess.check_output(['git','rev-parse',source+'^{tree}']).decode().strip()==f['sourceTree']
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 names=set()
 for m in tar:
  assert m.isfile() and m.name not in names and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts;names.add(m.name);b=tar.extractfile(m).read();assert b==subprocess.check_output(['git','show',source+':'+m.name]);mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644)
 assert len(names)==f['sourceArchive']['fileCount']
base=root/'apps/video/audit/evidence/web-playlist-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['inputPins'])==f['checks']['compositionInputs'] and all(x['exitCode']==0 for x in r['results'])
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
prior=json.loads((root/f['inheritedCheckpoint']['path']).read_bytes())
for pin in [prior['androidCandidate']]+prior['appleUnsignedCandidates']:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256']
with tarfile.open(root/f['webRuntime']['path']) as tar:
 members=list(tar);namesWeb=[m.name for m in members];assert len(set(namesWeb))==len(namesWeb)
 assert all(m.name.startswith('runtime') and '..' not in pathlib.PurePosixPath(m.name).parts and (m.isfile() or m.isdir()) for m in members)
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==source
 for name,pin in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
 assert {'playlist-journal.js','playlist-recovery.js'}<=set(manifest['files'])
journal=json.loads((base/'chromium-indexeddb-15.txt').read_bytes());assert len(journal['passed'])==15 and journal['actualIndexedDB'] and journal['actualPrivateSDK']==False
for pin in journal['sourcePins']:exact(pin)
assert 'PASS 144 actual browser visual states' in (base/'display-widths-final.txt').read_text()
assert 'pass 171' in (base/'web-final-171.txt').read_text();assert 'createPlaylistJournal is not defined' in (base/'web-first-navigation-fixture-failure.txt').read_text()
first=json.loads((base/'first-picker-assertion-failure-combined-source-receipt.json').read_bytes());assert first['results'][0]['exitCode']==1
firstEvents=[json.loads(l) for l in (base/'first-picker-assertion-failure-combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];assert any(e.get('Action')=='fail' and e.get('Test','').endswith('/video') for e in firstEvents);assert any('Original picker lost reply' in e.get('Output','') for e in firstEvents)
for name in ['qa-video-web-original-create-pending-390.png','qa-video-web-original-create-paused-successor-390.png','qa-video-web-picker-create-pending-390.png','qa-video-web-original-playlists-complete-1440.png']:assert (base/name).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
assert all(f['checks'][key]==False for key in ['actualWalletConsent','actualFormalHostCurrentActor','productionPublished']);assert f['checks']['earlierCreatorTimeoutCause']=='NOT_CONFIRMED'
print(json.dumps({'independentVerify':'PASS','sourceCommit':source,'deliveryCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'references':refs,'sourceArchiveMembers':len(names),'webRuntimeSourceFiles':len(manifest['files']),'fullGoRacePassEvents':f['checks']['fullGoRacePassEvents'],'fullGoRaceFailures':0,'actualWalletConsent':False,'productionPublished':False}))
