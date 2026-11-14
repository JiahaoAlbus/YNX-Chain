"""Offline intake for fixed backend bytes; never reads a route profile or starts a process."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat

PINS = {
    'tor': {'arti': 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a',
            'lyrebird': '7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d',
            'public-bridges.json': '2f7cf039710e96b70ea7d45473b905f9a6ce9a8b65e9f03e2507135ae8c75407'},
    # Reviewed protected-numeric V2 with absolute expiry; the preserved 04d V1 is not admitted.
    'nym': {'nym-socks5-client': '9cf0324880bdb8d8b8909581c81b91f750174b6ff0569e4f5270426c0dacb5a6',
            'recovery-overlay-pin.json': 'aed4ae1435f0fec8387018aed9291dd03117f20c38bb116657896901aae97f6f',
            'resume-unconfigured.patch': '382895ca68660776a0d92ad99e448c4289c8234e8075d24fb4c199cdbb6e69a3',
            'build-receipt.json': 'bf5afd267f8b967ee748d0f6fefebe1f2141f361629cc04c0ae1f795fe8d6d8f',
            'LICENSE.Apache-2.0.txt': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'},
}
RESOURCE_PATHS = {'tor': 'PrivacyBackends/Tor', 'nym': 'NymRuntime'}
METADATA = {'tor': {'manifest.json'}, 'nym': {'manifest.json'}}
EXECUTABLES = {'arti', 'lyrebird', 'nym-socks5-client'}

def _tor_license_gate():
    path = Path(__file__).resolve().parents[1] / 'privacy-routing/tor/license_supply.py'
    specification = importlib.util.spec_from_file_location('ynx_fixed_tor_license_supply', path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module

def read_supply(mode: str, directory: Path, *, require_release_licenses: bool = False):
    # Inputs are deliberately explicit local staging directories. There is no fallback to HOME,
    # environment proxy configuration, another installed app, a QA profile or a download URL.
    directory = directory.absolute()
    if directory.resolve(strict=True) != directory or not directory.is_dir():
        raise ValueError('backend supply root must be an actual directory without symlink ancestors')
    output = {}
    for path in directory.rglob('*'):
        relative = path.relative_to(directory).as_posix()
        attributes = path.lstat()
        if stat.S_ISDIR(attributes.st_mode):
            if mode != 'tor' or relative != 'LICENSES': raise ValueError('unexpected supply directory')
            continue
        if not stat.S_ISREG(attributes.st_mode) or attributes.st_mode & 0o022 or attributes.st_nlink != 1:
            raise ValueError('unsafe supply file')
        notice = mode == 'tor' and relative.startswith('LICENSES/') and len(path.relative_to(directory).parts) == 2 and path.suffix.lower() in {'.txt', '.md', '.toml'}
        if relative not in PINS[mode] and relative not in METADATA[mode] and not notice:
            raise ValueError('unreviewed backend supply file')
        bound = 64_000_000 if relative in EXECUTABLES else 2_000_000
        if not 0 < attributes.st_size <= bound: raise ValueError('backend supply byte bound')
        with path.open('rb') as source:
            data = source.read(bound + 1)
        after = path.lstat()
        if len(data) != attributes.st_size or (after.st_ino, after.st_dev, after.st_mtime_ns, after.st_size) != (attributes.st_ino, attributes.st_dev, attributes.st_mtime_ns, attributes.st_size):
            raise ValueError('backend supply changed during intake')
        digest = hashlib.sha256(data).hexdigest()
        if relative in PINS[mode] and digest != PINS[mode][relative]:
            raise ValueError('fixed backend byte mismatch; new signatures require explicit new intake')
        output[relative] = (data, 0o755 if relative in EXECUTABLES else 0o644, digest)
    if not (set(PINS[mode]) | METADATA[mode]).issubset(output):
        raise ValueError('incomplete backend supply')
    manifest = json.loads(output['manifest.json'][0])
    if mode == 'tor':
        contract = Path(__file__).resolve().parents[1] / 'privacy-routing/tor/tests/bundled-tor-manifest-v1.json'
        if manifest != json.loads(contract.read_text()): raise ValueError('Tor manifest differs from reviewed loader contract')
        gate = _tor_license_gate()
        if require_release_licenses: gate.require_release_license_coverage(output)
        else: gate.inspect_supply_license_materials(output)
    else:
        contract = Path(__file__).resolve().parents[1] / 'privacy-routing/nym/bundled-supply-manifest.json'
        if manifest != json.loads(contract.read_text()): raise ValueError('Nym manifest differs from reviewed loader contract')
    return output

def read_tor_release_supply(directory: Path):
    """Formal Tor release intake; unknown notice coverage refuses before staging."""
    return read_supply('tor', directory, require_release_licenses=True)

def stage_supply(mode: str, files, application: Path):
    license_coverage = _tor_license_gate().inspect_supply_license_materials(files) if mode == 'tor' else None
    destination = application / 'Contents/Resources' / RESOURCE_PATHS[mode]
    destination.mkdir(parents=True, exist_ok=False)
    for relative, (data, permissions, digest) in files.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(permissions)
    receipt = {'resourcePath': RESOURCE_PATHS[mode], 'filesSHA256': {name: entry[2] for name, entry in files.items()},
               'runtimeActivated': False, 'productionIsolationAdmitted': False}
    if mode == 'tor': receipt['licenseCoverage'] = license_coverage
    return receipt
