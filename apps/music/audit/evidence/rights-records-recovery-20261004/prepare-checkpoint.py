import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-media-music-rights-records-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/rights-records-recovery-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/music/audit/trust-appeal-recovery-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
with tarfile.open(root/inherited['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',inherited['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data;mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];values.append((name,data,0o755 if mode=='100755' else 0o644))
source=archive(out/'media-owned-source.tar.gz',values)
androiddir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-rights-records-android-build-r2-20261004.txt').read_text().splitlines()[-1])['out']);appledir=pathlib.Path(json.loads(pathlib.Path('/tmp/ynx-music-rights-records-apple-build-r2-20261004.txt').read_text().splitlines()[-1])['out'])
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
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-music-rights-records-focused-r2-20261004')/name,'trust-appeal-focused-'+name)
for src,name in [('/tmp/ynx-music-rights-records-java-r2-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-rights-records-swift-r3-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-rights-records-java-compile-r2-20261004.txt','java-compile.txt'),('/tmp/ynx-music-rights-records-swift-compile-r3-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-trust-business-web-r6-20261004.txt','web-final.txt')]:copy(src,name)
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
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-music-rights-records-20261004.py','verify-checkpoint.py')
(out/'followup.md').write_text('Original native Music rights records and four-kind recovery.\n\nThe normal Android/iOS/macOS original UI now displays authenticated own-account Music case records in Library and Creator; Apple track detail selects its original track. It displays actual original kind, reason, case reference, track title or unavailable-track label, actual original status and optional Trust reference. Records are ordered by original CreatedAt; Apple localizes the original date. Unknown original requests are not cleared merely because a record/reference is visible. NEW author takedown requests are now available through the same original owned-track dialog/model; the original server ownership rule and durable intent/receipt gate remain unchanged. No record display claims a review decision or immediate takedown.\n\nAll original report/unavailable provider/local-only/tamper/foreign/old-epoch/pause/same-body/confirmed-lost-reply checks are retained. Actual original generated SDK, original client API/controller/store or Apple model, and original Go Music HTTP execute report, foreign-track dispute, owner appeal and owner takedown. Each original logical request receives exactly one original case and one explicitly isolated HTTPS provider dispatch. For each new kind the successful native reply is lost, the original intent remains, cold original SDK/cache restores the original key, and the matching original case/receipt acknowledges it. Each newly read record must match original actor, track, reason, evidence and reference. Foreign NEW appeal/takedown each produces original HTTP403 without a case or SDK logout. Original audio drafts and original creator/library counts remain protected.\n\nOriginal status contract is open before a verified provider reference and submitted_to_trust after LinkCentralCase. Neither status is a decision. The first expanded test at 2659 incorrectly expected open after linkage; the original unchanged service returned submitted_to_trust. Original failed focused logs/receipt and the exact source commit are retained, not hidden or blamed on SDK/permission. dc439 corrects the test to the original producer contract and adds the correct localized submitted status. The original Go service/protocol/scopes/effect admission/UNKNOWN policy are unchanged.\n\nNew complete Android full lint/debug package and Apple unsigned complete iOS/macOS builds match current source exactly; original six SDK assets, packaged file bytes, original brand decoded pixels and all current compiled source pins are checked. Final full race/vet and focused original business evidence are frozen. Existing unchanged ordinary-cache probe results are inherited with their original scope, not called new SDK admission. Root910 SOURCE_PASS remains only historical cache-field acceptance. This new rights/UI source graph is still pending independent source review and is not formal deployment.\n\nThe original producer contract document supplies exact original route/body/key/header/receipt/UNKNOWN and currentActor requirements to the unique shared/publisher owner. It explicitly avoids assuming that the inherited Trust product reference is the current A producer. No shared actor proof, adapter, operator endpoint, grant, final-decision read or reconciliation URL is invented. Current original Music provides no authenticated final shared Trust outcome. Actual compatible shared producer/currentActor/matching clients/Host plus real Wallet/install/native rendered UI/live Trust and final outcome acceptance remain open. Earlier 120-second Creator iOS full-run timeout remains inherited NOT_CONFIRMED; final greens do not establish its cause.\n')
for name in ['combined-go-race.jsonl','combined-source-receipt.json']:
 copy(pathlib.Path('/tmp/ynx-music-rights-records-focused-20261004')/name,'first-status-contract-failure-'+name)
copy('/tmp/ynx-music-rights-records-focused-20261004.txt','first-status-contract-failure-stdout.txt')
copy(root/'apps/music/audit/contracts/native-rights-producer-contract-20261004.md','native-rights-producer-contract.md')
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in apple_candidates]}
checkpoint=dict(schema='ynx.music.rights-records-recovery.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,androidCandidateSourceCommit=android['sourceCommit'],appleCandidateSourceCommit=apple['sourceCommit'],sourceHoldStatus='CLOSED_FOR_MEDIA6288_CACHE_P2_ONLY',sourceReview=dict(cacheFieldMerge='BOUNDED_OWNED_SOURCE_PASS',sourceCommit='9105695d09f64d01c6e3e079de2875752d5d8603',trustSDKAuthority='NOT_INDEPENDENTLY_ADMITTED',nativeRightsRepair='PENDING_ROOT_SOURCE_REVIEW',formalRelease='NOT_VERIFIED'),rootCounterexampleCheckpoint='apps/music/audit/evidence/stale-ui-cache-counterexample-20261004/SOURCE_REPORT.md',nativeSourcePinsCurrentGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',androidBuildAndFullLint='PASS',appleFullBuilds='PASS',originalSameKeyTrustRetrySingleCase=True,unconfirmedTrustIntentRetained=True,originalTrustConfirmedLostReplyRecovery=True,isolatedHTTPSProviderDispatchesPerNativeActor=4,isolatedHTTPSProviderDispatchesPerOriginalKind=1,originalCaseCountAfterConfirmedColdReplay=4,webFreshPageOriginalIntentRecovery=True,webConfirmedReceipt='ISOLATED_SYNTHETIC_UI_ONLY',actualCentralTrustAcceptance=False,originalAudioDraftPreserved=True,originalBrandPixelsExact=True,actualInstalledNativeUI=False,actualWalletConsent=False,ownerExactRootCacheProbe='5PASS0FAIL_CACHE_ONLY',latestStoreFieldTransactions=True,foreignOwnerAppealRejectedWithoutLogout=True,originalOwnerHTTP403PerNativeActor=2,originalPausedCaseColdSameKeyRecovery=True,originalPausedSameBodyStageReusesKey=True,localPauseDoesNotWithdraw=True,retainedHistoryCapacity=64,localesComplete=12,localeKeys=90,nativeAllRightsKindsColdRecovery=True,nativeOriginalCaseRecordsReadback=True,originalCaseBeforeReceiptStatus="open",originalCaseAfterReceiptStatus="submitted_to_trust",trustReferenceIsNotDecision=True,firstStatusAssertionFailure="RETAINED_INCORRECT_OPEN_EXPECTATION",earlierCreatorIOSFullSuiteTimeout='RETAINED_CAUSE_NOT_CONFIRMED',creatorStageDiagnostics='OPT_IN_METADATA_ONLY_ORIGINAL_TIMEOUTS_UNCHANGED'),producerContract=pin(root/'apps/music/audit/contracts/native-rights-producer-contract-20261004.md'),inheritedCheckpoint=pin(inherited_path),remaining=[item for item in inherited['remaining'] if item not in ['Root successor independent review before SOURCE_HOLD may close','Native non-owner appeal selection requires owned UX/intent audit; original owner gate remains authoritative']]+['Native four-kind rights record/UI independent source review pending','Actual protected shared Trust decision/read/reconciliation producer contract required before final-outcome handling'],publicReadback=inherited['publicReadback'],evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/rights-records-recovery-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,passEvents=passed)))
