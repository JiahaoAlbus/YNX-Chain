"""Allowlisted same-child response timing, independent of directory qualification."""

from datetime import datetime, timezone
import json
import re

PREFIX = b'YNX_NYM_QA_DIRECTORY_HTTP_V1 '
SCHEMA = 'YNX_NYM_QA_DIRECTORY_HTTP_V1'
MAX_STREAM_BYTES = 524288
MAX_FRAMES = 161
KEYS = {
    'schema', 'runID', 'resource', 'page', 'status', 'responseUtcUnixSeconds',
    'responseElapsedMs', 'date', 'ageSeconds', 'cacheControl',
}
FLAGS = {
    'public', 'private', 'noCache', 'noStore', 'mustRevalidate',
    'proxyRevalidate', 'immutable',
}
DURATIONS = {'maxAge', 'sharedMaxAge', 'staleWhileRevalidate', 'staleIfError'}
WEEKDAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
HTTP_DATE = re.compile(r'([A-Za-z]{3}), ([0-9]{2}) ([A-Za-z]{3}) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT')


def uint(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate-key')
        result[key] = value
    return result


def header(field, convert):
    if isinstance(field, dict) and set(field) == {'state'} and field['state'] in ('missing', 'invalid'):
        return dict(field)
    if not isinstance(field, dict) or set(field) != {'state', 'value'} or field['state'] != 'observed':
        raise ValueError('header-shape')
    return convert(field['value'])


def date(value):
    match = HTTP_DATE.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ValueError('date-shape')
    day_name, day, month, year, hour, minute, second = match.groups()
    try:
        timestamp = datetime(int(year), MONTHS.index(month) + 1, int(day), int(hour),
                             int(minute), int(second), tzinfo=timezone.utc)
    except ValueError:
        return {'state': 'invalid'}
    if WEEKDAYS[timestamp.weekday()] != day_name:
        return {'state': 'invalid'}
    return {'state': 'observed', 'value': timestamp.isoformat()}


def age(value):
    if not uint(value, 2**32 - 1):
        raise ValueError('age-shape')
    return {'state': 'observed', 'value': value}


def policy(value):
    if (not isinstance(value, dict) or value.keys() != FLAGS | DURATIONS
            or any(type(value[key]) is not bool for key in FLAGS)
            or any(value[key] is not None and not uint(value[key], 2**32 - 1) for key in DURATIONS)):
        raise ValueError('cache-policy-shape')
    return {'state': 'observed', 'value': dict(value)}


def follows(previous, resource, page):
    if previous is None:
        return resource == 'basic' and page == 0
    if previous['status'] != 200:
        return False
    last, last_page = previous['resource'], previous['page']
    if last == resource:
        return resource != 'epoch' and page == last_page + 1
    return (last == 'basic' and resource == 'described' and page == 0
            or last == 'described' and resource == 'epoch')


def read_observations(stderr, run_id, *, terminal_capture_complete):
    """Return None for a rejected capture and [] for no emitted observations."""
    if (terminal_capture_complete is not True or not isinstance(stderr, bytes) or len(stderr) > MAX_STREAM_BYTES
            or not isinstance(run_id, str) or not re.fullmatch(r'qa-dir-[0-9a-f]{32}', run_id)):
        return None
    lines = stderr.split(b'\n')
    if lines[-1].startswith(PREFIX):
        return None
    frames = [line[len(PREFIX):] for line in lines[:-1] if line.startswith(PREFIX)]
    if len(frames) > MAX_FRAMES:
        return None
    observations = []
    try:
        for frame in frames:
            if len(frame) > 1536:
                return None
            value = json.loads(frame, object_pairs_hook=unique)
            if (not isinstance(value, dict) or value.keys() != KEYS or value['schema'] != SCHEMA
                    or value['runID'] != run_id or value['resource'] not in ('basic', 'described', 'epoch')
                    or not uint(value['status'], 599) or value['status'] < 100
                    or not uint(value['responseElapsedMs'], 120000)):
                return None
            resource, page = value['resource'], value['page']
            if not (page is None if resource == 'epoch' else uint(page, 79)):
                return None
            local = value['responseUtcUnixSeconds']
            if local is not None and not uint(local, 2**64 - 1):
                return None
            if not follows(observations[-1] if observations else None, resource, page):
                return None
            observations.append({'resource': resource, 'page': page, 'status': value['status'],
                                 'responseUtcUnixSeconds': local,
                                 'responseElapsedMs': value['responseElapsedMs'],
                                 'dateUTC': header(value['date'], date),
                                 'ageSeconds': header(value['ageSeconds'], age),
                                 'cacheControl': header(value['cacheControl'], policy)})
    except (ValueError, UnicodeError, TypeError, RecursionError):
        return None
    return observations


class TerminalHttpObservation:
    """Adapt the original decoder/diagnostic hooks before their private buffers disappear."""

    def __init__(self, decoder, diagnostics):
        self.decoder = decoder
        self.diagnostics = diagnostics
        self.records = None

    def require_terminal_capture(self, *args, **kwargs):
        return self.decoder.require_terminal_capture(*args, **kwargs)

    def parse_directory_output(self, stdout, stderr, run_id):
        self.records = read_observations(stderr, run_id, terminal_capture_complete=True)
        return self.decoder.parse_directory_output(stdout, stderr, run_id)

    def public_body_failure(self, stderr, run_id, fixed_errors, *, terminal_capture_complete):
        self.records = read_observations(stderr, run_id, terminal_capture_complete=terminal_capture_complete)
        return self.diagnostics.public_body_failure(
            stderr, run_id, fixed_errors, terminal_capture_complete=terminal_capture_complete)

    def persist(self, case, sha, save):
        # The frozen consumer calls these hooks only on original child output.
        # Check original receipt and terminal cleanup independently at the write.
        receipt = case / 'once-fresh-directory/receipt.json'
        if not self.records or not receipt.is_file() or receipt.is_symlink():
            return None
        terminal = json.loads(receipt.read_text())
        if (terminal['capturedEOF'] != ['stderr', 'stdout'] or terminal['FDClosed'] is not True
                or terminal['remainingOwned'] or terminal['cleanupFailure']
                or terminal['childOutcomeRecordingFailure'] or len(terminal['processes']) != 1):
            return None
        child = terminal['processes'][0]
        if child['reaped'] is not True or type(child['exit']) is not int:
            return None
        output = case / 'HTTP_OBSERVATION.json'
        save(output, {'schema': 'P05_NYM_OWNED_DIRECTORY_HTTP_OBSERVATION_V1',
                      'originalReceiptSHA256': sha(receipt),
                      'scopeSHA256': terminal['scopeSHA256'], 'binarySHA256': terminal['binarySHA256'],
                      'originalPID': child['pid'], 'originalWait': child['exit'],
                      'httpResponses': self.records})
        return output
