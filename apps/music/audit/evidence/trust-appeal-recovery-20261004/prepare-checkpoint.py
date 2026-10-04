import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-media-music-trust-appeal-full-r2-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/trust-appeal-recovery-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/music/audit/trust-confirmed-recovery-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
with tarfile.open(root/inherited['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',inherited['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data;mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];values.append((name,data,0o755 if mode=='100755' else 0o644))
source=archive(out/'media-owned-source.tar.gz',values)
androiddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-trust-appeal-android-build-r2-20261004.txt').read_text().splitlines()[-1])['out']);appledir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-trust-appeal-apple-build-r2-20261004.txt').read_text().splitlines()[-1])['out'])
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
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-music-trust-appeal-focused-r2-20261004')/name,'trust-appeal-focused-'+name)
for src,name in [('/tmp/ynx-music-trust-appeal-java-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-trust-appeal-swift-r2-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-trust-appeal-java-compile-20261004.txt','java-compile.txt'),('/tmp/ynx-music-trust-appeal-swift-compile-r2-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-trust-business-web-r6-20261004.txt','web-final.txt')]:copy(src,name)
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
copy('/tmp/ynx-music-trust-appeal-cache-20261004.txt','owner-field-cache-check.txt');copy('/tmp/ynx-music-trust-appeal-root-probe-20261004.txt','owner-exact-root-probe-check.txt');review=pathlib.Path('/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/recovery-20261004/media910-field-merge-independent-review')
review_closure=json.loads((review/'closure.json').read_bytes())
assert sha((review/'closure.json').read_bytes())=='2a1b049013c0a178c32e4ca8df5d943676756697971f0dce225e05c9cd3b2e1f'
assert review_closure['disposition']=='BOUNDED_OWNED_SOURCE_PASS' and review_closure['sourceCommit']=='9105695d09f64d01c6e3e079de2875752d5d8603'
copy(review/'closure.json','root-cache-source-closure.json')
for name in ['SOURCE_REPORT.md','independent-original-cache-check.log','independent-field-check.log','independent-field-boundary.log','independent-build.json']:
 b=(review/name).read_bytes();assert sha(b)==review_closure['hashes'][name];copy(review/name,'root-cache-'+name.replace('.log','.txt'))
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-music-trust-appeal-20261004.py','verify-checkpoint.py')
(out/'followup.md').write_text("Native Music owner appeal and original pending request recovery.\n\nNew report/dispute remains available to listeners. New appeal/takedown preflight checks the exact current original private Music snapshot profile and track owner, with the unchanged original service as final authority. Android ordinary latest-store staging and Apple original model reject an unowned new appeal before it can block the pending selector. Owner checks are not imposed on original-key retry/recovery because the original service replays admitted cases before the new owner check. Reason validation now follows the original service UTF-8 byte minimum.\n\nBoth native products offer an explicit confirmation before pausing this device's retry. This does not withdraw a server case or claim success. The immutable original key/account/body is moved into optional per-account caseHistory in the existing schema1 store. User recovery restores exactly that record. Re-entering the same paused request restores its original key; a distinct request may proceed while paused. Matching original receipt remains necessary to acknowledge. Old pause, restore or ACK cannot overwrite a successor. Android transactions load current fields under the existing lock and check original SDK/account immediately before save. Apple uses the original MainActor operation and atomic account store. At 64 retained entries pausing fails without deleting an entry. Other account contents, pending uploads, playlists, playback and original media remain separate and preserved.\n\nThe retained baseline at ac02 reproduces the former ordinary-store acceptance of an unowned appeal and its blocked successor; it is cache-only, not an SDK/server authority observation. Actual new Android production API/controller/store and Apple production API/model/store execute through the pinned original SDK and original Go Music service. The QA-only foreign-content endpoint seeds a disposable published generated PCM row via original Service methods. It is explicitly not a second authenticated Wallet/SDK identity. The original verified client account remains unchanged. Each native sends one direct unauthorized appeal to the original service: exact original HTTP403 is counted, the SDK remains current, original private readback succeeds and no case is created. New normal staging rejects the unowned appeal without a pending intent.\n\nThe existing unavailable Trust request is then locally paused, cold original session/cache reopened and original-key recovered. The original missing-provider and confirmed-lost-reply journey still yields one original case and one ISOLATED HTTPS provider dispatch. Actual Central Trust receipt/Wallet/installed UI are not claimed. The Android original same-body stage path reuses the historical key; Apple explicit restore preserves it. Ordinary cache tests additionally exercise successor ACK/restore refusal, final-write guard retirement, historical missing-owner recovery and foreign account denial. The original unmodified Root five-check probe is freshly rerun against the new production Store.\n\nAuthor rights entry is also exposed directly from all original CreatorTracks, including tracks absent from the public catalog. Apple Creator has the original pending/paused section, and its pause confirmation retires on view generation change.\n\nNew complete Android build/full lint/debug package and Apple iOS/macOS unsigned complete builds correspond exactly to this source. All source pins, original six SDK assets, packaged bytes and decoded brand pixels are verified. Full race/vet and focused SDK/original native/service evidence are frozen independently. An earlier full run at 04f80 ended with Creator iOS signal-killed at the existing 120-second QA deadline. That original failed run and receipt are retained separately. A focused original Creator iOS run at d305 passed in 77.75 seconds under unchanged original policy and timeout, but does not identify the prior root cause. Optional diagnostic metadata records command names, start/end, original rate-budget remaining and waits without request bodies, authority inputs or user data. The new full run retains these original stage traces; a later green never reclassifies the earlier unexplained failure as resolved.\n\nWeb source is unchanged; its earlier original IndexedDB/reopen evidence is inherited with its timestamp and scope. Root910 cache source acceptance is historical and bounded to its reviewed field merge. This new native rights repair is pending Root independent source review; owner greens are not source admission or formal public delivery. Host/currentActor/client mounting, real Wallet/installed native/UI/large-media/codec/AI/Pay/Trust/user acceptance remain unverified.\n")
for p in (root/'apps/music/audit/evidence/native-trust-appeal-recovery-20261004').iterdir():
 if p.is_file():copy(p,'baseline-'+p.name)
for name in ['combined-go-race.jsonl','combined-source-receipt.json']:
 copy(pathlib.Path('/tmp/ynx-media-music-trust-appeal-full-20261004')/name,'earlier-full-timeout-'+name)
copy('/tmp/ynx-media-music-trust-appeal-full-20261004.txt','earlier-full-timeout-stdout.txt')
copy('/tmp/ynx-music-trust-appeal-root-probe-fixture-retained-20261004.json','root-probe-generated-fixture-retained.json')
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:
 copy(pathlib.Path('/tmp/ynx-creator-ios-timeout-diagnostic-20261004')/name,'creator-ios-diagnostic-'+name)
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in apple_candidates]}
checkpoint=dict(schema='ynx.music.trust-appeal-recovery.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,androidCandidateSourceCommit=android['sourceCommit'],appleCandidateSourceCommit=apple['sourceCommit'],sourceHoldStatus='CLOSED_FOR_MEDIA6288_CACHE_P2_ONLY',sourceReview=dict(cacheFieldMerge='BOUNDED_OWNED_SOURCE_PASS',sourceCommit='9105695d09f64d01c6e3e079de2875752d5d8603',trustSDKAuthority='NOT_INDEPENDENTLY_ADMITTED',nativeRightsRepair='PENDING_ROOT_SOURCE_REVIEW',formalRelease='NOT_VERIFIED'),rootCounterexampleCheckpoint='apps/music/audit/evidence/stale-ui-cache-counterexample-20261004/SOURCE_REPORT.md',nativeSourcePinsCurrentGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',androidBuildAndFullLint='PASS',appleFullBuilds='PASS',originalSameKeyTrustRetrySingleCase=True,unconfirmedTrustIntentRetained=True,originalTrustConfirmedLostReplyRecovery=True,isolatedHTTPSProviderDispatchesPerNativeActor=1,originalCaseCountAfterConfirmedColdReplay=1,webFreshPageOriginalIntentRecovery=True,webConfirmedReceipt='ISOLATED_SYNTHETIC_UI_ONLY',actualCentralTrustAcceptance=False,originalAudioDraftPreserved=True,originalBrandPixelsExact=True,actualInstalledNativeUI=False,actualWalletConsent=False,ownerExactRootCacheProbe='5PASS0FAIL_CACHE_ONLY',latestStoreFieldTransactions=True,foreignOwnerAppealRejectedWithoutLogout=True,originalOwnerHTTP403PerNativeActor=1,originalPausedCaseColdSameKeyRecovery=True,originalPausedSameBodyStageReusesKey=True,localPauseDoesNotWithdraw=True,retainedHistoryCapacity=64,localesComplete=12,earlierCreatorIOSFullSuiteTimeout='RETAINED_CAUSE_NOT_CONFIRMED',creatorStageDiagnostics='OPT_IN_METADATA_ONLY_ORIGINAL_TIMEOUTS_UNCHANGED'),inheritedCheckpoint=pin(inherited_path),remaining=[item for item in inherited['remaining'] if item not in ['Root successor independent review before SOURCE_HOLD may close','Native non-owner appeal selection requires owned UX/intent audit; original owner gate remains authoritative']]+['New native owner-appeal and pause/recovery repair independent source review pending','Earlier Creator iOS 120-second full-run timeout cause NOT_CONFIRMED; later green is recovery evidence only'],publicReadback=inherited['publicReadback'],evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/trust-appeal-recovery-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,passEvents=passed)))
