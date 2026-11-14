#!/usr/bin/env python3
"""Run only an existing controlled profile; retain one owned handle and use graceful Nym stop."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time
import threading


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def binding(profile):
    names = ['private_identity.pem', 'public_identity.pem', 'private_encryption.pem', 'public_encryption.pem', 'ack_key.pem']
    return {name: digest(profile / 'data' / name) for name in names}


RECIPIENT = re.compile(r'[1-9A-HJ-NP-Za-km-z]{32,44}\.[1-9A-HJ-NP-Za-km-z]{32,44}@[1-9A-HJ-NP-Za-km-z]{32,44}')


def sanitize_log(line):
    line = RECIPIENT.sub(lambda m: 'recipient_sha256=' + hashlib.sha256(m.group().encode()).hexdigest() + ' gateway_sha256=' + hashlib.sha256(m.group().split('@')[1].encode()).hexdigest(), line)
    line = re.sub(r'using ([1-9A-HJ-NP-Za-km-z]{16,44}) for all anonymous',
                  lambda m: 'using sender_tag_sha256=' + hashlib.sha256(m[1].encode()).hexdigest() + ' for all anonymous', line)
    return re.sub(r'AnonymousSenderTag\([^)]*\)',
                  lambda m: 'sender_tag_sha256=' + hashlib.sha256(m.group().encode()).hexdigest(), line)


def validate_directory(args):
    basic_bytes = args.directory_basic.read_bytes()
    described_bytes = args.directory_described.read_bytes()
    epoch_bytes = args.directory_epoch.read_bytes()
    basic = json.loads(basic_bytes)
    described = json.loads(described_bytes)
    epoch = json.loads(epoch_bytes)
    def page(value):
        rows = value['data']; pagination = value['pagination']
        if pagination['page'] != 0 or pagination['total'] != len(rows):
            raise ValueError('Incomplete official directory snapshot')
        return rows
    nodes = page(basic['nodes']); descriptions = page(described); metadata = basic['metadata']
    now = datetime.datetime.now(datetime.timezone.utc)
    start = datetime.datetime.fromisoformat(epoch['current_epoch_start'].replace('Z', '+00:00'))
    length = epoch['epoch_length']
    refreshed = metadata['refreshed_at'].split(' ')
    if len(refreshed) != 3 or refreshed[2] != '+00:00:00':
        raise ValueError('Unexpected directory clock')
    # System Python may reject nine fractional digits; retain microsecond precision.
    clock, dot, fraction = refreshed[1].partition('.')
    clock += ('.' + fraction[:6]) if dot else ''
    refreshed = datetime.datetime.fromisoformat(refreshed[0] + 'T' + clock + '+00:00')
    end = start + datetime.timedelta(seconds=length['secs'])
    if (metadata['status'] is not None or metadata['absolute_epoch_id'] != epoch['total_elapsed_epochs']
        or not 600 <= length['secs'] <= 86400 or length['nanos'] != 0
        or not start <= now or now + datetime.timedelta(seconds=300) >= end
        or not -60 <= (now-refreshed).total_seconds() <= length['secs']):
        raise ValueError('Stale/mismatched/expiring official assignment; no start')
    def unique(rows, field, value):
        found = [n for n in rows if n[field] == value]
        if len(found) != 1: raise ValueError('Missing/ambiguous directory node')
        return found[0]
    entry = unique(nodes, 'node_id', args.entry_node_id)
    exit_node = unique(nodes, 'node_id', args.requester_node_id)
    detail = unique(descriptions, 'node_id', args.requester_node_id)['description']
    identity = exit_node['ed25519_identity_pubkey']
    if (entry['role'] != 'EntryGateway' or not entry['supported_roles']['entry']
        or not entry['entry']['hostname'] or not entry['entry']['wss_port']
        or exit_node['role'] != 'ExitGateway' or not exit_node['supported_roles']['exit_nr']
        or detail['host_information']['keys']['ed25519'] != identity
        or detail['network_requester']['address'] != args.provider or args.provider.split('@')[-1] != identity):
        raise ValueError('Selected nodes do not satisfy current assigned route roles')
    return {'epoch': epoch['total_elapsed_epochs'], 'validUntil': (end-datetime.timedelta(seconds=60)).isoformat(),
            'entryNodeID': args.entry_node_id, 'requesterNodeID': args.requester_node_id,
            'entryIdentitySHA256': hashlib.sha256(entry['ed25519_identity_pubkey'].encode()).hexdigest(),
            'requesterSHA256': hashlib.sha256(args.provider.encode()).hexdigest(),
            'basicSHA256': hashlib.sha256(basic_bytes).hexdigest(),
            'describedSHA256': hashlib.sha256(described_bytes).hexdigest(),
            'epochSHA256': hashlib.sha256(epoch_bytes).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--profile-id', required=True)
    parser.add_argument('--config-sha256', required=True)
    parser.add_argument('--provider', required=True)
    parser.add_argument('--port', type=int, default=1087)
    parser.add_argument('--ack-diagnostics', action='store_true', help='Scoped delivery event/size counters; never packet/key/payload tracing')
    parser.add_argument('--operation-root', type=Path, required=True)
    parser.add_argument('--directory-basic', type=Path, required=True)
    parser.add_argument('--directory-described', type=Path, required=True)
    parser.add_argument('--directory-epoch', type=Path, required=True)
    parser.add_argument('--entry-node-id', type=int, required=True)
    parser.add_argument('--requester-node-id', type=int, required=True)
    parser.add_argument('--reviewed-network', type=Path)
    parser.add_argument('--reviewed-network-sha256')
    parser.add_argument('--reviewed-run-id')
    parser.add_argument('--max-seconds', type=float, help='Bound this owned QA run, then SIGINT and reap its original child')
    args = parser.parse_args()
    if not re.fullmatch(r'ynx-route-[a-z0-9-]{1,64}', args.profile_id) or not 1 <= args.port <= 65535:
        raise SystemExit('Invalid controlled profile/port')
    if not re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}\.[1-9A-HJ-NP-Za-km-z]{32,44}@[1-9A-HJ-NP-Za-km-z]{32,44}', args.provider):
        raise SystemExit('Invalid provider')
    if args.binary.is_symlink() or digest(args.binary) != args.sha256:
        raise SystemExit('Pinned binary mismatch')
    profile = Path.home() / '.nym/socks5-clients' / args.profile_id
    config = profile / 'config/config.toml'
    if config.is_symlink() or digest(config) != args.config_sha256:
        raise SystemExit('Existing profile configuration mismatch')
    directory_binding = validate_directory(args)
    protected = [args.reviewed_network, args.reviewed_network_sha256, args.reviewed_run_id]
    if any(protected):
        if not all(protected) or args.reviewed_network.is_symlink() or digest(args.reviewed_network) != args.reviewed_network_sha256:
            raise SystemExit('Incomplete or changed reviewed network policy')
        policy = json.loads(args.reviewed_network.read_bytes())
        if (policy.get('schema') != 'YNX_NYM_REVIEWED_NETWORK_V1' or policy.get('stage') != 'route-runtime'
            or policy.get('runID') != args.reviewed_run_id or policy.get('directoryEpoch') != directory_binding['epoch']
            or policy.get('directorySHA256') != [directory_binding[k] for k in ['basicSHA256', 'describedSHA256', 'epochSHA256']]
            or policy.get('expiresAt', 0) <= time.time() or not -5 <= time.time() - policy.get('issuedAt', 0) <= 120):
            raise SystemExit('Policy is not bound to the current directory/operation')
    if args.max_seconds is not None and not 1 <= args.max_seconds <= 300:
        raise SystemExit('QA time limit must be within1..300seconds')
    keys_before = binding(profile)
    args.operation_root.mkdir(parents=True, exist_ok=False)
    # A local process lock is not route readiness; it only prevents duplicate owned runners.
    lock_fd = os.open(profile / '.ynx-run.lock', os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if binding(profile) != keys_before or digest(config) != args.config_sha256:
            raise SystemExit('Original profile changed before exclusive ownership')
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', args.port))
        command = [str(args.binary), 'run', '--ynx-runtime-contract', 'ynx-mixnet-v1', '--id', args.profile_id,
                   '--provider', args.provider, '--host', '127.0.0.1', '--port', str(args.port),
                   '--use-anonymous-replies', 'true', '--enabled-credentials-mode', 'false']
        if all(protected):
            command[command.index('ynx-mixnet-v1')] = 'ynx-protected-numeric-v2'
            command[1:1] = ['--no-banner', '--ynx-reviewed-network', str(args.reviewed_network),
                            '--ynx-reviewed-network-sha256', args.reviewed_network_sha256,
                            '--ynx-reviewed-run-id', args.reviewed_run_id]
        receipt_path = args.operation_root / 'operation.json'
        receipt = {'command': command, 'binarySHA256': args.sha256, 'profileID': args.profile_id,
                   'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   'state': 'starting', 'routeReady': False,
                   'class': 'owned backend operation only; no platform admission or page success',
                   'directoryBinding': directory_binding}
        def save():
            receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
        save()
        stopping = False
        def request_stop(signum, frame):
            nonlocal stopping
            stopping = True
        signal.signal(signal.SIGINT, request_stop)
        signal.signal(signal.SIGTERM, request_stop)
        logging = 'info'
        if args.ack_diagnostics:
            logging += ',nym_client_core::client::real_messages_control::acknowledgement_control::acknowledgement_listener=trace,nym_client_core::client::received_buffer=trace,nym_socks5_client_core::socks::mixnet_responses=trace'
        receipt['logging'] = logging; save()
        with (args.operation_root / 'client.log').open('wb') as log:
            child = subprocess.Popen(command, env={'PATH': '/usr/bin:/bin', 'RUST_LOG': logging, 'NO_COLOR': '1'},
                                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding='utf-8', errors='replace')
            def drain():
                for line in child.stdout:
                    log.write(sanitize_log(line).encode()); log.flush()
            reader = threading.Thread(target=drain, daemon=True); reader.start()
            receipt.update(pid=child.pid, supervisorPID=os.getpid(), state='running_unverified'); save()
            print(json.dumps({'pid': child.pid, 'supervisorPID': os.getpid(), 'receipt': str(receipt_path)}), flush=True)
            started = time.monotonic()
            while child.poll() is None and not stopping:
                if args.max_seconds is not None and time.monotonic() - started >= args.max_seconds:
                    stopping = True
                    receipt['deadlineReached'] = True
                    break
                time.sleep(0.2)
            if child.poll() is None:
                child.send_signal(signal.SIGINT)
                try:
                    child.wait(timeout=12)
                    receipt['termination'] = 'SIGINT'
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=5)
                    receipt['termination'] = 'SIGKILL; storage validation required before restart'
            reader.join(timeout=2)
            receipt.update(exitCode=child.returncode, processReaped=child.poll() is not None,
                           keysUnchanged=keys_before == binding(profile),
                           configUnchanged=digest(config) == args.config_sha256,
                           state='stopped' if stopping else 'exited',
                           finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            save()
            print(json.dumps({k: receipt[k] for k in ['state', 'exitCode', 'processReaped', 'keysUnchanged', 'configUnchanged']}), flush=True)
            return 0 if receipt['keysUnchanged'] and receipt['configUnchanged'] and child.returncode == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
