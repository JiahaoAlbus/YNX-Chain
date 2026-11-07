"""Normal leg trace original DATA closure controls; no Go or node execution."""
import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest import mock

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=module('leg_trace_controls','pq-normal-leg-trace.py');trace=module('leg_complete_trace_controls','pq-finalize-trace-readback.py');factory=module('leg_trace_data_fixture','test_pq_finalize_trace_readback.py');runtime=module('leg_trace_runtime_commands','pq-normal-paired-runtime.py')
def raw(v):return json.dumps(v,separators=(',',':')).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
Q=dict(source='c'*40,sourceTree='d'*40,supplierCommit='e'*40,supplierTree='f'*40)

def fixture(public):
 out=public/'complete-finalize-trace';factory.fixture(out);result=json.loads((out/'result.json').read_bytes());result.update(planSHA256='b'*64,activationSHA256='c'*64);(out/'result.json').write_bytes(raw(result));bundle=trace.read_bundle(out,sha(raw(result)),'trace');state=bundle['_final'];statepin=sha(state)
 source=dict(commit=Q['source'],tree=Q['sourceTree'],forkTree='54e88e6aba735eaceeb2d00bb40731248c673bd7')
 selection=dict(originalSourceCommit=Q['source'],originalSourceTree=Q['sourceTree'],selectedOptionalForkCommit=Q['supplierCommit'],selectedOptionalForkTree=Q['supplierTree'],buildTags=['ynx_live_wire_observation','ynx_lossless_hex'],sourceOnly=True,nodeStarted=False,carrierEnabled=False,fakeVCSIdentity=False,originalModuleDescriptorsChanged=False,originalCheckoutWritten=False);selectionraw=raw(selection)
 files={'normal-live-source-selection.json':selectionraw,'create-original.log':raw(dict(planSHA256='b'*64,plan=dict(initialHeight='1',rootDir='/original/network')))}
 processes=[dict(name=phase+'-node-'+str(i),pid=100+4*j+i,startTicks=1,rawReturnCode=0,exitCode=0,signal=None,exited=True) for j,phase in enumerate(('bootstrap','pq')) for i in range(4)];provenance={};binaries={}
 for i,(name,command) in enumerate(runtime.build_commands('/original/bin').items()):
  pin=str(i+1)*64;info=('/original/bin/'+name+': go1.26.10\n').encode();filename='buildinfo-'+name+'.log';files[filename]=info;binaries[name]=pin
  provenance[name]=dict(buildArgv=command,buildCwd='/original/build-source',binarySHA256=pin,sourceSelectionSHA256=sha(selectionraw),originalSource=source,selectedOptionalForkTree=Q['supplierTree'],buildInfoFile=filename,buildInfoSHA256=sha(info));processes.append(dict(name='build-'+name,pid=200+i,startTicks=1,command=command,rawReturnCode=0,exitCode=0,signal=None,exited=True))
 args=['finalize-trace','export','--synthetic','--root','/original/network','--plan-sha256','b'*64,'--activation-sha256','c'*64,'--height','2','--app-hash','a'*64,'--output',bundle['directory']]
 helper=dict(name='normal-finalize-trace-export',pid=300,startTicks=7,command=['/original/bin/ynx-consensus-pq-lab',*args],rawReturnCode=0,exitCode=0,signal=None,exited=True);processes.append(helper)
 files['finalize-trace-export-intent.json']=raw(dict(version='YNX-PERF-ORIGINAL-TRACE-EXPORT-INTENT/v1',status='RESULT_UNKNOWN_NO_RETRY',source=Q['source'],allFourStoppedStateSHA256=statepin,checkpointHeight=2,checkpointAppHash='a'*64,binarySHA256=binaries['ynx-consensus-pq-lab'],args=args))
 files['finalize-trace-export-return.json']=raw(dict(status='RETURNED_ORIGINAL_DATA',errorType=None,noRetry=True,startedMonotonicNs=100,returnedMonotonicNs=200,originalProcess=[copy.deepcopy(helper)]));files['normal-finalize-trace-export.log']=raw(result)
 exported=dict(schema='YNX-PERF-STOPPED-NORMAL-TRACE-EXPORT/v1',source=Q['source'],normalLiveChainCoverageQualified=False,pressureAuthorized=False,allFourStoppedStateSHA256=statepin,binary=provenance['ynx-consensus-pq-lab'],originalTrace=trace.public(bundle))
 receipt=dict(completeFinalizeTrace=exported,source=source,allFourStoppedStateSHA256=statepin,normalLiveBuildSource=dict(buildSource='/original/build-source',originalCoreSelection=dict(receiptSHA256=sha(selectionraw),receiptBytes=len(selectionraw),sourceSelection=selection)),normalLiveBuildProvenance=provenance,binaries=binaries,processes=processes,originalPlanSHA256='b'*64)
 return receipt,state,files

class NormalLegTraceControls(unittest.TestCase):
 def read(self,public,receipt,state,files):
  with mock.patch.object(m,'source_qualification',return_value=Q):return m.read(public,receipt,state,lambda name,limit:files[name])
 def test_absent_trace_preserves_legacy_leg_without_reading(self):
  r=m.read(Path('/not-read'),{},b'',mock.Mock(side_effect=AssertionError('read')));self.assertEqual(r['status'],'NOT_SUPPLIED');self.assertFalse(r['completePerLegTraceDataVerified'])
 def test_complete_original_data_reports_full_denominator_without_crypto_or_binary_rehash(self):
  with tempfile.TemporaryDirectory() as tmp:
   public=Path(tmp).resolve();receipt,state,files=fixture(public);r=self.read(public,receipt,state,files);self.assertTrue(r['completePerLegTraceDataVerified']);self.assertEqual(r['originalTrace']['retainedHeights'],2);self.assertEqual(r['originalCallerElapsedNs'],100);self.assertFalse(r['normalLiveChainCoverageQualified'] or r['runtimeBinaryFilesRehashedByThisReader'] or r['independentCryptographyReverified'] or r['pressureAuthorized'])
 def test_forced_node_exit_refuses_before_original_trace_file_reads(self):
  receipt=dict(completeFinalizeTrace={},processes=[])
  with self.assertRaisesRegex(RuntimeError,'eight normal exit0'):m.read(Path('/not-read'),receipt,b'',mock.Mock(side_effect=AssertionError('read')))
 def test_unknown_return_source_binary_argv_or_height_substitution_refused(self):
  for mode in ('unknown','source','binary','argv','height','startTicks'):
   with tempfile.TemporaryDirectory() as tmp:
    public=Path(tmp).resolve();receipt,state,files=fixture(public)
    if mode=='unknown':v=json.loads(files['finalize-trace-export-return.json']);v['status']='FAILED_OR_UNKNOWN';files['finalize-trace-export-return.json']=raw(v)
    elif mode=='source':receipt['source']['commit']='0'*40
    elif mode=='binary':receipt['binaries']['ynx-comet']='0'*64
    elif mode=='argv':receipt['processes'][-1]['command'][-1]='/other-output'
    elif mode=='startTicks':receipt['processes'][-1]['startTicks']=None
    else:v=json.loads(files['create-original.log']);v['plan']['initialHeight']='2';files['create-original.log']=raw(v)
    with self.subTest(mode=mode),self.assertRaises(RuntimeError):self.read(public,receipt,state,files)
 def test_same_apphash_cannot_hide_changed_complete_final_state_bytes(self):
  with tempfile.TemporaryDirectory() as tmp:
   public=Path(tmp).resolve();receipt,state,files=fixture(public);v=json.loads(state);v['history']='different';state=raw(v);receipt['allFourStoppedStateSHA256']=sha(state);receipt['completeFinalizeTrace']['allFourStoppedStateSHA256']=sha(state);intent=json.loads(files['finalize-trace-export-intent.json']);intent['allFourStoppedStateSHA256']=sha(state);files['finalize-trace-export-intent.json']=raw(intent)
   with self.assertRaisesRegex(RuntimeError,'no normalization'):self.read(public,receipt,state,files)
 def test_buildinfo_or_normal_stdout_tamper_is_not_accepted(self):
  for mode in ('buildinfo','stdout'):
   with tempfile.TemporaryDirectory() as tmp:
    public=Path(tmp).resolve();receipt,state,files=fixture(public)
    if mode=='buildinfo':files['buildinfo-ynx-comet.log']+=b'changed'
    else:v=json.loads(files['normal-finalize-trace-export.log']);v['normalizationApplied']=True;files['normal-finalize-trace-export.log']=raw(v)
    with self.subTest(mode=mode),self.assertRaises(RuntimeError):self.read(public,receipt,state,files)
if __name__=='__main__':unittest.main()
