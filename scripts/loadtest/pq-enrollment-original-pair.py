"""Opt-in byte joins for the original synthetic enrollment pair.

This inspects a fixed producer ABI; it does not invoke that producer, verify
record HMACs, decode signed messages, confirm a transaction or admit an owner.
Both operation directories are under the SPONSOR lease. Migration's target
nonce 1 is not a second sponsor ledger reservation. No CONFIRMED file is trusted
here and no missing file is reconstructed. Production callee remains closed.
"""
from contextlib import ExitStack
import importlib.util
import os
from pathlib import Path
import stat

spec=importlib.util.spec_from_file_location('enrollment_pair_callee',Path(__file__).with_name('pq-enrollment-normal-callee.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
b=c.b;require=b.require
SCHEMA='YNX-PERF-ENROLLMENT-ORIGINAL-PAIR/v1'
# Inspection identity only: not a binary/CI qualification or a production gate.
SOURCE='0a3a44f80159df800eeec8b54d200d982c5af762'
FILES={'request.json':16<<10,'INTENT.json':2<<20,'RESULT.json':2<<20,
       'transaction.wire':8<<20,'transaction.abci':8<<20}
TOTAL_LIMIT=96<<20
ROLES=('funding','migration')


def encoded(value):return b.accounting.d.encoded(value,2*b.EXPECTED_LIMIT+(64<<10)).encode()
def same(a,z):return encoded(a)==encoded(z)
def report(status=None):
    value=b.unknown_report(status)
    value.update(schema=SCHEMA,sourceCommit=SOURCE,operationIdentity='UNKNOWN',
        originalPairByteBindingsObserved=False,originalLedgerReadOnly=False,
        targetMigrationLedgerObserved=False,normalProducerInvoked=False,
        normalProducerAvailable=False,sourceDeploymentQualified=False)
    return value


def request(raw):
    value=b.accounting.strict(raw,16<<10)
    b.closed(value,('version','fundingOperationId','migrationOperationId','ownerIndex','fundingNonce',
                    'targetOwner','fundingAmount','activationHeight','pka','pkb'),'closed original pair request required')
    require(value['version']=='YNX-PQ-LAB-ENROLLMENT-REQUEST/v1'
            and b.hex_pin(value['fundingOperationId']) and b.hex_pin(value['migrationOperationId'])
            and value['fundingOperationId']!=value['migrationOperationId']
            and type(value['ownerIndex']) is int and 0<=value['ownerIndex']<1000,
            'distinct original pair operations and sponsor required')
    require(2<=b.decimal(value['fundingNonce']) and 3<=b.decimal(value['fundingAmount'])<(1<<63)-1
            and 0<b.decimal(value['activationHeight'])<1<<63
            and type(value['targetOwner']) is str and 0<len(value['targetOwner'])<=128
            and len(b.b64(value['pka'],2592))==2592 and len(b.b64(value['pkb'],64))==64,
            'bounded original pair request fields required')
    return value


def record(raw):
    wrapper=b.accounting.strict(raw,2<<20)
    b.closed(wrapper,('body','mac'),'original pair HMAC wrapper required')
    require(len(b.b64(wrapper['mac'],32))==32,'original record MAC missing; not authenticated here')
    body=b.b64(wrapper['body'],2<<20)
    return body,b.accounting.strict(body,2<<20)


def inspect_pair(*,binding,parent_directory,request_raw,workload_raw,context_raw,expected_raws,
                 funding_row,sponsor_account,enabled=False):
    require(enabled is True,'original pair inspection is explicitly opt-in')
    b.closed(binding,('schema','sourceCommit','requestSHA256','workloadSHA256','contextSHA256','expectedSHA256','files'),
             'closed original pair binding required')
    require(binding['schema']==SCHEMA and binding['sourceCommit']==SOURCE,'exact original pair producer source required')
    statuses=('reserved','signed','submitted','included','qualified','failed','unknown')
    if funding_row is not None:
        require(type(funding_row) is dict and funding_row.get('status') in statuses,'original bounded funding status required')
    out=report(funding_row['status'] if funding_row is not None else None)
    inputs={'request':request_raw,'workload':workload_raw,'context':context_raw}
    missing=[key for key,raw in inputs.items() if raw is None]
    if expected_raws is None:missing.append('bothCompleteExpected')
    elif type(expected_raws) is dict:
        missing.extend(role+'.completeExpected' for role in ROLES if expected_raws.get(role) is None)
    if parent_directory is None:missing.append('originalOperationParent')
    if funding_row is None:missing.append('originalFundingLedgerRow')
    if sponsor_account is None:missing.append('originalSponsorAccount')
    if missing:out['missingEvidence']=missing;return out
    b.closed(expected_raws,ROLES,'both complete original targets required')
    b.closed(binding['expectedSHA256'],ROLES,'both independent target pins required')
    limits={'request':16<<10,'workload':8<<20,'context':2*b.EXPECTED_LIMIT+(64<<10)}
    for key,raw in inputs.items():
        require(type(raw) is bytes and 0<len(raw)<=limits[key] and b.hex_pin(binding[key+'SHA256'])
                and b.sha(raw)==binding[key+'SHA256'],'original pair '+key+' bytes differ')
    expected={}
    for role,raw in expected_raws.items():
        require(type(raw) is bytes and 0<len(raw)<=b.EXPECTED_LIMIT and b.hex_pin(binding['expectedSHA256'][role])
                and b.sha(raw)==binding['expectedSHA256'][role],'original pair complete Expected bytes differ')
        expected[role]=b.decode_expected(raw)
    budget=sum(map(len,inputs.values()))+sum(map(len,expected_raws.values()))
    b.closed(binding['files'],ROLES,'both original operation file sets required')
    for pins in binding['files'].values():
        b.closed(pins,FILES,'all original request intent result and wire pins required')
        for name,pin in pins.items():
            b.closed(pin,('bytes','sha256'),'closed original pair file pin required')
            require(type(pin['bytes']) is int and 0<pin['bytes']<=FILES[name] and b.hex_pin(pin['sha256']),
                    'bounded original pair file required')
            budget+=pin['bytes']
    require(budget<=TOTAL_LIMIT,'original pair aggregate bytes exceed bound')
    r=request(request_raw);workload=b.accounting.strict(workload_raw,8<<20)
    require(workload.get('version')=='YNX-PQ-LOOPBACK-WORKLOAD/v1' and workload.get('mode')=='online'
            and workload.get('syntheticOnly') is True and workload.get('authorityGranted') is False
            and workload.get('nativeChainId')=='642399' and b.hex_pin(workload.get('originalGenesisHash'))
            and type(workload.get('owners')) is list and 0<len(workload['owners'])<=1000,
            'original online synthetic workload required')
    owners=[o for o in workload['owners'] if type(o) is dict and o.get('index')==r['ownerIndex']]
    require(len(owners)==1 and type(owners[0]['index']) is int,'one original workload sponsor required')
    sponsor=owners[0]
    require(type(sponsor.get('owner')) is str and 0<len(sponsor['owner'])<=128 and sponsor['owner']!=r['targetOwner']
            and 1<=b.decimal(sponsor.get('memberCapacity'))<=10000
            and b.decimal(r['fundingNonce'])<=b.decimal(sponsor['memberCapacity'])+1,'bounded original sponsor capacity differs')
    require(type(funding_row) is dict and funding_row.get('status') in statuses
            and funding_row.get('operationId')==r['fundingOperationId'] and type(funding_row.get('ownerIndex')) is int
            and funding_row['ownerIndex']==r['ownerIndex'] and type(funding_row.get('nonce')) is int
            and funding_row['nonce']==b.decimal(r['fundingNonce']) and type(sponsor_account) is dict
            and type(sponsor_account.get('ownerIndex')) is int and sponsor_account['ownerIndex']==r['ownerIndex']
            and sponsor_account.get('address')==sponsor['owner'],'original sponsor ledger identity differs')
    targets={role:dict(raw=expected_raws[role],sha256=binding['expectedSHA256'][role]) for role in ROLES}
    b.bind_normal_cli_expectations(context_raw,binding['contextSHA256'],targets,enabled=True)
    context=b.accounting.strict(context_raw,limits['context']);pins=context['pins']
    b.closed(pins,('originalGenesis','nativeChainId','fundingSource','owner','fundingAmount','pka','pkb','activationHeight'),
             'complete original independent enrollment pins required')
    require(same(pins,dict(originalGenesis=workload['originalGenesisHash'],nativeChainId='642399',fundingSource=sponsor['owner'],
        owner=r['targetOwner'],fundingAmount=r['fundingAmount'],pka=r['pka'],pkb=r['pkb'],activationHeight=r['activationHeight'])),
        'original pair request differs from independent enrollment pins')
    f,m=(expected[role] for role in ROLES)
    require(f['TransactionType']=='pq_transfer' and m['TransactionType']=='account_migration'
            and f['Block']['ChainID']==m['Block']['ChainID']
            and (f['Block']['HeaderHeight'],f['Index'])<(m['Block']['HeaderHeight'],m['Index']),
            'original enrollment role chain and order differ')
    points={}
    for target in (f,m):
        for point in (target['Block'],target['Successor']):
            height=point['HeaderHeight']
            require(height not in points or same(points[height],point),'same-height pair block identities differ')
            points[height]=point
    parent=Path(parent_directory)
    require(parent.is_absolute() and parent.name=='%04d'%r['ownerIndex'] and parent.parent.name=='sender-public',
            'original sponsor pair parent differs')
    files={};missing=[];directories=[]
    with ExitStack() as stack:
        for role in ROLES:
            directory=parent/r[role+'OperationId'];files[role]={}
            try:info=directory.lstat()
            except FileNotFoundError:missing.append(role+'.operationDirectory');continue
            require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode)==0o700 and info.st_uid==os.geteuid(),
                    'original private pair directory required')
            directories.append((directory,b.metadata(info)))
            for name,pin in binding['files'][role].items():
                try:raw,fd=stack.enter_context(c.held(directory/name,FILES[name]))
                except FileNotFoundError:missing.append(role+'.'+name);continue
                finfo=os.fstat(fd)
                require(stat.S_IMODE(finfo.st_mode)==0o600 and finfo.st_uid==os.geteuid()
                        and len(raw)==pin['bytes'] and b.sha(raw)==pin['sha256'],'original pair file changed')
                files[role][name]=raw
        if missing:out['missingEvidence']=missing;return out
        bodies={}
        for role,original in files.items():
            require(original['request.json']==request_raw,'original pair request copies differ')
            bodies[role]={}
            for name in ('INTENT.json','RESULT.json'):bodies[role][name]=record(original[name])
        # MACs include each original path. Compare bodies, never require equal
        # MACs or treat their existence/equality as authentication.
        for name in ('INTENT.json','RESULT.json'):
            require(bodies['funding'][name][0]==bodies['migration'][name][0],'original pair record bodies differ')
        intent=bodies['funding']['INTENT.json'][1];result=bodies['funding']['RESULT.json'][1]
        b.closed(intent,('version','request','checkpointHeight','checkpointAppHash','registration'),'complete original pair intent required')
        b.closed(result,('version','status','syntheticOnly','authorityGranted','currentEligibility','request','checkpointHeight',
            'checkpointAppHash','fundingWire','fundingEnvelope','migrationWire','migrationEnvelope'),'complete original pair result required')
        require(intent['version']=='YNX-PQ-LAB-ENROLLMENT-INTENT/v1' and same(intent['request'],r)
                and result['version']=='YNX-PQ-LAB-ENROLLMENT-RESULT/v1' and result['status']=='signed-originals'
                and result['syntheticOnly'] is True and result['authorityGranted'] is False and result['currentEligibility']=='UNKNOWN'
                and same(result['request'],r),'original pair result or intent request differs')
        height=b.decimal(intent['checkpointHeight'])
        require(height<(1<<63)-2 and b.hex_pin(intent['checkpointAppHash'])
                and result['checkpointHeight']==intent['checkpointHeight'] and result['checkpointAppHash']==intent['checkpointAppHash']
                and b.decimal(r['activationHeight'])>height+1 and f['Block']['HeaderHeight']>height,
                'original pair checkpoint or activation differs')
        reg=intent['registration']
        b.closed(reg,('AlgorithmVersion','Owner','Purpose','PolicyRevision','ChainID','PKA','PKB','Enabled','ActiveFrom','RevokedAt'),
                 'complete original intent registration required')
        require(reg['Owner']==sponsor['owner'] and reg['Purpose']=='TX-BATCH'
                and b.b64(reg['ChainID'],32).hex()==workload['originalGenesisHash']
                and type(reg['AlgorithmVersion']) is str and 0<len(reg['AlgorithmVersion'])<=128
                and type(reg['PolicyRevision']) is str and 0<len(reg['PolicyRevision'])<=128
                and len(b.b64(reg['PKA'],2592))==2592 and len(b.b64(reg['PKB'],64))==64
                and type(reg['Enabled']) is bool and type(reg['ActiveFrom']) is int and 0<=reg['ActiveFrom']<1<<64
                and (reg['RevokedAt'] is None or type(reg['RevokedAt']) is int and 0<=reg['RevokedAt']<1<<64),
                'original intent registration shape differs')
        for role in ROLES:
            original=files[role];target=expected[role]
            for suffix,name,key in (('Wire','transaction.wire','NativeWire'),('Envelope','transaction.abci','Envelope')):
                require(same(result[role+suffix],dict(path=name,sha256=b.sha(original[name]),bytes=str(len(original[name]))))
                        and b.b64(target[key],8<<20)==original[name],'original pair role wire or complete Expected differs')
            if role=='funding':
                require(funding_row.get('hash') in (None,b.sha(original['transaction.abci']))
                        and funding_row.get('nativeHash') in (None,b.sha(original['transaction.wire'])),'original sponsor ledger hash differs')
        out.update(originalPairByteBindingsObserved=True,originalByteBindingsObserved=True,
            originalPins=b.accounting.strict(encoded(binding)),
            originalOperationIdentityBindingSHA256=b.sha(encoded(r)),
            missingEvidence=['authenticatedOriginalRecordMAC','normalEnrollmentProducerCLI','targetMigrationLedger',
                             'authenticatedIndependentTrust','authenticatedCurrentAccountState','productionQualification'])
        for directory,identity in directories:
            require(b.metadata(directory.lstat())==identity,'original operation directory changed during pair inspection')
    return out


def audit_durable_pair(run_raw,run_sha256,*,source_tools,plan_raw,accounting_raw,private_database,index,**original):
    """Use only the same SHA-pinned stopped DB's original FUNDING row."""
    require(original.get('enabled') is True,'original pair inspection is explicitly opt-in')
    a=b.accounting
    observed=a.join_run(run_raw,run_sha256,binding=source_tools,plan_raw=plan_raw,accounting_raw=accounting_raw,
                        private_database=private_database)
    if observed['privateOriginalStatus']!='READ_ONLY_ORIGINAL_ACCOUNTING_OBSERVED':
        out=report();out['missingEvidence']=observed['missingEvidence'] or ['privateDatabase'];return out
    require(source_tools['source']['commit']==SOURCE,'original pair source differs from driver')
    receipt=a.strict(accounting_raw);plan=a.strict(plan_raw,a.d.MAX_PLAN_BYTES)['plan']
    require(plan['workloadSHA256']==original['binding']['workloadSHA256'],'original pair workload differs from driver')
    value=a.d.make_plan(plan['networkPlanSHA256'],plan['workloadSHA256'],plan['mode'],plan['accounts'],
        plan['requestedOfferedTPS'],plan['windowNs'],plan['tailNs'],enabled=True)
    pin={key:receipt['database'][key] for key in ('bytes','sha256')};path=Path(private_database)
    require(a.pin(path,a.DB_LIMIT)==pin,'same stopped original pair DB required')
    ledger=a.d.open_readonly(path,value,receipt['database']['planSHA256'],max_db_bytes=a.DB_LIMIT)
    try:
        row=ledger.row(index);owners=[o for o in plan['accounts'] if o['ownerIndex']==row['ownerIndex']]
        require(len(owners)==1,'original sponsor row owner missing')
        out=inspect_pair(funding_row=row,sponsor_account=owners[0],**original)
        out['originalLedgerReadOnly']=True;out['originalPins']['database']=dict(receipt['database'])
        cause=observed['firstCause'];out['originalFirstCauseSHA256']=None if cause is None else b.sha(cause.encode())
        return out
    finally:
        ledger.close();require(a.pin(path,a.DB_LIMIT)==pin,'original read-only pair DB changed')
