#!/usr/bin/env python3
"""Prepare a fixed, public-backend QA scope from supplied numeric mappings; no DNS."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid

SOURCE_SHA = '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407'
LINE_SHA = '9c4e18129d83487a0dcf479f1c3f261aa78f3ce4ab1048e264b63d86ca610a5f'
SCOPE_NAME = '.ynx-public-entry-qa-scope.json'
MAX_INPUT_BYTES = 32768
# Match the fixed Go candidate's conservative public-entry policy. Its loader is
# still authoritative; preparing a file grants no production qualification.
SPECIAL = tuple(ipaddress.ip_network(s) for s in (
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
    '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
    '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16',
    '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
    '224.0.0.0/4', '240.0.0.0/4', '2001::/23', '2001:db8::/32',
    '2002::/16', '2620:4f:8000::/48', '3fff::/20'))
IPV6_GLOBAL = ipaddress.ip_network('2000::/3')


class ScopeError(ValueError):
    """A fixed diagnostic label that contains no supplied address or path."""


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ScopeError('duplicate JSON key')
        result[key] = value
    return result


def read_file(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_INPUT_BYTES:
            raise ScopeError('input must be a bounded regular file')
        chunks = bytearray()
        while len(chunks) <= MAX_INPUT_BYTES:
            part = os.read(fd, MAX_INPUT_BYTES + 1 - len(chunks))
            if not part:
                break
            chunks.extend(part)
        if len(chunks) > MAX_INPUT_BYTES:
            raise ScopeError('input too large')
        return bytes(chunks)
    finally:
        os.close(fd)


def json_object(raw):
    result = json.loads(raw, object_pairs_hook=unique_object)
    if not isinstance(result, dict):
        raise ScopeError('JSON object required')
    return result


def reviewed_hosts(source):
    raw = read_file(source)
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise ScopeError('reviewed source identity mismatch')
    catalogue = json_object(raw)
    line = catalogue['bridges']['snowflake'][0]
    if hashlib.sha256(line.encode()).hexdigest() != LINE_SHA:
        raise ScopeError('selected bridge identity mismatch')
    tokens = line.split()
    attrs = dict(token.split('=', 1) for token in tokens[3:])
    fronts = attrs['fronts'].split(',')
    stun = []
    for entry in attrs['ice'].split(','):
        match = re.fullmatch(r'stun:([a-z0-9.-]+):3478', entry)
        if not match:
            raise ScopeError('reviewed STUN contract mismatch')
        stun.append(match[1])
    if len(fronts) != 2 or len(stun) != 8 or len(set(fronts + stun)) != 10:
        raise ScopeError('reviewed name count mismatch')
    return fronts, stun


def canonical_public_ip(value):
    if not isinstance(value, str) or '%' in value:
        raise ScopeError('numeric public address required')
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        raise ScopeError('numeric public address required') from None
    if str(ip) != value or getattr(ip, 'ipv4_mapped', None) is not None:
        raise ScopeError('noncanonical or mapped address')
    if ip.is_multicast or ip.is_unspecified or ip.is_loopback or ip.is_link_local:
        raise ScopeError('address outside public-entry policy')
    if ip.version == 6 and ip not in IPV6_GLOBAL:
        raise ScopeError('address outside public-entry policy')
    if any(ip.version == prefix.version and ip in prefix for prefix in SPECIAL):
        raise ScopeError('address outside public-entry policy')
    return ip


def prepare(profile_home, source, supplied_addresses, run_id, plan_deadline_ns,
            mapping_expires_ns, now_ns=None):
    now_ns = time.time_ns() if now_ns is None else now_ns
    if str(uuid.UUID(run_id)) != run_id:
        raise ScopeError('canonical lowercase run UUID required')
    for deadline, maximum in ((plan_deadline_ns, 650), (mapping_expires_ns, 900)):
        if type(deadline) is not int or not now_ns < deadline <= now_ns + maximum * 1_000_000_000:
            raise ScopeError('scope deadline outside bounded QA window')
        if deadline > (1 << 63) - 1:
            raise ScopeError('scope deadline exceeds Int64')
    fronts, stun = reviewed_hosts(source)
    if not isinstance(supplied_addresses, dict) or set(supplied_addresses) != set(fronts + stun):
        raise ScopeError('missing or unreviewed mapping host')
    addresses = {}
    nat_tuples = set()
    for name in fronts + stun:
        values = supplied_addresses[name]
        if not isinstance(values, list) or not 1 <= len(values) <= 16:
            raise ScopeError('mapping address count outside bounds')
        checked = [str(canonical_public_ip(value)) for value in values]
        if len(set(checked)) != len(checked):
            raise ScopeError('duplicate mapping address')
        addresses[name] = sorted(checked)
        if name in stun:
            nat_tuples.update(value for value in checked if ipaddress.ip_address(value).version == 4)
    if len(nat_tuples) > 64:
        raise ScopeError('STUN numeric tuple count outside bounds')
    profile = Path(profile_home)
    if not profile.is_absolute() or str(profile.resolve()) != str(profile):
        raise ScopeError('profile must be a canonical absolute directory')
    if (profile.name != 'Tor' or profile.parent.name != 'YNX Browser Route State'
            or not re.fullmatch(r'ynx-public-search-[A-Za-z0-9]{8}', profile.parent.parent.name)):
        raise ScopeError('fresh QA profile shape required')
    directory = os.open(str(profile), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    created = False
    try:
        before = os.fstat(directory)
        if before.st_uid != os.getuid() or stat.S_IMODE(before.st_mode) != 0o700:
            raise ScopeError('profile must be owned by current user with mode0700')
        if not 0 <= before.st_dev < (1 << 64) or not 0 <= before.st_ino < (1 << 64):
            raise ScopeError('profile identity outside UInt64')
        plan = dict(schema='P05_PUBLIC_ENTRY_QA_SCOPE_V1', runID=run_id,
                    reviewedSourceSHA256=SOURCE_SHA, selectedBridgeLineSHA256=LINE_SHA,
                    profileDevice=before.st_dev, profileInode=before.st_ino,
                    planDeadlineUnixNano=plan_deadline_ns,
                    mappingExpiresUnixNano=mapping_expires_ns, addresses=addresses)
        encoded = (json.dumps(plan, sort_keys=True, separators=(',', ':')) + '\n').encode()
        fd = os.open(SCOPE_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        created = True
        try:
            os.fchmod(fd, 0o600)
            offset = 0
            while offset < len(encoded):
                count = os.write(fd, encoded[offset:])
                if count <= 0:
                    raise OSError('scope write made no progress')
                offset += count
            os.fsync(fd)
            info = os.fstat(fd)
            if info.st_nlink != 1 or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise ScopeError('scope file identity mismatch')
        finally:
            os.close(fd)
        after = os.stat(str(profile), follow_symlinks=False)
        if (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino):
            raise ScopeError('profile identity changed during preparation')
        return dict(status='PREPARED_QA_INPUT_ONLY', scopeSHA256=hashlib.sha256(encoded).hexdigest(),
                    scopeBytes=len(encoded), hosts=len(addresses), addressCount=sum(map(len, addresses.values())),
                    STUNv4Tuples=len(nat_tuples), NATIfNoIPv4='unknown; no additional target allowed',
                    productionQualification=False, DNS='NOT_RUN', network='NOT_RUN',
                    profileDevice=before.st_dev, profileInode=before.st_ino)
    except Exception:
        # Preserve partial/unknown input instead of overwriting or renewing it on retry.
        if created:
            raise RuntimeError('scope preparation failed; owned file retained, do not launch backend') from None
        raise
    finally:
        os.close(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile-home', type=Path, required=True)
    parser.add_argument('--reviewed-source', type=Path, required=True)
    parser.add_argument('--addresses-json', type=Path, required=True)
    parser.add_argument('--run-id', default=None)
    parser.add_argument('--plan-deadline-unix-nano', type=int, required=True)
    parser.add_argument('--mapping-expires-unix-nano', type=int, required=True)
    args = parser.parse_args()
    try:
        result = prepare(args.profile_home, args.reviewed_source,
                         json_object(read_file(args.addresses_json)), args.run_id or str(uuid.uuid4()),
                         args.plan_deadline_unix_nano, args.mapping_expires_unix_nano)
    except Exception as error:
        # Never print mapping contents or file paths from malformed input.
        print(json.dumps(dict(status='FAILED_NO_BACKEND_LAUNCH', error=type(error).__name__,
                              reason=str(error) if isinstance(error, ScopeError) else 'input or filesystem failure',
                              productionQualification=False, DNS='NOT_RUN', network='NOT_RUN')))
        raise SystemExit(1)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
