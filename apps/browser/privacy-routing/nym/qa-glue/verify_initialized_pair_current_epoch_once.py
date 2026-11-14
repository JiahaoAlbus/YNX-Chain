"""New explicit 360s PUBLIC QA scope for the exact completed synthetic init below.

No init/reinit/add-gateway or profile copying. Retains the original failed receipt
and UNKNOWN intent bytes, reconciles only its actual init-complete/exit evidence,
then obtains a fresh directory and fixes the SAME pair for remaining PUBLIC QA.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import threading
import time
import uuid

import mac_cdn_fresh_executor as glue

ORIGINAL = glue.R2/'case-cdn-20261108T020745Z-00c54c'
RESULT_SHA = 'a87cdaaf91f6a26e03efdca935c0f9abf5377fd702a84f76d336263bbc83763a'
GLUE_SHA = '8a9e3955d5481efbf3a25b6b70b75ad0edb8a109b73007e83b1cd077f639c8f8'
SCOPE_FILE = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-epoch-diagnostic-20261108/PUBLIC_PAIR_CURRENT_EPOCH_SCOPE.json')
SCOPE_SHA = 'e8d8b398fb99d606d871986cfbf1536b45b7b91c01a364e7b65d5d2b83992d13'


def main():
    scope_started = time.monotonic()
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--execute', action='store_true', required=True)
    p.parse_args(); os.umask(0o077)
    if glue.sha(SCOPE_FILE) != SCOPE_SHA:
        raise RuntimeError('explicit-PUBLIC-scope-pin')
    scope = json.loads(SCOPE_FILE.read_text())
    if scope['NoProductionAuthority'] is not True or scope['wholeSeconds'] != 360 or scope['directoryCount'] != 1:
        raise RuntimeError('explicit-PUBLIC-scope-contract')
    last_failure=Path(scope['last360Failure']['path'])
    if glue.sha(last_failure)!=scope['last360Failure']['SHA256'] or json.loads(last_failure.read_text())['remainingOwned']:
        raise RuntimeError('last-consumed-scope-not-terminal')
    bridge_path=Path(__file__).with_name('current_epoch_directory_bridge.py')
    if glue.sha(bridge_path)!=scope['bridgeSHA256']:
        raise RuntimeError('current-directory-bridge-pin')
    bridge=glue.load('dual_executor_bridge',bridge_path,scope['bridgeSHA256'])
    previous_result = glue.R2/'case-cdn-successor-20261108T021250Z-0d4cf0/result.json'
    if glue.sha(previous_result) != scope['previousSuccessorResultSHA256'] or json.loads(previous_result.read_text())['remainingOwned']:
        raise RuntimeError('previous-successor-not-terminal')
    if glue.sha(ORIGINAL/'init-complete.json') != scope['originalInitCompleteSHA256'] or glue.sha(Path(glue.__file__).with_name('qa_directory_capture.py')) != scope['captureSHA256']:
        raise RuntimeError('completed-init-or-capture-pin')
    if glue.sha(Path(glue.__file__)) != GLUE_SHA or glue.sha(ORIGINAL/'result.json') != RESULT_SHA:
        raise RuntimeError('successor-original-binding')
    result = json.loads((ORIGINAL/'result.json').read_text())
    if result['remainingOwned'] or result['firstFailure']['message'] != 'rfc-1-output-limit':
        raise RuntimeError('original-terminal-not-eligible')
    children = result['originalChildren']
    if [(c['label'], c['exit']) for c in children] != [('directory-1',0),('official-init',0),('list-gateways',0),('run-1',0),('rfc-1',0)]:
        raise RuntimeError('original-actual-stages')
    if any(not c['reaped'] or not c['cleanupConfirmed'] or not (c['stdoutEOF'] is True and c['stderrEOF'] is True) or c['actualFDClosed'] != [True,True] for c in children):
        raise RuntimeError('original-child-or-FD-not-confirmed')
    events = [json.loads(line) for line in (ORIGINAL/'events.jsonl').read_text().splitlines()]
    starts = [x for x in events if x['kind'] == 'executor-start']
    choices = [x['value'] for x in events if x['kind'] == 'current-selection']
    if len(starts) != 1 or len(choices) != 1:
        raise RuntimeError('original-operation-ambiguous')
    origin_start = dt.datetime.fromisoformat(starts[0]['utc']).timestamp()
    # Independent new parent scope; the original 900s receipt/deadline is not renewed.
    remaining = 360
    profile_id = glue.fresh_profile_id(result['profileID'])
    completed = json.loads((ORIGINAL/'init-complete.json').read_text())
    intent = json.loads((ORIGINAL/'init-intent-UNKNOWN.json').read_text())
    if intent['profileID'] != profile_id or intent['state'] != 'UNKNOWN' or completed['actualChildExit'] != 0 or completed['originalChildReaped'] is not True:
        raise RuntimeError('completed-init-not-reconciled')
    network = glue.load('resume_network', glue.O/'run_cdn_directory_nr_once.py', '092f7077c07ac094b7c91d4da9e92a7c106382e59b1faef704eb4308b23e7643')
    facts = network.facts()
    if facts['memoryFreePercent'] < 35 or facts['homeFreeBytes'] < 2*glue.GIB+64*1024**2 or facts['WDFreeBytes'] < 16*glue.GIB:
        raise RuntimeError('fresh-resource-floor-no-child')
    producer = glue.load('resume_producer', glue.O/'produce_qa_cdn_plan_nr_logfix.py', '9d3e337d6bd65d113182186c11cd2a9d61805af0f774041f0b2693fa8a812622')
    directory_binary, binary = bridge.pinned_binaries()
    digest=glue.sha(binary)
    if digest != glue.RUNTIME_SHA:
        raise RuntimeError('runtime-pin')
    r2 = glue.load('resume_original_r2', glue.R2/'r2_executor.py', '330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67')
    guard = glue.load('resume_owned_groups', glue.O/'run_fullfeature_v4.py', 'b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05')
    producer.facts = network.facts
    base = glue.configure(r2, guard, producer, binary)
    Experiment = bridge.install(base,r2,directory_binary)
    case = glue.R2/('case-current-epoch-pair-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:6])
    remaining = int(360-(time.monotonic()-scope_started))
    if remaining <= 30:
        raise RuntimeError('scope-preflight-exhausted-no-child')
    exp = Experiment(argparse.Namespace(out=case, port=63781, budget_seconds=remaining))
    # More conservative than the authorized minimum 20s: cover at most two
    # original children (15s each), bounded FD joins and final fingerprint calls.
    exp.end -= 25
    exp.home = ORIGINAL/'home'; exp.profileID = profile_id
    exp.profile = exp.home/'.nym/socks5-clients'/profile_id
    exp.environment['NYM_HOME_DIR'] = str(exp.home)
    exp.publicAddressSHA256 = completed['publicClientAddressSHA256']
    signal.signal(signal.SIGINT, lambda *_: setattr(exp,'stopRequested',True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(exp,'stopRequested',True))
    lock = None; before = r2.network_fingerprint(); monitor = None
    try:
        lock = os.open(exp.profile/'.ynx-run.lock', os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
        st = os.fstat(lock)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1 or stat.S_IMODE(st.st_mode) != 0o600:
            raise r2.Failed('original-profile-lock-unsafe')
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        initial = r2.profile_metadata(exp.profile)
        if initial != completed['metadata']:
            raise r2.Failed('completed-original-profile-metadata-changed')
        r2.verify_config_scope(exp.profile, profile_id)
        init_policy = json.loads((ORIGINAL/'init-policy.json').read_text())
        parts = [(ORIGINAL/('directory-1-'+key+'.json')).read_bytes() for key in ('basic','described','epoch')]
        if [hashlib.sha256(part).hexdigest() for part in parts] != init_policy['directorySHA256']:
            raise r2.Failed('original-selection-data-digest')
        basic, described, _ = [json.loads(part) for part in parts]
        choice = choices[0]
        entry = next(x for x in basic['nodes']['data'] if x['node_id'] == choice['entryID'])
        detail = next(x['description'] for x in described['data'] if x['node_id'] == choice['requesterID'])
        previous = dict(entryIdentity=entry['ed25519_identity_pubkey'], requester=detail['network_requester']['address'])
        if previous['entryIdentity'] != init_policy['entryIdentity'] or hashlib.sha256(previous['requester'].encode()).hexdigest() != choice['requesterSHA256']:
            raise r2.Failed('original-pair-binding')
        # CAS once-only successor marker; no modification of original intent/result.
        r2.write_new(SCOPE_FILE.with_name('PUBLIC_PAIR_CURRENT_EPOCH_STARTED.json'), dict(case=str(case), originalResultSHA256=RESULT_SHA, **r2.stamp()))
        r2.write_new(case/'reconciliation.json', dict(originalResultSHA256=RESULT_SHA,
                      originalInitIntentSHA256=glue.sha(ORIGINAL/'init-intent-UNKNOWN.json'),
                      originalInitCompleteSHA256=glue.sha(ORIGINAL/'init-complete.json'),
                      previousCaseDeadlineUTCUnchanged=origin_start+900, newExplicitTotalSeconds=360, newScopeSHA256=SCOPE_SHA, NoProductionAuthority=True,
                      driverSHA256=glue.sha(Path(__file__)), glueSHA256=GLUE_SHA, directoryBridgeSHA256=scope['bridgeSHA256'], directoryBinarySHA256=bridge.DIRECTORY_SHA, runtimeBinarySHA256=glue.RUNTIME_SHA, noInitReplay=True,
                      sameOriginalProfile=True, originalPrivateKeyContentsReadOrHashed=False))
        original_sample = exp.sample_resources
        fingerprint_baseline=before['fingerprintSHA256']
        def abort_original_children(message):
            if exp.resourceFailure is None:
                exp.resourceFailure=dict(stage=exp.stage,type='Failed',message=message,**r2.stamp())
            for child in list(exp.children):
                if child.process.poll() is None:
                    try: child.process.send_signal(signal.SIGINT)
                    except ProcessLookupError: pass
            raise r2.Failed(message)
        def sample_original_profile():
            original_sample()
            if r2.profile_metadata(exp.profile) != initial:
                abort_original_children('original-profile-metadata-changed-during-operation')
            observed=r2.network_fingerprint()
            if observed['fingerprintSHA256']!=fingerprint_baseline:
                abort_original_children('security-network-fingerprint-changed')
        exp.sample_resources = sample_original_profile
        monitor = threading.Thread(target=exp.monitor, daemon=True); monitor.start()
        exp.event('successor-start', dict(pid=os.getpid(), pgid=os.getpgrp(), originalResultSHA256=RESULT_SHA, noInitReplay=True, remainingTotalSeconds=remaining))
        value, digests = exp.directory('directory-successor'); exp.selection = exp.select(value, digests, previous)
        exp.stage = 'gateway-readback'
        rows = json.loads(exp.run('list-gateways', exp.policy('gateway',exp.selection)+['list-gateways','--id',profile_id,'--output','json'],limit=1048576,seconds=30))
        active = [row for row in rows if row.get('active') is True]; endpoint = exp.selection['endpoints'][-1]
        if len(active) != 1 or active[0].get('fallback_endpoint','missing') is not None or bytes(active[0].get('identity',[])) != r2.identity_bytes(previous['entryIdentity']) or str(active[0].get('endpoint','')).rstrip('/') != 'wss://'+endpoint['host']+':'+str(endpoint['port']):
            raise r2.Failed('successor-official-gateway-readback')
        child = exp.bootstrap('run-1'); exp.socks(); exp.https('rfc-1')
        if exp.stop_child(child) != 0 or child.forced:
            raise r2.Failed('successor-stop-not-graceful')
        if r2.profile_metadata(exp.profile) != initial:
            raise r2.Failed('successor-storage-changed')
        # This scope allows exactly one fresh directory. The already selected
        # immutable snapshot/pair stays within its original epoch-validUntil;
        # restart gets a NEW <=110s route policy, never a renewed directory lease.
        exp.check()
        exp.event('same-snapshot-restart-bound', dict(directoryCount=1, samePair=True, epoch=exp.selection['epoch'], selectionExpiresAt=exp.selection['expiresAt']))
        child = exp.bootstrap('run-restart'); exp.https('rfc-restart')
        if exp.stop_child(child) != 0 or child.forced:
            raise r2.Failed('successor-restart-stop-not-graceful')
        if r2.profile_metadata(exp.profile) != initial:
            raise r2.Failed('successor-restart-storage-changed')
        exp.event('explicit-followup-stages-completed', dict(initCountThisOperation=0, samePair=True, normalPrivacyAdmission=False))
    except BaseException as error:
        exp.first = exp.resourceFailure or dict(stage=exp.stage,type=type(error).__name__,message=r2.redact(str(error)),**r2.stamp())
        exp.event('first-failure',exp.first)
    finally:
        exp.stage = 'final-cleanup'
        for child in reversed(exp.children):
            if child.stopped is None:
                try:
                    exp.stop_child(child)
                except BaseException as error:
                    if exp.first is None:
                        exp.first = dict(stage='cleanup',type=type(error).__name__,message=r2.redact(str(error)),**r2.stamp())
        exp.monitorDone.set()
        if monitor is not None: monitor.join(timeout=3)
        if lock is not None:
            fcntl.flock(lock, fcntl.LOCK_UN); os.close(lock)
        after = r2.network_fingerprint()
        receipt = dict(schema='P05_NYM_CURRENT_EPOCH_SAME_PAIR_RESULT_V1', scopeSHA256=SCOPE_SHA, NoProductionAuthority=True, totalSeconds=360, directoryCount=1, firstFailure=exp.first,
                       originalResultSHA256=RESULT_SHA, originalResultUnchanged=glue.sha(ORIGINAL/'result.json')==RESULT_SHA,
                       originalChildren=[c.receipt() for c in exp.children], remainingOwned=[c.pid for c in exp.children if c.process.poll() is None],
                       directoryBinarySHA256=bridge.DIRECTORY_SHA,runtimeBinarySHA256=glue.RUNTIME_SHA,
                       peakOwnedAggregateRSSBytes=exp.peakRSS, metadata=r2.profile_metadata(exp.profile),
                       networkBefore=before, networkAfter=after, noInitOrRegistrationReplay=True,
                       privateKeyContentsReadOrHashed=False, normalPrivacyAdmission=False, NativeOrWK='NOT_RUN', finished=r2.stamp())
        r2.write_new(case/'result.json',receipt); exp.log.close()
        print(json.dumps(dict(terminal=True,result=str(case/'result.json'),firstFailure=exp.first,remainingOwned=receipt['remainingOwned'])),flush=True)
    return 1 if exp.first else 0


if __name__ == '__main__':
    raise SystemExit(main())
