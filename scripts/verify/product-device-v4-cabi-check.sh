#!/usr/bin/env bash
set -euo pipefail
umask 077

# Reuse the original native job's sealed SINGLE archive. This builds only the
# synthetic public fixture and C consumer, never another Go archive/runtime.
[[ $# == 2 && "$1" == /* && "$2" == /* && -d "$1" && ! -L "$1" && ! -e "$2" && ! -L "$2" ]] || { echo 'sealed native-host and fresh absolute device case required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
original=$1
case_root=$2
[[ "$original" == "$RUNNER_TEMP/ynx-artifact-release-cabi/delivery/native-host" && "$case_root" == "$RUNNER_TEMP/ynx-product-device-v4-cabi" ]] || { echo 'fixed original same-job native paths required' >&2; exit 1; }
cd -- "$root"
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
git diff --exit-code
mkdir -m 0700 -- "$case_root"
cleanup_synthetic_private() {
  # Only test-generated DER in this exclusively new case. Never live custody,
  # an unknown prior case, a caller-provided key path, or physical-erasure proof.
  rm -f -- "$case_root/input/SYNTHETIC-ONLY-device-a.der" "$case_root/input/SYNTHETIC-ONLY-device-b.der"
}
trap cleanup_synthetic_private EXIT
archive="$original/libynx_artifact_release.a"
archive_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
parent_sha=$(shasum -a 256 "$original/SOURCE.json" | awk '{print $1}')
host_os=$(go env GOHOSTOS)
host_arch=$(go env GOHOSTARCH)
[[ "$(go env GOOS)" == "$host_os" && "$(go env GOARCH)" == "$host_arch" && ( "$host_os/$host_arch" == linux/amd64 || "$host_os/$host_arch" == darwin/arm64 ) ]] || { echo 'original actual native target required' >&2; exit 1; }
mkdir -m 0700 -- "$case_root/input"
CGO_ENABLED=0 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath \
  -o "$case_root/fixture" ./scripts/fixtures/verify-product-device-v4-cabi
go version -m "$case_root/fixture" > "$case_root/FIXTURE-GO-BUILD-INFO.txt"
"$case_root/fixture" generate "$case_root/input"
link_flags=(-pthread -lm)
if [[ $host_os == linux ]]; then link_flags+=(-ldl); else link_flags+=(-framework CoreFoundation -framework Security); fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-product-device-v4-cabi/c/product_device_smoke.c" "$archive" "${link_flags[@]}" -o "$case_root/product-device-c-driver"
if [[ $host_os == darwin ]]; then
  lipo "$archive" -verify_arch arm64
  lipo "$case_root/product-device-c-driver" -verify_arch arm64
fi
"$case_root/product-device-c-driver" "$case_root/input" > "$case_root/C-CALL.stdout"
"$case_root/fixture" verify "$case_root/input" > "$case_root/GO-CALL.stdout"
cleanup_synthetic_private
trap - EXIT
[[ $(shasum -a 256 "$archive" | awk '{print $1}') == "$archive_sha" && $(shasum -a 256 "$original/SOURCE.json" | awk '{print $1}') == "$parent_sha" ]] || { echo 'original sealed archive or SOURCE changed' >&2; exit 1; }

python3 -B - "$root" "$original" "$case_root" "$archive_sha" "$parent_sha" <<'PY'
import base64, hashlib, json, os, re, shutil, stat, subprocess, sys
from pathlib import Path

root, original, case = map(Path, sys.argv[1:4])
archive_sha, parent_sha = sys.argv[4:6]
def need(value, reason):
    if not value:
        raise RuntimeError(reason)
def command(*args):
    return subprocess.check_output(args, text=True).strip()
def identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
def pin(path, maximum=128 << 20):
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.geteuid()
         and 0 < before.st_size <= maximum, 'bounded owned single-link public file required')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        need(identity(os.fstat(source.fileno())) == identity(before), 'public input open changed')
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
        need(identity(os.fstat(source.fileno())) == identity(before), 'public input changed while hashing')
    need(identity(path.lstat()) == identity(before), 'public input path changed')
    return dict(bytes=before.st_size, sha256=digest)
def read(path, maximum):
    expected = pin(path, maximum)
    raw = path.read_bytes()
    need(len(raw) == expected['bytes'] and hashlib.sha256(raw).hexdigest() == expected['sha256']
         and pin(path, maximum) == expected, 'public input read changed')
    return raw
def unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, 'duplicate public JSON field')
        value[key] = item
    return value
def parse(path, maximum):
    return json.loads(read(path, maximum), object_pairs_hook=unique,
        parse_constant=lambda _: need(False, 'nonfinite public JSON'))
def exact(actual, expected):
    return json.dumps(actual, sort_keys=True, separators=(',', ':')) == json.dumps(expected, sort_keys=True, separators=(',', ':'))
def copy(source, target):
    expected = pin(source)
    with target.open('xb') as sink, source.open('rb') as src:
        shutil.copyfileobj(src, sink, 256 << 10)
        sink.flush()
        os.fsync(sink.fileno())
    need(pin(source) == expected and pin(target) == expected, 'public delivery copy differs')
    return expected

for path in (root, original, case, case / 'input'):
    info = path.lstat()
    need(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
         and info.st_uid == os.geteuid(), 'canonical owned source directory required')
for path in (original, case, case / 'input'):
    need(stat.S_IMODE(path.lstat().st_mode) == 0o700, 'private original and fixture directories required')
need(command('git', 'rev-parse', 'HEAD') == os.environ['GITHUB_SHA']
     and not command('git', 'status', '--porcelain', '--untracked-files=normal'), 'clean selected commit required')
commit, tree = os.environ['GITHUB_SHA'], command('git', 'rev-parse', 'HEAD^{tree}')
host = dict(os=command('go', 'env', 'GOHOSTOS'), arch=command('go', 'env', 'GOHOSTARCH'))
need(host == dict(os=command('go', 'env', 'GOOS'), arch=command('go', 'env', 'GOARCH'))
     and (host['os'], host['arch']) in (('linux', 'amd64'), ('darwin', 'arm64')), 'actual native target required')
archive = original / 'libynx_artifact_release.a'
archive_pin, parent_pin = pin(archive), pin(original / 'SOURCE.json', 1 << 20)
need(archive_pin['sha256'] == archive_sha and parent_pin['sha256'] == parent_sha, 'original shared archive changed')
parent = parse(original / 'SOURCE.json', 1 << 20)
need(parent.get('version') == 'YNX-ARTIFACT-RELEASE-CABI-CANDIDATE/v1', 'original archive SOURCE required')
for key, environment in (('commit', 'GITHUB_SHA'), ('runId', 'GITHUB_RUN_ID'), ('runAttempt', 'GITHUB_RUN_ATTEMPT'),
                         ('job', 'GITHUB_JOB'), ('matrixRunner', 'YNX_NATIVE_MATRIX_RUNNER'), ('runnerOS', 'RUNNER_OS')):
    need(parent.get(key) == os.environ[environment], 'same original native job required')
need(exact(parent.get('host'), host) and exact(parent.get('target'), host) and parent.get('sourceTree') == tree
     and exact(parent.get('archive'), archive_pin) and parent.get('actualCABIExecuted') is True
     and parent.get('nativeHostCoreTestsPassed') is True and parent.get('crossCompiled') is False
     and parent.get('privateMaterialIncluded') is False, 'original native archive qualification differs')
need(parent.get('suite') == 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512'
     and parent.get('circl', {}).get('Version') == 'v1.6.5', 'original fixed provider suite required')
need(read(case / 'C-CALL.stdout', 1024) == b'PRODUCT_DEVICE_V4_CABI_C_CASES=48\n'
     and read(case / 'GO-CALL.stdout', 1024) == b'PRODUCT_DEVICE_V4_CABI_INDEPENDENT_AND_DATA_ONLY\n', 'actual C and independent Go markers required')
public_inputs = ('registration-original.json', 'challenge-original.json', 'network.bin', 'owner.txt', 'device-pk-a.bin',
    'device-pk-b.bin', 'account-pk-a.bin', 'account-pk-b.bin', 'registration-member.bin', 'challenge-member.bin', 'C-RESULT.json',
    'PUBLIC-RECEIPT.json', 'PUBLIC-INTEROP.json')
need({p.name for p in (case / 'input').iterdir()} == set(public_inputs), 'closed public inputs and synthetic DER cleanup required')
receipt = parse(case / 'input/PUBLIC-RECEIPT.json', 1 << 20)
interop = parse(case / 'input/PUBLIC-INTEROP.json', 1 << 20)
need(receipt.get('version') == 'YNX-PRODUCT-DEVICE-V4-CABI-PUBLIC-RECEIPT/v1'
     and interop.get('version') == 'YNX-PRODUCT-DEVICE-V4-CABI-PUBLIC-INTEROP/v1', 'exact typed public evidence required')
for value in (receipt, interop):
    need(value.get('classification') == 'data' and value.get('syntheticOnly') is True
         and value.get('independentGoANDVerified') is True and value.get('sdkJSInteropExecuted') is False
         and type(value.get('memberCount')) is int and value['memberCount'] == 1
         and type(value.get('memberIndex')) is int and value['memberIndex'] == 0, 'fixed independent mathematical evidence required')
    for key in ('authorityGranted', 'RootAdmission', 'SourceAdmission', 'NativeAdmission', 'registered', 'current', 'sessionAuthorized'):
        need(value.get(key) is False, 'public evidence cannot grant authority')
need(receipt.get('actualCABIExecuted') is True and exact(receipt.get('boundaryCases'), 48)
     and exact(receipt.get('successfulCSignatures'), 2) and exact(receipt.get('corruptSignatureBranchesRejected'), 4)
     and exact(receipt.get('crossPurposesRejected'), 2) and exact(receipt.get('wrongFullPairsRejected'), 2)
     and receipt.get('registrationPurpose') == 'PRODUCT-SESSION-DEVICE-REGISTRATION'
     and receipt.get('challengePurpose') == 'PRODUCT-SESSION-DEVICE-CHALLENGE'
     and receipt.get('installed') is False and receipt.get('publicDeployment') is False, 'complete fixed C and negative verification evidence required')
for label, filename in (('registrationOriginal', 'registration-original.json'), ('challengeOriginal', 'challenge-original.json'),
                        ('registrationMember', 'registration-member.bin'), ('challengeMember', 'challenge-member.bin')):
    raw = read(case / 'input' / filename, 98304)
    need(receipt.get(label + 'SHA256') == hashlib.sha256(raw).hexdigest()
         and interop.get(label + ('OriginalBase64Url' if label.endswith('Member') else 'Base64Url')) == base64.urlsafe_b64encode(raw).decode().rstrip('='), 'exact original public evidence differs')
settings = {}
for line in read(case / 'FIXTURE-GO-BUILD-INFO.txt', 65536).decode().splitlines():
    if line.startswith('\tbuild\t'):
        key, sep, value = line[len('\tbuild\t'):].partition('=')
        need(sep and key not in settings, 'invalid actual fixture Go setting')
        settings[key] = value
for key, value in {'GOOS':host['os'], 'GOARCH':host['arch'], 'CGO_ENABLED':'0', '-trimpath':'true',
                   'vcs.revision':commit, 'vcs.modified':'false'}.items():
    need(settings.get(key) == value, 'actual public fixture source or target differs')
names = command('git', 'ls-files', 'go.mod', 'go.sum', 'internal/ynxbatch', 'internal/ynxauth', 'internal/accountaddress',
    'cmd/ynx-artifact-release-cabi', 'scripts/fixtures/verify-product-device-v4-cabi',
    'scripts/verify/product-device-v4-cabi-check.sh', '.github/workflows/resource-market-ci.yml').splitlines()
required = ('internal/ynxbatch/product_device_v4.go', 'cmd/ynx-artifact-release-cabi/product_device_registration_v4.h',
    'cmd/ynx-artifact-release-cabi/product_device_challenge_v4.h', 'scripts/fixtures/verify-product-device-v4-cabi/main.go',
    'scripts/fixtures/verify-product-device-v4-cabi/c/product_device_smoke.c', 'scripts/verify/product-device-v4-cabi-check.sh')
need(set(required) <= set(names), 'complete tracked typed implementation and caller required')
sources = {name:dict(**pin(root / name), gitBlob=command('git','rev-parse','HEAD:'+name)) for name in names}
for name, source_pin in sources.items():
    if name in parent['sources']:
        need(exact(source_pin, parent['sources'][name]), 'original archive compile inputs differ')
out = case / 'delivery'
out.mkdir(mode=0o700)
outputs = {name:copy(archive if name == 'libynx_artifact_release.a' else
    original / 'SOURCE.json' if name == 'ORIGINAL-ARCHIVE-SOURCE.json' else
    case / 'input' / name if name.startswith('PUBLIC-') else root / 'cmd/ynx-artifact-release-cabi' / name, out / name)
    for name in ('libynx_artifact_release.a', 'product_device_registration_v4.h', 'product_device_challenge_v4.h',
                 'PUBLIC-RECEIPT.json', 'PUBLIC-INTEROP.json', 'ORIGINAL-ARCHIVE-SOURCE.json')}
record = dict(version='YNX-PRODUCT-DEVICE-SIGN-CABI-CANDIDATE/v4', classification='fixed-public-mathematics',
    commit=commit, sourceTree=tree, runId=os.environ['GITHUB_RUN_ID'], runAttempt=os.environ['GITHUB_RUN_ATTEMPT'],
    job=os.environ['GITHUB_JOB'], matrixRunner=os.environ['YNX_NATIVE_MATRIX_RUNNER'], host=host, target=host,
    archive=archive_pin, originalArchiveSource=parent_pin, sharedOriginalArchive=True, archiveContainsOtherABIs=True,
    qualifiedEntryPoints=['YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4'],
    requestBytes=dict(registration=160, challenge=176), memberCapacity=98304, actualCABIExecuted=True,
    independentGoDualANDVerified=True, boundaryCases=48, successfulCSignatures=2, sdkJSInteropExecuted=False,
    syntheticTestKeysOnly=True, syntheticPrivateFixtureFilesRemoved=True, privateMaterialIncluded=False,
    keysGeneratedByCABI=False, crossCompiled=False, goVersion=parent['goVersion'], fixtureGoBuildSettings=settings,
    suite=parent['suite'], circl=parent['circl'], goMod=parent['goMod'], goSum=parent['goSum'], sources=sources,
    minimumSystemVersion=parent['minimumSystemVersion'], deploymentTargetEnvironment=parent['deploymentTargetEnvironment'],
    publicOutputs=outputs, callerRecipe='scripts/verify/product-device-v4-cabi-check.sh',
    nativeRootAuthorized=False, sourceOwnerQualified=False, accountAuthorized=False, mainCustodyVerified=False,
    durableOnceVerified=False, sessionAuthorized=False, productInstalled=False, publicDeployment=False, pqActivation=False,
    cleanup='logical Clear/Destroy/Discard and synthetic fixture DER removal; no physical-erasure or caller-borrow wipe guarantee')
raw = (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode()
with (out / 'SOURCE.json').open('xb') as sink:
    sink.write(raw)
need({p.name for p in out.iterdir()} == set(outputs) | {'SOURCE.json'}, 'closed seven-file public delivery required')
need(pin(archive) == archive_pin and pin(original / 'SOURCE.json', 1 << 20) == parent_pin
     and not command('git', 'status', '--porcelain', '--untracked-files=normal'), 'original bundle or source changed')
print('YNX_PRODUCT_DEVICE_CABI_SOURCE ' + raw.decode().strip())
print('YNX_PRODUCT_DEVICE_CABI_SOURCE_PIN ' + json.dumps(pin(out / 'SOURCE.json', 1 << 20), sort_keys=True))
print('YNX_PRODUCT_DEVICE_CABI_CHECK_PASS actualCABI=true authority=false')
PY
