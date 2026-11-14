#!/usr/bin/python3
"""Assemble one local ad-hoc QA app with isolated per-mode helpers; never install or launch it."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess


def package(binary: Path, output: Path) -> None:
    binary = binary.resolve(strict=True)
    if output.exists() or output.is_symlink() or output.suffix != '.app':
        raise ValueError('output must be a fresh .app path')
    template = Path(__file__).resolve().parents[1] / 'native/AppBundle/Info.plist'
    with template.open('rb') as source:
        info = plistlib.load(source)
    output.mkdir(mode=0o700)
    (output / 'Contents/MacOS').mkdir(parents=True)
    (output / 'Contents/Resources').mkdir()
    shutil.copy2(binary, output / 'Contents/MacOS/YNXBrowserNative')
    pins = {}
    for mode, name in [('tor', 'YNX Tor Route.app'), ('nym', 'YNX Nym Route.app')]:
        helper = output / 'Contents/Helpers' / name
        (helper / 'Contents/MacOS').mkdir(parents=True)
        executable = helper / 'Contents/MacOS/YNXBrowserNative'
        shutil.copy2(binary, executable)
        role_info = dict(info)
        role_info.pop('CFBundleURLTypes', None)
        role_info.update(CFBundleIdentifier=f'com.ynxweb4.browser.route.{mode}',
                         CFBundleName=name[:-4], CFBundleDisplayName=name[:-4],
                         YNXPrivacyRouteMode=mode, LSMinimumSystemVersion='14.0')
        with (helper / 'Contents/Info.plist').open('wb') as target:
            plistlib.dump(role_info, target)
        subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(helper)], check=True)
        subprocess.run(['codesign', '--verify', '--strict', str(helper)], check=True)
        pins[mode] = hashlib.sha256(executable.read_bytes()).hexdigest()
    info['YNXRoutedExecutableSHA256'] = pins
    with (output / 'Contents/Info.plist').open('wb') as target:
        plistlib.dump(info, target)
    subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(output)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(output)], check=True)
    receipt = {'schema': 'YNX_NATIVE_LOCAL_PACKAGE_V1', 'application': str(output.absolute()),
               'inputExecutableSHA256': hashlib.sha256(binary.read_bytes()).hexdigest(),
               'signedExecutableSHA256': hashlib.sha256((output / 'Contents/MacOS/YNXBrowserNative').read_bytes()).hexdigest(),
               'routedExecutables': pins, 'signing': 'ad-hoc QA only',
               'installed': False, 'launched': False, 'platformIsolationAdmitted': False}
    # Keep the receipt outside the signed bundle; adding it inside would invalidate the seal.
    output.with_suffix('.package.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    package(args.binary, args.output)
