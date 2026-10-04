import pathlib,json,hashlib,subprocess,tarfile
root=pathlib.Path.cwd();f=json.loads((root/'apps/video/audit/original-java-playlist-recovery-checkpoint-20261004.json').read_bytes());source=f['sourceCommit'];sha=lambda b:hashlib.sha256(b).hexdigest();refs=0
for pin in f['evidence']+[f['inheritedCheckpoint'],f['sourceArchive'],f['javaCompiledClasses'],f['javaBuildReceipt'],f['javaDependency'],f['unchangedAndroidCandidate'],f['unchangedWebRuntime']]+[x['receipt'] for x in f['unchangedNativeBuildPins']]:
 b=(root/pin['path']).read_bytes();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path'];refs+=1
assert subprocess.check_output(['git','rev-parse',source+'^{tree}']).decode().strip()==f['sourceTree']
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 names=set()
 for m in tar:
  assert m.isfile() and m.name not in names and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts;names.add(m.name);b=tar.extractfile(m).read();assert b==subprocess.check_output(['git','show',source+':'+m.name]);mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644)
 assert len(names)==f['sourceArchive']['fileCount']
base=root/'apps/video/audit/evidence/original-java-playlist-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['inputPins'])==f['checks']['compositionInputs'] and all(x['exitCode']==0 for x in r['results']) and r['actualOriginalJavaVideoPlaylists']
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
 if entry['platform']=='android':assert build['apk']['sha256']==f['unchangedAndroidCandidate']['sha256']
with tarfile.open(root/f['unchangedWebRuntime']['path']) as tar:
 members=list(tar);assert len({m.name for m in members})==len(members);assert all(not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts and (m.isfile() or m.isdir()) for m in members)
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==f['unchangedWebRuntimeSourceCommit']
 for name,pin in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==pin['bytes'] and sha(b)==pin['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
t=json.loads((base/'original-java-recovery-trace.json').read_bytes());assert t['actualOriginalSDKProof'] and t['actualShippedJavaPlaylistController'] and t['actualOriginalGoBusinessReadback'] and t['actualColdJVMOrdinaryFileRecovery'] and t['actualOriginalJavaEpochRetirement'];assert t['restores']==3 and t['completedMutationDispatches']==[1,1,1] and len(t['traces'])==6 and t['proofs']>=12 and t['proxyCalls']>=12
keys=set()
for i,action in enumerate(['add','remove','delete']):
 a,b=t['traces'][2*i:2*i+2];assert a['phase']=='stage' and b['phase']=='finish' and a['action']==action==b['action'] and a['pending']==b['original'] and a['originalJavaEpochRetired'] and b['pendingCleared'] and b['actualOriginalBusinessReadback'];assert a['pending']['key'] not in keys;keys.add(a['pending']['key']);assert b['ownListCount']==(1 if action=='delete' else 2)
 for row in [a,b]:assert len(row['ordinaryPins'])==1 and row['ordinaryPins'][0]['bytes']>0 and len(row['ordinaryPins'][0]['sha256'])==64
initial=json.loads((base/'initial-focused-combined-source-receipt.json').read_bytes());assert all(x['exitCode']==0 for x in initial['results']) and initial['actualOriginalJavaVideoPlaylists']
assert all(f['checks'][key]==False for key in ['actualWalletConsent','actualFormalHostCurrentActor','actualOSStorage','actualRenderedNativeUI','productionPublished','installed','launched']);assert f['checks']['earlierCreatorTimeoutCause']=='NOT_CONFIRMED'
print(json.dumps({'independentVerify':'PASS','sourceCommit':source,'deliveryCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'references':refs,'sourceArchiveMembers':len(names),'unchangedWebSourceFiles':len(manifest['files']),'actualOriginalJavaVideoSDK':True,'JavaCompiledSourcePins':len(java['sourcePins']),'JavaCompiledClassPins':len(java['classPins']),'separateJVMProcesses':len(t['traces']),'actualOriginalProofs':t['proofs'],'fullGoRacePassEvents':f['checks']['fullGoRacePassEvents'],'fullGoRaceFailures':0,'productionPublished':False}))
