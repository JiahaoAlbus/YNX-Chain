import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime
root=pathlib.Path.cwd();source=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip();sha=lambda b:hashlib.sha256(b).hexdigest()
out=root/'apps/video/audit/evidence/playlist-operations-recovery-20261004'
def pin(p):
 b=p.read_bytes();return {'path':str(p.relative_to(root)),'bytes':len(b),'sha256':sha(b)}
def exact(p):
 b=subprocess.check_output(['git','show',source+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
compose=pathlib.Path('/tmp/ynx-video-playlist-ops-full-20261004');receipt=json.loads((compose/'combined-source-receipt.json').read_bytes());assert all(r['exitCode']==0 for r in receipt['results'])
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for key in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[key]['sourcePins']:exact(p)
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')];passed=sum(e.get('Action')=='pass' for e in events);assert passed>=450 and not any(e.get('Action')=='fail' for e in events)
priorpath=root/'apps/video/audit/web-playlist-recovery-checkpoint-20261004.json';prior=json.loads(priorpath.read_bytes())
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
web=copy('/tmp/ynx-video-playlist-ops-runtime-20261004.tar.gz','video-web-runtime.tar.gz')
with tarfile.open(root/web['path']) as tar:
 manifest=json.load(tar.extractfile('runtime/runtime-manifest.json'));assert manifest['sourceCommit']==source
 for name,p in manifest['files'].items():
  b=tar.extractfile('runtime/'+name).read();assert len(b)==p['bytes'] and sha(b)==p['sha256'];assert b==subprocess.check_output(['git','show',source+':apps/video/'+name])
 assert {'playlist-journal.js','playlist-recovery.js'}<=set(manifest['files'])
(out/'web-runtime-build-receipt.json').write_text(json.dumps({'sourceCommit':source,'runtime':web,'files':manifest['files'],'everyPackagedSourceFileGitExact':True,'published':False},indent=2)+'\n')
native=[]
for entry in prior['unchangedNativeBuildPins']:
 build=json.loads((root/entry['receipt']['path']).read_bytes())
 for p in build['sourcePins']:exact(p)
 native.append({**entry,'currentSourcePinsGitExact':True,'recompiledThisBatch':False})
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:
 copy(compose/name,name);copy(pathlib.Path('/tmp/ynx-video-playlist-ops-focus-20261004')/name,'focused-'+name)
for p in sorted(compose.glob('*.png')):copy(p,p.name)
for src,name in [('/tmp/ynx-video-playlist-ops-runtime-20261004.txt','runtime-first-short-SHA-rejection.txt'),('/tmp/ynx-video-playlist-ops-runtime-r2-20261004.txt','runtime-final.txt'),('/tmp/ynx-video-playlist-ops-web-20261004.txt','web-final-171.txt'),('/tmp/ynx-video-playlist-ops-idb-20261004.txt','chromium-indexeddb-22.txt')]:copy(src,name)
journal=json.loads((out/'chromium-indexeddb-22.txt').read_bytes());assert len(journal['passed'])==22 and journal['actualIndexedDB'] and not journal['actualPrivateSDK']
for p in journal['sourcePins']:exact(p)
assert 'pass 171' in (out/'web-final-171.txt').read_text()
(out/'followup.md').write_text('Original Video playlist membership and deletion recovery. Add/remove/delete persist the original account-derived ordinary journal before mutation, in a new namespace separate from existing create records and Wallet state. Original own-list readback must contain only the original owner and unambiguous IDs/memberships. A retained exact operation can be ACKed when that protected read proves its requested final state, without sending DELETE against an already removed membership or playlist. This is desired-state confirmation, not an assertion about which concurrent actor caused it. A new absent-target deletion is rejected. Unknown or undesired reply/readback retains the original metadata and key. Cold picker restores the original add target and disables substitutions; Library and single-list views expose exact original retry. Account/revision/view retirement fences apply. The operation UI currently has retry, without a pause/history control. Existing create pause/history behavior is preserved. No original Go service, shared SDK/Auth/Host or Wallet key namespace change.\n\nActual original protected BrowserSSO/combined SDK and Go service plus normal product UI execute add/remove/delete success with deliberately unreadable HTTP200 replies. Cold add through the normal picker, and remove/delete through the Library retry, confirm original own state with exactly one mutation each in these controlled journeys. All original create journeys remain required with two original-key/body attempts each. Go receipt gates require all three new operations, original create gates and original one retained QA list. Only isolated QA-created lists are deleted. Twenty-two actual Chromium IndexedDB gates cover create preservation and operations with isolated actor/API, separately from actual private integration.\n\nOriginal full race and vet, Web171 and all inherited native compiled pins are verified. Native candidates are unchanged; no new native build/install/launch or Wallet consent claim. Initial runtime invocation rejected a short SHA before output; rerun uses the exact full source commit and every packed source file is Git-exact. Prior failed tests and unexplained Creator timeout remain retained by the inherited checkpoint. Formal A matching Host/currentActor/client, actual Wallet, installed codec, Trust result contract and user acceptance remain open. Host UNKNOWN is not probed.\n')
copy(__file__,'prepare-checkpoint.py');copy('/tmp/verify-video-playlist-ops-20261004.py','verify-checkpoint.py')
f={'schema':'ynx.video.playlist-operations-recovery.checkpoint.v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':source,'sourceTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}']).decode().strip(),'inheritedCheckpoint':pin(priorpath),'sourceArchive':{**pin(archive),'fileCount':len(values)},'webRuntime':web,'unchangedNativeBuildPins':native,'checks':{'fullGoRacePassEvents':passed,'fullGoRaceFailures':0,'vet':'PASS','compositionInputs':len(receipt['inputPins']),'webChecks':171,'actualChromiumIndexedDBGates':22,'originalLibraryCreateColdKeyRecovery':True,'originalWatchingPickerCreateColdKeyRecovery':True,'originalCreateRequestDispatchesEach':2,'originalAddRemoveDeleteColdReadbackRecovery':True,'originalOperationMutationDispatchesEach':1,'nativeBuildsUnchanged':True,'renderedControlledWebWidths':[390,1440],'actualWalletConsent':False,'actualFormalHostCurrentActor':False,'productionPublished':False,'earlierCreatorTimeoutCause':'NOT_CONFIRMED'},'remaining':prior['remaining'],'evidence':[pin(p) for p in sorted(out.iterdir()) if p.is_file()]}
p=root/'apps/video/audit/playlist-operations-recovery-checkpoint-20261004.json';p.write_text(json.dumps(f,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'checkpoint':pin(p),'sourceArchive':f['sourceArchive'],'runtime':web,'fullPass':passed,'inputs':len(receipt['inputPins'])}))
