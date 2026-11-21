"""Closed normal recover/confirm ABI joins; no authority or signing interface.

The inspected Core candidate has no qualified durable binary/fixture yet. Its
normal process gate remains None. The pure command/reply controls below bind
original bytes, not HMACs, cryptographic proof validity or current eligibility.
"""
import importlib.util
import json
import os
from pathlib import Path
import platform
import stat
from contextlib import contextmanager

spec=importlib.util.spec_from_file_location('normal_original_pair',Path(__file__).with_name('pq-enrollment-original-pair.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
c=p.c;b=p.b;require=b.require
INSPECTED_CLI='2b5eaa56f82c1e06f4ff959048ec8344f5effff3'
NORMAL_ORIGINAL_CALLEE=None
SCHEMA='YNX-PERF-ENROLLMENT-ORIGINAL-COMMAND/v1'
ROLES=('funding','migration')
PROOF_FILES={'CONFIRMED.json':2<<20,'confirmation-proof/request.json':8<<20,
             'confirmation-proof/trust-context.json':1<<20,'confirmation-proof/PUBLIC-PROOF-INPUTS.json':2<<20}
# A deliberately smaller readback profile, not all valid Core inputs: Core's
# single proof decoder permits 80MiB. Larger originals stay unresolved until
# the owning bounded reader/resource contract supports them; never truncate.


def canonical(value):
    text=json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    for char,escaped in (('<','\\u003c'),('>','\\u003e'),('&','\\u0026'),('\u2028','\\u2028'),('\u2029','\\u2029')):
        text=text.replace(char,escaped)
    return text.encode()


def unknown():
    return dict(schema=SCHEMA,status='UNKNOWN',normalCalleeInvoked=False,normalReplyObserved=False,
        inspectedCLI=INSPECTED_CLI,sourceCIQualified=False,completeCoreInputRangeSupported=False,
        originalPairReservationObserved=False,originalReplyByteBindingsObserved=False,
        recordMACAuthenticated=False,independentProofVerified=False,operationIdentity='UNKNOWN',
        currentEligibility='UNKNOWN',nativeGrant=False,nonceReleased=False,resigningAllowed=False,
        automaticRetry=False,missingEvidence=[])


def request(raw,pin):
    require(b.hex_pin(pin) and b.sha(raw)==pin,'independent original request SHA required')
    return p.request(raw)


def public_path(root,value):
    root_text=str(root);root=Path(root);path=Path(value)
    require(root.is_absolute() and path.is_absolute() and str(root)==root_text
            and str(path)==value and '..' not in root.parts and '..' not in path.parts
            and path.is_relative_to(root) and path!=root,'exact original lab-relative absolute path required')
    require(not set(path.relative_to(root).parts)&{'private-senders','custody'},'private source cannot be proof input')
    return value


def command(operation,request_raw,request_sha256,*,root,proof_inputs=None):
    """Produce exactly one existing canonical Core command, never sign/retry."""
    r=request(request_raw,request_sha256)
    require(operation in ('recover','confirm'),'only original recover/confirm supported')
    value=dict(version='YNX-PQ-LAB-ENROLLMENT-COMMAND/v1',operation=operation,request=r,requestSHA256=request_sha256)
    if operation=='recover':require(proof_inputs is None,'recover accepts only original request')
    else:b.closed(proof_inputs,ROLES,'both independently pinned proof inputs required')
    for role in ROLES:
        material=pin=proof=''
        if operation=='confirm':
            item=proof_inputs[role]
            b.closed(item,('materialsFile','materialsSHA256','proofFile','proofSHA256'),'closed original proof input pins required')
            material=public_path(root,item['materialsFile']);proof=public_path(root,item['proofFile']);pin=item['materialsSHA256']
            require(b.hex_pin(pin) and b.hex_pin(item['proofSHA256']),'independent original proof/material SHA required')
        value.update({role+'MaterialsFile':material,role+'MaterialsSHA256':pin,role+'ProofFile':proof})
    raw=canonical(value)
    require(len(raw)<32<<10,'original CLI scanner command limit exceeded')
    return raw+b'\n'


def file_matches(descriptor,name,raw):
    b.closed(descriptor,('path','sha256','bytes'),'closed normal original file descriptor required')
    require(descriptor==dict(path=name,sha256=b.sha(raw),bytes=str(len(raw))),'normal original file bytes differ')


def inspect_reply(raw,returncode,*,operation,request_raw,request_sha256,result_original_raw,
                  context_raw=None,proof_raws=None,proof_sha256=None,retained=None,parent_directory=None,enabled=False):
    """Inspect one original frame against separately retained bytes only.

    A syntactically valid success frame is not proof that the normal callee ran.
    No output of this function can release the original durable reservation.
    """
    require(enabled is True,'normal original reply inspection is explicitly opt-in')
    r=request(request_raw,request_sha256);out=unknown()
    require(operation in ('recover','confirm') and type(returncode) is int,'original operation and real exit required')
    v=b.accounting.strict(raw,1<<20)
    base={'version','code','result','syntheticOnly','authorityGranted','currentEligibility','requestSHA256'}
    require(type(v) is dict and v.get('version')=='YNX-PQ-LAB-ENROLLMENT-REPLY/v1'
            and v.get('syntheticOnly') is True and v.get('authorityGranted') is False
            and v.get('currentEligibility')=='UNKNOWN','normal original reply authority/schema differs')
    out.update(normalReplyObserved=True,normalReplySHA256=b.sha(raw),normalReplyCode=v.get('code'))
    if v.get('code')=='UNKNOWN':
        require(set(v) in (base|{'failureStage'},base|{'failureStage','proofFailureCode'})
                and v['result'] is None and returncode==0,'normal failure reply/exit differs')
        require(v['failureStage'] in (('request-identity','original-recovery') if operation=='recover'
                else ('request-identity','funding-proof-input','migration-proof-input','confirmation')),
                'normal failure stage differs')
        require(v['requestSHA256']==('' if v['failureStage']=='request-identity' else request_sha256),
                'normal failure original request differs')
        if 'proofFailureCode' in v:
            require(operation=='confirm' and v['failureStage']=='confirmation' and v['proofFailureCode'] in c.PROOF_STAGES,
                    'normal proof failure classification differs')
        out['failureStage']=v['failureStage'];out['proofFailureCode']=v.get('proofFailureCode')
        return out
    require(set(v)==base|{'fundingOperationId','migrationOperationId'} and returncode==0
            and v['requestSHA256']==request_sha256 and all(v[role+'OperationId']==r[role+'OperationId'] for role in ROLES),
            'normal success requires original request and both operation IDs')
    require(v['code']==('ORIGINAL_RECOVERED' if operation=='recover' else 'PROOF_CONFIRMED_DATA'),
            'normal reply operation/code differs')
    if result_original_raw is None:
        out['missingEvidence']=['originalRecordBytes'];return out
    _,original=p.record(result_original_raw)
    b.closed(original,('version','status','syntheticOnly','authorityGranted','currentEligibility','request','checkpointHeight',
                      'checkpointAppHash','fundingWire','fundingEnvelope','migrationWire','migrationEnvelope'),
             'complete retained original result required')
    require(original['version']=='YNX-PQ-LAB-ENROLLMENT-RESULT/v1' and p.same(original['request'],r)
            and original['status']=='signed-originals' and original['syntheticOnly'] is True
            and original['authorityGranted'] is False and original['currentEligibility']=='UNKNOWN',
            'original result request differs')
    if operation=='recover':
        require(p.same(v['result'],original),'normal recovered result differs from retained original')
        out['originalReplyByteBindingsObserved']=True
        out['missingEvidence']=['authenticatedNormalCallee','authenticatedCurrentAccountState'];return out
    missing=[name for name,value in (('originalContext',context_raw),('bothOriginalProofs',proof_raws),
                                    ('independentProofPins',proof_sha256),('bothRetainedConfirmations',retained),
                                    ('originalOperationParent',parent_directory)) if value is None]
    if missing:out['missingEvidence']=missing;return out
    for value in (proof_raws,proof_sha256,retained):b.closed(value,ROLES,'both original proof roles required')
    context=b.accounting.strict(context_raw,2*b.EXPECTED_LIMIT+(64<<10));result=v['result']
    for role in ROLES:
        expected=b.decode_cli_expected(canonical(context[role+'Expected']))
        for suffix,name,field in (('Wire','transaction.wire','NativeWire'),('Envelope','transaction.abci','Envelope')):
            file_matches(original[role+suffix],name,b.b64(expected[field],8<<20))
    b.closed(result,('funding','migration','historical','fundingConfirmed','migrationConfirmed','currentEligibility','authorityGranted'),
             'complete normal dual confirmation required')
    require(result['currentEligibility']=='UNKNOWN' and result['authorityGranted'] is False,'confirmation cannot grant current eligibility')
    historical=dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-RESULT/v1',code='VERIFIED_HISTORICAL_DATA',
        operationIdentity='UNKNOWN',currentEligibility='UNKNOWN',nativeGrant=False,result=result['historical'])
    c.classify_result(canonical(historical),0,context) # Existing shape/binding validator, never a Python proof verifier.
    for role in ROLES:
        proof_raw=proof_raws[role]
        require(type(proof_raw) is bytes and 0<len(proof_raw)<=8<<20 and b.hex_pin(proof_sha256[role])
                and b.sha(proof_raw)==proof_sha256[role],'independent original proof bytes differ')
        b.closed(retained[role],PROOF_FILES,'complete retained original confirmation files required')
        for name,limit in PROOF_FILES.items():
            require(type(retained[role][name]) is bytes and 0<len(retained[role][name])<=limit,'bounded original confirmation file required')
        export=result[role]
        b.closed(export,('version','syntheticOnly','authorityGranted','actualNetworkExecutionClaim','context','request','result','verifierArguments'),
                 'closed normal proof export required')
        require(export['version']=='YNX-PQ-LOOPBACK-PROOF-EXPORT/v1' and export['syntheticOnly'] is True
                and export['authorityGranted'] is False and export['actualNetworkExecutionClaim'] is False
                and p.same(export['result'],result['historical'][role]),'normal per-role proof outcome differs')
        files=retained[role];ctx=files['confirmation-proof/trust-context.json'];req=files['confirmation-proof/request.json']
        file_matches(export['context'],'trust-context.json',ctx);file_matches(export['request'],'request.json',req)
        envelope=b.accounting.strict(req,8<<20)
        b.closed(envelope,('version','expected','proof'),'full reconstructed normal verifier request required')
        require(envelope['version']=='YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1'
                and p.same(envelope['expected'],context[role+'Expected'])
                and p.same(envelope['proof'],b.accounting.strict(proof_raw,8<<20)),
                'full normal verifier request differs from original Expected/proof')
        decoded_context=b.accounting.strict(ctx,1<<20)
        b.closed(decoded_context,('version','lightTrust','expectedTransaction'),'complete normal transaction trust context required')
        require(decoded_context['version']=='YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1'
                and p.same(decoded_context['expectedTransaction'],context[role+'Expected']),
                'normal transaction context Expected differs')
        directory=Path(parent_directory)/r[role+'OperationId']/'confirmation-proof'
        require(export['verifierArguments']==['--trust-context',str(directory/'trust-context.json'),
                '--trust-context-sha256',b.sha(ctx)],'normal original verifier arguments differ')
        trust=decoded_context['lightTrust'];paths={'migrationFile':'migration.json','genesisFile':'genesis.json',
            'stateFile':'committed-state.json','scheduleFile':'schedule.json','trustedLightBlockFile':'trusted-light-block.json'}
        point=context[role+'Expected']['block']
        point_fields={'expectedHeaderHeight':'headerHeight','expectedBlockHash':'blockHash',
                      'expectedStateHeight':'stateHeight','expectedStateAppHash':'stateAppHash'}
        fixed=('version','chainId','scheduleHash','consensusGenesisSHA256','originalGenesisHash','migrationStateHash',
            'runtimePlanFile','runtimePlanHash','engineHeight','engineAppHash','trustedLightBlockSHA256',
            'trustingPeriodNanoseconds','maxClockDriftNanoseconds','trustLevelNumerator','trustLevelDenominator')
        b.closed(trust,set(fixed)|set(paths)|set(point_fields),'complete original normal light trust fields required')
        require(all(key in context['lightTrust'] and trust[key]==context['lightTrust'][key] for key in fixed)
                and all(trust[key]==str(directory/name) for key,name in paths.items())
                and all(trust[key]==point[name] for key,name in point_fields.items()),
                'normal confirmation trust differs from independent original context')
        public=b.accounting.strict(files['confirmation-proof/PUBLIC-PROOF-INPUTS.json'],2<<20)
        require(p.same(public,export),'retained normal public proof export differs')
        _,confirmed=p.record(files['CONFIRMED.json'])
        require(p.same(confirmed,dict(export,version='YNX-PQ-LAB-ENROLLMENT-CONFIRMED/v1')),
                'retained original CONFIRMED body differs')
        file_matches(result[role+'Confirmed'],'CONFIRMED.json',files['CONFIRMED.json'])
    out['originalReplyByteBindingsObserved']=True
    out['missingEvidence']=['authenticatedNormalCallee','authenticatedIndependentTrust','authenticatedCurrentAccountState']
    return out


def audit_reply(raw,returncode,*,operation,durable,original,proof_raws=None,proof_sha256=None,enabled=False):
    """Join a preserved reply with the SAME stopped DB and both original outboxes.

    Only fixed filenames are read. This does not read credential bytes, take the
    sender lease, run a callee, write confirmations or mutate the original DB.
    """
    require(enabled is True,'original reply audit is explicitly opt-in')
    require(type(durable) is dict and type(original) is dict and not set(durable)&set(original),
            'distinct original durable and pair inputs required')
    original=dict(original)
    require(original.pop('enabled',True) is True,'original pair inspection cannot be disabled')
    observed=p.audit_durable_pair(**durable,**original,enabled=True);out=unknown()
    out.update(originalLedgerReadOnly=observed['originalLedgerReadOnly'],
               originalPairReservationObserved=observed['originalPairReservationObserved'],
               originalFirstCauseSHA256=observed.get('originalFirstCauseSHA256'))
    if not observed['originalPairByteBindingsObserved'] or not observed['originalPairReservationObserved']:
        out['missingEvidence']=observed['missingEvidence'];return out
    r=request(original['request_raw'],original['binding']['requestSHA256']);parent=Path(original['parent_directory'])
    result_path=parent/r['fundingOperationId']/'RESULT.json'
    try:
        result_raw=c.read(result_path,p.FILES['RESULT.json'])
        pin=original['binding']['files']['funding']['RESULT.json']
        require(len(result_raw)==pin['bytes'] and b.sha(result_raw)==pin['sha256'],'original result changed after pair audit')
        initial=inspect_reply(raw,returncode,operation=operation,request_raw=original['request_raw'],
            request_sha256=original['binding']['requestSHA256'],result_original_raw=result_raw,enabled=True)
        if initial.get('normalReplyCode')=='UNKNOWN':
            initial.update(originalLedgerReadOnly=True,originalPairReservationObserved=True,
                           originalFirstCauseSHA256=out['originalFirstCauseSHA256'])
            return initial # A failure must not be hidden by absent/partial CONFIRMED output.
        retained=None
        if operation=='confirm':
            retained={role:{name:c.read(parent/r[role+'OperationId']/name,limit) for name,limit in PROOF_FILES.items()} for role in ROLES}
    except FileNotFoundError:
        out['missingEvidence']=['retainedOriginalReplyInputs'];return out
    classified=inspect_reply(raw,returncode,operation=operation,request_raw=original['request_raw'],
        request_sha256=original['binding']['requestSHA256'],result_original_raw=result_raw,
        context_raw=original['context_raw'],proof_raws=proof_raws,proof_sha256=proof_sha256,
        retained=retained,parent_directory=parent,enabled=True)
    classified.update(originalLedgerReadOnly=True,originalPairReservationObserved=True,
                      originalFirstCauseSHA256=out['originalFirstCauseSHA256'])
    return classified


@contextmanager
def inherited_credential(fd,root):
    """Hold a duplicate of the original credential FD without reading its bytes.

    Core alone reads/decrypts and acquires its existing sender lease. This
    caller must never take that lease first, reconstruct keys or open a new
    credential by name as a fallback. The caller retains ownership of its FD.
    """
    require(type(fd) is int and 3<=fd<=4096,'original inherited credential FD required')
    path=Path(root)/'workload/private-senders/recovery.raw'
    directory=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);held=None
    try:
        for part in path.parts[1:-1]:
            following=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
            os.close(directory);directory=following
        held=os.dup(fd);os.set_inheritable(held,False);before=os.fstat(held)
        require(3<=held<=4096 and stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600
                and before.st_nlink==1 and before.st_uid==os.geteuid() and before.st_size==32,
                'exact private original credential identity required')
        def check():
            named=os.stat(path.name,dir_fd=directory,follow_symlinks=False)
            require(b.metadata(before)==b.metadata(os.fstat(held))==b.metadata(named)==b.metadata(path.lstat()),
                    'original credential identity changed')
        parent_identity=os.fstat(directory)
        check();yield held;check()
        current=path.parent.lstat()
        require(stat.S_ISDIR(current.st_mode) and (current.st_dev,current.st_ino)==(parent_identity.st_dev,parent_identity.st_ino),
                'original credential directory identity changed')
    finally:
        if held is not None:os.close(held)
        os.close(directory)


def _retain_readback(output,value):
    raw=c.encoded(value);path=Path(output)
    folder=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);identity=os.fstat(folder);fd=None
    try:
        fd=os.open('readback.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=folder)
        pending=memoryview(raw)
        while pending:
            n=os.write(fd,pending);require(n>0,'original reply readback short write');pending=pending[n:]
        os.fsync(fd);os.fsync(folder)
        info=os.fstat(fd);named=os.stat('readback.json',dir_fd=folder,follow_symlinks=False);current=path.lstat()
        require(b.metadata(info)==b.metadata(named) and info.st_nlink==1 and info.st_size==len(raw)
                and stat.S_IMODE(info.st_mode)==0o600 and (identity.st_dev,identity.st_ino)==(current.st_dev,current.st_ino),
                'original reply readback identity changed')
    finally:
        if fd is not None:os.close(fd)
        os.close(folder)


def normal_original(*,enabled=False,source=None,binary=None,root=None,plan_sha256=None,workload_sha256=None,
                    credential_fd=None,operation=None,durable=None,original=None,proof_inputs=None,
                    output=None,timeout=10,stop=None):
    """One normal recover/confirm process; no signing, retry or pending release.

    Only a future owning source change may freeze NORMAL_ORIGINAL_CALLEE after
    complete same-source CI and binary/fixture qualification. Caller options or
    an old source pass cannot fill that gate. Raw child output remains private.
    Confirm can write original Core proof/CONFIRMED files; no rollback/replay is
    attempted on failure. The stopped Perf DB always remains read-only.
    """
    require(enabled is True,'normal original callee is explicitly opt-in')
    out=unknown();gate=NORMAL_ORIGINAL_CALLEE
    if gate is None:
        out['missingEvidence']=['fixedIntegratedSourceAndFullCI','sameSourceBinaryAndOriginalMaterials',
            'normalCredentialFDAndLease','normalTargetCustodyProducer','authenticatedCurrentAccountState'];return out
    b.closed(gate,('source','chainCI','resourceCI','binaries'),'closed owner-frozen normal callee qualification required')
    require(source==gate['source']==INSPECTED_CLI and p.contract.inspected_source(source)
            and all(type(gate[key]) is int and gate[key]>0 for key in ('chainCI','resourceCI')),
            'exact original source and complete owner-frozen CI required')
    require(type(gate['binaries']) is dict,'frozen normal platform binary pins required')
    binary_pin=gate['binaries'].get((platform.system(),platform.machine()))
    require(b.hex_pin(binary_pin),'same-source normal platform binary unavailable')
    if stop is not None and stop.is_set():
        out['missingEvidence']=['originalCallCancelledBeforeStart'];return out
    require(type(durable) is dict and type(original) is dict and not set(durable)&set(original),'independent original ledger/outbox inputs required')
    original=dict(original);require(original.pop('enabled',True) is True,'original outbox inspection required')
    require(original['binding']['sourceCommit']==source,'original producer and normal callee source differ')
    observed=p.audit_durable_pair(**durable,**original,enabled=True)
    out['originalFirstCauseSHA256']=observed.get('originalFirstCauseSHA256')
    if not observed['originalPairByteBindingsObserved'] or not observed['originalPairReservationObserved']:
        out['missingEvidence']=observed['missingEvidence'];return out
    out.update(originalPairReservationObserved=True,originalLedgerReadOnly=True)
    request_raw=original['request_raw'];request_pin=original['binding']['requestSHA256'];r=request(request_raw,request_pin)
    root_text=str(root);root=Path(root)
    require(root.is_absolute() and '..' not in root.parts and str(root)==root_text
            and Path(original['parent_directory'])==root/'workload/sender-public'/('%04d'%r['ownerIndex']),
            'same original lab root and sponsor directory required')
    require(plan_sha256==durable_plan_pin(durable) and workload_sha256==original['binding']['workloadSHA256']
            and b.hex_pin(plan_sha256),'same original plan/workload pins required')
    # Plan/workload are checked again by Core. Retain independent input digests
    # before the process, then re-read them and the stopped DB/outboxes after it.
    plan_path=root/'network-plan.json';workload_path=root/'workload/PUBLIC-WORKLOAD.json'
    pins={plan_path:(1<<20,plan_sha256),workload_path:(8<<20,workload_sha256)};proofs=None;proof_pins=None
    command_raw=command(operation,request_raw,request_pin,root=root,proof_inputs=proof_inputs)
    if operation=='confirm':
        proofs={};proof_pins={}
        for role,item in proof_inputs.items():
            pins[Path(item['materialsFile'])]=(8<<20,item['materialsSHA256'])
            pins[Path(item['proofFile'])]=(8<<20,item['proofSHA256'])
            proofs[role]=c.read(item['proofFile'],8<<20);proof_pins[role]=item['proofSHA256']
            require(b.sha(proofs[role])==proof_pins[role],'independent original proof pin differs')
    for path,(limit,pin) in pins.items():require(b.sha(c.read(path,limit))==pin,'original normal callee input pin differs')
    call=None
    try:
        with c.held(binary,64<<20,executable=True) as (binary_raw,binary_fd):
            require(b.sha(binary_raw)==binary_pin,'exact source-qualified normal binary differs')
            with inherited_credential(credential_fd,root) as inherited:
                argv=[str(binary),'enrollment-original','--synthetic','--root',str(root),'--plan-sha256',plan_sha256,
                    '--workload-sha256',workload_sha256,'--owner',str(r['ownerIndex']),'--credential-fd',str(inherited)]
                call=c._invoke(Path(binary),binary_fd,None,None,command_raw,output,timeout,stop,
                               original_argv=argv,inherited_fds=(inherited,))
    except Exception as error:
        if call is None:
            out['firstCause']=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error));return out
        if call['firstCause'] is None:call['firstCause']=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
    out.update(normalCalleeInvoked=call['processStarted'],sourceCIQualified=True,normalSource=source,
        binarySHA256=binary_pin,requestSHA256=request_pin,commandSHA256=b.sha(command_raw),
        stdoutSHA256=b.sha(call['stdout']),stderrSHA256=b.sha(call['stderr']),
        process={key:value for key,value in call.items() if key not in ('stdout','stderr','argv')},
        originalPairReservationObserved=True,originalLedgerReadOnly=True,
        credentialBytesReadByParent=False,credentialFDPassed=call['processStarted'],
        senderLeaseOwner='normal Core callee only; not independently attested by transport',
        confirmationMayHaveWrittenOriginals=operation=='confirm' and call['processStarted'])
    cause=out['process']['firstCause']
    try:
        for path,(limit,pin) in pins.items():require(b.sha(c.read(path,limit))==pin,'original inputs changed during normal call')
        repeated=p.audit_durable_pair(**durable,**original,enabled=True)
        require(repeated['originalPairByteBindingsObserved'] and repeated['originalPairReservationObserved'],
                'original stopped ledger/outbox changed during normal call')
        require(call['returnCode']==0,'normal enrollment process exited unsuccessfully')
        require(not call['stderr'],'normal enrollment process emitted stderr; preserve original')
        require(call['processReaped'] and call['outputComplete'] and call['requestBytesWritten']==len(command_raw),
                'normal enrollment process did not complete the original frame')
        if cause is None:
            joined=audit_reply(call['stdout'],call['returnCode'],operation=operation,durable=durable,original=original,
                               proof_raws=proofs,proof_sha256=proof_pins,enabled=True)
            out.update({key:value for key,value in joined.items() if key not in ('normalCalleeInvoked','sourceCIQualified')})
            if joined.get('normalReplyCode')=='UNKNOWN':
                cause=dict(type='OriginalOperationUnknown',message=joined['failureStage'],proofFailureCode=joined.get('proofFailureCode'))
    except Exception as error:
        if cause is None:cause=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
    out['process']['firstCause']=cause;out['firstCause']=cause
    out['missingEvidence']=list(dict.fromkeys(out['missingEvidence']+['authenticatedCurrentAccountState','normalTargetCustodyProducer']))
    try:_retain_readback(output,out)
    except Exception as error:
        out['readbackRetention']='NOT_RETAINED';out['readbackRetentionFailure']=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
        if out['firstCause'] is None:out['firstCause']=out['readbackRetentionFailure']
    return out


def durable_plan_pin(durable):
    plan=b.accounting.strict(durable['plan_raw'],b.accounting.d.MAX_PLAN_BYTES)
    return plan['plan']['networkPlanSHA256']
