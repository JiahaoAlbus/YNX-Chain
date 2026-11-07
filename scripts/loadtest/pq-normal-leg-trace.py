"""Consume one normal leg's original stopped export closure; no execution.

This verifies complete retained DATA and original runtime-reported identities.
It does not independently rehash an unuploaded runtime binary, reverify crypto,
turn the last unbound checkpoint into finality, or authorize a paired window.
"""
import hashlib,importlib.util,json
from pathlib import Path

HERE=Path(__file__).resolve().parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def require(ok,message):
    if not ok:raise RuntimeError(message)

def source_qualification():return module('leg_trace_source_data','pq-lossless-source-data.py').component_qualification()

def read(public,receipt,stopped_state_bytes,original):
    exported=receipt.get('completeFinalizeTrace')
    if exported is None:return dict(status='NOT_SUPPLIED',completePerLegTraceDataVerified=False,normalLiveChainCoverageQualified=False)
    io=module('leg_trace_original_public_io','pq-public-proof-readback.py')
    normal=module('leg_trace_normal_exit','pq-normal-process-lab.py')
    require(normal.normal_node_clean_exit(receipt['processes'])['allEightExitZero'],'original eight normal exit0 required for stopped trace closure')
    q=source_qualification();source=receipt['source']
    require(source==dict(commit=q['source'],tree=q['sourceTree'],forkTree='54e88e6aba735eaceeb2d00bb40731248c673bd7') and exported['source']==q['source'],'original leg source differs from own qualified source tuple')
    require(exported['schema']=='YNX-PERF-STOPPED-NORMAL-TRACE-EXPORT/v1' and exported['normalLiveChainCoverageQualified'] is False and exported['pressureAuthorized'] is False,'original stopped trace DATA scope differs')
    def data(name,limit=64<<10):return io.strict(original(name,limit))
    intent=data('finalize-trace-export-intent.json');returned=data('finalize-trace-export-return.json');created=data('create-original.log',1<<20)
    require(intent['version']=='YNX-PERF-ORIGINAL-TRACE-EXPORT-INTENT/v1' and intent['status']=='RESULT_UNKNOWN_NO_RETRY' and intent['source']==q['source'],'original one-shot export intent differs')
    require(returned['status']=='RETURNED_ORIGINAL_DATA' and returned['errorType'] is None and returned['noRetry'] is True and type(returned['startedMonotonicNs']) is int and type(returned['returnedMonotonicNs']) is int and 0<=returned['startedMonotonicNs']<=returned['returnedMonotonicNs'],'original export return absent/failed; no replay or backfill')
    state_pin=hashlib.sha256(stopped_state_bytes).hexdigest();state=io.strict(stopped_state_bytes)
    require(state_pin==receipt['allFourStoppedStateSHA256']==intent['allFourStoppedStateSHA256']==exported['allFourStoppedStateSHA256'] and intent['checkpointHeight']==state['height'] and intent['checkpointAppHash']==state['appHash'],'original complete stopped state or export checkpoint differs')
    build=receipt['normalLiveBuildSource'];selection_ref=build['originalCoreSelection'];selection_raw=original('normal-live-source-selection.json',64<<10);selection=io.strict(selection_raw)
    require(hashlib.sha256(selection_raw).hexdigest()==selection_ref['receiptSHA256'] and len(selection_raw)==selection_ref['receiptBytes'] and selection==selection_ref['sourceSelection'],'original normal source selection copies differ')
    require(selection['originalSourceCommit']==q['source'] and selection['originalSourceTree']==q['sourceTree'] and selection['selectedOptionalForkCommit']==q['supplierCommit'] and selection['selectedOptionalForkTree']==q['supplierTree'] and selection['buildTags']==['ynx_live_wire_observation','ynx_lossless_hex'] and selection['sourceOnly'] is True and all(selection[k] is False for k in ('nodeStarted','carrierEnabled','fakeVCSIdentity','originalModuleDescriptorsChanged','originalCheckoutWritten')),'original selected paired source scope differs')
    provenance=receipt['normalLiveBuildProvenance'];runtime=module('leg_trace_build_commands','pq-normal-paired-runtime.py');binary_paths={}
    def child(name):
        rows=[row for row in receipt['processes'] if row['name']==name]
        require(len(rows)==1 and rows[0]['exited'] is True and rows[0]['rawReturnCode']==rows[0]['exitCode']==0 and type(rows[0]['rawReturnCode']) is int and type(rows[0]['exitCode']) is int and rows[0]['signal'] is None,'original supervised child exit0 required: '+name)
        return rows[0]
    for name in ('ynx-comet','ynx-consensus-pq-lab','ynx-consensus-proof-verify'):
        p=provenance[name];build_child=child('build-'+name);argv=build_child['command'];require(argv.count('-o')==1,'one original build output required');binary=Path(argv[argv.index('-o')+1]);binary_paths[name]=str(binary)
        require(argv==runtime.build_commands(binary.parent)[name]==p['buildArgv'] and p['buildCwd']==build['buildSource'] and p['binarySHA256']==receipt['binaries'][name] and p['sourceSelectionSHA256']==selection_ref['receiptSHA256'] and p['originalSource']==source and p['selectedOptionalForkTree']==q['supplierTree'],'original normal binary build/source provenance differs')
        name_file=p['buildInfoFile'];require(Path(name_file).name==name_file,'closed original BuildInfo file required');raw=original(name_file,64<<10)
        require(hashlib.sha256(raw).hexdigest()==p['buildInfoSHA256'] and raw.decode().startswith(str(binary)+': ') and '\tvcs.revision=' not in raw.decode(),'original runtime BuildInfo bytes/identity differ')
    require(exported['binary']==provenance['ynx-consensus-pq-lab'] and intent['binarySHA256']==receipt['binaries']['ynx-consensus-pq-lab'],'original trace callee binary identity differs')
    trace_reader=module('leg_trace_complete_reader','pq-finalize-trace-readback.py');reported=exported['originalTrace'];trace=trace_reader.read_bundle(Path(public)/'complete-finalize-trace',reported['resultSHA256'],'trace')
    require(trace['originalResult']==reported['originalResult'] and trace['files']==reported['files'],'original exported trace file/result copies differ')
    require(trace['firstHeight']==int(created['plan']['initialHeight']) and created['planSHA256']==receipt['originalPlanSHA256'] and trace['lastHeight']==state['height'] and trace['originalResult']['engineAppHash']==state['appHash'],'complete original live-leg height denominator/checkpoint differs')
    require(trace['_final']==stopped_state_bytes,'original complete canonical final trace state and proof export bytes differ; no normalization')
    args=intent['args'];expected=['finalize-trace','export','--synthetic','--root',created['plan']['rootDir'],'--plan-sha256',created['planSHA256'],'--activation-sha256',trace['originalResult']['activationSHA256'],'--height',str(state['height']),'--app-hash',state['appHash'],'--output',reported['directory']]
    require(args==expected and trace['originalResult']['planSHA256']==created['planSHA256'],'original stopped trace argv/independent pins differ')
    export_child=child('normal-finalize-trace-export');require(export_child['command']==[binary_paths['ynx-consensus-pq-lab'],*args] and type(export_child.get('pid')) is int and type(export_child.get('startTicks')) is int,'original trace callee argv/PID/start identity differs')
    require(len(returned['originalProcess'])==1 and all(returned['originalProcess'][0].get(key)==export_child.get(key) for key in ('name','pid','startTicks','rawReturnCode','exitCode','signal','exited','command')),'original trace return and final process receipt differ')
    reply=data('normal-finalize-trace-export.log',64<<10);require(reply==trace['originalResult'],'original normal export stdout/durable result differs')
    return dict(status='ORIGINAL_NORMAL_LEG_TRACE_DATA_MATCHED',completePerLegTraceDataVerified=True,normalLiveChainCoverageQualified=False,source=source,originalTrace=trace_reader.public(trace),sourceOnlyCI=q,originalExportProcess=returned['originalProcess'][0],originalCallerElapsedNs=returned['returnedMonotonicNs']-returned['startedMonotonicNs'],allFourStoppedStateSHA256=state_pin,lastExecutionSuccessorBound=trace['records'][-1]['executionSuccessorBound'],runtimeBinaryHashesReportedByOriginalProcess=True,runtimeBinaryFilesRehashedByThisReader=False,independentCryptographyReverified=False,pressureAuthorized=False)
