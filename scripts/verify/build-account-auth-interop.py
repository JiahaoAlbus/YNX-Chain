#!/usr/bin/env python3
"""Build only the original Auth PUBLIC C++ joint harness using an existing archive."""
import hashlib,json,subprocess,sys
from pathlib import Path
if sys.platform!='darwin':
    raise SystemExit('Auth original PUBLIC platform fixture requires Darwin; no equivalent platform adapter supplied')
if len(sys.argv)!=4:raise SystemExit('new external output, existing Source18 archive and exact SHA256 required')
root=Path(__file__).resolve().parents[2];out=Path(sys.argv[1]).resolve();archive=Path(sys.argv[2]);expected=sys.argv[3]
if out.exists() or not archive.is_absolute() or not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('output or existing archive pin differs')
out.mkdir(mode=0o700,parents=True);fixture=root/'internal/consensus/testdata/account_auth_interop';auth=fixture/'auth-final-r1'
provenance=json.loads((fixture/'PROVENANCE.json').read_text())
for p in provenance['copied']+provenance['originalLinkDependencies']:
    b=(fixture/p['path']).read_bytes()
    if not p['verbatim'] or len(b)!=p['bytes'] or hashlib.sha256(b).hexdigest()!=p['sha256']:raise SystemExit('foreign source changed: '+p['path'])
flags=['-std=c++17','-Wall','-Wextra','-Werror','-mmacosx-version-min=13.0','-DYNX_RECEIPT_PUBLIC_CLOCK']
for inc in [auth/'source',auth/'inherited',auth/'native-input',auth/'sole-input',fixture/'auth-original-test-link',root/'cmd/ynx-artifact-release-cabi']:flags+=['-I',str(inc)]
steps=[]
def run(name,args):
    p=subprocess.run(['xcrun','clang++',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
    row={'name':name,'command':['xcrun','clang++',*args],'exitCode':p.returncode,'stdout':p.stdout.decode(),'stderr':p.stderr.decode()};steps.append(row)
    (out/'BUILD.json').write_text(json.dumps({'steps':steps,'archive':{'path':str(archive),'bytes':archive.stat().st_size,'sha256':expected},'archiveBuilt':False,'productionMobile':False},indent=2)+'\n')
    if p.returncode:raise SystemExit(name+': '+p.stderr.decode())
sources=[auth/'source/MobileRegisteredReceipt.cpp',auth/'source/MobileAccountProofClient.cpp',auth/'inherited/MobileSourceMath.cpp',auth/'inherited/MobileCanonicalDATA.cpp',auth/'inherited/MobileHeldOriginals.cpp',auth/'native-input/SelectedAppDirectory.cpp',fixture/'port.PUBLIC.cpp',fixture/'auth-original-test-link/unrelated-pay-abort.PUBLIC.cpp']
objects=[]
for i,src in enumerate(sources):
    obj=out/(str(i)+'.o');run('compile-'+str(i),flags+(['-include',str(fixture/'row.PUBLIC.hpp')] if i==0 else [])+['-c',str(src),'-o',str(obj)]);objects.append(str(obj))
root0=out/'root0.o';run('compile-unmodified-Root0',flags+['-c',str(sources[0]),'-o',str(root0)])
tail=[str(archive),'-Wl,-dead_strip','-framework','Security','-framework','CoreFoundation','-framework','SystemConfiguration','-lresolv']
for name,objs in [('account-auth-joint',objects),('account-auth-root0',[str(root0)]+objects[1:])]:run('link-'+name,['-mmacosx-version-min=13.0',*objs,*tail,'-o',str(out/name)])
print(json.dumps({'compiled':True,'archiveBuilt':False,'normalHost':False,'output':str(out)}))
