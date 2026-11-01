"""Finite original Linux source-functional DATA for the normal live consumer.

No API call, node, key access or pressure is performed by this module. Its
caller supplies the original run/job metadata and exact downloaded job logs.
"""
import hashlib
import json
import re

SOURCE='896ea094c985cd4b9e90681e436285a9bba0a979'
TREE='b99d095d2783da95c64583e81084f0b928ec3532'
RESOURCE_RUN=41306177925
CHAIN_RUN=41306177929
JOBS={
 'resource':(RESOURCE_RUN,124846905898,'focused-go'),
 'commit':(CHAIN_RUN,124846905628,'Original Commit consumer named cases'),
 'client':(CHAIN_RUN,124846954088,'Original client observations and cohort readback'),
}
LIVE_CASES={'TestPQLabLiveMaterialsCacheBoundOriginalSetupRequestResult','TestPQLabLiveMaterialsCacheFallbackOnlyExactBound','TestPQLabLiveMaterialsUncachedOriginalCurrentAndClose'}
CLI_CASES={'TestPQLabSenderPUBLICReadyBeforeCommandsAndSeparateColdCost','TestPQLabSenderPUBLICTimingsWithoutReadyRetainsColdCost','TestPQLabCalleeElapsedPUBLICColdSingleBefore','TestPQLabCalleeElapsedPUBLICSameInputCurrentReadBeforeAfter','TestPQLabCheckpointCacheFallbackLargeOriginal','TestPQLabCheckpointCacheFallbackOnlyExactBound','TestPQLabCheckpointCacheFallbackRereadsOriginalAndCurrent'}
COMMIT_CASES={'TestOperatorCommitObservationSchemaFixture','TestOperatorCommitObservationDefaultAndClosedFlags','TestOperatorCommitObservationRejectsPublicMigrationAndNetworkBeforeEnable','TestOperatorCommitObservationLoggerModuleOwnershipAndUntrustedPayloads','TestOperatorCommitObservationMissingFailureAndReplayRemainUnknown','TestOperatorCommitObservationOutputPreservesOriginalAndStopFailure','TestOperatorCommitObservationBoundedSamplesAndNormalStopGuard','TestOperatorCommitObservationRealBlockExecutorStateFeesAndJournalEquivalent','TestOperatorWireObservationNormalStopOneOutputAndPublicSchema','TestOperatorWireObservationFailureAndUnknownPreserveOriginal'}
CLIENT_CASES={'TestPQLabNetworkOriginalInputsExclusiveAndLoopback','TestPQLabNetworkActiveEngineDBRefusesCustodyCreation','TestPQLabNetworkRealRegistryStoppedSourcesAndColdCustody','TestPQLabNetworkMissingCheckpointPreservesFailedAttempt','TestPQLabWorkloadRealSourceCorpusExecutionAndRestart','TestPQLabWorkloadBoundsAliasesAndExactSource','TestPQLabWorkloadProofOriginalCLIInputsAndNegatives','TestPQLabWorkloadMaximumProtocolWhole','TestPQLabNormalCommandFreshIndependentProcessInputs','TestPQLabNormalCommandRefusesImplicitOrDuplicateInputs','TestPQLabWorkloadCommandInputsAndNoMutation','TestPQLabWorkloadCommandRealProofInputs','TestPQLabExportOriginalFourStoresNormalProofAndRefusals','TestPQLabMultiOwnerOriginalExecutionAndBounds','TestPQLabOnlineSenderRevocationAndPartialIntentPreserved','TestPQLabOnlineSenderOriginalRecoveryAndFullProof','TestPQLabOnlineSenderCommandOriginalLostAckAndUnknown','TestPQLabPreSignedCommandCurrentCheckpoint','TestPQLabExportCommandRejectsImplicitTrustAndUnknownInputs','TestPQLabNormalCommandOnlineIndependentOwnerFlags','TestPQLabExportCommandOriginalStoppedStoreFixture','TestPQLabLiveMaterialsOriginalAnchorContinuousProofAndSenderConfirm','TestPQLabLiveMaterialsBoundedPolicyNoSyntheticAuthority','TestPQLabLiveMaterialsIndependentAnchorAndEitherBranchRefusal','TestPQLabLiveMaterialsCommandStrictInputs','TestPQLabLiveMaterialsCommandOriginalSourceResultAndProofContext'}

WIRE_CASES={'TestMempoolWireObserverOriginalReceiveAndCheckTx','TestMempoolWireObserverOriginalSendRetryAndBytes','TestMempoolWireObserverLifecycleAndConcurrentSnapshot','TestMempoolWireObserverOverflowIsExplicit','TestOperatorWireObservationFlagsDefaultAndFailClosed','TestOperatorWireObservationActualPinnedConstructorAndReactor','TestOperatorWireObservationActualScopeAndLoopbackRefusals','TestOperatorWireObservationNormalStopOneOutputAndPublicSchema','TestOperatorWireObservationFailureAndUnknownPreserveOriginal','TestOperatorWireObservationPathAndEndpointBoundaries','TestOperatorWireObservationExactOutputReadback'}

def require(ok,message):
    if not ok:raise RuntimeError(message)

def strict(raw):
    def fields(items):
        result={}
        for key,value in items:
            require(key not in result,'duplicate source-functional field');result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=fields)

def marker(raw,name):
    require(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded original job log required')
    # Source code printed by the runner is not an executed assertion marker.
    pattern=re.compile(rb'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z '+re.escape(name.encode())+rb' (\{.*\})$',re.M)
    found=pattern.findall(raw)
    require(len(found)==1,'exactly one executed original marker required: '+name)
    return strict(found[0])

def names(value,expected,field='requiredPassed',exact=False):
    got=value.get(field)
    require(type(got) is list and all(type(x) is str for x in got) and len(set(got))==len(got) and (set(got)==expected if exact else expected<=set(got)),'original unique named case coverage differs')

def qualify(facts,logs):
    require(set(logs)==set(JOBS) and set(facts['jobs'])==set(JOBS),'all three original Linux groups required')
    for run,path in [(RESOURCE_RUN,'.github/workflows/resource-market-ci.yml'),(CHAIN_RUN,'.github/workflows/chain-core.yml')]:
        d=facts['runs'][str(run)]
        require(d.get('id')==run and d.get('head_sha')==SOURCE and d.get('head_branch')=='codex/ynx-pq-perf-integration' and d.get('path')==path and d.get('event')=='push' and d.get('run_attempt')==1 and ((d.get('status')=='in_progress' and d.get('conclusion') is None) or (d.get('status')=='completed' and d.get('conclusion') in ('success','failure','cancelled','timed_out'))),'exact first-attempt source workflow observation required')
    graph=facts['sourceGraph']
    require(graph.get('sha')==SOURCE and graph.get('tree',{}).get('sha')==TREE and [p['sha'] for p in graph.get('parents',[])]==['84a57203f2ea10dfa51c9c4cef817ea3cc411b9c'],'exact live-source graph differs')
    pins={}
    for key,(run,job,name) in JOBS.items():
        d=facts['jobs'][key]
        require(d.get('id')==job and d.get('run_id')==run and d.get('head_sha')==SOURCE and d.get('name')==name and d.get('status')=='completed' and d.get('conclusion')=='success','original successful Linux job required')
        steps=d.get('steps',[])
        require(steps and all(s.get('status')=='completed' and s.get('conclusion') in ('success','skipped') for s in steps),'missing/failed original job step')
        required_steps={'resource':{'Exercise original lab callee readiness and actual cold costs','Verify complete state bridge and sponsor continuity'},'commit':{'Execute every new Commit case and affected original stop cases'},'client':{'Verify normal PQ lab producers and the original proof caller','Verify the default-off normal node wire observation adapter'}}[key]
        for required_step in required_steps:
            matches=[s for s in steps if s.get('name')==required_step]
            require(len(matches)==1 and matches[0].get('conclusion')=='success','original required source-functional step missing/skipped')
        pins[key]=dict(run=run,job=job,bytes=len(logs[key]),sha256=hashlib.sha256(logs[key]).hexdigest(),jobConclusion='success')
    state=marker(logs['resource'],'YNX_INITIAL_CACHE_STATE_TESTS');cli=marker(logs['resource'],'YNX_LAB_CALLEE_TESTS')
    for d in [state,cli]:require(d.get('sourceCommit')==SOURCE and d.get('suitePassed') is True,'actual source state/callee assertion differs')
    names(state,LIVE_CASES);names(cli,CLI_CASES,exact=True)
    require(state.get('performanceMeasured') is False and cli.get('networkLoadMeasured') is False and cli.get('publicFinality') is False,'source tests cannot become performance/finality evidence')
    commit=marker(logs['commit'],'YNX_NORMAL_COMMIT_CONSUMER_CASES_EXECUTED')
    require(commit.get('actualCalleeSHA')==SOURCE and commit.get('actualCalleeTree')==TREE and commit.get('controllerSHA')==SOURCE and commit.get('runId')==str(CHAIN_RUN) and commit.get('runAttempt')=='1' and commit.get('skipped')==0 and commit.get('actualFourNodeWindow') is False and commit.get('dualPQ500CrossSourceEquality') is False and commit.get('authorityGranted') is False and commit.get('workflowOnlyContinuation') is False and commit.get('publicActivation') is False and type(commit.get('testJSONBytes')) is int and commit['testJSONBytes']>0 and re.fullmatch('[0-9a-f]{64}',commit.get('testJSONSHA256','')) is not None,'normal Commit consumer provenance/scope differs')
    names(commit,COMMIT_CASES,exact=True)
    client=marker(logs['client'],'YNX_PQ_LAB_CALLEES_EXECUTED');wire=marker(logs['client'],'YNX_ORIGINAL_WIRE_OBSERVATION_CALLEES_EXECUTED')
    require(client.get('commit')==SOURCE and client.get('nodeProcessesStarted')==0 and client.get('publicActivation') is False and wire.get('commit')==SOURCE and wire.get('physicalBytesMeasured') is False and wire.get('nodeProcessesStarted')==0,'original client/wire source scope differs')
    names(client,CLIENT_CASES,exact=True);names(wire,WIRE_CASES,exact=True)
    return dict(schema='YNX-PERF-LIVE-SOURCE-FUNCTIONAL-DATA/v1',sourceSHA=SOURCE,sourceTree=TREE,workflowObservations={key:{field:facts['runs'][str(run)].get(field) for field in ('id','head_sha','path','run_attempt','event','status','conclusion')} for key,run in [('resource',RESOURCE_RUN),('chain',CHAIN_RUN)]},officialLinuxGroups=pins,liveSourceCases=sorted(LIVE_CASES),normalCLIOriginalCases=sorted(CLI_CASES),originalStateAssertion=state,originalCLIAssertion=cli,originalCommitAssertion=commit,originalClientAssertion=client,originalWireAssertion=wire,sourceFunctionalQualified=True,actual500InitializedOwnersQualified=False,pressureAuthorized=False,sourceGrant=False,meaning='Original successful Linux source-functional cases only. No real complete500 initialization, business load, four physical fault domains, independent network capture or before/after throughput claim.')
