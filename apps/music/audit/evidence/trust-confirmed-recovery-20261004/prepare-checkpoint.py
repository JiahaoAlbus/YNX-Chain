import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-media-music-trust-confirmed-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/trust-confirmed-recovery-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/music/audit/field-merge-recovery-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
with tarfile.open(root/inherited['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',inherited['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data;mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];values.append((name,data,0o755 if mode=='100755' else 0o644))
source=archive(out/'media-owned-source.tar.gz',values)
androiddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-field-merge-android-build-20261004.txt').read_text().splitlines()[-1])['out']);appledir=pathlib.Path('/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-music-apple-native-b9rEN3')
android=json.loads((androiddir/'build-receipt.json').read_bytes());apple=json.loads((appledir/'build-receipt.json').read_bytes())
for build in [android,apple]:
 for p in build['sourcePins']:exact(p)
assert android['lint']=='PASS full lintDebug' and all(p['gitExact'] for p in apple['sourcePins'])
apk=copy(android['apk']['path'],'YNXMusic-android-debug.apk');assert apk['sha256']==android['apk']['sha256'] and apk['bytes']==android['apk']['bytes'];apk.update(debugSigned=True,releaseSigned=False,installed=False,launched=False)
with zipfile.ZipFile(root/apk['path']) as z:
 for p in android['sourcePins']:
  if '/assets/native-session/' in p['path']:
   data=z.read('assets/'+p['path'].split('/assets/')[1]);assert len(data)==p['bytes'] and sha(data)==p['sha256']
for name in ['build-receipt.json','gradle-build-lint.txt','apk-signature.txt','apk-badging.txt']:copy(androiddir/name,'android-'+name)
copy(appledir/'build-receipt.json','apple-build-receipt.json');apple_candidates=[]
for candidate in apple['candidates']:
 app=pathlib.Path(candidate['app']);values=[]
 for p in candidate['files']:
  b=(app/p['path']).read_bytes();assert len(b)==p['bytes'] and sha(b)==p['sha256'];values.append((app.name+'/'+p['path'],b,(app/p['path']).stat().st_mode&0o777))
 archived=archive(out/(candidate['scheme']+'-unsigned.tar.gz'),values);archived.update(scheme=candidate['scheme'],signed=False,installed=False,launched=False);apple_candidates.append(archived);copy(candidate['log'],candidate['scheme']+'-build.txt')
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(compose/name,name)
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-music-trust-confirmed-focused-20261004')/name,'trust-confirmed-focused-'+name)
for src,name in [('/tmp/ynx-music-trust-confirmed-java-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-trust-confirmed-swift-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-trust-confirmed-java-compile-20261004.txt','java-compile.txt'),('/tmp/ynx-music-trust-confirmed-swift-compile-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-trust-business-web-r6-20261004.txt','web-final.txt')]:copy(src,name)
for rev in ['', '-r2','-r3','-r4','-r5']:
 src=pathlib.Path('/tmp/ynx-music-trust-business-web'+rev+'-20261004.txt')
 if src.is_file():copy(src,'web-earlier'+(rev or '-r1')+'.txt')
for src,name in [('/tmp/ynx-music-trust-intent-java-compile-20261004.txt','java-first-compile-diagnostic.txt'),('/tmp/ynx-music-trust-intent-swift-compile-20261004.txt','swift-first-compile-diagnostic.txt')]:copy(src,name)
web=(out/'web-final.txt').read_text();assert 'fresh-page reopen' in web and 'zero browser errors' in web and 'Standard Wallet approve/reject' in web
pixel=root/'apps/music/audit/evidence/native-read-presentation-20261004/compiled-brand-pixel-check.swift';copy(pixel,'compiled-brand-pixel-check.swift');pixelbin='/tmp/ynx-music-trust-brand-check-20261004';subprocess.run(['xcrun','swiftc',str(pixel),'-o',pixelbin],check=True)
for candidate in apple_candidates:
 with tempfile.TemporaryDirectory(prefix='ynx-music-trust-apple-brand-') as tmp:
  built=pathlib.Path(tmp)/'compiled.png'
  with tarfile.open(root/candidate['path']) as tar:
   member=next(m for m in tar if m.name.endswith('/ynx-brand-original.png'));built.write_bytes(tar.extractfile(member).read())
  (out/(candidate['scheme']+'-brand-pixels.txt')).write_bytes(subprocess.check_output([pixelbin,str(root/'apps/music/ios/YNXMusic/ynx-brand-original.png'),str(built)]))
with tempfile.TemporaryDirectory(prefix='ynx-music-trust-android-brand-') as tmp:
 built=pathlib.Path(tmp)/'compiled.png'
 with zipfile.ZipFile(root/apk['path']) as z:built.write_bytes(z.read('res/drawable-nodpi-v4/ynx_brand_original.png'))
 (out/'android-brand-pixels.txt').write_bytes(subprocess.check_output([pixelbin,str(root/'apps/music/android/app/src/main/res/drawable-nodpi/ynx_brand_original.png'),str(built)]))
copy('/tmp/ynx-music-field-merge-cache-check-20261004.txt','owner-field-cache-check.txt');copy('/tmp/ynx-music-field-merge-root-probe-20261004.txt','owner-exact-root-probe-check.txt');review=pathlib.Path('/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/recovery-20261004/media910-field-merge-independent-review')
review_closure=json.loads((review/'closure.json').read_bytes())
assert sha((review/'closure.json').read_bytes())=='2a1b049013c0a178c32e4ca8df5d943676756697971f0dce225e05c9cd3b2e1f'
assert review_closure['disposition']=='BOUNDED_OWNED_SOURCE_PASS' and review_closure['sourceCommit']=='9105695d09f64d01c6e3e079de2875752d5d8603'
copy(review/'closure.json','root-cache-source-closure.json')
for name in ['SOURCE_REPORT.md','independent-original-cache-check.log','independent-field-check.log','independent-field-boundary.log','independent-build.json']:
 b=(review/name).read_bytes();assert sha(b)==review_closure['hashes'][name];copy(review/name,'root-cache-'+name.replace('.log','.txt'))
for path in ['apps/music/android/app/src/main/java/com/ynxweb4/music/MusicStore.java','apps/music/android/app/src/main/java/com/ynxweb4/music/MainActivity.java','apps/music/android/app/src/main/java/com/ynxweb4/music/PlaybackService.java']:
 assert subprocess.check_output(['git','show',head+':'+path])==subprocess.check_output(['git','show',review_closure['sourceCommit']+':'+path])
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-music-trust-confirmed-20261004.py','verify-checkpoint.py')
(out/'followup.md').write_text('Music original confirmed Trust response recovery evidence.\n\nOnly six owned QA/fixture files and a diagnostic line changed from e455; no product source, permission, SDK grant, schema, original service protocol, role gate, timeout, custody key or media bytes changed. Original cache P2 repair and Root source-hold report remain in the inherited field-merge checkpoint, including exact independent original 4PASS1FAIL and owner unmodified-probe 5PASS0FAIL. The exact new Root910 SOURCE_REPORT and closure establish BOUNDED_OWNED_SOURCE_PASS for the ordinary cache/caller repair and close that P2 only; these original reports/logs are copied with SHA verification. Trust/SDK/full product/public admission remains separate, and these owner HTTPS tests do not replace it.\n\nOriginal Java production Trust controller/API/store and Apple production model/API/store run through their actual original pinned SDK and original Go Music HTTP service. First missing Trust configuration keeps the exact saved request pending across cold same-account SDK restore with one original local case. The isolated QA backend then REOPENS the same original persisted Music store with an explicit HTTPS test receipt provider and the same original BusinessAuthority/actor/scopes. This is software fixture configuration, not a live Host/config rollout or actual Central Trust. Original HTTPS validation and bounded delegated-effect dispatch/receipt persistence gates execute unchanged.\n\nThe HTTPS fixture validates the original delegated request type, request key, subject, music.rights scope, purpose, report action, original evidence digest/summary/collection time/visibility, product header and isolated Authorization header. It emits one declared synthetic receipt. Only after the original Music service commits that receipt and links the original case does the Java reply adapter or Apple sender deliberately lose the successful Music response. The client retains the saved intent. Cold original SDK restore/reopen retries the original key and contents, returns the same original case and original linked receipt, and acknowledges only that matching intent. The provider dispatch counter must remain one, original case count must remain one, and Java staged original audio must remain retained. Prior unavailable/local-only/caller-mutation/duplicate-stage/changed-body/foreign/old-epoch checks still run. No external unknown-outcome effect is forcibly resent and no pending request is invented as successful.\n\nFocused actual SDK/original native/Go checks and the current complete full race suite/vet are separately frozen. Original native products and native source pins are byte-identical to the e455 candidates, so existing Android full build/lint/debug signature/original SDK assets and Apple complete build receipts are inherited, freshly checked against the current final source, and packaged bytes/brand decoded pixels independently verified again. Compiled headless Java16/Swift10 QA bundles are new because the fixture code changed; they do not replace the native APK/app build receipts.\n\nThis proves the original owned client/service recovery using an ISOLATED SYNTHETIC HTTPS provider receipt. Actual Central Trust/Wallet/device/install/UI acceptance remains NOT_VERIFIED. Formal original Host/currentActor/matching-client delivery and real Wallet/OS/codec/large-media/AI/Pay/Trust/user acceptance remain open. Inherited public readback carries its old timestamp only. Continuing owned capability audit includes native non-owner appeal selection against the original owner permission gate; that source concern is not an acceptance claim or permission change.\n')
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in apple_candidates]}
checkpoint=dict(schema='ynx.music.trust-confirmed-recovery.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,androidCandidateSourceCommit=android['sourceCommit'],appleCandidateSourceCommit=apple['sourceCommit'],sourceHoldStatus='CLOSED_FOR_MEDIA6288_CACHE_P2_ONLY',sourceReview=dict(cacheFieldMerge='BOUNDED_OWNED_SOURCE_PASS',sourceCommit='9105695d09f64d01c6e3e079de2875752d5d8603',trustSDKAuthority='NOT_INDEPENDENTLY_ADMITTED',formalRelease='NOT_VERIFIED'),rootCounterexampleCheckpoint='apps/music/audit/evidence/stale-ui-cache-counterexample-20261004/SOURCE_REPORT.md',nativeSourcePinsCurrentGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',androidBuildAndFullLint='PASS',appleFullBuilds='PASS',originalSameKeyTrustRetrySingleCase=True,unconfirmedTrustIntentRetained=True,originalTrustConfirmedLostReplyRecovery=True,isolatedHTTPSProviderDispatchesPerNativeActor=1,originalCaseCountAfterConfirmedColdReplay=1,webFreshPageOriginalIntentRecovery=True,webConfirmedReceipt='ISOLATED_SYNTHETIC_UI_ONLY',actualCentralTrustAcceptance=False,originalAudioDraftPreserved=True,originalBrandPixelsExact=True,actualInstalledNativeUI=False,actualWalletConsent=False,ownerExactRootCacheProbe='5PASS0FAIL_CACHE_ONLY',latestStoreFieldTransactions=True),inheritedCheckpoint=pin(inherited_path),remaining=[item for item in inherited['remaining'] if item!='Root successor independent review before SOURCE_HOLD may close']+['Native non-owner appeal selection requires owned UX/intent audit; original owner gate remains authoritative'],publicReadback=inherited['publicReadback'],evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/trust-confirmed-recovery-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,passEvents=passed)))
