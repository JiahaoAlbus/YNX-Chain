#!/usr/bin/env python3
"""Compile exact complete READ3 resource TU only; never run TPM/provider code."""
import hashlib,json,os,pathlib,shlex,subprocess,sys,time,traceback
HERE=pathlib.Path(__file__).resolve().parent
OUT=pathlib.Path(sys.argv[1]).resolve();OUT.mkdir(parents=True,exist_ok=False)
SOURCE=HERE/'source';events=[];start=time.monotonic()
def digest(p):
 p=pathlib.Path(p);h=hashlib.sha256()
 with p.open('rb') as f:
  for z in iter(lambda:f.read(1024*1024),b''):h.update(z)
 return {'path':str(p),'bytes':p.stat().st_size,'sha256':h.hexdigest()}
def save(name,value):(OUT/name).write_text(json.dumps(value,indent=2)+'\n')
def run(label,args,timeout=120):
 with (OUT/(label+'.raw')).open('xb') as raw:
  t=time.time();p=subprocess.run(args,stdout=raw,stderr=subprocess.STDOUT,timeout=min(timeout,max(0.1,600-(time.monotonic()-start))),check=False)
 e={'label':label,'argv':args,'actualExit':p.returncode,'startUTCUnix':t,'endUTCUnix':time.time(),'log':digest(OUT/(label+'.raw'))};events.append(e);save('COMMANDS.json',events)
 if p.returncode:raise RuntimeError('first failing command: '+label+' exit '+str(p.returncode))
 return (OUT/(label+'.raw')).read_text()
state='NOT_COMPILED';cause=None
try:
 manifest=json.loads((HERE/'SOURCE_INPUTS.json').read_text());assert manifest['pendingAuthAncestor17LeafRepair'] is False
 for row in manifest['files']:
  p=SOURCE/row['path'];assert p.is_file() and not p.is_symlink();actual=digest(p);assert actual['bytes']==row['bytes'] and actual['sha256']==row['sha256'],row
 # Replay the exact package/compiler/header inputs obtained from the first real Linux CI.
 lock=json.loads((HERE.parent/'social-tpm-r37'/'LINUX_DEPENDENCY_LOCK.json').read_text())
 run('APT_SIGNED_INDEX',['sudo','apt-get','update'],180)
 locked=lock['requestedExact']
 save('REQUESTED_DEPENDENCY_LOCK.json',{'packages':locked,'fromActualCiRun':lock['fromActualCiRun'],'sourceLock':digest(HERE.parent/'social-tpm-r37'/'LINUX_DEPENDENCY_LOCK.json'),'rebuildRule':'recorded versions/package SHA/compiler/header/library bytes only; no candidate or fallback'})
 run('APT_DOWNLOAD_LOCKED',['sudo','apt-get','--download-only','--yes','--no-install-recommends','install',*locked],180)
 debs=[]
 for p in sorted(pathlib.Path('/var/cache/apt/archives').glob('*.deb')):
  fields=subprocess.check_output(['dpkg-deb','--show','--showformat=${Package}\t${Version}\t${Architecture}',str(p)],text=True).strip()
  debs.append(dict(**digest(p),packageVersionArchitecture=fields))
 save('DOWNLOADED_PACKAGE_SHA256.json',{'aptVerifiedAgainstSignedIndex':True,'packages':debs})
 expected_debs={pathlib.Path(v['path']).name:v for v in lock['downloadedPackages']}
 for v in debs:
  expected=expected_debs.get(pathlib.Path(v['path']).name)
  assert expected is not None and v['sha256']==expected['sha256'] and v['bytes']==expected['bytes'] and v['packageVersionArchitecture']==expected['packageVersionArchitecture'],('dependency archive differs from fixed CI input',v)

 run('APT_INSTALL_LOCKED',['sudo','apt-get','--yes','--no-download','--no-install-recommends','install',*locked],180)
 packages=run('INSTALLED_PACKAGE_VERSIONS',['dpkg-query','--show','--showformat=${Package}\t${Version}\t${Architecture}\n'],15)
 compiler=pathlib.Path(subprocess.check_output(['which','gcc'],text=True).strip()).resolve()
 version=run('COMPILER_VERSION',[str(compiler),'--version'],15);target=run('COMPILER_TARGET',[str(compiler),'-dumpmachine'],15)
 pc=['tss2-esys','tss2-mu','tss2-tcti-device','openssl']
 pkgversions=run('PKG_CONFIG_VERSIONS',['pkg-config','--modversion',*pc],15)
 flags=shlex.split(run('PKG_CONFIG_CFLAGS',['pkg-config','--cflags',*pc],15))
 libs=run('PKG_CONFIG_LIBS',['pkg-config','--libs',*pc],15)
 headers=[]
 for root in [pathlib.Path('/usr/include/tss2'),pathlib.Path('/usr/include/openssl'),pathlib.Path('/usr/include/x86_64-linux-gnu/openssl')]:
  if root.is_dir():headers.extend(digest(p) for p in sorted(root.rglob('*')) if p.is_file())
 assert any('/tss2/tss2_esys.h' in h['path'] for h in headers),'actual TSS2 headers missing'
 librows=[]
 for name in ['tss2-esys','tss2-mu','tss2-tcti-device','crypto','ssl']:
  p=pathlib.Path(subprocess.check_output([str(compiler),'-print-file-name=lib'+name+'.so'],text=True).strip())
  assert p.is_file(),str(p);librows.append(digest(p.resolve()))
 save('ACTUAL_TOOLCHAIN_HEADERS_LIBRARIES.json',{'compiler':digest(compiler),'version':version,'target':target.strip(),'pkgConfigVersions':pkgversions,'cflags':flags,'actualLinkFlags':libs,'headers':headers,'libraries':librows,'installedPackagesLog':digest(OUT/'INSTALLED_PACKAGE_VERSIONS.raw')})
 assert digest(compiler)==lock['compiler'],'compiler binary differs from fixed CI input'
 assert version==lock['compilerVersion'] and target.strip()==lock['target'],'compiler version/target differs'
 assert flags==lock['cflags'] and pkgversions==lock['pkgConfigVersions'],'pkg-config fixed input differs'
 assert headers==lock['headers'],'actual TSS2/OpenSSL headers differ from fixed CI input'
 assert librows==lock['libraries'],'actual TSS2/OpenSSL libraries differ from fixed CI input'

 includes=[SOURCE/p for p in manifest['privateIncludes']]
 argv=[str(compiler),'-std=c11','-Wall','-Wextra','-Werror','-pthread','-fPIC','-ffunction-sections','-fdata-sections','-MMD','-MF',str(OUT/'resource-inputs.d'),*flags,*[a for p in includes for a in ['-I',str(p)]],'-c',str(SOURCE/manifest['productionTU']),'-o',str(OUT/'ynx_source_original_resource_owner.o')]
 run('ACTUAL_FULL_PRODUCTION_TU_COMPILE',argv,45)
 deps=(OUT/'resource-inputs.d').read_text();assert str(SOURCE/'vendor/sqlite3500400/sqlite3.h') in deps,'selected SQLite header not actually used';assert '/usr/include/sqlite3.h' not in deps,'ambient SQLite header used'
 save('ACTUAL_DEPENDENCY_READBACK.json',digest(OUT/'resource-inputs.d'))
 save('OBJECT_READBACK.json',digest(OUT/'ynx_source_original_resource_owner.o'));state='READ3_COMPLETE_RESOURCE_TU_WERROR_COMPILE_EXIT0_NOT_LINK_OR_HARDWARE'

except BaseException as e:
 cause=repr(e);save('FIRST_FAILURE.json',{'firstCause':cause,'traceback':traceback.format_exc()})
finally:
 save('RESULT.json',{'state':state,'firstCause':cause,'elapsedSeconds':time.monotonic()-start,'sourceManifest':digest(HERE/'SOURCE_INPUTS.json'),'commands':events,'fixtureCompiled':False,'linkedStorageOpenGraph':state=='NOT_APPLICABLE_COMPILE_ONLY','linkedPlatform':False,'tpmExecuted':False,'rootQualified':False,'serverQualified':False,'issued':False})
if cause:sys.exit(1)
