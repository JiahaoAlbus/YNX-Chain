"""Exact same-source held clock CI evidence; never a window permission.

The owner must review and freeze one complete successful source/run/job tuple
in BINDING. No CLI argument, environment variable or predecessor CI can fill
that slot. Metadata checks do not independently attest a binary or process.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request

spec=importlib.util.spec_from_file_location('original_held_clock_ci_contract',Path(__file__).with_name('pq-held-first100-source.py'))
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
BINDING=None
# Only the owner may freeze the original same-job log digest and exact test
# inventory after independent official collection. No caller/environment may
# supply or replace this value, and no duplicate log download is performed.
LOG_REQUIREMENTS=None
LOG_BEGIN='YNX-COMMIT-CLOCK-TEST-JSON-BEGIN/v1'
LOG_END='YNX-COMMIT-CLOCK-TEST-JSON-END/v1'
_PKG='github.com/JiahaoAlbus/YNX-Chain/'
REQUIRED_TESTS=tuple((_PKG+'cmd/ynx-comet',name) for name in (
    'TestCommitMonotonicRequiresDistinctSyntheticOriginal',
    'TestCommitMonotonicRealBlockExecutorSyntheticTransfer',
    'TestCommitMonotonicMissingSourceIsUnknown',
    'TestCommitMonotonicDeclaredSourceValidation',
    'TestCommitMonotonicSameKernelChild',
    'TestCommitValidationObservationOriginalBlockAndOptIn',
    'TestCommitValidationObservationSyntheticOptInCost',
    'TestCommitValidationRequiresSyntheticCommitObservation',
    'TestCommitValidationPhaseContractRejectsAmbiguousDetail',
    'TestOperatorFinalizeObservationDefaultAndClosedFlags',
    'TestOperatorFinalizeObservationActualCallerAndFailureProjection',
    'TestOperatorFinalizeObservationRetainsFailureAndDropDebt'))+tuple(
    (_PKG+'internal/consensus',name) for name in (
    'TestFinalizeTimingDefaultAndCanonicalEquivalence',
    'TestFinalizeTimingFailuresAndBoundedKnownClock',
    'TestFinalizeTimingMaterializationOriginalOwnership',
    'TestCommitValidationTimingTracksSameRealAttemptAndOriginalWire',
    'TestCommitValidationTimingOptInPreservesErrorsAndHashWithDeterministicClock',
    'TestABCIPublicTraceFullStateAndAppHashEveryHeight'))
EXTRA_FOCUSED_STEPS=('Verify synthetic local Commit monotonic boundary',)
CADDY_STEPS=('Record exact original Caddy source identity',
    'Verify original Caddy JSON consumer without changing services',
    'Verify independently prepared original Caddy baseline DATA',
    'Verify original Caddy source approval and normal cutover caller',
    'Verify existing Caddyfile and JSON ingress source controls',
    'Verify exact persistent baseline installer without operating services',
    'Verify bounded original Caddy DATA caller without starting a node',
    'Verify real FD transitions in the original bounded process guard',
    'Verify independent closed Caddy DATA window contract',
    'Seal only successfully tested public Caddy baseline sources',
    'Upload only the tested Caddy source bundle',
    'Seal only the normal bounded Caddy DATA control sources',
    'Upload only the tested normal Caddy DATA control source bundle')
VERIFIER_STEPS=('Checkout the same verified protocol source','Install the original pinned Go toolchain',
    'Build only the existing offline verifier for macOS callers',
    'Upload only public macOS verifier executables and exact source pins',
    'Build the normal macOS SourceOwner registration CLI without executing it',
    'Upload only public macOS SourceOwner registration executables and exact source pins')
REPOSITORY='JiahaoAlbus/YNX-Chain'
WORKFLOW_ID=322643672
WORKFLOW_PATH='.github/workflows/resource-market-ci.yml'


def require(condition,message):
    if not condition:raise RuntimeError(message)


def hex40(value):return type(value) is str and re.fullmatch('[0-9a-f]{40}',value) is not None


def strict(raw):
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'duplicate original CI metadata field');result[key]=value
        return result
    def invalid(value):raise RuntimeError('nonfinite original CI metadata field')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=invalid)


def binding_identity(binding,identity):
    fields={'source','tree','forkTree','branch','run','focusedJob','caddyJob','deliveryJob','verifierJob'}
    require(type(binding) is dict and set(binding)==fields and all(hex40(binding[k]) for k in ('source','tree','forkTree'))
            and type(binding['branch']) is str and re.fullmatch(r'codex/[a-z0-9][a-z0-9-]{1,96}',binding['branch'])
            and all(type(binding[k]) is int and binding[k]>0 for k in ('run','focusedJob','caddyJob','deliveryJob','verifierJob'))
            and len({binding[k] for k in ('focusedJob','caddyJob','deliveryJob','verifierJob')})==4,
            'closed frozen clock source/CI tuple required')
    require(type(identity) is dict and all(identity.get(k)==binding[name] for k,name in
            (('commit','source'),('tree','tree'),('forkTree','forkTree'))),'exact original source/tree/fork differs')


def original_log_identity(binding,requirements):
    fields={'source','run','job','attempt','sha256'}
    require(type(requirements) is dict and set(requirements)==fields
            and requirements['source']==binding['source'] and requirements['run']==binding['run']
            and type(requirements['run']) is int and requirements['job']==binding['focusedJob']
            and type(requirements['job']) is int and type(requirements['attempt']) is int
            and requirements['attempt']==1 and type(requirements['sha256']) is str
            and re.fullmatch('[0-9a-f]{64}',requirements['sha256']),
            'frozen same-job original log identity required')


def validate_original_log(binding,requirements,original):
    """Check a pinned, already-collected official job log, never a test summary."""
    original_log_identity(binding,requirements)
    expected=REQUIRED_TESTS
    require(type(original) is bytes and 0<len(original)<=32<<20
            and hashlib.sha256(original).hexdigest()==requirements['sha256'],
            'original same-job log missing, oversized or SHA differs')
    try:lines=original.decode('utf-8','strict').splitlines()
    except UnicodeDecodeError:raise RuntimeError('original job log is not UTF-8') from None
    # GitHub prefixes each raw job-log line with its timestamp. Do not accept a
    # marker buried in a test's JSON Output string as a runner line.
    def content(line):
        return re.sub(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z ', '', line, count=1)
    lines=[content(line) for line in lines]
    require(lines.count(LOG_BEGIN)==1 and lines.count(LOG_END)==1,'unique original test stream markers required')
    begin,end=lines.index(LOG_BEGIN),lines.index(LOG_END)
    require(begin<end,'original test stream markers out of order')
    wanted={tuple(pair) for pair in expected};packages={p for p,_ in wanted}
    seen={test:[] for _,test in wanted};package_events={p:[] for p in packages};package_state={p:0 for p in packages}
    for line in lines[begin+1:end]:
        event=strict(line.encode('utf-8'))
        require(type(event) is dict and event.get('Action') in
                ('start','run','pause','cont','pass','output','bench','skip','fail')
                and type(event.get('Package')) is str,'malformed original go test event')
        action=event['Action'];require(action not in ('skip','fail'),'original test was skipped or failed')
        package=event['Package'];test=event.get('Test')
        require(test is None or type(test) is str,'malformed original test identity')
        if package in package_state and test is not None:
            require(package_state[package]==1,'original test outside its package lifetime')
        if test in seen and action in ('run','pass'):seen[test].append((package,action))
        if package in package_events and test is None and action in ('start','pass'):
            require(package_state[package]==(0 if action=='start' else 1),
                    'original package start/pass out of order')
            package_state[package]=1 if action=='start' else 2
            package_events[package].append(action)
    require(all(seen[test]==[(package,'run'),(package,'pass')] for package,test in wanted)
            and all(events==['start','pass'] for events in package_events.values()),
            'original required tests or package start/pass missing, duplicate or out of order')
    return dict(sha256=requirements['sha256'],bytes=len(original),requiredTests=len(wanted),
                packages=len(packages),skipped=0,failed=0,officialIdentityRequiresFrozenCollection=True)


def validate(binding,identity,run,focused,jobs):
    """Validate supplied DATA only; a caller-provided binding grants nothing."""
    binding_identity(binding,identity)
    require(type(run) is dict and type(run.get('id')) is int and run['id']==binding['run']
            and run.get('head_sha')==binding['source'] and run.get('head_branch')==binding['branch']
            and run.get('event')=='push' and type(run.get('run_attempt')) is int and run['run_attempt']==1
            and type(run.get('workflow_id')) is int and run['workflow_id']==WORKFLOW_ID
            and type(run.get('repository')) is dict and run['repository'].get('full_name')==REPOSITORY
            and run.get('path')==WORKFLOW_PATH and run.get('status')=='completed' and run.get('conclusion')=='success',
            'one exact successful original source push run required')
    require(type(jobs) is list and len(jobs)<=100 and all(type(job) is dict for job in jobs),
            'complete bounded original job inventory required')
    def original_job(name,expected):
        matches=[job for job in jobs if job.get('name')==name]
        require(len(matches)==1,'one original same-run job required: '+name)
        job=matches[0]
        require(type(job.get('id')) is int and job['id']==expected and type(job.get('run_id')) is int and job['run_id']==binding['run']
                and type(job.get('run_attempt')) is int and job['run_attempt']==1 and job.get('head_sha')==binding['source']
                and job.get('run_url')=='https://api.github.com/repos/'+REPOSITORY+'/actions/runs/%d'%binding['run']
                and job.get('head_branch')==binding['branch'] and job.get('status')=='completed'
                and job.get('conclusion')=='success' and type(job.get('steps')) is list
                and len(job['steps'])<=512 and all(type(step) is dict for step in job['steps']),
                'original same-run job identity or outcome differs: '+name)
        return job
    producer=original_job('focused-go',binding['focusedJob'])
    caddy=original_job('caddy-source',binding['caddyJob'])
    delivery=original_job('protocol-delivery',binding['deliveryJob'])
    verifier=original_job('proof-verifier-macos',binding['verifierJob'])
    require(type(focused) is dict and all(type(focused.get(k)) is int for k in ('id','run_id','run_attempt'))
            and all(focused.get(k)==producer.get(k) for k in
            ('id','run_id','run_attempt','run_url','head_sha','head_branch','name','status','conclusion','steps')),
            'separately fetched focused job differs from same-run inventory')
    def steps(job,names):
        for name in names:
            matches=[step for step in job['steps'] if type(step) is dict and step.get('name')==name]
            require(len(matches)==1 and matches[0].get('status')=='completed' and matches[0].get('conclusion')=='success',
                    'original required CI step incomplete: '+name)
    steps(producer,(*held.REQUIRED_STEPS,*EXTRA_FOCUSED_STEPS))
    steps(caddy,CADDY_STEPS)
    steps(delivery,held.DELIVERY_STEPS)
    steps(verifier,VERIFIER_STEPS)
    return dict(source=binding['source'],sourceTree=binding['tree'],forkTree=binding['forkTree'],
        run=binding['run'],focusedJob=binding['focusedJob'],caddyJob=binding['caddyJob'],
        deliveryJob=binding['deliveryJob'],verifierJob=binding['verifierJob'],
        focusedSteps=[*held.REQUIRED_STEPS,*EXTRA_FOCUSED_STEPS],caddySteps=list(CADDY_STEPS),
        deliverySteps=list(held.DELIVERY_STEPS),verifierSteps=list(VERIFIER_STEPS),
        sourceOnlyEvidence=True,focusedOriginalLogVerified=False,binaryAndLiveProcessIndependentlyBound=False,runtimePermissionGranted=False,
        independentFinality=False,pressureAuthorized=False)


def qualification(identity,*,metadata_reader=None,focused_log_reader=None):
    """Use only the owner-frozen tuple; recheck the original run after inventory."""
    require(BINDING is not None,'exact clock source and full same-run CI NOT_SUPPLIED')
    binding_identity(BINDING,identity) # Refuse a changed checkout before any API request.
    if metadata_reader is None:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,req,fp,code,msg,headers,newurl):raise RuntimeError('original CI metadata redirect refused')
        opener=urllib.request.build_opener(NoRedirect)
        headers={'Accept':'application/vnd.github+json','User-Agent':'ynx-held-clock-source'}
        token=os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if token:headers['Authorization']='Bearer '+token
        def metadata_reader(endpoint):
            url='https://api.github.com/repos/'+REPOSITORY+'/actions/'+endpoint
            with opener.open(urllib.request.Request(url,headers=headers),timeout=15) as response:
                raw=response.read((1<<20)+1)
                require(response.status==200 and response.url==url and len(raw)<=1<<20,'bounded exact original CI metadata required')
                return strict(raw)
    run=metadata_reader('runs/%d'%BINDING['run'])
    focused=metadata_reader('jobs/%d'%BINDING['focusedJob'])
    inventory=metadata_reader('runs/%d/jobs?per_page=100'%BINDING['run'])
    require(type(inventory) is dict and type(inventory.get('total_count')) is int
            and type(inventory.get('jobs')) is list and inventory['total_count']==len(inventory['jobs'])
            and len(inventory['jobs'])<=100,'complete bounded original CI job inventory required')
    result=validate(BINDING,identity,run,focused,inventory['jobs'])
    require(LOG_REQUIREMENTS is not None and focused_log_reader is not None,
            'same-job original test log and fixed inventory NOT_SUPPLIED')
    original_log_identity(BINDING,LOG_REQUIREMENTS)
    # A single original collector owns retrieval. This boundary only consumes
    # its preserved bytes; it never starts or retries an Actions log download.
    original=focused_log_reader(BINDING['run'],BINDING['focusedJob'],1)
    result['originalFocusedTestLog']=validate_original_log(BINDING,LOG_REQUIREMENTS,original)
    latest=metadata_reader('runs/%d'%BINDING['run'])
    require(type(latest) is dict and all(latest.get(key)==run.get(key) for key in
        ('id','head_sha','head_branch','event','run_attempt','workflow_id','path','status','conclusion'))
        and type(latest.get('repository')) is dict and latest['repository'].get('full_name')==REPOSITORY,
        'original source run changed while reading job inventory')
    validate(BINDING,identity,latest,focused,inventory['jobs'])
    result['focusedOriginalLogVerified']=True
    return result
