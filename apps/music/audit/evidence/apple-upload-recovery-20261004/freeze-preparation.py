import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,urllib.request
root=pathlib.Path('/Users/huangjiahao/Desktop/YNX Audit Worktrees/20260906-video')
out=root/'apps/music/audit/evidence/apple-upload-recovery-20261004'
out.mkdir(parents=True,exist_ok=False)
def git(*args):return subprocess.check_output(['git',*args],cwd=root)
sha=lambda b:hashlib.sha256(b).hexdigest()
head=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip()
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def copy(source,name):
 p=out/name;shutil.copyfile(source,p);return p
def pack(name,members):
 p=out/name
 with p.open('xb') as f,gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as t:
  for name,b,mode in sorted(members):
   info=tarfile.TarInfo(name);info.size=len(b);info.mode=mode;info.mtime=0;t.addfile(info,io.BytesIO(b))
 expected={name:sha(b) for name,b,_ in members}
 with tarfile.open(p) as t:
  actual={m.name:sha(t.extractfile(m).read()) for m in t.getmembers()}
 assert actual==expected
 return dict(pin(p),fileCount=len(expected),everyMemberVerified=True)
previous=root/'apps/music/audit/evidence/apple-full-native-build-r2-20261004/media-owned-source-cb4c25cd.tar.gz'
with tarfile.open(previous) as t:names={m.name for m in t.getmembers() if m.isfile()}
allowed=('apps/video/','apps/creator-studio/','apps/music/','internal/video/','internal/music/')
for n in git('diff','--name-only','cb4c25cd307cb2281b66790869ab8a93bf9932b8',head).decode().splitlines():
 if n.startswith(allowed) and '/audit/' not in n and '/evidence/' not in n:names.add(n)
members=[]
for n in sorted(names):
 b=git('show',head+':'+n);assert (root/n).read_bytes()==b
 mode=int(git('ls-tree',head,'--',n).decode().split()[0],8)&0o777
 members.append((n,b,mode))
source=pack('media-owned-source-'+head[:8]+'.tar.gz',members);source['everyMemberGitByteExact']=True
buildMeta=json.loads(pathlib.Path('/tmp/ynx-music-upload-build-final-20261004.txt').read_text())
build=json.loads(pathlib.Path(buildMeta['path']).read_text());assert build['sourceCommit']==head
for p in build['sourcePins']:
 assert p['gitExact'] and sha(git('show',head+':'+p['path']))==p['sha256']
copy(buildMeta['path'],'full-native-build-receipt.json')
pixelSource=root/'apps/music/audit/evidence/apple-full-native-build-r2-20261004/compiled-brand-pixel-check.swift'
copy(pixelSource,'compiled-brand-pixel-check.swift')
pixelBin='/tmp/ynx-music-v2-freeze-brand-check'
subprocess.run(['xcrun','swiftc',str(pixelSource),'-o',pixelBin],check=True)
candidates=[]
for c in build['candidates']:
 app=pathlib.Path(c['app']);parts=[];resources=app/'Contents/Resources' if c['sdk']=='macosx' else app
 for p in c['files']:
  b=(app/p['path']).read_bytes();assert sha(b)==p['sha256'] and len(b)==p['bytes']
  parts.append((app.name+'/'+p['path'],b,0o755 if p['path'].endswith(('YNXMusic','YNXMusicMac')) else 0o644))
 candidate=pack('music-'+c['sdk']+'-unsigned-'+head[:8]+'.tar.gz',parts)
 candidate.update(scheme=c['scheme'],formalSigning=False,installed=False,launched=False);candidates.append(candidate)
 for p in build['sourcePins']:
  if '/native-session/' in p['path']:
   name=p['path'].split('/native-session/')[1]
   assert sha((resources/'native-session'/name).read_bytes())==p['sha256']
 assert (resources/'i18n.json').read_bytes()==git('show',head+':apps/music/shared/i18n.json')
 result=subprocess.check_output([pixelBin,str(root/'apps/music/ios/YNXMusic/ynx-brand-original.png'),str(resources/'ynx-brand-original.png')])
 (out/(c['scheme']+'-brand-pixels.txt')).write_bytes(result)
 copy(c['log'],c['scheme']+'-build.txt')
qa=pathlib.Path('/tmp/ynx-media-music-upload-go-full-20261004')
receipt=json.loads((qa/'combined-source-receipt.json').read_text())
assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
assert receipt['actualAppleSwiftWebKitEngine'] and receipt['actualAppleMusicSwiftWebKitEngine']
events=[json.loads(l) for l in (qa/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')]
passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert failed==0
ownedPins=[]
for p in receipt['inputPins']:
 if p['path'].startswith(allowed):
  assert sha(git('show',head+':'+p['path']))==p['sha256'];ownedPins.append(p)
for name in ('appleCompiledSource','appleMusicCompiledSource'):
 for p in receipt[name]['sourcePins']:assert sha(git('show',head+':'+p['path']))==p['sha256']
for n in ('combined-source-receipt.json','combined-go-race.jsonl','combined-go-vet.txt'):copy(qa/n,n)
copy('/tmp/ynx-music-upload-account-final-20261004.txt','account-key-preservation.txt')
copy('/tmp/ynx-music-upload-fixture-r4-20261004.txt','actual-model-fixture-compile.txt')
copy('/tmp/ynx-music-upload-fixture-r4-20261004/apple-music-engine-check.json','actual-model-fixture-source.json')
for sourceFile,name in [('/tmp/ynx-music-upload-go-unit-r1-20261004/combined-go-race.jsonl','first-fixture-duration-policy-failure.jsonl'),('/tmp/ynx-music-upload-go-focused-r1-20261004/combined-go-race.jsonl','first-fixture-track-selection-failure.jsonl')]:
 if pathlib.Path(sourceFile).exists():copy(sourceFile,name)
public=[]
for label,url in [('video-manifest','https://video.ynxweb4.com/video/runtime-manifest.json'),('creator-manifest','https://creator.ynxweb4.com/creator-studio.manifest.json'),('video-health','https://video.ynxweb4.com/video/api/health')]:
 item={'url':url,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'GET','authenticated':False}
 try:
  with urllib.request.urlopen(url,timeout=20) as r:b=r.read();item['status']=r.status
  path=out/(label+'-public-readback.json');path.write_bytes(b);item['body']=pin(path)
  try:
   v=json.loads(b);item['sourceCommit']=v.get('sourceCommit');item['centralDeploymentVerified']=v.get('centralDeploymentVerified')
  except ValueError:pass
 except Exception as e:item['error']=str(e)
 public.append(item)
(out/'public-readback-receipt.json').write_text(json.dumps(public,indent=2)+'\n')
freeze={'schema':'ynx.music.apple.upload-recovery.freeze.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'sourceTree':tree,'sourceArchive':source,'appleCandidates':candidates,'compiledSourcePinsGitExact':len(build['sourcePins']),'compositionInputPins':len(receipt['inputPins']),'ownedInputPinsGitExact':len(ownedPins),'checks':{'fullIOSSimulatorSwiftUIBuild':'PASS','fullNativeMacOSSwiftUIBuild':'PASS','goRacePassEvents':passed,'goRaceFailEvents':failed,'goVet':'PASS','actualMusicAppleModelOriginalSDKBusiness':True,'actualVideoAppleOriginalSDKBusiness':True,'keyPreservationDERAndMissingKeyHold':'PASS injected storage','actualIOSDeviceRuntime':False,'actualOSStorage':False,'actualWalletConsent':False,'actualRenderedNativeUI':False,'formalSigning':False,'publicPairDeployment':False},'nativeSDKSource':'5c5e8a234206e306b6044deb6e938c1763ac7005','changes':['Music normal Apple model uses pinned original Native SDK connect/callback/restore/disconnect with own Music binding and original business account readback','Music request proof uses original X-YNX-Music-Business-Proof-V2 and exact body commitment; wrong account and late operation replies rejected','Inherited device-p256 UTF-8 base64 key and account content retained; missing inherited key prevents silent identity replacement','Local withdrawal precedes revoke; negative marker prevents cold recovery after incomplete signout','Private playback downloads through original SDK proof into verified same-account audio cache before local playback'],'remaining':['Real Wallet consent, real Keychain and device UI/codec acceptance','Music audio/upload and durable upload draft recovery full original business verification','Creator Apple full app, original own SDK identity and complete upload/publish/revenue journeys','A original formal Host/client matching deployment and public normal-user readback'],'publicReadback':public,'inheritedMediaCheckpoint':pin(root/'apps/video/audit/media-apple-native-playlist-checkpoint-20261004.json'),'evidence':[pin(p) for p in sorted(out.iterdir()) if p.is_file()]}
path=root/'apps/music/audit/apple-upload-recovery-checkpoint-20261004.json';path.write_text(json.dumps(freeze,indent=2)+'\n')
print(json.dumps({'freeze':pin(path),'source':source,'candidates':candidates,'checks':freeze['checks'],'ownedPins':len(ownedPins)}))
