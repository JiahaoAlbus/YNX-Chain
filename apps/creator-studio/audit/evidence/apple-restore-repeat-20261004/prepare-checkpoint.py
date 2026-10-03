import pathlib,subprocess,json,hashlib,tarfile,gzip,io,shutil,datetime,urllib.request
root=pathlib.Path.cwd()
head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
tree=subprocess.check_output(['git','rev-parse',head+'^{tree}']).decode().strip()
previous_path=root/'apps/creator-studio/audit/apple-expiry-locales-checkpoint-20261004.json'
previous=json.loads(previous_path.read_bytes())
production=previous['sourceCommit']
sha=lambda b:hashlib.sha256(b).hexdigest()
def exact(p,commit=head):
 b=subprocess.check_output(['git','show',commit+':'+p['path']]);assert len(b)==p['bytes'] and sha(b)==p['sha256'],p['path']
def pin(p):
 b=p.read_bytes();return dict(path=str(p.relative_to(root)),bytes=len(b),sha256=sha(b))
allowed={'apps/creator-studio/scripts/apple-engine-check.swift','apps/creator-studio/scripts/apple-native-authority-check.mjs','internal/video/media_native_business_test.go'}
changed=subprocess.check_output(['git','diff','--name-only',production,head,'--','apps/video','apps/creator-studio','apps/music','internal/video','internal/music']).decode().splitlines()
source_changed={p for p in changed if '/audit/' not in p}
assert source_changed==allowed,source_changed
compose=pathlib.Path('/tmp/ynx-media-creator-restore-trace-full-r2-20261004')
receipt=json.loads((compose/'combined-source-receipt.json').read_bytes())
assert len(receipt['results'])==2 and all(r['exitCode']==0 for r in receipt['results'])
events=[json.loads(l) for l in (compose/'combined-go-race.jsonl').read_text().splitlines() if l.startswith('{')]
passed=sum(e.get('Action')=='pass' for e in events);failed=sum(e.get('Action')=='fail' for e in events)
assert passed>=447 and failed==0,(passed,failed)
for p in receipt['inputPins']:
 if p['owner'].startswith('Media'):exact(p)
for name in ['appleCreatorCompiledSource','appleCompiledSource','appleMusicCompiledSource','javaMusicCompiledSource']:
 for p in receipt[name]['sourcePins']:exact(p)
buildpath=root/'apps/creator-studio/audit/evidence/apple-expiry-locales-20261004/full-native-build-receipt.json'
build=json.loads(buildpath.read_bytes());assert build['sourceCommit']==production
for p in build['sourcePins']:exact(p);exact(p,production)
for p in [previous['sourceArchive'],*previous['candidates']]:exact(p)
out=root/'apps/creator-studio/audit/evidence/apple-restore-repeat-20261004';out.mkdir(parents=True,exist_ok=False)
def copy(src,name):
 dest=out/name;shutil.copyfile(src,dest);return pin(dest)
evidence=[]
for name in ['combined-go-race.jsonl','combined-go-vet.txt','combined-source-receipt.json']:evidence.append(copy(compose/name,name))
for directory,label in [('/tmp/ynx-creator-restore-trace-focused-20261004','initial-focused'),('/tmp/ynx-creator-restore-trace-diagnose-r2-20261004','strict-focused'),('/tmp/ynx-media-creator-restore-trace-full-20261004','first-full-missing-snapshot-failed')]:
 for name in ['combined-go-race.jsonl','combined-source-receipt.json']:evidence.append(copy(pathlib.Path(directory)/name,label+'-'+name))
evidence.append(copy('/tmp/ynx-creator-restore-trace-engine-20261004/apple-engine-check.json','compiled-swift-source.json'))
evidence.append(copy('/tmp/ynx-creator-restore-trace-engine-compile-20261004.txt','compiled-swift-log.txt'))
evidence.append(copy(__file__,'prepare-checkpoint.py'))
with tarfile.open(root/previous['sourceArchive']['path']) as tar:names=sorted(m.name for m in tar if m.isfile())
archive_path=out/('media-owned-qa-source-'+head[:8]+'.tar.gz')
with archive_path.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:
  with tarfile.open(fileobj=gz,mode='w') as tar:
   for name in names:
    data=subprocess.check_output(['git','show',head+':'+name]);assert (root/name).read_bytes()==data
    mode=subprocess.check_output(['git','ls-tree',head,'--',name]).decode().split()[0]
    item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o755 if mode=='100755' else 0o644;item.mtime=0;tar.addfile(item,io.BytesIO(data))
archive={**pin(archive_path),'fileCount':len(names),'everyMemberGitByteExact':True}
urls=['https://video.ynxweb4.com/video/runtime-manifest.json','https://creator.ynxweb4.com/creator-studio.manifest.json','https://video.ynxweb4.com/video/api/health']
public=[]
for i,url in enumerate(urls):
 record={'url':url,'readAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'actualWalletOrSignedBusiness':False}
 try:
  with urllib.request.urlopen(url,timeout=15) as response:
   data=response.read(262145);assert len(data)<=262144;record.update(status=response.status,response=json.loads(data))
 except Exception as error:record['error']=str(error)
 dest=out/('public-readback-'+str(i)+'.json');dest.write_text(json.dumps(record,indent=2)+'\n');public.append(pin(dest))
note='''Creator original-account restoration QA checkpoint. Production source and unsigned candidates are inherited byte-for-byte from the prior expiry/locales freeze. Only three QA files changed. Both Apple tuples exercise ten wrong-account vetoes followed by the same original account/session binding and deep-equal studio record. Wrong-account snapshots must clear videos, revenue and AI jobs. Initial restoration must contain the original video, not merely connected status.

The first full run failed because the initial restored snapshot had no video although connected was true; a later iteration read the original record. Its failure and receipt remain retained. The strict successor and focused run passing do not establish the cause of that failure or the earlier connected-false failure. SDK status/error and bounded path/status network tails are exposed by the isolated QA process; no headers, proofs, keys or bodies are logged. No production authority rule, retry policy, timeout, role or storage was changed.

Original Wallet consent, OS protected storage, installed UI/device/codec, formal Host/currentActor plus matching client, real AI/Pay and user acceptance remain unverified. This checkpoint does not replace the production candidate or claim release readiness.
'''
(out/'followup.md').write_text(note);evidence.append(pin(out/'followup.md'))
checkpoint=dict(schema='ynx.creator.apple.restore-repeat.qa-checkpoint.v1',createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),qaSourceCommit=head,qaSourceTree=tree,productionSourceCommit=production,qaChangedPaths=sorted(source_changed),qaSourceArchive=archive,inheritedProductionCheckpoint=pin(previous_path),inheritedProductionSourceArchive=previous['sourceArchive'],inheritedCandidates=previous['candidates'],inheritedBuildReceipt=pin(buildpath),productionBuildPinsStillGitExact=True,compositionInputPins=len(receipt['inputPins']),checks=dict(fullGoRacePassEvents=passed,fullGoRaceFailures=failed,goVet='PASS',originalSwiftSDKGoTenRestorationsEachAppleTuple=True,strictInitialOriginalVideoRequired=True,wrongAccountPrivateSnapshotCleared=True,boundedSDKAndNetworkDiagnostics=True,productionSourceChanged=False),remaining=['First full missing studio snapshot despite connected status has unconfirmed cause','Earlier connected-false restoration failure remains unconfirmed',*previous['remaining'][1:]],publicReadback=public,evidence=evidence)
path=root/'apps/creator-studio/audit/apple-restore-repeat-checkpoint-20261004.json';assert not path.exists();path.write_text(json.dumps(checkpoint,indent=2)+'\n')
print(json.dumps(dict(checkpoint=pin(path),qaSourceCommit=head,productionSourceCommit=production,qaArchive=archive,passEvents=passed)))
