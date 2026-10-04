import pathlib,subprocess,json,hashlib,tarfile,zipfile,tempfile
root=pathlib.Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();f=json.loads(subprocess.check_output(['git','show',head+':apps/music/audit/trust-appeal-recovery-checkpoint-20261004.json']));source=f['sourceCommit'];refs={}
sha=lambda b:hashlib.sha256(b).hexdigest()
def walk(x):
 if isinstance(x,dict):
  if all(k in x for k in ('path','bytes','sha256')) and x['path'].startswith('apps/'):refs[x['path']]=(x['bytes'],x['sha256'])
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
walk(f)
for path,(size,digest) in refs.items():
 b=subprocess.check_output(['git','show',head+':'+path]);assert len(b)==size and sha(b)==digest,path
with tarfile.open(root/f['sourceArchive']['path']) as tar:
 members=[m for m in tar if m.isfile()];assert len(members)==f['sourceArchive']['fileCount']
 assert len({m.name for m in members})==len(members) and len(tar.getmembers())==len(members)
 for m in members:
  assert not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts
  assert tar.extractfile(m).read()==subprocess.check_output(['git','show',source+':'+m.name]),m.name
  mode=subprocess.check_output(['git','ls-tree',source,'--',m.name]).decode().split()[0];assert m.mode==(0o755 if mode=='100755' else 0o644),m.name
base=root/'apps/music/audit/evidence/trust-appeal-recovery-20261004';r=json.loads((base/'combined-source-receipt.json').read_bytes());assert len(r['results'])==2 and all(x['exitCode']==0 for x in r['results'])
def exact(p):
 b=subprocess.check_output(['git','show',source+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
for p in r['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in r[key]['sourcePins']:exact(p)
android=json.loads((base/'android-build-receipt.json').read_bytes());apple=json.loads((base/'apple-build-receipt.json').read_bytes());assert android['sourceCommit']==f['androidCandidateSourceCommit'] and apple['sourceCommit']==f['appleCandidateSourceCommit'];assert android['lint']=='PASS full lintDebug'
for build in [android,apple]:
 for p in build['sourcePins']:exact(p)
assert android['apk']['bytes']==f['androidCandidate']['bytes'] and android['apk']['sha256']==f['androidCandidate']['sha256']
with zipfile.ZipFile(root/f['androidCandidate']['path']) as z:
 for p in android['sourcePins']:
  if '/assets/native-session/' in p['path']:
   b=z.read('assets/'+p['path'].split('/assets/')[1]);assert len(b)==p['bytes'] and sha(b)==p['sha256']
pixelbin='/tmp/ynx-music-trust-brand-independent-20261004';subprocess.run(['xcrun','swiftc',str(base/'compiled-brand-pixel-check.swift'),'-o',pixelbin],check=True)
for c in f['appleCandidates']:
 original=next(x for x in apple['candidates'] if x['scheme']==c['scheme'])
 with tarfile.open(root/c['path']) as tar:
  members={m.name:m for m in tar if m.isfile()};assert len(members)==c['fileCount']==len(original['files'])
  for p in original['files']:
   name=pathlib.Path(original['app']).name+'/'+p['path'];b=tar.extractfile(members[name]).read();assert len(b)==p['bytes'] and sha(b)==p['sha256']
  with tempfile.TemporaryDirectory(prefix='ynx-music-trust-brand-independent-') as tmp:
   image=pathlib.Path(tmp)/'compiled.png';m=next(m for m in members.values() if m.name.endswith('/ynx-brand-original.png'));image.write_bytes(tar.extractfile(m).read());subprocess.run([pixelbin,str(root/'apps/music/ios/YNXMusic/ynx-brand-original.png'),str(image)],check=True,stdout=subprocess.DEVNULL)
with tempfile.TemporaryDirectory(prefix='ynx-music-trust-android-independent-') as tmp:
 image=pathlib.Path(tmp)/'compiled.png'
 with zipfile.ZipFile(root/f['androidCandidate']['path']) as z:image.write_bytes(z.read('res/drawable-nodpi-v4/ynx_brand_original.png'))
 subprocess.run([pixelbin,str(root/'apps/music/android/app/src/main/res/drawable-nodpi/ynx_brand_original.png'),str(image)],check=True,stdout=subprocess.DEVNULL)
events=[json.loads(l) for l in (base/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passes=sum(x.get('Action')=='pass' for x in events);failures=sum(x.get('Action')=='fail' for x in events);assert passes==f['checks']['fullGoRacePassEvents']>=450 and failures==0
web=(base/'web-final.txt').read_text();assert 'fresh-page reopen' in web and 'zero browser errors' in web and 'Standard Wallet approve/reject' in web
assert f['sourceHoldStatus']=='CLOSED_FOR_MEDIA6288_CACHE_P2_ONLY'
assert f['sourceReview']['cacheFieldMerge']=='BOUNDED_OWNED_SOURCE_PASS'
closure=json.loads((base/'root-cache-source-closure.json').read_bytes())
assert closure['disposition']=='BOUNDED_OWNED_SOURCE_PASS' and closure['sourceCommit']==f['sourceReview']['sourceCommit']
assert sha((base/'root-cache-source-closure.json').read_bytes())=='2a1b049013c0a178c32e4ca8df5d943676756697971f0dce225e05c9cd3b2e1f'
for name in ['SOURCE_REPORT.md','independent-original-cache-check.log','independent-field-check.log','independent-field-boundary.log','independent-build.json']:
 assert sha((base/('root-cache-'+name.replace('.log','.txt'))).read_bytes())==closure['hashes'][name]
assert f['checks']['originalTrustConfirmedLostReplyRecovery']==True
assert f['checks']['foreignOwnerAppealRejectedWithoutLogout']==True
assert f['checks']['originalPausedCaseColdSameKeyRecovery']==True
assert f['sourceReview']['nativeRightsRepair']=='PENDING_ROOT_SOURCE_REVIEW'
assert f['checks']['isolatedHTTPSProviderDispatchesPerNativeActor']==1
assert f['checks']['originalCaseCountAfterConfirmedColdReplay']==1
assert sum('original Trust success/lost-native-reply/cold-original-key replay: one original case, one isolated HTTPS provider dispatch' in e.get('Output','') for e in events)==3
assert 'RESULT pass=5 fail=0 SDK/auth/network/device=NOT_RUN' in (base/'owner-exact-root-probe-check.txt').read_text()
assert json.loads((base/'owner-field-cache-check.txt').read_text())['cacheOnly']==True
prior=json.loads((base/'earlier-full-timeout-combined-source-receipt.json').read_bytes());assert prior['results'][0]['exitCode']==1
priorEvents=[json.loads(l) for l in (base/'earlier-full-timeout-combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')]
assert any(e.get('Action')=='fail' and e.get('Test','').endswith('creator-studio:ios') and 119<e['Elapsed']<125 for e in priorEvents)
assert f['checks']['earlierCreatorIOSFullSuiteTimeout']=='RETAINED_CAUSE_NOT_CONFIRMED'
assert sum('original Creator opt-in stage trace:' in e.get('Output','') for e in events)==2
assert f['checks']['actualCentralTrustAcceptance']==False and f['checks']['actualWalletConsent']==False
print(json.dumps(dict(independentVerify='PASS',sourceCommit=source,deliveryCommit=head,gitReferences=len(refs),sourceArchiveMembers=f['sourceArchive']['fileCount'],compositionInputs=len(r['inputPins']),fullGoRacePassEvents=passes,fullGoRaceFailures=failures,androidSourcePins=len(android['sourcePins']),appleSourcePins=len(apple['sourcePins']),originalBrandPixelChecks=3,actualWalletConsent=False,actualCentralTrustAcceptance=False)))
