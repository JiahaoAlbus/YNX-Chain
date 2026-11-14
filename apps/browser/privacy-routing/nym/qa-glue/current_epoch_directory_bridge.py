"""PUBLIC QA only: new directory DATA executor plus immutable original runtime.

This does not import normal qualification or install a directory into the SDK.
It preserves the original runtime/provisioning implementation and never calls init.
"""
import hashlib,json,math,os,re,time,uuid
from pathlib import Path
from qa_directory_capture import parse_directory_output,require_terminal_capture
import mac_cdn_fresh_executor as glue

DIRECTORY_BUILD=glue.PR/'nym-epoch-diagnostic-20261108/build-20261108T023605Z-13be20/receipt.json'
DIRECTORY_BUILD_SHA='0e5fa0e9652ef12313737de5db152201da9a0501be41d15941fe8598bb479e02'
DIRECTORY_SHA='099f16ec631a60ceefa7f5c81ab3f940903ce1346bcbc0d7cd154abb3d565358'

def fixed_curl_metrics(raw):
    """Actual five fields only. verify0/HTTP0 never constitute TLS success."""
    try:
        if not isinstance(raw,bytes) or len(raw)>65536:return None
        def unique(pairs):
            value={}
            for key,item in pairs:
                if key in value:raise ValueError('duplicate-metrics-key')
                value[key]=item
            return value
        value=json.loads(raw,object_pairs_hook=unique)
        if not isinstance(value,dict) or set(value)!={'response_code','ssl_verify_result','proxy_used','remote_ip','time_total'}:return None
        if type(value['response_code']) is not int or not (value['response_code']==0 or 100<=value['response_code']<=599):return None
        if type(value['ssl_verify_result']) is not int or not 0<=value['ssl_verify_result']<=2**63-1:return None
        if type(value['proxy_used']) is not int or value['proxy_used'] not in (0,1) or value['remote_ip'] not in ('','127.0.0.1'):return None
        if type(value['time_total']) not in (int,float) or not math.isfinite(value['time_total']) or not 0<=value['time_total']<=360:return None
        return value
    except (ValueError,UnicodeError,TypeError,KeyError,RecursionError):return None

def persist_metrics_observation(experiment,r2,label):
    """Never throws over the original process/request first cause."""
    try:
        children=[child for child in experiment.children if child.label==label]
        if len(children)!=1:raise ValueError('metrics-owned-child-count')
        child=children[0]
        with child.lock:
            metrics=fixed_curl_metrics(bytes(child.data))
            complete=child.process.returncode is not None and all(child.eof) and not child.read_errors and not child.overflow and child.cleanup_confirmed
            value=dict(originalPID=child.pid,originalExit=child.process.returncode,
                       originalChildReaped=child.process.returncode is not None,actualEOF=list(child.eof),actualFDClosed=list(child.closed),
                       completeOwnedCapture=complete,metrics=metrics,metricsShapeRejected=metrics is None,
                       tlsSuccessProof='NO_TLS_SUCCESS_PROOF',NoProductionAuthority=True)
        # Interpretation remains with HTTPS status/TLS/body validation; this
        # observation alone cannot label a request or route successful.
        r2.write_new(experiment.out/(label+'-metrics-observation.json'),value)
    except BaseException as error:
        if not hasattr(experiment,'metrics_observation_failures'):experiment.metrics_observation_failures=[]
        if len(experiment.metrics_observation_failures)<8:
            experiment.metrics_observation_failures.append(dict(label=label,type=type(error).__name__,fixedReason='metrics-observation-not-persisted'))

def public_epoch_summary(raw):
    """Optional log DATA: malformed input must never replace the callee first cause."""
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('duplicate-epoch-log-key')
            result[key]=value
        return result
    try:
        if not isinstance(raw,bytes) or len(raw)>4096:return None
        value=json.loads(raw,object_pairs_hook=unique)
        keys={'schema','NoProductionAuthority','diagnosticOnly','runID','reason','legacyError','sourceHash','metadataSourceHash','basicAbsoluteEpochID','totalElapsedEpochs','epochLengthSeconds','epochLengthNanos','currentEpochStartUTC','epochEndUTC','nowUTC','nowUnixMilliseconds','remainingMilliseconds','minimumRemainingSeconds','refreshedAtUTC','metadataAgeMilliseconds'}
        errors={
            'epoch_start_invalid':'qa-directory-epoch-start','epoch_length_missing_or_type':'qa-directory-epoch-length',
            'epoch_length_out_of_range':'qa-directory-stale-epoch','epoch_nanos_not_zero':'qa-directory-stale-epoch',
            'epoch_id_mismatch_or_missing':'qa-directory-stale-epoch','epoch_start_in_future':'qa-directory-stale-epoch',
            'epoch_end_out_of_range':'qa-directory-stale-epoch','epoch_remaining_not_above_300s':'qa-directory-stale-epoch',
            'metadata_refresh_in_future':'qa-directory-stale-metadata','metadata_refresh_older_than_epoch_length':'qa-directory-stale-metadata',
            'epoch_and_metadata_predicates_passed':None}
        if not isinstance(value,dict) or set(value)!=keys or value['reason'] not in errors or value['legacyError']!=errors[value['reason']]:return None
        if value['schema']!='YNX_NYM_QA_EPOCH_DIAGNOSTIC_V1' or value['NoProductionAuthority'] is not True or value['diagnosticOnly'] is not True or value['runID']!='not-a-permit':return None
        if value['sourceHash']!='3958eb64c35bbb69a8fbad0754554d1d4a2dcfd634f1c170b17eaab8e16d243c' or value['metadataSourceHash']!='6571bfabcefe7d274bc02e01a993d4656cd8d8c534f7693d748450b87cbafcce':return None
        if type(value['basicAbsoluteEpochID']) is not int or not 0<=value['basicAbsoluteEpochID']<=4294967295 or type(value['minimumRemainingSeconds']) is not int or value['minimumRemainingSeconds']!=300:return None
        for field,low,high in [('totalElapsedEpochs',0,2**64-1),('epochLengthSeconds',-2**63,2**63-1),('epochLengthNanos',0,2**64-1)]:
            if value[field] is not None and (type(value[field]) is not int or not low<=value[field]<=high):return None
        for field in ['currentEpochStartUTC','epochEndUTC','nowUTC','refreshedAtUTC']:
            if field in ['currentEpochStartUTC','epochEndUTC'] and value[field] is None:continue
            if not isinstance(value[field],str) or len(value[field])>64 or not re.fullmatch(r'[+-]?\d{4,6}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)',value[field]):return None
        for field in ['nowUnixMilliseconds','remainingMilliseconds','metadataAgeMilliseconds']:
            if field=='remainingMilliseconds' and value[field] is None:continue
            if not isinstance(value[field],str) or not re.fullmatch(r'-?\d{1,24}',value[field]):return None
        return {k:value[k] for k in ('reason','basicAbsoluteEpochID','totalElapsedEpochs','currentEpochStartUTC','epochEndUTC','nowUTC','remainingMilliseconds','refreshedAtUTC')}
    except (ValueError,UnicodeError,TypeError,KeyError,RecursionError):
        return None

def pinned_binaries():
    """Read-only original artifact provenance, not current writable Cargo output."""
    if glue.sha(DIRECTORY_BUILD)!=DIRECTORY_BUILD_SHA or glue.sha(glue.BUILD)!=glue.BUILD_SHA:
        raise ValueError('dual-executor-build-receipt-pin')
    directory=json.loads(DIRECTORY_BUILD.read_text());runtime=json.loads(glue.BUILD.read_text())
    for value in (directory,runtime):
        if value['firstFailure'] or value['cleanupFailure'] or value['childOutcomeRecordingFailure'] or value['remainingOwned'] or value['preservedInputsChanged'] or value['originalMetadataChanged']:
            raise ValueError('dual-executor-original-build-not-complete')
    if not directory['sourceStable'] or not runtime['sourceUnchanged']:
        raise ValueError('dual-executor-source-not-stable-at-build')
    if directory['sourceManifest']['SHA256']!='9a76e3b68884c8a6a03690fc8d1be898d631fc01af71ede8ec39a3d47c83f114' or runtime['sourceManifest']['SHA256']!='4f0eab68be0fa772fae47fa4cee3a9ed9ab5373cd38d30367df1f24431deab01':
        raise ValueError('dual-executor-source-manifest')
    for value in (directory,runtime):
        if glue.sha(value['sourceManifest']['path'])!=value['sourceManifest']['SHA256']:
            raise ValueError('immutable-source-manifest-pin')
    binaries=[]
    for value,receipt,pin in [(directory,DIRECTORY_BUILD,DIRECTORY_SHA),(runtime,glue.BUILD,glue.RUNTIME_SHA)]:
        artifact=value['newQAArtifact'];binary=Path(artifact['path'])
        if binary!=receipt.parent/'artifacts/qa-feature-on/nym-socks5-client' or binary.is_symlink() or artifact['SHA256']!=pin or glue.sha(binary)!=pin:
            raise ValueError('immutable-dual-executor-artifact-pin')
        binaries.append(binary)
    return tuple(binaries)

def install(base,r2,directory_binary):
    class CurrentEpochExperiment(base):
        def run(self,label,args,limit=65536,seconds=60,runtime=False,entry=None):
            try:return super().run(label,args,limit,seconds,runtime,entry)
            finally:
                if label in ('rfc-first','rfc-restart','DDG-public-once') and not runtime:
                    persist_metrics_observation(self,r2,label)

        def directory(self,label):
            self.stage=label;self.check()
            if getattr(self,'directory_count',0)!=0:raise r2.Failed('scope-permits-only-one-fresh-directory')
            actual,_=pinned_binaries()
            if actual!=directory_binary:raise r2.Failed('directory-executor-changed')
            self.directory_count=1
            issued=int(time.time());expires=min(issued+120,int(time.time()+self.end-time.monotonic()-3))
            if expires<=issued+1:raise r2.Failed('insufficient-fresh-directory-budget')
            run='qa-dir-'+uuid.uuid4().hex;plan=self.out/(label+'-cdn-plan.json')
            r2.write_new(plan,dict(schema='YNX_NYM_QA_CDN_DIRECTORY_V1',purpose='fresh-complete-directory-only',runID=run,issuedAt=issued,expiresAt=expires,networkDefaultsSHA256=r2.BOOTSTRAP_SOURCE,origin='https://cdn1.media-platform.net',addresses=['172.104.178.252']))
            deadline=time.monotonic()+max(0,expires-time.time())
            child=r2.Child(self,label,[str(directory_binary),'--no-banner','ynx-qa-cdn-directory','--plan',str(plan),'--plan-sha256',glue.sha(plan),'--run-id',run],16777217)
            try:
                while child.process.poll() is None:
                    self.check()
                    if time.monotonic()>=deadline+2:raise r2.Failed('directory-terminal-observation-deadline')
                    time.sleep(.05)
                code=self.stop_child(child)
            finally:
                with child.lock:
                    errors=glue.fixed_directory_errors(bytes(child.data),bytes(child.stderr))
                    observation=dict(runID=run,planSHA256=glue.sha(plan),binarySHA256=DIRECTORY_SHA,issuedAt=issued,expiresAt=expires,
                                     originalExit=child.process.returncode,originalChildReaped=child.process.returncode is not None,
                                     actualEOF=list(child.eof),actualFDClosed=list(child.closed),outputBytes=list(child.byteCounts),fixedErrorLabels=errors)
                    # A bounded, fixed-schema public epoch report is diagnostic DATA.
                    # Its full-directory log uses "not-a-permit", never a capability.
                    for line in bytes(child.stderr).split(b'\n'):
                        prefix=b'YNX_NYM_QA_EPOCH_DIAGNOSTIC_V1 '
                        if line.startswith(prefix) and len(line)<=4096:
                            report=public_epoch_summary(line[len(prefix):])
                            if report is None:
                                observation['epochDiagnosticMalformed']=True
                                continue
                            observation['epochReason']=report.pop('reason')
                            observation['publicEpochValues']=report
                r2.write_new(self.out/(label+'-capture-observation.json'),observation)
            if code!=0:
                self.event('directory-callee-failure',observation)
                raise r2.Failed(label+'-client-exit-'+str(code)+'-fixed-errors:'+','.join(errors))
            require_terminal_capture(code,child.eof[0],child.eof[1],child.overflow,bool(child.read_errors),expires,int(deadline*1e9),time.time(),time.monotonic_ns())
            parsed=parse_directory_output(bytes(child.data),bytes(child.stderr),run)
            if glue.sha(directory_binary)!=DIRECTORY_SHA:raise r2.Failed('directory-binary-changed-after-exec')
            self.parsed[id(parsed.value)]=parsed;self.capture_deadlines[id(parsed.value)]=(expires,int(deadline*1e9))
            parts={k:json.dumps(parsed.value[k],separators=(',',':'),ensure_ascii=False).encode() for k in ('basic','described','epoch')}
            for key,data in parts.items():
                with (self.out/(label+'-'+key+'.json')).open('xb') as out:os.fchmod(out.fileno(),0o600);out.write(data)
            self.event('same-owned-current-epoch-capture',dict(runID=run,planSHA256=glue.sha(plan),payloadSHA256=parsed.payload_sha256,directoryBinarySHA256=DIRECTORY_SHA,runtimeBinarySHA256=glue.RUNTIME_SHA,entryCandidates=len(parsed.entry_node_ids),exitCandidates=len(parsed.exit_node_ids),NoProductionAuthority=True))
            return parsed.value,[hashlib.sha256(parts[k]).hexdigest() for k in ('basic','described','epoch')]

        def https(self,label):
            if label!='rfc-1':return super().https(label)
            super().https('rfc-first')  # Fixed five metrics, no implicit search.
            budget=min(self.end-time.monotonic(),self.runtime_expiry-time.time())
            if budget<70:
                self.event('DDG-NOT_RUN',dict(reason='insufficient-absolute-route-or-scope-budget',remainingSeconds=max(0,int(budget)),noRequestSent=True))
                return
            self.stage='DDG-public-once';path=self.out/'ddg-public.body'
            command=['/usr/bin/curl','--disable','--proxy','socks5h://127.0.0.1:'+str(self.port),'--noproxy','','--proto','=https','--proto-redir','=https','--max-redirs','0','--retry','0','--connect-timeout','45','--max-time','60','--max-filesize','1048576','--output',str(path),'--write-out',glue.CURL_METRICS,'https://duckduckgo.com/?q=YNX%20browser%20privacy']
            metrics=None;failure=None
            try:metrics=json.loads(self.run('DDG-public-once',command,seconds=65))
            except r2.Failed as error:
                failure=r2.redact(str(error))
                for child in self.children:
                    if child.label=='DDG-public-once' and child.stopped is None:self.stop_child(child)
            body=path.read_bytes() if path.exists() else b'';lower=body.lower();captcha=any(x in lower for x in (b'anomaly-modal',b'unfortunately, bots use duckduckgo too',b'/anomaly.js'))
            status=metrics.get('response_code') if metrics else None
            result=dict(siteStatus='CAPTCHA' if captcha else ('HTTP_RESTRICTED' if status and status!=200 else ('UNVERIFIED_CONTENT' if status==200 else 'REQUEST_FAILED')),
                        http=status,captcha=captcha,requestFailure=failure,bodyBytes=len(body),bodySHA256=hashlib.sha256(body).hexdigest(),
                        tlsVerify=metrics.get('ssl_verify_result') if metrics else None,proxyUsed=metrics.get('proxy_used') if metrics else None,
                        remoteIsLoopback=metrics.get('remote_ip')=='127.0.0.1' if metrics else None,
                        retryOrRotation=False,siteResultDoesNotGrantOrRevokeRouteSafety=True)
            r2.write_new(self.out/'ddg-public-result.json',result);self.event('DDG-site-diagnostic',result)
    return CurrentEpochExperiment
