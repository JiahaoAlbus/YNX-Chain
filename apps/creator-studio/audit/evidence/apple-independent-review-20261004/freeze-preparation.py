import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,plistlib,urllib.request
root=pathlib.Path.cwd();out=root/'apps/creator-studio/audit/evidence/apple-independent-review-20261004';out.mkdir(parents=True,exist_ok=False)
head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip();assert head=='593c88ddb6bdf815ed76e95aabb1c2287ae2f1b4'
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def copy(p,name):
 p=pathlib.Path(p);dest=out/name;shutil.copyfile(p,dest);return pin(dest)
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,b,mode in values:
     item=tarfile.TarInfo(name);item.size=len(b);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(b))
 with tarfile.open(path) as tar:
  for item,(name,b,mode) in zip(tar.getmembers(),values):assert item.name==name and tar.extractfile(item).read()==b
 return {**pin(path),'fileCount':len(values),'everyMemberVerified':True}
previous=json.loads((root/'apps/music/audit/android-upload-recovery-checkpoint-20261004.json').read_bytes())
with tarfile.open(root/previous['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
changed=subprocess.check_output(['git','diff','--name-only',previous['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines()
for name in changed:
 if '/audit/' not in name and '/evidence/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 b=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==b
 mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0]
 values.append((name,b,0o755 if mode=='100755' else 0o644))
source=archive(out/'media-owned-source-593c88dd.tar.gz',values);source['everyMemberGitByteExact']=True
builddir=pathlib.Path('/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-creator-apple-native-n0OMep')
build=json.loads((builddir/'build-receipt.json').read_bytes());assert build['sourceCommit']==head
for p in build['sourcePins']:exact(p)
candidates=[]
pixel=root/'apps/music/audit/evidence/apple-full-native-build-r2-20261004/compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift')
pixelbin='/tmp/ynx-creator-apple-brand-pixel-check';subprocess.run(['xcrun','swiftc',str(pixel),'-o',pixelbin],check=True)
for c in build['candidates']:
 app=pathlib.Path(c['app']);resource=app if c['sdk']=='iphonesimulator' else app/'Contents/Resources'
 info=plistlib.loads((app/'Info.plist' if c['sdk']=='iphonesimulator' else app/'Contents/Info.plist').read_bytes());assert info['CFBundleIdentifier']=='com.ynxweb4.creator-studio';assert info['CFBundleURLTypes'][0]['CFBundleURLSchemes']==['ynxcreator']
 for name in ['source.json','client.mjs','index.html','media-native-consumer.mjs','wallet-auth-native-consumer.mjs','registry.json']:
  assert (resource/'native-session'/name).read_bytes()==(root/'apps/creator-studio/ios/YNXCreator/native-session'/name).read_bytes()
 (out/(c['scheme']+'-brand-pixels.txt')).write_bytes(subprocess.check_output([pixelbin,str(root/'apps/creator-studio/assets/ynx-brand-original.png'),str(resource/'ynx-brand-original.png')]))
 members=[]
 for p in c['files']:
  file=app/p['path'];b=file.read_bytes();assert len(b)==p['bytes'] and sha(b)==p['sha256'];members.append((app.name+'/'+p['path'],b,file.stat().st_mode&0o777))
 bundle=archive(out/(c['scheme']+'-593c88dd-unsigned.tar.gz'),members)
 candidates.append({**bundle,'scheme':c['scheme'],'sdk':c['sdk'],'applicationId':info['CFBundleIdentifier'],'callback':'ynxcreator://wallet-auth/callback','signed':False,'installed':False,'launched':False,'allOriginalNativeAssetsExact':True,'originalBrandPixelsExact':True})
 copy(c['log'],c['scheme']+'-full-build.txt')
copy(builddir/'build-receipt.json','full-native-build-receipt.json')
compose=pathlib.Path('/tmp/ynx-media-creator-review-go-full-final-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for name in ['actualAppleCreatorSwiftWebKitEngine','actualAppleMusicSwiftWebKitEngine','actualAppleSwiftWebKitEngine','actualOriginalJavaMusicUpload','actualProtectedBrowserOriginalMusicBusiness','actualProtectedBrowserOriginalVideoCreatorBusiness']:assert receipt[name],name
owned=[p for p in receipt['inputPins'] if p['owner'].startswith('Media')]
for p in owned:exact(p)
for name in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[name]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=447 and failed==0
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
for file,name in [('/tmp/ynx-creator-review-engine-r2-20261004/apple-engine-check.json','actual-swift-compiled-source.json'),('/tmp/ynx-creator-review-engine-compile-r2-20261004.txt','actual-swift-compile.txt'),('/tmp/ynx-creator-apple-state-check-r1-20261004.txt','protected-state-checks.txt'),('/tmp/ynx-creator-apple-typecheck-r3-20261004.txt','initial-full-swift-typecheck.txt'),('/tmp/ynx-creator-apple-go-focused-r2-20261004/combined-go-race.jsonl','stale-draft-controller-failed.jsonl'),('/tmp/ynx-creator-apple-go-focused-r3-20261004/combined-go-race.jsonl','stale-draft-controller-diagnosis.jsonl'),('/tmp/ynx-creator-apple-go-focused-r4-20261004/combined-go-race.jsonl','focused-native-business-passed.jsonl'),('/tmp/ynx-creator-apple-typecheck-20261004.txt','first-controller-typecheck-failed.txt'),('/tmp/ynx-creator-apple-typecheck-r2-20261004.txt','first-view-typecheck-failed.txt'),('/tmp/ynx-creator-apple-engine-compile-r1-20261004.txt','first-fixture-compile-failed.txt'),('/tmp/ynx-creator-apple-engine-compile-r2-20261004.txt','fixture-whitespace-compile-failed.txt')]:copy(file,name)
for directory,name in [('/tmp/ynx-creator-review-go-focused-r1-20261004','first-address-only-alias-admission-failed.jsonl'),('/tmp/ynx-creator-review-go-focused-r2-20261004','public-projection-reviewer-check-failed.jsonl'),('/tmp/ynx-creator-review-go-focused-r3-20261004','two-actor-independent-review-focused-passed.jsonl')]:copy(pathlib.Path(directory)/'combined-go-race.jsonl',name)
public=[]
for url,name in [('https://video.ynxweb4.com/video/runtime-manifest.json','video-manifest-public.json'),('https://creator.ynxweb4.com/creator-studio.manifest.json','creator-manifest-public.json'),('https://video.ynxweb4.com/video/api/health','video-health-public.json')]:
 try:
  with urllib.request.urlopen(url,timeout=20) as response:body=response.read(262145);status=response.status
  assert len(body)<=262144;file=out/name;file.write_bytes(body);j=json.loads(body)
  public.append({'url':url,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authenticated':False,'status':status,'sourceCommit':j.get('sourceCommit',j.get('source',{}).get('commit')),'centralDeploymentVerified':j.get('centralDeploymentVerified'),'body':pin(file)})
 except Exception as e:public.append({'url':url,'error':type(e).__name__,'verified':False})
copy('/tmp/freeze-creator-independent-review-20261004.py','freeze-preparation.py')
freeze={'schema':'ynx.creator.apple.independent-review.freeze.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'sourceTree':tree,'sourceArchive':source,'candidates':candidates,'buildSourcePinsGitExact':len(build['sourcePins']),'compositionInputPins':len(receipt['inputPins']),'ownedCompositionPinsGitExact':len(owned),'checks':{'fullIOSSimulatorAndMacOSBuild':'PASS','originalCreatorIdentityAndCallback':'PASS','originalSDKAndRegistryPackagedGitExact':True,'originalBrandPixels':True,'actualOriginalCreatorSwiftWebKitSDKGo':'PASS all original upload/identity recovery and two distinct SDK/Swift device keys and actors; named invite/accept, owner self-review denied, independent original rights/publication review, schedule not-due veto, committed publish-due lost reply, cold legacy pending POST same-key replay with no new version, signed reviewer/public record readback, original team revoke 403, moderator sign-out preserves owner authority','originalProtectedStateIOSAndMacOSTuples':'PASS injected storage and generated key','goRacePassEvents':passed,'goRaceFailEvents':failed,'goVet':'PASS','actualWalletConsent':False,'actualOSKeychain':False,'actualIOSRuntime':False,'actualRenderedNativeUI':False,'formalPublicPair':False},'remaining':['A formal original Host/currentActor + matching client deployment and public real-user readback','Real Wallet/iOS/macOS Keychain, installed UI/file-picker/large-media/codec acceptance','Real independent Wallet moderator approval and public publication/monetization/payout-provider/payment receipt acceptance; isolated original-service review passes only','Creator Apple assets/AI/dispute native parity; team/review/schedule source and isolated original business now pass; inherited Creator Web retained','New native texts fully English/zh-CN; ten other locales retain translated navigation with English fallback and need native workflow translations'],'inheritedAndroidMusicCheckpoint':pin(root/'apps/music/audit/android-upload-recovery-checkpoint-20261004.json'),'inheritedCreatorUploadCheckpoint':pin(root/'apps/creator-studio/audit/apple-native-upload-checkpoint-20261004.json'),'QAAdmission':{'ownerSample':'original SDK5c secp256k1 seed 1','independentModeratorSample':'original SDK5c secp256k1 seed 5','twoDistinctSwiftProcessesKeysAndCustody':True,'originalServerModeratorPolicy':'explicit isolated sample roster, not deployed policy','realRolePolicyAccepted':False},'publicReadback':public,'evidence':[pin(p) for p in sorted(out.iterdir()) if p.is_file()]}
file=root/'apps/creator-studio/audit/apple-independent-review-checkpoint-20261004.json';file.write_text(json.dumps(freeze,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'freeze':pin(file),'source':source,'candidates':candidates,'checks':freeze['checks'],'ownedPins':len(owned)}))
