#!/usr/bin/env python3
"""Transfer only bounded public fixtures between same-run protocol CI stages.

The external manifest SHA comes from the successful producer job output. This
serializer supplies neither execution authorization nor production authority.
No recursive directory copy, keys, database, signing state or binary is allowed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


VERSION = "YNX-PQ-CI-PUBLIC-STAGE-INPUTS/v1"
OPERATOR = "ynx-consensus-operator-public-inputs"
OPERATOR_NAMES = ("manifest.json", "migration.json", "validator-manifest.json", "genesis.json",
                  "operator-atomic-json.json", "operator-snapshot-journal.json", "operator-block-journal.json")
FILES = {"ynx-pq-consensus-light-proof-public.json": 32 << 20,
         "ynx-pq-consensus-transaction-proof-public.json": 128 << 20,
         **{OPERATOR + "/" + name: 16 << 20 for name in OPERATOR_NAMES}}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "duplicate_json_field")
        value[key] = item
    return value


def identity(commit, tree, run_id, attempt):
    require(type(commit) is str and re.fullmatch(r"[0-9a-f]{40}", commit) is not None
            and commit != "0" * 40, "commit_invalid")
    require(type(tree) is str and re.fullmatch(r"[0-9a-f]{40}", tree) is not None
            and tree != "0" * 40, "source_tree_invalid")
    require(all(type(item) is str and re.fullmatch(r"[1-9][0-9]{0,19}", item) is not None
                for item in (run_id, attempt)), "run_or_attempt_invalid")
    return dict(version=VERSION, commit=commit, sourceTree=tree, runId=run_id,
                runAttempt=attempt, producerJob="focused-go", publicDataOnly=True,
                nodeStarted=False)


def canonical_directory(path):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(str(path))
            and path.resolve(strict=True) == path and path.is_dir(), "directory_not_canonical")
    return path


def read_regular(path, maximum):
    require(path.resolve(strict=True) == path, "symlink_refused")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                and before.st_nlink == 1 and before.st_mode & 0o022 == 0
                and 0 < before.st_size <= maximum, "public_file_metadata_invalid")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            raw = source.read(maximum + 1)
        after = os.fstat(descriptor)
        observed = path.lstat()
        fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        require(len(raw) == before.st_size
                and all(getattr(before, key) == getattr(after, key) for key in fields)
                and (observed.st_dev, observed.st_ino) == (before.st_dev, before.st_ino),
                "public_file_changed_during_read")
        return raw
    finally:
        os.close(descriptor)


def write_new(path, raw):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as target:
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())
    require(read_regular(path, len(raw)) == raw, "written_public_file_differs")


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def material(root):
    directory = root / OPERATOR
    require(canonical_directory(directory) == directory
            and {path.name for path in directory.iterdir()} == set(OPERATOR_NAMES),
            "operator_public_allowlist_differs")
    raws = {name: read_regular(root / name, maximum) for name, maximum in FILES.items()}
    require(sum(len(raw) for name, raw in raws.items() if name.startswith(OPERATOR + "/"))
            <= 32 << 20, "operator_public_aggregate_exceeded")
    return raws


def pins(raws):
    return {name: dict(bytes=str(len(raw)), sha256=hashlib.sha256(raw).hexdigest())
            for name, raw in raws.items()}


def export_inputs(root, bundle, commit, tree, run_id, attempt):
    expected = identity(commit, tree, run_id, attempt)
    root = canonical_directory(root)
    bundle = Path(bundle)
    require(bundle.is_absolute() and bundle.parent == canonical_directory(bundle.parent)
            and not os.path.lexists(bundle), "bundle_must_be_new")
    raws = material(root)
    manifest = dict(expected, files=pins(raws))
    encoded = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    bundle.mkdir(mode=0o700)
    (bundle / OPERATOR).mkdir(mode=0o700)
    for name, raw in raws.items():
        write_new(bundle / name, raw)
    # Manifest is the final completion marker. Any failure preserves partials.
    require(material(root) == raws, "producer_inputs_changed")
    sync_directory(bundle / OPERATOR)
    write_new(bundle / "manifest.json", encoded)
    sync_directory(bundle)
    sync_directory(bundle.parent)
    return dict(expected, manifestSHA256=hashlib.sha256(encoded).hexdigest(),
                fileCount=len(raws), totalBytes=str(sum(map(len, raws.values()))))


def restore_inputs(root, bundle, commit, tree, run_id, attempt, manifest_sha256):
    expected = identity(commit, tree, run_id, attempt)
    require(type(manifest_sha256) is str and re.fullmatch(r"[0-9a-f]{64}", manifest_sha256) is not None
            and manifest_sha256 != "0" * 64, "external_manifest_pin_invalid")
    root, bundle = canonical_directory(root), canonical_directory(bundle)
    require({path.name for path in bundle.iterdir()} == {"manifest.json", OPERATOR,
                "ynx-pq-consensus-light-proof-public.json", "ynx-pq-consensus-transaction-proof-public.json"},
            "bundle_public_allowlist_differs")
    raw = read_regular(bundle / "manifest.json", 16384)
    require(hashlib.sha256(raw).hexdigest() == manifest_sha256, "external_manifest_pin_mismatch")
    manifest = json.loads(raw, object_pairs_hook=unique)
    require(type(manifest) is dict and set(manifest) == set(expected) | {"files"}
            and all(type(manifest[key]) is type(value) and manifest[key] == value
                    for key, value in expected.items()), "producer_identity_mismatch")
    raws = material(bundle)
    require(manifest["files"] == pins(raws), "public_material_pin_mismatch")
    require(all(not os.path.lexists(root / name) for name in FILES)
            and not os.path.lexists(root / OPERATOR), "consumer_destination_exists")
    (root / OPERATOR).mkdir(mode=0o700)
    for name, content in raws.items():
        write_new(root / name, content)
    sync_directory(root / OPERATOR)
    sync_directory(root)
    require(material(root) == raws and material(bundle) == raws, "restored_public_material_differs")
    return dict(expected, manifestSHA256=manifest_sha256, fileCount=len(raws),
                totalBytes=str(sum(map(len, raws.values()))))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("mode", choices=("export", "restore"))
    for flag in ("root", "bundle", "commit", "source-tree", "run-id", "run-attempt"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--manifest-sha256")
    args = parser.parse_args(argv)
    try:
        values = (args.root, args.bundle, args.commit, args.source_tree, args.run_id, args.run_attempt)
        if args.mode == "export":
            require(args.manifest_sha256 is None, "export_cannot_self_supply_pin")
            result = export_inputs(*values)
        else:
            result = restore_inputs(*values, args.manifest_sha256)
    except (ValueError, OSError, UnicodeError, TypeError):
        print("YNX_PQ_CI_STAGE_INPUTS_REJECTED", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
