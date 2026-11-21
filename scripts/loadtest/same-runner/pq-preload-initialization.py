"""Same-window initialization observations before first bounded business load.

Source/CI qualification and Root's actual window remain the caller's gates.
This check deliberately cannot establish the later four PQ exits or finality.
"""
import math
import re

def require(ok,message):
    if not ok:raise RuntimeError(message)

def validate(census,processes,unconfirmed,remaining_seconds,load_seconds,tail_seconds):
    require(type(load_seconds) is int and load_seconds==5 and type(tail_seconds) is int and tail_seconds==30,'exact first bounded100 workload budget required')
    require(type(remaining_seconds) in (int,float) and math.isfinite(remaining_seconds) and remaining_seconds>=load_seconds+tail_seconds,'original active budget cannot cover configured load and tail; all demand stays unreleased')
    # Normal bootstrap/activation uses only reserved owners0..3. Its original
    # pending operations are retained until their original proof/confirm path;
    # they must not be cleared, replayed, or counted as business finality here.
    require(type(unconfirmed) is list and len(unconfirmed)<=4 and all(type(owner) is int and 0<=owner<4 for owner in unconfirmed) and len(set(unconfirmed))==len(unconfirmed),'business owner pending or invalid reserved preparation identities; no load release')
    require(type(census) is dict and census.get('schema')=='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1' and census.get('configuredLoadAccounts')==500 and census.get('completeFourNodeAccountReadback') is True and census.get('normalGoStaticOrCryptoQualification') is False and census.get('signCommandsIssued')==0 and census.get('businessPOSTsIssued')==0 and census.get('sourceGrant') is False,'complete original500 account census required before load release')
    nodes=census.get('nodes');require(type(nodes) is list and len(nodes)==4 and [n.get('node') for n in nodes]==list(range(4)),'original four-node census order differs')
    for node in nodes:
        require(type(node.get('node')) is int and type(node.get('height')) is int and node['height']>0 and type(node.get('appHash')) is str and re.fullmatch('[0-9a-f]{64}',node['appHash']) and node['appHash']!='0'*64 and type(node.get('matchingOriginalLoadAccounts')) is int and node['matchingOriginalLoadAccounts']==500,'original full account checkpoint differs')
        require(type(node.get('snapshotBytes')) is int and node['snapshotBytes']>0 and type(node.get('snapshotSHA256')) is str and re.fullmatch('[0-9a-f]{64}',node['snapshotSHA256']),'original account snapshot pin missing')
    require(len({(n['height'],n['appHash']) for n in nodes})==1,'original four-node census checkpoint differs')
    require(type(processes) is list,'original process receipts required')
    identities=set();retained=[]
    for phase in ('bootstrap','pq'):
        for index in range(4):
            name=f'{phase}-node-{index}';matches=[p for p in processes if p.get('name')==name]
            require(len(matches)==1,'unique original node receipt required: '+name);row=matches[0]
            require(type(row.get('pid')) is int and row['pid']>0 and type(row.get('startTicks')) in (int,str) and str(row['startTicks']).isdigit() and int(row['startTicks'])>0,'original node identity missing: '+name)
            identity=(row['pid'],str(row['startTicks']));require(identity not in identities,'original node process identity reused');identities.add(identity)
            if phase=='bootstrap':
                require(row.get('exited') is True and type(row.get('rawReturnCode')) is int and row['rawReturnCode']==0 and type(row.get('exitCode')) is int and row['exitCode']==0 and row.get('signal') is None,'original bootstrap exit0 required before load release: '+name)
            else:
                require(row.get('exited') is False and row.get('rawReturnCode') is None and row.get('exitCode') is None and row.get('signal') is None,'original PQ node must remain running before load release: '+name)
            retained.append({key:row.get(key) for key in ('name','pid','startTicks','exited','rawReturnCode','exitCode','signal')})
    return dict(schema='YNX-PERF-PRELOAD-INITIALIZATION-BOUNDARY/v1',configuredDemand=500,configuredLoadAccounts=500,bootstrapFourNaturalExitZero=True,pqFourStillRunning=True,checkpoint=dict(height=nodes[0]['height'],appHash=nodes[0]['appHash']),originalProcesses=retained,unconfirmedReservedPreparationOwners=list(unconfirmed),preparationFinalityQualified=False,remainingOriginalActiveSeconds=remaining_seconds,requiredLoadAndTailSeconds=load_seconds+tail_seconds,loadReleased=False,allEightNaturalExitObserved=False,sourceGrant=False,independentFinality=False,meaning='Parent initialization preconditions only; reserved0..3 pending operations remain original/unconfirmed, never counted in business finality. Original Go validation/CI and Root window are separate. PQ4 stay online; final natural exit0 of all8 and complete business proofs are still required after load. No prior500/1000 or sustained permission.')
