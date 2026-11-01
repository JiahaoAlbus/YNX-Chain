"""Metadata only for the original temporary lab's exact three store paths.

No keys/HRS/config/WAL scan, payload open, new process, thread or filesystem.
Allocated bytes are filesystem allocation, not disk writes or physical devices.
"""
import os
import itertools
from pathlib import Path
import stat
import time

MAX_FILES=4096

def require(ok,reason):
    if not ok:raise ValueError(reason)

def sample_path(root,path,deadline=None):
    began=time.monotonic_ns();out=dict(status='UNKNOWN',logicalBytes=None,allocatedBytes=None,regularFiles=None,atomic=False)
    try:
        root,path=Path(root),Path(path)
        require(root.is_absolute() and root.resolve(strict=True)==root and root in path.parents,'store escaped original lab root')
        require(path.resolve(strict=True)==path,'store symlink/redirect refused')
        pending=[path];seen=set();logical=allocated=files=0;entries=0
        if deadline is None:deadline=time.monotonic()+1
        while pending:
            require(time.monotonic()<deadline,'store metadata sampling deadline')
            p=pending.pop();info=p.lstat();entries+=1;require(entries<=MAX_FILES,'store metadata file bound')
            if stat.S_ISDIR(info.st_mode):
                with os.scandir(p) as stream:children=list(itertools.islice(stream,MAX_FILES+1))
                require(len(children)+entries<=MAX_FILES,'store metadata entry bound');pending.extend(Path(c.path) for c in children)
            else:
                require(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'store special/symlink/hardlinked file refused')
                identity=(info.st_dev,info.st_ino);require(identity not in seen,'duplicate store inode');seen.add(identity)
                require(hasattr(info,'st_blocks'),'allocated filesystem blocks unsupported')
                logical+=info.st_size;allocated+=info.st_blocks*512;files+=1
        out.update(status='OBSERVED_METADATA',logicalBytes=logical,allocatedBytes=allocated,regularFiles=files)
    except (OSError,ValueError) as e:out.update(reason=str(e),errorType=type(e).__name__)
    out['samplingElapsedNs']=time.monotonic_ns()-began;return out

class OwnedStorageWindow:
    def __init__(self,ceremony):
        self.c=ceremony;self.before=None;self.after=None
    def capture(self,side):
        require(side in ('before','after') and getattr(self,side) is None,'one original store checkpoint per side')
        lo=time.monotonic_ns();rows=[];deadline=time.monotonic()+1
        for n in self.c.plan['nodes']:
            # Original plan paths were already validated by original_plan().
            home=Path(n['home']);paths=dict(blockstore=home/'data/blockstore.db',stateDB=home/'data/state.db',applicationState=Path(n['statePath']))
            rows.append(dict(node=n['index'],stores={name:sample_path(self.c.root,p,deadline) for name,p in paths.items()}))
        value=dict(startMonotonicNs=str(lo),endMonotonicNs=str(time.monotonic_ns()),nodes=rows,phase='pre-load metadata checkpoint' if side=='before' else 'after original owned cleanup attempt; producer stop status remains in original process receipt',planSHA256=self.c.pin)
        setattr(self,side,value);return value
    def finish(self,commit_readback=None):
        if self.after is None:self.capture('after')
        rows=[]
        for n in self.after['nodes']:
            before=next((v for v in (self.before or {}).get('nodes',[]) if v['node']==n['node']),{})
            changes={}
            for name,end in n['stores'].items():
                start=before.get('stores',{}).get(name,{})
                complete=start.get('status')==end.get('status')=='OBSERVED_METADATA'
                changes[name]=dict(status='OBSERVED_NONATOMIC_ALLOCATION_DELTA' if complete else 'UNKNOWN',logicalBytesDelta=end['logicalBytes']-start['logicalBytes'] if complete else None,allocatedBytesDelta=end['allocatedBytes']-start['allocatedBytes'] if complete else None)
            original=next((v for v in (commit_readback or {}).get('originalSnapshots',[]) if v['node']==n['node'] and v.get('usable')),{}).get('rawOriginalObservation',{})
            rows.append(dict(node=n['node'],stores=changes,nodeLifetimeObservedSuccessNotifications=original.get('successNotifications'),retainedDurableCommitSamples=len(original['samples']) if 'samples' in original else None,actualLoadWindowCommitCount=None,commitCountCoverage='observer lifetime and retained samples only; no pre-load notification checkpoint, so exact allocation-window Commit denominator UNKNOWN'))
        return dict(schema='YNX-PERF-OWNED-STORE-METADATA/v1',before=self.before,after=self.after,nodes=rows,filesystemAllocationIsNotDiskWrites=True,physicalStorageDevicesMeasured=False,perTransactionBytes=None,allStorePathsCovered=False,scope='exact original lab blockstore.db/state.db/applicationState only; excludes keys,HRS,config,consensus WAL,journal sidecars',loadWindowAtomic=False,actualLoadWindowCommitCount=None,sameHost=True,physicalFaultDomains=1)
