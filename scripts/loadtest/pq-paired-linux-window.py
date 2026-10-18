#!/usr/bin/env python3
"""Linux-only, one prepared PQ paired test. Default never launches Go.

Kernel /proc/stat identities + smaps_rollup RSS; no monitor ps subprocess.
Sampled limits are not a hard cgroup ceiling or an atomic host snapshot.
"""
import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

CAPS = dict(activeMs=105000, cleanupMs=15000, totalMs=120000,
            ownedRSSBytes=1 << 30, threads=320, ownedProcesses=16,
            privateBytes=32 << 20, buildBytes=1 << 30, logBytes=1 << 20,
            diskFloorBytes=1 << 30, rootReserveBytes=425 << 20,
            compileReserveBytes=1 << 30, availableMemoryFloorBytes=(1 << 30) + (128 << 20),
            sampleMs=200)


def bounded(path, limit=65536):
    with open(path, "rb") as handle:
        raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise RuntimeError("bounded kernel/input read exceeded: " + str(path))
    return raw


def parse_stat(raw, expected):
    end = raw.rfind(b")")
    if not raw.startswith((str(expected) + " (").encode()) or end < 0:
        raise RuntimeError("invalid proc stat identity")
    fields = raw[end + 1:].split()
    if len(fields) < 22 or len(fields[0]) != 1:
        raise RuntimeError("truncated proc stat")
    row = dict(pid=expected, parent=int(fields[1]), group=int(fields[2]),
               startTicks=int(fields[19]), threads=int(fields[17]), state=fields[0].decode("ascii"))
    if expected < 1 or any(row[k] < 0 for k in ("parent", "group", "startTicks", "threads")):
        raise RuntimeError("invalid proc stat fields")
    return row


def proc_inventory(root=Path("/proc")):
    entries = [p for p in root.iterdir() if p.name.isdecimal()]
    if len(entries) > 65536:
        raise RuntimeError("host PID inventory bound")
    rows = {}
    vanished = []
    for directory in entries:
        pid = int(directory.name)
        try:
            rows[pid] = parse_stat(bounded(directory / "stat"), pid)
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH):
                raise  # Unknown host identities cannot be excluded by guessing.
            vanished.append(pid)
    return rows, vanished


def owned_set(rows, launcher, job=None, known=None, require_job=False, job_start=None):
    if launcher not in rows or (require_job and job not in rows):
        raise RuntimeError("active owned root missing")
    owned = {launcher}
    for pid, row in rows.items():
        if (known or {}).get(pid) == row["startTicks"]:
            owned.add(pid)
    changed = True
    while changed:
        changed = False
        for pid, row in rows.items():
            # The disposable wrapper is a subreaper; adopted children are owned.
            if row["parent"] in owned and pid not in owned:
                owned.add(pid)
                changed = True
    if len(owned) > CAPS["ownedProcesses"]:
        raise RuntimeError("owned PID bound; inventory not truncated")
    # Never seed ownership from a recycled numeric PID/PGID. The disposable
    # wrapper's real child/adopted closure and prior startTicks establish it.
    if require_job and (job not in owned or job_start is None or rows[job]["startTicks"] != job_start):
        raise RuntimeError("active owned root identity mismatch")
    return sorted(owned)


def smaps_rss(raw):
    found = re.findall(rb"^Rss:\s+(\d+)\s+kB\s*$", raw, re.M)
    if len(found) != 1:
        raise RuntimeError("smaps_rollup RSS missing or duplicate")
    return int(found[0]) * 1024


def memory_available(root=Path("/proc")):
    found = re.findall(rb"^MemAvailable:\s+(\d+)\s+kB\s*$", bounded(root / "meminfo"), re.M)
    if len(found) != 1:
        raise RuntimeError("actual Linux MemAvailable unavailable")
    return int(found[0]) * 1024


def directory_bytes(root):
    total, count = 0, 0
    pending = [(Path(root), 0)]
    while pending:
        directory, depth = pending.pop()
        if depth > 32:
            raise RuntimeError("private directory depth bound")
        for entry in directory.iterdir():
            count += 1
            if count > 10000:
                raise RuntimeError("private file count bound")
            try:
                info = entry.lstat()
            except FileNotFoundError:
                continue  # A rename/unlink completed; final retired scan is strict/stable.
            if stat.S_ISDIR(info.st_mode):
                pending.append((entry, depth + 1))
            elif stat.S_ISREG(info.st_mode):
                total += info.st_size
            else:
                raise RuntimeError("nonregular private artifact")
    return total


def enforce(sample, initial=False, *, private_bytes_cap=None):
    # Only the explicitly registered Supply data64 profile opts into this budget.
    # Default and all legacy callers retain the original cap. No sample is clipped.
    if private_bytes_cap is not None and (type(private_bytes_cap) is not int or private_bytes_cap != 64 << 20):
        raise RuntimeError("unregistered private data cap")
    caps = CAPS if private_bytes_cap is None else dict(CAPS, privateBytes=private_bytes_cap)
    for key, cap in (("rssBytes", "ownedRSSBytes"), ("threads", "threads"),
                     ("privateBytes", "privateBytes"), ("buildBytes", "buildBytes")):
        if not isinstance(sample[key], int) or sample[key] < 0 or sample[key] > caps[cap]:
            raise RuntimeError(key + " cap exceeded/invalid")
    floor = CAPS["diskFloorBytes"] + CAPS["rootReserveBytes"]
    if initial:
        floor += CAPS["compileReserveBytes"] + caps["privateBytes"]
    if type(sample["freeDiskBytes"]) is not int or sample["freeDiskBytes"] < floor:
        raise RuntimeError("actual disk floor/reserve failed")
    if type(sample["availableMemoryBytes"]) is not int or sample["availableMemoryBytes"] < CAPS["availableMemoryFloorBytes"]:
        raise RuntimeError("Linux MemAvailable floor failed; not a macOS pressure signal")


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def validate_recipe(plan, prepared, case_n=1):
    source = Path(plan["sourceRoot"]).resolve()
    case = prepared.parent.resolve()
    if source == case or source in case.parents or case in source.parents:
        raise RuntimeError("private CI case must be outside source checkout")
    if case_n not in (1, 16) or type(plan.get("n")) is not int or plan["n"] != case_n or plan.get("trial") != 1:
        raise RuntimeError("explicit case scope must match one N1 or N16/trial1")
    version = plan.get("productionMeasurementVersion")
    if version not in (None, "ynx-pq-batch-measurement-v1") or (case_n == 16 and version is None):
        raise RuntimeError("N16 requires frozen production measurement API")
    expected = ["go", "test", "-overlay", str(case / "overlay.json"), "-p", "1",
                "./internal/chain", "-run", "^TestPQPairedPersistentPerformance$", "-count=1", "-timeout=90s"]
    if plan.get("command") != expected or plan.get("executionAuthorized") is not False:
        raise RuntimeError("unapproved command/recipe shape")
    overlay = plan["overlayPin"]
    frozen = case / "pq_paired_performance_test.go.in"
    if Path(overlay["path"]) != frozen or frozen.is_symlink() or digest(frozen) != overlay["sha256"]:
        raise RuntimeError("frozen overlay pin mismatch")
    mappings = json.loads(bounded(case / "overlay.json", 1 << 20))
    if mappings != {"Replace": {str(source / "internal/chain/pq_paired_performance_test.go"): str(frozen)}}:
        raise RuntimeError("overlay maps outside owned test")
    env = plan["environment"]
    expected_env = dict(GOMAXPROCS="1", GOGC="50", GOMEMLIMIT="512MiB",
                        YNX_PQ_PAIR_SOURCE_COMMIT=plan["commit"], YNX_PQ_PAIR_N=str(plan["n"]),
                        YNX_PQ_PAIR_TRIAL=str(plan["trial"]), YNX_PQ_PAIR_OUTPUT=str(case / "pq-paired-result.json"))
    if env != expected_env or not re.fullmatch(r"[0-9a-f]{40}", plan["commit"]):
        raise RuntimeError("frozen environment mismatch")
    return source, case, expected, expected_env


def validate_production_measurement(row, report, plan):
    version = "ynx-pq-batch-measurement-v1"
    m = row.get("wholeMeasurement")
    if plan.get("productionMeasurementVersion") != version or report.get("productionMeasurementVersion") != version or not isinstance(m, dict) or m.get("version") != version:
        raise RuntimeError("production measurement version/result missing")
    def decimal(value, maximum, length):
        return isinstance(value, str) and len(value) <= length and re.fullmatch(r"0|[1-9][0-9]*", value) is not None and int(value) <= maximum
    def phase(value, attempts):
        if (not isinstance(value, dict) or any(type(value.get(k)) is not int for k in ("attempts", "completed", "errors"))
                or value["attempts"] != attempts or value["completed"] != attempts or value["errors"] != 0
                or not decimal(value.get("durationNs"), (1 << 63)-1, 19)
                or (attempts == 0 and value["durationNs"] != "0")):
            raise RuntimeError("actual successful production phase coverage missing")
    wire_hash = "0x" + report["sharedWholeSha256"]
    out = m.get("result")
    if (m.get("wireHash") != wire_hash or not decimal(m.get("executionHeight"), (1 << 64)-1, 20)
            or not isinstance(out, dict) or out.get("batchHash") != wire_hash or out.get("executionHeight") != m["executionHeight"]
            or out.get("status") != "durable" or out.get("replayed") is not False
            or type(m.get("verifierSignatureChecks")) is not int or m["verifierSignatureChecks"] != 2
            or type(m.get("memberAdmitted")) is not int or m["memberAdmitted"] != plan["n"]
            or type(m.get("memberRejected")) is not int or m["memberRejected"] != 0):
        raise RuntimeError("production measurement differs from original successful Whole call")
    members = out.get("results")
    if not isinstance(members, list) or len(members) != plan["n"]:
        raise RuntimeError("production member outcomes missing")
    for i, member in enumerate(members):
        if not isinstance(member, dict) or type(member.get("index")) is not int or member["index"] != i or member.get("outcome") != "admitted" or member.get("transactionHash") != row["memberHashes"][i] or member.get("error", "") != "":
            raise RuntimeError("production member result identity differs")
    for name in ("total", "inputCloneHash", "lockWait", "policyValidation", "wireDecode", "wholeAuthentication"):
        phase(m.get(name), 1)
    phase(m.get("memberExecution"), plan["n"]); phase(m.get("replay"), 0)
    persistence = m.get("persistence")
    if not isinstance(persistence, dict):
        raise RuntimeError("production persistence phases missing")
    for name in ("total", "snapshotBuild", "integritySeal", "checkpointBuild", "persistenceLockWait", "mkdir"):
        phase(persistence.get(name), 1)
    for name in ("snapshotFile", "markerFile"):
        f = persistence.get(name)
        if not isinstance(f, dict) or any(type(f.get(k)) is not int or f[k] < 1 for k in ("writeCalls", "bytesWritten")):
            raise RuntimeError("actual production writes missing")
        for name in ("total", "openTemp", "encodeWrite", "fileSync", "close", "rename", "directorySync"):
            phase(f.get(name), 1)
    published = persistence.get("published")
    if (not isinstance(published, dict) or published.get("version") != "ynx-local-durability-v1"
            or not decimal(published.get("height"), (1 << 64)-1, 20) or not isinstance(published.get("hash"), str)
            or not isinstance(published.get("snapshotIntegrity"), str) or not published["snapshotIntegrity"]
            or published["snapshotIntegrity"] != persistence.get("candidateIntegrity")):
        raise RuntimeError("production local checkpoint publication missing")


def validate_result(report, plan, case):
    if report.get("sourceCommit") != plan["commit"] or report.get("n") != plan["n"] or report.get("trial") != plan["trial"] or report.get("businessProjectionEqual") is not True or report.get("bftFinalCommits") is not None:
        raise RuntimeError("expected bounded paired result missing/mismatched")
    if (report.get("schema") != 1 or report.get("kind") != "isolated-single-producer-PQ-paired-component"
            or "bftFinalCommits" not in report or "consensusFinalityLatency" not in report
            or report["consensusFinalityLatency"] is not None or report.get("gomaxprocs") != 1
            or report.get("order") != ["members", "whole"]
            or not re.fullmatch(r"[0-9a-f]{64}", report.get("sharedWholeSha256", ""))):
        raise RuntimeError("paired result qualification fields missing")
    rows = report.get("results")
    if not isinstance(rows, list) or len(rows) != 2 or any(not isinstance(row, dict) for row in rows):
        raise RuntimeError("both measured member paths required")
    if [row.get("mode") for row in rows] != report["order"]:
        raise RuntimeError("measured modes/order differ")
    if plan.get("productionMeasurementVersion") is not None or report.get("productionMeasurementVersion") is not None:
        if rows[0].get("wholeMeasurement") is not None:
            raise RuntimeError("standalone member path cannot claim Whole phase measurement")
        validate_production_measurement(rows[1], report, plan)
    signing = []
    for row in rows:
        n, mode = plan["n"], row["mode"]
        for key in ("members", "localBlockCheckpointMembers", "coldRestoredMembers"):
            if type(row.get(key)) is not int or row[key] != n:
                raise RuntimeError("actual member checkpoint/readback count missing")
        if row.get("cloneLocalPeersPreserved") is not True or row.get("checkpointPointerTransitions") != (1 if mode == "whole" else n):
            raise RuntimeError("local clone/checkpoint qualification missing")
        hashes = row.get("memberHashes")
        if not isinstance(hashes, list) or len(hashes) != n or any(not isinstance(h, str) or not re.fullmatch(r"0x[0-9a-f]{64}", h) for h in hashes) or len(set(hashes)) != n:
            raise RuntimeError("distinct measured member identities missing")
        for key in ("submitNs", "submitWallNs", "sharedSigningPreparationNs", "manualProduceBlockNs", "coldRestoreNs"):
            if type(row.get(key)) is not int or row[key] <= 0:
                raise RuntimeError("original measured phase duration missing")
        if row["submitWallNs"] < row["submitNs"]:
            raise RuntimeError("API duration exceeds actual loop window")
        requests, observed = row.get("requestCheckpointNs"), row.get("memberOfferToCheckpointNs")
        if not isinstance(requests, list) or len(requests) != (1 if mode == "whole" else n) or any(type(v) is not int or v <= 0 for v in requests) or sum(requests) != row["submitNs"]:
            raise RuntimeError("request timing coverage missing")
        if not isinstance(observed, list) or len(observed) != n or any(type(v) is not int or v <= 0 or v > row["submitWallNs"] for v in observed):
            raise RuntimeError("member timing coverage missing")
        signing.append(row["sharedSigningPreparationNs"])
        for phase in ("pending", "block"):
            if type(row.get(phase + "SnapshotBytes")) is not int or not 0 < row[phase + "SnapshotBytes"] <= CAPS["privateBytes"] or not re.fullmatch(r"[0-9a-f]{64}", row.get(phase + "SnapshotSha256", "")):
                raise RuntimeError("snapshot measurement missing")
        snapshot = case / ("pq-paired-result.json." + mode + ".snapshot.json")
        before = snapshot.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size != row["blockSnapshotBytes"] or digest(snapshot) != row["blockSnapshotSha256"]:
            raise RuntimeError("private retained snapshot differs from measured result")
        after = snapshot.lstat()
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
            raise RuntimeError("private snapshot changed during qualification")
    if signing[0] != signing[1]:
        raise RuntimeError("paired paths did not share one signing preparation")


def run(prepared, receipt, case_n=1):
    if sys.platform != "linux":
        raise RuntimeError("Linux /proc/smaps_rollup/subreaper required; no macOS substitution")
    started = time.monotonic()
    result = dict(schema=1, kind="single-PQ-paired-Linux-CI-window", launcher=os.getpid(),
                  startedAtUnix=time.time(), caps=CAPS, firstCause=None, samples=[], known={},
                  child=None, cleanupComplete=False, admissionPlatform="Linux, not macOS dispatch1")
    child = None
    selector = selectors.DefaultSelector()
    logs = {}
    known = {}
    case = build = None
    def interrupted(signum, _frame):
        raise RuntimeError("wrapper signal " + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)

    def fail(error):
        if result["firstCause"] is None:
            result["firstCause"] = str(error)

    def sample(initial=False):
        rows, vanished = proc_inventory()
        running = child is not None and child.poll() is None
        ids = owned_set(rows, os.getpid(), child.pid if child else None, known, running,
                        result["child"].get("startTicks") if child else None)
        tasks = []
        for pid in ids:
            before = rows[pid]
            try:
                raw = bounded(Path("/proc") / str(pid) / "smaps_rollup") if before["state"] != "Z" else None
                after = parse_stat(bounded(Path("/proc") / str(pid) / "stat"), pid)
            except OSError as error:
                if error.errno not in (errno.ENOENT, errno.ESRCH):
                    raise
                try:
                    current = parse_stat(bounded(Path("/proc") / str(pid) / "stat"), pid)
                except OSError as absent:
                    if absent.errno in (errno.ENOENT, errno.ESRCH):
                        continue  # Proved gone, not a missing live RSS row.
                    raise
                if current["startTicks"] != before["startTicks"] or current["state"] != "Z":
                    raise RuntimeError("active owned task RSS unreadable")
                after, raw = current, None
            if after["startTicks"] != before["startTicks"]:
                raise RuntimeError("owned PID reused during capture")
            if raw is None and after["state"] != "Z":
                raise RuntimeError("live owned task missing RSS")
            tasks.append(dict(after, rssBytes=smaps_rss(raw) if raw is not None else 0))
        known.clear()
        known.update({p["pid"]: p["startTicks"] for p in tasks if p["pid"] != os.getpid()})
        free = os.statvfs(case)
        item = dict(elapsedMs=int((time.monotonic() - started) * 1000),
                    rssBytes=sum(p["rssBytes"] for p in tasks), threads=sum(p["threads"] for p in tasks),
                    privateBytes=directory_bytes(case), buildBytes=directory_bytes(build),
                    freeDiskBytes=free.f_bavail * free.f_frsize, availableMemoryBytes=memory_available(),
                    hostIdentities=len(rows), vanishedHostPIDs=vanished, tasks=tasks)
        result["samples"].append(item)
        enforce(item, initial)
        return rows, ids

    try:
        plan = json.loads(bounded(prepared, 1 << 20))
        source, case, command, pinned_env = validate_recipe(plan, prepared, case_n=case_n)
        if receipt.exists() or receipt.is_symlink() or case == receipt.parent or case in receipt.parents:
            raise RuntimeError("new guard receipt must be outside private case")
        result["preparedSHA256"] = digest(prepared)
        result["sourceCommit"] = plan["commit"]
        result["explicitCaseN"] = case_n
        result["kernel"] = dict(release=os.uname().release, machine=os.uname().machine, logicalCPUs=os.cpu_count())
        def source_check():
            git_env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
            head = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], env=git_env, check=True, capture_output=True, timeout=3).stdout.strip().decode()
            dirty = subprocess.run(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=normal"], env=git_env, check=True, capture_output=True, timeout=3).stdout
            if head != plan["commit"] or dirty:
                raise RuntimeError("source no longer exact/clean")
            for relative, pin in plan["sourcePins"].items():
                if source not in (source / relative).resolve().parents or digest(source / relative) != pin["sha256"]:
                    raise RuntimeError("source pin mismatch")
        source_check()
        for name in ("pq-paired-result.json", "pq-paired-result.json.members.snapshot.json", "pq-paired-result.json.whole.snapshot.json", "tmp", "go.stdout.log", "go.stderr.log"):
            if (case / name).exists() or (case / name).is_symlink():
                raise RuntimeError("preserve prior case artifacts")
        build = case.with_name(case.name + ".build")
        build.mkdir(mode=0o700)
        (build / "tmp").mkdir(); (case / "tmp").mkdir()
        if len({os.stat(p).st_dev for p in (source, case, build, Path.home())}) != 1:
            raise RuntimeError("CI source/temp/default cache must share monitored filesystem")
        caches = dict(
            GOCACHE=os.environ.get("GOCACHE") or str(Path(os.environ.get("XDG_CACHE_HOME") or Path.home()/".cache")/"go-build"),
            GOMODCACHE=os.environ.get("GOMODCACHE") or str(Path((os.environ.get("GOPATH") or str(Path.home()/"go")).split(os.pathsep)[0])/"pkg/mod"))
        for name, value in caches.items():
            cache = Path(value)
            if not cache.is_absolute():
                raise RuntimeError("absolute supported Go cache required: " + name)
            while not cache.exists():
                cache = cache.parent
            if cache.stat().st_dev != case.stat().st_dev:
                raise RuntimeError("Go caches must share monitored filesystem")
        result["goCachePaths"] = caches
        mounts = [line.split() for line in bounded(Path("/proc/mounts"), 1 << 20).splitlines()]
        proc_mounts = [row for row in mounts if len(row) >= 4 and row[1:3] == [b"/proc", b"proc"]]
        if len(proc_mounts) != 1 or any(option.startswith(b"hidepid=") and option != b"hidepid=0" for option in proc_mounts[0][3].split(b",")):
            raise RuntimeError("complete visible procfs without hidepid required")
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        current = ctypes.c_int(0)
        if libc.prctl(36, 1, 0, 0, 0) != 0 or libc.prctl(37, ctypes.cast(ctypes.pointer(current), ctypes.c_void_p).value, 0, 0, 0) != 0 or current.value != 1:
            raise RuntimeError("private child subreaper unavailable")
        result["subreaper"] = True
        pid = os.fork()
        if pid == 0:
            os._exit(0)
        result["forkProbe"] = dict(pid=pid, waited=None, status=None)
        waited, status = os.waitpid(pid, 0)
        result["forkProbe"] = dict(pid=pid, waited=waited, status=status)
        if waited != pid or status != 0:
            raise RuntimeError("actual fork/wait failed")
        sample(True)
        if time.monotonic() - started >= CAPS["activeMs"] / 1000:
            raise RuntimeError("active deadline before Go START")
        executable = shutil.which("go")
        if not executable:
            raise RuntimeError("configured Go executable missing")
        result["goExecutable"] = dict(path=executable, sha256=digest(executable))
        environment = dict(os.environ)
        environment.pop("YNX_CHAIN_STOPPED_WINDOW", None); environment.pop("YNX_CHAIN_PARTIAL_STOPPED_WINDOW", None)
        environment.update(pinned_env, TMPDIR=str(case / "tmp"), GOTMPDIR=str(build / "tmp"), GOWORK="off", GOTOOLCHAIN="local", GOFLAGS="-mod=readonly")
        for key in ("stdout", "stderr"):
            logs[key] = open(case / ("go." + key + ".log"), "xb", buffering=0)
        child = subprocess.Popen([executable] + command[1:], cwd=source, env=environment,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        result["child"] = dict(pid=child.pid, code=None)
        print(json.dumps(dict(stage="START", launcher=os.getpid(), go=child.pid, birthIdentityPending=True)), flush=True)
        birth = parse_stat(bounded(Path("/proc") / str(child.pid) / "stat"), child.pid)
        if birth["parent"] != os.getpid():
            raise RuntimeError("Go root was not born as this wrapper's child")
        result["child"]["startTicks"] = birth["startTicks"]
        for key, stream in (("stdout", child.stdout), ("stderr", child.stderr)):
            os.set_blocking(stream.fileno(), False); selector.register(stream, selectors.EVENT_READ, key)
        byte_count, next_sample = 0, 0.0
        while True:
            if time.monotonic() - started >= CAPS["activeMs"] / 1000:
                raise RuntimeError("105s active deadline")
            for key, _ in selector.select(0.05):
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj); continue
                byte_count += len(block)
                if byte_count > CAPS["logBytes"]:
                    raise RuntimeError("combined Go log bound")
                logs[key.data].write(block)
            if time.monotonic() >= next_sample:
                sample(); next_sample = time.monotonic() + CAPS["sampleMs"] / 1000
            if child.poll() is not None and not selector.get_map():
                break
        if time.monotonic() - started >= CAPS["activeMs"] / 1000:
            raise RuntimeError("active deadline exceeded before qualification")
        result["child"]["code"] = child.returncode
        if child.returncode != 0:
            raise RuntimeError("actual Go terminal code " + str(child.returncode))
        sample()  # Complete retired data/log scan, even if Go finished between ticks.
        source_check()
        # Neither a skipped Go test nor a leftover JSON can qualify success.
        report = json.loads(bounded(case / "pq-paired-result.json", 1 << 20))
        validate_result(report, plan, case)
        result["resultSHA256"] = digest(case / "pq-paired-result.json")
    except Exception as error:
        fail(error)
    finally:
        # Signal only fresh PID+start identities in this wrapper's child tree.
        cleanup_start = time.monotonic()
        cleanup_deadline = min(cleanup_start + CAPS["cleanupMs"] / 1000, started + CAPS["totalMs"] / 1000)
        empty_checks = 0
        result["emptyOwnedScans"] = []
        while (child is not None or result.get("subreaper")) and time.monotonic() < cleanup_deadline:
            try:
                if child is not None:
                    child.poll()
                rows, _ = proc_inventory()
                ids = [p for p in owned_set(rows, os.getpid(), child.pid if child else None, known) if p != os.getpid()]
                if not ids:
                    empty_checks += 1
                    result["emptyOwnedScans"].append(dict(elapsedMs=int((time.monotonic()-started)*1000), hostIdentities=len(rows)))
                    if empty_checks >= 2:
                        result["cleanupComplete"] = True
                        break
                    time.sleep(0.05)
                    continue
                empty_checks = 0
                for pid in ids:
                    row = rows[pid]
                    fresh = parse_stat(bounded(Path("/proc") / str(pid) / "stat"), pid)
                    if fresh["startTicks"] != row["startTicks"]:
                        raise RuntimeError("cleanup PID identity changed; not signalled")
                    if fresh["state"] == "Z" and fresh["parent"] == os.getpid() and (child is None or pid != child.pid):
                        os.waitpid(pid, os.WNOHANG)
                    else:
                        os.kill(pid, signal.SIGKILL if time.monotonic() - cleanup_start > 2 else signal.SIGTERM)
                known.update({pid: rows[pid]["startTicks"] for pid in ids})
            except OSError as error:
                if error.errno not in (errno.ENOENT, errno.ESRCH, errno.ECHILD):
                    fail(error)
            except Exception as error:
                fail(error)
                # On incomplete telemetry, only the directly owned Popen PID
                # can be signalled safely; no shared/guessed group is killed.
                if child is not None and child.poll() is None:
                    child.kill()
            time.sleep(0.05)
        if child is None and not result.get("subreaper"):
            result["cleanupComplete"] = True
        if child is not None:
            result["child"]["code"] = child.poll()
        if not result["cleanupComplete"]:
            fail("owned process cleanup incomplete")
        selector.close()
        for handle in logs.values():
            handle.close()
        result.pop("known", None)
        result["elapsedMs"] = int((time.monotonic() - started) * 1000)
        if result["elapsedMs"] > CAPS["totalMs"]:
            fail("total120s window exceeded")
        result["measurementLimits"] = "Sampled smaps RSS, not hard cgroup enforcement; non-atomic /proc scans; no macOS pressure equivalence. No PASS if telemetry or cleanup is incomplete."
        with open(receipt, "x", encoding="utf8") as handle:
            json.dump(result, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        print(json.dumps({k: result[k] for k in ("firstCause", "child", "cleanupComplete", "elapsedMs")}), flush=True)
    return 1 if result["firstCause"] else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--case-n", type=int, choices=(1, 16), default=1, help="explicit Root-scheduled case only; does not grant execution or expand budgets")
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps(dict(status="prepared_only_no_Go_or_probe_started", supported=sys.platform == "linux", caps=CAPS,
                              requires="Linux readable /proc + smaps_rollup, subreaper, exact prepared source, fresh Root isolated CI grant; not a macOS native-guard replacement")))
    elif not args.prepared or not args.receipt:
        parser.error("--prepared and a new --receipt outside case are required")
    else:
        sys.exit(run(args.prepared.resolve(), args.receipt.resolve(), case_n=args.case_n))
