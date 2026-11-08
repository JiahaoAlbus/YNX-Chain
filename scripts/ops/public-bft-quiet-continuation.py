#!/usr/bin/env python3
"""Closed public DATA checks for the original native cutover transaction.

No keys, signing, service mutation, RPC-selected root or approval generation.
The normal driver separately verifies packages and runs the pinned proof CLI.
"""
import argparse
import base64
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import shlex
import sys

ROLES = ('primary', 'singapore', 'silicon-valley', 'seoul')
QUIET = 'quiet-first-registration-v1'
PREFIX = ['preflight', 'backup', 'freeze_mutations', 'pause_authoritative']
BOOTSTRAP = ['export_final_snapshot', 'initialize_candidate', 'deploy_candidate', 'start_candidate', 'verify_candidate']
TAIL = ['verify_pq_continuation', 'start_dependencies', 'verify_continuity', 'switch_ingress', 'verify_public', 'unfreeze_mutations']
CONTEXT_FIELDS = set(('version chainId migrationFile genesisFile stateFile scheduleFile scheduleHash consensusGenesisSHA256 '
    'originalGenesisHash migrationStateHash runtimePlanFile runtimePlanHash engineHeight engineAppHash expectedHeaderHeight '
    'expectedBlockHash expectedStateHeight expectedStateAppHash trustedLightBlockFile trustedLightBlockSHA256 '
    'trustingPeriodNanoseconds maxClockDriftNanoseconds trustLevelNumerator trustLevelDenominator').split())

def need(ok, message):
    if not ok:
        raise ValueError(message)

def unique(pairs):
    out = {}
    for key, value in pairs:
        need(key not in out, 'duplicate public JSON field')
        out[key] = value
    return out

def decode(raw):
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid JSON number')))

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def pin(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None and value != '0' * 64

def decimal(value):
    return type(value) is str and re.fullmatch('[1-9][0-9]*', value) is not None and int(value) <= (1 << 63) - 1

def identity(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_mtime_ns, value.st_ctime_ns)

def original(path, limit=96 << 20):
    p = Path(path)
    need(p.is_absolute() and str(p) == path and str(p.resolve(strict=True)) == path, 'canonical absolute original path required')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= limit, 'bounded original regular file required')
        raw = bytearray()
        while chunk := os.read(fd, min(1 << 20, limit + 1 - len(raw))):
            raw.extend(chunk)
            need(len(raw) <= limit, 'original file grew beyond bound')
        need(len(raw) == before.st_size and identity(before) == identity(os.fstat(fd)) == identity(p.lstat()), 'original changed during read')
        return bytes(raw)
    finally:
        os.close(fd)

def load(path, digest=None, limit=96 << 20):
    raw = original(str(path), limit)
    if digest is not None:
        need(pin(digest) and sha(raw) == digest, 'original differs from independent pin')
    return decode(raw), raw

def digest_original(path, limit):
    p = Path(path)
    need(p.is_absolute() and str(p.resolve(strict=True)) == str(p), 'canonical original file required')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= limit, 'bounded public original required')
        h, count = hashlib.sha256(), 0
        while chunk := os.read(fd, 1 << 20):
            count += len(chunk)
            need(count <= limit, 'public original grew beyond bound')
            h.update(chunk)
        need(count == before.st_size and identity(before) == identity(os.fstat(fd)) == identity(p.lstat()), 'public original changed')
        return h.hexdigest()
    finally:
        os.close(fd)

def private_root(path):
    p = Path(path)
    s = p.lstat()
    need(p.is_absolute() and str(p.resolve(strict=True)) == str(p) and stat.S_ISDIR(s.st_mode) and
         stat.S_IMODE(s.st_mode) == 0o700 and s.st_uid == os.geteuid(), 'original canonical same-owner private transaction required')
    return p

def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def publish(path, value):
    raw = (json.dumps(value, separators=(',', ':'), sort_keys=True) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as out:
            out.write(raw)
            out.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_dir(Path(path).parent)
    return sha(raw)

def pairs(phases):
    return [(p, state) for p in phases for state in ('started', 'passed')]

def expected_prefix():
    return pairs(PREFIX) + [('preparation', 'awaiting_final_snapshot_authorization')] + pairs(BOOTSTRAP)

def journal(root, expected):
    raw = original(str(root / 'journal.jsonl'), 1 << 20)
    need(raw.endswith(b'\n'), 'partial journal retained')
    rows = [decode(line) for line in raw.splitlines()]
    need(len(rows) == len(expected), 'incomplete, repeated or UNKNOWN transaction journal')
    for row, pair in zip(rows, expected):
        need(set(row) == {'phase', 'status', 'at'} and (row['phase'], row['status']) == pair and
             re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', row['at']) is not None, 'transaction phase/order changed')
    return raw

def selected_plan(path, digest):
    p, _ = load(path, digest)
    need(p.get('version') == 'YNX-PRODUCTION-OPERATOR/v1', 'original operator plan required')
    mode = p.get('bootstrapRegistrationMode', '')
    need(mode in ('', QUIET), 'unsupported bootstrap mode')
    if mode:
        need(not p.get('pqSchedule') and not p.get('pqScheduleHash') and not p.get('heightHaltSessionId'), 'quiet only selects original bootstrap without halt')
    return p

def approval(root):
    value, raw = load(root / 'approval.json', limit=1 << 20)
    need(value.get('approved') is True and value.get('custodyProfile') in ('single-app-gateway/v1', 'single-app-same-owner-inplace/v1') and
         value.get('authoritativeCommit') and value.get('operatorPreparationPlanSha256'), 'original full native approval required')
    if value.get('custodyProfile') == 'single-app-same-owner-inplace/v1':
        helper = Path(__file__).resolve().parent / 'remote' / 'public-bft-capture-snapshot-source.py'
        spec = importlib.util.spec_from_file_location('same_owner_retained_projection', helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.same_owner_preparation(value, root.name, preparation_only=False)
    # The shell invokes both original approval validators. This additional check
    # preserves the expiry while subsequent normal driver phases run.
    until = datetime.datetime.fromisoformat(value['expiresAt'].replace('Z', '+00:00'))
    need(until.tzinfo is not None and until > datetime.datetime.now(datetime.timezone.utc), 'original approval expired; keep pause/UNKNOWN')
    return value, raw

def pause(root_path, plan_path, plan_pin):
    root = private_root(root_path)
    plan = selected_plan(plan_path, plan_pin)
    need(plan.get('bootstrapRegistrationMode') == QUIET, 'explicit pinned quiet bootstrap required')
    a, a_raw = approval(root)
    need(a['operatorPlanSha256'] == plan_pin, 'quiet plan differs from original final approval')
    prefix = journal(root, expected_prefix())
    ready, ready_raw = load(root / 'candidate/verify-result.json', limit=1 << 20)
    need(ready.get('version') == 'YNX-QUIET-BOOTSTRAP-READY/v1' and ready.get('transactionId') == root.name and
         ready.get('operatorPlanSHA256') == plan_pin and ready.get('ready') is True and ready.get('dryRun') is False and
         ready.get('pqActivationVerified') is False and ready.get('publicIngressChanged') is False, 'normal quiet ready observation required')
    attempt = root / 'quiet-bootstrap-attempt'
    attempt.mkdir(mode=0o700)
    fsync_dir(root)
    publish(attempt / 'intent.json', {'status': 'unknown', 'automaticRetry': False})
    event = {'phase': 'bootstrap', 'status': 'awaiting_pq_activation', 'at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    fd = os.open(root / 'journal.jsonl', os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    try:
        os.write(fd, (json.dumps(event, separators=(',', ':')) + '\n').encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    paused_journal = journal(root, expected_prefix() + [('bootstrap', 'awaiting_pq_activation')])
    result = {'version': 'YNX-QUIET-BOOTSTRAP-PAUSED/v1', 'transactionId': root.name,
              'approvalSHA256': sha(a_raw), 'operatorPlanSHA256': plan_pin, 'readySHA256': sha(ready_raw),
              'prefixSHA256': sha(prefix), 'journalSHA256': sha(paused_journal), 'expiresAt': a['expiresAt'],
              'status': 'awaiting_pq_activation', 'nativeRemainsPaused': True, 'mutationsRemainFrozen': True,
              'publicIngressChanged': False, 'pqActivationVerified': False, 'automaticRetry': False}
    publish(attempt / 'result.json', result)
    publish(root / 'continuation-attempt/result.json', {'status': 'awaiting_pq_activation', 'automaticRetry': False})
    return result

def paused(root, plan_pin):
    a, a_raw = approval(root)
    p, _ = load(root / 'quiet-bootstrap-attempt/result.json', limit=1 << 20)
    need(p.get('version') == 'YNX-QUIET-BOOTSTRAP-PAUSED/v1' and p.get('transactionId') == root.name and
         p.get('approvalSHA256') == sha(a_raw) and p.get('operatorPlanSHA256') == plan_pin == a['operatorPlanSha256'] and
         p.get('expiresAt') == a['expiresAt'] and p.get('status') == 'awaiting_pq_activation' and
         p.get('nativeRemainsPaused') is True and p.get('mutationsRemainFrozen') is True and
         p.get('publicIngressChanged') is False and p.get('pqActivationVerified') is False, 'original durable quiet pause mismatch')
    ready = original(str(root / 'candidate/verify-result.json'), 1 << 20)
    need(sha(ready) == p['readySHA256'], 'original quiet ready changed')
    return p

def continuation(root_path, bootstrap_path, bootstrap_pin, packet_path, packet_pin):
    root = private_root(root_path)
    old = selected_plan(bootstrap_path, bootstrap_pin)
    need(old.get('bootstrapRegistrationMode') == QUIET, 'original quiet bootstrap required')
    stopped = paused(root, bootstrap_pin)
    c, raw = load(packet_path, packet_pin, 1 << 20)
    fields = {'version', 'transactionId', 'bootstrapPlanSHA256', 'transitionId', 'transitionRoot',
              'transitionApproval', 'transitionApprovalSHA256', 'currentPackage', 'currentOperatorPlanSHA256',
              'runtimeCommit', 'runtimeManifestSHA256', 'proof'}
    need(set(c) == fields and c['version'] == 'YNX-QUIET-PQ-CONTINUATION-INPUT/v1' and c['transactionId'] == root.name and
         c['bootstrapPlanSHA256'] == bootstrap_pin and c['transitionId'] == root.name, 'closed original transaction continuation inputs required')
    # These are independently pinned DATA selections. They do not mint a Root
    # or replace either original protected cutover or transition approvals.
    need(all(type(v) is str and not any(ord(ch) < 32 for ch in v) for k, v in c.items() if k != 'proof') and
         re.fullmatch('[0-9a-f]{40}', c['runtimeCommit']) and pin(c['runtimeManifestSHA256']), 'closed canonical continuation scalars required')
    transition = private_root(c['transitionRoot'])
    need(transition.name == c['transitionId'], 'transition root identity differs')
    new = selected_plan(str(Path(c['currentPackage']) / 'common/operator-plan.json'), c['currentOperatorPlanSHA256'])
    need(not new.get('bootstrapRegistrationMode') and new.get('pqSchedule') and pin(new.get('pqScheduleHash')), 'normal independently pinned PQ target required')
    for key in ('version', 'chainId', 'validatorManifestSHA256', 'consensusGenesis', 'consensusGenesisSHA256',
                'originalGenesisHash', 'migrationStateHash', 'stateLayout', 'runtimePlan', 'runtimePlanHash'):
        need(old[key] == new[key], 'original identity changed: ' + key)
    old_roles = {r['role']: r for r in old['roles']}
    new_roles = {r['role']: r for r in new['roles']}
    need(set(old_roles) == set(new_roles) == set(ROLES), 'four original roles required')
    for role in ROLES:
        for key in ('role', 'home', 'abciState', 'legacyKeyPath', 'legacyStatePath', 'nodeKeyPath'):
            need(old_roles[role][key] == new_roles[role][key], 'original state/custody path changed')
    a, _ = load(c['transitionApproval'], c['transitionApprovalSHA256'], 1 << 20)
    need(a.get('version') == 'YNX-OPERATOR-TRANSITION-APPROVAL/v1' and a.get('approved') is True and a.get('phase') == 'start' and
         a.get('transitionId') == c['transitionId'] and a.get('cutoverTransactionId') == root.name and
         a.get('oldOperatorPlanSHA256') == bootstrap_pin and a.get('nextOperatorPlanSHA256') == c['currentOperatorPlanSHA256'] and
         a.get('runtimeCommit') == c['runtimeCommit'] and a.get('runtimeManifestSHA256') == c['runtimeManifestSHA256'] and
         a.get('oldRuntimeCommit') == c['runtimeCommit'] and a.get('oldRuntimeManifestSHA256') == c['runtimeManifestSHA256'], 'original external start approval differs')
    schedule_raw = base64.b64decode(new['pqSchedule'], validate=True)
    schedule = decode(schedule_raw)
    cp = a['checkpoint']
    need(set(cp) == {'height', 'appHash', 'registryRoot', 'registryEventCount'} and
         decimal(cp['height']) and decimal(cp['registryEventCount']) and pin(cp['appHash']) and pin(cp['registryRoot']) and
         int(cp['height']) == schedule['registryHeight'] and cp['registryRoot'] == schedule['registryRoot'] and
         int(cp['registryEventCount']) == schedule['registryEventCount'], 'approved complete registry checkpoint differs')
    need(schedule['authorizedAt'] == schedule['registryHeight'] + 1 and schedule['paramsUpdateHeight'] == schedule['authorizedAt'] and
         schedule['validatorUpdateHeight'] == schedule['activationHeight'] - 2 and schedule['activationHeight'] >= schedule['authorizedAt'] + 3, 'original P/U/A order differs')
    evidence = {}
    for role in ROLES:
        need(a['freezeSHA256'][role] == sha(original(str(root / 'candidate/start-attempt' / role / 'marker.json'), 1 << 20)) and
             a['nativePauseSHA256'] == sha(original(str(root / 'candidate/start-attempt/primary/pause-marker.json'), 1 << 20)),
             'transition changed the original retained native freeze/pause')
        entries = {}
        for phase, status in [('quiesce', 'stopped'), ('install', 'installed_not_started'), ('start', 'started_activation_unproven')]:
            entry, entry_raw = load(transition / (phase + '-attempt') / (role + '.result.json'), limit=1 << 20)
            need(entry.get('version') == 'YNX-OPERATOR-TRANSITION-RESULT/v1' and entry.get('status') == status and
                 entry.get('transitionId') == c['transitionId'] and entry.get('cutoverTransactionId') == root.name and
                 entry.get('role') == role and entry.get('oldOperatorPlanSHA256') == bootstrap_pin and
                 entry.get('phase') == phase and entry.get('originalMaterialRetained') is True and entry.get('pqActivationVerified') is False and
                 entry.get('independentFinalityVerified') is False, 'incomplete original role transition')
            need(all(entry['checkpoint'][k] == v for k, v in cp.items()) and entry.get('backupSHA256') == a['backups'][role], 'original stopped checkpoint/backup differs')
            if phase != 'quiesce':
                need(entry.get('nextOperatorPlanSHA256') == c['currentOperatorPlanSHA256'] and
                     entry.get('runtimeCommit') == c['runtimeCommit'] and entry.get('runtimeManifestSHA256') == c['runtimeManifestSHA256'] and
                     all(entry['checkpoint'][k] == v for k, v in cp.items()), 'current transition target/checkpoint differs')
            if phase == 'start':
                need(entry.get('approvalSHA256') == c['transitionApprovalSHA256'] and
                     entry.get('scheduleHash') == new['pqScheduleHash'] and entry.get('schedule') == schedule, 'start receipt differs from external plan/approval')
            entries[phase] = {'sha256': sha(entry_raw), 'value': entry}
        binding, binding_raw = load(transition / 'start-attempt' / (role + '.binding.json'), limit=1 << 20)
        need(binding.get('version') == 'YNX-OPERATOR-TRANSITION-BINDING/v1' and
             all(entries['start']['value'].get(k) == v for k, v in binding.items() if k not in ('version', 'checkpoint')) and
             binding.get('checkpoint') == cp, 'original start binding differs')
        evidence[role] = {'transition': entries, 'bindingSHA256': sha(binding_raw)}
    proof = c['proof']
    need(type(proof) is dict and set(proof) == {'trustContext', 'trustContextSHA256', 'request', 'requestSHA256'}, 'closed proof selection required')
    context, _ = load(proof['trustContext'], proof['trustContextSHA256'], 32 << 10)
    need(set(context) == CONTEXT_FIELDS and all(type(v) is str for v in context.values()) and context['version'] == 'YNX-CONSENSUS-PROOF-TRUST/v1', 'original light trust context required')
    for key in ('chainId', 'consensusGenesisSHA256', 'originalGenesisHash', 'migrationStateHash', 'runtimePlanHash'):
        need(context[key] == new[key], 'proof context differs from current plan: ' + key)
    need(context['scheduleHash'] == new['pqScheduleHash'] and original(context['scheduleFile'], 32 << 10) == schedule_raw, 'proof schedule differs from approved exact bytes')
    need(all(decimal(context[k]) for k in ('expectedHeaderHeight','expectedStateHeight','engineHeight')) and
         pin(context['expectedBlockHash']) and pin(context['expectedStateAppHash']), 'canonical independent proof coordinates required')
    height = int(context['expectedHeaderHeight'])
    need(height > schedule['activationHeight'] and int(context['expectedStateHeight']) == height - 1 and
         int(context['engineHeight']) >= height - 1, 'proof must include a committed active PQ state/header')
    target = (context['expectedHeaderHeight'], context['expectedBlockHash'], context['expectedStateHeight'], context['expectedStateAppHash'])
    request, _ = load(proof['request'], proof['requestSHA256'], 16 << 20)
    need(set(request) == {'version', 'expected', 'proof'} and request['version'] == 'YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1' and
         request['expected'] == dict(chainId=new['chainId'], headerHeight=target[0], blockHash=target[1], stateHeight=target[2], stateAppHash=target[3]), 'original proof target differs')
    return {'input': c, 'inputSHA256': sha(raw), 'pause': stopped, 'plan': new, 'schedule': schedule, 'roles': evidence,
            'proof': proof, 'context': context, 'headerHeight': target[0], 'blockHash': target[1], 'stateHeight': target[2], 'stateAppHash': target[3]}

def resume_check(root_path, plan_path, plan_pin, packet_path, packet_pin):
    root = private_root(root_path)
    result = continuation(root_path, plan_path, plan_pin, packet_path, packet_pin)
    if os.path.lexists(root / 'pq-continuation-attempt'):
        # A fully committed result with a lost stdout is read back, never
        # dispatched again. Every partial or failed attempt remains UNKNOWN.
        need((root / 'pq-continuation-attempt/result.json').is_file(), 'incomplete continuation/UNKNOWN; no redispatch')
        final, _ = load(root / 'pq-continuation-attempt/result.json', limit=1 << 20)
        need(final == {'status': 'passed', 'automaticRetry': False, 'inputSHA256': packet_pin}, 'incomplete original continuation result')
        journal(root, expected_prefix() + [('bootstrap', 'awaiting_pq_activation')] + pairs(TAIL) + [('transaction', 'passed')])
        forward_gate(root_path, plan_path, plan_pin)
        return {**final, 'reconciled': True, 'redispatched': False}
    raw = journal(root, expected_prefix() + [('bootstrap', 'awaiting_pq_activation')])
    need(sha(raw) == result['pause']['journalSHA256'], 'original durable pause journal changed')
    for name in ('dependencies', 'ingress'):
        need(not os.path.lexists(root / name), 'late-phase residual exists; preserve UNKNOWN')
    return {'version': 'YNX-QUIET-PQ-CONTINUATION-PREFLIGHT/v1', 'transactionId': root.name,
            'inputSHA256': packet_pin, 'currentOperatorPlanSHA256': result['input']['currentOperatorPlanSHA256'],
            'activationVerified': False, 'publicIngressChanged': False, 'status': 'ready'}


# Sent by the original fixed driver through its normal authenticated SSH
# transport. It reads only installed public files/process metadata and fixed
# loopback RPCs; no service transition, key/HRS read or remote file creation.
REMOTE_OBSERVE = r'''
import base64,hashlib,json,os,pathlib,shlex,stat,subprocess,sys,urllib.request
p=json.loads(base64.b64decode(sys.argv[1],validate=True)); assert set(p)=={'version','role','transactionId','chainId','nodeId','address','cometSHA256','files','freezeSHA256','pauseSHA256','headerHeight','blockHash'}
assert p['version']=='YNX-PQ-CUTOVER-ROLE-READ/v1' and p['role'] in ('primary','singapore','silicon-valley','seoul') and os.geteuid()==0
unit='ynx-consensus-operator-candidate.service'; installed='/var/lib/ynx-chain/consensus-candidate'
def sha_file(name):
    h=hashlib.sha256()
    with open(name,'rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()
def show(key):return subprocess.check_output(['systemctl','show','--property',key,'--value',unit],timeout=5,text=True).strip()
def check_files():
    assert show('FragmentPath')=='/etc/systemd/system/'+unit and show('DropInPaths')==''
    assert 'path='+installed+'/scripts/start-operator.sh ;' in show('ExecStart')
    for name,digest in p['files'].items():
        q=pathlib.Path(name); st=q.lstat()
        assert stat.S_ISREG(st.st_mode) and str(q.resolve(strict=True))==name and sha_file(name)==digest
    assert sha_file('/var/lib/ynx-chain/mutation-freeze.json')==p['freezeSHA256']
    freeze=json.load(open('/var/lib/ynx-chain/mutation-freeze.json'));assert freeze['transactionId']==p['transactionId'] and freeze['role']==p['role'] and freeze['frozenAt']
    if p['role']=='primary':
        assert sha_file('/var/lib/ynx-chain/block-production-pause.json')==p['pauseSHA256']
        pause=json.load(open('/var/lib/ynx-chain/block-production-pause.json'));assert pause['transactionId']==p['transactionId'] and pause['pausedAt']
def process():
    assert show('ActiveState')=='active'; pid=show('MainPID'); assert pid.isdecimal() and int(pid)>0
    proc=pathlib.Path('/proc')/pid
    def ticks():return (proc/'stat').read_text().rsplit(') ',1)[1].split()[19]
    start=ticks(); assert os.readlink(proc/'exe')==installed+'/bin/ynx-comet' and sha_file(proc/'exe')==p['cometSHA256']
    lines=[s for s in pathlib.Path(installed+'/scripts/start-operator.sh').read_text().splitlines() if s.startswith('exec ')]
    assert len(lines)==1; expected=shlex.split(lines[0]); assert expected[:4]==['exec','env','-i','PATH=/usr/bin:/bin']
    assert (proc/'cmdline').read_bytes()==b'\0'.join(v.encode() for v in expected[4:])+b'\0'
    assert (proc/'environ').read_bytes()==b'PATH=/usr/bin:/bin\0'
    group=show('ControlGroup');assert group.startswith('/') and '..' not in group.split('/')
    assert pid in pathlib.Path('/sys/fs/cgroup'+group+'/cgroup.procs').read_text().splitlines()
    assert ticks()==start and show('MainPID')==pid
    return dict(mainPid=pid,startTicks=start,runningExecutableSHA256=p['cometSHA256'],invocationId=show('InvocationID'))
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def rpc(route):
    with opener.open('http://127.0.0.1:27757/'+route,timeout=10) as r:
        assert r.status==200; raw=r.read((16<<20)+1);assert len(raw)<=16<<20
    value=json.loads(raw); assert set(value)<= {'jsonrpc','id','result'} and 'result' in value
    return value['result']
check_files(); before=process(); status=rpc('status'); info=rpc('abci_info'); peers=rpc('net_info')
block=None if p['headerHeight'] is None else rpc('block?height='+p['headerHeight'])
check_files();after=process();assert before==after
print(json.dumps(dict(version='YNX-PQ-CUTOVER-ROLE-OBSERVATION/v1',role=p['role'],transactionId=p['transactionId'],process=after,status=status,abciInfo=info,netInfo=peers,block=block,installedFilesVerified=True,originalFreezePreserved=True,originalNativePausePreserved=p['role']=='primary',sourceReadOnly=True),separators=(',',':')))
'''

def observation_command(root_path, package, runtime, plan_path, plan_pin, role, packet_path=None, packet_pin=None):
    root = private_root(root_path)
    need(role in ROLES, 'original role required')
    plan = selected_plan(plan_path, plan_pin)
    node, _ = load(Path(package) / 'roles' / role / 'role-manifest.json')
    source, _ = load(Path(runtime) / 'SOURCE.json')
    mode = 'quiet' if packet_path is None else 'pq'
    info = None
    if mode == 'quiet':
        need(plan.get('bootstrapRegistrationMode') == QUIET, 'quiet bootstrap plan required')
        freeze = sha(original(str(root / 'candidate/start-attempt' / role / 'marker.json'), 1 << 20))
        pause_pin = sha(original(str(root / 'candidate/start-attempt/primary/pause-marker.json'), 1 << 20))
        height, block_hash = None, None
    else:
        info = continuation(root_path, plan_path, plan_pin, packet_path, packet_pin)
        need(str(Path(package)) == info['input']['currentPackage'], 'observation package differs from new independent target')
        plan = info['plan']
        freeze = info['roles'][role]['transition']['start']['value']['freezeSHA256']
        pause_pin = info['roles'][role]['transition']['start']['value']['nativePauseSHA256']
        height, block_hash = info['headerHeight'], info['blockHash']
    node = node['node']
    files = {}
    role_root = Path(package) / 'roles' / role
    for relative, target in [('scripts/start-operator.sh', '/var/lib/ynx-chain/consensus-candidate/scripts/start-operator.sh'),
                             ('role-manifest.json', '/var/lib/ynx-chain/consensus-candidate/role-manifest.json'),
                             ('systemd/ynx-consensus-operator-candidate.service', '/etc/systemd/system/ynx-consensus-operator-candidate.service')]:
        files[target] = sha(original(str(role_root / relative), 16 << 20))
    config = role_root / 'config'
    need(config.is_dir() and not config.is_symlink(), 'verified normal configuration required')
    for file in sorted(config.iterdir()):
        need(file.is_file() and not file.is_symlink() and re.fullmatch('[A-Za-z0-9._-]+', file.name), 'closed original config files required')
        files['/var/lib/ynx-chain/consensus-candidate/config/' + file.name] = digest_original(file, 1 << 30)
    # Hash full migration streaming in the normal package verifier; avoid
    # reading private state/custody. The files here are public package inputs.
    for name in ('ynx-comet', 'ynx-consensus-keycheck'):
        files['/var/lib/ynx-chain/consensus-candidate/bin/' + name] = source['binaries'][name]['sha256']
    p = dict(version='YNX-PQ-CUTOVER-ROLE-READ/v1', role=role, transactionId=root.name, chainId=plan['chainId'],
             nodeId=node['nodeId'], address=node['consensusAddress'], cometSHA256=source['binaries']['ynx-comet']['sha256'],
             files=files, freezeSHA256=freeze, pauseSHA256=pause_pin, headerHeight=height, blockHash=block_hash)
    raw = json.dumps(p, separators=(',', ':')).encode()
    need(len(raw) <= 64 << 10, 'bounded fixed observation input required')
    return 'sudo -n /usr/bin/timeout --signal=TERM --kill-after=5 60 /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -B -c ' + shlex.quote(REMOTE_OBSERVE) + ' ' + shlex.quote(base64.b64encode(raw).decode())

def role_observations(root, package, evidence, minimum_height=None, block_hash=None):
    records, common = {}, None
    for role in ROLES:
        node, _ = load(Path(package) / 'roles' / role / 'role-manifest.json')
        node = node['node']
        row, raw = load(Path(evidence) / (role + '.json'), limit=64 << 20)
        need(set(row) == {'version', 'role', 'transactionId', 'process', 'status', 'abciInfo', 'netInfo', 'block',
                         'installedFilesVerified', 'originalFreezePreserved', 'originalNativePausePreserved', 'sourceReadOnly'} and
             row['version'] == 'YNX-PQ-CUTOVER-ROLE-OBSERVATION/v1' and row['role'] == role and row['transactionId'] == root.name and
             row['installedFilesVerified'] is True and row['originalFreezePreserved'] is True and row['sourceReadOnly'] is True and
             row['originalNativePausePreserved'] is (role == 'primary'), 'complete source-qualified original role observation required')
        process = row['process']
        need(set(process) == {'mainPid', 'startTicks', 'runningExecutableSHA256', 'invocationId'} and
             all(re.fullmatch('[1-9][0-9]*', process[k]) for k in ('mainPid', 'startTicks')) and
             pin(process['runningExecutableSHA256']) and re.fullmatch('[0-9a-f]{32}', process['invocationId']), 'actual process incarnation required')
        status = row['status']
        need(status['node_info']['network'] == 'ynx_6423-1' and status['node_info']['id'] == node['nodeId'] and
             status['validator_info']['address'].upper() == node['consensusAddress'].upper() and status['sync_info']['catching_up'] is False,
             'actual local status differs from original role/chain')
        info = row['abciInfo']['response']
        height = int(info['last_block_height'])
        need(info.get('data') == 'ynx-chain-abci' and height >= 0 and int(status['sync_info']['latest_block_height']) >= height, 'incomplete current engine/App observation')
        need(type(info['last_block_app_hash']) is str and len(base64.b64decode(info['last_block_app_hash'], validate=True)) == 32,
             'complete original AppHash required')
        peers = {v['node_info']['id'] for v in row['netInfo']['peers']}
        expected = {load(Path(package) / 'roles' / r / 'role-manifest.json')[0]['node']['nodeId'] for r in ROLES if r != role}
        need(expected <= peers and int(row['netInfo']['n_peers']) >= 3, 'four original peers not ready')
        if minimum_height is None:
            coordinate = (height, info['last_block_app_hash'])
            if common is None:
                common = coordinate
            need(common == coordinate and row['block'] is None, 'quiet bootstrap engines differ; keep original pause')
        else:
            need(height >= minimum_height and row['block']['block']['header']['height'] == str(minimum_height) and
                 row['block']['block_id']['hash'].lower() == block_hash, 'actual current process lacks verified active PQ block')
        records[role] = {'sha256': sha(raw), 'process': process, 'height': str(height)}
    return records, common

def ready(root_path, plan_path, plan_pin, package, evidence):
    root = private_root(root_path)
    plan = selected_plan(plan_path, plan_pin)
    need(plan.get('bootstrapRegistrationMode') == QUIET, 'pinned quiet bootstrap required')
    records, common = role_observations(root, package, evidence)
    genesis = decode(base64.b64decode(plan['consensusGenesis'], validate=True))
    need(common[0] >= int(genesis['initial_height']) - 1, 'actual bootstrap height predates original genesis')
    value = {'version': 'YNX-QUIET-BOOTSTRAP-READY/v1', 'transactionId': root.name, 'operatorPlanSHA256': plan_pin,
             'height': str(common[0]), 'appHash': base64.b64decode(common[1]).hex(), 'roles': records,
             'ready': True, 'dryRun': False, 'pqActivationVerified': False, 'independentFinalityVerified': False, 'publicIngressChanged': False}
    publish(root / 'candidate/verify-result.json', value)
    return value

def validate_proof_result(r, context):
    fields = {'version', 'classification', 'chainId', 'genesisSha256', 'authorityThroughHeight', 'trustedHeight',
              'trustedBlockHash', 'headerHeight', 'blockHash', 'stateHeight', 'stateAppHash', 'validatorsHash',
              'nextValidatorsHash', 'consensusHash', 'commitVerified', 'lightTransitionVerified'}
    need(type(r) is dict and set(r) == fields and r['version'] == 'YNX-PQ-LIGHT-PROOF/v1' and r['classification'] == 'data',
         'complete original typed proof result required')
    need(all(type(r[k]) is str for k in fields - {'commitVerified', 'lightTransitionVerified'}) and
         all(pin(r[k]) for k in ('genesisSha256', 'trustedBlockHash', 'blockHash', 'stateAppHash', 'validatorsHash', 'nextValidatorsHash', 'consensusHash')) and
         all(re.fullmatch('[1-9][0-9]*', r[k]) for k in ('authorityThroughHeight','trustedHeight','headerHeight','stateHeight')),
         'canonical proof result coordinates required')
    for actual, expected in [('chainId','chainId'), ('genesisSha256','consensusGenesisSHA256'),
                             ('headerHeight','expectedHeaderHeight'), ('blockHash','expectedBlockHash'),
                             ('stateHeight','expectedStateHeight'), ('stateAppHash','expectedStateAppHash'),
                             ('authorityThroughHeight','engineHeight')]:
        need(r[actual] == context[expected], 'original verified target/authority differs')
    need(r['commitVerified'] is True and r['lightTransitionVerified'] is True and
         int(r['stateHeight']) == int(r['headerHeight']) - 1 and int(r['trustedHeight']) < int(r['headerHeight']),
         'bound complete PQ commit/transition proof required')

def verify_results(root_path, plan_path, plan_pin, packet_path, packet_pin, evidence):
    root = private_root(root_path)
    data = continuation(root_path, plan_path, plan_pin, packet_path, packet_pin)
    records, _ = role_observations(root, data['input']['currentPackage'], evidence, int(data['headerHeight']), data['blockHash'])
    result, raw = load(Path(evidence) / 'light.proof-result.json', limit=64 << 10)
    need(set(result) == {'version', 'code', 'result'} and result['version'] == 'YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1' and
         result['code'] == 'VERIFIED_DATA', 'normal proof verifier did not return complete VERIFIED_DATA')
    validate_proof_result(result['result'], data['context'])
    need(sha(original(str(Path(evidence) / 'light.proof-request.json'), 16 << 20)) == data['proof']['requestSHA256'],
         'retained exact proof input changed')
    for role in ROLES:
        need(sha(original(str(Path(evidence) / (role + '.binding.json')), 1 << 20)) == data['roles'][role]['bindingSHA256'],
             'normal independent transition binding changed')
        start = data['roles'][role]['transition']['start']['value']
        expected_process = start['process']
        need(set(expected_process) == {'mainPid', 'startTicks', 'runningExecutableSHA256'} and
             all(re.fullmatch('[1-9][0-9]*', expected_process[k]) for k in ('mainPid', 'startTicks')) and
             expected_process['runningExecutableSHA256'] == start['cometSHA256'] == records[role]['process']['runningExecutableSHA256'],
             'original/current independently qualified operator source differs')
        # The stopped light exporter may require a normal cold restart. The
        # current process is qualified by the real installed plan/source and
        # stable before/after kernel identity, not by requiring an old PID.
        records[role]['originalStartProcess'] = expected_process
        records[role]['restartedSinceTransition'] = any(records[role]['process'][k] != expected_process[k] for k in ('mainPid', 'startTicks'))
    value = {'version': 'YNX-QUIET-PQ-CONTINUATION-VERIFIED/v1', 'transactionId': root.name, 'inputSHA256': packet_pin,
             'bootstrapPlanSHA256': plan_pin, 'currentOperatorPlanSHA256': data['input']['currentOperatorPlanSHA256'],
             'runtimeCommit': data['input']['runtimeCommit'], 'runtimeManifestSHA256': data['input']['runtimeManifestSHA256'],
             'scheduleHash': data['plan']['pqScheduleHash'], 'registryRoot': data['schedule']['registryRoot'],
             'headerHeight': data['headerHeight'], 'blockHash': data['blockHash'], 'stateHeight': data['stateHeight'],
             'stateAppHash': data['stateAppHash'], 'roles': records, 'proofResultSHA256': sha(raw),
             'pqCommitVerified': True, 'publicIngressChanged': False, 'authorityGranted': False}
    publish(root / 'pq-continuation-attempt/verified.json', value)
    return value

def forward_gate(root_path, plan_path, plan_pin, phase=None):
    plan = selected_plan(plan_path, plan_pin)
    if plan.get('bootstrapRegistrationMode') != QUIET:
        return
    root = private_root(root_path)
    paused(root, plan_pin)
    if phase is not None:
        need(phase in TAIL[1:], 'only the original transaction tail may advance')
        journal(root, expected_prefix() + [('bootstrap', 'awaiting_pq_activation')] +
                pairs(TAIL[:TAIL.index(phase)]) + [(phase, 'started')])
    intent, _ = load(root / 'pq-continuation-attempt/intent.json', limit=1 << 20)
    packet_path = str(root / 'pq-continuation-attempt/input.json')
    data = continuation(root_path, plan_path, plan_pin, packet_path, intent['inputSHA256'])
    v, _ = load(root / 'pq-continuation-attempt/verified.json', limit=1 << 20)
    need(v.get('version') == 'YNX-QUIET-PQ-CONTINUATION-VERIFIED/v1' and v.get('transactionId') == root.name and
         v.get('inputSHA256') == intent['inputSHA256'] and v.get('pqCommitVerified') is True and
         v.get('currentOperatorPlanSHA256') == data['input']['currentOperatorPlanSHA256'], 'quiet bootstrap cannot continue without normal PQ proof')
    evidence = root / 'pq-continuation-attempt/evidence'
    for role in ROLES:
        need(sha(original(str(evidence / (role + '.json')), 64 << 20)) == v['roles'][role]['sha256'], 'original normal qualification bytes changed')
    need(sha(original(str(evidence / 'light.proof-result.json'), 64 << 10)) == v['proofResultSHA256'], 'original normal proof result changed')

def main():
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=('mode', 'pause', 'resume-check', 'observe-command', 'ready', 'verify-results', 'forward-gate', 'proof-args', 'target-package'))
    p.add_argument('--transaction')
    p.add_argument('--plan', required=True)
    p.add_argument('--plan-sha256', required=True)
    p.add_argument('--input')
    p.add_argument('--input-sha256')
    p.add_argument('--package')
    p.add_argument('--runtime')
    p.add_argument('--role', choices=ROLES)
    p.add_argument('--evidence')
    p.add_argument('--phase', choices=TAIL[1:])
    a = p.parse_args()
    if a.action == 'mode':
        print(selected_plan(a.plan, a.plan_sha256).get('bootstrapRegistrationMode', ''))
    elif a.action == 'pause':
        print(json.dumps(pause(a.transaction, a.plan, a.plan_sha256)))
    elif a.action == 'resume-check':
        print(json.dumps(resume_check(a.transaction, a.plan, a.plan_sha256, a.input, a.input_sha256)))
    elif a.action == 'observe-command':
        print(observation_command(a.transaction, a.package, a.runtime, a.plan, a.plan_sha256, a.role, a.input, a.input_sha256))
    elif a.action == 'ready':
        print(json.dumps(ready(a.transaction, a.plan, a.plan_sha256, a.package, a.evidence)))
    elif a.action == 'verify-results':
        print(json.dumps(verify_results(a.transaction, a.plan, a.plan_sha256, a.input, a.input_sha256, a.evidence)))
    elif a.action == 'forward-gate':
        forward_gate(a.transaction, a.plan, a.plan_sha256, a.phase)
    else:
        data = continuation(a.transaction, a.plan, a.plan_sha256, a.input, a.input_sha256)
        if a.action == 'target-package':
            print(data['input']['currentPackage'])
            print(data['input']['currentOperatorPlanSHA256'])
            print(data['input']['runtimeCommit'])
            print(data['input']['runtimeManifestSHA256'])
        else:
            proof = data['proof']
            if a.evidence:
                # Hold and copy exact public request once before the child;
                # the original caller never truncates/reconstructs proof data.
                raw = original(proof['request'], 16 << 20)
                need(sha(raw) == proof['requestSHA256'], 'original proof changed before retention')
                target = Path(a.evidence) / 'light.proof-request.json'
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                try:
                    with os.fdopen(fd, 'wb', closefd=False) as output:
                        output.write(raw)
                        output.flush()
                    os.fsync(fd)
                finally:
                    os.close(fd)
                fsync_dir(target.parent)
                proof = {**proof, 'request': str(target)}
            for key in ('trustContext', 'trustContextSHA256', 'request', 'requestSHA256'):
                need('\n' not in proof[key] and '\r' not in proof[key], 'proof scalar contains controls')
                print(proof[key])

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print('quiet continuation refused; retain originals/UNKNOWN: ' + str(error), file=sys.stderr)
        sys.exit(1)
