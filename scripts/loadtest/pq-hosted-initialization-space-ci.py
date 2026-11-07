#!/usr/bin/env python3
"""Prepare unused Android space on one explicitly authorized disposable CI VM.

This is NOT admission, a workload runner or a general cleanup utility. The
original initialization driver must subsequently perform its own fresh admit.
No arguments select paths, caps, source revisions or deletion commands.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
from types import SimpleNamespace

PROFILE = "first100-own1b-initialize-before-load"
REF = "refs/heads/codex/ynx-pq-current75-baseline-20261101"
WORKFLOW = ".github/workflows/pq-normal-process.yml"
REPOSITORY = "JiahaoAlbus/YNX-Chain"
AUTHORIZATION = "remove-unused-android-for-first100-own1b-v1"
GO_SOURCE = "1b0ea548aca6b5260a9824d0edd3012d52e53521"
TOOLS_SOURCE = "67870e2be35295fb903e4d6f1723092e2facef7f"
D24_PROFILE = "first100-d24-initialize-before-load"
D24_AUTHORIZATION = "remove-unused-android-for-first100-d24-v1"
D24_GO_SOURCE = "d24ad7e422583906d9823789b049ef2251a09e2c"
D24_TOOLS_SOURCE = "08a14143434c2c01e2a59ece0f04ad71f9d6c60c"
TARGET = Path("/usr/local/lib/android")
SECURE_ANCESTOR = Path("/usr")
PATH_OWNER_UID = 0
DISK_FLOOR = 16 << 30
MEMORY_FLOOR = 6 << 30
MAX_PUBLIC_FILE = 512 << 10
SCRIPT = "scripts/loadtest/pq-hosted-initialization-space-ci.py"
REASON = ("This fixed profile builds Go/C consensus tooling and initializes "
          "synthetic accounts; it does not build, test or execute Android.")
REMOVE_ARGV = ("/usr/bin/sudo", "-n", "/usr/bin/timeout", "--signal=TERM",
               "--kill-after=5s", "90s", "/usr/bin/rm", "--recursive",
               "--force", "--one-file-system", "--preserve-root=all", "--",
               "/usr/local/lib/android")


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def prepared():
    return dict(schema="YNX-HOSTED-INITIALIZATION-SPACE/v1", profile=PROFILE,
                target=str(TARGET), execute=False, explicitAuthorizationRequired=True,
                initialDiskBytes=DISK_FLOOR, initialMemoryBytes=MEMORY_FLOOR,
                admissionGranted=False, nodeStartAuthorized=False,
                pressureAuthorized=False, originalWindowChanged=False)


def fixed_profile(environment):
    profile = environment.get("PQ_BASELINE_PROFILE")
    require(profile in (PROFILE, D24_PROFILE), "unknown fixed hosted preparation profile")
    if profile == D24_PROFILE:
        return profile, D24_AUTHORIZATION, D24_GO_SOURCE, D24_TOOLS_SOURCE
    return PROFILE, AUTHORIZATION, GO_SOURCE, TOOLS_SOURCE


def validate_host(environment):
    profile, authorization, _, _ = fixed_profile(environment)
    fixed = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
             "RUNNER_OS": "Linux", "RUNNER_ARCH": "X64", "ImageOS": "ubuntu24",
             "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_REF": REF,
             "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": profile,
             "PQ_BASELINE_PROFILE": profile,
             "PQ_HOSTED_SPACE_PREPARATION": authorization,
             "GITHUB_WORKFLOW_REF": REPOSITORY + "/" + WORKFLOW + "@" + REF}
    require(sys.platform == "linux" and platform.machine() == "x86_64" and
            all(environment.get(k) == v for k, v in fixed.items()) and
            environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch",
            "only explicitly authorized first-attempt fixed hosted Ubuntu24 profile")
    commit = environment.get("GITHUB_SHA", "")
    require(re.fullmatch("[0-9a-f]{40}", commit) is not None and commit != "0" * 40 and
            environment.get("GITHUB_WORKFLOW_SHA") == commit and
            re.fullmatch("[1-9][0-9]*", environment.get("GITHUB_RUN_ID", "")) is not None,
            "actual same workflow/controller commit and run identity required")
    require(os.geteuid() != 0, "normal non-root hosted runner required")


def command(argv, timeout=10, maximum=64 << 10):
    # No shell, network, package installation, build, signing, or Node workload.
    env = dict(os.environ, GOTOOLCHAIN="local", GOTELEMETRY="off", LC_ALL="C",
               GIT_OPTIONAL_LOCKS="0")
    result = subprocess.run(argv, capture_output=True, timeout=timeout, env=env,
                            check=False)
    require(len(result.stdout) + len(result.stderr) <= maximum,
            "bounded diagnostic command output exceeded")
    require(result.returncode == 0, "diagnostic command failed: " + Path(argv[0]).name)
    return result.stdout.decode("utf-8", errors="strict").strip()


def canonical(path, exists=True):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(str(path)),
            "absolute canonical path required")
    require(path.resolve(strict=exists) == path, "symlink or path alias refused")
    return path


def overlaps(a, b):
    return a == b or a in b.parents or b in a.parents


def checked_layout(environment):
    profile, _, source, tools = fixed_profile(environment)
    workspace = canonical(environment["GITHUB_WORKSPACE"])
    parent = canonical(environment["RUNNER_TEMP"])
    home = canonical(environment["HOME"])
    toolcache = canonical(environment["RUNNER_TOOL_CACHE"])
    controller = Path(__file__).resolve(strict=True).parents[2]
    require(controller == workspace / "controller", "exact controller checkout location required")
    for name, commit in (("controller", environment["GITHUB_SHA"]),
                         ("source", source), ("tools", tools)):
        checkout = canonical(workspace / name)
        prefix = ["/usr/bin/git", "-c", "core.fsmonitor=false", "-C", str(checkout)]
        require(command(prefix + ["rev-parse", "HEAD"]) == commit and
                command(prefix + ["status", "--porcelain", "--untracked-files=all"]) == "",
                "exact clean original checkouts required before preparation")
    original = subprocess.check_output(["/usr/bin/git", "-C", str(controller), "show",
                                        environment["GITHUB_SHA"] + ":" + SCRIPT], timeout=10)
    require(original == Path(__file__).read_bytes(), "executing helper differs from selected Git blob")
    os_release = Path("/etc/os-release").read_text(encoding="utf-8")
    require(re.search(r'^ID=ubuntu$', os_release, re.M) and
            re.search(r'^VERSION_ID="24\.04"$', os_release, re.M),
            "actual Ubuntu 24.04 filesystem required")
    require(not Path("/.dockerenv").exists(), "container is not the authorized hosted VM")
    protected = [workspace, parent, home, toolcache]
    for name in ("GOCACHE", "GOMODCACHE", "GOPATH", "GOROOT", "GOTMPDIR",
                 "TMPDIR", "XDG_CACHE_HOME"):
        if environment.get(name):
            for item in environment[name].split(os.pathsep):
                protected.append(canonical(item, exists=False))
    output = parent / ("pq-hosted-initialization-space-" + environment["GITHUB_RUN_ID"] + "-1")
    if profile == D24_PROFILE:
        output = parent / ("pq-hosted-initialization-space-d24-" + environment["GITHUB_RUN_ID"] + "-1")
    require(not output.exists() and not output.is_symlink(), "existing preparation/UNKNOWN evidence retained; no retry")
    return SimpleNamespace(workspace=workspace, parent=parent, home=home,
                           toolcache=toolcache, protected=protected, output=output)


def mount_unescape(value):
    require(re.search(r"\\(?!040|011|012|134)", value) is None, "invalid kernel mount escape")
    return re.sub(r"\\(040|011|012|134)", lambda m: chr(int(m[1], 8)), value)


def parse_mounts(raw):
    require(0 < len(raw.encode("utf-8")) <= 256 << 10, "bounded mountinfo required")
    result = []
    for line in raw.splitlines():
        fields = line.split()
        require(len(fields) >= 10 and "-" in fields and fields.index("-") >= 6,
                "malformed kernel mountinfo")
        root, point = (Path(mount_unescape(fields[i])) for i in (3, 4))
        require(root.is_absolute() and point.is_absolute() and
                str(root) == os.path.normpath(str(root)) and
                str(point) == os.path.normpath(str(point)), "noncanonical kernel mount path")
        result.append(dict(root=str(root), point=str(point), device=fields[2]))
    require(result and len(result) <= 4096, "bounded nonempty mount table required")
    return result


def target_guard(context, mounts, protected):
    # All fixed target ancestors are physically directories, root-owned and not
    # renameable by an unprivileged workflow process. SDK *children* may be 0777
    # in the official image; rm does not dereference their symbolic links.
    parent = canonical(TARGET.parent)
    current = TARGET
    while True:
        if current == TARGET and not current.exists() and not current.is_symlink():
            pass
        else:
            info = current.lstat()
            require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
                    info.st_uid == PATH_OWNER_UID and info.st_mode & 0o022 == 0,
                    "target or ancestor is aliased, writable, or not image-owned")
        if current == SECURE_ANCESTOR:
            break
        require(current != current.parent, "fixed target ancestry differs")
        current = current.parent
    require(not any(overlaps(TARGET, Path(p)) for p in protected),
            "Android target overlaps workspace/home/cache/toolchain/protected evidence")
    for mount in mounts:
        point, root = Path(mount["point"]), Path(mount["root"])
        require(point == Path("/") or not overlaps(TARGET, point),
                "Android target overlaps a non-root mount")
        require(root == Path("/") or not overlaps(TARGET, root),
                "Android target aliases a bind/subvolume source")
    require(parent.stat().st_dev == context.parent.stat().st_dev == context.workspace.stat().st_dev,
            "Android removal cannot free the original admission filesystem")
    if not TARGET.exists():
        return None
    canonical(TARGET)
    info = TARGET.stat()
    require(info.st_dev == parent.stat().st_dev, "target is a distinct mounted filesystem")
    return dict(device=info.st_dev, inode=info.st_ino, ctimeNS=info.st_ctime_ns,
                mode=stat.S_IMODE(info.st_mode), uid=info.st_uid)


def tools_snapshot():
    tools = {}
    for name, args in (("go", ["version"]), ("python3", ["--version"]),
                       ("node", ["--version"]), ("cc", ["--version"]),
                       ("openssl", ["version"])):
        selected = shutil.which(name)
        require(selected is not None, "original profile tool is missing: " + name)
        executable = Path(selected).resolve(strict=True)
        require(executable.is_file() and not overlaps(TARGET, executable),
                "tool executable overlaps deletion target")
        tools[name] = dict(executable=str(executable),
                           version=command([str(executable), *args], maximum=16 << 10))
    require(tools["go"]["version"] == "go version go1.26.10 linux/amd64",
            "original pinned normal Go toolchain required")
    raw = command([tools["go"]["executable"], "env", "-json", "GOROOT", "GOPATH", "GOCACHE", "GOMODCACHE"])
    paths = json.loads(raw)
    require(set(paths) == {"GOROOT", "GOPATH", "GOCACHE", "GOMODCACHE"} and
            all(isinstance(x, str) and x for x in paths.values()), "actual Go path inventory required")
    protected = [Path(t["executable"]) for t in tools.values()]
    for value in paths.values():
        protected.extend(canonical(p, exists=False) for p in value.split(os.pathsep))
    return tools, paths, protected


def capture(context, into):
    into["timeUnixNS"] = time.time_ns()
    into["df"] = command(["/usr/bin/df", "-B1", "-P", "/", str(context.parent),
                           str(context.workspace), str(TARGET.parent)])
    mount_raw = Path("/proc/self/mountinfo").read_text(encoding="utf-8")
    mounts = parse_mounts(mount_raw)
    into["mountinfo"] = mount_raw
    memory = Path("/proc/meminfo").read_text(encoding="ascii")
    require(len(memory) <= 64 << 10, "bounded meminfo required")
    matches = re.findall(r"^MemAvailable:\s+([0-9]+) kB$", memory, re.M)
    require(len(matches) == 1, "actual MemAvailable unavailable")
    into["meminfo"] = memory
    into["memoryAvailableBytes"] = int(matches[0]) * 1024
    fs = os.statvfs(context.parent)
    into["diskAvailableBytes"] = fs.f_bavail * fs.f_frsize
    tools, paths, protected = tools_snapshot()
    into["tools"], into["goPaths"] = tools, paths
    protected = context.protected + protected
    into["protectedPaths"] = [str(p) for p in protected]
    identity = target_guard(context, mounts, protected)
    into["targetIdentity"] = identity
    into["targetExists"] = identity is not None
    if identity is None:
        into["targetAllocatedBytes"] = 0
    else:
        measured = command(["/usr/bin/du", "-s", "-x", "-B1", "--", str(TARGET)], timeout=60)
        match = re.fullmatch(r"([0-9]+)\s+" + re.escape(str(TARGET)), measured)
        require(match is not None, "actual bounded Android directory size unavailable")
        into["targetAllocatedBytes"] = int(match[1])
        into["du"] = measured
    into["complete"] = True
    return mounts, protected


def write_new(root, name, data):
    raw = (json.dumps(data, sort_keys=True, indent=2) + "\n").encode("utf-8")
    require(len(raw) <= MAX_PUBLIC_FILE, "public evidence exceeds fixed bound")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(root / name, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        # Keep exact partial/UNKNOWN evidence. Never unlink or replace.
        raise


def remove_fixed_target(record):
    require(TARGET == Path("/usr/local/lib/android"), "fixed Android path changed")
    validate_host(os.environ)  # The private primitive cannot bypass the CI gate.
    record["argv"] = list(REMOVE_ARGV)
    record["startedUnixNS"] = time.time_ns()
    # The privileged timeout is the parent of privileged rm; it terminates and
    # reaps its own child. Never launch detached asynchronous cleanup/retries.
    try:
        child = subprocess.Popen(REMOVE_ARGV, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.PIPE, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        record["pid"] = child.pid
        try:
            _, stderr = child.communicate(timeout=110)
        except subprocess.TimeoutExpired:
            child.kill()
            _, stderr = child.communicate()
            record["outerTimeout"] = True
        record["returncode"] = child.returncode
        record["stderrBytes"] = len(stderr)
        record["stderrSHA256"] = hashlib.sha256(stderr).hexdigest()
        require(not record.get("outerTimeout") and child.returncode == 0,
                "Android removal UNKNOWN/failed; preserve evidence, never retry")
    finally:
        record["finishedUnixNS"] = time.time_ns()


def execute(environment):
    validate_host(environment)  # Absolutely no mutation before explicit host gate.
    context = checked_layout(environment)
    context.output.mkdir(mode=0o700)  # Exclusive once-per-run evidence/intent.
    before, after, removal = {}, {}, {}
    result = dict(prepared(), execute=True, controllerCommit=environment["GITHUB_SHA"],
                  runID=environment["GITHUB_RUN_ID"], attempt=1, notNeededReason=REASON,
                  parentReportedPriorFailure=dict(runID="41332298089", stage="original admission before Window/build/key/node", reason="initial disk below original 16GiB floor"),
                  removalAttempted=False, status="UNKNOWN", originalDriverMustReadmit=True)
    result["profile"] = fixed_profile(environment)[0]
    held = None
    before_written = False
    try:
        mounts, protected = capture(context, before)
        write_new(context.output, "BEFORE.json", before)
        before_written = True
        should_remove = (before["diskAvailableBytes"] < DISK_FLOOR and
                         before["memoryAvailableBytes"] >= MEMORY_FLOOR and before["targetExists"])
        if should_remove:
            held = os.open(TARGET, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(held)
            require((info.st_dev, info.st_ino, info.st_ctime_ns) ==
                    tuple(before["targetIdentity"][k] for k in ("device", "inode", "ctimeNS")),
                    "Android identity changed since original before snapshot")
            write_new(context.output, "INTENT.json", dict(target=str(TARGET),
                      targetIdentity=before["targetIdentity"], removalArgv=list(REMOVE_ARGV),
                      controllerCommit=environment["GITHUB_SHA"], reason=REASON,
                      status="INTENT_ONLY_RESULT_UNKNOWN", automaticRetryAllowed=False))
            fresh_mounts = parse_mounts(Path("/proc/self/mountinfo").read_text(encoding="utf-8"))
            require(target_guard(context, fresh_mounts, protected) == before["targetIdentity"],
                    "Android identity changed before mutation")
            result["removalAttempted"] = True
            remove_fixed_target(removal)
        else:
            result["notRemovedReason"] = ("disk floor already available" if before["diskAvailableBytes"] >= DISK_FLOOR
                                          else "insufficient memory is not repaired by deletion" if before["memoryAvailableBytes"] < MEMORY_FLOOR
                                          else "Android installation absent")
        capture(context, after)
        require(after["tools"] == before["tools"] and after["goPaths"] == before["goPaths"],
                "protected tool/version/path changed during preparation")
        require(not result["removalAttempted"] or not after["targetExists"],
                "fixed directory remains after reported removal")
        result["status"] = ("PREPARATION_COMPLETE_NOT_ADMISSION" if
                            after["diskAvailableBytes"] >= DISK_FLOOR and
                            after["memoryAvailableBytes"] >= MEMORY_FLOOR else "NO_CAPACITY")
        result["exitCode"] = 0
    except Exception as error:
        result["status"] = "UNKNOWN_REMOVAL" if result["removalAttempted"] else "REFUSED"
        result["firstCause"] = str(error)
        result["exitCode"] = 1
        if result["removalAttempted"] and not after.get("complete"):
            try:
                capture(context, after)
            except Exception as secondary:
                after["captureError"] = str(secondary)
    finally:
        if held is not None:
            os.close(held)
        if not before_written:
            write_new(context.output, "BEFORE.json", before)
        write_new(context.output, "AFTER.json", after)
        result["removal"] = removal
        write_new(context.output, "RESULT.json", result)
    # Successful preparation (including NO_CAPACITY) is not a Ready grant.
    # The very next original driver invocation re-measures its unchanged floors.
    print(json.dumps(result, sort_keys=True))
    return result["exitCode"]


def main(argv=None):
    values = list(sys.argv[1:] if argv is None else argv)
    require(values.count("--execute") <= 1, "duplicate explicit execution flag")
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(values)
    if not args.execute:
        print(json.dumps(prepared(), sort_keys=True))
        return 0
    return execute(dict(os.environ))


if __name__ == "__main__":
    raise SystemExit(main())
