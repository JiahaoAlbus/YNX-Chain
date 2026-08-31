#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import stat
import sys

PATH = "/opt/ynx/stage/finance/finance-combined-4f7fba323a89-20260831t041500z"

def kind(mode):
    if stat.S_ISREG(mode): return "regular file"
    if stat.S_ISDIR(mode): return "directory"
    if stat.S_ISLNK(mode): return "symbolic link"
    return "other"

def full_tuple(value):
    return f"{value.st_dev}:{value.st_ino}:{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:{value.st_nlink}:{value.st_size}:{kind(value.st_mode)}"

def stable(value):
    return f"{value.st_dev}:{value.st_ino}:{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:directory"

def sha_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk: break
            digest.update(chunk)
    return digest.hexdigest()

def root_fact():
    value = os.lstat(PATH)
    if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode):
        raise RuntimeError("CARRIER_ROOT_NOT_DIRECTORY")
    return {"path":PATH,"fullTuple":full_tuple(value),"stableIdentity":stable(value)}

def main():
    before = root_fact()
    children = []
    for name in sorted(os.listdir(PATH), key=os.fsencode):
        path = os.path.join(PATH, name)
        value = os.lstat(path)
        item = {"name":name,"tuple":full_tuple(value),"sha256":sha_file(path) if stat.S_ISREG(value.st_mode) else None}
        children.append(item)
    canonical = json.dumps(children, separators=(",", ":"), sort_keys=True).encode()
    after = root_fact()
    if before != after:
        raise RuntimeError("CARRIER_ROOT_CHANGED_DURING_READ")
    output = {
        "inspection":"FINANCE_P0318_CARRIER_RAW_FIRST_ZERO_WRITE",
        "rootBefore":before,
        "directChildren":len(children),
        "children":children,
        "canonicalInventoryInputBytes":len(canonical),
        "canonicalInventoryInputBase64":base64.b64encode(canonical).decode(),
        "canonicalInventorySha256":hashlib.sha256(canonical).hexdigest(),
        "rootAfter":after,
        "rootStableDuringRead":True,
        "mutationCount":0,
    }
    print(json.dumps(output, separators=(",", ":"), sort_keys=True))

if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(f"p0324-raw-first-fail:{type(error).__name__}:{error}", file=sys.stderr)
        raise SystemExit(65)
