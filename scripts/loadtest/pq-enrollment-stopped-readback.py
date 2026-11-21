"""Bounded, read-only joins of one stopped synthetic enrollment original.

This consumes the original SQLite reservation and Core's retained normal
command/reply/confirmation files. File agreement is not HMAC authentication,
proof verification, source qualification or a permission to release a nonce.
No credential file, sender lease, process, RPC or writable database is opened.
"""
from contextlib import ExitStack, contextmanager
import importlib.util
import os
from pathlib import Path
import re
import stat


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

r=module('pq-enrollment-reservation-transport.py')
o=r.original;p=o.p;b=r.b;c=r.c;d=r.d;require=r.require
SCHEMA='YNX-PERF-STOPPED-ENROLLMENT-BYTE-JOIN/v1'
TOTAL_LIMIT=64<<20
ROOT_FILES={'fixture-public-identity.json':32<<10,'fixture-confirm-command.json':32<<10,
            'fixture-recover-command.json':32<<10,'fixture-confirm-reply.json':1<<20,
            'fixture-recover-reply.json':1<<20}
MATERIAL_FILES={'migration':'migration.json','genesis':'genesis.json','committedState':'committed-state.json',
                'schedule':'schedule.json','trustedLightBlock':'trusted-light-block.json'}
ROLE_FILES=dict(p.FILES,**o.PROOF_FILES,**{'confirmation-proof/'+name:8<<20 for name in MATERIAL_FILES.values()})
MATERIAL_FIELDS=('version','migration','genesis','committedState','schedule','trustedLightBlock','pins',
                 'scheduleHash','engineHeight','engineAppHash','trustingPeriodNanoseconds',
                 'maxClockDriftNanoseconds','trustNumerator','trustDenominator','expected')


def report():
    return dict(schema=SCHEMA,status='UNKNOWN',sourceCIQualified=False,normalCalleeInvoked=False,
        recordMACAuthenticated=False,independentProofVerified=False,currentEligibility='UNKNOWN',
        operationIdentity='UNKNOWN',nativeGrant=False,nonceReleased=False,automaticRetry=False,
        privateDataExported=False,resourceCapsQualified=False,originalLedgerReadOnly=False,
        normalReplyExitStatusObserved=False,
        localPairReservationObserved=False,originalPendingPreserved=False,
        bothOutboxByteBindingsObserved=False,bothConfirmationByteBindingsObserved=False,
        coldRecoveryReplyBytesMatch=False,fixtureIdentityBytesMatch=False,
        confirmedFilesObserved={'funding':False,'migration':False},originalPins={},missingEvidence=[],
        sourceCommit=None,planSHA256=None,workloadSHA256=None,requestSHA256=None,originalReservationPins={},
        cleanupDebt=False,firstCauseType=None,firstCauseSHA256=None,originalFirstCauseSHA256=None,
        retentionErrors=[],
        trustProvenance='RETAINED_CORE_FIXTURE_FILES_ONLY_NOT_AUTHENTICATED',
        byteCountScope='CLOSED_STOPPED_FILE_SET_EXCLUDES_DATABASE_RESERVATION_AND_REREADS',
        observedBytes=0)


def retirement(stopped):
    b.closed(stopped,('originalProcessReaped','ownedDescendantsRetired','cleanupDebt','firstCause'),
             'closed original retirement observation required')
    require(all(type(stopped[k]) is bool for k in ('originalProcessReaped','ownedDescendantsRetired','cleanupDebt')),
            'typed original retirement observation required')
    cause=stopped['firstCause']
    require(cause is None or type(cause) is dict,'original first cause must remain separate')
    return stopped['originalProcessReaped'] and stopped['ownedDescendantsRetired'] and not stopped['cleanupDebt']


@contextmanager
def held_stopped(path,limit,out):
    """Keep a body failure when the original FD context also fails to close.

    There is one exit attempt. An uncertain close is not retried, and its
    error is kept separately without exporting a potentially private path.
    """
    original=c.held(path,limit);value=original.__enter__()
    try:yield value
    except BaseException as primary:
        try:original.__exit__(type(primary),primary,primary.__traceback__)
        except BaseException as secondary:
            if secondary is not primary:
                out['cleanupDebt']=True
                out['retentionErrors'].append(dict(type=type(secondary).__name__,
                    sha256=b.sha(d.failure_message(secondary).encode())))
        raise
    else:
        try:original.__exit__(None,None,None)
        except BaseException as error:
            out['cleanupDebt']=True
            out['retentionErrors'].append(dict(type=type(error).__name__,
                sha256=b.sha(d.failure_message(error).encode())))
            raise


def file_layout(pins,request):
    root=pins.root;parent=root/'workload/sender-public/0004'
    paths={name:(root/name,limit) for name,limit in ROOT_FILES.items()}
    for role in o.ROLES:
        paths[role+'/materials']=(root/'original-public-proofs'/(role+'-materials.json'),8<<20)
        paths[role+'/proof']=(root/'original-public-proofs'/(role+'-proof.json'),8<<20)
        for name,limit in ROLE_FILES.items():paths[role+'/'+name]=(parent/request[role+'OperationId']/name,limit)
    return paths


def _identity(raw,pins,binaries,request_sha):
    value=b.accounting.strict(raw,ROOT_FILES['fixture-public-identity.json'])
    fields=('version','sourceCommit','binarySHA256','cliSourceBinding','testBinarySHA256','testSourceBinding',
            'planSHA256','workloadSHA256','requestSHA256','proofTrustExpiresAt','testOutcome','currentEligibility',
            'syntheticOnly','preSignPerfReservation','authorityGranted')
    b.closed(value,fields,'closed original Core fixture identity required')
    require(value['version']=='YNX-PRIVATE-SYNTHETIC-ENROLLMENT-FIXTURE/v1'
        and value['sourceCommit']==pins.source and value['binarySHA256']==binaries['cliSHA256']
        and value['testBinarySHA256']==binaries['testSHA256'] and value['planSHA256']==pins.plan_pin
        and value['workloadSHA256']==pins.workload_pin and value['requestSHA256']==request_sha,
        'original fixture source/binary/plan/request differs')
    require(value['cliSourceBinding'] in ('EMBEDDED_VCS','EXTERNAL_ONLY')
        and value['testSourceBinding']==value['testOutcome']=='NOT_ATTESTED'
        and value['currentEligibility']=='UNKNOWN' and value['syntheticOnly'] is True
        and value['preSignPerfReservation'] is False and value['authorityGranted'] is False,
        'fixture cannot attest test, reservation or authority')
    require(type(value['proofTrustExpiresAt']) is str
        and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z',value['proofTrustExpiresAt']),
        'original fixture trust time encoding differs')
    # The stored expiry is not a fresh time, a trust extension or current proof verification.


def capture_stopped_manifest(*,handshake,stopped,check_resources=None,enabled=False):
    """Pin only closed public-data filenames after original retirement.

    Capturing these hashes does not attest the files or supply absent evidence.
    This is read-only and never creates a missing normal confirmation/reply.
    """
    require(enabled is True,'stopped evidence capture is explicitly opt-in')
    out=dict(schema='YNX-PERF-STOPPED-ENROLLMENT-FILE-PINS/v1',status='UNKNOWN',evidencePins={},
        missingEvidence=[],firstCauseType=None,firstCauseSHA256=None,sourceCIQualified=False,
        nonceReleased=False,automaticRetry=False,privateDataExported=False,cleanupDebt=False,retentionErrors=[])
    if not retirement(stopped):
        out['missingEvidence']=['originalCompleteProcessAndDescendantRetirement'];return out
    if not callable(check_resources):out['missingEvidence']=['originalReadScopeResourceObserver'];return out
    try:
        b.closed(handshake,('originalLaunch','transcript','database','database_pin','file_pins'),
                 'closed original stopped handshake arguments required')
        launch=handshake['originalLaunch']
        b.closed(launch,('root','source','planSHA256','workloadSHA256'),'closed independent original launch pins required')
        check_resources();pins=r.PinnedOriginals(launch['root'],launch['source'],launch['planSHA256'],launch['workloadSHA256'])
        observed=r.audit_private_reservation(pins=pins,enabled=True,**{k:v for k,v in handshake.items() if k!='originalLaunch'})
        require(observed['firstCause'] is None,'original reservation audit refused before capture')
        if not observed['bothOutboxRequestBytesMatch']:
            out['missingEvidence']=observed['missingEvidence'] or ['originalPrivateReservation'];return out
        frame=r.decode('REQUEST',c.read(Path(handshake['transcript'])/'request.jsonl',r.FRAME_LIMIT))
        request=o.request(o.canonical(frame['request']),observed['requestSHA256']);total=0
        for name,(path,limit) in file_layout(pins,request).items():
            check_resources()
            try:
                with held_stopped(path,limit,out) as (raw,fd):
                    info=os.fstat(fd)
                    require(stat.S_IMODE(info.st_mode)==0o600 and info.st_uid==os.geteuid(),'owner-only stopped original required')
                    total+=len(raw);require(total<=TOTAL_LIMIT,'stopped aggregate byte bound exceeded')
                    out['evidencePins'][name]=dict(bytes=len(raw),sha256=b.sha(raw))
            except FileNotFoundError:out['missingEvidence'].append(name)
        pins.check();check_resources()
    except Exception as error:
        out['firstCauseType']=type(error).__name__;out['firstCauseSHA256']=b.sha(d.failure_message(error).encode())
    return out


def inspect_stopped(*,handshake,binary_pins,stopped,evidence_pins,check_resources=None,enabled=False):
    """Read exact stopped originals once; return only closed public DATA hashes.

    `evidence_pins` are caller-observed file bytes, not an authorization. The
    original resource owner must supply its live read-scope observer; a stopped
    Window.sample is not valid because its original logs may already be closed.
    Missing retirement/observer/evidence refuses before further private reads.
    """
    require(enabled is True,'stopped enrollment readback is explicitly opt-in')
    out=report();complete=retirement(stopped)
    if stopped['firstCause'] is not None:out['originalFirstCauseSHA256']=b.sha(o.canonical(stopped['firstCause']))
    out['cleanupDebt']=stopped['cleanupDebt']
    if not complete:
        out['missingEvidence']=['originalCompleteProcessAndDescendantRetirement'];return out
    if not callable(check_resources):
        out['missingEvidence']=['originalReadScopeResourceObserver'];return out
    require(type(handshake) is dict,'original stopped handshake arguments required')
    b.closed(handshake,('originalLaunch','transcript','database','database_pin','file_pins'),
             'closed original stopped handshake arguments required')
    launch=handshake['originalLaunch']
    b.closed(launch,('root','source','planSHA256','workloadSHA256'),'closed independent original launch pins required')
    b.closed(binary_pins,('testSHA256','cliSHA256'),'independent original binary pins required')
    require(all(b.hex_pin(v) for v in binary_pins.values()),'original binary byte pins required')
    require(type(evidence_pins) is dict,'original stopped file pins required')
    ledger=None;original_db=None;success=False;pending_observed=False
    try:
        check_resources()
        pins=r.PinnedOriginals(launch['root'],launch['source'],launch['planSHA256'],launch['workloadSHA256'])
        out.update(sourceCommit=pins.source,planSHA256=pins.plan_pin,workloadSHA256=pins.workload_pin)
        observed=r.audit_private_reservation(pins=pins,enabled=True,**{k:v for k,v in handshake.items() if k!='originalLaunch'})
        out['originalLedgerReadOnly']=observed['originalLedgerReadOnly']
        out['localPairReservationObserved']=observed['localPairReservationObserved']
        if observed.get('originalExchangeFirstCause') is not None and out['originalFirstCauseSHA256'] is None:
            out['originalFirstCauseSHA256']=b.sha(o.canonical(observed['originalExchangeFirstCause']))
        require(observed['firstCause'] is None,'original handshake byte join refused')
        if not all(observed[k] for k in ('localPairReservationObserved','peerAckBytesMatch','bothOutboxRequestBytesMatch')):
            out['missingEvidence']=observed['missingEvidence'] or ['completeOriginalReservationBytes'];return out
        request_sha=observed['requestSHA256'];database=Path(handshake['database'])
        out['requestSHA256']=request_sha;out['originalReservationPins']=observed['originalPins']
        original_db={k:handshake['database_pin'][k] for k in ('bytes','sha256')}
        require(b.accounting.pin(database,b.accounting.DB_LIMIT)==original_db,'original database changed before stopped join')
        ledger=d.open_readonly(database,pins.plan(),handshake['database_pin']['planSHA256'],max_db_bytes=b.accounting.DB_LIMIT)
        reserved=ledger.read_enrollment_pair(0,request_sha);request_raw=reserved['requestRaw'];request=o.request(request_raw,request_sha)
        require(reserved['sourceCommit']==pins.source,'stopped original reservation source differs')
        pending=ledger.audit()['originalPending']
        require(len(pending)==1 and pending[0]['pending']==0 and pending[0]['nextNonce']==2,
                'original pending was released or replaced')
        pending_observed=True
        layout=file_layout(pins,request)
        unexpected=set(evidence_pins)-set(layout);require(not unexpected,'unlisted private evidence file refused')
        missing=set(layout)-set(evidence_pins)
        if missing:out['missingEvidence']=sorted(missing);return out
        total=0
        for name,pin in evidence_pins.items():
            b.closed(pin,('bytes','sha256'),'closed stopped original file pin required')
            require(type(pin['bytes']) is int and 0<pin['bytes']<=layout[name][1] and b.hex_pin(pin['sha256']),
                    'bounded stopped original file pin required')
            total+=pin['bytes']
        require(total<=TOTAL_LIMIT,'stopped original aggregate byte bound exceeded')
        values={}
        with ExitStack() as stack:
            for name,(path,limit) in layout.items():
                check_resources()
                try:value,fd=stack.enter_context(held_stopped(path,limit,out))
                except FileNotFoundError:out['missingEvidence'].append(name);continue
                info=os.fstat(fd)
                require(stat.S_IMODE(info.st_mode)==0o600 and info.st_uid==os.geteuid(),
                        'private original stopped file mode/owner differs')
                pin=dict(bytes=len(value),sha256=b.sha(value))
                require(pin==evidence_pins[name],'stopped original file bytes differ: '+name)
                values[name]=value;out['originalPins'][name]=pin;out['observedBytes']+=len(value)
                for role in o.ROLES:
                    if name==role+'/CONFIRMED.json':out['confirmedFilesObserved'][role]=True
            if out['missingEvidence']:return out
            _identity(values['fixture-public-identity.json'],pins,binary_pins,request_sha)
            out['fixtureIdentityBytesMatch']=True
            materials={role:b.accounting.strict(values[role+'/materials'],8<<20) for role in o.ROLES}
            expected={};contexts={};retained={};proofs={};proof_pins={};inputs={}
            parent=pins.root/'workload/sender-public/0004'
            for role in o.ROLES:
                material=materials[role];b.closed(material,MATERIAL_FIELDS,'complete original proof materials required')
                require(material['version']=='YNX-PQ-LOOPBACK-PROOF-MATERIALS/v1','original material ABI differs')
                expected[role]=b.decode_expected(o.canonical(material['expected']))
                retained[role]={name:values[role+'/'+name] for name in o.PROOF_FILES}
                contexts[role]=b.accounting.strict(retained[role]['confirmation-proof/trust-context.json'],1<<20)
                target=contexts[role]['expectedTransaction']
                require(p.same(b.decode_cli_expected(o.canonical(target)),expected[role]),'retained full Expected differs from original materials')
                for field,filename in MATERIAL_FILES.items():
                    require(b.b64(material[field],8<<20)==values[role+'/confirmation-proof/'+filename],
                            'retained original trust material bytes differ')
                light=contexts[role]['lightTrust'];bootstrap=material['pins']
                b.closed(bootstrap,('CometGenesisSHA256','OriginalGenesisHash','MigrationStateHash'),
                         'complete original material bootstrap pins required')
                workload=b.accounting.strict(pins.workload_raw,8<<20)
                require(bootstrap['CometGenesisSHA256']==b.sha(b.b64(material['genesis'],8<<20))
                    ==light['consensusGenesisSHA256']
                    and bootstrap['OriginalGenesisHash']==workload['originalGenesisHash']==light['originalGenesisHash']
                    and bootstrap['MigrationStateHash']==workload['migrationStateHash']==light['migrationStateHash']
                    and light['trustedLightBlockSHA256']==b.sha(b.b64(material['trustedLightBlock'],8<<20))
                    and light['engineAppHash']==b.b64(material['engineAppHash'],32).hex(),
                    'retained trust context differs from original material bytes/pins')
                for key,field in (('scheduleHash','scheduleHash'),('engineHeight','engineHeight'),
                    ('trustingPeriodNanoseconds','trustingPeriodNanoseconds'),('maxClockDriftNanoseconds','maxClockDriftNanoseconds'),
                    ('trustLevelNumerator','trustNumerator'),('trustLevelDenominator','trustDenominator')):
                    require(light[key]==material[field],'retained trust parameter differs from original material')
                proofs[role]=values[role+'/proof'];proof_pins[role]=b.sha(proofs[role])
                inputs[role]=dict(materialsFile=str(layout[role+'/materials'][0]),materialsSHA256=b.sha(values[role+'/materials']),
                    proofFile=str(layout[role+'/proof'][0]),proofSHA256=proof_pins[role])
            require(p.same({k:v for k,v in materials['funding'].items() if k!='expected'},
                           {k:v for k,v in materials['migration'].items() if k!='expected'}),'two original trust material sets differ')
            for operation in ('confirm','recover'):
                require(values['fixture-'+operation+'-command.json']==o.command(operation,request_raw,request_sha,
                    root=pins.root,proof_inputs=inputs if operation=='confirm' else None)[:-1],
                    'retained normal original command differs')
            workload=b.accounting.strict(pins.workload_raw,8<<20)
            context=dict(version='YNX-CONSENSUS-ENROLLMENT-PROOF-TRUST/v1',lightTrust=contexts['funding']['lightTrust'],
                pins=dict(originalGenesis=workload['originalGenesisHash'],nativeChainId='642399',fundingSource=pins.owner['address'],
                    owner=request['targetOwner'],fundingAmount=request['fundingAmount'],pka=request['pka'],pkb=request['pkb'],activationHeight=request['activationHeight']),
                fundingExpected=contexts['funding']['expectedTransaction'],migrationExpected=contexts['migration']['expectedTransaction'],
                fundingOriginalFile=str(parent/request['fundingOperationId']/'transaction.abci'),
                migrationOriginalFile=str(parent/request['migrationOperationId']/'transaction.abci'))
            # This context is an observed byte projection of retained files,
            # NOT an authenticated trust source. All authority bits stay false.
            context_raw=o.canonical(context)
            binding=dict(schema=p.SCHEMA,sourceCommit=pins.source,requestSHA256=request_sha,workloadSHA256=pins.workload_pin,
                contextSHA256=b.sha(context_raw),expectedSHA256={role:b.sha(o.canonical(expected[role])) for role in o.ROLES},
                files={role:{name:evidence_pins[role+'/'+name] for name in p.FILES} for role in o.ROLES})
            pair=p.inspect_pair(binding=binding,parent_directory=parent,request_raw=request_raw,workload_raw=pins.workload_raw,
                context_raw=context_raw,expected_raws={role:o.canonical(expected[role]) for role in o.ROLES},
                funding_row=ledger.row(0),sponsor_account=pins.owner,enabled=True)
            require(pair['originalPairByteBindingsObserved'],'original outbox pair byte join incomplete')
            for operation in ('confirm','recover'):
                # Exit 0 selects the success-frame ABI contract here; no exit
                # observation is inferred from these stored files or returned.
                classified=o.inspect_reply(values['fixture-'+operation+'-reply.json'],0,operation=operation,
                    request_raw=request_raw,request_sha256=request_sha,result_original_raw=values['funding/RESULT.json'],
                    context_raw=context_raw,proof_raws=proofs,proof_sha256=proof_pins,retained=retained,
                    parent_directory=parent,enabled=True)
                require(classified['originalReplyByteBindingsObserved'],'retained normal reply is incomplete or UNKNOWN')
            pending=ledger.audit()['originalPending']
            require(len(pending)==1 and pending[0]['pending']==0 and pending[0]['nextNonce']==2,
                    'original pending was released or replaced')
            check_resources();pins.check()
        success=True
    except Exception as error:
        out['firstCauseType']=type(error).__name__;out['firstCauseSHA256']=b.sha(d.failure_message(error).encode())
    finally:
        if ledger is not None:
            try:
                ledger.close();require(b.accounting.pin(Path(handshake['database']),b.accounting.DB_LIMIT)==original_db,
                                       'read-only original database changed after stopped join')
                out['originalPendingPreserved']=pending_observed
            except Exception as error:
                success=False;out['cleanupDebt']=True
                if out['firstCauseType'] is None:
                    out['firstCauseType']=type(error).__name__;out['firstCauseSHA256']=b.sha(d.failure_message(error).encode())
        if success:
            out.update(originalPendingPreserved=True,bothOutboxByteBindingsObserved=True,
                bothConfirmationByteBindingsObserved=True,coldRecoveryReplyBytesMatch=True)
    return out


def audit_stopped_originals(*,handshake,binary_pins,stopped,check_resources=None,enabled=False):
    """Capture and consume the same stopped originals, without a retry path.

    This convenience entry point still requires the resource owner's genuine
    read-scope callback and retirement observation. It is not wired to a
    production sender, cannot repair missing files, and cannot release pending.
    """
    require(enabled is True,'stopped original audit is explicitly opt-in')
    captured=capture_stopped_manifest(handshake=handshake,stopped=stopped,
        check_resources=check_resources,enabled=True)
    if captured['firstCauseType'] is not None or captured['cleanupDebt'] or captured['missingEvidence']:
        out=report();out.update(missingEvidence=captured['missingEvidence'],
            firstCauseType=captured['firstCauseType'],firstCauseSHA256=captured['firstCauseSHA256'],
            cleanupDebt=stopped['cleanupDebt'] or captured['cleanupDebt'],retentionErrors=captured['retentionErrors'])
        if stopped['firstCause'] is not None:out['originalFirstCauseSHA256']=b.sha(o.canonical(stopped['firstCause']))
        # Captured partial pins are retained as byte observations, never as a
        # complete pair, a successful durability return, or a second attempt.
        out['originalPins']=captured['evidencePins'];return out
    return inspect_stopped(handshake=handshake,binary_pins=binary_pins,stopped=stopped,
        evidence_pins=captured['evidencePins'],check_resources=check_resources,enabled=True)
