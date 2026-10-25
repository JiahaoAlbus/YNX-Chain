"""Single bounded original public-range cache writer; never grants network admission.
Args: frozen packet, original run root, pinned artifact API JSON, mode, NEW proof.
Modes priority-prefetch/all-prefetch fetch only absent exact original ranges;
priority-recover publishes only17 original diagnostics with CRC/SHA proofs.
Canonical frozen recover/verify remains mandatory for complete qualification.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,signal,stat,sys,time
base,root,meta_path=map(lambda s:Path(s).absolute(),sys.argv[1:4]);mode=sys.argv[4];output=Path(sys.argv[5]);assert mode in ('priority-prefetch','all-prefetch','priority-recover')
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
head='f2ffa01ba006a8a2aba3ca3a9f09b04311857731';run=40186554841
reader=base/'frozen-readers/scripts/loadtest/native-stream-artifact.py';adapter=base/'persistent-original-range-recovery.py'
assert hashlib.sha256(reader.read_bytes()).hexdigest()=='9bb43e1e36960ea65bc95c108afdd9936810be0921ddefa97d42615d9dd17987';assert hashlib.sha256(adapter.read_bytes()).hexdigest()=='7164d9a1c9944c300c90009317a76a46bc2a8b44aaeeb395d017ccf7c901bc3b'
core=load('frozen_procs2_recovery',reader);transport=load('frozen_procs2_transport',adapter);artifact=json.loads(meta_path.read_bytes());assert artifact['workflow_run']['id']==run and artifact['workflow_run']['head_sha']==head
cases=('before-native-replay-procs1','after-native-replay-procs2');wanted={c+'/'+n for c in cases for n in ('verifier.log','native-stream-verifier.json','network/transactions-result.json','evidence/actual.json',*[f'abci-{i}.log' for i in range(4)])}|{'evidence/actual.json'}
began=time.monotonic();opener=None;result=dict(schema=1,runId=run,sourceCommit=head,mode=mode,consumerSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),originalReaderSHA256=hashlib.sha256(reader.read_bytes()).hexdigest(),fetchedRanges=[],priorityOriginalMembers=[],completeArchiveRecovery=False,nativePairQualified=False,networkQualified=False,sustainedTPSQualified=False)
signal.signal(signal.SIGALRM,core.recovery_timeout);signal.setitimer(signal.ITIMER_REAL,60)
try:
 meta,url=core.original_artifact(artifact['id'],run,head,'network-pair');assert all(meta[k]==artifact[k] for k in ('id','name','size_in_bytes','digest','workflow_run'))
 identity=dict(artifactId=meta['id'],name=meta['name'],bytes=meta['size_in_bytes'],runId=run,head=head,digestReportedButNotRecomputed=meta.get('digest'));result['artifact']=identity
 opener=transport.PersistentArtifactOpener(url);ranges=core.ExactHTTPRanges(url,identity['bytes'],root/'range-cache',identity,opener=opener);ranges.deadline=began+60
 archive=core.Archive(core.Blocks(identity['bytes'],ranges.fetch));selection=core.Selection('network-pair');starts=set();selected=0;encountered=set()
 for entry in archive.entries():
  relative=selection.select(entry['name'])
  if relative is None:continue
  core.need(not stat.S_ISLNK(entry['mode']) and core.integer(entry['size'],0,core.MAX_MEMBER),'original public member type/size bound');selected+=entry['size'];core.need(selected<=core.MAX_RECOVERED,'original selected byte cap')
  if mode!='all-prefetch' and relative not in wanted:continue
  encountered.add(relative);target=root/'capture'/relative;core.need(target.parent.resolve()==target.parent,'member parent symlink refused')
  if mode!='priority-recover' and target.exists():
   core.need(target.is_file() and not target.is_symlink(),'existing member type differs');continue
  begin=archive.inspect_member(entry)
  if mode!='priority-recover':
   if entry['packed']:starts.update(range(begin//core.BLOCK*core.BLOCK,(begin+entry['packed']-1)//core.BLOCK*core.BLOCK+core.BLOCK,core.BLOCK))
   continue
  target.parent.mkdir(parents=True,exist_ok=True)
  if target.exists() or target.is_symlink():
   member=core.file_identity(target);core.need(member['bytes']==entry['size'] and member['crc32']==entry['crc'],'existing original member CRC differs');core.need(member==archive.member(entry,core.VerifyOnly(),begin),'existing original member SHA differs')
  else:
   partial=target.with_name(target.name+'.recover-partial');member=core.recover_partial_member(archive,entry,partial,begin);os.link(partial,target);partial.unlink();fd=os.open(target.parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0));os.fsync(fd);os.close(fd)
  result['priorityOriginalMembers'].append(dict(path=relative,**member))
 result.update(originalSelectedBytes=selected,centralDirectorySHA256=archive.central_sha)
 for start in sorted(starts):
  body=root/'range-cache'/('block-%010d.bin'%start);pin=body.with_suffix('.json')
  if body.exists() or pin.exists():core.need(body.exists() and pin.exists(),'incomplete original range cache; reconcile');continue
  ranges.fetch(start,min(core.BLOCK,identity['bytes']-start));result['fetchedRanges'].append(start)
 core.need(mode=='all-prefetch' or encountered==wanted,'original priority members absent')
 result['missingOriginalPriorityMembers']=sorted(wanted-{m['path'] for m in result['priorityOriginalMembers']}) if mode=='priority-recover' else []
 result['operationComplete']=True
except Exception as e:result.update(operationComplete=False,firstCause=str(e) if isinstance(e,RuntimeError) else type(e).__name__)
finally:
 if opener:opener.close()
 signal.setitimer(signal.ITIMER_REAL,0);result.update(elapsedSeconds=time.monotonic()-began,networkRangeBytes=ranges.network_bytes if 'ranges' in locals() else 0,etag=ranges.etag if 'ranges' in locals() else None,httpRequests=opener.requests if opener else 0)
 with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 print(json.dumps({k:v for k,v in result.items() if k not in ('fetchedRanges','priorityOriginalMembers','artifact')}))

raise SystemExit(0 if result.get("operationComplete") else 1)
