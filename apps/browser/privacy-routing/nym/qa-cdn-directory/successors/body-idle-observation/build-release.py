#!/usr/bin/env python3
"""Prepare and build the isolated, exact-source body-diagnostic QA release."""

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
BASE = Path('/REDACTED_VOLUME/YNX-large-work')
PR = BASE / 'coordination-v5-20261031/owners/P05/privacy-routing'
CASE = PR / 'nym-directory-body-idle-20261113'
ORIGINAL = PR / 'nym-qa-cdn-fullfeature-20261108'
OLD = PR / 'nym-persistent-capabilities-20261108'
WORK = CASE / 'exact-qa-release'
LOCK = BASE / 'original-a-builds/.original-a-normal-heavy.lock'
GUARD = ORIGINAL / 'run_fullfeature_v4.py'
GUARD_SHA = 'b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05'
OLD_PROPOSAL = OLD / 'build-proposal.json'
OLD_SOURCE = OLD / 'source-after-manifest.json'
LEAF = Path('common/http-api-client/src/qa_directory.rs')
AFTER = HERE / 'overlay' / LEAF
ARTIFACT_REL = Path('build/artifacts/qa-feature-on/nym-socks5-client')
RESUME_ARTIFACT_REL = Path('build-resumed/artifacts/qa-feature-on/nym-socks5-client')
FIRST_BUILD_SHA = '37e3851f2e6dcb29a0d285c0ad00cbd910d67369dea199f18fcd1d3adba78abe'
FIRST_PROPOSAL_SHA = 'b883d25122dc2542198a4e592c4ef38022ebf2c2dc43fb4c707dfca16308d251'
ORIGINAL_RECEIPT = OLD / 'build-20261108T051957Z-a5b287/receipt.json'
OLD_BINARY = ORIGINAL_RECEIPT.parent / 'artifacts/qa-feature-on/nym-socks5-client'
LOCK_SHA = '29275bf9e41f6d6acad87f4737b5640e89ada39e0d7752a9211d04fec7871558'
SOURCE_SHA = '0704783948054fc2c8f6ba8f82a12ab06bda85910c642a9374c509670a1773cf'
NEW_LEAF_SHA = '3f728e516cf12a6b69dd1039e71f583a4a99897aa5b31b7cd846ae88548bde69'
OLD_LEAF_SHA = '70767b79c258e8c90d1f7575b1c08db546080cf6da040ef2f0d9ef991e573532'
OLD_ARTIFACT_SHA = '6dce5c8d32932b8968f4a4e2db65db52c48aaf049ad75dad7c4f249f1e8ffda4'
INPUTS = {
    GUARD: GUARD_SHA,
    OLD_PROPOSAL: 'ff24c04e2ef37685a3a59af46a8857df92342349d8963911d3843656d192c602',
    OLD_SOURCE: SOURCE_SHA,
    OLD / 'cargo-home-manifest.json': 'a2c8e4b8b8987cfb2b765ac0bffbe859157fa74d531c0821a05487bc4e1b5494',
    ORIGINAL_RECEIPT: '5ffcdbe897ef62843a05996501b9b2703e0533137e774303b1501df288400ebb',
    OLD_BINARY: OLD_ARTIFACT_SHA,
    CASE / 'RESULT.json': 'e7e5f9148f8dc41ba63412efc5bff0de82ee95536d9b302e31e04144a4469019',
    HERE / 'source-pin.json': 'f0d3304e1ba09a7b874fcc33d868516bc9158b61de17e379a2996dcbcd753125',
    HERE / 'body-idle-observation.patch': '83c1f2d009d67506570608a55e36283e3eef712eeadaafea89f37d59d6584d68',
    AFTER: NEW_LEAF_SHA,
}
GIB = 1024**3


def load_guard():
    if hashlib.sha256(GUARD.read_bytes()).hexdigest() != GUARD_SHA:
        raise RuntimeError('build-guard-pin')
    spec = importlib.util.spec_from_file_location('frozen_owner', GUARD)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dump_new(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n')


def require_hashes(g, refs):
    for path, digest in refs.items():
        if path.is_symlink() or g.sha(path) != digest:
            raise RuntimeError('input-pin: ' + str(path))


def facts(g):
    return {
        'UTC': g.utc(),
        'memoryFreePercent': g.memory(),
        'homeFreeBytes': g.free(g.HOME_VOLUME_PATH),
        'WDFreeBytes': g.free(WORK if WORK.exists() else CASE),
    }


def require_floors(capacity):
    if (capacity['memoryFreePercent'] < 35 or capacity['homeFreeBytes'] < int(2.25 * GIB)
            or capacity['WDFreeBytes'] < 16 * GIB):
        raise RuntimeError('fresh-resource-floor')


def inventory(root):
    result = {}
    for folder, dirs, files in os.walk(root):
        for name in dirs:
            if (Path(folder) / name).is_symlink():
                raise RuntimeError('symlink-directory-in-staging')
        for name in files:
            path = Path(folder) / name
            st = path.lstat()
            if not stat.S_ISREG(st.st_mode):
                raise RuntimeError('non-regular-input: ' + str(path))
            result[str(path.relative_to(root))] = (path, st)
    return result


def allocated_bytes(root, paths=None):
    # Cargo creates, renames and unlinks temporary rmeta files while sampled.
    # Single lstat avoids following links. A vanished sample entry is the only
    # filesystem error that can be ignored; all other monitor errors are fatal.
    total = 0
    for path in (root.rglob('*') if paths is None else paths):
        try:
            sample = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISREG(sample.st_mode):
            total += sample.st_blocks * 512
    return total


def warm_plan(g):
    first_plan = WORK / 'BUILD_PROPOSAL.json'
    first_receipt = WORK / 'build/receipt.json'
    require_hashes(g, {first_plan: FIRST_PROPOSAL_SHA, first_receipt: FIRST_BUILD_SHA, **INPUTS})
    previous = json.loads(first_receipt.read_text())
    steps = previous['steps']
    if (previous['firstFailure']['type'] != 'FileNotFoundError' or previous['cleanupFailure'] or previous['remainingOwned']
            or previous['sourceStable'] is not True or previous['artifact'] is not None
            or len(steps) != 1 or steps[0]['exit'] != -2 or steps[0]['reaped'] is not True
            or steps[0]['pid'] != 95215):
        raise RuntimeError('first-build-not-eligible-for-monitor-race-resume')
    proposal = json.loads(first_plan.read_text())
    proposal.update(controllerSHA256=g.sha(__file__), priorMonitorFailureReceiptSHA256=FIRST_BUILD_SHA)
    manifests = {}
    for name in ('cargo-home', 'target'):
        rows = {}
        for key, (_, st) in inventory(WORK / name).items():
            rows[key] = {'bytes': st.st_size, 'mode': oct(stat.S_IMODE(st.st_mode)), 'mtimeNS': st.st_mtime_ns,
                         'ctimeNS': st.st_ctime_ns, 'inode': st.st_ino, 'device': st.st_dev}
        target = WORK / ('warm-' + name + '-manifest.json')
        dump_new(target, rows)
        manifests[name] = {'path': str(target), 'SHA256': g.sha(target), 'files': len(rows)}
    proposal['cacheManifests'] = manifests
    proposal['cacheEvidence'] = 'Same locally owned, offline partially compiled cache after original wait/group0; fresh inode/ctime/mtime continuity. No reclone.'
    plan = WORK / 'BUILD_RESUME_PROPOSAL.json'
    dump_new(plan, proposal)
    print(json.dumps({'warmBuildProposal': str(plan), 'SHA256': g.sha(plan), 'CargoStarted': False}), flush=True)


def clone_tree(g, name):
    original, destination = ORIGINAL / name, WORK / name
    if name == 'source':
        g.verify_manifest(original, OLD_SOURCE)
    elif name == 'target' and g.sha(original / 'release/nym-socks5-client') != OLD_ARTIFACT_SHA:
        raise RuntimeError('cached-original-binary-pin')
    before = inventory(original)
    if not destination.exists():
        subprocess.run(['/bin/cp', '-cRp', str(original), str(destination)], check=True, timeout=180)
    after = inventory(destination)
    if before.keys() != after.keys():
        raise RuntimeError('cloned-file-inventory-difference: ' + name)
    records = {}
    # Build products changed during the original release. Only the exact
    # dependency manifest is reusable; never use the old target manifest.
    historical = json.loads((OLD / 'cargo-home-manifest.json').read_text()) if name == 'cargo-home' else {}
    for relative, (source_path, a) in before.items():
        clone_path, b = after[relative]
        if (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino):
            raise RuntimeError('cloned-input-shares-writable-inode: ' + relative)
        if a.st_size != b.st_size or a.st_mtime_ns != b.st_mtime_ns or stat.S_IMODE(a.st_mode) != stat.S_IMODE(b.st_mode):
            raise RuntimeError('cloned-file-metadata-difference: ' + relative)
        record = {'bytes': b.st_size, 'mtimeNS': b.st_mtime_ns, 'mode': oct(stat.S_IMODE(b.st_mode))}
        if name == 'source':
            digest = g.sha(source_path)
            if g.sha(clone_path) != digest:
                raise RuntimeError('cloned-file-content-difference: ' + relative)
            record['sha256'] = digest
        elif name == 'cargo-home':
            previous = historical.get(relative, {})
            if all(previous.get(key) == value for key, value in record.items()):
                record['sha256'] = previous['sha256']
            else:
                digest = g.sha(source_path)
                if g.sha(clone_path) != digest:
                    raise RuntimeError('cloned-file-content-difference: ' + relative)
                record['sha256'] = digest
        if name != 'source':
            record.update(inode=b.st_ino, device=b.st_dev, ctimeNS=b.st_ctime_ns)
        records[relative] = record
    return records


def prepare(g, resume=False):
    require_hashes(g, INPUTS)
    baseline = facts(g)
    require_floors(baseline)
    if resume:
        previous = WORK / 'preparation-interrupted.json'
        if not previous.is_file() or json.loads(previous.read_text())['originalWait'] != 143:
            raise RuntimeError('original-staging-wait-not-confirmed')
    else:
        WORK.mkdir(mode=0o700)
    dump_new(WORK / ('preparation-resume-start.json' if resume else 'preparation-start.json'),
             {'pid': os.getpid(), 'capacity': baseline})
    manifests = {}
    for name in ('source', 'cargo-home', 'target'):
        manifest = WORK / (name + '-manifest.json')
        if name == 'source' and resume:
            require_hashes(g, {manifest: '65838e1371153c3ac7a497bf628082115c5b1a7fbe87426effe0a9d9c0951055'})
            g.verify_manifest(WORK / 'source', manifest, content=False)
            rows = json.loads(manifest.read_text())
            manifests[name] = {'path': str(manifest), 'SHA256': g.sha(manifest), 'files': len(rows)}
            continue
        rows = clone_tree(g, name)
        if name == 'source':
            leaf = WORK / 'source' / LEAF
            if rows[str(LEAF)]['sha256'] != OLD_LEAF_SHA:
                raise RuntimeError('original-body-leaf-pin')
            shutil.copyfile(AFTER, leaf)
            if g.sha(leaf) != NEW_LEAF_SHA or g.sha(WORK / 'source/Cargo.lock') != LOCK_SHA:
                raise RuntimeError('successor-body-leaf-or-lock-pin')
            rows[str(LEAF)].update(sha256=NEW_LEAF_SHA, bytes=leaf.stat().st_size, mtimeNS=leaf.stat().st_mtime_ns)
        dump_new(manifest, rows)
        manifests[name] = {'path': str(manifest), 'SHA256': g.sha(manifest), 'files': len(rows)}
        print(json.dumps({'staged': name, **manifests[name]}), flush=True)
    old = json.loads(OLD_PROPOSAL.read_text())
    env = {key: value for key, value in old['environment'].items() if key not in ('TMPDIR', 'MACOSX_DEPLOYMENT_TARGET')}
    env.update(CARGO_HOME=str(WORK / 'cargo-home'), CARGO_TARGET_DIR=str(WORK / 'target'))
    proposal = {
        'schema': 'P05_NYM_QA_BODY_DIAGNOSTIC_BUILD_PLAN_V1',
        'controllerSHA256': g.sha(__file__),
        'originalSourceManifestSHA256': SOURCE_SHA,
        'preservedInputs': {str(path): digest for path, digest in INPUTS.items()},
        'CargoLockSHA256': LOCK_SHA,
        'sourceManifest': manifests['source'],
        'cacheManifests': {name: manifests[name] for name in ('cargo-home', 'target')},
        'cacheEvidence': 'Original cargo hash inventory and independent-inode metadata continuity, content rechecked on cargo drift. Target is an optimization: independent-inode metadata and pinned original executable, not an authoritative source. Cargo checks locked/offline inputs.',
        'toolchainManifest': old['toolchainManifest'],
        'immutableRecipeArgv': old['steps'][1]['argv'],
        'environment': env,
        'sharedLock': str(LOCK),
        'baseline': baseline,
        'requestedLimitsNotYetGranted': {'aggregateSeconds': 1800, 'cleanupReserveSeconds': 15},
        'actualControllerLimits': {'buildAndProbesSeconds': 885, 'cleanupSeconds': 15, 'wholeSeconds': 900, 'groupRSSBytes': 4 * GIB, 'newDiskBytes': 4 * GIB},
        'scope': 'Only the one additive HTTP instrumentation leaf; feature-on Cargo locked/offline jobs=1; no profile, public network, or production release.',
    }
    proposal_path = WORK / 'BUILD_PROPOSAL.json'
    dump_new(proposal_path, proposal)
    print(json.dumps({'buildProposal': str(proposal_path), 'SHA256': g.sha(proposal_path), 'CargoStarted': False}), flush=True)


def take_shared_lock():
    fd = os.open(LOCK, os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        held, named = os.fstat(fd), LOCK.lstat()
        if (not stat.S_ISREG(held.st_mode) or held.st_uid != os.getuid() or held.st_nlink != 1
                or held.st_mode & 0o022 or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino)):
            raise RuntimeError('shared-lock-inode')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except BaseException:
        os.close(fd)
        raise


def build(g, proposal_sha, resume=False):
    plan_path = WORK / ('BUILD_RESUME_PROPOSAL.json' if resume else 'BUILD_PROPOSAL.json')
    require_hashes(g, {plan_path: proposal_sha, **INPUTS})
    proposal = json.loads(plan_path.read_text())
    if proposal['controllerSHA256'] != g.sha(__file__) or proposal['CargoLockSHA256'] != LOCK_SHA:
        raise RuntimeError('build-controller-or-lock-pin')
    if resume:
        require_hashes(g, {WORK / 'build/receipt.json': FIRST_BUILD_SHA, WORK / 'BUILD_PROPOSAL.json': FIRST_PROPOSAL_SHA})
        if proposal['priorMonitorFailureReceiptSHA256'] != FIRST_BUILD_SHA:
            raise RuntimeError('build-resume-original-first-cause-pin')
    refs = [proposal['sourceManifest'], *proposal['cacheManifests'].values(), proposal['toolchainManifest']]
    require_hashes(g, {Path(ref['path']): ref['SHA256'] for ref in refs})
    g.ROOT = WORK
    # Preparation verified all original and cloned bytes. Check full inventory
    # and unchanged metadata of the private, never-used cache before first Cargo.
    g.verify_manifest(WORK / 'source', proposal['sourceManifest']['path'], content=False)
    for name, ref in proposal['cacheManifests'].items():
        rows = json.loads(Path(ref['path']).read_text())
        actual = inventory(WORK / name)
        if rows.keys() != actual.keys():
            raise RuntimeError('cache-inventory-continuity:' + name)
        for relative, (_, st) in actual.items():
            row = rows[relative]
            if (st.st_ino, st.st_dev, st.st_ctime_ns, st.st_mtime_ns, st.st_size, oct(stat.S_IMODE(st.st_mode))) != (
                    row['inode'], row['device'], row['ctimeNS'], row['mtimeNS'], row['bytes'], row['mode']):
                raise RuntimeError('cache-metadata-continuity:' + name + ':' + relative)
    require_hashes(g, {WORK / 'source/Cargo.lock': LOCK_SHA, WORK / 'source' / LEAF: NEW_LEAF_SHA})
    tool = Path(proposal['environment']['RUSTC']).parent.parent
    g.verify_manifest(tool, proposal['toolchainManifest']['path'])
    fd = take_shared_lock()
    try:
        # The old guard calls this after every child, including harmless version
        # and signature checks. Continuity uses the already hashed exact tree.
        def verify_source(pinned):
            g.verify_manifest(WORK / 'source', pinned['sourceManifest']['path'], content=False)
            require_hashes(g, {WORK / 'source/Cargo.lock': LOCK_SHA, WORK / 'source' / LEAF: NEW_LEAF_SHA})

        g.immutable_source = verify_source
        g.allocation = lambda: allocated_bytes(WORK)
        return run_build(g, proposal, proposal_sha, resume)
    finally:
        os.close(fd)


def run_build(g, proposal, proposal_sha, resume):
    started = time.monotonic()
    capacity = facts(g)
    require_floors(capacity)
    case = WORK / ('build-resumed' if resume else 'build')
    case.mkdir(mode=0o700)
    (case / 'tmp').mkdir(mode=0o700)
    owner = g.Build(proposal, case, started)
    owner.work_seconds = 885
    owner.baseline = {**capacity, 'ownAllocatedSumNotUniquePhysical': g.allocation()}
    failure = cleanup_failure = artifact = None
    remaining, caller_signals = [], []
    alias = None
    cancelled = False
    inherited_monitor = owner.monitor

    def cancel(signum, _frame):
        nonlocal cancelled
        caller_signals.append({'UTC': g.utc(), 'signal': signum})
        cancelled = True

    def monitor():
        if cancelled:
            raise g.CallerCancelled('caller-cancelled')
        inherited_monitor()

    signal.signal(signal.SIGINT, cancel)
    signal.signal(signal.SIGTERM, cancel)
    owner.monitor = monitor
    dump_new(case / 'start.json', {'UTC': g.utc(), 'pid': os.getpid(), 'facts': capacity,
                                  'proposalSHA256': proposal_sha, 'sharedLock': str(LOCK)})

    try:
        alias = Path(tempfile.mkdtemp(prefix='ynx-body-release.', dir='/private/tmp'))
        (alias / 'tmp').symlink_to(case / 'tmp')
        env = dict(proposal['environment'], TMPDIR=str(alias / 'tmp') + '/')
        if 'HOME' in os.environ:
            env['HOME'] = os.environ['HOME']
        owner.run('qa-release-build', proposal['immutableRecipeArgv'], 870, env)
        dest = WORK / (RESUME_ARTIFACT_REL if resume else ARTIFACT_REL)
        dest.parent.mkdir(mode=0o700, parents=True)
        shutil.copyfile(WORK / 'target/release/nym-socks5-client', dest)
        dest.chmod(0o500)
        owner.run('qa-release-version', [str(dest), '--no-banner', '--version'],
                  min(5, 885 - (time.monotonic() - started)), env)
        owner.run('qa-release-code-signature',
                  ['/usr/bin/codesign', '--verify', '--strict', '--all-architectures', str(dest)],
                  min(5, 885 - (time.monotonic() - started)), env)
        monitor()
        artifact = {'path': str(dest), 'SHA256': g.sha(dest), 'bytes': dest.stat().st_size,
                    'sourceManifestSHA256': proposal['sourceManifest']['SHA256']}
        if artifact['SHA256'] == OLD_ARTIFACT_SHA:
            raise RuntimeError('source-delta-not-reflected-in-executable')
    except BaseException as error:
        failure = {'UTC': g.utc(), 'type': type(error).__name__, 'cause': str(error)}
    finally:
        try:
            remaining = owner.cleanup()
        except BaseException as error:
            cleanup_failure = {'type': type(error).__name__, 'cause': str(error)}
            remaining = [{'state': 'UNKNOWN', 'pid': child.pid} for child in owner.children] or [{'state': 'UNKNOWN'}]
        if alias is not None and not remaining and (alias / 'tmp').is_symlink():
            (alias / 'tmp').unlink()
            alias.rmdir()
        try:
            g.immutable_source(proposal)
            require_hashes(g, INPUTS)
            source_stable = True
        except BaseException as error:
            source_stable = False
            if failure is None:
                failure = {'UTC': g.utc(), 'type': type(error).__name__, 'cause': str(error)}
        receipt = case / 'receipt.json'
        result = {'schema': 'P05_NYM_QA_BODY_DIAGNOSTIC_RELEASE_V1', 'buildPlanSHA256': proposal_sha,
                  'sourceManifest': proposal['sourceManifest'], 'CargoLockSHA256': LOCK_SHA,
                  'firstFailure': failure, 'cleanupFailure': cleanup_failure,
                  'childOutcomeRecordingFailure': owner.child_outcome_recording_failure,
                  'remainingOwned': remaining, 'steps': owner.steps, 'artifact': artifact,
                  'callerSignals': caller_signals,
                  'sourceStable': source_stable, 'wholeElapsedSeconds': time.monotonic() - started,
                  'groupRSSPeakBytes': owner.peak, 'productionRelease': False, 'publicNetworkRun': False}
        dump_new(receipt, result)
        print(json.dumps({'receipt': str(receipt), 'SHA256': g.sha(receipt), 'artifact': artifact,
                          'firstFailure': failure, 'remainingOwned': remaining}), flush=True)
        if remaining:
            owner.custody(receipt, caller_signals)
    return int(bool(failure or cleanup_failure or remaining or owner.child_outcome_recording_failure or not source_stable or artifact is None))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    prepare_parser = sub.add_parser('prepare')
    prepare_parser.add_argument('--resume', action='store_true')
    sub.add_parser('prepare-warm-resume')
    execute = sub.add_parser('execute')
    execute.add_argument('--proposal-sha256', required=True)
    execute.add_argument('--warm-resume', action='store_true')
    args = parser.parse_args()
    g = load_guard()
    if args.operation == 'prepare':
        prepare(g, args.resume)
        return 0
    if args.operation == 'prepare-warm-resume':
        warm_plan(g)
        return 0
    return build(g, args.proposal_sha256, args.warm_resume)


if __name__ == '__main__':
    raise SystemExit(main())
