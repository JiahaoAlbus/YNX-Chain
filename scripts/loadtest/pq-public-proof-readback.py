#!/usr/bin/env python3
"""Transport original public proof bytes; reverify only with the pinned normal CLI.

No consensus/transaction codec, signer, source authority or replacement verifier.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import threading
import time

SCHEMA='YNX-PERF-ORIGINAL-PUBLIC-PROOF-CLOSURE/v1'
FILES={'migration':'migration.json','genesis':'genesis.json','state':'committed-state.json','schedule':'schedule.json','trustedLightBlock':'trusted-light-block.json','request':'request.json','context':'trust-context.json','proof':'proof.json','publicProofInputs':'PUBLIC-PROOF-INPUTS.json'}
FIELDS={'migration':'migrationFile','genesis':'genesisFile','state':'stateFile','schedule':'scheduleFile','trustedLightBlock':'trustedLightBlockFile'}
FILE_LIMIT=64<<20
MIGRATION_FILE_LIMIT=128<<20
TOTAL_LIMIT=256<<20
_export_lock=threading.Lock()
PRE_OUTPUT_FAILURE_VERSION = 'YNX-PQ-LAB-LIVE-MATERIALS-PRE-OUTPUT-FAILURE/v1'
PRE_OUTPUT_PHASES = frozenset((
    'request-stat', 'current-source', 'request-read', 'request-decode', 'request-sequence',
    'transaction-replay', 'request-cancelled', 'transaction-validation', 'output-cancelled', 'output-create',
))
CAPTURE_OBSERVATION_LIMIT = 16 << 10
CAPTURE_PHASES = frozenset('proof.' + name for name in (
    'intentWrite', 'checkpoint', 'stateDecode', 'loadPQLab', 'heldStaticCurrent', 'stateValidate', 'anchorAndRegistry',
    'retainedBlockSearch', 'advanceAnchor', 'lightBlocks', 'migrationCanonical', 'migrationOriginalRead',
    'derivedPlanWrite', 'derivedPlanInputs', 'sourceContextCapture', 'materialsEncode', 'verifierInputs',
    'materialsWrite', 'finalInputCurrent', 'resultWrite',
))
CAPTURE_SUBPHASES = frozenset(('proof.engineRead', 'proof.appReadLockWait',
                              'proof.appLockedCheckpoint', 'proof.appEncodeCheckpoint'))

def require(ok,message):
    if not ok:raise RuntimeError(message)

def pre_output_failure(raw, pin, sequence):
    value = strict(raw)
    require(type(value) is dict
            and set(value) == {'version', 'policySHA256', 'sequence', 'phase', 'outcome', 'firstCauseSHA256'}
            and value['version'] == PRE_OUTPUT_FAILURE_VERSION and value['policySHA256'] == pin
            and type(value['sequence']) is int and value['sequence'] == sequence
            and type(value['phase']) is str and value['phase'] in PRE_OUTPUT_PHASES
            and value['outcome'] == 'unknown' and type(value['firstCauseSHA256']) is str
            and re.fullmatch('[0-9a-f]{64}', value['firstCauseSHA256']),
            'original pre-output proof failure record differs')
    return value


def capture_observation(raw, *, node, sequence, pin, request_sha256, failure):
    require(type(raw) is bytes and 0 < len(raw) <= CAPTURE_OBSERVATION_LIMIT,
            'bounded original proof capture observation required')
    value = strict(raw)
    require(type(value) is dict and set(value) == {
        'version', 'owningNodeIndex', 'sequence', 'policySHA256', 'requestSHA256', 'firstCauseSHA256',
        'outcome', 'lastEnteredPhase', 'typedCrossings', 'captureBudgetNs', 'sinceCaptureStartNs', 'timings',
    } and value['version'] == 'YNX-PQ-LAB-PROOF-CAPTURE-OBSERVATION/v1'
        and type(value['owningNodeIndex']) is int and value['owningNodeIndex'] == node
        and type(value['sequence']) is int and value['sequence'] == sequence
        and value['policySHA256'] == pin and re.fullmatch('[0-9a-f]{64}', request_sha256 or '')
        and value['requestSHA256'] == request_sha256 and value['firstCauseSHA256'] == failure['FirstCauseSHA256']
        and value['outcome'] == 'unknown' and type(value['lastEnteredPhase']) is str
        and value['lastEnteredPhase'] in CAPTURE_PHASES
        and type(value['typedCrossings']) is int and 0 <= value['typedCrossings'] <= 3
        and all(type(value[key]) is int and 0 <= value[key] < 1 << 63
                for key in ('captureBudgetNs', 'sinceCaptureStartNs')),
        'original proof capture observation identity or phase differs')
    timing = value['timings']
    require(type(timing) is dict and set(timing) == {'version', 'clock', 'intervalsOverlap', 'stages'}
            and timing['version'] == 'YNX-PQ-LAB-CALLEE-ELAPSED/v1'
            and timing['clock'] == 'monotonic_elapsed_wall_ns' and timing['intervalsOverlap'] is True
            and type(timing['stages']) is dict and len(timing['stages']) <= 128,
            'original proof capture timing schema differs')
    for label, stage in timing['stages'].items():
        require((label in CAPTURE_PHASES or label in CAPTURE_SUBPHASES or re.fullmatch(r'lab\.[A-Za-z0-9]{1,100}', label))
                and type(stage) is dict and set(stage) == {'calls', 'elapsedNs'}
                and type(stage['calls']) is int and 0 < stage['calls'] < 1 << 64
                and type(stage['elapsedNs']) is int and 0 <= stage['elapsedNs'] < 1 << 63,
                'original proof capture stage counters differ')
    return value


def sha(raw):return hashlib.sha256(raw).hexdigest()
def strict(raw):
    def pairs(items):
        out={}
        for key,value in items:
            require(key not in out,'duplicate public manifest/context field');out[key]=value
        return out
    return json.loads(raw,object_pairs_hook=pairs)
def read_original(path,limit=FILE_LIMIT,allow_empty=False):
    path=Path(path);require(path.is_absolute() and path.resolve(strict=True)==path,'canonical non-symlink public input required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and (0<=before.st_size<=limit if allow_empty else 0<before.st_size<=limit),'bounded regular public input required')
        with os.fdopen(fd,'rb',closefd=False) as f:raw=f.read(limit+1)
        after=os.fstat(fd);require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) and len(raw)==before.st_size,'original public input changed during read')
        return raw
    finally:os.close(fd)
def write_new(path,raw):
    with open(path,'xb') as out:os.chmod(path,0o600);out.write(raw);out.flush();os.fsync(out.fileno())
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def json_bytes(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def public_file_limit(role):
    return MIGRATION_FILE_LIMIT if role in ('migration', 'context/migration.json') else FILE_LIMIT


def scan_existing_blob(path, size, *, expected=None, output=None):
    require(path.resolve(strict=True) == path, 'canonical non-symlink public input required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == size,
                'existing public blob differs; never overwrite')
        view = memoryview(expected) if expected is not None else None
        digest = hashlib.sha256()
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            for offset in range(0, size, 1 << 20):
                length = min(1 << 20, size - offset)
                chunk = stream.read(length)
                require(len(chunk) == length and (view is None or chunk == view[offset:offset + length]),
                        'existing public blob differs; never overwrite')
                if view is None:
                    digest.update(chunk)
                if output is not None:
                    output.write(chunk)
            require(not stream.read(1), 'existing public blob differs; never overwrite')
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                'existing public blob differs; never overwrite')
        return digest.hexdigest() if view is None else None
    finally:
        os.close(fd)


def store_migration_blob(public, path, available):
    """Copy the held public migration without materializing its bytes in Python."""
    size = path.stat().st_size
    require(0 < size <= min(available, MIGRATION_FILE_LIMIT), 'bounded regular public input required')
    with _export_lock:
        blobs = public/'proof-public-blobs'
        blobs.mkdir(mode=0o700, exist_ok=True)
        require(blobs.resolve(strict=True) == blobs, 'public blob directory may not be redirected')
        with tempfile.TemporaryDirectory(dir=public.parent) as temporary:
            staged = Path(temporary)/'migration'
            with staged.open('xb') as output:
                os.fchmod(output.fileno(), 0o600)
                pin = scan_existing_blob(path, size, output=output)
                output.flush()
                os.fsync(output.fileno())
            target = blobs/(pin+'.json')
            try:
                os.link(staged, target)
            except FileExistsError:
                require(scan_existing_blob(target, size) == pin, 'existing public blob differs; never overwrite')
            staged.unlink()
            fd = os.open(blobs, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    return dict(originalAbsolutePath=str(path), publicRelativePath=str(target.relative_to(public)),
                sha256=pin, bytes=size)

# These legacy carrier labels are the existing normal importer's CLOSED
# transport names. They never assert that an actual operation belongs to owner4.
LEGACY_RESULTS={
    'finalReceipt':'functional-owner-4-final-proof.json',
    'normalVerifier':'functional-owner-4-normal-verifier.log',
    'observation':'functional-owner-4-observation.json',
    'originalConfirm':'functional-owner-4-original-confirm.log',
    'originalExport':'functional-owner-4-original-export.log',
    'originalSign':'functional-owner-4-original-sign.log',
}

def store_originals(public,originals,values=None):
    if values is None:values={role:read_original(path,public_file_limit(role)) for role,path in originals.items()}
    require(sum(map(len,values.values()))<=TOTAL_LIMIT,'original public DATA exceeds existing portable total bound')
    entries={}
    with _export_lock:
        blobs=public/'proof-public-blobs';blobs.mkdir(mode=0o700,exist_ok=True)
        require(blobs.resolve(strict=True)==blobs,'public blob directory may not be redirected')
        for role,raw in values.items():
            pin=sha(raw);target=blobs/(pin+'.json')
            if target.exists():scan_existing_blob(target,len(raw),expected=raw)
            else:write_new(target,raw)
            entries[role]=dict(originalAbsolutePath=str(originals[role]),publicRelativePath=str(target.relative_to(public)),sha256=pin,bytes=len(raw))
    return entries,values

def export_original_public_proof(public,case,directory,context,proof,source_commit,verifier_sha256):
    """Original bytes only; normal portable-import owns all context mapping."""
    public,case,directory=map(Path,(public,case,directory))
    require(public.resolve(strict=True)==public and case.resolve(strict=True)==case and case.parent.parent==public and case.parent.name=='load-operations','original public case location required')
    require(directory.resolve(strict=True)==directory and directory.name=='verifier','original normal verifier directory required')
    require(context.get('syntheticOnly') is True and context.get('authorityGranted') is False,'original synthetic public export scope required')
    require(context['request']['path']==FILES['request'] and context['context']['path']==FILES['context'],'fixed original public proof filenames required')
    originals={role:directory/name for role,name in FILES.items() if role!='proof'};originals['proof']=directory.parent/'proof.json'
    require(Path(proof['path'])==originals['proof'],'fixed original proof path required')
    # Only inspect the existing optional path selector, never patch/decode proof.
    context_raw=read_original(originals['context']);light=strict(context_raw)['lightTrust']
    for role,field in FIELDS.items():require(light.get(field)==str(originals[role]),'original public context path outside fixed allowlist')
    if light.get('runtimePlanFile'):
        require(light['runtimePlanFile']==str(directory/'runtime-plan.json'),'runtime plan outside closed original path')
        originals['runtimePlan']=directory/'runtime-plan.json'
    migration = originals.pop('migration')
    values={role:read_original(path,public_file_limit(role)) for role,path in originals.items()}
    for role,ref in [('request',context['request']),('context',context['context']),('proof',proof)]:
        require(sha(values[role])==ref['sha256'] and len(values[role])==int(ref['bytes']),'original public proof external pin differs')
    require(sha(values['trustedLightBlock'])==light['trustedLightBlockSHA256'],'original trusted LightBlock pin differs')
    # Reject an unsafe original before exporting any other role.
    require(migration.resolve(strict=True) == migration and migration.stat().st_nlink == 1,
            'canonical single-link public migration required')
    migration_entry = store_migration_blob(public, migration, TOTAL_LIMIT - sum(map(len, values.values())))
    entries,values=store_originals(public,originals,values)
    entries['migration'] = migration_entry
    manifest=dict(schema=SCHEMA,sourceCommit=source_commit,verifierBinarySHA256=verifier_sha256,entries=entries,originalContextSHA256=sha(values['context']),originalRequestSHA256=sha(values['request']),syntheticOnly=True,authorityGranted=False,actualNetworkExecutionClaim=False,independentReverification=False,meaning='Original public bytes only. Missing original result files cannot be invented. Only the normal portable-import may map context paths; no keys/custody/HRS are selected.')
    path=case/'original-public-proof-manifest.json';raw=json_bytes(manifest);write_new(path,raw)
    return dict(path=str(path.relative_to(public)),sha256=sha(raw),bytes=len(raw),independentReverification=False,authorityGranted=False)

def read_original_closure(manifest_path,manifest_sha256,*,retain_blobs=True):
    manifest_path=Path(manifest_path);raw=read_original(manifest_path,256<<10);require(sha(raw)==manifest_sha256,'external original manifest pin differs')
    manifest=strict(raw);require(manifest.get('schema')==SCHEMA and manifest.get('syntheticOnly') is True and manifest.get('authorityGranted') is False and manifest.get('actualNetworkExecutionClaim') is False,'public closure scope differs')
    require(manifest_path.name=='original-public-proof-manifest.json' and manifest_path.parent.parent.name=='load-operations','fixed public manifest location required')
    public=manifest_path.parent.parent.parent;entries=manifest['entries'];require(set(entries) in (set(FILES),set(FILES)|{'runtimePlan'}),'exact original public allowlist required')
    values={};paths={};total=0
    for role,entry in entries.items():
        pin=entry['sha256'];require(type(pin) is str and re.fullmatch('[0-9a-f]{64}',pin) and entry['publicRelativePath']=='proof-public-blobs/'+pin+'.json','public blob path differs from exact hash')
        path=public/entry['publicRelativePath'];size=entry['bytes'];limit=public_file_limit(role)
        require(type(size) is int and 0<size<=limit and total+size<=TOTAL_LIMIT,'original public blob pin/size differs')
        total+=size
        if retain_blobs:
            value=read_original(path,limit)
            require(sha(value)==pin and len(value)==size,'original public blob pin/size differs')
            values[role]=value
        else:
            require(scan_existing_blob(path,size)==pin,'original public blob pin/size differs')
        paths[role]=path
    require(entries['context']['sha256']==manifest['originalContextSHA256'] and entries['request']['sha256']==manifest['originalRequestSHA256'],'original closure/context/request differs')
    return manifest,values,paths

def finalize_portable_catalog(public,case,closure_ref,row):
    public,case=Path(public),Path(case)
    initial,_,_=read_original_closure(public/closure_ref['path'],closure_ref['sha256'],retain_blobs=False)
    require(case==public/'load-operations'/('%05d'%row['index']),'original operation case differs')
    originals={
        'finalReceipt':case/'qualified-receipt.json',
        'normalVerifier':public/('load-%05d-normal-verifier.log'%row['index']),
        'observation':case/'four-node-inclusion.json',
        'originalConfirm':case/'original-confirm-reply.json',
        'originalExport':public/('load-%05d-live-result.log'%row['index']),
        'originalSign':case/'original-sign-reply.json',
    }
    # All six must already exist as original files. No alias body is synthesized.
    entries,values=store_originals(public,originals)
    final=strict(values['finalReceipt']);require(final['operationId']==row['operationId'] and final['transaction']['ownerIndex']==row['ownerIndex'] and final['transaction']['firstNonce']==str(row['nonce']),'legacy carrier label cannot replace actual operation identity')
    payload={}
    for role,entry in initial['entries'].items():
        if role=='proof':continue # retained as raw original in initial closure
        payload['context/'+('runtime-plan.json' if role=='runtimePlan' else FILES[role])]=entry
    for role,entry in entries.items():payload['original-results/'+LEGACY_RESULTS[role]]=entry
    require(len(payload) in (14,15) and sum(x['bytes'] for x in payload.values())<=TOTAL_LIMIT,'normal closed portable DATA payload differs')
    catalog=dict(version='YNX-CONSENSUS-PROOF-PORTABLE-FILES/v1',files=[dict(path=name,bytes=str(entry['bytes']),sha256=entry['sha256']) for name,entry in sorted(payload.items())])
    catalog_path=case/'portable-file-catalog.json';catalog_raw=json_bytes(catalog);write_new(catalog_path,catalog_raw)
    manifest=dict(schema='YNX-PERF-NORMAL-PORTABLE-ORIGINALS/v1',sourceCommit=initial['sourceCommit'],verifierBinarySHA256=initial['verifierBinarySHA256'],originalContextSHA256=initial['originalContextSHA256'],originalRequestSHA256=initial['originalRequestSHA256'],originalClosure=closure_ref,actualOwnerIndex=row['ownerIndex'],actualOperationId=row['operationId'],actualNonce=str(row['nonce']),catalogSHA256=sha(catalog_raw),payload=payload,sourceGrant=False,nativeRootAuthorized=False,proofVerified=False,legacyOwner4LabelsAreTransportNamesOnly=True,meaning='Every payload byte is copied from an existing original; legacy filename labels do not assert owner4. Normal portable-import and normal verifier must run separately.')
    path=case/'normal-portable-originals.json';raw=json_bytes(manifest);write_new(path,raw)
    return dict(path=str(path.relative_to(public)),sha256=sha(raw),bytes=len(raw))

def read_portable_archive(manifest_path,manifest_sha256):
    manifest_path=Path(manifest_path);raw=read_original(manifest_path,256<<10);require(sha(raw)==manifest_sha256,'external portable manifest pin differs');m=strict(raw)
    require(m.get('schema')=='YNX-PERF-NORMAL-PORTABLE-ORIGINALS/v1' and m.get('sourceGrant') is False and m.get('nativeRootAuthorized') is False and m.get('proofVerified') is False and m.get('legacyOwner4LabelsAreTransportNamesOnly') is True,'normal portable DATA scope differs')
    require(manifest_path.name=='normal-portable-originals.json' and manifest_path.parent.parent.name=='load-operations','fixed portable manifest location required');public=manifest_path.parent.parent.parent
    catalog_path=manifest_path.parent/'portable-file-catalog.json';catalog_raw=read_original(catalog_path,32<<10);require(sha(catalog_raw)==m['catalogSHA256'],'original catalog pin differs');catalog=strict(catalog_raw)
    want={'context/'+name for role,name in FILES.items() if role!='proof'}|{'original-results/'+name for name in LEGACY_RESULTS.values()}
    if 'context/runtime-plan.json' in m['payload']:want.add('context/runtime-plan.json')
    require(set(m['payload'])==want and catalog==dict(version='YNX-CONSENSUS-PROOF-PORTABLE-FILES/v1',files=[dict(path=name,bytes=str(entry['bytes']),sha256=entry['sha256']) for name,entry in sorted(m['payload'].items())]),'exact existing normal portable catalog required')
    total=0
    for name,entry in m['payload'].items():
        pin=entry['sha256'];require(re.fullmatch('[0-9a-f]{64}',pin) and entry['publicRelativePath']=='proof-public-blobs/'+pin+'.json','portable public blob path differs');value=read_original(public/entry['publicRelativePath'],public_file_limit(name));require(sha(value)==pin and len(value)==entry['bytes'],'portable original blob differs');total+=len(value)
    require(total<=TOTAL_LIMIT,'normal portable total bound exceeded')
    require(m['payload']['context/trust-context.json']['sha256']==m['originalContextSHA256'] and m['payload']['context/request.json']['sha256']==m['originalRequestSHA256'],'original context/request pins differ')
    return m,public,catalog_path

def reverify(manifest_path,manifest_sha256,verifier,verifier_sha256,output,execute=False):
    m,public,catalog=read_portable_archive(manifest_path,manifest_sha256)
    require(m['verifierBinarySHA256']==verifier_sha256 and sha(read_original(Path(verifier),128<<20))==verifier_sha256,'exact original normal verifier binary pin differs')
    output=Path(output);require(output.is_absolute() and not output.exists() and output.parent.resolve(strict=True)==output.parent,'fresh canonical independent output required');output.mkdir(mode=0o700)
    source=output/'original-source';source.mkdir(mode=0o700)
    for name,entry in m['payload'].items():
        path=source/name;path.parent.mkdir(mode=0o700,exist_ok=True);write_new(path,read_original(public/entry['publicRelativePath'],public_file_limit(name)))
    catalog_copy=output/'original-file-catalog.json';write_new(catalog_copy,read_original(catalog,32<<10))
    imported=output/'normal-portable-import'
    command=[str(verifier),'portable-import','--trust-context',str(source/'context/trust-context.json'),'--trust-context-sha256',m['originalContextSHA256'],'--file-catalog',str(catalog_copy),'--file-catalog-sha256',m['catalogSHA256'],'--source-dir',str(source),'--output-dir',str(imported)]
    report=dict(schema='YNX-PERF-INDEPENDENT-NORMAL-PORTABLE-REVERIFY/v1',sourceCommit=m['sourceCommit'],verifierBinarySHA256=verifier_sha256,originalManifestSHA256=manifest_sha256,originalRequestSHA256=m['originalRequestSHA256'],originalContextSHA256=m['originalContextSHA256'],actualOwnerIndex=m['actualOwnerIndex'],actualOperationId=m['actualOperationId'],executed=False,independentCryptographicReverification=False,sourceGrant=False,nativeRootAuthorized=False,originalAuthorityClaim=False,normalImportCommand=command)
    def call(command,name,stdin=None):
        log=output/(name+'.log');row=dict(command=command)
        with open(log,'xb') as stream:
            try:process=subprocess.run(command,input=stdin,stdout=stream,stderr=subprocess.STDOUT,timeout=30,check=False);row['returnCode']=process.returncode
            except subprocess.TimeoutExpired:row.update(timeout=True,returnCode=None)
        raw=read_original(log,4<<20,allow_empty=True);row['logSHA256']=sha(raw)
        try:row['originalResult']=strict(raw)
        except ValueError:row['originalResult']=None
        return row
    if execute:
        report['executed']=True;report['normalImport']=call(command,'normal-portable-import')
        entry=report['normalImport'];result=entry.get('originalResult')
        if entry['returnCode']==0 and type(result) is dict and result.get('code')=='IMPORTED_DATA':
            require(result.get('version')=='YNX-CONSENSUS-PROOF-PORTABLE-IMPORT/v1' and result.get('classification')=='data' and result.get('originalContextSHA256')==m['originalContextSHA256'] and result.get('catalogSHA256')==m['catalogSHA256'],'normal portable import identity differs')
            require(all(result.get(k) is False for k in ('sourceGrant','nativeRootAuthorized','sourceDeploymentQualified','proofVerified')),'normal portable DATA must not claim authority or proof verification')
            context=Path(result['contextPath']);require(context==imported/'portable-trust-context.json' and sha(read_original(context))==result['contextSHA256'],'normal imported context differs')
            request=imported/'original/context/request.json';raw_request=read_original(request);require(sha(raw_request)==m['originalRequestSHA256'],'normal importer changed original request')
            require(sha(read_original(imported/'original/context/trust-context.json'))==m['originalContextSHA256'],'normal importer changed original context')
            verified=call([str(verifier),'--trust-context',str(context),'--trust-context-sha256',result['contextSHA256']],'normal-verifier',raw_request);report['normalVerifier']=verified
            if verified['returnCode']==0 and type(verified.get('originalResult')) is dict:
                spec=importlib.util.spec_from_file_location('original_portable_normal',Path(__file__).with_name('pq-normal-process-lab.py'));normal=importlib.util.module_from_spec(spec);spec.loader.exec_module(normal)
                expected=strict(read_original(imported/'original/context/trust-context.json'))['expectedTransaction']
                try:normal.require_verified(verified['originalResult'],dict(abciHash=expected['transactionHash'],nativeHash=expected['nativeWireHash']));report['independentCryptographicReverification']=True
                except RuntimeError:pass
    write_new(output/'reverification.json',json_bytes(report))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('manifest','manifest-sha256','verifier','verifier-sha256','output-directory'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    report=reverify(Path(args.manifest),args.manifest_sha256,Path(args.verifier),args.verifier_sha256,Path(args.output_directory),args.execute);print(json.dumps(report))
    if args.execute and not report['independentCryptographicReverification']:raise SystemExit(1)
