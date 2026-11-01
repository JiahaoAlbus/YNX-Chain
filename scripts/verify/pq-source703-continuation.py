#!/usr/bin/env python3
"""Fixed source-only 703 continuation. No deployment or authorization effects."""
import datetime, hashlib, json, os, pathlib, subprocess, sys, time

SPEC = json.loads(r'''{"resourceSHA256":"381b8e30f93c7087af8a911037fb9d45afa85f7ee756bdfeba7ccf0097ee5e70","priorPrefix":[[1,"Set up job","success"],[2,"Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1","success"],[3,"Run actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e","success"],[4,"Verify exact public TLS fixture and fail-closed secret scanning","success"],[5,"Record exact candidate identity","success"],[6,"Check reachable vulnerabilities in the eight production runtime commands","success"],[7,"Verify same-source completed normal CI before remote network execution","skipped"],[8,"Verify original-copy observation controls without touching the original case","success"],[9,"Verify Linux window controls without starting a node","success"],[10,"Verify pure dual-PQ protocol and account authorization","success"],[11,"Upload only actual Go public artifact-purpose vectors","success"],[12,"Upload public canonical action vectors from the actual Go codec","success"],[13,"Verify forked engine keys and actual consensus objects","success"],[14,"Compile forked state and consensus engine without starting nodes","success"],[15,"Verify exact-height maintenance stop with real engine commit and cold stores","success"],[16,"Reproduce and repair same-directory database ownership without starting nodes","success"],[17,"Verify real profile state transition and historical store without starting nodes","success"],[18,"Reproduce and repair real Commit and engine checkpoint read ordering","success"],[19,"Verify bounded remote signer transport and unchanged legacy protobuf vectors","success"],[20,"Verify actual engine signing caller uses committed height key and round context","success"],[21,"Measure fresh single and bounded concurrent dual signature paths","success"],[22,"Measure actual policy certificate cache consumer cold and warm paths","success"],[23,"Install pinned contract build runtime","success"],[24,"Verify failed candidate deployment preserves services and signing history","success"],[25,"Verify original-state operator transition preserves custody and uncertain attempts","success"],[26,"Verify original key ceremony retains partial custody and never creates during resume","success"],[27,"Compile frozen measured production overlay without executing cases","success"],[28,"Generate canonical IDE contract fixture","success"],[29,"Verify actual IDE compiler materials with original Go deployment callees","success"],[30,"Verify existing Wallet inbox materials with original Go deployment callees","success"],[31,"Upload only public contract deployment registry from the actual Go caller","success"],[32,"Verify native ledger and HTTP PQ integration","success"],[33,"Compile production entry points","success"],[34,"Exercise original lab callee readiness and actual cold costs","success"],[35,"Reproduce opaque classic staking refusal with original successful transactions","success"],[36,"Reproduce the original missing PQ validator staking entry","success"],[37,"Reproduce source log response budget overrun before later records","success"],[38,"Verify complete state bridge and sponsor continuity","success"],[39,"Reproduce signed-history overwrite and unsafe rollback callers","success"],[40,"Reproduce source-authority initialization coupling and verify independent execution","success"],[41,"Reproduce JSON-only signing source and verify real journal recovery","success"],[42,"Reproduce atomic-only Comet operator startup and verify normal journal selection","success"],[43,"Reproduce Ethereum mutable-lot provenance counterexamples and verify cold recovery","success"],[44,"Reproduce historical AA policy counterexamples against the original state validator","success"],[45,"Reproduce source evidence rehash counterexamples and verify original-label coverage","success"],[46,"Reproduce history pagination movement across real application commits","success"],[47,"Reproduce the existing Wallet health refusal with the complete original Gateway","success"]],"dependency":{"index":26,"name":"Generate canonical IDE contract fixture","bodySHA256":"2da64f78d08e69a92e3432e7a38775d5d4520951a9d47fa762ea3c73476d1404","env":{"NODE_OPTIONS":"--max-old-space-size=1536"}},"steps":[{"index":46,"name":"Verify Whole BFT gateway and native container readback","bodySHA256":"12c80eec149efe88637f02c42e368ce94df84d0a61bbd1512e25ce54ba124e85","env":{"YNX_PQ_STAKING_ORIGINALS_FIXTURE_OUT":"${{ runner.temp }}/ynx-pq-staking-originals-public-interop.json","YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT":"${{ runner.temp }}/ynx-pq-contract-deploy-public-interop.json"}},{"index":49,"name":"Verify existing Chain readback and recovery after protocol integration","bodySHA256":"6df8ea01f41f88ab8f7baf49adcab457ffc1b49b4fc4db7daa932cb1dc9e0841","env":{}},{"index":50,"name":"Verify existing Chain SDK after protocol integration","bodySHA256":"efc51916ac5bda49f2376f02acb54e7a361dc5952152f1df5d2f505a58e792ca","env":{}},{"index":51,"name":"Emit application-backed public Wallet HTTP fixture","bodySHA256":"f363ab0e424107e3b13c6efc6e458f1075bc68b71532a105c92f836a67995d53","env":{"YNX_PQ_WALLET_FIXTURE_OUT":"${{ runner.temp }}/ynx-pq-wallet-public-http-fixture.json"}},{"index":53,"name":"Verify shared Wallet policy and Chain payment authorization regressions","bodySHA256":"3baa35ffc144ee79a40ee8b245619fcab6d9922fa7595338685ebb2562360b2c","env":{}},{"index":54,"name":"Reproduce private verifier process-exit telemetry counterexample","bodySHA256":"375c437b4adba9b882b90b9f079023d85d9632f9d63e4d80b7beeca8eda1e519","env":{}},{"index":55,"name":"Verify operator checkpoint format and original read-lock admission","bodySHA256":"20701caa5e7308adea90dc5f097dd46881b2bd7c1997fbd6591239da1e040224","env":{}}]}''')
REPO = 'JiahaoAlbus/YNX-Chain'
SOURCE = '7037966eb2ce7a7167f02a09ee1f3bc0eebd1026'
TREE = 'd15f6dc63ee4c69460273d348637e135c8005922'
BRANCH = 'refs/heads/codex/ynx-pq-source703-continuation-20261101'
WORKFLOW = '.github/workflows/pq-normal-process.yml'
JOB = 'source703-continuation'

class Refused(Exception):
    pass

def require(ok, message):
    if not ok:
        raise Refused(message)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode() + b'\n'

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=20).decode().strip()

def api(path):
    require(path.startswith(('actions/', 'check-runs/', 'git/commits/')), 'API outside fixed read-only scope')
    r = subprocess.run(['gh', 'api', 'repos/' + REPO + '/' + path], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    require(r.returncode == 0 and len(r.stdout) <= 2 << 20, 'official read-only API unavailable')
    return json.loads(r.stdout)

def validate_prior(run, job, annotations, chain, commit):
    require(run.get('id') == 41272858949 and run.get('head_sha') == SOURCE and run.get('run_attempt') == 1, 'prior source/run/attempt differs')
    require(run.get('event') == 'push' and run.get('head_branch') == 'codex/ynx-pq-perf-integration' and run.get('path') == '.github/workflows/resource-market-ci.yml', 'prior normal source entry differs')
    require(run.get('status') == 'completed' and run.get('conclusion') == 'cancelled', 'prior CANCELLED must be retained')
    require(job.get('id') == 124749016396 and job.get('run_id') == run['id'] and job.get('head_sha') == SOURCE and job.get('run_attempt') == 1 and job.get('name') == 'focused-go' and job.get('conclusion') == 'cancelled', 'prior focused job differs')
    require(any(a.get('annotation_level') == 'failure' and a.get('message') == 'The job has exceeded the maximum execution time of 15m0s' for a in annotations), 'official source timeout annotation missing')
    parse = lambda x: datetime.datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ')
    require(900 <= (parse(job['completed_at']) - parse(job['started_at'])).total_seconds() <= 930, 'prior job duration is not the original 15-minute timeout')
    actual = [(x['number'], x['name'], x.get('conclusion')) for x in job['steps'] if x['number'] < 48]
    require(actual == [tuple(x) for x in SPEC['priorPrefix']], 'actual successful/skipped prefix changed')
    require(any(x.get('number') == 48 and x.get('name') == SPEC['steps'][0]['name'] and x.get('conclusion') == 'cancelled' for x in job['steps']), 'original Whole gateway cancellation missing')
    require(chain.get('id') == 41272858825 and chain.get('head_sha') == SOURCE and chain.get('run_attempt') == 1 and chain.get('event') == 'push' and chain.get('status') == 'completed' and chain.get('conclusion') == 'success' and chain.get('path') == '.github/workflows/chain-core.yml', 'original Chain CI scope not actually successful')
    require(commit.get('sha') == SOURCE and commit.get('tree', {}).get('sha') == TREE, 'official source Git tuple differs')
    return {'resourceRunId': run['id'], 'resourceConclusion': 'cancelled', 'focusedJobId': job['id'], 'cancellationCause': 'official 15m0s timeout annotation', 'chainRunId': chain['id'], 'chainConclusion': 'success', 'prefix': SPEC['priorPrefix'], 'newReadyAndCacheScopeReused': True, 'resourceWholeSuccess': False}

def validate_host(env, event, controller, source):
    require(env.get('GITHUB_REPOSITORY') == REPO and env.get('GITHUB_EVENT_NAME') == 'push' and env.get('GITHUB_REF') == BRANCH and env.get('GITHUB_RUN_ATTEMPT') == '1', 'only fixed original first normal push allowed')
    sha = env.get('GITHUB_SHA', '')
    require(len(sha) == 40 and all(c in '0123456789abcdef' for c in sha) and sha != SOURCE and int(sha, 16) != 0, 'independent controller SHA required')
    require(env.get('GITHUB_WORKFLOW_REF') == REPO + '/' + WORKFLOW + '@' + BRANCH and env.get('GITHUB_WORKFLOW_SHA') == sha, 'original workflow/controller identity differs')
    require(event.get('ref') == BRANCH and event.get('after') == sha and event.get('before') == '0' * 40 and event.get('created') is True and event.get('deleted') is False and event.get('forced') is False, 'only unique new-branch push is allowed')
    require(event.get('repository', {}).get('full_name') == REPO, 'foreign event repository')
    require(controller['head'] == sha and controller['parents'] == [SOURCE], 'controller must be sole child of actual source703')
    require(source['head'] == SOURCE and source['tree'] == TREE and source['shallow'] is False and source['dirty'] is False, 'actual callee must be clean complete source703')
    require(env.get('GOMAXPROCS') == '2' and env.get('GOMEMLIMIT') == '1536MiB' and env.get('CGO_ENABLED') == '0', 'source CPU/memory tuple differs')
    return sha

def source_steps(source):
    path = source / '.github/workflows/resource-market-ci.yml'
    raw = path.read_bytes()
    require(digest(raw) == SPEC['resourceSHA256'], 'source703 original resource workflow bytes differ')
    expression = "d=YAML.load_file(ARGV[0]);s=d.fetch('jobs').fetch('focused-go').fetch('steps');puts JSON.generate([26,46,49,50,51,53,54,55].map{|i|{'index'=>i,'step'=>s.fetch(i)}})"
    items = json.loads(subprocess.check_output(['/usr/bin/ruby', '-ryaml', '-rjson', '-e', expression, str(path)], timeout=15))
    expected = [SPEC['dependency']] + SPEC['steps']
    require(len(items) == len(expected), 'fixed step catalog changed')
    for item, pin in zip(items, expected):
        s = item['step']
        require(item['index'] == pin['index'] and s['name'] == pin['name'] and digest(s['run'].encode()) == pin['bodySHA256'] and s.get('env', {}) == pin['env'], 'original run/env bytes changed')
    return items

def check_workflow(controller, extracted):
    flow = json.loads((controller / WORKFLOW).read_bytes())
    require(set(flow['jobs']) == {JOB}, 'continuation must contain exactly one source job')
    require(flow['on'] == {'push': {'branches': [BRANCH.removeprefix('refs/heads/')]}}, 'extra entry/event refused')
    steps = flow['jobs'][JOB]['steps']
    for item in extracted:
        selected = [s for s in steps if s.get('name') == item['step']['name']]
        require(len(selected) == 1 and selected[0]['run'] == item['step']['run'] and selected[0].get('env', {}) == item['step'].get('env', {}), 'continuation changed original run/env bytes')
    require([s['name'] for s in steps if s.get('name') in [x['step']['name'] for x in extracted]] == [x['step']['name'] for x in extracted], 'original continuation order changed')

def paths():
    workspace = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    return workspace / 'controller', workspace / 'source703', pathlib.Path(os.environ['RUNNER_TEMP']) / 'ynx-source703-continuation-public'

def exclusive(path, value):
    with path.open('xb') as f:
        f.write(canonical(value))
        f.flush()
        os.fsync(f.fileno())

def preflight():
    controller, source, out = paths()
    event = json.loads(pathlib.Path(os.environ['GITHUB_EVENT_PATH']).read_bytes())
    current_controller = {'head': git(controller, 'rev-parse', 'HEAD'), 'parents': git(controller, 'show', '-s', '--format=%P', 'HEAD').split()}
    current_source = {'head': git(source, 'rev-parse', 'HEAD'), 'tree': git(source, 'rev-parse', 'HEAD^{tree}'), 'shallow': git(source, 'rev-parse', '--is-shallow-repository') != 'false', 'dirty': bool(git(source, 'status', '--porcelain'))}
    sha = validate_host(os.environ, event, current_controller, current_source)
    extracted = source_steps(source)
    check_workflow(controller, extracted)
    current = api('actions/runs/' + os.environ['GITHUB_RUN_ID'])
    require(current.get('workflow_id') == 402774607 and current.get('head_sha') == sha and current.get('run_attempt') == 1 and current.get('event') == 'push' and current.get('path') == WORKFLOW, 'original normal workflow/current run identity differs')
    prior = validate_prior(api('actions/runs/41272858949'), api('actions/jobs/124749016396'), api('check-runs/124749016396/annotations?per_page=100'), api('actions/runs/41272858825'), api('git/commits/' + SOURCE))
    require(subprocess.check_output(['go', 'env', 'GOVERSION'], cwd=source, timeout=15).decode().strip() == 'go1.26.10', 'actual Go differs')
    require(subprocess.check_output(['node', '--version'], timeout=15).decode().strip() == 'v24.19.0', 'actual Node differs')
    out.mkdir(mode=0o700)
    exclusive(out / 'PRIOR-SCOPE.json', {'version': 'YNX-SOURCE703-CONTINUATION-PRIOR/v1', 'controllerSHA': sha, 'actualCalleeSHA': SOURCE, 'actualCalleeTree': TREE, 'sourceWorkflowSHA256': SPEC['resourceSHA256'], 'prior': prior, 'authorityGranted': False, 'deployed': False})
    exclusive(out / 'SOURCE-STEPS.json', {'dependencyMaterialRebuildOnly': SPEC['dependency'], 'requiredNewTail': SPEC['steps'], 'oldSuccessfulVerificationGroupsRerun': False, 'authorityGranted': False})
    print('YNX_SOURCE703_CONTINUATION_IDENTITY_PASS controller=' + sha + ' callee=' + SOURCE + ' prior=CANCELLED_15M_TIMEOUT authority=false')

def tail_outcomes(job):
    statuses = []
    for spec in SPEC['steps']:
        found = [s for s in job['steps'] if s['name'] == spec['name']]
        require(len(found) <= 1, 'duplicate required actual step')
        statuses.append({'index': spec['index'], 'name': spec['name'], 'bodySHA256': spec['bodySHA256'], 'env': spec['env'], 'actual': found[0] if found else None})
    return statuses

def seven_pass(statuses):
    return len(statuses) == 7 and all(x['actual'] and x['actual'].get('status') == 'completed' and x['actual'].get('conclusion') == 'success' for x in statuses)

def seal():
    controller, source, out = paths()
    prior = json.loads((out / 'PRIOR-SCOPE.json').read_bytes())
    require(prior['controllerSHA'] == os.environ['GITHUB_SHA'] and prior['actualCalleeSHA'] == SOURCE and prior['prior']['resourceConclusion'] == 'cancelled', 'preflight tuple missing')
    source_unchanged = git(source, 'rev-parse', 'HEAD') == SOURCE and not git(source, 'diff', '--name-only', 'HEAD')
    controller_unchanged = git(controller, 'rev-parse', 'HEAD') == prior['controllerSHA'] and not git(controller, 'diff', '--name-only', 'HEAD')
    run_id = os.environ['GITHUB_RUN_ID']
    require(run_id.isdecimal(), 'invalid current run')
    run = api('actions/runs/' + run_id)
    require(run.get('head_sha') == prior['controllerSHA'] and run.get('run_attempt') == 1 and run.get('event') == 'push' and run.get('path') == WORKFLOW and run.get('workflow_id') == 402774607, 'current official run identity differs')
    deadline = time.monotonic() + 20
    statuses = []
    while True:
        jobs = api('actions/runs/' + run_id + '/jobs?filter=all&per_page=100')['jobs']
        require(len(jobs) == 1 and jobs[0]['name'] == JOB and jobs[0]['head_sha'] == prior['controllerSHA'], 'unexpected continuation job graph')
        statuses = tail_outcomes(jobs[0])
        if all(x['actual'] and x['actual'].get('conclusion') == 'success' for x in statuses) or any(x['actual'] and x['actual'].get('conclusion') in ['failure', 'cancelled', 'skipped', 'timed_out'] for x in statuses) or time.monotonic() >= deadline:
            break
        time.sleep(2)
    dependency = [x for x in jobs[0]['steps'] if x['name'] == SPEC['dependency']['name']]
    require(len(dependency) == 1, 'dependency material step absent or duplicated')
    tail_passed = seven_pass(statuses)
    passed = tail_passed and dependency[0].get('conclusion') == 'success' and source_unchanged and controller_unchanged
    exclusive(out / 'CONTINUATION-RECEIPT.json', {'version': 'YNX-SOURCE703-CONTINUATION-RESULT/v1', 'controllerSHA': prior['controllerSHA'], 'actualCalleeSHA': SOURCE, 'actualCalleeTree': TREE, 'sourceWorkflowSHA256': SPEC['resourceSHA256'], 'currentRunId': int(run_id), 'currentRunAttempt': 1, 'currentJobId': jobs[0]['id'], 'prior': prior['prior'], 'dependencyMaterialRebuildOnly': SPEC['dependency'], 'tailSteps': statuses, 'sevenTailActualPassed': tail_passed, 'continuationScopePassed': passed, 'dependencyActual': dependency[0], 'sourceUnchanged': bool(source_unchanged), 'controllerUnchanged': bool(controller_unchanged), 'originalResourceWholeSuccess': False, 'deploymentQualified': False, 'authorityGranted': False, 'realFunds': False, 'newNetworkWindow': False, 'actual500Window': False})
    require(passed, 'one or more required continuation steps did not actually pass; prior CANCELLED retained')
    print('YNX_SOURCE703_CONTINUATION_SEVEN_ACTUAL_PASS authority=false originalResourceWholeSuccess=false')

if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in ['preflight', 'seal'], 'only fixed preflight/seal accepted')
        preflight() if sys.argv[1] == 'preflight' else seal()
    except (Refused, KeyError, ValueError, OSError, subprocess.SubprocessError) as e:
        print('YNX_SOURCE703_CONTINUATION_REFUSED: ' + str(e), file=sys.stderr)
        raise SystemExit(78)
