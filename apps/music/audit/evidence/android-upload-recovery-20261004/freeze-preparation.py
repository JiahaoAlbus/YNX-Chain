import pathlib,json,subprocess,hashlib,tarfile,gzip,io,shutil,zipfile,datetime,urllib.request
root=pathlib.Path('/Users/huangjiahao/Desktop/YNX Audit Worktrees/20260906-video');out=root/'apps/music/audit/evidence/android-upload-recovery-20261004';out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=root)
head=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip()
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def copy(source,name):p=out/name;shutil.copyfile(source,p);return p
previous=json.loads((root/'apps/music/audit/apple-upload-recovery-checkpoint-20261004.json').read_text())
with tarfile.open(root/previous['sourceArchive']['path']) as t:names={m.name for m in t.getmembers() if m.isfile()}
allowed=('apps/video/','apps/creator-studio/','apps/music/','internal/video/','internal/music/')
for n in git('diff','--name-only',previous['sourceCommit'],head).decode().splitlines():
 if n.startswith(allowed) and '/audit/' not in n:names.add(n)
members={}
for n in names:
 b=git('show',head+':'+n);assert (root/n).read_bytes()==b;members[n]=b
archive=out/('media-owned-source-'+head[:8]+'.tar.gz')
with archive.open('xb') as f,gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as t:
 for n,b in sorted(members.items()):
  info=tarfile.TarInfo(n);info.size=len(b);info.mode=int(git('ls-tree',head,'--',n).decode().split()[0],8)&0o777;info.mtime=0;t.addfile(info,io.BytesIO(b))
with tarfile.open(archive) as t:assert {m.name:sha(t.extractfile(m).read()) for m in t.getmembers()}=={n:sha(b) for n,b in members.items()}
source=dict(pin(archive),fileCount=len(members),everyMemberGitByteExact=True,everyMemberVerified=True)
meta=json.loads(pathlib.Path('/tmp/ynx-music-android-upload-build-final3-20261004.txt').read_text());build=json.loads(pathlib.Path(meta['path']).read_text());assert build['sourceCommit']==head and build['sourceTree']==tree
for p in build['sourcePins']:assert p['gitExact'] and sha(git('show',head+':'+p['path']))==p['sha256']
apk=copy(build['apk']['path'],'ynx-music-android-'+head[:8]+'-debug.apk');assert sha(apk.read_bytes())==build['apk']['sha256']
copy(meta['path'],'full-android-build-receipt.json');copy(build['log'],'gradle-full-build-lint.txt')
for name in ('apk-signature.txt','apk-badging.txt'):copy(pathlib.Path(meta['out'])/name,name)
lint=copy(pathlib.Path(build['project'])/'app/build/reports/lint-results-debug.txt','android-lint.txt');assert '0 errors, 32 warnings' in lint.read_text()
with zipfile.ZipFile(apk) as z:
 for p in build['sourcePins']:
  if '/assets/native-session/' in p['path']:assert sha(z.read('assets/'+p['path'].split('/assets/')[1]))==p['sha256']
 brand=out/'compiled-original-brand.png';brand.write_bytes(z.read('res/drawable-nodpi-v4/ynx_brand_original.png'))
pixel=root/'apps/music/audit/evidence/apple-full-native-build-r2-20261004/compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift');pixelBin='/tmp/ynx-music-android-brand-pixel-check'
subprocess.run(['xcrun','swiftc',str(pixel),'-o',pixelBin],check=True)
(out/'android-brand-pixels.txt').write_bytes(subprocess.check_output([pixelBin,str(root/'apps/music/android/app/src/main/res/drawable-nodpi/ynx_brand_original.png'),str(brand)]))
qa=pathlib.Path('/tmp/ynx-media-android-music-upload-go-full3-20261004');receipt=json.loads((qa/'combined-source-receipt.json').read_text());assert all(r['exitCode']==0 for r in receipt['results']) and len(receipt['results'])==2
assert receipt['actualOriginalJavaMusicUpload'] and receipt['actualAppleMusicSwiftWebKitEngine'] and receipt['actualAppleSwiftWebKitEngine']
ownedPins=[]
for p in receipt['inputPins']:
 if p['path'].startswith(allowed):assert sha(git('show',head+':'+p['path']))==p['sha256'];ownedPins.append(p)
for name in ('javaMusicCompiledSource','appleCompiledSource','appleMusicCompiledSource'):
 for p in receipt[name]['sourcePins']:assert sha(git('show',head+':'+p['path']))==p['sha256']
events=[json.loads(l) for l in (qa/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert failed==0
for name in ('combined-source-receipt.json','combined-go-race.jsonl','combined-go-vet.txt'):copy(qa/name,name)
copy('/tmp/ynx-music-android-upload-store-final3-20261004.txt','actual-java-store-http-checks.txt');copy('/tmp/ynx-music-android-upload-compile-final3-20261004.txt','actual-java-compile.txt');copy('/tmp/ynx-music-android-upload-classes-final3-20261004.json','actual-java-compiled-source.json')
copy('/tmp/ynx-music-android-upload-compile-r1-20261004.txt','first-fixture-path-compilation-failure.txt');copy('/tmp/ynx-music-android-upload-store-final2-20261004.txt','withdrawal-selection-regression-failed.txt')
copy('/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-music-android-native-ESd7wt/gradle-build-lint.txt','first-full-ui-compile-failure.txt');copy('/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-music-android-native-SFpuOn/gradle-build-lint.txt','inherited-typeface-lint-failure.txt');copy('/tmp/ynx-media-android-music-upload-go-full2-20261004/combined-go-race.jsonl','withdrawal-selection-original-business-failed.jsonl')
public=[]
for label,url in [('video-manifest','https://video.ynxweb4.com/video/runtime-manifest.json'),('creator-manifest','https://creator.ynxweb4.com/creator-studio.manifest.json'),('video-health','https://video.ynxweb4.com/video/api/health')]:
 item={'url':url,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'GET','authenticated':False}
 try:
  with urllib.request.urlopen(url,timeout=20) as r:b=r.read();item['status']=r.status
  p=out/(label+'-public-readback.json');p.write_bytes(b);item['body']=pin(p);v=json.loads(b);item['sourceCommit']=v.get('sourceCommit');item['centralDeploymentVerified']=v.get('centralDeploymentVerified')
 except Exception as e:item['error']=str(e)
 public.append(item)
(out/'public-readback-receipt.json').write_text(json.dumps(public,indent=2)+'\n')
copy('/tmp/freeze-music-android-upload-20261004.py','freeze-preparation.py')
freeze={'schema':'ynx.music.android.upload-recovery.freeze.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'sourceTree':tree,'sourceArchive':source,'androidCandidate':dict(pin(apk),applicationId='com.ynxweb4.music',debugSigned=True,releaseSigned=False,installed=False,launched=False),'androidCompiledSourcePinsGitExact':len(build['sourcePins']),'javaCompiledSourcePinsGitExact':len(receipt['javaMusicCompiledSource']['sourcePins']),'compositionInputPins':len(receipt['inputPins']),'ownedCompositionPinsGitExact':len(ownedPins),'checks':{'fullAndroidGradleBuild':'PASS','fullAndroidLint':'PASS 0 errors, 32 warnings retained','APKDebugSignature':'PASS','originalSDKAndRegistryPackagedGitExact':True,'compiledOriginalBrandPixels':True,'actualJavaControllerOriginalPackagedSDKGoBusiness':'PASS lost reply, cold SDK restore, same intent one track, original owner/audio readback','originalSameAccountSignedAudioDownloadCache':'PASS','explicitDraftCancelRetainsLocalAndServerAudio':'PASS','unconfirmedDetachHidesPrivateCache':'PASS injected preferences','damagedOriginalStateRetainedBeforeReplacement':'PASS; unpreserved oversized original remains held','goRacePassEvents':passed,'goRaceFailEvents':failed,'goVet':'PASS','actualAndroidWebViewOrJNI':False,'actualOSKeyStore':False,'actualAPI28DeviceRuntime':False,'actualRenderedNativeUI':False,'actualWalletConsent':False,'formalPublicPair':False},'changes':['Normal Android original creator picker stages bounded original audio and durable operation under verified same-account directory; retry uses fresh original SDK proof and same upload key','Actual original Java controller/API/store plus pinned packaged Native SDK and original Go service prove lost upload reply, cold original SDK restore, one original track and verified owned audio cache; isolated JVM/protected adapters only','SDK restore/account readback must precede cache presentation; native withdrawal/expiry clears private UI and stops original playback; failed local preference commits remain locally withdrawn','Missing legacy ciphertext does not block independently verified native-v2 requests; forbidden business responses retain otherwise valid original session; unauthorized responses retire it','Atomic account-scoped draft state updates preserve other private library data; explicit cancel retains original audio; scoped private-data clear includes own draft files','Original minSdk28 collection and bounded streaming primitives replace API30/33 calls; inherited equivalent Typeface constants repaired; original device key aliases/metadata/callback and content retained'],'remaining':['Actual installed Android WebView/JNI/KeyStore, real Wallet consent, API28/device UI/codec acceptance','32 Android lint warnings retained; formal release signing and user acceptance','Creator Apple complete own native app and upload/publish/revenue flows','A original formal Host/currentActor matching client deployment and public normal-user business readback'],'publicReadback':public,'inheritedAppleCheckpoint':pin(root/'apps/music/audit/apple-upload-recovery-checkpoint-20261004.json'),'evidence':[pin(p) for p in sorted(out.iterdir()) if p.is_file()]}
p=root/'apps/music/audit/android-upload-recovery-checkpoint-20261004.json';p.write_text(json.dumps(freeze,indent=2)+'\n');print(json.dumps({'freeze':pin(p),'source':source,'apk':freeze['androidCandidate'],'checks':freeze['checks'],'ownedPins':len(ownedPins)}))
