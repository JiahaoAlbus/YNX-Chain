"""Original parent confirmation-bound DATA controls; no network or signatures."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('confirmation_bound',Path(__file__).with_name('pq-pair-confirmation-bound-readback.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def raw(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(value):return hashlib.sha256(value).hexdigest()


class ConfirmationBoundControls(unittest.TestCase):
    def fixture(self):
        abci=b'CONTROL signed outer transaction';wire=b'CONTROL native transaction'
        outer,native=sha(abci),sha(wire);prefix='synthetic/public/'
        rows=[dict(index=i,id=('%064x'%(i+1))) for i in range(500)]
        row=rows[0];row.update(operationId='f'*64,ownerIndex=4,nonce=2,hash=outer,nativeHash=native,
            submittedNs=2,includedNs=5,finalNs=10,terminalNs=10,status='qualified',
            proofReference='load-operations/00000/qualified-receipt.json',
            stageTimes=[['verifier',6],['confirm',7],['receipt',8],['proof_portable_export',9]])
        event=dict(kind='qualified',index=0,id=row['id'],atNs=10,hash=outer,nativeHash=native,
            normalVerifierCode='VERIFIED_TRANSACTION_DATA',normalConfirmCode='PROOF_CONFIRMED_DATA',
            executionSuccessful=True,executionCode='0',transactionType='pq_transfer',members=1,nativeGrant=False,
            proofReference=row['proofReference'])
        journal=b''.join(raw(dict(kind='normal_stage',index=0,id=row['id'],stage=name,atNs=at))+b'\n'
            for name,at in row['stageTimes'])+raw(event)+b'\n'
        receipt=dict(sameHost=True,physicalFaultDomains=1,
            commitClockParent=dict(processID=100,clock='CLOCK_MONOTONIC',bootID='CONTROL-boot',timeNamespace='1:2'),
            loadResult=dict(originProcessID=100,originMonotonicNs='1000',observationCutoffNs=20,rows=rows),
            journalSegments=[dict(path='load-events-00000.jsonl',bytes=len(journal),sha256=sha(journal))],
            normalCommitObservation=dict(originalSnapshots=[dict(node=i,path='commit-observation-node-%d-original.json'%i) for i in range(4)]),
            normalHelperLifecycle=dict(parentTiming=dict(records=[dict(name='load-00000-normal-verifier',requestedMonotonicNs=1006,returnedMonotonicNs=1007)])),
            normalPublicOwnerTransport=dict(records=[dict(operation='confirm',ownerIndex=4,operationId=row['operationId'],
                code='PROOF_CONFIRMED_DATA',requestedMonotonicNs=1007,returnedMonotonicNs=1008)]))
        clock_rows=[dict(index=i,id=row['id'],status='CENSORED') for i,row in enumerate(rows)]
        clock_rows[0].update(status='OBSERVED',nodesNs=[1,2,3,4],fourNodeUpperBoundNs=4)
        clock=dict(status='OBSERVED_OR_CENSORED',configuredDemand=500,rows=clock_rows)
        block=dict(chainId='CONTROL-chain',headerHeight='5',stateHeight='4',blockHash='a'*64,
            stateAppHash='c'*64,genesisSha256='9'*64,commitVerified=True,lightTransitionVerified=True)
        successor=dict(chainId='CONTROL-chain',headerHeight='6',stateHeight='5',blockHash='b'*64,
            stateAppHash='d'*64,genesisSha256='9'*64,commitVerified=True,lightTransitionVerified=True)
        result=dict(height='5',index='0',block=block,successor=successor,transactionHash=outer,nativeWireHash=native,
            included=True,finalized=True,executionSuccessful=True,executionCode='0',nativeGrant=False)
        expected=dict(block={k:block[k] for k in ('chainId','headerHeight','stateHeight','blockHash','stateAppHash')},
            successor={k:successor[k] for k in ('chainId','headerHeight','stateHeight','blockHash','stateAppHash')},
            transactionType='pq_transfer',transactionHash=outer,nativeWireHash=native,index='0',
            envelope=base64.b64encode(abci).decode(),nativeWire=base64.b64encode(wire).decode())
        proof=dict(version='CONTROL synthetic original proof')
        request=dict(version='YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1',expected=expected,proof=proof)
        context=dict(version='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',expectedTransaction=copy.deepcopy(expected),
            lightTrust=dict(chainId='CONTROL-chain',originalGenesisHash='8'*64,consensusGenesisSHA256='9'*64))
        closure=dict(entries={name:dict(publicRelativePath='proof-public-blobs/'+name+'.json')
                              for name in ('request','context','proof')})
        final=dict(id=row['id'],operationId=row['operationId'],mode='online',
            transaction=dict(abciHash=outer,nativeHash=native,ownerIndex=4,firstNonce='2',members='1',type='pq_transfer'),
            normalLiveResult=dict(transactionHash=outer,nativeWireHash=native),
            originalPublicProofClosure=dict(path='load-operations/00000/original-public-proof-manifest.json'),
            normalVerifier=dict(code='VERIFIED_TRANSACTION_DATA',result=result),
            normalConfirm=dict(version='YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1',ownerIndex=4,operationId=row['operationId'],
                code='PROOF_CONFIRMED_DATA',result=dict(result=copy.deepcopy(result))))
        files={prefix+'load-events-00000.jsonl':journal,
            prefix+'load-operations/00000/transaction.abci':abci,prefix+'load-operations/00000/transaction.wire':wire,
            prefix+'load-operations/00000/four-node-inclusion.json':raw(dict(rows=[dict(height='5',index=0) for _ in range(4)])),
            prefix+final['originalPublicProofClosure']['path']:raw(closure),
            prefix+'proof-public-blobs/request.json':raw(request),prefix+'proof-public-blobs/context.json':raw(context),
            prefix+'proof-public-blobs/proof.json':raw(proof)}
        for i in range(4):files[prefix+'commit-observation-node-%d-original.json'%i]=raw(dict(chainID='CONTROL-chain',
            originalGenesisHash='8'*64,samples=[dict(height=5,appHash='d'*64)]))
        return receipt,files,prefix,clock,{0:final}

    def test_valid_original_completion_is_upper_bound_not_consensus_time(self):
        receipt,files,prefix,clock,qualified=self.fixture();result=m.project(receipt,files,prefix,clock,qualified)
        self.assertEqual((result['status'],result['observed'],result['censored']),('OBSERVED_OR_CENSORED',1,499))
        row=result['rows'][0]
        self.assertEqual((row['status'],row['submitToConfirmationObservedUpperNs']),('OBSERVED_DATA',8))
        self.assertEqual((row['proofReportedBlockHashH'],row['proofReportedBlockHashHPlus1']),('a'*64,'b'*64))
        self.assertTrue(row['applicationStateAtHMatchesProofHPlus1'])
        self.assertIsNone(result['consensusFinalityTimeNs'])
        self.assertIsNone(result['nodeSuccessorCommitEventTimesNs'])
        self.assertFalse(result['nodeSuccessorBlockHashBound'])
        self.assertFalse(result['localCommitBlockHashBound'] or result['independentFinality']
                         or result['independentCryptographicReverification'] or result['runtimeAuthorized'])

    def test_wrong_operation_or_clock_domain_never_qualifies(self):
        for defect in ('id','operation','reply-owner','reply-operation','owner','owner-missing','nonce','nonce-missing','status','hash','parent','pid','clock','node'):
            with self.subTest(defect=defect):
                receipt,files,prefix,clock,qualified=self.fixture()
                if defect=='id':receipt['loadResult']['rows'][0]['id']='e'*64
                elif defect=='operation':qualified[0]['operationId']='e'*64
                elif defect=='reply-owner':qualified[0]['normalConfirm']['ownerIndex']=5
                elif defect=='reply-operation':qualified[0]['normalConfirm']['operationId']='e'*64
                elif defect=='owner':qualified[0]['transaction']['ownerIndex']=5
                elif defect=='owner-missing':del qualified[0]['transaction']['ownerIndex']
                elif defect=='nonce':qualified[0]['transaction']['firstNonce']='3'
                elif defect=='nonce-missing':del qualified[0]['transaction']['firstNonce']
                elif defect=='status':receipt['loadResult']['rows'][0]['status']='unknown'
                elif defect=='hash':receipt['loadResult']['rows'][0]['nativeHash']='e'*64
                elif defect=='parent':receipt['commitClockParent']['clock']='CLOCK_REALTIME'
                elif defect=='pid':receipt['loadResult']['originProcessID']=101
                elif defect=='clock':clock['status']='NOT_SUPPLIED'
                else:clock['rows'][0]['status']='CENSORED'
                result=m.project(receipt,files,prefix,clock,qualified)
                self.assertEqual((result['observed'],result['censored']),(0,500))
                self.assertFalse(result['independentFinality'])

    def test_early_qualified_or_missing_confirmation_remains_censored(self):
        for defect in ('stage-order','stage-row-mismatch','early-event','missing-stage','late-verifier','late-confirm','confirm-mismatch','missing-proof'):
            with self.subTest(defect=defect):
                receipt,files,prefix,clock,qualified=self.fixture();row=receipt['loadResult']['rows'][0]
                if defect=='stage-order':row['stageTimes'][1][1]=11
                elif defect=='stage-row-mismatch':row['stageTimes'][1][1]=6
                elif defect=='early-event':row['finalNs']=6
                elif defect=='missing-stage':row['stageTimes'].pop()
                elif defect=='late-verifier':receipt['normalHelperLifecycle']['parentTiming']['records'][0]['returnedMonotonicNs']=1008
                elif defect=='late-confirm':receipt['normalPublicOwnerTransport']['records'][0]['returnedMonotonicNs']=1009
                elif defect=='confirm-mismatch':qualified[0]['normalConfirm']['result']['result']['height']='6'
                else:qualified.clear()
                result=m.project(receipt,files,prefix,clock,qualified)
                self.assertEqual((result['observed'],result['censored']),(0,500))

    def test_tampered_proof_headers_or_original_bytes_are_censored(self):
        for defect in ('height','state','proof','proof-type','transaction','native','position','journal','duplicate','duplicate-stage','reordered','stage-reordered','stage-float','qualified-float'):
            with self.subTest(defect=defect):
                receipt,files,prefix,clock,qualified=self.fixture()
                if defect=='height':qualified[0]['normalVerifier']['result']['successor']['headerHeight']='7'
                elif defect=='state':files[prefix+'commit-observation-node-1-original.json']=raw(dict(samples=[dict(height=5,appHash='e'*64)]))
                elif defect=='proof':files[prefix+'proof-public-blobs/proof.json']=b'{}'
                elif defect=='proof-type':
                    request=json.loads(files[prefix+'proof-public-blobs/request.json']);request['proof']['counter']=True
                    original=json.loads(files[prefix+'proof-public-blobs/proof.json']);original['counter']=1
                    files[prefix+'proof-public-blobs/request.json']=raw(request);files[prefix+'proof-public-blobs/proof.json']=raw(original)
                elif defect=='transaction':files[prefix+'load-operations/00000/transaction.abci']=b'different'
                elif defect=='native':files[prefix+'load-operations/00000/transaction.wire']=b'different'
                elif defect=='position':files[prefix+'load-operations/00000/four-node-inclusion.json']=raw(dict(rows=[dict(height='5',index=1) for _ in range(4)]))
                elif defect=='journal':files[prefix+'load-events-00000.jsonl']+=b'{}\n'
                elif defect=='duplicate':
                    key=prefix+'load-events-00000.jsonl';files[key]+=files[key]
                    receipt['journalSegments'][0].update(bytes=len(files[key]),sha256=sha(files[key]))
                elif defect=='duplicate-stage':
                    key=prefix+'load-events-00000.jsonl';files[key]+=files[key].splitlines()[0]+b'\n'
                    receipt['journalSegments'][0].update(bytes=len(files[key]),sha256=sha(files[key]))
                elif defect=='reordered':
                    key=prefix+'load-events-00000.jsonl';lines=files[key].splitlines()
                    files[key]=b'\n'.join([lines[-1],*lines[:-1]])+b'\n'
                    receipt['journalSegments'][0].update(bytes=len(files[key]),sha256=sha(files[key]))
                elif defect=='stage-reordered':
                    key=prefix+'load-events-00000.jsonl';lines=files[key].splitlines();lines[0],lines[1]=lines[1],lines[0]
                    files[key]=b'\n'.join(lines)+b'\n'
                    receipt['journalSegments'][0].update(bytes=len(files[key]),sha256=sha(files[key]))
                else:
                    key=prefix+'load-events-00000.jsonl';lines=[json.loads(line) for line in files[key].splitlines()]
                    lines[0 if defect=='stage-float' else -1]['atNs']=float(lines[0 if defect=='stage-float' else -1]['atNs'])
                    files[key]=b''.join(raw(line)+b'\n' for line in lines)
                    receipt['journalSegments'][0].update(bytes=len(files[key]),sha256=sha(files[key]))
                result=m.project(receipt,files,prefix,clock,qualified)
                self.assertEqual((result['observed'],result['censored']),(0,500))

    def test_no_clock_or_original_journal_returns_unknown_without_inventing_rows(self):
        receipt,files,prefix,clock,qualified=self.fixture();del receipt['journalSegments']
        result=m.project(receipt,files,prefix,clock,qualified)
        self.assertEqual((result['status'],result['observed'],result['censored'],result['rows']),('NOT_SUPPLIED',0,500,[]))
        self.assertIsNone(result['consensusFinalityTimeNs'])

    def test_original_json_limit_is_inclusive_and_never_truncates(self):
        original=b'"'+b'x'*((8<<20)-2)+b'"'
        self.assertEqual(len(m.strict(original)),(8<<20)-2)
        with self.assertRaisesRegex(ValueError,'bounded original JSON'):
            m.strict(original+b' ')

    def test_actual_pair_held_closure_joins_and_censors_rebound_native_bytes(self):
        fixtures=module('test_pq_same_runner_pair_readback');case=fixtures.PairFixture();reader=fixtures.reader
        template,public,prefix,clock,qualified=self.fixture();original=qualified[0]
        abci=public[prefix+'load-operations/00000/transaction.abci'];wire=public[prefix+'load-operations/00000/transaction.wire']
        label='before';p=case.prefixes[label];plan=case.get(label,'load-plan.json');events=[]
        ledger=fixtures.scheduler.Ledger(plan,events.append);ledger.release(0);row,_=ledger.reserve(0)
        def event(kind,at,**values):ledger.event(dict(kind=kind,index=row['index'],id=row['id'],atNs=at,**values))
        event('signed',1,hash=sha(abci),nativeHash=sha(wire));event('submitted',2);event('ack',3);event('included',5)
        for stage,at in (('verifier',6),('confirm',7),('receipt',8),('proof_portable_export',9)):
            event('normal_stage',at,stage=stage)
        proof_ref='load-operations/00000/qualified-receipt.json'
        event('qualified',10,hash=sha(abci),nativeHash=sha(wire),normalVerifierCode='VERIFIED_TRANSACTION_DATA',
            normalConfirmCode='PROOF_CONFIRMED_DATA',executionSuccessful=True,executionCode='0',
            transactionType='pq_transfer',members=1,nativeGrant=False,proofReference=proof_ref)
        receipt=case.get(label,'receipt.json');old_load=receipt['loadResult'];load=ledger.report(20,'CONTROL synthetic cutoff')
        load.update(originMonotonicNs=old_load['originMonotonicNs'],originProcessID=100,pipeline=old_load['pipeline'])
        journal=b''.join(raw(item)+b'\n' for item in events);case.files[label][p+'load-events-00000.jsonl']=journal
        receipt.update(configuredDemand=500,loadResult=load,sameHost=True,physicalFaultDomains=1,
            commitClockParent=template['commitClockParent'],journalSegments=[dict(path='load-events-00000.jsonl',bytes=len(journal),sha256=sha(journal))])
        origin=int(load['originMonotonicNs'])
        receipt['normalHelperLifecycle']['parentTiming']=dict(schema='YNX-PERF-PARENT-HELPER-BOUNDARIES/v1',
            clock='parent_monotonic_ns',records=[dict(name='load-00000-normal-verifier',
                requestedMonotonicNs=origin+6,returnedMonotonicNs=origin+7)],omittedCompleted=0)
        transport=receipt['normalPublicOwnerTransport'];transport.update(attempted=2,retained=2)
        transport['records'].append(dict(operation='confirm',ownerIndex=row['ownerIndex'],operationId=row['operationId'],
            code='PROOF_CONFIRMED_DATA',requestedMonotonicNs=origin+7,streamAcquiredMonotonicNs=origin+7,
            commandRequestedMonotonicNs=origin+7,replyReceivedMonotonicNs=origin+8,returnedMonotonicNs=origin+8))
        receipt.setdefault('binaries',{})['ynx-consensus-proof-verify']='b'*64
        snapshots=[]
        for node in range(4):
            name='commit-observation-node-%d-original.json'%node;snapshot=json.loads(public[prefix+name]);snapshot['processID']=200+node;blob=raw(snapshot)
            case.files[label][p+name]=blob
            snapshots.append(dict(node=node,path=name,bytes=len(blob),sha256=sha(blob),usable=False))
        receipt['normalCommitObservation']=dict(originalSnapshots=snapshots)
        case.files[label][p+'load-operations/00000/transaction.abci']=abci
        case.files[label][p+'load-operations/00000/transaction.wire']=wire
        case.put(label,'load-operations/00000/submission-intent.json',dict(id=row['id'],operationId=row['operationId'],
            owner=row['ownerIndex'],nonce=str(row['nonce']),transactionHash=sha(abci),submissionAttempts=1,qualifiedFinal=False))
        original_inclusion=case.get(label,'load-operations/00000/four-node-inclusion.json')
        for item in original_inclusion['rows']:item.update(height='5',index=0,hash=sha(abci),tx=base64.b64encode(abci).decode())
        case.put(label,'load-operations/00000/four-node-inclusion.json',original_inclusion)
        request=public[prefix+'proof-public-blobs/request.json'];context=public[prefix+'proof-public-blobs/context.json'];proof=public[prefix+'proof-public-blobs/proof.json']
        proof_readback=reader.held.proof_readback;entries={}
        for name in proof_readback.FILES:
            data={'request':request,'context':context,'proof':proof}.get(name,b'{}');pin=sha(data)
            entries[name]=dict(publicRelativePath='proof-public-blobs/'+pin+'.json',sha256=pin,bytes=len(data))
            case.files[label][p+entries[name]['publicRelativePath']]=data
        closure=dict(schema=proof_readback.SCHEMA,sourceCommit=receipt['source']['commit'],verifierBinarySHA256='b'*64,
            entries=entries,originalContextSHA256=sha(context),originalRequestSHA256=sha(request),syntheticOnly=True,
            authorityGranted=False,actualNetworkExecutionClaim=False,independentReverification=False)
        closure_path='load-operations/00000/original-public-proof-manifest.json';closure_raw=raw(closure)
        case.files[label][p+closure_path]=closure_raw
        original['id']=row['id'];original['operationId']=row['operationId']
        original['transaction'].update(ownerIndex=row['ownerIndex'],firstNonce=str(row['nonce']))
        original['normalConfirm'].update(version='YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1',
            ownerIndex=row['ownerIndex'],operationId=row['operationId'])
        original['originalPublicProofClosure']=dict(path=closure_path,bytes=len(closure_raw),sha256=sha(closure_raw))
        original['normalLiveResult'].update(proof=dict(sha256=sha(proof),bytes=len(proof)),
            verified=dict(context=dict(sha256=sha(context),bytes=len(context)),request=dict(sha256=sha(request),bytes=len(request))))
        case.put(label,proof_ref,original);case.put(label,'load-operations/00000/original-confirm-reply.json',original['normalConfirm'])
        case.put(label,'load-00000-normal-verifier.log',original['normalVerifier'])
        case.put(label,'load-00000-live-result.log',dict(version='YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1',
            outcome='original_result_read',result=original['normalLiveResult']))
        case.put(label,'receipt.json',receipt)
        clock['rows']=[dict(index=item['index'],id=item['id'],status='CENSORED') for item in load['rows']]
        clock['rows'][0].update(status='OBSERVED',nodesNs=[1,2,3,4],fourNodeUpperBoundNs=4)
        for declaration in case.pair['arms']:
            arm=declaration['arm'];frozen=json.loads(case.files[arm]['pq-first100-held-plan.json'])
            frozen['configuration']['options']['commit_clock_observation']=True
            frozen['configurationSHA256']=sha(raw(frozen['configuration']));case.files[arm]['pq-first100-held-plan.json']=raw(frozen)
            adapter=case.get(arm,'FIRST100-HELD-CI.json');adapter.update(frozen);case.put(arm,'FIRST100-HELD-CI.json',adapter)
            case.expected[arm]['configurationSHA256']=frozen['configurationSHA256'];declaration['configurationSHA256']=frozen['configurationSHA256']
        def fake_original_clock(files,root,source,tools):
            return clock if source['commit']==receipt['source']['commit'] else dict(status='NOT_SUPPLIED',configuredDemand=500,observed=0,censored=500,rows=[])
        base_files=dict(case.files[label]);base_original=copy.deepcopy(original);base_receipt=copy.deepcopy(receipt)
        errors=[];original_require=m.require;original_module=reader.held.module
        def traced_require(value,message):
            if not value:errors.append(message)
            return original_require(value,message)
        with mock.patch.object(reader.held,'original_commit_clock_readback',side_effect=fake_original_clock), \
             mock.patch.object(reader.held,'module',side_effect=lambda name:m if name=='pq-pair-confirmation-bound-readback.py' else original_module(name)), \
             mock.patch.object(m,'require',side_effect=traced_require):
            for defect in ('none','native','owner','nonce','stage','stage-float','qualified-float','stage-reordered','foreign-chain'):
                case.files[label]=dict(base_files);changed=copy.deepcopy(base_original);changed_receipt=copy.deepcopy(base_receipt);errors.clear()
                if defect=='native':case.files[label][p+'load-operations/00000/transaction.wire']=b'changed'
                elif defect=='owner':changed['transaction']['ownerIndex']+=1
                elif defect=='nonce':changed['transaction']['firstNonce']='3'
                elif defect=='stage':
                    load2=changed_receipt['loadResult'];changed_row=load2['rows'][0]
                    changed_row['stageTimes'][-1][1]=8
                    points=changed_row['stageTimes'];completed=[]
                    for i,(name,at) in enumerate(points):
                        end=points[i+1][1] if i+1<len(points) else changed_row['finalNs']
                        completed.append(dict(stage=name,durationNs=end-at))
                        load2['completedStageIntervals'][name].update(totalNs=end-at,maxNs=end-at)
                    changed_row['completedStageDurations']=completed
                elif defect in ('stage-float','qualified-float'):
                    key=p+'load-events-00000.jsonl';lines=[json.loads(line) for line in case.files[label][key].splitlines()]
                    target=(next(item for item in lines if item.get('kind')=='normal_stage' and item.get('stage')=='verifier')
                            if defect=='stage-float' else next(item for item in lines if item.get('kind')=='qualified'))
                    target['atNs']=float(target['atNs']);data=b''.join(raw(item)+b'\n' for item in lines)
                    case.files[label][key]=data;changed_receipt['journalSegments'][0].update(bytes=len(data),sha256=sha(data))
                elif defect=='stage-reordered':
                    key=p+'load-events-00000.jsonl';lines=[json.loads(line) for line in case.files[label][key].splitlines()]
                    a=next(i for i,item in enumerate(lines) if item.get('kind')=='normal_stage' and item.get('stage')=='verifier')
                    b=next(i for i,item in enumerate(lines) if item.get('kind')=='normal_stage' and item.get('stage')=='confirm')
                    lines[a],lines[b]=lines[b],lines[a];data=b''.join(raw(item)+b'\n' for item in lines)
                    case.files[label][key]=data;changed_receipt['journalSegments'][0].update(bytes=len(data),sha256=sha(data))
                elif defect=='foreign-chain':
                    foreign_request=json.loads(request);foreign_context=json.loads(context)
                    for part in ('block','successor'):
                        foreign_request['expected'][part]['chainId']='FOREIGN-chain'
                        foreign_context['expectedTransaction'][part]['chainId']='FOREIGN-chain'
                        changed['normalVerifier']['result'][part]['chainId']='FOREIGN-chain'
                        changed['normalConfirm']['result']['result'][part]['chainId']='FOREIGN-chain'
                    foreign_context['lightTrust']['chainId']='FOREIGN-chain'
                    revised=copy.deepcopy(closure)
                    for name,data in (('request',raw(foreign_request)),('context',raw(foreign_context))):
                        digest=sha(data);revised['entries'][name]=dict(publicRelativePath='proof-public-blobs/'+digest+'.json',sha256=digest,bytes=len(data))
                        revised['originalRequestSHA256' if name=='request' else 'originalContextSHA256']=digest
                        case.files[label][p+revised['entries'][name]['publicRelativePath']]=data
                        changed['normalLiveResult']['verified'][name]=dict(sha256=digest,bytes=len(data))
                    revised_raw=raw(revised);case.files[label][p+closure_path]=revised_raw
                    changed['originalPublicProofClosure']=dict(path=closure_path,bytes=len(revised_raw),sha256=sha(revised_raw))
                case.put(label,'receipt.json',changed_receipt);case.put(label,proof_ref,changed)
                case.put(label,'load-operations/00000/original-confirm-reply.json',changed['normalConfirm'])
                case.put(label,'load-00000-normal-verifier.log',changed['normalVerifier'])
                case.put(label,'load-00000-live-result.log',dict(version='YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1',
                    outcome='original_result_read',result=changed['normalLiveResult']))
                originals,metadata=case.package()
                result=reader.inspect(originals['manifest'],originals['before'],originals['after'],metadata=metadata,
                    controller=case.controller,manifest_sha256=sha(originals['manifest']),expected=case.expected)
                data=result['before']['originalConfirmationObservation']
                self.assertEqual(data['observed'],1 if defect=='none' else 0)
                self.assertEqual(data['censored'],500-data['observed'])
                self.assertIsNone(data['consensusFinalityTimeNs']);self.assertFalse(data['independentFinality'])
                expected_error={'native':'original signed transaction bytes differ',
                    'owner':'original verifier and confirmation proof identities differ',
                    'nonce':'original verifier and confirmation proof identities differ',
                    'stage':'original stage journal differs','stage-float':'original stage journal differs',
                    'qualified-float':'original qualified event differs','stage-reordered':'original stage journal order differs',
                    'foreign-chain':'original node/proof network identity differs'}
                if defect!='none':self.assertIn(expected_error[defect],errors)
            for field in ('ownerIndex','operationId'):
                case.files[label]=dict(base_files);changed=copy.deepcopy(base_original)
                changed['normalConfirm'][field]=5 if field=='ownerIndex' else 'e'*64
                case.put(label,proof_ref,changed);case.put(label,'load-operations/00000/original-confirm-reply.json',changed['normalConfirm'])
                originals,metadata=case.package()
                with self.assertRaisesRegex(RuntimeError,'original owner reply does not match parent and cohort'):
                    reader.inspect(originals['manifest'],originals['before'],originals['after'],metadata=metadata,
                        controller=case.controller,manifest_sha256=sha(originals['manifest']),expected=case.expected)


if __name__=='__main__':unittest.main()
