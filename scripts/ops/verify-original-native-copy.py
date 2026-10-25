#!/usr/bin/env python3
"""One externally confirmed Linux COPY export/verify; never live-chain authority.

No import-time host inspection. Default CLI validates only the small contract.
The independent contract pin and a later exact confirmation are both required
before the fixed two ELF commands can run. An existing attempt is never reused.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

VERSION = "YNX-ORIGINAL-NATIVE-COPY-VERIFY/v1"
CASE = "/var/tmp/ynx-pq-original-native-check-5d-20261023163017Z"
COMMIT = "5d712dee8ac0b48da05f91a94dd2f3f495c8544f"
RUN_ID = "39982960594"
ARTIFACT_ID = "12515396547"
ARTIFACT_SHA256 = "93241f5bf1134e90a7464f8f9f5734f93af04d35bf538eebace6321557ca8713"
TOOLS = ("ynx-chaind", "ynx-consensus-package")
PINNED = {
    "COPY_RECEIPT.json": {"bytes": "731", "sha256": "715e9c079997472f12dd468ba54983fd79416336bdfb105f077a80ef6b359daa"},
    "data-verified/devnet-state.json": {"bytes": "666005578", "sha256": "c2e32d1f6a13954a38fd5a12dc35f22122b8655f2ef17fdf380e7a0f2d3f2974"},
    "data-verified/devnet-state.integrity-version": {"bytes": "2", "sha256": "53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3"},
    "tools/extracted/SOURCE.json": {"bytes": "459", "sha256": "aa940909ccc78ba30c23c408d97af9c343b2a9d5110f017a0a005ffd785f69cb"},
    "tools/extracted/ynx-chaind": {"bytes": "24567992", "sha256": "52d453591a544c621dde4d65ba525ef21f86e1b95ecae13ee4f9bf96066c22e2"},
    "tools/extracted/ynx-consensus-package": {"bytes": "23613624", "sha256": "67fc5dd9cca8703da882c59d9491de9836d9b12f83db5a620293be16f79d8017"},
}
LIMITS = {"activeSeconds": 180, "cleanupSeconds": 15, "totalSeconds": 195,
          "rssBytes": 8 << 30, "caseDeltaBytes": 4 << 30,
          "diskFloorBytes": 10 << 30, "freshMemoryBytes": 16 << 30,
          "sampleMs": 200, "processes": 16, "threads": 320,
          "toolLogBytes": 1 << 20, "telemetryBytes": 8 << 20, "fdsPerTask": 4096}
ENVIRONMENT = {"GOMAXPROCS": "2", "GOMEMLIMIT": "8GiB"}
ATTEMPT = "offline-export-verify-8g180s-observation-fixed"
HEAVY = {"cargo", "rustc", "go", "compile", "link", "cc1", "cc1plus",
         "gcc", "g++", "clang", "clang++", "cmake", "make", "ninja"}


class Refused(RuntimeError):
    """A stable first-cause code; never copied ledger data or service secrets."""


def require(ok, code):
    if not ok:
        raise Refused(code)


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "duplicate_json_field")
        value[key] = item
    return value


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(Refused("nonfinite_json")))


def closed(value, names):
    require(type(value) is dict and set(value) == set(names), "closed_fields_required")


def digest(value):
    require(type(value) is str and re.fullmatch("[0-9a-f]{64}", value)
            and value != "0" * 64, "independent_nonzero_sha256_required")
    return value


def positive(value):
    require(type(value) is str and re.fullmatch("[1-9][0-9]{0,19}", value), "canonical_positive_integer_required")
    return int(value)


def validate_contract(value):
    closed(value, ("version", "classification", "casePath", "controllerSHA256", "inputs",
                   "toolSource", "limits", "environment", "mustBeEmptyProcessGroups", "preparedInputWitness"))
    require(value["version"] == VERSION and value["classification"] == "data"
            and value["casePath"] == CASE, "wrong_fixed_case_profile")
    digest(value["controllerSHA256"])
    require(value["inputs"] == PINNED, "independent_original_input_pins_required")
    require(value["toolSource"] == {"commit": COMMIT, "runId": RUN_ID,
            "artifactId": ARTIFACT_ID, "artifactSHA256": ARTIFACT_SHA256}, "wrong_normal_ci_tools")
    require(type(value["limits"]) is dict and set(value["limits"]) == set(LIMITS)
            and all(type(value["limits"][key]) is int and value["limits"][key] == item
                    for key, item in LIMITS.items()), "fixed_limits_required")
    require(value["environment"] == ENVIRONMENT, "fixed_empty_service_environment_required")
    witness = value["preparedInputWitness"]
    directories = (".", "data-verified", "tools", "tools/extracted")
    closed(witness, (*directories, *PINNED))
    for name, row in witness.items():
        closed(row, ("uid", "mode", "device", "inode") if name in directories else
               ("uid", "mode", "device", "inode", "bytes", "mtimeNs", "ctimeNs", "nlink"))
        executable = name.rsplit("/", 1)[-1] in TOOLS
        require(row["uid"] == "0" and row["mode"] == ("700" if name in directories or executable else "600"), "prepared_root_private_mode_required")
        positive(row["inode"])
        require(type(row["device"]) is str and re.fullmatch("0|[1-9][0-9]*", row["device"]), "prepared_device_required")
        if name not in directories:
            require(row["bytes"] == PINNED[name]["bytes"] and row["nlink"] == "1", "prepared_regular_file_witness_required")
            positive(row["mtimeNs"])
            positive(row["ctimeNs"])
    groups = value["mustBeEmptyProcessGroups"]
    require(type(groups) is list and 1 <= len(groups) <= 8, "original_owner_empty_groups_required")
    seen = set()
    for row in groups:
        closed(row, ("pgid", "leaderStartTicks"))
        pgid = positive(row["pgid"])
        positive(row["leaderStartTicks"])
        require(1 < pgid <= 0x7fffffff and pgid not in seen, "invalid_original_owner_group")
        seen.add(pgid)
    return value


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def private_directory(path):
    require(path.is_absolute() and str(path.resolve(strict=True)) == str(path), "canonical_private_directory_required")
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
            and info.st_uid == os.geteuid(), "owned_0700_directory_required")
    return identity(info)


def regular(path, executable=False):
    require(path.is_absolute() and str(path.resolve(strict=True)) == str(path), "canonical_regular_file_required")
    info = path.lstat()
    modes = (0o400, 0o500, 0o600, 0o700) if executable is None else ((0o500, 0o700) if executable else (0o400, 0o600))
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) in modes
            and info.st_nlink == 1 and info.st_uid == os.geteuid(), "owned_private_file_mode_required")
    return info


def read_file(path, expected=None, maximum=None, progress=lambda: None, executable=False):
    before = regular(path, executable)
    require(maximum is None or before.st_size <= maximum, "bounded_metadata_required")
    sha, count, chunks = hashlib.sha256(), 0, []
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as stream:
        require(identity(os.fstat(stream.fileno())) == identity(before), "input_open_identity_changed")
        while True:
            block = stream.read(65536)
            if not block:
                break
            count += len(block)
            require(count <= before.st_size, "input_grew_during_read")
            sha.update(block)
            if maximum is not None:
                chunks.append(block)
            progress()
        require(identity(os.fstat(stream.fileno())) == identity(before)
                and identity(regular(path, executable)) == identity(before)
                and count == before.st_size, "input_changed_during_read")
    pin = {"bytes": str(count), "sha256": sha.hexdigest()}
    require(expected is None or pin == expected, "independent_input_pin_mismatch")
    return {"pin": pin, "identity": identity(before)}, b"".join(chunks)


def validate_copy_receipt(record):
    closed(record, ("schema", "casePath", "dataPath", "bytes", "sourceSHA256", "copySHA256",
                   "heldSourceStatBefore", "heldSourceStatAfter", "markerHex", "copyVerified",
                   "liveSourceNotPaused", "authoritativeFinalCheckpoint", "migrationVerified"))
    require(record["schema"] == "YNX_ORIGINAL_PRIMARY_NATIVE_LINUX_COPY_V1"
            and record["casePath"] == CASE and record["dataPath"] == CASE + "/data-verified"
            and type(record["bytes"]) is int and record["bytes"] == 666005578
            and record["sourceSHA256"] == record["copySHA256"] == PINNED["data-verified/devnet-state.json"]["sha256"]
            and record["markerHex"] == "320a" and record["copyVerified"] is True
            and record["liveSourceNotPaused"] is True and record["authoritativeFinalCheckpoint"] is False
            and record["migrationVerified"] is False, "wrong_held_copy_witness")
    held = "bytes=666005578 dev=64770 inode=1353209 mtime=1792773171 mode=600 uid=995 gid=986"
    require(record["heldSourceStatBefore"] == record["heldSourceStatAfter"] == held, "held_source_witness_changed")


def validate_source(record):
    closed(record, ("version", "commit", "runId", "platform", "purpose", "binaries"))
    require(record["version"] == "YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1"
            and record["commit"] == COMMIT and record["runId"] == RUN_ID
            and record["platform"] == "linux/amd64"
            and record["purpose"] == "offline copied-state validation; not installed or activated",
            "wrong_offline_normal_source")
    closed(record["binaries"], TOOLS)
    for name in TOOLS:
        pin = PINNED["tools/extracted/" + name]
        closed(record["binaries"][name], ("bytes", "sha256"))
        require(type(record["binaries"][name]["bytes"]) is int
                and record["binaries"][name] == {"bytes": int(pin["bytes"]), "sha256": pin["sha256"]},
                "normal_binary_manifest_mismatch")


def validate_inputs(case, progress):
    require(os.geteuid() == 0, "explicit_root_prepared_copy_required")
    private_directory(case)
    private_directory(case / "data-verified")
    private_directory(case / "tools")
    private_directory(case / "tools/extracted")
    require({p.name for p in (case / "data-verified").iterdir()} ==
            {"devnet-state.json", "devnet-state.integrity-version"}, "copy_sidecar_or_unknown_present")
    require({p.name for p in (case / "tools/extracted").iterdir()} ==
            {"SOURCE.json", *TOOLS}, "closed_two_elf_tools_required")
    require(not any(re.search(r"UNKNOWN|\.partial|\.tmp(?:$|[-.])", p.name)
                    or p.name.startswith("migration.json") for p in case.iterdir()), "retained_unknown_attempt_present")
    pins, metadata = {}, {}
    for name, pin in PINNED.items():
        executable = name.rsplit("/", 1)[-1] in TOOLS
        maximum = 16384 if name.endswith(".json") and "devnet-state" not in name else None
        record, raw = read_file(case / name, pin, maximum, progress, executable)
        pins[name] = record
        if maximum is not None:
            metadata[name] = decode(raw)
        if executable:
            with (case / name).open("rb") as stream:
                header = stream.read(20)
            require(header[:6] == b"\x7fELF\x02\x01" and header[18:20] == b"\x3e\x00", "normal_linux_amd64_elf_required")
    validate_copy_receipt(metadata["COPY_RECEIPT.json"])
    validate_source(metadata["tools/extracted/SOURCE.json"])
    return pins


def prepared_witness(info, directory=False):
    value = dict(uid=str(info.st_uid), mode=format(stat.S_IMODE(info.st_mode), "o"),
                 device=str(info.st_dev), inode=str(info.st_ino))
    if not directory:
        value.update(bytes=str(info.st_size), mtimeNs=str(info.st_mtime_ns),
                     ctimeNs=str(info.st_ctime_ns), nlink=str(info.st_nlink))
    return value


def check_prepared_witness(case, expected):
    require(os.geteuid() == 0, "explicit_root_prepared_copy_required")
    directories = (".", "data-verified", "tools", "tools/extracted")
    for name, before in expected.items():
        path = case if name == "." else case / name
        if name in directories:
            private_directory(path)
        else:
            regular(path, name.rsplit("/", 1)[-1] in TOOLS)
        require(prepared_witness(path.lstat(), name in directories) == before, "prepared_input_identity_mismatch")


def parse_stat(raw, expected, page_size):
    require(len(raw) <= 65536, "bounded_proc_stat_required")
    end = raw.rfind(b")")
    begin = raw.find(b"(")
    require(begin > 0 and end > begin and raw[:begin].strip() == str(expected).encode(), "proc_pid_mismatch")
    fields = raw[end + 1:].split()
    require(len(fields) >= 22 and all(re.fullmatch(b"[0-9]+", fields[i]) for i in (1, 2, 3, 17, 19, 21)), "incomplete_proc_telemetry")
    state = fields[0].decode("ascii")
    require(state in ("R", "S", "D", "Z", "T", "t", "X", "I", "P", "W", "K"), "unknown_proc_state")
    return dict(pid=expected, parent=int(fields[1]), group=int(fields[2]), session=int(fields[3]),
                startTicks=int(fields[19]), rssBytes=int(fields[21]) * page_size,
                threads=int(fields[17]), state=state, comm=raw[begin + 1:end].decode("utf-8", "replace"))


class LinuxProc:
    def __init__(self):
        self.page = os.sysconf("SC_PAGE_SIZE")
        require(self.page > 0, "proc_page_size_missing")
        mounts = self.bounded(Path("/proc/mounts"), 1 << 20).splitlines()
        entries = [line.split() for line in mounts if len(line.split()) >= 4 and line.split()[1:3] == [b"/proc", b"proc"]]
        require(len(entries) == 1 and not any(option.startswith(b"hidepid=") and option != b"hidepid=0"
                for option in entries[0][3].split(b",")), "complete_proc_mount_required")

    @staticmethod
    def bounded(path, limit):
        with path.open("rb") as source:
            raw = source.read(limit + 1)
        require(len(raw) <= limit, "bounded_proc_telemetry_required")
        return raw

    def one(self, pid):
        return parse_stat(self.bounded(Path("/proc") / str(pid) / "stat", 65536), pid, self.page)

    def one_or_gone(self, pid):
        for _ in range(3):
            try:
                return self.one(pid)
            except (FileNotFoundError, ProcessLookupError):
                try:
                    (Path("/proc") / str(pid)).lstat()
                except FileNotFoundError:
                    return None
        raise Refused("present_process_stat_missing")

    def inventory(self):
        rows = {}
        for path in Path("/proc").iterdir():
            if path.name.isdecimal():
                try:
                    rows[int(path.name)] = self.one(int(path.name))
                except FileNotFoundError:
                    # A disappeared task is the only admissible inventory race.
                    try:
                        path.lstat()
                    except FileNotFoundError:
                        continue
                    raise Refused("present_process_stat_missing")
        return rows

    def available_memory(self):
        raw = self.bounded(Path("/proc/meminfo"), 65536)
        found = re.findall(rb"^MemAvailable:\s+([0-9]+) kB$", raw, re.MULTILINE)
        require(len(found) == 1 and int(found[0]) > 0, "memory_telemetry_missing")
        return int(found[0]) * 1024

    def sample_task(self, original, check_sockets=True, observation_deadline=None, socket_authorizer=None):
        """Actual RSS or confirmed same-identity terminal state; never stat RSS.

        Missing/zero smaps, a disappearing FD directory or an FD closed/reused
        during readback can receive a short complete observation. All tasks share the caller's current 200ms
        cycle deadline, also capped by its existing 180s active deadline. This
        neither extends the command budget nor turns an unreadable live task
        into zero RSS. Typed diagnostics never contain smaps bodies or FD paths.
        """
        self.last_task_observation = None
        pid, started = original["pid"], time.monotonic()
        deadline = started + LIMITS["sampleMs"] / 1000
        if observation_deadline is not None:
            deadline = min(deadline, observation_deadline)
        pause = 0.01
        max_attempts = 1 + (LIMITS["sampleMs"] + 9) // 10
        observations = []
        fd_churn = ("fd_closed_during_read", "fd_reused_during_read")

        def unstable_code():
            return "owned_fd_observation_unresolved" if any(item["kind"] in fd_churn for item in observations) else "owned_live_rss_unresolved"

        def public_stat(value):
            if value is None:
                return None
            return {**{key: value[key] for key in ("pid", "parent", "group", "session", "startTicks", "threads", "state")},
                    "statRSSBytes": value["rssBytes"]}

        def observe(kind, before, after, after_kind, rss_kib, raw_bytes, errno, attempt):
            observations.append(dict(attempt=attempt, kind=kind, errno=errno,
                                     before=public_stat(before), after=public_stat(after), afterKind=after_kind,
                                     smapsRSSKiB=rss_kib, smapsRawBytes=raw_bytes))

        def finish(resolution, failure=None):
            self.last_task_observation = dict(version="YNX-ORIGINAL-NATIVE-TASK-SAMPLE/v1", pid=pid,
                expectedStartTicks=original["startTicks"], inventory=public_stat(original),
                budgetMs=max(0, int((deadline - started) * 1000)),
                elapsedMs=max(0, int((time.monotonic() - started) * 1000)),
                resolution=resolution, observations=observations,
                resolvedStat=public_stat(after or before) if resolution in ("rss_recovered", "fd_recovered", "terminal_single_thread") else None,
                resolvedSmapsRSSKiB=rss_kib if resolution in ("rss_recovered", "fd_recovered") else None,
                failureClass=None if failure is None else type(failure).__name__,
                failureCode=None if failure is None else (str(failure) if isinstance(failure, Refused) else type(failure).__name__))

        for attempt in range(1, max_attempts + 1):
            before, after, rss_kib, raw_bytes, missing_errno = None, None, None, None, None
            stage, reason, after_kind, recorded = "before_stat", None, "not_observed", False
            try:
                before = self.one_or_gone(pid)
                if before is None:
                    observe("stat_confirmed_gone", None, None, "confirmed_gone", None, None, None, attempt)
                    finish("confirmed_gone")
                    return None
                require(before["startTicks"] == original["startTicks"], "sample_pid_identity_changed")
                if before["state"] in ("Z", "X"):
                    observe("stat_terminal", before, before, "present", None, None, None, attempt)
                    recorded = True
                    require(before["threads"] == 1, "owned_terminal_thread_count_unresolved")
                    finish("terminal_single_thread")
                    return {**before, "rssBytes": 0}
                stage = "smaps_read"
                try:
                    raw = self.bounded(Path("/proc") / str(pid) / "smaps_rollup", 1 << 20)
                    raw_bytes = len(raw)
                except (FileNotFoundError, ProcessLookupError) as exc:
                    reason, missing_errno = "smaps_missing", exc.errno
                if reason is None:
                    stage = "smaps_parse"
                    rss = re.findall(rb"^Rss:\s+([0-9]+) kB$", raw, re.MULTILINE)
                    require(len(rss) == 1, "owned_smaps_rss_missing")
                    rss_kib = int(rss[0])
                    if rss_kib == 0:
                        reason = "smaps_zero"
                if reason is None and check_sockets:
                    stage = "fd_inventory"
                    directory = Path("/proc") / str(pid) / "fd"
                    try:
                        entries = list(directory.iterdir())
                    except FileNotFoundError as exc:
                        reason, missing_errno = "fd_directory_missing", exc.errno
                    if reason is None:
                        require(len(entries) <= LIMITS["fdsPerTask"] and all(p.name.isdecimal() for p in entries), "owned_fd_inventory_invalid")
                        stage = "fd_readlink"
                        for entry in entries:
                            try:
                                target = os.readlink(entry)
                            except FileNotFoundError as exc:
                                try:
                                    entry.lstat()
                                except FileNotFoundError:
                                    reason = "fd_closed_during_read"
                                else:
                                    reason = "fd_reused_during_read"
                                missing_errno = exc.errno
                                # Invalidate this whole FD observation. Still
                                # inspect the remaining readable entries so a
                                # socket already visible is refused immediately.
                                # The next attempt starts with fresh stat, real
                                # smaps RSS and the complete FD inventory.
                                continue
                            if target.startswith("socket:["):
                                match = re.fullmatch(r"socket:\[([1-9][0-9]*)\]", target)
                                require(match is not None and socket_authorizer is not None, "owned_socket_present")
                                try:
                                    allowed = socket_authorizer(before, int(entry.name), int(match[1]), deadline)
                                except FileNotFoundError as exc:
                                    # An exact socket/FD can close during kernel
                                    # readback too. Re-observe the whole task;
                                    # never authorize an absent or reused FD.
                                    reason, missing_errno = "fd_closed_during_read", exc.errno
                                    continue
                                require(allowed is True, "owned_socket_present")
                stage = "after_stat"
                after = self.one_or_gone(pid)
                after_kind = "confirmed_gone" if after is None else "present"
                if reason is not None or after is None or after["state"] in ("Z", "X"):
                    observe(reason or ("stat_confirmed_gone" if after is None else "stat_terminal"),
                            before, after, after_kind, rss_kib, raw_bytes, missing_errno, attempt)
                    recorded = True
                if after is None:
                    finish("confirmed_gone")
                    return None
                require(after["startTicks"] == original["startTicks"], "sample_pid_identity_changed")
                if after["state"] in ("Z", "X"):
                    require(after["threads"] == 1, "owned_terminal_thread_count_unresolved")
                    finish("terminal_single_thread")
                    return {**after, "rssBytes": 0}
                if reason is None:
                    if observations:
                        require(time.monotonic() <= deadline, unstable_code())
                        finish("fd_recovered" if any(item["kind"] in fd_churn for item in observations) else "rss_recovered")
                    return {**after, "rssBytes": rss_kib * 1024}
                remaining = deadline - time.monotonic()
                require(remaining > 0 and attempt < max_attempts, unstable_code())
                time.sleep(min(pause, remaining))
                require(time.monotonic() < deadline, unstable_code())
            except Exception as exc:
                if not recorded:
                    observe(reason or stage + "_error", before, after, after_kind, rss_kib, raw_bytes,
                            getattr(exc, "errno", None), attempt)
                finish("refused", exc)
                raise


class Owned:
    """PID/startTicks provenance, rooted only in this fresh controller's children."""
    def __init__(self, controller, rows):
        require(controller in rows and not any(r["parent"] == controller for r in rows.values()), "fresh_childless_controller_required")
        self.controller = controller
        self.self_start = rows[controller]["startTicks"]
        self.baseline = {(pid, row["startTicks"]) for pid, row in rows.items()}
        self.known = {}
        self.groups = set()

    def update(self, rows):
        require(self.controller in rows and rows[self.controller]["startTicks"] == self.self_start, "controller_identity_changed")
        found = {pid for pid, ticks in self.known.items() if pid in rows and rows[pid]["startTicks"] == ticks}
        changed = True
        while changed:
            changed = False
            anchors = {rows[pid]["group"] for pid in found}
            for pid, row in rows.items():
                if pid == self.controller or pid in found or (pid, row["startTicks"]) in self.baseline:
                    continue
                parent_proven = row["parent"] == self.controller or row["parent"] in found
                group_proven = row["group"] in self.groups and row["group"] in anchors
                if parent_proven or group_proven:
                    found.add(pid)
                    self.known[pid] = row["startTicks"]
                    if row["group"] == pid and row["session"] == pid:
                        self.groups.add(pid)
                    changed = True
        # Do not interpret an unproven member of an old group as empty/safe.
        require(not any(row["group"] in self.groups and pid not in found for pid, row in rows.items()), "owned_group_identity_unresolved")
        return {pid: rows[pid] for pid in found}


def capacity(rows, owned, contract, available, free, case_delta, elapsed, fresh=False):
    blocked = {int(row["pgid"]) for row in contract["mustBeEmptyProcessGroups"]}
    leaders = {int(row["pgid"]): int(row["leaderStartTicks"]) for row in contract["mustBeEmptyProcessGroups"]}
    require(not any(row["group"] in blocked or leaders.get(pid) == row["startTicks"]
                    for pid, row in rows.items()), "original_owner_group_not_empty")
    ours = set(owned)
    require(not any(pid not in ours and row["state"] != "Z" and row["comm"] in HEAVY
                    for pid, row in rows.items()), "other_heavy_owner_active")
    require(available > 0 and (not fresh or available >= LIMITS["freshMemoryBytes"]), "fresh_memory_floor")
    require(free >= LIMITS["diskFloorBytes"], "disk_floor")
    require(0 <= case_delta <= LIMITS["caseDeltaBytes"], "case_increment_limit")
    require(elapsed <= LIMITS["activeSeconds"], "active_time_limit")
    require(sum(row["rssBytes"] for row in owned.values()) <= LIMITS["rssBytes"], "owned_rss_limit")
    require(sum(row["threads"] for row in owned.values()) <= LIMITS["threads"]
            and len(owned) <= LIMITS["processes"], "owned_task_limit")


def directory_bytes(root):
    total = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            info = (Path(directory) / name).lstat()
            require(not stat.S_ISLNK(info.st_mode), "case_symlink_present")
            require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), "case_special_file_present")
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return total


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exclusive(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    sync_directory(path.parent)


def json_bytes(value):
    return (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()


def cleanup_once(proc, ownership, children, kill, reap):
    for child in children:
        child.poll()  # Reap only the original Popen's child and preserve its code.
    rows = proc.inventory()
    tasks = ownership.update(rows)
    for pid, row in tasks.items():
        fresh = proc.one_or_gone(pid)
        if fresh is None:
            # Confirmed /proc disappearance is normal exit, not incomplete
            # telemetry. Keep this inventory nonempty until the next full scan.
            continue
        require(fresh["startTicks"] == row["startTicks"], "cleanup_pid_identity_changed")
        if fresh["state"] == "Z" and fresh["threads"] == 1 and fresh["parent"] == ownership.controller:
            try:
                reap(pid, os.WNOHANG)
            except ChildProcessError:
                pass
        elif fresh["state"] != "Z" or fresh["threads"] != 1:
            # A dead thread-group leader can retain live threads/resources.
            # Its pidfd still identifies the owned process, which must receive
            # the ordinary TERM/KILL cleanup instead of a premature reap only.
            kill(pid)
    return not tasks and not any(row["group"] in ownership.groups for row in rows.values())


class Controller:
    def __init__(self, contract, contract_pin):
        self.contract, self.contract_pin = contract, contract_pin
        self.case, self.output = Path(contract["casePath"]), Path(contract["casePath"]) / ATTEMPT
        self.started, self.next_sample = time.monotonic(), 0.0
        self.proc = LinuxProc()
        rows = self.proc.inventory()
        self.owned = Owned(os.getpid(), rows)
        self.initial_bytes = directory_bytes(self.case)
        self.children, self.codes, self.samples = [], [], 0
        self.log_bytes, self.telemetry_bytes = 0, 0
        self.peak_rss, self.max_delta, self.min_free = 0, 0, None
        self.events = None
        self.first_cause = None
        self.last_sample = None
        self.task_sample_failure = None
        self.task_sample_journal_error = None
        self.capacity(fresh=True)

    def capacity(self, fresh=False):
        now = time.monotonic()
        if not fresh and now < self.next_sample:
            return
        # One shared cycle budget, not a fresh 200ms allowance for each PID.
        observation_deadline = min(now + LIMITS["sampleMs"] / 1000,
                                   self.started + LIMITS["activeSeconds"])
        rows = self.proc.inventory()
        owned_rows = self.owned.update(rows)
        owned_rows[self.owned.controller] = rows[self.owned.controller]
        owned = {}
        for pid, row in owned_rows.items():
            try:
                task = self.proc.sample_task(row, check_sockets=pid != self.owned.controller,
                                             observation_deadline=observation_deadline)
            except Exception as original:
                diagnostic = getattr(self.proc, "last_task_observation", None)
                if (type(diagnostic) is dict and diagnostic.get("pid") == pid
                        and diagnostic.get("expectedStartTicks") == row["startTicks"]
                        and diagnostic.get("resolution") == "refused"):
                    self.task_sample_failure = diagnostic
                    try:
                        self.event("task_sample_refused", diagnostic)
                    except Exception as journal_error:
                        # Keep the original telemetry refusal as first cause.
                        # The existing first-cause file retains this secondary
                        # failure without copying exception messages or paths.
                        self.task_sample_journal_error = dict(kind="journal_persistence_failed",
                            errorClass=type(journal_error).__name__, errno=getattr(journal_error, "errno", None))
                raise original
            observation = getattr(self.proc, "last_task_observation", None)
            if observation is not None:
                self.event("task_sample_observed", observation)
            if task is not None:
                owned[pid] = task
        free_info = os.statvfs(self.case)
        free = free_info.f_bavail * free_info.f_frsize
        delta = max(0, directory_bytes(self.case) - self.initial_bytes)
        observed = time.monotonic()
        sample = dict(elapsedMs=int((observed - self.started) * 1000), rssBytes=sum(r["rssBytes"] for r in owned.values()),
                      caseDeltaBytes=delta, freeDiskBytes=free, availableMemoryBytes=self.proc.available_memory(),
                      tasks=[{k: row[k] for k in ("pid", "parent", "group", "session", "startTicks", "rssBytes", "threads", "state")}
                             for row in owned.values()])
        self.peak_rss = max(self.peak_rss, sample["rssBytes"])
        self.max_delta = max(self.max_delta, delta)
        self.min_free = free if self.min_free is None else min(self.min_free, free)
        self.samples += 1
        self.last_sample = sample
        self.event("sample", sample)
        capacity(rows, owned, self.contract, sample["availableMemoryBytes"], free, delta,
                 time.monotonic() - self.started, fresh)
        # Do not wait another cycle after a terminal observation has used this
        # cycle's time. The original schedule remains anchored at tick start.
        self.next_sample = now + LIMITS["sampleMs"] / 1000

    def event(self, kind, detail):
        if self.events is not None:
            raw = json_bytes({"event": kind, "detail": detail})
            self.telemetry_bytes += len(raw)
            require(self.telemetry_bytes <= LIMITS["telemetryBytes"], "telemetry_size_limit")
            self.events.write(raw)
            self.events.flush()
            os.fsync(self.events.fileno())

    def command(self, command, label, original_pin):
        # File descriptors anchor the exact pinned executable inode, while the
        # argv/environment remain the fixed normal CLI, with no shell/config.
        self.capacity(fresh=True)
        tool = Path(command[0])
        current, _ = read_file(tool, original_pin["pin"], progress=self.capacity, executable=True)
        require(current == original_pin, "binary_changed_before_execution")
        executable = os.open(tool, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        selector, logs = selectors.DefaultSelector(), {}
        try:
            require(identity(os.fstat(executable)) == original_pin["identity"], "binary_fd_identity_changed")
            for name in ("stdout", "stderr"):
                fd = os.open(self.output / (label + "." + name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                logs[name] = os.fdopen(fd, "wb", buffering=0)
            # Recheck the exact original window immediately before each spawn,
            # after hashing/opening the tool. A cached active sample is not a
            # fresh 16GiB/empty-original-owner/disk/time permission to start.
            self.capacity(fresh=True)
            require(identity(os.fstat(executable)) == original_pin["identity"], "binary_fd_identity_changed")
            child = subprocess.Popen(command, executable="/proc/self/fd/" + str(executable),
                pass_fds=(executable,), cwd=self.output, env=dict(ENVIRONMENT),
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True, close_fds=True)
            self.children.append(child)
            self.next_sample = 0
            self.capacity()
            require(child.pid in self.owned.known, "normal_child_birth_identity_missing")
            self.event("child_started", {"phase": label, "pid": child.pid, "startTicks": self.owned.known[child.pid]})
            for name, stream in (("stdout", child.stdout), ("stderr", child.stderr)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while True:
                self.next_sample = 0 if not self.owned.known else self.next_sample
                self.capacity()
                for key, _ in selector.select(0.05):
                    block = os.read(key.fileobj.fileno(), 65536)
                    if not block:
                        selector.unregister(key.fileobj)
                    else:
                        self.log_bytes += len(block)
                        require(self.log_bytes <= LIMITS["toolLogBytes"], "tool_log_size_limit")
                        logs[key.data].write(block)
                if child.poll() is not None and not selector.get_map():
                    break
            self.codes.append(child.returncode)
            self.event("child_exited", {"phase": label, "code": child.returncode})
            require(child.returncode == 0, "normal_" + label + "_failed")
            self.next_sample = 0
            self.capacity()
            # A successful parent cannot leave children to overlap the verifier.
            require(not self.owned.update(self.proc.inventory()), "normal_command_left_owned_descendants")
            for out in logs.values():
                out.flush()
                os.fsync(out.fileno())
        finally:
            selector.close()
            for out in logs.values():
                out.close()
            os.close(executable)

    def cleanup(self):
        started = time.monotonic()
        end = min(started + LIMITS["cleanupSeconds"], self.started + LIMITS["totalSeconds"])
        empty, error = 0, None
        while time.monotonic() < end:
            try:
                def send(pid):
                    # pidfd anchors the same process across the final stat /
                    # signal boundary; PID reuse can never target a stranger.
                    fd = os.pidfd_open(pid, 0)
                    try:
                        fresh = self.proc.one_or_gone(pid)
                        if fresh is None:
                            # The pinned process can exit between pidfd_open and
                            # stat. Never signal; require the later empty scans.
                            return
                        require(fresh["startTicks"] == self.owned.known[pid], "cleanup_pidfd_identity_changed")
                        signal.pidfd_send_signal(fd, signal.SIGKILL if time.monotonic() - started >= 2 else signal.SIGTERM)
                    finally:
                        os.close(fd)
                if cleanup_once(self.proc, self.owned, self.children, send, os.waitpid):
                    empty += 1
                    if empty == 2:
                        return error is None, error
                else:
                    empty = 0
            except ProcessLookupError:
                empty = 0
            except Exception as exc:
                error = error or (str(exc) if isinstance(exc, Refused) else "cleanup_telemetry_incomplete")
                empty = 0
            time.sleep(0.1)
        return False, error or "owned_cleanup_incomplete"


def qualify_verifier(raw, codes):
    require(codes == [0, 0], "both_normal_exit_codes_required")
    match = re.fullmatch(rb"consensus migration state passed: height=([1-9][0-9]*) lastBlockHash=((?:0x)?[0-9a-f]{64}) stateHash=([0-9a-f]{64}) accounts=([1-9][0-9]*) validators=(4)\n", raw)
    require(match is not None, "normal_verifier_completion_missing")
    return dict(height=match[1].decode(), lastBlockHash=match[2].decode(), stateHash=match[3].decode(),
                accounts=match[4].decode(), validators=match[5].decode())


def normal_commands(case):
    migration = case / ATTEMPT / "migration.json"
    return [([str(case / "tools/extracted/ynx-chaind"), "--data-dir", str(case / "data-verified"),
              "--export-consensus-state", str(migration)], "export", "ynx-chaind"),
            ([str(case / "tools/extracted/ynx-consensus-package"), "-verify-migration-state", str(migration)],
             "verify", "ynx-consensus-package")]


def run(contract, contract_pin, witnesses):
    require(sys.platform == "linux" and platform.machine() == "x86_64", "linux_amd64_required")
    require(os.geteuid() == 0, "explicit_root_prepared_copy_required")
    require(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"), "identity_safe_cleanup_unavailable")
    case = Path(contract["casePath"])
    private_directory(case)
    require(not os.path.lexists(case / ATTEMPT), "original_attempt_partial_or_unknown_retained")
    controller = Controller(contract, contract_pin)
    # Setting child subreaper is local to this fresh wrapper, not a service.
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    previous, confirmed = ctypes.c_int(), ctypes.c_int()
    require(libc.prctl(37, ctypes.cast(ctypes.pointer(previous), ctypes.c_void_p).value, 0, 0, 0) == 0
            and libc.prctl(36, 1, 0, 0, 0) == 0
            and libc.prctl(37, ctypes.cast(ctypes.pointer(confirmed), ctypes.c_void_p).value, 0, 0, 0) == 0
            and confirmed.value == 1, "owned_child_subreaper_required")
    controller.output.mkdir(mode=0o700)
    sync_directory(case)
    exclusive(controller.output / "intent.json", json_bytes({"version": VERSION, "contractSHA256": contract_pin,
              "controllerSHA256": contract["controllerSHA256"], "status": "unknown", "automaticRetry": False,
              "limits": LIMITS, "environment": ENVIRONMENT, "sourceFinalCheckpoint": False, "rootGrant": False}))
    fd = os.open(controller.output / "journal.jsonl", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    controller.events = os.fdopen(fd, "wb")
    result, pins, cleanup_ok, cleanup_error = None, None, False, None
    previous_handlers = {}
    timer_owned = False
    def interrupted(_signum, _frame):
        raise Refused("external_interruption")
    def active_timeout(_signum, _frame):
        raise Refused("active_time_limit")
    try:
        controller.event("fresh_preflight", controller.last_sample)
        require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), "fresh_controller_timer_required")
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM):
            previous_handlers[sig] = signal.signal(sig, interrupted)
        signal.signal(signal.SIGALRM, active_timeout)
        signal.setitimer(signal.ITIMER_REAL, max(0.001, controller.started + LIMITS["activeSeconds"] - time.monotonic()))
        timer_owned = True
        check_prepared_witness(case, contract["preparedInputWitness"])
        pins = validate_inputs(case, controller.capacity)
        migration = controller.output / "migration.json"
        for command, label, name in normal_commands(case):
            controller.command(command, label, pins["tools/extracted/" + name])
        raw = (controller.output / "verify.stdout").read_bytes()
        result = qualify_verifier(raw, controller.codes)
        migration_pin, _ = read_file(migration, progress=controller.capacity)
        result.update(migrationBytes=migration_pin["pin"]["bytes"], migrationSHA256=migration_pin["pin"]["sha256"])
        for name, before in pins.items():
            after, _ = read_file(case / name, before["pin"], progress=controller.capacity,
                                 executable=name.rsplit("/", 1)[-1] in TOOLS)
            require(after == before, "original_input_changed_after_commands")
        for path, before, executable in witnesses:
            after, _ = read_file(path, before["pin"], maximum=1 << 20,
                                 progress=controller.capacity, executable=executable)
            require(after == before, "contract_or_controller_source_changed")
        check_prepared_witness(case, contract["preparedInputWitness"])
        controller.next_sample = 0
        controller.capacity()
    except Exception as exc:
        controller.first_cause = str(exc) if isinstance(exc, Refused) else "input_or_telemetry_" + type(exc).__name__
    finally:
        # Subsequent TERM must not replace the first cause or abort owned cleanup.
        if timer_owned:
            signal.setitimer(signal.ITIMER_REAL, 0)
        for sig in previous_handlers:
            signal.signal(sig, signal.SIG_IGN)
        if timer_owned:
            signal.signal(signal.SIGALRM, lambda _s, _f: (_ for _ in ()).throw(Refused("cleanup_time_limit")))
            remaining = min(LIMITS["cleanupSeconds"], controller.started + LIMITS["totalSeconds"] - time.monotonic())
            signal.setitimer(signal.ITIMER_REAL, max(0.001, remaining))
        try:
            cleanup_ok, cleanup_error = controller.cleanup()
        except Exception as exc:
            cleanup_ok, cleanup_error = False, str(exc) if isinstance(exc, Refused) else "cleanup_telemetry_incomplete"
        if timer_owned:
            signal.setitimer(signal.ITIMER_REAL, 0)
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
        if libc.prctl(36, previous.value, 0, 0, 0) != 0:
            cleanup_ok, cleanup_error = False, cleanup_error or "subreaper_restore_failed"
        try:
            controller.events.close()
        except OSError:
            cleanup_ok, cleanup_error = False, cleanup_error or "journal_persistence_failed"
    if not cleanup_ok:
        controller.first_cause = controller.first_cause or cleanup_error
    if time.monotonic() - controller.started > LIMITS["totalSeconds"]:
        controller.first_cause = controller.first_cause or "total_time_limit"
    if controller.first_cause is not None:
        try:
            # Prioritize the bounded owned cleanup; secondary persistence must
            # never replace its original failure or trigger a command retry.
            first_cause = {"code": controller.first_cause}
            if controller.task_sample_failure is not None:
                first_cause["taskSample"] = controller.task_sample_failure
                first_cause["taskSampleJournalError"] = controller.task_sample_journal_error
            exclusive(controller.output / "first-cause.json", json_bytes(first_cause))
        except Exception:
            pass
    receipt = {"version": VERSION, "classification": "data", "contractSHA256": contract_pin,
               "normalExitCodes": controller.codes, "firstCause": controller.first_cause,
               "cleanupComplete": cleanup_ok, "cleanupError": cleanup_error, "sampleCount": controller.samples,
               "peakOwnedRSSBytes": controller.peak_rss, "maxCaseDeltaBytes": controller.max_delta,
               "minFreeDiskBytes": controller.min_free, "elapsedMs": int((time.monotonic() - controller.started) * 1000),
               "inputBytesUnchanged": controller.first_cause is None, "verification": result,
               "preparedOwnerUID": "0", "guardMode": "sampled-proc-smaps-rollup-200ms",
               "cgroupHardWall": False, "ownedSockets": "sampled-rejected",
               "migrationVerified": result is not None and controller.first_cause is None and cleanup_ok,
               "authoritativeFinalCheckpoint": False, "sourceDeploymentQualified": False,
               "deployment": False, "rootGrant": False, "publicActivation": False}
    try:
        exclusive(controller.output / "result.json", json_bytes(receipt))
    except Exception:
        raise Refused(controller.first_cause or "result_persistence_failed")
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True)
    parser.add_argument("--contract-sha256", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirmed-contract-sha256")
    args = parser.parse_args(argv)
    try:
        digest(args.contract_sha256)
        record, raw = read_file(Path(args.contract), maximum=32768)
        require(record["pin"]["sha256"] == args.contract_sha256, "external_contract_pin_mismatch")
        contract = validate_contract(decode(raw))
        require(args.execute or args.confirmed_contract_sha256 is None, "confirmation_without_execution")
        if not args.execute:
            print(json_bytes({"version": VERSION, "classification": "data", "contractValidated": True,
                  "executionStarted": False, "requiresExactRootWindow": True, "rootGrant": False}).decode(), end="")
            return 0
        require(args.confirmed_contract_sha256 == args.contract_sha256, "later_exact_window_confirmation_required")
        controller, _ = read_file(Path(__file__).resolve(), maximum=1 << 20, executable=None)
        require(controller["pin"]["sha256"] == contract["controllerSHA256"], "external_controller_source_pin_mismatch")
        result = run(contract, args.contract_sha256,
                     [(Path(args.contract), record, False), (Path(__file__).resolve(), controller, None)])
        print(json_bytes(result).decode(), end="")
        return 0 if result["migrationVerified"] else 1
    except Exception as exc:
        code = str(exc) if isinstance(exc, Refused) else "preflight_" + type(exc).__name__
        print("YNX_ORIGINAL_NATIVE_COPY_REFUSED " + code, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
