import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,plistlib,urllib.request
root=pathlib.Path.cwd();out=root/'apps/creator-studio/audit/evidence/apple-studio-readiness-20261004';out.mkdir(parents=True,exist_ok=False)
head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip()
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
source=archive(out/('media-owned-source-'+head[:8]+'.tar.gz'),values);source['everyMemberGitByteExact']=True
builddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-creator-studio-readiness-full-build-20261004.txt').read_text().splitlines()[-1])['out'])
build=json.loads((builddir/'build-receipt.json').read_bytes());assert build['sourceCommit']==head
for p in build['sourcePins']:exact(p)
candidates=[]
pixel=root/'apps/music/audit/evidence/apple-full-native-build-r2-20261004/compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift')
pixelbin='/tmp/ynx-creator-apple-brand-pixel-check';subprocess.run(['xcrun','swiftc',str(pixel),'-o',pixelbin],check=True)
for c in build['candidates']:
 app=pathlib.Path(c['app']);resource=app if c['sdk']=='iphonesimulator' else app/'Contents/Resources'
 assert (resource/'catalog.json').read_bytes()==(root/'apps/creator-studio/ios/YNXCreator/catalog.json').read_bytes()
 info=plistlib.loads((app/'Info.plist' if c['sdk']=='iphonesimulator' else app/'Contents/Info.plist').read_bytes());assert info['CFBundleIdentifier']=='com.ynxweb4.creator-studio';assert info['CFBundleURLTypes'][0]['CFBundleURLSchemes']==['ynxcreator']
 for name in ['source.json','client.mjs','index.html','media-native-consumer.mjs','wallet-auth-native-consumer.mjs','registry.json']:
  assert (resource/'native-session'/name).read_bytes()==(root/'apps/creator-studio/ios/YNXCreator/native-session'/name).read_bytes()
 (out/(c['scheme']+'-brand-pixels.txt')).write_bytes(subprocess.check_output([pixelbin,str(root/'apps/creator-studio/assets/ynx-brand-original.png'),str(resource/'ynx-brand-original.png')]))
 members=[]
 for p in c['files']:
  file=app/p['path'];b=file.read_bytes();assert len(b)==p['bytes'] and sha(b)==p['sha256'];members.append((app.name+'/'+p['path'],b,file.stat().st_mode&0o777))
 bundle=archive(out/(c['scheme']+'-'+head[:8]+'-unsigned.tar.gz'),members)
 candidates.append({**bundle,'scheme':c['scheme'],'sdk':c['sdk'],'applicationId':info['CFBundleIdentifier'],'callback':'ynxcreator://wallet-auth/callback','signed':False,'installed':False,'launched':False,'allOriginalNativeAssetsExact':True,'originalBrandPixelsExact':True})
 copy(c['log'],c['scheme']+'-full-build.txt')
copy(builddir/'build-receipt.json','full-native-build-receipt.json')
compose=pathlib.Path('/tmp/ynx-media-creator-studio-readiness-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for name in ['actualAppleCreatorSwiftWebKitEngine','actualAppleMusicSwiftWebKitEngine','actualAppleSwiftWebKitEngine','actualOriginalJavaMusicUpload','actualProtectedBrowserOriginalMusicBusiness','actualProtectedBrowserOriginalVideoCreatorBusiness']:assert receipt[name],name
owned=[p for p in receipt['inputPins'] if p['owner'].startswith('Media')]
for p in owned:exact(p)
for name in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[name]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=447 and failed==0
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
copy('/tmp/ynx-creator-studio-readiness-engine-r2-20261004/apple-engine-check.json','compiled-swift-source.json')
copy('/tmp/ynx-creator-studio-readiness-compile-r2-20261004.txt','compiled-swift-log.txt')
copy('/tmp/ynx-creator-studio-readiness-focused-20261004/combined-go-race.jsonl','original-readiness-focused-pass.jsonl')
copy('/tmp/ynx-creator-studio-readiness-focused-20261004/combined-source-receipt.json','original-readiness-focused-receipt.json')
copy('/tmp/ynx-creator-restore-diagnostic-three-20261004/combined-go-race.jsonl','prior-diagnostic-three-cancel-provider-race-failed.jsonl')
copy('/tmp/ynx-creator-restore-diagnostic-three-20261004/combined-source-receipt.json','prior-diagnostic-three-cancel-provider-race-receipt.json')
copy('/tmp/ynx-creator-restore-diagnostic-three-runner-20261004.py','prior-diagnostic-three-runner.py')
copy(__file__,'prepare-checkpoint.py')
inherited=json.loads((root/'apps/creator-studio/audit/apple-expiry-locales-checkpoint-20261004.json').read_bytes())
note='''Creator current-account studio readiness and retired-readback repair.

Confirmed owned source gap: CreatorModel.onChange marks connected after the SDK has verified the original /v1/account. auth then separately fetches /v1/studio. A failure of that second request previously kept connected true with nil snapshot; CreatorView displayed the ordinary empty-library state. This was a readiness/UI state gap, not evidence that the SDK connected contract also promises a studio snapshot. Neither historical first-restore request failure root cause is proved by later green repetitions.

Studio state is now unread/loading/ready/failed. Only validated current-account original /v1/studio data marks ready. A successfully read original empty library is ready; unread or failed is not represented as empty. Snapshot read generation and original model revision, engine identity and epoch guard publication. A changed binding clears the previous snapshot and retires tasks. Sign-out retires in-flight work immediately before original SDK revocation, clearing the screen; old success and old error cannot overwrite a current successor or signed-out state. No shared SDK/registry/Host, roles/scopes/timeouts or stored keys/files changed.

Actual original SDK/Swift/Go QA reads the original service response then deliberately loses that response, preserving verified original account/binding and failed unread state. Normal original signed refresh recovers the same record without new Wallet authorization. Real responses held during restore expose loading/not-ready; retiring that generation and restoring normally recovers the current account. Releasing the held old success or old transport error cannot change successor ready data/message. Sign-out supersedes a held real studio read; releasing it cannot repopulate private data. The initial original empty studio is separately asserted ready. Both Apple tuples retain ten wrong-account veto/original-record restorations and the entire upload/assets/rights/moderation/AI/finance journey.

The diagnostic three repetitions of the prior source encountered two explicit test-provider completion races: review_required arrived before cancellation instead of cancelled. Those failures/receipts are retained. The isolated test provider's second request now stays at its actual partial until the original service cancels its context, so the QA actually tests a running cancellation. Product provider timeout and original cancellation policy are unchanged. This does not erase or explain the historical initial restoration failures.

Unsigned iOS Simulator/macOS candidates are compiled source-exact. Actual Wallet consent, OS custody, installed UI/device/codec, real AI/Pay/moderation and user acceptance remain unverified. Formal public Host/currentActor plus matching client is still required; public legacy status is not original signed business proof. Media full goal remains open.
'''
(out/'followup.md').write_text(note)
public=[]
for i,url in enumerate(['https://video.ynxweb4.com/video/runtime-manifest.json','https://creator.ynxweb4.com/creator-studio.manifest.json','https://video.ynxweb4.com/video/api/health']):
 record=dict(url=url,readAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),actualSignedBusiness=False)
 try:
  with urllib.request.urlopen(url,timeout=15) as response:
   data=response.read(262145);assert len(data)<=262144;record.update(status=response.status,response=json.loads(data))
 except Exception as error:record['error']=str(error)
 file=out/('public-readback-'+str(i)+'.json');file.write_text(json.dumps(record,indent=2)+'\n');public.append(pin(file))
evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name!=pathlib.Path(source['path']).name and not any(p.name==pathlib.Path(c['path']).name for c in candidates)]
checkpoint=dict(schema='ynx.creator.apple.studio-readiness.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,candidates=candidates,buildSourcePinsGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',fullIOSSimulatorMacOSBuild='PASS',originalSDKAssetsAndBrandExact=True,studioReadinessSeparatedFromVerifiedAccount=True,originalEmptyReadDistinguishedFromUnread=True,lostOriginalStudioReplySameBindingRefreshRecovery=True,oldReadSuccessAndFailureCannotOverwriteCurrentSuccessor=True,signOutSupersedesOriginalReadNoPrivateReappearance=True,actualOriginalStudioReadinessAndCompleteNativeJourney=True,originalSDKProtocolScopesRolesTimeoutsUnchanged=True),inheritedRestoreQACheckpoint=pin(root/'apps/creator-studio/audit/apple-restore-repeat-checkpoint-20261004.json'),inheritedExpiryLocalesCheckpoint=pin(root/'apps/creator-studio/audit/apple-expiry-locales-checkpoint-20261004.json'),remaining=inherited['remaining'],publicReadback=public,evidence=evidence)
path=root/'apps/creator-studio/audit/apple-studio-readiness-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n')
print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceTree=tree,sourceArchive=source,candidates=candidates,passEvents=passed)))
