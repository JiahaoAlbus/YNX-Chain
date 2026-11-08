"""Check complete per-height PUBLIC state and actual cold reconstruction records.

This reader never reconstructs consensus state or grants execution authority.
Go must emit every raw state and its actual normal-loader cold observation.
"""
import hashlib
import json
import re


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'duplicate semantic JSON key')
        out[key] = value
    return out


def strict(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique)


def compare_height_states(before, after, trace_rows):
    """Mappings have relative public paths -> original bytes; no disk writes."""
    heights = [row['height'] for row in trace_rows]
    require(heights == list(map(str, range(4, 13))), 'all nine original heights required')
    required = {'height-states/' + h + '.json' for h in heights}
    pins = {}; timings = {}
    fields = frozenset(('height','stateBytes','stateSHA256','appHash','coldStateBytes','coldStateSHA256',
                        'coldAppHash','bytesEqual','coldLoadNs','coldEncodeNs','coldCompareNs'))
    for arm, files in [('before', before), ('after', after)]:
        require({name for name in files if name.startswith('height-states/')} == required,
                'complete exact per-height raw states required: ' + arm)
        raw = files['cold-reconstruction.jsonl']
        require(0 < len(raw) <= 1 << 20 and raw.endswith(b'\n'), 'bounded complete cold records required')
        cold = [strict(line) for line in raw.splitlines()]
        require([row['height'] for row in cold] == heights, 'all ordered cold height observations required')
        timings[arm] = []
        for reference, observed in zip(trace_rows, cold):
            require(set(observed) == fields, 'closed actual cold observation fields required')
            phase = dict(height=observed['height'])
            for key in ('coldLoadNs','coldEncodeNs','coldCompareNs'):
                value = observed[key]
                require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*', value) is not None
                        and int(value) < 1 << 63, 'original monotonic cold phase duration required: ' + key)
                phase[key] = value
            timings[arm].append(phase)
            h = reference['height']; state = files['height-states/' + h + '.json']
            require(0 < len(state) <= 8 << 20, 'bounded complete state required')
            digest = hashlib.sha256(state).hexdigest()
            require(str(len(state)) == reference['stateBytes'] and digest == reference['stateSHA256'],
                    'raw state differs from original per-height full-state pin: ' + arm + '/' + h)
            value = strict(state)
            require(type(value.get('height')) is int and value['height'] == int(h)
                    and value.get('appHash') == reference['appHash'], 'raw state height/AppHash differs')
            for key, expected in [('stateBytes', str(len(state))), ('stateSHA256', digest),
                                  ('appHash', reference['appHash']), ('coldStateBytes', str(len(state))),
                                  ('coldStateSHA256', digest), ('coldAppHash', reference['appHash']), ('bytesEqual', True)]:
                require(type(observed.get(key)) is type(expected) and observed[key] == expected,
                        'actual cold reconstruction differs: ' + arm + '/' + h + '/' + key)
            pins[arm + '/' + h] = dict(bytes=len(state), sha256=digest)
    for name in required:
        require(before[name] == after[name], 'two complete per-height states differ: ' + name)
    return dict(heights=heights, completePerHeightRawStateBytesEqual=True,
                completePerHeightBalanceNonceStateEqual=True, completePerHeightAppHashEqual=True,
                coldReconstructionProducerRecordsVerified=True,
                coldReconstructionIndependentlyExecutedByReader=False, statePins=pins,
                coldStageObservedNanoseconds=timings,
                timingMeaning='Original Go monotonic load/encode/compare observations; no missing interval filled; not business latency or source performance improvement.')


HEIGHT_TEST_CHILDREN = {
    'TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold': tuple(map(str, range(4, 13))),
    'TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals': (
        'live-hash', 'wrong-height', 'wrong-apphash', 'invalid-normal-state', 'output-failure', 'no-overwrite'),
}


def verify_go_tests(raw):
    """Require the complete original two-top/15-child serial Go JSON stream."""
    require(type(raw) is bytes and 0 < len(raw) <= 4 << 20 and raw.endswith(b'\n'),
            'complete bounded height-evidence Go JSON stream required')
    package = 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
    required = set(HEIGHT_TEST_CHILDREN)
    for parent, names in HEIGHT_TEST_CHILDREN.items():
        required.update(parent + '/' + name for name in names)
    started = ended = False
    active, ran, passed = set(), set(), set()
    for line in raw.splitlines():
        row = strict(line)
        require(type(row) is dict, 'original Go JSON object required')
        action = row.get('Action'); name = row.get('Test')
        require(type(row) is dict and row.get('Package') == package and not ended,
                'foreign/trailing height-evidence Go package')
        require(action in ('start', 'run', 'output', 'pass'), 'failed/skipped/unknown height-evidence Go action')
        if action == 'start':
            require(not started and not name, 'duplicate Go package start'); started = True
            continue
        require(started, 'height-evidence Go package start missing')
        if action == 'output':
            require(not name or name in ran, 'Go output without original test run')
            continue
        if action == 'run':
            require(name in required and name not in ran, 'unexpected/duplicate original height test')
            parent = name.rsplit('/', 1)[0] if '/' in name else None
            require(parent is None or parent in active, 'height subtest parent is not running')
            active.add(name); ran.add(name)
        elif name:
            require(name in active and not any(child.startswith(name + '/') for child in active),
                    'height test return without complete original run')
            active.remove(name); passed.add(name)
        else:
            require(not active and ran == passed == required, 'incomplete/zero-hit height test package')
            ended = True
    require(started and ended and not active and passed == required, 'truncated height-evidence Go test stream')
    return dict(package=package, topCases=2, childCases=15, passed=sorted(passed),
                originalStreamBytes=len(raw), originalStreamSHA256=hashlib.sha256(raw).hexdigest(),
                failed=0, skipped=0, packagePassed=True, nodeStarted=False, semanticPairQualified=False)
