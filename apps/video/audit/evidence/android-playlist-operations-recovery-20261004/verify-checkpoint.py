import pathlib,json,hashlib,subprocess,tarfile
root=pathlib.Path.cwd();f=json.loads((root/'apps/video/audit/android-playlist-operations-recovery-checkpoint-20261004.json').read_bytes());source=f['sourceCommit'];sha=lambda b:hashlib.sha256(b).hexdigest();refs=0
for pin in f['evidence']+[f['inheritedCheckpoint'],f['sourceArchive'],f['androidCandidate'],f['androidBuildReceipt'],f['unchangedWebRuntime']]+[x['receipt'] for x in f['unchangedNativeBuildPins']]:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path'];refs+=1
assert subprocess.check_output(['git','rev-parse',source+'^{tree}']).decode().strip()==f['sourceTree']
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 names=set()
 for m in tar:
  assert m.isfile() and m.name not in names and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts;names.add(m.name);b=tar.extractfile(m).read();assert b==subprocess.check_output(['git','show',source+':'+m.name]);mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644)
 assert len(names)==f['sourceArchive']['fileCount']
base=root/'apps/video/audit/evidence/android-playlist-operations-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['inputPins'])==f['checks']['compositionInputs'] and all(x['exitCode']==0 for x in r['results'])
def exact(pin):
 b=subprocess.check_output(['git','show',source+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path']
for pin in r['inputPins']:
 if pin['owner'].startswith('Media'):exact(pin)
for key in ['appleCompiledSource','appleCreatorCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for pin in r[key]['sourcePins']:exact(pin)
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];assert sum(e.get('Action')=='pass' for e in events)==f['checks']['fullGoRacePassEvents'];assert not any(e.get('Action')=='fail' for e in events)
assert any(e.get('Action')=='pass' and e.get('Test')=='TestVideoCreatorProtectedBrowserAndOriginalBusiness/video' for e in events)
for entry in f['unchangedNativeBuildPins']:
 build=json.loads((root/entry['receipt']['path']).read_bytes());assert entry['platform']=='apple' and entry['recompiledThisBatch']==False
 for pin in build['sourcePins']:exact(pin)
build=json.loads((root/f['androidBuildReceipt']['path']).read_bytes());assert build['sourceCommit']==source and build['sourceTree']==f['sourceTree'];assert build['lint']=='PASS full lintDebug';assert len(build['sourcePins'])==f['checks']['androidSourcePins'];assert not build['apk']['installed'] and not build['apk']['launched'] and not build['apk']['releaseSigned']
for pin in build['sourcePins']:exact(pin)
apk=root/f['androidCandidate']['path'];assert f['androidCandidate']['bytes']==build['apk']['bytes'] and f['androidCandidate']['sha256']==build['apk']['sha256']
for pin in build['sourcePins']:
 if '/assets/native-session/' in pin['path'] or pin['path']=='apps/video/i18n/catalog.json':
  name='assets/catalog.json' if pin['path'].endswith('catalog.json') else 'assets/'+pin['path'].split('/assets/')[1];b=subprocess.check_output(['unzip','-p',str(apk),name]);assert sha(b)==pin['sha256']
with tarfile.open(root/f['unchangedWebRuntime']['path']) as tar:
 members=list(tar);assert len({m.name for m in members})==len(members);assert all(not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts and (m.isfile() or m.isdir()) for m in members)
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==f['unchangedWebRuntimeSourceCommit']
 for name,pin in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
host=json.loads((base/'java-host-receipt.json').read_bytes());assert host['sourceCommit']==source and host['JUnitTests']==12 and host['actualJavaVideoSDK']==False
for pin in host['sourcePins']:exact(pin)
assert 'OK (12 tests)' in (base/'host-final.txt').read_text() and 'PASS original add/remove/delete' in (base/'host-final.txt').read_text();assert 'AssertionError: Retired or unavailable request accepted' in (base/'host-first-corrupt-constructor-assertion-failure.txt').read_text();assert 'i18n audit passed: 12 locales, 35 exact keys' in (base/'i18n-final.txt').read_text()
assert all(f['checks'][key]==False for key in ['actualWalletConsent','actualFormalHostCurrentActor','actualJavaVideoSDK','actualOSStorage','productionPublished','installed','launched']);assert f['checks']['earlierCreatorTimeoutCause']=='NOT_CONFIRMED'
print(json.dumps({'independentVerify':'PASS','sourceCommit':source,'deliveryCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'references':refs,'sourceArchiveMembers':len(names),'unchangedWebSourceFiles':len(manifest['files']),'newAndroidSourcePins':len(build['sourcePins']),'hostJavaPins':len(host['sourcePins']),'fullGoRacePassEvents':f['checks']['fullGoRacePassEvents'],'fullGoRaceFailures':0,'actualJavaVideoSDK':False,'productionPublished':False}))
