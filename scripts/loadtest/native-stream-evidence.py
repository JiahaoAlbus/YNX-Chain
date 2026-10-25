#!/usr/bin/env python3
"""Bounded identity readback of original signed/terminal streams, never BFT admission.
The owning Supply controller must separately qualify source, nodes, resources,
actual signature/state/quorum verification and the complete monotonic timeline.
"""
import base64,hashlib,json,os,re,stat,zlib,math,calendar,datetime
from array import array
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

class LatencyFold:
    """Same fixed 1ms/60s histogram intervals as Go; never retain lifetime rows."""
    names=('queue','checkTx','authenticatedInclusion','effectiveBusinessInclusion','final','offerToFinal')
    measured_names=names+('checkToObservedInclusion','observedInclusionToFinal','offerToEffectiveBusinessInclusion')
    def __init__(self):
        self.bins=[array('Q',[0])*60001 for _ in self.measured_names]
        self.samples=0;self.mins=[None]*9;self.maxs=[0]*9
        self.queue_ns=0;self.peak_queue_ns=0;self.callback_ns=0;self.callback_samples=0
    def add(self,row):
        values=[row.get(k) for k in ('queueDelayMs','checkTxMs','inclusionMs','inclusionMs','confirmationMs')]
        need(all(type(v) in (int,float) and math.isfinite(v) and 0<=v<(2**63-1)/1e6 for v in values),'complete finite original latency fields required')
        need(values[1]<=values[2]<=values[4],'original stage latencies are not ordered')
        values.extend((values[0]+values[4],values[2]-values[1],values[4]-values[2],values[0]+values[2]))
        ns=[]
        for value in values:
            scaled=value*1e6;whole=math.floor(scaled)
            ns.append(whole+(1 if scaled-whole>=0.5 else 0))
        need(all(0<=v<2**63 for v in ns) and self.samples<MAX_RECORDS,'latency sample/duration bound')
        for i,v in enumerate(ns):
            self.bins[i][min(v//1000000,60000)]+=1
            self.mins[i]=v if self.mins[i] is None else min(v,self.mins[i]);self.maxs[i]=max(v,self.maxs[i])
        self.samples+=1;self.queue_ns+=ns[0];self.peak_queue_ns=max(self.peak_queue_ns,ns[0])
        callback=row.get('submissionPhases',{}).get('callbackReturnNs')
        if callback is not None:
            need(integer(callback,0,2**63-1),'invalid original callback interval')
            self.callback_ns+=callback;self.callback_samples+=1
    def result(self):
        need(self.samples>0,'empty original latency fold');out={}
        for i,name in enumerate(self.measured_names):
            dist=dict(samples=self.samples,resolutionNs=1000000,overflowSamples=self.bins[i][-1],minNs=self.mins[i],maxNs=self.maxs[i])
            rank=[(self.samples*q+99)//100 for q in (50,95,99)];seen=0;n=0
            for bucket,count in enumerate(self.bins[i]):
                seen+=count
                while n<3 and seen>=rank[n]:
                    dist[('p50','p95','p99')[n]]=dict(valid=True,lowerNs=max(bucket*1000000,self.mins[i]),upperNs=min(self.maxs[i],(bucket+1)*1000000-1) if bucket<60000 else self.maxs[i],overflow=bucket==60000);n+=1
                if n==3:break
            out[name]=dist
        return dict(records=self.samples,latencyIntervalsNs={k:out[k] for k in self.names},stageGapIntervalsNs={k:out[k] for k in ('queue','checkTx','checkToObservedInclusion','observedInclusionToFinal')},offerLatencyIntervalsNs={k:out[k] for k in ('offerToEffectiveBusinessInclusion','offerToFinal')},queueWaitNs=self.queue_ns,peakQueueWaitNs=self.peak_queue_ns,callbackReturnNs=self.callback_ns,callbackSamples=self.callback_samples)


def verify_bounded_latency(measured,bounded):
    need(isinstance(bounded,dict) and type(bounded.get('terminalRecords')) is int and bounded['terminalRecords']==measured['records'] and type(bounded.get('invalidLatencyRecords')) is int and bounded['invalidLatencyRecords']==0,'bounded latency record coverage differs')
    # Strict JSON equality also excludes bools being accepted as integer counters.
    need(json.dumps(measured['latencyIntervalsNs'],sort_keys=True,separators=(',',':'))==json.dumps(bounded.get('latencyIntervalsNs'),sort_keys=True,separators=(',',':')),'bounded latency intervals differ from complete original stream')
    return measured


def qualified_terminal_publication(row):
    """Mirror original Go qualifiedBusinessFinal/verifyJournalPublishedState.

    Published Info may advance while the reader verifies an earlier committed
    state. Equal height requires equal AppHash; a later Info hash belongs to its
    own height and must never be relabeled as the earlier post-state hash.
    """
    need(row.get('status')=='confirmed' and type(row.get('checkTxCode')) is int and row['checkTxCode']==0 and type(row.get('executionCode')) is int and row['executionCode']==0 and all(row.get(k) is True for k in ('checkTxIdentityVerified','quorumVerified','transactionProofVerified','durableStateVerified','durableInfoVerified')),'terminal is not a reported qualified business final')
    height,state,info=(row.get(k) for k in ('height','durableStateHeight','durableInfoHeight'))
    need(integer(height,1,2**63-1) and integer(state,height,2**63-1) and integer(info,state,2**63-1),'terminal durable publication height regressed')
    hashes=[row.get(k) for k in ('durableStateAppHash','durableInfoAppHash')]
    need(all(type(h) is str and re.fullmatch('[0-9a-fA-F]{64}',h) is not None for h in hashes),'terminal publication AppHash malformed')
    if state==info:need(hashes[0].lower()==hashes[1].lower(),'same-height published AppHash differs')
    return height,state,info


def verify_streams(capture_root,runtime_root,runtime_output,manifest_raw,initial,intents,terminal,latest,rounds,evidence_limit,measure_latency=False,node_completion_join=None,submission_trace_join=None):
    need(node_completion_join is None or isinstance(node_completion_join,NodeCompletionJoin),'original node completion join type differs')
    fold=LatencyFold() if measure_latency else None
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
                qualified_terminal_publication(r)
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
        if fold is not None:fold.add(row)
        if node_completion_join is not None:node_completion_join.add(row)
        if submission_trace_join is not None:submission_trace_join.add(row)
        matched+=1
    try:next(intents_iter)
    except StopIteration:pass
    else:raise RuntimeError('unmatched signed suffix')
    need(not pending and matched==total and matched_latest==senders and intent_state and terminal_state,'incomplete signed/terminal join')
    result=dict(schema=1,validatedRecords=matched,matchedLatestSlots=matched_latest,peakPendingIdentities=peak_pending,intents=intent_state,terminal=terminal_state,originalPublicMemberManifest=dict(members=member_count,sha256=member_manifest.hexdigest(),encoding='sha256 of canonical sorted-key compact JSON descriptors(path,bytes,sha256), each followed by LF; intent sequence then terminal sequence; not a whole-ZIP digest'),networkQualified=False,sustainedTPSQualified=False,interpretation='Read-only original stream identity/coverage validation. Reported quorum/state flags and hash chains do not replace independent source/node/BFT/durable/resource admission. No network call or submission.')

    if fold is not None:result['rowMetrics']=fold.result()
    if node_completion_join is not None:result['nodeCompletionJoin']=node_completion_join.result()
    if submission_trace_join is not None:result['submissionTraceJoin']=submission_trace_join.result()
    return result


def reader_gate_measurements(reader,required=False):
    """Actual outer reader lock wall totals, not additive decoder/RPC stages."""
    need(type(required) is bool,'reader gate timing selection must be boolean')
    gate=reader.get('readerGate')
    if gate is None:
        need(not required,'selected original outer reader gate timing absent')
        return None
    fields=('acquisitions','waitNs','maxWaitNs','holdNs','maxHoldNs')
    need(type(gate) is dict and set(gate)==set(fields),'outer reader gate measurement schema differs')
    need(all(integer(gate[k],0,2**63-1) for k in fields),'outer reader gate counters invalid')
    attempts=reader.get('attempts')
    need(integer(attempts,0,2**63-1) and gate['acquisitions']>=attempts,'outer reader gate acquisition coverage differs')
    need(gate['maxWaitNs']<=gate['waitNs'] and gate['maxHoldNs']<=gate['holdNs'],'outer reader gate maxima exceed totals')
    if gate['acquisitions']==0:need(all(gate[k]==0 for k in fields),'unused outer reader gate has timings')
    else:need(gate['holdNs']>0 and gate['maxHoldNs']>0,'acquired outer reader gate hold absent')
    return dict(gate)


def client_clock_measurements(timeline,records,required=False):
    need(type(required) is bool and integer(records,1,MAX_RECORDS),'client clock selection/record bound differs')
    clock=timeline.get('clock')
    if clock is None:
        need(not required,'selected original client clock measurements absent')
        return None
    keys={'originUnixNs','samples','invalidSamples','maximumAbsWallDriftNs','valid','driftWithin1ms'}
    need(type(clock) is dict and set(clock)==keys,'client clock measurement schema differs')
    origin=clock['originUnixNs']
    need(type(origin) is str and re.fullmatch('[1-9][0-9]{0,18}',origin) is not None and int(origin)<=2**63-1,'client origin must preserve exact Unix nanoseconds')
    need(all(integer(clock[k],0,2**63-1) for k in ('samples','invalidSamples','maximumAbsWallDriftNs')),'client clock counter invalid')
    need(clock['samples']+clock['invalidSamples']==3*records,'client offered/submitted/hand-back clock coverage differs')
    valid=clock['invalidSamples']==0 and clock['samples']>0
    need(type(clock['valid']) is bool and clock['valid']==valid and type(clock['driftWithin1ms']) is bool and clock['driftWithin1ms']==(valid and clock['maximumAbsWallDriftNs']<=1000000),'client clock validity/drift claim differs')
    return dict(clock)


def client_hash_encoding_measurements(report,selected=False):
    """Actual explicit client process window counters, never finality authority."""
    need(type(report) is dict and type(selected) is bool and report.get('nativeCachedFeeJSON',False) is selected,'client hash encoding selection differs')
    value=report.get('clientStateHashEncoding')
    if not selected:
        need('clientStateHashEncoding' not in report,'unselected client hash encoding inventory')
        return None
    need(type(value) is dict and set(value)=={'mode','candidateAttempts','encodingErrors'},'client hash encoding inventory differs')
    need(value['mode']=='cached-fee-time-json' and integer(value['candidateAttempts'],1,2**63-1) and type(value['encodingErrors']) is int and value['encodingErrors']==0,'selected client hash work absent/failed')
    reader=report.get('durableReadback');need(type(reader) is dict,'client hash reader inventory absent')
    prefix=reader.get('prefixReplay');need(type(prefix) is dict,'client hash prefix inventory absent')
    phases=prefix.get('workPhases');need(type(phases) is dict,'client hash work inventory absent')
    details=phases.get('certificatePublishDetails');need(type(details) is dict,'client hash publication inventory absent')
    accepted=details.get('preparedNativeAccepted')
    need(prefix.get('preparedCertificate') is True and integer(accepted,1,2**63-1) and value['candidateAttempts']>=accepted,'client hash work lacks prepared full-state coverage')
    return dict(value)


def certificate_publish_measurements(phases,canonical_limit,required=False,native_clone=False,canonical_native=False,prepared_native=False):
    """Nested costs are already inside certificatePublish; never sum twice."""
    need(type(required) is bool and type(native_clone) is bool and type(canonical_native) is bool and (not canonical_native or native_clone) and integer(canonical_limit,1,512<<20),'certificate timing selection/bound differs')
    need(type(prepared_native) is bool and not(prepared_native and (canonical_native or not native_clone)),'prepared timing selection differs')
    details=phases.get('certificatePublishDetails')
    if details is None:
        need(not required,'selected certificatePublish child costs absent')
        return None
    phase_names=('payloadCopy','strictJSON','nativeClone')
    base=set(phase_names)|{'payloadBytes','prefixBytesHashed'}
    optional=({'canonicalNative','canonicalNativeAccepted'} if canonical_native else set())|({'preparedNativeAccepted'} if prepared_native else set())
    need(type(details) is dict and base<=set(details)<=base|optional,'certificate child inventory differs')
    candidate=details.get('canonicalNative')
    accepted=details.get('canonicalNativeAccepted',0)
    need(integer(accepted,0,2**63-1),'canonical native accepted count invalid')
    prepared_accepted=details.get('preparedNativeAccepted',0)
    need(integer(prepared_accepted,0,2**63-1),'prepared accepted count invalid')
    encode=phases.get('preparedEncodeDetails')
    if prepared_native:
        names=('normalize','jsonEncode','publicCopy','fallbackEncode')
        need(type(encode) is dict and set(encode)==set(names),'prepared encode child inventory differs')
        parent=phases.get('suffixEncode',{})
        for part in (parent,*(encode[k] for k in names)):
            need(type(part) is dict and set(part)=={'calls','errors','durationNs'} and all(integer(v,0,2**63-1) for v in part.values()),'prepared encode child counts/time invalid')
            need(part['errors']<=part['calls'] and (part['calls']>0 and part['durationNs']>0 or part['calls']==part['errors']==part['durationNs']==0),'prepared encode empty/error coverage differs')
        normalize,json_encode,public_copy,fallback=(encode[k] for k in names)
        need(normalize['calls']==parent['calls'] and normalize['errors']==0 and json_encode['calls']+fallback['calls']==normalize['calls'] and public_copy['calls']==json_encode['calls']-json_encode['errors'] and public_copy['errors']==0,'prepared encode branch coverage differs')
        need(prepared_accepted<=public_copy['calls'] and sum(encode[k]['errors'] for k in names)==parent['errors'] and sum(encode[k]['durationNs'] for k in names)<=parent['durationNs'],'prepared encode children exceed publication/parent coverage')
    else:
        need(encode is None,'unselected prepared encode child timings')
    if prepared_native:
        suffix=phases.get('suffixEncode',{});need(integer(suffix.get('calls'),0,2**63-1) and integer(suffix.get('errors'),0,2**63-1) and 0<prepared_accepted<=suffix['calls']-suffix['errors'],'prepared accepted lacks successful owned encoding')
    children=[details[k] for k in phase_names]+([candidate] if candidate is not None else [])
    parent=phases.get('certificatePublish',{})
    for part in (parent,*children):
        need(type(part) is dict and set(part)=={'calls','errors','durationNs'} and all(integer(v,0,2**63-1) for v in part.values()),'certificate child counts/time invalid')
        need(part['errors']<=part['calls'] and (part['calls']>0 and part['durationNs']>0 or part['calls']==part['errors']==part['durationNs']==0),'certificate child empty/error coverage differs')
    payload,strict,native=(details[k] for k in phase_names)
    payload_success=payload['calls']-payload['errors']
    if canonical_native:
        need((candidate is not None and candidate['calls']==payload_success and candidate['errors']==0 and accepted<=candidate['calls']) or (candidate is None and payload_success==accepted==0),'canonical native branch coverage differs')
    accepted+=prepared_accepted
    need(payload['calls']==parent['calls'] and strict['calls']==(payload_success-accepted if native_clone else 0) and native['calls']==(accepted+strict['calls']-strict['errors'] if native_clone else 0),'certificate child branch coverage differs')
    need(sum(p['errors'] for p in children)==parent['errors'] and sum(p['durationNs'] for p in children)<=parent['durationNs'],'certificate child errors/time exceed parent')
    for key in ('payloadBytes','prefixBytesHashed'):
        need(integer(details[key],0,min(2**63-1,parent['calls']*canonical_limit)),'certificate copied/hashed byte budget differs')
        need(payload['calls']==0 and details[key]==0 or payload['calls']>0 and (payload['errors']==payload['calls'] or details[key]>0),'certificate actual byte coverage absent')
    return {k:dict(v) if type(v) is dict else v for k,v in details.items()}


def utc_nanoseconds(value):
    """Go UTC timestamps, parsed without a float or loss of nanoseconds."""
    need(type(value) is str,'exact UTC timestamp required')
    match=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z',value)
    need(match is not None,'exact UTC timestamp format differs')
    try:date=datetime.datetime.strptime(match[1],'%Y-%m-%dT%H:%M:%S')
    except ValueError as error:raise RuntimeError('invalid UTC calendar timestamp') from error
    ns=calendar.timegm(date.timetuple())*1000000000+int((match[2] or '').ljust(9,'0') or '0')
    need(integer(ns,1,2**63-1),'UTC timestamp outside signed nanosecond range')
    return ns


class NodeCompletionJoin:
    """Bounded diagnostic join, never independent BFT or same-VM admission.

    Input node phases must come from readNodePhaseTiming, after original node
    shutdown; the owner separately verifies source, /proc host and BFT evidence.
    Header AppHash at H is deliberately not treated as post-state AppHash at H.
    """
    names=('offerToNodeFinalizeReturn','offerToNodeDurableCommitReturn','nodeCommitToClientFinalObservation')
    def __init__(self,endpoints,node_phases,timeline,records):
        need(type(endpoints) is list and len(endpoints)==4 and all(type(e) is str and e for e in endpoints) and len(set(endpoints))==4,'four unique original node endpoints required')
        need(type(node_phases) is list and len(node_phases)==4,'four original node phase reports required')
        self.clock=client_clock_measurements(timeline,records,True)
        need(self.clock['valid'] and self.clock['driftWithin1ms'],'client clock cannot qualify node correlation')
        self.nodes={};self.expected=records;self.records=0;self.max_error=0;self.info_ahead=0;self.state_ahead=0
        self.bins=[array('Q',[0])*60001 for _ in self.names]
        self.mins=[None]*3;self.maxs=[0]*3
        for endpoint,phase in zip(endpoints,node_phases):
            clock=phase.get('blockExecutionClock',{})
            drift=clock.get('maximumAbsWallDriftNs')
            need(clock.get('completeCommitCoverage') is True and clock.get('completeBlockHashCoverage') is True and clock.get('driftWithin1ms') is True and integer(drift,0,1000000),'complete calibrated node clocks required')
            origin=clock.get('originUnixNs');need(type(origin) is str and re.fullmatch('[1-9][0-9]{0,18}',origin) is not None and int(origin)<=2**63-1,'exact node origin required')
            blocks=clock.get('blocks');need(type(blocks) is list and 1<=len(blocks)<=4096,'bounded node block points required')
            indexed={}
            for point in blocks:
                height=point.get('height');need(integer(height,1,2**63-1) and height not in indexed,'duplicate/invalid node block height')
                need(all(hex_digest(point.get(k)) for k in ('blockHash','appHash')),'node block/state identity absent')
                need(integer(point.get('transactions'),0,MAX_RECORDS) and integer(point.get('codeZeroTransactions'),0,point['transactions']),'node transaction coverage invalid')
                points=[]
                for name in ('finalizeReturned','commitReturned'):
                    at=point.get(name,{})
                    ns=at.get('unixNs');elapsed=at.get('elapsedNs');offset=at.get('wallDriftNs')
                    need(type(ns) is str and re.fullmatch('[1-9][0-9]{0,18}',ns) is not None and int(ns)<=2**63-1 and integer(elapsed,0,2**63-1) and type(offset) is int and abs(offset)<=drift and int(ns)-int(origin)-elapsed==offset,'node point calibration differs')
                    points.append(int(ns))
                need(points[0]<=points[1],'node completion order differs')
                indexed[height]=(point,points)
            self.nodes[endpoint]=(indexed,drift)
    def add(self,row):
        need(self.records<self.expected,'node join record bound exceeded')
        height,state_height,info_height=qualified_terminal_publication(row)
        need(row.get('endpoint') in self.nodes,'terminal endpoint outside original node set')
        indexed,drift=self.nodes[row['endpoint']];need(all(h in indexed for h in (height,state_height,info_height)),'terminal publication height missing node completion')
        point,(finalized,committed)=indexed[height]
        state_point,state_times=indexed[state_height];info_point,info_times=indexed[info_height]
        need(type(row.get('blockHash')) is str and row['blockHash'].lower()==point['blockHash'] and row['durableStateAppHash'].lower()==state_point['appHash'] and row['durableInfoAppHash'].lower()==info_point['appHash'],'terminal block/post-state identities differ from node completion')
        need(type(row.get('blockTxTotal')) is int and row['blockTxTotal']==point['transactions'] and integer(row.get('blockTxIndex'),0,point['transactions']-1),'terminal transaction position differs from node block')
        offered=utc_nanoseconds(row.get('offeredAt'));submitted=utc_nanoseconds(row.get('submittedAt'));observed=utc_nanoseconds(row.get('confirmedObservedAt'))
        error=drift+self.clock['maximumAbsWallDriftNs']
        need(offered>=int(self.clock['originUnixNs']) and offered<=submitted and submitted<=finalized+error and max(committed,state_times[1],info_times[1])<=observed+error,'cross-process completion order outside measured clock error')
        values=(finalized-offered,committed-offered,observed-committed)
        for i,value in enumerate(values):
            low=max(0,value-error);high=max(0,value+error)
            # Conservative quantile envelopes include calibration uncertainty;
            # bins store upper bounds, and min/max retain exact integer bounds.
            self.bins[i][min(high//1000000,60000)]+=1
            self.mins[i]=low if self.mins[i] is None else min(low,self.mins[i]);self.maxs[i]=max(high,self.maxs[i])
        self.max_error=max(self.max_error,error);self.records+=1
        self.info_ahead+=int(info_height>state_height);self.state_ahead+=int(state_height>height)
    def result(self):
        need(self.records==self.expected,'incomplete original node/terminal join')
        distributions={}
        for i,name in enumerate(self.names):
            ranks=[(self.records*q+99)//100 for q in (50,95,99)];seen=0;next_rank=0
            dist=dict(samples=self.records,resolutionNs=1000000,overflowSamples=self.bins[i][-1],minimumLowerBoundNs=self.mins[i],maximumUpperBoundNs=self.maxs[i])
            for bucket,count in enumerate(self.bins[i]):
                seen+=count
                while next_rank<3 and seen>=ranks[next_rank]:
                    # Every lower bound differs from its upper bound by at
                    # most twice the maximum measured calibration error.
                    dist[('p50','p95','p99')[next_rank]]=dict(lowerNs=max(self.mins[i],bucket*1000000-2*self.max_error),upperNs=min(self.maxs[i],(bucket+1)*1000000-1) if bucket<60000 else self.maxs[i]);next_rank+=1
                if next_rank==3:break
            distributions[name]=dist
        return dict(records=self.records,publishedInfoAheadRows=self.info_ahead,durableStateAheadRows=self.state_ahead,maximumCalibrationErrorBoundNs=self.max_error,nodeCompletionLatencyIntervalsNs=distributions,independentSameVMAdmission=False,independentBFTVerification=False,bftQuorumFormationInstantMeasured=False,networkQualified=False,interpretation='Original endpoint node transaction-height Finalize and durable Commit returns joined by block hash; durable readback and published Info each match their own post-state height/hash. Calibrated wall-clock envelopes include client/node drift. These are completion observations after reported verified BFT proof, not the earliest quorum formation instant. Original native admission and cryptographic verifier remain mandatory.')


def current_input_reuse_measurements(reader,selected=False):
    need(type(selected) is bool,'current input reuse selection must be boolean')
    stats=reader.get('currentInputReuse')
    if not selected:
        need(stats is None,'unselected current input reuse has statistics')
        return None
    fields={'enabled','attempts','errors','hits','misses','comparedBytes','lookupNs','retainedInputBytes'}
    need(type(stats) is dict and set(stats)==fields and stats['enabled'] is True,'selected current input reuse statistics missing')
    need(all(integer(stats[k],0,2**63-1) for k in fields-{'enabled'}),'current input reuse counter invalid')
    need(integer(reader.get('snapshotValidations'),0,2**63-1) and stats['misses']==reader['snapshotValidations'],'current input reuse misses differ from actual decode work')
    need(integer(reader.get('snapshotCacheHits'),0,2**63-1) and stats['hits']<=reader['snapshotCacheHits'] and stats['comparedBytes']>=stats['hits'],'current input reuse hit/byte coverage differs')
    budget=reader.get('readerBudget',{})
    need(integer(budget.get('cachedInputBytes'),0,2**31) and integer(budget.get('cacheInputByteBudget'),1,2**31) and stats['retainedInputBytes']==budget['cachedInputBytes']<=budget['cacheInputByteBudget'],'current retained input budget differs')
    need(stats['attempts']==stats['hits']+stats['misses']+stats['errors'],'current input lookup attempts/outcomes differ')
    need(stats['lookupNs']>0 if stats['attempts'] else stats['lookupNs']==0,'actual current input lookup timer absent')
    return dict(stats)


def suffix_replay_measurements(phases, required=False):
    """Validate selected local replay children; none are node/disk completion."""
    detail=phases.get('suffixReplayDetails')
    need(type(required) is bool and (detail is not None)==required,'suffix replay timing selection differs')
    if not required:return None
    frame={'readFrame','decodeRecord','checkpointValidate','decodeRequest','finalize','verifyResponse','memoryCommit','finalValidate'}
    need(type(detail) is dict and set(detail)==frame|{'finalizeDetails'},'suffix replay child inventory differs')
    def phase(value):
        need(type(value) is dict and set(value)=={'calls','errors','durationNs'} and all(type(v) is int and v>=0 for v in value.values()) and value['errors']<=value['calls'],'invalid replay child counter')
        need(value['calls']>0 or value['errors']==value['durationNs']==0,'empty replay child has work')
        need(value['calls']==0 or value['durationNs']>0,'active replay child timing absent')
        return value
    for name in frame:phase(detail[name])
    parent=phase(phases['suffixReplay'])
    need(parent['calls']>0 and detail['finalize']['calls']>0 and sum(detail[n]['durationNs'] for n in frame)<=parent['durationNs'],'suffix children exceed parent or real replay missing')
    chain=('readFrame','decodeRecord','decodeRequest','finalize','verifyResponse','memoryCommit')
    need(all(detail[a]['calls']>=detail[b]['calls'] for a,b in zip(chain,chain[1:])) and detail['finalValidate']['calls']<=parent['calls'] and detail['checkpointValidate']['calls']==0,'suffix child branch coverage differs')
    final=detail['finalizeDetails'];names={'cloneExecutionState','executeTransactions','sealState','buildResponse'}
    need(type(final) is dict and set(final)==names|{'transactionDetails'},'replay Finalize child inventory differs')
    for name in names:phase(final[name])
    need(final['cloneExecutionState']['calls']==detail['finalize']['calls'] and sum(final[n]['durationNs'] for n in names)<=detail['finalize']['durationNs'],'Finalize children exceed parent/call count')
    chain=('cloneExecutionState','executeTransactions','sealState','buildResponse')
    need(all(final[a]['calls']>=final[b]['calls'] for a,b in zip(chain,chain[1:])),'Finalize child branch coverage differs')
    tx=final['transactionDetails'];names={'envelopeType','nativeDecodeVerified','nativeApplyState','nativeFeeEventAppend'}
    need(type(tx) is dict and set(tx)==names,'replay transaction child inventory differs')
    for name in names:phase(tx[name])
    chain=('envelopeType','nativeDecodeVerified','nativeApplyState','nativeFeeEventAppend')
    need(all(tx[a]['calls']>=tx[b]['calls'] for a,b in zip(chain,chain[1:])) and tx['nativeFeeEventAppend']['calls']>0,'native transaction/fee replay missing or inconsistent')
    need(sum(tx[n]['durationNs'] for n in names-{'nativeFeeEventAppend'})<=final['executeTransactions']['durationNs'] and tx['nativeFeeEventAppend']['durationNs']<=tx['nativeApplyState']['durationNs'],'transaction children exceed parent; fee append is nested')
    return dict(details=detail,localReplayOnly=True,nodeDurabilityMeasured=False,interpretation='Frame children are inside suffixReplay; Finalize children inside finalize; fee append inside nativeApplyState. Not additional CPU/wall, node execution, disk durability or earliest BFT formation.')
