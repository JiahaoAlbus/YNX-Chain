"""Sequential pair coordinator candidate; no execution CLI or source grant.

The owning controller must bind BOTH original qualified source/Tools adapters,
the real hosted job, unchanged resource caps and Root's dispatch authorization.
Adapters expose qualification_record(), qualify(), admit(retained_roots), execute(register_work), and
retire(). register_work runs once at the original Window boundary, before keys
or children. retire always runs and returns that Window's original child records
(pid/startTicks/process), after stopping only its owned work. It must preserve
the original receipt and workers' retirement evidence. No environment, source
pin, existing single-window guard, account, nonce or password is patched here.
The real adapter MUST propagate registration failures before starting any key or
child work. If an adapter violates this and swallows the exception, this library
can reject pair qualification and the next arm only after execute() returns; it
cannot undo or prevent effects inside that misbehaving adapter. The owning real
adapter still needs an injected fence-failure integration test before dispatch.

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
from contextlib import contextmanager
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
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


def write_new(path, value, *, expected_parent=None):
    raw = value if type(value) is bytes else encode(value)
    path = absolute_path(path)
    with directory_fd(path.parent) as parent:
        require(expected_parent is None or directory_identity(os.fstat(parent)) == expected_parent,
                'original fence directory replaced')
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=parent)
        try:
            opened = os.fstat(fd)
            require(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1, 'new single-link regular file required')
            offset = 0
            while offset < len(raw):
                written = os.write(fd, raw[offset:])
                require(written > 0, 'original file write did not advance')
                offset += written
            os.fsync(fd)
            os.fsync(parent) # The one-use intent's name must survive a crash too.
            final = os.fstat(fd)
            require(file_identity(final) == file_identity(os.stat(path.name, dir_fd=parent, follow_symlinks=False))
                    and final.st_nlink == 1 and final.st_size == len(raw), 'new file path changed during persistence')
        finally:
            os.close(fd)


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


def absolute_path(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts and len(path.parts) <= 128,
            'canonical bounded absolute path without escape required')
    return path


def directory_identity(value):
    return value.st_dev, value.st_ino, value.st_mode


def file_identity(value):
    return (*directory_identity(value), value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def check_directory(parent, name, fd, expected):
    actual = os.fstat(fd)
    path = os.stat(name, dir_fd=parent, follow_symlinks=False)
    require(stat.S_ISDIR(actual.st_mode) and directory_identity(actual) == directory_identity(expected)
            == directory_identity(path), 'original directory path was replaced or escaped')


@contextmanager
def directory_fd(path, create=False):
    """Keep every ancestor fd open; never resolve symlinks while walking names."""
    path = absolute_path(path)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptors, edges = [os.open(path.anchor, flags)], []
    try:
        for name in path.parts[1:]:
            parent = descriptors[-1]
            try: expected = os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                if not create: raise
                os.mkdir(name, mode=0o700, dir_fd=parent)
                os.fsync(parent)
                expected = os.stat(name, dir_fd=parent, follow_symlinks=False)
            require(stat.S_ISDIR(expected.st_mode), 'original directory alias or non-directory refused')
            child = os.open(name, flags, dir_fd=parent)
            descriptors.append(child)
            check_directory(parent, name, child, expected)
            edges.append((parent, name, child, expected))
        yield descriptors[-1]
        for edge in edges: check_directory(*edge)
    finally:
        for fd in reversed(descriptors): os.close(fd)


def mkdir_new(path):
    path = absolute_path(path)
    with directory_fd(path.parent) as parent:
        os.mkdir(path.name, mode=0o700, dir_fd=parent)
        expected = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        child = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            check_directory(parent, path.name, child, expected)
            os.fsync(parent) # Persist the output directory before creating any intent.
            check_directory(parent, path.name, child, expected)
            return directory_identity(os.fstat(child))
        finally:
            os.close(child)


def read_regular(parent, name, expected):
    require(stat.S_ISREG(expected.st_mode), 'original regular PUBLIC file required')
    require(expected.st_nlink == 1, 'original PUBLIC hard-link refused; single-link file required')
    # NONBLOCK prevents a swapped FIFO/device from blocking before fstat rejects it.
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
    try:
        opened = os.fstat(fd)
        require(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1
                and file_identity(opened) == file_identity(expected)
                == file_identity(os.stat(name, dir_fd=parent, follow_symlinks=False)),
                'original PUBLIC file replaced before read')
        require(opened.st_size <= 8 << 20, 'original public file exceeds bound')
        chunks, size = [], 0
        while size <= 8 << 20:
            chunk = os.read(fd, min(65536, (8 << 20) + 1 - size))
            if not chunk: break
            chunks.append(chunk); size += len(chunk)
        final = os.fstat(fd)
        require(file_identity(opened) == file_identity(final)
                == file_identity(os.stat(name, dir_fd=parent, follow_symlinks=False))
                and final.st_nlink == 1 and size == opened.st_size,
                'original PUBLIC file changed during read')
        return b''.join(chunks) # Empty original logs remain empty.
    finally:
        os.close(fd)


def snapshot_tree(root):
    files, total, entries = {}, 0, 0
    def walk(fd, prefix, depth):
        nonlocal total, entries
        require(depth <= 32, 'bounded PUBLIC directory depth required')
        before = os.fstat(fd)
        for name in sorted(os.listdir(fd)):
            entries += 1
            require(entries <= 16384 and name not in ('.', '..') and not name.startswith('.')
                    and '/' not in name and '\\' not in name, 'bounded public names without escape required')
            observed = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(observed.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                try:
                    check_directory(fd, name, child, observed)
                    walk(child, prefix+name+'/', depth+1)
                    check_directory(fd, name, child, observed)
                finally: os.close(child)
            else:
                require(len(files) < 8192, 'bounded original public files required')
                raw = read_regular(fd, name, observed)
                total += len(raw)
                require(total <= 256 << 20, 'original public snapshot exceeds bound')
                files[prefix+name] = raw
        require(file_identity(before) == file_identity(os.fstat(fd)), 'original PUBLIC directory changed during snapshot')
    with directory_fd(root) as fd: walk(fd, '', 0)
    return files


def public_files(work):
    """Snapshot stopped PUBLIC single-link regular files; preserve private state."""
    work = absolute_path(work)
    return {f'{work.name}/public/{name}': raw for name, raw in snapshot_tree(work/'public').items()}


def public_bytes(path):
    path = absolute_path(path)
    with directory_fd(path.parent) as parent:
        return read_regular(parent, path.name, os.stat(path.name, dir_fd=parent, follow_symlinks=False))


def inventory(files):
    return {name: dict(bytes=len(raw), sha256=sha(raw)) for name, raw in files.items()}


def copy_payload(destination, files):
    mkdir_new(destination)
    for relative, raw in files.items():
        path = destination/relative
        with directory_fd(path.parent, create=True): pass
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
    output_identity = mkdir_new(output)
    write_new(output/'INTENT.json', dict(schema='YNX-PERF-SAME-RUNNER-INTENT/v1', pair=pair,
        status='RESULT_UNKNOWN_NO_RETRY', configuredDemandPerArm=500), expected_parent=output_identity)
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
                status='RESULT_UNKNOWN_NO_RETRY', configurationSHA256=strict(plans[arm])['configurationSHA256']),
                expected_parent=output_identity)
            registered, registration_failures = [], []
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
                try:
                    write_new(output/(arm+'-REGISTERED.json'), dict(arm=arm, originalDirectory=str(path)),
                              expected_parent=output_identity)
                except BaseException as error:
                    registration_failures.append(error)
                    raise
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
            if registration_failures:
                if primary is not None and primary is not registration_failures[0]:
                    result['secondaryFailures'].append(failure(primary))
                primary = registration_failures[0] # No pair/successor qualification after a swallowed fence error.
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
            write_new(output/(arm+'-SEALED.json'), arm_state, expected_parent=output_identity)
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
    write_new(output/'PRODUCER.json', result, expected_parent=output_identity)
    return result


def seal_manifest(output, metadata):
    """After original before/after uploads: use actual Actions ZIP digest/size."""
    output = Path(output)
    require(output.resolve(strict=True) == output, 'canonical original producer directory required')
    state = strict(public_bytes(output/'PRODUCER.json'))
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
        files = snapshot_tree(output/label)
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
    mkdir_new(destination)
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
