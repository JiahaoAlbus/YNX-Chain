#!/usr/bin/env python3
import copy, hashlib, importlib.util, json, os, pathlib, re, shutil, subprocess, sys, tempfile, types, unittest
from unittest import mock
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pair',HERE/'pair_run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=pathlib.Path(os.environ.get('YNX_PAIR_REPO', str(HERE.parents[2]))).resolve(strict=True)
class PairControls(unittest.TestCase):
 def test_source_pair_fails_closed_on_any_identity_or_delta_change(self):
  def fake(kind):
   def git(root,*args):
    side=str(root); a=tuple(args); commit=m.BEFORE if side=='before' else m.AFTER
    if a==('rev-parse','HEAD'):return (('0'*40 if kind=='commit' and side=='before' else commit)+'\n').encode()
    if a==('rev-parse','HEAD^{tree}'):return (('0'*40 if kind=='tree' and side=='after' else m.TREES[side])+'\n').encode()
    if a==('rev-parse','HEAD:third_party/cometbft'):return (('0'*40 if kind=='fork' and side=='after' else m.FORK)+'\n').encode()
    if a==('status','--porcelain','--untracked-files=normal'):return b' M changed\n' if kind=='dirty' and side=='after' else b''
    if a==('rev-parse',m.AFTER+'^'):return (('0'*40 if kind=='parent' else m.BEFORE)+'\n').encode()
    if a==('diff','--name-status',m.BEFORE,m.AFTER):
     rows=list(m.EXPECTED_DIFF)
     if kind=='missing':rows.pop()
     if kind=='extra':rows.append(('M','internal/unauthorized.go'))
     if kind=='mode':rows[0]=('M',rows[0][1])
     return ''.join(x+'\t'+p+'\n' for x,p in rows).encode()
    if len(a)==2 and a[0]=='show':return b'mismatched' if kind=='composer' and side=='after' and a[1].endswith('wire-live-matching-source-ci.py') else a[1].split(':',1)[1].encode()
    if a==('rev-parse',m.SUPPLIER+':third_party/cometbft'):return (('0'*40 if kind=='supplier' else m.SUPPLIER_TREE)+'\n').encode()
    raise AssertionError((side,a))
   return git
  original=m.git
  try:
   for kind in ['valid','commit','tree','fork','dirty','parent','missing','extra','mode','composer','supplier']:
    with self.subTest(kind=kind):
     m.git=fake(kind)
     if kind=='valid':self.assertEqual(m.verify_pair('before','after')['after'],m.AFTER)
     else:
      with self.assertRaises(AssertionError):m.verify_pair('before','after')
  finally:m.git=original
 def test_git_source_diff_and_parent_are_actual_fixed_commits(self):
  self.assertEqual(subprocess.check_output(['git','rev-parse',m.AFTER+'^'],cwd=ROOT,text=True).strip(),m.BEFORE)
  rows=subprocess.check_output(['git','diff','--name-status',m.BEFORE,m.AFTER],cwd=ROOT,text=True).splitlines()
  self.assertEqual(tuple(tuple(r.split('\t',1)) for r in rows),m.EXPECTED_DIFF)
  for side,commit in [('before',m.BEFORE),('after',m.AFTER)]:
   self.assertEqual(subprocess.check_output(['git','rev-parse',commit+'^{tree}'],cwd=ROOT,text=True).strip(),m.TREES[side])
   self.assertEqual(subprocess.check_output(['git','rev-parse',commit+':third_party/cometbft'],cwd=ROOT,text=True).strip(),m.FORK)
 def test_instrumentation_wraps_exact_both_sources_without_source_write(self):
  paths=['cmd/ynx-consensus-proof-verify/trust.go','cmd/ynx-consensus-proof-verify/transaction.go','internal/consensus/pq_transaction_proof.go']
  with tempfile.TemporaryDirectory() as t:
   case=pathlib.Path(t).resolve()
   for side,rev in [('before',m.BEFORE),('after',m.AFTER)]:
    source=case/('pair-'+side)/'source'
    for name in paths:
     path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(subprocess.check_output(['git','show',rev+':'+name],cwd=ROOT))
    before={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in paths}
    env=os.environ.copy();env.update(YNX_PROOF_CLOSURE_CASE=str(case),YNX_PROOF_AB_SIDE=side)
    subprocess.run(['/usr/bin/python3',str(HERE/'pair_observer.py')],check=True,env=env,capture_output=True)
    replacements=json.loads((case/('OBSERVATION-OVERLAY-'+side+'.json')).read_text())['Replace']
    self.assertEqual(set(replacements),{str(source/name) for name in paths})
    self.assertEqual(before,{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in paths})
    for path in replacements.values():
     subprocess.run([os.environ.get('YNX_PAIR_GOFMT', shutil.which('gofmt') or 'gofmt'),'-e',path],stdout=subprocess.DEVNULL,check=True)
 def test_harness_requires_original_closure_and_compares_complete_results(self):
  source=(HERE/'pair_run.py').read_text()
  for marker in ["SOURCE", "14108709609", "prepare.py", "restore_linux_originals.py", "m.collect(", "left.read_bytes()==right.read_bytes()", "original763Binary=False", "onlineFinalityQualified=False", "originalUnknownReplaced=False", "transactionReplayed=False", "nodeStarted=False", "outerSupervisorRequired=True", "YNX_PAIR_SUPERVISED"]:
   self.assertIn(marker,source)
 def test_phase_process_inherits_supervised_session_and_keeps_failure(self):
  with tempfile.TemporaryDirectory() as d:
   case=pathlib.Path(d)
   row=m.stage(case,'OK',[sys.executable,'-c','import os; print(os.getsid(0))'],case,os.environ.copy())
   self.assertEqual(row['exitCode'],0)
   self.assertEqual((case/'results/OK.stdout').read_text().strip(),str(os.getsid(0)))
   with self.assertRaises(RuntimeError):m.stage(case,'FAIL',[sys.executable,'-c','raise SystemExit(7)'],case,os.environ.copy())
   failed=json.loads((case/'results/FAIL.result.json').read_text());self.assertEqual(failed['firstCause'],'CHILD_EXIT_NONZERO');self.assertEqual(failed['exitCode'],7)
  source=(HERE/'pair_run.py').read_text();supervisor=(HERE/'pair_supervisor.py').read_text()
  self.assertNotIn('start_new_session=True',source);self.assertNotIn('m.bounded(',source)
  self.assertIn("m.bounded(case,'PAIR-WHOLE'",supervisor);self.assertIn('wholeDiagnosticSeconds=720',supervisor);self.assertIn('ownedRSSCapBytes=4<<30',supervisor)
 def test_admission_failure_is_durable_and_does_not_reuse_old_result(self):
  spec=importlib.util.spec_from_file_location('pair_supervisor',HERE/'pair_supervisor.py');supervisor=importlib.util.module_from_spec(spec);spec.loader.exec_module(supervisor)
  for existing in [False,True]:
   with self.subTest(existing=existing),tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d).resolve();case=root/'proof-pair-435829'
    if existing:
     (case/'results').mkdir(parents=True)
     (case/'results/PAIR-WHOLE.result.json').write_text('{"firstCause":"STALE_RESULT_MUST_NOT_BE_USED"}')
    args=['supervisor','--original-root','a','--before-root','b','--after-root','c','--case',str(case)]
    with mock.patch.dict(os.environ,{'RUNNER_TEMP':str(root)}),mock.patch.object(sys,'argv',args),mock.patch.object(supervisor.platform,'system',return_value='Darwin'):
     with self.assertRaises(SystemExit):supervisor.main()
    self.assertEqual(json.loads((root/'proof-pair-supervisor-start.json').read_text())['state'],'STARTED')
    row=json.loads((root/'proof-pair-supervisor-result.json').read_text())
    self.assertEqual(row['state'],'FAILED');self.assertEqual(row['firstCause'],'SUPERVISION_OR_ADMISSION_FAILURE');self.assertEqual(row['admissionPhase'],'case-admission' if existing else 'platform-admission');self.assertIsNone(row['supervision'])
 def test_outer_preserves_first_cause_and_cleanup_debt(self):
  spec=importlib.util.spec_from_file_location('pair_supervisor_control',HERE/'pair_supervisor.py');outer=importlib.util.module_from_spec(spec);spec.loader.exec_module(outer)
  fake=types.SimpleNamespace(ADMISSION_DISK_FREE=None,ADMISSION_STARTED=None)
  def fail(case,name,argv,cwd,env,seconds,cpus):
   self.assertEqual(name,'PAIR-WHOLE');self.assertEqual(seconds,720);self.assertEqual(env['YNX_PAIR_SUPERVISED'],'1')
   (case/'results').mkdir();(case/'PAIR-PHASES.jsonl').write_text('{"phase":"prepare-original-evidence"}\n');(case/'PAIR-CHILD-FAILURE.json').write_text('{"phase":"prepare-original-evidence","kind":"CalledProcessError"}');(case/'results/PAIR-WHOLE.result.json').write_text(json.dumps(dict(firstCause='OWNED_RSS_BOUND',firstCauseType=None,cleanupErrors=['OWNED_DRAIN_UNCONFIRMED'],ownedGone=False)))
   raise RuntimeError('preserve first cause')
  fake.bounded=fail
  original_read=pathlib.Path.read_text
  def read(path,*args,**kwargs):
   return 'MemAvailable: 99999999 kB\n' if str(path)=='/proc/meminfo' else original_read(path,*args,**kwargs)
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d).resolve();case=root/'proof-pair-435829';args=['supervisor','--original-root','a','--before-root','b','--after-root','c','--case',str(case)]
   with mock.patch.dict(os.environ,{'RUNNER_TEMP':str(root)}),mock.patch.object(sys,'argv',args),mock.patch.object(outer.platform,'system',return_value='Linux'),mock.patch.object(outer.platform,'machine',return_value='x86_64'),mock.patch.object(outer.os,'sched_getaffinity',return_value={0,1},create=True),mock.patch.object(outer.shutil,'disk_usage',return_value=types.SimpleNamespace(free=20<<30)),mock.patch.object(pathlib.Path,'read_text',read),mock.patch.object(outer.importlib.util,'spec_from_file_location',return_value=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda x:None))),mock.patch.object(outer.importlib.util,'module_from_spec',return_value=fake):
    with self.assertRaises(SystemExit):outer.main()
   result=json.loads((root/'proof-pair-supervisor-result.json').read_text())
   self.assertEqual(result['firstCause'],'OWNED_RSS_BOUND');self.assertEqual(result['childLastPhase'],'prepare-original-evidence');self.assertEqual(result['childFailure']['kind'],'CalledProcessError');self.assertFalse(result['supervision']['ownedGone']);self.assertEqual(result['supervision']['cleanupErrors'],['OWNED_DRAIN_UNCONFIRMED'])
 def test_child_failure_phase_and_safe_evidence_index(self):
  with tempfile.TemporaryDirectory() as d:
   case=pathlib.Path(d).resolve();env=os.environ.copy();env.update(YNX_PAIR_SUPERVISED='1',YNX_PAIR_PHASE_ROOT=str(case))
   result=subprocess.run([sys.executable,str(HERE/'pair_run.py'),'--original-root',str(case/'missing'),'--before-root',str(case),'--after-root',str(case),'--case',str(case)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   self.assertNotEqual(result.returncode,0)
   failure=json.loads((case/'PAIR-CHILD-FAILURE.json').read_text())
   self.assertEqual(failure['phase'],'resolve-roots');self.assertEqual(failure['kind'],'FileNotFoundError');self.assertEqual(failure['originalStderr'],'results/PAIR-WHOLE.stderr')
   self.assertNotIn(str(case),json.dumps(failure));self.assertIsNone(failure['stage'])
   self.assertEqual(json.loads((case/'PAIR-PHASES.jsonl').read_text().splitlines()[-1])['phase'],'resolve-roots')
 def test_dispatch_route_is_fixed_and_mutually_exclusive(self):
  workflow=(HERE.parents[2]/'.github/workflows/resource-market-ci.yml').read_text()
  block=workflow.split('  proof-pair-415f-b957-evidence:\n')[1].split('  proof-closure-435829-evidence:\n')[0]
  actual=next(line.strip()[4:] for line in block.splitlines() if line.startswith('    if:'))
  flags=['paired_n1','consensus_e2e','consensus_e2e_retained_history','consensus_remote_e2e_retained_history','consensus_fresh_paired_business','remote_signer_process']
  expected="github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/codex/ynx-pq-perf-integration' && inputs.proof_pair_b957_controller_sha == github.sha && inputs.proof_closure_435829_controller_sha == '' && inputs.candidate_sha == ''"+''.join(' && !inputs.'+flag for flag in flags)
  self.assertEqual(actual,expected)
  expression=actual.replace('&&','and').replace('!','not ')
  def route(**kwargs):
   values=dict.fromkeys(flags,False);values.update(proof_pair_b957_controller_sha='same',proof_closure_435829_controller_sha='',candidate_sha='');values.update(kwargs)
   return eval(expression,{'__builtins__':{}},{'github':types.SimpleNamespace(event_name='workflow_dispatch',ref='refs/heads/codex/ynx-pq-perf-integration',sha='same'),'inputs':types.SimpleNamespace(**values)})
  self.assertTrue(route())
  for flag in flags:self.assertFalse(route(**{flag:True}))
  self.assertFalse(route(proof_pair_b957_controller_sha='wrong'))
  self.assertFalse(route(proof_closure_435829_controller_sha='same'))
  self.assertFalse(route(candidate_sha='same'))
  original=workflow.split('  proof-closure-435829-evidence:\n')[1]
  self.assertIn("inputs.proof_closure_435829_controller_sha == github.sha",original)
  for literal in ['ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade','cancel-in-progress: false',"go-version: '1.26.11'",m.BEFORE,m.AFTER,'763b7f8f422f38f39e747a4f7f6cfb6405a0b96d','if: always()','PAIR-*.json','results/*.result.json','profile-*/NORMAL-CLI-RESULT.json','evidence/RECEIPT-ORIGINAL.json','proof-pair-supervisor-result.json','PAIR-PHASES.jsonl','proof-closure-435829/pair_supervisor.py']:
   self.assertIn(literal,block)
  pins=re.findall(r'uses: ([^\s@]+)@([^\s]+)',block)
  expectedpins=[('actions/checkout','3d3c42e5aac5ba805825da76410c181273ba90b1')]*4+[('actions/setup-go','b7ad1dad31e06c5925ef5d2fc7ad053ef454303e'),('actions/upload-artifact','ea165f8d65b6e75b540449e92b4886f43607fa02')]
  self.assertEqual(pins,expectedpins)
if __name__=='__main__':unittest.main(verbosity=2)
