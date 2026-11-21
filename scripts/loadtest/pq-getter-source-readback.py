"""Inspect frozen public getter evidence; never authorizes runtime or a node."""
import hashlib
import json
import re

SUPPLIER_COMMIT='5a49f5c91452604dffb910df736702b3b9df2562'
SUPPLIER_TREE='08747364c24c065bf2b13527c210625d7ec95fba'
LIVE=('TestOperatorWireLivePrivateControlTwoEndpointsAndNoReplay',
 'TestOperatorWireLiveUnknownPreservesOriginalAndRetires',
 'TestOperatorWireLiveCloseJoinsOriginalCaptureWithoutNodeQuit',
 'TestOperatorWireLivePermissionsIdentityAndResiduals',
 'TestOperatorWireLiveRequesterUnknownAndProducerIdentity',
 'TestOperatorWireLiveSelfProcParsingAndDefaultOff',
 'TestOperatorWireLiveTypedNormalNodeBeforeStartIsUnknown')
BUDGET=tuple('TestLosslessHexBudget'+x for x in (
 'FullQueueElapsedDeadline','FullQueueStopsWithoutRawReplay','InvalidEnableStaysDefaultOff',
 'LocalExhaustionDoesNotDisconnectAndRedial','Normalize','PackFailureNeverFallsBack',
 'PackReservesBeforeFrameAllocation','ParallelAttemptsAndClose','ParallelReservations',
 'PeerBytes','PeerClock','PeerIdentityAndLifetime','ReceiveBeforeOriginalCheckTx',
 'SendAttemptsAndAtomicCharge','SendClockRollback','SendIdentityAndClock',
 'TypedNilPeerCannotClaimCapability'))+tuple('TestLosslessHexTransport'+x for x in (
 'DefaultOffAndSingleCarrier','LegacyEmptyUnknownAndMalformedKeepOriginalEntry',
 'QueuedRetryKeepsSelectedFormat','RejectsBeforeCheckTxNoRawFallback',
 'RestoresBeforeOriginalPrecheckCacheAndTxKey'))+('TestLosslessHexBudgetInitialPeerReadinessDeadline',
 'TestLosslessHexBudgetReadyTransitionKeepsSelectedCarrier')
FILES={'SOURCE.json','composition/SOURCE-SELECTION.json','GETTER-QUALIFICATION.json'} | {
 label+suffix for label in ('normal-live-caller','original-peer-budget')
 for suffix in ('.jsonl','.stderr.log','.result.json')}

def strict(raw):
    def pairs(items):
        out={}
        for k,v in items:
            if k in out: raise ValueError('duplicate getter JSON key')
            out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite getter JSON')))

def require(ok,message):
    if not ok: raise ValueError(message)

def pin(raw): return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
def matches_pin(record,raw):
    expected=pin(raw)
    return type(record) is dict and type(record.get('bytes')) is int and record['bytes']==expected['bytes'] and record.get('sha256')==expected['sha256']
def exact(a,b):
    return json.dumps(a,sort_keys=True,separators=(',',':'))==json.dumps(b,sort_keys=True,separators=(',',':'))

def inspect_getter(members, *, source, tree, fork, run, attempt, expected_members):
    """The owner must independently freeze official job/artifact identities and hashes."""
    require(all(type(x) is str and re.fullmatch(r'[0-9a-f]{40}',x) for x in (source,tree,fork))
            and type(run) is int and run>0 and type(attempt) is int and attempt==1,'invalid frozen getter source')
    require(type(members) is dict and set(members)==FILES and type(expected_members) is dict and set(expected_members)==FILES,'getter inventory differs')
    for name in FILES:
        data=members[name];digest=expected_members[name]
        require(type(data) is bytes and len(data)<=32*1024*1024 and (data or name.endswith('.stderr.log'))
                and type(digest) is str and re.fullmatch(r'[0-9a-f]{64}',digest)
                and hashlib.sha256(data).hexdigest()==digest,'getter frozen member differs: '+name)
    try:
        identity=strict(members['SOURCE.json']); selection=strict(members['composition/SOURCE-SELECTION.json'])
        require(type(identity) is dict and type(selection) is dict,'getter identity must be objects')
        for key,value in dict(version='YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1',sourceCommit=source,sourceTree=tree,
            productionForkTree=fork,optionalForkCommit=SUPPLIER_COMMIT,optionalForkTree=SUPPLIER_TREE,
            buildTags=['ynx_live_wire_observation'],sourceOnly=True,actualPreStartNodeGetter=True,
            nodeProcessesStarted=0,actualRunningWindow=False,carrierEnabled=False,publicActivation=False).items():
            require(key in identity and exact(identity[key],value),'getter original identity differs: '+key)
        for key,value in dict(originalSourceCommit=source,originalSourceTree=tree,originalProductionForkTree=fork,
            selectedOptionalForkCommit=SUPPLIER_COMMIT,selectedOptionalForkTree=SUPPLIER_TREE,
            nodeStarted=False,carrierEnabled=False,publicActivation=False).items():
            require(key in selection and exact(selection[key],value),'getter original selection differs: '+key)
        selected=pin(members['composition/SOURCE-SELECTION.json']); prepared=identity['preparedSourceSelection']
        require(type(prepared) is dict and exact(prepared['receiptBytes'],selected['bytes']) and prepared['receiptSHA256']==selected['sha256']
                and exact(prepared['sourceSelection'],selection),'getter selection receipt differs')
        files={'SOURCE.json':pin(members['SOURCE.json']),'composition/SOURCE-SELECTION.json':selected}
        for label,key,names,package in (
            ('normal-live-caller','normalProducer',LIVE,'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet'),
            ('original-peer-budget','originalSupplierBudget',BUDGET,'github.com/cometbft/cometbft/mempool')):
            stdout=members[label+'.jsonl'];stderr=members[label+'.stderr.log'];result_raw=members[label+'.result.json'];result=strict(result_raw)
            require(type(result) is dict and type(result.get('returnCode')) is int and result['returnCode']==0
                    and result.get('timedOut') is False and result.get('validationPassed') is True and result.get('firstFailure') is None
                    and type(result.get('requiredPassed')) is list and set(names)<=set(result['requiredPassed']), 'getter original execution incomplete')
            for kind,raw in (('stdout',stdout),('stderr',stderr)):
                require(matches_pin(result.get(kind),raw),'getter original stream digest differs')
            aggregate=identity[key]
            require(type(aggregate) is dict and exact(aggregate.get('bytes'),len(stdout)) and aggregate.get('sha256')==pin(stdout)['sha256']
                    and matches_pin(aggregate.get('stderr'),stderr) and matches_pin(aggregate.get('result'),result_raw),'getter aggregate differs')
            rows=[strict(line) for line in stdout.splitlines()]
            require(all(type(row) is dict and row.get('Action') not in ('fail','skip','build-fail') for row in rows),'getter stream failure or skip')
            terminals=[(i,row.get('Action')) for i,row in enumerate(rows) if row.get('Package')==package and not row.get('Test') and row.get('Action') in ('start','pass','fail','skip')]
            require(len(terminals)==2 and [v for _,v in terminals]==['start','pass'],'getter package lifecycle differs')
            start,end=terminals[0][0],terminals[1][0]
            for name in names:
                events=[(i,row) for i,row in enumerate(rows) if row.get('Test')==name and row.get('Action') in ('run','pass','fail','skip')]
                require(len(events)==2 and [row.get('Action') for _,row in events]==['run','pass']
                    and all(row.get('Package')==package for _,row in events) and start<events[0][0]<events[1][0]<end,'getter test lifecycle differs: '+name)
            files[label+'.jsonl']=pin(stdout);files[label+'.stderr.log']=pin(stderr);files[label+'.result.json']=pin(result_raw)
        expected=dict(version='YNX-HELD-OPTIONAL-LIVE-GETTER-CI/v1',sourceCommit=source,sourceTree=tree,productionForkTree=fork,
            supplierCommit=SUPPLIER_COMMIT,supplierForkTree=SUPPLIER_TREE,runId=str(run),runAttempt=str(attempt),files=files,
            sourceOnly=True,nodeStarted=False,authorityGranted=False,publicActivation=False,independentFinality=False)
        require(exact(strict(members['GETTER-QUALIFICATION.json']),expected),'getter qualification original differs')
    except (KeyError,TypeError,UnicodeError) as exc:
        raise ValueError('incomplete getter original') from exc
    return {'source':source,'run':run,'attempt':attempt,'dataOnly':True,'sourceQualified':False,'runtimePermissionGranted':False}
