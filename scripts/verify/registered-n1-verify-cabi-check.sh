#!/usr/bin/env bash
set -euo pipefail
umask 077

# Normal native CI only. Reuse the sealed, already executed SINGLE Go archive.
# This qualifier builds only a public fixture and its C caller, never an archive.
[[ $# == 2 && "$1" == /* && "$2" == /* ]] || { echo 'sealed native-host directory and fresh absolute N1 case required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd -- "$root"
python3 -B - "$root" "$1" "$2" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

INPUT_NAMES = (
    'member.bin', 'message.bin', 'network.bin', 'owner.txt', 'purpose.txt', 'pk-a.bin', 'pk-b.bin',
    'bad-sig-a.bin', 'bad-sig-b.bin', 'bad-leaf.bin', 'bad-message.bin', 'member-n2.bin',
    'bad-index.bin', 'bad-path-a.bin', 'bad-path-b.bin', 'bad-suite.bin', 'member-empty.bin',
    'member-revoke.bin', 'purpose-revoke.txt',
)
PUBLIC_NAMES = INPUT_NAMES + ('PUBLIC-INPUTS.json', 'N1-C-RESULT.json', 'C-BOUNDARY-CASES.txt')
CASES = 62
SUITE = 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512'
SOURCE_SCOPES = ('go.mod', 'go.sum', 'internal/ynxbatch', 'internal/ynxauth', 'internal/accountaddress',
    'cmd/ynx-artifact-release-cabi', 'scripts/fixtures/verify-registered-n1-cabi',
    'scripts/verify/registered-n1-verify-cabi-check.sh', 'scripts/ops/test_registered_n1_verify_cabi_supply.py',
    '.github/workflows/resource-market-ci.yml')
REQUIRED_SOURCES = (
    'cmd/ynx-artifact-release-cabi/registered_n1_verify.h',
    'cmd/ynx-artifact-release-cabi/registered_n1_verify_core.go',
    'cmd/ynx-artifact-release-cabi/registered_n1_verify_bridge.go',
    'cmd/ynx-artifact-release-cabi/registered_n1_verify_core_test.go',
    'scripts/fixtures/verify-registered-n1-cabi/main.go',
    'scripts/fixtures/verify-registered-n1-cabi/c/registered_n1_smoke.c',
    'scripts/verify/registered-n1-verify-cabi-check.sh',
    'scripts/ops/test_registered_n1_verify_cabi_supply.py',
)


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate public JSON field')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def same_json(actual, expected):
    # JSON booleans must never satisfy integer fields through Python equality.
    return json.dumps(actual, sort_keys=True, separators=(',', ':')) == json.dumps(expected, sort_keys=True, separators=(',', ':'))


def identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def directory(path, private=False):
    info = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid(), 'canonical owned directory required')
    require(not private or stat.S_IMODE(info.st_mode) == 0o700, 'private directory required')
    return identity(info)


def pin(path, maximum=128 << 20, private=False):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.geteuid()
            and 0 < before.st_size <= maximum, 'bounded owned single-link public file required')
    require(not private or stat.S_IMODE(before.st_mode) == 0o600, 'public DATA mode0600 required')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        require(identity(os.fstat(source.fileno())) == identity(before), 'public file open identity changed')
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
        require(identity(os.fstat(source.fileno())) == identity(before), 'public file changed while hashing')
    require(identity(path.lstat()) == identity(before), 'public file path changed')
    return dict(bytes=before.st_size, sha256=digest)


def read_public(path, maximum):
    expected = pin(path, maximum, private=True)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        raw = source.read(maximum + 1)
    require(len(raw) == expected['bytes'] and hashlib.sha256(raw).hexdigest() == expected['sha256']
            and pin(path, maximum, private=True) == expected, 'public file read changed')
    return raw


def write_new(path, raw):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as sink:
        require(sink.write(raw) == len(raw), 'short public DATA write')
        sink.flush()
        os.fsync(sink.fileno())


def copy_public(source, target, expected):
    require(pin(source) == expected, 'original public copy input changed')
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as reader:
        with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as writer:
            while True:
                chunk = reader.read(256 << 10)
                if not chunk:
                    break
                require(writer.write(chunk) == len(chunk), 'short public copy')
            writer.flush()
            os.fsync(writer.fileno())
    require(pin(source) == expected and pin(target, private=True) == expected, 'public copy bytes differ')


def command(arguments, timeout=30, environment=None):
    result = subprocess.run(arguments, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    # No private inputs enter these fixed commands. Preserve first failure as a
    # failure; do not retry, use another archive, or turn it into a qualification.
    require(len(result.stdout) <= 1 << 20 and len(result.stderr) <= 1 << 20, 'bounded public command output exceeded')
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise RuntimeError('registered N1 fixed command failed: ' + arguments[0])
    return result.stdout


def validate_parent(parent, environment, host, tree, archive_pin):
    require(type(parent) is dict and parent.get('version') == 'YNX-ARTIFACT-RELEASE-CABI-CANDIDATE/v1', 'original archive SOURCE version required')
    for key, name in (('commit', 'GITHUB_SHA'), ('runId', 'GITHUB_RUN_ID'), ('runAttempt', 'GITHUB_RUN_ATTEMPT'),
                      ('job', 'GITHUB_JOB'), ('matrixRunner', 'YNX_NATIVE_MATRIX_RUNNER'), ('runnerOS', 'RUNNER_OS')):
        require(parent.get(key) == environment[name], 'same-job original archive SOURCE required')
    require(parent.get('sourceTree') == tree and same_json(parent.get('host'), host)
            and same_json(parent.get('target'), host), 'same native source tree and target required')
    for key, expected in (('actualCABIExecuted', True), ('nativeHostCoreTestsPassed', True),
                          ('crossCompiled', False), ('privateMaterialIncluded', False)):
        require(parent.get(key) is expected, 'original native archive qualification differs')
    require(parent.get('abi') == 'YNXArtifactPublicationSignV1' and parent.get('suite') == SUITE
            and same_json(parent.get('archive'), archive_pin), 'original shared archive pin differs')


def validate_interop(raw):
    expected = dict(schema='ynx-registered-n1-cabi-public-interop/v1', actualCABI=True, cases=CASES,
                    fullANDChecks=2, N=1, index=0, authority=False, keysRead=False, signingByCABI=False)
    require(same_json(strict_json(raw), expected), 'exact independent Go N1 interop receipt required')
    return expected


def validate_public_inputs(path):
    directory(path, private=True)
    require({p.name for p in path.iterdir()} == set(PUBLIC_NAMES), 'closed22 public fixture catalog required')
    manifest = strict_json(read_public(path / 'PUBLIC-INPUTS.json', 16384))
    require(type(manifest) is list and len(manifest) == len(INPUT_NAMES), 'exact public input manifest required')
    for name, row in zip(INPUT_NAMES, manifest):
        require(same_json(row, dict(name=name, **pin(path / name, 98304, private=True))), 'original public input pin differs')
    result = strict_json(read_public(path / 'N1-C-RESULT.json', 1024))
    require(same_json(result, dict(version=1, structSize=32, verified=1, memberCount=1, index=0,
                                  cleanupStatus=0, reserved=0, cases=CASES, authority=False)), 'exact C result required')
    require(read_public(path / 'C-BOUNDARY-CASES.txt', 32) == (str(CASES) + '\n').encode('ascii'), 'exact C boundary count required')
    return {name: pin(path / name, 98304, private=True) for name in PUBLIC_NAMES}


def fixture_build_info(raw, host, commit):
    settings = {}
    for line in raw.decode('utf-8').splitlines():
        if line.startswith('\tbuild\t'):
            key, separator, value = line[len('\tbuild\t'):].partition('=')
            require(separator and key not in settings, 'invalid actual fixture Go build setting')
            settings[key] = value
    for key, value in {'GOOS': host['os'], 'GOARCH': host['arch'], 'CGO_ENABLED': '0',
                       '-trimpath': 'true', 'vcs.revision': commit, 'vcs.modified': 'false'}.items():
        require(settings.get(key) == value, 'actual public fixture Go identity differs')
    return dict(raw=raw.decode('utf-8'), settings=settings, executable='public-fixture-only', archiveBuildInfoClaimed=False)


def main():
    require(len(sys.argv) == 4, 'fixed normal native qualifier arguments required')
    root, original, case = map(Path, sys.argv[1:])
    directory(root)
    temp = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    require(original == temp / 'ynx-artifact-release-cabi/delivery/native-host'
            and case == temp / 'ynx-registered-n1-verify-cabi', 'fixed same-job original and new case paths required')
    original_identity = directory(original, private=True)
    directory(case.parent)
    require(not case.exists() and not case.is_symlink(), 'fresh exclusive N1 case required')
    require(re.fullmatch('[0-9a-f]{40}', os.environ['GITHUB_SHA']) is not None, 'full source commit required')
    commit = command(['git', 'rev-parse', 'HEAD']).decode().strip()
    tree = command(['git', 'rev-parse', 'HEAD^{tree}']).decode().strip()
    require(commit == os.environ['GITHUB_SHA'] and not command(['git', 'status', '--porcelain', '--untracked-files=normal']), 'clean selected source checkout required')
    observed = command(['go', 'env', 'GOHOSTOS', 'GOHOSTARCH', 'GOOS', 'GOARCH']).decode().splitlines()
    require(len(observed) == 4 and observed[:2] == observed[2:] and tuple(observed[:2]) in (('linux', 'amd64'), ('darwin', 'arm64')), 'actual Linux amd64 or Darwin arm64 native host required')
    host = dict(os=observed[0], arch=observed[1])
    archive = original / 'libynx_artifact_release.a'
    archive_pin = pin(archive, private=True)
    parent_pin = pin(original / 'SOURCE.json', 1 << 20, private=True)
    originals = {name: identity((original / name).lstat()) for name in ('libynx_artifact_release.a', 'SOURCE.json')}
    parent = strict_json(read_public(original / 'SOURCE.json', 1 << 20))
    validate_parent(parent, os.environ, host, tree, archive_pin)
    require(command(['go', 'version']).decode().strip() == parent['goVersion'], 'same original Go toolchain required')
    names = command(['git', 'ls-files', *SOURCE_SCOPES]).decode().splitlines()
    require(set(REQUIRED_SOURCES) <= set(names), 'complete tracked new N1 implementation and caller source required')
    sources = {name: dict(**pin(root / name), gitBlob=command(['git', 'rev-parse', 'HEAD:' + name]).decode().strip()) for name in names}
    for name in names:
        if name in parent['sources']:
            require(same_json(sources[name], parent['sources'][name]), 'shared archive source closure differs')
    require(same_json(parent['goMod'], pin(root / 'go.mod')) and same_json(parent['goSum'], pin(root / 'go.sum')), 'original module pins differ')
    module = strict_json(command(['go', 'list', '-m', '-json', 'github.com/cloudflare/circl']))
    require(module.get('Version') == 'v1.6.5' and not module.get('Replace')
            and same_json({k: module[k] for k in ('Path', 'Version', 'Sum', 'GoModSum') if k in module}, parent['circl']), 'fixed original CIRCL provider required')
    case.mkdir(mode=0o700)
    inputs = case / 'public-inputs'
    inputs.mkdir(mode=0o700)
    environment = dict(os.environ, CGO_ENABLED='0', GOOS=host['os'], GOARCH=host['arch'])
    fixture = case / 'fixture'
    command(['go', 'build', '-p', '1', '-trimpath', '-o', str(fixture), './scripts/fixtures/verify-registered-n1-cabi'], timeout=120, environment=environment)
    go_info = fixture_build_info(command(['go', 'version', '-m', str(fixture)]), host, commit)
    command([str(fixture), 'generate', str(inputs)], timeout=60)
    flags = ['-pthread', '-lm']
    if host['os'] == 'linux':
        flags += ['-ldl']
    else:
        flags += ['-framework', 'CoreFoundation', '-framework', 'Security']
    caller = case / 'registered-n1-c-driver'
    command(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', str(root / 'cmd/ynx-artifact-release-cabi'),
             str(root / 'scripts/fixtures/verify-registered-n1-cabi/c/registered_n1_smoke.c'), str(archive), *flags, '-o', str(caller)], timeout=60)
    if host['os'] == 'darwin':
        command(['lipo', str(archive), '-verify_arch', 'arm64'])
        command(['lipo', str(caller), '-verify_arch', 'arm64'])
    c_stdout = command([str(caller), str(inputs)], timeout=60)
    require(c_stdout == ('YNX_REGISTERED_N1_C_DRIVER_PASS cases=' + str(CASES) + ' authority=false\n').encode('ascii'), 'actual complete C boundary marker required')
    write_new(case / 'C-CALL.stdout', c_stdout)
    interop_raw = command([str(fixture), 'verify', str(inputs)], timeout=60)
    interop = validate_interop(interop_raw)
    write_new(case / 'PUBLIC-INTEROP.json', interop_raw)
    public_pins = validate_public_inputs(inputs)
    require(pin(archive) == archive_pin and pin(original / 'SOURCE.json', 1 << 20) == parent_pin
            and directory(original, private=True) == original_identity
            and all(identity((original / name).lstat()) == before for name, before in originals.items()), 'original sealed archive or SOURCE changed')
    out = case / 'delivery'
    out.mkdir(mode=0o700)
    public_out = out / 'public-inputs'
    public_out.mkdir(mode=0o700)
    copy_public(archive, out / 'libynx_artifact_release.a', archive_pin)
    copy_public(original / 'SOURCE.json', out / 'ORIGINAL-ARCHIVE-SOURCE.json', parent_pin)
    header = root / 'cmd/ynx-artifact-release-cabi/registered_n1_verify.h'
    copy_public(header, out / 'registered_n1_verify.h', pin(header))
    copy_public(case / 'PUBLIC-INTEROP.json', out / 'PUBLIC-INTEROP.json', pin(case / 'PUBLIC-INTEROP.json'))
    for name in PUBLIC_NAMES:
        copy_public(inputs / name, public_out / name, public_pins[name])
    record = dict(version='YNX-REGISTERED-N1-VERIFY-CABI-CANDIDATE/v1', classification='public-data-mathematics',
        commit=commit, sourceTree=tree, runId=os.environ['GITHUB_RUN_ID'], runAttempt=os.environ['GITHUB_RUN_ATTEMPT'],
        job=os.environ['GITHUB_JOB'], matrixRunner=os.environ['YNX_NATIVE_MATRIX_RUNNER'], host=host, target=host,
        originalArchiveSource=parent_pin, sharedOriginalArchive=True, archive=archive_pin,
        originalArchiveSourceFile='ORIGINAL-ARCHIVE-SOURCE.json',
        header=pin(out / 'registered_n1_verify.h'), publicEvidence=public_pins,
        publicInterop=pin(out / 'PUBLIC-INTEROP.json'), originalGoVersion=parent['goVersion'], fixtureGoBuildInfo=go_info,
        executedFixture=pin(fixture), executedCCaller=pin(caller), cCallStdout=pin(case / 'C-CALL.stdout'),
        compilerVersion=command(['cc', '--version']).decode().strip(), circl=parent['circl'],
        goMod=parent['goMod'], goSum=parent['goSum'], sources=sources,
        minimumSystemVersion=parent['minimumSystemVersion'], deploymentTargetEnvironment=parent['deploymentTargetEnvironment'],
        abi='YNXRegisteredANDMemberVerifyN1V1', abiVersion=1, requestBytes=160, resultBytes=32, borrowedPublicSpans=7,
        qualifiedEntryPoints=['YNXRegisteredANDMemberVerifyN1V1'], archiveContainsOtherABIs=True,
        suite=SUITE, N=1, index=0, purposes=['SOURCE-ROOT-READ-V2', 'SOURCE-DEVICE-REVOKE-V2'],
        callerRecipe='scripts/verify/registered-n1-verify-cabi-check.sh', actualCABIExecuted=True,
        independentGoDualANDVerified=True, interop=interop, boundaryCases=CASES, crossCompiled=False,
        fixtureSyntheticSigningOnly=True, privateMaterialIncluded=False, keysRead=False, signingByCABI=False,
        nativeRootAuthorized=False, sourceOwnerQualified=False, accountAuthorized=False, mainCustodyVerified=False,
        productInstalled=False, publicDeployment=False, pqActivation=False,
        admission='Expected pair, policy and context require independent Auth admission; mathematics never grants authority.')
    source_raw = (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
    require(len(source_raw) <= 1 << 20, 'bounded N1 SOURCE required')
    write_new(out / 'SOURCE.json', source_raw)
    require({p.name for p in out.iterdir()} == {'libynx_artifact_release.a', 'registered_n1_verify.h', 'PUBLIC-INTEROP.json', 'public-inputs', 'SOURCE.json', 'ORIGINAL-ARCHIVE-SOURCE.json'}, 'closed6 N1 supply catalog required')
    require(validate_public_inputs(public_out) == public_pins, 'delivered public inputs differ')
    require(pin(archive) == archive_pin and pin(original / 'SOURCE.json', 1 << 20) == parent_pin
            and directory(original, private=True) == original_identity
            and all(identity((original / name).lstat()) == before for name, before in originals.items()), 'original bundle changed during delivery')
    for name in names:
        require(same_json(dict(**pin(root / name), gitBlob=command(['git', 'rev-parse', 'HEAD:' + name]).decode().strip()), sources[name]), 'N1 source changed during qualification')
    require(not command(['git', 'status', '--porcelain', '--untracked-files=normal']), 'N1 qualification modified source checkout')
    sys.stdout.write(c_stdout.decode('ascii'))
    print('YNX_REGISTERED_N1_GO_AND_PASS ' + json.dumps(interop, sort_keys=True, separators=(',', ':')))
    print('YNX_REGISTERED_N1_CABI_SOURCE ' + source_raw.decode().strip())
    print('YNX_REGISTERED_N1_CABI_SOURCE_PIN ' + json.dumps(pin(out / 'SOURCE.json', 1 << 20), sort_keys=True, separators=(',', ':')))
    print('YNX_REGISTERED_N1_CABI_CHECK_PASS host=' + host['os'] + '/' + host['arch'] + ' actualCABI=true authority=false')


if __name__ == '__main__':
    main()
PY
