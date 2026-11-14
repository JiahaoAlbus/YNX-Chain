#!/usr/bin/env python3
"""Prepare one derived PUBLIC QA Arti source; never run Cargo or a backend."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

ARTI = 'a567e05cf614b579609d958e41b54602eea6983bccfec46d1e933a45605dd813'
CHANNEL = '431ba53bf020ea8681ef0c2fbf0f0f854997fca9afe1b2c081f41f14ec00cf5d'
LOCK = '866b32b0fea381705308414e976d4125644c7b88772dbf508ea950369dd29689'
BEFORE = '''let delay = if target.chan_method().is_direct() {
            std::time::Duration::new(5, 0)
        } else {
            std::time::Duration::new(10, 0)
        };'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unpack(archive, expected, prefix, destination):
    raw = archive.read_bytes()
    if len(raw) > 8 * 1024 * 1024 or sha(raw) != expected:
        raise ValueError('fixed published archive rejected')
    count = total = 0
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        for member in tar:
            path = Path(member.name)
            if path.is_absolute() or path.parts[0] != prefix or any(x in ('.', '..') for x in path.parts):
                raise ValueError('unsafe archive path')
            relative = Path(*path.parts[1:])
            if member.isdir():
                (destination / relative).mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            if not member.isfile() or member.size > 4 * 1024 * 1024:
                raise ValueError('nonregular or oversized source member')
            count += 1
            total += member.size
            if count > 512 or total > 16 * 1024 * 1024:
                raise ValueError('source intake bound exceeded')
            target = destination / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open('xb') as handle:
                handle.write(tar.extractfile(member).read(member.size + 1))
    return count, total


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--supply', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    supply = args.supply.resolve(strict=True)
    output = args.output.absolute()
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    root = output / 'root'
    crate = output / 'tor-chanmgr'
    root.mkdir(mode=0o700)
    crate.mkdir(mode=0o700)
    arti_archive = supply / 'intake/arti-2.7.0.crate'
    channel_archive = supply / 'build/cargo-home/registry/cache/index.crates.io-1949cf8c6b5b557f/tor-chanmgr-0.47.0.crate'
    counts = [unpack(arti_archive, ARTI, 'arti-2.7.0', root),
              unpack(channel_archive, CHANNEL, 'tor-chanmgr-0.47.0', crate)]
    lock = (root / 'Cargo.lock').read_text()
    if sha(lock.encode()) != LOCK:
        raise ValueError('original published lock rejected')
    blocks = re.split(r'(?=\[\[package\]\])', lock)
    matches = [x for x in blocks if re.match(r'\[\[package\]\]\nname = "tor-chanmgr"\nversion = "0.47.0"\n', x)]
    if len(matches) != 1:
        raise ValueError('ambiguous locked channel dependency')
    original = matches[0]
    if 'checksum = "' + CHANNEL + '"\n' not in original:
        raise ValueError('locked crate archive checksum mismatch')
    replacement, removed = re.subn(r'^(?:source = "registry\+[^"\n]+"|checksum = "' + CHANNEL + '")\n', '', original, flags=re.M)
    if removed != 2:
        raise ValueError('unexpected local patch lock shape')
    (root / 'Cargo.lock').write_text(lock.replace(original, replacement, 1))
    toml = (root / 'Cargo.toml').read_text()
    if '[patch.' in toml:
        raise ValueError('original root already patched')
    (root / 'Cargo.toml').write_text(toml + '\n[patch.crates-io]\ntor-chanmgr = { path = "../tor-chanmgr" }\n')
    builder = crate / 'src/builder.rs'
    text = builder.read_text()
    if text.count(BEFORE) != 1:
        raise ValueError('fixed channel deadline callee changed')
    builder.write_text(text.replace(BEFORE, BEFORE.replace('new(10, 0)', 'new(30, 0)'), 1))
    files = {str(x.relative_to(output)): sha(x.read_bytes())
             for folder in (root, crate) for x in sorted(folder.rglob('*')) if x.is_file()}
    manifest = dict(schema='P05_DERIVED_ARTI_PUBLIC_CHANNEL_TIMEOUT_QA_SOURCE_V1',
                    experiment='non-direct-channel-30s', baseArtiArchiveSHA256=ARTI,
                    baseChannelArchiveSHA256=CHANNEL, baseCargoLockSHA256=LOCK,
                    sourceFiles=files, sourceCounts=counts,
                    lockStatus='STRUCTURALLY_DERIVED_EXPECTED_LOCK_NOT_YET_ACCEPTED_BY_CARGO',
                    allowedLockDelta='only tor-chanmgr0.47 package source/checksum removed for local path; versions/dependencies identical',
                    protocolChange='one non-direct outer deadline10->30s, direct5 unchanged',
                    notOfficialPublishedBinary=True, notProductionAuthority=True,
                    compiler='NOT_RUN', network='NOT_RUN')
    (output / 'SOURCE-INPUTS.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print(json.dumps(dict(sourceInputsSHA256=sha((output / 'SOURCE-INPUTS.json').read_bytes()),
                          files=len(files), compiler='NOT_RUN', network='NOT_RUN')))


if __name__ == '__main__':
    main()
