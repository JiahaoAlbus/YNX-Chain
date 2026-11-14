#!/usr/bin/env python3
"""Extract the actual PUBLIC route fence and child owner for a harmless executable test."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile


def local_output(argv):
    return subprocess.check_output(argv, text=True, timeout=5).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    output = parser.parse_args().output.absolute()
    output.mkdir(mode=0o700)
    (output/'tmp').mkdir(mode=0o700)
    tests = Path(__file__).resolve().parent
    sources = tests.parents[2]/'native/Sources'
    native = sources/'YNXBrowserNative'
    paths = {'runtime': native/'NymPublicSearchRuntime.swift',
             'protected': native/'NymProtectedRouteProvider.swift',
             'core': sources/'YNXBrowserCore/NymRouteAdapter.swift',
             'fixture': tests/'NymPublicRouteLossChecks.swift'}
    inputs = {name:path.read_bytes() for name,path in paths.items()}
    runtime = inputs['runtime'].decode()
    runtime = runtime[runtime.index('enum NymPublicSearchRole {'):runtime.index('/// A once-only fresh PUBLIC vendor operation.')]
    protected = inputs['protected'].decode().split('final class NymObservedStartupLine {',1)[1].split('/// Restricted background role',1)[0]
    core = inputs['core'].decode().split('public final class NymBootstrapMarker:',1)[1].split('/// Shares the same advisory profile lease',1)[0]
    components = output/'ActualRouteFenceAndChild.swift'
    components.write_text('import Foundation\nimport CoreFoundation\nimport CryptoKit\nimport Darwin\n'+runtime
                          +'\nfinal class NymObservedStartupLine {'+protected+'\npublic final class NymBootstrapMarker:'+core)
    fixture = output/'NymPublicRouteLossChecks.swift'
    fixture.write_bytes(inputs['fixture'])
    harmless = output/'owned-exit-fixture'
    harmless.write_text('#!/bin/sh\nprintf fixture\nprintf stderr-fixture >&2\nexit 7\n')
    harmless.chmod(0o700)
    compiler = local_output(['/usr/bin/xcrun','--find','swiftc'])
    sdk = local_output(['/usr/bin/xcrun','--sdk','macosx','--show-sdk-path'])
    arch = local_output(['/usr/bin/uname','-m'])
    steps = []
    first_failure = None
    executable = output/'route-loss-checks'
    try:
        with tempfile.TemporaryDirectory(prefix='ynx-nym-loss-',dir='/tmp') as alias:
            os.symlink(output/'tmp',Path(alias)/'tmp')
            env = dict(os.environ,TMPDIR=str(Path(alias)/'tmp')+'/')
            commands = [
                ('compile',[compiler,'-swift-version','6','-sdk',sdk,'-target',arch+'-apple-macosx14.0',
                            '-module-cache-path',str(output/'cache'),str(components),str(fixture),'-o',str(executable)],15),
                ('fixture',[str(executable),str(harmless)],7),
            ]
            for label, argv, timeout in commands:
                with (output/(label+'.stdout')).open('xb') as out, (output/(label+'.stderr')).open('xb') as err:
                    child = subprocess.Popen(argv,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
                    step = {'name':label,'pid':child.pid,'argv':argv}
                    steps.append(step)
                    try:
                        status = child.wait(timeout=timeout)
                    finally:
                        if child.poll() is None and os.getpgid(child.pid)==child.pid:
                            os.killpg(child.pid,signal.SIGKILL)
                        child.wait(timeout=3)
                        step.update(exit=child.returncode,reaped=child.returncode is not None)
                    if status:
                        raise RuntimeError(f'{label}-exit-{status}')
        if any(path.read_bytes()!=inputs[name] for name,path in paths.items()):
            raise RuntimeError('source-drift')
        if not (output/'fixture.stdout').read_text().startswith('PASS Nym PUBLIC path loss'):
            raise RuntimeError('fixture-receipt')
    except BaseException as error:
        first_failure = {'type':type(error).__name__,'message':str(error)}
        raise
    finally:
        pins = {str(path):hashlib.sha256(inputs[name]).hexdigest() for name,path in paths.items()}
        (output/'RESULT.json').write_text(json.dumps({'firstFailure':first_failure,'sourcePins':pins,'steps':steps},indent=2)+'\n')
    print((output/'fixture.stdout').read_text().strip())


if __name__=='__main__':
    main()
