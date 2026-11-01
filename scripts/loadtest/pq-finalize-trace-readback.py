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

def compare(trace,before=None,after=None,execution=None):
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
    if execution is not None:
        require(type(execution) is OriginalExecution and execution.trace_pin==trace['resultSHA256'] and before is execution.before and after is execution.after,'only verified original execution readback may qualify semantic gate1')
        report.update(status='QUALIFIED_SUPPLIED_TRACE_SEMANTIC_GATE1',qualified=True,semanticGate1Qualified=True,commonOriginalFinalizeTrajectoryQualified=True,independentReplayExecutionsObserved=True,sourceBinaryBindingSupplied=True,originalExecution=execution.provenance,qualificationScope='Only supplied complete stopped-store reconstructed trajectory and explicit f27+same-caller overlay versus6cc. No live capture, whole-chain history denominator, runtime window, speed or ON grant.')
    if execution is None:report['missing'].append('Independent original normal caller/source/binary/CI identity and before/after binding required; result files alone contain no executable/source provenance')
    report['missing'].append('Actual each-live-leg full-height denominator and own full AppHash chain qualification required; reconstructed module fixture is not a live capture')
    return report

APPROVED_EXECUTION_SHA256='e1b9c8305e087ab9b6297bfe080683c6c1ad497c3bdc43a951e65efba69b4a17'

class OriginalExecution:
    def __init__(self,trace_pin,provenance,before,after):
        self.trace_pin=trace_pin;self.provenance=provenance;self.before=before;self.after=after

def read_execution(path,pin,trace):
    """Consume Root-selected original independent binaries. Never run a binary."""
    import os,stat
    path=Path(path);require(pin==APPROVED_EXECUTION_SHA256,'independently selected semantic execution pin required')
    raw=io.read_original(path,128<<10);require(sha(raw)==pin,'original semantic execution H pin differs');h=io.strict(raw)
    require(h['schema']=='YNX-SAME-ORIGINAL-FINALIZE-REPLAY-EXECUTION/v1' and h['syntheticOnly'] is True,'original semantic execution schema/scope differs')
    for key in ('liveNetworkExecuted','liveOFFONQualified','throughputMeasured','performanceBenefitMeasured','nodeStarted','sourceOrTraceMutated','walletOrPublicActivation'):require(h[key] is False,'semantic execution scope differs: '+key)
    require(h['sameCallerExactFiveBlobs'] is True and h['beforeIsExplicitF27PlusNewCallerNotOriginalF27CLI'] is True and h['sourceProvenanceIsExternalInventoryNotEmbeddedVCS'] is True,'explicit controlled baseline caller/source provenance required')
    require(h['originalTrace']['result']['sha256']==trace['resultSHA256'] and h['perfInputs']['consumerExpectedTraceSHA256']==trace['resultSHA256'],'execution binds a different original trace')
    verified=[]
    def file(ref,limit=256<<20,blob=None):
        p=Path(ref['path']);require(p.is_absolute() and p.resolve(strict=True)==p,'canonical original execution file required')
        fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<=before.st_size<=limit and before.st_size==ref['bytes'],'bounded regular original execution file required')
            digest256=hashlib.sha256();gitblob=hashlib.sha1(('blob '+str(before.st_size)+'\0').encode());count=0
            with os.fdopen(fd,'rb',closefd=False) as stream:
                while True:
                    chunk=stream.read(1<<20)
                    if not chunk:break
                    count+=len(chunk);digest256.update(chunk);gitblob.update(chunk)
            after=os.fstat(fd);current=p.lstat();signature=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            require(count==before.st_size and signature(before)==signature(after)==signature(current) and digest256.hexdigest()==ref['sha256'],'original execution bytes/identity changed')
            if blob is not None:require(gitblob.hexdigest()==blob,'original source Git blob differs')
        finally:os.close(fd)
        verified.append(dict(path=str(p),bytes=count,sha256=digest256.hexdigest()))
        return p
    evidence={ref['path']:ref for ref in h['evidence']}
    require(len(evidence)==len(h['evidence']),'duplicate original execution evidence')
    for ref in h['evidence']:file(ref,16<<20)
    file(h['runner'],1<<20);file(h['sourceSelection'],128<<10);file(h['resource']['execution'],128<<10)
    execution=io.strict(io.read_original(Path(h['resource']['execution']['path']),128<<10));require(execution['firstCause'] is None,'original execution first cause must stay visible')
    commands={row['name']:row for row in execution['commands']};require(len(commands)==len(execution['commands']),'independent original command names required')
    outputs={};arms={};sources={}
    for label in ('before','after'):
        arm=h['arms'][label];source=arm['source'];root=Path(source['source']);require(root.is_absolute() and root.resolve(strict=True)==root and not (root/'.git').exists(),'original immutable archive source required')
        inv_path=Path(source['sourceInventory']);require(str(inv_path) in evidence and evidence[str(inv_path)]['sha256']==source['sourceInventorySHA256'],'original source inventory pin differs')
        inventory=io.strict(io.read_original(inv_path,2<<20));require(len(inventory)==source['sourceFiles'] and len(inventory)<=10000,'complete original source inventory required')
        names=set();total=0;rows={}
        for row in inventory:
            relative=Path(row['path']);require(not relative.is_absolute() and '..' not in relative.parts and row['path'] not in names and row['gitMode'] in ('100644','100755'),'closed original source inventory entry required');names.add(row['path']);rows[row['path']]=row
            file(dict(path=str(root/relative),bytes=row['bytes'],sha256=row['sha256']),16<<20,row['gitBlob']);total+=row['bytes']
        actual=set()
        for directory,dirs,files in os.walk(root,followlinks=False):
            require(all(not (Path(directory)/name).is_symlink() for name in dirs),'original source directory redirect refused')
            actual.update(str((Path(directory)/name).relative_to(root)) for name in files)
        require(actual==names and total==source['sourceBytes'],'original complete source file denominator differs')
        tree_path=str(path.parent/'evidence'/(label+'.git-source-tree.bin'));require(tree_path in evidence,'original source Git tree evidence required');tree={}
        for entry in io.read_original(Path(tree_path),2<<20).split(b'\0'):
            if not entry:continue
            head,name=entry.split(b'\t',1);mode,kind,blob=head.decode().split();require(kind=='blob' and name.decode() not in tree,'original source tree entry differs');tree[name.decode()]=(mode,blob)
        require(set(tree)==names and all(tree[name]==(row['gitMode'],row['gitBlob']) for name,row in rows.items()),'original source tree and complete inventory differ')
        archive=Path(source['archive']);file(dict(path=str(archive),bytes=archive.stat().st_size,sha256=source['archiveSHA256']))
        file(arm['binary'],128<<20);file(arm['buildInfo'],64<<10)
        info=io.read_original(Path(arm['buildInfo']['path']),64<<10).decode();require(info.startswith(arm['binary']['path']+': '+h['sameGoVersion']) and '\tpath\tgithub.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-pq-lab\n' in info and '\tvcs.revision=' not in info,'original BuildInfo path/toolchain or VCS provenance differs')
        buildinfo=commands[label+'-buildinfo']
        require(buildinfo['exitCode']==0 and buildinfo['firstCause'] is None and buildinfo['ownedProcessGroupRemaining']==[] and buildinfo['argv']==[arm['build']['argv'][0],'version','-m',arm['binary']['path']] and buildinfo['stdout']==arm['buildInfo'],'original BuildInfo invocation/exit differs')
        for phase in ('build','replay'):
            command=arm[phase];require(command==commands[label+'-'+phase] and command['exitCode']==0 and type(command['exitCode']) is int and command['firstCause'] is None and command['ownedProcessGroupRemaining']==[] and command['cwd']==str(root),'original independent normal command/exit differs')
            for stream in ('stdout','stderr'):file(command[stream],128<<10)
        require(arm['build']['argv'][1:]==['build',*h['sameFlags'],'-o',arm['binary']['path'],'./cmd/ynx-consensus-pq-lab'],'original normal binary build argv differs')
        require(arm['replay']['argv']==[arm['binary']['path'],'finalize-trace','replay','--synthetic','--trace',trace['directory'],'--trace-sha256',trace['resultSHA256'],'--output',arm['outputDirectory']],'original normal replay argv/immutable trace differs')
        require(io.strict(io.read_original(Path(arm['replay']['stdout']['path']),128<<10))==io.strict(io.read_original(Path(arm['outputDirectory'])/'result.json',64<<10)),'original normal stdout and durable receipt differ')
        for ref in arm['outputFiles']:file(ref,8<<20)
        outputs[label]=read_bundle(Path(arm['outputDirectory']),h['perfInputs'][label+'ReplayReceipt']['sha256'],'replay')
        arms[label]=dict(source=source,binary=arm['binary'],buildInfo=arm['buildInfo'],build=arm['build'],replay=arm['replay'],embeddedVCSRevision=None,sourceProvenance='external original archive/Git-blob inventory, not embedded VCS')
        sources[label]=rows
    require(h['arms']['before']['binary']['path']!=h['arms']['after']['binary']['path'] and h['arms']['before']['binary']['sha256']!=h['arms']['after']['binary']['sha256'] and outputs['before']['directory']!=outputs['after']['directory'],'two independent original binaries/replay directories required')
    require(outputs['before']['resultSHA256']==outputs['after']['resultSHA256'],'complete original normal replay receipts differ')
    require(len(h['sameCallerOverlayFiles'])==5 and all(sources['before'][r['path']]['sha256']==sources['after'][r['path']]['sha256']==r['sha256'] and sources['before'][r['path']]['gitBlob']==sources['after'][r['path']]['gitBlob']==r['gitBlob'] for r in h['sameCallerOverlayFiles']),'exact same controlled five-blob replay caller required')
    for name in ('go.mod','go.sum'):require(sources['before'][name]['sha256']==sources['after'][name]['sha256'],'original paired module descriptors differ')
    provenance=dict(schema='YNX-PERF-INDEPENDENT-SEMANTIC-EXECUTION-READBACK/v1',originalH=dict(path=str(path),sha256=pin,bytes=len(raw)),arms=arms,verifiedFiles=len({v['path'] for v in verified}),verifiedFileReadChecks=len(verified),filePins=verified,beforeProductionBase=h['beforeProductionBase'],beforeComposedCommit=h['beforeComposedCommit'],afterCommit=h['afterCommit'],controlledCallerOverlayExplicit=True,performanceMeasured=False,liveNetworkExecuted=False)
    return OriginalExecution(trace['resultSHA256'],provenance,outputs['before'],outputs['after'])
