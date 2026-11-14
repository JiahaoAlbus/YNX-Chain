"""Exact reviewed PUBLIC transport data; no arbitrary bridge/URL acceptance or networking."""
import hashlib
import ipaddress
import json
import re
from urllib.parse import urlsplit

PUBLIC_SHA256 = '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407'
MEEK_LINE_SHA256 = 'e5dc3554f6f7d01241596e4139f4477829905070acf0bdf0e794d3d6712c63de'
SNOWFLAKE_LINE_SHA256 = {
    '9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f',
    '284c53a7162ba87e1fe4213cf7976a8170628a63e8d9112f40e50ddbf6363d68',
}


class Rejected(ValueError):
    """Fixed classification only; never include input material in public errors."""


def reviewed_document(raw):
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != PUBLIC_SHA256:
        raise Rejected('reviewed-source-pin-mismatch')
    value = json.loads(raw)
    if set(value) != {'recommendedDefault', 'pluggableTransports', 'bridges'}:
        raise Rejected('reviewed-schema-mismatch')
    return value


def parse_line(line):
    if not isinstance(line, str) or len(line.encode()) > 4096 or not line.isascii() or any(ord(c) < 32 or ord(c) > 126 for c in line):
        raise Rejected('line-size-or-character-rejected')
    parts = line.split(' ')
    if len(parts) < 3 or any(not p for p in parts) or parts[0] not in {'meek_lite', 'snowflake', 'webtunnel', 'obfs4'}:
        raise Rejected('transport-or-line-grammar-rejected')
    try:
        host, port = parts[1].rsplit(':', 1)
        address = ipaddress.ip_address(host.strip('[]'))
        if not port.isascii() or not port.isdecimal() or not 0 < int(port) < 65536:
            raise ValueError()
    except ValueError:
        raise Rejected('numeric-address-or-explicit-port-required') from None
    fingerprint = None
    offset = 2
    if re.fullmatch(r'[A-Fa-f0-9]{40}', parts[offset]):
        fingerprint = parts[offset]; offset += 1
    options = {}
    for value in parts[offset:]:
        if '=' not in value:
            raise Rejected('transport-option-grammar-rejected')
        key, item = value.split('=', 1)
        if not re.fullmatch('[a-z][a-z0-9-]{0,31}', key) or not item or key in options:
            raise Rejected('duplicate-or-invalid-option')
        options[key] = item
    return {'protocol': parts[0], 'endpoint': (str(address), int(port)), 'fingerprint': fingerprint, 'options': options}


def require_https(value):
    try:
        url = urlsplit(value)
        if url.scheme != 'https' or not url.hostname or url.username is not None or url.password is not None or url.fragment or url.port not in (None, 443):
            raise ValueError()
        if '%' in url.hostname or not re.fullmatch(r'[A-Za-z0-9.-]+', url.hostname):
            raise ValueError()
        return url
    except ValueError:
        raise Rejected('https-origin-contract-rejected') from None


def meek_review(raw):
    document = reviewed_document(raw)
    lines = document['bridges'].get('meek')
    if not isinstance(lines, list) or len(lines) != 1 or hashlib.sha256(lines[0].encode()).hexdigest() != MEEK_LINE_SHA256:
        raise Rejected('exact-reviewed-meek-line-required')
    parsed = parse_line(lines[0])
    if parsed['protocol'] != 'meek_lite' or set(parsed['options']) != {'url', 'front', 'utls'}:
        raise Rejected('reviewed-meek-options-rejected')
    require_https(parsed['options']['url'])
    if not re.fullmatch(r'[A-Za-z0-9.-]+', parsed['options']['front']):
        raise Rejected('single-fixed-front-required')
    return parsed


def require_arti_rsa(parsed):
    if parsed['fingerprint'] is None:
        # Pinned tor-guardmgr0.47 config.rs:563 and builder:352; never infer a key.
        raise Rejected('arti-2.7-requires-reviewed-rsa-identity')
    return parsed


def snowflake_review(raw):
    document = reviewed_document(raw)
    lines = document['bridges'].get('snowflake')
    if not isinstance(lines, list) or len(lines) != 2 or {hashlib.sha256(v.encode()).hexdigest() for v in lines} != SNOWFLAKE_LINE_SHA256:
        raise Rejected('exact-reviewed-snowflake-lines-required')
    result = []
    for line in lines:
        parsed = require_arti_rsa(parse_line(line))
        options = parsed['options']
        if parsed['protocol'] != 'snowflake' or set(options) != {'fingerprint', 'fronts', 'ice', 'url', 'utls-imitate'} or options['fingerprint'] != parsed['fingerprint']:
            raise Rejected('snowflake-reviewed-settings-or-identity-mismatch')
        require_https(options['url'])
        fronts = options['fronts'].split(',')
        if len(fronts) != 2 or any(not re.fullmatch(r'[A-Za-z0-9.-]+', front) for front in fronts):
            raise Rejected('reviewed-front-set-required')
        ice = options['ice'].split(',')
        if len(ice) != 8 or any(not re.fullmatch(r'stun:[A-Za-z0-9.-]+:3478', endpoint) for endpoint in ice):
            raise Rejected('reviewed-udp-stun-set-required')
        # Pinned Arti proxied.rs:492-548 escapes ';' and '\\', '=' only in key.
        def escaped(value, key=False):
            return ''.join(('\\' if ch in '\\;' or key and ch == '=' else '') + ch for ch in value)
        encoded = ';'.join(escaped(k, True) + '=' + escaped(v) for k, v in options.items())
        if len(encoded.encode()) > 510:
            raise Rejected('arti-socks5-settings-exceed-510')
        parsed['encodedSettingsBytes'] = len(encoded.encode())
        result.append(parsed)
    return result
