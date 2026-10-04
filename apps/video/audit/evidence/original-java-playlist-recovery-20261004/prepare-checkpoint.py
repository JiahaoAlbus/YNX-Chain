import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime
root=pathlib.Path.cwd();source=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();sha=lambda b:hashlib.sha256(b).hexdigest();out=root/'apps/video/audit/evidence/original-java-playlist-recovery-20261004'
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def exact(p):
 b=subprocess.check_output(['git','show',source+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-video-original-playlist-java-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert all(r['exitCode']==0 for r in receipt['results']) and receipt['actualOriginalJavaVideoPlaylists']
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource','javaVideoCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);assert passed>=450 and not any(e.get('Action')=='fail' for e in events)
priorpath=root/'apps/video/audit/android-playlist-operations-recovery-checkpoint-20261004.json';prior=json.loads(priorpath.read_bytes())
with tarfile.open(root/prior['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',prior['sourceCommit'],source,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',source+':'+name]);assert data==(root/name).read_bytes();mode=subprocess.check_output(['git','ls-tree',source,'--',name]).decode().split()[0];assert mode in ['100644','100755'];values.append((name,data,0o755 if mode=='100755' else 0o644))
out.mkdir(parents=True,exist_ok=False)
def archive(path,values):
 with path.open('xb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as tar:
  for name,data,mode in values:
   item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
sourceArchive=out/'media-owned-source.tar.gz';archive(sourceArchive,values)
def copy(src,name):
 p=out/name;shutil.copyfile(src,p);return pin(p)
with tarfile.open(root/prior['unchangedWebRuntime']['path']) as tar:
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'))
 for name,p in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==p['bytes'] and sha(b)==p['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
native=[]
for platform,p in [('android',prior['androidBuildReceipt'])]+[(entry['platform'],entry['receipt']) for entry in prior['unchangedNativeBuildPins']]:
 build=json.loads((root/p['path']).read_bytes())
 for v in build['sourcePins']:exact(v)
 native.append({'platform':platform,'receipt':p,'sourcePins':len(build['sourcePins']),'currentSourcePinsGitExact':True,'recompiledThisBatch':False})
classes=pathlib.Path('/tmp/ynx-video-original-playlist-java-r2-20261004');java=receipt['javaVideoCompiledSource'];classValues=[]
for p in java['classPins']:
 b=(classes/p['path']).read_bytes();assert len(b)==p['bytes'] and sha(b)==p['sha256'];classValues.append((p['path'],b,0o644))
classArchive=out/'java-compiled-classes.tar.gz';archive(classArchive,classValues);copy(str(classes)+'.json','java-build-receipt.json');dependency=copy(java['jsonDependency']['path'],'json-dependency.jar');assert dependency['sha256']==java['jsonDependency']['sha256']
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-video-original-playlist-java-focus-20261004')/name,'initial-focused-'+name)
for p in sorted(compose.glob('*.png')):copy(p,p.name)
trace=copy(compose/'qa-video-original-java-playlist-recovery.json','original-java-recovery-trace.json');r=json.loads((out/'original-java-recovery-trace.json').read_bytes());assert r['actualOriginalSDKProof'] and r['actualShippedJavaPlaylistController'] and r['actualOriginalGoBusinessReadback'] and r['actualColdJVMOrdinaryFileRecovery'] and r['actualOriginalJavaEpochRetirement'];assert r['completedMutationDispatches']==[1,1,1] and r['restores']==3 and len(r['traces'])==6
for i,action in enumerate(['add','remove','delete']):
 a,b=r['traces'][2*i:2*i+2];assert a['phase']=='stage' and b['phase']=='finish' and a['action']==action==b['action'] and a['pending']==b['original'] and a['originalJavaEpochRetired'] and b['pendingCleared'];assert b['ownListCount']==(1 if action=='delete' else 2)
for src,name in [('/tmp/ynx-video-original-playlist-java-compile-20261004.txt','initial-java-compile-output.txt'),('/tmp/ynx-video-original-playlist-java-compile-r2-20261004.txt','final-java-compile-output.txt')]:copy(src,name)
(out/'followup.md').write_text('The new shipped Android Video playlist recovery controller now executes with actual original packaged SDK proof generation and original protected Go business. The QA bridge forwards the original Java final method/path/body digest/byte count to the actual packaged Video consumer prepareRequest, then forwards the original proof headers and exact HTTP body to the original Go service. No fixture grant, actor substitution, bypass path or hard-coded proof is used. Normal production controller/API/viewer source is unchanged from the prior Android candidate. Isolated ordinary preferences are file-backed and atomically written; this is JVM software persistence, not Android SharedPreferences or OS custody.\n\nSix separate JVM processes stage and recover add/remove/delete. Each mutation really succeeds with original HTTP200 before the reply is made unreadable. The exact account-owned action/list/video/name/UUID survives actual SDK restore and a new process, original protected own-list readback confirms the requested state, and no second mutation is sent. Java old captured epoch rejects before network after SDK restore. The final original Go fixture retains its preexisting playlist; only the QA-added list is explicitly removed. Current protected identity is verified by actual SDK account readback before proofs. Three successful mutation dispatches are strictly one each. This proves controlled SDK/Java/Go integration, not current production Host binding, Wallet consent, physical device storage, installed rendering or codec acceptance.\n\nThe current full receipt validates all new source and compiled class/dependency pins before execution; Go requires the Java flags, three 1-count dispatches, final original own-list count and the original remaining SDK gates. Initial focused source90d7 passed. Final source adds only durable ordinary trace/count evidence; compiled driver pinned again. No test assertions or timeouts were relaxed, no new product build or release version is claimed. Unchanged Android31/Apple23 packaged-source pins and Web38 sources are rechecked against current Git. Full450 race gates and vet remain required. Earlier failed records and unexplained Creator timeout remain inherited. Actual OS, real Wallet, formal A Host/currentActor/matching clients, Music Trust final protected results and user acceptance remain open.\n')
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-video-original-java-playlists-20261004.py','verify-checkpoint.py')
remaining=[x for x in prior['remaining'] if x!='New Android Video controller actual protected Java SDK bridge and physical installed cold recovery still unverified']+['New Android controller physical installed cold recovery and real Wallet/OS remain unverified']
f={'schema':'ynx.video.original-java-playlist-recovery.checkpoint.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':source,'sourceTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip(),'inheritedCheckpoint':pin(priorpath),'sourceArchive':{**pin(sourceArchive),'fileCount':len(values)},'javaCompiledClasses':{**pin(classArchive),'classCount':len(classValues)},'javaBuildReceipt':pin(out/'java-build-receipt.json'),'javaDependency':dependency,'unchangedAndroidCandidate':prior['androidCandidate'],'unchangedWebRuntime':prior['unchangedWebRuntime'],'unchangedWebRuntimeSourceCommit':manifest['sourceCommit'],'unchangedNativeBuildPins':native,'checks':{'fullGoRacePassEvents':passed,'fullGoRaceFailures':0,'vet':'PASS','compositionInputs':len(receipt['inputPins']),'javaVideoCompiledSourcePins':len(java['sourcePins']),'javaVideoCompiledClassPins':len(java['classPins']),'actualOriginalJavaVideoSDK':True,'actualOriginalGoJavaReadback':True,'coldJVMProcesses':6,'ordinaryFilePersistence':True,'actualJavaOldEpochRetirement':True,'lostReplyMutationDispatches':[1,1,1],'finalOriginalOwnListCount':1,'actualOSStorage':False,'actualRenderedNativeUI':False,'actualWalletConsent':False,'actualFormalHostCurrentActor':False,'productionPublished':False,'installed':False,'launched':False,'earlierCreatorTimeoutCause':'NOT_CONFIRMED'},'remaining':remaining,'evidence':[pin(p) for p in sorted(out.iterdir()) if p.is_file()]}
p=root/'apps/video/audit/original-java-playlist-recovery-checkpoint-20261004.json';p.write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'checkpoint':pin(p),'sourceArchive':f['sourceArchive'],'javaClassArchive':f['javaCompiledClasses'],'fullPass':passed,'inputs':len(receipt['inputPins']),'JavaProofs':r['proofs'],'JavaProxyCalls':r['proxyCalls']}))
