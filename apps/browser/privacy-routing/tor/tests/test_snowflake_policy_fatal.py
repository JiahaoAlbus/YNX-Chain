#!/usr/bin/python3
"""Only new policy-fatal/lifecycle delta. Parent fresh resource guard required.
No real Arti, managed PT, GUI, DNS, URL or qualification is created.
"""
import argparse, hashlib, json, platform, subprocess, time
from pathlib import Path
from test_worker_ownership import NYM_DECLARATION_SOURCE, NYM_PUBLIC_SOURCES, nym_public_declarations, segment

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--qa-core-products',type=Path,required=True)
 p.add_argument('--native-source',type=Path,required=True)
 p.add_argument('--module-cache',type=Path,required=True)
 p.add_argument('--output',type=Path,required=True)
 p.add_argument('--producer-capture',type=Path)
 p.add_argument('--reuse-previous-native',type=Path)
 a=p.parse_args(); out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
 native=a.native_source.resolve()
 names=['PrivacyTorPlatform.swift','BundledTorBackend.swift','TorPublicSearchDiagnostic.swift','TorSnowflakePublicBrowserBackend.swift','SnowflakeSafePhaseRecorder.swift','TorProtectedRouteProvider.swift','TorExternalTransport.swift']
 nym_sources=list(NYM_PUBLIC_SOURCES) if 'NymPublicSearchRuntime' in (native/'TorPublicSearchDiagnostic.swift').read_text() else []
 nym_dependencies=nym_sources+[NYM_DECLARATION_SOURCE] if nym_sources else []
 inputs={}
 for n in names+nym_dependencies:
  source=native/n;inputs[str(source)]=sha(source);(out/n).write_bytes(source.read_bytes())
 if (native/'SnowflakeSafePhaseRecorder.swift').read_bytes()!=Path(__file__).with_name('SnowflakeSafePhaseRecorder.swift').read_bytes():raise ValueError('phase Native/test drift')
 for n in ['SnowflakePolicyFatalAdapterFixture.swift','SnowflakePolicyFatalDeltaProbe.swift','SnowflakeBrowserHarmlessChild.swift','test_worker_ownership.py',Path(__file__).name]:
  source=Path(__file__).with_name(n);inputs[str(source)]=sha(source);(out/n).write_bytes(source.read_bytes())
 adapter=out/'PrivacyTorPlatform.swift'
 adapter.write_text(adapter.read_text()+(out/'SnowflakePolicyFatalAdapterFixture.swift').read_text())
 declarations=out/'ActualOwnedDeclarations.swift'
 declarations.write_text('import Foundation\nimport YNXBrowserCore\n'+segment((out/'TorProtectedRouteProvider.swift').read_text(),'enum TorCoordinatorFailure:')+'\n'+segment((out/'TorProtectedRouteProvider.swift').read_text(),'@MainActor final class TorStartupOwnership<Value: Sendable>')+'\n'+segment((out/'TorExternalTransport.swift').read_text(),'enum TorTransportFailure:')+'\n')
 if nym_sources:
  declarations.write_text(declarations.read_text()+nym_public_declarations((out/NYM_DECLARATION_SOURCE).read_text()))
 core=a.qa_core_products.resolve();module=core/'YNXBrowserCore.swiftmodule'; include=core
 if not module.exists():module=core/'Modules/YNXBrowserCore.swiftmodule';include=core/'Modules'
 lib=core/'libYNXBrowserCore.a'
 if not lib.is_file():lib=core/'YNXBrowserCore.o'
 if not module.exists() or not lib.is_file():raise ValueError('actual full QA Core product required')
 for f in [lib]+(list(module.rglob('*')) if module.is_dir() else [module]):
  if f.is_file():inputs[str(f)]=sha(f)
 if a.producer_capture:inputs[str(a.producer_capture.resolve())]=sha(a.producer_capture.resolve())
 sdk=subprocess.check_output(['/usr/bin/xcrun','--show-sdk-path'],text=True,timeout=5).strip()
 flags=['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-sdk',sdk,'-j','1','-module-cache-path',str(a.module_cache.resolve()),'-parse-as-library']
 src=[str(out/n) for n in names[:5]+nym_sources]+[str(declarations)]
 steps=[('normal-phase-symbols',flags+['-emit-object',str(out/'SnowflakeSafePhaseRecorder.swift'),'-o',str(out/'normal-phase.o')],20),
 ('normal-symbol-check',['/usr/bin/nm','-j',str(out/'normal-phase.o')],5),
 ('normal-affected-typecheck',flags+['-typecheck','-I',str(include)]+src,30),
 ('harmless-fixture',flags+[str(out/'SnowflakeBrowserHarmlessChild.swift'),'-o',str(out/'HarmlessChild')],20),
 ('compile-new-fatal-delta',flags+['-DYNX_PRIVACY_ACCEPTANCE','-I',str(include),str(lib)]+src+[str(out/'SnowflakePolicyFatalDeltaProbe.swift'),'-o',str(out/'PolicyFatalProbe')],35),
 ('actual-new-fatal-delta',[str(out/'PolicyFatalProbe'),str(out),str(out/'HarmlessChild')]+([str(a.producer_capture.resolve())] if a.producer_capture else []),25)]
 reuse = None
 if a.reuse_previous_native:
  prior = a.reuse_previous_native.resolve()
  old = json.loads((prior/'RESULT.json').read_text())
  successful = {v['stage']:v for v in old['stages'] if v['exit']==0 and v['reaped'] and not v['timeout']}
  for label in ['normal-phase-symbols','normal-symbol-check','normal-affected-typecheck','harmless-fixture']:
   if label not in successful:raise ValueError('missing actual earlier unaffected PASS '+label)
  for n in names[:5]+nym_dependencies:
   current=(out/n).read_bytes();previous=(prior/n).read_bytes()
   if n=='TorPublicSearchDiagnostic.swift':
    current=current.replace(b'@MainActor func managedPending()',b'func managedPending()')
   if current!=previous:raise ValueError('prior unaffected source drift '+n)
  if (out/'ActualOwnedDeclarations.swift').read_bytes()!=(prior/'ActualOwnedDeclarations.swift').read_bytes():raise ValueError('declaration source drift')
  source=prior/'HarmlessChild';inputs[str(source)]=sha(source)
  (out/'HarmlessChild').write_bytes(source.read_bytes());(out/'HarmlessChild').chmod(0o700)
  reuse={'oldResult':str(prior/'RESULT.json'),'oldResultSHA256':sha(prior/'RESULT.json'),'stages':list(successful),'HarmlessSHA256':sha(source),'originalFailedQACompilePreserved':True,'notRerun':True}
  steps=steps[4:]
 result={'schema':'P05_POLICY_FATAL_NEW_DELTA_V1','status':'FAIL','stages':[],'inputs':inputs,'SDK':sdk,'reuseEvidence':reuse,'network':'NOT_RUN','GUI':'NOT_RUN','normalAdmission':'UNCHANGED_BLOCKED'}
 for label,argv,budget in steps:
  start=time.monotonic();child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:stdout,stderr=child.communicate(timeout=budget);timed=False
  except subprocess.TimeoutExpired:
   timed=True;child.terminate()
   try:stdout,stderr=child.communicate(timeout=2)
   except subprocess.TimeoutExpired:child.kill();stdout,stderr=child.communicate(timeout=2)
  (out/(label+'.stdout')).write_bytes(stdout);(out/(label+'.stderr')).write_bytes(stderr)
  result['stages'].append(dict(stage=label,argv=argv,pid=child.pid,exit=child.returncode,reaped=child.poll() is not None,timeout=timed,seconds=time.monotonic()-start))
  if timed or child.returncode or label=='normal-symbol-check' and (b'TorPublicBackendFatalLatch' in stdout or b'SnowflakeSafePhaseRecorder' in stdout):
   result['firstCause']=label;break
 else:result['status']='PASS'
 result['drift']=[name for name,h in inputs.items() if sha(Path(name))!=h]
 if result['drift']:result['status']='FAIL'
 result['generatedSourcePins']={str(f):sha(f) for f in [adapter,declarations]}
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'stages':len(result['stages']),'network':'NOT_RUN'}))
 return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
