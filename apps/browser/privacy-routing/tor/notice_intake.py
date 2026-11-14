"""Offline intake of seven reviewed original notice files for five fixed packages.

Produces a candidate ledger and append recipe in a NEW directory. Never fetches,
replaces the admitted ledger, changes vendor bytes, or claims legal clearance.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import tarfile

BASE_COVERAGE_SHA256 = '3db980f61049d07d6128418eba7b3c3f61e8ac79fbfc91c49023937bfacb4ded'
# Bytes are original fixed-commit publisher files (or members of the locked crate),
# never generic license templates selected from an SPDX declaration.
REVIEWED = {
    ('amplify_num', '0.5.4'): ('872842c3d151296b18314dfa5bf86548c2ce4f29', 'rust-amplify/amplify-num', [
        ('LICENSE', 'amplify-num-LICENSE.txt', 'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9')]),
    ('amplify_syn', '2.0.1'): ('29ca86c56316ce683bf3827a9d245334db69ce1f', 'rust-amplify/amplify-derive', [
        ('LICENSE', 'amplify-syn-LICENSE.txt', 'a7173d3ff287d45cecb4f31f854259264206b152b00bf4ac6ba0445bb0e864a9')]),
    ('asn1-rs-impl', '0.2.0'): ('a20e5f7319c896737ad0f2557037817b91ad854f', 'rusticata/asn1-rs', [
        ('LICENSE-MIT', 'asn1-rs-MIT.txt', 'a5c61b93b6ee1d104af9920cf020ff3c7efe818e31fe562c72261847a728f513'),
        ('LICENSE-APACHE', 'asn1-rs-APACHE.txt', 'a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2')]),
    ('cookie-factory', '0.3.3'): ('d36b805dbd7dd65f2df947235c5bcc573afe2c76', 'rust-bakery/cookie-factory', [
        ('LICENSES/MIT.txt', 'cookie-factory-MIT.txt', 'd09216dc1ea5f273997667935a8d6514d80f00b89fb6954ecc3a43e0a6e360de')]),
    ('priority-queue', '2.7.0'): ('0c76fb8fe75e4457f16f8e6c8e86508d1a89ba1d', None, [
        ('LGPL-3.0-or-later.txt', None, 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768'),
        ('MPL-2.0.txt', None, 'c73cc0c27b0f24d5612e76bf83b5845c4fbd0374a1a8483f3d16befe58a60c9a')]),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(data, digest):
    if not isinstance(data, bytes) or not 0 < len(data) <= 200_000 or sha(data) != digest:
        raise ValueError('original reviewed notice byte mismatch')
    data.decode('utf-8')
    return data


def member(archive, name):
    item = archive.getmember(name)
    if not item.isfile() or not 0 < item.size <= 200_000:
        raise ValueError('unsafe fixed crate source member')
    return archive.extractfile(item).read()


def prepare(base_raw, cache, fetched, fetch_receipts):
    if sha(base_raw) != BASE_COVERAGE_SHA256:
        raise ValueError('unreviewed baseline coverage')
    ledger = copy.deepcopy(json.loads(base_raw))
    packages = {(p['name'], p['version']): p for p in ledger['arti']['closure']['packages']}
    material = {}
    proofs = []
    for identity, (commit, repository, notices) in REVIEWED.items():
        package = packages[identity]
        name, version = identity
        if package['status'] != 'UNKNOWN' or package['noticeFiles'] or package['publishedVCS']['git']['sha1'] != commit:
            raise ValueError('source package identity/coverage mismatch')
        source = cache / (name + '-' + version + '.crate')
        raw = source.read_bytes()
        if sha(raw) != package['archiveSHA256']:
            raise ValueError('locked crate checksum mismatch')
        references = []
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            prefix = name + '-' + version + '/'
            vcs = json.loads(member(archive, prefix + '.cargo_vcs_info.json'))
            if vcs != package['publishedVCS']:
                raise ValueError('published source commit/path mismatch')
            # Preserve the publisher's package metadata as source-link evidence.
            manifest = member(archive, prefix + 'Cargo.toml').decode()
            if repository and ('https://github.com/' + repository) not in manifest:
                raise ValueError('publisher repository is not the pinned package repository')
            for original_path, local_name, digest in notices:
                if local_name:
                    url = 'https://raw.githubusercontent.com/' + repository + '/' + commit + '/' + original_path
                    matching = [r for r in fetch_receipts if r.get('url') == url and r.get('status') == 200]
                    if len(matching) != 1 or matching[0].get('sha256') != digest or matching[0].get('finalURL') != url:
                        raise ValueError('missing exact original publisher HTTPS receipt')
                    data = checked((fetched / local_name).read_bytes(), digest)
                    origin = dict(type='exact-published-vcs-primary-repository-notice', sourceURL=url,
                                  publishedCommit=commit, crateArchiveSHA256=package['archiveSHA256'],
                                  pathInVCS=vcs['path_in_vcs'])
                else:
                    data = checked(member(archive, prefix + original_path), digest)
                    origin = dict(type='original-file-in-lock-checksum-verified-crate', archive=str(source),
                                  member=prefix + original_path, archiveSHA256=package['archiveSHA256'],
                                  publishedCommit=commit)
                destination = 'LICENSES/' + name + '-' + version + '-' + original_path.replace('/', '-')
                if not destination.endswith(('.txt', '.md')):
                    destination += '.txt'
                if destination in material:
                    raise ValueError('duplicate notice destination')
                material[destination] = data
                ledger['materials'].append(dict(path=destination, bytes=len(data), sha256=digest, origin=origin))
                references.append(destination)
                proofs.append(dict(package=name, version=version, archiveSHA256=package['archiveSHA256'],
                                   publishedVCS=vcs, path=destination, bytes=len(data), sha256=digest, origin=origin))
        package['noticeFiles'] = references
        package['evidenceKind'] = 'exact-published-source-original-notice-bytes'
        package['status'] = 'BYTES_PRESENT'
    ledger['unknownPackages'] = [p for p in ledger['unknownPackages'] if (p['name'], p['version']) not in REVIEWED]
    # Arti root, 49 same-commit workspace dependencies, two objc2 crates and void
    # remain unresolved. Never promote a README/SPDX link to full original bytes.
    if len(ledger['unknownPackages']) != 52 or ledger['arti']['rootLicenseStatus'] != 'UNKNOWN':
        raise ValueError('unexpected unresolved source coverage')
    ledger['noticeCoverageComplete'] = False
    ledger['legalClearance'] = 'UNKNOWN'
    ledger['productionIsolationAdmission'] = False
    ledger['materials'].sort(key=lambda item: item['path'])
    return ledger, material, proofs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('cache', type=Path)
    parser.add_argument('intake', type=Path, help='owned fetched/ and FETCH*.json directory')
    parser.add_argument('output', type=Path, help='NEW candidate directory; baseline is never modified')
    args = parser.parse_args()
    receipts = []
    for name in ['FETCH.json', 'FETCH-ADDITIONAL.json']:
        receipts += json.loads((args.intake / name).read_bytes())
    ledger, materials, proofs = prepare(args.baseline.read_bytes(), args.cache, args.intake / 'fetched', receipts)
    args.output.mkdir(mode=0o700, exist_ok=False)
    (args.output / 'LICENSES').mkdir(mode=0o700)
    entries = []
    for relative, data in sorted(materials.items()):
        path = args.output / relative
        path.write_bytes(data); path.chmod(0o644)
        entries.append(dict(source=str(path.resolve()), destinationRelative=relative, sha256=sha(data), mode='0o644'))
    encoded = (json.dumps(ledger, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()
    (args.output / 'LICENSES/NOTICE-COVERAGE-v1.txt').write_bytes(encoded)
    report = dict(schema='YNX_FIXED_TOR_NOTICE_INTAKE_DELTA_V1', baselineCoverageSHA256=BASE_COVERAGE_SHA256,
                  candidateCoverageSHA256=sha(encoded), newOriginalFiles=len(materials), newCoveredDependencies=5,
                  unknownDependenciesBefore=57, unknownDependenciesAfter=52, rootArti='UNKNOWN', proofs=proofs,
                  releaseApproved=False, legalClearance='UNKNOWN', vendorBytesChanged=False,
                  loaderManifestChanged=False, admittedSupplyChanged=False, appendRecipe=entries,
                  next='explicit exact coverage pin review required before supply integration')
    (args.output / 'NOTICE-INTAKE.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['proofs', 'appendRecipe']}, indent=2))


if __name__ == '__main__':
    main()
