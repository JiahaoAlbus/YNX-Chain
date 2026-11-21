#!/usr/bin/env python3
"""One whole-process-session bound for the historical PUBLIC comparison."""
import argparse, importlib.util, json, os, pathlib, platform, shutil, subprocess, sys, time
HERE=pathlib.Path(__file__).resolve().parent

def dump(path,value):
 with path.open('x') as f:
  json.dump(value,f,indent=2,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())

def main():
 p=argparse.ArgumentParser();p.add_argument('--original-root',required=True);p.add_argument('--before-root',required=True);p.add_argument('--after-root',required=True);p.add_argument('--case',required=True);a=p.parse_args()
 temp=pathlib.Path(os.environ['RUNNER_TEMP'])
 assert temp.is_absolute() and temp.resolve(strict=True)==temp
 start=temp/'proof-pair-supervisor-start.json';finish=temp/'proof-pair-supervisor-result.json'
 dump(start,dict(state='STARTED',onlineFinalityQualified=False))
 case=pathlib.Path(a.case);started=time.monotonic();reason=None;failure_type=None;bounded_result=None;launched=False;phase='case-admission'
 try:
  assert case==temp/'proof-pair-435829' and not case.exists() and not case.is_symlink()
  case.mkdir(mode=0o700)
  phase='platform-admission'
  assert platform.system()=='Linux' and platform.machine()=='x86_64'
  phase='memory-admission'
  mem={x.split(':')[0]:int(x.split()[1])*1024 for x in pathlib.Path('/proc/meminfo').read_text().splitlines()}
  assert mem['MemAvailable']>=6<<30
  phase='disk-admission'
  disk=shutil.disk_usage(temp).free;assert disk>=16<<30
  phase='cpu-admission'
  cpus=sorted(os.sched_getaffinity(0))[:2];assert len(cpus)==2
  phase='supervisor-load'
  spec=importlib.util.spec_from_file_location('original_diagnostic',HERE/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  m.ADMISSION_DISK_FREE=disk;m.ADMISSION_STARTED=started
  phase='resource-receipt'
  dump(case/'RESOURCE-ADMISSION.json',dict(go='verified inside supervised child',availableMemoryBytes=mem['MemAvailable'],availableDiskBytes=disk,cpuAffinity=cpus,ownedRSSCapBytes=4<<30,newDiskCapBytes=8<<30,wholeDiagnosticSeconds=720,supervisedScope='all pair work in one owned session',onlineFinalityQualified=False))
  env=os.environ.copy();env['YNX_PAIR_SUPERVISED']='1';env['YNX_PAIR_PHASE_ROOT']=str(case)
  argv=[sys.executable,str(HERE/'pair_run.py'),'--original-root',a.original_root,'--before-root',a.before_root,'--after-root',a.after_root,'--case',a.case]
  phase='owned-session'
  launched=True
  bounded_result=m.bounded(case,'PAIR-WHOLE',argv,HERE,env,720,cpus)
 except BaseException as error:
  reason='SUPERVISION_OR_ADMISSION_FAILURE';failure_type=type(error).__name__
 finally:
  result_path=case/'results/PAIR-WHOLE.result.json'
  if launched and result_path.is_file():
   try:bounded_result=json.loads(result_path.read_text())
   except Exception:
    reason=reason or 'SUPERVISOR_RESULT_UNREADABLE'
  detail=None;last_phase=None
  if launched:
   journal=case/'PAIR-PHASES.jsonl'
   if journal.is_file():
    try:
     lines=journal.read_text().splitlines(keepends=True)
     rows=[json.loads(line) for line in lines if line.endswith('\n')]
     if rows:last_phase=rows[-1]['phase']
    except Exception:last_phase='UNREADABLE_PHASE_JOURNAL'
   failure=case/'PAIR-CHILD-FAILURE.json'
   if failure.is_file():
    try:detail=json.loads(failure.read_text())
    except Exception:detail={'kind':'UNREADABLE_CHILD_FAILURE'}
  if bounded_result is not None and bounded_result.get('firstCause'):
   reason=bounded_result['firstCause'];failure_type=bounded_result.get('firstCauseType')
  dump(finish,dict(state='COMPLETE' if reason is None else 'FAILED',firstCause=reason,firstCauseType=failure_type,admissionPhase=phase,childLastPhase=last_phase,childFailure=detail,originalStderr='results/PAIR-WHOLE.stderr' if launched else None,supervision=bounded_result,elapsedSeconds=time.monotonic()-started,onlineFinalityQualified=False))
 if reason:raise SystemExit(1)
if __name__=='__main__':main()
