"""Read pinned normal Go public-owner JSONL; never execute/retry an operation."""
import argparse
import collections
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


normal=module('public_owner_readback_normal','pq-normal-process-lab.py')
held=module('public_owner_readback_inputs','pq-held-input-footprint.py')
require=normal.lab.require
CODES={'ORIGINAL_SAVED','UNKNOWN','REJECTED','ORIGINAL_RECOVERED','PROOF_CONFIRMED_DATA','OWNER_RETIRED'}


def strict(raw):
    def fields(items):
        result={}
        for key,value in items:
            require(key not in result,'duplicate original JSON field');result[key]=value
        return result
    def constant(value):raise RuntimeError('nonfinite original JSON number')
    return json.loads(raw,object_pairs_hook=fields,parse_constant=constant)


def readback(raw,expected_sha256):
    require(type(raw) is bytes and 0<len(raw)<=4<<20,'bounded original public stream required')
    require(type(expected_sha256) is str and re.fullmatch('[0-9a-f]{64}',expected_sha256)
            and hashlib.sha256(raw).hexdigest()==expected_sha256,'original public stream SHA256 differs')
    require(raw.endswith(b'\n'),'original stream ends with an incomplete line')
    lines=raw.splitlines();rows=[strict(line) for line in lines]
    require(1<len(rows)<=10001 and all(type(r) is dict for r in rows),'original READY and replies required')
    ready=rows[0];owners=ready.get('owners')
    require(ready.get('version')=='YNX-PQ-LAB-PUBLIC-OWNER-READY/v1'
            and ready.get('status')=='original_public_scope_held'
            and type(owners) is list and 0<len(owners)<=1000
            and all(type(v) is int and 0<=v<1000 for v in owners)
            and sorted(set(owners))==owners
            and ready.get('syntheticOnly') is True and ready.get('authorityGranted') is False
            and all(ready.get(k) is False for k in ('signed','nonceReserved','bootstrapLoaded'))
            and type(ready.get('startupElapsedNs')) is int and 0<=ready['startupElapsedNs']<1<<63,
            'original cold public scope READY differs')
    counts=collections.Counter();observations=[]
    for index,r in enumerate(rows[1:]):
        owner=r.get('ownerIndex');identity=r.get('operationId');code=r.get('code')
        require(r.get('version')=='YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1'
                and type(owner) is int and 0<=owner<1000 and type(code) is str and code in CODES,
                'original reply identity or code differs')
        require(type(identity) is str and (re.fullmatch('[0-9a-f]{64}',identity)
                or (code=='OWNER_RETIRED' and identity=='')), 'original operation identity missing')
        require(owner in owners or code=='REJECTED','out-of-scope owner supplied a non-refusal')
        result=r.get('result')
        require(result is None or (type(result) is dict and result.get('authorityGranted') is False),
                'public result authority differs')
        require(code not in ('UNKNOWN','REJECTED','OWNER_RETIRED') or result is None,
                'refusal or retirement must not carry a successful original')
        require(code not in ('ORIGINAL_SAVED','ORIGINAL_RECOVERED','PROOF_CONFIRMED_DATA')
                or type(result) is dict,'positive reply lacks its original result')
        counts[code]+=1
        value=dict(replyIndex=index,ownerIndex=owner,operationId=identity,code=code,
                   originalReplySHA256=hashlib.sha256(lines[index+1]).hexdigest(),
                   calleeElapsedNs=None,stages=None,persistenceRoles=None)
        # No fabricated zeros when an old/unmeasured reply omits telemetry.
        if 'timings' in r or 'calleeElapsedNs' in r:
            timing=normal.callee_snapshot(r.get('timings'))
            elapsed=r.get('calleeElapsedNs')
            require(type(elapsed) is int and 0<=elapsed<1<<63,'original callee elapsed missing')
            value.update(calleeElapsedNs=elapsed,stages=copy.deepcopy(timing['stages']),
                         persistenceRoles={k:copy.deepcopy(v) for k,v in timing['stages'].items()
                                           if k.startswith('sender.persistence.')})
        if 'sourceInputs' in r:
            value['sourceInputs']=held.inspect(r['sourceInputs'],r.get('staticCache'))
        observations.append(value)
    return dict(schema='YNX-PERF-PUBLIC-OWNER-ORIGINAL-READBACK/v1',
                originalSHA256=expected_sha256,originalBytes=len(raw),ready=copy.deepcopy(ready),
                returnedReplies=len(observations),outcomes=dict(counts),records=observations,
                observationsSummed=False,intervalsOverlap=True,unmeasuredStagesFilled=False,
                commandRequestsSupplied=False,livePipeVerified=False,
                businessQualified=None,inclusionTPS=None,finalConfirmationTPS=None,
                finalConfirmationPercentilesMs=dict(p50=None,p95=None,p99=None),
                sourceQualified=False,authorityGranted=False,
                meaning='Pinned producer output only. Repeated owner/operation IDs can be recover or confirm observations; no command phase is invented. Nested elapsed spans, shared input snapshots and returned replies are not business throughput or finality.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True,type=Path)
    parser.add_argument('--expected-sha256',required=True)
    args=parser.parse_args()
    with args.input.open('rb') as source:raw=source.read((4<<20)+1)
    print(json.dumps(readback(raw,args.expected_sha256),indent=2))


if __name__=='__main__':main()
