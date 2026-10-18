#!/usr/bin/env python3
"""Explicit Linux normal-signer process window; default is inert preparation.

This profile executes a precompiled test and the pinned normal signer command.
It never deploys a public validator, builds a binary, creates a key subprocess,
or runs the old paired/E2E guard. Private case data is never removed or printed.
"""
import argparse
import ctypes
import errno
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

PROFILE = "remote-signer-process-v1"
GUARD_SHA256 = "95d283c7fd0983381325e85cb9364cb4d77bcfefeaf3d2cc78a36b9a5e4a15d1"
TEST = "TestPQRemoteSignerNormalProcessColdRecoveryAndUnknown"
SOURCE_LEAF = "internal/consensus/pq_remote_process_test.go"
SOURCE_SHA256 = "01663b399daf0c7c70faab41e629a85d2538ea4bb9bb395fe724ec2ccf06948d"
TEST_BINARY = "consensus.test"
DAEMON_BINARY = "ynx-consensus-pq-remote-signer"
BUILD_FILES = {"SOURCE.json", "pq_remote_process_test.go", TEST_BINARY, DAEMON_BINARY}
LIMITS = dict(activeMs=75000, cleanupMs=15000, totalMs=90000,
              rssBytes=512 << 20, privateBytes=32 << 20, logBytes=1 << 20,
              buildBytes=1 << 30, processes=3, threads=160,
              diskFloorBytes=2 << 30, memoryFloorBytes=1 << 30, sampleMs=100)
ENVIRONMENT = dict(GOMAXPROCS="2", GOGC="50", GOMEMLIMIT="256MiB",
                   GOTOOLCHAIN="local", GOWORK="off", LANG="C", TZ="UTC",
                   YNX_PQ_REMOTE_PROCESS="authorized-signer-process-window")
CHECKPOINT_LAYOUTS = ("atomic-json", "snapshot-journal", "block-journal")


def checkpoint_layout(value):
    if type(value) is not str or value not in CHECKPOINT_LAYOUTS:
        raise RuntimeError("explicit supported remote checkpoint layout required")
    return value


def checkpoint_layout_marker(layout):
    return ("checkpointLayout="+checkpoint_layout(layout)+
            " normalCLI=true originalSourceUnchanged=true coldOriginalHRS=true unknownNoRetry=true")


def process_environment(case, build, pins, layout):
    return dict(ENVIRONMENT, HOME=str(case/"tmp"), TMPDIR=str(case/"tmp"),
                YNX_PQ_REMOTE_SIGNER_BINARY=str(build/DAEMON_BINARY),
                YNX_PQ_REMOTE_SIGNER_SHA256=pins[DAEMON_BINARY]["sha256"],
                YNX_PQ_REMOTE_PROCESS_LAYOUT=checkpoint_layout(layout))


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise RuntimeError("duplicate build metadata field")
        out[key] = value
    return out


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_mode, info.st_nlink, info.st_uid)


def private_directory(path):
    if not path.is_absolute() or path.resolve() != path:
        raise RuntimeError("canonical absolute private directory required")
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
        raise RuntimeError("owned 0700 directory required")


def regular(path, executable=False):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_uid != os.getuid() or info.st_mode & 0o077
            or executable and info.st_mode & 0o500 != 0o500):
        raise RuntimeError("owned single-link private regular input required")
    return info


def read_file(path, limit, retain=False, progress=lambda: None, executable=False):
    before = regular(path, executable)
    if before.st_size > limit:
        raise RuntimeError("pinned file exceeds fixed size bound")
    digest, data, count = hashlib.sha256(), bytearray(), 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("pinned input changed during open")
        while True:
            block = source.read(65536)
            if not block:
                break
            count += len(block)
            if count > limit:
                raise RuntimeError("pinned input grew beyond bound")
            digest.update(block)
            if retain:
                data.extend(block)
            progress()
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("pinned input changed during read")
    if identity(regular(path, executable)) != identity(before) or count != before.st_size:
        raise RuntimeError("pinned input replaced or resized")
    return dict(sha256=digest.hexdigest(), bytes=count, identity=identity(before)), bytes(data)


def load_guard(path):
    if not path.is_absolute() or path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode):
        raise RuntimeError("canonical frozen guard source required")
    with path.open("rb") as source:
        raw = source.read((1 << 20) + 1)
    if len(raw) > 1 << 20 or hashlib.sha256(raw).hexdigest() != GUARD_SHA256:
        raise RuntimeError("frozen guard definitions SHA mismatch")
    spec = importlib.util.spec_from_file_location("remote_process_pinned_guard", path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module  # Definitions only; never module.run(), enforce(), or CAPS mutation.


def validate_inputs(args, progress=lambda: None):
    checkpoint_layout(args.checkpoint_layout)
    private_directory(args.case)
    private_directory(args.build)
    if args.case == args.build or args.case in args.build.parents or args.build in args.case.parents:
        raise RuntimeError("private case and read-only build must be separate nonnested directories")
    if any(args.case.iterdir()):
        raise RuntimeError("fresh empty case required; preserve prior result or UNKNOWN")
    if {p.name for p in args.build.iterdir()} != BUILD_FILES:
        raise RuntimeError("read-only build must contain exactly manifest, frozen test leaf and two binaries")
    if re.fullmatch(r"[0-9a-f]{40}", args.expected_commit or "") is None:
        raise RuntimeError("external full commit pin required")
    for value in (args.expected_manifest_sha256, args.expected_test_sha256, args.expected_daemon_sha256):
        if re.fullmatch(r"[0-9a-f]{64}", value or "") is None:
            raise RuntimeError("external manifest and dual binary SHA256 pins required")
    manifest_pin, raw = read_file(args.build/"SOURCE.json", 65536, True, progress)
    if manifest_pin["sha256"] != args.expected_manifest_sha256:
        raise RuntimeError("external build manifest SHA mismatch")
    source = json.loads(raw, object_pairs_hook=unique_object)
    if (not isinstance(source, dict)
            or set(source) != {"version", "commit", "platform", "sourceLeaves", "binaries"}
            or source["version"] != "YNX-PQ-REMOTE-SIGNER-PROCESS-BUILD/v1"
            or source["commit"] != args.expected_commit or source["platform"] != "linux/amd64"
            or source["sourceLeaves"] != {SOURCE_LEAF: SOURCE_SHA256}
            or not isinstance(source["binaries"], dict)
            or set(source["binaries"]) != {TEST_BINARY, DAEMON_BINARY}):
        raise RuntimeError("build metadata differs from fixed profile/source/full commit")
    pins = {"SOURCE.json": manifest_pin}
    leaf, _ = read_file(args.build/"pq_remote_process_test.go", 128 << 10, progress=progress)
    if leaf["sha256"] != SOURCE_SHA256:
        raise RuntimeError("actual operational test source leaf differs from fixed SHA")
    pins["pq_remote_process_test.go"] = leaf
    for name, expected in ((TEST_BINARY, args.expected_test_sha256), (DAEMON_BINARY, args.expected_daemon_sha256)):
        metadata = source["binaries"][name]
        if not isinstance(metadata, dict) or type(metadata.get("bytes")) is not int:
            raise RuntimeError("binary metadata requires exact integer byte count")
        pin, _ = read_file(args.build/name, 256 << 20, progress=progress, executable=True)
        if pin["sha256"] != expected or metadata != {"sha256": pin["sha256"], "bytes": pin["bytes"]}:
            raise RuntimeError("binary differs from independent pin or pinned build metadata")
        fd = os.open(args.build/name, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as binary:
            if identity(os.fstat(binary.fileno())) != pin["identity"]:
                raise RuntimeError("binary identity changed before ELF validation")
            header = binary.read(20)
        if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00" or header[16:18] not in (b"\x02\x00", b"\x03\x00"):
            raise RuntimeError("only precompiled Linux amd64 executable ELF inputs are permitted")
        pins[name] = pin
    if pins[TEST_BINARY]["sha256"] == pins[DAEMON_BINARY]["sha256"]:
        raise RuntimeError("test and normal daemon cannot be the same executable")
    if sum(p["bytes"] for p in pins.values()) > LIMITS["buildBytes"]:
        raise RuntimeError("read-only build size exceeded")
    return pins


def unchanged(build, pins, progress=lambda: None):
    if {p.name for p in build.iterdir()} != BUILD_FILES:
        raise RuntimeError("read-only build entries changed")
    for name, before in pins.items():
        after, _ = read_file(build/name, max(before["bytes"], 1), progress=progress,
                             executable=name in (TEST_BINARY, DAEMON_BINARY))
        if after != before:
            raise RuntimeError("read-only build input changed")


def exclusive(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def enforce(sample):
    for name in ("rssBytes", "privateBytes", "buildBytes", "logBytes", "processes", "threads"):
        if type(sample.get(name)) is not int or not 0 <= sample[name] <= LIMITS[name]:
            raise RuntimeError("remote-process cap exceeded/invalid: " + name)
    for name, floor in (("freeDiskBytes", "diskFloorBytes"), ("availableMemoryBytes", "memoryFloorBytes")):
        if type(sample.get(name)) is not int or sample[name] < LIMITS[floor]:
            raise RuntimeError("remote-process fresh resource floor failed: " + name)


def sample_owned_task(guard, before, active_deadline):
    """Original fixed identity sampler plus the verified bounded EXIT-mm repair."""
    pid, observed = before["pid"], before
    for attempt in range(4):
        if time.monotonic() >= active_deadline:
            raise RuntimeError("remote-process active deadline")
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
                    return None
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
                    raise RuntimeError("remote-process active deadline")
                time.sleep(min(0.01, remaining))
                observed = current
                continue
        if after["startTicks"] != before["startTicks"] or raw is None and after["state"] != "Z":
            raise RuntimeError("owned task identity/telemetry changed")
        return dict(after, rssBytes=guard.smaps_rss(raw) if raw is not None else 0)


def cleanup_scan(guard, launcher, child, known, kill, send=None, wait=None):
    send, wait = os.kill if send is None else send, os.waitpid if wait is None else wait
    if child is not None:
        child.poll()
    rows, _ = guard.proc_inventory()
    ids = [p for p in guard.owned_set(rows, launcher, child.pid if child else None, known) if p != launcher]
    for pid in ids:
        row = rows[pid]
        fresh = guard.parse_stat(guard.bounded(Path("/proc")/str(pid)/"stat"), pid)
        if fresh["startTicks"] != row["startTicks"]:
            raise RuntimeError("cleanup identity changed; no signal sent")
        if fresh["state"] == "Z" and fresh["parent"] == launcher and (child is None or pid != child.pid):
            wait(pid, os.WNOHANG)
        else:
            send(pid, signal.SIGKILL if kill else signal.SIGTERM)
    known.update({pid: rows[pid]["startTicks"] for pid in ids})
    return not ids


class Window:
    def __init__(self, guard, case, build, layout="atomic-json"):
        self.guard, self.case, self.build = guard, case, build
        self.checkpoint_layout = checkpoint_layout(layout)
        self.started, self.next_sample = time.monotonic(), 0
        self.child, self.birth, self.known = None, None, {}
        self.samples, self.empty_scans = [], []
        self.subreaper, self.log_bytes = False, 0
        self.observed_processes, self.output_complete = 0, False
        self.telemetry_failure = None

    def tick(self, force=False):
        now = time.monotonic()
        if (now - self.started) * 1000 >= LIMITS["activeMs"]:
            raise RuntimeError("remote-process active deadline")
        if not force and now < self.next_sample:
            return
        g = self.guard
        rows, _ = g.proc_inventory()
        running = self.child is not None and self.child.poll() is None
        ids = g.owned_set(rows, os.getpid(), self.child.pid if self.child else None, self.known, running, self.birth)
        self.observed_processes = max(self.observed_processes, len(ids))
        if len(ids) > LIMITS["processes"]:
            raise RuntimeError("remote-process cap exceeded/invalid: processes")
        tasks = []
        for pid in ids:
            try:
                task = sample_owned_task(g, rows[pid], self.started + LIMITS["activeMs"]/1000)
            except Exception:
                if self.telemetry_failure is None:
                    self.telemetry_failure = dict(pid=pid, startTicks=rows[pid]["startTicks"])
                raise
            if task is not None:
                tasks.append(task)
        self.known.update({p["pid"]: p["startTicks"] for p in tasks if p["pid"] != os.getpid()})
        disk = os.statvfs(self.case)
        sample = dict(elapsedMs=int((now-self.started)*1000), rssBytes=sum(p["rssBytes"] for p in tasks),
                      threads=sum(p["threads"] for p in tasks), processes=len(tasks),
                      privateBytes=g.directory_bytes(self.case), buildBytes=g.directory_bytes(self.build),
                      logBytes=self.log_bytes, freeDiskBytes=disk.f_bavail*disk.f_frsize,
                      availableMemoryBytes=g.memory_available(), tasks=tasks)
        self.samples.append(sample)
        enforce(sample)
        self.next_sample = time.monotonic() + LIMITS["sampleMs"]/1000

    def start(self):
        rows = [line.split() for line in self.guard.bounded(Path("/proc/mounts"), 1 << 20).splitlines()]
        proc = [r for r in rows if len(r) >= 4 and r[1:3] == [b"/proc", b"proc"]]
        if len(proc) != 1 or any(x.startswith(b"hidepid=") and x != b"hidepid=0" for x in proc[0][3].split(b",")):
            raise RuntimeError("complete visible procfs required")
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        current = ctypes.c_int(0)
        if libc.prctl(36, 1, 0, 0, 0) != 0 or libc.prctl(37, ctypes.cast(ctypes.pointer(current), ctypes.c_void_p).value, 0, 0, 0) != 0 or current.value != 1:
            raise RuntimeError("owned child subreaper unavailable")
        self.subreaper = True
        allowed = sorted(os.sched_getaffinity(0))
        if not allowed:
            raise RuntimeError("CPU affinity unavailable")
        selected = set(allowed[:2])
        os.sched_setaffinity(0, selected)
        if os.sched_getaffinity(0) != selected:
            raise RuntimeError("bounded CPU affinity was not applied")
        self.tick(True)

    def command(self, pins):
        selector, streams, executable_fd = selectors.DefaultSelector(), {}, None
        try:
            for name in ("stdout", "stderr"):
                fd = os.open(self.case/(name+".log"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                streams[name] = os.fdopen(fd, "wb", buffering=0)
            env = process_environment(self.case, self.build, pins, self.checkpoint_layout)
            command = [str(self.build/TEST_BINARY), "-test.run=^"+TEST+"$", "-test.count=1", "-test.timeout=90s", "-test.v"]
            self.tick(True)
            executable_fd = os.open(self.build/TEST_BINARY, os.O_RDONLY | os.O_NOFOLLOW)
            if identity(os.fstat(executable_fd)) != pins[TEST_BINARY]["identity"]:
                raise RuntimeError("test binary changed before execution")
            self.child = subprocess.Popen(command, cwd=self.case, env=env, stdin=subprocess.DEVNULL,
                                          executable="/proc/self/fd/"+str(executable_fd), pass_fds=(executable_fd,),
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            row = self.guard.parse_stat(self.guard.bounded(Path("/proc")/str(self.child.pid)/"stat"), self.child.pid)
            if row["parent"] != os.getpid():
                raise RuntimeError("test child has no original wrapper parent")
            self.birth = row["startTicks"]
            self.known[self.child.pid] = self.birth
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
                        raise RuntimeError("remote-process combined log bound exceeded")
                    streams[key.data].write(block)
                if self.child.poll() is not None and not selector.get_map():
                    self.output_complete = True
                    break
            self.tick(True)
            return self.child.returncode
        finally:
            failed, close_error = sys.exc_info()[0] is not None, None
            selector.close()
            for stream in streams.values():
                try:
                    stream.flush()
                    os.fsync(stream.fileno())
                except OSError as error:
                    close_error = close_error or error
                finally:
                    stream.close()
            if self.child is not None:
                for stream in (self.child.stdout, self.child.stderr):
                    if stream is not None:
                        stream.close()
            if executable_fd is not None:
                os.close(executable_fd)
            if close_error is not None and not failed:
                raise RuntimeError("private process log sync failed; preserve original outcome") from close_error

    def cleanup(self):
        began = time.monotonic()
        deadline = min(began+LIMITS["cleanupMs"]/1000, self.started+LIMITS["totalMs"]/1000)
        consecutive, first_error = 0, None
        while time.monotonic() < deadline:
            try:
                empty = cleanup_scan(self.guard, os.getpid(), self.child, self.known, time.monotonic()-began > 2)
                if empty:
                    consecutive += 1
                    self.empty_scans.append(int((time.monotonic()-self.started)*1000))
                    if consecutive >= 2:
                        return first_error is None, first_error
                else:
                    consecutive = 0
            except OSError as error:
                consecutive = 0
                if error.errno not in (errno.ENOENT, errno.ESRCH, errno.ECHILD):
                    first_error = first_error or "cleanup telemetry unreadable"
            except Exception:
                consecutive = 0
                first_error = first_error or "cleanup identity/telemetry incomplete"
                if self.child is not None and self.child.poll() is None:
                    try:
                        self.child.kill()  # Only the direct, unreaped Popen identity.
                    except OSError:
                        pass  # Not proof of exit; fresh scans must still confirm.
            time.sleep(0.05)
        return False, first_error or "owned process cleanup incomplete"

    def total_deadline(self):
        if (time.monotonic()-self.started)*1000 >= LIMITS["totalMs"]:
            raise RuntimeError("remote-process total window exceeded")

    def final_files(self):
        # No owned child remains. A second stable scan closes the last-sample
        # gap without pretending that log success proves process disappearance.
        self.total_deadline()
        first = (self.guard.directory_bytes(self.case), self.guard.directory_bytes(self.build))
        second = (self.guard.directory_bytes(self.case), self.guard.directory_bytes(self.build))
        if first != second:
            raise RuntimeError("retired private/build files changed during final scan")
        disk = os.statvfs(self.case)
        row = self.guard.parse_stat(self.guard.bounded(Path("/proc")/str(os.getpid())/"stat"), os.getpid())
        task = sample_owned_task(self.guard, row, self.started+LIMITS["totalMs"]/1000)
        if task is None:
            raise RuntimeError("wrapper identity missing during final scan")
        sample = dict(elapsedMs=int((time.monotonic()-self.started)*1000),
                      rssBytes=task["rssBytes"], threads=task["threads"], processes=1,
                      privateBytes=second[0], buildBytes=second[1], logBytes=self.log_bytes,
                      freeDiskBytes=disk.f_bavail*disk.f_frsize,
                      availableMemoryBytes=self.guard.memory_available(), tasks=[task])
        self.samples.append(sample)
        enforce(sample)
        self.total_deadline()


def qualify(stdout, stderr, terminal, daemon_sha, layout="atomic-json"):
    layout = checkpoint_layout(layout)
    if type(terminal) is not int or terminal != 0 or stderr or len(stdout)+len(stderr) > LIMITS["logBytes"]:
        raise RuntimeError("normal process test has nonzero terminal or unexpected stderr/output bound")
    text = stdout.decode("utf-8", "strict")
    lines = text.splitlines()
    if (lines.count("=== RUN   "+TEST) != 1 or lines.count("PASS") != 1
            or len([v for v in lines if v.startswith("=== RUN")]) != 1
            or len([v for v in lines if re.fullmatch(r"--- PASS: "+TEST+r" \([0-9]+(?:\.[0-9]+)?s\)", v)]) != 1
            or len([v for v in lines if v.startswith("--- PASS:")]) != 1
            or any("SKIP" in v or "FAIL" in v or "panic:" in v for v in lines)):
        raise RuntimeError("unique actual normal-process test PASS is missing; skip/zero/FAIL refused")
    marker = ("normalRemoteProcess=true proposal=true prevote=true precommit=true extension=true "
              "coldOriginalHRS=true unknownNoRetry=true freshCheckpoint=true fullPeerPin=true "
              "nodeStarted=false publicDeployment=false binarySHA256="+daemon_sha)
    matches = [v for v in lines if re.fullmatch(r"\s+pq_remote_process_test\.go:[0-9]+: "+re.escape(marker), v)]
    if (len(matches) != 1 or len([v for v in lines if "normalRemoteProcess=" in v]) != 1
            or lines[0] != "=== RUN   "+TEST or lines[-1] != "PASS"
            or lines.index(matches[0]) >= len(lines)-2):
        raise RuntimeError("unique complete normal-process result marker or daemon pin missing")
    layout_marker = checkpoint_layout_marker(layout)
    layout_matches = [v for v in lines if re.fullmatch(r"\s+pq_remote_process_test\.go:[0-9]+: "+re.escape(layout_marker), v)]
    if (len(layout_matches) != 1 or len([v for v in lines if "checkpointLayout=" in v]) != 1
            or lines.index(layout_matches[0]) >= lines.index(matches[0])):
        raise RuntimeError("actual checkpoint layout marker differs from explicit selected layout")
    return hashlib.sha256(marker.encode()).hexdigest()


def run(args):
    layout = checkpoint_layout(args.checkpoint_layout)
    if sys.platform != "linux" or os.uname().machine != "x86_64":
        raise RuntimeError("remote process profile requires Linux amd64")
    if args.profile != PROFILE or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}", args.authorization_id or "") is None:
        raise RuntimeError("fixed profile and explicit external authorization reference required")
    guard = load_guard(args.guard)
    private_directory(args.case)
    if any(args.case.iterdir()):
        raise RuntimeError("fresh empty case required; preserve prior result or UNKNOWN")
    window = Window(guard, args.case, args.build, layout)
    result = dict(version="YNX-PQ-REMOTE-SIGNER-PROCESS-RESULT/v1", profile=PROFILE,
                  authorization=args.authorization_id, sourceCommit=args.expected_commit,
                  sourceManifestSHA256=args.expected_manifest_sha256, sourceLeafSHA256=SOURCE_SHA256,
                  checkpointLayout=layout,
                  guardSHA256=GUARD_SHA256, limits=dict(LIMITS), status="unknown", firstCause=None,
                  cleanupComplete=False, terminalCode=None, processAssertionsVerified=False,
                  publicDeployment=False, nodeStarted=False, privateArtifactsRetained=True,
                  privateRetentionScope="Runner/test do not delete this synthetic QA case on the current host. Ephemeral host retirement is not a durable backup. Do not publish vault/key/HRS inputs.")
    def public_cause(error):
        if not isinstance(error, RuntimeError):
            return type(error).__name__
        return str(error).replace(str(args.case), "<private-case>").replace(str(args.build), "<pinned-build>")
    def interrupted(signum, _frame):
        raise RuntimeError("remote process wrapper interrupted by signal "+str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    pins = None
    try:
        window.start()
        pins = validate_inputs(args, window.tick)
        result["binaryPins"] = {name: {k: pins[name][k] for k in ("sha256", "bytes")} for name in (TEST_BINARY, DAEMON_BINARY)}
        exclusive(args.case/"invocation.json", (json.dumps(dict(profile=PROFILE, authorization=args.authorization_id, sourceCommit=args.expected_commit, checkpointLayout=layout), sort_keys=True)+"\n").encode())
        (args.case/"tmp").mkdir(mode=0o700)
        sync_directory(args.case)
        unchanged(args.build, pins, window.tick)
        result["terminalCode"] = window.command(pins)
        unchanged(args.build, pins, window.tick)
        stdout = guard.bounded(args.case/"stdout.log", LIMITS["logBytes"])
        stderr = guard.bounded(args.case/"stderr.log", LIMITS["logBytes"])
        result["resultMarkerSHA256"] = qualify(stdout, stderr, result["terminalCode"], args.expected_daemon_sha256, layout)
        result["checkpointLayoutMarkerSHA256"] = hashlib.sha256(checkpoint_layout_marker(layout).encode()).hexdigest()
        result["processAssertionsVerified"] = True
    except Exception as error:
        result["firstCause"] = public_cause(error)
    finally:
        # A second TERM must not interrupt preservation/owned cleanup after the
        # original signal has already been recorded as the first cause.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if window.subreaper or window.child is not None:
            result["cleanupComplete"], cleanup_error = window.cleanup()
        else:
            result["cleanupComplete"], cleanup_error = True, None
        result["firstCause"] = result["firstCause"] or cleanup_error
        if window.child is not None:
            result["terminalCode"] = window.child.poll()
            result["child"] = dict(pid=window.child.pid, startTicks=window.birth)
        try:
            if result["cleanupComplete"]:
                window.final_files()
                if pins is not None:
                    unchanged(args.build, pins, window.total_deadline)
        except Exception as error:
            result["firstCause"] = result["firstCause"] or public_cause(error)
        result["emptyOwnedScans"] = window.empty_scans
        result["samples"] = window.samples
        result["resourcePeak"] = {k: max((s[k] for s in window.samples), default=0) for k in ("rssBytes", "privateBytes", "buildBytes", "logBytes", "processes", "threads")}
        result["resourcePeak"]["logBytes"] = max(result["resourcePeak"]["logBytes"], window.log_bytes)
        result["resourcePeak"]["processes"] = max(result["resourcePeak"]["processes"], window.observed_processes)
        result["outputComplete"] = window.output_complete
        result["output"] = {}
        for name in ("stdout", "stderr"):
            path = args.case/(name+".log")
            if path.exists() and not path.is_symlink():
                try:
                    output, _ = read_file(path, LIMITS["logBytes"], progress=window.total_deadline)
                    result["output"][name] = {k: output[k] for k in ("sha256", "bytes")}
                except Exception:
                    result["firstCause"] = result["firstCause"] or "bounded output evidence unavailable"
        if window.telemetry_failure is not None:
            result["telemetryFailure"] = window.telemetry_failure
        result["elapsedMs"] = int((time.monotonic()-window.started)*1000)
        if result["elapsedMs"] >= LIMITS["totalMs"]:
            result["firstCause"] = result["firstCause"] or "remote-process total window exceeded"
        if (result["processAssertionsVerified"] and result["terminalCode"] == 0
                and result["cleanupComplete"] and result["outputComplete"] and not result["firstCause"]):
            result["status"] = "validated_normal_remote_process"
        result["measurementLimits"] = "Sampled procfs/startTicks/smaps RSS, not a hard cgroup ceiling; TERM then KILL after 2s; two empty owned scans required. Precompiled read-only build is separately bounded. No public deployment or four-node inference."
        receipt = (json.dumps(result, sort_keys=True)+"\n").encode()
        if window.samples and window.samples[-1]["privateBytes"]+len(receipt) > LIMITS["privateBytes"]:
            result["firstCause"] = result["firstCause"] or "retained evidence exceeds private byte cap"
            result["status"] = "unknown"
            receipt = (json.dumps(result, sort_keys=True)+"\n").encode()
        exclusive(args.case/"remote-process-receipt.json", receipt)
        sync_directory(args.case)
        print(json.dumps({k: result[k] for k in ("status", "firstCause", "terminalCode", "cleanupComplete", "elapsedMs")}))
    return 0 if result["status"] == "validated_normal_remote_process" else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--profile", default=PROFILE, choices=(PROFILE,))
    parser.add_argument("--checkpoint-layout", default="atomic-json", choices=CHECKPOINT_LAYOUTS)
    parser.add_argument("--case", type=Path)
    parser.add_argument("--build", type=Path)
    parser.add_argument("--guard", type=Path)
    parser.add_argument("--expected-commit")
    parser.add_argument("--expected-manifest-sha256")
    parser.add_argument("--expected-test-sha256")
    parser.add_argument("--expected-daemon-sha256")
    parser.add_argument("--authorization-id")
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps(dict(status="prepared_only_no_process_started", profile=PROFILE, limits=LIMITS,
                              checkpointLayout=args.checkpoint_layout,
                              guardSHA256=GUARD_SHA256, sourceLeaf=SOURCE_LEAF, sourceLeafSHA256=SOURCE_SHA256,
                              requires="independent full commit/build-manifest/dual-binary pins and fresh authorized Linux case",
                              scope="normal command process validation only; no deployment or Node.Start")))
        return 0
    if any(getattr(args, key) is None for key in ("case", "build", "guard", "expected_commit", "expected_manifest_sha256", "expected_test_sha256", "expected_daemon_sha256", "authorization_id")):
        parser.error("execute requires all independent pins, case/build/guard and authorization-id")
    try:
        return run(args)
    except Exception as error:
        print(json.dumps(dict(status="refused_or_unknown", firstCause=str(error) if isinstance(error, RuntimeError) else type(error).__name__)))
        return 1


if __name__ == "__main__":
    sys.exit(main())
