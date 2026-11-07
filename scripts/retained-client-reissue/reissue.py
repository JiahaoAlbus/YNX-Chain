#!/usr/bin/env python3
"""Closed-three retained public client verification. Never executes a binary."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import struct
import sys
import zipfile
import zlib

MANIFEST_SHA256 = "b843823e77acc529e74d12abc6d09d367df2a86128863b221357b3bcaf00ea68"
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_TOTAL = 40 * 1024 * 1024
CHUNK = 1024 * 1024

class ValidationError(ValueError):
    pass

def fail(code):
    raise ValidationError(code)

def enforce_budget():
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
        os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
    # macOS has no sched_setaffinity; this code is single-threaded and its real
    # RSS is observed by the caller. It does not claim an unsupported kernel cap.

def contract():
    data = Path(__file__).with_name("retained-client-manifest.json").read_bytes()
    if hashlib.sha256(data).hexdigest() != MANIFEST_SHA256:
        fail("MANIFEST_HASH_MISMATCH")
    value = json.loads(data)
    if value["schema"] != "YNX_RETAINED_CLIENT_CLOSED_THREE_V1" or len(value["members"]) != 3:
        fail("MANIFEST_SCHEMA")
    return value

def digest_file(stream):
    total = 0
    sha = hashlib.sha256()
    while True:
        part = stream.read(CHUNK)
        if not part:
            return total, sha.hexdigest()
        total += len(part)
        if total > MAX_ARCHIVE:
            fail("ARCHIVE_SIZE_BOUND")
        sha.update(part)

def check_identity(source_bytes, info_bytes, manifest):
    try:
        source = json.loads(source_bytes)
        info = info_bytes.decode("utf-8")
    except (ValueError, UnicodeError) as error:
        raise ValidationError("SOURCE_OR_BUILDINFO_PARSE") from error
    if source != manifest["source"]:
        fail("SOURCE_IDENTITY_MISMATCH")
    expected = ["go1.26.10", "\tpath\tgithub.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-perf-client",
                "\tbuild\tGOOS=linux", "\tbuild\tGOARCH=amd64",
                "\tbuild\tvcs.revision=" + source["commit"], "\tbuild\tvcs.modified=false"]
    if any(item not in info for item in expected):
        fail("BUILDINFO_IDENTITY_MISMATCH")
    if source["executionAuthorized"] is not False or source["publicDeployment"] is not False:
        fail("ORIGINAL_EXECUTION_BOUNDARY")
    return source

def receipt_write(path, value):
    data = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o444)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(str(Path(path).parent), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)

def verify_archive(archive, *, original=True, output=None):
    manifest = contract()
    expected = {entry["name"]: entry for entry in manifest["members"]}
    try:
        fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise ValidationError("INPUT_NOT_REGULAR_OR_OPEN_FAILED") from error
    try:
        with os.fdopen(fd, "rb") as stream:
            initial = os.fstat(stream.fileno())
            if not stat.S_ISREG(initial.st_mode) or initial.st_nlink != 1:
                fail("INPUT_NOT_REGULAR")
            if initial.st_size > MAX_ARCHIVE or initial.st_size < 22:
                fail("ARCHIVE_SIZE_BOUND")
            archive_bytes, archive_sha = digest_file(stream)
            if original and (archive_bytes != manifest["originalArchive"]["bytes"] or archive_sha != manifest["originalArchive"]["sha256"]):
                fail("ORIGINAL_ARCHIVE_HASH_MISMATCH")
            stream.seek(0)
            try:
                with zipfile.ZipFile(stream) as archive_file:
                    infos = archive_file.infolist()
                    names = [item.filename for item in infos]
                    if len(names) != len(set(names)):
                        fail("DUPLICATE_MEMBER")
                    if len(infos) != 3 or set(names) != set(expected):
                        fail("CLOSED_THREE_NAMES_REQUIRED")
                    if sum(item.file_size for item in infos) > MAX_TOTAL:
                        fail("MEMBER_TOTAL_BOUND")
                    records = []
                    public = {}
                    for item in infos:
                        exp = expected[item.filename]
                        mode = item.external_attr >> 16
                        kind = stat.S_IFMT(mode)
                        # DOS regular entries need not carry POSIX type bits;
                        # all extraction is explicit O_EXCL regular-file creation.
                        if item.is_dir() or item.external_attr & 0x10 or kind not in (0, stat.S_IFREG):
                            fail("MEMBER_NOT_REGULAR")
                        if item.flag_bits & 1:
                            fail("ENCRYPTED_MEMBER_REFUSED")
                        if item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                            fail("COMPRESSION_REFUSED")
                        if item.file_size != exp["bytes"] or item.compress_size < 0 or item.compress_size > MAX_ARCHIVE:
                            fail("MEMBER_SIZE_MISMATCH")
                        if item.CRC != exp["crc32"]:
                            fail("CRC_DECLARATION_MISMATCH")
                        sha, crc, size, prefix = hashlib.sha256(), 0, 0, b""
                        small = bytearray() if item.filename != "ynx-consensus-perf-client" else None
                        with archive_file.open(item) as member:
                            while True:
                                part = member.read(CHUNK)
                                if not part:
                                    break
                                size += len(part)
                                if size > exp["bytes"]:
                                    fail("MEMBER_READ_BOUND")
                                sha.update(part)
                                crc = zlib.crc32(part, crc)
                                if len(prefix) < 64:
                                    prefix = (prefix + part)[:64]
                                if small is not None:
                                    small.extend(part)
                        if size != exp["bytes"] or sha.hexdigest() != exp["sha256"]:
                            fail("MEMBER_SHA_MISMATCH")
                        if crc & 0xffffffff != item.CRC:
                            fail("CRC_READBACK_MISMATCH")
                        if item.filename == "ynx-consensus-perf-client":
                            if len(prefix) < 20 or prefix[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", prefix, 18)[0] != 62:
                                fail("EXPECTED_LINUX_AMD64_ELF")
                        else:
                            public[item.filename] = bytes(small)
                        records.append({"name": item.filename, "bytes": size, "sha256": sha.hexdigest(), "crc32": crc & 0xffffffff})
                    source = check_identity(public["SOURCE.json"], public["go-build-info.txt"], manifest)
                    if output is not None:
                        # A previous/partial directory is never removed or reused.
                        os.mkdir(output, 0o700)
                        directory = os.open(output, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                        try:
                            for item in infos:
                                exp = expected[item.filename]
                                target = os.open(item.filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                                with os.fdopen(target, "wb") as dest, archive_file.open(item) as member:
                                    sha, size = hashlib.sha256(), 0
                                    while True:
                                        part = member.read(CHUNK)
                                        if not part:
                                            break
                                        size += len(part)
                                        if size > exp["bytes"]:
                                            fail("EXTRACTION_READ_BOUND")
                                        dest.write(part)
                                        sha.update(part)
                                    if size != exp["bytes"] or sha.hexdigest() != exp["sha256"]:
                                        fail("EXTRACTION_SHA_MISMATCH")
                                    dest.flush()
                                    os.fsync(dest.fileno())
                                    os.fchmod(dest.fileno(), 0o444)
                            os.fsync(directory)
                        finally:
                            os.close(directory)
            except (zipfile.BadZipFile, RuntimeError, zlib.error, NotImplementedError) as error:
                raise ValidationError("ZIP_DATA_INVALID") from error
            final = os.fstat(stream.fileno())
            if (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns) != (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns):
                fail("INPUT_CHANGED_DURING_READ")
    except BaseException:
        # Owned partial output remains for first-cause recovery. No cleanup or retry.
        raise
    return {"schema": "YNX_RETAINED_CLIENT_BYTE_VERIFICATION_V1", "status": "EXACT_ORIGINAL_THREE_MEMBERS",
            "archive": {"bytes": archive_bytes, "sha256": archive_sha, "originalContainerRequired": original},
            "members": records, "originalSource": source, "originalRun": manifest["originalRun"],
            "originalArtifact": manifest["originalArtifact"], "binaryExecuted": False,
            "compilerExecuted": False, "originalProvenanceModified": False,
            "newBuild": False, "newExecutionAuthority": False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify", "extract"))
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--reissued", action="store_true", help="New ZIP container; exact original three-member identities remain mandatory")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    if (args.command == "extract") != (args.output is not None):
        parser.error("extract requires a new output directory; verify does not accept output")
    enforce_budget()
    try:
        result = verify_archive(args.archive, original=not args.reissued, output=args.output)
    except BaseException as error:
        failure = {"status": "FAILED", "errorType": type(error).__name__, "firstCause": str(error),
                   "partialOutputRetained": bool(args.output and args.output.exists()), "binaryExecuted": False}
        if args.receipt:
            try:
                receipt_write(args.receipt, failure)
            except BaseException as receipt_error:
                failure["receiptErrorType"] = type(receipt_error).__name__
        print(json.dumps(failure), file=sys.stderr)
        raise
    if args.receipt:
        receipt_write(args.receipt, result)
    print(json.dumps(result, sort_keys=True))

if __name__ == "__main__":
    main()
