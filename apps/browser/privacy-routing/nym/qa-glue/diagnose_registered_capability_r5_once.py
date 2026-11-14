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

ORIGINAL = glue.R2/'case-fresh-current-20261108T025826Z-c47bdb'
RESULT_SHA = 'f66578d0f83e94dce55c8fb96aedd3d8d1b9234672ae9eee53de115f49e864c2'
GLUE_SHA = '8a9e3955d5481efbf3a25b6b70b75ad0edb8a109b73007e83b1cd077f639c8f8'
SCOPE_FILE = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-persistent-capabilities-20261108/R5-modern-TLS/EXPERIMENT_PROPOSAL.json')

TLS_INPUTS = Path("/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-persistent-capabilities-20261108/R5-modern-TLS/TLS_TOOL_INPUTS.json")
TLS_INPUTS_SHA = 'bc7f0f77bf0c9e9522ffc1e09a516bab5c9045b8fe335e9253c9266cf0c2ebac'
MODERN_PROBE = '/opt/homebrew/Cellar/python@3.13/3.13.3/Frameworks/Python.framework/Versions/3.13/bin/python3.13'

def modern_component_metadata(verify_hashes=False):
    if glue.sha(TLS_INPUTS)!=TLS_INPUTS_SHA:raise RuntimeError('modern-TLS-input-manifest-pin')
    value=json.loads(TLS_INPUTS.read_text())
    if value['TLS13'] is not True or value['defaultCertRequired'] is not True or value['defaultHostnameVerification'] is not True or value['CAStats']['x509_ca']!=192:
        raise RuntimeError('modern-TLS-default-verification-contract')
    result={}
    for item in value['components']:
        locator=Path(item['locator']);resolved=locator.resolve(strict=True)
        if str(resolved)!=item['resolved']:raise RuntimeError('modern-TLS-component-link-changed')
        st=resolved.stat()
        record=[st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns]
        expected=[item['device'],item['inode'],item['bytes'],item['mtimeNS']]
        if record!=expected or (verify_hashes and glue.sha(resolved)!=item['sha256']):raise RuntimeError('modern-TLS-component-changed')
        result[str(locator)]=record
    capath=Path(value['capath'])
    inventory=[[str(path.relative_to(capath)),str(path.resolve())] for path in capath.rglob('*')] if capath.exists() else []
    if inventory!=value['capathInventory']:raise RuntimeError('modern-TLS-CA-directory-changed')
    return result

def reconciled_profile_id(result,intent):
    profile_id=glue.fresh_profile_id(result['newProfileID'])
    if intent.get('profileID')!=profile_id or intent.get('state')!='UNKNOWN':
        raise RuntimeError('completed-profile-intent-binding')
    return profile_id

def main():
    scope_started = time.monotonic()
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--execute', action='store_true', required=True)
    p.add_argument('--scope-sha256',required=True);args=p.parse_args();os.umask(0o077)
    SCOPE_SHA=args.scope_sha256
    if not re.fullmatch('[a-f0-9]{64}',SCOPE_SHA):raise RuntimeError('scope-pin-shape')
    if glue.sha(SCOPE_FILE) != SCOPE_SHA:
        raise RuntimeError('explicit-PUBLIC-scope-pin')
    scope = json.loads(SCOPE_FILE.read_text())
    modern_component_metadata(verify_hashes=True)
    if scope['NoProductionAuthority'] is not True or scope['wholeSeconds'] != 360 or scope['directoryCount'] != 1 or scope['initCountMaximum'] != 0:
        raise RuntimeError('explicit-PUBLIC-scope-contract')
    if not scope['notBeforeUnixSeconds']<=time.time()<scope['latestStartUnixSeconds']:
        raise RuntimeError('fixed-next-epoch-start-window-no-child')
    for name,digest in scope['sourcePins'].items():
        if glue.sha(Path(__file__).with_name(name))!=digest:raise RuntimeError('stage-source-pin:'+name)
    bridge_path=Path(__file__).with_name('capability_directory_bridge.py')
    bridge=glue.load('dual_executor_bridge',bridge_path,scope['sourcePins']['capability_directory_bridge.py'])
    observe_path=Path(__file__).with_name('nym_runtime_stage_observer.py')
    observe=glue.load('runtime_stage_observer',observe_path,scope['sourcePins']['nym_runtime_stage_observer.py'])
    if glue.sha(ORIGINAL/'init-complete.json') != scope['originalInitCompleteSHA256'] or glue.sha(Path(glue.__file__).with_name('qa_directory_capture.py')) != scope['sourcePins']['qa_directory_capture.py']:
        raise RuntimeError('completed-init-or-capture-pin')
    if glue.sha(Path(glue.__file__)) != GLUE_SHA or glue.sha(ORIGINAL/'result.json') != RESULT_SHA:
        raise RuntimeError('successor-original-binding')
    result = json.loads((ORIGINAL/'result.json').read_text())
    if result['remainingOwned'] or result['firstFailure']['message'] != 'rfc-first-exit-28':
        raise RuntimeError('original-terminal-not-eligible')
    children = result['originalChildren']
    if [(c['label'], c['exit']) for c in children] != [('directory-fresh',0),('official-init',0),('list-gateways',0),('run-1',0),('rfc-first',28)]:
        raise RuntimeError('original-actual-stages')
    if any(not c['reaped'] or not c['cleanupConfirmed'] or not (c['stdoutEOF'] is True and c['stderrEOF'] is True) or c['actualFDClosed'] != [True,True] for c in children):
        raise RuntimeError('original-child-or-FD-not-confirmed')
    events = [json.loads(line) for line in (ORIGINAL/'events.jsonl').read_text().splitlines()]
    starts = [x for x in events if x['kind'] == 'fresh-public-scope-start']
    choices = [x['value'] for x in events if x['kind'] == 'current-selection']
    if len(starts) != 1 or len(choices) != 1:
        raise RuntimeError('original-operation-ambiguous')
    origin_start = dt.datetime.fromisoformat(starts[0]['utc']).timestamp()
    # Independent new parent scope; the prior 360s receipt/deadline is not renewed.
    remaining = 360
    intent = json.loads((ORIGINAL/'init-intent-UNKNOWN.json').read_text())
    profile_id = reconciled_profile_id(result,intent)
    completed = json.loads((ORIGINAL/'init-complete.json').read_text())
    if intent['profileID'] != profile_id or intent['state'] != 'UNKNOWN' or completed['actualChildExit'] != 0 or completed['originalChildReaped'] is not True:
        raise RuntimeError('completed-init-not-reconciled')
    network = glue.load('resume_network', glue.O/'run_cdn_directory_nr_once.py', '092f7077c07ac094b7c91d4da9e92a7c106382e59b1faef704eb4308b23e7643')
    facts = network.facts()
    if facts['memoryFreePercent'] < 35 or facts['homeFreeBytes'] < 2*glue.GIB+64*1024**2 or facts['WDFreeBytes'] < 16*glue.GIB:
        raise RuntimeError('fresh-resource-floor-no-child')
    producer = glue.load('resume_producer', glue.O/'produce_qa_cdn_plan_nr_logfix.py', '9d3e337d6bd65d113182186c11cd2a9d61805af0f774041f0b2693fa8a812622')
    supply_path=bridge.D/'DIRECTORY_SUPPLY.json';supply_sha=scope['directorySupplySHA256']
    directory_binary,binary=bridge.pinned_binaries(supply_path,supply_sha)
    if glue.sha(directory_binary)!=scope['directoryBinarySHA256'] or glue.sha(binary)!=scope['runtimeBinarySHA256']:
        raise RuntimeError('capability-scope-executor-cohort-pin')
    digest=glue.sha(binary)
    if digest != glue.RUNTIME_SHA:
        raise RuntimeError('runtime-pin')
    r2 = glue.load('resume_original_r2', glue.R2/'r2_executor.py', '330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67')
    guard = glue.load('resume_owned_groups', glue.O/'run_fullfeature_v4.py', 'b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05')
    producer.facts = network.facts
    base = glue.configure(r2, guard, producer, binary)
    Experiment = bridge.install(base,r2,directory_binary,supply_path,supply_sha)
    observer=observe.RuntimeStageObserver(uuid.uuid4().hex,63801)
    observe.install_observed_child(r2,observer)
    case = glue.R2/('case-capability-request-phases-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:6])
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
        r2.verify_config_scope(exp.profile,profile_id)
        bridge.require_unmodified_sdk_role_defaults((exp.profile/'config/config.toml').read_text())
        init_policy = json.loads((ORIGINAL/'init-policy.json').read_text())
        parts = [(ORIGINAL/('directory-fresh-'+key+'.json')).read_bytes() for key in ('basic','described','epoch')]
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
        r2.write_new(SCOPE_FILE.with_name('CAPABILITY_STAGE_SCOPE_STARTED.json'), dict(case=str(case), originalResultSHA256=RESULT_SHA, **r2.stamp()))
        r2.write_new(case/'reconciliation.json', dict(originalResultSHA256=RESULT_SHA,
                      originalInitIntentSHA256=glue.sha(ORIGINAL/'init-intent-UNKNOWN.json'),
                      originalInitCompleteSHA256=glue.sha(ORIGINAL/'init-complete.json'),
                      previousCaseDeadlineUTCUnchanged=origin_start+360, newExplicitTotalSeconds=360, newScopeSHA256=SCOPE_SHA, NoProductionAuthority=True,
                      driverSHA256=glue.sha(Path(__file__)), glueSHA256=GLUE_SHA, directoryBridgeSHA256=scope['sourcePins']['capability_directory_bridge.py'], directoryBinarySHA256=scope['directoryBinarySHA256'], runtimeBinarySHA256=glue.RUNTIME_SHA, noInitReplay=True,
                      sameOriginalProfile=True, originalPrivateKeyContentsReadOrHashed=False))
        original_check=exp.check
        def check_with_requester_failure():
            original_check()
            if hasattr(exp,'requester_failure'):
                raise r2.Failed(exp.requester_failure['fixedReason']+':'+exp.requester_failure['classification'])
        exp.check=check_with_requester_failure
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
            modern_component_metadata()
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
        exp.environment['RUST_LOG']=observe.RUST_LOG
        exp.environment['PYTHONDONTWRITEBYTECODE']='1'
        with __import__('socket').socket() as reservation:reservation.bind(('127.0.0.1',63801))
        child=exp.bootstrap('run-stages')
        if observer.provider_sha256!=hashlib.sha256(exp.selection['requester'].encode()).hexdigest() or observer.counts.get('listener_protocols',0)!=1:
            raise r2.Failed('runtime-observer-provider-or-protocol-binding-unobserved')
        modern_component_metadata(verify_hashes=True)
        cap_code='import ssl,json; c=ssl.create_default_context(); print(json.dumps(dict(SSL=ssl.OPENSSL_VERSION,TLS13=ssl.HAS_TLSv1_3,certRequired=c.verify_mode==ssl.CERT_REQUIRED,hostname=c.check_hostname,CA=c.cert_store_stats())))'
        capability=json.loads(exp.run('modern-TLS-capability',[MODERN_PROBE,'-c',cap_code],limit=4096,seconds=5))
        if capability.get('TLS13') is not True or capability.get('certRequired') is not True or capability.get('hostname') is not True or capability.get('CA',{}).get('x509_ca')!=192 or capability.get('SSL')!='OpenSSL 3.6.4 25 Aug 2026':
            raise r2.Failed('modern-TLS-actual-defaults-unverified')
        r2.write_new(exp.out/'modern-TLS-actual-defaults.json',capability)
        exp.stage='RFC-staged-HTTPS'
        probe=Path(__file__).with_name('nym_https_stage_probe.py');probe_output=exp.out/'RFC-stage-probe'
        command=[MODERN_PROBE,str(probe),'--port','63781','--local-port','63801','--expires-at',str(exp.runtime_expiry),'--output',str(probe_output)]
        try:exp.run('rfc-stages',command,seconds=90)
        except r2.Failed:
            result_path=probe_output/'result.json'
            if result_path.exists() and result_path.stat().st_size<=16384:
                report=json.loads(result_path.read_text())
                if report.get('schema')=='YNX_NYM_PUBLIC_HTTPS_STAGE_RESULT_V1' and report.get('firstFailure'):
                    events=report.get('events',[])
                    last=events[-1] if events else {}
                    if last.get('event')=='first_failure' and last.get('phase') in ('socks_greeting','socks_domain_connect','tls_handshake','http_headers','http_body') and last.get('code') in ('SOCKS_EOF','SOCKS_AUTH_REJECTED','SOCKS_CONNECT_REJECTED','SOCKS_REPLY_ATYP','ABSOLUTE_REQUEST_DEADLINE','STAGE_TIMEOUT','TLS_CERTIFICATE_REJECTED','TLS_NEGOTIATION_FAILED','HTTP_PROTOCOL_ERROR','SOCKET_IO_FAILED','HTTP_HEADERS_LIMIT','HTTP_BODY_LENGTH_LIMIT','HTTP_BODY_LIMIT','HTTP_BODY_NOT_RFC','HTTP_BODY_TRUNCATED','HTTP_BODY_DOCUMENT_PIN_MISMATCH','HTTP_STATUS_NOT_200'):
                        verified=last.get('tlsHandshakeVerified') is True and last['phase'] in ('http_headers','http_body') and last.get('tlsSuccessProof')=='VERIFIED_HANDSHAKE_ONLY'
                        exp.event('RFC-stage-failure',dict(phase=last['phase'],code=last['code'],tlsHandshakeVerified=verified,
                                  tlsSuccessProof='VERIFIED_HANDSHAKE_ONLY' if verified else 'NO_TLS_SUCCESS_PROOF',RFCBodyVerified=False))
                        raise r2.Failed('RFC_STAGE:'+last['phase']+':'+last['code']) from None
            raise
        report=json.loads((probe_output/'result.json').read_text())
        if report['firstFailure'] or report['result']['httpStatus']!=200 or report['result']['tlsHandshakeVerified'] is not True:
            raise r2.Failed('RFC-stage-result-not-verified')
        exp.event('RFC-staged-HTTPS-verified',report['result'])
        budget=min(exp.end-time.monotonic(),exp.runtime_expiry-time.time())
        if budget<70:
            exp.event('DDG-NOT_RUN',dict(reason='preserve-original-scope-and-route-cleanup',remainingSeconds=max(0,int(budget))))
        else:
            exp.stage='DDG-public-once';path=exp.out/'ddg-public.body'
            command=['/usr/bin/curl','--disable','--local-port','63802','--proxy','socks5h://127.0.0.1:63781','--noproxy','','--proto','=https','--proto-redir','=https','--max-redirs','0','--retry','0','--connect-timeout','45','--max-time','60','--max-filesize','1048576','--output',str(path),'--write-out',glue.CURL_METRICS,'https://duckduckgo.com/?q=YNX%20browser%20privacy']
            metrics=None;site_failure=None
            try:metrics=json.loads(exp.run('DDG-public-once',command,seconds=65))
            except r2.Failed as error:
                site_failure=r2.redact(str(error))
                for request in exp.children:
                    if request.label=='DDG-public-once' and request.stopped is None:exp.stop_child(request)
            body=path.read_bytes() if path.exists() else b'';lower=body.lower();captcha=any(x in lower for x in (b'anomaly-modal',b'unfortunately, bots use duckduckgo too',b'/anomaly.js'))
            status=metrics.get('response_code') if metrics else None
            result=dict(siteStatus='CAPTCHA' if captcha else ('HTTP_RESTRICTED' if status and status!=200 else ('UNVERIFIED_CONTENT' if status==200 else 'REQUEST_FAILED')),http=status,captcha=captcha,requestFailure=site_failure,
                        bodyBytes=len(body),bodySHA256=hashlib.sha256(body).hexdigest(),tlsVerify=metrics.get('ssl_verify_result') if metrics else None,retryOrRotation=False,siteDoesNotGrantOrRevokeRouteSafety=True)
            r2.write_new(exp.out/'ddg-public-result.json',result);exp.event('DDG-site-diagnostic',result)
        exp.stage='stop-stages'
        if exp.stop_child(child)!=0 or child.forced:raise r2.Failed('stage-runtime-stop-not-graceful')
        if r2.profile_metadata(exp.profile)!=initial:raise r2.Failed('stage-runtime-storage-changed')
        exp.event('request-phases-scope-completed',dict(initCount=0,directoryCount=1,pairUnchanged=True,normalProductionAuthority=False))
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
        after = r2.network_fingerprint();metadata=None;metadata_failure=None
        try:metadata=r2.profile_metadata(exp.profile)
        except BaseException as error:
            metadata_failure=dict(type=type(error).__name__,fixedReason='profile-metadata-unavailable-or-unsafe')
            if exp.first is None:exp.first=dict(stage='metadata-readback',type=type(error).__name__,message='profile-metadata-unavailable-or-unsafe',**r2.stamp())
        receipt = dict(schema='P05_NYM_REGISTERED_CAPABILITY_REQUEST_PHASE_RESULT_V2', scopeSHA256=SCOPE_SHA, NoProductionAuthority=True, totalSeconds=360, directoryCount=1, firstFailure=exp.first,
                       originalResultSHA256=RESULT_SHA, originalResultUnchanged=glue.sha(ORIGINAL/'result.json')==RESULT_SHA,
                       originalChildren=[c.receipt() for c in exp.children], remainingOwned=[c.pid for c in exp.children if c.process.poll() is None],
                       runtimeObservationCounts=observer.counts,droppedRuntimeLines=observer.dropped,requesterFailure=getattr(exp,'requester_failure',None),
                       directoryBinarySHA256=scope['directoryBinarySHA256'],runtimeBinarySHA256=glue.RUNTIME_SHA,
                       peakOwnedAggregateRSSBytes=exp.peakRSS, metadata=metadata,metadataReadbackFailure=metadata_failure,
                       networkBefore=before, networkAfter=after, noInitOrRegistrationReplay=True,
                       privateKeyContentsReadOrHashed=False, normalPrivacyAdmission=False, NativeOrWK='NOT_RUN', finished=r2.stamp())
        r2.write_new(case/'result.json',receipt); exp.log.close()
        print(json.dumps(dict(terminal=True,result=str(case/'result.json'),firstFailure=exp.first,remainingOwned=receipt['remainingOwned'])),flush=True)
    return 1 if exp.first else 0


if __name__ == '__main__':
    raise SystemExit(main())
