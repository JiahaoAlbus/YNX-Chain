#!/usr/bin/env bash
set -Eeuo pipefail

# The normal Go codec consumes an externally approved complete Registration.
# This caller owns transport/evidence only; it never creates an approval, PoP,
# key, schedule, membership root or consensus activation authorization.
exec python3 - "$@" <<'PY'
import argparse, base64, hashlib, ipaddress, json, os, re, stat, subprocess, sys, urllib.parse, uuid

MAX_WIRE=128 << 10
MAX_BODY=2*MAX_WIRE+128
MAX_RPC=8 << 20
KIND='ynx_validator_registry_v1'
VERSION='YNX-VALIDATOR-REGISTRATION-CALLER/v1'
attempt=None
observation=None

def require(ok, message):
    if not ok: raise ValueError(message)

def unique(pairs):
    out={}
    for k,v in pairs:
        require(k not in out, 'duplicate JSON field')
        out[k]=v
    return out

def decode(raw):
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON number')))

def canonical(value):
    return (json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n').encode()

def hex_pin(value):
    require(isinstance(value,str) and re.fullmatch('[0-9a-f]{64}',value) and value!='0'*64, 'independent nonzero lowercase SHA256 required')
    return value

def b64(value):
    require(isinstance(value,str), 'base64 field must be a string')
    raw=base64.b64decode(value,validate=True)
    require(base64.b64encode(raw).decode()==value,'noncanonical base64 field')
    return raw

def decimal(value, minimum=1):
    require(isinstance(value,str) and re.fullmatch('0|[1-9][0-9]*',value),'canonical decimal string required')
    n=int(value)
    require(minimum<=n<=2**63-1,'height/index out of range')
    return n

def integer(value, maximum=2**32-1):
    require(type(value) is int and 0<=value<=maximum,'invalid exact integer')
    return value

def digest(raw): return hashlib.sha256(raw).hexdigest()

def safe_path(path):
    require(os.path.isabs(path) and os.path.normpath(path)==path and os.path.realpath(path)==path,'absolute canonical path without symlinks required')
    return path

def regular(path, maximum, executable=False):
    safe_path(path)
    before=os.lstat(path)
    require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<before.st_size<=maximum,'input must be a bounded original single-link regular file')
    if executable: require(before.st_mode & 0o111,'normal Go encoder must be executable')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        opened=os.fstat(fd)
        require((opened.st_dev,opened.st_ino)==(before.st_dev,before.st_ino),'input identity changed while opening')
        with os.fdopen(fd,'rb',closefd=False) as f: raw=f.read(maximum+1)
        after=os.fstat(fd)
        identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_nlink)
        require(identity(before)==identity(after)==identity(os.lstat(path)) and len(raw)==before.st_size,'input changed while reading')
        return raw
    finally: os.close(fd)

def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def fresh_file(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb',closefd=False) as f: f.write(raw); f.flush(); os.fsync(fd)
    finally: os.close(fd)
    sync_dir(os.path.dirname(path))

def fresh_dir(path):
    safe_path(path)
    parent=os.path.dirname(path)
    require(os.path.isdir(parent) and not os.path.islink(parent),'existing canonical parent required')
    os.mkdir(path,0o700) # any existing, partial or dangling attempt is terminal
    sync_dir(parent)

def run_encoder(wire_path, destination):
    require(digest(regular(args.encoder,128<<20,True))==args.encoder_sha256,'normal encoder differs from independent binary pin')
    out=os.path.join(destination,'encoding.json'); err=os.path.join(destination,'encoding.stderr')
    # Both files are exclusive and retained even if the fixed tool refuses.
    with open(out,'xb') as stdout, open(err,'xb') as stderr:
        result=subprocess.run([args.encoder,'encode-validator-registration','--wire',wire_path,'--wire-sha256',args.wire_sha256],stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,timeout=15,check=False)
        stdout.flush(); stderr.flush(); os.fsync(stdout.fileno()); os.fsync(stderr.fileno())
    sync_dir(destination)
    require(result.returncode==0,'normal Go registration encoder refused original wire')
    encoded=decode(regular(out,MAX_BODY*2))
    require(encoded.get('version')=='YNX-VALIDATOR-REGISTRATION-ENCODING/v1' and encoded.get('encoded') is True and encoded.get('registrationAuthorized') is False,'encoder result must not grant registration authority')
    require(encoded.get('wireSHA256')==args.wire_sha256,'encoder wire identity mismatch')
    body=b64(encoded.get('payloadBase64'))
    require(0<len(body)<=MAX_BODY and encoded.get('abciHash')=='0x'+digest(body),'encoder ABCI identity mismatch')
    wire=regular(wire_path,MAX_WIRE)
    require(digest(wire)==args.wire_sha256,'original wire changed before encoding')
    envelope=decode(body)
    require(envelope=={'type':KIND,'wire':wire.hex()},'normal encoder payload differs from exact original wire')
    hex_pin(encoded.get('consensusGenesisSHA256'))
    require(isinstance(encoded.get('chainId'),str) and 0<len(encoded['chainId'])<=50,'encoder network identity missing')
    require(isinstance(encoded.get('operationHash'),str) and re.fullmatch('0x[0-9a-f]{64}',encoded['operationHash']),'domain-separated operation identity missing')
    decimal(encoded.get('approvedAt')); decimal(encoded.get('effectiveAt'))
    require(isinstance(encoded.get('validatorAddress'),str) and re.fullmatch('[0-9a-f]{40}',encoded['validatorAddress']),'logical validator identity missing')
    return body,encoded

def code(result): return integer(result.get('code',0))

def tx_hash(value):
    require(isinstance(value,str) and re.fullmatch('[0-9a-fA-F]{64}',value),'invalid Comet transaction hash')
    return value.lower()

def rpc(label, method, params=None):
    target=os.path.join(observation,label)
    response=target+'.response.json'; error=target+'.stderr'; status_file=target+'.http-status'
    # No curl config, proxy, redirect, network retry or alternative endpoint.
    command=['curl','--disable','--noproxy','*','--proto','=http,https','--retry','0','--connect-timeout','5','--max-time','20','--max-filesize',str(MAX_RPC),'--silent','--show-error']
    if method=='broadcast_tx_commit':
        request=canonical({'jsonrpc':'2.0','id':'validator-registration','method':method,'params':{'tx':base64.b64encode(payload).decode()}})
        request_path=target+'.request.json'; fresh_file(request_path,request)
        command+=['--request','POST','--header','content-type: application/json','--data-binary','@'+request_path]
        url=args.rpc
    else:
        url=args.rpc+'/'+method+'?'+urllib.parse.urlencode(params or {})
    # Reserve output before curl; opening an existing file is not an overwrite
    # permission. The new private observation directory owns this path only.
    fd=os.open(response,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); os.close(fd)
    command+=['--output',response,'--write-out','%{http_code}','--url',url]
    with open(error,'xb') as stderr:
        completed=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=stderr,timeout=23,check=False)
        stderr.flush(); os.fsync(stderr.fileno())
    fresh_file(status_file,completed.stdout)
    with open(response,'rb') as f: os.fsync(f.fileno())
    sync_dir(observation)
    require(completed.returncode==0,'RPC transport failed; retain original attempt without rebroadcast')
    require(completed.stdout==b'200','RPC HTTP status is not 200; redirects are not followed')
    value=decode(regular(response,MAX_RPC))
    require(isinstance(value,dict) and value.get('jsonrpc')=='2.0' and value.get('error') is None and isinstance(value.get('result'),dict),'RPC error/malformed result is not confirmation')
    if method=='broadcast_tx_commit': require(value.get('id')=='validator-registration','broadcast response identity differs')
    return value['result']

def readback(broadcast=None):
    found=rpc('tx','tx',{'hash':'0x'+digest(payload),'prove':'false'})
    require(tx_hash(found.get('hash'))==digest(payload) and b64(found.get('tx'))==payload,'transaction readback differs from original exact ABCI bytes')
    height=decimal(found.get('height')); index=integer(found.get('index'))
    require(height==decimal(encoding['approvedAt']),'observed execution height differs from signed original ApprovedAt')
    execution=found.get('tx_result')
    require(isinstance(execution,dict),'actual execution result missing')
    actual_code=code(execution)
    if broadcast is not None:
        require(decimal(broadcast.get('height'))==height and broadcast.get('tx_result')==execution,'broadcast and indexed execution disagree')
    block=rpc('block','block',{'height':str(height)})
    header=block.get('block',{}).get('header',{})
    require(header.get('chain_id')==encoding['chainId'] and decimal(header.get('height'))==height,'block network/height differs from original intent')
    block_hash=tx_hash(block.get('block_id',{}).get('hash'))
    txs=block.get('block',{}).get('data',{}).get('txs')
    require(isinstance(txs,list) and index<len(txs) and b64(txs[index])==payload,'actual Comet block index differs from original transaction')
    results=rpc('block-results','block_results',{'height':str(height)})
    require(decimal(results.get('height'))==height,'execution-results height differs')
    all_results=results.get('txs_results')
    require(isinstance(all_results,list) and len(all_results)==len(txs) and all_results[index]==execution,'block execution result/index differs')
    query=rpc('registry','abci_query',{'path':'"/validator-registry"','height':'0','prove':'false'}).get('response')
    require(isinstance(query,dict) and code(query)==0,'committed registry query refused')
    query_height=decimal(query.get('height'))
    require(query_height>=height,'registry query precedes original execution')
    registry=decode(b64(query.get('value')))
    def receipt(state,root):
        return dict(version=VERSION,status=state,source='configured-comet-rpc',transactionType=KIND,abciHash=encoding['abciHash'],wireSHA256=args.wire_sha256,operationHash=encoding['operationHash'],height=str(height),transactionIndex=str(index),blockHash=block_hash,executionCode=str(actual_code),queryHeight=str(query_height),registryRoot=root,registrationObserved=actual_code==0,independentFinalityVerified=False,scheduleAuthorized=False,pqActivationVerified=False,automaticRetry=False)
    if registry is None:
        require(actual_code!=0,'successful execution has no committed registry history')
        return receipt('execution_rejected','')
    require(isinstance(registry,dict) and type(registry.get('version')) is int and registry['version']==1 and isinstance(registry.get('events'),list) and len(registry['events'])>0,'committed registry history absent')
    bootstrap=registry.get('bootstrap',{})
    require(bootstrap.get('chainId')==encoding['chainId'] and bootstrap.get('cometGenesisSHA256')==encoding['consensusGenesisSHA256'],'committed registry differs from signed original network')
    root=hex_pin(registry.get('root'))
    matches=[]; previous_height=0; previous_index=-1
    for position,event in enumerate(registry['events']):
        require(isinstance(event,dict) and integer(event.get('index'),2**64-1)==position,'registry event sequence differs')
        h=integer(event.get('height'),2**63-1); ti=integer(event.get('transactionIndex'))
        require(0<h<=query_height and h>=previous_height and (h!=previous_height or ti>previous_index),'registry event ordering differs')
        previous_height,previous_index=h,ti
        if event.get('abciHash')==encoding['abciHash']: matches.append(event)
    if actual_code!=0:
        require(not matches,'failed execution conflicts with committed registry event')
        state='execution_rejected'
    else:
        require(b64(execution.get('data'))==encoding['abciHash'].encode(),'execution Data does not identify exact original ABCI bytes')
        require(len(matches)==1,'committed registry must contain exactly one original event')
        event=matches[0]
        require(event.get('height')==height and event.get('transactionIndex')==index and event.get('operationHash')==encoding['operationHash'] and b64(event.get('wire'))==original_wire,'committed registry original wire/operation/height/index differs')
        state='registered_observed'
    return receipt(state,root)

try:
    parser=argparse.ArgumentParser(allow_abbrev=False,description='Single-submit validator registration with preserved UNKNOWN and explicit readback')
    parser.add_argument('mode',choices=['submit','readback'])
    for name in ['attempt-dir','rpc','encoder','encoder-sha256','wire-sha256']: parser.add_argument('--'+name,required=True)
    parser.add_argument('--wire')
    flags=[x.split('=',1)[0] for x in sys.argv[1:] if x.startswith('--')]
    require(len(flags)==len(set(flags)),'duplicate command-line option')
    args=parser.parse_args()
    os.umask(0o077)
    hex_pin(args.encoder_sha256); hex_pin(args.wire_sha256)
    safe_path(args.encoder); safe_path(args.attempt_dir)
    parsed=urllib.parse.urlsplit(args.rpc)
    require(re.fullmatch(r'https?://(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(?::[1-9][0-9]{0,4})?/?',args.rpc) is not None and (parsed.port is None or 1<=parsed.port<=65535),'canonical RPC root without credentials, whitespace or path required')
    require(parsed.scheme in ('https','http') and parsed.hostname and parsed.username is None and parsed.password is None and not parsed.query and not parsed.fragment and parsed.path in ('','/'),'explicit canonical Comet RPC root required')
    if parsed.scheme=='http':
        require(ipaddress.ip_address(parsed.hostname).is_loopback,'plain HTTP is restricted to the original loopback Comet RPC')
    args.rpc=args.rpc.rstrip('/')
    require((args.mode=='submit')==(args.wire is not None),'--wire is required only for the original submit; readback uses preserved original bytes')
    identity=dict(version=VERSION,rpc=args.rpc,encoderSHA256=args.encoder_sha256,wireSHA256=args.wire_sha256,automaticRetry=False)
    if args.mode=='submit':
        require(os.environ.get('PUBLIC_BFT_VALIDATOR_REGISTRATION_APPROVED')=='yes','explicit registration broadcast approval is required')
        original_wire=regular(args.wire,MAX_WIRE)
        require(digest(original_wire)==args.wire_sha256,'original wire differs from independent SHA256')
        require(digest(regular(args.encoder,128<<20,True))==args.encoder_sha256,'normal encoder differs from independent binary pin')
        fresh_dir(args.attempt_dir); attempt=args.attempt_dir
        fresh_file(os.path.join(attempt,'registration.wire'),original_wire)
        payload,encoding=run_encoder(os.path.join(attempt,'registration.wire'),attempt)
        fresh_file(os.path.join(attempt,'transaction.json'),payload)
        identity.update(status='unknown',abciHash=encoding['abciHash'],operationHash=encoding['operationHash'])
        fresh_file(os.path.join(attempt,'intent.json'),canonical(identity))
    else:
        attempt=args.attempt_dir
        s=os.lstat(attempt)
        require(stat.S_ISDIR(s.st_mode) and s.st_mode & 0o077==0,'original private attempt directory required')
        prior=decode(regular(os.path.join(attempt,'intent.json'),65536))
        require(all(type(prior.get(k))==type(v) and prior[k]==v for k,v in identity.items()) and prior.get('status')=='unknown','readback differs from original fixed attempt inputs')
        original_wire=regular(os.path.join(attempt,'registration.wire'),MAX_WIRE)
        require(digest(original_wire)==args.wire_sha256,'preserved original wire changed')
        payload=regular(os.path.join(attempt,'transaction.json'),MAX_BODY)
        encoding=decode(regular(os.path.join(attempt,'encoding.json'),MAX_BODY*2))
        require(prior.get('abciHash')==encoding.get('abciHash')=='0x'+digest(payload) and prior.get('operationHash')==encoding.get('operationHash'),'preserved ABCI identity changed')
    observation=os.path.join(attempt,'observation-'+uuid.uuid4().hex)
    fresh_dir(observation)
    if args.mode=='readback':
        checked,metadata=run_encoder(os.path.join(attempt,'registration.wire'),observation)
        require(checked==payload and metadata==encoding,'normal re-encoding differs from preserved original evidence')
    broadcast=None
    if args.mode=='submit':
        # Durable intent + exact body/hash exist before the only write request.
        broadcast=rpc('broadcast','broadcast_tx_commit')
        require(tx_hash(broadcast.get('hash'))==digest(payload),'broadcast transaction identity differs')
        check=broadcast.get('check_tx')
        require(isinstance(check,dict),'CheckTx result missing')
        if code(check)!=0:
            result=dict(identity,status='check_rejected',checkCode=str(code(check)),registrationObserved=False,source='configured-comet-rpc',independentFinalityVerified=False,scheduleAuthorized=False,pqActivationVerified=False)
            fresh_file(os.path.join(observation,'result.json'),canonical(result))
            sys.stdout.buffer.write(canonical(result)); sys.exit(3)
    result=readback(broadcast)
    fresh_file(os.path.join(observation,'result.json'),canonical(result))
    sys.stdout.buffer.write(canonical(result))
    sys.exit(0 if result['registrationObserved'] else 3)
except (Exception,) as error:
    # Never overwrite an earlier intent, response, result or UNKNOWN. The
    # original command's diagnostic is retained; no retry/rebroadcast occurs.
    message=str(error)
    status='UNKNOWN' if attempt is not None else 'REFUSED'
    if observation is not None:
        try: fresh_file(os.path.join(observation,'failure.json'),canonical(dict(version=VERSION,status=status,firstCause=message,automaticRetry=False)))
        except Exception: pass
    print('VALIDATOR_REGISTRATION_'+status+': '+message,file=sys.stderr)
    sys.exit(1)
PY
