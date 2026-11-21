"""Original proof-confirmation observation DATA, never consensus-time authority.

The caller has already verified the original public closure and the exact
four-node local Commit clock DATA. This reader does not run a verifier, infer
an H/H+1 block hash for a local Commit, or upgrade a reported finality flag.
"""
import base64
import hashlib
import io
import json
import re


def require(value, message):
    if not value: raise ValueError(message)


def strict(raw):
    require(type(raw) is bytes and 0 < len(raw) <= 8 << 20, 'bounded original JSON required')
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result, 'duplicate original JSON field')
            result[key]=value
        return result
    def invalid(value): raise ValueError('nonfinite original JSON')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=invalid)


def pin(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}',value) is not None


def same(left,right):
    if type(left) is not type(right):return False
    if type(left) is dict:
        return left.keys()==right.keys() and all(same(left[key],right[key]) for key in left)
    if type(left) is list:
        return len(left)==len(right) and all(same(a,b) for a,b in zip(left,right))
    return left==right


def decimal(value):
    require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*',value) is not None,
            'canonical original proof height required')
    number=int(value);require(number < 1 << 63, 'bounded original proof height required');return number


def rpc_index(value):
    if type(value) is int:
        require(0<=value<1<<32, 'bounded original RPC index required');return value
    number=decimal(value);require(number<1<<32, 'bounded original RPC index required');return number


def project(receipt,files,prefix,clock,qualified):
    """Bind saved qualified events to original H/H+1 verifier output and clock.

    qualified contains only operations whose original closure passed the normal
    held reader. Clock has independently recomputed same-process/node DATA;
    its original static source gates remain the sole entry to usable rows.
    """
    output=dict(schema='YNX-PERF-ORIGINAL-CONFIRMATION-BOUND/v1',status='NOT_SUPPLIED',
        configuredDemand=500,observed=0,censored=500,rows=[],sourceCIIndependentlyVerified=False,
        independentCryptographicReverification=False,independentFinality=False,runtimeAuthorized=False,
        consensusFinalityTimeNs=None,localCommitBlockHashBound=False,
        nodeSuccessorCommitEventTimesNs=None,nodeSuccessorBlockHashBound=False,
        perOriginalJSONLimitBytes=8<<20,journalEventLimit=100000,readbackRSS='UNKNOWN',
        meaning='Parent-observed original verifier and sender-confirmation completion upper bound; '
                'node Commit events have height/state identity only. Neither is the consensus finality instant.')
    try:
        load=receipt['loadResult'];rows=load['rows'];parent=receipt['commitClockParent']
        require(receipt.get('sameHost') is True and type(receipt.get('physicalFaultDomains')) is int
            and receipt['physicalFaultDomains']==1 and type(parent['processID']) is int and parent['processID']>0
            and type(load.get('originProcessID')) is int and load['originProcessID']==parent['processID']
            and parent.get('clock')=='CLOCK_MONOTONIC' and type(parent.get('bootID')) is str
            and type(parent.get('timeNamespace')) is str, 'original parent clock identity unavailable')
        require(clock.get('status')=='OBSERVED_OR_CENSORED' and clock.get('configuredDemand')==500
            and type(clock.get('rows')) is list and len(clock['rows'])==500
            and type(rows) is list and len(rows)==500 and type(qualified) is dict,
            'original full-demand clock or proof observations unavailable')
        require(all(type(row) is dict and type(row.get('index')) is int and pin(row.get('id')) for row in rows)
            and sorted(row['index'] for row in rows)==list(range(500))
            and len({row['id'] for row in rows})==500, 'original demand rows differ')
        require(all(type(row) is dict and type(row.get('index')) is int for row in clock['rows'])
            and sorted(row['index'] for row in clock['rows'])==list(range(500)), 'original clock rows differ')
        clocks={row['index']:row for row in clock['rows']}
        segments=receipt['journalSegments'];require(type(segments) is list and 0<len(segments)<=4096,
            'bounded original event journal required')
        seen=set();events={};stage_events={};total=0;event_order=0
        for segment_index,segment in enumerate(segments):
            name=segment['path'];require(type(name) is str and re.fullmatch(r'load-events-\d{5}\.jsonl',name)
                and name=='load-events-%05d.jsonl'%segment_index and name not in seen,
                'ordered unique original event segment required');seen.add(name)
            data=files[prefix+name];total+=len(data)
            require(total <= 32 << 20 and type(segment['bytes']) is int and segment['bytes']==len(data)
                and data.endswith(b'\n') and segment['sha256']==hashlib.sha256(data).hexdigest(), 'original event bytes differ')
            for line in io.BytesIO(data):
                item=strict(line);event_order+=1
                require(event_order<=100000, 'original event inventory exceeds bound')
                if item.get('kind')=='qualified':
                    index=item.get('index');require(type(index) is int and 0<=index<500 and index not in events,
                        'unique original qualified event required');events[index]=(item,event_order)
                elif item.get('kind')=='normal_stage' and item.get('stage') in ('verifier','confirm','receipt','proof_portable_export'):
                    index=item.get('index');require(type(index) is int and 0<=index<500,
                        'original stage event index differs')
                    bucket=stage_events.setdefault((index,item['stage']),[])
                    require(len(bucket)<2, 'original stage event multiplicity exceeds bound')
                    bucket.append((item,event_order))
        output['status']='OBSERVED_OR_CENSORED'
        for row in rows:
            index=row['index'];entry=dict(index=index,id=row['id'],status='CENSORED',
                submitToConfirmationObservedUpperNs=None,proofReportedBlockHashH=None,
                proofReportedBlockHashHPlus1=None,applicationStateAtHMatchesProofHPlus1=False)
            try:
                original=qualified[index];event,qualified_order=events[index];node=clocks[index]
                submitted,included,final,cutoff=(row['submittedNs'],row['includedNs'],row['finalNs'],load['observationCutoffNs'])
                require(all(type(value) is int and 0<=value<1<<63 for value in (submitted,included,final,cutoff))
                    and row.get('status')=='qualified' and type(row.get('terminalNs')) is int and row['terminalNs']==final
                    and submitted<=included<=final<cutoff and node['status']=='OBSERVED'
                    and node['id']==row['id'] and type(node['nodesNs']) is list and len(node['nodesNs'])==4
                    and all(type(value) is int and 0<=value<=final-submitted for value in node['nodesNs'])
                    and node['fourNodeUpperBoundNs']==max(node['nodesNs']), 'original bounded clock observation differs')
                require(event.get('id')==row['id'] and event.get('index')==index and event.get('atNs')==final
                    and type(event.get('atNs')) is int
                    and event.get('hash')==row['hash'] and event.get('nativeHash')==row['nativeHash']
                    and event.get('normalVerifierCode')=='VERIFIED_TRANSACTION_DATA'
                    and event.get('normalConfirmCode')=='PROOF_CONFIRMED_DATA'
                    and event.get('executionSuccessful') is True and event.get('executionCode')=='0'
                    and event.get('transactionType')=='pq_transfer' and type(event.get('members')) is int
                    and event['members']==1 and event.get('nativeGrant') is False
                    and event.get('proofReference')==row['proofReference'], 'original qualified event differs')
                points=row['stageTimes'];require(type(points) is list,'original stage chronology missing')
                selected=[];stage_orders=[]
                for name in ('verifier','confirm','receipt','proof_portable_export'):
                    matches=[point[1] for point in points if type(point) is list and len(point)==2 and point[0]==name]
                    require(len(matches)==1 and type(matches[0]) is int,'original verifier/confirm stage missing')
                    originals=stage_events.get((index,name),[])
                    require(len(originals)==1 and originals[0][0].get('id')==row['id']
                            and type(originals[0][0].get('atNs')) is int and originals[0][0].get('atNs')==matches[0]
                            and originals[0][1]<qualified_order,
                            'original stage journal differs')
                    selected.append(matches[0]);stage_orders.append(originals[0][1])
                require(all(a<b for a,b in zip(stage_orders,stage_orders[1:])), 'original stage journal order differs')
                require(included<=selected[0]<=selected[1]<=selected[2]<=selected[3]<=final,
                    'original verification/confirmation chronology differs')
                origin=decimal(load['originMonotonicNs'])
                require(origin+cutoff < 1<<63, 'original parent time overflows')
                helpers=receipt['normalHelperLifecycle']['parentTiming']['records']
                verifier_traces=[trace for trace in helpers if type(trace) is dict
                    and trace.get('name')=='load-%05d-normal-verifier'%index]
                require(len(verifier_traces)==1 and not verifier_traces[0].get('errorType')
                    and type(verifier_traces[0].get('requestedMonotonicNs')) is int
                    and type(verifier_traces[0].get('returnedMonotonicNs')) is int
                    and origin+selected[0]<=verifier_traces[0]['requestedMonotonicNs']
                    <=verifier_traces[0]['returnedMonotonicNs']<=origin+selected[1],
                    'original verifier completion timing differs')
                records=receipt['normalPublicOwnerTransport']['records']
                confirmations=[record for record in records if type(record) is dict and record.get('operation')=='confirm'
                    and type(record.get('ownerIndex')) is int and record['ownerIndex']==row['ownerIndex']
                    and record.get('operationId')==row['operationId']]
                require(len(confirmations)==1 and confirmations[0].get('code')=='PROOF_CONFIRMED_DATA'
                    and type(confirmations[0].get('requestedMonotonicNs')) is int
                    and type(confirmations[0].get('returnedMonotonicNs')) is int
                    and origin+selected[1]<=confirmations[0]['requestedMonotonicNs']
                    <=confirmations[0]['returnedMonotonicNs']<=origin+selected[2],
                    'original sender confirmation timing differs')
                verifier=original['normalVerifier'];confirm=original['normalConfirm'];proof=verifier['result']
                require(original.get('id')==row['id'] and original.get('operationId')==row['operationId']
                    and original.get('mode')=='online' and type(original['transaction'].get('ownerIndex')) is int
                    and original['transaction']['ownerIndex']==row['ownerIndex']
                    and type(row.get('nonce')) is int and row['nonce']>0
                    and original['transaction'].get('firstNonce')==str(row['nonce'])
                    and original['transaction'].get('members')=='1' and original['transaction'].get('type')=='pq_transfer'
                    and original['transaction']['abciHash'].removeprefix('0x').lower()==row['hash']
                    and original['transaction']['nativeHash'].removeprefix('0x').lower()==row['nativeHash']
                    and original['normalLiveResult']['transactionHash'].removeprefix('0x').lower()==row['hash']
                    and original['normalLiveResult']['nativeWireHash'].removeprefix('0x').lower()==row['nativeHash']
                    and verifier['code']=='VERIFIED_TRANSACTION_DATA' and confirm['code']=='PROOF_CONFIRMED_DATA'
                    and confirm.get('version')=='YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1'
                    and type(confirm.get('ownerIndex')) is int and confirm['ownerIndex']==row['ownerIndex']
                    and confirm.get('operationId')==row['operationId']
                    and same(confirm['result']['result'],proof) and proof['included'] is True and proof['finalized'] is True
                    and proof['executionSuccessful'] is True and proof['nativeGrant'] is False
                    and proof['transactionHash'].removeprefix('0x').lower()==row['hash']
                    and proof['nativeWireHash'].removeprefix('0x').lower()==row['nativeHash'],
                    'original verifier and confirmation proof identities differ')
                h=decimal(proof['height']);block=proof['block'];successor=proof['successor']
                require(h>0 and h<(1<<63)-1 and decimal(block['headerHeight'])==h
                    and decimal(block['stateHeight'])==h-1 and decimal(successor['headerHeight'])==h+1
                    and decimal(successor['stateHeight'])==h and block['chainId']==successor['chainId']
                    and pin(block['blockHash']) and pin(successor['blockHash']) and pin(successor['stateAppHash'])
                    and all(part.get('commitVerified') is True and part.get('lightTransitionVerified') is True
                            for part in (block,successor)), 'original reported H/H+1 proof differs')
                closure=strict(files[prefix+original['originalPublicProofClosure']['path']])
                entries=closure['entries']
                request=strict(files[prefix+entries['request']['publicRelativePath']])
                context=strict(files[prefix+entries['context']['publicRelativePath']])
                original_proof=strict(files[prefix+entries['proof']['publicRelativePath']])
                expected=request['expected']
                require(request['version']=='YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1'
                    and context['version']=='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1'
                    and same(context['expectedTransaction'],expected) and same(request['proof'],original_proof)
                    and context['lightTrust']['chainId']==block['chainId']
                    and pin(context['lightTrust']['originalGenesisHash'])
                    and pin(context['lightTrust']['consensusGenesisSHA256'])
                    and block['genesisSha256']==successor['genesisSha256']==context['lightTrust']['consensusGenesisSHA256']
                    and expected['transactionType']=='pq_transfer' and expected['transactionHash']==row['hash']
                    and expected['nativeWireHash']==row['nativeHash']
                    and decimal(expected['index'])==decimal(proof['index']), 'original proof request/context differs')
                for original_header,reported in ((expected['block'],block),(expected['successor'],successor)):
                    require(all(original_header[key]==reported[key] for key in
                        ('chainId','headerHeight','blockHash','stateHeight','stateAppHash')),
                        'original proof header/result differs')
                abci=files[prefix+'load-operations/%05d/transaction.abci'%index]
                wire=files[prefix+'load-operations/%05d/transaction.wire'%index]
                require(base64.b64decode(expected['envelope'],validate=True)==abci
                    and base64.b64decode(expected['nativeWire'],validate=True)==wire
                    and hashlib.sha256(abci).hexdigest()==row['hash']
                    and hashlib.sha256(wire).hexdigest()==row['nativeHash'], 'original signed transaction bytes differ')
                inclusion=strict(files[prefix+'load-operations/%05d/four-node-inclusion.json'%index])
                require(type(inclusion.get('rows')) is list and len(inclusion['rows'])==4
                    and all(decimal(item['height'])==h and rpc_index(item['index'])==decimal(proof['index'])
                            for item in inclusion['rows']), 'original proof/inclusion position differs')
                snapshots=receipt['normalCommitObservation']['originalSnapshots'];states=[]
                for i in range(4):
                    refs=[ref for ref in snapshots if type(ref) is dict and ref.get('node')==i]
                    require(len(refs)==1 and refs[0]['path']=='commit-observation-node-%d-original.json'%i,
                            'original node Commit snapshot missing')
                    original_snapshot=strict(files[prefix+refs[0]['path']])
                    require(original_snapshot['chainID']==block['chainId']
                        and original_snapshot['originalGenesisHash']==context['lightTrust']['originalGenesisHash'],
                        'original node/proof network identity differs')
                    sample=original_snapshot['samples']
                    matches=[item for item in sample if type(item) is dict and item.get('height')==h]
                    require(len(matches)==1 and pin(matches[0].get('appHash')),'original node state height differs')
                    states.append(matches[0]['appHash'])
                require(all(value==successor['stateAppHash'] for value in states), 'original H state and successor proof differ')
                entry.update(status='OBSERVED_DATA',submitToConfirmationObservedUpperNs=final-submitted,
                    proofReportedBlockHashH=block['blockHash'],proofReportedBlockHashHPlus1=successor['blockHash'],
                    applicationStateAtHMatchesProofHPlus1=True)
                output['observed']+=1
            except (KeyError,ValueError,TypeError,AttributeError,IndexError,OverflowError,RecursionError):pass
            output['rows'].append(entry)
        output['censored']=500-output['observed']
    except (KeyError,ValueError,TypeError,AttributeError,IndexError,OverflowError,RecursionError):pass
    return output
