"""V2 capability DATA bridge for an already registered fixed PUBLIC QA pair.

This never installs a normal Root/NE capability, changes the SDK topology mode,
or provisions an identity. The signed/normal production gates are untouched.
"""
import hashlib,json,os,re,time,uuid
from pathlib import Path
from qa_capability_directory_capture import parse_directory_output,require_terminal_capture
import mac_cdn_fresh_executor as glue
import current_epoch_directory_bridge as original

SOURCE_MANIFEST_SHA='0704783948054fc2c8f6ba8f82a12ab06bda85910c642a9374c509670a1773cf'
D=glue.PR/'nym-persistent-capabilities-20261108'

def require_unmodified_sdk_role_defaults(text):
    # Current C47's canonical SDK-generated TOML omits both flags and topology
    # section. An explicit override is a distinct contract, never silently ignored.
    if not isinstance(text,str) or len(text)>1048576:raise ValueError('profile-config-bound')
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        if any(key in line for key in ('ignore_ingress_epoch_role','ignore_egress_epoch_role','use_extended_topology')):
            raise ValueError('explicit-topology-override-not-reviewed')

def pinned_binaries(supply_path,supply_sha):
    if Path(supply_path)!=D/'DIRECTORY_SUPPLY.json' or not re.fullmatch('[a-f0-9]{64}',supply_sha) or glue.sha(supply_path)!=supply_sha:
        raise ValueError('capability-supply-pin')
    v=json.loads(Path(supply_path).read_text())
    if not isinstance(v,dict) or set(v)!={'schema','buildReceipt','buildReceiptSHA256','directoryBinarySHA256','sourceManifestSHA256'} or v['schema']!='P05_NYM_QA_CAPABILITY_DIRECTORY_SUPPLY_V2' or v['sourceManifestSHA256']!=SOURCE_MANIFEST_SHA:
        raise ValueError('capability-supply-schema')
    receipt=Path(v['buildReceipt'])
    if receipt.parent.parent!=D or not receipt.parent.name.startswith('build-') or receipt.name!='receipt.json' or receipt.is_symlink() or glue.sha(receipt)!=v['buildReceiptSHA256']:
        raise ValueError('capability-build-receipt-pin')
    build=json.loads(receipt.read_text())
    if build['schema']!='P05_NYM_CAPABILITY_DIRECTORY_QA_BUILD_V1' or build['firstFailure'] or build['cleanupFailure'] or build['childOutcomeRecordingFailure'] or build['remainingOwned'] or not build['sourceStable'] or build['originalMetadataChanged'] or build['preservedInputsChanged']:
        raise ValueError('capability-build-not-confirmed')
    if build['sourceManifest']['SHA256']!=SOURCE_MANIFEST_SHA or glue.sha(build['sourceManifest']['path'])!=SOURCE_MANIFEST_SHA:
        raise ValueError('capability-source-manifest')
    artifact=build['newQAArtifact'];binary=Path(artifact['path'])
    if binary!=receipt.parent/'artifacts/qa-feature-on/nym-socks5-client' or binary.is_symlink() or artifact['SHA256']!=v['directoryBinarySHA256'] or glue.sha(binary)!=v['directoryBinarySHA256']:
        raise ValueError('capability-artifact-pin')
    # Reuse immutable runtime331 provenance; the old099 directory is NOT invoked.
    _,runtime=original.pinned_binaries()
    return binary,runtime

def install(base,r2,directory_binary,supply_path,supply_sha):
    Original=original.install(base,r2,directory_binary)
    directory_sha=glue.sha(directory_binary)
    class CapabilityRegisteredExperiment(Original):
        def select(self,value,digests,previous=None):
            if previous is None:raise r2.Failed('V2-capability-requires-original-registered-pair')
            require_unmodified_sdk_role_defaults((self.profile/'config/config.toml').read_text())
            return super().select(value,digests,previous)
        def directory(self,label):
            self.stage=label;self.check()
            if getattr(self,'directory_count',0)!=0:raise r2.Failed('scope-permits-only-one-fresh-directory')
            actual,_=pinned_binaries(supply_path,supply_sha)
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
                    observation=dict(runID=run,planSHA256=glue.sha(plan),binarySHA256=directory_sha,issuedAt=issued,expiresAt=expires,
                                     originalExit=child.process.returncode,originalChildReaped=child.process.returncode is not None,
                                     actualEOF=list(child.eof),actualFDClosed=list(child.closed),outputBytes=list(child.byteCounts),fixedErrorLabels=errors)
                    # A bounded, fixed-schema public epoch report is diagnostic DATA.
                    # Its full-directory log uses "not-a-permit", never a capability.
                    for line in bytes(child.stderr).split(b'\n'):
                        prefix=b'YNX_NYM_QA_EPOCH_DIAGNOSTIC_V1 '
                        if line.startswith(prefix) and len(line)<=4096:
                            report=original.public_epoch_summary(line[len(prefix):])
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
            if glue.sha(directory_binary)!=directory_sha:raise r2.Failed('directory-binary-changed-after-exec')
            self.parsed[id(parsed.value)]=parsed;self.capture_deadlines[id(parsed.value)]=(expires,int(deadline*1e9))
            parts={k:json.dumps(parsed.value[k],separators=(',',':'),ensure_ascii=False).encode() for k in ('basic','described','epoch')}
            for key,data in parts.items():
                with (self.out/(label+'-'+key+'.json')).open('xb') as out:os.fchmod(out.fileno(),0o600);out.write(data)
            self.event('same-owned-current-epoch-capture',dict(runID=run,planSHA256=glue.sha(plan),payloadSHA256=parsed.payload_sha256,directoryBinarySHA256=directory_sha,runtimeBinarySHA256=glue.RUNTIME_SHA,entryCandidates=len(parsed.entry_node_ids),exitCandidates=len(parsed.exit_node_ids),NoProductionAuthority=True))
            return parsed.value,[hashlib.sha256(parts[k]).hexdigest() for k in ('basic','described','epoch')]

    return CapabilityRegisteredExperiment
