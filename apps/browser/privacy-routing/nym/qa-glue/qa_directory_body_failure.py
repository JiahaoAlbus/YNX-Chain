"""Bounded optional DATA from the QA directory's original terminal stderr."""
import json
import re

PREFIX = b'YNX_NYM_QA_BODY_FAILURE_V1 '
KEYS = {'schema', 'runID', 'resource', 'page', 'reason', 'expectedBodyBytes',
        'receivedBodyBytes', 'sessionBodyBytes', 'nonemptyChunks'}
REASONS = {'qa-directory-body-idle', 'qa-directory-body-transport', 'qa-directory-expired'}


def public_body_failure(stderr, run_id, fixed_errors, *, terminal_capture_complete):
    if (terminal_capture_complete is not True or not isinstance(stderr, bytes) or len(stderr) > 524288
            or not isinstance(run_id, str) or not re.fullmatch(r'qa-dir-[0-9a-f]{32}', run_id)):
        return None
    frames = [line[len(PREFIX):] for line in stderr.splitlines() if line.startswith(PREFIX)]
    if len(frames) != 1 or len(frames[0]) > 512:
        return None

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate diagnostic field')
            result[key] = value
        return result

    def bounded(value, ceiling):
        return type(value) is int and 0 <= value <= ceiling

    try:
        record = json.loads(frames[0], object_pairs_hook=unique)
        if not isinstance(record, dict) or set(record) != KEYS:
            return None
        if record['schema'] != 'YNX_NYM_QA_BODY_FAILURE_V1' or record['runID'] != run_id:
            return None
        resource, page, reason = (record[key] for key in ('resource', 'page', 'reason'))
        if not isinstance(reason, str) or reason not in REASONS or reason not in fixed_errors:
            return None
        if resource not in ('basic', 'described', 'epoch') or (resource == 'epoch' and page is not None):
            return None
        if resource != 'epoch' and not bounded(page, 79):
            return None
        expected, received, session, chunks = (record[key] for key in ('expectedBodyBytes', 'receivedBodyBytes', 'sessionBodyBytes', 'nonemptyChunks'))
        if not bounded(received, 4194304) or not bounded(session, 16777216) or not bounded(chunks, received):
            return None
        if session < received or (received == 0) != (chunks == 0):
            return None
        if expected is not None and (not bounded(expected, 4194304) or expected < received):
            return None
        return {key: record[key] for key in KEYS - {'runID', 'schema'}}
    except (ValueError, UnicodeError, TypeError, KeyError, RecursionError):
        return None
