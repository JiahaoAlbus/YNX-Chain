"""Sequential pair coordinator candidate; no execution CLI or source grant.

The owning controller must bind BOTH original qualified source/Tools adapters,
the real hosted job, unchanged resource caps and Root's dispatch authorization.
Adapters expose qualification_record(), qualify(), admit(retained_roots), execute(register_work), and
retire(). register_work runs once at the original Window boundary, before keys
or children. retire always runs and returns that Window's original child records
(pid/startTicks/process), after stopping only its owned work. It must preserve
the original receipt and workers' retirement evidence. No environment, source
pin, existing single-window guard, account, nonce or password is patched here.

run_pair writes a durable one-use intent and public payloads. After the workflow
uploads before/after payloads separately, seal_manifest consumes their actual
Actions metadata/digests and writes the manifest payload. The workflow then
uploads that payload. Local ZIPs are NOT substituted for Actions artifact ZIPs.
The reader verifies the downloaded originals independently afterwards.
qualify() must return the exact qualification_record() only after its real source
and CI checks pass. Upload output/{before,after}/** separately, without enclosing
ZIPs or private directories, then output/manifest/**. Preserve INCOMPLETE output
and make the owning workflow fail; a local return is not success or permission.
admit() must enforce the unchanged owned-byte/RSS/process floors over all supplied
roots; it is called again after copying public payloads so archive staging is not
outside resource accounting. Refusals raise; successful checks return None.
"""
import argparse
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import zipfile


spec = importlib.util.spec_from_file_location('same_runner_reader', Path(__file__).with_name('pq-same-runner-pair-readback.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
require, strict, sha = reader.require, reader.strict, reader.digest


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def write_new(path, value):
    raw = value if type(value) is bytes else encode(value)
    with Path(path).open('xb') as target:
        os.chmod(path, 0o600)
        target.write(raw); target.flush(); os.fsync(target.fileno())


def identity():
    """Actual original Linux coordinator identity, not an environment assertion."""
    require(sys.platform == 'linux', 'original Linux coordinator required')
    boot = reader.bounded('/proc/sys/kernel/random/boot_id', 128).strip()
    stat = reader.bounded('/proc/self/stat', 16384).decode().rpartition(')')[2].split()
    require(len(stat) > 19 and stat[19].isdigit(), 'original coordinator start ticks missing')
    return dict(kind='CLOCK_MONOTONIC', bootIDSHA256=sha(boot), coordinatorPID=os.getpid(),
                coordinatorStartTicks=reader.positive(int(stat[19])))


def hosted(pair, environment):
    required = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
        GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain', GITHUB_EVENT_NAME='workflow_dispatch',
        GITHUB_JOB='first100-held-public-owner', GITHUB_REF='refs/heads/'+reader.BRANCH,
        GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=pair['controllerCommit'],
        GITHUB_WORKFLOW_SHA=pair['controllerCommit'], GITHUB_RUN_ID=str(pair['runID']),
        RUNNER_NAME=pair['runnerName'],
        GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/.github/workflows/pq-normal-process.yml@refs/heads/'+reader.BRANCH)
    require(sys.platform == 'linux' and all(environment.get(k) == v for k, v in required.items()),
            'original first-attempt hosted pair context required')
    for key in ('runID', 'jobID', 'runAttempt', 'runnerID'):
        reader.positive(pair[key])
    require(pair['runAttempt'] == 1 and pair['schema'] == reader.SCHEMA and not pair['arms']
            and pair['clock'] == identity(), 'original pair coordinator context differs')
    reader.pin(pair['pairID']); reader.pin(pair['controllerCommit'], 40)


def public_files(work):
    """Snapshot stopped PUBLIC regular files only; never delete private state."""
    public = work/'public'
    require(public.resolve(strict=True) == public, 'original public directory alias refused')
    files, total = {}, 0
    for path in sorted(public.rglob('*')):
        require(not path.is_symlink() and not any(p.startswith('.') for p in path.relative_to(public).parts),
                'public symlink or hidden entry refused')
        if path.is_dir(): continue
        require(path.is_file() and len(files) < 8190, 'bounded original regular public files required')
        before = path.stat()
        raw = public_bytes(path)
        after = path.stat()
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                'original public file changed during snapshot')
        total += len(raw)
        require(total <= 256 << 20, 'original public snapshot exceeds bound')
        files[f'{work.name}/public/{path.relative_to(public).as_posix()}'] = raw
    return files


def public_bytes(path):
    with Path(path).open('rb') as stream: raw = stream.read((8 << 20) + 1)
    require(len(raw) <= 8 << 20, 'original public file exceeds bound')
    return raw # Empty original logs are retained, never filled or discarded.


def inventory(files):
    return {name: dict(bytes=len(raw), sha256=sha(raw)) for name, raw in files.items()}


def copy_payload(destination, files):
    destination.mkdir(mode=0o700)
    for relative, raw in files.items():
        path = destination/relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        write_new(path, raw)
    return inventory(files)


def retired(receipt, children, threads_before):
    reader.clean_processes(receipt)
    require(receipt.get('resourceObserverRetired') is True, 'original resource observer did not retire')
    expected = {(p['pid'], p['startTicks']): p for p in receipt['processes']}
    observed = set()
    for child in children:
        key = child['pid'], child['startTicks']
        require(key in expected and key not in observed and child['process'].pid == child['pid'],
                'original owned child handle differs')
        code = child['process'].poll()
        require(type(code) is int and code == expected[key]['rawReturnCode'],
                'original child has not exited with its recorded result')
        observed.add(key)
    require(observed == set(expected), 'complete original owned child handles required')
    require(not [t for t in threading.enumerate() if t not in threads_before and t.is_alive()],
            'new original worker remains alive; no second arm')


def failure(error):
    # Public receipt first causes remain in original bytes. Arbitrary adapter
    # exceptions may contain credentials; preserve their type/hash, not text.
    return dict(errorType=type(error).__name__, errorSHA256=sha(str(error).encode()))


def validate_payload(files, declaration, pair, expected):
    """Local structural validation only; this ZIP is never an Actions original."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in files.items(): archive.writestr(name, raw)
    raw = output.getvalue()
    return reader.arm_read(raw, declaration['arm'], dict(declaration, archive=dict(bytes=len(raw), sha256=sha(raw))),
                           pair, expected)


def run_pair(output, *, pair, plans, adapters, environment=None, clock=time.monotonic_ns):
    """Execute each supplied owning adapter at most once; never retry a failed arm.

    This library boundary does not qualify adapters. No default/runtime adapter
    exists here. The controller owner must wire original source/CI/admission and
    own-Window cleanup before a Root-authorized hosted workflow can call it.
    """
    environment = os.environ if environment is None else environment
    hosted(pair, environment)
    require(set(plans) == set(adapters) == set(reader.ARMS), 'both frozen original adapters required')
    comparable, qualifications = [], {}
    for arm in reader.ARMS:
        plan = strict(plans[arm])
        config = plan['configuration']
        require(sha(encode(config)) == plan['configurationSHA256'] and plan['runtimePlanSHA256'] is None,
                'original configuration bytes differ')
        required = dict(mode='online', rate=100, seconds=5, tail_seconds=30, accounts=500,
            per_account=1, initialize_before_load=True, initialization_only=False,
            staged_publication=True, sender_backend='public-owner', held_ready_only=False,
            prior_result=None, prior_result_sha256=None, proof_timeout=30,
            first_trial_profile='held-first100', startup_timings=True, wire_observation=True,
            commit_observation=True, network_accounting=True, owned_storage_accounting=True,
            header_hop_capture=False, execute=False)
        require(config['profile'] == 'first100-held-public-owner' and config['nodeCount'] == 4
                and config['pressureLevel'] == 1 and all(k in config['options']
                    and type(config['options'][k]) is type(v) and config['options'][k] == v
                    for k, v in required.items()), 'original bounded full500 fresh initialization options required')
        qualifications[arm] = copy.deepcopy(adapters[arm].qualification_record())
        comparable.append(reader.configuration_conditions(config, qualifications[arm])[0])
    require(comparable[0] == comparable[1], 'pair load/sampling/caps/business conditions differ')
    output = Path(output)
    require(output.is_absolute() and output.parent.resolve(strict=True) == output.parent,
            'canonical new producer output required')
    # Existing intents, including interrupted/UNKNOWN ones, are never resumed.
    output.mkdir(mode=0o700)
    write_new(output/'INTENT.json', dict(schema='YNX-PERF-SAME-RUNNER-INTENT/v1', pair=pair,
        status='RESULT_UNKNOWN_NO_RETRY', configuredDemandPerArm=500))
    result = dict(schema='YNX-PERF-SAME-RUNNER-PRODUCER/v1', status='INCOMPLETE', pair=copy.deepcopy(pair),
        arms=[], firstCause=None, secondaryFailures=[], runtimeQualified=False,
        pressureAuthorized=False, unknownReplayed=False, originalDirectoriesPreserved=True)
    retained, validated = [output], []
    try:
        for arm in reader.ARMS:
            require(adapters[arm].qualify() == qualifications[arm],
                    'original qualified source/Tools/CI record differs') # Before either Window.
        for arm in reader.ARMS:
            adapter = adapters[arm]
            require(adapter.admit(tuple(retained)) is None,
                    'original admission must raise on refusal, not return an unchecked value')
            started = reader.positive(clock())
            require(not validated or started > validated[-1]['end'], 'second arm precedes original cleanup')
            write_new(output/(arm+'-INTENT.json'), dict(arm=arm, startedMonotonicNs=started,
                status='RESULT_UNKNOWN_NO_RETRY', configurationSHA256=strict(plans[arm])['configurationSHA256']))
            registered = []
            def register(work):
                path = Path(work)
                require(not registered and path.is_absolute() and path.resolve(strict=True) == path
                        and path.parent == Path(environment['RUNNER_TEMP']).resolve(strict=True)
                        and re.fullmatch(r'pq-independent-load-[A-Za-z0-9_-]{6,64}', path.name)
                        and path not in retained, 'one fresh original work directory required')
                require((path/'.private').resolve(strict=True) == path/'.private'
                        and (path/'public').resolve(strict=True) == path/'public'
                        and (path/'.private').is_dir() and not list((path/'.private').iterdir())
                        and (path/'public').is_dir()
                        and not (path/'public/receipt.json').exists()
                        and not (path/'public/load-plan.json').exists(), 'original work already contains operation state')
                registered.append(path); retained.append(path)
                write_new(output/(arm+'-REGISTERED.json'), dict(arm=arm, originalDirectory=str(path)))
            threads_before = set(threading.enumerate())
            primary, children = None, None
            try:
                adapter.execute(register)
            except BaseException as error:
                primary = error
            finally:
                try: children = adapter.retire()
                except BaseException as error:
                    if primary is None: primary = error
                    else: result['secondaryFailures'].append(failure(error))
            if primary is not None: result['firstCause'] = failure(primary)
            require(len(registered) == 1, 'original Window registration missing; preserve intent')
            work = registered[0]
            originals = public_files(work)
            prefix = work.name+'/public/'
            receipt = strict(originals[prefix+'receipt.json']) if prefix+'receipt.json' in originals else None
            arm_state = dict(arm=arm, originalDirectory=str(work), firstCause=receipt.get('firstCause') if receipt else None,
                             executionFailure=failure(primary) if primary else None)
            result['arms'].append(arm_state)
            # Even failed/incomplete arms get immutable PUBLIC payloads; no pair
            # marker is manufactured when cleanup or the original receipt is absent.
            originals['pq-first100-held-plan.json'] = plans[arm]
            try:
                require(primary is None, 'original arm execution or retirement raised')
                require(receipt is not None, 'original arm receipt missing')
                retired(receipt, children, threads_before)
                require(receipt.get('firstCause') is None and receipt['loadResult'].get('firstCause') is None,
                        'original arm first cause blocks successor; retain UNKNOWN')
                ended = reader.positive(clock())
                require(started < ended, 'original arm clock did not advance')
                marker = dict(schema=reader.MARKER, arm=arm, workDirectoryName=work.name,
                    **{k: copy.deepcopy(pair[k]) for k in ('pairID', 'runID', 'jobID', 'runAttempt', 'controllerCommit', 'clock')},
                    startedMonotonicNs=started, cleanupCompletedMonotonicNs=ended)
                for key, filename in (('receipt', 'receipt.json'), ('loadPlan', 'load-plan.json')):
                    path = prefix+filename
                    marker[key] = dict(path=path, **inventory({path: originals[path]})[path])
                marker_path = prefix+'SAME-RUNNER-ARM.json'
                require(marker_path not in originals, 'original pair marker already exists')
                originals[marker_path] = encode(marker)
                declaration = dict(arm=arm, source=receipt['source'], tools=receipt['toolIdentity'],
                    configurationSHA256=strict(plans[arm])['configurationSHA256'],
                    marker=dict(path=marker_path, **inventory({marker_path: originals[marker_path]})[marker_path]))
                checked = validate_payload(originals, declaration, pair, dict(source=receipt['source']['commit'],
                    tools=receipt['toolIdentity']['commit'], configurationSHA256=declaration['configurationSHA256']))
                if validated:
                    previous = validated[-1]
                    require(not previous['addresses'] & checked['addresses']
                            and not previous['operationIDs'] & checked['operationIDs']
                            and not previous['processes'] & checked['processes'],
                            'original arm accounts/operations/processes reused')
                    require(all(previous['plan'][k] != checked['plan'][k] for k in
                                ('networkPlanSHA256', 'workloadSHA256')), 'original arm inputs reused')
                validated.append(checked)
                arm_state['declaration'] = declaration
            except BaseException as error:
                arm_state['boundaryFailure'] = failure(error)
                primary = primary or error
            arm_state['payloadFiles'] = copy_payload(output/arm, originals)
            write_new(output/(arm+'-SEALED.json'), arm_state)
            try:
                require(adapter.admit(tuple(retained)) is None,
                        'post-copy original resource admission differs')
            except BaseException as error:
                if primary is None: primary = error
                else: result['secondaryFailures'].append(failure(error))
            if primary is not None:
                result['firstCause'] = arm_state['firstCause'] or failure(primary)
                break
        if result['firstCause'] is None and len(result['arms']) == 2 and all('declaration' in a for a in result['arms']):
            result['status'] = 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS'
    except BaseException as error:
        if result['firstCause'] is None: result['firstCause'] = failure(error)
        else: result['secondaryFailures'].append(failure(error))
    write_new(output/'PRODUCER.json', result)
    return result


def seal_manifest(output, metadata):
    """After original before/after uploads: use actual Actions ZIP digest/size."""
    output = Path(output)
    require(output.resolve(strict=True) == output, 'canonical original producer directory required')
    state = strict(reader.bounded(output/'PRODUCER.json', 8 << 20))
    require(state['status'] == 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS'
            and state['firstCause'] is None and [a['arm'] for a in state['arms']] == list(reader.ARMS),
            'both original arm payloads must be sealed')
    pair = copy.deepcopy(state['pair'])
    run, job, artifacts = metadata
    require(run['id'] == pair['runID'] and run['run_attempt'] == 1 and run['head_sha'] == pair['controllerCommit']
            and run['event'] == 'workflow_dispatch' and run['head_branch'] == reader.BRANCH
            and run['repository']['full_name'] == 'JiahaoAlbus/YNX-Chain'
            and run['path'] == '.github/workflows/pq-normal-process.yml'
            and job['id'] == pair['jobID'] and job['run_id'] == pair['runID'] and job['run_attempt'] == 1
            and job['head_sha'] == pair['controllerCommit'] and job['name'] == reader.JOB
            and job['runner_id'] == pair['runnerID'] and job['runner_name'] == pair['runnerName'],
            'original upload run/job/runner identity differs')
    ids = set()
    for arm in state['arms']:
        label = arm['arm']
        require((output/label).resolve(strict=True) == output/label, 'sealed payload directory alias refused')
        paths = list((output/label).rglob('*'))
        require(len(paths) <= 16384 and not any(p.is_symlink() for p in paths),
                'bounded sealed payload without aliases required')
        files = {p.relative_to(output/label).as_posix(): public_bytes(p)
                 for p in paths if p.is_file()}
        require(inventory(files) == arm['payloadFiles'], 'sealed original payload changed after upload')
        uploads = [s for s in job['steps'] if s['name'] == 'Preserve same-runner '+label+' originals']
        matches = [a for a in artifacts['artifacts'] if a['name'] == f"pq-first100-same-runner-{pair['runID']}-1-{label}"]
        require(len(uploads) == len(matches) == 1 and uploads[0]['conclusion'] == 'success',
                'original successful arm upload missing')
        artifact = matches[0]
        require(reader.positive(artifact['id']) not in ids and artifact['expired'] is False
                and artifact['workflow_run']['id'] == pair['runID']
                and artifact['workflow_run']['head_sha'] == pair['controllerCommit']
                and artifact['workflow_run']['head_branch'] == reader.BRANCH
                and 0 < reader.positive(artifact['size_in_bytes']) <= 128 << 20
                and artifact['digest'].startswith('sha256:'), 'original uploaded artifact identity differs')
        ids.add(artifact['id'])
        declaration = copy.deepcopy(arm['declaration'])
        declaration['archive'] = dict(bytes=artifact['size_in_bytes'], sha256=reader.pin(artifact['digest'][7:]))
        pair['arms'].append(declaration)
    destination = output/'manifest'
    destination.mkdir(mode=0o700)
    write_new(destination/'same-runner-pair.json', pair)
    return pair


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--seal-uploads', type=Path, required=True)
    parser.add_argument('--actions-metadata', type=Path, required=True)
    args = parser.parse_args(argv)
    metadata = [strict(reader.bounded(args.actions_metadata/name, 1 << 20))
                for name in ('RUN.json', 'JOB.json', 'ARTIFACTS.json')]
    return seal_manifest(args.seal_uploads, metadata)


if __name__ == '__main__':
    print(json.dumps(main(), sort_keys=True))
