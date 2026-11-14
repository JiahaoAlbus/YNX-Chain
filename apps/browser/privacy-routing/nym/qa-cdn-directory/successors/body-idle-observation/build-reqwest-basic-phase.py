"""Link a single diagnostic to the exact already-built Nym release cache."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
EVIDENCE = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113')
RELEASE = EVIDENCE / 'exact-qa-release'
WORK = EVIDENCE / 'reqwest-basic-direct-control'
PROOF = RELEASE / 'build-reconciled/receipt.json'
PROOF_SHA = '842f5ae703082b8a1c0cda5a715cc8e74b4369ed9a09473f52a8564b6ab41906'
LOCK_SHA = '29275bf9e41f6d6acad87f4737b5640e89ada39e0d7752a9211d04fec7871558'
RUSTC_SHA = '4f26ad57dcb9b12f9791317a1387e3e8d6ad803d4bd20fcdc65142a91e903d45'


def sha(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for part in iter(lambda: stream.read(1048576), b''):
            digest.update(part)
        return digest.hexdigest()


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if sha(PROOF) != PROOF_SHA or sha(RELEASE / 'source/Cargo.lock') != LOCK_SHA:
        raise RuntimeError('exact-Nym-release-or-Cargo-lock-pin')
    old = json.loads((RELEASE / 'BUILD_PROPOSAL.json').read_text())
    rustc = Path(old['environment']['RUSTC'])
    if sha(rustc) != RUSTC_SHA:
        raise RuntimeError('rustc-pin')
    cache = RELEASE / 'target/release'
    resolver = load(HERE / 'test-body-idle-observation.py')
    resolved = resolver.dependencies(cache)
    rl = resolved['reqwest']
    fp = cache / '.fingerprint'
    reqwest = rl.name.removeprefix('lib').removesuffix('.rlib')
    if reqwest != 'reqwest-e4f0e5a21722ffa0':
        raise RuntimeError('reqwest-0.13.4-cohort-pin')
    tags = json.loads((fp / reqwest / 'lib-reqwest.json').read_text())['deps']

    def artifact(name, value=None):
        candidates = [cache / ('deps/lib' + name + '-' + p.parent.name.rsplit('-', 1)[1] + '.rlib')
                      for p in fp.glob('*/lib-' + name)
                      if value is None or int.from_bytes(bytes.fromhex(p.read_text().strip()), 'little') == value]
        candidates = [p for p in candidates if p.is_file()]
        if len(candidates) != 1:
            raise RuntimeError('exact-cohort-candidate-count:' + name)
        return candidates[0]

    needed = {'rustls', 'tower_service', 'tower', 'tokio_rustls'}
    cohort = {name: artifact(name, tag) for _, name, _, tag in tags if name in needed}
    if set(cohort) != needed:
        raise RuntimeError('expected-Reqwest-dependency-edges')
    tower = cohort['tower'].name.removeprefix('lib').removesuffix('.rlib')
    dep = json.loads((fp / tower / 'lib-tower.json').read_text())['deps']
    cohort['tower_layer'] = artifact('tower_layer', next(item[3] for item in dep if item[1] == 'tower_layer'))
    roots = {name: value for name, value in resolved.items() if name in ('tokio','reqwest','serde_json','original_http')}
    roots.update({name: path for name, path in cohort.items() if name != 'tower'})
    if (not sys.dont_write_bytecode or Path.cwd() != WORK or os.environ.get('TMPDIR') != str(WORK)
            or WORK.stat().st_dev == Path('/Users/huangjiahao').stat().st_dev):
        raise RuntimeError('build-output-not-isolated')
    src = HERE / 'reqwest-basic-phase-control.rs'
    bin_path = WORK / 'reqwest-basic-phase-control'
    if bin_path.exists():
        raise RuntimeError('diagnostic-binary-already-exists')
    args = [str(rustc), '--edition=2021', '-C', 'panic=abort', '-C', 'strip=none',
            '-L', 'dependency=' + str(cache / 'deps'), str(src), '-o', str(bin_path)]
    args += [part for name,path in sorted(roots.items()) for part in ('--extern',name+'='+str(path))]
    env = {'PATH':'/usr/bin:/bin','TMPDIR':str(WORK),'SDKROOT':old['environment']['SDKROOT']}
    start = time.monotonic()
    p = None
    error = None
    with (WORK / 'rustc.stdout').open('xb') as stdout, (WORK / 'rustc.stderr').open('xb') as stderr:
        p = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
        print(json.dumps({'actualRustcPID': p.pid, 'pgid': p.pid, 'monotonicStart':start}), flush=True)
        try:
            p.wait(timeout=30)
        except BaseException as first:
            error = type(first).__name__
            p.kill()
            p.wait(timeout=3)
    report = {'schema':'P05_NYM_REQWEST_BASIC_PHASE_LINK_V1','seconds':time.monotonic()-start,
              'sourcePin':sha(src),'rustcPID':p.pid,'originalWait':p.returncode,'firstFailure':error,
              'binarySHA256':sha(bin_path) if p.returncode == 0 else None,
              'dependencySHA256':{name:sha(path) for name,path in roots.items()},'argv':args,'cargoStarted':False,'publicNetwork':False}
    dest = WORK / 'LINK_RESULT.json'
    with dest.open('x') as fd:
        json.dump(report,fd,indent=2)
        fd.write('\n')
    print(json.dumps({'linkResult':str(dest),'SHA256':sha(dest),'exit':p.returncode,'binarySHA256':report['binarySHA256']}),flush=True)
    return int(bool(error or p.returncode))


if __name__ == '__main__':
    raise SystemExit(main())
