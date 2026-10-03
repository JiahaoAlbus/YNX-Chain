import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def exact(pin):
 b=subprocess.check_output(['git','show',head+':'+pin['path']]);assert len(b)==pin['bytes'] and sha(b)==pin['sha256'],pin['path']
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
compose=pathlib.Path('/tmp/ynx-media-music-library-cache-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/android-library-cache-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/music/audit/native-read-presentation-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
with tarfile.open(root/inherited['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',inherited['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data;mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];values.append((name,data,0o755 if mode=='100755' else 0o644))
source=archive(out/('media-owned-source-'+head[:8]+'.tar.gz'),values);source['everyMemberGitByteExact']=True
androiddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-library-cache-android-build-r2-20261004.txt').read_text().splitlines()[-1])['out']);android=json.loads((androiddir/'build-receipt.json').read_bytes());assert android['sourceCommit']==head and android['lint']=='PASS full lintDebug'
for p in android['sourcePins']:exact(p)
apk=copy(android['apk']['path'],'YNXMusic-'+head[:8]+'-debug.apk');assert apk['bytes']==android['apk']['bytes'] and apk['sha256']==android['apk']['sha256'];apk.update(applicationId='com.ynxweb4.music',debugSigned=True,releaseSigned=False,installed=False,launched=False)
for p in android['sourcePins']:
 if '/assets/native-session/' in p['path']:
  data=subprocess.check_output(['unzip','-p',str(root/apk['path']),'assets/'+p['path'].split('/assets/')[1]]);assert len(data)==p['bytes'] and sha(data)==p['sha256']
for name in ['build-receipt.json','gradle-build-lint.txt','apk-signature.txt','apk-badging.txt']:copy(androiddir/name,'android-'+name)
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-music-library-cache-focused-20261004')/name,'android-original-cache-focused-'+name)
for src,name in [('/tmp/ynx-music-library-cache-java-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-library-cache-java-compile-20261004.txt','java-compile.txt')]:copy(src,name)
# Reuse unchanged exact Apple candidates; their source pins must also match this successor.
base=root/'apps/music/audit/evidence/native-read-presentation-20261004';apple=json.loads((base/'apple-build-receipt.json').read_bytes())
for p in apple['sourcePins']:exact(p)
copy(base/'apple-build-receipt.json','inherited-apple-build-receipt.json')
for candidate in inherited['appleCandidates']:exact(candidate)
pixel=base/'compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift');pixelbin='/tmp/ynx-music-library-brand-pixel-check-20261004';subprocess.run(['xcrun','swiftc',str(pixel),'-o',pixelbin],check=True)
for candidate in inherited['appleCandidates']:
 with tempfile.TemporaryDirectory(prefix='ynx-music-inherited-brand-') as tmp:
  built=pathlib.Path(tmp)/'compiled.png'
  with tarfile.open(root/candidate['path']) as tar:
   member=next(m for m in tar if m.name.endswith('/ynx-brand-original.png'));built.write_bytes(tar.extractfile(member).read())
  (out/(candidate['scheme']+'-brand-pixels.txt')).write_bytes(subprocess.check_output([pixelbin,str(root/'apps/music/ios/YNXMusic/ynx-brand-original.png'),str(built)]))
with tempfile.TemporaryDirectory(prefix='ynx-music-android-brand-') as tmp:
 built=pathlib.Path(tmp)/'compiled.png'
 with zipfile.ZipFile(root/apk['path']) as z:built.write_bytes(z.read('res/drawable-nodpi-v4/ynx_brand_original.png'))
 (out/'android-brand-pixels.txt').write_bytes(subprocess.check_output([pixelbin,str(root/'apps/music/android/app/src/main/res/drawable-nodpi/ynx_brand_original.png'),str(built)]))
copy(__file__,'prepare-checkpoint.py')
(out/'followup.md').write_text('''Android Music original cache transactions and durable library recovery.

Confirmed source gaps: MainActivity workers retained a shared mutable UI state and completed profile/download tasks through the global current store, allowing stale full-cache replacement. Original refresh replaced remote but did not merge original server listener favorites/queue. Local library edits had no durable confirmation marker. Report dialog text was read from worker threads after the original button click. Only one account dialog was retired, while multiple normal dialogs could remain.

MainActivity now captures deep immutable operation state and synchronous form values, keeps original generation/SDK checks, commits profile/download data to the captured original MusicStore on UI publication, and preserves unrelated current cache fields. Profile commits update only original profile. Download confirmation verifies original local WAV hash and marks that item without restoring older state. Failed local favorite/AI-preference writes no longer silently publish success. All owned account dialogs are tracked until dismissal and retired on exit/change/destroy, including overlapping forms and AI disclosures. Installed UI/Looper execution is still unverified.

Library edits persist an optional libraryIntent in the existing version-1 original account cache before HTTP. Existing caches/fields/directories and upload drafts are preserved; this adds no grant, key migration or new service protocol. The Activity's serial MusicLibraryWriter captures exact original intent values. Only the current same-account intent can send; original SDK epoch/view guards still prepare real fresh proofs. Original response must match original account/favorites/queue/downloads before matching-intent acknowledgement. An older queued job cannot consume its successor. An unobserved reply remains pending. Original signed snapshot readback can acknowledge an already committed same intent without another PUT. If not confirmed, original local desired library survives refresh and is normally retried with current original authority. With no pending edit, original remote favorites/queue populate the local account cache. Local audio availability is separately verified from original file hashes, never inferred from remote available markers.

Actual production Java API/Store/Writer/Upload run against the original SDK and Go service: real profile update and original downloaded WAV preserve the newer playlist snapshot, local preference and pending upload; the first successful original library PUT returns a truncated original response, preserving the original intent. A cold original SDK restore/read confirms it without resending. Older queued work skips the successor; immutable input survives mutation after enqueue; original SDK epoch retirement blocks queued request/ack while preserving intent; same original intent later completes after protected recovery. Other-account selection rejects the old profile commit. The original pending audio draft survives and is cancelled only through the normal original upload controller, preserving its bytes. Four actual library PUT responses are counted, so skipped/retired jobs and lost-reply read recovery do not silently resend. This uses disposable JVM ports and controlled scheduling, not installed Android/OS/Wallet approval.

The current complete actual SDK/Swift/Java/Go race batch and vet are frozen separately from previous runs. Android final source build/full lint/debug signature/identity and original six SDK assets are verified. Unchanged Apple candidates are inherited byte-for-byte; every inherited Apple build source pin also matches the current source, and decoded original brand pixel hashes are checked again. Android packaged original brand pixels are independently checked. No real user files, shared SDK/Host/permissions/roles/timeouts or original service behavior changed. Public readback is inherited with its original timestamp; formal Host/currentActor/client deployment and real Wallet/OS/device/codec/AI/Pay/user acceptance remain open. Historical initial restore failures remain unconfirmed.
''')
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name}
checkpoint=dict(schema='ynx.music.android.library-cache.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,androidCandidate=apk,appleCandidates=inherited['appleCandidates'],appleCandidateSourceCommit=apple['sourceCommit'],appleSourcePinsCurrentGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',androidBuildAndFullLint='PASS',originalCacheFieldMerge=True,actualDurableOriginalLibrarySync=True,originalLostReplyColdReadbackWithoutResend=True,olderIntentCannotConsumeSuccessor=True,retiredOriginalSDKWorkCannotAck=True,immutableLibraryInput=True,originalUploadDraftBytesPreserved=True,originalBrandPixelsExact=True,actualInstalledAndroidUILooper=False,actualWalletConsent=False),inheritedReadPresentationCheckpoint=pin(inherited_path),remaining=inherited['remaining'],publicReadback=inherited['publicReadback'],evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/android-library-cache-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,androidCandidate=apk,passEvents=passed)))
