"""Read Core's complete stopped-store reconstruction/replay DATA, no execution.

Protobuf bytes stay opaque and intact. Normal Go owns codec/state validation.
Source/binary/CI binding and original live-leg coverage are separate evidence.
"""
import base64
import hashlib
import importlib.util
from pathlib import Path
import re

spec=importlib.util.spec_from_file_location('finalize_original_io',Path(__file__).with_name('pq-public-proof-readback.py'))
io=importlib.util.module_from_spec(spec);spec.loader.exec_module(io)
require=io.require
TRACE_VERSION='YNX-PQ-LAB-FINALIZE-TRACE/v1'
REPLAY_VERSION='YNX-PQ-LAB-FINALIZE-REPLAY/v1'
REQUEST_SOURCE='original-BlockExecutor-eight-fields-from-stopped-BlockStore;not-RPC-wire-capture'
STATE_ENCODING='complete-encodeCommittedStateJSON-bytes;one-height-materialized;length-and-SHA256;no-field-projection'
FILES={'migration':'migration.json','genesis':'genesis.json','schedule':'schedule.json','initChain':'init-chain.pb','initialState':'initial-state.json','finalState':'final-state.json','records':'records.jsonl'}
RECORD_FIELDS={'height','block','lightBlock','request','response','stateBytes','stateSHA256','appHash','executionSuccessorBound'}
TOTAL_LIMIT=256<<20

def sha(raw):return hashlib.sha256(raw).hexdigest()
def uint(value):
    require(type(value) is str and re.fullmatch('0|[1-9][0-9]*',value) is not None,'canonical original decimal string required')
    return int(value)
def digest(value):require(type(value) is str and re.fullmatch('[0-9a-f]{64}',value) is not None,'original SHA256 required');return value

def read_bundle(directory,result_sha256,kind):
    directory=Path(directory);require(directory.is_absolute() and directory.resolve(strict=True)==directory,'canonical original trace directory required')
    raw=io.read_original(directory/'result.json',64<<10);require(sha(raw)==digest(result_sha256),'external original trace result pin differs');result=io.strict(raw)
    require(kind in ('trace','replay') and result.get('version')==(TRACE_VERSION if kind=='trace' else REPLAY_VERSION),'original complete trace/replay schema differs')
    for key,expected in [('sourceReadOnly',True),('syntheticOnly',True),('nodeStarted',False),('authorityGranted',False)]:require(result.get(key) is expected,'original trace scope differs: '+key)
    first,last=uint(result['firstHeight']),uint(result['lastHeight']);require(0<first<=last and last-first<4096,'complete bounded original height denominator required')
    roles=FILES if kind=='trace' else {'records':'replay.jsonl','finalState':'final-state.json'}
    total=0
    for role,name in roles.items():
        ref=result.get(role);require(type(ref) is dict and set(ref)=={'name','bytes','sha256'} and ref['name']==name,'closed original trace file name/descriptor required')
        size=uint(ref['bytes']);digest(ref['sha256']);require(0<size<=TOTAL_LIMIT,'original trace file bound exceeded');total+=size
    require(total<=TOTAL_LIMIT,'original portable trace readback total exceeds256MiB')
    values={};pins=[dict(name='result.json',bytes=len(raw),sha256=sha(raw))]
    for role,name in roles.items():
        body=io.read_original(directory/name,min(uint(result[role]['bytes']),TOTAL_LIMIT));require(len(body)==uint(result[role]['bytes']) and sha(body)==result[role]['sha256'],'original trace file size/SHA differs: '+name)
        values[role]=body;pins.append(dict(name=name,bytes=len(body),sha256=sha(body)))
    if kind=='trace':
        require(result.get('requestSource')==REQUEST_SOURCE and result.get('stateEncoding')==STATE_ENCODING,'original request reconstruction/state encoding differs')
        require(result.get('stoppedNodes')==4 and type(result['stoppedNodes']) is int and result.get('coldReopened') is True and result.get('publicNetwork') is False,'original stopped four-node synthetic trace scope required')
        require(result.get('runtimePlan') is None and result.get('runtimePlanHash')=='','runtime-plan-bearing trace not supported by this original synthetic ABI')
        intent=io.read_original(directory/'intent.json',64<<10);pins.append(dict(name='intent.json',bytes=len(intent),sha256=sha(intent)));io.strict(intent)
        require(result['pins']['CometGenesisSHA256']==sha(values['genesis']),'original genesis bytes/receipt pin differ')
    else:
        digest(result['traceSHA256'])
        for key,expected in [('completeStateBytesReconstructed',True),('fullResponsesCompared',True),('normalizationApplied',False),('liveNetworkPairQualified',False)]:require(result.get(key) is expected,'original replay coverage differs: '+key)
    lines=values['records'].splitlines();require(len(lines)==last-first+1,'all original heights required; no missing or extra record')
    records=[]
    for height,line in enumerate(lines,first):
        require(len(line)<=128<<20,'bounded original per-height record required');row=io.strict(line)
        require(set(row)==RECORD_FIELDS and uint(row['height'])==height,'complete original record fields/height order differs')
        state_bytes=uint(row['stateBytes']);require(0<state_bytes<=128<<20,'complete original state byte bound differs');digest(row['stateSHA256']);digest(row['appHash']);require(type(row['executionSuccessorBound']) is bool,'original successor binding marker required')
        packet_pins={}
        for field in ('block','lightBlock','request','response'):
            require(type(row[field]) is str,'original protobuf/base64 packet required');packet=base64.b64decode(row[field],validate=True)
            require(base64.b64encode(packet).decode()==row[field] and packet,'original complete packet must stay canonical and nonempty')
            packet_pins[field]=dict(bytes=len(packet),sha256=sha(packet))
        records.append(dict(height=height,recordBytes=len(line),recordSHA256=sha(line),packetPins=packet_pins,stateBytes=state_bytes,stateSHA256=row['stateSHA256'],appHash=row['appHash'],executionSuccessorBound=row['executionSuccessorBound']))
    final=io.strict(values['finalState']);require(type(final.get('height')) is int and final['height']==last and final.get('appHash')==records[-1]['appHash'] and len(values['finalState'])==records[-1]['stateBytes'] and sha(values['finalState'])==records[-1]['stateSHA256'],'last complete original state/checkpoint differs')
    if kind=='trace':require(result['engineAppHash']==records[-1]['appHash'],'original engine final checkpoint differs')
    return dict(kind=kind,directory=str(directory),resultSHA256=result_sha256,originalResult=result,files=pins,firstHeight=first,lastHeight=last,expectedHeights=last-first+1,retainedHeights=len(records),records=records,
        requestOrigin=REQUEST_SOURCE,RPCWireCaptured=False,protobufReverifiedByThisReader=False,intermediateFullStateBytesIndependentlyReconstructed=False,sourceBinaryBindingSupplied=False,sourceCIQualificationConsumed=False,
        _records=values['records'],_final=values['finalState'])

def public(bundle):return {k:v for k,v in bundle.items() if not k.startswith('_')}

def compare(trace,before=None,after=None):
    report=dict(schema='YNX-PERF-COMPLETE-FINALIZE-TRACE-READBACK/v1',status='TRACE_ORIGINALS_READ',qualified=False,trace=public(trace),replays={},allOriginalHeightsRead=True,commonOriginalFinalizeTrajectoryQualified=False,beforeAfterSourceQualification=False,normalWirePairQualified=False,pressureAuthorized=False,missing=[])
    for label,bundle in [('before',before),('after',after)]:
        if bundle is None:report['missing'].append(label+' original normal CLI replay not supplied');continue
        require(bundle['kind']=='replay' and bundle['originalResult']['traceSHA256']==trace['resultSHA256'],'replay must bind the identical immutable original trace')
        require((bundle['firstHeight'],bundle['lastHeight'])==(trace['firstHeight'],trace['lastHeight']),'original replay height denominator differs')
        require(bundle['_records']==trace['_records'] and bundle['_final']==trace['_final'],'complete original replay records/final state bytes differ; no field projection or normalization')
        report['replays'][label]=public(bundle)
    if before is not None and after is not None:
        report['status']='MATCHED_ORIGINAL_REPLAY_DATA_ONLY';report['completeReplayBytesEqual']=True
        if before['directory']==after['directory']:report['missing'].append('Same original replay directory cannot represent two independent source executions')
    report['independentReplayExecutionsObserved']=False
    report['missing']+=['Independent original normal caller/source/binary/CI identity and before/after binding required; result files alone contain no executable/source provenance', 'Actual each-live-leg full-height denominator and own full AppHash chain qualification required; reconstructed module fixture is not a live capture']
    return report
