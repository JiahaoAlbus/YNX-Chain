import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,tempfile,zipfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip()
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
def exact(p):
 b=subprocess.check_output(['git','show',head+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-media-music-trust-intent-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events);assert passed>=450 and failed==0
out=root/'apps/music/audit/evidence/trust-intent-recovery-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
def archive(path,values):
 with path.open('xb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w') as tar:
    for name,data,mode in values:
     item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
 return {**pin(path),'fileCount':len(values)}
inherited_path=root/'apps/music/audit/android-library-cache-checkpoint-20261004.json';inherited=json.loads(inherited_path.read_bytes())
with tarfile.open(root/inherited['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',inherited['sourceCommit'],head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data;mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0];values.append((name,data,0o755 if mode=='100755' else 0o644))
source=archive(out/'media-owned-source.tar.gz',values)
androiddir=pathlib.Path('/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-music-android-native-g71Kh2');appledir=pathlib.Path('/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-music-apple-native-b9rEN3')
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
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-music-trust-intent-native-focused-20261004')/name,'native-focused-'+name)
for src,name in [('/tmp/ynx-music-trust-intent-java-r2-20261004.json','compiled-java-source.json'),('/tmp/ynx-music-trust-intent-swift-r2-20261004/apple-music-engine-check.json','compiled-swift-source.json'),('/tmp/ynx-music-trust-intent-java-compile-r2-20261004.txt','java-compile.txt'),('/tmp/ynx-music-trust-intent-swift-compile-r2-20261004.txt','swift-compile.txt'),('/tmp/ynx-music-trust-business-web-r6-20261004.txt','web-final.txt')]:copy(src,name)
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
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-music-trust-intent-20261004.py','verify-checkpoint.py')
(out/'followup.md').write_text('''Music Trust request recovery, Android/Apple/Web.

Baseline retained at apps/music/audit/evidence/android-trust-original-duplicate-20261004: actual original Java API, original pinned SDK and original Go HTTP created two local cases when two normal fresh-key requests encountered unconfigured Trust. This baseline deliberately asserts the defect; it is not the repaired regression.

All three normal submit paths now save one account-bound original operation key and exact normalized request contents before HTTP. They reject replacement of an unresolved request. Same-account normal original SDK restore uses a fresh original proof but retries the same operation. Account replacement/retired SDK contexts cannot send or acknowledge it. Existing original credentials, account directories, upload bytes, profiles, library data and scopes remain unchanged. Original service behavior, permission gates and delegated-effect unknown-outcome hold remain unchanged; no forced upstream resend or invented success. Only an exact matching case receipt with nonempty Central case ID clears the matching pending intent. A local case projection without Central receipt remains pending.

Actual Java production controller/store/API + original SDK/Go regression checks caller mutation, duplicate staging rejection, unavailable Trust, cold original SDK retry with one local case, retired SDK veto, changed-body conflict, local-only receipt rejection, other-account cache isolation, and original audio draft retention. Actual Apple production model/API/store + original SDK/Go confirms unavailable Trust remains pending across cold same-account recovery and reuses the key, retaining one local case. The native fixtures do not establish Central Trust acceptance or installed native UI/OS custody.

Web Playwright drives normal Dispute and Library retry controls against explicit isolated UI responses: lost Music reply after a synthetic receipt, a local-only response, account replacement, fresh-page reopen with durable IndexedDB recovery, exact same original key/body, and matching synthetic confirmation clearing once. This browser fixture is not actual Wallet authorization or real Central Trust. Initial QA-only failures (guest message/MJS MIME, wrong Creator selector, implicit Playwright context) and compiler diagnostics are retained separately from the final pass; final fixture uses the existing actual entry controls and explicit same-origin browser context.

Current full original SDK/Swift/Java/Go race suite and vet pass. Android full build/lint/debug signature/identity and original six SDK assets pass. Full iOS Simulator and macOS native builds pass; candidates are unsigned/uninstalled and decoded original brand pixels match. Build source commit e14c88af1503c24afb8af561e53a0ea5af2a4354 precedes a QA-only browser-context correction; every native build and composition input pin is independently checked against the final frozen source commit. No product source is inferred from a chat or public alias.

Formal Host/currentActor/matching-client deployment and real Wallet/OS/device/codec/AI/Pay/Trust/user acceptance remain unverified. Public readback is inherited with its original timestamp. This engineering checkpoint is not a release receipt.
''')
excluded={pathlib.Path(source['path']).name,pathlib.Path(apk['path']).name,*[pathlib.Path(c['path']).name for c in apple_candidates]}
checkpoint=dict(schema='ynx.music.trust-intent-recovery.checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceCommit=head,sourceTree=tree,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,nativeCandidateSourceCommit=android['sourceCommit'],nativeSourcePinsCurrentGitExact=True,compositionInputPins=len(receipt['inputPins']),ownedCompositionPinsGitExact=True,checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',androidBuildAndFullLint='PASS',appleFullBuilds='PASS',originalSameKeyTrustRetrySingleCase=True,unconfirmedTrustIntentRetained=True,webFreshPageOriginalIntentRecovery=True,webConfirmedReceipt='ISOLATED_SYNTHETIC_UI_ONLY',actualCentralTrustAcceptance=False,originalAudioDraftPreserved=True,originalBrandPixelsExact=True,actualInstalledNativeUI=False,actualWalletConsent=False),inheritedCheckpoint=pin(inherited_path),remaining=inherited['remaining']+['Actual Central Trust receipt and user acceptance'],publicReadback=inherited['publicReadback'],evidence=[pin(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in excluded])
path=root/'apps/music/audit/trust-intent-recovery-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n');print(json.dumps(dict(checkpoint=pin(path),sourceCommit=head,sourceArchive=source,androidCandidate=apk,appleCandidates=apple_candidates,passEvents=passed)))
