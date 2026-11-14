#!/usr/bin/env python3
"""Compile one QA transport module against the matching cached Nym dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
QA = HERE.parents[2]
OLD_SOURCE_SHA = '70767b79c258e8c90d1f7575b1c08db546080cf6da040ef2f0d9ef991e573532'
HTTP_CRATE = 'nym-http-api-client'
HTTP_MODULE = 'nym_http_api_client'
RELATIVE_SOURCE = 'common/http-api-client/src/qa_directory.rs'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dependencies(target):
    fingerprint = target/'.fingerprint'
    deps = target/'deps'

    def find(name, value):
        candidates = [deps/('lib'+name+'-'+p.parent.name.rsplit('-', 1)[1]+'.rlib')
                      for p in fingerprint.glob('*/lib-'+name)
                      if int.from_bytes(bytes.fromhex(p.read_text().strip()), 'little') == value]
        if len(candidates) != 1 or not candidates[0].is_file():
            raise ValueError('ambiguous cache dependency '+name)
        return candidates[0]

    candidates = []
    for path in fingerprint.glob(HTTP_CRATE+'-*/lib-'+HTTP_MODULE+'.json'):
        info = json.loads(path.read_text())
        if '"ynx-qa-directory"' in info['features']:
            artifact = deps/('lib'+HTTP_MODULE+'-'+path.parent.name.rsplit('-',1)[1]+'.rlib')
            if artifact.is_file():
                candidates.append((artifact, info))
    if len(candidates) != 1:
        raise ValueError('expected exactly one cached HTTP QA feature build')
    original, build = candidates[0]
    names = {'tokio','reqwest','serde','serde_json','tracing'}
    roots = {name: find(name, fingerprint_hash) for _,name,_,fingerprint_hash in build['deps'] if name in names}
    # Tokio can be a transitive edge of the original HTTP crate.
    if 'tokio' not in roots and 'reqwest' in roots:
        reqwest = roots['reqwest'].name.removeprefix('lib').removesuffix('.rlib')
        info = json.loads((fingerprint/reqwest/'lib-reqwest.json').read_text())
        roots['tokio'] = find('tokio', next(row[3] for row in info['deps'] if row[1]=='tokio'))
    if set(roots) != names:
        raise ValueError('original HTTP crate dependency shape')
    return {'original_http':original, **roots}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--release-cache', type=Path, required=True)
    parser.add_argument('--rustc', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    baseline = args.source_root/RELATIVE_SOURCE
    successor = HERE/'overlay'/RELATIVE_SOURCE
    test = HERE/'body_idle_checks.rs.in'
    consumer = QA/'qa-glue/qa_directory_body_failure.py'
    pins = {str(p):sha(p) for p in (baseline,successor,test,consumer,args.rustc)}
    if pins[str(baseline)] != OLD_SOURCE_SHA:
        raise ValueError('original transport source pin')
    roots = dependencies(args.release_cache)
    args.out.mkdir(mode=0o700)
    replacement = args.out/'candidate.rs'
    replacement.write_text(successor.read_text()+'\n'+test.read_text())
    wrapper = args.out/'runner.rs'
    wrapper.write_text('pub use original_http::{expiry_deadline,tls,reviewed_network};\n'
                       '#[path="candidate.rs"] mod candidate;\n'
                       'fn main() { tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()'
                       '.block_on(candidate::body_idle_fixture()); }\n')
    binary = args.out/'body-idle-controls'
    compile_command = [str(args.rustc),'--edition=2021','--cfg','test','-C','panic=abort','-C','strip=none',
                       '-L','dependency='+str(args.release_cache/'deps'),str(wrapper),'-o',str(binary)]
    compile_command += [part for name,path in roots.items() for part in ('--extern',name+'='+str(path))]
    steps = []
    first = None
    try:
        for label, command, timeout in [('compile',compile_command,25),('fixture',[str(binary)],8)]:
            with (args.out/(label+'.stdout')).open('xb') as stdout,(args.out/(label+'.stderr')).open('xb') as stderr:
                with subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,start_new_session=True) as process:
                    step = {'label':label,'argv':command,'pid':process.pid}
                    steps.append(step)
                    try:
                        result = process.wait(timeout=timeout)
                    finally:
                        if process.poll() is None:
                            process.kill()
                        process.wait(timeout=3)
                        step.update(exit=process.returncode,reaped=True)
            if result:
                raise RuntimeError(label+'-exit-'+str(result))
        sys.path.insert(0,str(consumer.parent))
        from qa_directory_body_failure import PREFIX, public_body_failure
        lines = [line for line in (args.out/'fixture.stdout').read_bytes().splitlines() if line.startswith(PREFIX)]
        assert len(lines)==2
        run = 'qa-dir-11111111111111111111111111111111'
        reasons = ['qa-directory-body-idle']
        reports = [public_body_failure(line,run,reasons,terminal_capture_complete=True) for line in lines]
        assert [p['receivedBodyBytes'] for p in reports] == [0,2]
        assert public_body_failure(b'\n'.join(lines),run,reasons,terminal_capture_complete=True) is None
        assert public_body_failure(lines[0],run,reasons,terminal_capture_complete=False) is None
        assert public_body_failure(lines[0],run+'1',reasons,terminal_capture_complete=True) is None
        assert public_body_failure(lines[0],run,[],terminal_capture_complete=True) is None
        assert pins == {name:sha(Path(name)) for name in pins}
        print('PASS local reqwest first byte, partial idle, complete body, transport timeout, absolute expiry and frame parsing')
    except BaseException as error:
        first = {'type':type(error).__name__,'message':str(error)}
        raise
    finally:
        (args.out/'RESULT.json').write_text(json.dumps({'sourcePins':pins,'steps':steps,'firstFailure':first,
              'dependencyArtifacts':{name:{'path':str(path),'sha256':sha(path)} for name,path in roots.items()},
              'publicNetworkUsed':False,'vendorRebuilt':False,'controlledHTTPFixture':'numeric loopback'},indent=2)+'\n')


if __name__ == '__main__':
    main()
