#!/usr/bin/env python3
"""Opt-in Linux validation of one captured private COPY; never a deployment.

The default performs no I/O against the copy and starts no child. Execution
requires a separately granted Root window and externally pinned capture, CI
SOURCE manifest and full commit. This does not grant that window itself.
"""
import argparse
import ctypes
import errno
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

GUARD_SHA256 = "5601bf3eaab58b5986a9ce859a77563956e148989f61134027799bf7ff481a16"
TOOL_COMMIT = "af1cbaf94313e628e212aabad60d05d85c2aa3fc"
# The exact 940-byte capture manifest supplies the full gzip/raw pins and marker.
# It is independently pinned by the caller as well; sourcePath/archivePath inside
# it are descriptive evidence and are NEVER used as filesystem input paths.
CAPTURE_SHA256 = "fd62921bb90a4565fab3a34af39daacd73698fd597daa759129b0bdcbdbbcef5"
TOOLS_ARCHIVE_SHA256 = "7d05d35e49cffb681a4f3f5ec52582c7450b5d6209cdbbdffd479c4d52930ed1"
TOOLS_ARCHIVE_BYTES = 17650233
# A separate profile reads the exact retained r2 migration, never the original
# case or a newly exported replacement. These pins do not authorize execution;
# the external SOURCE hash and a fresh Root window remain mandatory.
EXECUTION_TOOL_COMMIT = "ca803206b57e03d7d35f72ac027784466447d785"
EXECUTION_SOURCE_SHA256 = "1e9f3767c902dd6c98716229903823d90e1f4e861b1d03a08e2b64b523500b34"
EXECUTION_TOOLS_ARCHIVE_SHA256 = "41fe2ae45b5fec20183a519865407ec8fb79133ad5bce60019f09a3310b864d2"
EXECUTION_TOOLS_ARCHIVE_BYTES = 17791219
EXECUTION_MIGRATION_SHA256 = "72606eb9ad4187117f47b14f8745caaed81bd347011b6c5f8bb0b62c1ee84028"
EXECUTION_MIGRATION_BYTES = 683131154
LIMITS = dict(activeMs=120000, cleanupMs=15000, totalMs=135000,
              rssBytes=4 << 30, privateBytes=8 << 30, logBytes=1 << 20,
              threads=320, processes=16, diskFloorBytes=2 << 30,
              memoryFloorBytes=4 << 30, sampleMs=200)
TOOL_NAMES = ("ynx-chaind", "ynx-consensus-package")
INITIAL_FILES = {"capture.json", "devnet-state.json.gz", "tools.zip", "tools"}
EXECUTION_INITIAL_FILES = {"capture.json", "migration.json", "tools.zip", "tools"}
ENVIRONMENT = dict(GOMAXPROCS="1", GOGC="50", GOMEMLIMIT="3GiB",
                   GOTOOLCHAIN="local", GOWORK="off", TZ="UTC", LANG="C")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError("duplicate metadata field")
        result[key] = value
    return result


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_mode, info.st_nlink, info.st_uid)


def regular(path, executable=False):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_uid != os.getuid() or info.st_mode & 0o077
            or executable and info.st_mode & 0o500 != 0o500):
        raise RuntimeError("private regular owned input required")
    return info


def private_directory(path):
    if not path.is_absolute() or path.resolve() != path:
        raise RuntimeError("absolute non-aliased private directory required")
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
        raise RuntimeError("owned 0700 private directory required")


def read_file(path, limit=None, progress=lambda: None):
    """Hash through one no-follow FD; optionally retain only bounded metadata."""
    before = regular(path)
    digest, data, count = hashlib.sha256(), bytearray(), 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("input changed during open")
        while True:
            block = source.read(65536)
            if not block:
                break
            count += len(block)
            if limit is not None:
                if count > limit:
                    raise RuntimeError("metadata bound exceeded")
                data.extend(block)
            digest.update(block)
            progress()
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("input changed during read")
    if identity(regular(path)) != identity(before) or count != before.st_size:
        raise RuntimeError("input replaced or resized")
    return dict(sha256=digest.hexdigest(), bytes=count, identity=identity(before)), bytes(data)


def load_guard(path):
    # Public frozen source need not have private-case file modes. Refuse links
    # and verify the complete source before importing definitions (no run call).
    if path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode):
        raise RuntimeError("frozen guard must be a regular non-aliased file")
    with path.open("rb") as source:
        raw = source.read((1 << 20)+1)
    if len(raw) > 1 << 20 or hashlib.sha256(raw).hexdigest() != GUARD_SHA256:
        raise RuntimeError("frozen identity guard SHA mismatch")
    spec = importlib.util.spec_from_file_location("private_copy_pinned_guard", path)
    module = importlib.util.module_from_spec(spec)
    # Execute the already authenticated bytes, not a second racy path read.
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def checked_json(path, expected, progress):
    record, raw = read_file(path, 1 << 20, progress)
    if not re.fullmatch(r"[0-9a-f]{64}", expected or "") or record["sha256"] != expected:
        raise RuntimeError("external metadata SHA mismatch")
    return record, json.loads(raw, object_pairs_hook=unique_object)


def validate_inputs(case, expected_capture, expected_source, expected_commit, progress=lambda: None,
                    *, verify_migration_execution=False, expected_migration=None):
    private_directory(case)
    initial_files = EXECUTION_INITIAL_FILES if verify_migration_execution else INITIAL_FILES
    if {p.name for p in case.iterdir()} != initial_files:
        if verify_migration_execution:
            raise RuntimeError("fresh execution case must contain only retained migration, capture metadata, pinned tools.zip and tools; preserve UNKNOWN")
        raise RuntimeError("fresh case must contain only captured gzip, capture metadata, original tools.zip and tools; preserve UNKNOWN")
    tools = case / "tools"
    private_directory(tools)
    if {p.name for p in tools.iterdir()} != {"SOURCE.json", *TOOL_NAMES}:
        raise RuntimeError("unexpected tool directory entries")
    tool_commit = EXECUTION_TOOL_COMMIT if verify_migration_execution else TOOL_COMMIT
    if expected_commit != tool_commit or expected_capture != CAPTURE_SHA256:
        raise RuntimeError("this profile requires the approved read-only integration build and captured copy")
    if verify_migration_execution:
        if expected_migration != EXECUTION_MIGRATION_SHA256:
            raise RuntimeError("execution profile requires the exact external retained migration SHA")
        if expected_source != EXECUTION_SOURCE_SHA256:
            raise RuntimeError("execution profile requires the exact external CI SOURCE SHA")
    elif expected_migration is not None:
        raise RuntimeError("migration input pin requires the execution compatibility profile")
    capture_pin, capture = checked_json(case / "capture.json", expected_capture, progress)
    if (capture.get("format") != "YNX-PRIVATE-CHECKPOINT-CAPTURE/v1"
            or any(capture.get(k) is not True for k in ("complete", "sourceDescriptorUnchanged", "localGzipVerified"))
            or any(capture.get(k) is not False for k in ("serviceChanged", "sourceWritten", "migrationExecutionVerified"))
            or capture.get("integrityMarker") != "2\n"
            or any(type(capture.get(k)) is not int or not 0 < capture[k] <= LIMITS["privateBytes"] for k in ("sourceBytes", "archiveBytes"))
            or any(not isinstance(capture.get(k), str) or re.fullmatch(r"[0-9a-f]{64}", capture[k]) is None for k in ("sourceSHA256", "archiveSHA256"))
            or capture.get("localDecompressedSHA256") != capture["sourceSHA256"]):
        raise RuntimeError("incomplete or inconsistent original capture metadata")
    source_pin, source = checked_json(tools / "SOURCE.json", expected_source, progress)
    if (source.get("version") != "YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1"
            or source.get("commit") != expected_commit or source.get("platform") != "linux/amd64"
            or not isinstance(source.get("runId"), str) or not source["runId"].isdecimal()
            or set(source.get("binaries", {})) != set(TOOL_NAMES)):
        raise RuntimeError("CI tools do not match the externally pinned read-only source")
    pins = {"capture.json":capture_pin, "tools/SOURCE.json":source_pin}
    tool_archive, _ = read_file(case / "tools.zip", progress=progress)
    archive_sha = EXECUTION_TOOLS_ARCHIVE_SHA256 if verify_migration_execution else TOOLS_ARCHIVE_SHA256
    archive_bytes = EXECUTION_TOOLS_ARCHIVE_BYTES if verify_migration_execution else TOOLS_ARCHIVE_BYTES
    if tool_archive["sha256"] != archive_sha or tool_archive["bytes"] != archive_bytes:
        raise RuntimeError("original CI tools archive SHA or size mismatch")
    pins["tools.zip"] = tool_archive
    if verify_migration_execution:
        migration, _ = read_file(case / "migration.json", progress=progress)
        if migration["sha256"] != expected_migration or migration["bytes"] != EXECUTION_MIGRATION_BYTES:
            raise RuntimeError("retained migration SHA or size mismatch")
        pins["migration.json"] = migration
    else:
        archive, _ = read_file(case / "devnet-state.json.gz", progress=progress)
        if archive["sha256"] != capture["archiveSHA256"] or archive["bytes"] != capture["archiveBytes"]:
            raise RuntimeError("captured gzip identity mismatch")
        pins["devnet-state.json.gz"] = archive
    for name in TOOL_NAMES:
        path = tools / name
        regular(path, executable=True)
        pin, _ = read_file(path, progress=progress)
        if source["binaries"][name] != {"sha256":pin["sha256"], "bytes":pin["bytes"]}:
            raise RuntimeError("CI binary SHA or size differs from pinned SOURCE")
        with path.open("rb") as binary:
            header = binary.read(20)
        if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
            raise RuntimeError("only precompiled Linux amd64 ELF tools are permitted")
        pins["tools/" + name] = pin
    return capture, pins


def exclusive(path, payload):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as target:
        target.write(payload)
        target.flush()
        os.fsync(target.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def restore_copy(case, capture, progress=lambda: None):
    state = case / "state"
    state.mkdir(mode=0o700)  # no exist_ok; interrupted copies remain UNKNOWN
    archive = case / "devnet-state.json.gz"
    before = regular(archive)
    raw = state / "devnet-state.json"
    fd = os.open(raw, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    source_fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    digest, count = hashlib.sha256(), 0
    with os.fdopen(fd, "wb") as target, os.fdopen(source_fd, "rb") as source:
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("gzip identity changed before restoration")
        with gzip.GzipFile(fileobj=source, mode="rb") as compressed:
            while True:
                block = compressed.read(65536)
                if not block:
                    break
                count += len(block)
                if count > capture["sourceBytes"]:
                    raise RuntimeError("decompressed size exceeds captured raw bound")
                target.write(block)
                digest.update(block)
                progress()
        target.flush()
        os.fsync(target.fileno())
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("gzip changed during restoration")
    if identity(regular(archive)) != identity(before) or count != capture["sourceBytes"] or digest.hexdigest() != capture["sourceSHA256"]:
        raise RuntimeError("decompressed original identity mismatch")
    exclusive(state / "devnet-state.integrity-version", capture["integrityMarker"].encode("ascii"))
    sync_directory(state)
    return {name:read_file(state/name, progress=progress)[0] for name in ("devnet-state.json", "devnet-state.integrity-version")}


def fixed_commands(case, verify_migration_execution=False):
    if verify_migration_execution:
        return [[str(case/"tools/ynx-consensus-package"), "-verify-migration-execution", str(case/"migration.json")]]
    return [
        [str(case/"tools/ynx-chaind"), "-data-dir", str(case/"state"), "-export-consensus-state", str(case/"migration.json")],
        [str(case/"tools/ynx-consensus-package"), "-verify-migration-state", str(case/"migration.json")],
    ]


def enforce(sample):
    for name in ("rssBytes", "privateBytes", "threads", "processes"):
        if type(sample.get(name)) is not int or not 0 <= sample[name] <= LIMITS[name]:
            raise RuntimeError("private-copy resource cap: " + name)
    if sample["freeDiskBytes"] < LIMITS["diskFloorBytes"] or sample["availableMemoryBytes"] < LIMITS["memoryFloorBytes"]:
        raise RuntimeError("private-copy fresh disk/memory floor failed")


def cleanup_scan(guard, launcher, child, known, kill, send=None, wait=None):
    """Original guard cleanup identity algorithm; never signal guessed PGIDs."""
    # Resolve at the actual call boundary so a caller/test fence cannot be
    # bypassed by a system function captured earlier during module import.
    send = os.kill if send is None else send
    wait = os.waitpid if wait is None else wait
    if child is not None:
        child.poll()
    rows, _ = guard.proc_inventory()
    ids = [p for p in guard.owned_set(rows, launcher, child.pid if child else None, known) if p != launcher]
    for pid in ids:
        row = rows[pid]
        fresh = guard.parse_stat(guard.bounded(Path("/proc")/str(pid)/"stat"), pid)
        if fresh["startTicks"] != row["startTicks"]:
            raise RuntimeError("cleanup PID identity changed; not signalled")
        if fresh["state"] == "Z" and fresh["parent"] == launcher and (child is None or pid != child.pid):
            wait(pid, os.WNOHANG)
        else:
            send(pid, signal.SIGKILL if kill else signal.SIGTERM)
    known.update({pid:rows[pid]["startTicks"] for pid in ids})
    return not ids


def sample_owned_task(guard, before, active_deadline):
    """Resolve only a bounded procfs exit race; never substitute live RSS.

    Linux can drop a task's mm before /proc/<pid>/stat reports Z. In that
    interval smaps_rollup may return ESRCH/ENOENT while the same task still
    reports R. Recheck at most three times, within the original active budget.
    A live result still needs real RSS; retirement needs a missing stat or the
    same startTicks in Z. Output text and Popen return codes prove neither.
    """
    pid = before["pid"]
    observed = before
    for attempt in range(4):
        if time.monotonic() >= active_deadline:
            raise RuntimeError("private-copy active deadline")
        try:
            raw = guard.bounded(Path("/proc")/str(pid)/"smaps_rollup") if observed["state"] != "Z" else None
            after = guard.parse_stat(guard.bounded(Path("/proc")/str(pid)/"stat"), pid)
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH):
                raise
            try:
                current = guard.parse_stat(guard.bounded(Path("/proc")/str(pid)/"stat"), pid)
            except OSError as absent:
                if absent.errno in (errno.ENOENT, errno.ESRCH):
                    return None  # Stat proves gone, not an unreadable live row.
                raise
            if current["startTicks"] != before["startTicks"]:
                raise RuntimeError("active owned RSS unreadable")
            if current["state"] == "Z":
                after, raw = current, None
            else:
                if attempt == 3:
                    raise RuntimeError("active owned RSS unreadable")
                remaining = active_deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("private-copy active deadline")
                # This is at most 30ms of the existing active window, not a
                # deadline extension or a new grace/cleanup budget.
                time.sleep(min(0.01, remaining))
                observed = current
                continue
        if after["startTicks"] != before["startTicks"] or raw is None and after["state"] != "Z":
            raise RuntimeError("owned task identity/telemetry changed")
        return dict(after, rssBytes=guard.smaps_rss(raw) if raw is not None else 0)


class Window:
    def __init__(self, guard, case):
        self.guard, self.case, self.started = guard, case, time.monotonic()
        self.child, self.birth, self.known = None, None, {}
        self.samples, self.next_sample, self.log_bytes = [], 0, 0
        self.subreaper = False
        self.command_label, self.telemetry_failure = None, None

    def tick(self, force=False):
        elapsed = time.monotonic() - self.started
        if elapsed * 1000 >= LIMITS["activeMs"]:
            raise RuntimeError("private-copy active deadline")
        if not force and time.monotonic() < self.next_sample:
            return
        g = self.guard
        rows, _ = g.proc_inventory()
        running = self.child is not None and self.child.poll() is None
        ids = g.owned_set(rows, os.getpid(), self.child.pid if self.child else None, self.known, running, self.birth)
        tasks = []
        for pid in ids:
            try:
                task = sample_owned_task(g, rows[pid], self.started + LIMITS["activeMs"]/1000)
            except Exception:
                if self.telemetry_failure is None:
                    # Public process identity only; no private paths, command
                    # arguments, copied state or tool stdout enters the receipt.
                    self.telemetry_failure = dict(command=self.command_label, pid=pid, startTicks=rows[pid]["startTicks"])
                raise
            if task is not None:
                tasks.append(task)
        self.known = {p["pid"]:p["startTicks"] for p in tasks if p["pid"] != os.getpid()}
        free = os.statvfs(self.case)
        sample = dict(elapsedMs=int(elapsed*1000), rssBytes=sum(p["rssBytes"] for p in tasks),
                      threads=sum(p["threads"] for p in tasks), processes=len(tasks),
                      privateBytes=g.directory_bytes(self.case), freeDiskBytes=free.f_bavail*free.f_frsize,
                      availableMemoryBytes=g.memory_available(), tasks=tasks)
        self.samples.append(sample)
        enforce(sample)
        self.next_sample = time.monotonic() + LIMITS["sampleMs"]/1000

    def start(self):
        mounts = [line.split() for line in self.guard.bounded(Path("/proc/mounts"), 1 << 20).splitlines()]
        proc = [r for r in mounts if len(r) >= 4 and r[1:3] == [b"/proc", b"proc"]]
        if len(proc) != 1 or any(x.startswith(b"hidepid=") and x != b"hidepid=0" for x in proc[0][3].split(b",")):
            raise RuntimeError("complete readable procfs required")
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        current = ctypes.c_int(0)
        if libc.prctl(36, 1, 0, 0, 0) != 0 or libc.prctl(37, ctypes.cast(ctypes.pointer(current), ctypes.c_void_p).value, 0, 0, 0) != 0 or current.value != 1:
            raise RuntimeError("private child subreaper unavailable")
        self.subreaper = True
        allowed = os.sched_getaffinity(0)
        if not allowed:
            raise RuntimeError("CPU affinity unavailable")
        selected = {min(allowed)}
        os.sched_setaffinity(0, selected)
        if os.sched_getaffinity(0) != selected:
            raise RuntimeError("single-CPU affinity was not applied")
        self.tick(True)

    def command(self, command, label, binary_pin):
        selector = selectors.DefaultSelector()
        streams = {}
        executable_fd = None
        try:
            for stream in ("stdout", "stderr"):
                fd = os.open(self.case/(label+"."+stream+".log"), os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
                streams[stream] = os.fdopen(fd, "wb", buffering=0)
            # Deliberately no inherited YNX config, PATH, auth files, proxy or
            # service environment. Only fixed precompiled absolute ELF commands.
            env = dict(ENVIRONMENT, HOME=str(self.case/"tmp"), TMPDIR=str(self.case/"tmp"))
            self.tick(True)
            executable_fd = os.open(command[0], os.O_RDONLY|os.O_NOFOLLOW)
            if identity(os.fstat(executable_fd)) != binary_pin["identity"]:
                raise RuntimeError("pinned executable changed before start")
            self.child = subprocess.Popen(command, cwd=self.case, env=env, stdin=subprocess.DEVNULL,
                                          executable="/proc/self/fd/"+str(executable_fd), pass_fds=(executable_fd,),
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            self.command_label = label
            birth = self.guard.parse_stat(self.guard.bounded(Path("/proc")/str(self.child.pid)/"stat"), self.child.pid)
            if birth["parent"] != os.getpid():
                raise RuntimeError("command root was not born as this wrapper's child")
            self.birth = birth["startTicks"]
            for name, stream in (("stdout", self.child.stdout), ("stderr", self.child.stderr)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while True:
                self.tick()
                for key, _ in selector.select(0.05):
                    block = os.read(key.fileobj.fileno(), 65536)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    self.log_bytes += len(block)
                    if self.log_bytes > LIMITS["logBytes"]:
                        raise RuntimeError("combined private tool log bound exceeded")
                    streams[key.data].write(block)
                if self.child.poll() is not None and not selector.get_map():
                    break
            self.tick(True)
            if self.child.returncode != 0:
                raise RuntimeError(label+" terminal code "+str(self.child.returncode))
            return self.child.returncode
        finally:
            selector.close()
            for stream in streams.values():
                stream.close()
            if executable_fd is not None:
                os.close(executable_fd)

    def cleanup(self):
        started = time.monotonic()
        deadline = min(started+LIMITS["cleanupMs"]/1000, self.started+LIMITS["totalMs"]/1000)
        scans, first_error = 0, None
        while time.monotonic() < deadline:
            try:
                empty = cleanup_scan(self.guard, os.getpid(), self.child, self.known, time.monotonic()-started > 2)
                scans = scans+1 if empty else 0
                if scans >= 2:
                    return first_error is None, first_error
            except OSError as error:
                if error.errno not in (errno.ENOENT, errno.ESRCH, errno.ECHILD):
                    first_error = first_error or "cleanup telemetry error"
            except Exception:
                first_error = first_error or "cleanup identity/telemetry incomplete"
                if self.child is not None and self.child.poll() is None:
                    self.child.kill()  # only directly owned, unreaped Popen PID
            time.sleep(0.05)
        return False, first_error or "owned process cleanup incomplete"


def unchanged(case, pins, progress):
    for relative, original in pins.items():
        current, _ = read_file(case/relative, progress=progress)
        if current != original:
            raise RuntimeError("original private input changed")


def qualify(codes, output, verify_migration_execution=False):
    if verify_migration_execution:
        if codes != [0] or re.fullmatch(rb"consensus migration execution passed: height=[0-9]+ lastBlockHash=(?:0x)?[0-9a-fA-F]{64} stateHash=[0-9a-f]{64} blockers=0 scope=executor-compatibility-only validatorBinding=unchecked applicationRestore=unchecked deployment=not-performed initChain=not-performed pqActivation=not-performed\n", output) is None:
            raise RuntimeError("actual canonical migration execution compatibility completion missing")
        return
    if codes != [0, 0] or re.fullmatch(rb"consensus migration state passed: height=[0-9]+ lastBlockHash=(?:0x)?[0-9a-fA-F]{64} stateHash=[0-9a-f]{64} accounts=[1-9][0-9]* validators=[1-9][0-9]*\n", output) is None:
        raise RuntimeError("actual canonical migration verification completion missing")


def run(args):
    if sys.platform != "linux" or os.uname().machine != "x86_64":
        raise RuntimeError("only the separately granted Linux amd64 window is supported")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}", args.authorization_id or "") is None:
        raise RuntimeError("external Root authorization reference required")
    execution = args.verify_migration_execution
    guard = load_guard(args.guard)
    private_directory(args.case)
    receipt = args.case/"validation-receipt.json"
    if receipt.exists() or receipt.is_symlink():
        raise RuntimeError("preserve existing result or UNKNOWN")
    window = Window(guard, args.case)
    result = dict(version="YNX-PRIVATE-CONSENSUS-COPY-VALIDATION/v1", authorization=args.authorization_id,
                  sourceCommit=args.expected_commit, sourceManifestSHA256=args.expected_source_sha256,
                  captureSHA256=args.expected_capture_sha256, guardSHA256=GUARD_SHA256,
                  toolsArchiveSHA256=EXECUTION_TOOLS_ARCHIVE_SHA256 if execution else TOOLS_ARCHIVE_SHA256,
                  toolsArchiveBytes=EXECUTION_TOOLS_ARCHIVE_BYTES if execution else TOOLS_ARCHIVE_BYTES,
                  limits=LIMITS, status="unknown", firstCause=None, cleanupComplete=False,
                  scope="private copied-state semantic validation only; not deployed or activated")
    if execution:
        result.update(profile="verify-migration-execution", expectedMigrationSHA256=args.expected_migration_sha256,
                      scope="retained migration executor compatibility only; not validator binding, application restore, deployment, InitChain or PQ activation")
    def interrupted(signum, _frame):
        raise RuntimeError("private wrapper interrupted by signal "+str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        window.start()
        capture, pins = validate_inputs(args.case, args.expected_capture_sha256, args.expected_source_sha256,
                                       args.expected_commit, window.tick, verify_migration_execution=execution,
                                       expected_migration=args.expected_migration_sha256)
        source_pins = {}
        if not execution:
            source_pins = restore_copy(args.case, capture, window.tick)
            pins.update({"state/"+name:pin for name, pin in source_pins.items()})
        (args.case/"tmp").mkdir(mode=0o700)
        sync_directory(args.case)
        result["terminalCodes"] = []
        labels = ("verify-execution",) if execution else ("export", "verify")
        for command, label in zip(fixed_commands(args.case, execution), labels):
            unchanged(args.case, pins, window.tick)
            result["terminalCodes"].append(window.command(command, label, pins["tools/"+Path(command[0]).name]))
            unchanged(args.case, pins, window.tick)
            if label == "export":
                migration_pin, _ = read_file(args.case/"migration.json", progress=window.tick)
                if migration_pin["bytes"] == 0:
                    raise RuntimeError("empty migration output")
                pins["migration.json"] = migration_pin
        # Exact real verifier completion; a code-zero no-op or leftover output
        # cannot qualify. Full migration validation is performed by the tool.
        output = guard.bounded(args.case/(labels[-1]+".stdout.log"), LIMITS["logBytes"])
        qualify(result["terminalCodes"], output, execution)
        migration_pin, _ = read_file(args.case/"migration.json", progress=window.tick)
        if migration_pin["bytes"] == 0:
            raise RuntimeError("empty migration output")
        if execution and migration_pin != pins["migration.json"]:
            raise RuntimeError("original private input changed")
        if not execution and {p.name for p in (args.case/"state").iterdir()} != set(source_pins):
            raise RuntimeError("unexpected source state artifact; preserve UNKNOWN")
        expected_files = (EXECUTION_INITIAL_FILES | {"tmp", "verify-execution.stdout.log", "verify-execution.stderr.log"}
                          if execution else INITIAL_FILES | {"state", "tmp", "migration.json", "export.stdout.log", "export.stderr.log", "verify.stdout.log", "verify.stderr.log"})
        if ({p.name for p in args.case.iterdir()} != expected_files
                or {p.name for p in (args.case/"tools").iterdir()} != {"SOURCE.json", *TOOL_NAMES}
                or any((args.case/"tmp").iterdir())):
            raise RuntimeError("unexpected private result artifact; preserve UNKNOWN")
        result.update(migrationSHA256=migration_pin["sha256"], migrationBytes=migration_pin["bytes"])
        if execution:
            result.update(migrationInputUnchanged=True, executorCompatibilityVerified=True,
                          validatorBinding="unchecked", applicationRestore="unchecked", deployment="not-performed",
                          initChain="not-performed", pqActivation="not-performed", status="validated_migration_execution")
        else:
            result.update(sourceCopyUnchanged=True, originalMarkerPreserved=True, status="validated_private_copy")
    except Exception as error:
        # Never echo private tool logs, paths, account contents or raw state.
        result["firstCause"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        if window.subreaper:
            result["cleanupComplete"], cleanup_error = window.cleanup()
        else:
            result["cleanupComplete"], cleanup_error = True, None
        result["firstCause"] = result["firstCause"] or cleanup_error
        result["elapsedMs"] = int((time.monotonic()-window.started)*1000)
        if result["elapsedMs"] > LIMITS["totalMs"]:
            result["firstCause"] = result["firstCause"] or "total private window exceeded"
        if result["firstCause"] or not result["cleanupComplete"]:
            result["status"] = "unknown"
        result["samples"] = window.samples
        if window.telemetry_failure is not None:
            result["telemetryFailure"] = window.telemetry_failure
        result["measurementLimits"] = "Sampled /proc+smaps RSS, not a hard cgroup ceiling; TERM then KILL after 2s is not a 15s graceful-stop guarantee. All private artifacts retained."
        exclusive(receipt, (json.dumps(result, sort_keys=True)+"\n").encode())
        sync_directory(args.case)
        print(json.dumps({k:result[k] for k in ("status", "cleanupComplete", "elapsedMs")}))
    return 0 if result["status"] == ("validated_migration_execution" if execution else "validated_private_copy") else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--verify-migration-execution", action="store_true",
                        help="check only the fixed retained migration in a new case; never export or restore an Application")
    parser.add_argument("--case", type=Path)
    parser.add_argument("--guard", type=Path)
    parser.add_argument("--expected-capture-sha256")
    parser.add_argument("--expected-source-sha256")
    parser.add_argument("--expected-commit")
    parser.add_argument("--expected-migration-sha256")
    parser.add_argument("--authorization-id")
    args = parser.parse_args(argv)
    if args.expected_migration_sha256 is not None and not args.verify_migration_execution:
        parser.error("--expected-migration-sha256 requires --verify-migration-execution")
    if not args.execute:
        prepared = dict(status="prepared_only_no_copy_or_process_started",
                        toolCommit=EXECUTION_TOOL_COMMIT if args.verify_migration_execution else TOOL_COMMIT,
                        guardSHA256=GUARD_SHA256, limits=LIMITS,
                        requires="fresh external Root/central Linux execution grant and exact CI SOURCE SHA")
        if args.verify_migration_execution:
            prepared.update(profile="verify-migration-execution", migrationSHA256=EXECUTION_MIGRATION_SHA256,
                            migrationBytes=EXECUTION_MIGRATION_BYTES,
                            sourceManifestSHA256=EXECUTION_SOURCE_SHA256,
                            scope="executor-compatibility-only; applicationRestore=unchecked")
        print(json.dumps(prepared))
        return 0
    if any(getattr(args, k) is None for k in ("case", "guard", "expected_capture_sha256", "expected_source_sha256", "expected_commit", "authorization_id")):
        parser.error("execute requires new private case, frozen guard and all external pins/authorization")
    if args.verify_migration_execution and args.expected_migration_sha256 != EXECUTION_MIGRATION_SHA256:
        parser.error("execution profile requires the exact external retained migration SHA")
    try:
        return run(args)
    except Exception as error:
        print(json.dumps(dict(status="refused_before_execution", reason=str(error) if isinstance(error, RuntimeError) else type(error).__name__)))
        return 1


if __name__ == "__main__":
    sys.exit(main())
