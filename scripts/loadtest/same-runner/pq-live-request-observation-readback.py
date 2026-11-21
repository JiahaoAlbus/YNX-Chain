"""Read bounded opt-in records from an original merged stdout/stderr log.

Only validated observation lines may be removed from the ordinary output.
Ordinary stderr stays opaque: it is not promoted to safe telemetry or success.
No flags, source admission, process, signal or retry behavior is changed here.
"""
import hashlib
import json

VERSION = 'YNX-PQ-LAB-LIVE-REQUEST-OBSERVATION/v1'
FIELDS = frozenset(('version', 'sequence', 'event', 'stage', 'span', 'elapsedNs', 'reason', 'authorityGranted'))
STAGES = frozenset(('REQUEST', 'REQUEST_PUBLISH', 'POLICY_LOAD', 'CONFIG_LOAD', 'STATIC_LOAD',
    'MIGRATION_READ', 'MIGRATION_DECODE', 'BOOTSTRAP_VALIDATE', 'STATIC_CURRENT',
    'HELD_STATIC_CURRENT', 'ANCHOR_VALIDATE', 'ANCHOR_STATE_VALIDATE', 'ANCHOR_REGISTRY_REPLAY',
    'ANCHOR_COMMIT_VERIFY', 'DURABLE_PUBLISH', 'TRANSACTION_READ', 'PREVIOUS_RESULT',
    'INPUTS_CURRENT_BEFORE', 'INPUTS_CURRENT_AFTER', 'INPUTS_CLOSE', 'TRANSACTION_CLOSE', 'OBSERVATION'))


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def pairs(items):
    value = {}
    for key, child in items:
        require(key not in value, 'duplicate observation JSON field')
        value[key] = child
    return value


def split_original(raw, expected_sha256):
    require(type(raw) is bytes and len(raw) <= 4 << 20, 'original bounded helper log required')
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, 'original helper log SHA256 differs')
    ordinary, records, open_spans, completed = [], [], {}, []
    begun, last_span, stopped, partial = set(), 0, False, []
    for number, line in enumerate(raw.splitlines(keepends=True), 1):
        try:
            value = json.loads(line, object_pairs_hook=pairs)
        except (ValueError, UnicodeDecodeError, RuntimeError):
            # A signal or failed write may leave only an unterminated prefix.
            # Keep it byte-for-byte; never fabricate its missing fields/END.
            candidate = line.lstrip().startswith(b'{') and VERSION.encode() in line
            require(not candidate or not line.endswith(b'\n'),
                    'malformed complete observation record')
            if candidate:
                partial.append(dict(line=number, bytes=len(line), sha256=hashlib.sha256(line).hexdigest()))
            ordinary.append(line)
            continue
        if type(value) is not dict or value.get('version') != VERSION:
            ordinary.append(line)
            continue
        if not line.endswith(b'\n'):
            partial.append(dict(line=number, bytes=len(line), sha256=hashlib.sha256(line).hexdigest()))
            ordinary.append(line)
            continue
        require(not stopped and len(records) < 64 and len(line) <= 512 and line.endswith(b'\n'),
                'original observation line/record bound or termination differs')
        require(set(value) == FIELDS and value['authorityGranted'] is False,
                'closed safe observation fields required')
        for key, maximum in (('sequence', 64), ('span', 65535), ('elapsedNs', (1 << 63)-1)):
            require(type(value[key]) is int and 0 <= value[key] <= maximum,
                    'original observation integer differs')
        require(value['sequence'] == len(records)+1 and type(value['stage']) is str
                and value['stage'] in STAGES and type(value['event']) is str,
                'original observation sequence/stage differs')
        event, stage, span = value['event'], value['stage'], value['span']
        if not records:
            require(event == 'BEGIN' and stage == 'REQUEST' and span == 1,
                    'original observer entry missing')
        if event == 'BEGIN':
            require(stage != 'OBSERVATION' and span > last_span and value['elapsedNs'] == 0
                    and value['reason'] == '' and (not records or 1 in open_spans),
                    'original BEGIN span differs')
            begun.add(span); open_spans[span] = stage; last_span = span
        elif event == 'END':
            require(open_spans.get(span) == stage and value['reason'] == '',
                    'original END lacks matching BEGIN')
            del open_spans[span]
            completed.append(dict(stage=stage, span=span, elapsedNs=value['elapsedNs'],
                                  returned=True, businessSuccessInferred=False))
            if span == 1:
                stopped = True
        elif event == 'CANCEL':
            require(stage == 'REQUEST' and span == 1 and 1 in open_spans
                    and value['reason'] in ('SIGINT', 'SIGTERM'), 'original CANCEL scope differs')
        elif event == 'TRUNCATED':
            require(stage == 'OBSERVATION' and span == 0 and value['reason'] == 'RECORD_BOUND'
                    and value['sequence'] == 64, 'original TRUNCATED scope differs')
            stopped = True
        else:
            raise RuntimeError('original observation event differs')
        records.append(value)
    other = b''.join(ordinary)
    canceled = any(row['event'] == 'CANCEL' for row in records)
    truncated = any(row['event'] == 'TRUNCATED' for row in records)
    status = 'NOT_OBSERVED' if not records and not partial else 'OBSERVED_INCOMPLETE'
    if records and not open_spans and not canceled and not truncated and not partial:
        status = 'INTERVALS_RETURNED'
    report = dict(schema='YNX-PERF-LIVE-REQUEST-OBSERVATION-READBACK/v1', status=status,
                  originalSHA256=expected_sha256, originalBytes=len(raw), records=records,
                  completedSpans=completed, begunSpans=len(begun),
                  unresolvedSpans=[dict(span=span, stage=stage, elapsedNs=None) for span, stage in sorted(open_spans.items())],
                  partialRecordPrefixes=partial, canceledSignalObserved=canceled, truncated=truncated,
                  ordinaryOutputBytes=len(other), ordinaryOutputSHA256=hashlib.sha256(other).hexdigest(),
                  ordinaryOutputAssumedSafe=False, cleanupCompleteInferred=False, signalExitStatusInferred=False,
                  missingElapsedFilled=False, stagesAdded=False, businessQualified=False,
                  meaning='END is an interval return, including failure. CANCEL is signal observation only. Missing END and absent SIGKILL records remain unknown; ordinary stderr is opaque.')
    return report, other
