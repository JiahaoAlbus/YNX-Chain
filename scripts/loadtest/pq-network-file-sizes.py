#!/usr/bin/env python3
"""Public, metadata-only accounting after the owned four-node window ends.

Derived from integration af1cbaf94313e628e212aabad60d05d85c2aa3fc.
The workflow must first finish the existing guard's cleanup. This does not
start/stop processes, authorize a run, change caps, delete data, or read file
contents. Redirect stdout to a NEW sibling of the case, never inside it.
Two identical metadata scans are required; they are not a filesystem snapshot
or independent proof that no writer exists. The guard remains that boundary.
"""

import argparse
import hashlib
import json
import os
import re
import stat
import sys


SCHEMA = "ynx-pq-network-file-sizes/v1"
MAX_ENTRIES = 10000
MAX_DEPTH = 32
MAX_JSON_BYTES = 1 << 20
LARGEST_COUNT = 20
CATEGORIES = (
    "consensus_wal", "blockstore_db", "state_db", "tx_index_db", "evidence_db",
    "application_snapshot", "application_journal", "sign_state", "case_metadata",
    "other",
)


class ScanError(Exception):
    """Only fixed public codes may cross the CLI boundary."""


class PublicArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default error includes arbitrary argv values/paths.
        raise ScanError("invalid_cli_arguments")


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _canonical_absolute(path):
    if (not isinstance(path, str) or not path.startswith("/") or "\x00" in path
            or path == "/" or "//" in path or os.path.normpath(path) != path):
        raise ScanError("noncanonical_path")
    return path


def _open_directory(name, parent_fd=None):
    # All opened objects are directories. Regular files are only stat'ed.
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if not stat.S_ISDIR(before.st_mode):
        raise ScanError("directory_alias_or_non_directory")
    fd = os.open(name, flags, dir_fd=parent_fd)
    try:
        if _identity(before) != _identity(os.fstat(fd)):
            raise ScanError("directory_changed_while_opening")
        return fd
    except BaseException:
        os.close(fd)
        raise


def _open_absolute_directory(path):
    fd = _open_directory("/")
    try:
        for component in path.split("/")[1:]:
            child = _open_directory(component, fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def category_for(relative):
    """Classification is structural, not inferred from private file contents."""
    parts = relative.split("/")
    if len(parts) == 1 and parts[0] in ("prepared.json", "go.stdout.log", "go.stderr.log"):
        return "case_metadata"
    # Only the fixture's four known validator roots qualify for named classes.
    for i, part in enumerate(parts[:-1]):
        if re.fullmatch(r"validator-[0-3]", part):
            tail = parts[i + 1:]
            if len(tail) < 2 or tail[0] != "data":
                return "other"
            name = tail[1]
            if name == "cs.wal" and len(tail) >= 3:
                return "consensus_wal"
            dbs = {"blockstore.db": "blockstore_db", "state.db": "state_db",
                   "tx_index.db": "tx_index_db", "evidence.db": "evidence_db"}
            if name in dbs and len(tail) >= 3:
                return dbs[name]
            if len(tail) != 2:
                return "other"
            if name == "application.json" or name.startswith(".ynx-abci-state-"):
                return "application_snapshot"
            if (name in ("application.journal", "application.json.journal",
                         "application.block-journal", "application.json.block-journal")
                    or name.startswith((".ynx-journal-compact-", ".ynx-block-journal-"))):
                return "application_journal"
            if (name in ("priv_validator_state.json", "pq-sign-state.json",
                         "pq-sign-state.json.lock")
                    or name.startswith(".ynx-consensus-sign-")):
                return "sign_state"
            return "other"
    return "other"


def _scan(root_fd):
    root_info = os.fstat(root_fd)
    records = {}
    seen = {(root_info.st_dev, root_info.st_ino)}
    count = 0

    def visit(fd, prefix, depth):
        nonlocal count
        if depth > MAX_DEPTH:
            raise ScanError("depth_bound")
        before = os.fstat(fd)
        with os.scandir(fd) as entries:
            for entry in entries:
                count += 1
                if count > MAX_ENTRIES:
                    raise ScanError("entry_count_bound")
                relative = prefix + entry.name
                info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                identity = (info.st_dev, info.st_ino)
                if info.st_dev != root_info.st_dev or info.st_uid != root_info.st_uid:
                    raise ScanError("foreign_device_or_owner")
                if identity in seen:
                    raise ScanError("duplicate_inode_alias")
                seen.add(identity)
                if stat.S_ISDIR(info.st_mode):
                    child = _open_directory(entry.name, fd)
                    try:
                        if _identity(info) != _identity(os.fstat(child)):
                            raise ScanError("directory_changed_while_opening")
                        visit(child, relative + "/", depth + 1)
                    finally:
                        os.close(child)
                elif not stat.S_ISREG(info.st_mode):
                    raise ScanError("nonregular_entry")
                elif info.st_nlink != 1:
                    raise ScanError("hardlink_alias")
                if info.st_size < 0:
                    raise ScanError("invalid_logical_size")
                records[relative] = _identity(info)
        if _identity(before) != _identity(os.fstat(fd)):
            raise ScanError("directory_changed_during_scan")

    visit(root_fd, "", 0)
    return records


def scan_case(ephemeral_parent, case, run_id, run_attempt):
    parent = _canonical_absolute(ephemeral_parent)
    case = _canonical_absolute(case)
    if not all(isinstance(v, str) and re.fullmatch(r"[1-9][0-9]{0,19}", v)
               for v in (run_id, run_attempt)):
        raise ScanError("invalid_run_coordinates")
    name = "ynx-pq-network-" + run_id + "-" + run_attempt
    if case != parent + "/" + name:
        raise ScanError("not_the_exact_ephemeral_case")
    parent_fd = _open_absolute_directory(parent)
    try:
        root_fd = _open_directory(name, parent_fd)
        try:
            initial = os.fstat(root_fd)
            if initial.st_uid != os.getuid() or stat.S_IMODE(initial.st_mode) != 0o700:
                raise ScanError("case_must_be_owned_and_0700")
            first = _scan(root_fd)
            second = _scan(root_fd)
            if (first != second or _identity(initial) != _identity(os.fstat(root_fd))
                    or _identity(initial) != _identity(os.stat(name, dir_fd=parent_fd, follow_symlinks=False))):
                raise ScanError("case_changed_between_scans")
        finally:
            os.close(root_fd)
    finally:
        os.close(parent_fd)
    categories = {name: {"category": name, "count": 0, "logicalBytes": 0} for name in CATEGORIES}
    largest = []
    for relative, metadata in first.items():
        if not stat.S_ISREG(metadata[2]):
            continue
        size = metadata[5]
        category = category_for(relative)
        categories[category]["count"] += 1
        categories[category]["logicalBytes"] += size
        largest.append({"category": category, "logicalBytes": size,
                        "pathSHA256": hashlib.sha256(b"YNX-PQ-NETWORK-PATH/v1\0" + os.fsencode(relative)).hexdigest()})
    largest.sort(key=lambda item: (-item["logicalBytes"], item["category"], item["pathSHA256"]))
    return {"schema": SCHEMA, "status": "complete", "sourceKind": "owned-ephemeral-case-metadata",
            "observation": "post-window-retained-files", "historicalPeakMeasured": False,
            "runId": run_id, "runAttempt": run_attempt, "contentsRead": False,
            "metric": "sum-regular-file-st_size", "consistency": "two-identical-metadata-scans",
            "count": sum(item["count"] for item in categories.values()),
            "logicalBytes": sum(item["logicalBytes"] for item in categories.values()),
            "categories": list(categories.values()), "largest": largest[:LARGEST_COUNT]}


def encode_report(report):
    wire = (json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
    if len(wire) > MAX_JSON_BYTES:
        raise ScanError("json_output_bound")
    return wire


def main(argv=None):
    parser = PublicArgumentParser(description=__doc__)
    parser.add_argument("--ephemeral-parent", required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    try:
        args = parser.parse_args(argv)
        wire = encode_report(scan_case(args.ephemeral_parent, args.case, args.run_id, args.run_attempt))
    except (ScanError, OSError) as exc:
        # Never print OSError text: it can contain private absolute paths.
        code = str(exc) if isinstance(exc, ScanError) else "filesystem_metadata_unavailable"
        sys.stdout.buffer.write(encode_report({"schema": SCHEMA, "status": "failed", "errorCode": code}))
        return 1
    sys.stdout.buffer.write(wire)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
