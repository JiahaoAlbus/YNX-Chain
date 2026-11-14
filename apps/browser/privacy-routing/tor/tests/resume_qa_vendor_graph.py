#!/usr/bin/env python3
"""Resume only fixed MVS metadata after the preserved historical-file cap stop."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--intake',type=Path,required=True)
    parser.add_argument('--previous-intake',type=Path,required=True)
    parser.add_argument('--go',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,mode=0o700,exist_ok=False)
    prior=json.loads((args.intake/'RESULT.json').read_text());assert len(prior['sources'])==66 and prior['firstCause']=='module-count-budget'
    cache=Path(prior['ownedCache']);root=Path(prior['root']);assert (root/'go.mod').is_file()
    expected_mod='ecc6b80bdee7119c24b21ba675e83a2632b663b63ffdd23e8d87d5d2270835ae';expected_sum='e388221bde560069abf61bf2b14c50b3bb4d994895f30ea596f9c02f31a25ea8'
    assert hashlib.sha256((root/'go.mod').read_bytes()).hexdigest()==expected_mod and hashlib.sha256((root/'go.sum').read_bytes()).hexdigest()==expected_sum
    env=dict(os.environ,GOTOOLCHAIN='local',GOPROXY='https://proxy.golang.org',GOSUMDB='sum.golang.org',GOMODCACHE=str(cache),GOCACHE=str(out/'gocache'),GOMAXPROCS='1',GOMEMLIMIT='384MiB',GOWORK='off',GOFLAGS='',GOPRIVATE='',GONOPROXY='',GONOSUMDB='',GOAUTH='off')
    argv=[str(args.go),'list','-mod=readonly','-m','-json','all'];start=time.monotonic();peak=0;reason=None;cancelled=None
    def physical():
        total=0
        for tree in [out,args.intake,args.previous_intake]:
            for base,_,names in os.walk(tree,followlinks=False):
                for name in names:
                    p=Path(base)/name
                    if not p.is_symlink():total+=p.stat().st_blocks*512
        return total
    capacity={'hostFreeBytes':shutil.disk_usage('/').free,'WDFreeBytes':shutil.disk_usage(out).free}
    assert capacity['hostFreeBytes']>=2*1024**3 and capacity['WDFreeBytes']>=16*1024**3
    with(out/'graph.stdout').open('xb')as stdout,(out/'graph.stderr').open('xb')as stderr:
        child=subprocess.Popen(argv,cwd=root,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
        (out/'CURRENT.json').write_text(json.dumps({'status':'MVS_METADATA_ONLY_RUNNING','pid':child.pid,'argv':argv,'capacity':capacity,'priorMeasuredSeconds':prior['cumulativeMeasuredExecutionSeconds'],'maximumDistinctSelectedEffectiveModules':96,'maximumHistoricalGoModFiles':256,'maximumHistoricalGoModBytes':512*1024,'compiler':'NOT_RUN'},indent=2)+'\n')
        print(json.dumps({'event':'metadata-resume','pid':child.pid,'pgid':child.pid}),flush=True)
        while child.poll()is None:
            elapsed=time.monotonic()-start
            mods=list((cache/'cache/download').rglob('*.mod'))
            if len(mods)>256 or sum(p.stat().st_size for p in mods)>512*1024:reason='historical-metadata-cap'
            if elapsed>30:reason='metadata-command-deadline'
            if elapsed+prior['cumulativeMeasuredExecutionSeconds']>600:reason='cumulative-source-deadline'
            if physical()>384*1024**2:reason='cumulative-physical-budget'
            ps=subprocess.run(['/bin/ps','-axo','pid=,ppid=,rss='],capture_output=True,text=True,timeout=3);table={}
            for line in ps.stdout.splitlines():
                w=line.split()
                if len(w)==3 and all(t.isdigit()for t in w):table[int(w[0])]=(int(w[1]),int(w[2]))
            owned={child.pid}
            while True:
                added={pid for pid,(ppid,_)in table.items()if ppid in owned}-owned
                if not added:break
                owned|=added
            rss=sum(table.get(p,(0,0))[1]for p in owned)*1024;peak=max(peak,rss)
            if rss>512*1024**2:reason='tree-RSS-budget'
            if reason and cancelled is None:os.killpg(child.pid,signal.SIGTERM);cancelled=time.monotonic()
            if cancelled is not None and time.monotonic()-cancelled>2:os.killpg(child.pid,signal.SIGKILL)
            time.sleep(.2)
        child.wait(timeout=2)
    decoder=json.JSONDecoder();text=(out/'graph.stdout').read_text();graph=[]
    while text.strip():
        item,index=decoder.raw_decode(text.lstrip());graph.append(item);text=text.lstrip()[index:]
    selected={}
    for item in graph:
        if item.get('Main'):continue
        effective=item.get('Replace',item);selected[effective['Path']+'@'+effective['Version']]=effective
    if len(selected)>96:reason=reason or'selected-effective-module-cap'
    if child.returncode!=0:reason=reason or'actual-MVS-failed'
    if hashlib.sha256((root/'go.mod').read_bytes()).hexdigest()!=expected_mod or hashlib.sha256((root/'go.sum').read_bytes()).hexdigest()!=expected_sum:reason=reason or'root-lock-drift'
    sums={tuple(l.split()[:2]):l.split()[2]for l in(root/'go.sum').read_text().splitlines()if len(l.split())==3}
    missing=[{'module':key,'expectedSourceSum':sums.get((v['Path'],v['Version']))}for key,v in selected.items()if key not in prior['sources']]
    result={'schema':'P05_FIXED_QA_VENDOR_MVS_RESUME_V1','status':'MVS_RESOLVED'if reason is None else'MVS_INCOMPLETE','firstCause':reason,'pid':child.pid,'returncode':child.returncode,'reaped':True,'elapsedSeconds':time.monotonic()-start,'cumulativeMeasuredSeconds':time.monotonic()-start+prior['cumulativeMeasuredExecutionSeconds'],'peakTreeRSSBytes':peak,'cumulativePhysicalBytes':physical(),'historicalGoModFiles':len(list((cache/'cache/download').rglob('*.mod'))),'selectedEffectiveCount':len(selected),'selectedEffectiveModules':selected,'missingSelectedSources':missing,'actualImportGraph':'NOT_RUN','compiler':'NOT_RUN','vendorPT':'NOT_RUN','driverSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k]for k in ['status','firstCause','pid','returncode','elapsedSeconds','selectedEffectiveCount','historicalGoModFiles','missingSelectedSources']}));raise SystemExit(0 if reason is None else 1)


if __name__=='__main__':main()
