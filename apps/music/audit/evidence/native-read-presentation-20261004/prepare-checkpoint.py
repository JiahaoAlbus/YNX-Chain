import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,plistlib,urllib.request
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
compose=pathlib.Path('/tmp/ynx-music-read-presentation-focused-r2-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=6 and failed==0
out=root/'apps/music/audit/evidence/native-read-presentation-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/creator-studio/audit/apple-studio-readiness-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
with tarfile.open(root/inherited['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',inherited['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data;mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];values.append((name,data,0o755 if mode=='100755' else 0o644))
source=archive(out/('media-owned-source-'+head[:8]+'.tar.gz'),values);source['everyMemberGitByteExact']=True
builddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-read-presentation-apple-build-r2-20261004.txt').read_text().splitlines()[-1])['out']);build=json.loads((builddir/'build-receipt.json').read_bytes());assert build['sourceCommit']==head and all(p['gitExact'] for p in build['sourcePins'])
for p in build['sourcePins']:exact(p)
candidates=[]
pixel=root/'apps/music/audit/evidence/apple-full-native-build-r2-20261004/compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift')
pixelbin='/tmp/ynx-music-ordered-brand-pixel-check-20261004';subprocess.run(['xcrun','swiftc',str(pixel),'-o',pixelbin],check=True)
for c in build['candidates']:
 app=pathlib.Path(c['app']);resource=app if c['sdk']=='iphonesimulator' else app/'Contents/Resources';info=plistlib.loads((app/'Info.plist' if c['sdk']=='iphonesimulator' else app/'Contents/Info.plist').read_bytes());assert info['CFBundleIdentifier']=='com.ynxweb4.music';assert info['CFBundleURLTypes'][0]['CFBundleURLSchemes']==['ynxmusic']
 (out/(c['scheme']+'-brand-pixels.txt')).write_bytes(subprocess.check_output([pixelbin,str(root/'apps/music/ios/YNXMusic/ynx-brand-original.png'),str(resource/'ynx-brand-original.png')]))
 for name in ['source.json','client.mjs','index.html','media-native-consumer.mjs','wallet-auth-native-consumer.mjs','registry.json']:assert (resource/'native-session'/name).read_bytes()==(root/'apps/music/ios/YNXMusic/native-session'/name).read_bytes()
 values=[]
 for p in c['files']:
  file=app/p['path'];data=file.read_bytes();assert len(data)==p['bytes'] and sha(data)==p['sha256'];values.append((app.name+'/'+p['path'],data,file.stat().st_mode&0o777))
 candidates.append({**archive(out/(c['scheme']+'-'+head[:8]+'-unsigned.tar.gz'),values),'scheme':c['scheme'],'sdk':c['sdk'],'signed':False,'installed':False,'launched':False,'originalIdentitySDKExact':True,'originalBrandPixelsExact':True});copy(c['log'],c['scheme']+'-full-build.txt')
copy(builddir/'build-receipt.json','apple-build-receipt.json')
androiddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-read-presentation-android-build-r2-20261004.txt').read_text().splitlines()[-1])['out']);android=json.loads((androiddir/'build-receipt.json').read_bytes());assert android['sourceCommit']==head and android['lint']=='PASS full lintDebug'
for p in android['sourcePins']:exact(p)
apk=copy(android['apk']['path'],'YNXMusic-'+head[:8]+'-debug.apk');assert apk['bytes']==android['apk']['bytes'] and apk['sha256']==android['apk']['sha256'];apk.update(applicationId='com.ynxweb4.music',debugSigned=True,releaseSigned=False,installed=False,launched=False)
for p in android['sourcePins']:
 if '/assets/native-session/' in p['path']:
  data=subprocess.check_output(['unzip','-p',str(root/apk['path']),'assets/'+p['path'].split('/assets/')[1]]);assert len(data)==p['bytes'] and sha(data)==p['sha256']
for name in ['build-receipt.json','gradle-build-lint.txt','apk-signature.txt','apk-badging.txt']:copy(androiddir/name,'android-'+name)
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
for name in ['combined-go-race.jsonl','combined-source-receipt.json']:
 copy(pathlib.Path('/tmp/ynx-music-read-presentation-focused-20261004')/name,'first-SDK-phase-hold-QA-rejected-'+name)
for file,name in [('/tmp/ynx-music-read-presentation-swift-r2-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-read-presentation-swift-compile-r2-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-ordered-snapshot-java-r2-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-ordered-snapshot-java-compile-r2-20261004.txt','java-compile.txt')]:copy(file,name)
copy('/tmp/ynx-music-read-presentation-freeze-first-path-error-20261004.txt','first-freeze-inherited-path-error.txt')
copy(__file__,'prepare-checkpoint.py')
note='''Music current business read presentation successor.

The inherited e157 checkpoint retains the complete 450-pass/zero-failure/vet original SDK/Go batch and original rate-key recovery. This successor changes only four Music source/QA files. Its focused actual Swift SDK/Go and Java/packaged-Music original business regressions pass, with vet, alongside all three final-source native builds. No new full 450-pass run is claimed for this successor.

Confirmed UI gaps: Home/catalog and Library/playlists originally displayed empty states before a successful original account snapshot, including initial failure. Apple now publishes unread/loading/ready/failed separately, retains the exact committed MusicSessionContext, and displays original business data only while that committed context remains current. Withdrawal invalidates it. A subsequent same-context failed read retains the existing original cached snapshot and explicitly shows offline/retry. Home distinguishes an actual empty catalog from no search results. Library, Creator business counts/forms and Profile display similarly distinguish unavailable reads. Normal retry refreshes the existing binding, or invokes original restore when no binding exists; it does not approve a new session. Android renders unavailable-read notices before catalog/Library/Creator empty states, checks original session/native epoch/committed remote snapshot, and labels retained same-epoch data during loading/failure.

The actual original Apple SDK validates identity first; the QA transport then holds only the first original model snapshot response while the model is loading. Its real returned original response is dropped to force initial read failure without revoking the verified original binding. The model has no current snapshot and reports failed. Normal original refresh under the exact same account/binding succeeds with zero original playlists and reports ready/current-snapshot. Existing same-binding older success/error ordering, original cache-permission failure/recovery, upload cold same-key, original playlist editing, WAV hash/cache/playback retirement and account/revocation gates remain.

The first new QA attempt held the SDK's earlier identity-verification /api/me response instead of the model's business read and observed unread rather than loading. That exact failure is retained. The final holder is explicitly gated by actual model loading and leaves original SDK verification untouched. It does not inject identity, relax assertions or mutate business records. Native UI rendering/installed device/OS/Wallet consent remains unverified. Android activity is built and linted; this source gate is not an installed Looper/UI execution claim. No roles/scopes/SDK/timeouts/data formats or user files changed. Public evidence is inherited unchanged with its original read timestamp; it is not a new deployment check.
'''
(out/'followup.md').write_text(note)
inherited_music_path=root/'apps/music/audit/native-ordered-snapshot-checkpoint-20261004.json';inherited_music=json.loads(inherited_music_path.read_bytes());public=inherited_music['publicReadback']
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in candidates]}
checkpoint=dict(schema='ynx.music.native.read-presentation.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,appleCandidates=candidates,androidCandidate=apk,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(focusedGoRacePassEvents=passed,focusedGoRaceFailures=failed,goVet='PASS',fullAppleBuild='PASS',fullAndroidBuildAndLint='PASS',actualOriginalOrderedSwiftSnapshots=True,actualJavaBoundaryAndOriginalCachePublication=True,originalReadSameBinding=True,olderSuccessErrorRetired=True,failedCacheCommitNotReady=True,initialUnreadFailureDistinctFromSuccessfulEmpty=True,committedSnapshotContextMustRemainCurrent=True,originalIdentitySDKBrandPreserved=True,actualInstalledAndroidUILooper=False),inheritedCreatorReadinessCheckpoint=pin(inherited_path),inheritedMusic450PassCheckpoint=pin(inherited_music_path),remaining=inherited['remaining'],publicReadback=public,evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/native-read-presentation-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,appleCandidates=candidates,androidCandidate=apk,passEvents=passed)))
