import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-media-music-field-merge-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/field-merge-recovery-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/music/audit/trust-intent-recovery-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
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
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-music-trust-intent-native-focused-20261004')/name,'inherited-trust-native-focused-'+name)
for src,name in [('/tmp/ynx-music-field-merge-java-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-trust-intent-swift-r2-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-field-merge-java-compile-20261004.txt','java-compile.txt'),('/tmp/ynx-music-trust-intent-swift-compile-r2-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-trust-business-web-r6-20261004.txt','web-final.txt')]:copy(src,name)
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
copy('/tmp/ynx-music-field-merge-cache-check-20261004.txt','owner-field-cache-check.txt');copy('/tmp/ynx-music-field-merge-root-probe-20261004.txt','owner-exact-root-probe-check.txt');copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-music-field-merge-20261004.py','verify-checkpoint.py')
(out/'followup.md').write_text('Current cache successor details are in field-merge-followup.md. Prior Android/Apple/Web Trust baseline and behavior are retained in the inherited trust-intent-recovery-checkpoint-20261004.json; the inherited native-focused logs apply to that earlier source. Current full SDK/composition and Android build receipts are separate and pinned to this successor. SOURCE_HOLD remains pending successor independent review.\n')
(out/'field-merge-followup.md').write_text("Successor to the original Music Trust checkpoint, including the Root6288 P2 cache repair.\n\nRoot exact original probe/report/closure/failure hashes are retained in stale-ui-cache-counterexample-20261004. Owner reproduced the old MusicStore stale-UI whole-cache replacement at afa19 independently with disposable JVM files. This explains a real missing ordinary-cache boundary despite prior450/native green. No SDK grant/HTTP/Wallet/device is established by those cache checks.\n\nprepareLibrary now reloads the latest account state under the original WRITE_LOCK and applies only supplied favorite/queue fields. Downloads come only from commitDownload's latest-state original WAV verification. MainActivity toggleLibrary applies its one toggle to current persisted favorites or queue in that same transaction, preserving a newer other list and every unrelated cache field. Durable libraryIntent captures this current merged tuple. Pending upload/Trust/playlist selectors, original remote profile/playlists, verified downloaded markers and playback position remain intact.\n\nAudited every ordinary full-candidate write in Android Activity and PlaybackService: they now use explicit latest-store field transactions for AI preference, playback cursor, playlist stage, matching original key/body ACK and explicit captured-key discard. An older playlist completion cannot consume a successor. Upload ACK removes only its matching uploadIntent and no longer restores an older complete remote snapshot. Normal original snapshot ordering/publishing remains the existing source-owned read boundary. Existing credentials, state schema, ownership, service protocol, SDK scopes, role permissions, timeouts and codec behavior are unchanged.\n\nOwner reran the exact Root probe without editing its source: five positive tests including the original P2 now pass, upload=true/position99/newer playlist/staged audio=true. Original four positive guards remain. Additional ordinary field-cache regression checks current-list toggling, newer queue/download preservation, case/upload selectors, AI/playback field writes, matching playlist ACK, old ACK/successor veto, upload ACK/remote ordering, and foreign-account write rejection. These are explicitly cache-only, not actualSDK proof/device acceptance. The new actual Java API/Store/Writer/Upload/Trust bundle is separately pinned and exercised in the full actual SDK/original Go service suite. Apple/Web Trust recovery and native candidates inherit the unchanged current-exact pins from the previous Trust checkpoint.\n\nAll current native build/composition source pins are verified against this successor source. Android candidate comes from the new source; Apple candidates come from unchanged e14 source pins and retain exact package bytes. Source archive and original packaged SDK/brand pixels are independently verified. Root SOURCE_HOLD remains pending successor independent review; owner checks/full450/build green do not close it. Formal Host/currentActor/matching-client delivery and real Wallet/install/device/large-media/codec/AI/Pay/Trust/user acceptance remain separate and unverified.\n")
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in apple_candidates]}
checkpoint=dict(schema='ynx.music.field-merge-recovery.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,androidCandidateSourceCommit=android['sourceCommit'],appleCandidateSourceCommit=apple['sourceCommit'],sourceHoldStatus='PENDING_SUCCESSOR_INDEPENDENT_REVIEW',rootCounterexampleCheckpoint='apps/music/audit/evidence/stale-ui-cache-counterexample-20261004/SOURCE_REPORT.md',nativeSourcePinsCurrentGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',androidBuildAndFullLint='PASS',appleFullBuilds='PASS',originalSameKeyTrustRetrySingleCase=True,unconfirmedTrustIntentRetained=True,webFreshPageOriginalIntentRecovery=True,webConfirmedReceipt='ISOLATED_SYNTHETIC_UI_ONLY',actualCentralTrustAcceptance=False,originalAudioDraftPreserved=True,originalBrandPixelsExact=True,actualInstalledNativeUI=False,actualWalletConsent=False,ownerExactRootCacheProbe='5PASS0FAIL_CACHE_ONLY',latestStoreFieldTransactions=True),inheritedCheckpoint=pin(inherited_path),remaining=inherited['remaining']+['Root successor independent review before SOURCE_HOLD may close'],publicReadback=inherited['publicReadback'],evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/field-merge-recovery-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,passEvents=passed)))
