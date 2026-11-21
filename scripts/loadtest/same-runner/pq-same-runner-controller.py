"""Default-closed controller candidate for two fresh original hosted arms.

No caller-supplied JSON, environment variable or CLI switch grants qualification.
The owning controller must freeze bridge.QUALIFIED_PAIR_BINDING in source, obtain
its exact CI and add the explicit pair profile to the ORIGINAL workflow. Existing
single-arm profiles and their controller are untouched. This module supplies the
real qualification/admission callbacks; the driver retains its own checks too.
Public uploads and manifest sealing remain separate original workflow steps.
"""
import argparse
import copy
import datetime
import errno
import importlib.util
import inspect
import json
import os
import socket
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


bridge = module('same_runner_controller_bridge', Path(__file__).with_name('pq-same-runner-original-adapter.py'))
producer, require = bridge.producer, bridge.require
reader = producer.reader
REPOSITORY = 'JiahaoAlbus/YNX-Chain'
PROFILE = 'first100-held-public-owner-sequential-pair'
CLOCK_LOG_BINDING = None  # Owner-frozen same-arm original focused logs only.
CLOCK_EVIDENCE_BINDING = None  # Owner-frozen same-arm original source artifacts only.
BEFORE59_COMPOSITION_BINDING = None  # Owner-frozen original Tools source/build artifact only.
WORKFLOW = '.github/workflows/pq-normal-process.yml'
TOOL_CI_WORKFLOW = '.github/workflows/chain-core.yml'
TOOL_CI_WORKFLOW_ID = 322083952
TOOL_CI_JOB = 'Chain Core source and release gate'
REQUIRED_TOOL_STEPS = (
    'Verify original d24 cohort and separate stage denominators',
    'Verify optional held public input footprint and original readiness metrics',
    'Verify normal public owner stream isolation and lost acknowledgements',
)
REQUIRED_TOOL_PINS = (
    'pq-independent-load.py', 'consensus-linux-cohort.py', 'pq-paired-linux-window.py',
    'pq-staged-independent-scheduler.py', 'pq-staged-harness-controls.py',
    'pq-held-first100-source.py', 'pq-initialization-readback.py', 'pq-public-proof-readback.py',
)
PAIR_JOB_SECONDS = 45*60
PAIR_EXECUTION_SECONDS = 35*60


def controller_root(filename):
    """Only the development location or isolated original-controller install."""
    path = Path(filename).resolve()
    if path.parent.name == 'same-runner':
        require(path.parts[-4:-1] == ('scripts', 'loadtest', 'same-runner'),
                'exact isolated pair controller installation required')
        return path.parents[3]
    require(path.parts[-3:-1] == ('scripts', 'loadtest'),
            'exact pair development installation required')
    return path.parents[2]


def pair_time_budget(job, pair, remaining_arms, execution_started, *, now=None, elapsed=None):
    """Actual Actions job deadline plus monotonic coordinator deadline, never a cap increase."""
    require(type(remaining_arms) is int and remaining_arms in (1,2), 'bounded remaining original arms required')
    require(job.get('id') == pair['jobID'] and job.get('run_id') == pair['runID']
            and type(job.get('run_attempt')) is int and job['run_attempt'] == 1
            and job.get('head_sha') == pair['controllerCommit'] and job.get('status') == 'in_progress'
            and job.get('name') == reader.JOB and job.get('runner_id') == pair['runnerID']
            and job.get('runner_name') == pair['runnerName'], 'original pair deadline job identity differs')
    stamp = job.get('started_at')
    require(type(stamp) is str and stamp.endswith('Z'), 'original job start time missing')
    started = datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()
    age = (time.time() if now is None else now)-started
    elapsed = time.monotonic()-execution_started if elapsed is None else elapsed
    require(0 <= age < PAIR_JOB_SECONDS and elapsed >= 0, 'original job or coordinator clock differs')
    require(PAIR_JOB_SECONDS-age >= remaining_arms*(900+15)+300
            and PAIR_EXECUTION_SECONDS-elapsed >= remaining_arms*(900+15)+30,
            'original deadline cannot cover remaining arms cleanup and uploads')


def same(left, right):
    return producer.encode(left) == producer.encode(right)


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=10, text=True).strip()


def checkout(root, commit, tree=None):
    reader.pin(commit, 40)
    require(root.is_absolute() and root.resolve(strict=True) == root
            and git(root, 'rev-parse', 'HEAD') == commit
            and not git(root, 'status', '--porcelain', '--untracked-files=all'),
            'exact canonical clean original checkout required')
    if tree is not None:
        reader.pin(tree, 40)
        require(git(root, 'rev-parse', 'HEAD^{tree}') == tree, 'frozen original checkout tree differs')


class ActionsMetadata:
    """Original bounded API GET only; no upload, dispatch or retry path."""
    def __init__(self, token):
        require(type(token) is str and bool(token),
                'original metadata credential missing; no unauthenticated pair fallback')
        self.token = token

    def read(self, suffix):
        import re
        require(re.fullmatch(r'(runs/[1-9][0-9]*(/((attempts/1/)?jobs|artifacts)\?per_page=100)?|jobs/[1-9][0-9]*)', suffix),
                'exact original metadata endpoint required')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                raise RuntimeError('original pair metadata redirect refused')
        url = 'https://api.github.com/repos/'+REPOSITORY+'/actions/'+suffix
        headers = {'Accept':'application/vnd.github+json', 'User-Agent':PROFILE}
        if self.token: headers['Authorization'] = 'Bearer '+self.token
        with urllib.request.build_opener(NoRedirect).open(
                urllib.request.Request(url, headers=headers), timeout=15) as response:
            raw = response.read((1 << 20)+1)
            require(response.status == 200 and response.url == url and len(raw) <= 1 << 20,
                    'bounded original metadata response required')
        return reader.strict(raw)


def verify_tools_ci(binding, run, job, *, clock_observation=False):
    reader.fields(binding, 'run job source branch event', 'frozen tools CI')
    reader.pin(binding['source'], 40)
    for key in ('run', 'job'): reader.positive(binding[key])
    require(binding['event'] in ('push', 'workflow_dispatch')
            and type(binding['branch']) is str and binding['branch'].startswith('codex/'),
            'explicit frozen Tools CI event and branch required')
    require(type(run.get('id')) is int and run['id'] == binding['run']
            and run.get('head_sha') == binding['source'] and run.get('head_branch') == binding['branch']
            and run.get('event') == binding['event'] and type(run.get('run_attempt')) is int
            and run['run_attempt'] == 1 and run.get('workflow_id') == TOOL_CI_WORKFLOW_ID
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('path') == TOOL_CI_WORKFLOW and run.get('status') == 'completed'
            and run.get('conclusion') == 'success', 'exact original tools CI run differs')
    require(type(job.get('id')) is int and job['id'] == binding['job']
            and job.get('run_id') == binding['run'] and type(job.get('run_attempt')) is int
            and job['run_attempt'] == 1 and job.get('head_sha') == binding['source']
            and job.get('name') == TOOL_CI_JOB and job.get('status') == 'completed'
            and job.get('conclusion') == 'success', 'exact original tools CI job differs')
    require(type(clock_observation) is bool,'explicit original clock Tools CI condition required')
    required=REQUIRED_TOOL_STEPS+(('Verify synthetic Commit clock original evidence readback',) if clock_observation else ())
    for name in required:
        steps = [step for step in job.get('steps', []) if step.get('name') == name]
        require(len(steps) == 1 and steps[0].get('status') == 'completed'
                and steps[0].get('conclusion') == 'success', 'original pair Tools CI step incomplete: '+name)
    return dict(run=binding['run'], job=binding['job'], source=binding['source'],
                requiredSteps=list(required), conclusion='success')


def verify_tool_files(tools, pins):
    require(type(pins) is dict and set(REQUIRED_TOOL_PINS) <= set(pins) and len(pins) <= 256,
            'explicit original driver, source, guard and staged TOOL_PINS required')
    for name, pin in pins.items():
        require(type(name) is str and Path(name).name == name and name.endswith('.py'),
                'original tool pin must be a local Python filename')
        reader.pin(pin)
        require(reader.digest(producer.public_bytes(tools/'scripts/loadtest'/name)) == pin,
                'frozen original TOOL_PINS differs: '+name)


def configuration(arm):
    reader.fields(arm, 'source sourceTree tools toolsTree toolsCI toolPins sourceQualification go supplier supplierTree',
                  'frozen original arm')
    for key in ('source', 'sourceTree', 'tools', 'toolsTree', 'supplier', 'supplierTree'):
        reader.pin(arm[key], 40)
    require(type(arm['go']) is str and arm['go'].startswith('go1.'), 'exact original Go version required')
    ci = arm['toolsCI']
    reader.fields(ci, 'run job source branch event', 'frozen tools CI')
    require(ci['source'] == arm['tools'], 'Tools CI does not bind this arm')
    for key in ('run', 'job'): reader.positive(ci[key])
    qualification = arm['sourceQualification']
    require(type(qualification) is dict and qualification.get('source') == arm['source']
            and qualification.get('sourceTree') == arm['sourceTree']
            and qualification.get('sourceOnlyQualified') is True
            and qualification.get('runtimePermissionGranted') is False,
            'explicit original source-only qualification required')
    for key in ('run', 'job'): reader.positive(qualification[key])
    options = dict(source='source', commit=arm['source'], mode='online', rate=100, seconds=5,
        tail_seconds=30, accounts=500, per_account=1, proof_timeout=30,
        first_trial_profile='held-first100', sender_backend='public-owner', initialize_before_load=True,
        initialization_only=False, staged_publication=True, startup_timings=True, wire_observation=True,
        commit_observation=True, network_accounting=True, owned_storage_accounting=True,
        header_hop_capture=False, prior_result=None, prior_result_sha256=None,
        held_ready_only=False, execute=False)
    if CLOCK_LOG_BINDING is not None:
        require(type(CLOCK_LOG_BINDING) is dict and set(CLOCK_LOG_BINDING)==set(reader.ARMS),
                'both original clock log arm bindings NOT_SUPPLIED')
        options.update(commit_clock_observation=True,commit_clock_ci_original_log=None)
    return dict(profile='first100-held-public-owner', ref='refs/heads/'+reader.BRANCH, workflow=WORKFLOW,
        source=arm['source'], sourceTree=arm['sourceTree'], tools=arm['tools'], toolsTree=arm['toolsTree'],
        toolsRun=ci['run'], toolsJobName=TOOL_CI_JOB, go=arm['go'], supplier=arm['supplier'],
        supplierTree=arm['supplierTree'], options=options, nodeCount=4, pressureLevel=1)


def cached_original_reader(read):
    """Read each exact original once; subsequent checks use identical in-memory bytes."""
    values={};attempted=set()
    def cached(*args):
        require(args not in attempted or args in values,'original evidence prior read failed; no retry')
        if args not in values:
            attempted.add(args)
            values[args]=read(*args)
        return values[args]
    return cached


def preflight_clock_source(driver, identity, metadata_reader, options, clock_reader, evidence_reader):
    if getattr(options,'commit_clock_observation',False) is not True:return
    require(callable(clock_reader),'original focused clock log NOT_SUPPLIED')
    kwargs=dict(metadata_reader=metadata_reader,focused_log_reader=clock_reader)
    if evidence_reader is not None:kwargs['original_evidence_reader']=evidence_reader
    result=driver.commit_clock_ci.qualification(identity,**kwargs)
    require(type(result) is dict and result.get('source')==identity.get('commit')==driver.commit_clock.COMMIT_CLOCK_SOURCE
        and result.get('focusedOriginalLogVerified') is True and result.get('sourceOnlyEvidence') is True
        and result.get('runtimePermissionGranted') is False and result.get('pressureAuthorized') is False
        and result.get('independentFinality') is False,
        'original arm clock/source prequalification differs')
    if 'historyJob' in driver.commit_clock_ci.BINDING:
        require(result.get('historyOriginalExecutionVerified') is True and result.get('getterOriginalEvidenceVerified') is True,
                'original arm history/getter prequalification incomplete')
    if getattr(driver.commit_clock_ci,'BEFORE59_SOURCE',None) is not None and driver.commit_clock_ci.BINDING.get('source')==driver.commit_clock_ci.BEFORE59_SOURCE:
        require(result.get('before59OriginalEquivalenceVerified') is True,
                'original before59 equivalence prequalification incomplete')


def clock_log_reader_for_arm(label, driver, arm, options):
    """Transport sole-collected bytes; source and job authority remain frozen in each driver."""
    enabled=getattr(options,'commit_clock_observation',False)
    require(type(enabled) is bool,'clock observation option must be boolean')
    if not enabled:return None
    require(type(CLOCK_LOG_BINDING) is dict and set(CLOCK_LOG_BINDING)==set(reader.ARMS)
            and label in reader.ARMS,'both original clock log arm bindings NOT_SUPPLIED')
    entry=CLOCK_LOG_BINDING[label]
    require(type(entry) is dict and set(entry)=={'source','tools','run','job','attempt','sha256','path'}
            and entry['source']==arm['source'] and entry['tools']==arm['tools']
            and all(type(entry[key]) is int and entry[key]>0 for key in ('run','job','attempt')),
            'original clock log arm source/Tools binding differs')
    require(getattr(options,'commit_clock_ci_original_log',None) is None
            and 'clock_original_log_reader' in inspect.signature(driver.run).parameters,
            'original clock log callback ABI NOT_SUPPLIED or ambiguous')
    ci=driver.commit_clock_ci
    require(ci.BINDING is not None and ci.LOG_REQUIREMENTS is not None
            and driver.commit_clock.COMMIT_CLOCK_SOURCE==entry['source'],
            'original clock source and job evidence NOT_SUPPLIED')
    ci.original_log_identity(ci.BINDING,ci.LOG_REQUIREMENTS)
    require(all(entry[key]==ci.LOG_REQUIREMENTS[key] for key in ('source','run','job','attempt','sha256')),
            'original clock source/job/log binding differs')
    return cached_original_reader(ci.retained_original_log_reader(entry['path'],driver.commit_clock.read_original))


def clock_evidence_reader_for_arm(label, driver, arm, options):
    """Transport original frozen arm files; never infer CI authority from paths."""
    if getattr(options,'commit_clock_observation',False) is not True:return None
    ci=driver.commit_clock_ci
    if ci.BINDING is None or 'historyJob' not in ci.BINDING:return None
    require(type(CLOCK_EVIDENCE_BINDING) is dict and set(CLOCK_EVIDENCE_BINDING)==set(reader.ARMS)
            and label in reader.ARMS and ci.ORIGINAL_EVIDENCE_REQUIREMENTS is not None
            and 'clock_original_evidence_reader' in inspect.signature(driver.run).parameters,
            'original same-arm history/getter evidence NOT_SUPPLIED')
    entry=CLOCK_EVIDENCE_BINDING[label]; required=ci.ORIGINAL_EVIDENCE_REQUIREMENTS
    fields={'source','tools','run','attempt','historyJob','getterJob','historyArtifact','getterArtifact',
            'historyLogPath','historyArchivePath','getterArchivePath'}
    require(type(entry) is dict and set(entry)==fields and entry['source']==arm['source']
            and entry['tools']==arm['tools'] and entry['source']==ci.BINDING['source']
            and all(type(entry[k]) is int and entry[k]>0 and entry[k]==required.get(k)
                    for k in ('run','attempt','historyJob','getterJob','historyArtifact','getterArtifact'))
            and len({entry[k] for k in ('historyLogPath','historyArchivePath','getterArchivePath')})==3
            and all(type(entry[k]) is str and Path(entry[k]).is_absolute() for k in ('historyLogPath','historyArchivePath','getterArchivePath')),
            'original same-arm history/getter binding differs')
    entry=dict(entry)  # Freeze this arm's reviewed source and path tuple.
    attempted=set()
    def read(kind,run,job,artifact,attempt):
        require(kind in ('history','getter') and kind not in attempted,'original evidence already attempted or unknown')
        attempted.add(kind)
        require(type(run) is int and type(job) is int and type(artifact) is int and type(attempt) is int
                and (run,job,artifact,attempt)==(entry['run'],entry[kind+'Job'],entry[kind+'Artifact'],entry['attempt']),
                'original evidence callback identity differs')
        if kind=='history':
            return (driver.commit_clock.read_original(entry['historyLogPath'],128*1024*1024),
                    driver.commit_clock.read_original(entry['historyArchivePath'],128*1024*1024))
        return driver.commit_clock.read_original(entry['getterArchivePath'],128*1024*1024)
    return cached_original_reader(read)


def validate_binding(binding):
    reader.fields(binding, 'schema arms', 'frozen pair binding')
    require(binding['schema'] == 'YNX-PERF-ORIGINAL-PAIR-BINDING/v1'
            and type(binding['arms']) is dict and set(binding['arms']) == set(reader.ARMS),
            'both original frozen source/Tools arms required')
    if CLOCK_LOG_BINDING is not None:
        require(type(CLOCK_LOG_BINDING) is dict and set(CLOCK_LOG_BINDING)==set(reader.ARMS)
                and all(type(CLOCK_LOG_BINDING[label]) is dict
                        and CLOCK_LOG_BINDING[label].get('source')==binding['arms'][label]['source']
                        and CLOCK_LOG_BINDING[label].get('tools')==binding['arms'][label]['tools']
                        for label in reader.ARMS),
                'original clock log pair arm identities differ')
    configurations = {arm: configuration(value) for arm, value in binding['arms'].items()}
    conditions = [reader.configuration_conditions(config, dict(toolsCI=dict(
        run=config['toolsRun'], job=binding['arms'][arm]['toolsCI']['job'],
        source=config['tools'], conclusion='success')))[0] for arm, config in configurations.items()]
    require(same(*conditions), 'original pair conditions differ outside exact source/Tools provenance')
    return configurations


def probe_original_ports():
    """Probe the original fixed loopback ports without retaining any socket."""
    sockets = []
    primary = None
    close_error = None
    try:
        for base in (31656, 31757, 31858):
            for offset in range(4):
                sock = socket.socket()
                sockets.append(sock)  # Register before bind so failure closes it too.
                sock.bind(('127.0.0.1', base+offset))
    except BaseException as error:
        primary = error
    finally:
        for sock in sockets:
            try:
                sock.close()
            except BaseException as error:
                if close_error is None: close_error = error
    if close_error is not None:
        # Do not retry a busy port if even one probe socket may still be held.
        raise RuntimeError('original port probe socket cleanup failed') from (primary or close_error)
    if primary is not None:
        raise primary


class FreshAdmission:
    """Use original guards including retained first-arm bytes, never node-only RSS."""
    def __init__(self, lab, parent):
        self.lab, self.parent, self.samples, self.port_observations = lab, parent, [], []

    def __call__(self, paths):
        lab = self.lab
        paths = bridge.roots(paths)
        started = time.monotonic()
        deadline = started + 65.0
        attempts = 0
        last_busy = None
        def record(status, observed=None):
            observed = time.monotonic() if observed is None else observed
            event = dict(schema='YNX-PAIR-PORT-READINESS/v1', status=status,
                attempts=attempts, elapsedNs=int((observed-started)*1_000_000_000),
                acceptanceDeadlineNs=65_000_000_000)
            self.port_observations.append(event)
            try:
                print(json.dumps(event), flush=True)
            except (OSError, ValueError):
                # Keep the original error and the producer's public record.
                pass
            return event
        def reject_expired(observed=None):
            observed = time.monotonic() if observed is None else observed
            if observed >= deadline:
                record('BUSY_TIMEOUT' if last_busy is not None else 'ADMISSION_TIMEOUT', observed)
                if last_busy is not None:
                    raise last_busy
                raise TimeoutError('original pair port readiness deadline exceeded')
        while True:
            reject_expired()
            rows, _ = lab.guard.proc_inventory()
            memory, free = lab.guard.memory_available(), shutil.disk_usage(self.parent).free
            heavy = lab.heavy_processes(rows)
            lab.admit(memory, free, heavy)
            ids = lab.guard.owned_set(rows, os.getpid())
            require(ids == [os.getpid()], 'original owned child remains before pair admission')
            rss = sum(lab.owned_rss(pid, rows[pid]) for pid in ids)
            physical = sum(lab.private_bytes(path) for path in paths)
            require(rss <= lab.CAPS['rssBytes'] and physical <= lab.CAPS['newBytes'],
                    'original retained roots or owned RSS exceeds unchanged cap')
            reject_expired()
            attempts += 1
            try:
                probe_original_ports()
            except OSError as error:
                if error.errno != errno.EADDRINUSE:
                    record('PROBE_ERROR')
                    raise
                last_busy = error
                reject_expired()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    reject_expired()
                time.sleep(min(1.0, remaining))
                continue
            accepted = time.monotonic()
            reject_expired(accepted)
            elapsed_ns = record('READY', accepted)['elapsedNs']
            self.samples.append(dict(availableMemoryBytes=memory, freeDiskBytes=free,
                ownedRSSBytes=rss, retainedPhysicalBytes=physical, roots=[str(path) for path in paths],
                portReadinessAttempts=attempts, portWaitNs=elapsed_ns))
            # The unchanged original driver probes these same ports again and
            # checks its deadline before any original Window or transaction.
            return


class RevalidatedArm(bridge.OriginalDriverAdapter):
    """Refresh original qualification and admission without credentials in env."""
    def __init__(self,*args,deadline_check,**kwargs):
        require(callable(deadline_check),'original pair deadline check required')
        self._deadline_check = deadline_check
        super().__init__(*args,**kwargs)

    def port_readiness(self):
        require(isinstance(self._admission, FreshAdmission), 'original pair admission observer required')
        return copy.deepcopy(self._admission.port_observations)

    def execute(self, register_work):
        require(not any(key in os.environ for key in ('GH_TOKEN', 'GITHUB_TOKEN')),
                'original metadata credential may not enter a subprocess environment')
        # Producer prequalifies BOTH arms before the first Window. Check the
        # second arm again after the first finishes; never reuse old permission.
        self.qualify()
        self.admit(self.retained_roots)
        self._deadline_check()
        return super().execute(register_work)


def active_pair(environment, api, configurations):
    require(environment.get('YNX_HELD_DISPATCH_PROFILE') == PROFILE,
            'explicit original sequential-pair profile required')
    run_id = reader.positive(int(environment['GITHUB_RUN_ID']))
    controller = reader.pin(environment['GITHUB_SHA'], 40)
    run = api.read('runs/'+str(run_id))
    jobs = api.read('runs/'+str(run_id)+'/attempts/1/jobs?per_page=100')
    require(run.get('id') == run_id and run.get('head_sha') == controller
            and run.get('head_branch') == reader.BRANCH and run.get('event') == 'workflow_dispatch'
            and type(run.get('run_attempt')) is int and run['run_attempt'] == 1
            and run.get('path') == WORKFLOW and run.get('status') == 'in_progress'
            and run.get('repository', {}).get('full_name') == REPOSITORY,
            'active original pair workflow differs')
    require(type(jobs.get('jobs')) is list and type(jobs.get('total_count')) is int
            and jobs['total_count'] == len(jobs['jobs']) <= 100, 'complete bounded original job metadata required')
    matched = [job for job in jobs['jobs'] if job.get('name') == reader.JOB]
    require(len(matched) == 1, 'one original sequential-pair job required')
    job = matched[0]
    require(job.get('run_id') == run_id and type(job.get('run_attempt')) is int
            and job['run_attempt'] == 1 and job.get('head_sha') == controller
            and job.get('status') == 'in_progress' and job.get('runner_name') == environment.get('RUNNER_NAME'),
            'actual original pair runner identity differs')
    pair = dict(schema=reader.SCHEMA, controllerCommit=controller, runID=run_id,
        jobID=reader.positive(job['id']), runAttempt=1, runnerID=reader.positive(job['runner_id']),
        runnerName=job['runner_name'], clock=producer.identity(), arms=[])
    pair['pairID'] = reader.digest(producer.encode(dict(context=pair, configurations=configurations)))
    producer.hosted(pair, environment)
    return pair


def prepare(binding, environment, api):
    """Build qualified adapters before workdirs, keys or runtime children exist.

    Read-only git/toolchain qualification subprocesses retain the normal entry.
    """
    execution_started = time.monotonic()
    configurations = validate_binding(binding)
    require(not any(key in os.environ for key in ('GH_TOKEN', 'GITHUB_TOKEN')),
            'metadata credential must be removed before original Git/Go qualification')
    pair = active_pair(environment, api, configurations)
    workspace = Path(environment['GITHUB_WORKSPACE']).resolve(strict=True)
    parent = Path(environment['RUNNER_TEMP']).resolve(strict=True)
    controller = workspace/'controller'
    require(controller_root(__file__) == controller, 'original pair controller checkout path required')
    checkout(controller, pair['controllerCommit'])
    go = shutil.which('go')
    require(go is not None, 'original pinned Go toolchain missing')
    storage = bridge.roots((workspace, parent, Path(go).resolve(strict=True).parent.parent))
    plans, adapters = {}, {}
    for label in reader.ARMS:
        arm = copy.deepcopy(binding['arms'][label])
        source, tools = workspace/('source-'+label), workspace/('tools-'+label)
        config = configurations[label]
        plan = dict(configuration=config, configurationSHA256=reader.digest(producer.encode(config)), runtimePlanSHA256=None)
        plans[label] = producer.encode(plan)
        checkout(source, arm['source'], arm['sourceTree']); checkout(tools, arm['tools'], arm['toolsTree'])
        clock_enabled=config['options'].get('commit_clock_observation',False) is True
        if clock_enabled:
            require({'pq-normal-live-reader.py','pq-7c25-native-source-dependencies.py',
                     'pq-commit-clock-source-qualification.py','pq-commit-clock-readback.py',
                     'pq-experimental-owner-pidfd.py'} <= set(arm['toolPins']),
                    'original clock qualification/readback/process tool pins NOT_SUPPLIED')
        verify_tool_files(tools, arm['toolPins'])
        driver = module('same_runner_original_'+label, tools/'scripts/loadtest/pq-independent-load.py')
        require('source_metadata_reader' in inspect.signature(driver.run).parameters,
                'original held metadata-only transport ABI NOT_SUPPLIED; no environment fallback')
        if callable(getattr(driver,'select_held_source',None)):
            gate=driver.select_held_source(arm['source'])
        else:
            require(not clock_enabled and (driver.HELD_TRIAL_SOURCE,driver.HELD_TRIAL_TREE)==(arm['source'],arm['sourceTree']),
                    'original legacy driver cannot accept clock source evidence')
            gate=driver.held_first_trial_source
        require('metadata_reader' in inspect.signature(gate.qualification).parameters
                and (gate.SOURCE,gate.TREE)==(arm['source'],arm['sourceTree']),
                'original driver source qualification differs; no pin mutation permitted')
        is_before=gate is getattr(driver,'before59_held_source',None)
        if clock_enabled and driver.commit_clock_ci.BINDING is not None and getattr(driver.commit_clock_ci,'BEFORE59_SOURCE',None) is not None and driver.commit_clock_ci.BINDING.get('source')==driver.commit_clock_ci.BEFORE59_SOURCE:
            require('pq-before59-equivalence-readback.py' in arm['toolPins'],
                    'original before59 equivalence evidence tool pin NOT_SUPPLIED')
        if clock_enabled and driver.commit_clock_ci.BINDING is not None and 'historyJob' in driver.commit_clock_ci.BINDING:
            require({'pq-source-evidence-archive.py','pq-source-history-readback.py','pq-getter-source-readback.py'} <= set(arm['toolPins']),
                    'original history/getter evidence tool pins NOT_SUPPLIED')
        if is_before:
            require(clock_enabled and 'focused_log_reader' in inspect.signature(gate.qualification).parameters
                    and 'pq-before59-held-source.py' in arm['toolPins']
                    and driver.commit_clock_ci.BINDING is not None and driver.commit_clock_ci.LOG_REQUIREMENTS is not None
                    and gate.BINDING==gate.clock.BINDING==driver.commit_clock_ci.BINDING
                    and gate.clock.LOG_REQUIREMENTS==driver.commit_clock_ci.LOG_REQUIREMENTS,
                    'original before59 held source and log gate NOT_SUPPLIED')
            require(type(BEFORE59_COMPOSITION_BINDING) is dict and label in BEFORE59_COMPOSITION_BINDING
                    and {'pq-before59-composition-readback.py','pq-source-evidence-archive.py'} <= set(arm['toolPins']),
                    'original before59 Tools source-build evidence NOT_SUPPLIED')
            composition_binding=copy.deepcopy(BEFORE59_COMPOSITION_BINDING[label])
            require(type(composition_binding) is dict and composition_binding.get('source')==arm['source']
                    and composition_binding.get('tools')==arm['tools'] and composition_binding.get('run')==arm['toolsCI']['run']
                    and type(composition_binding.get('job')) is int and composition_binding['job']>0
                    and type(composition_binding.get('path')) is str,
                    'frozen before59 Tools source-build arm differs')
            composition_readback=module('before59_tools_composition_'+label,tools/'scripts/loadtest/pq-before59-composition-readback.py')
            composition_readback.validate_binding(composition_binding)
            require(composition_binding['job']!=arm['toolsCI']['job'], 'before59 Tools composition job must be distinct')
            composition_raw=cached_original_reader(lambda path=composition_binding['path'],clock=driver.commit_clock:
                clock.read_original(path,32<<20))
            def check_composition(binding=composition_binding,readback=composition_readback,raw=composition_raw):
                job=api.read('jobs/'+str(binding['job']))
                inventory=api.read('runs/'+str(binding['run'])+'/artifacts?per_page=100')
                readback.validate_metadata(binding,job,inventory)
                return readback.inspect(binding,job,inventory,raw(),strict=reader.strict)
        tools_ci = verify_tools_ci(arm['toolsCI'], api.read('runs/'+str(arm['toolsCI']['run'])),
                                  api.read('jobs/'+str(arm['toolsCI']['job'])),clock_observation=clock_enabled)
        record = dict(plan, controllerCommit=pair['controllerCommit'], toolsCI=tools_ci)
        if is_before:record['before59OriginalToolBuild']=check_composition()
        options = argparse.Namespace(**dict(config['options'], source=str(source), execute=True))
        clock_reader=clock_log_reader_for_arm(label,driver,arm,options)
        evidence_reader=clock_evidence_reader_for_arm(label,driver,arm,options)

        def qualify(arm=arm, source=source, tools=tools, driver=driver, gate=gate, is_before=is_before, record=record,
                    clock_enabled=clock_enabled, options=options, clock_reader=clock_reader, evidence_reader=evidence_reader,
                    check_composition=check_composition if is_before else None):
            checkout(controller, pair['controllerCommit'])
            checkout(source, arm['source'], arm['sourceTree']); checkout(tools, arm['tools'], arm['toolsTree'])
            verify_tool_files(tools, arm['toolPins'])
            require(git(source, 'rev-parse', arm['supplier']+':third_party/cometbft') == arm['supplierTree'],
                    'immutable original supplier object differs')
            require(subprocess.check_output([go, 'env', 'GOVERSION'], cwd=source, timeout=10, text=True).strip() == arm['go'],
                    'fixed original Go toolchain differs')
            identity = driver.lab.check_source(source, arm['source'])
            require(identity['tree'] == arm['sourceTree'], 'original source identity differs')
            if is_before:
                require(same(check_composition(),record['before59OriginalToolBuild']),
                        'original before59 Tools source-build evidence changed')
            source_ci = arm['sourceQualification']
            source_options=dict(metadata_reader=api.read)
            if is_before:source_options['focused_log_reader']=clock_reader
            require(same(gate.qualification(**source_options), source_ci),
                    'original source qualification failed; candidate Tools CI is insufficient')
            preflight_clock_source(driver,identity,api.read,options,clock_reader,evidence_reader)
            require(same(verify_tools_ci(arm['toolsCI'], api.read('runs/'+str(arm['toolsCI']['run'])),
                         api.read('jobs/'+str(arm['toolsCI']['job'])),clock_observation=clock_enabled), record['toolsCI']),
                    'original Tools CI changed before admission')
            return copy.deepcopy(record)

        def deadline_check(label=label):
            pair_time_budget(api.read('jobs/'+str(pair['jobID'])),pair,
                             2 if label == 'before' else 1,execution_started)
        adapters[label] = RevalidatedArm(driver, options, record, source_metadata_reader=api.read,
            clock_original_log_reader=clock_reader,clock_original_evidence_reader=evidence_reader,
            deadline_check=deadline_check,
            verify_qualification=qualify, admit=FreshAdmission(driver.lab, parent), storage_roots=storage)
    return dict(pair=pair, plans=plans, adapters=adapters,
                output=parent/('pq-same-runner-pair-%d-%d'%(pair['runID'], pair['jobID'])))


def execute():
    context = {}
    def factory(binding):
        token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        # Remove from the process before ANY git/Go child. Only the bounded
        # metadata GET reader retains it; no environment restoration/fallback.
        os.environ.pop('GH_TOKEN', None); os.environ.pop('GITHUB_TOKEN', None)
        context.update(prepare(binding, os.environ, ActionsMetadata(token)))
        return context['adapters']
    adapters = bridge.configured_adapters(factory)  # None refuses before even reading host paths/metadata.
    def interrupted(signum, frame):
        raise RuntimeError('original sequential pair interrupted by signal '+str(signum))
    previous = {signum:signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGTERM)}
    try:
        for signum in previous: signal.signal(signum, interrupted)
        result = producer.run_pair(context['output'], pair=context['pair'], plans=context['plans'], adapters=adapters)
    finally:
        for signum, handler in previous.items(): signal.signal(signum, handler)
    require(result['status'] == 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS',
            'original pair incomplete; preserve intent, first cause and UNKNOWN without retry')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    if args.execute: return execute()
    return dict(schema='YNX-PERF-PAIR-CONTROLLER-CANDIDATE/v1', profile=PROFILE,
        configured=bridge.QUALIFIED_PAIR_BINDING is not None, runtimePermissionGranted=False,
        workflow=WORKFLOW, jobKey='first100-held-public-owner', jobName=reader.JOB,
        originalSingleArmProfilesUnchanged=True, freshAccountsAndWorkdirsPerArm=True,
        missing=['two frozen source/Tools/CI arms', 'original workflow profile/checkout/upload wiring',
                 'Root dispatch authorization'], originalOperationsReplayed=False)


if __name__ == '__main__':
    print(json.dumps(main(), sort_keys=True))
