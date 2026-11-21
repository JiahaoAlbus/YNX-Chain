"""Bind original H+1 height visibility to submitted operations, not finality."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re


spec=importlib.util.spec_from_file_location('successor_d24_originals',Path(__file__).with_name('pq-first100-d24-readback.py'))
d24=importlib.util.module_from_spec(spec);spec.loader.exec_module(d24)
require,strict=d24.require,d24.strict


def integer(value):
    require(type(value) is int and 0<=value<1<<63,'original nonnegative integer required')
    return value


def inspect(files,prefix,receipt):
    load=receipt.get('loadResult')
    if load is None:return dict(status='NOT_SUPPLIED',records=[],independentFinality=False)
    demand=integer(load['configuredDemand']);encoded_origin=load['originMonotonicNs']
    require(type(encoded_origin) is str and re.fullmatch(r'[1-9][0-9]{0,18}',encoded_origin),
            'original canonical decimal parent origin required')
    origin=integer(int(encoded_origin))
    rows=load['rows'];require(0<demand<=10000 and len(rows)==demand,'complete original demand required')
    require({r['index'] for r in rows}==set(range(demand)),'unique complete original indices required')
    by_index={r['index']:r for r in rows};found={}
    for path in files:
        if not path.startswith(prefix):continue
        match=re.fullmatch(r'load-operations/([0-9]{5})/successor-availability.json',path[len(prefix):])
        if match:
            index=int(match[1]);require(index in by_index,'height availability outside original demand')
            found[index]=path
    records=[]
    for index,path in sorted(found.items()):
        row=by_index[index];base=prefix+'load-operations/%05d/'%index
        available=strict(files[path]);inclusion=strict(files[base+'four-node-inclusion.json'])
        intent=strict(files[base+'submission-intent.json'])
        require(intent['id']==row['id'] and intent['operationId']==row['operationId']
                and intent['owner']==row['ownerIndex'] and intent['nonce']==str(row['nonce'])
                and intent['transactionHash']==row['hash'] and intent['submissionAttempts']==1
                and intent['qualifiedFinal'] is False,'original submission binding differs')
        require(inclusion['qualifiedFinal'] is False and available['qualifiedFinal'] is False,
                'height visibility cannot claim finality')
        height=integer(available['transactionHeight']);required=integer(available['minimumSuccessorHeight'])
        require(height>0 and required==height+1,'original H/H+1 differs')
        replies=inclusion['rows'];require(len(replies)==4,'four original inclusion replies required')
        for reply in replies:
            require(reply['height']==str(height) and reply['hash'].lower()==row['hash']
                    and type(reply['tx_result']['code']) is int and reply['tx_result']['code']==0,
                    'original inclusion identity/height/execution differs')
            tx=base64.b64decode(reply['tx'],validate=True)
            require(hashlib.sha256(tx).hexdigest()==row['hash'],'original RPC transaction bytes differ')
        observed=available['observations']
        require(len(observed)==4 and all(type(v['node']) is int for v in observed)
                and {v['node'] for v in observed}==set(range(4)),'four distinct original successor nodes required')
        require(all(min(integer(v['engineHeight']),integer(v['applicationHeight']))>=required for v in observed),
                'all original engine/application heights must reach H+1')
        submitted=integer(row['submittedNs']);included=integer(row['includedNs'])
        at=integer(available['observedMonotonicNs'])-origin
        stages=dict(row['stageTimes']);begin=integer(stages['successor_availability'])
        require(0<=submitted<=included<=begin<=at<=integer(row['terminalNs']),
                'original parent clock/operation ordering differs')
        live=stages.get('live_publish')
        if live is not None:require(integer(live)>=at,'proof publication preceded observed availability')
        records.append(dict(index=index,ownerIndex=row['ownerIndex'],operationId=row['operationId'],
                            transactionHash=row['hash'],transactionHeight=height,minimumSuccessorHeight=required,
                            sourceFile=path,sourceSHA256=hashlib.sha256(files[path]).hexdigest(),
                            originalAvailability=available,submittedOffsetNs=submitted,includedOffsetNs=included,
                            heightVisibleOffsetNs=at,submitToHeightVisibleNs=at-submitted,
                            inclusionToHeightVisibleNs=at-included,livePublishOffsetNs=live,
                            heightVisibleToLivePublishNs=None if live is None else live-at,
                            originalTerminalStatus=row['status'],originalFinalNs=row.get('finalNs')))
    return dict(schema='YNX-PERF-SUCCESSOR-HEIGHT-AVAILABILITY/v1',status='ORIGINALS_READ',
                configuredDemand=demand,observed=len(records),notObserved=demand-len(records),records=records,
                originalQualified=load['qualified'],independentFinality=False,finalityPercentilesMs=None,
                observationsSummed=False,missingTimingsFilled=False,
                meaning='Parent-observed four-node H+1 height availability after hash-bound code0 inclusion. RPC heights are not authenticated H/H+1 proof or sender confirmation. Bounds include polling and observer overhead; missing rows remain unobserved.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    require(args.sha256==d24.ARCHIVE_SHA256,'fixed original d24 archive required')
    require(not args.archive.is_symlink(),'archive may not redirect')
    with args.archive.open('rb') as source:raw=source.read(d24.ARCHIVE_BYTES+1)
    require(len(raw)==d24.ARCHIVE_BYTES,'original archive size differs')
    files,manifest,total=d24.original.public_archive(raw,args.sha256,entry_limit=8192)
    matches=[name for name in files if name.endswith('/public/receipt.json')]
    require(len(matches)==1,'one original receipt required')
    prefix=matches[0].removesuffix('receipt.json')
    original=d24.inspect(files,prefix)
    result=inspect(files,prefix,strict(files[matches[0]]))
    result.update(runID=d24.RUN_ID,jobID=d24.JOB_ID,archiveSHA256=args.sha256,
                  source=original['source'],tools=original['tools'],newExecution=False)
    with args.output.open('x') as output:json.dump(result,output,indent=2);output.write('\n')
    print(json.dumps(dict(observed=result['observed'],configuredDemand=result['configuredDemand'],independentFinality=False)))


if __name__=='__main__':main()
