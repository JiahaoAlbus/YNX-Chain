"""Attach qualified normal paired source/private reader and stopped trace export.

No Window, key, fixture, signer, store or admission is created here. The sole
normal controller owns the selected runtime window and legitimate common input.
"""
import hashlib,importlib.util,json
from pathlib import Path
import time

HERE=Path(__file__).resolve().parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def require(ok,message):
    if not ok:raise RuntimeError(message)

def build_commands(bins):
    return {name:['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false',*(['-tags','ynx_live_wire_observation,ynx_lossless_hex'] if name=='ynx-comet' else []),'-o',str(Path(bins)/name),'./cmd/'+name] for name in ('ynx-consensus-pq-lab','ynx-comet','ynx-consensus-proof-verify')}

def checked_context(c,composition,provenance,lab):
    q=module('paired_runtime_source_data','pq-lossless-source-data.py').component_qualification()
    identity=dict(commit=q['source'],tree=q['sourceTree'],forkTree='54e88e6aba735eaceeb2d00bb40731248c673bd7')
    require(composition.get('source')==identity and composition.get('originalSourceUnchanged') is True,'exact original paired source composition required')
    selection=composition['originalCoreSelection'];path=Path(selection['receiptPath']);raw=lab.guard.bounded(path,64<<10)
    require(hashlib.sha256(raw).hexdigest()==selection['receiptSHA256'] and len(raw)==selection['receiptBytes'] and json.loads(raw)==selection['sourceSelection'],'original paired source selection pin differs')
    receipt=selection['sourceSelection']
    require(receipt['originalSourceCommit']==q['source'] and receipt['originalSourceTree']==q['sourceTree'] and receipt['selectedOptionalForkCommit']==q['supplierCommit'] and receipt['selectedOptionalForkTree']==q['supplierTree'] and receipt['buildTags']==['ynx_live_wire_observation','ynx_lossless_hex'] and receipt['nodeStarted'] is False and receipt['carrierEnabled'] is False,'actual paired source selection scope differs')
    require(Path(c.w.source)==Path(composition['buildSource']) and c.observe_wire is True and c.mode=='online','original paired build cwd/online wire scope required')
    expected=build_commands(c.bins)
    for name,command in expected.items():
        require(name in provenance,'all original paired binary BuildInfo receipts required')
        p=provenance[name];children=[x for x in c.w.children if x['name']=='build-'+name]
        require(len(children)==1 and children[0]['process'].poll()==0 and children[0]['command']==command and p['buildArgv']==command and p['buildCwd']==str(c.w.source) and p['sourceSelectionSHA256']==selection['receiptSHA256'],'actual supervised normal build identity differs')
        require(lab.guard.digest(c.bins/name)==p['binarySHA256'],'actual paired normal binary SHA differs')
        info=Path(c.w.work)/'public'/p['buildInfoFile'];require(info.parent==Path(c.w.work)/'public' and lab.guard.digest(info)==p['buildInfoSHA256'],'original paired BuildInfo file pin differs')
        data=lab.guard.bounded(info,64<<10).decode();require(str(c.bins/name)+': ' in data and '\tvcs.revision=' not in data,'actual archive binary BuildInfo required without fabricated VCS')
    return q

class StoppedTraceExporter:
    def __init__(self,composition,provenance,lab):
        self.composition,self.provenance,self.lab=composition,provenance,lab;self.attempted=False
    def export(self,c):
        require(not self.attempted,'original stopped trace export already attempted; reconcile original result, never retry')
        q=checked_context(c,self.composition,self.provenance,self.lab)
        normal=module('paired_runtime_original_normal','pq-normal-process-lab.py')
        require(normal.normal_node_clean_exit(c.w.process_receipt())['allEightExitZero'],'all eight original node exits must be0 before normal trace export')
        require(c.nodes and len(c.nodes)==4 and all(p.poll()==0 for p in c.nodes),'original four PQ processes must be stopped normally')
        require(self.lab.guard.digest(c.root/'network-plan.json')==c.pin and self.lab.guard.digest(c.root/'activation/activation.json')==c.activation_pin,'independent original plan/activation pins differ')
        checkpoint=None;state_sha=None
        for node in c.plan['nodes']:
            c.w.sample();raw=self.lab.guard.bounded(Path(node['statePath']),128<<20);state=json.loads(raw);c.w.sample()
            point=(state['height'],state['appHash']);pin=hashlib.sha256(raw).hexdigest()
            require(type(point[0]) is int and point[0]>0 and state['initialized'] is True,'original stopped checkpoint required')
            if checkpoint is None:checkpoint,state_sha=point,pin
            require(point==checkpoint and pin==state_sha,'all four complete stopped original states must match')
        output=c.w.work/'public/complete-finalize-trace';intent=c.w.work/'public/finalize-trace-export-intent.json'
        args=['finalize-trace','export','--synthetic','--root',str(c.root),'--plan-sha256',c.pin,'--activation-sha256',c.activation_pin,'--height',str(checkpoint[0]),'--app-hash',checkpoint[1],'--output',str(output)]
        require(not output.exists() and not output.is_symlink(),'fresh trace output required; retain original partial/UNKNOWN')
        self.lab.write_new(intent,dict(version='YNX-PERF-ORIGINAL-TRACE-EXPORT-INTENT/v1',source=q['source'],binarySHA256=self.provenance['ynx-consensus-pq-lab']['binarySHA256'],args=args,status='RESULT_UNKNOWN_NO_RETRY',checkpointHeight=checkpoint[0],checkpointAppHash=checkpoint[1],allFourStoppedStateSHA256=state_sha))
        self.attempted=True;started=time.monotonic_ns();outcome='FAILED_OR_UNKNOWN';error_type=None;original_error=None
        try:
            reply=c.call('normal-finalize-trace-export',args)
            children=[row for row in c.w.children if row['name']=='normal-finalize-trace-export']
            require(len(children)==1 and children[0]['process'].poll()==0 and children[0]['command']==[str(c.bins/'ynx-consensus-pq-lab'),*args],'original supervised trace callee exit/argv missing')
            reader=module('paired_runtime_complete_trace_readback','pq-finalize-trace-readback.py');raw=reader.io.read_original(output/'result.json',64<<10)
            require(reader.io.strict(raw)==reply,'normal trace export stdout and durable original result differ')
            bundle=reader.read_bundle(output,reader.sha(raw),'trace')
            require(bundle['lastHeight']==checkpoint[0] and bundle['originalResult']['engineAppHash']==checkpoint[1],'original exported trace differs from stopped checkpoint')
            outcome='RETURNED_ORIGINAL_DATA'
            return dict(schema='YNX-PERF-STOPPED-NORMAL-TRACE-EXPORT/v1',source=q['source'],binary=self.provenance['ynx-consensus-pq-lab'],originalTrace=reader.public(bundle),allFourStoppedStateSHA256=state_sha,normalLiveChainCoverageQualified=False,pressureAuthorized=False)
        except BaseException as error:original_error=error;error_type=type(error).__name__;raise
        finally:
            try:self.lab.write_new(c.w.work/'public/finalize-trace-export-return.json',dict(status=outcome,errorType=error_type,startedMonotonicNs=started,returnedMonotonicNs=time.monotonic_ns(),originalProcess=[r for r in c.w.process_receipt() if r['name']=='normal-finalize-trace-export'],missingResultRemainsUnknown=True,noRetry=True))
            except BaseException as error:
                self.return_journal_error=dict(errorType=type(error).__name__)
                if original_error is None:raise

def attach(c,composition,provenance,arm,lab):
    require(arm in ('off','on'),'exact normal paired off/on arm required')
    q=checked_context(c,composition,provenance,lab)
    require(getattr(c,'live_reader',None) is None and not c.nodes and not getattr(c,'stopped_trace_export',None),'attach once before original bootstrap; do not replace a live reader')
    reader=module('paired_runtime_original_live_reader','pq-normal-live-reader.py')
    class PairedLiveReader(reader.NormalLiveReader):
        def validate_original_startup_arguments(self,args):
            require(not any(v=='--experimental-mempool-lossless-hex' or v.startswith('--experimental-mempool-lossless-hex=') for v in args),'original activation args must remain defaultOFF; paired optin is selected exactly once')
        def startup_arguments(self,phase,index):
            args=super().startup_arguments(phase,index)
            return args+(['--experimental-mempool-lossless-hex','on'] if phase=='pq' and arm=='on' else [])
    c.live_reader=PairedLiveReader(c,lab)
    exporter=StoppedTraceExporter(composition,provenance,lab);c.stopped_trace_export=lambda:exporter.export(c)
    c.network_profile=dict(source=q['source'],tools=lab.git(HERE.parents[1],'rev-parse','HEAD'))
    return dict(schema='YNX-PERF-NORMAL-PAIRED-ATTACHMENT/v1',source=q['source'],arm=arm,normalPrivateReaderPreserved=True,originalStoppedTraceExportAttached=True,runtimeWindowCreated=False,commonCanonicalFixtureQualified=False,pressureAuthorized=False)
