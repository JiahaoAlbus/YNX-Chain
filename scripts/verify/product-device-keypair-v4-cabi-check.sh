#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 2 && "$1" == /* && "$2" == /* ]] || { echo 'sealed native-host and fresh fixed device-creator case required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd -- "$root"
python3 -B - "$root" "$1" "$2" <<'PY'
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

SUITE = 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512'
PURPOSE = 'product-session-device-v4'
RECIPE = 'scripts/verify/product-device-keypair-v4-cabi-check.sh'
CHECK = 'scripts/fixtures/verify-product-device-keypair-v4/check.sh'
CONTROL = 'scripts/ops/test_product_device_keypair_v4_supply.py'
HEADER = 'cmd/ynx-artifact-release-cabi/product_device_keypair_v4.h'
SOURCE_SCOPES = ('go.mod', 'go.sum', 'internal/ynxbatch', 'internal/ynxauth', 'internal/accountaddress',
                 'cmd/ynx-artifact-release-cabi', 'scripts/fixtures/verify-product-device-keypair-v4', RECIPE, CONTROL,
                 '.github/workflows/resource-market-ci.yml')
REQUIRED_SOURCES = (HEADER, 'cmd/ynx-artifact-release-cabi/product_device_keypair_v4_core.go',
                    'cmd/ynx-artifact-release-cabi/product_device_keypair_v4_bridge.go',
                    'cmd/ynx-artifact-release-cabi/product_device_keypair_v4_core_test.go',
                    'scripts/fixtures/verify-product-device-keypair-v4/main.go',
                    'scripts/fixtures/verify-product-device-keypair-v4/c/driver.c', CHECK, RECIPE, CONTROL)
CORE_TESTS = ('TestProductDeviceKeypairV4FreshActualImportAndAND', 'TestProductDeviceKeypairV4FullPairAndDERCorruptionRejected',
              'TestProductDeviceKeypairV4PreTransferFailureClearsAndPreservesFirstCause', 'TestProductDeviceKeypairV4LatePrivateOutcomeStaysUnknown')
PARENT_NAMES = ('libynx_artifact_release.a', 'ynx_artifact_release.h', 'tx_batch.h', 'account_initial.h', 'product_session_http.h',
                'PUBLIC-RECEIPT.json', 'PUBLIC-INTEROP.json', 'TX-PUBLIC-RECEIPT.json', 'TX-PUBLIC-INTEROP.json',
                'INITIAL-PUBLIC-RECEIPT.json', 'INITIAL-PUBLIC-INTEROP.json', 'DEVICE-HTTP-PUBLIC-RECEIPT.json',
                'DEVICE-HTTP-PUBLIC-INTEROP.json', 'SOURCE.json')
MATERIAL_NAMES = ('first-pk-a.bin', 'first-pk-b.bin', 'second-pk-a.bin', 'second-pk-b.bin', 'C-RESULT.json', 'PUBLIC-RESULT.json')
DELIVERY_NAMES = ('libynx_artifact_release.a', 'product_device_keypair_v4.h', 'PUBLIC-RESULT.json', 'ORIGINAL-ARCHIVE-SOURCE.json', 'SOURCE.json')
NEGATIVES = [prefix + '-' + name for prefix in ('first', 'second')
             for name in ('signature-A', 'signature-B', 'full-pair-binding', 'full-pair-math', 'wrong-purpose')]


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def same(actual, expected):
    return json.dumps(actual, sort_keys=True, separators=(',', ':')) == json.dumps(expected, sort_keys=True, separators=(',', ':'))


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate public JSON field')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: require(False, 'nonfinite public JSON'))


def identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def directory(path, private=False):
    info = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid(), 'canonical owned directory required')
    require(not private or stat.S_IMODE(info.st_mode) == 0o700, 'directory mode0700 required')
    return identity(info)


def pin(path, maximum=128 << 20, private=False):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.geteuid()
            and not stat.S_IMODE(before.st_mode) & 0o022 and 0 < before.st_size <= maximum,
            'bounded owned single-link public file required')
    require(not private or stat.S_IMODE(before.st_mode) == 0o600, 'fixture mode0600 required')
    digest = hashlib.sha256()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        require(identity(os.fstat(source.fileno())) == identity(before), 'public input open changed')
        while True:
            chunk = source.read(256 << 10)
            if not chunk:
                break
            digest.update(chunk)
        require(identity(os.fstat(source.fileno())) == identity(before), 'public input changed while hashing')
    require(identity(path.lstat()) == identity(before), 'public input path changed')
    return dict(bytes=before.st_size, sha256=digest.hexdigest())


def read_public(path, maximum, private=True):
    expected = pin(path, maximum, private=private)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        raw = source.read(maximum + 1)
    require(len(raw) == expected['bytes'] and hashlib.sha256(raw).hexdigest() == expected['sha256']
            and pin(path, maximum, private=private) == expected, 'public input changed while reading')
    return raw


def write_new(path, raw):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as output:
        require(output.write(raw) == len(raw), 'short public output write')
        output.flush()
        os.fsync(output.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def copy_public(source, target, expected):
    before = identity(source.lstat())
    require(pin(source) == expected, 'public copy input differs')
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as src:
        with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as dst:
            while True:
                chunk = src.read(256 << 10)
                if not chunk:
                    break
                require(dst.write(chunk) == len(chunk), 'short public copy')
            dst.flush()
            os.fsync(dst.fileno())
    require(pin(source) == expected and identity(source.lstat()) == before and pin(target, private=True) == expected,
            'public copy changed original or output')


def command(arguments, timeout=30, environment=None):
    done = subprocess.run(arguments, env=environment, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=False)
    require(len(done.stdout) <= 1 << 20 and len(done.stderr) <= 1 << 20, 'public command output bound')
    if done.returncode:
        sys.stderr.buffer.write(done.stderr)
        raise RuntimeError('fixed supply command failed: ' + arguments[0])
    return done.stdout


def validate_environment(env, host):
    require(env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_EVENT_NAME') == 'push'
            and env.get('GITHUB_REPOSITORY') == 'JiahaoAlbus/YNX-Chain' and env.get('GITHUB_JOB') == 'artifact-release-cabi',
            'normal original GitHub native push job required')
    require(type(env.get('GITHUB_SHA')) is str and re.fullmatch('[0-9a-f]{40}', env['GITHUB_SHA'])
            and env['GITHUB_SHA'] != '0' * 40, 'complete selected Git commit required')
    for name in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
        require(type(env.get(name)) is str and re.fullmatch('[1-9][0-9]*', env[name]), 'canonical original run identity required')
    allowed = {'ubuntu-24.04': ('Linux', dict(os='linux', arch='amd64')),
               'macos-15': ('macOS', dict(os='darwin', arch='arm64'))}
    selected = allowed.get(env.get('YNX_NATIVE_MATRIX_RUNNER'))
    require(selected is not None and env.get('RUNNER_OS') == selected[0] and same(host, selected[1]), 'actual original native matrix target required')


def validate_parent(parent, env, host, tree, archive_pin, original_pins):
    require(type(parent) is dict and parent.get('version') == 'YNX-ARTIFACT-RELEASE-CABI-CANDIDATE/v1', 'original archive SOURCE required')
    for key, name in (('commit', 'GITHUB_SHA'), ('runId', 'GITHUB_RUN_ID'), ('runAttempt', 'GITHUB_RUN_ATTEMPT'),
                      ('job', 'GITHUB_JOB'), ('matrixRunner', 'YNX_NATIVE_MATRIX_RUNNER'), ('runnerOS', 'RUNNER_OS')):
        require(parent.get(key) == env[name], 'same-job original archive identity required')
    require(parent.get('sourceTree') == tree and same(parent.get('host'), host) and same(parent.get('target'), host)
            and same(parent.get('archive'), archive_pin), 'original source/tree/native archive differs')
    for key in ('actualCABIExecuted', 'nativeHostCoreTestsPassed', 'independentGoDualANDVerified', 'typedN1Inspected', 'targetCompiled', 'targetCallerLinked',
                'actualTransactionCABIExecuted', 'transactionIndependentGoDualANDVerified', 'actualInitialAccountCABIExecuted',
                'initialAccountIndependentGoDualANDVerified', 'actualDeviceHTTPCABIExecuted', 'deviceHTTPIndependentGoDualANDVerified'):
        require(parent.get(key) is True, 'complete original native symbols and math evidence required')
    for key in ('crossCompiled', 'privateMaterialIncluded', 'publisherAuthorized', 'nativeRootAuthorized', 'mainCustodyVerified',
                'productInstalled', 'publicDeployment', 'pqActivation', 'transactionAccountAuthorized', 'initialAccountAuthorized',
                'deviceHTTPSourceQualified', 'deviceHTTPSessionAuthorized'):
        require(parent.get(key) is False, 'original archive cannot grant authority or contain private material')
    for key, expected in (('abi', 'YNXArtifactPublicationSignV1'), ('abiVersion', 1),
                          ('transactionABI', 'YNXTransactionBatchSignV1'), ('transactionABIVersion', 1),
                          ('initialAccountABI', 'YNXAccountInitialSignV1'), ('initialAccountABIVersion', 1),
                          ('deviceHTTPABI', 'YNXProductSessionHTTPProofSignV4'), ('deviceHTTPABIVersion', 4)):
        require(same(parent.get(key), expected), 'original native ABI catalog differs')
    require(parent.get('suite') == SUITE and type(parent.get('circl')) is dict
            and parent['circl'].get('Path') == 'github.com/cloudflare/circl' and parent['circl'].get('Version') == 'v1.6.5'
            and 'Replace' not in parent['circl'], 'fixed original full AND provider required')
    for field, name in (('header', 'ynx_artifact_release.h'), ('transactionHeader', 'tx_batch.h'),
                        ('initialAccountHeader', 'account_initial.h'), ('deviceHTTPHeader', 'product_session_http.h')):
        require(same(parent.get(field), original_pins[name]), 'original header pin differs')
    for field, prefix in (('publicEvidence', ''), ('transactionPublicEvidence', 'TX-'),
                          ('initialAccountPublicEvidence', 'INITIAL-'), ('deviceHTTPPublicEvidence', 'DEVICE-HTTP-')):
        expected = {prefix + name: original_pins[prefix + name] for name in ('PUBLIC-RECEIPT.json', 'PUBLIC-INTEROP.json')}
        require(same(parent.get(field), expected), 'original public evidence pin differs')
    require(same(parent.get('publicEvidenceTarget'), host), 'original public evidence target differs')
    target = '13.0' if host['os'] == 'darwin' else None
    require(parent.get('minimumSystemVersion') == target and parent.get('deploymentTargetEnvironment') == target,
            'original platform deployment target differs')


def validate_core_tests(raw):
    package = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-artifact-release-cabi'
    rows = [strict_json(line) for line in raw.splitlines() if line]
    require(rows and all(type(row) is dict for row in rows), 'actual original Go JSONL required')
    for name in CORE_TESTS:
        terminal = [row.get('Action') for row in rows if row.get('Package') == package and row.get('Test') == name
                    and row.get('Action') in ('pass', 'fail', 'skip')]
        require(terminal == ['pass'], 'actual device creator core test missing/failed/skipped: ' + name)
    terminal = [row.get('Action') for row in rows if row.get('Package') == package and 'Test' not in row
                and row.get('Action') in ('pass', 'fail', 'skip')]
    require(terminal == ['pass'], 'actual complete original core suite must pass')
    return list(CORE_TESTS)


def validate_markers(raw):
    lines = raw.decode('ascii').splitlines()
    prefix = 'DEVICE_KEYPAIR_C_CASE_PASS '
    actual = collections.Counter(line[len(prefix):] for line in lines if line.startswith(prefix))
    expected = dict(null_request=1, null_outcome=1, version=1, struct_size=1, unaligned_request=1, unaligned_outcome=1,
                    outcome_request_overlap=1, buffer_request_overlap=4, null_buffer=4, exact_capacity=12,
                    output_pair_overlap=6, outcome_buffer_overlap=4, actual_fresh_pair_complete_no_overrun=2)
    markers = ['YNX_PRODUCT_DEVICE_KEYPAIR_C_PASS cases=39 purpose=product-session-device-v4 physicalEraseClaimed=false',
               'YNX_PRODUCT_DEVICE_KEYPAIR_INTEROP_PASS C=39 GoNegative=10 actualFullAND=true authority=false',
               'YNX_PRODUCT_DEVICE_KEYPAIR_CHECK_PASS sharedArchive=true authority=false']
    require(actual == expected and [line for line in lines if not line.startswith(prefix)] == markers,
            'actual complete C39 and independent Go10 markers required')


def validate_material(path):
    directory(path, private=True)
    require({p.name for p in path.iterdir()} == set(MATERIAL_NAMES), 'closed6 public material catalog and complete DER cleanup required')
    pins = {name: pin(path / name, 65536, private=True) for name in MATERIAL_NAMES}
    c = strict_json(read_public(path / 'C-RESULT.json', 1024))
    require(same(c, dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-C-RESULT/v4', cases=39, syntheticOnly=True, authority=False)), 'exact actual C boundary receipt required')
    result = strict_json(read_public(path / 'PUBLIC-RESULT.json', 65536))
    expected = dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-PUBLIC-RESULT/v4', purpose=PURPOSE, syntheticOnly=True, actualCCreator=True,
                    cCases=39, independentFullPairImport=True, actualDualANDVerified=True, typedRegistrationInspected=True,
                    negativeCases=NEGATIVES, privateTestFilesRemoved=True, logicalCleanupOnly=True, physicalEraseClaimed=False,
                    authProvisioningVerified=False, visibleApprovalVerified=False, osCustodyImported=False, rootGrant=False)
    require(type(result) is dict and set(result) == set(expected) | {'publicPins'}
            and same({key: result[key] for key in expected}, expected), 'closed independent actual AND/no-authority public receipt required')
    declared = result['publicPins']
    require(type(declared) is dict and set(declared) == {'firstA', 'firstB', 'secondA', 'secondB', 'firstMember', 'secondMember'}, 'complete public pair and member pins required')
    for label, filename, size in (('firstA', 'first-pk-a.bin', 2592), ('firstB', 'first-pk-b.bin', 64),
                                  ('secondA', 'second-pk-a.bin', 2592), ('secondB', 'second-pk-b.bin', 64)):
        require(pins[filename]['bytes'] == size and same(declared[label], pins[filename]), 'actual complete generated public key pin differs')
    for label in ('firstMember', 'secondMember'):
        row = declared[label]
        require(type(row) is dict and set(row) == {'bytes', 'sha256'} and type(row['bytes']) is int and 0 < row['bytes'] <= 98304
                and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}', row['sha256']) and row['sha256'] != '0' * 64,
                'actual synthetic registration member pin required')
    require(declared['firstA'] != declared['secondA'] and declared['firstB'] != declared['secondB'], 'both fresh generated public branches required')
    return pins, result


def fixture_build_info(raw, host, commit):
    settings = {}
    for line in raw.decode('utf-8').splitlines():
        if line.startswith('\tbuild\t'):
            key, separator, value = line[len('\tbuild\t'):].partition('=')
            require(separator and key not in settings, 'duplicate or invalid actual Go fixture setting')
            settings[key] = value
    for key, value in {'GOOS': host['os'], 'GOARCH': host['arch'], 'CGO_ENABLED': '0', '-trimpath': 'true',
                       'vcs.revision': commit, 'vcs.modified': 'false'}.items():
        require(settings.get(key) == value, 'independent actual fixture compile identity differs')
    return dict(raw=raw.decode('utf-8'), settings=settings, archiveBuildInfoClaimed=False)


def validate_source_pins(sources, parent):
    require(set(REQUIRED_SOURCES) <= set(sources), 'complete tracked creator implementation and caller required')
    require(type(parent.get('sources')) is dict, 'original complete archive compile sources required')
    for name, row in sources.items():
        compiled = name in ('go.mod', 'go.sum') or name.startswith(('internal/ynxbatch/', 'internal/ynxauth/', 'internal/accountaddress/', 'cmd/ynx-artifact-release-cabi/'))
        if compiled:
            require(name in parent['sources'] and same(row, parent['sources'][name]), 'original archive complete compile source pin differs')
        elif name in parent['sources']:
            require(same(row, parent['sources'][name]), 'original same-job caller source pin differs')


def main():
    require(len(sys.argv) == 4, 'fixed original native supply arguments required')
    root, original, case = map(Path, sys.argv[1:])
    directory(root)
    temp = Path(os.environ['RUNNER_TEMP'])
    directory(temp)
    require(original == temp / 'ynx-artifact-release-cabi/delivery/native-host'
            and case == temp / 'ynx-product-device-keypair-v4-cabi', 'fixed same-job native-host and fresh creator case required')
    directory(original, private=True)
    require(not case.exists() and not case.is_symlink(), 'existing creator case/UNKNOWN must be retained')
    observed = command(['go', 'env', 'GOHOSTOS', 'GOHOSTARCH', 'GOOS', 'GOARCH']).decode().splitlines()
    require(len(observed) == 4 and observed[:2] == observed[2:], 'actual native target only')
    host = dict(os=observed[0], arch=observed[1])
    validate_environment(os.environ, host)
    commit = command(['git', 'rev-parse', 'HEAD']).decode().strip()
    tree = command(['git', 'rev-parse', 'HEAD^{tree}']).decode().strip()
    require(commit == os.environ['GITHUB_SHA'] and not command(['git', 'status', '--porcelain', '--untracked-files=normal']), 'clean actual selected commit required; no local dirty seal')
    require({p.name for p in original.iterdir()} == set(PARENT_NAMES), 'complete original14 native catalog required')
    original_pins = {name: pin(original / name, private=True) for name in PARENT_NAMES}
    original_id = directory(original, private=True)
    identities = {name: identity((original / name).lstat()) for name in PARENT_NAMES}
    archive = original / 'libynx_artifact_release.a'
    archive_pin, parent_pin = original_pins[archive.name], original_pins['SOURCE.json']
    parent = strict_json(read_public(original / 'SOURCE.json', 1 << 20))
    validate_parent(parent, os.environ, host, tree, archive_pin, original_pins)
    require(command(['go', 'version']).decode().strip() == parent['goVersion'], 'same original Go toolchain required')
    module = strict_json(command(['go', 'list', '-m', '-json', 'github.com/cloudflare/circl']))
    require(module.get('Version') == 'v1.6.5' and not module.get('Replace') and same(
        {key: module[key] for key in ('Path', 'Version', 'Sum', 'GoModSum') if key in module}, parent['circl']), 'fixed actual original provider required')
    names = command(['git', 'ls-files', *SOURCE_SCOPES]).decode().splitlines()
    sources = {name: dict(**pin(root / name), gitBlob=command(['git', 'rev-parse', 'HEAD:' + name]).decode().strip()) for name in names}
    validate_source_pins(sources, parent)
    require(same(parent['goMod'], pin(root / 'go.mod')) and same(parent['goSum'], pin(root / 'go.sum')), 'original module input pins differ')
    core_log = temp / 'ynx-native-cabi-core-tests.jsonl'
    core_pin = pin(core_log, 16 << 20)
    core_tests = validate_core_tests(read_public(core_log, 16 << 20, private=False))
    case.mkdir(mode=0o700)
    exercise = case / 'exercise'
    done = subprocess.run(['bash', str(root / CHECK), str(archive), str(exercise)], stdin=subprocess.DEVNULL,
                          capture_output=True, timeout=300, check=False)
    require(len(done.stdout) <= 1 << 20 and len(done.stderr) <= 1 << 20, 'bounded fixed caller output required')
    write_new(case / 'CHECK.stdout', done.stdout)
    # Empty stderr is permitted; no private data is emitted by the fixed recipe.
    if done.stderr:
        write_new(case / 'CHECK.stderr', done.stderr)
    if done.returncode:
        sys.stderr.buffer.write(done.stderr)
        raise RuntimeError('actual fixed C creator/Go checker failed; original outcome retained')
    validate_markers(done.stdout)
    material = exercise / 'material'
    material_pins, result = validate_material(material)
    go_info = fixture_build_info(command(['go', 'version', '-m', str(exercise / 'independent')]), host, commit)
    if host['os'] == 'darwin':
        command(['lipo', str(archive), '-verify_arch', 'arm64'])
        command(['lipo', str(exercise / 'c-driver'), '-verify_arch', 'arm64'])
    require(directory(original, private=True) == original_id and all(
        identity((original / name).lstat()) == identities[name] and pin(original / name, private=True) == original_pins[name]
        for name in PARENT_NAMES), 'original sealed native archive/SOURCE/catalog changed')
    out = case / 'delivery'
    out.mkdir(mode=0o700)
    destinations = {'libynx_artifact_release.a': archive, 'product_device_keypair_v4.h': root / HEADER,
                    'PUBLIC-RESULT.json': material / 'PUBLIC-RESULT.json', 'ORIGINAL-ARCHIVE-SOURCE.json': original / 'SOURCE.json'}
    outputs = {}
    for name, source in destinations.items():
        outputs[name] = pin(source)
        copy_public(source, out / name, outputs[name])
    record = dict(version='YNX-PRODUCT-DEVICE-KEYPAIR-CABI-CANDIDATE/v4', classification='fixed-public-mathematics',
        commit=commit, sourceTree=tree, runId=os.environ['GITHUB_RUN_ID'], runAttempt=os.environ['GITHUB_RUN_ATTEMPT'],
        job=os.environ['GITHUB_JOB'], matrixRunner=os.environ['YNX_NATIVE_MATRIX_RUNNER'], runnerOS=os.environ['RUNNER_OS'], host=host, target=host,
        archive=archive_pin, header=outputs['product_device_keypair_v4.h'], publicResult=outputs['PUBLIC-RESULT.json'],
        originalArchiveSource=parent_pin, originalArchiveSourceFile='ORIGINAL-ARCHIVE-SOURCE.json',
        sharedOriginalArchive=True, archiveContainsOtherABIs=True,
        qualifiedEntryPoints=['YNXProductSessionDeviceKeypairGenerateV4'], abiVersion=4, purpose=PURPOSE,
        requestBytes=80, outcomeBytes=40, pkcs8Capacities=dict(a=54, b=150), publicKeyCapacities=dict(a=2592, b=64),
        outputStates=dict(none=0, complete=1, unknown=2), cleanupStates=dict(unknown=0, notRequired=1, logicalComplete=2, failed=3),
        actualCABIExecuted=True, keysGeneratedByCABI=True, generationCalls=2, independentGoFullPairImportVerified=True,
        independentGoDualANDVerified=True, typedDeviceRegistrationInspected=True, boundaryCases=39, negativeMathCases=10,
        signingByCABI=False, syntheticTestKeysOnly=True, syntheticPrivateFixtureFilesRemoved=True, privateMaterialIncluded=False,
        crossCompiled=False, goVersion=parent['goVersion'], compilerVersion=command(['cc', '--version']).decode().strip(),
        fixtureGoBuildInfo=go_info, executedFixture=pin(exercise / 'independent'), executedCCaller=pin(exercise / 'c-driver'),
        fixedCallerStdout=pin(case / 'CHECK.stdout'), requiredCoreTestsPassed=core_tests, originalCoreJSONL=core_pin,
        suite=SUITE, circl=parent['circl'], goMod=parent['goMod'], goSum=parent['goSum'], sources=sources,
        publicMaterialPins=material_pins, publicOutputs=outputs, callerRecipe=RECIPE,
        minimumSystemVersion=parent['minimumSystemVersion'], deploymentTargetEnvironment=parent['deploymentTargetEnvironment'],
        authProvisioningVerified=False, visibleApprovalVerified=False, osCustodyImported=False, nativeRootAuthorized=False,
        sourceOwnerQualified=False, mainCustodyVerified=False, durableOnceVerified=False, registered=False, current=False,
        sessionAuthorized=False, productInstalled=False, publicDeployment=False, pqActivation=False,
        cleanup='logical Clear/Destroy and exact synthetic DER cleanup only; no physical-erasure or nonexportable claim',
        admission='Original Auth Native must provision the lawful purpose, obtain visible approval, preserve private outcomes/once UNKNOWN, and import into its own custody.')
    source_raw = (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode()
    require(len(source_raw) <= 1 << 20, 'bounded new public SOURCE required')
    write_new(out / 'SOURCE.json', source_raw)
    sync_directory(out)
    require({p.name for p in out.iterdir()} == set(DELIVERY_NAMES), 'closed five-file public delivery required')
    require(same(strict_json(read_public(out / 'SOURCE.json', 1 << 20)), record), 'new SOURCE exact readback differs')
    for name, expected in outputs.items():
        require(pin(out / name, private=True) == expected, 'delivered original public output pin differs')
    require(validate_material(material)[0] == material_pins and directory(original, private=True) == original_id and all(
        pin(original / name, private=True) == original_pins[name] and identity((original / name).lstat()) == identities[name]
        for name in PARENT_NAMES), 'original archive/SOURCE/material changed during delivery')
    for name in names:
        require(same(dict(**pin(root / name), gitBlob=command(['git', 'rev-parse', 'HEAD:' + name]).decode().strip()), sources[name]), 'creator compile input changed during qualification')
    require(pin(core_log, 16 << 20) == core_pin and not command(['git', 'status', '--porcelain', '--untracked-files=normal']), 'original tests or selected clean source changed')
    sys.stdout.write(done.stdout.decode('ascii'))
    print('YNX_PRODUCT_DEVICE_KEYPAIR_CABI_SOURCE ' + source_raw.decode().strip())
    print('YNX_PRODUCT_DEVICE_KEYPAIR_CABI_SOURCE_PIN ' + json.dumps(pin(out / 'SOURCE.json', 1 << 20), sort_keys=True))
    print('YNX_PRODUCT_DEVICE_KEYPAIR_CABI_DELIVERY_PASS host=' + host['os'] + '/' + host['arch'] + ' actualCABI=true authority=false')


if __name__ == '__main__':
    main()
PY
