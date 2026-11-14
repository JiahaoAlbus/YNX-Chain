"""Offline fixed-Tor notice byte gate. No fetch, vendor execution, or legal inference.

The packaging owner supplies read_supply()'s already safety-checked file mapping.
Candidate intake can inspect verified UNKNOWN coverage; formal release must call
require_release_license_coverage(). Neither function grants privacy admission.
"""
import hashlib
import json

COVERAGE_PATH = 'LICENSES/NOTICE-COVERAGE-v1.txt'
COVERAGE_SHA256 = '3db980f61049d07d6128418eba7b3c3f61e8ac79fbfc91c49023937bfacb4ded'
# Explicitly reviewed five-package supplement. Keeping the original pin distinct
# preserves old supply as UNKNOWN57; it can never silently inherit these materials.
SUPPLEMENTED_COVERAGE_SHA256 = 'df281c86175ec45f46ca9d5b81e49e1b83aa15f24055bf6c1f06f3ac0b986f1f'
REVIEWED_COVERAGE = {
    COVERAGE_SHA256: (374, 57),
    SUPPLEMENTED_COVERAGE_SHA256: (379, 52),
}
ARTI_SHA256 = 'fbb7d956875f58b5bf25f329c3066d437d9a223098d450a1c7209970634d8e6a'
LYREBIRD_SHA256 = '7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d'
SOURCE_SHA256 = 'a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813'
LOCK_SHA256 = '866b32b0fea381705308414e976d4125644c7b88772dbf508ea950369dd29689'


class LicenseCoverageUnavailable(ValueError):
    def __init__(self, report):
        self.report = report
        super().__init__('Tor notice coverage is UNKNOWN; release license gate refused')


def _bytes(files, path):
    try:
        data, _mode, declared_digest = files[path]
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError('missing or malformed fixed Tor notice material: ' + path) from error
    if not isinstance(data, bytes) or not 0 < len(data) <= 64_000_000:
        raise ValueError('invalid Tor notice material bytes')
    digest = hashlib.sha256(data).hexdigest()
    if declared_digest != digest:
        raise ValueError('Tor intake digest does not match actual bytes')
    return data, digest


def inspect_supply_license_materials(files):
    """Validate the exact reviewed ledger/materials and return truthful coverage.

    A self-consistent replacement ledger is rejected by its compiled-in pin.
    Matching SPDX strings alone never establish a package's notice coverage.
    """
    for path, expected in [('arti', ARTI_SHA256), ('lyrebird', LYREBIRD_SHA256)]:
        if _bytes(files, path)[1] != expected:
            raise ValueError('license evidence belongs to different Tor executable bytes')
    raw, digest = _bytes(files, COVERAGE_PATH)
    if len(raw) > 2_000_000 or digest not in REVIEWED_COVERAGE:
        raise ValueError('unreviewed Tor source-notice coverage ledger')
    ledger = json.loads(raw)
    if ledger.get('schema') != 'ynx-fixed-tor-notice-coverage-v1' or ledger.get('scope') != 'SOURCE_NOTICE_BYTES_ONLY_NOT_LEGAL_CLEARANCE':
        raise ValueError('unsupported Tor notice coverage scope')
    arti = ledger['arti']
    if (arti['version'], arti['binarySHA256'], arti['sourceArchiveSHA256'], arti['lockSHA256']) != ('2.7.0', ARTI_SHA256, SOURCE_SHA256, LOCK_SHA256):
        raise ValueError('Tor source/lock/version license binding mismatch')
    lyrebird = ledger['lyrebird']
    if (lyrebird['version'], lyrebird['binarySHA256'], lyrebird['goVersion']) != ('0.9.0', LYREBIRD_SHA256, 'go1.22.12'):
        raise ValueError('Lyrebird version/runtime license binding mismatch')
    material_paths = set()
    for material in ledger['materials']:
        path = material['path']
        if not path.startswith('LICENSES/') or path.count('/') != 1 or '..' in path or path in material_paths or path == COVERAGE_PATH:
            raise ValueError('unsafe or duplicate Tor notice reference')
        data, actual = _bytes(files, path)
        if len(data) != material['bytes'] or actual != material['sha256']:
            raise ValueError('fixed original Tor notice bytes changed')
        material_paths.add(path)
    if {path for path in files if path.startswith('LICENSES/')} != material_paths | {COVERAGE_PATH}:
        raise ValueError('Tor notice material set differs from reviewed ledger')
    packages = arti['closure']['packages']
    identities = {(package['name'], package['version']) for package in packages}
    if len(identities) != len(packages) or len(packages) + 1 != arti['closure']['packageCountIncludingRoot']:
        raise ValueError('Tor target dependency closure is incomplete or duplicated')
    unknown = []
    for package in packages:
        refs = package['noticeFiles']
        if any(path not in material_paths for path in refs):
            raise ValueError('Tor dependency references an absent notice')
        if package['status'] != 'BYTES_PRESENT' or not refs:
            unknown.append({'name': package['name'], 'version': package['version'], 'archiveSHA256': package['archiveSHA256']})
    root_unknown = arti['rootLicenseStatus'] != 'BYTES_PRESENT' or not arti['rootLicenseFiles']
    if (len(packages) - len(unknown), len(unknown)) != REVIEWED_COVERAGE[digest] or not root_unknown:
        raise ValueError('reviewed Tor notice revision coverage mismatch')
    if any(path not in material_paths for path in arti['rootLicenseFiles']):
        raise ValueError('missing exact Arti root license')
    for field in ['publisherNotices', 'observedBinaryMetadata', 'goRuntimeLicense']:
        if lyrebird[field] not in material_paths:
            raise ValueError('missing selected Lyrebird publisher/runtime notices')
    modules = lyrebird['modules']
    if len({module['name'] for module in modules}) != len(modules) or any(not module['noticeSections'] or module['noticeDocument'] != lyrebird['publisherNotices'] for module in modules):
        raise ValueError('Lyrebird observed module notice mapping incomplete')
    complete = not unknown and not root_unknown and ledger['noticeCoverageComplete'] is True
    return {'schema': ledger['schema'], 'coverageSHA256': digest,
            'status': 'NOTICE_BYTES_PRESENT' if complete else 'UNKNOWN',
            'noticeCoverageComplete': complete, 'rootArtiLicense': 'UNKNOWN' if root_unknown else 'BYTES_PRESENT',
            'targetPackagesIncludingArti': len(packages) + 1,
            'dependenciesWithNoticeBytes': len(packages) - len(unknown),
            'unknownDependencies': unknown, 'noticeMaterialCount': len(material_paths),
            'lyrebirdObservedModules': len(modules), 'legalClearance': 'UNKNOWN',
            'productionIsolationAdmitted': False}


def require_release_license_coverage(files):
    """Fail the affected release when exact-source notice bytes remain unknown."""
    report = inspect_supply_license_materials(files)
    if not report['noticeCoverageComplete']:
        raise LicenseCoverageUnavailable(report)
    return report


def main():
    import argparse
    from pathlib import Path
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('supply', type=Path, help='Exact reviewed offline Tor contract directory')
    parser.add_argument('--require-complete', action='store_true', help='Refuse release when exact-source notice coverage is UNKNOWN')
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
    from privacy_backend_supply import read_supply
    try:
        files = read_supply('tor', args.supply)
        report = require_release_license_coverage(files) if args.require_complete else inspect_supply_license_materials(files)
    except LicenseCoverageUnavailable as error:
        print(json.dumps(error.report, sort_keys=True))
        return 3
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'status': 'REJECTED', 'detail': str(error), 'noticeCoverageComplete': False}))
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0  # Diagnostic collection succeeded; report may still be UNKNOWN.


if __name__ == '__main__':
    raise SystemExit(main())
