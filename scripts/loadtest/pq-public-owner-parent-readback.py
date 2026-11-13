"""Read pinned parent transport boundaries; no workload, retry or finality grant."""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import re


SCHEMA = 'YNX-PERF-PUBLIC-OWNER-TRANSPORT/v1'
BOUNDARIES = ('requestedMonotonicNs', 'streamAcquiredMonotonicNs',
              'commandRequestedMonotonicNs', 'replyReceivedMonotonicNs',
              'returnedMonotonicNs')
STAGES = {'requestToReturn': (0, 4), 'streamQueueWait': (0, 1),
          'acquireToCommand': (1, 2), 'commandToReply': (2, 3),
          'replyToReturn': (3, 4)}
CODES = {'sign': {'ORIGINAL_SAVED'}, 'confirm': {'PROOF_CONFIRMED_DATA'},
         'recover': {'ORIGINAL_RECOVERED'}, 'close-owner': {'OWNER_RETIRED'}}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def integer(value):
    require(type(value) is int and 0 <= value < 1 << 63, 'bounded nonnegative original integer required')
    return value


def strict(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate original JSON field')
            result[key] = value
        return result
    def constant(_):
        raise RuntimeError('nonfinite original number')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def samples(values, missing_attempts):
    observed = sorted(v for v in values if v is not None)
    complete = missing_attempts == 0 and len(observed) == len(values) and bool(observed)
    def percentile(p):
        return observed[(len(observed)*p+99)//100-1] if complete else None
    return dict(retainedAttempts=len(values), observed=len(observed),
                retainedMissing=len(values)-len(observed),
                minNs=observed[0] if observed else None,
                maxNs=observed[-1] if observed else None,
                fullAttemptP50Ns=percentile(50), fullAttemptP95Ns=percentile(95),
                fullAttemptP99Ns=percentile(99), fullAttemptQuantilesCensored=not complete)


def readback(raw, expected_sha256):
    require(type(raw) is bytes and 0 < len(raw) <= 4 << 20, 'bounded original transport report required')
    require(type(expected_sha256) is str and re.fullmatch('[0-9a-f]{64}', expected_sha256)
            and hashlib.sha256(raw).hexdigest() == expected_sha256, 'original transport SHA256 differs')
    report = strict(raw)
    require(type(report) is dict and report.get('schema') == SCHEMA
            and report.get('clock') == 'parent_monotonic_ns'
            and report.get('recordLimit') == 2048
            and report.get('automaticRetry') is False and report.get('authorityGranted') is False,
            'original parent transport schema or scope differs')
    attempted, retained, omitted = (integer(report.get(k)) for k in ('attempted', 'retained', 'omitted'))
    rows = report.get('records')
    require(type(rows) is list and retained == len(rows) <= 2048
            and attempted == retained+omitted, 'original attempted/retained/omitted counts differ')
    output, groups = [], collections.defaultdict(list)
    for index, row in enumerate(rows):
        require(type(row) is dict and set(row) <= set(BOUNDARIES) | {
            'ownerIndex', 'operationId', 'operation', 'code', 'errorType'}, 'unknown original boundary field')
        operation, owner, identity = row.get('operation'), row.get('ownerIndex'), row.get('operationId')
        require(type(owner) is int and 0 <= owner < 1000 and type(operation) is str
                and operation in CODES and type(identity) is str
                and (re.fullmatch('[0-9a-f]{64}', identity)
                     or (operation == 'close-owner' and identity == '')), 'original operation identity differs')
        require(BOUNDARIES[0] in row and BOUNDARIES[-1] in row, 'original request/return boundary missing')
        # Request, acquire, command and reply are a prefix; return is present
        # for all retained attempts, including cancellation and lost replies.
        reached = [name in row for name in BOUNDARIES[:-1]]
        require(reached == sorted(reached, reverse=True), 'original boundary has an impossible gap')
        clocks = [integer(row[name]) for name in BOUNDARIES if name in row]
        require(clocks == sorted(clocks), 'parent clock boundaries reversed')
        code, error = row.get('code'), row.get('errorType')
        if code is not None:
            require(type(code) is str and code in CODES[operation] | {'UNKNOWN', 'REJECTED'}
                    and BOUNDARIES[3] in row, 'reply outcome differs from original command phase')
        require(error is None or (type(error) is str and 0 < len(error) <= 128), 'original error type differs')
        require(code is not None or error is not None, 'returned attempt lacks an outcome or original error')
        stages = {name: row[BOUNDARIES[b]]-row[BOUNDARIES[a]]
                  if BOUNDARIES[a] in row and BOUNDARIES[b] in row else None
                  for name, (a, b) in STAGES.items()}
        value = dict(recordIndex=index, originalRecord=dict(row), stagesNs=stages,
                     replyObserved=BOUNDARIES[3] in row,
                     outcomeUnknown=code == 'UNKNOWN' or error is not None,
                     businessFinalityQualified=False)
        output.append(value)
        groups[operation].append(value)
    return dict(schema='YNX-PERF-PUBLIC-OWNER-PARENT-READBACK/v1',
                originalSHA256=expected_sha256, originalBytes=len(raw), attempted=attempted,
                retained=retained, omitted=omitted, records=output,
                groups={phase: dict(retainedAttempts=len(values),
                    phaseAttemptDenominatorKnown=omitted == 0,
                    outcomes=dict(collections.Counter(v['originalRecord'].get('code', 'NO_VALIDATED_REPLY') for v in values)),
                    stages={name: samples([v['stagesNs'][name] for v in values], omitted) for name in STAGES})
                    for phase, values in sorted(groups.items())},
                unassignedOmittedAttempts=omitted, stagesAdded=False, goCalleeTimeInferred=False,
                automaticRetry=False, businessQualified=None, inclusionTPS=None, finalConfirmationTPS=None,
                finalConfirmationPercentilesMs=dict(p50=None, p95=None, p99=None),
                meaning='Parent wall spans only. Acquire-to-command includes checkpoint preparation; command-to-reply includes pipe, Go and receipt reading. Omitted or missing boundaries censor quantiles. Recover/close are separate phases; no finality follows from a reply code.')


def source_preparation(receipt, raw, expected_owners):
    """Bind pre-window parent observations to the preserved Go READY line."""
    pool = receipt.get('senderPoolPreparation')
    if pool is None or pool.get('readyMode') != 'ORIGINAL_PUBLIC_STATIC_SOURCE_PREPARED':
        require(raw is None, 'prepared READY supplied without original pool receipt')
        return dict(status='NOT_SUPPLIED')
    require(type(raw) is bytes and 0 < len(raw) <= 2 << 20
            and raw.endswith(b'\n') and raw.count(b'\n') == 1,
            'one bounded original prepared READY line required')
    owners = tuple(expected_owners)
    require(0 < len(owners) <= 1000
            and all(type(owner) is int and 0 <= owner < 1000 for owner in owners)
            and tuple(sorted(set(owners))) == owners, 'original owner set required')
    preparation = pool.get('sourcePreparation')
    digest = hashlib.sha256(raw).hexdigest()
    require(type(preparation) is dict and preparation.get('sourceReply') == 'load-public-owners-ready.json'
            and preparation.get('sourceReplySHA256') == digest, 'prepared READY receipt SHA256 differs')
    spec = importlib.util.spec_from_file_location('prepared_owner_transport',
        Path(__file__).with_name('pq-public-owner-transport.py'))
    transport = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transport)
    ready = transport.prepared_ready(strict(raw), owners, require)
    require(pool.get('publicScopeReady') == ready and pool.get('bootstrapLoaded') is True
            and all(pool.get(key) is False for key in
                    ('signed', 'nonceReserved', 'loadClockStarted', 'sourceGrant',
                     'coldValidationIncludedInFirstCommand'))
            and preparation.get('calleeStartupElapsedNs') == ready['startupElapsedNs']
            and preparation.get('calleePreparationTimings') == ready['preparationTimings']
            and preparation.get('parentClock') == 'parent_monotonic_ns'
            and preparation.get('intervalsOverlap') is True
            and preparation.get('addedToPerCommand') is False
            and preparation.get('checkpointValidated') is False,
            'prepared READY receipt scope or timings differ')
    launch = integer(preparation.get('parentLaunchMonotonicNs'))
    received = integer(preparation.get('parentReadyReceivedMonotonicNs'))
    elapsed = integer(preparation.get('parentLaunchToReadyNs'))
    require(received - launch == elapsed, 'prepared READY parent elapsed differs')
    load = receipt.get('loadResult')
    gap = None
    if load is not None:
        origin = load.get('originMonotonicNs')
        require(type(origin) is str and re.fullmatch('0|[1-9][0-9]{0,18}', origin),
                'original load origin required')
        gap = integer(int(origin)) - received
        require(gap >= 0, 'prepared READY arrived after original load origin')
    return dict(status='ORIGINAL_READY_READ', sourceReplySHA256=digest,
                parentLaunchToReadyNs=elapsed, calleeStartupElapsedNs=ready['startupElapsedNs'],
                calleePreparationTimings=ready['preparationTimings'],
                readyToLoadOriginNs=gap, readinessBeforeLoadObserved=gap is not None,
                intervalsOverlap=True, addedToPerCommand=False,
                checkpointValidated=False, businessQualified=False)


def pinned_file(path, expected, limit):
    with path.open('rb') as source:
        raw = source.read(limit + 1)
    require(0 < len(raw) <= limit and hashlib.sha256(raw).hexdigest() == expected,
            'original file bounds or SHA256 differ')
    return raw


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--ready', type=Path, help='read prepared READY against a pinned original window receipt')
    parser.add_argument('--load-plan', type=Path, help='original load plan bound by receipt planSHA256')
    args = parser.parse_args()
    if args.ready is None and args.load_plan is None:
        print(json.dumps(readback(pinned_file(args.input, args.expected_sha256, 4 << 20),
                                  args.expected_sha256), indent=2))
        return
    if args.ready is None or args.load_plan is None:
        parser.error('--ready and --load-plan are both required for preparation readback')
    receipt = strict(pinned_file(args.input, args.expected_sha256, 64 << 20))
    plan = strict(pinned_file(args.load_plan, receipt.get('planSHA256'), 16 << 20))
    with args.ready.open('rb') as source:
        raw = source.read((2 << 20) + 1)
    owners = sorted(account['ownerIndex'] for account in plan['accounts'])
    print(json.dumps(source_preparation(receipt, raw, owners), indent=2))


if __name__ == '__main__':
    main()
