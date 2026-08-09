#!/usr/bin/env python3
"""Fail-closed structural and secret scan for Quant desktop ZIP candidates."""

import argparse
import hashlib
import json
import pathlib
import re
import stat
import sys
import zipfile

MAX_FILES = 5000
MAX_UNCOMPRESSED = 256 * 1024 * 1024
MAX_RATIO = 200
TEXT_SCAN_LIMIT = 8 * 1024 * 1024
ALLOWED_EXECUTABLES = {
    "ynx-quant-desktop",
    "ynx-quantd",
    "ynx-quant-web",
    "ynx-quant-desktop.exe",
    "ynx-quantd.exe",
    "ynx-quant-web.exe",
}
PROHIBITED = re.compile(
    rb"BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|"
    rb"sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-",
    re.IGNORECASE,
)


def scan(path: pathlib.Path) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    seen = set()
    total = 0
    scanned = 0
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_FILES:
            raise ValueError("archive file count outside policy")
        for entry in entries:
            pure = pathlib.PurePosixPath(entry.filename)
            if pure.is_absolute() or ".." in pure.parts or "" in pure.parts:
                raise ValueError(f"unsafe archive path: {entry.filename}")
            if entry.filename in seen:
                raise ValueError(f"duplicate archive path: {entry.filename}")
            seen.add(entry.filename)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError(f"symbolic link rejected: {entry.filename}")
            total += entry.file_size
            if total > MAX_UNCOMPRESSED:
                raise ValueError("archive exceeds uncompressed size policy")
            if entry.compress_size == 0 and entry.file_size > 0:
                raise ValueError(f"invalid zero compressed size: {entry.filename}")
            if entry.compress_size and entry.file_size / entry.compress_size > MAX_RATIO:
                raise ValueError(f"compression ratio exceeds policy: {entry.filename}")
            if entry.is_dir():
                continue
            executable = bool(mode & 0o111) or pure.suffix.lower() == ".exe"
            if executable and pure.name not in ALLOWED_EXECUTABLES:
                raise ValueError(f"unexpected executable: {entry.filename}")
            if entry.file_size > TEXT_SCAN_LIMIT:
                continue
            content = archive.read(entry)
            scanned += len(content)
            if PROHIBITED.search(content):
                raise ValueError(f"credential pattern found: {entry.filename}")
    return {
        "archive": path.name,
        "bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "entries": len(seen),
        "uncompressedBytes": total,
        "contentScannedBytes": scanned,
        "pathTraversal": False,
        "symlinks": False,
        "duplicateEntries": False,
        "compressionBomb": False,
        "unexpectedExecutables": False,
        "credentialPatterns": False,
        "scanner": "ynx-archive-safety-v1",
        "passed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archives", nargs="+")
    args = parser.parse_args()
    results = []
    try:
        for value in args.archives:
            path = pathlib.Path(value)
            if not path.is_file():
                raise ValueError(f"archive unavailable: {path}")
            results.append(scan(path))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(json.dumps({"passed": False, "error": str(error)}, sort_keys=True))
        return 1
    print(json.dumps({"schemaVersion": 1, "results": results}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
