"""Original stopped normal-node Commit snapshots only; no finality or signer I/O."""
import hashlib
import json
import os
from pathlib import Path
import stat

VERSION='YNX-COMET-COMMIT-OBSERVATION/v1'
SCOPE='synthetic-loopback-lab/v1'
MAX_SAMPLES=128
MAX_BYTES=4<<20

def require(ok,message):
    if not ok:raise RuntimeError(message)
def integer(value):return type(value) is int and 0<=value<1<<63
def strict(raw):
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value,'duplicate original Commit observation field');value[key]=item
        return value
    return json.loads(raw,object_pairs_hook=pairs)
def arguments(output,private_root):
    output,private_root=Path(output),Path(private_root)
    require(private_root.resolve(strict=True)==private_root and output.is_absolute() and output.parent==private_root and not output.exists() and not output.is_symlink(),'fresh canonical private Commit observation path required')
    return ['--commit-observation-output',str(output),'--commit-observation-scope',SCOPE]

def validate_declared_contract(snapshot,pid,chain_id,genesis_hash):
    # This exact declared ABI remains fail-closed until compared with CORE's
    # final producer specimen/source pin; no aliases/defaults hide a mismatch.
    require(type(snapshot) is dict and snapshot.get('version')==VERSION,'original Commit observation version differs')
    require(type(snapshot.get('processID')) is int and snapshot['processID']==pid and snapshot.get('chainID')==chain_id and snapshot.get('originalGenesisHash')==genesis_hash,'original Commit process/chain/genesis identity differs')
    for key,value in [('independentFinality',False),('signerFsyncMeasured',False),('allCommitAttemptsCovered',False),('replayCoverageComplete',False),('unreportedStagesAreUnknown',True)]:require(snapshot.get(key) is value,'original Commit coverage/meaning differs: '+key)
    for key in ('successNotifications','errorNotifications','droppedSuccessSamples','rejectedNotifications'):require(integer(snapshot.get(key)),'original Commit counter missing/invalid: '+key)
    require('lastFailure' in snapshot and 'unobservedLatest' in snapshot,'original Commit nullable failure/missing markers required')
    for key in ('lastFailure','unobservedLatest'):require(snapshot[key] is None or type(snapshot[key]) is dict,'original Commit failure marker differs')
    require('heightGaps' in snapshot,'original Commit height gap coverage missing')
    samples=snapshot.get('samples');require(type(samples) is list and len(samples)<=MAX_SAMPLES and len(samples)<=snapshot['successNotifications'],'original fixed128 Commit samples differ')
    seen=set()
    for sample in samples:
        require(type(sample) is dict and integer(sample.get('height')) and sample['height']>0 and sample['height'] not in seen and type(sample.get('appHash')) is str and 0<len(sample['appHash'])<=256,'original Commit sample identity invalid/duplicate');seen.add(sample['height'])
        persistence=sample.get('persistence');require(type(persistence) is dict and persistence.get('height')==sample['height'] and type(persistence.get('storage')) is str and 0<len(persistence['storage'])<=64 and type(persistence.get('durable')) is bool and integer(persistence.get('elapsedNs')) and integer(persistence.get('payloadBytes')),'original CommitTimingSample differs')
        stages=persistence.get('stagesNs');require(type(stages) is dict and len(stages)<=64,'original bounded Commit stages required')
        for stage,ns in stages.items():require(type(stage) is str and 0<len(stage)<=128 and integer(ns),'original Commit stage value missing/invalid')
    return snapshot

def retain_after_stop(window,descriptors,chain_id,genesis_hash):
    result=dict(schema='YNX-PERF-ORIGINAL-COMMIT-READBACK/v1',expectedNodes=4,originalSnapshots=[],errors=[],allCommitAttemptsCovered=False,replayCoverageComplete=False,unreportedStagesAreUnknown=True,independentFinality=False,signerFsyncMeasured=False,meaning='Only original stopped normal-node snapshots. Persistence spans are not signer fsync, inclusion, finality or complete replay/commit coverage; absent stages are UNKNOWN.')
    require(len(descriptors)==4,'four original normal-node Commit descriptors required')
    for descriptor in descriptors:
        path=Path(descriptor['path']);name=descriptor['processName'];node=descriptor['node']
        try:
            child=next((c for c in window.children if c['name']==name),None)
            require(child is not None and child['process'].poll() is not None,'original Commit producer must be stopped before readback')
            require(path.resolve(strict=True)==path,'original Commit observation path may not be redirected')
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600 and before.st_nlink==1 and 0<before.st_size<=MAX_BYTES,'original Commit output must be exclusive0600 regular bounded JSON')
                with os.fdopen(fd,'rb',closefd=False) as stream:raw=stream.read(MAX_BYTES+1)
                after=os.fstat(fd);require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) and len(raw)==before.st_size,'original Commit output changed during stopped readback')
            finally:os.close(fd)
            public=window.work/'public'/('commit-observation-node-%d-original.json'%node)
            with open(public,'xb') as out:os.chmod(public,0o600);out.write(raw);out.flush();os.fsync(out.fileno())
            folder=os.open(public.parent,os.O_RDONLY)
            try:os.fsync(folder)
            finally:os.close(folder)
            record=dict(node=node,processName=name,pid=child['process'].pid,path=str(public.relative_to(window.work/'public')),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),sourceStopped=True,usable=False)
            result['originalSnapshots'].append(record)
            snapshot=validate_declared_contract(strict(raw),child['process'].pid,chain_id,genesis_hash)
            record.update(usable=True,sampleCount=len(snapshot['samples']),droppedSuccessSamples=snapshot['droppedSuccessSamples'],overflow=snapshot['droppedSuccessSamples']>0,rawOriginalObservation=snapshot)
        except (OSError,ValueError,RuntimeError,KeyError) as error:result['errors'].append(dict(node=node,errorType=type(error).__name__,reason=str(error),missingStagesAreUnknown=True))
    result['validOriginalNodes']=sum(x['usable'] for x in result['originalSnapshots']);result['fourOriginalSnapshotsValid']=result['validOriginalNodes']==4 and not result['errors']
    return result
