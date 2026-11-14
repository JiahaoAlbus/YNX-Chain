"""Independent Mac PUBLIC QA glue, never normal Browser/Root/NE admission.

The full immutable directory is captured from the original pinned child. Candidate
membership comes from its typed Rust sideband, not a Python Recipient codec. Init
still performs the official separate validator ENTRY fetch; CDN bytes are not
silently installed into that client. Private key contents are never opened here.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import threading
import time
import uuid

from qa_directory_capture import parse_directory_output, require_terminal_capture

PR = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing')
O = PR/'nym-qa-cdn-fullfeature-20261108'
R2 = PR.parent/'r2-20261107/nym'
BUILD = O/'wss-successor-build-20261108T015802Z-41f1c5/receipt.json'
BUILD_SHA = 'b796d33f881cf34204a7f8e084c06134699a56e1ef522585a2610f5d142ce17c'
PROPOSAL_SHA = '815639409a91819f70018e5cec5ec5e126a87eb2529080ce856403f4797badea'
RUNTIME_SHA = '331afc307bd38c5a8adcddc25f0e333790bf332a61661ce1d800412917a9cb00'
GIB = 1024**3
CURL_METRICS = ('{"response_code":%{response_code},"ssl_verify_result":%{ssl_verify_result},'
                '"proxy_used":%{proxy_used},"remote_ip":"%{remote_ip}","time_total":%{time_total}}')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(name, path, pin):
    if sha(path) != pin:
        raise ValueError('source-pin-mismatch:' + name)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def fresh_profile_id(value):
    if not re.fullmatch(r'ynx-route-bundled-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', value):
        raise ValueError('profile-id-not-protected-init-compatible')
    return value


def fixed_directory_errors(stdout, stderr):
    """Bounded vocabulary only; no URLs, identities, arbitrary header/error text."""
    labels = re.findall(rb'\b(?:qa-(?:directory|cdn)-[a-z0-9-]{1,96}|PolicyExpired|StepTimedOut)\b', stdout+stderr)
    return sorted({x.decode('ascii') for x in labels})[:16]


class SafeLines:
    """Drop PEM and private/secret lines before capture, parsing, or hashing."""
    def __init__(self):
        self.pem = False

    def accept(self, line):
        upper = line.upper()
        if b'-----BEGIN ' in upper:
            self.pem = True
        withheld = self.pem or any(x in upper for x in (b'PRIVATE KEY', b'PRIVATE_KEY', b'SECRETKEY', b'SECRET_KEY'))
        if b'-----END ' in upper:
            self.pem = False
        return None if withheld else line


def configure(r2, guard, producer, binary):
    """Reuse the official existing QA lifecycle with narrow corrected callees."""
    r2.BINARY, r2.PIN = binary, RUNTIME_SHA
    original_redact = r2.redact
    r2.redact = lambda text: '[sensitive-line-withheld]' if re.search(r'PRIVATE KEY|private_key|SecretKey|secret_key', text, re.I) else original_redact(text)

    class Child(r2.Child):
        def __init__(self, owner, label, command, limit, runtime=False, entry=None):
            self.owner, self.label, self.command, self.limit = owner, label, command, limit
            self.runtime, self.entry = runtime, entry
            self.public_directory = label.startswith('directory-')
            self.data = bytearray(); self.stderr = bytearray(); self.byteCounts = [0, 0]
            self.eof = [False, False]; self.closed = [False, False]; self.read_errors = []
            self.overflow = False; self.events = []; self.errors = []
            self.marker = False; self.gatewayMatched = False; self.finalConfig = False
            self.publicAddressSHA256 = None; self.lock = threading.Lock()
            self.started = r2.stamp(); self.stopped = None; self.forced = False
            self.threads = []; self.cleanup_confirmed = False
            custody = owner.out/('owned-' + str(len(owner.children)))
            custody.mkdir(mode=0o700)
            # Only the frozen ownership/cleanup implementation is used here;
            # its Cargo runner and 1800s work budget are never called.
            self.custodian = guard.Build({'requestedLimitsNotYetGranted':
                                         {'aggregateSeconds': 1800, 'cleanupReserveSeconds': 15}},
                                        custody, time.monotonic())
            self.process = subprocess.Popen(command, env=owner.environment, stdin=subprocess.DEVNULL,
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                            start_new_session=True, bufsize=0)
            # Adoption precedes getpgid, fstat, thread setup, logging, or any other
            # fallible work. Even a partially constructed Child remains owned.
            self.pid = self.pgid = self.process.pid
            owner.children.append(self)
            self.custodian.children.append(self.process); self.custodian.groups.add(self.pid)
            record = dict(name=label, pid=self.pid, pgid=self.pid, utc=r2.now())
            self.custodian.steps.append(record); self.custodian.child_records[self.process] = record
            try:
                if os.getpgid(self.pid) != self.pid:
                    raise r2.Failed('owned-child-group-mismatch')
            except ProcessLookupError:
                if self.process.poll() is None:
                    raise
            for index, stream in enumerate((self.process.stdout, self.process.stderr)):
                thread = threading.Thread(target=self.drain, args=(index, stream), daemon=True)
                thread.start(); self.threads.append(thread)
            owner.event('child-start', dict(label=label, pid=self.pid, pgid=self.pgid, started=self.started))

        def drain(self, index, stream):
            partial = b''; safe = SafeLines()
            try:
                original = os.fstat(stream.fileno())
                if not stat.S_ISFIFO(original.st_mode):
                    raise ValueError('owned-output-not-pipe')
                while True:
                    current = os.fstat(stream.fileno())
                    if (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
                        raise ValueError('owned-output-fd-replaced')
                    block = stream.read(65536)
                    if not block:
                        self.eof[index] = True
                        break
                    with self.lock:
                        self.byteCounts[index] += len(block)
                        cap = (self.limit if index == 0 and not self.runtime else 1048576)
                        if self.public_directory and index == 1:
                            cap = 524288
                        if self.byteCounts[index] > cap:
                            self.overflow = True
                        if self.public_directory and not self.overflow:
                            (self.data if index == 0 else self.stderr).extend(block)
                    if self.public_directory:
                        continue
                    partial += block
                    while b'\n' in partial:
                        line, partial = partial.split(b'\n', 1)
                        clean = safe.accept(line)
                        if clean is not None:
                            with self.lock:
                                if index == 0 and not self.runtime and len(self.data)+len(clean)+1 <= self.limit:
                                    self.data.extend(clean+b'\n')
                            self.line(clean.decode('utf-8', 'replace'))
                    # curl %{json} is one bounded public metrics line and can
                    # exceed 8KiB on this system. The stdout operation cap still
                    # applies; runtime/error lines retain their smaller bound.
                    line_cap = self.limit if index == 0 and not self.runtime else 8192
                    if len(partial) > line_cap:
                        self.overflow = True
                        partial = b''
                if partial:
                    clean = safe.accept(partial)
                    if clean is not None:
                        if index == 0 and not self.runtime:
                            self.data.extend(clean)
                        self.line(clean.decode('utf-8', 'replace'))
            except BaseException as error:
                with self.lock:
                    self.read_errors.append(type(error).__name__)
            finally:
                stream.close(); self.closed[index] = True

        def receipt(self):
            value = super().receipt()
            value.update(actualFDClosed=self.closed, outputReadErrors=self.read_errors,
                         cleanupConfirmed=self.cleanup_confirmed)
            return value

    r2.Child = Child

    class Experiment(r2.Experiment):
        def __init__(self, args):
            super().__init__(args)
            self.profileID = fresh_profile_id('ynx-route-bundled-' + str(uuid.uuid4()))
            self.profile = self.home/'.nym/socks5-clients'/self.profileID
            if 'HOME' in os.environ:
                self.environment['HOME'] = os.environ['HOME']
            else:
                self.environment.pop('HOME', None)
            self.case_deadline = self.end; self.end -= 20
            self.policy_expiries = {}; self.runtime_expiry = None; self.parsed = {}; self.capture_deadlines = {}

        def check(self):
            super().check()
            if self.runtime_expiry is not None and time.time() >= self.runtime_expiry:
                raise r2.Failed('runtime-stage-absolute-policy-expired')

        def event(self, kind, value):
            if kind == 'executor-start':
                value = dict(value, environmentScope='HOME unchanged; fresh dedicated NYM_HOME_DIR',
                             initDirectoryDependency='Official independent validator ENTRY refetch, not CDN adoption')
            super().event(kind, value)

        def monitor(self):
            # Cancellation is performed by the retained original child custodians
            # in final-cleanup, never by unverified numeric PGIDs in this thread.
            while not self.monitorDone.wait(.75):
                try:
                    self.sample_resources()
                    if time.monotonic() >= self.end:
                        raise r2.Failed('case-work-deadline')
                except BaseException as error:
                    if self.resourceFailure is None:
                        self.resourceFailure = dict(stage=self.stage, type=type(error).__name__,
                                                    message=r2.redact(str(error)), **r2.stamp())
                    return

        def sample_resources(self):
            rows = [row for child in list(self.children) for row in child.custodian.owned()]
            self.peakRSS = max(self.peakRSS, sum(row['rss'] for row in rows))
            if self.peakRSS > GIB or any(c.overflow for c in self.children):
                raise r2.Failed('owned-RSS-or-output-limit')
            facts = producer.facts()
            if facts['homeFreeBytes'] < 2*GIB or facts['memoryFreePercent'] < 20 or facts['WDFreeBytes'] < 16*GIB:
                raise r2.Failed('runtime-resource-floor')
            if sum(f.stat().st_size for f in self.out.rglob('*') if f.is_file() and not f.is_symlink()) > 256*1024**2:
                raise r2.Failed('new-disk-limit')

        def stop_child(self, child):
            if child.stopped is not None:
                return child.process.returncode
            try:
                if child.process.poll() is None:
                    remaining = child.custodian.cleanup()
                else:
                    child.process.wait(); child.custodian.record_child_outcomes()
                    remaining = child.custodian.owned()
            except BaseException:
                remaining = [{'state': 'UNKNOWN', 'originalPID': child.pid}]
            # A post-Popen setup failure may leave a stream without a reader.
            # Once the child is reaped, close that owned FD explicitly. Missing
            # reader/EOF remains a DATA rejection, never fabricated output.
            if child.process.poll() is not None:
                for index, pipe in enumerate((child.process.stdout, child.process.stderr)):
                    if index >= len(child.threads):
                        pipe.close(); child.closed[index] = True
            for thread in child.threads:
                thread.join(timeout=1)
            if remaining or child.process.returncode is None or any(t.is_alive() for t in child.threads) or not all(child.closed):
                path = child.custodian.case/'cleanup-UNKNOWN.json'
                if not path.exists():
                    r2.write_new(path, dict(originalChildPID=child.pid, replayForbidden=True, **r2.stamp()))
                child.custodian.custody(path, [])
                for index, pipe in enumerate((child.process.stdout, child.process.stderr)):
                    if index >= len(child.threads):
                        pipe.close(); child.closed[index] = True
                # No new phase and no release of the outer profile lock while an
                # original FD/thread is still owned. Reconcile without re-init.
                while any(t.is_alive() for t in child.threads) or not all(child.closed):
                    time.sleep(.5)
                raise r2.Failed('owned-cleanup-was-UNKNOWN-no-next-phase')
            child.cleanup_confirmed = True; child.stopped = r2.stamp()
            child.forced = child.process.returncode in (-signal.SIGKILL, -signal.SIGTERM)
            child.custodian.groups.clear(); child.custodian.identities.clear()
            if child.runtime:
                self.runtime_expiry = None
            self.event('child-reaped', child.receipt())
            if not all(child.eof) or child.read_errors:
                raise r2.Failed('owned-output-not-complete')
            return child.process.returncode

        def policy(self, label, selection=None):
            self.check(); self.policyCount += 1
            run = 'r2-' + str(self.policyCount) + '-' + str(uuid.uuid4()); issued = int(time.time())
            expiry = min(issued+110, int(time.time()+self.end-time.monotonic()-3))
            if selection:
                expiry = min(expiry, selection['expiresAt'])
            if expiry <= issued+1:
                raise r2.Failed('insufficient-fresh-policy-budget')
            value = dict(schema='YNX_NYM_REVIEWED_NETWORK_V1', runID=run,
                         stage='route-runtime' if selection else 'directory-bootstrap', issuedAt=issued, expiresAt=expiry,
                         endpoints=selection['endpoints'] if selection else r2.ENDPOINTS)
            if selection:
                value.update(directoryEpoch=selection['epoch'], directorySHA256=selection['digests'], entryIdentity=selection['entryIdentity'])
            else:
                value['networkDefaultsSHA256'] = r2.BOOTSTRAP_SOURCE
            path = self.out/(label+'-policy.json'); r2.write_new(path, value)
            self.policy_expiries[label] = expiry
            return [str(binary), '--no-banner', '--ynx-reviewed-network', str(path),
                    '--ynx-reviewed-network-sha256', sha(path), '--ynx-reviewed-run-id', run]

        def directory(self, label):
            self.stage = label; self.check()
            # Verify build/source inputs before fixing the once-only network clock.
            producer.verified_build(BUILD, BUILD_SHA, PROPOSAL_SHA)
            issued = int(time.time()); expires = min(issued+120, int(time.time()+self.end-time.monotonic()-3))
            if expires <= issued+1:
                raise r2.Failed('insufficient-CDN-budget')
            run = 'qa-dir-' + uuid.uuid4().hex
            plan = self.out/(label+'-cdn-plan.json')
            r2.write_new(plan, dict(schema='YNX_NYM_QA_CDN_DIRECTORY_V1', purpose='fresh-complete-directory-only',
                                   runID=run, issuedAt=issued, expiresAt=expires, networkDefaultsSHA256=r2.BOOTSTRAP_SOURCE,
                                   origin='https://cdn1.media-platform.net', addresses=['172.104.178.252']))
            deadline = time.monotonic()+max(0, expires-time.time())
            child = Child(self, label, [str(binary), '--no-banner', 'ynx-qa-cdn-directory', '--plan', str(plan),
                                       '--plan-sha256', sha(plan), '--run-id', run], 16777217)
            while child.process.poll() is None:
                self.check()
                if time.monotonic() >= deadline+2:
                    raise r2.Failed('CDN-terminal-observation-deadline')
                time.sleep(.05)
            try:
                code = self.stop_child(child)
            finally:
                # Preserve the actual callee exit/fixed diagnostic BEFORE any
                # generic DATA/EOF rejection. This is not success or authority.
                with child.lock:
                    fixed_errors = fixed_directory_errors(bytes(child.data), bytes(child.stderr))
                    observation = dict(runID=run, planSHA256=sha(plan), binarySHA256=RUNTIME_SHA,
                                       issuedAt=issued, expiresAt=expires, originalExit=child.process.returncode,
                                       originalChildReaped=child.process.returncode is not None,
                                       actualEOF=list(child.eof), actualFDClosed=list(child.closed),
                                       outputBytes=list(child.byteCounts), fixedErrorLabels=fixed_errors)
                r2.write_new(self.out/(label+'-capture-observation.json'), observation)
            if code != 0:
                self.event('directory-callee-failure', observation)
                raise r2.Failed(label+'-client-exit-'+str(code)+'-fixed-errors:'+','.join(fixed_errors))
            require_terminal_capture(code, child.eof[0], child.eof[1], child.overflow, bool(child.read_errors),
                                     expires, int(deadline*1e9), time.time(), time.monotonic_ns())
            parsed = parse_directory_output(bytes(child.data), bytes(child.stderr), run)
            self.parsed[id(parsed.value)] = parsed
            self.capture_deadlines[id(parsed.value)] = (expires, int(deadline*1e9))
            parts = {k: json.dumps(parsed.value[k], separators=(',', ':'), ensure_ascii=False).encode() for k in ('basic', 'described', 'epoch')}
            for key, data in parts.items():
                with (self.out/(label+'-'+key+'.json')).open('xb') as stream:
                    os.fchmod(stream.fileno(), 0o600); stream.write(data)
            self.event('same-owned-CDN-capture', dict(payloadSHA256=parsed.payload_sha256, runID=run,
                         issuedAt=issued, expiresAt=expires, binarySHA256=RUNTIME_SHA, planSHA256=sha(plan),
                         entryCandidates=len(parsed.entry_node_ids), exitCandidates=len(parsed.exit_node_ids),
                         childReaped=True, bothEOF=True, normalAuthority=False))
            return parsed.value, [hashlib.sha256(parts[k]).hexdigest() for k in ('basic', 'described', 'epoch')]

        def select(self, value, digests, previous=None):
            parsed = self.parsed.get(id(value))
            if parsed is None or parsed.value is not value:
                raise r2.Failed('selection-not-same-owned-capture')
            capture_wall, capture_monotonic = self.capture_deadlines[id(value)]
            if time.time() >= capture_wall or time.monotonic_ns() >= capture_monotonic:
                raise r2.Failed('selection-capture-expired-no-restamp')
            nodes = value['basic']['nodes']['data']; details = {x['node_id']: x['description'] for x in value['described']['data']}
            epoch = value['epoch']; meta = value['basic']['metadata']; length = epoch['epoch_length']
            start = dt.datetime.fromisoformat(epoch['current_epoch_start'].replace('Z', '+00:00')).timestamp()
            end = start+length['secs']; now = time.time()
            refreshed = meta['refreshed_at'].split(' '); main, dot, fraction = refreshed[1].partition('.')
            refresh = dt.datetime.fromisoformat(refreshed[0]+'T'+main+('.'+fraction[:6] if dot else '')+'+00:00').timestamp()
            if meta['status'] is not None or meta['absolute_epoch_id'] != epoch['total_elapsed_epochs'] or not 600 <= length['secs'] <= 86400 or length['nanos'] != 0 or not start <= now or now+300 >= end or not -60 <= now-refresh <= length['secs']:
                raise r2.Failed('SERVICE_STALE_OR_EXPIRING_DIRECTORY')
            entries = []; exits = []
            for node in nodes:
                score = float(node['performance'])
                if not 0 <= score <= 1:
                    continue
                if node['node_id'] in parsed.entry_node_ids:
                    host = node['entry']['hostname']
                    if not all(ipaddress.ip_address(x).is_global for x in node['ip_addresses']) or not re.fullmatch(r'(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z][a-zA-Z0-9-]*', host):
                        continue
                    entries.append((-score, node['node_id'], node))
                if node['node_id'] in parsed.exit_node_ids:
                    exits.append((-score, node['node_id'], node, details[node['node_id']]['network_requester']['address']))
            if previous:
                entries = [x for x in entries if x[2]['ed25519_identity_pubkey'] == previous['entryIdentity']]
                exits = [x for x in exits if x[3] == previous['requester']]
            if not entries or not exits:
                raise r2.Failed('no-current-same-typed-role-pair')
            entry = min(entries, key=lambda x: x[:2])[2]; exit = min(exits, key=lambda x: x[:2]); endpoint = entry['entry']
            selection = dict(epoch=epoch['total_elapsed_epochs'], expiresAt=int(end-60), entryID=entry['node_id'],
                             entryIdentity=entry['ed25519_identity_pubkey'], requesterID=exit[2]['node_id'], requester=exit[3],
                             digests=digests, endpoints=r2.ENDPOINTS+[dict(purpose='gatewayWSS', scheme='wss', host=endpoint['hostname'], port=endpoint['wss_port'], addresses=entry['ip_addresses'])])
            self.event('current-selection', dict(epoch=selection['epoch'], expiresAt=selection['expiresAt'], entryID=selection['entryID'], requesterID=selection['requesterID'],
                         entryIdentitySHA256=hashlib.sha256(selection['entryIdentity'].encode()).hexdigest(), requesterSHA256=hashlib.sha256(selection['requester'].encode()).hexdigest(), samePair=previous is not None))
            return selection

        def run(self, label, args, limit=65536, seconds=60, runtime=False, entry=None):
            fresh_profile_id(self.profileID)
            self.check()
            if runtime:
                self.runtime_expiry = self.policy_expiries[label]
            return super().run(label, args, limit, seconds, runtime, entry)

        def https(self, label):
            self.stage = label
            body_path = self.out/(label+'.body')
            command = ['/usr/bin/curl', '--disable', '--proxy', 'socks5h://127.0.0.1:'+str(self.port),
                       '--noproxy', '', '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '0',
                       '--retry', '0', '--connect-timeout', '45', '--max-time', '60', '--max-filesize', '65536',
                       '--output', str(body_path), '--write-out', CURL_METRICS, r2.TARGET]
            # Only the five required fixed-vocabulary fields, not curl's growing
            # %{json} object/certificate text, cross the pipe/capture boundary.
            metrics = json.loads(self.run(label, command, seconds=65))
            body = body_path.read_bytes()
            result = dict(http=metrics.get('response_code'), tlsVerify=metrics.get('ssl_verify_result'),
                          proxyUsed=metrics.get('proxy_used'), remoteIsLoopback=metrics.get('remote_ip')=='127.0.0.1',
                          bytes=len(body), bodySHA256=hashlib.sha256(body).hexdigest(), elapsed=metrics.get('time_total'))
            self.event('RFC-HTTPS-result', result)
            if result['http'] != 200 or result['tlsVerify'] != 0 or result['proxyUsed'] != 1 or not result['remoteIsLoopback'] or b'RFC 1928' not in body or b'SOCKS' not in body:
                raise r2.Failed('RFC-HTTPS-status-TLS-proxy-body-failed')
            if label != 'rfc-1':
                return
            self.stage = 'DDG-public-once'
            path = self.out/'ddg-public.body'
            command = ['/usr/bin/curl', '--disable', '--proxy', 'socks5h://127.0.0.1:'+str(self.port),
                       '--noproxy', '', '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '0',
                       '--retry', '0', '--connect-timeout', '45', '--max-time', '60', '--max-filesize', '1048576',
                       '--output', str(path), '--write-out', CURL_METRICS,
                       'https://duckduckgo.com/?q=YNX%20browser%20privacy']
            metrics = None; failure = None
            try:
                metrics = json.loads(self.run('DDG-public-once', command, seconds=65))
            except r2.Failed as error:
                failure = r2.redact(str(error))
                for child in self.children:
                    if child.label == 'DDG-public-once' and child.stopped is None:
                        self.stop_child(child)
            body = path.read_bytes() if path.exists() else b''; lower = body.lower()
            captcha = any(x in lower for x in (b'anomaly-modal', b'unfortunately, bots use duckduckgo too', b'/anomaly.js'))
            status = metrics.get('response_code') if metrics else None
            state = 'CAPTCHA' if captcha else ('HTTP_RESTRICTED' if status and status != 200 else ('UNVERIFIED_CONTENT' if status == 200 else 'REQUEST_FAILED'))
            result = dict(siteStatus=state, http=status, captcha=captcha, requestFailure=failure,
                          bodyBytes=len(body), bodySHA256=hashlib.sha256(body).hexdigest(),
                          tlsVerify=metrics.get('ssl_verify_result') if metrics else None,
                          retryOrRotation=False, siteResultDoesNotGrantOrRevokeRouteSafety=True)
            r2.write_new(self.out/'ddg-public-result.json', result); self.event('DDG-site-diagnostic', result)

    return Experiment


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--execute', action='store_true', required=True)
    parser.parse_args(); os.umask(0o077)
    if sha(Path(__file__).with_name('qa_directory_capture.py')) != '57e5a9e0542654b81faf20fa32f94840ff81186ac28e1b847c86bcd18a8659fc':
        raise RuntimeError('DATA-decoder-pin')
    network = load('frozen_once_network', O/'run_cdn_directory_nr_once.py', '092f7077c07ac094b7c91d4da9e92a7c106382e59b1faef704eb4308b23e7643')
    facts = network.facts()
    if facts['memoryFreePercent'] < 35 or facts['homeFreeBytes'] < 2*GIB+64*1024**2 or facts['WDFreeBytes'] < 16*GIB:
        raise RuntimeError('fresh-resource-floor-no-child-created')
    producer = load('frozen_NR_producer', O/'produce_qa_cdn_plan_nr_logfix.py', '9d3e337d6bd65d113182186c11cd2a9d61805af0f774041f0b2693fa8a812622')
    binary, digest = producer.verified_build(BUILD, BUILD_SHA, PROPOSAL_SHA)
    if digest != RUNTIME_SHA:
        raise RuntimeError('runtime-pin')
    r2 = load('original_r2', R2/'r2_executor.py', '330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67')
    guard = load('owned_groups', O/'run_fullfeature_v4.py', 'b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05')
    # Only resource inspection is shared, not normal qualification or process authority.
    producer.facts = network.facts
    Experiment = configure(r2, guard, producer, binary)
    case = R2/('case-cdn-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:6])
    experiment = Experiment(argparse.Namespace(out=case, port=63781, budget_seconds=900))
    signal.signal(signal.SIGINT, lambda *_: setattr(experiment, 'stopRequested', True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(experiment, 'stopRequested', True))
    r2.write_new(case/'driver-binding.json', dict(driverSHA256=sha(Path(__file__)), binarySHA256=digest,
                     buildReceiptSHA256=BUILD_SHA, originalExecutorSHA256=sha(R2/'r2_executor.py'),
                     caseSeconds=900, cleanupReserveSeconds=20, noPrivateKeyReads=True, normalPrivacyAdmission=False))
    return experiment.execute()


if __name__ == '__main__':
    raise SystemExit(main())
