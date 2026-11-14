"""One separately authorized fresh PUBLIC QA profile, never normal admission.

Old pair retirement is preserved. No old identity/config is read or copied.
Only official executor init creates/uses this new synthetic identity once.
"""
import argparse,datetime as dt,fcntl,hashlib,json,os,signal,socket,stat,threading,time,uuid
from pathlib import Path
import mac_cdn_fresh_executor as glue

SCOPE_FILE=glue.PR/'nym-epoch-diagnostic-20261108/FRESH_CURRENT_PROFILE_SCOPE.json'
SCOPE_SHA='8574e6411a3266a1e5dd8eefee825da45270a7383389c316ccd27d50687ad395'

def main():
    started=time.monotonic();p=argparse.ArgumentParser(description=__doc__);p.add_argument('--execute',action='store_true',required=True);p.parse_args();os.umask(0o077)
    if glue.sha(SCOPE_FILE)!=SCOPE_SHA:raise RuntimeError('fresh-scope-pin')
    scope=json.loads(SCOPE_FILE.read_text())
    if scope['NoProductionAuthority'] is not True or scope['wholeSeconds']!=360 or scope['cleanupReserveSeconds']!=45 or scope['directoryCount']!=1 or scope['initCountMaximum']!=1:raise RuntimeError('fresh-scope-contract')
    for name in ['mac_cdn_fresh_executor.py','qa_directory_capture.py','current_epoch_directory_bridge.py']:
        if glue.sha(Path(__file__).with_name(name))!=scope['sourcePins'][name]:raise RuntimeError('fresh-source-pin:'+name)
    bridge_path=Path(__file__).with_name('current_epoch_directory_bridge.py');bridge=glue.load('fresh_dual_executor',bridge_path,scope['sourcePins']['current_epoch_directory_bridge.py'])
    directory_binary,runtime_binary=bridge.pinned_binaries()
    network=glue.load('fresh_resource_facts',glue.O/'run_cdn_directory_nr_once.py','092f7077c07ac094b7c91d4da9e92a7c106382e59b1faef704eb4308b23e7643')
    facts=network.facts()
    if facts['memoryFreePercent']<35 or facts['homeFreeBytes']<2*glue.GIB+64*1024**2 or facts['WDFreeBytes']<16*glue.GIB:raise RuntimeError('fresh-resource-floor-no-child')
    r2=glue.load('fresh_original_r2',glue.R2/'r2_executor.py','330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67')
    guard=glue.load('fresh_original_owner',glue.O/'run_fullfeature_v4.py','b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05')
    class Resources:pass
    resources=Resources();resources.facts=network.facts
    base=glue.configure(r2,guard,resources,runtime_binary);Experiment=bridge.install(base,r2,directory_binary)
    remaining=int(360-(time.monotonic()-started))
    if remaining<=60:raise RuntimeError('fresh-preflight-exhausted')
    case=glue.R2/('case-fresh-current-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:6])
    exp=Experiment(argparse.Namespace(out=case,port=63781,budget_seconds=remaining));exp.end-=25
    # Base constructor creates a unique 0700 NYM_HOME_DIR, canonical bundled UUID,
    # and leaves the user's HOME unchanged. It does not read any older profile.
    glue.fresh_profile_id(exp.profileID)
    r2.write_new(SCOPE_FILE.with_name('FRESH_CURRENT_PROFILE_STARTED.json'),dict(case=str(case),scopeSHA256=SCOPE_SHA,NoProductionAuthority=True,**r2.stamp()))
    r2.write_new(case/'driver-binding.json',dict(driverSHA256=glue.sha(Path(__file__)),sourcePins=scope['sourcePins'],scopeSHA256=SCOPE_SHA,
                 directoryBinarySHA256=bridge.DIRECTORY_SHA,runtimeBinarySHA256=glue.RUNTIME_SHA,totalSeconds=360,cleanupReserveSeconds=45,
                 latestAllowedTerminalUTC=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=360-(time.monotonic()-started))).isoformat(),
                 noOldProfileReadOrCopy=True,normalPrivacyAdmission=False))
    initial=None;lock=None;monitor=None;before=r2.network_fingerprint()
    def signal_originals(message):
        if exp.resourceFailure is None:exp.resourceFailure=dict(stage=exp.stage,type='Failed',message=message,**r2.stamp())
        for child in list(exp.children):
            if child.process.poll() is None:
                try:child.process.send_signal(signal.SIGINT)
                except ProcessLookupError:pass
    def cancel(*_):
        exp.stopRequested=True;signal_originals('caller-cancelled-fresh-scope')
    signal.signal(signal.SIGINT,cancel);signal.signal(signal.SIGTERM,cancel)
    original_sample=exp.sample_resources
    def sample():
        original_sample()
        if initial is not None and r2.profile_metadata(exp.profile)!=initial:
            signal_originals('fresh-key-config-metadata-changed');raise r2.Failed('fresh-key-config-metadata-changed')
        if r2.network_fingerprint()['fingerprintSHA256']!=before['fingerprintSHA256']:
            signal_originals('security-network-fingerprint-changed');raise r2.Failed('security-network-fingerprint-changed')
    exp.sample_resources=sample
    try:
        with socket.socket() as reservation:reservation.bind(('127.0.0.1',exp.port))
        monitor=threading.Thread(target=exp.monitor,daemon=True);monitor.start()
        exp.event('fresh-public-scope-start',dict(pid=os.getpid(),pgid=os.getpgrp(),newProfile=True,NoProductionAuthority=True,
                       directoryBinarySHA256=bridge.DIRECTORY_SHA,runtimeBinarySHA256=glue.RUNTIME_SHA,workSeconds=max(0,int(exp.end-time.monotonic())),cleanupReserveSeconds=45))
        value,digests=exp.directory('directory-fresh');exp.selection=exp.select(value,digests)
        exp.stage='init-once';glue.fresh_profile_id(exp.profileID)
        exp.profile.mkdir(mode=0o700,parents=True,exist_ok=False)
        lock=os.open(exp.profile/'.ynx-run.lock',os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        # Durable UNKNOWN precedes the sole real official init child. Never replay.
        r2.write_new(case/'init-intent-UNKNOWN.json',dict(profileID=exp.profileID,operationID=str(uuid.uuid4()),state='UNKNOWN',replayForbidden=True,**r2.stamp()))
        selection=exp.selection
        command=exp.policy('init',selection)+['init','--id',exp.profileID,'--provider',selection['requester'],'--gateway',selection['entryIdentity'],
                    '--host','127.0.0.1','--port',str(exp.port),'--force-tls-gateway','--use-reply-surbs','true','--enabled-credentials-mode','false','--output','json']
        result=json.loads(exp.run('official-init',command,seconds=110))
        if result.get('id')!=exp.profileID or result.get('gateway_id')!=selection['entryIdentity'] or result.get('fallback_listener','missing') is not None:
            raise r2.Failed('fresh-official-init-result-binding')
        metadata=r2.profile_metadata(exp.profile)
        if not all(metadata[x]['exists'] for x in ['private_identity.pem','public_identity.pem','private_encryption.pem','public_encryption.pem','ack_key.pem','config']):raise r2.Failed('fresh-init-key-config-missing')
        r2.verify_config_scope(exp.profile,exp.profileID)
        address=result.get('client_address')
        if not isinstance(address,str) or not r2.RECIPIENT.fullmatch(address):raise r2.Failed('fresh-init-public-address-missing')
        exp.publicAddressSHA256=hashlib.sha256(address.encode()).hexdigest();initial=metadata
        r2.write_new(case/'init-complete.json',dict(version=result.get('version'),publicClientAddressSHA256=exp.publicAddressSHA256,metadata=initial,
                     actualChildExit=0,originalChildReaped=True,bothEOF=True,privateKeyContentsReadOrHashed=False,**r2.stamp()))
        exp.event('fresh-official-identity-complete',dict(version=result.get('version'),publicClientAddressSHA256=exp.publicAddressSHA256,
                       actualInitExit=0,newKeyFilesExist=True,privateKeyContentsReadOrHashed=False,publicFingerprintHashed=True))
        exp.stage='gateway-readback'
        rows=json.loads(exp.run('list-gateways',exp.policy('gateway',selection)+['list-gateways','--id',exp.profileID,'--output','json'],limit=1048576,seconds=30))
        active=[row for row in rows if row.get('active') is True];endpoint=selection['endpoints'][-1]
        if len(active)!=1 or active[0].get('fallback_endpoint','missing') is not None or bytes(active[0].get('identity',[]))!=r2.identity_bytes(selection['entryIdentity']) or str(active[0].get('endpoint','')).rstrip('/')!='wss://'+endpoint['host']+':'+str(endpoint['port']):raise r2.Failed('fresh-gateway-official-readback')
        exp.event('fresh-gateway-official-readback',dict(activeCount=1,registeredCount=len(rows),fallback=False))
        child=exp.bootstrap('run-1');exp.socks();exp.https('rfc-1')
        exp.stage='stop-1'
        if exp.stop_child(child)!=0 or child.forced:raise r2.Failed('fresh-stop-not-graceful')
        if r2.profile_metadata(exp.profile)!=initial:raise r2.Failed('fresh-stop-storage-changed')
        exp.event('fresh-stop-storage-preserved',dict(originalExit=0,metadataUnchanged=True))
        exp.check();budget=min(exp.end-time.monotonic(),selection['expiresAt']-time.time())
        if budget<95:
            exp.event('restart-NOT_RUN',dict(reason='preserve-RFC-and-cleanup-budget',remainingSeconds=max(0,int(budget)),newDirectoryOrPair=False))
        else:
            exp.event('same-snapshot-restart-bound',dict(epoch=selection['epoch'],directoryCount=1,sameProfileAndPair=True,selectionExpiresAt=selection['expiresAt']))
            child=exp.bootstrap('run-restart');exp.https('rfc-restart');exp.stage='stop-restart'
            if exp.stop_child(child)!=0 or child.forced:raise r2.Failed('fresh-restart-stop-not-graceful')
            if r2.profile_metadata(exp.profile)!=initial:raise r2.Failed('fresh-restart-storage-changed')
            exp.event('fresh-restart-completed',dict(initCount=1,restartCount=1,originalExit=0,metadataUnchanged=True))
    except BaseException as error:
        exp.first=exp.resourceFailure or dict(stage=exp.stage,type=type(error).__name__,message=r2.redact(str(error)),**r2.stamp());exp.event('first-failure',exp.first)
    finally:
        exp.stage='final-cleanup'
        for child in reversed(exp.children):
            if child.stopped is None:
                try:exp.stop_child(child)
                except BaseException as error:
                    if exp.first is None:exp.first=dict(stage='cleanup',type=type(error).__name__,message=r2.redact(str(error)),**r2.stamp())
        exp.monitorDone.set()
        if monitor is not None:monitor.join(timeout=3)
        if lock is not None:fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)
        after=r2.network_fingerprint();metadata=None;metadata_failure=None
        try:metadata=r2.profile_metadata(exp.profile) if exp.profile.exists() else None
        except BaseException as error:
            metadata_failure=dict(type=type(error).__name__,fixedReason='profile-metadata-unavailable-or-unsafe')
            if exp.first is None:exp.first=dict(stage='metadata-readback',type=type(error).__name__,message='profile-metadata-unavailable-or-unsafe',**r2.stamp())
        receipt=dict(schema='P05_NYM_FRESH_ACTIVE_PAIR_PUBLIC_RESULT_V1',scopeSHA256=SCOPE_SHA,NoProductionAuthority=True,firstFailure=exp.first,
                     directoryBinarySHA256=bridge.DIRECTORY_SHA,runtimeBinarySHA256=glue.RUNTIME_SHA,originalChildren=[c.receipt() for c in exp.children],
                     remainingOwned=[c.pid for c in exp.children if c.process.poll() is None],newProfileID=exp.profileID,metadata=metadata,metadataReadbackFailure=metadata_failure,
                     metadataMatchesCompletedInit=metadata==initial if initial is not None else None,completedInit=(case/'init-complete.json').exists(),
                     noOldProfileReadOrCopy=True,privateKeyContentsReadOrHashed=False,networkBefore=before,networkAfter=after,
                     metricsObservationFailures=getattr(exp,'metrics_observation_failures',[]),
                     peakOwnedAggregateRSSBytes=exp.peakRSS,elapsedSeconds=time.monotonic()-started,normalPrivacyAdmission=False,NativeOrWK='NOT_RUN',finished=r2.stamp())
        r2.write_new(case/'result.json',receipt);exp.log.close()
        print(json.dumps(dict(terminal=True,result=str(case/'result.json'),firstFailure=exp.first,remainingOwned=receipt['remainingOwned'])),flush=True)
    return 1 if exp.first else 0

if __name__=='__main__':raise SystemExit(main())
