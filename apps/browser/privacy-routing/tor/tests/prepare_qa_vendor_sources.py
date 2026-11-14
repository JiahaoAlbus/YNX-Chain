#!/usr/bin/env python3
"""Fixed 0.9 QA source intake only; no build, PT startup, or browsing."""
import argparse, base64, hashlib, json, os, shutil, signal, subprocess, time
from pathlib import Path


def h1_files(names, read):
    summary=b''.join((hashlib.sha256(read(n)).hexdigest()+'  '+n+'\n').encode()for n in sorted(names))
    return 'h1:'+base64.b64encode(hashlib.sha256(summary).digest()).decode()


def escape(s): return ''.join('!'+c.lower()if c.isupper()else c for c in s)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--patched-root',type=Path,required=True)
    ap.add_argument('--patched-module-json',type=Path,required=True)
    ap.add_argument('--cache',type=Path,action='append',required=True)
    ap.add_argument('--go',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--previous-intake',type=Path,help='Preserve prior terminal attempt and include its measured execution/storage in whole budget')
    a=ap.parse_args();out=a.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
    began=time.monotonic();cache=out/'gomodcache';cache.mkdir(mode=0o700);fetch=out/'fetch';fetch.mkdir(mode=0o700)
    (fetch/'go.mod').write_text('module ynx.local/source-intake\n\ngo 1.22\n')
    root=out/'root';shutil.copytree(a.patched_root.resolve(),root)
    assert hashlib.sha256((root/'go.mod').read_bytes()).hexdigest()=='ecc6b80bdee7119c24b21ba675e83a2632b663b63ffdd23e8d87d5d2270835ae'
    assert hashlib.sha256((root/'go.sum').read_bytes()).hexdigest()=='e388221bde560069abf61bf2b14c50b3bb4d994895f30ea596f9c02f31a25ea8'
    doc=json.loads(a.patched_module_json.read_text());replacements={r['Old']['Path']:r['New']for r in doc['Replace']}
    required=[replacements.get(r['Path'],r)for r in doc['Require']];assert len(required)<=96
    sums={tuple(l.split()[:2]):l.split()[2]for l in(root/'go.sum').read_text().splitlines()if len(l.split())==3}
    sources={};events=[];first=None;peak=0;global_failure=None
    previous_elapsed=0
    if a.previous_intake: previous_elapsed=json.loads((a.previous_intake/'RESULT.json').read_text())['elapsedSeconds']
    env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='https://proxy.golang.org',GOSUMDB='sum.golang.org',GOMODCACHE=str(cache),GOCACHE=str(out/'gocache'),GOMAXPROCS='1',GOMEMLIMIT='384MiB',GOWORK='off',GOFLAGS='',GOPRIVATE='',GONOPROXY='',GONOSUMDB='',GOAUTH='off',TMPDIR=str(out/'tmp'))
    (out/'tmp').mkdir(mode=0o700)
    def physical():
        total=0
        for tree in [out]+([a.previous_intake]if a.previous_intake else[]):
            for base,dirs,files in os.walk(tree,followlinks=False):
                for n in files:
                    p=Path(base)/n
                    if not p.is_symlink():total+=p.stat().st_blocks*512
        return total
    def capacity():
        host=shutil.disk_usage('/').free;wd=shutil.disk_usage(out).free
        if host<2*1024**3 or wd<16*1024**3:raise RuntimeError('fresh host/WD capacity minimum not met')
        return {'hostFreeBytes':host,'WDFreeBytes':wd}
    initial={'schema':'P05_FIXED_QA_VENDOR_SOURCE_INTAKE_V1','status':'RUNNING','capacity':capacity(),'wholeDeadlineSeconds':600,'perItemDeadlineSeconds':30,'RSSBudgetBytes':512*1024**2,'physicalBudgetBytes':384*1024**2,'maximumModules':96,'declaredModules':len(required),'compiler':'NOT_RUN','vendorNetwork':'NOT_RUN'}
    (out/'CURRENT.json').write_text(json.dumps(initial,indent=2)+'\n')
    def run(name,argv,cwd):
        nonlocal peak,global_failure
        capacity();start=time.monotonic()
        with(out/(name+'.stdout')).open('xb')as stdout,(out/(name+'.stderr')).open('xb')as stderr:
            c=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
            print(json.dumps({'event':'source-command','name':name,'pid':c.pid,'moduleOrdinal':len(events)+1}),flush=True)
            reason=None;cancel=None
            while c.poll()is None:
                now=time.monotonic()
                if now-start>30:reason='per-item-source-deadline'
                if now-began+previous_elapsed>600:reason='whole-source-deadline'
                if physical()>384*1024**2:reason='source-physical-budget'
                if len(list((cache/'cache/download').rglob('*.mod')))>96:reason='module-count-budget'
                q=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss='],capture_output=True,text=True,timeout=3);table={}
                for line in q.stdout.splitlines():
                    w=line.split()
                    if len(w)==3 and all(x.isdigit()for x in w):table[int(w[0])]=(int(w[1]),int(w[2]))
                owned={c.pid}
                while True:
                    added={pid for pid,(ppid,_)in table.items()if ppid in owned}-owned
                    if not added:break
                    owned|=added
                rss=sum(table.get(pid,(0,0))[1]for pid in owned)*1024;peak=max(peak,rss)
                if rss>512*1024**2:reason='source-RSS-budget'
                if reason and cancel is None:os.killpg(c.pid,signal.SIGTERM);cancel=now
                if cancel is not None and now-cancel>2:os.killpg(c.pid,signal.SIGKILL)
                time.sleep(.2)
            c.wait(timeout=2)
        r={'name':name,'argv':argv,'pid':c.pid,'returncode':c.returncode,'reaped':True,'seconds':time.monotonic()-start,'stopReason':reason}
        events.append(r);(out/'COMMANDS.json').write_text(json.dumps(events,indent=2)+'\n')
        if reason:global_failure=reason;raise RuntimeError(reason)
        return r
    try:
        for ordinal,mod in enumerate(required):
            name,version=mod['Path'],mod['Version'];key=name+'@'+version;expected=sums.get((name,version))
            if not expected:raise RuntimeError('fixed root lacks source sum for '+key)
            adopted=False;prefix=key+'/'
            for old in a.cache:
                path=old.resolve()/(escape(name)+'@'+escape(version))
                if not path.is_dir():continue
                files=[str(q.relative_to(path)).replace(os.sep,'/')for q in path.rglob('*')if q.is_file()]
                assert all(not q.is_symlink()for q in path.rglob('*'))
                current=h1_files([prefix+n for n in files],lambda n:(path/n[len(prefix):]).read_bytes())
                if current!=expected:
                    events.append({'name':'cached-source-h1-rejected','module':key,'actual':current,'expected':expected});continue
                # Legacy pre-module releases may have a generated .mod in Go's cache,
                # rather than a go.mod file in the source ZIP. Verify that exact mod sum.
                mod_file=path/'go.mod'
                if not mod_file.exists():mod_file=old.resolve()/'cache/download'/escape(name)/'@v'/(escape(version)+'.mod')
                if not mod_file.exists():events.append({'name':'cached-source-generated-mod-not-present','module':key});continue
                go_mod=mod_file.read_bytes();modhash=h1_files(['go.mod'],lambda _:go_mod)
                if modhash!=sums.get((name,version+'/go.mod')):raise RuntimeError('cached go.mod sum mismatch for '+key)
                target=cache/(escape(name)+'@'+escape(version));target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to(path,target_is_directory=True)
                metadata=cache/'cache/download'/escape(name)/'@v';metadata.mkdir(parents=True,exist_ok=True)
                (metadata/(escape(version)+'.mod')).write_bytes(go_mod);(metadata/(escape(version)+'.ziphash')).write_text(expected)
                old_info=old.resolve()/'cache/download'/escape(name)/'@v'/(escape(version)+'.info')
                if old_info.exists():shutil.copyfile(old_info,metadata/(escape(version)+'.info'))
                sources[key]={'kind':'READ_ONLY_ADOPTED_FRESH_TREE_H1','source':str(path),'sum':current,'goModSum':modhash};adopted=True;break
            if adopted:continue
            name_out='module-'+str(ordinal).zfill(2)
            r=run(name_out,[str(a.go),'mod','download','-json',key],fetch)
            data=json.loads((out/(name_out+'.stdout')).read_text())
            if r['returncode']!=0 or data.get('Sum')!=expected:raise RuntimeError('exact module source download failed/sum mismatch: '+key)
            sources[key]={'kind':'OFFICIAL_PROXY_SUMDB_DOWNLOADED','source':data['Dir'],'sum':data['Sum'],'origin':data.get('Origin')}
            (out/'SOURCES-CURRENT.json').write_text(json.dumps(sources,indent=2)+'\n')
        # Actual readonly graph. Network may fetch only metadata required by the locked graph;
        # the same unique-module budget and whole/per-command limits remain active.
        r=run('readonly-MVS-graph',[str(a.go),'list','-mod=readonly','-m','-json','all'],root)
        if r['returncode']!=0:raise RuntimeError('actual readonly MVS graph failed; preserve stderr')
        if hashlib.sha256((root/'go.mod').read_bytes()).hexdigest()!='ecc6b80bdee7119c24b21ba675e83a2632b663b63ffdd23e8d87d5d2270835ae':raise RuntimeError('rootgo.mod drift')
        if hashlib.sha256((root/'go.sum').read_bytes()).hexdigest()!='e388221bde560069abf61bf2b14c50b3bb4d994895f30ea596f9c02f31a25ea8':raise RuntimeError('rootgo.sum drift')
    except Exception as e:first=str(e)
    final=dict(initial,status='SOURCE_CLOSURE_READY'if first is None else'SOURCE_CLOSURE_INCOMPLETE',firstCause=first,elapsedSeconds=time.monotonic()-began,cumulativeMeasuredExecutionSeconds=time.monotonic()-began+previous_elapsed,peakOwnedRSSBytes=peak,newPhysicalBytes=physical(),sources=sources,commands=events,root=str(root),ownedCache=str(cache),driverSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),fullImportGraph='NOT_RUN; no Go compilation/listdeps yet',noVendorOrPTStarted=True)
    (out/'RESULT.json').write_text(json.dumps(final,indent=2)+'\n');print(json.dumps({'status':final['status'],'firstCause':first,'sourceCount':len(sources),'elapsedSeconds':final['elapsedSeconds'],'peakRSS':peak,'physicalBytes':final['newPhysicalBytes']}));raise SystemExit(0 if first is None else 1)


if __name__=='__main__':main()
