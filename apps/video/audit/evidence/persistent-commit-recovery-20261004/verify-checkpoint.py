import pathlib,json,hashlib,subprocess,tarfile
root=pathlib.Path.cwd();f=json.loads((root/'apps/video/audit/persistent-commit-recovery-checkpoint-20261004.json').read_bytes());source=f['sourceCommit'];sha=lambda b:hashlib.sha256(b).hexdigest();refs=0
for pin in f['evidence']+[f['inheritedCheckpoint'],f['sourceArchive'],f['javaCompiledClasses'],f['javaBuildReceipt'],f['javaDependency'],f['androidCandidate'],f['unchangedWebRuntime']]+[f['androidBuildReceipt']]+f['originalRedEvidence']+[x['receipt'] for x in f['unchangedNativeBuildPins']]:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path'];refs+=1
assert subprocess.check_output(['git','rev-parse',source+'^{tree}']).decode().strip()==f['sourceTree']
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 names=set()
 for m in tar:
  assert m.isfile() and m.name not in names and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts;names.add(m.name);b=tar.extractfile(m).read();assert b==subprocess.check_output(['git','show',source+':'+m.name]);mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644)
 assert len(names)==f['sourceArchive']['fileCount']
base=root/'apps/video/audit/evidence/persistent-commit-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['inputPins'])==f['checks']['compositionInputs'] and all(x['exitCode']==0 for x in r['results']) and r['actualOriginalJavaVideoPlaylists']
def exact(pin):
 b=subprocess.check_output(['git','show',source+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path']
for pin in r['inputPins']:
 if pin['owner'].startswith('Media'):exact(pin)
for key in ['appleCompiledSource','appleCreatorCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource','javaVideoCompiledSource']:
 for pin in r[key]['sourcePins']:exact(pin)
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];assert sum(e.get('Action')=='pass' for e in events)==f['checks']['fullGoRacePassEvents'];assert not any(e.get('Action')=='fail' for e in events)
assert any(e.get('Action')=='pass' and e.get('Test')=='TestVideoCreatorNativeConsumerAndOriginalBusiness/video:android' for e in events)
java=json.loads((root/f['javaBuildReceipt']['path']).read_bytes());assert java==r['javaVideoCompiledSource'];assert len(java['sourcePins'])==f['checks']['javaVideoCompiledSourcePins'] and len(java['classPins'])==f['checks']['javaVideoCompiledClassPins']
with tarfile.open(root/f['javaCompiledClasses']['path']) as tar:
 expected={p['path']:p for p in java['classPins']};members=list(tar);assert len(members)==len(expected)==f['javaCompiledClasses']['classCount'] and len({m.name for m in members})==len(members)
 for m in members:
  assert m.isfile() and m.name in expected and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts;p=expected[m.name];b=tar.extractfile(m).read();assert len(b)==p['bytes'] and sha(b)==p['sha256']
assert f['javaDependency']['sha256']==java['jsonDependency']['sha256']=='3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed'
for entry in f['unchangedNativeBuildPins']:
 build=json.loads((root/entry['receipt']['path']).read_bytes());assert entry['recompiledThisBatch']==False and len(build['sourcePins'])==entry['sourcePins']
 for pin in build['sourcePins']:exact(pin)
 if entry['platform']=='android':assert build['apk']['sha256']==f['androidCandidate']['sha256']
build=json.loads((root/f['androidBuildReceipt']['path']).read_bytes());assert build['sourceCommit']==source and build['sourceTree']==f['sourceTree'] and build['lint']=='PASS full lintDebug';assert len(build['sourcePins'])==f['checks']['newAndroidSourcePins'];assert not build['apk']['installed'] and not build['apk']['launched'] and not build['apk']['releaseSigned'];assert build['apk']['sha256']==f['androidCandidate']['sha256']
for pin in build['sourcePins']:exact(pin)
for pin in build['sourcePins']:
 if '/assets/native-session/' in pin['path'] or pin['path']=='apps/video/i18n/catalog.json':
  name='assets/catalog.json' if pin['path'].endswith('catalog.json') else 'assets/'+pin['path'].split('/assets/')[1];b=subprocess.check_output(['unzip','-p',str(root/f['androidCandidate']['path']),name]);assert sha(b)==pin['sha256']
with tarfile.open(root/f['unchangedWebRuntime']['path']) as tar:
 members=list(tar);assert len({m.name for m in members})==len(members);assert all(not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts and (m.isfile() or m.isdir()) for m in members)
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==f['unchangedWebRuntimeSourceCommit']
 for name,pin in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
t=json.loads((base/'original-java-recovery-trace.json').read_bytes());assert t['actualOriginalSDKProof'] and t['actualShippedJavaPlaylistController'] and t['actualOriginalGoBusinessReadback'] and t['actualColdJVMOrdinaryFileRecovery'] and t['actualOriginalJavaEpochRetirement'];assert t['restores']==3 and t['completedMutationDispatches']==[1,1,1] and len(t['traces'])==7 and t['persistentFailedStorageAllMutationsBlocked'] and t['proofs']>=12 and t['proxyCalls']>=12
keys=set()
for i,action in enumerate(['add','remove','delete']):
 a,b=t['traces'][1+2*i:1+2*i+2];assert a['phase']=='stage' and b['phase']=='finish' and a['action']==action==b['action'] and a['pending']==b['original'] and a['originalJavaEpochRetired'] and b['pendingCleared'] and b['actualOriginalBusinessReadback'];assert a['pending']['key'] not in keys;keys.add(a['pending']['key']);assert b['ownListCount']==(1 if action=='delete' else 2)
 for row in [a,b]:assert len(row['ordinaryPins'])==1 and row['ordinaryPins'][0]['bytes']>0 and len(row['ordinaryPins'][0]['sha256'])==64
initial=json.loads((base/'initial-postfix-focused-combined-source-receipt.json').read_bytes());assert all(x['exitCode']==0 for x in initial['results']) and initial['actualOriginalJavaVideoPlaylists']
d=t['traces'][0];assert d['phase']=='durability'
for k in ['createRetriesBlocked','operationRetriesBlocked','cachedWatchReplayBlocked','originalBodiesAndKeysRetained','unconfirmedACKRetainsOriginals']:assert d[k]
redbase=root/'apps/video/audit/evidence/persistent-commit-red-20261004';red=next(json.loads(l) for l in (redbase/'original-three-path-red.txt').read_text().splitlines() if l.startswith('{"failures"'));assert red['failures']==3 and all(x['persistentCommitFailureMutationCount']==1 for x in red['sourceCounterexamples'])
original=json.loads((redbase/'original-source.json').read_bytes())
for p in original['sourcePins']:
 b=(root/p['saved']).read_bytes();assert len(b)==p['bytes'] and sha(b)==p['sha256'];assert b==subprocess.check_output(['git','show',original['sourceCommit']+':'+p['path']])
green=next(json.loads(l) for l in (base/'host-final.txt').read_text().splitlines() if l.startswith('{"failures"'));assert green['failures']==0 and len(green['sourceCounterexamples'])==5 and all(x['passed'] for x in green['sourceCounterexamples']);assert all(x['persistentCommitFailureMutationCount']==0 for x in green['sourceCounterexamples'][:3])
assert 'OK (12 tests)' in (base/'host-final.txt').read_text() and 'i18n audit passed: 12 locales, 35 exact keys' in (base/'i18n-final.txt').read_text();assert f['checks']['sourceReviewAdmission']=='PENDING' and f['checks']['originalSourceHoldP1Preserved']
assert all(f['checks'][key]==False for key in ['actualWalletConsent','actualFormalHostCurrentActor','actualOSStorage','actualRenderedNativeUI','productionPublished','installed','launched']);assert f['checks']['earlierCreatorTimeoutCause']=='NOT_CONFIRMED'
print(json.dumps({'independentVerify':'PASS','sourceCommit':source,'deliveryCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'references':refs,'sourceArchiveMembers':len(names),'unchangedWebSourceFiles':len(manifest['files']),'actualOriginalJavaVideoSDK':True,'JavaCompiledSourcePins':len(java['sourcePins']),'JavaCompiledClassPins':len(java['classPins']),'separateJVMProcesses':len(t['traces']),'actualOriginalProofs':t['proofs'],'fullGoRacePassEvents':f['checks']['fullGoRacePassEvents'],'fullGoRaceFailures':0,'productionPublished':False}))
