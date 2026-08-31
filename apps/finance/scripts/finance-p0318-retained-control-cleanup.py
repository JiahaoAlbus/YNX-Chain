#!/usr/bin/env python3
"""Identity-bound cleanup of only the two retained P0-318 control files."""
import base64
import ctypes
import errno
import hashlib
import json
import os
import stat
import sys

TARGET_ID = "finance-combined-4f7fba323a89-20260831t041500z"
PRODUCTION_PARENT = "/opt/ynx/leases/finance"
RENAME_NOREPLACE = 1


def full_tuple(st):
    if stat.S_ISREG(st.st_mode):
        kind = "regular file"
    elif stat.S_ISDIR(st.st_mode):
        kind = "directory"
    else:
        kind = "other"
    return f"{st.st_dev}:{st.st_ino}:{st.st_uid}:{st.st_gid}:{stat.S_IMODE(st.st_mode):o}:{st.st_nlink}:{st.st_size}:{kind}"


def stable_identity(st):
    kind = "directory" if stat.S_ISDIR(st.st_mode) else "other"
    return f"{st.st_dev}:{st.st_ino}:{st.st_uid}:{st.st_gid}:{stat.S_IMODE(st.st_mode):o}:{kind}"


def sha_fd(fd):
    digest = hashlib.sha256()
    offset = 0
    while True:
        chunk = os.pread(fd, 1024 * 1024, offset)
        if not chunk:
            break
        digest.update(chunk)
        offset += len(chunk)
    return digest.hexdigest()


def inspect_parent(parent):
    pst = os.lstat(parent)
    if not stat.S_ISDIR(pst.st_mode) or stat.S_ISLNK(pst.st_mode) or (os.path.realpath(parent) != parent and os.environ.get("FINANCE_P0318_CLEANUP_TEST_ROOT") != "1"):
        raise RuntimeError("PARENT_NOT_CANONICAL_DIRECTORY")
    children = []
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with os.scandir(parent) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                st = entry.stat(follow_symlinks=False)
                item = {"name": entry.name, "tuple": full_tuple(st)}
                if stat.S_ISREG(st.st_mode):
                    fd = os.open(entry.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                    try:
                        item["sha256"] = sha_fd(fd)
                    finally:
                        os.close(fd)
                else:
                    item["sha256"] = None
                children.append(item)
    finally:
        os.close(parent_fd)
    body = json.dumps(children, separators=(",", ":"), sort_keys=True).encode()
    return {
        "parentFullTuple": full_tuple(pst),
        "parentStableIdentity": stable_identity(pst),
        "directChildren": len(children),
        "inventorySha256": hashlib.sha256(body).hexdigest(),
        "children": children,
    }


def rename_noreplace(parent_fd, source, target):
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    if function is None:
        if os.environ.get("FINANCE_P0318_CLEANUP_TEST_ALLOW_PORTABLE_RENAME") != "1":
            raise RuntimeError("RENAMEAT2_NOREPLACE_UNAVAILABLE")
        try:
            os.stat(target, dir_fd=parent_fd, follow_symlinks=False)
            raise FileExistsError(target)
        except FileNotFoundError:
            pass
        os.rename(source, target, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        return
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(parent_fd, os.fsencode(source), parent_fd, os.fsencode(target), RENAME_NOREPLACE) != 0:
        value = ctypes.get_errno()
        raise OSError(value, os.strerror(value), source, target)


def require_target(parent_fd, name, expected):
    st = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
        raise RuntimeError(f"TARGET_NOT_REGULAR:{name}")
    if full_tuple(st) != expected["tuple"] or st.st_size != expected["bytes"]:
        raise RuntimeError(f"TARGET_TUPLE_MISMATCH:{name}")
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    fst = os.fstat(fd)
    if (fst.st_dev, fst.st_ino) != (st.st_dev, st.st_ino) or sha_fd(fd) != expected["sha256"]:
        os.close(fd)
        raise RuntimeError(f"TARGET_IDENTITY_MISMATCH:{name}")
    return fd, st


def cleanup(payload):
    lease = payload["lease"]
    if lease.get("signed") is not True or lease.get("kind") != "FINANCE_P0318_RETAINED_CONTROL_CLEANUP_ONLY":
        raise RuntimeError("LEASE_NOT_SIGNED_FOR_P0318_CLEANUP")
    cleanup_id = lease.get("id", "")
    if not cleanup_id.startswith("p0") or "-finance-p0318-retained-control-cleanup-" not in cleanup_id:
        raise RuntimeError("CLEANUP_ID_INVALID")
    parent = payload["parent"]["path"]
    if parent != PRODUCTION_PARENT and os.environ.get("FINANCE_P0318_CLEANUP_TEST_ROOT") != "1":
        raise RuntimeError("PARENT_OUT_OF_SCOPE")
    names = {
        "executor": f"{TARGET_ID}.executor.sh",
        "signedLease": f"{TARGET_ID}.json",
    }
    for key, name in names.items():
        if payload["targets"][key]["path"] != os.path.join(parent, name):
            raise RuntimeError(f"TARGET_PATH_MISMATCH:{key}")
    before = inspect_parent(parent)
    for key in ("parentFullTuple", "parentStableIdentity", "directChildren", "inventorySha256"):
        if before[key] != payload["parent"][key]:
            raise RuntimeError(f"PARENT_PREWRITE_MISMATCH:{key}")
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    opened = {}
    moved = []
    try:
        for key, name in names.items():
            opened[key] = require_target(parent_fd, name, payload["targets"][key])
        second = inspect_parent(parent)
        if second != before:
            raise RuntimeError("PARENT_OR_CHILD_TOCTOU_BEFORE_MOVE")
        for key, name in names.items():
            fd, expected_st = opened[key]
            current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != (expected_st.st_dev, expected_st.st_ino):
                raise RuntimeError(f"TARGET_TOCTOU:{key}")
            quarantine = f".{cleanup_id}.{key}.owned"
            try:
                os.stat(quarantine, dir_fd=parent_fd, follow_symlinks=False)
                raise RuntimeError(f"QUARANTINE_ALREADY_PRESENT:{key}")
            except FileNotFoundError:
                pass
            rename_noreplace(parent_fd, name, quarantine)
            moved.append((key, name, quarantine))
            qst = os.stat(quarantine, dir_fd=parent_fd, follow_symlinks=False)
            if (qst.st_dev, qst.st_ino) != (expected_st.st_dev, expected_st.st_ino) or full_tuple(qst) != payload["targets"][key]["tuple"] or sha_fd(fd) != payload["targets"][key]["sha256"]:
                raise RuntimeError(f"QUARANTINE_IDENTITY_MISMATCH:{key}")
        for key, _, quarantine in moved:
            fd, expected_st = opened[key]
            qst = os.stat(quarantine, dir_fd=parent_fd, follow_symlinks=False)
            if (qst.st_dev, qst.st_ino) != (expected_st.st_dev, expected_st.st_ino) or sha_fd(fd) != payload["targets"][key]["sha256"]:
                raise RuntimeError(f"PREUNLINK_IDENTITY_MISMATCH:{key}")
        for _, _, quarantine in moved:
            os.unlink(quarantine, dir_fd=parent_fd)
        moved.clear()
    except Exception:
        for _, name, quarantine in reversed(moved):
            try:
                rename_noreplace(parent_fd, quarantine, name)
            except Exception:
                pass
        raise
    finally:
        for fd, _ in opened.values():
            os.close(fd)
        os.close(parent_fd)
    for name in names.values():
        if os.path.lexists(os.path.join(parent, name)):
            raise RuntimeError("TARGET_REMAINS_AFTER_CLEANUP")
    after = inspect_parent(parent)
    if after["parentStableIdentity"] != payload["postCleanup"]["parentStableIdentity"] or after["directChildren"] != payload["postCleanup"]["directChildren"] or after["inventorySha256"] != payload["postCleanup"]["inventorySha256"]:
        raise RuntimeError("POST_CLEANUP_READBACK_MISMATCH")
    print(json.dumps({
        "cleanup": "P0318_RETAINED_CONTROL_PAIR_REMOVED",
        "executorFinal": "absent",
        "signedLeaseFinal": "absent",
        "parentStableIdentity": after["parentStableIdentity"],
        "remainingDirectChildren": after["directChildren"],
        "remainingInventorySha256": after["inventorySha256"],
        "oldRuntimeMutationCount": 0,
    }, separators=(",", ":"), sort_keys=True))


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "inspect":
        print(json.dumps(inspect_parent(sys.argv[2]), separators=(",", ":"), sort_keys=True))
        return
    if len(sys.argv) != 3 or sys.argv[1] != "cleanup":
        raise RuntimeError("USAGE")
    payload = json.loads(base64.b64decode(sys.argv[2], validate=True))
    cleanup(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"finance-p0318-cleanup-fail:{type(error).__name__}:{error}", file=sys.stderr)
        sys.exit(65)
