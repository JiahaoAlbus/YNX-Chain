import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,plistlib,urllib.request
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
compose=pathlib.Path('/tmp/ynx-media-music-ordered-snapshot-full-r4-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/native-ordered-snapshot-20261004';out.mkdir(parents=True,exist_ok=False)
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
builddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-ordered-snapshot-apple-build-r4-20261004.txt').read_text().splitlines()[-1])['out']);build=json.loads((builddir/'build-receipt.json').read_bytes());assert build['sourceCommit']==head and all(p['gitExact'] for p in build['sourcePins'])
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
androiddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-ordered-snapshot-android-build-r4-20261004.txt').read_text().splitlines()[-1])['out']);android=json.loads((androiddir/'build-receipt.json').read_bytes());assert android['sourceCommit']==head and android['lint']=='PASS full lintDebug'
for p in android['sourcePins']:exact(p)
apk=copy(android['apk']['path'],'YNXMusic-'+head[:8]+'-debug.apk');assert apk['bytes']==android['apk']['bytes'] and apk['sha256']==android['apk']['sha256'];apk.update(applicationId='com.ynxweb4.music',debugSigned=True,releaseSigned=False,installed=False,launched=False)
for p in android['sourcePins']:
 if '/assets/native-session/' in p['path']:
  data=subprocess.check_output(['unzip','-p',str(root/apk['path']),'assets/'+p['path'].split('/assets/')[1]]);assert len(data)==p['bytes'] and sha(data)==p['sha256']
for name in ['build-receipt.json','gradle-build-lint.txt','apk-signature.txt','apk-badging.txt']:copy(androiddir/name,'android-'+name)
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
for directory,label in [('/tmp/ynx-music-ordered-snapshot-focused-20261004','first-additional-test-playlists-rejected'),('/tmp/ynx-music-ordered-snapshot-focused-r2-20261004','same-original-playlist-edit-focused-pass'),('/tmp/ynx-music-ordered-snapshot-cache-focused-20261004','cache-commit-recovery-focused-pass')]:
 for name in ['combined-go-race.jsonl','combined-source-receipt.json']:copy(pathlib.Path(directory)/name,label+'-'+name)
for file,name in [('/tmp/ynx-music-ordered-snapshot-swift-r3-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-ordered-snapshot-swift-compile-r3-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-ordered-snapshot-java-r2-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-ordered-snapshot-java-compile-r2-20261004.txt','java-compile.txt')]:copy(file,name)
copy('/tmp/ynx-media-music-ordered-snapshot-full-r2-20261004/combined-go-race.jsonl','creator-original-rate-limit-429-failed.jsonl')
copy('/tmp/ynx-media-music-ordered-snapshot-full-r2-20261004/combined-source-receipt.json','creator-original-rate-limit-429-receipt.json')
copy('/tmp/ynx-creator-original-rate-paced-engine-20261004/apple-engine-check.json','creator-rate-paced-compiled-source.json')
copy('/tmp/ynx-creator-original-rate-paced-compile-20261004.txt','creator-rate-paced-compile.txt')
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:
 copy(pathlib.Path('/tmp/ynx-video-original-rate-key-recovery-focused-20261004')/name,'original-rate-key-recovery-focused-'+name)
copy('/tmp/ynx-music-ordered-snapshot-freeze-first-brand-byte-check-20261004.txt','first-freeze-brand-byte-check-rejected.txt')
copy(__file__,'prepare-checkpoint.py')
note='''Music same-account snapshot ordering and verified cache publication.

The first freeze attempt incorrectly required the compiled iOS PNG bytes to equal the source PNG. Xcode optimizes that resource; the unchanged source bytes remain Git-pinned and the final compiled resource is separately pinned. This evidence-only assertion failure is preserved. The inherited CoreGraphics/ImageIO checker now compares decoded dimensions and sRGB RGBA pixel hashes for each built candidate, independently repeated by the verifier; no brand asset or build flag was changed.

Confirmed source gaps: Apple refresh previously guarded only MusicSessionFence, and Android refresh only authGeneration. Concurrent reads under the same original binding could publish an earlier snapshot after a newer original read. Android merge swallowed cache-save errors; Apple saveLocal set retry on save failure but refresh immediately set ready. These are owned presentation/cache-publication gaps. No SDK/session/scopes/roles/timeouts changed.

Apple now guards success and error with a per-read generation, retired on withdraw. It builds a local state candidate preserving pending upload/playlist intents and verified audio markers, saves the original account candidate, then publishes snapshot/readiness. Android MainActivity refresh uses the actual MusicReadBoundary, serializes original profile validation, selected-store save and UI publication with retirement, and marks ready only after commit. It no longer swallows refresh cache failures.

Actual original Swift/SDK/Go journey holds a real earlier /api/me response, edits the same original playlist and reads the newer service record under the same binding. Releasing either the older success or older transport failure cannot change newer snapshot/name/ready status. Original empty-record counts remain separate from read failure. The isolated original Apple store directory is temporarily non-writable: a current signed playlist edit and original read occur, failed cache save preserves old displayed record and cannot claim ready, restoring its QA directory permission and normal original refresh recovers the original new name/binding. No user files are changed.

Actual Java API/SDK/Go/store plus the live Android publication boundary similarly commit a newer original playlist snapshot; the retired older callback cannot execute cache publication or replace ready state. Boundary retirement and failed commit are checked. MainActivity itself is full APK compiled/linted; installed Android UI/Looper/JNI/KeyStore execution is not claimed. Initial QA added extra playlists, violating the inherited exact-one-original-playlist journey. That failure is retained; final checks edit the same existing record and preserve the original count, without weakening the original gate.

The preceding complete batch failed on original Creator studio retry with actual businessRejected(429, rate limit exceeded), while original account/binding were verified. Original Server maxPerMinute=120 and UTC minute actor buckets remain unchanged. The complete journey can reach that fixed bucket differently depending on wall-clock minute crossings. This new failure is causally confirmed as original business rate limiting; historical initial restore failures still lack that exact HTTP evidence and remain unconfirmed. Creator QA alone counts actual original business sends and waits before preparing fresh proofs when less than 20 original requests remain in that UTC minute. SDK/Go timeouts/session duration and product rate policy are unchanged. Failed batch and receipt are retained.

The original admission 429 also exposed a persistent operation-key defect: the response was previously saved as complete, so later same-key/body retries could replay 429 forever. The owned server now preserves that original commitment as rate_limited, and recognizes the exact legacy complete/429 admission error for retry. Actor/method/path/body equality is checked before recovery; original authentication and fresh action proof gates still precede reservation. Completed successful replay and the production 120-request UTC-minute bucket are unchanged; Retry-After describes the admission window. The focused HTTP-service regression uses isolated StaticTokenAuth and budget one to force original rejection, verifies no comment side effect, rejects a changed body, restarts the actual service, recovers the same key/body once, and replays that success without duplication. Both new and legacy persisted formats pass. This focused durability case does not itself claim real SDK approval; the complete inherited original SDK/business batch is separately rerun against the final source. A must deploy this matching owned server together with clients.

Complete inherited original upload lost-reply/cold same-key, release, WAV byte/hash/cache, playback late-source veto, account mismatch and revocation checks remain. Wider Media capability/installed/native/Web user acceptance remains open. Historical Creator initial restore request failures remain unconfirmed; the inherited Creator readiness repair is retained. Formal Host/currentActor plus matching client deployment, real Wallet/OS custody/device/codec/real AI/Pay/user acceptance remain unverified.
'''
(out/'followup.md').write_text(note)
public=[]
for i,url in enumerate(['https://video.ynxweb4.com/video/runtime-manifest.json','https://creator.ynxweb4.com/creator-studio.manifest.json','https://video.ynxweb4.com/video/api/health']):
 record=dict(url=url,readAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),actualSignedBusiness=False)
 try:
  with urllib.request.urlopen(url,timeout=15) as response:
   data=response.read(262145);assert len(data)<=262144;record.update(status=response.status,response=json.loads(data))
 except Exception as error:record['error']=str(error)
 p=out/('public-readback-'+str(i)+'.json');p.write_text(json.dumps(record,indent=2)+'\n');public.append(pin(p))
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in candidates]}
checkpoint=dict(schema='ynx.music.native.ordered-snapshot.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,appleCandidates=candidates,androidCandidate=apk,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',fullAppleBuild='PASS',fullAndroidBuildAndLint='PASS',actualOriginalOrderedSwiftSnapshots=True,actualJavaBoundaryAndOriginalCachePublication=True,originalReadSameBinding=True,olderSuccessErrorRetired=True,failedCacheCommitNotReady=True,creatorOriginal429CauseCaptured=True,creatorQAOriginalRateLimitPacedNotWeakened=True,originalAdmissionKeyRecovery=True,legacyAdmission429KeyRecovery=True,rateRecoveryRejectsChangedBody=True,rateRecoverySingleOriginalEffect=True,focusedDurabilityUsesActualWalletConsent=False,originalIdentitySDKBrandPreserved=True,actualInstalledAndroidUILooper=False),inheritedCreatorReadinessCheckpoint=pin(inherited_path),remaining=inherited['remaining'],publicReadback=public,evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/native-ordered-snapshot-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,appleCandidates=candidates,androidCandidate=apk,passEvents=passed)))
