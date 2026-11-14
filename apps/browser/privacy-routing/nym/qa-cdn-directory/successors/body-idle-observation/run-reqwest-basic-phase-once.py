"""Supervise a single exact Reqwest comparison and persist finite telemetry only."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import subprocess
import sys
import time

WORK = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113/reqwest-basic-direct-control')
PINNED = {'binary': '60fb738c5be8813e3976e0efbaed64b2d2153219c830ba1f936bb9f3929486b5',
          'link': '1d3f38312eea2b2e0c3222efceaac88b79a0c68fdfaaa99a55acf9df101fb167',
          'fixture': '9613a858c027a9cf866b84cb0c8de023886a0d976c58a6d2a1150154ef091d9b',
          'platform': 'a6d87d20324b6b7f07ed72775dd6ec5055c82f70c6fec75bddd25214e34bb5b9'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open('x') as file:
        os.fchmod(file.fileno(), 0o600)
        json.dump(value,file,indent=2)
        file.write('\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--scope-sha256',required=True)
    args = p.parse_args()
    if (not sys.dont_write_bytecode or Path.cwd() != WORK or os.environ.get('TMPDIR') != str(WORK)
            or WORK.stat().st_dev == Path('/Users/huangjiahao').stat().st_dev):
        raise RuntimeError('external-output-isolation')
    files = {'binary':WORK/'reqwest-basic-phase-control','link':WORK/'LINK_RESULT.json',
             'fixture':WORK/'FIXTURE_RESULT.json',
             'platform':WORK.parent/'header-phase-get-external-only/one-basic-get/result.json'}
    for key,path in files.items():
        if path.is_symlink() or sha(path) != PINNED[key]:
            raise RuntimeError('input-pin-'+key)
    scope = WORK/'SCOPE.json'
    st = scope.lstat()
    if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_nlink != 1
            or stat.S_IMODE(st.st_mode) != 0o600 or st.st_size > 4096 or sha(scope) != args.scope_sha256):
        raise RuntimeError('scope-identity')
    pins = json.loads(scope.read_text())
    if (set(pins) != {'schema','inputSHA256','runnerSHA256','notBefore','latestStart'}
            or pins['schema'] != 'P05_NYM_REQWEST_BASIC_ONCE_SCOPE_V1' or pins['inputSHA256'] != PINNED
            or pins['runnerSHA256'] != sha(Path(__file__))
            or type(pins['notBefore']) is not int or type(pins['latestStart']) is not int
            or not 0 < pins['latestStart'] - pins['notBefore'] <= 900
            or not pins['notBefore'] <= time.time() < pins['latestStart']):
        raise RuntimeError('scope-expired-or-shape')
    fs = os.statvfs(WORK)
    if fs.f_bavail * fs.f_frsize < 16 * 1024**3:
        raise RuntimeError('external-free-space')
    case = WORK/'public-once'
    case.mkdir(mode=0o700)
    resource.setrlimit(resource.RLIMIT_FSIZE,(32768,32768))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    begin = time.monotonic()
    utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
    env = {'PATH':'/usr/bin:/bin','TMPDIR':str(case)}
    failure = None
    metrics = None
    with (case/'stdout.jsonl').open('xb') as stdout, (case/'stderr.log').open('xb') as stderr:
        child = subprocess.Popen([str(files['binary']),'public'],cwd=case,env=env,stdin=subprocess.DEVNULL,
                                 stdout=stdout,stderr=stderr,start_new_session=True)
        start = dict(pid=child.pid,pgid=child.pid,monotonicStart=begin,utc=utc,scopeSHA256=args.scope_sha256)
        write(case/'START.json',start)
        print(json.dumps(start),flush=True)
        try:
            child.wait(timeout=24)
        except BaseException as error:
            failure = {'kind':type(error).__name__}
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGKILL)
            child.wait(timeout=3)
    ps = subprocess.run(['/bin/ps','-axo','pid=,pgid='],capture_output=True,text=True,timeout=3,check=True)
    remaining = [int(parts[0]) for line in ps.stdout.splitlines()
                 if len(parts:=line.split())==2 and int(parts[1])==child.pid]
    try:
        metrics = json.loads((case/'stdout.jsonl').read_bytes())
        if (metrics['schema']!='P05_NYM_REQWEST_BASIC_PHASE_V1' or metrics['mode']!='public'
                or metrics['retainedBodyBytes']!=0 or not 0<=metrics['observedBodyBytes']<=4096
                or metrics['fullDirectoryAccepted'] is not False or metrics['rawResponsePersisted'] is not False):
            raise ValueError('finite-metrics-contract')
    except (KeyError,TypeError,ValueError):
        metrics = None
        failure = failure or {'kind':'missing-finite-observation'}
    result = dict(schema='P05_NYM_REQWEST_BASIC_ONCE_TERMINAL_V1',start=start,elapsedSeconds=time.monotonic()-begin,
                  originalWait=child.returncode,remainingOwned=remaining,metrics=metrics,
                  scopeSHA256=args.scope_sha256,experimentalFailure=failure,
                  binarySHA256=PINNED['binary'],sameEndpointPlatformGET=PINNED['platform'],
                  stdoutClosed=stdout.closed,stderrClosed=stderr.closed,
                  stderrBytes=(case/'stderr.log').stat().st_size,fullDirectoryAccepted=False,productionAuthority=False)
    dest=case/'RESULT.json'
    write(dest,result)
    print(json.dumps({'result':str(dest),'SHA256':sha(dest),'evidence':result}),flush=True)
    return int(bool(failure or remaining or child.returncode))


if __name__=='__main__':
    raise SystemExit(main())
