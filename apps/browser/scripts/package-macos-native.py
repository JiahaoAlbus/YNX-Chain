#!/usr/bin/python3
"""Assemble one local ad-hoc QA app with isolated per-mode helpers; never install or launch it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
from urllib.parse import urlsplit
from privacy_backend_supply import RESOURCE_PATHS, read_supply, stage_supply


def read_normal_template():
    template = Path(__file__).resolve().parents[1] / 'native/AppBundle/Info.plist'
    with template.open('rb') as source:
        info = plistlib.load(source)
    # Keep the identifiers and keys aligned with publicDiagnosticRoleRequested in main.swift.
    identifier = info.get('CFBundleIdentifier')
    if identifier in ('com.ynxweb4.browser.qa.tor.public-search',
                      'com.ynxweb4.browser.qa.tor.public-search.snowflake',
                      'com.ynxweb4.browser.qa.nym.public-search',
                      'com.ynxweb4.browser.qa.interactive',
                      'com.ynxweb4.browser.qa.tor.interactive',
                      'com.ynxweb4.browser.qa.nym.interactive'):
        raise ValueError(f'Public-search diagnostic identifier in normal app template: {identifier}')
    # The normal executable exits on presence of any of these keys, even if false.
    for marker in ('YNXPublicSearchDiagnostic', 'YNXPublicSnowflakeSearchDiagnostic',
                   'YNXPublicNymSearchDiagnostic', 'YNXPublicSnowflakeLaunchSHA256',
                   'YNXPublicArtiChannelTimeoutExperiment', 'YNXInteractiveRouteExperiment'):
        if marker in info:
            raise ValueError(f'Public-search diagnostic marker in normal app template: {marker}')
    return info


def signature_identity(application: Path):
    result = subprocess.run(['codesign', '--display', '--verbose=4', str(application)], check=True, capture_output=True, text=True)
    fields = dict(line.split('=', 1) for line in result.stderr.splitlines() if '=' in line)
    team = fields.get('TeamIdentifier')
    return {'identifier': fields['Identifier'], 'codeDirectoryHash': fields['CDHash'],
            'teamIdentifier': None if team in (None, 'not set') else team}


def validate_route_filter_provider(provider, expected_sha256, reviewed_team):
    """Artifact binding only; a provider signature never grants route qualification."""
    if provider is None and expected_sha256 is None:
        return None
    if (provider is None or not isinstance(expected_sha256, str)
            or re.fullmatch('[a-f0-9]{64}', expected_sha256) is None):
        raise ValueError('Reviewed provider bundle and exact post-sign executable SHA-256 are required together')
    if not isinstance(reviewed_team, str) or re.fullmatch('[A-Z0-9]{10}', reviewed_team) is None:
        raise ValueError('Provider intake requires the source template reviewed Team; no caller Team override')
    provider = Path(provider).absolute()
    if provider.resolve(strict=True) != provider or not provider.is_dir() or provider.suffix != '.systemextension':
        raise ValueError('Provider must be an actual system-extension bundle without symlink ancestors')
    info_path = provider / 'Contents/Info.plist'
    if (info_path.resolve(strict=True) != info_path or not info_path.is_file()
            or not 0 < info_path.stat().st_size <= 65536):
        raise ValueError('Invalid provider Info.plist')
    info = plistlib.loads(info_path.read_bytes())
    identifier = 'com.ynxweb4.browser.routefilter.provider'
    if (info.get('CFBundleIdentifier') != identifier or info.get('CFBundleExecutable') != 'YNXPrivacyFilter'
            or info.get('CFBundlePackageType') != 'SYSX' or info.get('YNXReviewedTeamIdentifier') != reviewed_team):
        raise ValueError('Provider bundle identity differs from the reviewed source configuration')
    executable = provider / 'Contents/MacOS/YNXPrivacyFilter'
    if executable.resolve(strict=True) != executable:
        raise ValueError('Provider executable cannot use symlink ancestors')
    fd = os.open(executable, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_mode & 0o022
                or not 0 < before.st_size <= 268435456):
            raise ValueError('Provider executable is not a bounded regular file')
        digest = hashlib.sha256()
        consumed = 0
        while True:
            chunk = os.read(fd, 1048576)
            if not chunk:
                break
            consumed += len(chunk)
            if consumed > before.st_size:
                raise ValueError('Provider executable grew during intake')
            digest.update(chunk)
        after = os.fstat(fd)
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
                or digest.hexdigest() != expected_sha256):
            raise ValueError('Provider executable changed or differs from its reviewed post-sign pin')
        requirement = ('anchor apple generic and certificate leaf[subject.OU] = "' + reviewed_team
                       + '" and identifier "' + identifier + '"')
        subprocess.run(['codesign', '--verify', '--strict', '--all-architectures', '-R=' + requirement,
                        str(provider)], check=True, capture_output=True, timeout=30)
        identity = signature_identity(provider)
        current = executable.stat()
        if (identity['teamIdentifier'] != reviewed_team or identity['identifier'] != identifier
                or (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns)
                != (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)):
            raise ValueError('Provider signature or executable identity changed during intake')
    finally:
        os.close(fd)
    return {'providerExecutableSHA256': expected_sha256, 'codeSignature': identity,
            'platformIsolationAdmitted': False, 'installedOrActivated': False}


def validate_nym_proof_configuration(origin, response_sha256):
    """Syntax and expected-byte pin only; never service approval or network qualification."""
    if origin is None and response_sha256 is None:
        return None
    if not isinstance(origin, str) or not isinstance(response_sha256, str):
        raise ValueError('Nym proof origin and response SHA-256 must be supplied together')
    if not origin or len(origin) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in origin):
        raise ValueError('Nym proof requires an explicit HTTPS public DNS origin')
    try:
        parts = urlsplit(origin)
        host = parts.hostname
        port = parts.port
    except ValueError as error:
        raise ValueError('Invalid Nym proof origin') from None
    if (parts.scheme != 'https' or not host or len(host) > 253 or '.' not in host
            or not re.search('[a-z]', host) or parts.username is not None or parts.password is not None
            or port not in (None, 443) or parts.path not in ('', '/')
            or '?' in origin or '#' in origin or '\\' in origin
            or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in host.split('.'))
            or host.endswith(('.localhost', '.local', '.test', '.invalid', '.example', '.onion'))):
        raise ValueError('Nym proof requires an explicit HTTPS public DNS origin')
    if re.fullmatch('[a-f0-9]{64}', response_sha256) is None:
        raise ValueError('Nym proof response SHA-256 must be exactly 64 lowercase hexadecimal characters')
    return {'origin': 'https://' + host, 'responseSHA256': response_sha256}


def copy_browser_executable(binary: Path, destination: Path) -> None:
    shutil.copy2(binary, destination)
    # The build umask is private, but each sealed app executable needs all execute bits.
    destination.chmod(0o755)


def package(binary: Path, output: Path, tor_supply: Path = None, nym_supply: Path = None, spawn_gate_helper: Path = None,
            nym_proof_origin: str = None, nym_proof_response_sha256: str = None,
            route_filter_provider: Path = None, route_filter_provider_sha256: str = None) -> None:
    proof_configuration = validate_nym_proof_configuration(nym_proof_origin, nym_proof_response_sha256)
    if proof_configuration is not None and nym_supply is None:
        raise ValueError('Controlled Nym proof configuration requires a reviewed Nym runtime supply')
    binary = binary.resolve(strict=True)
    if output.exists() or output.is_symlink() or output.suffix != '.app':
        raise ValueError('output must be a fresh .app path')
    info = read_normal_template()
    supplies = {mode: read_supply(mode, directory) for mode, directory in [('tor', tor_supply), ('nym', nym_supply)] if directory is not None}
    gate_bytes = None
    if spawn_gate_helper is not None:
        if spawn_gate_helper.is_symlink() or not spawn_gate_helper.is_file() or not 0 < spawn_gate_helper.stat().st_size <= 8_000_000:
            raise ValueError('reviewed owned spawn helper must be a bounded regular executable')
        gate_bytes = spawn_gate_helper.read_bytes()
    # Never inherit a stale or synthetic provider pin from a template. Only explicit
    # current, signed provider intake can bind the normal root and its proof child.
    info.pop('YNXRouteFilterProviderSHA256', None)
    # This producer only ad-hoc signs QA artifacts. A stale normal-observation
    # role must not migrate into QA, routed copies, or the proof helper. The
    # original Team-signing recipe binds that role independently; it is not a
    # qualification or a caller-controlled switch on this QA packager.
    info.pop('YNXNormalArtifactCaptureRole', None)
    provider_binding = validate_route_filter_provider(route_filter_provider, route_filter_provider_sha256,
                                                     info.get('YNXReviewedTeamIdentifier'))
    output.mkdir(mode=0o700, parents=True)
    (output / 'Contents/MacOS').mkdir(parents=True)
    (output / 'Contents/Resources').mkdir()
    copy_browser_executable(binary, output / 'Contents/MacOS/YNXBrowserNative')
    bundled = {mode: stage_supply(mode, files, output) for mode, files in supplies.items()}
    pins = {}
    start_gates = {}
    nym_proof = None
    for mode, name in [('tor', 'YNX Tor Route.app'), ('nym', 'YNX Nym Route.app')]:
        helper = output / 'Contents/Helpers' / name
        (helper / 'Contents/MacOS').mkdir(parents=True)
        executable = helper / 'Contents/MacOS/YNXBrowserNative'
        copy_browser_executable(binary, executable)
        role_info = dict(info)
        role_info.pop('CFBundleURLTypes', None)
        role_info.update(CFBundleIdentifier=f'com.ynxweb4.browser.route.{mode}',
                         CFBundleName=name[:-4], CFBundleDisplayName=name[:-4],
                         YNXPrivacyRouteMode=mode, LSMinimumSystemVersion='14.0')
        if provider_binding is not None:
            role_info['YNXRouteFilterProviderSHA256'] = provider_binding['providerExecutableSHA256']
        if mode in supplies:
            role_info['YNXBundledPrivacyBackends'] = {mode: stage_supply(mode, supplies[mode], helper)}
        if gate_bytes is not None:
            gate = helper / 'Contents/Helpers/YNXBackendStartGate'
            gate.parent.mkdir(parents=True)
            gate.write_bytes(gate_bytes); gate.chmod(0o755)
            subprocess.run(['codesign', '--force', '--sign', '-', '--identifier', 'com.ynxweb4.browser.route-start-gate', '--timestamp=none', str(gate)], check=True)
            subprocess.run(['codesign', '--verify', '--strict', str(gate)], check=True)
            start_gates[mode] = hashlib.sha256(gate.read_bytes()).hexdigest()
            role_info['YNXBackendStartGateSHA256'] = start_gates[mode]
        if mode == 'nym':
            if proof_configuration is not None:
                role_info['YNXNymProofOrigin'] = proof_configuration['origin']
                role_info['YNXNymProofResponseSHA256'] = proof_configuration['responseSHA256']
            proof_app = helper / 'Contents/Helpers/YNX Nym Probe.app'
            (proof_app / 'Contents/MacOS').mkdir(parents=True)
            proof_executable = proof_app / 'Contents/MacOS/YNXBrowserNative'
            copy_browser_executable(binary, proof_executable)
            proof_info = dict(info)
            proof_info.pop('CFBundleURLTypes', None)
            proof_info.pop('YNXPrivacyRouteMode', None)
            proof_info.update(CFBundleIdentifier='com.ynxweb4.browser.route.nym.probe',
                              CFBundleName='YNX Nym Probe', CFBundleDisplayName='YNX Nym Probe',
                              YNXNymProofHelper=True, LSBackgroundOnly=True)
            if provider_binding is not None:
                proof_info['YNXRouteFilterProviderSHA256'] = provider_binding['providerExecutableSHA256']
            with (proof_app / 'Contents/Info.plist').open('wb') as target:
                plistlib.dump(proof_info, target)
            subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(proof_app)], check=True)
            subprocess.run(['codesign', '--verify', '--strict', str(proof_app)], check=True)
            proof_sha256 = hashlib.sha256(proof_executable.read_bytes()).hexdigest()
            role_info['YNXNymProofHelperSHA256'] = proof_sha256
            nym_proof = {'binarySHA256': proof_sha256, 'codeSignature': signature_identity(proof_app),
                         'relativePath': 'Contents/Helpers/YNX Nym Probe.app', 'networkTested': False}
        with (helper / 'Contents/Info.plist').open('wb') as target:
            plistlib.dump(role_info, target)
        subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(helper)], check=True)
        subprocess.run(['codesign', '--verify', '--strict', str(helper)], check=True)
        pins[mode] = hashlib.sha256(executable.read_bytes()).hexdigest()
    info['YNXRoutedExecutableSHA256'] = pins
    info['YNXBundledPrivacyBackends'] = bundled
    if provider_binding != validate_route_filter_provider(route_filter_provider, route_filter_provider_sha256,
                                                         info.get('YNXReviewedTeamIdentifier')):
        raise ValueError('Provider binding changed while staging application roles')
    with (output / 'Contents/Info.plist').open('wb') as target:
        plistlib.dump(info, target)
    subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(output)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(output)], check=True)
    for mode, files in supplies.items():
        helper_name = 'YNX Tor Route.app' if mode == 'tor' else 'YNX Nym Route.app'
        for application in [output, output / 'Contents/Helpers' / helper_name]:
            root = application / 'Contents/Resources' / RESOURCE_PATHS[mode]
            for relative, (_, _, expected) in files.items():
                if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected:
                    raise ValueError('signing modified a pinned backend resource')
    receipt = {'schema': 'YNX_NATIVE_LOCAL_PACKAGE_V1', 'application': str(output.absolute()),
               'inputExecutableSHA256': hashlib.sha256(binary.read_bytes()).hexdigest(),
               'signedExecutableSHA256': hashlib.sha256((output / 'Contents/MacOS/YNXBrowserNative').read_bytes()).hexdigest(),
               'routedExecutables': pins, 'signing': 'ad-hoc QA only',
               'backendStartGates': start_gates,
               'inputStartGateSHA256': hashlib.sha256(gate_bytes).hexdigest() if gate_bytes is not None else None,
               'nymProofHelper': nym_proof,
               'nymProofResourceConfiguration': proof_configuration,
               'nymProofNetworkValidated': False,
               'normalRouteFilterProviderBinding': provider_binding,
               'codeSignatures': {'ordinary': signature_identity(output),
                                  'tor': signature_identity(output / 'Contents/Helpers/YNX Tor Route.app'),
                                  'nym': signature_identity(output / 'Contents/Helpers/YNX Nym Route.app')},
               'bundledBackends': bundled,
               'installed': False, 'launched': False, 'platformIsolationAdmitted': False}
    # Keep the receipt outside the signed bundle; adding it inside would invalidate the seal.
    output.with_suffix('.package.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--tor-supply', type=Path, help='Exact reviewed offline Tor contract directory; no automatic fetch')
    parser.add_argument('--nym-supply', type=Path, help='Exact reviewed offline Nym overlay contract directory; no user keys')
    parser.add_argument('--spawn-gate-helper', type=Path, help='Current owned start-suspended helper compiled from reviewed source')
    parser.add_argument('--nym-proof-origin', help='Explicit reviewed public HTTPS proof origin; no default and no deployment implied')
    parser.add_argument('--nym-proof-response-sha256', help='Exact SHA-256 of the reviewed fixed public proof response bytes')
    parser.add_argument('--route-filter-provider', type=Path, help='Explicit reviewed signed provider .systemextension; does not install or activate it')
    parser.add_argument('--route-filter-provider-sha256', help='Exact reviewed post-sign provider executable SHA-256; source template Team is required')
    args = parser.parse_args()
    package(args.binary, args.output, args.tor_supply, args.nym_supply, args.spawn_gate_helper,
            args.nym_proof_origin, args.nym_proof_response_sha256,
            args.route_filter_provider, args.route_filter_provider_sha256)
