"""Check complete per-height PUBLIC state and actual cold reconstruction records.

This reader never reconstructs consensus state or grants execution authority.
Go must emit every raw state and its actual normal-loader cold observation.
"""
import hashlib
import json


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
    pins = {}
    for arm, files in [('before', before), ('after', after)]:
        require({name for name in files if name.startswith('height-states/')} == required,
                'complete exact per-height raw states required: ' + arm)
        raw = files['cold-reconstruction.jsonl']
        require(0 < len(raw) <= 1 << 20 and raw.endswith(b'\n'), 'bounded complete cold records required')
        cold = [strict(line) for line in raw.splitlines()]
        require([row['height'] for row in cold] == heights, 'all ordered cold height observations required')
        for reference, observed in zip(trace_rows, cold):
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
                coldReconstructionIndependentlyExecutedByReader=False, statePins=pins)
