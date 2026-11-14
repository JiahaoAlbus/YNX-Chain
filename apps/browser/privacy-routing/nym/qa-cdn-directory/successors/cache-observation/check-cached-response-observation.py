"""Compile the patched QA module and test finite response output without network."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import signal
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
EVIDENCE = Path('/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/nym-directory-body-idle-20261113')
RELEASE = EVIDENCE / 'exact-qa-release'
LINK = EVIDENCE / 'reqwest-basic-direct-control/LINK_RESULT.json'
LINK_HASH = '1d3f38312eea2b2e0c3222efceaac88b79a0c68fdfaaa99a55acf9df101fb167'
RUSTC_HASH = '4f26ad57dcb9b12f9791317a1387e3e8d6ad803d4bd20fcdc65142a91e903d45'
SDK = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.2.sdk'
OUTPUT_CAP = 64 * 1024 * 1024
RSS_CAP = 768 * 1024 * 1024
GIB = 1024 * 1024 * 1024


def sha(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for part in iter(lambda: stream.read(1048576), b''):
            digest.update(part)
        return digest.hexdigest()


def require(path, digest):
    if path.is_symlink() or not path.is_file() or sha(path) != digest:
        raise ValueError('cache-or-source-pin:' + str(path))


def load_observer():
    spec = importlib.util.spec_from_file_location('cache_terminal_observer', HERE / 'observe-headers.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def processes():
    rows = subprocess.run(['/bin/ps', '-axo', 'pid=,pgid=,rss='], check=True, capture_output=True, text=True, timeout=3)
    return [tuple(map(int, line.split())) for line in rows.stdout.splitlines() if line.strip()]


def stage(out, source):
    pinned = json.loads((HERE / 'source-pin.json').read_text())
    require(RELEASE / 'source-manifest.json', pinned['originalSourceManifestSHA256'])
    require(RELEASE / 'source/Cargo.lock', pinned['cargoLockSHA256'])
    require(HERE / 'cache-observation.patch', pinned['patchSHA256'])
    require(HERE / 'observe-headers.py', pinned['observerSHA256'])
    require(LINK, LINK_HASH)
    paths = {}
    for relative, details in pinned['files'].items():
        original = RELEASE / 'source' / relative
        if details['before'] is not None:
            require(original, details['before'])
        elif original.exists() or original.is_symlink():
            raise ValueError('unexpected-original-source-leaf:' + str(original))
        leaf = HERE / 'overlay' / relative
        require(leaf, details['after'])
        paths[leaf.name] = leaf
    original = json.loads(LINK.read_text())
    arg = original['argv']
    rustc = Path(arg[0])
    require(rustc, RUSTC_HASH)
    names = {'original_http','reqwest','tokio','serde_json'}
    deps_dir = RELEASE / 'target/release/deps'
    deps = {}
    for index, value in enumerate(arg[:-1]):
        if value != '--extern':
            continue
        name, raw = arg[index + 1].split('=',1)
        if name in names:
            path = Path(raw)
            if path.parent != deps_dir:
                raise ValueError('dependency-outside-exact-cache')
            require(path, original['dependencySHA256'][name])
            deps[name] = path
    if set(deps) != names:
        raise ValueError('cache-input-set')
    fingerprints = deps_dir.parent / '.fingerprint'
    manifest = fingerprints / 'nym-http-api-client-a8117eb90adc169d/lib-nym_http_api_client.json'
    rows = json.loads(manifest.read_text())['deps']
    for name in ('serde', 'http', 'tracing'):
        fingerprint = next(item[3] for item in rows if item[1] == name)
        candidates = [deps_dir / ('lib' + name + '-' + f.parent.name.rsplit('-', 1)[-1] + '.rlib')
                      for f in fingerprints.glob('*/lib-' + name)
                      if int.from_bytes(bytes.fromhex(f.read_text().strip()), 'little') == fingerprint]
        if len(candidates) != 1 or candidates[0].is_symlink() or not candidates[0].is_file():
            raise ValueError('dependency-fingerprint:' + name)
        deps[name] = candidates[0]

    (out / 'qa_directory.rs').write_bytes(paths['qa_directory.rs'].read_bytes())
    (out / 'module.rs').write_text(
        'pub use original_http::{expiry_deadline,reviewed_network,tls};\n'
        '#[path="qa_directory.rs"] pub mod qa_directory;\n')
    (out / 'qa_cache_observation.rs').write_bytes(paths['qa_cache_observation.rs'].read_bytes())
    (out / 'fixture.rs').write_bytes(source.read_bytes())
    return rustc, deps_dir, deps, pinned


def run(args, out, label, timeout):
    env = {'PATH': '/usr/bin:/bin', 'TMPDIR': str(out), 'SDKROOT': SDK}
    started = time.monotonic()
    peak = 0
    failure = None
    with (out / (label + '.stdout')).open('xb') as stdout, (out / (label + '.stderr')).open('xb') as stderr:
        child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                 cwd=out, env=env, start_new_session=True)
        print(json.dumps({'stage':label,'pid':child.pid,'pgid':child.pid}),flush=True)
        try:
            while child.poll() is None:
                peak = max(peak, sum(rss for _,pgid,rss in processes() if pgid == child.pid) * 1024)
                allocated = sum(p.stat().st_blocks * 512 for p in out.iterdir() if p.is_file())
                if (peak > RSS_CAP or allocated > OUTPUT_CAP or time.monotonic()-started >= timeout):
                    raise RuntimeError('lightweight-probe-resource-cap')
                time.sleep(.25)
        except BaseException as error:
            failure = type(error).__name__ + ': ' + str(error)
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
        finally:
            child.wait(timeout=3)
    remaining = [pid for pid,pgid,_ in processes() if pgid == child.pid]
    return {'stage':label,'pid':child.pid,'pgid':child.pid,'originalWait':child.returncode,
            'remainingOwned':remaining,'seconds':time.monotonic()-started,
            'sampledPeakRSSBytes':peak,'firstFailure':failure,'argv':args}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--out', type=Path, required=True)
    cli.add_argument('--metadata-only', action='store_true')
    args = cli.parse_args()
    out = args.out
    device = EVIDENCE.stat().st_dev
    if (not sys.dont_write_bytecode or out.parent.resolve() != EVIDENCE or out.parent.stat().st_dev != device
            or device == Path('/Users/huangjiahao').stat().st_dev or not out.is_absolute()):
        raise RuntimeError('isolated-external-output')
    out.mkdir(mode=0o700)
    resource.setrlimit(resource.RLIMIT_CORE, (0,0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_CAP, OUTPUT_CAP))

    source = HERE / 'cached-response-fixture.rs'
    rustc, deps_dir, deps, pinned = stage(out, source)
    binary = out / 'response-fixture'
    base = [str(rustc),'--edition=2021','-C','panic=abort','-C','strip=none','-L','dependency=' + str(deps_dir)]
    if args.metadata_only:
        rust_args = base + ['--crate-type','lib','--emit=metadata','--cfg','test',str(out/'module.rs'),'-o',str(out/'module.rmeta')]
        selected = deps
    else:
        rust_args = base + [str(out/'fixture.rs'),'-o',str(binary)]
        selected = {key: deps[key] for key in ('reqwest','serde','serde_json','http')}
    rust_args += [part for name,path in sorted(selected.items()) for part in ('--extern',name+'='+str(path))]
    stages = []
    result = None
    try:
        stages.append(run(rust_args,out,'rustc',30))
        if any((stages[-1]['originalWait'],stages[-1]['remainingOwned'],stages[-1]['firstFailure'])):
            return 1
        if args.metadata_only:
            return 0
        stages.append(run([str(binary)],out,'fixture',5))
        if any((stages[-1]['originalWait'],stages[-1]['remainingOwned'],stages[-1]['firstFailure'])):
            return 1
        stdout = (out/'fixture.stdout').read_bytes()
        stderr = (out/'fixture.stderr').read_bytes()
        obs = load_observer()
        result = obs.read_observations(stderr,'qa-dir-' + '1'*32,terminal_capture_complete=True)
        assert stdout == b'response-fixture-complete\n'
        assert result and len(result) == 1 and result[0]['ageSeconds']['value'] == 30 and result[0]['responseElapsedMs'] == 42
        assert result[0]['cacheControl']['value']['maxAge'] == 60
        assert not result[0]['cacheControl']['value']['private'] and not result[0]['cacheControl']['value']['noStore']
        assert b'fixture-secret' not in stderr and b'never emit' not in stderr and b'x-hidden' not in stderr
        return 0
    finally:
        report = {'schema':'P05_NYM_QA_CACHED_HTTP_RESPONSE_CHECK_V1','stages':stages,'observations':result,
                  'sourceSHA256':{k:v['after'] for k,v in pinned['files'].items()},
                  'compiledFixtureSHA256':sha(binary) if binary.is_file() else None,
                  'dependencySHA256':{name:sha(path) for name,path in selected.items()},
                  'metadataOnly':args.metadata_only,
                  'compiledMetadataSHA256':sha(out/'module.rmeta') if (out/'module.rmeta').is_file() else None,
                  'rustcSHA256':RUSTC_HASH,'patchedVendorArtifact':False,
                  'publicNetwork':False,'cargoStarted':False,'loopbackNetwork':False}
        receipt = out/'RESULT.json'
        with receipt.open('x') as stream:
            json.dump(report,stream,indent=2)
            stream.write('\n')
        print(json.dumps({'result':str(receipt),'SHA256':sha(receipt)}),flush=True)


if __name__=='__main__':
    raise SystemExit(main())
