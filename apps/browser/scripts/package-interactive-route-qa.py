#!/usr/bin/python3
"""Assemble a local, explicitly experimental Tor/Nym browser QA bundle.

This command neither builds the executable nor launches or installs the result.
The macOS admission decision, connectivity and leak testing are separate steps.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess


ROLES = {
    'launcher': ('com.ynxweb4.browser.qa.interactive', 'YNX Route Test'),
    'tor': ('com.ynxweb4.browser.qa.tor.interactive', 'Tor Interactive QA'),
    'nym': ('com.ynxweb4.browser.qa.nym.interactive', 'Nym Interactive QA'),
}
TOR_PINS = {
    'arti': 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a',
    'lyrebird': '7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d',
    'public-bridges.json': '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407',
    'manifest.json': '5e26027c57d222da151002958656acd27639708aa7a95668842bf244b2ed1e74',
}
NYM_DIRECTORY_SHA256 = '855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798'
NYM_RUNTIME_SHA256 = '331afc307bd38c5a8adcddc25f0e333790bf332a61661ce1d800412917a9cb00'
NYM_MANIFEST_SHA256 = '6ee129f7bcdbf7b292be948ab6e3869a7d7ea71e00948f9c75f1bc0cdeb19477'
MAX_FILE_BYTES = 128 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_file(path, limit=MAX_FILE_BYTES):
    """Read one actual regular file without following symlinks or accepting changes."""
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise ValueError(f'Input is not an absolute, non-symlink path: {path}')
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or
                before.st_mode & 0o022 or not 0 < before.st_size <= limit):
            raise ValueError(f'Unsafe input file: {path}')
        chunks, remaining = [], before.st_size
        while remaining:
            chunk = os.read(fd, min(1024 * 1024, remaining))
            if not chunk:
                raise ValueError(f'Input shortened while reading: {path}')
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(fd, 1):
            raise ValueError(f'Input grew while reading: {path}')
        after = os.fstat(fd)
        names = ('st_dev', 'st_ino', 'st_size', 'st_mode', 'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(before, name) != getattr(after, name) for name in names):
            raise ValueError(f'Input changed while reading: {path}')
        return b''.join(chunks), bool(before.st_mode & 0o111)
    finally:
        os.close(fd)


def copy_supply(source, destination):
    source = Path(source)
    if not source.is_absolute() or source.resolve(strict=True) != source or not source.is_dir():
        raise ValueError(f'Supply is not an actual directory: {source}')
    hashes = {}
    for base, directories, files in os.walk(source, followlinks=False):
        base = Path(base)
        for name in directories:
            item = base / name
            if item.is_symlink() or not item.is_dir() or item.stat().st_mode & 0o022:
                raise ValueError(f'Invalid supply directory: {item}')
        relative = base.relative_to(source)
        target_dir = destination / relative
        target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name in files:
            item = base / name
            raw, executable = read_file(item)
            target = target_dir / name
            with target.open('xb') as output:
                output.write(raw)
            target.chmod(0o700 if executable else 0o600)
            hashes[str(item.relative_to(source))] = sha(raw)
    return hashes


def populate_app(path, role, executable):
    identifier, name = ROLES[role]
    contents = path / 'Contents'
    macos = contents / 'MacOS'
    macos.mkdir(mode=0o700, parents=True)
    info = {'CFBundleIdentifier': identifier, 'CFBundleName': name,
            'CFBundleExecutable': 'YNXBrowserNative', 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': '0.4.3', 'CFBundleVersion': '1',
            'LSMinimumSystemVersion': '14.0', 'NSPrincipalClass': 'NSApplication',
            'YNXInteractiveRouteExperiment': True}
    (contents / 'Info.plist').write_bytes(plistlib.dumps(info, sort_keys=True))
    binary = macos / 'YNXBrowserNative'
    with binary.open('xb') as output:
        output.write(executable)
    binary.chmod(0o700)


def sign_and_verify(path):
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', str(path)],
                   check=True, capture_output=True, timeout=60)
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', '--all-architectures', str(path)],
                   check=True, capture_output=True, timeout=60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--binary-sha256', required=True)
    parser.add_argument('--tor-supply', required=True, type=Path)
    parser.add_argument('--nym-supply', required=True, type=Path)
    parser.add_argument('--nym-directory-sha256', required=True)
    parser.add_argument('--nym-runtime-sha256', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    for value in (args.binary_sha256, args.nym_directory_sha256, args.nym_runtime_sha256):
        if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
            parser.error('All SHA-256 pins must be lowercase hexadecimal')
    if not args.output.is_absolute() or args.output.suffix != '.app' or args.output.exists():
        parser.error('Output must be a new absolute .app path')
    if args.output.with_suffix('.package.json').exists():
        parser.error('Output receipt already exists')
    if args.output.parent.resolve(strict=True) != args.output.parent:
        parser.error('Output parent must not contain symlinks')
    if (args.nym_directory_sha256 != NYM_DIRECTORY_SHA256 or
            args.nym_runtime_sha256 != NYM_RUNTIME_SHA256):
        raise ValueError('Nym supply pins are not the reviewed interactive cohort')
    executable, is_executable = read_file(args.binary)
    if not is_executable or sha(executable) != args.binary_sha256:
        raise ValueError('QA executable differs from its supplied pin or is not executable')
    os.umask(0o077)
    populate_app(args.output, 'launcher', executable)
    helpers = args.output / 'Contents/Helpers'
    tor = helpers / 'Tor Interactive QA.app'
    nym = helpers / 'Nym Interactive QA.app'
    populate_app(tor, 'tor', executable)
    populate_app(nym, 'nym', executable)
    tor_hashes = copy_supply(args.tor_supply, tor / 'Contents/Resources/PrivacyBackends/Tor')
    nym_hashes = copy_supply(args.nym_supply, nym / 'Contents/Resources/NymPublicRuntime')
    if any(tor_hashes.get(path) != pin for path, pin in TOR_PINS.items()):
        raise ValueError('Tor supply does not match the fixed Arti/Lyrebird/bridge pins')
    if (nym_hashes.get('directory/nym-socks5-client') != args.nym_directory_sha256 or
            nym_hashes.get('runtime/nym-socks5-client') != args.nym_runtime_sha256 or
            nym_hashes.get('manifest.json') != NYM_MANIFEST_SHA256):
        raise ValueError('Nym supply executables do not match the supplied exact pins')
    # The Native consumer separately validates its compiled-in role and supply manifest.
    for role in (tor, nym, args.output):
        sign_and_verify(role)
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(args.output)],
                   check=True, capture_output=True, timeout=60)
    # Sealing the app must not alter the pinned nested backend executables.
    for relative, expected in TOR_PINS.items():
        if sha((tor / 'Contents/Resources/PrivacyBackends/Tor' / relative).read_bytes()) != expected:
            raise ValueError('Tor supply changed during signing')
    for relative, expected in [('directory/nym-socks5-client', NYM_DIRECTORY_SHA256),
                               ('runtime/nym-socks5-client', NYM_RUNTIME_SHA256),
                               ('manifest.json', NYM_MANIFEST_SHA256)]:
        if sha((nym / 'Contents/Resources/NymPublicRuntime' / relative).read_bytes()) != expected:
            raise ValueError('Nym supply changed during signing')
    result = {'schema': 'YNX_INTERACTIVE_ROUTE_QA_PACKAGE_V1', 'inputExecutableSHA256': args.binary_sha256,
              'bundleIDs': {key: value[0] for key, value in ROLES.items()},
              'torSupplySHA256': tor_hashes, 'nymSupplySHA256': nym_hashes,
              'signed': 'ad-hoc local QA', 'platformAdmission': 'NOT_TESTED',
              'installed': False, 'launched': False, 'torReachability': 'NOT_TESTED',
              'nymReachability': 'NOT_TESTED', 'wholeWindowLeakSafety': 'NOT_TESTED',
              'productionApproved': False}
    receipt = args.output.with_suffix('.package.json')
    with receipt.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({'status': 'ASSEMBLED_NOT_LAUNCHED', 'app': str(args.output), 'receipt': str(receipt)}))


if __name__ == '__main__':
    main()
