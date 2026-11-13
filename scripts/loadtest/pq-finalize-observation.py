"""Validate the normal stopped-node FinalizeBlock timing projection."""
import re
import stat

VERSION = 'YNX-COMET-FINALIZE-OBSERVATION/v1'
BOUNDARY = 'owning-Application-FinalizeBlock-after-lock;after-opt-in;normal-stop-output;pre-bind-replay-not-covered'
PHASES = ('preflight', 'prepare', 'apply_transactions', 'seal', 'continuation', 'response')
CHILDREN = frozenset(('transaction.clone', 'transaction.accounts_materialize',
                      'seal.accounts_materialize', 'seal.fee_materialize', 'seal.hash', 'seal.validate'))


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def nonnegative(value):
    return type(value) is int and 0 <= value < 1 << 63


def validate(snapshot, *, pid, chain_id, genesis_hash):
    require((snapshot['version'], snapshot['scope'], snapshot['captureBoundary']) ==
            (VERSION, 'synthetic-loopback-lab/v1', BOUNDARY)
            and type(pid) is int and pid > 0 and snapshot['processID'] == pid
            and snapshot['chainID'] == chain_id and snapshot['originalGenesisHash'] == genesis_hash,
            'original Finalize producer identity differs')
    require(snapshot['lockWaitIncluded'] is False and snapshot['independentFinality'] is False
            and snapshot['unreportedStagesAreUnknown'] is True and snapshot['childrenOverlapParentPhases'] is True
            and snapshot['maxSamples'] == 128, 'original Finalize timing scope differs')
    observation = snapshot['observation']
    attempts, dropped, samples, latest = (observation[key] for key in ('attempts', 'dropped', 'samples', 'latest'))
    require(nonnegative(attempts) and nonnegative(dropped) and type(samples) is list
            and len(samples) == min(attempts, 128) and attempts == len(samples) + dropped
            and snapshot['captureComplete'] is (attempts > 0 and dropped == 0), 'original Finalize coverage differs')
    require((latest is None if attempts == 0 else type(latest) is dict and latest['attempt'] == attempts)
            and (not samples or dropped > 0 or latest == samples[-1]), 'original Finalize latest attempt differs')

    def check_sample(sample, attempt):
        phases, children = sample['phaseNs'], sample['childrenNs']
        elapsed, success, failed = sample['elapsedNs'], sample['success'], sample['failedPhase']
        require(type(sample['attempt']) is int and sample['attempt'] == attempt
                and type(sample['requestPresent']) is bool and type(sample['height']) is int
                and type(success) is bool and nonnegative(elapsed), 'original Finalize attempt differs')
        require(set(phases) == set(PHASES[:len(phases)]) and bool(phases)
                and all(nonnegative(value) for value in phases.values()) and sum(phases.values()) == elapsed,
                'Finalize parent stages must partition elapsed')
        require(children.keys() <= CHILDREN and all(nonnegative(value) for value in children.values()),
                'original Finalize child timings differ')
        if success:
            require(sample['requestPresent'] and sample['height'] > 0 and failed == ''
                    and set(phases) == set(PHASES) and re.fullmatch('[0-9a-f]{64}', sample['appHash']),
                    'original successful Finalize attempt differs')
        else:
            require(failed in phases.keys() | children.keys() and sample['appHash'] == '',
                    'failed Finalize attempt cannot inherit a successful AppHash')

    for attempt, sample in enumerate(samples, 1):
        check_sample(sample, attempt)
    if dropped:
        check_sample(latest, attempts)
    return observation


def business_heights(observation, heights, commit_samples):
    """Join successful observations by height and AppHash on one node."""
    committed = {sample['height']: sample['appHash'] for sample in commit_samples}
    selected = {}
    for row in observation['samples']:
        height = row['height']
        if row['success'] and height in heights and height in committed:
            require(height not in selected and row['appHash'] == committed[height],
                    'Finalize and Commit original AppHash or height differs')
            selected[height] = row
    return dict(samples=selected, missingHeights=sorted(set(heights)-selected.keys()),
                failedAttempts=[row for row in observation['samples'] if not row['success']],
                droppedAttempts=observation['dropped'])

def retain_after_stop(window, descriptors, chain_id, genesis_hash, public_io):
    records, errors = [], []
    for descriptor in descriptors:
        node = descriptor['node']
        try:
            child, = (row for row in window.children if row['name'] == descriptor['processName'])
            process = child['process']
            require(process.poll() is not None, 'original Finalize producer must have stopped')
            source = descriptor['path']
            require(stat.S_IMODE(source.lstat().st_mode) == 0o600, 'original Finalize output mode differs')
            raw = public_io.read_original(source, limit=512 << 10)
            target = window.work / 'public' / f'finalize-observation-node-{node}-original.json'
            public_io.write_new(target, raw)
            record = dict(node=node, pid=process.pid, path=target.name, bytes=len(raw), sha256=public_io.sha(raw),
                          complete=False)
            records.append(record)
            snapshot = public_io.strict(raw)
            validate(snapshot, pid=process.pid, chain_id=chain_id, genesis_hash=genesis_hash)
            record['complete'] = snapshot['captureComplete']
        except (KeyError, RuntimeError, ValueError, TypeError, OSError) as error:
            errors.append(dict(node=node, reason=str(error)))
    return dict(records=records, errors=errors,
                fourComplete=not errors and {row['node'] for row in records if row['complete']} == set(range(4)))
