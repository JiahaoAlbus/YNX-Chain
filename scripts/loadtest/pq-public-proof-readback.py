#!/usr/bin/env python3
"""Transport original public proof bytes; reverify only with the pinned normal CLI.

No consensus/transaction codec, signer, source authority or replacement verifier.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import threading
import time

SCHEMA='YNX-PERF-ORIGINAL-PUBLIC-PROOF-CLOSURE/v1'
FILES={'migration':'migration.json','genesis':'genesis.json','state':'committed-state.json','schedule':'schedule.json','trustedLightBlock':'trusted-light-block.json','request':'request.json','context':'trust-context.json','proof':'proof.json'}
FIELDS={'migration':'migrationFile','genesis':'genesisFile','state':'stateFile','schedule':'scheduleFile','trustedLightBlock':'trustedLightBlockFile'}
FILE_LIMIT=128<<20
TOTAL_LIMIT=1<<30
_export_lock=threading.Lock()

def require(ok,message):
    if not ok:raise RuntimeError(message)
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

def export_original_public_proof(public,case,directory,context,proof,source_commit,verifier_sha256):
    """Exact 8-file allowlist only. Shared blobs are bytes, never cached trust."""
    public,case,directory=map(Path,(public,case,directory))
    require(public.resolve(strict=True)==public and case.resolve(strict=True)==case and case.parent.parent==public and case.parent.name=='load-operations','original public case location required')
    require(directory.resolve(strict=True)==directory and directory.name=='verifier','original normal verifier directory required')
    require(context.get('syntheticOnly') is True and context.get('authorityGranted') is False,'original synthetic public export scope required')
    require(context['request']['path']==FILES['request'] and context['context']['path']==FILES['context'],'fixed original public proof filenames required')
    originals={role:directory/name for role,name in FILES.items() if role!='proof'}
    originals['proof']=directory.parent/'proof.json'
    require(Path(proof['path'])==originals['proof'],'fixed original proof path required')
    values={role:read_original(path) for role,path in originals.items()}
    require(sum(map(len,values.values()))<=TOTAL_LIMIT,'public proof closure exceeds transport bound')
    for role,ref in [('request',context['request']),('context',context['context']),('proof',proof)]:
        require(sha(values[role])==ref['sha256'] and len(values[role])==int(ref['bytes']),'original public proof external pin differs')
    original_context=strict(values['context']);light=original_context['lightTrust']
    require(original_context.get('version')=='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1' and light.get('runtimePlanFile')=='' and light.get('runtimePlanHash')=='','unsupported public context/source profile; no recursive discovery')
    for role,field in FIELDS.items():require(light.get(field)==str(originals[role]),'original public context path outside fixed allowlist')
    require(sha(values['trustedLightBlock'])==light['trustedLightBlockSHA256'],'original trusted LightBlock pin differs')
    entries={}
    with _export_lock:
        blobs=public/'proof-public-blobs';blobs.mkdir(mode=0o700,exist_ok=True)
        require(blobs.resolve(strict=True)==blobs,'public blob directory may not be redirected')
        for role,raw in values.items():
            pin=sha(raw);target=blobs/(pin+'.json')
            if target.exists():require(read_original(target)==raw,'existing public blob differs; never overwrite')
            else:write_new(target,raw)
            entries[role]=dict(originalAbsolutePath=str(originals[role]),publicRelativePath=str(target.relative_to(public)),sha256=pin,bytes=len(raw))
        manifest=dict(schema=SCHEMA,sourceCommit=source_commit,verifierBinarySHA256=verifier_sha256,entries=entries,originalContextSHA256=sha(values['context']),originalRequestSHA256=sha(values['request']),syntheticOnly=True,authorityGranted=False,actualNetworkExecutionClaim=False,independentReverification=False,meaning='Original bytes and separate path map only; not proof verification or authority. No keys, custody, HRS or directory traversal exported.')
        path=case/'original-public-proof-manifest.json';raw=json_bytes(manifest);write_new(path,raw)
    return dict(path=str(path.relative_to(public)),sha256=sha(raw),bytes=len(raw),independentReverification=False,authorityGranted=False)

def read_original_closure(manifest_path,manifest_sha256):
    manifest_path=Path(manifest_path);raw=read_original(manifest_path,256<<10);require(sha(raw)==manifest_sha256,'external original manifest pin differs')
    manifest=strict(raw);require(manifest.get('schema')==SCHEMA and manifest.get('syntheticOnly') is True and manifest.get('authorityGranted') is False and manifest.get('actualNetworkExecutionClaim') is False,'public closure scope differs')
    require(manifest_path.name=='original-public-proof-manifest.json' and manifest_path.parent.parent.name=='load-operations','fixed public manifest location required')
    public=manifest_path.parent.parent.parent;entries=manifest['entries'];require(set(entries)==set(FILES),'exact public proof closure allowlist required')
    values={};paths={}
    for role,entry in entries.items():
        pin=entry['sha256'];require(type(pin) is str and re.fullmatch('[0-9a-f]{64}',pin) and entry['publicRelativePath']=='proof-public-blobs/'+pin+'.json','public blob path differs from exact hash')
        path=public/entry['publicRelativePath'];value=read_original(path);require(sha(value)==pin and type(entry['bytes']) is int and len(value)==entry['bytes'],'original public blob pin/size differs')
        values[role]=value;paths[role]=path
    require(sum(map(len,values.values()))<=TOTAL_LIMIT and sha(values['context'])==manifest['originalContextSHA256'] and sha(values['request'])==manifest['originalRequestSHA256'],'original closure/context/request differs')
    original=strict(values['context']);require(original.get('version')=='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1' and original['lightTrust'].get('runtimePlanFile')=='' and original['lightTrust'].get('runtimePlanHash')=='','unsupported public context/source profile')
    return manifest,values,paths,original

def prepare_reverification(manifest_path,manifest_sha256,output):
    manifest,values,paths,original=read_original_closure(manifest_path,manifest_sha256)
    entries=manifest["entries"]
    derived=copy.deepcopy(original)
    for role,field in FIELDS.items():
        require(original['lightTrust'][field]==entries[role]['originalAbsolutePath'],'original context path map differs')
        derived['lightTrust'][field]=str(paths[role])
    require(sha(values['trustedLightBlock'])==original['lightTrust']['trustedLightBlockSHA256'],'original trusted LightBlock pin differs')
    output=Path(output);require(output.is_absolute() and not output.exists() and output.parent.resolve(strict=True)==output.parent,'fresh canonical independent output directory required');output.mkdir(mode=0o700)
    context_raw=json_bytes(derived);context_path=output/'derived-context.json';write_new(context_path,context_raw)
    mapping=dict(schema='YNX-PERF-PUBLIC-PROOF-RELOCATION/v1',originalManifestSHA256=manifest_sha256,originalContextSHA256=sha(values['context']),derivedContextSHA256=sha(context_raw),originalRequestSHA256=sha(values['request']),pathChanges={field:dict(original=original['lightTrust'][field],derived=derived['lightTrust'][field]) for field in FIELDS.values()},originalContextBytesPreserved=True,originalRequestBytesPreserved=True,derivedContextIsOriginal=False,authorityGranted=False,meaning='New-environment public DATA verification only; relocation grants no original authority or production activation.')
    write_new(output/'path-map.json',json_bytes(mapping))
    return manifest,context_path,sha(context_raw),paths['request'],mapping

def reverify(manifest_path,manifest_sha256,verifier,verifier_sha256,output,execute=False):
    manifest,context,context_pin,request,mapping=prepare_reverification(manifest_path,manifest_sha256,output)
    require(manifest['verifierBinarySHA256']==verifier_sha256 and sha(read_original(Path(verifier),128<<20))==verifier_sha256,'exact original normal verifier binary pin differs')
    command=[str(verifier),'--trust-context',str(context),'--trust-context-sha256',context_pin]
    report=dict(schema='YNX-PERF-INDEPENDENT-PUBLIC-PROOF-REVERIFY/v1',sourceCommit=manifest['sourceCommit'],verifierBinarySHA256=verifier_sha256,originalManifestSHA256=manifest_sha256,originalRequestSHA256=mapping['originalRequestSHA256'],derivedContextSHA256=context_pin,executed=False,independentCryptographicReverification=False,authorityGranted=False,actualNetworkExecutionClaim=False,originalAuthorityClaim=False,command=command)
    if execute:
        started=time.monotonic_ns();log=Path(output)/'normal-verifier.log'
        with open(log,'xb') as stream:
            try:process=subprocess.run(command,input=read_original(request),stdout=stream,stderr=subprocess.STDOUT,timeout=30,check=False);report['returnCode']=process.returncode
            except subprocess.TimeoutExpired:report['timeout']=True;report['returnCode']=None
        report.update(executed=True,parentElapsedNs=time.monotonic_ns()-started,originalVerifierLogSHA256=sha(read_original(log,4<<20,allow_empty=True)))
        try:result=strict(read_original(log,4<<20,allow_empty=True))
        except (ValueError,RuntimeError):result=None
        report['originalVerifierResult']=result
        # The existing normal verifier alone establishes cryptographic success.
        valid=False
        if report['returnCode']==0 and type(result) is dict:
            spec=importlib.util.spec_from_file_location('original_proof_readback_normal',Path(__file__).with_name('pq-normal-process-lab.py'));normal=importlib.util.module_from_spec(spec);spec.loader.exec_module(normal)
            expected=strict(read_original(context))['expectedTransaction']
            try:
                normal.require_verified(result,dict(abciHash=expected['transactionHash'],nativeHash=expected['nativeWireHash']))
                valid=True
            except RuntimeError:pass
        report['independentCryptographicReverification']=valid
    write_new(Path(output)/'reverification.json',json_bytes(report))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('manifest','manifest-sha256','verifier','verifier-sha256','output-directory'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    report=reverify(Path(args.manifest),args.manifest_sha256,Path(args.verifier),args.verifier_sha256,Path(args.output_directory),args.execute);print(json.dumps(report))
    if args.execute and not report['independentCryptographicReverification']:raise SystemExit(1)
