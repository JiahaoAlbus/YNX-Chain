#!/usr/bin/env python3
"""Pure catalog/observer/collector controls. These do not execute Go or proofs."""
import contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,re,select,signal,subprocess,sys,tempfile,time,types,unittest
from unittest import mock
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('diagnostic',HERE/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PKG='github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-proof-verify'
TOP='TestProofClosure435829HistoricalOriginal'
STAGES=['migration.read','migration.strictShape','migration.typedRead','bootstrap.validate','schedule.validate','state.sourceConstruction','state.committedAuthority','trust.lightBlockDecode','request.trustContextDecode','request.proofDecode','trust.load','transaction.verify','light.block','light.successor']

def exact_action_pins(block):
 expected={'actions/checkout':'3d3c42e5aac5ba805825da76410c181273ba90b1','actions/setup-go':'b7ad1dad31e06c5925ef5d2fc7ad053ef454303e','actions/upload-artifact':'ea165f8d65b6e75b540449e92b4886f43607fa02'}
 entries=re.findall(r'uses: ([^\s@]+)@([^\s]+)',block)
 assert len(entries)==4
 assert [name for name,pin in entries]==['actions/checkout','actions/checkout','actions/setup-go','actions/upload-artifact']
 for name,pin in entries:assert re.fullmatch('[0-9a-f]{40}',pin) and pin==expected[name]

def rows():
 r=[dict(Action='start',Package=PKG),dict(Action='run',Package=PKG,Test=TOP)]
 for stage in STAGES:
  for event in ['BEGIN','END']:
   msg=dict(version='YNX-PROOF-CLOSURE-OFFLINE-OBSERVATION/v1',component='consensus' if stage.startswith('light.') else 'main',stage=stage,event=event,elapsedNs=1,rejected=False,allocatedBytes=2,heapAllocBytes=3,heapInuseBytes=4,peakRSSBytes=5,peakRSSAvailable=True)
   r.append(dict(Action='output',Package=PKG,Test=TOP,Output=json.dumps(msg,separators=(',',':'))+'\n'))
 r += [dict(Action='pass',Package=PKG,Test=TOP),dict(Action='pass',Package=PKG)]
 return r

class Controls(unittest.TestCase):
 def test_optimization_exact_closed_source_before_and_after(self):
  manifest=json.loads((HERE/'OPTIMIZATION-SOURCE.json').read_text())
  controller=HERE.parents[2]
  for row in manifest['files']:
   raw=(controller/row['path']).read_bytes()
   self.assertEqual(len(raw),row['after']['bytes']);self.assertEqual(hashlib.sha256(raw).hexdigest(),row['after']['sha256'])
   self.assertEqual(hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),row['after']['gitBlob'])
  for kind in ['valid','before','after','unexpected-path','missing','extra','new-already-exists','authority']:
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as d:
    case=pathlib.Path(d);source=case/'source';owner=case/'controller';source.mkdir();owner.mkdir()
    synthetic=copy.deepcopy(manifest)
    def pin(b):return dict(bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),gitBlob=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest())
    for i,row in enumerate(synthetic['files']):
     new=('PUBLIC after '+str(i)).encode();p=owner/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(new);row['after']=pin(new)
     if row['before'] is not None:
      old=('PUBLIC before '+str(i)).encode();p=source/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(old);row['before']=pin(old)
    if kind=='before':(source/synthetic['files'][0]['path']).write_bytes(b'changed')
    if kind=='after':(owner/synthetic['files'][0]['path']).write_bytes(b'changed')
    if kind=='unexpected-path':synthetic['files'][0]['path']='../outside'
    if kind=='missing':synthetic['files'].pop()
    if kind=='extra':synthetic['files'].append(copy.deepcopy(synthetic['files'][0]))
    if kind=='new-already-exists':(source/synthetic['files'][3]['path']).write_bytes(b'existing')
    if kind=='authority':synthetic['onlineFinalityQualified']=True
    if kind=='valid':self.assertEqual(len(m.prepare_optimization(case,source,owner,synthetic)['Replace']),6)
    else:
     with self.assertRaises(AssertionError):m.prepare_optimization(case,source,owner,synthetic)
     self.assertFalse((case/'OPTIMIZATION-OVERLAY.json').exists())
 def test_regression_collector_requires_all_original_runs_and_children(self):
  baseline=[]
  for package,names in m.OPTIMIZATION_REQUIRED.items():
   baseline.append(dict(Action='start',Package=package))
   for name in names:
    baseline.extend([dict(Action='run',Package=package,Test=name),dict(Action='run',Package=package,Test=name+'/PUBLIC-control'),dict(Action='pass',Package=package,Test=name+'/PUBLIC-control'),dict(Action='pass',Package=package,Test=name)])
   baseline.append(dict(Action='pass',Package=package))
  for kind in ['valid','missing','duplicate','foreign','child-fail','skip','early-package-end','build-middle']:
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as d:
    rows=copy.deepcopy(baseline)
    if kind=='missing':rows=[r for r in rows if r.get('Test')!=m.OPTIMIZATION_REQUIRED[next(iter(m.OPTIMIZATION_REQUIRED))][0]]
    if kind=='duplicate':rows.insert(2,copy.deepcopy(rows[1]))
    if kind=='foreign':rows[2]['Package']='foreign'
    if kind=='child-fail':rows[3]['Action']='fail'
    if kind=='skip':rows[3]['Action']='skip'
    if kind=='early-package-end':rows.insert(2,dict(Action='pass',Package=rows[0]['Package']))
    if kind=='build-middle':rows.insert(2,dict(Action='build-output',ImportPath=rows[0]['Package']+'.test',Output='diagnostic'))
    p=pathlib.Path(d)/'GO.jsonl';p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    if kind=='valid':self.assertEqual(m.collect_regressions(p)['topCount'],4)
    else:
     with self.assertRaises(AssertionError):m.collect_regressions(p)
 def test_comparison_keeps_original_budget_pins_and_complete_results(self):
  source=(HERE/'run.py').read_text();observer=(HERE/'make_observation_overlay.py').read_text()
  self.assertIn("assert binary_pin['sha256']==BINARY_SHA",source)
  self.assertLess(source.index("assert binary_pin['sha256']==BINARY_SHA"),source.index('prepare_optimization(case,source,controller,manifest)',source.index('def main():')))
  self.assertIn("(old/'NORMAL-CLI-RESULT.json').read_bytes()==(new/'NORMAL-CLI-RESULT.json').read_bytes()",source)
  self.assertIn("time.monotonic()-ADMISSION_STARTED>720",source);self.assertIn('rss>4<<30',source)
  self.assertIn("'-timeout=120s'",source);self.assertIn("YNX_PROOF_CLOSURE_VARIANT='original'",source)
  self.assertIn("VARIANT in ('original','prepared')",observer)
  self.assertIn("else:assert target.read_text()==expected",observer)
  self.assertIn('consensus.PreparePQEngineBootstrap(genesisRaw, pins, migration)',observer)
  self.assertIn('prepared.FileSource(c.StateFile, engine, runtime)',observer)
  workflow=(HERE.parents[2]/'.github/workflows/resource-market-ci.yml').read_text()
  for name in ['OPTIMIZATION-SOURCE.json','OPTIMIZATION-OVERLAY.json','OPTIMIZATION-REGRESSIONS.json','OPTIMIZATION-BINARY.json','OBSERVATION-OVERLAY-prepared.json','OBSERVATION-DELTA-prepared.json','COMPARISON-RESULT.json']:
   self.assertEqual(workflow.count('${{ runner.temp }}/proof-closure-435829-diagnostic/'+name),1)
 def supervised(self,script,sampler,seconds=2):
  original_popen=subprocess.Popen;children=[];queues={};observed=set()
  original_observer=m.child_exited
  def launch(argv,**kwargs):
   self.assertEqual(argv[:2],['taskset','--cpu-list'])
   child=original_popen(argv[3:],**kwargs);children.append(child)
   if sys.platform=='darwin':
    queue=select.kqueue();queues[child.pid]=queue
    queue.control([select.kevent(child.pid,filter=select.KQ_FILTER_PROC,flags=select.KQ_EV_ADD,fflags=select.KQ_NOTE_EXIT)],0,0)
   return child
  def observe(child):
   if sys.platform!='darwin':return original_observer(child)
   # Darwin control only: kqueue NOTE_EXIT, like Linux WNOWAIT, does not
   # reap the child. Production still strictly requires Linux/amd64.
   if queues[child.pid].control(None,1,0):observed.add(child.pid)
   return child.pid in observed
  with tempfile.TemporaryDirectory() as d:
   case=pathlib.Path(d);outcome=None
   try:
    with mock.patch.object(m.subprocess,'Popen',side_effect=launch),mock.patch.object(m,'owned',side_effect=sampler),mock.patch.object(m,'child_exited',side_effect=observe),mock.patch.object(m,'TERM_SECONDS',.15),mock.patch.object(m,'KILL_SECONDS',.3),mock.patch.object(m,'REAP_SECONDS',.3):
     try:outcome=m.bounded(case,'CONTROL',[sys.executable,'-I','-c',script],case,os.environ.copy(),seconds,[0,1])
     except RuntimeError:pass
    row=json.loads((case/'results/CONTROL.result.json').read_text())
    self.assertEqual(len(children),1);self.assertIsNotNone(children[0].returncode)
    return row,outcome
   finally:
    for child in children:
     if child.poll() is None:
      child.terminate()
      try:child.wait(timeout=2)
      except subprocess.TimeoutExpired:child.kill();child.wait(timeout=2)
    for queue in queues.values():queue.close()
 def test_owned_child_success_nonzero_and_no_unnecessary_signal(self):
  for status in [0,7]:
   with self.subTest(exit=status):
    row,outcome=self.supervised('raise SystemExit('+str(status)+')',lambda pid:[])
    self.assertEqual(row['exitCode'],status);self.assertTrue(row['childReaped']);self.assertTrue(row['ownedGone'])
    self.assertEqual(row['cleanupSignals'],[]);self.assertEqual(row['cleanupErrors'],[])
    self.assertEqual(row['firstCause'],None if status==0 else 'CHILD_EXIT_NONZERO')
    self.assertEqual(outcome is not None,status==0)
 def test_bound_term_ignored_requires_kill_then_reap(self):
  row,outcome=self.supervised('import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)',lambda pid:[],seconds=.3)
  self.assertIsNone(outcome);self.assertEqual(row['firstCause'],'WALL_BOUND')
  self.assertEqual(row['cleanupSignals'],['SIGTERM','SIGKILL'])
  self.assertEqual(row['exitCode'],-signal.SIGKILL);self.assertTrue(row['ownedGone']);self.assertTrue(row['childReaped'])
 def test_cancel_and_persistent_sampler_failure_keep_first_cause(self):
  for error in [KeyboardInterrupt(),IndexError('do not publish this text')]:
   with self.subTest(kind=type(error).__name__):
    def broken(pid):raise error
    row,outcome=self.supervised('import time; time.sleep(30)',broken)
    self.assertIsNone(outcome);self.assertEqual(row['firstCause'],'SUPERVISION_EXCEPTION')
    self.assertEqual(row['firstCauseType'],type(error).__name__)
    self.assertTrue(row['childReaped']);self.assertFalse(row['ownedGone'])
    self.assertIn('OWNED_SAMPLE_UNAVAILABLE',row['cleanupErrors'])
    self.assertNotIn('do not publish',json.dumps(row))
 def test_owned_start_ticks_change_refused_and_cleanup_retained(self):
  count=0
  def sampler(pid):
   nonlocal count
   count+=1;return [(pid,100 if count==1 else 101,1)]
  row,outcome=self.supervised('import time; time.sleep(30)',sampler)
  self.assertIsNone(outcome);self.assertEqual(row['firstCause'],'SUPERVISION_EXCEPTION')
  self.assertEqual(row['firstCauseType'],'ValueError');self.assertTrue(row['childReaped']);self.assertFalse(row['ownedGone'])
 def test_launch_failure_also_records_result(self):
  with tempfile.TemporaryDirectory() as d:
   case=pathlib.Path(d)
   with mock.patch.object(m.subprocess,'Popen',side_effect=OSError('private launch detail')):
    with self.assertRaises(RuntimeError):m.bounded(case,'LAUNCH',['unused'],case,{},1,[0,1])
   row=json.loads((case/'results/LAUNCH.result.json').read_text())
   self.assertEqual(row['firstCause'],'SUPERVISION_EXCEPTION');self.assertEqual(row['firstCauseType'],'OSError')
   self.assertIsNone(row['exitCode']);self.assertFalse(row['childReaped']);self.assertTrue(row['ownedGone'])
   self.assertNotIn('private launch detail',json.dumps(row))
 def test_waitid_keeps_original_child_unreaped_until_cleanup(self):
  child=types.SimpleNamespace(pid=12345,returncode=None)
  # API arguments are checked even on Darwin, where the native Linux API
  # is unavailable. The real Linux job will use this exact implementation.
  with contextlib.ExitStack() as stack:
   for name,value in [('P_PID',1),('WEXITED',4),('WNOHANG',1),('WNOWAIT',0x1000000)]:stack.enter_context(mock.patch.object(m.os,name,value,create=True))
   wait=stack.enter_context(mock.patch.object(m.os,'waitid',return_value=None,create=True))
   self.assertFalse(m.child_exited(child));wait.assert_called_once_with(1,12345,0x1000005)
   wait.return_value=object();self.assertTrue(m.child_exited(child))
   child.returncode=0
   with self.assertRaises(RuntimeError):m.child_exited(child)
 def test_lost_child_reservation_cannot_signal_reused_session(self):
  child=types.SimpleNamespace(pid=12345,returncode=None,wait=mock.Mock(return_value=0))
  with tempfile.TemporaryDirectory() as d:
   case=pathlib.Path(d)
   with mock.patch.object(m.subprocess,'Popen',return_value=child),mock.patch.object(m,'child_exited',side_effect=ChildProcessError()),mock.patch.object(m,'owned',return_value=[]),mock.patch.object(m.os,'killpg') as kill,mock.patch.object(m.os,'getsid') as getsid,mock.patch.object(m,'TERM_SECONDS',0),mock.patch.object(m,'KILL_SECONDS',0):
    with self.assertRaises(RuntimeError):m.bounded(case,'RESERVATION',['unused'],case,{},1,[0,1])
   kill.assert_not_called();getsid.assert_not_called()
   child.wait.assert_called_once_with(timeout=m.REAP_SECONDS)
   row=json.loads((case/'results/RESERVATION.result.json').read_text())
   self.assertEqual(row['firstCauseType'],'ChildProcessError')
   self.assertFalse(row['childReaped']);self.assertFalse(row['ownedGone'])
   self.assertIn('OWNED_SESSION_RESERVATION_UNCONFIRMED',row['cleanupErrors'])
 def test_proc_stat_empty_disappearance_and_nonempty_identity_refusal(self):
  fields=['S','1','77','77']+['0']*18;fields[19]='123';fields[21]='2'
  raw='77 (command with ) parentheses) '+' '.join(fields)+'\n'
  with mock.patch.object(m.pathlib.Path,'open',return_value=io.StringIO(raw)):
   self.assertEqual(m.proc_row(77),(77,123,2*os.sysconf('SC_PAGE_SIZE')))
  for bad in ['',raw.replace('77 (','78 (',1),'77 (bad) S',raw.replace(' 123 ',' invalid '),raw.replace('S 1 77 77','S 1 77 -1'),raw+'x'*65536]:
   with self.subTest(kind=bad[:24]),mock.patch.object(m.pathlib.Path,'open',return_value=io.StringIO(bad)),mock.patch.object(m.pathlib.Path,'stat',return_value=object()):
    with self.assertRaises(ValueError):m.proc_row(77)
  with mock.patch.object(m.pathlib.Path,'open',return_value=io.StringIO('')),mock.patch.object(m.pathlib.Path,'stat',side_effect=FileNotFoundError()):self.assertIsNone(m.proc_row(77))
  with mock.patch.object(m.pathlib.Path,'open',return_value=io.StringIO('')),mock.patch.object(m.pathlib.Path,'stat',side_effect=PermissionError()):
   with self.assertRaises(PermissionError):m.proc_row(77)
  for error in [FileNotFoundError(),ProcessLookupError()]:
   with mock.patch.object(m.pathlib.Path,'open',side_effect=error):self.assertIsNone(m.proc_row(77))
 def test_unobserved_session_debt_never_qualifies(self):
  row,outcome=self.supervised('raise SystemExit(0)',lambda pid:[(pid+1,123,1)])
  self.assertIsNone(outcome);self.assertEqual(row['firstCause'],'OWNED_PROCESS_DEBT')
  self.assertTrue(row['childReaped']);self.assertFalse(row['ownedGone'])
  self.assertIn('OWNED_DRAIN_UNCONFIRMED',row['cleanupErrors'])
 def test_sampling_exception_reaps_original_child_and_records_firstcause(self):
  # Same injected sampler failure as the original Perf review. The child is
  # real; on Darwin only taskset and non-consuming Linux exit observation are
  # substituted. This is not evidence of Linux affinity or a real proc race.
  original_popen=subprocess.Popen;children=[]
  def launch(argv,**kwargs):
   self.assertEqual(argv[:2],['taskset','--cpu-list'])
   child=original_popen(argv[3:],**kwargs);children.append(child);return child
  with tempfile.TemporaryDirectory() as d:
   case=pathlib.Path(d)
   try:
    with mock.patch.object(m.subprocess,'Popen',side_effect=launch),mock.patch.object(m,'owned',side_effect=IndexError('terminal empty proc stat')),mock.patch.object(m,'child_exited',side_effect=lambda p:p.poll() is not None,create=True):
     with self.assertRaises(Exception):m.bounded(case,'SAMPLER',[sys.executable,'-I','-c','import time; time.sleep(30)'],case,os.environ.copy(),5,[0,1])
    self.assertEqual(len(children),1)
    self.assertIsNotNone(children[0].returncode,'runner returned without reaping its child')
    row=json.loads((case/'results/SAMPLER.result.json').read_text())
    self.assertEqual(row['firstCause'],'SUPERVISION_EXCEPTION')
    self.assertEqual(row['firstCauseType'],'IndexError')
    self.assertTrue(row['childReaped'])
    self.assertFalse(row['ownedGone'])
    self.assertIn('OWNED_SAMPLE_UNAVAILABLE',row['cleanupErrors'])
    self.assertNotIn('terminal empty proc stat',json.dumps(row))
   finally:
    # Reviewer safety only: the RED must not leak the old runner's child.
    for child in children:
     if child.poll() is None:
      child.terminate()
      try:child.wait(timeout=2)
      except subprocess.TimeoutExpired:child.kill();child.wait(timeout=2)
 def test_actionpins_exact_original_commits(self):
  workflow=HERE.parents[2]/'.github/workflows/resource-market-ci.yml'
  block=workflow.read_text().split('  proof-closure-435829-evidence:\n')[1]
  exact_action_pins(block)
 def test_actionpin_mutations_rejected(self):
  workflow=HERE.parents[2]/'.github/workflows/resource-market-ci.yml'
  block=workflow.read_text().split('  proof-closure-435829-evidence:\n')[1]
  original='b7ad1dad31e06c5925ef5d2fc7ad053ef454303e'
  for bad in ['b7ad1dad31e06c5925d2fc7ad053ef454303e','0'*40,'v6',original.upper(),original+'0']:
   with self.subTest(pin=bad):
    with self.assertRaises(AssertionError):exact_action_pins(block.replace(original,bad))
 def feed(self,r):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'GO.jsonl';p.write_text(''.join(json.dumps(x)+'\n' for x in r));return m.collect(p)
 def test_complete_synthetic_collector_control(self):
  self.assertEqual(len(self.feed(rows())),28)
 def test_required_run_pass_and_package(self):
  for index in [1,-1,-2]:
   with self.subTest(index=index):
    r=rows();r.pop(index)
    with self.assertRaises(AssertionError):self.feed(r)
 def test_skip_failure_duplicate_foreign_are_rejected(self):
  for change in ['skip','fail','duplicate','foreign','child']:
   with self.subTest(change=change):
    r=rows()
    if change in ['skip','fail']:r[-2]['Action']=change
    elif change=='duplicate':r.append(copy.deepcopy(r[-2]))
    elif change=='foreign':r[2]['Package']='foreign/package'
    else:r[2]['Test']=TOP+'/unexpected'
    with self.assertRaises(AssertionError):self.feed(r)
 def test_stage_missing_duplicate_rejected(self):
  for change in ['missing','duplicate','rejected','unknown','order']:
   with self.subTest(change=change):
    r=rows()
    if change=='missing':r.pop(3)
    elif change=='duplicate':r.insert(3,copy.deepcopy(r[3]))
    elif change=='order':r[2],r[3]=r[3],r[2]
    else:
     e=json.loads(r[3]['Output']);e['rejected']=change=='rejected'
     if change=='unknown':e['stage']='invented'
     r[3]['Output']=json.dumps(e,separators=(',',':'))+'\n'
    with self.assertRaises(AssertionError):self.feed(r)
 def test_build_prefix_exactshape_only(self):
  good=dict(Action='build-output',ImportPath=PKG+'.test',Output='public compiler diagnostic\n')
  self.assertEqual(len(self.feed([good]+rows())),28)
  for change in ['foreign','package','extra','middle','empty','failure']:
   with self.subTest(change=change):
    b=copy.deepcopy(good);r=rows()
    if change=='foreign':b['ImportPath']='foreign.test'
    elif change=='package':b['Package']=b.pop('ImportPath')
    elif change=='extra':b['Test']=TOP
    elif change=='empty':b['Output']=''
    elif change=='failure':b['Action']='build-fail'
    if change=='middle':r.insert(2,b)
    else:r.insert(0,b)
    with self.assertRaises(AssertionError):self.feed(r)
 def test_original_clock_and_platform_are_fixed(self):
  raw=(HERE/'ORIGINAL-JOB.json').read_bytes()
  self.assertEqual(hashlib.sha256(raw).hexdigest(),'d1dbab37536379753efcfdc78ea03a0efd5a9e75a6965c3bbcaf912e12e8de40')
  self.assertEqual(json.loads(raw)['completed_at'],'2026-11-14T10:06:52Z')
  test=(HERE/'proof_closure_diagnostic_test.go').read_text()
  self.assertTrue(test.startswith('//go:build linux && amd64 && ynx_proof_closure_diagnostic'))
  self.assertIn('run([]string{"--trust-context", context.OriginalAbsolutePath',test)
  self.assertNotIn('portableContextPaths(',test)
  self.assertNotIn('KeyGen(',test)
  self.assertNotIn('Node.Start',test)
 def test_observation_no_extra_fields_or_unknown_peak(self):
  for change in ['extra','type','peak','component']:
   with self.subTest(change=change):
    r=rows();e=json.loads(r[3]['Output'])
    if change=='extra':e['error']='forbidden raw error'
    elif change=='type':e['elapsedNs']=True
    elif change=='peak':e['peakRSSAvailable']=False
    else:e['component']='other'
    r[3]['Output']=json.dumps(e,separators=(',',':'))+'\n'
    with self.assertRaises(AssertionError):self.feed(r)
 def test_workflow_fixed_one_job_route_and_old_jobs_unchanged(self):
  workflow=HERE.parents[2]/'.github/workflows/resource-market-ci.yml'
  text=workflow.read_text()
  marker='  proof-closure-435829-evidence:\n'
  self.assertEqual(text.count(marker),1)
  block=text.split(marker)[1]
  self.assertIn("inputs.candidate_sha == ''",block)
  self.assertIn("inputs.proof_closure_435829_controller_sha == github.sha",block)
  self.assertIn("github.ref == 'refs/heads/codex/ynx-pq-perf-integration'",block)
  self.assertIn('timeout-minutes: 15',block)
  self.assertIn('cancel-in-progress: false',block)
  self.assertIn("go-version: '1.26.11'",block)
  self.assertIn('ref: 763b7f8f422f38f39e747a4f7f6cfb6405a0b96d',block)
  flags=['paired_n1','consensus_e2e','consensus_e2e_retained_history','consensus_remote_e2e_retained_history','consensus_fresh_paired_business','remote_signer_process']
  for flag in flags:self.assertIn('!inputs.'+flag,block)
  # Exact truth table for the new dispatch route. Empty candidate_sha also
  # leaves the original integration focused-go dispatch predicate false.
  actual=next(line.strip()[4:] for line in block.splitlines() if line.startswith('    if:'))
  expected="github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/codex/ynx-pq-perf-integration' && inputs.proof_closure_435829_controller_sha == github.sha && inputs.candidate_sha == ''"+''.join(' && !inputs.'+flag for flag in flags)
  self.assertEqual(actual,expected)
  expression=actual.replace('&&','and').replace('!','not ')
  def route(event='workflow_dispatch',ref='refs/heads/codex/ynx-pq-perf-integration',pin='same',candidate='',active=False):
   values={flag:active for flag in flags};values.update(proof_closure_435829_controller_sha=pin,candidate_sha=candidate)
   return eval(expression,{'__builtins__':{}},{'github':types.SimpleNamespace(event_name=event,ref=ref,sha='same'),'inputs':types.SimpleNamespace(**values)})
  self.assertTrue(route())
  for event in ['push','pull_request']:self.assertFalse(route(event=event))
  for ref in ['refs/heads/main','refs/heads/codex/ynx-pq-public-upgrade','refs/heads/codex/ynx-pq-remote-test']:self.assertFalse(route(ref=ref))
  self.assertFalse(route(pin='wrong'));self.assertFalse(route(candidate='same'));self.assertFalse(route(active=True))
 def test_wrong_platform_refuses_before_any_process_or_file(self):
  with mock.patch.object(m.platform,'system',return_value='Darwin'),mock.patch.object(m.sys,'argv',['run.py','--source-root','/unused','--case','/unused']),mock.patch.object(m.subprocess,'check_output') as process,mock.patch.object(m.pathlib.Path,'mkdir') as mkdir:
   with self.assertRaisesRegex(AssertionError,'Linux amd64 only'):m.main()
   process.assert_not_called();mkdir.assert_not_called()

if __name__=='__main__':unittest.main()
