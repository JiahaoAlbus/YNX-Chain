import pathlib,json,hashlib,subprocess,tarfile,zipfile
root=pathlib.Path.cwd();p=root/'apps/video/audit/playlist-pause-recovery-checkpoint-20261004.json';f=json.loads(p.read_bytes());sha=lambda b:hashlib.sha256(b).hexdigest();count=0
for pin in f['evidence']+[f['inheritedCheckpoint']]:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path'];count+=1
source=f['sourceCommit'];assert subprocess.check_output(['git','rev-parse',source+'^{tree}']).decode().strip()==f['sourceTree']
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 names=set()
 for m in tar:
  assert m.isfile() and m.name not in names and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts
  names.add(m.name);b=tar.extractfile(m).read();assert b==subprocess.check_output(['git','show',source+':'+m.name]);mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644)
 assert len(names)==f['sourceArchive']['fileCount']
base=root/'apps/video/audit/evidence/playlist-pause-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['inputPins'])==f['checks']['compositionInputs'] and all(x['exitCode']==0 for x in r['results'])
for pin in r['inputPins']:
 if pin['owner'].startswith('Media'):
  b=subprocess.check_output(['git','show',source+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256']
for key in ['appleCompiledSource','appleCreatorCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for pin in r[key]['sourcePins']:
  b=subprocess.check_output(['git','show',source+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256']
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];assert sum(e.get('Action')=='pass' for e in events)==f['checks']['fullGoRacePassEvents'];assert not any(e.get('Action')=='fail' for e in events)
for platform in ['android','apple']:
 build=json.loads((base/(platform+'-build-receipt.json')).read_bytes())
 for pin in build['sourcePins']:
  b=subprocess.check_output(['git','show',source+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256']
android=json.loads((base/'android-build-receipt.json').read_bytes());assert android['lint']=='PASS full lintDebug'
with zipfile.ZipFile(root/f['androidCandidate']['path']) as z:
 for pin in android['sourcePins']:
  if '/assets/native-session/' in pin['path']:assert sha(z.read('assets/'+pin['path'].split('/assets/')[1]))==pin['sha256']
 assert z.read('assets/catalog.json')==subprocess.check_output(['git','show',source+':apps/video/i18n/catalog.json'])
for candidate in f['appleUnsignedCandidates']:
 assert candidate['installed']==False and candidate['signed']==False
 with tarfile.open(root/candidate['path']) as tar:
  members={m.name:tar.extractfile(m).read() for m in tar if m.isfile()}
  build=json.loads((base/'apple-build-receipt.json').read_bytes());original=next(c for c in build['candidates'] if c['scheme']==candidate['scheme']);app=pathlib.Path(original['app']).name
  assert len(members)==len(original['files'])
  for pin in original['files']:assert len(members[app+'/'+pin['path']])==pin['bytes'] and sha(members[app+'/'+pin['path']])==pin['sha256']
  for name,b in members.items():
   route=name[len(app)+1:]
   if route.startswith('native-session/'):assert b==subprocess.check_output(['git','show',source+':apps/video/ios/YNXVideo/'+route])
   if route=='catalog.json':assert b==subprocess.check_output(['git','show',source+':apps/video/i18n/catalog.json'])
assert (base/'original-discard-baseline-source.swift').read_bytes()==subprocess.check_output(['git','show','5630898b989822449f5538580b20bf72ce0dce0d:apps/video/ios/YNXVideo/VideoViewerState.swift'])
assert 'retained original request key: false' in (base/'original-discard-baseline-failure.txt').read_text()
assert 'pass 171' in (base/'video-web-check.txt').read_text()
assert 'OK (12 tests)' in (base/'java-storage.txt').read_text();assert 'PASS' in (base/'apple-storage.txt').read_text();assert '12 locales, 35 exact keys' in (base/'i18n-passed.txt').read_text();assert 'native contract missing ynx_6423-1' in (base/'i18n-first-failed.txt').read_text();assert 'video-studio' in (base/'apple-builder-first-path-failed.txt').read_text()
assert all(f['checks'][k]==False for k in ['actualWalletConsent','actualInstalledNativeUI','actualCentralTrustAcceptance']);assert f['checks']['earlierCreatorTimeoutCause']=='NOT_CONFIRMED'
print(json.dumps({'independentVerify':'PASS','sourceCommit':source,'deliveryCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'references':count,'sourceArchiveMembers':len(names),'fullGoRacePassEvents':f['checks']['fullGoRacePassEvents'],'fullGoRaceFailures':0,'actualWalletConsent':False,'actualInstalledNativeUI':False}))
