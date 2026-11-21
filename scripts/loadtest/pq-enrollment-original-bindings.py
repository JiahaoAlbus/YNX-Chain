"""Read original sender byte bindings before a SAME-CHAIN proof caller.

This does not authenticate sender-record MACs, decode transaction cryptography,
or create an enrollment operation. Core dfad supplies a historical proof CLI;
normal classic-funding/initial-migration durable outboxes and current account
eligibility remain separate, unavailable contracts here.
Only the existing one-member PQ sender format is understood here. An observed
byte join never releases the ledger, retries an operation or admits an account.
"""
import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import stat

spec=importlib.util.spec_from_file_location('enrollment_original_accounting',Path(__file__).with_name('pq-durable-load-accounting.py'))
accounting=importlib.util.module_from_spec(spec);spec.loader.exec_module(accounting)
require=accounting.require
SCHEMA='YNX-PERF-ENROLLMENT-ORIGINAL-BINDING/v1'
SOURCE='33f83823f438c8d9ac1edd3014a9ca0505ef4d00'
# ABI inspection only, NOT an accepted binary/CI tuple or executable source gate.
INSPECTED_ENROLLMENT_CLI='dfadf421e817bf7898c50aea2340a71672561890'
# Source CI or public fixture verification is not production admission.
# No caller/environment can open the production invocation gate.
NORMAL_ENROLLMENT_CALLEE=None
FILE_LIMITS={'request.json':4096,'RESULT.json':2<<20,'transaction.wire':8<<20,'transaction.abci':8<<20}
EXPECTED_LIMIT=24<<20


def sha(raw):return hashlib.sha256(raw).hexdigest()
def hex_pin(value):return type(value) is str and re.fullmatch('[0-9a-f]{64}',value) is not None
def decimal(value):
    require(type(value) is str and re.fullmatch('[1-9][0-9]*',value) is not None,'canonical original nonce required')
    number=int(value);require(number<1<<64,'bounded original nonce required');return number
def b64(value,limit):
    require(type(value) is str and len(value)<=4*((limit+2)//3),'bounded original base64 required')
    raw=base64.b64decode(value,validate=True)
    require(len(raw)<=limit and base64.b64encode(raw).decode()==value,'canonical original base64 required')
    return raw
def closed(value,fields,message):require(type(value) is dict and set(value)==set(fields),message)
def metadata(info):
    return (info.st_dev,info.st_ino,info.st_mode,info.st_nlink,info.st_uid,info.st_size,info.st_mtime_ns,info.st_ctime_ns)


def unknown_report(original_status=None):
    return dict(schema=SCHEMA,status='UNKNOWN',sourceCommit=SOURCE,originalByteBindingsObserved=False,
                normalVerifierInvoked=False,normalVerifierAvailable=False,recordMACAuthenticated=False,
                independentTransactionFinality=False,currentEligibility='UNKNOWN',nativeGrant=False,
                nonceReleased=False,automaticRetry=False,resigningAllowed=False,accountAdmissionAllowed=False,
                privateDataExported=False,missingEvidence=[],originalStatus=original_status,originalPins={})


def decode_expected(expected_raw):
    """The existing Go API's complete target, without verifying any proof."""
    expected=accounting.strict(expected_raw,EXPECTED_LIMIT)
    closed(expected,('Block','Successor','TransactionType','Envelope','NativeWire','TransactionHash','NativeWireHash','Index'),
           'complete original Go proof expectation required')
    require(expected['TransactionType'] in ('pq_transfer','account_migration','YNX-LAB-LEGACY-FUNDING/v1')
            and type(expected['Index']) is int and 0<=expected['Index']<1<<32,'original proof transaction kind/index differs')
    for key in ('Block','Successor'):
        point=expected[key]
        closed(point,('ChainID','HeaderHeight','BlockHash','StateHeight','StateAppHash'),'complete original expected header required')
        require(type(point['ChainID']) is str and 0<len(point['ChainID'])<=128
                and type(point['HeaderHeight']) is int and 0<point['HeaderHeight']<1<<63
                and type(point['StateHeight']) is int and 0<=point['StateHeight']<1<<63
                and point['HeaderHeight']==point['StateHeight']+1
                and len(b64(point['BlockHash'],32))==32 and len(b64(point['StateAppHash'],32))==32,
                'original expected header encoding differs')
    require(expected['Block']['ChainID']==expected['Successor']['ChainID']
            and expected['Block']['HeaderHeight']<(1<<63)-3
            and expected['Successor']['HeaderHeight']==expected['Block']['HeaderHeight']+1,
            'original same-chain H/H+1 expectation differs')
    require(sha(b64(expected['Envelope'],8<<20))==b64(expected['TransactionHash'],32).hex()
            and sha(b64(expected['NativeWire'],8<<20))==b64(expected['NativeWireHash'],32).hex(),
            'complete Expected raw hashes differ')
    return expected


def decode_cli_expected(expected_raw):
    """Shape-only conversion from the normal CLI ABI; no transaction decoding."""
    value=accounting.strict(expected_raw,EXPECTED_LIMIT)
    closed(value,('block','successor','transactionType','envelope','nativeWire','transactionHash','nativeWireHash','index'),
           'complete original normal CLI proof expectation required')
    def integer(text,limit):
        require(type(text) is str and re.fullmatch('0|[1-9][0-9]*',text) is not None and len(text)<=20,
                'canonical normal CLI integer required')
        number=int(text);require(number<limit,'bounded normal CLI integer required');return number
    def digest(text):
        require(hex_pin(text),'canonical normal CLI hash required')
        return base64.b64encode(bytes.fromhex(text)).decode()
    def point(item):
        closed(item,('chainId','headerHeight','blockHash','stateHeight','stateAppHash'),
               'complete original normal CLI header required')
        return dict(ChainID=item['chainId'],HeaderHeight=integer(item['headerHeight'],1<<63),
            BlockHash=digest(item['blockHash']),StateHeight=integer(item['stateHeight'],1<<63),
            StateAppHash=digest(item['stateAppHash']))
    typed=dict(Block=point(value['block']),Successor=point(value['successor']),TransactionType=value['transactionType'],
        Envelope=value['envelope'],NativeWire=value['nativeWire'],TransactionHash=digest(value['transactionHash']),
        NativeWireHash=digest(value['nativeWireHash']),Index=integer(value['index'],1<<32))
    return decode_expected(accounting.d.encoded(typed,EXPECTED_LIMIT).encode('utf-8'))


def bind_normal_cli_expectations(context_raw,context_sha256,expectations,*,expected_format='go-default',enabled=False):
    """Pure ABI adapter; leave the caller's raw trust context unchanged.

    This binds both independent typed targets to the normal CLI's lowercase,
    string-scalar JSON. It neither validates the trust source nor invokes the
    candidate. Missing original operation producers remain UNKNOWN separately.
    """
    require(enabled is True,'normal enrollment ABI binding is explicitly opt-in')
    require(expected_format in ('go-default','normal-cli'),'explicit original Expected format required')
    require(hex_pin(context_sha256) and type(context_raw) is bytes and sha(context_raw)==context_sha256,
            'independent original normal context pin differs')
    context=accounting.strict(context_raw,2*EXPECTED_LIMIT+(64<<10))
    closed(context,('version','lightTrust','pins','fundingExpected','migrationExpected','fundingOriginalFile','migrationOriginalFile'),
           'closed normal enrollment context required')
    require(context['version']=='YNX-CONSENSUS-ENROLLMENT-PROOF-TRUST/v1','normal enrollment context ABI differs')
    closed(expectations,('funding','migration'),'both independently pinned original targets required')
    pins={}
    for role,original in expectations.items():
        closed(original,('raw','sha256'),'complete independent typed target pin required')
        require(type(original['raw']) is bytes and hex_pin(original['sha256']) and sha(original['raw'])==original['sha256'],
                'original typed target bytes differ')
        expected=(decode_expected if expected_format=='go-default' else decode_cli_expected)(original['raw'])
        require(expected['TransactionType'] in ('pq_transfer','YNX-LAB-LEGACY-FUNDING/v1') if role=='funding'
                else expected['TransactionType']=='account_migration','original enrollment role/type differs')
        def point(value):
            return dict(chainId=value['ChainID'],headerHeight=str(value['HeaderHeight']),blockHash=b64(value['BlockHash'],32).hex(),
                        stateHeight=str(value['StateHeight']),stateAppHash=b64(value['StateAppHash'],32).hex())
        projected=dict(block=point(expected['Block']),successor=point(expected['Successor']),transactionType=expected['TransactionType'],
            envelope=expected['Envelope'],nativeWire=expected['NativeWire'],transactionHash=b64(expected['TransactionHash'],32).hex(),
            nativeWireHash=b64(expected['NativeWireHash'],32).hex(),index=str(expected['Index']))
        require(accounting.d.encoded(context[role+'Expected'],EXPECTED_LIMIT)==accounting.d.encoded(projected,EXPECTED_LIMIT),
                'normal CLI target differs from complete original Expected')
        pins[role]=original['sha256']
    report=unknown_report()
    report.update(inspectedVerifierABI=INSPECTED_ENROLLMENT_CLI,originalExpectedFormat=expected_format,
        normalCLIExpectedByteBindingsObserved=True,
        originalPins=dict(contextSHA256=context_sha256,expectedSHA256=pins),
        missingEvidence=['fixedVerifierSourceCIAndBinary','authenticatedIndependentTrust','originalOperationIdentity','authenticatedCurrentAccountState'])
    return report


def original_files(directory,pins):
    """Fixed filenames only, from one held private directory; never keys/vaults."""
    closed(pins,FILE_LIMITS,'complete original request/outbox/wire pins required')
    for name,pin in pins.items():
        closed(pin,('bytes','sha256'),'closed original file pin required')
        require(type(pin['bytes']) is int and 0<pin['bytes']<=FILE_LIMITS[name] and hex_pin(pin['sha256']),
                'bounded independently pinned original file required')
    path=Path(directory)
    require(path.is_absolute() and path.resolve(strict=True)==path,'canonical original operation directory required')
    folder=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        parent=os.fstat(folder)
        require(stat.S_IMODE(parent.st_mode)==0o700 and parent.st_uid==os.geteuid(),'original private operation directory required')
        result={};missing=[]
        for name,pin in pins.items():
            try:fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=folder)
            except FileNotFoundError:missing.append(name);continue
            try:
                before=os.fstat(fd)
                require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600 and before.st_nlink==1
                        and before.st_uid==os.geteuid() and before.st_size==pin['bytes'],'original file identity/size differs')
                chunks=[];remaining=pin['bytes']
                while remaining:
                    part=os.read(fd,min(remaining,65536));require(part,'original file shortened')
                    chunks.append(part);remaining-=len(part)
                require(not os.read(fd,1),'original file grew')
                raw=b''.join(chunks)
                require(metadata(before)==metadata(os.fstat(fd))==metadata(os.stat(name,dir_fd=folder,follow_symlinks=False))
                        and sha(raw)==pin['sha256'],'original file bytes or identity changed')
                result[name]=raw
            finally:os.close(fd)
        current=path.lstat();held=os.fstat(folder)
        require((parent.st_dev,parent.st_ino,parent.st_uid,stat.S_IMODE(parent.st_mode))==
                (current.st_dev,current.st_ino,current.st_uid,stat.S_IMODE(current.st_mode))==
                (held.st_dev,held.st_ino,held.st_uid,stat.S_IMODE(held.st_mode)) and stat.S_ISDIR(current.st_mode),
                'original operation directory changed')
        return result,missing
    finally:os.close(folder)


def inspect_sender_original(*,binding,directory,workload_raw,expected_raw,row,account,enabled=False):
    """Inspect known original DATA; never substitute a missing normal verifier."""
    require(enabled is True,'original enrollment binding inspection is explicitly opt-in')
    closed(binding,('schema','sourceCommit','operationId','ownerIndex','owner','nonce','transactionType',
                    'files','workloadSHA256','expectedSHA256'),'closed original operation binding required')
    require(binding['schema']==SCHEMA and binding['sourceCommit']==SOURCE,'exact inspected Core source required')
    require(hex_pin(binding['operationId']) and hex_pin(binding['workloadSHA256']) and hex_pin(binding['expectedSHA256'])
            and type(binding['ownerIndex']) is int and 0<=binding['ownerIndex']<1000
            and type(binding['owner']) is str and 0<len(binding['owner'])<=128,'original operation identity required')
    nonce=decimal(binding['nonce'])
    require(row.get('status') in ('reserved','signed','submitted','included','qualified','failed','unknown'),
            'original claimed operation status required')
    report=unknown_report(row.get('status'))
    require(row.get('operationId')==binding['operationId'] and type(row.get('ownerIndex')) is int
            and row['ownerIndex']==binding['ownerIndex'] and type(row.get('nonce')) is int and row['nonce']==nonce
            and account.get('ownerIndex')==binding['ownerIndex'] and type(account.get('ownerIndex')) is int
            and account.get('address')==binding['owner'],'original ledger operation/owner/nonce differs')
    # Neither the classic test wire nor an initial migration has this sender
    # outbox contract. Do not reinterpret them or create replacement originals.
    if binding['transactionType']!='pq_transfer':
        report['missingEvidence']=['normalOriginalOperationProducer','normalEnrollmentVerifierCLI','authenticatedCurrentAccountState']
        return report
    require(nonce>=2,'normal PQ sender nonce differs')
    path=Path(directory)
    require(path.name==binding['operationId'] and path.parent.name=='%04d'%binding['ownerIndex']
            and path.parent.parent.name=='sender-public','original sender operation path differs')
    if workload_raw is None or expected_raw is None:
        report['missingEvidence']=[name for name,value in (('originalWorkload',workload_raw),('completeExpected',expected_raw)) if value is None]
        return report
    require(type(workload_raw) is bytes and 0<len(workload_raw)<=8<<20 and sha(workload_raw)==binding['workloadSHA256']
            and type(expected_raw) is bytes and 0<len(expected_raw)<=EXPECTED_LIMIT and sha(expected_raw)==binding['expectedSHA256'],
            'original workload/complete Expected bytes differ')
    workload=accounting.strict(workload_raw,8<<20)
    require(workload.get('version')=='YNX-PQ-LOOPBACK-WORKLOAD/v1' and workload.get('mode')=='online'
            and workload.get('syntheticOnly') is True and workload.get('authorityGranted') is False
            and type(workload.get('owners')) is list and 0<len(workload['owners'])<=1000,'normal synthetic online workload required')
    owners=[value for value in workload['owners'] if value.get('index')==binding['ownerIndex']]
    require(len(owners)==1 and type(owners[0]['index']) is int and owners[0].get('owner')==binding['owner'],
            'original workload owner differs')
    try:files,missing=original_files(directory,binding['files'])
    except FileNotFoundError:
        report['missingEvidence']=['originalOperationDirectory'];return report
    if missing:report['missingEvidence']=missing;return report
    request=accounting.strict(files['request.json'],4096)
    closed(request,('version','operationId','ownerIndex','firstNonce','members'),'closed original sender request required')
    require(request==dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId=binding['operationId'],
                         ownerIndex=binding['ownerIndex'],firstNonce=binding['nonce'],members=1)
            and type(request['members']) is int and type(request['ownerIndex']) is int,'original request identity differs')
    record=accounting.strict(files['RESULT.json'],2<<20)
    closed(record,('body','mac'),'original sender record wrapper required')
    require(len(b64(record['mac'],32))==32,'original sender MAC bytes missing; not authenticated here')
    result=accounting.strict(b64(record['body'],2<<20),2<<20)
    closed(result,('version','status','syntheticOnly','authorityGranted','operationId','ownerIndex','checkpointHeight',
                   'checkpointAppHash','transaction'),'closed original sender result required')
    require(result['version']=='YNX-PQ-LAB-SENDER-RESULT/v1' and result['status']=='signed-original'
            and result['syntheticOnly'] is True and result['authorityGranted'] is False
            and result['operationId']==binding['operationId'] and type(result['ownerIndex']) is int
            and result['ownerIndex']==binding['ownerIndex'] and decimal(result['checkpointHeight'])<1<<63
            and hex_pin(result['checkpointAppHash']),'original result identity/checkpoint differs')
    tx=result['transaction']
    closed(tx,('ownerIndex','type','wire','envelope','nativeHash','abciHash','firstNonce','members','amountPerMember','feePerMember'),
           'closed original transaction reference required')
    require(type(tx['ownerIndex']) is int and tx['ownerIndex']==binding['ownerIndex'] and tx['type']=='pq_transfer'
            and tx['firstNonce']==binding['nonce'] and tx['members']==tx['amountPerMember']==tx['feePerMember']=='1',
            'original sender transaction/nonce differs')
    for key,name in (('wire','transaction.wire'),('envelope','transaction.abci')):
        closed(tx[key],('path','sha256','bytes'),'closed original wire reference required')
        require(tx[key]==dict(path=name,sha256=sha(files[name]),bytes=str(len(files[name]))),'original wire reference differs')
    require(tx['nativeHash']==sha(files['transaction.wire']) and tx['abciHash']==sha(files['transaction.abci'])
            and row.get('nativeHash') in (None,tx['nativeHash']) and row.get('hash') in (None,tx['abciHash']),
            'original raw hashes differ from ledger/outbox')
    expected=decode_expected(expected_raw)
    require(expected['TransactionType']=='pq_transfer','original proof transaction kind differs')
    require(b64(expected['Envelope'],8<<20)==files['transaction.abci'] and b64(expected['NativeWire'],8<<20)==files['transaction.wire']
            and b64(expected['TransactionHash'],32)==bytes.fromhex(tx['abciHash'])
            and b64(expected['NativeWireHash'],32)==bytes.fromhex(tx['nativeHash']),
            'complete Expected does not bind both original wires/hashes')
    report.update(originalByteBindingsObserved=True,
        originalPins=dict(files={name:dict(pin) for name,pin in binding['files'].items()},
                          workloadSHA256=binding['workloadSHA256'],expectedSHA256=binding['expectedSHA256']),
        missingEvidence=['normalEnrollmentVerifierCLI','authenticatedOriginalRecordMAC','authenticatedCurrentAccountState'])
    # No release callback, writable ledger handle, signer or subprocess exists.
    return report


def audit_durable_sender(run_raw,run_sha256,*,source_tools,plan_raw,accounting_raw,private_database,index,**original):
    """Bind one row from the SAME pinned stopped DB; never resume it writable."""
    require(original.get('enabled') is True,'original enrollment binding inspection is explicitly opt-in')
    observed=accounting.join_run(run_raw,run_sha256,binding=source_tools,plan_raw=plan_raw,
        accounting_raw=accounting_raw,private_database=private_database)
    if observed['privateOriginalStatus']!='READ_ONLY_ORIGINAL_ACCOUNTING_OBSERVED':
        report=unknown_report();report['missingEvidence']=observed['missingEvidence'] or ['privateDatabase']
        report['originalLedgerReadOnly']=False;return report
    receipt=accounting.strict(accounting_raw)
    plan=accounting.strict(plan_raw,accounting.d.MAX_PLAN_BYTES)['plan']
    require(source_tools['source']['commit']==original['binding']['sourceCommit']
            and plan['workloadSHA256']==original['binding']['workloadSHA256'],'original source/workload differs from driver')
    value=accounting.d.make_plan(plan['networkPlanSHA256'],plan['workloadSHA256'],plan['mode'],plan['accounts'],
        plan['requestedOfferedTPS'],plan['windowNs'],plan['tailNs'],enabled=True)
    expected_pin={key:receipt['database'][key] for key in ('bytes','sha256')}
    path=Path(private_database)
    require(accounting.pin(path,accounting.DB_LIMIT)==expected_pin,'same stopped original DB required')
    ledger=accounting.d.open_readonly(path,value,receipt['database']['planSHA256'],max_db_bytes=accounting.DB_LIMIT)
    try:
        row=ledger.row(index);matches=[a for a in plan['accounts'] if a['ownerIndex']==row['ownerIndex']]
        require(len(matches)==1,'original row owner missing')
        result=inspect_sender_original(row=row,account=matches[0],**original)
        result['originalPins']['database']=dict(receipt['database'])
        result['originalLedgerReadOnly']=True
        cause=observed['firstCause']
        result['originalFirstCauseSHA256']=None if cause is None else sha(cause.encode())
        return result
    finally:
        ledger.close();require(accounting.pin(path,accounting.DB_LIMIT)==expected_pin,'original read-only ledger changed')
