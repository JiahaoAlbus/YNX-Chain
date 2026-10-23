#!/usr/bin/env python3
"""Bounded identity readback of original signed/terminal streams, never BFT admission.
The owning Supply controller must separately qualify source, nodes, resources,
actual signature/state/quorum verification and the complete monotonic timeline.
"""
import base64,hashlib,json,os,re,stat,zlib
from pathlib import Path

ROW_LIMIT=64<<10
SEGMENT_LIMIT=64*(ROW_LIMIT+1)+8192
MAX_RECORDS=1_000_000
ZERO='0'*64

def need(condition,message):
    if not condition:raise RuntimeError(message)

def integer(value,low,high):return type(value) is int and low<=value<=high

def digest(raw):return hashlib.sha256(raw).hexdigest()

def hex_digest(value):return type(value) is str and re.fullmatch('[0-9a-f]{64}',value) is not None

def strict_json(raw):
    def unique(pairs):
        obj={}
        for key,value in pairs:
            need(key not in obj,'duplicate JSON key');obj[key]=value
        return obj
    def constant(_):raise RuntimeError('nonfinite JSON number')
    try:return json.loads(raw,object_pairs_hook=unique,parse_constant=constant)
    except (ValueError,UnicodeError) as error:raise RuntimeError('invalid stream JSON') from error

def capture(path,limit):
    before=path.lstat();need(stat.S_ISREG(before.st_mode) and before.st_size<=limit,'nonregular/oversized stream member')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as handle:
        opened=os.fstat(handle.fileno());need((opened.st_dev,opened.st_ino)==(before.st_dev,before.st_ino),'stream member replaced before open')
        raw=handle.read(limit+1);after=os.fstat(handle.fileno())
    final=path.lstat()
    fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    need(len(raw)<=limit and len(raw)==before.st_size and fields(before)==fields(after)==fields(final),'stream member changed during capture')
    return raw

def inventory(root,runtime_root,reported,relative,prefix,receipt,total):
    need(type(reported) is str and Path(reported)==runtime_root/relative,'reported stream directory escaped runtime scope')
    path=root/relative;before=path.lstat()
    need(stat.S_ISDIR(before.st_mode) and not path.is_symlink() and path.resolve()==path,'stream directory must be owned and nonsymlinked')
    segments=receipt.get('segments');need(integer(segments,1,total),'stream segment count bound')
    count=0
    with os.scandir(path) as entries:
        for entry in entries:
            count+=1;match=re.fullmatch(prefix+r'-(\d{6})\.jsonl',entry.name)
            need(match is not None and entry.is_file(follow_symlinks=False) and int(match[1])<segments and count<=segments,'stream inventory differs')
    need(count==segments,'missing original stream segment')
    return path,before

def finish_directory(path,before):
    after=path.lstat();need((before.st_dev,before.st_ino,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_ctime_ns),'stream directory changed during readback')

def signed_shape(encoded,templates,sender,round_number):
    try:wire=base64.b64decode(encoded,validate=True)
    except (ValueError,TypeError) as error:raise RuntimeError('invalid signed base64 identity') from error
    need(1<=len(wire)<=65536 and base64.b64encode(wire).decode()==encoded,'signed envelope size/encoding differs')
    tx=strict_json(wire);base=templates[sender]
    need(isinstance(tx,dict) and set(tx)==set(base),'signed transaction schema changed')
    for name in ('version','chainId','amount','fee','nonce'):need(type(tx.get(name)) is int,'signed numeric identity is not typed')
    need(tx['version']==1 and tx['chainId']==6423 and tx.get('type')=='transfer' and tx['amount']==1 and tx['fee']==1 and tx['nonce']==round_number and type(tx.get('signature')) is str and bool(tx['signature']) and type(tx.get('publicKey')) is str and bool(tx['publicKey']),'native business/nonce identity differs')
    need(all(value==base[key] for key,value in tx.items() if key not in ('nonce','signature')),'successor changed signed business template')
    return wire

def verify_streams(capture_root,runtime_root,runtime_output,manifest_raw,initial,intents,terminal,latest,rounds,evidence_limit):
    root=Path(capture_root).absolute();runtime_root=Path(runtime_root);output=Path(runtime_output)
    need(root.resolve()==root and runtime_root.is_absolute() and output==runtime_root/'transactions-result.json','fixed original runtime/capture paths required')
    senders=len(initial);total=senders*rounds
    need(integer(senders,1,2048) and integer(rounds,2,4096) and total<=MAX_RECORDS and integer(evidence_limit,1,2<<30),'stream workload bound')
    need(isinstance(latest,list) and len(latest)==senders,'latest slot coverage differs')
    manifest=strict_json(manifest_raw)
    need(isinstance(manifest,dict) and hex_digest(manifest.get('migrationStateHash')) and hex_digest(manifest.get('genesisHash')),'manifest binding hashes invalid')
    need(type(manifest.get('version')) is int and manifest['version']==1 and manifest.get('chainId')=='ynx_6423-1' and manifest.get('purpose')=='local-ephemeral-consensus-quorum-only-not-for-remote-or-custody','original isolated ephemeral manifest scope differs')
    binding=dict(kind='YNX_LOCAL_READY_SENDER_V1',manifestSha256=digest(manifest_raw),migrationHash=manifest['migrationStateHash'],genesisHash=manifest['genesisHash'])
    templates=[]
    for encoded in initial:
        try:templates.append(strict_json(base64.b64decode(encoded,validate=True)))
        except (ValueError,TypeError) as error:raise RuntimeError('initial signed input malformed') from error
    need(all(isinstance(t,dict) for t in templates),'initial transaction must be an object')
    need(len({t.get('from') for t in templates})==senders,'initial accounts are not independent')
    for sender,encoded in enumerate(initial):signed_shape(encoded,templates,sender,1)
    for receipt in (intents,terminal):
        need(receipt.get('poisoned') is False and type(receipt.get('records')) is int and receipt['records']==total and integer(receipt.get('bytes'),1,1<<30) and hex_digest(receipt.get('chainSha256')),'incomplete stream receipt')
    need(type(terminal.get('durableRecords')) is int and terminal['durableRecords']==total and terminal.get('encoding','') in ('','gzip') and intents['bytes']+terminal['bytes']<=evidence_limit,'terminal durability/combined byte budget differs')
    need(integer(terminal.get('segments'),1,(total+63)//64),'terminal segment bound')
    member_count=0;member_manifest=hashlib.sha256();intent_state={};terminal_state={}
    def record_member(file,raw):
        nonlocal member_count
        descriptor=dict(path=str(file.relative_to(root)),bytes=len(raw),sha256=digest(raw))
        member_manifest.update((json.dumps(descriptor,sort_keys=True,separators=(',',':'))+'\n').encode());member_count+=1
    def intent_rows():
        path,before=inventory(root,runtime_root,intents.get('directory'),'sender-ready-intents','intent',intents,total)
        chain=ZERO;sequence=0;size=0;last=[0]*senders
        for segment in range(intents['segments']):
            file=path/('intent-%06d.jsonl'%segment);raw=capture(file,min(SEGMENT_LIMIT,intents['bytes']-size));size+=len(raw)
            need(raw.endswith(b'\n') and b'\n' in raw,'incomplete signed segment')
            first,payload=raw.split(b'\n',1);h=strict_json(first);rows=payload[:-1].split(b'\n')
            need(set(h)=={'kind','fixture','segment','firstRecord','records','previousSha256','payloadSha256'} and h['kind']=='YNX_LOCAL_READY_INTENT_SEGMENT_V1' and h['fixture']==binding and type(h['segment']) is int and h['segment']==segment and type(h['firstRecord']) is int and h['firstRecord']==sequence and integer(h['records'],1,64) and h['records']==len(rows) and h['previousSha256']==chain and h['payloadSha256']==digest(payload),'signed segment fixture/hash/coverage differs')
            chain=digest(raw);record_member(file,raw)
            for line in rows:
                need(len(line)<=ROW_LIMIT,'signed row byte bound');e=strict_json(line)
                need(set(e)=={'index','sender','round','hash','transaction'} and integer(e['index'],0,total-1) and type(e['sender']) is int and e['sender']==e['index']%senders and type(e['round']) is int and e['round']==e['index']//senders+1 and e['round']==last[e['sender']]+1,'signed sender/index/nonce coverage differs')
                wire=signed_shape(e['transaction'],templates,e['sender'],e['round']);need(e['hash']==digest(wire).upper(),'signed wire hash differs')
                last[e['sender']]=e['round'];sequence+=1;yield e
        finish_directory(path,before);need(sequence==total and size==intents['bytes'] and chain==intents['chainSha256'] and all(v==rounds for v in last),'signed stream final coverage/bytes/hash differs')
        intent_state.update(records=sequence,bytes=size,chainSha256=chain)
    def terminal_rows():
        relative='transactions-result.json.terminal-stream';path,before=inventory(root,runtime_root,terminal.get('directory'),relative,'terminal',terminal,total)
        chain=ZERO;sequence=0;size=0;last=[0]*senders
        for segment in range(terminal['segments']):
            file=path/('terminal-%06d.jsonl'%segment);stored=capture(file,min(SEGMENT_LIMIT,terminal['bytes']-size));size+=len(stored)
            record_member(file,stored)
            raw=stored
            if terminal.get('encoding')=='gzip':
                try:
                    decoder=zlib.decompressobj(31);raw=decoder.decompress(stored,SEGMENT_LIMIT+1)
                except zlib.error as error:raise RuntimeError('invalid original gzip member') from error
                need(len(raw)<=SEGMENT_LIMIT and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,'gzip concatenation/tail/expansion bound')
            need(raw.endswith(b'\n') and len(raw)<=SEGMENT_LIMIT,'terminal incomplete tail/byte bound')
            lines=raw[:-1].split(b'\n');need(3<=len(lines)<=66,'terminal line bound');h=strict_json(lines[0])
            need(set(h)=={'kind','segment','firstSequence','previousSha256','fixture'} and h['kind']=='YNX_LOCAL_TERMINAL_SEGMENT_V1' and type(h['segment']) is int and h['segment']==segment and type(h['firstSequence']) is int and h['firstSequence']==sequence and h['previousSha256']==chain and h['fixture']==binding,'terminal header/fixture chain differs')
            batch=[]
            for line in lines[1:-1]:
                need(len(line)<=ROW_LIMIT,'terminal row byte bound');row=strict_json(line)
                need(set(row)=={'sequence','previousSha256','result'} and type(row['sequence']) is int and row['sequence']==sequence and row['previousSha256']==chain,'terminal row hash/sequence differs')
                r=row['result'];need(isinstance(r,dict) and integer(r.get('index'),0,total-1) and type(r.get('round')) is int and r['round']==r['index']//senders+1 and r['round']==last[r['index']%senders]+1,'terminal sender nonce coverage differs')
                need(r.get('status')=='confirmed' and type(r.get('checkTxCode')) is int and r['checkTxCode']==0 and type(r.get('executionCode')) is int and r['executionCode']==0 and all(r.get(k) is True for k in ('checkTxIdentityVerified','quorumVerified','transactionProofVerified','durableStateVerified','durableInfoVerified')) and type(r.get('height')) is int and r['height']>0 and type(r.get('durableStateHeight')) is int and r['durableStateHeight']==r['height'] and type(r.get('durableInfoHeight')) is int and r['durableInfoHeight']==r['height'],'terminal is not a reported qualified business final')
                chain=digest(line);last[r['index']%senders]=r['round'];sequence+=1;batch.append(r)
            seal=strict_json(lines[-1]);need(set(seal)=={'kind','records','chainSha256'} and seal['kind']=='YNX_LOCAL_TERMINAL_SEAL_V1' and type(seal['records']) is int and seal['records']==len(batch) and seal['chainSha256']==chain,'terminal seal differs')
            yield from batch
        finish_directory(path,before);need(sequence==total and size==terminal['bytes'] and chain==terminal['chainSha256'] and all(v==rounds for v in last),'terminal final coverage/bytes/hash differs')
        terminal_state.update(records=sequence,bytes=size,chainSha256=chain)
    intents_iter=iter(intent_rows());pending={};matched=0;matched_latest=0;peak_pending=0
    for row in terminal_rows():
        index=row['index']
        while index not in pending:
            try:e=next(intents_iter)
            except StopIteration as error:raise RuntimeError('terminal has no matching original signed intent') from error
            need(e['index'] not in pending and len(pending)<senders+64,'signed/terminal join exceeded original bounded window');pending[e['index']]=e;peak_pending=max(peak_pending,len(pending))
        e=pending.pop(index);wire=signed_shape(row.get('signedTransaction'),templates,index%senders,row['round'])
        need(row.get('bytes')==len(wire) and type(row.get('bytes')) is int and row.get('hash')==e['hash'] and row['signedTransaction']==e['transaction'],'terminal signed envelope changed')
        if row['round']==rounds:
            need(json.dumps(latest[index%senders],sort_keys=True,separators=(',',':'))==json.dumps(row,sort_keys=True,separators=(',',':')),'latest slot differs from original terminal');matched_latest+=1
        matched+=1
    try:next(intents_iter)
    except StopIteration:pass
    else:raise RuntimeError('unmatched signed suffix')
    need(not pending and matched==total and matched_latest==senders and intent_state and terminal_state,'incomplete signed/terminal join')
    return dict(schema=1,validatedRecords=matched,matchedLatestSlots=matched_latest,peakPendingIdentities=peak_pending,intents=intent_state,terminal=terminal_state,originalPublicMemberManifest=dict(members=member_count,sha256=member_manifest.hexdigest(),encoding='sha256 of canonical sorted-key compact JSON descriptors(path,bytes,sha256), each followed by LF; intent sequence then terminal sequence; not a whole-ZIP digest'),networkQualified=False,sustainedTPSQualified=False,interpretation='Read-only original stream identity/coverage validation. Reported quorum/state flags and hash chains do not replace independent source/node/BFT/durable/resource admission. No network call or submission.')
