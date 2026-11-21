"""Pinned normal enrollment CLI transport, default closed and read-only.

The public synthetic control executes Core's original verifier. Its result is
historical DATA; it never authenticates a pending operation or current account.
Production remains blocked by the original gate in the binding module.
"""
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import selectors
import signal
import stat
import subprocess
import time

spec=importlib.util.spec_from_file_location('enrollment_bindings',Path(__file__).with_name('pq-enrollment-original-bindings.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
require=b.require
CORE='dfadf421e817bf7898c50aea2340a71672561890'
CHAIN_CI=44891667706
# These exact public synthetic artifacts were produced by the original Core
# owner. Chain source CI is complete; this is NOT Resource/runtime admission.
PUBLIC_FIXTURES=frozenset(('d30feb7e34e2ee3d6b220bf7902fee677a75d81857d77879629d97d71b859ea3',
                           '8eea4948a812ab7bf794f430e209d958716145da44af4faaf12b1bb59dc46de0'))
PUBLIC_BINARIES={('Darwin','arm64'):'56140ae0e0d8fc8ee78f08e6930409adf0a0a0b09b508969596f102a9aede6b6',
                 ('Linux','x86_64'):'875c8f5206404bce2a7bc69b7bd290dc15f00db0570f81ba3897d8bec88f5eae'}
RESULT_LIMIT=1<<20
INPUT_LIMIT=8<<20
FAILURE_CODES=frozenset(('INVALID_ARGUMENTS','TRUST_CONTEXT_INVALID','ORIGINAL_INPUT_INVALID',
                         'INVALID_REQUEST','TRUST_SOURCE_INVALID','PROOF_REJECTED'))
PROOF_STAGES=frozenset(('invalid_proof','invalid_trust','expired_trust','anchor_mismatch','authority_rejected',
                        'commit_invalid','light_transition_invalid','transaction_proof_invalid','header_link_invalid','execution_proof_invalid'))


def encoded(value):return b.accounting.d.encoded(value,2*b.EXPECTED_LIMIT+(64<<10)).encode('utf-8')
def unknown():
    return dict(schema='YNX-PERF-NORMAL-ENROLLMENT-CALLEE/v1',status='UNKNOWN',normalVerifierInvoked=False,
        historicalProofStatus='UNKNOWN',historicalCryptographicVerificationObserved=False,operationIdentity='UNKNOWN',
        currentEligibility='UNKNOWN',nativeGrant=False,nonceReleased=False,resigningAllowed=False,automaticRetry=False,
        accountAdmissionAllowed=False,sourceDeploymentQualified=False,privateDataExported=False,missingEvidence=[])
def number(value,limit=1<<63,*,positive=False,signed=False):
    require(type(value) is str and len(value)<=20 and re.fullmatch(r'-?[1-9][0-9]*|0' if signed else r'[1-9][0-9]*|0',value),
            'canonical original CLI integer required')
    result=int(value);require((-limit if signed else 1 if positive else 0)<=result<limit,'bounded original CLI integer required')
    return result


@contextmanager
def held(path,limit,*,executable=False):
    """Hold the original regular file, refusing links in every path component."""
    path=Path(path)
    require(path.is_absolute() and '..' not in path.parts,'absolute original path required')
    directory=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    fd=None
    try:
        for name in path.parts[1:-1]:
            following=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
            os.close(directory);directory=following
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory)
        before=os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<before.st_size<=limit,
                'bounded single-link original file required')
        if executable:require(before.st_mode & 0o111 and not before.st_mode & 0o022,'protected original executable required')
        pieces=[];remaining=before.st_size
        while remaining:
            part=os.read(fd,min(remaining,65536));require(part,'original file shortened');pieces.append(part);remaining-=len(part)
        raw=b''.join(pieces);require(not os.read(fd,1),'original file grew')
        def check():
            require(b.metadata(before)==b.metadata(os.fstat(fd))==b.metadata(os.stat(path.name,dir_fd=directory,follow_symlinks=False))
                    ==b.metadata(path.lstat()),'original file identity changed')
        check();yield raw,fd;check()
    finally:
        if fd is not None:os.close(fd)
        os.close(directory)


def read(path,limit):
    with held(path,limit) as (raw,_):return raw


def classify_result(raw,returncode,context):
    """Validate Core's closed public result ABI; never reproduce its verifier."""
    require(type(returncode) is int,'actual normal CLI return code required')
    value=b.accounting.strict(raw,RESULT_LIMIT)
    base={'version','code','operationIdentity','currentEligibility','nativeGrant'}
    require(type(value) is dict and value.get('version')=='YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-RESULT/v1'
        and value.get('operationIdentity')==value.get('currentEligibility')=='UNKNOWN' and value.get('nativeGrant') is False,
        'normal enrollment result authority/schema differs')
    if value['code']!='VERIFIED_HISTORICAL_DATA':
        require(set(value)==base|{'error'} and value['code'] in FAILURE_CODES and returncode==1
                and type(value['error']) is str and 0<len(value['error'])<=512,'normal rejection code/result differs')
        stage=value['error'].split(': ',1)[0]
        return dict(classification='REJECTED',code=value['code'],proofFailureStage=stage if stage in PROOF_STAGES else None,
                    firstCauseSHA256=b.sha(value['error'].encode()),normalResultSHA256=b.sha(raw))
    require(set(value)==base|{'result'} and returncode==0,'normal success exit/result differs')
    result=value['result']
    b.closed(result,('classification','funding','migration','currentEligibility','nativeGrant'),'closed original enrollment proof required')
    require(result['classification']=='data' and result['currentEligibility']=='UNKNOWN' and result['nativeGrant'] is False,
            'historical result cannot grant current authority')
    light_fields={'version','classification','chainId','genesisSha256','authorityThroughHeight','trustedHeight','trustedBlockHash',
        'headerHeight','blockHash','stateHeight','stateAppHash','validatorsHash','nextValidatorsHash','consensusHash','commitVerified','lightTransitionVerified'}
    tx_fields={'version','classification','block','successor','transactionType','transactionHash','nativeWireHash','height','index','total',
        'executionCode','gasWanted','gasUsed','executionData','included','finalized','executionSuccessful','outcome','nativeGrant'}
    for role in ('funding','migration'):
        tx=result[role];target=context[role+'Expected'];b.decode_cli_expected(encoded(target))
        require(target['transactionType'] in ('pq_transfer','YNX-LAB-LEGACY-FUNDING/v1') if role=='funding'
                else target['transactionType']=='account_migration','normal enrollment result role differs')
        b.closed(tx,tx_fields,'closed original transaction proof result required')
        require(tx['version']=='YNX-PQ-TRANSACTION-PROOF/v1' and tx['classification']=='data'
            and tx['transactionType']==target['transactionType'] and tx['transactionHash']==target['transactionHash']
            and tx['nativeWireHash']==target['nativeWireHash'] and tx['index']==target['index']
            and tx['height']==target['block']['headerHeight'] and tx['executionCode']=='0'
            and tx['included'] is True and tx['finalized'] is True and tx['executionSuccessful'] is True
            and tx['outcome']=='succeeded' and tx['nativeGrant'] is False,'normal historical transaction identity/outcome differs')
        require(number(tx['total'],1<<32,positive=True)>number(tx['index'],1<<32),'normal transaction denominator/index differs')
        number(tx['gasWanted'],signed=True);number(tx['gasUsed'],signed=True);b.b64(tx['executionData'],1<<20)
        for name in ('block','successor'):
            light=tx[name];expected=target[name];b.closed(light,light_fields,'closed original light proof result required')
            require(light['version']=='YNX-PQ-LIGHT-PROOF/v1' and light['classification']=='data'
                and light['commitVerified'] is True and light['lightTransitionVerified'] is True
                and all(light[k]==expected[k] for k in ('chainId','headerHeight','blockHash','stateHeight','stateAppHash'))
                and light['genesisSha256']==context['lightTrust']['consensusGenesisSHA256']
                and light['authorityThroughHeight']==context['lightTrust']['engineHeight'],'normal light proof identity differs')
            require(number(light['trustedHeight'],positive=True)<number(light['headerHeight'],positive=True),'normal trusted height differs')
            number(light['authorityThroughHeight'],positive=True);number(light['stateHeight'])
            require(all(b.hex_pin(light[k]) for k in ('genesisSha256','trustedBlockHash','blockHash','stateAppHash','validatorsHash','nextValidatorsHash','consensusHash')),
                    'normal full light proof hash differs')
    f=result['funding'];m=result['migration']
    require(f['block']['chainId']==m['block']['chainId'] and number(f['height'])<=number(m['height'])
        and (f['height']!=m['height'] or number(f['index'])<number(m['index'])),'normal same-chain operation order differs')
    return dict(classification='DATA',code=value['code'],proofFailureStage=None,normalResultSHA256=b.sha(raw))


def bind_operation(context_raw,context_sha256,role,*,original=None,durable=None,enabled=False):
    """Join exact original sender bytes, not an ID carried in a proof result."""
    require(enabled is True and role in ('funding','migration'),'explicit original role inspection required')
    require(b.hex_pin(context_sha256) and b.sha(context_raw)==context_sha256,'original context digest differs')
    context=b.accounting.strict(context_raw,2*b.EXPECTED_LIMIT+(64<<10));target=context[role+'Expected']
    b.decode_cli_expected(encoded(target));report=unknown()
    if original is None:
        report['missingEvidence']=['normalOriginalOperationProducer'];return report
    require(type(original) is dict and type(original.get('binding')) is dict,'original request/outbox binding required')
    binding=original['binding']
    # Unsupported enrollment producer formats must not inherit sender identity.
    if target['transactionType']!='pq_transfer' or binding.get('transactionType')!='pq_transfer':
        report['missingEvidence']=['normalOriginalOperationProducer'];return report
    require(role=='funding' and binding['owner']==context['pins']['fundingSource'],'original funding sender differs')
    expected=b.decode_expected(original['expected_raw'])
    require(encoded(expected)==encoded(b.decode_cli_expected(encoded(target))),'original operation complete Expected differs')
    if durable is None:
        observed=b.inspect_sender_original(**original)
    else:
        require(type(durable) is dict and not set(durable)&set(original),'closed distinct original ledger and sender arguments required')
        observed=b.audit_durable_sender(**durable,**original)
    report.update(originalByteBindingsObserved=observed['originalByteBindingsObserved'],originalStatus=observed.get('originalStatus'),
        originalLedgerReadOnly=observed.get('originalLedgerReadOnly',False),originalPins=observed['originalPins'],
        missingEvidence=observed['missingEvidence'])
    if observed['originalByteBindingsObserved']:
        report['originalOperationIdentityBindingSHA256']=b.sha(encoded({k:binding[k] for k in ('operationId','ownerIndex','owner','nonce')}))
    return report


def _invoke(binary,fd,context_path,context_sha,request,output,timeout,stop=None,*,original_argv=None,inherited_fds=(),synthetic_fixture=None):
    """One unreplayed original Popen; finite nonblocking IO and exact raw logs."""
    synthetic=synthetic_fixture is not None
    require(type(timeout) in (int,float) and 0.05<=timeout<=(240 if synthetic else 10),'bounded normal verifier deadline required')
    argv=[str(binary),'enrollment','--trust-context',str(context_path),'--trust-context-sha256',context_sha]
    if original_argv is not None:
        require(type(original_argv) is list and original_argv and original_argv[0]==str(binary)
                and all(type(item) is str for item in original_argv),'exact original callee argv required')
        argv=original_argv
    require(type(inherited_fds) is tuple and len(inherited_fds)<=(3 if synthetic else 1) and len(set(inherited_fds))==len(inherited_fds)
            and all(type(item) is int and item>=3 and item!=fd for item in inherited_fds),
            'one independent original credential descriptor required')
    env={'PATH':os.defpath,'LANG':'C'};cwd=None
    if synthetic:
        b.closed(synthetic_fixture,('cwd','env','exchange','check_resources','lifecycle'),'closed original synthetic fixture transport required')
        cwd=Path(synthetic_fixture['cwd'])
        require(cwd.is_absolute() and cwd.resolve(strict=True)==cwd and callable(synthetic_fixture['exchange'])
                and callable(synthetic_fixture['check_resources'])
                and argv==[str(binary),'-test.run','^TestPQLabEnrollmentOriginalCLIConfirmAndRestart$',
                           '-test.count=1','-test.timeout=240s','-test.v'],'exact original synthetic fixture entry required')
        extra=synthetic_fixture['env']
        require(type(extra) is dict and all(type(k) is str and type(v) is str for k,v in extra.items())
                and all(k.startswith('YNX_PQ_ENROLLMENT_') or k in ('PATH','HOME','TMPDIR','GOTMPDIR','GOCACHE',
                    'GOMODCACHE','GOPATH','GOTOOLCHAIN','GOMAXPROCS','GOMEMLIMIT','GOGC','GOPROXY','GOSUMDB',
                    'GOFLAGS','GOENV','GOTELEMETRY') for k in extra),'bounded original synthetic environment required')
        env.update(extra)
        lifecycle=synthetic_fixture['lifecycle']
        require(lifecycle is None or all(callable(getattr(lifecycle,k,None)) for k in ('begin','publish','finish')),
                'original Window pending lifecycle required')
    output=Path(output);require(output.is_absolute() and not output.exists() and output.parent.resolve(strict=True)==output.parent,
                                'fresh private verifier evidence directory required')
    parent=os.open(output.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    parent_info=os.fstat(parent)
    try:
        os.mkdir(output.name,mode=0o700,dir_fd=parent)
        folder=os.open(output.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
    except BaseException:
        os.close(parent);raise
    folder_info=os.fstat(folder);streams={};initial={}
    try:
        for name in ('stdout','stderr'):
            log=os.open(name+'.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=folder)
            streams[name]=os.fdopen(log,'wb',buffering=0);initial[name]=os.fstat(log)
    except BaseException:
        for stream in streams.values():stream.close()
        os.close(folder);os.close(parent);raise
    linux=platform.system()=='Linux';process=None;pidfd=None;published=False;selector=selectors.DefaultSelector();start=time.monotonic_ns()
    deadline=time.monotonic()+timeout;buffers={'stdout':bytearray(),'stderr':bytearray()};offset=0;cause=None;reaped=False
    eof=set();broken_pipe=False;truncated=False;retention_errors=[];cleanup_errors=[]
    def finish(action,target,*,retention=False):
        try:action()
        except Exception as error:
            failure=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error),target=target)
            cleanup_errors.append(failure)
            if retention:retention_errors.append(failure)
    def pump(wait):
        nonlocal offset,broken_pipe,truncated
        if synthetic:synthetic_fixture['check_resources']()
        if stop is not None and stop.is_set():raise InterruptedError('normal verifier cancelled; preserve original inputs')
        if time.monotonic()>=deadline:raise TimeoutError('normal enrollment verifier deadline exceeded')
        for key,_ in selector.select(wait):
            name=key.data;stream=key.fileobj
            if name=='stdin':
                try:written=os.write(stream.fileno(),memoryview(request)[offset:offset+65536])
                except BrokenPipeError:
                    broken_pipe=True;selector.unregister(stream);stream.close();continue
                offset+=written
                if offset==len(request):selector.unregister(stream);stream.close()
            else:
                part=os.read(stream.fileno(),65536)
                if not part:eof.add(name);selector.unregister(stream);stream.close();continue
                room=RESULT_LIMIT-len(buffers[name]);retained=part[:max(room,0)]
                buffers[name].extend(retained);pending=memoryview(retained)
                while pending:
                    written=streams[name].write(pending);require(written>0,'original output short write');pending=pending[written:]
                if len(part)>room:
                    truncated=True;raise ValueError('normal enrollment verifier output exceeded bound')
    try:
        if synthetic:
            synthetic_fixture['check_resources']()
            require(not linux or hasattr(os,'pidfd_open') and hasattr(signal,'pidfd_send_signal'),
                    'Linux original synthetic child pidfd required before launch')
            if lifecycle is not None:lifecycle.begin()
        if stop is not None and stop.is_set():raise InterruptedError('normal verifier cancelled before original process start')
        process=subprocess.Popen(argv,executable='/proc/self/fd/%d'%fd if linux else str(binary),pass_fds=((fd,) if linux else ())+inherited_fds,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,bufsize=0,
            env=env,cwd=cwd,start_new_session=synthetic)
        if synthetic and linux:pidfd=os.pidfd_open(process.pid,0) # Before publication to the owning Window.
        if synthetic and lifecycle is not None:lifecycle.publish(process,argv)
        for name in ('stdin','stdout','stderr'):
            stream=getattr(process,name);os.set_blocking(stream.fileno(),False)
            selector.register(stream,selectors.EVENT_WRITE if name=='stdin' else selectors.EVENT_READ,name)
        if synthetic:
            published=True
            synthetic_fixture['exchange'](lambda:pump(0),process)
        while selector.get_map():
            pump(min(max(0,deadline-time.monotonic()),0.05))
        if synthetic:synthetic_fixture['check_resources']()
        if stop is not None and stop.is_set():raise InterruptedError('normal verifier cancelled; preserve original inputs')
        if synthetic:
            while process.poll() is None:
                pump(0);time.sleep(.05) # Keep the original resource observer live after pipe EOF.
        process.wait(timeout=max(0.001,deadline-time.monotonic()));reaped=True
    except Exception as error:
        cause=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
    finally:
        if process is not None and not reaped:
            # The same-job Window observes this child but retires only AFTER
            # this call returns. A published Linux leader is signalled via its
            # pre-publication pidfd; descendant retirement remains Window work.
            try:
                if process.poll() is None:
                    if synthetic and linux and published:
                        require(pidfd is not None,'original synthetic leader identity missing; retain cleanup debt')
                        try:signal.pidfd_send_signal(pidfd,signal.SIGKILL)
                        except ProcessLookupError:pass # Same handle has already exited; still reap the original Popen.
                    else:process.kill() # Still private/unpublished, or original non-synthetic callee.
                process.wait(timeout=1);reaped=True
            except Exception as error:
                failure=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error),target='original child retirement')
                cleanup_errors.append(failure)
                if cause is None:cause=failure
        if pidfd is not None:finish(lambda:os.close(pidfd),'original child pidfd close')
        if synthetic and lifecycle is not None:finish(lambda:lifecycle.finish(process,argv),'original pending launch retirement')
        finish(selector.close,'selector close')
        if process is not None:
            for name in ('stdin','stdout','stderr'):
                stream=getattr(process,name)
                if stream is not None and not stream.closed:
                    finish(stream.close,name+' pipe close') # unbuffered, no retransmit
        for name,stream in streams.items():
            try:
                os.fsync(stream.fileno());current=os.fstat(stream.fileno());named=os.stat(name+'.log',dir_fd=folder,follow_symlinks=False)
                require(b.metadata(current)==b.metadata(named) and current.st_nlink==1
                    and stat.S_IMODE(current.st_mode)==0o600 and current.st_size==len(buffers[name])
                    and (current.st_dev,current.st_ino)==(initial[name].st_dev,initial[name].st_ino),'original output identity differs')
            except Exception as error:retention_errors.append(dict(type=type(error).__name__,message=b.accounting.d.failure_message(error)))
            finally:finish(stream.close,name+' log close',retention=True)
        try:
            os.fsync(folder);os.fsync(parent);current=output.lstat();current_parent=output.parent.lstat()
            require(stat.S_ISDIR(current.st_mode) and (folder_info.st_dev,folder_info.st_ino)==(current.st_dev,current.st_ino),
                    'original evidence directory identity differs')
            require(stat.S_ISDIR(current_parent.st_mode)
                    and (parent_info.st_dev,parent_info.st_ino)==(current_parent.st_dev,current_parent.st_ino),
                    'original evidence parent directory identity differs')
        except Exception as error:retention_errors.append(dict(type=type(error).__name__,message=b.accounting.d.failure_message(error)))
        finally:
            finish(lambda:os.close(folder),'evidence folder close',retention=True)
            finish(lambda:os.close(parent),'evidence parent close',retention=True)
        if cause is None and retention_errors:cause=retention_errors[0]
        if cause is None and cleanup_errors:cause=cleanup_errors[0]
    return dict(argv=argv,returnCode=process.returncode if process is not None else None,
        originalProcessID=process.pid if process is not None else None,
        elapsedNs=time.monotonic_ns()-start,firstCause=cause,processStarted=process is not None,processReaped=reaped,
        cleanupDebt=(process is not None and not reaped) or bool(cleanup_errors),cleanupErrors=cleanup_errors,
        descendantCleanupRequired=synthetic and process is not None,descendantRetirementObserved=False,
        leaderPidfdUsed=synthetic and linux and pidfd is not None,
        requestBytesWritten=offset,requestBytes=len(request),
        requestPipeClosedEarly=broken_pipe,outputTruncated=truncated,outputComplete=eof=={'stdout','stderr'} and not truncated,
        originalOutputRetained=not retention_errors,retentionErrors=retention_errors,
        deadlineScope='pipe IO and final wait; filesystem calls and process creation are not interruptible here',
        executableFDUsed=linux and process is not None,stdout=bytes(buffers['stdout']),stderr=bytes(buffers['stderr']))


def verify_enrollment(*,scope='production',enabled=False,source=None,chain_ci=None,binary=None,fixture=None,fixture_sha256=None,
                      case_directory=None,context_sha256=None,request_sha256=None,output=None,timeout=10,stop=None):
    """Production stays closed; fixed public controls exercise the same callee."""
    require(enabled is True,'normal enrollment callee is explicitly opt-in')
    report=unknown()
    if scope=='production':
        require(b.NORMAL_ENROLLMENT_CALLEE is None,'a new production contract requires owning source integration')
        report['missingEvidence']=['completeSourceAndResourceCI','authenticatedCurrentAccountState','normalOriginalOperationProducers']
        return report # No IO, Popen, ledger mutation or caller-supplied gate.
    if stop is not None and stop.is_set():
        report['missingEvidence']=['originalCallCancelledBeforeStart'];return report
    require(scope=='public-synthetic-offline' and source==CORE and type(chain_ci) is int and chain_ci==CHAIN_CI,
            'exact public synthetic source and original Chain CI required')
    require(fixture_sha256 in PUBLIC_FIXTURES and b.hex_pin(context_sha256) and b.hex_pin(request_sha256),
            'independently pinned original public fixture/context/request required')
    expected_binary=PUBLIC_BINARIES.get((platform.system(),platform.machine()))
    require(expected_binary is not None,'normal public verifier platform unavailable')
    try:raw=read(fixture,8<<20)
    except FileNotFoundError:
        report['missingEvidence']=['originalPublicFixture'];return report
    require(b.sha(raw)==fixture_sha256,'original public fixture bytes differ')
    original=b.accounting.strict(raw,8<<20)
    b.closed(original,('version','syntheticOnly','materials','trust','pins','fundingExpected','migrationExpected','fundingProof','migrationProof'),
             'closed original public fixture required')
    require(original['version']=='YNX-PQ-ENROLLMENT-PUBLIC-FIXTURE/v1' and original['syntheticOnly'] is True,
            'original public synthetic fixture required')
    directory=Path(case_directory);context_path=directory/'context.json'
    try:context_raw=read(context_path,1<<20);request=read(directory/'request.json',INPUT_LIMIT)
    except FileNotFoundError:
        report['missingEvidence']=['originalContextOrProofRequest'];return report
    require(b.sha(context_raw)==context_sha256 and b.sha(request)==request_sha256,'original normal inputs differ')
    context=b.accounting.strict(context_raw,1<<20);decoded=b.accounting.strict(request,INPUT_LIMIT)
    require(encoded(decoded)==encoded(dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-VERIFY-REQUEST/v1',fundingProof=original['fundingProof'],migrationProof=original['migrationProof'])),
            'normal request differs from both original proofs')
    materials=original['materials'];names={'funding.tx','migration.tx','genesis.json','migration.json','schedule.json','state.json','trusted.json'}
    require(type(materials) is dict and set(materials) in (names,names|{'same-owner-alternate.tx'}),'closed original public materials required')
    pins={}
    for name,data in materials.items():
        original_bytes=b.b64(data,8<<20)
        try:actual=read(directory/name,8<<20)
        except FileNotFoundError:
            report['missingEvidence']=['originalPublicMaterial:'+name];return report
        require(actual==original_bytes,'original fixture material bytes differ');pins[name]=b.sha(actual)
    for field,name in (('migrationFile','migration.json'),('genesisFile','genesis.json'),('stateFile','state.json'),
                       ('scheduleFile','schedule.json'),('trustedLightBlockFile','trusted.json')):
        require(context['lightTrust'][field]==str(directory/name),'normal original trust material path differs')
    for key,value in original['trust'].items():
        if key not in ('migrationFile','genesisFile','stateFile','scheduleFile','trustedLightBlockFile'):
            require(encoded(context['lightTrust'][key])==encoded(value),'original trust settings differ')
    require(encoded(context['pins'])==encoded(original['pins']) and context['fundingOriginalFile']==str(directory/'funding.tx')
            and context['migrationOriginalFile']==str(directory/'migration.tx'),'original enrollment input paths/pins differ')
    expectations={role:dict(raw=encoded(original[role+'Expected'])) for role in ('funding','migration')}
    for item in expectations.values():item['sha256']=b.sha(item['raw'])
    b.bind_normal_cli_expectations(context_raw,context_sha256,expectations,expected_format='normal-cli',enabled=True)
    call=None
    try:
        with held(binary,64<<20,executable=True) as (binary_raw,fd):
            require(b.sha(binary_raw)==expected_binary,'exact original normal verifier binary differs')
            call=_invoke(Path(binary),fd,context_path,context_sha256,request,output,timeout,stop)
    except Exception as error:
        if call is None:
            if isinstance(error,FileNotFoundError):
                report['missingEvidence']=['originalPinnedVerifierBinary'];return report
            raise
        if call['firstCause'] is None:call['firstCause']=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
    report.update(normalVerifierInvoked=call['processStarted'],syntheticOfflineOnly=True,verifierSource=CORE,chainSourceCI=CHAIN_CI,
        resourceCIQualified=False,binarySHA256=expected_binary,fixtureSHA256=fixture_sha256,contextSHA256=context_sha256,
        requestSHA256=request_sha256,stdoutSHA256=b.sha(call['stdout']),stderrSHA256=b.sha(call['stderr']),
        process={k:v for k,v in call.items() if k not in ('stdout','stderr','argv')})
    try:
        unchanged=all(b.sha(read(directory/name,8<<20))==pin for name,pin in pins.items())
        unchanged=unchanged and b.sha(read(context_path,1<<20))==context_sha256 and b.sha(read(directory/'request.json',INPUT_LIMIT))==request_sha256
        require(unchanged,'original normal inputs changed during verification')
        require(not call['stderr'],'normal verifier emitted stderr; retain original output')
    except Exception as error:
        if report['process']['firstCause'] is None:
            report['process']['firstCause']=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
    if report['process']['firstCause'] is None and call['processReaped'] and call['outputComplete']:
        try:
            classification=classify_result(call['stdout'],call['returnCode'],context)
            require(classification['classification']!='DATA' or call['requestBytesWritten']==len(request),
                    'normal success did not consume the full original request')
            report.update(normalResult=classification,historicalProofStatus=classification['classification'],
                historicalCryptographicVerificationObserved=classification['classification']=='DATA')
        except (ValueError,KeyError,TypeError) as error:
            report['process']['firstCause']=dict(type=type(error).__name__,message=b.accounting.d.failure_message(error))
    report['missingEvidence']=['normalOriginalOperationProducers','authenticatedCurrentAccountState','productionQualification']
    raw=encoded(report)
    folder=os.open(output,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);identity=os.fstat(folder)
    fd=None
    try:
        fd=os.open('readback.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=folder)
        pending=memoryview(raw)
        while pending:
            written=os.write(fd,pending);require(written>0,'original readback short write');pending=pending[written:]
        os.fsync(fd);os.fsync(folder)
        info=os.fstat(fd);named=os.stat('readback.json',dir_fd=folder,follow_symlinks=False);current=Path(output).lstat()
        require(b.metadata(info)==b.metadata(named) and info.st_nlink==1 and info.st_size==len(raw)
                and stat.S_IMODE(info.st_mode)==0o600 and stat.S_ISDIR(current.st_mode)
                and (identity.st_dev,identity.st_ino)==(current.st_dev,current.st_ino),'original readback identity differs')
    finally:
        if fd is not None:os.close(fd)
        os.close(folder)
    return report
