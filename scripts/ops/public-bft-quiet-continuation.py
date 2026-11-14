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
SOURCE_PROFILE = 'YNX-QUIET-PQ-PROOF-SOURCE/v1'
SOURCE_PLAN_FIELDS = set(('version chainId headerHeight migrationFile migrationSHA256 genesisFile consensusGenesisSHA256 '
    'originalGenesisHash migrationStateHash stateFile stateLayout cometDataDirectory signingStatePath signingLockKind '
    'scheduleFile scheduleHash scheduleSHA256 runtimePlanFile runtimePlanHash runtimePlanSHA256 engineHeight engineAppHash '
    'trustedHeight trustedBlockHash trustingPeriodNanoseconds maxClockDriftNanoseconds trustLevelNumerator trustLevelDenominator').split())

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

SAME_OWNER = 'single-app-same-owner-inplace/v1'
SNAPSHOT_FIELDS = set(('version transactionId commit bftRelease status preparationApprovalSHA256 '
    'snapshotApprovalOriginalSHA256 snapshotApprovalSHA256 snapshotSourceSHA256 exporterManifestSHA256 '
    'remoteEvidenceSHA256 journalSHA256 automaticRetry').split())

def preparation_prefix():
    return pairs(PREFIX) + [('preparation', 'awaiting_final_snapshot_authorization')]

def snapshot_prefix():
    return preparation_prefix() + pairs(['export_final_snapshot']) + [('snapshot', 'awaiting_final_plan_authorization')]

def native_boundary(root_path, exporting=False):
    root = private_root(root_path)
    for name in ('approval.json', 'continuation-attempt', 'candidate/initialize-attempt', 'candidate/start-attempt', 'abort-attempt'):
        need(not os.path.lexists(root / name), 'existing continuation/initialization must be retained')
    def scan(directory):
        for item in directory.iterdir():
            st = item.lstat()
            need(not stat.S_ISLNK(st.st_mode) and not re.search(r'UNKNOWN|\.partial|\.tmp(?:$|[-.])', item.name),
                 'retained partial/UNKNOWN or alias blocks continuation')
            if stat.S_ISDIR(st.st_mode):
                scan(item)
    scan(root)
    prep, _ = load(root / 'preparation-approval.json', limit=1 << 20)
    if exporting:
        need(prep.get('custodyProfile') == SAME_OWNER, 'snapshot stop is same-owner only')
        for name in ('snapshot-export-attempt', 'snapshot-approval.original.json', 'snapshot-approval.json', 'final-snapshot'):
            need(not os.path.lexists(root / name), 'existing snapshot/UNKNOWN forbids export retry')
        journal(root, preparation_prefix())
    elif prep.get('custodyProfile') == SAME_OWNER:
        snapshot_record(root)
        journal(root, snapshot_prefix())
    else:
        for name in ('snapshot-export-attempt', 'snapshot-approval.original.json', 'snapshot-approval.json'):
            need(not os.path.lexists(root / name), 'legacy preparation cannot adopt snapshot stop')
        journal(root, preparation_prefix())
    return prep.get('custodyProfile', '')

def snapshot_bindings(root, current=True):
    prep, prep_raw = load(root / 'preparation-approval.json', limit=1 << 20)
    snap, snap_raw = load(root / 'snapshot-approval.json', limit=1 << 20)
    original_raw = original(str(root / 'snapshot-approval.original.json'), 1 << 20)
    need(prep.get('custodyProfile') == SAME_OWNER and prep.get('preparationOnly') is True and
         snap.get('snapshotOnly') is True and pin(snap.get('snapshotSourceSha256')),
         'original same-owner preparation and snapshot approvals required')
    stable = dict(snap); stable.pop('snapshotOnly'); stable.pop('snapshotSourceSha256')
    before = dict(prep); before.pop('preparationOnly')
    need(stable == before and prep.get('transactionId') == root.name, 'snapshot changed original stable authorization')
    until = datetime.datetime.fromisoformat(prep['expiresAt'].replace('Z', '+00:00'))
    need(until.tzinfo is not None and (not current or until > datetime.datetime.now(datetime.timezone.utc)), 'snapshot approval expired')
    intent, _ = load(root / 'snapshot-export-attempt/intent.json', limit=4096)
    need(intent == {'status': 'unknown', 'automaticRetry': False} and intent['automaticRetry'] is False, 'original exclusive snapshot intent required')
    terminal, terminal_raw = load(root / 'final-snapshot/remote-evidence.json', limit=1 << 20)
    need(terminal.get('transactionId') == root.name and terminal.get('commit') == prep.get('commit') and
         terminal.get('bftRelease') == prep.get('release') and
         terminal.get('snapshotSourceSha256') == snap['snapshotSourceSha256'] and
         terminal.get('exporterManifestSha256') == snap.get('exporterManifestSha256') and
         terminal.get('exporterCommit') == prep['sameOwnerEvidence']['sourceCommit'] and
         all(terminal.get(k) is True for k in ('pauseVerified','mutationFreezeVerified','sourceUnchanged','validated')) and
         all(terminal.get(k) is False for k in ('reused','deployment','runtimeStarted')) and pin(terminal.get('sha256')),
         'original final snapshot terminal differs from independent approval')
    return dict(version='YNX-NATIVE-SNAPSHOT-EXPORTED/v1', transactionId=root.name, commit=prep['commit'],
                bftRelease=prep['release'], status='awaiting_final_plan_authorization',
                preparationApprovalSHA256=sha(prep_raw), snapshotApprovalOriginalSHA256=sha(original_raw),
                snapshotApprovalSHA256=sha(snap_raw), snapshotSourceSHA256=snap['snapshotSourceSha256'],
                exporterManifestSHA256=snap['exporterManifestSha256'], remoteEvidenceSHA256=sha(terminal_raw),
                automaticRetry=False)

def snapshot_complete(root_path):
    root = private_root(root_path)
    value = snapshot_bindings(root)
    value['journalSHA256'] = sha(journal(root, snapshot_prefix()))
    publish(root / 'snapshot-export-attempt/result.json', value)
    return value

def snapshot_record(root, current=True):
    value, _ = load(root / 'snapshot-export-attempt/result.json', limit=16 << 10)
    need(type(value) is dict and set(value) == SNAPSHOT_FIELDS and value['automaticRetry'] is False, 'closed original snapshot completion required')
    bound = snapshot_bindings(root, current=current)
    raw = original(str(root / 'journal.jsonl'), 1 << 20)
    # Hash the exact original bytes, including timestamps, through the durable
    # export stop. Later bootstrap/tail entries cannot rewrite that prefix.
    lines = raw.splitlines(keepends=True)
    count = len(snapshot_prefix())
    need(len(lines) >= count and all(line.endswith(b'\n') for line in lines), 'partial snapshot journal retained')
    prefix = b''.join(lines[:count])
    validate_journal(prefix, snapshot_prefix())
    bound['journalSHA256'] = sha(prefix)
    need(value == bound, 'snapshot completion or retained originals changed')
    return value

# Explicit same-original inverse, usable only before any candidate attempt.
ABORT_PHASES = ['abort_native_preflight', 'resume_authoritative', 'unfreeze_mutations', 'verify_recovery']

def abort_boundary(root_path, phase=None):
    root = private_root(root_path)
    for name in ('approval.json', 'continuation-attempt', 'pq-continuation-attempt', 'candidate/initialize-attempt', 'candidate/start-attempt'):
        need(not os.path.lexists(root/name), 'candidate/continuation footprint forbids native inverse')
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs+files:
            p=Path(directory)/name
            need(not p.is_symlink() and not re.search(r'UNKNOWN|\.partial|\.tmp(?:$|[-.])',name), 'retained partial/UNKNOWN forbids native inverse')
    prep, raw = load(root/'preparation-approval.json',limit=1<<20)
    need(prep.get('custodyProfile')==SAME_OWNER and prep.get('preparationOnly') is True and prep.get('transactionId')==root.name, 'original same-owner preparation required')
    base=preparation_prefix()
    if os.path.lexists(root/'snapshot-export-attempt'):
        snapshot_record(root,current=False);base=snapshot_prefix()
    else:
        for name in ('snapshot-approval.json','snapshot-approval.original.json','final-snapshot'):
            need(not os.path.lexists(root/name), 'incomplete snapshot must be reconciled')
    if phase is None:
        need(not os.path.lexists(root/'abort-attempt'),'original inverse attempt/UNKNOWN must not be retried')
        need(not os.path.lexists(root/'recovery') and not any(p.name.startswith('recovery-attempt-') for p in root.iterdir()),'prior recovery observation must be reconciled')
        journal(root,base)
    else:
        intent,_=load(root/'abort-attempt/intent.json',limit=4096)
        need(set(intent)=={'version','status','automaticRetry','preparationApprovalSHA256','journalSHA256'} and
             intent['version']=='YNX-NATIVE-ABORT-INTENT/v1' and intent['status']=='unknown' and intent['automaticRetry'] is False and
             intent['preparationApprovalSHA256']==sha(raw),'original exclusive inverse intent changed')
        need(phase in ABORT_PHASES+['complete'],'unsupported inverse action')
        i=len(ABORT_PHASES) if phase=='complete' else ABORT_PHASES.index(phase)
        expected=base+pairs(ABORT_PHASES[:i])+([] if phase=='complete' else [(phase,'started')])
        rows=journal(root,expected).splitlines(keepends=True)
        need(sha(b''.join(rows[:len(base)]))==intent['journalSHA256'],'original stopped journal changed')
    return root,prep,base

def abort_start(root_path):
    root,prep,base=abort_boundary(root_path)
    value=dict(version='YNX-NATIVE-ABORT-INTENT/v1',status='unknown',automaticRetry=False,
               preparationApprovalSHA256=sha(original(str(root/'preparation-approval.json'),1<<20)),journalSHA256=sha(journal(root,base)))
    (root/'abort-attempt').mkdir(mode=0o700)
    fsync_dir(root)
    publish(root/'abort-attempt/intent.json',value)
    return value

def abort_complete(root_path):
    root,prep,_=abort_boundary(root_path,'complete')
    recovery,recovery_raw=load(root/'recovery/validation.json',limit=1<<20)
    need(recovery.get('status')=='passed' and recovery.get('freezeRemoved') is True and recovery.get('authoritativePaused') is False and recovery.get('publicIngressChanged') is False,'original recovery verifier must finish successfully')
    for name in ('journal.jsonl','recovery/validation.json'):
        fd=os.open(root/name,os.O_RDONLY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
    fsync_dir(root/'recovery');fsync_dir(root)
    value=dict(version='YNX-NATIVE-ABORTED/v1',transactionId=root.name,commit=prep['commit'],status='native_recovered',
               journalSHA256=sha(original(str(root/'journal.jsonl'),1<<20)),automaticRetry=False,checkpointReusable=False,recoveryValidationSHA256=sha(recovery_raw))
    publish(root/'abort-attempt/result.json',value)
    return value

def line_record(path,keys):
    raw=original(str(path),64<<10)
    need(raw.endswith(b'\n'),'partial original phase stdout')
    result={}
    for line in raw.decode('ascii').splitlines():
        k,sep,v=line.partition('=')
        need(sep and k not in result,'duplicate/invalid original phase stdout')
        result[k]=v
    need(set(result)==set(keys.split()),'closed original phase stdout required')
    return result

def abort_observation_request(root_path,role,phase,evidence_root):
    root,prep,_=abort_boundary(root_path,phase)
    need(role in ROLES,'original role required')
    plan,_=load(root/'preparation-operator-plan.json',prep['operatorPreparationPlanSha256'],1<<20)
    roles={r['role']:r for r in plan['roles']};need(set(roles)==set(ROLES),'complete original plan required')
    selected=roles[role]
    native=prep['authoritativeRoles'][role]
    live,_=load(root/'abort-attempt'/phase/(role+'-native.json'),limit=1<<20)
    need(live.get('version')=='YNX-PUBLIC-BFT-NATIVE-IDENTITY/v1' and live.get('role')==role and live.get('transactionId')==root.name and live.get('commit')==prep['commit'] and
         all(live.get(k)==native[k] for k in ('authoritativeCommit','authoritativeRelease','authoritativeBinarySha256')) and live.get('readOnly') is True and
         live.get('deployment') is False and live.get('nativeRootAuthorized') is False and decimal(live.get('mainPid')) and
         re.fullmatch('[0-9]+:[0-9]+',live.get('runningExecutableDeviceInode','')),'current original native qualification differs')
    tx=root.name; release=prep['release']
    need(type(evidence_root) is str and re.fullmatch(r'/[A-Za-z0-9._/-]+',evidence_root) and '..' not in evidence_root and evidence_root.endswith('/public-bft-cutover/'+tx),'original evidence root required')
    fields='transactionId role operation commit authoritativeRelease bftRelease marker markerSha256 readStatus readEvm mutationStateVerified reused'
    freeze=line_record(root/'roles'/(role+'-freeze.txt'),fields)
    for k,v in dict(transactionId=tx,role=role,operation='freeze',commit=prep['commit'],authoritativeRelease=native['authoritativeRelease'],bftRelease=release,marker=native['authoritativeSource']['mutationMarkerPath'],readStatus='200',readEvm='200',mutationStateVerified='true',reused='false').items():
        need(freeze[k]==v,'original freeze evidence differs')
    need(pin(freeze['markerSha256']),'original marker pin required')
    pause=None
    if role=='primary':
        pause=line_record(root/'roles/primary-pause-authoritative.txt','transactionId operation commit authoritativeRelease bftRelease pauseMarker markerSha256 heightBefore heightAfter readsOnline productionStateVerified reused')
        for k,v in dict(transactionId=tx,operation='pause',commit=prep['commit'],authoritativeRelease=native['authoritativeRelease'],bftRelease=release,pauseMarker=native['authoritativeSource']['pauseMarkerPath'],readsOnline='true',productionStateVerified='true',reused='false').items():
            need(pause[k]==v,'original pause evidence differs')
        need(pin(pause['markerSha256']) and decimal(pause['heightBefore']) and pause['heightBefore']==pause['heightAfter'],'original paused height/pin required')
    return dict(version='YNX-NATIVE-ABORT-OBSERVATION/v1',transactionId=tx,role=role,commit=prep['commit'],bftRelease=release,
                evidenceRoot=evidence_root,native=native,home=selected['home'],abciState=selected['abciState'],freezeSHA256=freeze['markerSha256'],
                nativePID=live['mainPid'],nativeExecutableIdentity=live['runningExecutableDeviceInode'],
                pauseSHA256=pause['markerSha256'] if pause else None,pauseRequired=phase in ('abort_native_preflight','resume_authoritative'))

def abort_observation_result(root_path,role,phase,evidence_root):
    request=abort_observation_request(root_path,role,phase,evidence_root)
    expected={k:request[k] for k in ('version','transactionId','role','commit','freezeSHA256','pauseSHA256','pauseRequired')}
    expected.update(readOnly=True,candidateAbsent=True)
    value,_=load(Path(root_path)/'abort-attempt'/phase/(role+'-markers.json'),limit=16<<10)
    need(value==expected and value['readOnly'] is True and value['candidateAbsent'] is True and type(value['pauseRequired']) is bool,'original marker observation receipt missing/changed')

def abort_phase_result(root_path,phase):
    root,prep,_=abort_boundary(root_path,phase)
    if phase=='verify_recovery':
        result,_=load(root/'recovery/validation.json',limit=1<<20)
        need(result.get('status')=='passed' and result.get('commit')==prep['authoritativeCommit'][:12] and result.get('release')==prep['authoritativeRelease'] and
             result.get('freezeRemoved') is True and result.get('authoritativePaused') is False and result.get('publicIngressChanged') is False,'original recovery verifier receipt differs')
        return
    need(phase in ('resume_authoritative','unfreeze_mutations'),'unsupported inverse terminal')
    roles=('primary',) if phase=='resume_authoritative' else ROLES
    for role in roles:
        pause=phase=='resume_authoritative'
        keys='transactionId operation commit authoritativeRelease bftRelease pauseMarker markerSha256 heightBefore heightAfter readsOnline productionStateVerified reused' if pause else 'transactionId role operation commit authoritativeRelease bftRelease marker markerSha256 readStatus readEvm mutationStateVerified reused'
        old=line_record(root/'roles'/(role+'-pause-authoritative.txt' if pause else role+'-freeze.txt'),keys)
        new=line_record(root/'roles'/(role+'-resume-authoritative.txt' if pause else role+'-unfreeze.txt'),keys)
        for k in set(old)-{'operation','heightBefore','heightAfter'}:need(old[k]==new[k],'original inverse terminal differs from frozen evidence')
        need(new['reused']=='false' and new['operation']==('resume' if pause else 'unfreeze'),'inverse cannot adopt a reused/missing marker')
        if pause:need(decimal(new['heightBefore']) and decimal(new['heightAfter']) and int(new['heightAfter'])>int(new['heightBefore'])>=int(old['heightAfter']),'native did not resume')


def abort_remote_observe(request):
    """Read-only stream in the original root SSH session; no directory creation.

    Production paths come solely from the retained approved plan. No private
    application, HRS or key body is opened. The caller separately invokes the
    original full native identity qualifier before this additional observation.
    """
    import subprocess
    need(set(request)==set('version transactionId role commit bftRelease evidenceRoot native home abciState freezeSHA256 pauseSHA256 pauseRequired nativePID nativeExecutableIdentity'.split()) and request['version']=='YNX-NATIVE-ABORT-OBSERVATION/v1','closed inverse observation request required')
    need(os.geteuid()==0,'original privileged read-only observer required')
    role=request['role'];need(role in ROLES and type(request['pauseRequired']) is bool,'invalid role/phase')
    native=request['native'];source=native['authoritativeSource']
    def process_identity():
        need(decimal(request['nativePID']),'actual original native PID required')
        result=subprocess.run(['systemctl','show','ynx-chaind.service','--property=MainPID,InvocationID,ExecMainStartTimestampMonotonic,ActiveState'],capture_output=True,text=True,timeout=10)
        value=unique(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        need(result.returncode==0 and set(value)=={'MainPID','InvocationID','ExecMainStartTimestampMonotonic','ActiveState'} and
             value['MainPID']==request['nativePID'] and value['ActiveState']=='active' and re.fullmatch('[0-9a-f]{32}',value['InvocationID']) and decimal(value['ExecMainStartTimestampMonotonic']),'current native incarnation differs')
        proc=Path('/proc')/value['MainPID']
        # Only Linux process public stat and executable inode; no environ/key.
        with open(proc/'stat','rb') as inp:raw=inp.read(65537)
        need(len(raw)<=65536 and b') ' in raw,'invalid bounded native process stat')
        fields=raw.rsplit(b') ',1)[1].split();need(len(fields)>19 and fields[19].isdigit(),'native start ticks missing')
        st=os.stat(proc/'exe');need(str(st.st_dev)+':'+str(st.st_ino)==request['nativeExecutableIdentity'],'native executable incarnation changed')
        return value,fields[19]
    before_process=process_identity()
    def absent(path):
        p=Path(path);need(p.is_absolute() and str(p.resolve(strict=False))==str(p),'canonical absent candidate path required')
        need(not os.path.lexists(p),'candidate writer/state footprint forbids inverse')
    absent(request['abciState']);absent(Path(request['abciState']).parent)
    absent(Path(request['home'])/'data')
    for unit in ('ynx-consensus-operator-candidate.service','ynx-consensus-pq-remote-signer.service','ynx-comet.service'):
        result=subprocess.run(['systemctl','show',unit,'--property=LoadState,ActiveState,MainPID,ControlGroup'],capture_output=True,text=True,timeout=10)
        values=unique(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        need(set(values)=={'LoadState','ActiveState','MainPID','ControlGroup'} and values['MainPID']=='0' and values['ActiveState']=='inactive' and values['ControlGroup']=='' and
             ((result.returncode==0 and values['LoadState']=='loaded') or (result.returncode in (0,1) and values['LoadState']=='not-found')),'candidate unit/process state is unknown or active')
    def marker(path,pin_value,pause):
        fixed='/var/lib/ynx-chain/'+('block-production-pause.json' if pause else 'mutation-freeze.json')
        need(path==fixed and pin(pin_value),'original fixed marker/pin required')
        before=Path(path).lstat();need(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600 and before.st_uid==0 and before.st_nlink==1,'protected original marker required')
        raw=original(path,16<<10);need(sha(raw)==pin_value and identity(before)==identity(Path(path).lstat()),'original marker bytes/identity changed')
        value=decode(raw);timekey='pausedAt' if pause else 'frozenAt'
        expected=dict(transactionId=request['transactionId'],commit=request['commit'],authoritativeRelease=native['authoritativeRelease'],authoritativeCommit=native['authoritativeCommit'],bftRelease=request['bftRelease'])
        if not pause:expected['role']=role
        need(set(value)==set(expected)|{timekey} and all(value[k]==v for k,v in expected.items()) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z',value[timekey]),'original marker closed scope differs')
    remote=Path(request['evidenceRoot'])
    need(str(remote).endswith('/public-bft-cutover/'+request['transactionId']) and str(remote.resolve(strict=True))==str(remote),'original remote evidence root differs')
    retained=[remote/(role+'-unfreeze.json'),Path(source['mutationMarkerPath']+'.UNKNOWN'),Path(source['mutationMarkerPath']+'.partial-'+request['transactionId'])]
    retained += [Path(str(retained[0])+suffix) for suffix in ('.partial','.UNKNOWN')]
    if role=='primary' and request['pauseRequired']:
        p=remote/'primary-resume-authoritative.json'
        retained += [p,Path(str(p)+'.partial'),Path(str(p)+'.UNKNOWN'),Path(source['pauseMarkerPath']+'.UNKNOWN'),Path(source['pauseMarkerPath']+'.partial-'+request['transactionId'])]
    need(all(not os.path.lexists(p) for p in retained),'original remote recovery/UNKNOWN footprint must be retained')
    marker(source['mutationMarkerPath'],request['freezeSHA256'],False)
    if role=='primary':
        if request['pauseRequired']:marker(source['pauseMarkerPath'],request['pauseSHA256'],True)
        else:
            p=Path(source['pauseMarkerPath']);need(source['pauseMarkerPath']=='/var/lib/ynx-chain/block-production-pause.json' and not os.path.lexists(p),'original pause was not removed')
    need(process_identity()==before_process,'native process changed while checking original markers')
    return dict(version=request['version'],transactionId=request['transactionId'],role=role,commit=request['commit'],freezeSHA256=request['freezeSHA256'],pauseSHA256=request['pauseSHA256'],pauseRequired=request['pauseRequired'],readOnly=True,candidateAbsent=True)


def expected_prefix(root=None):
    if root is not None:
        full, _ = load(root / 'approval.json', limit=1 << 20)
        if full.get('custodyProfile') == SAME_OWNER:
            retained = snapshot_record(root)
            need(full.get('transactionId') == root.name and full.get('snapshotSourceSha256') == retained['snapshotSourceSHA256'] and
                 full.get('exporterManifestSha256') == retained['exporterManifestSHA256'], 'final approval changed original export')
            return snapshot_prefix() + pairs(BOOTSTRAP[1:])
    return pairs(PREFIX) + [('preparation', 'awaiting_final_snapshot_authorization')] + pairs(BOOTSTRAP)

def journal(root, expected):
    raw = original(str(root / 'journal.jsonl'), 1 << 20)
    validate_journal(raw, expected)
    return raw

def validate_journal(raw, expected):
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
    prefix = journal(root, expected_prefix(root))
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
    paused_journal = journal(root, expected_prefix(root) + [('bootstrap', 'awaiting_pq_activation')])
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

def source_proof_selection(root, packet, plan, schedule, proof):
    """Bind the existing stopped exporter inputs; never export or grant here."""
    need(set(proof) == {'version', 'role', 'sourcePlan', 'sourcePlanSHA256', 'output'} and
         proof['version'] == SOURCE_PROFILE and proof['role'] in ROLES,
         'closed original normal light source selection required')
    need(all(type(v) is str for v in proof.values()), 'normal light source scalars required')
    role = proof['role']
    need(proof['output'] == '/var/tmp/ynx-public-light-' + root.name + '-' + role + '/delivery',
         'fixed same-operation role public output required')
    source, _ = load(proof['sourcePlan'], proof['sourcePlanSHA256'], 32 << 10)
    need(type(source) is dict and set(source) == SOURCE_PLAN_FIELDS and all(type(v) is str for v in source.values()) and
         source['version'] == 'YNX-PQ-LIGHT-SOURCE-PLAN/v1', 'complete original light source plan required')
    for key in ('chainId', 'consensusGenesisSHA256', 'originalGenesisHash', 'migrationStateHash',
                'stateLayout', 'runtimePlanHash'):
        need(source[key] == plan[key], 'light source differs from approved target: ' + key)
    need(source['scheduleHash'] == plan['pqScheduleHash'] and
         source['scheduleSHA256'] == sha(base64.b64decode(plan['pqSchedule'], validate=True)),
         'light source schedule differs from approved exact bytes')
    selected = next(v for v in plan['roles'] if v['role'] == role)
    config = '/var/lib/ynx-chain/consensus-candidate/config/'
    need(source['stateFile'] == selected['abciState'] and
         source['cometDataDirectory'] == selected['home'] + '/data' and
         source['migrationFile'] == config + 'bound-migration.json' and
         source['genesisFile'] in (config + 'genesis.json', selected['home'] + '/config/genesis.json') and
         source['scheduleFile'] == config + 'pq-engine-schedule.json',
         'light source paths differ from the selected original role')
    # The original package was separately verified by the normal driver. Bind
    # its whole public migration bytes, not an incoming summary or a new root.
    migration = Path(packet['currentPackage']) / 'roles' / role / 'config/bound-migration.json'
    need(source['migrationSHA256'] == digest_original(migration, 1 << 30),
         'light source differs from complete approved package migration')
    runtime = base64.b64decode(plan['runtimePlan'], validate=True) if plan['runtimePlan'] else b''
    need((source['runtimePlanFile'], source['runtimePlanSHA256']) ==
         ((config + 'runtime-plan.json', sha(runtime)) if runtime else ('', '')),
         'light source runtime differs from approved exact bytes')
    signing = source['signingStatePath']
    need(signing.startswith('/') and str(Path(signing)) == signing and '..' not in Path(signing).parts and
         not any(ord(ch) < 32 for ch in signing) and source['signingLockKind'] == 'pq-signer' and
         signing not in {selected[k] for k in ('abciState', 'legacyKeyPath', 'legacyStatePath', 'nodeKeyPath')} and
         signing != selected.get('transportKeyPath'), 'original separate PQ signing lock identity required')
    for key in ('engineHeight', 'headerHeight', 'trustedHeight', 'trustingPeriodNanoseconds',
                'trustLevelNumerator', 'trustLevelDenominator'):
        need(decimal(source[key]), 'canonical bounded light source coordinate required: ' + key)
    drift = source['maxClockDriftNanoseconds']
    need(drift == '0' or decimal(drift), 'canonical light clock drift required')
    for key in ('engineAppHash', 'trustedBlockHash', 'migrationSHA256', 'consensusGenesisSHA256',
                'originalGenesisHash', 'migrationStateHash', 'scheduleHash', 'scheduleSHA256'):
        need(pin(source[key]), 'complete independent light source pin required: ' + key)
    height = int(source['headerHeight'])
    need(int(source['trustedHeight']) < height <= int(source['engineHeight']) and height > schedule['activationHeight'],
         'source target must include the committed active PQ state')
    # Fraction semantics, registry, store locks, all signatures and the real
    # verification clock stay in the original Go exporter and verifier.
    return {'proofSource': proof, 'sourcePlan': source, 'headerHeight': str(height), 'stateHeight': str(height - 1)}

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
    custody_handoffs = {}
    for role in ROLES:
        for key in ('role', 'home', 'abciState', 'legacyStatePath'):
            need(old_roles[role][key] == new_roles[role][key], 'original state/custody path changed')
        before, after = old_roles[role], new_roles[role]
        if any(before[key] != after[key] for key in ('legacyKeyPath', 'nodeKeyPath')):
            base = '/etc/ynx/consensus-candidate/' + role
            need(before['legacyKeyPath'] == base + '/priv_validator_key.json' and
                 before['legacyStatePath'] == base + '/priv_validator_state.json' and before['nodeKeyPath'] == base + '/node_key.json',
                 'cold handoff requires exact original role custody')
            want = dict(version='YNX-ORIGINAL-SIGNER-CUSTODY/v1',
                        legacyKeyPath='/etc/ynx/consensus-pq-legacy/' + role + '/priv_validator_key.json',
                        nodeKeyPath='/etc/ynx/consensus-pq-engine/' + role + '/node_key.json', legacyStatePath=before['legacyStatePath'])
            need(all(after[key] == want[key] for key in ('legacyKeyPath', 'nodeKeyPath')), 'cold handoff destinations differ')
            custody_handoffs[role] = want
    a, _ = load(c['transitionApproval'], c['transitionApprovalSHA256'], 1 << 20)
    need(a.get('version') == 'YNX-OPERATOR-TRANSITION-APPROVAL/v1' and a.get('approved') is True and a.get('phase') == 'start' and
         a.get('transitionId') == c['transitionId'] and a.get('cutoverTransactionId') == root.name and
         a.get('oldOperatorPlanSHA256') == bootstrap_pin and a.get('nextOperatorPlanSHA256') == c['currentOperatorPlanSHA256'] and
         a.get('runtimeCommit') == c['runtimeCommit'] and a.get('runtimeManifestSHA256') == c['runtimeManifestSHA256'] and
         a.get('oldRuntimeCommit') == c['runtimeCommit'] and a.get('oldRuntimeManifestSHA256') == c['runtimeManifestSHA256'], 'original external start approval differs')
    install_pins = a.get('signerInstallReceiptSHA256ByRole')
    if custody_handoffs:
        need(type(install_pins) is dict and set(install_pins) == set(custody_handoffs) and all(pin(v) for v in install_pins.values()),
             'original start approval lacks complete signer installation pins')
    else:
        need('signerInstallReceiptSHA256ByRole' not in a, 'unchanged custody cannot claim signer installation pins')
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
            if phase != 'quiesce' and role in custody_handoffs:
                need(entry.get('custodyHandoff') == custody_handoffs[role] and pin(entry.get('custodyHandoffReceiptSHA256')),
                     'normal cold custody receipt missing or differs')
                if phase == 'start':
                    need(entry['custodyHandoffReceiptSHA256'] == entries['install']['value']['custodyHandoffReceiptSHA256'],
                         'start did not consume original completed custody handoff')
                    need(entry.get('signerInstallReceiptSHA256') == install_pins[role],
                         'start did not consume the approved signer installation')
            elif phase != 'quiesce':
                need('custodyHandoff' not in entry and 'custodyHandoffReceiptSHA256' not in entry,
                     'unchanged custody cannot claim a transfer')
            if phase != 'start' or role not in custody_handoffs:
                need('signerInstallReceiptSHA256' not in entry, 'only a completed cold custody start may claim signer installation')
            entries[phase] = {'sha256': sha(entry_raw), 'value': entry}
        binding, binding_raw = load(transition / 'start-attempt' / (role + '.binding.json'), limit=1 << 20)
        need(binding.get('version') == 'YNX-OPERATOR-TRANSITION-BINDING/v1' and
             all(entries['start']['value'].get(k) == v for k, v in binding.items() if k not in ('version', 'checkpoint')) and
             binding.get('checkpoint') == cp, 'original start binding differs')
        evidence[role] = {'transition': entries, 'bindingSHA256': sha(binding_raw)}
    proof = c['proof']
    if type(proof) is dict and proof.get('version') == SOURCE_PROFILE:
        selected = source_proof_selection(root, c, new, schedule, proof)
        return {'input': c, 'inputSHA256': sha(raw), 'pause': stopped, 'plan': new, 'schedule': schedule,
                'roles': evidence, **selected}
    need(type(proof) is dict and set(proof) == {'trustContext', 'trustContextSHA256', 'request', 'requestSHA256'}, 'closed proof selection required')
    need(not os.environ.get('PUBLIC_BFT_LINUX_TOOL_ROLE'), 'remote public proof requires original normal capture provenance before material reads')
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

def capture_binding(root_path, bootstrap_path, bootstrap_pin, packet_path, packet_pin,
                    approval_path, approval_pin, phase, runtime):
    """Select one actual normal operator action under the retained approval."""
    need(phase in ('capture', 'resume'), 'explicit capture or resume phase required')
    data = continuation(root_path, bootstrap_path, bootstrap_pin, packet_path, packet_pin)
    need('proofSource' in data, 'source-plan profile required for cold capture')
    root = private_root(root_path)
    cutover,cutover_raw=approval(root)
    packet, plan, source = data['input'], data['plan'], data['sourcePlan']
    proof = data['proofSource']; role = proof['role']
    selected = next(v for v in plan['roles'] if v['role'] == role)
    session = plan.get('heightHaltSessionId', '')
    control = str(Path(selected['abciState']).parent / ('operator-height-halt-' + session + '.json'))
    need(pin(session) and selected.get('heightHaltControlPath') == control,
         'capture requires the independently preconfigured current height-halt session')
    host = selected.get('hostBinding')
    need(type(host) is dict and host.get('SignerStatePath') == source['signingStatePath'] and
         host.get('Policy', {}).get('ChainID') == plan['chainId'], 'source signer must be the original current host binding')
    a, _ = load(approval_path, approval_pin, 1 << 20)
    fields = {'version', 'phase', 'approved', 'transitionId', 'cutoverTransactionId', 'role',
              'operatorPlanSHA256', 'runtimeCommit', 'runtimeManifestSHA256', 'inputSHA256',
              'sourcePlanSHA256', 'output', 'expiresAt', 'captureSHA256'}
    need(type(a) is dict and set(a) == fields and a['version'] == 'YNX-OPERATOR-LIGHT-CAPTURE-APPROVAL/v1' and
         a['phase'] == phase and a['approved'] is True, 'complete independently pinned phase approval required')
    expected = dict(transitionId=packet['transitionId'], cutoverTransactionId=root.name, role=role,
                    operatorPlanSHA256=packet['currentOperatorPlanSHA256'], runtimeCommit=packet['runtimeCommit'],
                    runtimeManifestSHA256=packet['runtimeManifestSHA256'], inputSHA256=packet_pin,
                    sourcePlanSHA256=proof['sourcePlanSHA256'], output=proof['output'])
    need(all(a[k] == v for k, v in expected.items()), 'capture approval differs from the original operation/source/role')
    expires = datetime.datetime.fromisoformat(a['expiresAt'].replace('Z', '+00:00'))
    need(expires.tzinfo is not None and expires > datetime.datetime.now(datetime.timezone.utc), 'capture phase approval expired')
    need(a['captureSHA256'] is None if phase == 'capture' else pin(a['captureSHA256']), 'resume must pin the completed original capture')
    src, _ = load(Path(runtime) / 'SOURCE.json', packet['runtimeManifestSHA256'], 1 << 20)
    need(src['commit'] == packet['runtimeCommit'] and src.get('platform') == 'linux/amd64', 'normal exact Linux runtime required')
    binaries = {k: src['binaries'][k]['sha256'] for k in
                ('ynx-comet', 'ynx-consensus-package', 'ynx-consensus-keycheck', 'ynx-consensus-pq-remote-signer')}
    need(all(pin(v) for v in binaries.values()), 'complete actual runtime binary pins required')
    capture_root = '/var/lib/ynx-chain/operator-transitions/' + root.name + '/' + role + '/capture-attempt'
    binding = dict(version='YNX-OPERATOR-LIGHT-CAPTURE-BINDING/v1', phase=phase, **expected,
                   approvalSHA256=approval_pin, expiresAt=a['expiresAt'], captureSHA256=a['captureSHA256'],
                   cutoverApprovalSHA256=sha(cutover_raw),cutoverExpiresAt=cutover['expiresAt'],
                   captureRoot=capture_root, originalRole=selected, sourcePlan=source, binarySHA256=binaries,
                   originalStartSHA256=data['roles'][role]['transition']['start']['sha256'],
                   originalStartBindingSHA256=data['roles'][role]['bindingSHA256'],
                   heightHaltSessionId=session, heightHaltControlPath=control,
                   freezeSHA256=data['roles'][role]['transition']['start']['value']['freezeSHA256'],
                   nativePauseSHA256=data['roles'][role]['transition']['start']['value']['nativePauseSHA256'])
    if phase == 'resume':
        receipt, receipt_raw = load(Path(packet['transitionRoot']) / 'capture-attempt' / (role + '.result.json'),
                                    a['captureSHA256'], 1 << 20)
        validate_capture_receipt(data, receipt, receipt_raw)
    return binding

CAPTURE_FIELDS = set(('version phase status transitionId cutoverTransactionId role runtimeCommit runtimeManifestSHA256 '
    'operatorPlanSHA256 inputSHA256 sourcePlanSHA256 captureApprovalSHA256 engineHeight engineAppHash headerHeight '
    'stateHeight captureRoot output checkpointSHA256 haltRequestSHA256 signingStateIdentity exportReceiptSHA256 '
    'deliverySHA256 originalMaterialRetained sourceReadOnly nativeRootAuthorized deploymentVerified').split())

def validate_capture_receipt(data, receipt, raw):
    proof, packet, source = data['proofSource'], data['input'], data['sourcePlan']
    need(type(receipt) is dict and set(receipt) == CAPTURE_FIELDS and
         receipt['version'] == 'YNX-OPERATOR-LIGHT-CAPTURE-RESULT/v1' and receipt['phase'] == 'capture' and
         receipt['status'] == 'stopped_exported', 'complete original cold capture result required')
    expected = dict(transitionId=packet['transitionId'], cutoverTransactionId=packet['transactionId'], role=proof['role'],
                    runtimeCommit=packet['runtimeCommit'], runtimeManifestSHA256=packet['runtimeManifestSHA256'],
                    operatorPlanSHA256=packet['currentOperatorPlanSHA256'], inputSHA256=data['inputSHA256'],
                    sourcePlanSHA256=proof['sourcePlanSHA256'], output=proof['output'],
                    engineHeight=source['engineHeight'], engineAppHash=source['engineAppHash'],
                    headerHeight=source['headerHeight'], stateHeight=str(int(source['headerHeight'])-1),
                    captureRoot='/var/lib/ynx-chain/operator-transitions/' + packet['transitionId'] + '/' + proof['role'] + '/capture-attempt')
    need(all(receipt[k] == v for k, v in expected.items()), 'capture receipt source/role/operation/target mismatch')
    need(receipt['originalMaterialRetained'] is True and receipt['sourceReadOnly'] is True and
         receipt['nativeRootAuthorized'] is False and receipt['deploymentVerified'] is False, 'capture DATA boundary changed')
    for key in ('captureApprovalSHA256', 'checkpointSHA256', 'haltRequestSHA256', 'exportReceiptSHA256', 'deliverySHA256'):
        need(pin(receipt[key]), 'capture original pin missing: ' + key)
    need(type(receipt['signingStateIdentity']) is dict and set(receipt['signingStateIdentity']) ==
         {'device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs'} and
         all(type(v) is str and re.fullmatch('[0-9]+', v) for v in receipt['signingStateIdentity'].values()),
         'original signing metadata identity required; never a private HRS body')
    return receipt

def validate_capture_transition_result(b, r):
    extra={'resumeApprovalSHA256','captureSHA256','currentProcess','signerProcess'} if b['phase']=='resume' else set()
    need(type(r) is dict and set(r)==CAPTURE_FIELDS|extra and r['version']=='YNX-OPERATOR-LIGHT-CAPTURE-RESULT/v1' and
         r['phase']==b['phase'] and r['status']==('stopped_exported' if b['phase']=='capture' else 'resumed_activation_unproven'),
         'complete original capture phase result required')
    for key in ('transitionId','cutoverTransactionId','role','runtimeCommit','runtimeManifestSHA256','operatorPlanSHA256',
                'inputSHA256','sourcePlanSHA256','captureRoot','output'):
        need(r[key]==b[key],'original capture phase correlation changed: '+key)
    for key in ('engineHeight','engineAppHash','headerHeight'):
        need(r[key]==b['sourcePlan'][key],'original capture coordinate changed')
    need(r['stateHeight']==str(int(b['sourcePlan']['headerHeight'])-1) and r['originalMaterialRetained'] is True and
         r['sourceReadOnly'] is True and r['nativeRootAuthorized'] is False and r['deploymentVerified'] is False,
         'original capture DATA boundary changed')
    for key in ('captureApprovalSHA256','checkpointSHA256','haltRequestSHA256','exportReceiptSHA256','deliverySHA256'):
        need(pin(r[key]),'missing original capture pin')
    need(type(r['signingStateIdentity']) is dict and set(r['signingStateIdentity']) ==
         {'device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs'} and
         all(type(v) is str and re.fullmatch('[0-9]+',v) for v in r['signingStateIdentity'].values()),
         'original signing metadata only; no private HRS body')
    if b['phase']=='capture':need(r['captureApprovalSHA256']==b['approvalSHA256'],'capture approval changed')
    else:
        need(r['captureSHA256']==b['captureSHA256'] and r['resumeApprovalSHA256']==b['approvalSHA256'], 'original resume approval/capture changed')
        for process in (r['currentProcess'],r['signerProcess']):
            need(type(process) is dict and decimal(process.get('mainPid')) and decimal(process.get('startTicks')), 'original resumed physical process required')
    return r


def retain_capture_result(binding_path, raw_path, target_path):
    b,_=load(binding_path,limit=1<<20);r,raw=load(raw_path,limit=1<<20);validate_capture_transition_result(b,r)
    target=Path(target_path)
    if os.path.lexists(target):
        need(original(str(target),1<<20)==raw,'existing original result differs; preserve UNKNOWN')
        return
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb',closefd=False) as f:f.write(raw);f.flush()
        os.fsync(fd)
    finally:os.close(fd)
    fsync_dir(target.parent)

def capture_signer_identity(binding, running):
    import subprocess
    unit='ynx-consensus-pq-remote-signer.service'
    config='/etc/ynx/consensus-pq-remote-signer.conf'
    launcher='/usr/local/libexec/ynx-consensus-pq-remote-signer-launch'
    binary='/usr/local/libexec/ynx-consensus-pq-remote-signer'
    unit_file='/etc/systemd/system/'+unit
    def show(key):
        return subprocess.check_output(['/usr/bin/systemctl','show','--property',key,'--value',unit],timeout=5,text=True).strip()
    for fixed in (config,launcher,binary,unit_file):
        f=Path(fixed);st=f.lstat()
        need(str(f.resolve(strict=True))==fixed and stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==0 and not st.st_mode&0o022,
             'original root-owned signer public installation required')
    need(show('FragmentPath')==unit_file and show('DropInPaths')=='' and
         'path='+launcher+' ;' in show('ExecStart') and show('User')=='ynx-pq-signer', 'original signer service identity differs')
    c, confraw=load(config,limit=16<<10)
    role=binding['originalRole'];source=binding['sourcePlan']
    expected=dict(schema='ynx-pq-remote-service-v1',binary=binary,binarySHA256=binding['binarySHA256']['ynx-consensus-pq-remote-signer'],
                  abciState=role['abciState'],legacyKey=role['legacyKeyPath'],legacyState=role['legacyStatePath'],
                  pqState=source['signingStatePath'],listen=role['remoteSigner'],scheduleHash=source['scheduleHash'],
                  cometGenesisSHA256=source['consensusGenesisSHA256'],originalGenesisHash=source['originalGenesisHash'],
                  migrationStateHash=source['migrationStateHash'],runtimePlanHash=source['runtimePlanHash'])
    need(all(c.get(k)==v for k,v in expected.items()), 'original signer/current operator configuration differs')
    need(digest_original(binary,128<<20)==expected['binarySHA256'],'installed signer binary differs from exact SOURCE')
    result=dict(configSHA256=sha(confraw),unitSHA256=digest_original(unit_file,1<<20),
                launcherSHA256=digest_original(launcher,1<<20),binarySHA256=expected['binarySHA256'])
    if running:
        pid=show('MainPID');need(show('ActiveState')=='active' and decimal(pid),'original signer is not running')
        proc=Path('/proc')/pid
        def ticks():return (proc/'stat').read_text().rsplit(')',1)[1].split()[19]
        start=ticks();need(os.readlink(proc/'exe')==binary,'signer executable identity differs')
        # /proc/exe is intentionally kernel-selected; never treat it as an
        # arbitrary proof material path or put argv/credential data in output.
        with (proc/'exe').open('rb') as f:
            h=hashlib.file_digest(f,'sha256').hexdigest()
        need(h==expected['binarySHA256'],'actual signer executable differs')
        args=(proc/'cmdline').read_bytes().split(b'\0');need(args[-1]==b'' and args[0]==binary.encode(),'original signer argv required')
        words=[v.decode('utf-8') for v in args[:-1]]
        for flag,value in [('--abci-state',role['abciState']),('--legacy-state',role['legacyStatePath']),
                           ('--pq-engine-schedule-hash',source['scheduleHash']),('--pq-host-key-binding',c['binding']),
                           ('--listen',role['remoteSigner']),('--recovery-fd','3')]:
            need(words.count(flag)==1 and words[words.index(flag)+1]==value,'original signer argument differs: '+flag)
        group=show('ControlGroup');need(group.startswith('/') and '..' not in Path(group).parts,'original signer cgroup required')
        need(pid in (Path('/sys/fs/cgroup'+group)/'cgroup.procs').read_text().splitlines() and ticks()==start and show('MainPID')==pid,
             'signer changed during observation')
        need(show('ExecMainPID')==pid and decimal(show('ExecMainStartTimestampMonotonic')), 'original signer invocation coordinates required')
        result.update(mainPid=pid,startTicks=start,invocationId=show('InvocationID'),execMainStartTimestampMonotonic=show('ExecMainStartTimestampMonotonic'))
    else:
        need(show('ActiveState')=='inactive' and show('MainPID')=='0','original signer has not stopped')
    return result

def remote_capture_inputs(binding_path, approval_path, source_path, package_path, plan_path, start_path, cutover_path):
    """Recheck the staged public bindings against original installed-operation records."""
    b, _ = load(binding_path, limit=1 << 20)
    need(b['version'] == 'YNX-OPERATOR-LIGHT-CAPTURE-BINDING/v1' and b['phase'] in ('capture', 'resume'), 'fixed capture binding required')
    a, _ = load(approval_path, b['approvalSHA256'], 1 << 20)
    need(a['version'] == 'YNX-OPERATOR-LIGHT-CAPTURE-APPROVAL/v1' and a['approved'] is True and
         a['phase'] == b['phase'] and all(a[k] == b[k] for k in a if k not in ('version','approved')), 'original explicit phase approval changed')
    expires = datetime.datetime.fromisoformat(b['expiresAt'].replace('Z', '+00:00'))
    need(expires.tzinfo is not None and expires > datetime.datetime.now(datetime.timezone.utc), 'phase approval expired')
    original_cutover,_=load(cutover_path,b['cutoverApprovalSHA256'],1<<20)
    need(original_cutover['expiresAt']==b['cutoverExpiresAt'] and original_cutover['approved'] is True,'original cutover approval changed')
    cutoff=datetime.datetime.fromisoformat(b['cutoverExpiresAt'].replace('Z','+00:00'))
    need(cutoff.tzinfo is not None and cutoff>datetime.datetime.now(datetime.timezone.utc),'original cutover approval expired; preserve UNKNOWN')
    src, _ = load(source_path, b['runtimeManifestSHA256'], 1 << 20)
    need(src['commit'] == b['runtimeCommit'] and src['platform'] == 'linux/amd64' and
         all(src['binaries'][k]['sha256'] == v for k,v in b['binarySHA256'].items()), 'actual runtime differs')
    p, _ = load(Path(package_path)/'common/operator-plan.json', b['operatorPlanSHA256'])
    s, _ = load(plan_path, b['sourcePlanSHA256'], 32 << 10)
    need(s == b['sourcePlan'] and set(s) == SOURCE_PLAN_FIELDS, 'original source plan changed')
    roles = {r['role']:r for r in p['roles']}
    need(len(p['roles']) == 4 and set(roles) == set(ROLES) and roles[b['role']] == b['originalRole'], 'original role changed')
    need(not p.get('bootstrapRegistrationMode') and p['heightHaltSessionId'] == b['heightHaltSessionId'] and
         roles[b['role']]['heightHaltControlPath'] == b['heightHaltControlPath'], 'current normal profile changed')
    need(s['signingStatePath'] == b['originalRole']['hostBinding']['SignerStatePath'], 'original signer binding changed')
    old, _ = load(start_path, b['originalStartSHA256'], 1 << 20)
    need(old['status'] == 'started_activation_unproven' and old['phase'] == 'start' and
         old['nextOperatorPlanSHA256'] == b['operatorPlanSHA256'] and old['runtimeCommit'] == b['runtimeCommit'] and
         old['runtimeManifestSHA256'] == b['runtimeManifestSHA256'] and old['role'] == b['role'] and
         old['transitionId'] == b['transitionId'], 'actual original transition start required')
    need(b['transitionId'] == b['cutoverTransactionId'] and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', b['transitionId']), 'same original operation required')
    need(b['captureRoot'] == '/var/lib/ynx-chain/operator-transitions/'+b['transitionId']+'/'+b['role']+'/capture-attempt' and
         b['output'] == '/var/tmp/ynx-public-light-'+b['transitionId']+'-'+b['role']+'/delivery', 'fixed original output required')
    return b


def signing_metadata(path):
    p = Path(path); st = p.lstat()
    need(str(p.resolve(strict=True)) == str(p) and stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o600 and
         st.st_nlink == 1 and st.st_size > 0, 'original single-link private signing state required')
    return dict(zip(('device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs'),
                    map(str,(st.st_dev,st.st_ino,st.st_mode,st.st_uid,st.st_gid,st.st_size,st.st_mtime_ns,st.st_ctime_ns))))


def check_capture_checkpoint(binding, path):
    c, raw = load(path, limit=1 << 20); s = binding['sourcePlan']
    need(c['version'] == 'YNX-OPERATOR-CHECKPOINT/v1' and all(c[k] is True for k in
         ('readOnly','sourceReadOnly','writerExcluded','signingWriterExcluded','engineCheckpointVerified')) and
         c['pqActivationVerified'] is False, 'actual full stopped checkpoint required')
    for key in ('chainId','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','stateLayout'):
        need(c[key] == s[key], 'actual checkpoint source differs: '+key)
    need(str(c['height']) == s['engineHeight'] and c['appHash'] == s['engineAppHash'] and
         c['committedScheduleHash'] == s['scheduleHash'] and c['nextScheduleHash'] is None,
         'actual stopped committed schedule/H/AppHash differs')
    return c, raw


def finish_capture(binding, attempt):
    p = Path(attempt); s = binding['sourcePlan']
    _, cp = check_capture_checkpoint(binding, p/'checkpoint.json')
    _, after = check_capture_checkpoint(binding, p/'checkpoint-after.json')
    need(cp == after, 'original checkpoint changed during export')
    before, _ = load(p/'signing-metadata.json', limit=4096)
    need(before == signing_metadata(s['signingStatePath']), 'original signing metadata changed during export')
    r, raw = load(p/'export-receipt.json', limit=1 << 20)
    fields = {'version','planSHA256','manifestPath','manifestSHA256','contextPath','contextSHA256','requestPath','requestSHA256',
              'engineHeight','engineAppHash','verification','publicDataOnly','sourceReadOnly','nativeRootAuthorized','deploymentVerified'}
    need(set(r) == fields and r['version'] == 'YNX-PQ-LIGHT-SOURCE-EXPORT/v1' and r['planSHA256'] == binding['sourcePlanSHA256'],
         'original successful Go export receipt required')
    need(r['publicDataOnly'] is True and r['sourceReadOnly'] is True and r['nativeRootAuthorized'] is False and r['deploymentVerified'] is False,
         'normal exporter DATA scope changed')
    output = binding['output']
    for key,name in (('manifest','delivery.json'),('context','trust-context.json'),('request','request.json')):
        need(r[key+'Path'] == output+'/'+name and digest_original(Path(output)/name,16<<20) == r[key+'SHA256'], 'actual export output changed')
    need(str(r['engineHeight']) == s['engineHeight'] and r['engineAppHash'] == s['engineAppHash'], 'actual export checkpoint changed')
    v = r['verification']
    need(v['classification'] == 'data' and v['commitVerified'] is True and v['lightTransitionVerified'] is True and
         str(v['headerHeight']) == s['headerHeight'] and str(v['stateHeight']) == str(int(s['headerHeight'])-1), 'actual full AND light verification required')
    request_raw = original(binding['heightHaltControlPath'], 4096)
    need(request_raw == original(str(p/'halt-request.json'),4096), 'original consumed halt request changed')
    return dict(version='YNX-OPERATOR-LIGHT-CAPTURE-RESULT/v1',phase='capture',status='stopped_exported',
        **{k:binding[k] for k in ('transitionId','cutoverTransactionId','role','runtimeCommit','runtimeManifestSHA256','operatorPlanSHA256',
                                 'inputSHA256','sourcePlanSHA256','captureRoot','output')},
        captureApprovalSHA256=binding['approvalSHA256'],engineHeight=s['engineHeight'],engineAppHash=s['engineAppHash'],
        headerHeight=s['headerHeight'],stateHeight=str(int(s['headerHeight'])-1),checkpointSHA256=sha(cp),haltRequestSHA256=sha(request_raw),
        signingStateIdentity=before,exportReceiptSHA256=sha(raw),deliverySHA256=r['manifestSHA256'],originalMaterialRetained=True,
        sourceReadOnly=True,nativeRootAuthorized=False,deploymentVerified=False)


def retain_consumed_halt(binding, capture, current_checkpoint):
    """Explicit resume only: retain the exact consumed inode with Linux NOREPLACE."""
    import ctypes
    need(binding['phase'] == 'resume', 'explicit independently pinned resume required')
    p = Path(binding['heightHaltControlPath'])
    target = p.with_name(p.name+'.consumed-'+binding['transitionId'])
    need(not os.path.lexists(target), 'existing retained request/UNKNOWN; no retry')
    _, cp = check_capture_checkpoint(binding, current_checkpoint)
    need(sha(cp) == capture['checkpointSHA256'] and signing_metadata(binding['sourcePlan']['signingStatePath']) == capture['signingStateIdentity'],
         'cold checkpoint/signing identity changed before resume')
    fd = os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600 and 0<st.st_size<=4096,
             'private original halt request required')
        raw=os.read(fd,4097)
        need(len(raw)==st.st_size and sha(raw)==capture['haltRequestSHA256'] and identity(st)==identity(p.lstat())==identity(os.fstat(fd)),
             'consumed halt request changed')
        need(sys.platform.startswith('linux'), 'normal Linux NOREPLACE rename required')
        libc=ctypes.CDLL(None,use_errno=True); rename=libc.renameat2
        rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
        if rename(-100,os.fsencode(p),-100,os.fsencode(target),1) != 0:
            code=ctypes.get_errno();raise OSError(code,os.strerror(code))
        fsync_dir(p.parent)
        after=target.lstat();held=os.fstat(fd)
        stable=lambda v:(v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid,v.st_nlink,v.st_size,v.st_mtime_ns)
        need(stable(st)==stable(after)==stable(held) and original(str(target),4096)==raw and not os.path.lexists(p),
             'retained consumed request changed; preserve UNKNOWN')
    finally:
        os.close(fd)
    return str(target)

def received_source_proof(root, data, directory=None):
    """Read only an original normal capture and its completed transport."""
    if 'proofSource' not in data:
        need(directory is None, 'legacy local proof cannot adopt remote public transport')
        return data
    packet, selection = data['input'], data['proofSource']; role = selection['role']
    capture_path = Path(packet['transitionRoot'])/'capture-attempt'/(role+'.result.json')
    capture, capture_raw = load(capture_path, limit=1<<20)
    validate_capture_receipt(data,capture,capture_raw)
    resume, _ = load(Path(packet['transitionRoot'])/'resume-attempt'/(role+'.result.json'),limit=1<<20)
    need(set(resume) == CAPTURE_FIELDS | {'resumeApprovalSHA256','captureSHA256','currentProcess','signerProcess'} and
         resume['phase']=='resume' and resume['status']=='resumed_activation_unproven' and
         resume['captureSHA256']==sha(capture_raw) and pin(resume['resumeApprovalSHA256']) and
         all(resume[k]==v for k,v in capture.items() if k not in ('phase','status')), 'completed original explicit resume required')
    for process in (resume['currentProcess'],resume['signerProcess']):
        need(type(process) is dict and decimal(process.get('mainPid')) and decimal(process.get('startTicks')), 'actual resumed process identity required')
    marker_path = root/'pq-continuation-attempt/export-selection.json'
    if directory is None:
        selected, _ = load(marker_path,limit=16<<10)
        need(set(selected)=={'inputSHA256','captureSHA256','directory'} and selected['inputSHA256']==data['inputSHA256'] and
             selected['captureSHA256']==sha(capture_raw), 'retained original capture selection required')
        directory=selected['directory']
    requested=private_root(directory)
    marker,_=load(root/'linux-public-data-root.json',limit=16<<10)
    need(set(marker)=={'version','transaction','parent','parentDevice','parentInode','dataRoot'} and
         marker['version']=='YNX-PUBLIC-LINUX-DATA-ROOT/v1' and marker['transaction']==str(root), 'original external public data root required')
    parent=private_root(marker['parent']);st=parent.stat()
    need(marker['parentDevice']==str(st.st_dev) and marker['parentInode']==str(st.st_ino) and
         marker['dataRoot']==str(parent/root.name),'external original public data parent identity changed')
    work=private_root(marker['dataRoot'])/'linux-public-tools'
    need(work.is_dir() and not work.is_symlink() and str(work.resolve(strict=True))==str(work),'original transport workspace required')
    spec=importlib.util.spec_from_file_location('quiet_original_linux_tools',Path(__file__).with_name('public-bft-linux-public-tools.py'))
    bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
    public=requested
    if requested.parent==work and re.fullmatch('[0-9a-f]{64}',requested.name):
        case_request=bridge.validate_request(load(requested/'request.json',limit=2<<20)[0])
        need(sha(bridge.encode(case_request))==requested.name,'original publication case changed')
        public=private_root(case_request['destination'])
    entries=list(work.iterdir());need(len(entries)<=128,'bounded original request inventory')
    matched=[]
    for entry in entries:
        if not re.fullmatch('[0-9a-f]{64}',entry.name) or not (entry/'PUBLISHED.json').is_file():continue
        private_root(str(entry))
        request=bridge.validate_request(load(entry/'request.json',limit=2<<20)[0])
        need(sha(bridge.encode(request))==entry.name,'original request path changed')
        if request['destination']!=str(public):continue
        need(request['operation'] in ('light-files','light-metadata') and request['role']==role and request['transaction']==root.name and
             request['commit']==packet['runtimeCommit'] and request['sourceSHA256']==packet['runtimeManifestSHA256'] and
             request['arguments']==dict(captureRoot=capture['captureRoot'],captureReceiptSHA256=sha(capture_raw),sourcePlanSHA256=selection['sourcePlanSHA256']),
             'transport is not the same original capture/source/role/operation')
        _,status=bridge.retained_result(entry,request)
        need(status==0,'original capture transport failed')
        matched.append((entry,request))
    need(len(matched)==1,'one completed original capture transport required; partial streams cannot be joined')
    need(original(str(public/'capture-receipt.json'),1<<20)==capture_raw,'actual SSH receipt and published receipt differ')
    need(sha(original(str(public/'source-plan.json'),32<<10))==selection['sourcePlanSHA256'],'original source plan changed in transport')
    export_raw=original(str(public/'export-receipt.json'),1<<20)
    need(sha(export_raw)==capture['exportReceiptSHA256'],'actual Go stdout changed in transport')
    receipt,context,_=bridge.light_delivery(public/'delivery',selection['output'],export_raw,capture['deliverySHA256'],selection['sourcePlanSHA256'],
                                          metadata_only=matched[0][1]['operation']=='light-metadata')
    need(set(context)==CONTEXT_FIELDS and all(type(v) is str for v in context.values()),'full original light context required')
    for key in ('chainId','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','runtimePlanHash'):
        need(context[key]==data['plan'][key],'original exported context source differs')
    s=data['sourcePlan']
    need(context['engineHeight']==s['engineHeight'] and context['engineAppHash']==s['engineAppHash'] and
         context['expectedHeaderHeight']==s['headerHeight'] and context['expectedStateHeight']==str(int(s['headerHeight'])-1) and
         context['scheduleHash']==s['scheduleHash'],'original exported active-state coordinates differ')
    validate_proof_result(receipt['verification'],context)
    proof=dict(trustContext=str(public/'delivery/trust-context.json'),trustContextSHA256=receipt['contextSHA256'],
               request=str(public/'delivery/request.json'),requestSHA256=receipt['requestSHA256'])
    return {**data,'proof':proof,'context':context,'headerHeight':context['expectedHeaderHeight'],'blockHash':context['expectedBlockHash'],
            'stateHeight':context['expectedStateHeight'],'stateAppHash':context['expectedStateAppHash'],
            'exportSelection':dict(inputSHA256=data['inputSHA256'],captureSHA256=sha(capture_raw),directory=str(requested))}

def resume_check(root_path, plan_path, plan_pin, packet_path, packet_pin):
    root = private_root(root_path)
    result = continuation(root_path, plan_path, plan_pin, packet_path, packet_pin)
    if os.path.lexists(root / 'pq-continuation-attempt'):
        # A fully committed result with a lost stdout is read back, never
        # dispatched again. Every partial or failed attempt remains UNKNOWN.
        need((root / 'pq-continuation-attempt/result.json').is_file(), 'incomplete continuation/UNKNOWN; no redispatch')
        final, _ = load(root / 'pq-continuation-attempt/result.json', limit=1 << 20)
        need(final == {'status': 'passed', 'automaticRetry': False, 'inputSHA256': packet_pin}, 'incomplete original continuation result')
        journal(root, expected_prefix(root) + [('bootstrap', 'awaiting_pq_activation')] + pairs(TAIL) + [('transaction', 'passed')])
        forward_gate(root_path, plan_path, plan_pin)
        return {**final, 'reconciled': True, 'redispatched': False}
    raw = journal(root, expected_prefix(root) + [('bootstrap', 'awaiting_pq_activation')])
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
        info = received_source_proof(root, continuation(root_path, plan_path, plan_pin, packet_path, packet_pin))
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
    data = received_source_proof(root, continuation(root_path, plan_path, plan_pin, packet_path, packet_pin))
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
        journal(root, expected_prefix(root) + [('bootstrap', 'awaiting_pq_activation')] +
                pairs(TAIL[:TAIL.index(phase)]) + [(phase, 'started')])
    intent, _ = load(root / 'pq-continuation-attempt/intent.json', limit=1 << 20)
    packet_path = str(root / 'pq-continuation-attempt/input.json')
    data = received_source_proof(root, continuation(root_path, plan_path, plan_pin, packet_path, intent['inputSHA256']))
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
    p.add_argument('action', choices=('abort-observation-result', 'abort-phase-result', 'abort-start', 'abort-check', 'abort-complete', 'abort-observation', 'abort-remote-observe', 'snapshot-start-check', 'native-continuation-check', 'snapshot-complete', 'mode', 'pause', 'resume-check', 'observe-command', 'ready', 'verify-results', 'forward-gate', 'proof-args', 'export-args', 'capture-binding', 'target-package'))
    p.add_argument('--transaction')
    p.add_argument('--plan')
    p.add_argument('--plan-sha256')
    p.add_argument('--input')
    p.add_argument('--input-sha256')
    p.add_argument('--package')
    p.add_argument('--runtime')
    p.add_argument('--role', choices=ROLES)
    p.add_argument('--evidence')
    p.add_argument('--phase', choices=TAIL[1:]+['capture','resume']+ABORT_PHASES)
    p.add_argument('--approval')
    p.add_argument('--approval-sha256')
    p.add_argument('--export-receipt-dir')
    a = p.parse_args()
    if a.action=='abort-observation-result':
        abort_observation_result(a.transaction,a.role,a.phase,a.evidence)
    elif a.action=='abort-phase-result':
        abort_phase_result(a.transaction,a.phase)
    elif a.action=='abort-start':
        print(json.dumps(abort_start(a.transaction)))
    elif a.action=='abort-check':
        abort_boundary(a.transaction,a.phase)
    elif a.action=='abort-complete':
        print(json.dumps(abort_complete(a.transaction)))
    elif a.action=='abort-observation':
        print(base64.b64encode(json.dumps(abort_observation_request(a.transaction,a.role,a.phase,a.evidence),separators=(',',':')).encode()).decode())
    elif a.action=='abort-remote-observe':
        print(json.dumps(abort_remote_observe(decode(base64.b64decode(a.input,validate=True)))))
    elif a.action in ('snapshot-start-check', 'native-continuation-check'):
        print(native_boundary(a.transaction, a.action == 'snapshot-start-check'))
    elif a.action == 'snapshot-complete':
        print(json.dumps(snapshot_complete(a.transaction), separators=(',', ':'), sort_keys=True))
    elif a.action == 'mode':
        print(selected_plan(a.plan, a.plan_sha256).get('bootstrapRegistrationMode', ''))
    elif a.action == 'pause':
        print(json.dumps(pause(a.transaction, a.plan, a.plan_sha256)))
    elif a.action == 'resume-check':
        print(json.dumps(resume_check(a.transaction, a.plan, a.plan_sha256, a.input, a.input_sha256)))
    elif a.action == 'capture-binding':
        print(json.dumps(capture_binding(a.transaction,a.plan,a.plan_sha256,a.input,a.input_sha256,a.approval,a.approval_sha256,a.phase,a.runtime),separators=(',',':'),sort_keys=True))
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
        elif a.action == 'export-args':
            need('proofSource' in data, 'normal source profile required; legacy context cannot select remote export')
            for key in ('role', 'sourcePlan', 'sourcePlanSHA256', 'output'):
                value = data['proofSource'][key]
                need('\n' not in value and '\r' not in value, 'source scalar contains controls')
                print(value)
        else:
            if 'proofSource' in data:
                data = received_source_proof(private_root(a.transaction), data, a.export_receipt_dir)
                marker = Path(a.transaction)/'pq-continuation-attempt/export-selection.json'
                if marker.exists():
                    need(load(marker,limit=16<<10)[0]==data['exportSelection'],'original capture selection changed')
                else:
                    publish(marker,data['exportSelection'])
            else:
                need(a.export_receipt_dir is None,'legacy local context cannot adopt remote transport')
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
