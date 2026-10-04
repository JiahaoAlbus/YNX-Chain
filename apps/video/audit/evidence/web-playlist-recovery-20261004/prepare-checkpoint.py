import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime
root=pathlib.Path.cwd();source=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();sha=lambda b:hashlib.sha256(b).hexdigest()
out=root/'apps/video/audit/evidence/web-playlist-recovery-20261004'
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def exact(p):
 b=subprocess.check_output(['git','show',source+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-video-web-playlist-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);assert passed>=450 and not any(e.get('Action')=='fail' for e in events)
priorpath=root/'apps/video/audit/playlist-pause-recovery-checkpoint-20261004.json';prior=json.loads(priorpath.read_bytes())
with tarfile.open(root/prior['sourceArchive']['path']) as tar:names={m.name for m in tar if m.isfile()}
for name in subprocess.check_output(['git','diff','--name-only',prior['sourceCommit'],source,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines():
 if '/audit/' not in name and (root/name).is_file():names.add(name)
values=[]
for name in sorted(names):
 data=subprocess.check_output(['git','show',source+':'+name]);assert data==(root/name).read_bytes();mode=subprocess.check_output(['git','ls-tree',source,'--',name]).decode().split()[0];assert mode in ['100644','100755'];values.append((name,data,0o755 if mode=='100755' else 0o644))
out.mkdir(parents=True,exist_ok=False)
archive=out/'media-owned-source.tar.gz'
with archive.open('xb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as tar:
 for name,data,mode in values:
  item=tarfile.TarInfo(name);item.size=len(data);item.mode=mode;item.mtime=0;tar.addfile(item,io.BytesIO(data))
def copy(src,name):
 p=out/name;shutil.copyfile(src,p);return pin(p)
web=copy('/tmp/ynx-video-web-playlist-runtime-20261004.tar.gz','video-web-runtime.tar.gz')
with tarfile.open(root/web['path']) as tar:
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==source
 assert 'playlist-journal.js' in manifest['files'] and 'playlist-recovery.js' in manifest['files']
 for name,p in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==p['bytes'] and sha(b)==p['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
(out/'web-runtime-build-receipt.json').write_text(json.dumps({'sourceCommit':source,'runtime':web,'files':manifest['files'],'everyPackagedSourceFileGitExact':True,'published':False},indent=2)+'\n')
base=root/'apps/video/audit/evidence/playlist-pause-recovery-20261004';native=[]
for platform in ['android','apple']:
 build=json.loads((base/(platform+'-build-receipt.json')).read_bytes())
 for p in build['sourcePins']:exact(p)
 native.append({'platform':platform,'receipt':pin(base/(platform+'-build-receipt.json')),'currentSourcePinsGitExact':True,'sourcePins':len(build['sourcePins']),'recompiledThisBatch':False})
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:
 copy(compose/name,name);copy(pathlib.Path('/tmp/ynx-video-web-playlist-original-focus-r3-20261004')/name,'focused-'+name)
for name in ['combined-go-race.jsonl','combined-source-receipt.json']:copy(pathlib.Path('/tmp/ynx-video-web-playlist-original-focus-20261004')/name,'first-picker-assertion-failure-'+name)
for p in sorted(compose.glob('*.png')):copy(p,p.name)
for p in sorted(pathlib.Path('/tmp/ynx-video-web-playlist-original-focus-r2-20261004').glob('*.png')):copy(p,'before-mobile-nav-'+p.name)
for src,name in [('/tmp/ynx-video-web-playlist-display-check-20261004.txt','display-first-invocation-failure.txt'),('/tmp/ynx-video-web-playlist-display-check-r2-20261004.txt','display-widths-final.txt'),('/tmp/ynx-video-web-playlist-web-check-20261004.txt','web-first-navigation-fixture-failure.txt'),('/tmp/ynx-video-web-playlist-web-check-r3-20261004.txt','web-final-171.txt'),('/tmp/ynx-video-web-playlist-guest-r2-20261004.txt','guest-navigation-final.txt'),('/tmp/ynx-video-web-playlist-journal-20261004.txt','chromium-indexeddb-15.txt')]:copy(src,name)
journal=json.loads((out/'chromium-indexeddb-15.txt').read_bytes());assert len(journal['passed'])==15 and journal['actualIndexedDB'] and not journal['actualPrivateSDK']
for p in journal['sourcePins']:exact(p)
assert 'pass 171' in (out/'web-final-171.txt').read_text()
assert 'PASS 144 actual browser visual states' in (out/'display-widths-final.txt').read_text()
(out/'followup.md').write_text('Original Video Web playlist recovery, both existing real product entry points. Ordinary IndexedDB records are derived only from the current exact verified YNX actor and kept separately from Wallet keys/credentials. A serialized account slot preserves the original Name/body and UUID before dispatch. Both normal Library creation and watching-page new-playlist saving use the same original record. Original service UTF8 1..100-byte name validation precedes persistence. Only matching original returned ID/Owner/Name plus authenticated original own-list readback can ACK the exact pending key/body. Unknown replies remain retained, pause does not cancel server content, 64 history capacity never deletes earlier rows, same-name and explicit recovery restore the same key, corrupted records remain untouched, and explicit own-data deletion only clears the original account after actual protected service deletion. Navigation/account retirement fences all dispatch, reads and late dialog updates.\n\nActual pinned SDK/protected Chromium device, original BrowserSSO/combined original actor, owned real UI and original Go service execute both journeys. For each create, the successful original reply is deliberately made unreadable, the original record remains, reload retains original protected identity and ordinary cache, and the second original-key/body dispatch reads the same own-created record. The Library path additionally pauses, creates a separate successor and restores the original. The watching path additionally confirms exactly the original published disposable fixture video in the recovered playlist. Controlled extra QA lists are removed; the original preexisting QA list remains. No new grant, sameRequester claim or provider alias is invented. Actual Go required receipt gates validate both journeys and exact two attempts per original request. Real Wallet/production Host/currentActor/native installed codecs/user acceptance remain unverified.\n\nA separate real Chromium IndexedDB check covers 15 actual-cache gates including cross-tab serialization, cold pause, old ACK versus successor, foreign isolation, capacity, invalid UTF8, storage failure/no dispatch, wrong-owner retention, current-context retirement, exact own deletion and corruption preservation. Its API and actor are isolated, not actual SDK/business evidence. Complete original private SDK journeys separately prove the integration. First full Web checks failed because old import-stripping navigation fixtures omitted the new dependency; the old synthetic fixtures now explicitly supply only empty ordinary-cache reads. First protected browser check raced the async restored picker and saw its empty pre-read input. It now waits for the actual restored dialog before the same original-key/content assertions; original failure retained. Earlier Creator timeout cause remains NOT_CONFIRMED through the inherited checkpoint.\n\nControlled 390 and 1440 captures inspected. The inherited mobile horizontal nav used 100-percent-width buttons, leaving a single destination occupying the bar; a narrow original CSS repair gives destinations their content widths and a real width assertion guards it. Restored names wrap without HTML interpretation. Current exact Web runtime packages both new modules and their MIME/public routes. Unchanged native build artifacts are inherited with all 31 Android and 23 Apple source pins rechecked against current Git; this batch does not claim new native builds. Source review and exact formal release remain pending.\n')
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-video-web-playlist-20261004.py','verify-checkpoint.py')
remaining=[x for x in prior['remaining'] if x!='Web both create-playlist entry points need durable original-key recovery'];remaining += ['Independent current Web playlist and inherited native source graph review pending','Formal Video own-account login/business/cold recovery through unique A matching Host/client still unverified']
f={'schema':'ynx.video.web-playlist-recovery.checkpoint.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':source,'sourceTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip(),'inheritedCheckpoint':pin(priorpath),'sourceArchive':{**pin(archive),'fileCount':len(values)},'webRuntime':web,'unchangedNativeBuildPins':native,'checks':{'fullGoRacePassEvents':passed,'fullGoRaceFailures':0,'vet':'PASS','compositionInputs':len(receipt['inputPins']),'webChecks':171,'syntheticVisualStates':144,'syntheticVisualScope':'Shipped DOM/font/brand/callback stress only; not actual Wallet/private business or every translated label','actualChromiumIndexedDBGates':15,'originalLibraryCreateColdKeyRecovery':True,'originalWatchingPickerCreateColdKeyRecovery':True,'originalRequestDispatchesEach':2,'noDuplicatePlaylistAfterColdRetry':True,'nativeBuildsUnchanged':True,'mobileNavigationWidthGate':'PASS <250px per destination at390','renderedControlledWebWidths':[390,1440],'actualWalletConsent':False,'actualFormalHostCurrentActor':False,'productionPublished':False,'earlierCreatorTimeoutCause':'NOT_CONFIRMED'},'remaining':remaining,'evidence':[pin(p) for p in sorted(out.iterdir()) if p.is_file()]}
p=root/'apps/video/audit/web-playlist-recovery-checkpoint-20261004.json';p.write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'checkpoint':pin(p),'sourceArchive':f['sourceArchive'],'runtime':web,'fullPass':passed,'inputs':len(receipt['inputPins'])}))
