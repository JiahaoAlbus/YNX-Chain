#!/usr/bin/env python3
"""Offline candidate guard against full pinned transport package; no vendor/relay run."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time
import uuid


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--transport-source', required=True, type=Path)
    ap.add_argument('--ice-source', required=True, type=Path)
    ap.add_argument('--go', required=True, type=Path)
    ap.add_argument('--output', required=True, type=Path)
    ap.add_argument('--test-name', help='One exact new delta only; default runs the whole candidate suite')
    a=ap.parse_args();out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
    transport=a.transport_source.resolve();ice=a.ice_source.resolve();guard=Path(__file__).resolve().parents[1]/'qa-egress-guard'
    assert (transport/'go.mod').read_text().startswith('module github.com/pion/transport/v4\n')
    assert sha(transport/'net.go')=='0be09e9fadba876c64f8c63d3a19cbb19b1fb8b6cedc967d282d313665825dd7', 'pinned transport API drift'
    candidate=ice/'candidate_base.go';body=candidate.read_text();assert 'if errors.Is(err, io.ErrClosedPipe)' in body and 'return n, nil' in body
    source_pins={str(p):sha(p) for p in sorted(guard.glob('*.go'))}
    expected_tests=sorted(re.findall(r'^func (Test\w+)\(', '\n'.join(Path(p).read_text()for p in source_pins), re.M))
    if a.test_name:
        assert a.test_name in expected_tests, 'unknown delta test'
        expected_tests=[a.test_name]
    dependency_pins={str(p):sha(p)for p in [transport/'go.mod',candidate]+sorted(transport.glob('*.go'))}
    module=out/'module';module.mkdir(mode=0o700)
    for name in source_pins: p=Path(name);(module/p.name).write_bytes(p.read_bytes())
    # An explicit local replace compiles the actual complete pinned transport package.
    # This is not a copy/extraction of its interface declarations or a vendor rebuild.
    (module/'go.mod').write_text('module ynx.local/public-entry-guard\n\ngo 1.22\n\nrequire github.com/pion/transport/v4 v4.0.1\nreplace github.com/pion/transport/v4 => '+json.dumps(str(transport))+'\n')
    tmp=out/'tmp';tmp.mkdir(mode=0o700);alias=Path('/private/tmp')/('p05-egress-'+uuid.uuid4().hex[:12]);alias.symlink_to(tmp,target_is_directory=True);alias_inode=alias.lstat().st_ino
    env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='off',GOSUMDB='off',GOMAXPROCS='1',GOMEMLIMIT='384MiB',GOCACHE=str(out/'gocache'),GOMODCACHE=str(out/'gomodcache'),TMPDIR=str(alias)+'/',GOWORK='off',GOFLAGS='')
    version=subprocess.run([str(a.go),'version'],capture_output=True,timeout=5)
    (out/'go-version.stdout').write_bytes(version.stdout);(out/'go-version.stderr').write_bytes(version.stderr)
    argv=[str(a.go),'test','-json','-count=1','-p=1','-parallel=1','-timeout=15s','-vet=off']
    if a.test_name: argv+=['-run','^'+a.test_name+'$']
    argv+=['.']
    began=time.monotonic();peak=0;reason=None;cancelled=False
    with(out/'go-test.jsonl').open('xb')as stdout,(out/'go-test.stderr').open('xb')as stderr:
        child=subprocess.Popen(argv,cwd=module,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
        initial={'schema':'P05_PUBLIC_ENTRY_GUARD_TEST_V1','status':'RUNNING','pid':child.pid,'pgid':os.getpgid(child.pid),'argv':argv,'maximumSeconds':60,'memoryBudgetBytes':512*1024**2,'version':version.stdout.decode().strip(),'sourcePins':source_pins,'dependencyPins':dependency_pins,'sourceWasCopiedIntoOwnedModule':True,'actualFullTransportPackageCompiled':True,'relayOrVendor':'NOT_RUN','realPrivatePayloadSends':'FORBIDDEN; only numeric loopback standard-Dialer preconnect rejection control','DNS':'NO_DEFAULT_RESOLVER; closed synthetic mapping','candidateIsBrowserQualification':False}
        (out/'CURRENT.json').write_text(json.dumps(initial,indent=2)+'\n')
        print(json.dumps({'event':'started','pid':child.pid,'pgid':initial['pgid'],'sourceFiles':len(source_pins),'network':'no relay or successful connect'}),flush=True)
        while child.poll()is None:
            elapsed=time.monotonic()-began
            ps=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss='],capture_output=True,text=True,timeout=3)
            table={}
            for line in ps.stdout.splitlines():
                words=line.split()
                if len(words)==3 and all(w.isdigit()for w in words):table[int(words[0])]=(int(words[1]),int(words[2]))
            owned={child.pid}
            while True:
                added={pid for pid,(ppid,_)in table.items()if ppid in owned}-owned
                if not added:break
                owned|=added
            rss=sum(table.get(pid,(0,0))[1]for pid in owned)*1024;peak=max(peak,rss)
            if elapsed>60:reason='deadline'
            if rss>512*1024**2:reason='RSS-budget'
            if reason and not cancelled:os.killpg(child.pid,signal.SIGTERM);cancelled=True
            if cancelled and elapsed>63:os.killpg(child.pid,signal.SIGKILL)
            time.sleep(.2)
        child.wait(timeout=2)
    assert alias.is_symlink()and alias.lstat().st_ino==alias_inode and alias.resolve()==tmp;alias.unlink()
    events=[]
    for line in(out/'go-test.jsonl').read_text().splitlines():
        try:events.append(json.loads(line))
        except json.JSONDecodeError:pass
    failures=[e.get('Test')for e in events if e.get('Action')=='fail']
    passed=[e['Test']for e in events if e.get('Action')=='pass'and e.get('Test')]
    drift=[p for p,h in{**source_pins,**dependency_pins}.items()if sha(Path(p))!=h]
    groups=subprocess.run(['/bin/ps','-axo','pgid='],capture_output=True,text=True,timeout=3)
    group_remaining=sum(1 for line in groups.stdout.splitlines()if line.strip()==str(child.pid))
    result=dict(initial,status='PASS'if child.returncode==0 and not reason and not drift and group_remaining==0 and sorted(passed)==expected_tests else'FAIL',returncode=child.returncode,reaped=True,elapsedSeconds=time.monotonic()-began,peakOwnedRSSBytes=peak,firstCause=reason or ('go-test-failed'if child.returncode else None),passedTests=passed,expectedTests=expected_tests,failedTests=failures,sourceDrift=drift,processGroupRemaining=group_remaining,ownAliasRemoved=not alias.exists(),driverSHA256=sha(Path(__file__)),actualPionPrivateCallerExecution='NOT_RUN; pinned closed-pipe branch inspected, typed guard error tested',actualSnowflakeCallsiteWiring='NOT_RUN',fixedPublisherLyrebirdChanged=False)
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k]for k in ['status','pid','returncode','elapsedSeconds','peakOwnedRSSBytes','passedTests','firstCause','processGroupRemaining']}));raise SystemExit(0 if result['status']=='PASS' else 1)


if __name__=='__main__':main()
