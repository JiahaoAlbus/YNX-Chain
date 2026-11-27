"""Strict DATA-only readback of the original govulncheck JSON stream."""
import datetime
import json
import re

MAX_BYTES = 4 << 20
ADVISORY = 'GO-2026-6278'
MODULE = 'github.com/gorilla/websocket'
TARGET = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-perf-client'


def valid_time(value):
    if type(value) is not str or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})', value):
        return False
    offset = re.search(r'([+-])(\d{2}):(\d{2})$', value)
    if offset is not None and (int(offset.group(2)) > 23 or int(offset.group(3)) > 59):
        return False
    try:
        datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return True
    except ValueError:
        return False


def _pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError('duplicate JSON key')
        out[key] = value
    return out


def inspect(raw, *, exit_code, output_complete, expected_go='go1.26.10'):
    if type(exit_code) is not int or exit_code != 0 or output_complete is not True:
        raise ValueError('original scanner did not complete successfully')
    if expected_go not in ('go1.26.10', 'go1.26.11'):
        raise ValueError('original scanner toolchain is not frozen')
    if type(raw) is not bytes or not 0 < len(raw) <= MAX_BYTES:
        raise ValueError('original scanner stream unavailable or oversized')
    text = raw.decode('utf-8')
    decoder = json.JSONDecoder(object_pairs_hook=_pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON')))
    messages = []
    offset = 0
    while offset < len(text):
        while offset < len(text) and text[offset] in ' \t\r\n':
            offset += 1
        if offset == len(text):
            break
        message, offset = decoder.raw_decode(text, offset)
        if type(message) is not dict or len(message) != 1 or next(iter(message)) not in ('config', 'SBOM', 'progress', 'osv', 'finding'):
            raise ValueError('invalid original scanner message')
        messages.append(message)
        if len(messages) > 100000:
            raise ValueError('scanner message limit exceeded')
    if not messages or list(messages[0]) != ['config'] or sum('config' in m for m in messages) != 1:
        raise ValueError('original scanner configuration missing or duplicated')
    config = messages[0]['config']
    if (type(config) is not dict or config.get('protocol_version') != 'v1.0.0' or config.get('scanner_name') != 'govulncheck'
            or config.get('scanner_version') != 'v1.1.4'
            or config.get('go_version') != expected_go
            or config.get('db') != 'https://vuln.go.dev'
            or not valid_time(config.get('db_last_modified'))
            or config.get('scan_level') != 'symbol' or config.get('scan_mode') != 'source'):
        raise ValueError('original scanner/database/toolchain identity unavailable')
    sboms = [m['SBOM'] for m in messages if 'SBOM' in m]
    if len(sboms) != 1 or type(sboms[0]) is not dict or sboms[0].get('roots') != [TARGET]:
        raise ValueError('original target package SBOM unavailable')
    modules = sboms[0].get('modules', [])
    if type(modules) is not list or any(type(m) is not dict for m in modules):
        raise ValueError('invalid original target SBOM modules')
    websocket = [m for m in modules if m.get('path') == MODULE]
    if len(websocket) > 1 or websocket and type(websocket[0].get('version')) is not str:
        raise ValueError('original target module identity ambiguous')
    target_osv = [m['osv'] for m in messages if 'osv' in m and type(m['osv']) is dict and m['osv'].get('id') == ADVISORY]
    if websocket and not target_osv:
        raise ValueError('target advisory absent from original scanner database stream')
    progress = [m['progress'].get('message') for m in messages if 'progress' in m and type(m['progress']) is dict]
    if (progress.count('Fetching vulnerabilities from the database...') != 1
            or progress.count('Checking the code against the vulnerabilities...') != 1
            or progress.index('Fetching vulnerabilities from the database...') >= progress.index('Checking the code against the vulnerabilities...')):
        raise ValueError('original database/source analysis progress incomplete')
    affected = []
    for message in messages:
        if 'finding' not in message:
            continue
        finding = message['finding']
        if type(finding) is not dict or type(finding.get('osv')) is not str or type(finding.get('trace')) is not list or not finding['trace']:
            raise ValueError('invalid original finding')
        if finding['osv'] != ADVISORY:
            continue
        frame = finding['trace'][0]
        if type(frame) is not dict or frame.get('module') != MODULE:
            raise ValueError('target advisory module differs')
        function = frame.get('function')
        if function is not None and (type(function) is not str or not function):
            raise ValueError('invalid target symbol')
        if function and (frame.get('package') != MODULE or type(finding['trace'][-1]) is not dict
                         or finding['trace'][-1].get('package') != TARGET):
            raise ValueError('target call trace identity unavailable')
        affected.append('SYMBOL' if function else 'PACKAGE' if frame.get('package') else 'MODULE')
    return dict(version='YNX-PERF-CLIENT-VULN-DATA/v1', advisory=ADVISORY,
        targetPackage=TARGET, sourceScanOnly=True, runtimeAuthorized=False,
        independentBinaryVerified=False, scannerVersion=config['scanner_version'],
        goVersion=config['go_version'], database=config['db'],
        databaseLastModified=config['db_last_modified'],
        targetModuleVersion=websocket[0]['version'] if websocket else None,
        targetFindings=affected,
        targetReachability=('CALLED' if 'SYMBOL' in affected else 'NO_SYMBOL_FINDING_REPORTED' if websocket else 'NOT_IN_TARGET_SBOM'),
        interpretation='Original source-scan findings for the selected toolchain and observed database; no claim about an already-built binary or runtime.')
