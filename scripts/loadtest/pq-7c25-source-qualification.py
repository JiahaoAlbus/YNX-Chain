"""Independent future-source eligibility; no runtime or pressure authority.

The collector's complete originals and a same-tuple semantic execution must
both be sealed before this profile can prepare or run. Old1695 data is not a
substitute. The receipt pins stay absent until those actual originals arrive.
"""
import hashlib
import json
from pathlib import Path
import re

SOURCE = '7c25cbcc7d31b10743e26ae1ddca745085ee1b0b'
TREE = '8a90d4ceb86a3a9460648e011bfed9f2e3ac1f4a'
FORK = '5a128880d14bfc73de4334cba23218859ad3473c'
CI_REF = 'codex/ynx-pq-perf-source-20261108'
CI_RUN = 42439090843
CI_JOB = 128604251201
REPOSITORY = 'JiahaoAlbus/YNX-Chain'
# These are evidence pins, not permissions. They may only be filled from the
# Root sole collector's verified complete source/semantic originals.
NORMAL_RECEIPT_SHA256 = 'c4cb8cfcf87b6ff4f6de2f91af656f93cd7c663487c02e733e7448554a45fab9'
SEMANTIC_RECEIPT_SHA256 = None
CLI_REQUIRED = frozenset(('TestPQLabSenderPUBLICReadyBeforeCommandsAndSeparateColdCost',
    'TestPQLabSenderPUBLICTimingsWithoutReadyRetainsColdCost', 'TestPQLabCalleeElapsedPUBLICColdSingleBefore',
    'TestPQLabCalleeElapsedPUBLICSameInputCurrentReadBeforeAfter', 'TestPQLabCheckpointCacheFallbackLargeOriginal',
    'TestPQLabCheckpointCacheFallbackOnlyExactBound', 'TestPQLabCheckpointCacheFallbackRereadsOriginalAndCurrent',
    'TestPQLabSenderPUBLICOwnersOriginalStream', 'TestPQLabSenderPUBLICOwnersBoundedFramingAndLostAck',
    'TestPQLabPublicOwnerFailureDiagnosticActualRejection', 'TestPQLabPublicOwnerFailureDiagnosticClosedVocabulary',
    'TestPQLabLiveObservationCommandOptInAndLegacy', 'TestPQLabLiveObservationCommandScopeAndSink',
    'TestPQLabLiveObservationSignalForwarding'))
CORE_REQUIRED = frozenset(('TestPQLabLiveObservationClosedStagesAndBounds',
                          'TestPQLabLiveObservationDisabledAndOutputFailure'))
STREAMS = frozenset(('ynx-native-history-chain-tests.jsonl','ynx-initial-cache-state-tests.jsonl',
                    'ynx-current4-wire-tests.jsonl','ynx-lab-callee-tests.jsonl','ynx-production-entrypoint-tests.jsonl'))
SOURCE_FILES = {
    '.github/workflows/resource-market-ci.yml':dict(bytes=474967,
        sha256='34859948746bb252d9864f3ff891638d8dc32c61c63e01231f0269455fe97be2',gitBlob='ad9eb894a9663ede861def01c6ccb77860bd48e8'),
    'scripts/ops/test_validate_pq_remote_normal_ci.py':dict(bytes=414729,
        sha256='22a35c1cf82e78db88c3e9ea87c83b6fd6c36f7a1e0da935e891be99d0f8de38',gitBlob='06638261c6f7d7f09cc1c1a619f7fe93dbe5670c')}
OPT_IN_SKIPS = frozenset(('TestFeeHistoryCost','TestABCITransferPerformance','TestCommitStorageMatchedPerformance',
    'TestPQCheckpointAccessTwoUIDOriginalStateLayouts','TestPQCheckpointAccessUIDHelper',
    'TestPQNetworkFourValidatorSignedBusinessConsumerAndIndependentFinality',
    'TestPQNetworkFourValidatorOriginalStateTransitionAndRestart','TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming',
    'TestPQNetworkFourValidatorRemoteSignerOriginalStateTransitionAndRestart','TestPQRemoteSignerNormalProcessColdRecoveryAndUnknown'))


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def identity(run, job, source):
    require((run.get('id'),run.get('head_sha'),run.get('head_branch'),run.get('event'),run.get('run_attempt'))
            == (CI_RUN,SOURCE,CI_REF,'push',1), 'future source actual CI ref/head/attempt differs')
    require(run.get('path') == '.github/workflows/resource-market-ci.yml'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'complete matching future source normal CI NOT_SUPPLIED')
    require(run.get('repository',{}).get('full_name') == REPOSITORY
            and run.get('head_repository',{}).get('full_name') == REPOSITORY
            and run['repository'].get('fork') is False and run['head_repository'].get('fork') is False,
            'future source canonical repository differs')
    require((job.get('id'),job.get('run_id'),job.get('head_sha'),job.get('name'))
            == (CI_JOB,CI_RUN,SOURCE,'focused-go')
            and job.get('status') == 'completed' and job.get('conclusion') == 'success',
            'complete matching future focused job NOT_SUPPLIED')
    for name in ('Exercise original lab callee readiness and actual cold costs',
                 'Verify complete state bridge and sponsor continuity',
                 'Retain exact public test streams and same-job source identity',
                 'Upload only original focused public test streams'):
        matches=[step for step in job.get('steps',[]) if step.get('name')==name]
        require(len(matches)==1 and matches[0].get('status')=='completed' and matches[0].get('conclusion')=='success',
                'required original future CI step missing/skipped: '+name)
    require(source.get('version') == 'YNX-FOCUSED-PUBLIC-TEST-STREAMS/v2'
            and (source.get('commit'),source.get('sourceTree'),source.get('cometForkTree')) == (SOURCE,TREE,FORK)
            and (source.get('runId'),source.get('runAttempt'),source.get('job')) == (str(CI_RUN),'1','focused-go')
            and source.get('repository') == REPOSITORY and source.get('captureComplete') is True
            and source.get('errors') == [] and source.get('testQualification') == 'not-evaluated'
            and all(source.get(k) is False for k in ('nativeGrant','nodeStartAuthorized','publicDeployment')),
            'future complete v2 source snapshot differs')


def original_go_frames(raw, package, required, *, frames=1, allowed_skips=(), closed_tops=False):
    """Full run/terminal framing, including children; no detached PASS union."""
    events = [json.loads(line) for line in raw.splitlines()]
    active = False; seen = set(); terminal = {}; groups = []; current = set()
    for event in events:
        require(type(event) is dict, 'original Go object required')
        action, name = event.get('Action'), event.get('Test')
        if action == 'build-output':
            require(not active and not groups and set(event) == {'Action','ImportPath','Output'}
                    and event['ImportPath'] == package+'.test' and type(event['Output']) is str,
                    'original Go build notice scope differs')
            continue
        require(event.get('Package') == package and action in ('start','run','pause','cont','output','pass','skip'),
                'original Go failure/foreign package/unsupported event')
        if action == 'start':
            require(not active and name is None, 'overlapping original package frame')
            active = True; current = set(); continue
        require(active, 'unframed original Go event')
        if name is None:
            if action == 'output':
                continue
            require(action == 'pass' and current and all(n in terminal for n in current),
                    'original package must pass every started top and child')
            groups.append(current); active = False; continue
        require(type(name) is str and name.startswith('Test') and all(name.split('/')),
                'original Go test name differs')
        if action == 'run':
            parent = name.rsplit('/',1)[0] if '/' in name else None
            if parent is not None and not closed_tops:
                # A t.Run label may itself contain '/'. Only prefixes that
                # actually ran are parents; an invented intermediate run is
                # not required. Still reject a child of a closed real parent.
                while parent not in seen and '/' in parent:
                    parent=parent.rsplit('/',1)[0]
            require(name not in seen and (parent is None or (parent in current and parent not in terminal)),
                    'duplicate original run or missing active parent')
            seen.add(name); current.add(name)
        elif action in ('pass','skip'):
            require(name in current and name not in terminal
                    and (action != 'skip' or name in allowed_skips), 'duplicate/missing run or unexpected skipped case')
            terminal[name] = action
        else:
            require(name in current and name not in terminal, 'output/continuation lacks active original test')
    require(not active and len(groups) == frames and set(terminal) == seen,
            'incomplete original Go package/child coverage')
    require(all(terminal.get(name) == 'pass' for name in required), 'required original Go run/pass missing')
    if closed_tops:
        require({name for name in seen if '/' not in name} == set(required), 'original CLI top scope differs')
    return dict(package=package,packageInvocations=len(groups),requiredPassed=sorted(required),
                topCases=sum('/' not in name for name in seen),childCases=sum('/' in name for name in seen),
                explicitSkipped=sorted(n for n,v in terminal.items() if v == 'skip'))


def read_focused(files,run,job):
    """Read the sole collector's unpacked originals, never fetch a second ZIP.

    Original all-suite collectors remain enforced by the exact successful CI
    and its source-file blobs. The new CLI/Core cases are independently read
    from complete run/pass frames; no detached marker can stand in for them.
    """
    require(set(files) == STREAMS | {'SOURCE.json'}, 'complete future five-stream inventory required')
    source=json.loads(files['SOURCE.json']);identity(run,job,source)
    require(source.get('sourceFiles') == SOURCE_FILES, 'original future CI/collector source blobs differ')
    refs=source.get('files');require(type(refs) is list and len(refs)==5, 'all five captured stream references required')
    found=set();reports={}
    for ref in refs:
        name=ref['path'];require(name in STREAMS and name not in found and ref.get('status')=='captured',
                                 'unique complete future original stream required')
        raw=files[name];require(type(raw) is bytes and len(raw)==ref['bytes']
                               and hashlib.sha256(raw).hexdigest()==ref['sha256'], 'future original stream SHA/bytes differ')
        rows=[json.loads(line) for line in raw.splitlines()]
        require(rows and all(type(e) is dict and e.get('Action') not in ('fail','build-fail') for e in rows),
                'future original Go failure cannot qualify')
        found.add(name)
        reports[name]=dict(bytes=len(raw),sha256=ref['sha256'],events=len(rows))
    require(found==STREAMS, 'future source stream coverage incomplete')
    cli=original_go_frames(files['ynx-lab-callee-tests.jsonl'],
                          'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab',CLI_REQUIRED,closed_tops=True)
    core=original_go_frames(files['ynx-initial-cache-state-tests.jsonl'],
                           'github.com/JiahaoAlbus/YNX-Chain/internal/consensus',CORE_REQUIRED,
                           frames=6,allowed_skips=OPT_IN_SKIPS)
    require(set(core['explicitSkipped'])==OPT_IN_SKIPS, 'original ten explicit opt-in skips differ')
    return dict(schema='YNX-PERF-7C25-NORMAL-CI-ORIGINAL-READBACK/v1',source=SOURCE,sourceTree=TREE,
                sourceCIRef=CI_REF,sourceCIRun=CI_RUN,sourceCIJob=CI_JOB,sourceOnlyQualified=True,
                cliRequiredPassed=cli['requiredPassed'],coreRequiredPassed=core['requiredPassed'],
                cli=cli,core=core,streams=reports,originalSourceFiles=SOURCE_FILES,
                oldRequiredCollectorsEnforcedByMatchingCI=True,actual500InitializedOwnersQualified=False,
                semanticPairConsumed=False,runtimePermissionGranted=False,pressureAuthorized=False,
                sourceParentAuthorityGranted=False,businessTPS=None,finalityLatency=None)


def _sealed(directory, name, pin):
    require(type(pin) is str and re.fullmatch('[0-9a-f]{64}',pin) is not None,
            '7c25 complete original '+name+' pin NOT_SUPPLIED')
    path = directory/name
    require(not path.is_symlink(), 'future evidence may not redirect')
    with path.open('rb') as stream:
        raw = stream.read((4<<20)+1)
    require(len(raw) <= 4<<20 and hashlib.sha256(raw).hexdigest() == pin, 'sealed future evidence differs')
    return json.loads(raw)


def require_semantic(semantic):
    require(semantic.get('schema') == 'YNX-PERF-7C25-LINUX-SEMANTIC-ORIGINAL-READBACK/v1'
            and semantic.get('afterCommit') == SOURCE and semantic.get('afterTree') == TREE
            and semantic.get('toolsCommit') == '478bf2ee60c19dcbdb67872184f9e1f500511746'
            and semantic.get('beforeExecutionTree') == '0397f75ec55db6a89b46e2e6d051ce960c36827d'
            and semantic.get('afterExecutionTree') == '96d91aed6a015f7243bb18b5d7a375bddf51483a'
            and semantic.get('traceSHA256') == '11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6'
            and all(semantic.get(k) is True for k in ('limitedOriginalTrajectoryQualified',
                'completePerHeightTxResultsEqual','completePerHeightBalanceNonceStateEqual',
                'completePerHeightAppHashEqual','completePerHeightRawStateBytesEqual',
                'coldReconstructionProducerRecordsVerified','cleanupComplete'))
            and type(semantic.get('heights')) is int and semantic['heights'] == 9,
            'same-tuple complete nine-height transaction/raw-state/AppHash/cold equivalence NOT_SUPPLIED')
    go = semantic.get('afterSourceGoHeightTests', {})
    require(go.get('topCases') == 2 and go.get('childCases') == 15 and go.get('packagePassed') is True
            and go.get('failed') == 0 and go.get('skipped') == 0,
            'same-window actual after-source Go height-evidence tests NOT_SUPPLIED')
    evidence = semantic.get('perHeightEvidence', {})
    require(evidence.get('heights') == list(map(str, range(4,13)))
            and evidence.get('completePerHeightRawStateBytesEqual') is True
            and evidence.get('coldReconstructionProducerRecordsVerified') is True
            and set(evidence.get('coldStageObservedNanoseconds', {})) == {'before','after'}
            and all([r.get('height') for r in evidence['coldStageObservedNanoseconds'][arm]]
                    == list(map(str,range(4,13))) for arm in ('before','after')),
            'all original nine-height cold timing records NOT_SUPPLIED')


def qualification(directory=None):
    directory = Path(directory) if directory is not None else Path(__file__).with_name('fixtures')/'7c25-source'
    normal = _sealed(directory,'NORMAL-READBACK.json',NORMAL_RECEIPT_SHA256)
    require(normal.get('schema')=='YNX-PERF-7C25-NORMAL-CI-ORIGINAL-READBACK/v1'
            and normal.get('source') == SOURCE and normal.get('sourceTree') == TREE
            and normal.get('sourceCIRef') == CI_REF and normal.get('sourceOnlyQualified') is True
            and normal.get('sourceCIRun') == CI_RUN and normal.get('sourceCIJob') == CI_JOB
            and set(normal.get('cliRequiredPassed',[])) == CLI_REQUIRED
            and set(normal.get('coreRequiredPassed',[])) == CORE_REQUIRED,
            'future source normal originals not qualified')
    semantic = _sealed(directory,'SEMANTIC-READBACK.json',SEMANTIC_RECEIPT_SHA256)
    require_semantic(semantic)
    return dict(schema='YNX-PERF-7C25-SOURCE-AND-SEMANTIC-QUALIFICATION/v1',source=SOURCE,sourceTree=TREE,
                productionForkTree=FORK,sourceCIRef=CI_REF,sourceCIRun=CI_RUN,sourceCIJob=CI_JOB,
                sourceOnlyQualified=True,semanticPairConsumed=True,heights=semantic['heights'],
                normalReadbackSHA256=NORMAL_RECEIPT_SHA256,semanticReadbackSHA256=SEMANTIC_RECEIPT_SHA256,
                actual500InitializedOwnersQualified=False,runtimePermissionGranted=False,pressureAuthorized=False,
                sourceParentAuthorityGranted=False,businessTPS=None,finalityLatency=None)
