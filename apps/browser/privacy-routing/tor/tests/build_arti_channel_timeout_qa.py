#!/usr/bin/env python3
"""Parent-resource-guard-only offline build of one reviewed derived QA Arti.

Does not launch Arti/PT or make a website request. Requires the original fixed
toolchain/cache; missing offline inputs stop without source/toolchain fallback.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

SOURCE = 'a72764db4438ec7b4132307bc98932225183e9bdeb1b677731c08ad307d27270'
FBB = 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a'
CARGO = '03e381389f5b7b8e695a744362f3866478f99034b2cf2df6afd4d42cfdab6f67'
RUSTC = '12cab30aa9890d54445e29149a1e82d18fbe457de12801bd11bbe7e5e7fe33a0'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'supply', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    source, supply = args.source.resolve(strict=True), args.supply.resolve(strict=True)
    output = args.output.absolute()
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    manifest = source / 'SOURCE-INPUTS.json'
    if digest(manifest) != SOURCE:
        raise ValueError('reviewed derived source manifest rejected')
    pins = json.loads(manifest.read_text())['sourceFiles']

    def drift():
        return [name for name, h in pins.items() if not (source / name).is_file() or digest(source / name) != h]

    tooling = supply / 'tooling/rustup/toolchains/1.92.0-aarch64-apple-darwin/bin'
    cargo, rustc = tooling / 'cargo', tooling / 'rustc'
    if drift() or digest(cargo) != CARGO or digest(rustc) != RUSTC or digest(supply / 'artifact/arti') != FBB:
        raise ValueError('source/toolchain/original artifact drift')
    target = output / 'target'
    env = dict(os.environ, CARGO_HOME=str(supply / 'build/cargo-home'),
               CARGO_TARGET_DIR=str(target), CARGO_NET_OFFLINE='true',
               PATH=str(tooling) + ':/usr/bin:/bin', RUSTFLAGS='-Cstrip=none',
               RUSTC=str(rustc), CARGO_BUILD_JOBS='1')
    for key in list(env):
        if key in ('CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER',
                   'RUSTC_BOOTSTRAP', 'CARGO_BUILD_TARGET') or key.startswith(('CARGO_PROFILE_', 'CARGO_TARGET_')):
            if key != 'CARGO_TARGET_DIR':
                env.pop(key, None)
    # HOME is inherited, never replaced. Parent supplies a short owned TMPDIR.
    result = dict(schema='P05_DERIVED_ARTI_CHANNEL_TIMEOUT_OFFLINE_BUILD_V1',
                  status='FAIL', sourceInputsSHA256=SOURCE, stages=[],
                  sourceDrift=[], network='NOT_RUN', backend='NOT_RUN',
                  normalAdmission='UNCHANGED_BLOCKED', originalArtiSHA256=FBB)
    steps = [('offline-locked-metadata', [str(cargo), 'metadata', '--offline', '--locked', '--format-version=1', '--no-deps'], 30),
             ('derived-qa-release-build', [str(cargo), 'build', '--offline', '--locked', '--release', '--jobs', '1'], 840)]
    for name, argv, budget in steps:
        if drift():
            result['firstCause'] = 'source drift before ' + name
            break
        began = time.monotonic()
        process = subprocess.Popen(argv, cwd=source / 'root', env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timed = False
        try:
            stdout, stderr = process.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timed = True
            process.terminate()
            try:
                stdout, stderr = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate(timeout=3)
        (output / (name + '.stdout')).write_bytes(stdout)
        (output / (name + '.stderr')).write_bytes(stderr)
        result['stages'].append(dict(stage=name, argv=argv, pid=process.pid,
                                     exit=process.returncode, reaped=process.poll() is not None,
                                     seconds=time.monotonic() - began, timeout=timed))
        if process.returncode != 0 or timed:
            result['firstCause'] = name
            break
        if drift():
            result['firstCause'] = 'locked metadata/build changed source or expected lock'
            break
        if name == 'offline-locked-metadata':
            metadata = json.loads(stdout)
            if Path(metadata['workspace_root']).resolve() != source / 'root' or Path(metadata['target_directory']).resolve() != target:
                result['firstCause'] = 'Cargo workspace/target binding mismatch'
                break
    else:
        artifact = output / 'ArtiPublicChannelTimeout30'
        shutil.copy2(target / 'release/arti', artifact)
        artifact.chmod(0o700)
        pin = digest(artifact)
        if pin == FBB:
            result['firstCause'] = 'derived artifact unexpectedly equals original byte pin'
        else:
            content = dict(schema='P05_DERIVED_ARTI_PUBLIC_CHANNEL_TIMEOUT_ARTIFACT_V1',
                           artiSHA256=pin, sourceInputsSHA256=SOURCE, baseArtiSHA256=FBB,
                           baseSourceArchiveSHA256='a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813',
                           nonDirectSeconds=30, directSeconds=5)
            (output / 'manifest.json').write_text(json.dumps(content, sort_keys=True, separators=(',', ':')))
            result['artifact'] = dict(path=str(artifact), sha256=pin,
                                      manifestSHA256=digest(output / 'manifest.json'))
            result['status'] = 'PASS_DERIVED_QA_ONLY_NOT_RUN'
    result['sourceDrift'] = drift()
    result['originalArtifactUnchanged'] = digest(supply / 'artifact/arti') == FBB
    if result['sourceDrift'] or not result['originalArtifactUnchanged']:
        result['status'] = 'FAIL'
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status=result['status'], firstCause=result.get('firstCause'))))
    return 0 if result['status'] == 'PASS_DERIVED_QA_ONLY_NOT_RUN' else 1


if __name__ == '__main__':
    raise SystemExit(main())
