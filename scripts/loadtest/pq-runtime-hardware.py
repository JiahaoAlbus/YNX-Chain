"""Read hardware conditions once; no processes, affinity changes or admission."""
import argparse
import json
import os
from pathlib import Path
import platform
import re


def bounded(path,limit):
    with open(path,'rb') as source:raw=source.read(limit+1)
    if len(raw)>limit:raise RuntimeError('hardware input bound exceeded')
    return raw.decode('utf-8',errors='strict')


def cpu_models(text):
    values=set()
    for line in text.splitlines():
        key,sep,value=line.partition(':')
        if sep and key.strip() in ('model name','Hardware','Processor','CPU implementer','CPU part'):
            value=value.strip()
            if not value or len(value)>256:raise RuntimeError('invalid bounded CPU model')
            values.add(key.strip()+': '+value)
    if not values or len(values)>64:raise RuntimeError('CPU model not supplied')
    return sorted(values)


def memory_bytes(text):
    rows=[line for line in text.splitlines() if line.startswith('MemTotal:')]
    if len(rows)!=1:raise RuntimeError('one original MemTotal required')
    match=re.fullmatch(r'MemTotal:\s+([0-9]+) kB',rows[0])
    if match is None or not 0<int(match[1])<1<<53:raise RuntimeError('invalid original MemTotal')
    return int(match[1])*1024


def filesystem_type(text,device):
    # Match the actual st_dev rather than exposing mount paths or options.
    major_minor='%d:%d'%(os.major(device),os.minor(device))
    types=set()
    for line in text.splitlines():
        fields=line.split()
        if len(fields)>6 and fields[2]==major_minor:
            separator=fields.index('-')
            if separator+1>=len(fields):raise RuntimeError('incomplete original mount identity')
            types.add(fields[separator+1])
    if len(types)!=1:raise RuntimeError('unambiguous original filesystem type not supplied')
    return types.pop()


def capture(work):
    result=dict(schema='YNX-PERF-RUNTIME-HARDWARE/v1',status='NOT_SUPPLIED',
                system=platform.system(),machine=platform.machine(),kernelRelease=platform.release(),
                cpuModels=None,effectiveAffinity=None,hostMemTotalBytes=None,filesystem=None,errors={},
                authorityGranted=False,admissionChanged=False,affinityChanged=False,
                sameHardwareAcrossRunsProven=False,
                meaning='Observed runtime conditions only. Host memory is not available memory or the owned RSS cap; filesystem type does not prove identical physical media or I/O contention.')
    if result['system']!='Linux':
        result['errors']['platform']='UNSUPPORTED_NON_LINUX';return result
    def observe(key,read):
        try:result[key]=read()
        except Exception as error:result['errors'][key]=type(error).__name__
    observe('cpuModels',lambda:cpu_models(bounded('/proc/cpuinfo',1<<20)))
    observe('effectiveAffinity',lambda:sorted(os.sched_getaffinity(0)))
    observe('hostMemTotalBytes',lambda:memory_bytes(bounded('/proc/meminfo',65536)))
    def storage():
        path=Path(work).resolve(strict=True);device=path.stat().st_dev;fs=os.statvfs(path)
        return dict(type=filesystem_type(bounded('/proc/self/mountinfo',1<<20),device),
                    volumeBytes=fs.f_blocks*fs.f_frsize,availableBytes=fs.f_bavail*fs.f_frsize,
                    fragmentBytes=fs.f_frsize)
    observe('filesystem',storage)
    result['status']='PARTIAL' if result['errors'] else 'OBSERVED'
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir',type=Path,required=True)
    args=parser.parse_args();print(json.dumps(capture(args.workdir),indent=2))
