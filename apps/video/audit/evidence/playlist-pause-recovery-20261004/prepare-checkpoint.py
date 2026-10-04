import pathlib,json,hashlib,subprocess,tarfile,gzip,io,shutil,zipfile,tempfile,datetime
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
out=root/'apps/video/audit/evidence/playlist-pause-recovery-20261004'
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert sha(b)==p['sha256'] and len(b)==p['bytes'],p['path']
def archive(p,values):
 with p.open('xb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as tar:
  for name,data,mode in values:
   i=tarfile.TarInfo(name);i.size=len(data);i.mode=mode;i.mtime=0;tar.addfile(i,io.BytesIO(data))
 return {**pin(p),'fileCount':len(values)}
compose=pathlib.Path('/tmp/ynx-video-playlist-pause-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes())
assert all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);assert passed>=450 and not any(e.get('Action')=='fail' for e in events)
priorpath=root/'apps/music/audit/rights-records-recovery-checkpoint-20261004.json';prior=json.loads(priorpath.read_bytes())
with tarfile.open(root/prior['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',prior['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 b=subprocess.check_output(['git','show',head+':'+name]);assert b==(root/name).read_bytes();mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];assert mode in ['100644','100755'];values.append((name,b,0o755 if mode=='100755' else 0o644))
out.mkdir(parents=True,exist_ok=False)
source=archive(out/'media-owned-source.tar.gz',values)
def copy(src,name):
 p=out/name;shutil.copyfile(src,p);return pin(p)
builds={}
for platform,log in [('android','/tmp/ynx-video-playlist-pause-android-build-20261004.txt'),('apple','/tmp/ynx-video-playlist-pause-apple-build-r2-20261004.txt')]:
 directory=pathlib.Path(json.loads(pathlib.Path(log).read_text().splitlines()[-1])['out']);b=json.loads((directory/'build-receipt.json').read_bytes());builds[platform]=(directory,b)
 for p in b['sourcePins']:exact(p)
 copy(directory/'build-receipt.json',platform+'-build-receipt.json');copy(log,platform+'-build-stdout.txt')
directory,android=builds['android'];apk=copy(android['apk']['path'],'YNXVideo-android-debug.apk');assert apk['sha256']==android['apk']['sha256'];assert android['lint']=='PASS full lintDebug'
with zipfile.ZipFile(root/apk['path']) as z:
 for p in android['sourcePins']:
  if '/assets/native-session/' in p['path']:assert sha(z.read('assets/'+p['path'].split('/assets/')[1]))==p['sha256']
 assert sha(z.read('assets/catalog.json'))==next(p['sha256'] for p in android['sourcePins'] if p['path']=='apps/video/i18n/catalog.json')
for name in ['gradle-build-lint.txt','apk-badging.txt','apk-signature.txt']:copy(directory/name,'android-'+name)
_,apple=builds['apple'];candidates=[]
for c in apple['candidates']:
 app=pathlib.Path(c['app']);rows=[]
 for p in c['files']:
  data=(app/p['path']).read_bytes();assert len(data)==p['bytes'] and sha(data)==p['sha256'];
  if p['path'].startswith('native-session/'):assert data==subprocess.check_output(['git','show',head+':apps/video/ios/YNXVideo/'+p['path']])
  if p['path']=='catalog.json':assert data==subprocess.check_output(['git','show',head+':apps/video/i18n/catalog.json'])
  rows.append((app.name+'/'+p['path'],data,(app/p['path']).stat().st_mode&0o777))
 candidates.append({**archive(out/(c['scheme']+'-unsigned.tar.gz'),rows),'scheme':c['scheme'],'signed':False,'installed':False,'launched':False});copy(c['log'],c['scheme']+'-build.txt')
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name);copy(pathlib.Path('/tmp/ynx-video-playlist-pause-original-focus-20261004')/name,'focused-'+name)
for src,name in [('/tmp/ynx-video-playlist-pause-baseline-failure-20261004.txt','original-discard-baseline-failure.txt'),('/tmp/ynx-video-playlist-pause-baseline-compile-20261004.txt','original-discard-baseline-compile.txt'),('/tmp/ynx-video-playlist-pause-baseline-20261004/VideoViewerState.swift','original-discard-baseline-source.swift'),('/tmp/ynx-video-playlist-pause-baseline-20261004/check.swift','original-discard-baseline-check.swift'),('/tmp/ynx-video-playlist-pause-web-check-20261004.txt','video-web-check.txt'),('/tmp/ynx-video-playlist-pause-apple-storage-20261004.txt','apple-storage.txt'),('/tmp/ynx-video-playlist-pause-java-storage-20261004.txt','java-storage.txt'),('/tmp/ynx-video-playlist-pause-i18n-first-failed-20261004.txt','i18n-first-failed.txt'),('/tmp/ynx-video-playlist-pause-i18n-r2-20261004.txt','i18n-passed.txt'),('/tmp/ynx-video-playlist-pause-apple-build-20261004.txt','apple-builder-first-path-failed.txt'),('/tmp/ynx-video-playlist-pause-apple-compile-20261004.txt','apple-engine-compile.txt'),('/tmp/ynx-video-playlist-pause-apple-engine-20261004/apple-engine-check.json','compiled-video-source.json')]:copy(src,name)
pixel=root/'apps/music/audit/evidence/native-read-presentation-20261004/compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift');binary='/tmp/ynx-video-playlist-pause-brand-check-20261004';subprocess.run(['xcrun','swiftc',str(pixel),'-o',binary],check=True)
for c in apple['candidates']:
 app=pathlib.Path(c['app']);built=next(app/p['path'] for p in c['files'] if p['path'].endswith('ynx-brand-original.png'))
 (out/(c['scheme']+'-brand-pixels.txt')).write_bytes(subprocess.check_output([binary,str(root/'apps/video/ios/YNXVideo/ynx-brand-original.png'),str(built)]))
with tempfile.TemporaryDirectory(prefix='ynx-video-brand-') as tmp:
 built=pathlib.Path(tmp)/'logo.png'
 with zipfile.ZipFile(root/apk['path']) as z:built.write_bytes(z.read('res/drawable-nodpi-v4/ynx_brand_original.png'))
 (out/'android-brand-pixels.txt').write_bytes(subprocess.check_output([binary,str(root/'apps/video/android/app/src/main/res/drawable-nodpi/ynx_brand_original.png'),str(built)]))
(out/'followup.md').write_text('Video original native playlist create recovery. Android and Apple replace destructive discard with explicit pause and original-key restoration. Original account-scoped schema/version and key custody are preserved; optional history is bounded at 64 and full history rejects pause without erasing pending/history. Matching same-name requests restore the original key. Old acknowledgment/body mismatch/foreign account/current-context/successor fences remain. Pause does not cancel already-created server content.\n\nActual original Apple SDK/model/private service test loses a successful create reply, pauses the original, creates a successor, cold-restores the original and retries its original key; exact owned server readback remains three playlists rather than a duplicate, then only disposable QA playlists are explicitly removed. Android shipped viewer-state software tests protect cold/account/late ACK/history capacity; Android actual Activity rendering and installed callbacks remain unverified. Full Android build/lint/debug signature/catalog/six SDK assets and complete unsigned Apple iOS/macOS builds are frozen. No live Host/network, user content/keys or shared authority modified.\n\nAn isolated check compiled the exact pre-repair 5630898b9 viewer state and reproduced that original discard removes the original request key; the failing result and exact old source are retained. First i18n check failed because its Swift contract source list omitted existing native identity files; exact project membership and full current files are now checked, no binding removed. First Apple builder path incorrectly used video-studio; corrected to the existing Video project, original error retained. Earlier Creator timeout cause remains NOT_CONFIRMED via inherited checkpoint. Actual Wallet/install/rendered/native codec/Host/currentActor/Trust final decision/user acceptance remain unverified.\n\nWeb two existing create-playlist entry points have no durable original request key and remain an explicit next owned recovery gap: apps/video/app.js showPlaylists and playlist-save-form. This native source batch does not claim Web recovery repaired or formal release.\n')
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-video-playlist-pause-20261004.py','verify-checkpoint.py')
evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file()]
f={'schema':'ynx.video.playlist-pause-recovery.checkpoint.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':head,'sourceTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip(),'inheritedCheckpoint':pin(priorpath),'sourceArchive':source,'androidCandidate':{**apk,'installed':False,'launched':False,'debugSigned':True,'releaseSigned':False},'appleUnsignedCandidates':candidates,'checks':{'fullGoRacePassEvents':passed,'fullGoRaceFailures':0,'vet':'PASS','compositionInputs':len(receipt['inputPins']),'androidStorageJUnit':12,'videoWebChecks':171,'nativeRetainedHistoryCapacity':64,'originalDiscardBaseline':'REPRODUCED_KEY_ERASURE','locales':12,'localeKeys':35,'actualOriginalAppleModelCreateLostReplyPauseSuccessorColdOriginalKey':True,'actualWalletConsent':False,'actualInstalledNativeUI':False,'actualCentralTrustAcceptance':False,'earlierCreatorTimeoutCause':'NOT_CONFIRMED'},'remaining':prior['remaining']+['Formal Video same-own business and exact release tuple remain unverified','Web both create-playlist entry points need durable original-key recovery','Independent native playlist source review pending'],'evidence':evidence}
p=root/'apps/video/audit/playlist-pause-recovery-checkpoint-20261004.json';p.write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'checkpoint':pin(p),'source':source,'pass':passed,'androidAPK':apk,'appleCandidates':candidates}))
