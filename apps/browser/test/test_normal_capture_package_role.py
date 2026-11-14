#!/usr/bin/env python3
"""Exercise the normal observation and public diagnostic package boundaries.

Uses a copied inert system executable, never launches it, and never supplies a
Team, provider, backend, qualification, or user profile.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import subprocess
import sys


PUBLIC_DIAGNOSTIC_MARKERS = (
    'YNXPublicSearchDiagnostic',
    'YNXPublicSnowflakeSearchDiagnostic',
    'YNXPublicNymSearchDiagnostic',
    'YNXPublicSnowflakeLaunchSHA256',
    'YNXPublicArtiChannelTimeoutExperiment',
    'YNXInteractiveRouteExperiment',
)
PUBLIC_DIAGNOSTIC_IDENTIFIERS = (
    'com.ynxweb4.browser.qa.tor.public-search',
    'com.ynxweb4.browser.qa.tor.public-search.snowflake',
    'com.ynxweb4.browser.qa.nym.public-search',
    'com.ynxweb4.browser.qa.interactive',
    'com.ynxweb4.browser.qa.tor.interactive',
    'com.ynxweb4.browser.qa.nym.interactive',
)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'darwin' or not args.output.is_absolute() or args.output.exists():
        parser.error('Actual macOS and fresh absolute output required')
    os.umask(0o077)
    args.output.mkdir(mode=0o700)
    browser = Path(__file__).resolve().parents[1]
    isolated = args.output / 'isolated-browser'
    scripts = isolated / 'scripts'
    scripts.mkdir(parents=True)
    inputs = {}
    for name in ['build-macos-app.sh', 'package-macos-native.py', 'privacy_backend_supply.py']:
        original = browser / 'scripts' / name
        inputs[str(original)] = sha(original)
        shutil.copyfile(original, scripts / name)
    template = browser / 'native/AppBundle/Info.plist'
    inputs[str(template)] = sha(template)
    info = plistlib.loads(template.read_bytes())
    info.pop('YNXReviewedTeamIdentifier', None)
    info['YNXNormalArtifactCaptureRole'] = 'normal-artifact-observation-v1'
    info['YNXRouteFilterProviderSHA256'] = '0' * 64
    destination = isolated / 'native/AppBundle/Info.plist'
    destination.parent.mkdir(parents=True)
    destination.write_bytes(plistlib.dumps(info))
    binary = args.output / 'inert-input'
    shutil.copyfile('/usr/bin/true', binary)
    binary.chmod(0o700)
    before = sha(binary)
    app = args.output / 'QA-Role-Boundary.app'
    argv = ['/usr/bin/python3', str(scripts / 'package-macos-native.py'),
            '--binary', str(binary), '--output', str(app)]
    invalid_roles = [(marker, {marker: False}, f'marker in normal app template: {marker}')
                     for marker in PUBLIC_DIAGNOSTIC_MARKERS]
    invalid_roles += [(identifier, {'CFBundleIdentifier': identifier},
                       f'identifier in normal app template: {identifier}')
                      for identifier in PUBLIC_DIAGNOSTIC_IDENTIFIERS]
    rejected_roles = []
    for name, change, reason in invalid_roles:
        destination.write_bytes(plistlib.dumps({**info, **change}))
        message = f'Public-search diagnostic {reason}'.encode()
        preflight = subprocess.run(['/bin/bash', str(scripts / 'build-macos-app.sh')],
                                   capture_output=True, timeout=10)
        assert preflight.returncode == 64
        assert message in preflight.stderr
        assert not (isolated / 'dist').exists()
        contaminated_app = args.output / f'{name}.app'
        result = subprocess.run(argv[:-1] + [str(contaminated_app)], capture_output=True, timeout=45)
        (args.output / f'{name}.stderr').write_bytes(result.stderr)
        assert result.returncode == 1, f'{name} produced exit {result.returncode}'
        assert message in result.stderr
        assert not contaminated_app.exists()
        assert not contaminated_app.with_suffix('.package.json').exists()
        rejected_roles.append(name)
    destination.write_bytes(plistlib.dumps(info))

    with (args.output / 'assembly.stdout').open('xb') as stdout, (args.output / 'assembly.stderr').open('xb') as stderr:
        result = subprocess.run(argv, stdout=stdout, stderr=stderr, timeout=45)
    if result.returncode:
        raise RuntimeError('Actual QA assembly failed; preserve original stderr')
    roles = [app, app / 'Contents/Helpers/YNX Tor Route.app',
             app / 'Contents/Helpers/YNX Nym Route.app',
             app / 'Contents/Helpers/YNX Nym Route.app/Contents/Helpers/YNX Nym Probe.app']
    observed = []
    for role in roles:
        actual = plistlib.loads((role / 'Contents/Info.plist').read_bytes())
        assert 'YNXNormalArtifactCaptureRole' not in actual
        assert 'YNXRouteFilterProviderSHA256' not in actual
        assert not actual.get('YNXReviewedTeamIdentifier')
        executable = role / 'Contents/MacOS' / actual['CFBundleExecutable']
        assert stat.S_IMODE(executable.stat().st_mode) == 0o755
        check = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(role)],
                               capture_output=True, timeout=10)
        assert check.returncode == 0
        observed.append({'relativeRole': str(role.relative_to(args.output)),
                         'bundleID': actual['CFBundleIdentifier'],
                         'executableMode': '0755',
                         'normalObservationMarkerPresent': False,
                         'providerPinPresent': False, 'strictSealExit': check.returncode})
    package = json.loads(app.with_suffix('.package.json').read_text())
    assert package['signing'] == 'ad-hoc QA only'
    assert package['platformIsolationAdmitted'] is False
    assert package['normalRouteFilterProviderBinding'] is None
    assert not package['installed'] and not package['launched']
    assert sha(binary) == before
    assert stat.S_IMODE(binary.stat().st_mode) == 0o700
    assert all(sha(Path(path)) == pin for path, pin in inputs.items())
    receipt = {'schema': 'P05_QA_NORMAL_CAPTURE_ROLE_BOUNDARY_V1', 'inputs': inputs,
               'command': argv, 'assemblyExit': 0, 'actualRoles': observed,
               'rejectedPublicDiagnosticRoles': rejected_roles,
               'inertInputUnchanged': True, 'sourceDrift': False,
               'realCodeSigning': 'actual ad-hoc only; no Team identity supplied',
               'normalQualificationCreated': False, 'AppOrBackendOrNetworkStarted': False,
               'installed': False, 'productionPrivacyApproved': False}
    (args.output / 'RESULT.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': 'PASS', 'rolesChecked': len(observed), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
