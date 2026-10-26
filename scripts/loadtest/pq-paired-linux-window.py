#!/usr/bin/env python3
"""Linux-only, one prepared PQ paired test or explicit consensus E2E profile.

Default never launches Go. E2E executes only a separately compiled, pinned test.

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

E2E_RETAINED_HISTORY_PROFILE = "consensus-e2e-retained-history-v1"
REMOTE_E2E_RETAINED_HISTORY_PROFILE = "consensus-remote-e2e-retained-history-v1"
BUSINESS_E2E_PROFILE = "consensus-signed-business-v1"
FRESH_BUSINESS_E2E_PROFILE = "consensus-fresh-paired-business-v1"


def fixed_caps(profile=None):
    # Profiles select reviewed constants; neither prepared JSON nor a caller
    # supplied dictionary can increase any limit. Keep the original CAPS intact.
    if profile not in (None, "consensus-e2e", E2E_RETAINED_HISTORY_PROFILE, REMOTE_E2E_RETAINED_HISTORY_PROFILE, BUSINESS_E2E_PROFILE, FRESH_BUSINESS_E2E_PROFILE):
        raise RuntimeError("unknown fixed resource profile")
    caps = dict(CAPS)
    if profile in (E2E_RETAINED_HISTORY_PROFILE, REMOTE_E2E_RETAINED_HISTORY_PROFILE, BUSINESS_E2E_PROFILE, FRESH_BUSINESS_E2E_PROFILE):
        caps["privateBytes"] = 536870912
    return caps


def selected_profile(consensus_e2e=False, consensus_e2e_retained_history=False,
                     consensus_remote_e2e_retained_history=False, consensus_signed_business=False,
                     consensus_fresh_paired_business=False):
    flags = (consensus_e2e, consensus_e2e_retained_history, consensus_remote_e2e_retained_history,
             consensus_signed_business, consensus_fresh_paired_business)
    if any(type(flag) is not bool for flag in flags) or sum(flags) > 1:
        raise RuntimeError("consensus E2E profile flags are mutually exclusive")
    if consensus_remote_e2e_retained_history:
        return REMOTE_E2E_RETAINED_HISTORY_PROFILE
    if consensus_signed_business:
        return BUSINESS_E2E_PROFILE
    if consensus_fresh_paired_business:
        return FRESH_BUSINESS_E2E_PROFILE
    if consensus_e2e_retained_history:
        return E2E_RETAINED_HISTORY_PROFILE
    return "consensus-e2e" if consensus_e2e else None


E2E_TEST = "TestPQNetworkFourValidatorOriginalStateTransitionAndRestart"
E2E_SOURCE = "internal/consensus/pq_network_e2e_test.go"
# Updated only with the separately frozen test leaves and normal CI compilation.
E2E_SOURCE_SHA256 = "b8c15de1e2b4b1927e8276301e5c04ef7108677d5d16043426b9bc62825598e1"
E2E_PROGRESS_SOURCE = "internal/consensus/pq_network_progress_test.go"
E2E_PROGRESS_SOURCE_SHA256 = "66dd40ab781943d85555cac243148d9744d049d780488f542bb47e50af977044"
E2E_ENV = dict(GOMAXPROCS="2", GOGC="50", GOMEMLIMIT="1536MiB",
               YNX_PQ_NETWORK_E2E="authorized-four-node-window")
REMOTE_E2E_TEST = "TestPQNetworkFourValidatorRemoteSignerOriginalStateTransitionAndRestart"
REMOTE_E2E_SOURCE = "internal/consensus/pq_network_remote_e2e_test.go"
# Updated only after the owning normal test source is separately frozen.
REMOTE_E2E_SOURCE_SHA256 = "8d5e5d11ff8145d38aaca6dee68495a6077337f5b141ad6ffc4b143df75d6aaa"
REMOTE_PROCESS_SOURCE = "internal/consensus/pq_remote_process_test.go"
REMOTE_PROCESS_SOURCE_SHA256 = "01663b399daf0c7c70faab41e629a85d2538ea4bb9bb395fe724ec2ccf06948d"
REMOTE_E2E_ENV = dict(GOMAXPROCS="2", GOGC="50", GOMEMLIMIT="1536MiB",
                      YNX_PQ_NETWORK_REMOTE_E2E="authorized-four-node-remote-signer-window")
BUSINESS_E2E_TEST = "TestPQNetworkFourValidatorSignedBusinessConsumerAndIndependentFinality"
BUSINESS_E2E_SOURCE = "internal/consensus/pq_network_business_test.go"
# The owning test freezes this leaf together with the shared network source.
BUSINESS_E2E_SOURCE_SHA256 = "0b4739b3ac7a3c8a21573074d74734da964c256e76d0f10fb5b42a8e7db63d73"
BUSINESS_CLIENT_COMMIT = "3f5b1ce792616b01b38fe4320c6d4d83fbcc22a0"
FRESH_BUSINESS_E2E_TEST = "TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming"
FRESH_BUSINESS_E2E_SOURCE = "internal/consensus/pq_network_fresh_business_test.go"
FRESH_BUSINESS_E2E_SOURCE_SHA256 = "8f2d4f58808dee77ab00dc69a9a285f770b7aeafa49b4e8865455f581ad1d438"
FRESH_BUSINESS_CLIENT_COMMIT = "70e7e450997a0ae77dbad5a8be3682f482c6ddd8"
FRESH_BUSINESS_CLIENT_TREE = "4866cc3924c060eb6a29939915d39b1c5c625607"
FRESH_BUSINESS_CLOCK = "test-process time.Now monotonic elapsed; not a cross-process or wall-clock subtraction"
BUSINESS_BINARIES = ("consensus.test", "ynx-bft-gatewayd", "ynx-consensus-perf-client",
                     "ynx-consensus-proof-verify")


def unique_json(raw):
    if isinstance(raw, bytes):
        raw = raw.decode("utf8", errors="strict")
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise RuntimeError("duplicate original JSON field")
            value[key] = item
        return value
    def invalid_constant(_):
        raise RuntimeError("nonfinite original JSON value")
    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_constant)


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


def enforce(sample, initial=False, profile=None):
    caps = fixed_caps(profile)
    for key, cap in (("rssBytes", "ownedRSSBytes"), ("threads", "threads"),
                     ("privateBytes", "privateBytes"), ("buildBytes", "buildBytes")):
        if not isinstance(sample[key], int) or sample[key] < 0 or sample[key] > caps[cap]:
            raise RuntimeError(key + " cap exceeded/invalid")
    floor = caps["diskFloorBytes"] + caps["rootReserveBytes"]
    if initial:
        floor += caps["compileReserveBytes"] + caps["privateBytes"]
    if type(sample["freeDiskBytes"]) is not int or sample["freeDiskBytes"] < floor:
        raise RuntimeError("actual disk floor/reserve failed")
    if type(sample["availableMemoryBytes"]) is not int or sample["availableMemoryBytes"] < caps["availableMemoryFloorBytes"]:
        raise RuntimeError("Linux MemAvailable floor failed; not a macOS pressure signal")


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def validate_recipe(plan, prepared, case_n=1):
    if "remoteSignerPin" in plan or "businessManifestPin" in plan:
        raise RuntimeError("paired benchmark cannot select another network profile")
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


def validate_pinned_consensus_binary(pin, binary):
    if (not isinstance(pin, dict) or set(pin) != {"path", "sha256"}
            or pin.get("path") != str(binary)
            or not re.fullmatch(r"[0-9a-f]{64}", pin.get("sha256", ""))):
        raise RuntimeError("exact precompiled consensus binary pin required")
    before = binary.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
            or before.st_nlink != 1 or before.st_mode & 0o022 or not os.access(binary, os.X_OK)):
        raise RuntimeError("consensus binary must be an owned regular executable, not an alias")
    with binary.open("rb") as handle:
        if handle.read(4) != b"\x7fELF":
            raise RuntimeError("precompiled Linux consensus.test ELF required; no interpreter command")
    if digest(binary) != pin["sha256"]:
        raise RuntimeError("precompiled consensus binary SHA256 mismatch")
    after = binary.lstat()
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_mode)
    if identity(before) != identity(after):
        raise RuntimeError("consensus binary changed during verification")
    return binary


def validate_consensus_e2e_binary(plan, build):
    return validate_pinned_consensus_binary(plan.get("binaryPin"), build / "consensus.test")


def validate_consensus_remote_signer_binary(plan, build):
    binary = build / "ynx-consensus-pq-remote-signer"
    if binary.resolve(strict=True) != binary:
        raise RuntimeError("normal remote signer must use the canonical sibling binary")
    return validate_pinned_consensus_binary(plan.get("remoteSignerPin"), binary)


def consensus_remote_source_pins():
    return {E2E_SOURCE: {"sha256": E2E_SOURCE_SHA256},
            E2E_PROGRESS_SOURCE: {"sha256": E2E_PROGRESS_SOURCE_SHA256},
            REMOTE_E2E_SOURCE: {"sha256": REMOTE_E2E_SOURCE_SHA256},
            REMOTE_PROCESS_SOURCE: {"sha256": REMOTE_PROCESS_SOURCE_SHA256}}


def consensus_remote_environment(plan, build):
    pin = plan.get("remoteSignerPin")
    if (not isinstance(pin, dict) or set(pin) != {"path", "sha256"}
            or pin.get("path") != str(build / "ynx-consensus-pq-remote-signer")
            or not re.fullmatch(r"[0-9a-f]{64}", pin.get("sha256", ""))):
        raise RuntimeError("independent normal remote signer binary pin required")
    return dict(REMOTE_E2E_ENV, YNX_PQ_REMOTE_SIGNER_BINARY=pin["path"],
                YNX_PQ_REMOTE_SIGNER_SHA256=pin["sha256"])


def consensus_business_source_pins(fresh=False):
    pins = {E2E_SOURCE: {"sha256": E2E_SOURCE_SHA256},
            BUSINESS_E2E_SOURCE: {"sha256": BUSINESS_E2E_SOURCE_SHA256}}
    if fresh:
        pins[FRESH_BUSINESS_E2E_SOURCE] = {"sha256": FRESH_BUSINESS_E2E_SOURCE_SHA256}
    return pins


def consensus_business_environment(plan, build, fresh=False):
    pin = plan.get("businessManifestPin")
    if (not isinstance(pin, dict) or set(pin) != {"path", "sha256"}
            or pin.get("path") != str(build / "business-manifest.json")
            or not re.fullmatch(r"[0-9a-f]{64}", pin.get("sha256", ""))
            or pin["sha256"] == "0" * 64):
        raise RuntimeError("independent original business manifest pin required")
    if fresh:
        return dict(GOMAXPROCS="2", GOGC="50", GOMEMLIMIT="1536MiB",
                    YNX_PQ_NETWORK_FRESH_BUSINESS_E2E="authorized-fresh-four-node-business-window",
                    YNX_PQ_NETWORK_FRESH_BUSINESS_MANIFEST=pin["path"],
                    YNX_PQ_NETWORK_FRESH_BUSINESS_MANIFEST_SHA256=pin["sha256"],
                    YNX_PQ_NETWORK_FRESH_BUSINESS_SOURCE_COMMIT=plan["commit"])
    return dict(GOMAXPROCS="2", GOGC="50", GOMEMLIMIT="1536MiB",
                YNX_PQ_NETWORK_BUSINESS_E2E="authorized-four-node-business-window",
                YNX_PQ_NETWORK_BUSINESS_MANIFEST=pin["path"],
                YNX_PQ_NETWORK_BUSINESS_MANIFEST_SHA256=pin["sha256"],
                YNX_PQ_NETWORK_BUSINESS_SOURCE_COMMIT=plan["commit"])


def validate_consensus_business_files(plan, source, build, captured=None, fresh=False):
    # The independent manifest commits the four real compiled executables. No
    # path or hash is selected from an RPC response or the test's own output.
    pin = plan["businessManifestPin"]
    consensus_business_environment(plan, build, fresh)
    manifest_path = build / "business-manifest.json"
    names = {*BUSINESS_BINARIES, manifest_path.name}
    temporary = build / "tmp"
    if temporary.exists() or temporary.is_symlink():
        info = temporary.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
            raise RuntimeError("business build temp must remain an owned private directory")
        names.add("tmp")
    if {path.name for path in build.iterdir()} != names:
        raise RuntimeError("business build requires exactly four original ELFs and manifest")
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                             info.st_ctime_ns, info.st_mode, info.st_uid, info.st_gid, info.st_nlink)
    before = manifest_path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != 0o600 or manifest_path.resolve(strict=True) != manifest_path):
        raise RuntimeError("original private business manifest required")
    raw = bounded(manifest_path, 64 << 10)
    if hashlib.sha256(raw).hexdigest() != pin["sha256"]:
        raise RuntimeError("business manifest SHA256 differs from independent pin")
    manifest = unique_json(raw)
    fields = {"version", "protocolCommit", "performanceClientCommit", "sourceRoot", "sourceLeaves", "binaries"}
    if fresh:
        fields.add("performanceClientTree")
    client_commit = FRESH_BUSINESS_CLIENT_COMMIT if fresh else BUSINESS_CLIENT_COMMIT
    if (not isinstance(manifest, dict) or set(manifest) != fields
            or manifest.get("version") != ("YNX-PQ-NETWORK-FRESH-BUSINESS-BUILD/v1" if fresh else "YNX-PQ-NETWORK-BUSINESS-BUILD/v1")
            or manifest.get("protocolCommit") != plan["commit"]
            or manifest.get("performanceClientCommit") != client_commit
            or fresh and manifest.get("performanceClientTree") != FRESH_BUSINESS_CLIENT_TREE
            or manifest.get("sourceRoot") != str(source)
            or manifest.get("sourceLeaves") != {name: value["sha256"] for name, value in consensus_business_source_pins(fresh).items()}
            or not isinstance(manifest.get("binaries"), dict) or set(manifest["binaries"]) != set(BUSINESS_BINARIES)):
        raise RuntimeError("closed original business source/client manifest differs")
    if identity(before) != identity(manifest_path.lstat()):
        raise RuntimeError("business manifest changed while reading")
    identities = {str(manifest_path): identity(before)}
    files = {source / relative: value["sha256"] for relative, value in consensus_business_source_pins(fresh).items()}
    total, hashes = 0, set()
    for name in BUSINESS_BINARIES:
        record = manifest["binaries"][name]
        wanted_commit = client_commit if name == "ynx-consensus-perf-client" else plan["commit"]
        binary = build / name
        if (not isinstance(record, dict) or set(record) != {"path", "sha256", "commit", "bytes"}
                or record.get("path") != str(binary) or record.get("commit") != wanted_commit
                or type(record.get("bytes")) is not int or not 20 <= record["bytes"] <= 128 << 20
                or record.get("sha256") in hashes or record.get("sha256") == "0" * 64):
            raise RuntimeError("distinct bounded original business executable identity required")
        binary_before = identity(binary.lstat())
        validate_pinned_consensus_binary({key: record[key] for key in ("path", "sha256")}, binary)
        with binary.open("rb") as handle:
            header = handle.read(20)
        if (header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00"
                or header[16:18] not in (b"\x02\x00", b"\x03\x00") or binary.stat().st_size != record["bytes"]):
            raise RuntimeError("original normal Linux amd64 ELF and exact bytes required")
        if binary_before != identity(binary.lstat()):
            raise RuntimeError("business original executable changed during admission")
        if name == "consensus.test" and plan["binaryPin"] != {key: record[key] for key in ("path", "sha256")}:
            raise RuntimeError("running consensus binary differs from independent business manifest")
        hashes.add(record["sha256"])
        total += record["bytes"]
        identities[str(binary)] = binary_before
        files[binary] = record["sha256"]
    if total > 512 << 20:
        raise RuntimeError("business executable total exceeds unchanged build budget")
    for path, expected in files.items():
        before = path.lstat()
        if str(path) in identities and identities[str(path)] != identity(before):
            raise RuntimeError("business executable changed between original pin reads")
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1
                or before.st_mode & 0o022 or path.resolve(strict=True) != path or digest(path) != expected
                or path not in {build / name for name in BUSINESS_BINARIES} and not 0 < before.st_size <= 256 << 10):
            raise RuntimeError("business original source/executable identity differs")
        after = path.lstat()
        if identity(before) != identity(after):
            raise RuntimeError("business source/executable changed during pin verification")
        identities[str(path)] = identity(after)
    if identities[str(manifest_path)] != identity(manifest_path.lstat()):
        raise RuntimeError("business manifest changed during executable/source verification")
    if captured is not None and identities != captured:
        raise RuntimeError("business manifest/source/executable changed since admission")
    return identities


def reject_inherited_remote_window_optins(inherited):
    if any(key in inherited for key in ("YNX_PQ_NETWORK_E2E", "YNX_PQ_REMOTE_PROCESS", "YNX_PQ_REMOTE_PROCESS_LAYOUT", "YNX_PQ_NETWORK_BUSINESS_E2E", "YNX_PQ_NETWORK_FRESH_BUSINESS_E2E")):
        raise RuntimeError("remote network window cannot inherit the local network or separate process opt-in")


def consensus_runtime_environment(pinned_env, case, build, profile, inherited):
    if profile in (BUSINESS_E2E_PROFILE, FRESH_BUSINESS_E2E_PROFILE):
        reject_inherited_business_optins(inherited, profile == FRESH_BUSINESS_E2E_PROFILE)
        return dict(pinned_env, PATH="/usr/bin:/bin", TMPDIR=str(case / "tmp"))
    if profile == REMOTE_E2E_RETAINED_HISTORY_PROFILE:
        reject_inherited_remote_window_optins(inherited)
        # No caller key/Host mode, Go option or old opt-in is inherited. The
        # compiled test and normal daemon need only their fixed public runtime
        # environment, absolute executable paths and monitored private TMPDIR.
        return dict(pinned_env, PATH="/usr/bin:/bin", TMPDIR=str(case / "tmp"))
    if any(key in inherited for key in ("YNX_PQ_NETWORK_REMOTE_E2E", "YNX_PQ_NETWORK_BUSINESS_E2E", "YNX_PQ_NETWORK_FRESH_BUSINESS_E2E")):
        raise RuntimeError("local profile cannot inherit a remote network opt-in")
    environment = dict(inherited)
    environment.pop("YNX_CHAIN_STOPPED_WINDOW", None)
    environment.pop("YNX_CHAIN_PARTIAL_STOPPED_WINDOW", None)
    environment.update(pinned_env, TMPDIR=str(case / "tmp"), GOTMPDIR=str(build / "tmp"),
                       GOWORK="off", GOTOOLCHAIN="local", GOFLAGS="-mod=readonly")
    return environment


def validate_consensus_remote_e2e_files(plan, source, build, captured=None):
    names = {"consensus.test", "ynx-consensus-pq-remote-signer"}
    temporary = build / "tmp"
    if temporary.exists() or temporary.is_symlink():
        info = temporary.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700
                or info.st_uid != os.getuid()):
            raise RuntimeError("remote window build temp must remain an owned private directory")
        names.add("tmp")
    if {path.name for path in build.iterdir()} != names:
        raise RuntimeError("remote window build must retain exactly the two original binaries and owned temp")
    validate_consensus_e2e_binary(plan, build)
    validate_consensus_remote_signer_binary(plan, build)
    files = {source / relative: pin["sha256"] for relative, pin in consensus_remote_source_pins().items()}
    files.update({build / "consensus.test": plan["binaryPin"]["sha256"],
                  build / "ynx-consensus-pq-remote-signer": plan["remoteSignerPin"]["sha256"]})
    identities = {}
    identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                             info.st_ctime_ns, info.st_mode, info.st_uid, info.st_gid, info.st_nlink)
    for path, pin in files.items():
        before = path.lstat()
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1
                or before.st_mode & 0o022 or path.resolve(strict=True) != path
                or not re.fullmatch(r"[0-9a-f]{64}", pin) or digest(path) != pin):
            raise RuntimeError("remote window frozen source/binary identity mismatch")
        after = path.lstat()
        if identity(before) != identity(after):
            raise RuntimeError("remote window source/binary changed while reading")
        identities[str(path)] = identity(after)
    if captured is not None and identities != captured:
        raise RuntimeError("remote window source/binary changed since admission")
    return identities


def validate_consensus_e2e_recipe(plan, prepared, profile="consensus-e2e"):
    if profile not in ("consensus-e2e", E2E_RETAINED_HISTORY_PROFILE) or plan.get("profile") != profile:
        raise RuntimeError("explicit consensus E2E flag and prepared profile must match")
    if "remoteSignerPin" in plan or "businessManifestPin" in plan:
        raise RuntimeError("local consensus recipe cannot select another network profile")
    return validate_consensus_window_recipe(plan, prepared, profile)


def validate_consensus_remote_e2e_recipe(plan, prepared, inherited=None):
    reject_inherited_remote_window_optins(os.environ if inherited is None else inherited)
    if set(plan) != {"profile", "caps", "sourceRoot", "commit", "executionAuthorized", "workingDirectory",
                     "sourcePins", "binaryPin", "remoteSignerPin", "command", "environment"}:
        raise RuntimeError("exact closed remote consensus recipe required")
    if plan.get("profile") != REMOTE_E2E_RETAINED_HISTORY_PROFILE:
        raise RuntimeError("explicit remote consensus E2E flag and prepared profile must match")
    if (not isinstance(plan.get("sourceRoot"), str) or not Path(plan["sourceRoot"]).is_absolute()
            or str(Path(plan["sourceRoot"]).resolve(strict=True)) != plan["sourceRoot"]):
        raise RuntimeError("remote consensus source checkout must be canonical and absolute")
    return validate_consensus_window_recipe(plan, prepared, REMOTE_E2E_RETAINED_HISTORY_PROFILE)


def reject_inherited_business_optins(inherited, fresh=False):
    other = "YNX_PQ_NETWORK_BUSINESS_E2E" if fresh else "YNX_PQ_NETWORK_FRESH_BUSINESS_E2E"
    if any(key in inherited for key in ("YNX_PQ_NETWORK_E2E", "YNX_PQ_NETWORK_REMOTE_E2E", "YNX_PQ_REMOTE_PROCESS", "YNX_PQ_REMOTE_PROCESS_LAYOUT", other)):
        raise RuntimeError("business window cannot inherit another network/process opt-in")


def validate_consensus_business_recipe(plan, prepared, inherited=None, fresh=False):
    reject_inherited_business_optins(os.environ if inherited is None else inherited, fresh)
    profile = FRESH_BUSINESS_E2E_PROFILE if fresh else BUSINESS_E2E_PROFILE
    if (set(plan) != {"profile", "caps", "sourceRoot", "commit", "executionAuthorized", "workingDirectory",
                      "sourcePins", "binaryPin", "businessManifestPin", "command", "environment"}
            or plan.get("profile") != profile):
        raise RuntimeError("explicit closed signed-business recipe required")
    if (not isinstance(plan.get("sourceRoot"), str) or not Path(plan["sourceRoot"]).is_absolute()
            or str(Path(plan["sourceRoot"]).resolve(strict=True)) != plan["sourceRoot"]):
        raise RuntimeError("business source checkout must be canonical and absolute")
    return validate_consensus_window_recipe(plan, prepared, profile)


def validate_consensus_fresh_business_recipe(plan, prepared, inherited=None):
    return validate_consensus_business_recipe(plan, prepared, inherited, fresh=True)


def validate_consensus_window_recipe(plan, prepared, profile):
    remote = profile == REMOTE_E2E_RETAINED_HISTORY_PROFILE
    fresh = profile == FRESH_BUSINESS_E2E_PROFILE
    business = profile in (BUSINESS_E2E_PROFILE, FRESH_BUSINESS_E2E_PROFILE)
    caps = fixed_caps(profile)
    # Old prepared recipes need no new field. A claimed cap is never ignored;
    # the new profile must explicitly commit all of its unchanged limits too.
    if profile in (E2E_RETAINED_HISTORY_PROFILE, REMOTE_E2E_RETAINED_HISTORY_PROFILE, BUSINESS_E2E_PROFILE, FRESH_BUSINESS_E2E_PROFILE) or "caps" in plan:
        claimed = plan.get("caps")
        if (not isinstance(claimed, dict) or claimed != caps
                or any(type(value) is not int for value in claimed.values())):
            raise RuntimeError("prepared caps must exactly match the selected fixed profile")
    source = Path(plan["sourceRoot"]).resolve()
    case = prepared.parent.resolve()
    build = case.with_name(case.name + ".build")
    if source == case or source in case.parents or case in source.parents:
        raise RuntimeError("private CI case must be outside source checkout")
    if source == build or source in build.parents or build in source.parents:
        raise RuntimeError("private CI build must be outside source checkout")
    if (plan.get("executionAuthorized") is not False
            or not re.fullmatch(r"[0-9a-f]{40}", plan.get("commit", ""))
            or any(key in plan for key in ("n", "trial", "overlayPin", "productionMeasurementVersion"))):
        raise RuntimeError("explicit frozen consensus-e2e recipe required")
    test_name = FRESH_BUSINESS_E2E_TEST if fresh else BUSINESS_E2E_TEST if business else REMOTE_E2E_TEST if remote else E2E_TEST
    expected_env = (consensus_business_environment(plan, build, fresh) if business else
                    consensus_remote_environment(plan, build) if remote else E2E_ENV)
    expected = [str(build / "consensus.test"), "-test.run=^" + test_name + "$",
                "-test.count=1", "-test.timeout=120s", "-test.v"]
    if (plan.get("command") != expected or plan.get("environment") != expected_env
            or plan.get("workingDirectory") != str(source / "internal/consensus")):
        raise RuntimeError("consensus E2E command/cwd/environment mismatch")
    pins = plan.get("sourcePins")
    required_pins = {E2E_SOURCE: {"sha256": E2E_SOURCE_SHA256},
                     E2E_PROGRESS_SOURCE: {"sha256": E2E_PROGRESS_SOURCE_SHA256}}
    if remote:
        required_pins = consensus_remote_source_pins()
    if business:
        required_pins = consensus_business_source_pins(fresh)
    if not isinstance(pins, dict) or pins != required_pins:
        raise RuntimeError("exact frozen consensus E2E source pins required")
    for relative, pin in required_pins.items():
        test = source / relative
        try:
            # Both the leaf and its parents must be real checkout paths. A
            # matching digest reached through a symlink is still not this leaf.
            if (not stat.S_ISREG(test.lstat().st_mode) or test.resolve(strict=True) != test
                    or digest(test) != pin["sha256"]):
                raise RuntimeError("frozen consensus E2E test source mismatch")
        except OSError as exc:
            raise RuntimeError("frozen consensus E2E test source unavailable") from exc
    for directory in (case, build):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
            raise RuntimeError("new owned private case/build directories must be mode 0700")
    info = prepared.lstat()
    if (prepared.name != "prepared.json" or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1):
        raise RuntimeError("owned private prepared.json required")
    binary_names = ({*BUSINESS_BINARIES, "business-manifest.json"} if business else
                    {"consensus.test", "ynx-consensus-pq-remote-signer"} if remote else {"consensus.test"})
    if {p.name for p in case.iterdir()} != {"prepared.json"} or {p.name for p in build.iterdir()} != binary_names:
        raise RuntimeError("preserve prior E2E logs/tmp/UNKNOWN; only fresh prepared case and sole precompiled binary allowed")
    validate_consensus_e2e_binary(plan, build)
    if remote:
        validate_consensus_remote_e2e_files(plan, source, build)
    if business:
        validate_consensus_business_files(plan, source, build, fresh=fresh)
    return source, case, expected, dict(expected_env)


def validate_consensus_e2e_result(stdout, stderr, terminal_code):
    return validate_consensus_network_result(stdout, stderr, terminal_code, E2E_TEST)


def validate_consensus_business_result(stdout, stderr, terminal_code, commit):
    evidence = validate_consensus_network_result(stdout, stderr, terminal_code, BUSINESS_E2E_TEST)
    text = stdout.decode("utf8", errors="strict")
    markers = list(re.finditer(r"^[ \t]+pq_network_business_test\.go:[0-9]+: PQ_NETWORK_BUSINESS_SUMMARY (\{[^\r\n]+\})$", text, re.M))
    if len(markers) != 1 or not text.index("PQ_NETWORK_E2E_SUMMARY ") < markers[0].start() < text.index("--- PASS: " + BUSINESS_E2E_TEST + " ("):
        raise RuntimeError("one signed-business summary required after original cleanup evidence")
    summary = unique_json(markers[0][1])
    if (not isinstance(summary, dict) or set(summary) != {"version", "syntheticOnly", "clientCommit", "protocolCommit", "rows", "sustainedTPSQualified", "publicDeployment", "nativeGrant"}
            or summary.get("version") != "YNX-PQ-NETWORK-SIGNED-BUSINESS/v1" or summary.get("syntheticOnly") is not True
            or not re.fullmatch(r"[0-9a-f]{40}", commit) or commit == "0" * 40
            or summary.get("protocolCommit") != commit or summary.get("clientCommit") != BUSINESS_CLIENT_COMMIT
            or any(summary.get(key) is not False for key in ("sustainedTPSQualified", "publicDeployment", "nativeGrant"))
            or not isinstance(summary.get("rows"), list) or len(summary["rows"]) != 3):
        raise RuntimeError("signed-business source/result DATA boundary differs")
    fields = {"kind", "outcome", "transactionHash", "height", "finalizedBusinesses", "rejectedMembers", "registrationFinalized", "initialSubmissionUnknown", "independentFinalityVerified", "offerToIndependentFinalityNs"}
    expected = (("account_initial", "succeeded", 0, 0, True),
                ("pq_transfer", "succeeded", 1, 0, False),
                ("pq_whole", "partial", 1, 1, False))
    prior, hashes = evidence["activationHeight"] - 1, set()
    for row, (kind, outcome, admitted, rejected, registered) in zip(summary["rows"], expected):
        if (not isinstance(row, dict) or set(row) != fields or row.get("kind") != kind or row.get("outcome") != outcome
                or type(row.get("height")) is not int or not prior < row["height"] <= evidence["coldRestart"]["finalHeight"]
                or type(row.get("finalizedBusinesses")) is not int or row["finalizedBusinesses"] != admitted
                or type(row.get("rejectedMembers")) is not int or row["rejectedMembers"] != rejected
                or row.get("registrationFinalized") is not registered or type(row.get("initialSubmissionUnknown")) is not bool
                or row.get("independentFinalityVerified") is not True
                or type(row.get("offerToIndependentFinalityNs")) is not int or not 0 < row["offerToIndependentFinalityNs"] <= CAPS["activeMs"] * 1000000
                or not isinstance(row.get("transactionHash"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["transactionHash"])
                or row["transactionHash"] == "0" * 64 or row["transactionHash"] in hashes):
            raise RuntimeError("actual initial/Member/partial business or independent finality row differs")
        prior = row["height"]
        hashes.add(row["transactionHash"])
    evidence["signedBusiness"] = summary
    return evidence


def validate_consensus_fresh_business_result(stdout, stderr, terminal_code, manifest, child_pid):
    # Only the pinned Go selector performs cryptography/real four-node effects.
    # This gate binds its complete DATA receipt to admission, actual Popen PID
    # and original numeric observations; it never invents missing RPC latency.
    def require(ok, message):
        if not ok:
            raise RuntimeError("fresh business result: " + message)
    def fields(value, names):
        return isinstance(value, dict) and set(value) == set(names.split())
    def integer(value, maximum=120000000000, minimum=0):
        return type(value) is int and minimum <= value <= maximum
    def decimal(value, maximum=(1 << 63) - 1, minimum=0):
        return isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value) is not None and minimum <= int(value) <= maximum
    def hex_hash(value, prefix=False):
        return isinstance(value, str) and re.fullmatch(("0x" if prefix else "") + r"[0-9a-f]{64}", value) is not None and value != ("0x" if prefix else "") + "0" * 64
    require(type(terminal_code) is int and terminal_code == 0 and stderr == b"", "actual successful terminal code and empty stderr required")
    text = stdout.decode("utf8", errors="strict")
    require(not re.search(r"(?:--- (?:SKIP|FAIL):|^FAIL(?:\s|$)|^panic:|^fatal error:)", text, re.M), "skip/failure cannot qualify")
    require(re.findall(r"^=== RUN   (.+)$", text, re.M) == [FRESH_BUSINESS_E2E_TEST]
            and re.findall(r"^--- PASS: (\S+) \([0-9]+(?:\.[0-9]+)?s\)$", text, re.M) == [FRESH_BUSINESS_E2E_TEST]
            and len(re.findall(r"^PASS$", text, re.M)) == 1 and text.splitlines()[-1:] == ["PASS"], "exact sole fresh RUN/PASS markers required")
    markers = list(re.finditer(r"^[ \t]+pq_network_fresh_business_test\.go:[1-9][0-9]*: PQ_NETWORK_FRESH_BUSINESS_SUMMARY (\{[^\r\n]+\})$", text, re.M))
    require(len(markers) == 1 and text.index("=== RUN   ") < markers[0].start() < text.index("--- PASS: "), "one original fresh summary before PASS required")
    require(len(markers[0][1].encode("utf8")) <= 256 << 10, "original Go public summary bound exceeded")
    summary = unique_json(markers[0][1])
    require(fields(summary, "version syntheticOnly protocolCommit clientCommit clientTree binaries sourceLeaves arms phaseRows clockDomain sameVM sameProcessPID businessFinalized birthsExcluded sustainedTPSQualified publicDeployment nativeGrant"), "closed fresh summary required")
    require(fields(manifest, "version protocolCommit performanceClientCommit performanceClientTree sourceRoot sourceLeaves binaries")
            and manifest["version"] == "YNX-PQ-NETWORK-FRESH-BUSINESS-BUILD/v1"
            and manifest["performanceClientCommit"] == FRESH_BUSINESS_CLIENT_COMMIT and manifest["performanceClientTree"] == FRESH_BUSINESS_CLIENT_TREE
            and isinstance(manifest["protocolCommit"], str) and re.fullmatch(r"[0-9a-f]{40}", manifest["protocolCommit"]) is not None and manifest["protocolCommit"] != "0" * 40
            and isinstance(manifest["binaries"], dict) and set(manifest["binaries"]) == set(BUSINESS_BINARIES)
            and summary["version"] == "YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1"
            and summary["syntheticOnly"] is True and summary["sameVM"] is True
            and summary["protocolCommit"] == manifest.get("protocolCommit")
            and summary["clientCommit"] == FRESH_BUSINESS_CLIENT_COMMIT and summary["clientTree"] == FRESH_BUSINESS_CLIENT_TREE
            and summary["binaries"] == manifest.get("binaries") and summary["sourceLeaves"] == manifest.get("sourceLeaves")
            and summary["sourceLeaves"] == {key: pin["sha256"] for key, pin in consensus_business_source_pins(True).items()}
            and integer(child_pid, (1 << 31) - 1, 1) and type(summary["sameProcessPID"]) is int and summary["sameProcessPID"] == child_pid
            and summary["clockDomain"] == "pq-fresh:" + str(child_pid)
            and type(summary["businessFinalized"]) is int and summary["businessFinalized"] == 32
            and type(summary["birthsExcluded"]) is int and summary["birthsExcluded"] == 34
            and all(summary[key] is False for key in ("sustainedTPSQualified", "publicDeployment", "nativeGrant")), "source, binary, PID/clock or DATA boundary differs")
    arms = summary["arms"]
    require(isinstance(arms, list) and len(arms) == 2, "both complete paired arms required")
    seen_owners, seen_hashes, arm_by_name, missing_rpc = set(), set(), {}, 0
    report_fields = "readbackIndexMode readbackOnly submissionToFirstCommittedRPCObservationNs firstCommittedRPCObservationSource firstCommittedRPCHeight firstCommittedRPCIndex abciTransactionHash nativeTransactionHash transactionType executionHeight cometIndex submissionAttempts originalReadbackAttempts initialSubmissionUnknown members effectiveBusinessIncludedObserved rejectedMembers effectiveBusinessFinalized independentFinalityVerified registrationFinalized consensusExecutionOutcome finalizedBusinessHashes actualOfferToFinalityMeasured sustainedTPSQualified status proofVerificationStatus proofVerifierSha256 trustContextSha256 verifierPreparationNs verifierProcessNs verifierEvidenceDurabilityNs verifierResultValidationNs proofVerificationNs clientPhases"
    phase_fields = "inputPreparationNs intentDurabilityNs submissionHTTPNs submissionValidationNs originalReadbackHTTPNs originalReadbackValidationNs proofCollectionHTTPNs collectorIdentityValidationNs proofDurabilityNs"
    bool_fields = "readbackOnly initialSubmissionUnknown independentFinalityVerified registrationFinalized actualOfferToFinalityMeasured sustainedTPSQualified".split()
    count_fields = "submissionAttempts originalReadbackAttempts members effectiveBusinessIncludedObserved rejectedMembers effectiveBusinessFinalized".split()
    proof_times = "verifierPreparationNs verifierProcessNs verifierEvidenceDurabilityNs verifierResultValidationNs proofVerificationNs".split()
    for arm, name, mode in zip(arms, ("before", "after"), ("decode-index-again", "reuse-validated-index")):
        require(fields(arm, "name readbackIndexMode genesisSHA256 activationHeight initialHeight finalHeight births rows offeredBusiness finalizedBusiness maximumInFlight offeredRatePerSecond businessWindowNs businessStartNs clockOrigin clock sustainedTPSQualified"), "closed arm required")
        require(arm["name"] == name and arm["readbackIndexMode"] == mode and hex_hash(arm["genesisSHA256"])
                and all(integer(arm[key], (1 << 63) - 1, 1) for key in ("initialHeight", "activationHeight", "finalHeight"))
                and arm["initialHeight"] <= arm["activationHeight"] < arm["finalHeight"]
                and arm["finalHeight"] - arm["initialHeight"] < 48
                and type(arm["offeredBusiness"]) is int and arm["offeredBusiness"] == 16
                and type(arm["finalizedBusiness"]) is int and arm["finalizedBusiness"] == 16
                and integer(arm["maximumInFlight"], 4, 1) and type(arm["offeredRatePerSecond"]) is int and arm["offeredRatePerSecond"] == 2
                and integer(arm["businessWindowNs"], minimum=1) and integer(arm["businessStartNs"])
                and arm["clock"] == FRESH_BUSINESS_CLOCK and arm["clockOrigin"] == "paired selector origin shared by both arms and all Host/ABCI offsets; child client durations use their own clock"
                and arm["sustainedTPSQualified"] is False, "arm count, rate, height or original clock differs")
        if name == "after":
            require(arm["businessStartNs"] >= arms[0]["businessStartNs"] + arms[0]["businessWindowNs"]
                    and arm["genesisSHA256"] != arms[0]["genesisSHA256"], "arms must be ordered fresh independent sources")
        births, rows = arm["births"], arm["rows"]
        require(isinstance(births, list) and len(births) == 17 and isinstance(rows, list) and len(rows) == 16, "exact seventeen births and sixteen business rows per arm required")
        arm_by_name[name] = arm
        senders = set()
        for birth in births:
            require(fields(birth, "owner fundingHash abciTransactionHash nativeTransactionHash height index activationHeight registrationFinalized finalizedBusinessMembers")
                    and isinstance(birth["owner"], str) and re.fullmatch(r"0x[0-9a-f]{40}", birth["owner"]) is not None
                    and birth["owner"] not in seen_owners
                    and all(hex_hash(birth[key], True) for key in ("fundingHash", "abciTransactionHash", "nativeTransactionHash"))
                    and integer(birth["height"], arm["finalHeight"] - 1, arm["activationHeight"])
                    and integer(birth["activationHeight"], arm["finalHeight"], birth["height"] + 1)
                    and integer(birth["index"], (1 << 31) - 1) and birth["registrationFinalized"] is True
                    and type(birth["finalizedBusinessMembers"]) is int and birth["finalizedBusinessMembers"] == 0, "birth cannot be reused or counted as business")
            seen_owners.add(birth["owner"])
        previous_offer = None
        for ordinal, row in enumerate(rows):
            require(fields(row, "sender nativeHash abciHash height index offerOffsetNs offerLatenessNs observedCompletionNs independentCompletionNs offerToIndependentNs independentTimingMeaning submission readback"), "closed original transfer row required")
            require(row["sender"] in {birth["owner"] for birth in births[1:]} and row["sender"] not in senders
                    and hex_hash(row["nativeHash"], True) and hex_hash(row["abciHash"], True)
                    and row["nativeHash"] not in seen_hashes and row["abciHash"] not in seen_hashes
                    and row["nativeHash"] != row["abciHash"] and integer(row["height"], arm["finalHeight"] - 1, arm["activationHeight"])
                    and integer(row["index"], (1 << 31) - 1)
                    and all(integer(row[key]) for key in ("offerOffsetNs", "offerLatenessNs", "observedCompletionNs", "independentCompletionNs", "offerToIndependentNs"))
                    and arm["businessStartNs"] <= row["offerOffsetNs"] <= row["observedCompletionNs"] <= row["independentCompletionNs"]
                    and row["independentCompletionNs"] <= arm["businessStartNs"] + arm["businessWindowNs"] <= 120000000000
                    and row["offerLatenessNs"] == row["offerOffsetNs"] - (arm["businessStartNs"] + ordinal * 500000000)
                    and (previous_offer is None or row["offerOffsetNs"] - previous_offer >= 500000000)
                    and row["offerToIndependentNs"] == row["independentCompletionNs"] - row["offerOffsetNs"] > 0
                    and row["independentTimingMeaning"] == "upper-bound observation including queued proof verification; not consensus formation time", "original business identity or monotonic times differ")
            senders.add(row["sender"]); seen_hashes.update((row["nativeHash"], row["abciHash"]))
            previous_offer = row["offerOffsetNs"]
            for report, readback in ((row["submission"], False), (row["readback"], True)):
                require(fields(report, report_fields) and report["readbackIndexMode"] == mode
                        and all(type(report[key]) is bool for key in bool_fields)
                        and all(integer(report[key], (1 << 31) - 1) for key in count_fields)
                        and all(decimal(report[key], 120000000000) for key in proof_times)
                        and fields(report["clientPhases"], phase_fields) and all(decimal(value, 120000000000) for value in report["clientPhases"].values())
                        and report["readbackOnly"] is readback and report["abciTransactionHash"] == row["abciHash"] and report["nativeTransactionHash"] == row["nativeHash"]
                        and report["transactionType"] == "pq_transfer" and report["members"] == 1
                        and report["actualOfferToFinalityMeasured"] is False and report["sustainedTPSQualified"] is False, "original client record or decimal duration differs")
                if readback:
                    require(report["submissionAttempts"] == 0 and report["originalReadbackAttempts"] == 1 and report["status"] == "committed_observed"
                            and report["effectiveBusinessIncludedObserved"] == 1 and report["rejectedMembers"] == 0
                            and report["effectiveBusinessFinalized"] == 1 and report["independentFinalityVerified"] is True and report["registrationFinalized"] is False
                            and report["consensusExecutionOutcome"] == "succeeded" and report["finalizedBusinessHashes"] == [row["nativeHash"]]
                            and report["proofVerificationStatus"] == "verified_original_transaction"
                            and report["proofVerifierSha256"] == manifest["binaries"]["ynx-consensus-proof-verify"]["sha256"] and hex_hash(report["trustContextSha256"])
                            and report["executionHeight"] == str(row["height"]) and type(report["cometIndex"]) is int and report["cometIndex"] == row["index"]
                            and report["submissionToFirstCommittedRPCObservationNs"] is None, "independent H/H+1 readback proof/effect required")
                else:
                    duration = report["submissionToFirstCommittedRPCObservationNs"]
                    require(report["submissionAttempts"] == 1 and report["independentFinalityVerified"] is False and report["effectiveBusinessFinalized"] == 0
                            and report["status"] in ("committed_observed", "submission_unknown"), "one original offer only; no synthetic finality")
                    if duration is None:
                        require(report["firstCommittedRPCObservationSource"] == "" and report["firstCommittedRPCHeight"] == "0" and report["firstCommittedRPCIndex"] is None
                                and report["status"] == "submission_unknown" and report["initialSubmissionUnknown"] is True, "missing first RPC stays missing/UNKNOWN")
                        missing_rpc += 1
                    else:
                        require(decimal(duration, 120000000000) and report["firstCommittedRPCObservationSource"] in ("post_response", "original_get")
                                and report["firstCommittedRPCHeight"] == str(row["height"]) and type(report["firstCommittedRPCIndex"]) is int and report["firstCommittedRPCIndex"] == row["index"], "first RPC needs its actual duration and exact coordinate")
                    if report["status"] == "committed_observed":
                        require(report["effectiveBusinessIncludedObserved"] == 1 and report["rejectedMembers"] == 0 and duration is not None, "committed RPC requires original observation")
    phases = summary["phaseRows"]
    require(isinstance(phases, list) and 0 < len(phases) <= 2 * 4 * 48 * 2, "bounded phaseRows required")
    pairs, masks, heights = {}, {}, {"before": set(), "after": set()}
    for phase in phases:
        is_commit = isinstance(phase, dict) and phase.get("phase") == "commit"
        require(fields(phase, "arm nodeIndex height clockDomain startNs endNs phase" + (" commitTiming" if is_commit else ""))
                and phase["arm"] in arm_by_name and integer(phase["nodeIndex"], 3)
                and decimal(phase["height"], minimum=1) and phase["clockDomain"] == summary["clockDomain"]
                and integer(phase["startNs"]) and integer(phase["endNs"]) and phase["startNs"] <= phase["endNs"]
                and phase["phase"] in ("finalize", "commit"), "exact numeric phase coordinate/domain required")
        arm, height = phase["arm"], int(phase["height"])
        require(arm_by_name[arm]["initialHeight"] <= height <= arm_by_name[arm]["finalHeight"], "phase height outside its original arm")
        key = (arm, phase["nodeIndex"], height)
        pair = pairs.setdefault(key, {})
        require(phase["phase"] not in pair, "duplicate actual node/height phase")
        pair[phase["phase"]] = phase
        masks[(arm, height)] = masks.get((arm, height), 0) | (1 << phase["nodeIndex"])
        heights[arm].add(height)
        if is_commit:
            timing = phase["commitTiming"]
            require(fields(timing, "height storage durable elapsedNs payloadBytes stagesNs")
                    and type(timing["height"]) is int and timing["height"] == height and timing["durable"] is True
                    and isinstance(timing["storage"], str) and 0 < len(timing["storage"]) <= 64
                    and integer(timing["elapsedNs"], phase["endNs"] - phase["startNs"])
                    and integer(timing["payloadBytes"], fixed_caps(FRESH_BUSINESS_E2E_PROFILE)["privateBytes"])
                    and isinstance(timing["stagesNs"], dict) and all(isinstance(k, str) and integer(v) for k, v in timing["stagesNs"].items()), "original durable numeric commitTiming required")
    require(all(set(pair) == {"finalize", "commit"} and pair["finalize"]["endNs"] <= pair["commit"]["startNs"] for pair in pairs.values())
            and all(mask == 15 for mask in masks.values()), "every height requires four ordered Finalize/Commit pairs")
    for name, arm in arm_by_name.items():
        observed = heights[name]
        require(observed and max(observed) == arm["finalHeight"] and max(observed) - min(observed) + 1 == len(observed)
                and all((name, row["height"]) in masks and (name, row["height"] + 1) in masks for row in arm["rows"])
                and all((name, birth["height"]) in masks for birth in arm["births"]), "phase coverage must retain original birth heights, empty successors and every business H/H+1")
    return dict(freshBusiness=summary, resultSHA256=hashlib.sha256(markers[0][1].encode("utf8")).hexdigest(),
                firstRPCMissing=missing_rpc, initialUNKNOWN=sum(row["submission"]["initialSubmissionUnknown"] for arm in arms for row in arm["rows"]))


def validate_consensus_network_result(stdout, stderr, terminal_code, test_name):
    # These log controls are necessary evidence from the pinned test, not a
    # substitute for that test's real Comet/cryptographic assertions. Root's
    # normal CI compilation is the separate provenance boundary for the ELF.
    if type(terminal_code) is not int or terminal_code != 0:
        raise RuntimeError("consensus E2E needs actual terminal code zero")
    text = stdout.decode("utf8", errors="strict")
    errors_text = stderr.decode("utf8", errors="strict")
    if re.search(r"(?:--- (?:SKIP|FAIL):|^FAIL(?:\s|$)|^panic:|^fatal error:)", text + "\n" + errors_text, re.M):
        raise RuntimeError("consensus E2E skip/failure cannot qualify")
    run = re.findall(r"^=== RUN   (.+)$", text, re.M)
    passed = re.findall(r"^--- PASS: (\S+) \([0-9]+(?:\.[0-9]+)?s\)$", text, re.M)
    if (run != [test_name] or passed != [test_name] or len(re.findall(r"^PASS$", text, re.M)) != 1
            or text.splitlines()[-1:] != ["PASS"]):
        raise RuntimeError("exact sole consensus E2E RUN/PASS markers required")
    prefix = r"^[ \t]+pq_network_e2e_test\.go:[0-9]+: "
    patterns = [
        prefix + r"actual Ed25519 network: initial Comet height=([1-9][0-9]*), ordinary transaction height=([1-9][0-9]*), Counter storage=12$",
        prefix + r"independent schedule pin=([0-9a-f]{64}) registryHeight=([1-9][0-9]*) P=([1-9][0-9]*) U=([1-9][0-9]*) A=([1-9][0-9]*)$",
        prefix + r"actual 3/4 PQ Commit: height=([1-9][0-9]*) ABCI transaction=(0x[0-9a-f]{64})$",
        prefix + r"PQ_NETWORK_E2E_SUMMARY (\{[^\r\n]+\})$",
    ]
    found = [list(re.finditer(pattern, text, re.M)) for pattern in patterns]
    if any(len(matches) != 1 for matches in found):
        raise RuntimeError("actual Ed/schedule/3of4 PQ/cold-restart evidence markers required exactly once")
    ed, schedule, pq, final = [matches[0] for matches in found]
    initial, ordinary = map(int, ed.groups())
    pin, registry, p, u, a = schedule.groups()
    registry, p, u, a = map(int, (registry, p, u, a))
    height, tx_hash = int(pq[1]), pq[2]
    pass_at = text.index("--- PASS: " + test_name + " (")
    if (not ed.start() < schedule.start() < pq.start() < final.start() < pass_at or ordinary < initial or registry < ordinary
            or p != registry + 1 or a != registry + 4 or u != a - 2 or height < a
            or pin == "0" * 64 or tx_hash == "0x" + "0" * 64):
        raise RuntimeError("consensus E2E evidence ordering/heights/identity mismatch")
    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise RuntimeError("duplicate consensus E2E summary field")
            value[key] = item
        return value
    summary = json.loads(final[1], object_pairs_hook=unique_object)
    flags = ("syntheticOnly", "nativeReceiptsVerified", "traceLineageVerified", "threeOfFourCommitVerified",
             "twoOfFourRejected", "coldRestartVerified", "nodeStopAndHostCloseCompleted")
    integers = ("initialHeight", "finalHeight", "blockCount", "preservedOriginalBlocks", "ordinaryTransferHeight", "pqTransferHeight")
    fields = {"version", "scheduleHash", "pqTransactionHash", "nodes", *flags, *integers}
    if (set(summary) != fields or summary.get("version") != "ynx-pq-four-node-e2e/v1"
            or any(summary.get(key) is not True for key in flags)
            or any(type(summary.get(key)) is not int or not 0 < summary[key] < 1 << 63 for key in integers)
            or summary["initialHeight"] != initial or summary["ordinaryTransferHeight"] != ordinary
            or summary["pqTransferHeight"] != height or summary["pqTransactionHash"] != tx_hash
            or summary["scheduleHash"] != pin or summary["finalHeight"] < height
            or summary["blockCount"] != summary["finalHeight"] - initial + 1 or summary["blockCount"] > 48
            or not height - initial + 1 <= summary["preservedOriginalBlocks"] <= summary["blockCount"]):
        raise RuntimeError("consensus E2E final cold-restart summary does not bind original evidence")
    nodes = summary["nodes"]
    if not isinstance(nodes, list) or len(nodes) != 4:
        raise RuntimeError("four final restarted node records required")
    common = None
    for index, node in enumerate(nodes):
        if (not isinstance(node, dict) or set(node) != {"index", "height", "appHash", "blockHash", "legacyHRS", "pqHRS"}
                or type(node.get("index")) is not int or node["index"] != index
                or type(node.get("height")) is not int or node["height"] != summary["finalHeight"]):
            raise RuntimeError("final node index/height mismatch")
        for key in ("appHash", "blockHash"):
            if not isinstance(node[key], str) or not re.fullmatch(r"[0-9a-f]{64}", node[key]) or node[key] == "0" * 64:
                raise RuntimeError("final node checkpoint hash missing")
        identity = (node["height"], node["appHash"], node["blockHash"])
        if common is not None and common != identity:
            raise RuntimeError("four restarted nodes disagree on final checkpoint")
        common = identity
        for key, max_step in (("legacyHRS", 3), ("pqHRS", 4)):
            hrs = node[key]
            if (not isinstance(hrs, dict) or set(hrs) != {"height", "round", "step"}
                    or any(type(hrs[k]) is not int for k in hrs)
                    or not 0 < hrs["height"] <= summary["finalHeight"] + 1
                    or not 0 <= hrs["round"] < 1 << 31 or not 1 <= hrs["step"] <= max_step):
                raise RuntimeError("actual original signer H/R/S missing or out of range")
    return dict(initialHeight=initial, ordinaryHeight=ordinary, registryHeight=registry,
                paramsUpdateHeight=p, validatorUpdateHeight=u, activationHeight=a,
                scheduleSHA256=pin, pqCommitHeight=height, pqTransactionHash=tx_hash, coldRestart=summary)


def validate_consensus_remote_e2e_result(stdout, stderr, terminal_code, binary_sha256):
    evidence = validate_consensus_network_result(stdout, stderr, terminal_code, REMOTE_E2E_TEST)
    text = stdout.decode("utf8", errors="strict")
    matches = list(re.finditer(r"^[ \t]+pq_network_remote_e2e_test\.go:[0-9]+: PQ_NETWORK_REMOTE_E2E_SUMMARY (\{[^\r\n]+\})$", text, re.M))
    if len(matches) != 1:
        raise RuntimeError("one original normal remote signer network summary required")
    marker = matches[0]
    if not (text.index("actual 3/4 PQ Commit:") < marker.start() < text.index("PQ_NETWORK_E2E_SUMMARY ")):
        raise RuntimeError("remote summary must follow the actual PQ commit and precede final cold-restart evidence")
    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise RuntimeError("duplicate remote network evidence field")
            value[key] = item
        return value
    summary = json.loads(marker[1], object_pairs_hook=unique_object)
    true_flags = ("syntheticOnly", "checkpointPathSharedWithOriginalApp", "originalHRSColdRecovered",
                  "remoteProposalVerified", "remotePrevoteVerified", "remotePrecommitVerified",
                  "remoteThreeOfFourCommitVerified", "remoteColdCommitVerified")
    false_flags = ("automaticReconnect", "localSignerForRemoteValidator", "publicDeployment")
    counts = ("proposalCount", "prevoteCount", "precommitCount")
    heights = ("firstRemoteHeight", "lastRemoteHeight", "threeOfFourCommitHeight", "coldCommitHeight")
    fields = {"version", "remoteValidatorIndex", "normalBinarySHA256", "daemonStarts", "daemonExits",
              *true_flags, *false_flags, *counts, *heights}
    if (not isinstance(summary, dict) or set(summary) != fields
            or summary.get("version") != "ynx-pq-four-node-remote-e2e/v1"
            or not isinstance(binary_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", binary_sha256)
            or binary_sha256 == "0" * 64 or summary.get("normalBinarySHA256") != binary_sha256
            or type(summary.get("remoteValidatorIndex")) is not int or summary["remoteValidatorIndex"] != 0
            or any(type(summary.get(key)) is not int or summary[key] != 2 for key in ("daemonStarts", "daemonExits"))
            or any(summary.get(key) is not True for key in true_flags)
            or any(summary.get(key) is not False for key in false_flags)
            or any(type(summary.get(key)) is not int or not 0 < summary[key] < 1 << 63 for key in (*counts, *heights))
            or not evidence["activationHeight"] <= summary["firstRemoteHeight"] <= summary["threeOfFourCommitHeight"]
            or summary["threeOfFourCommitHeight"] != evidence["pqCommitHeight"]
            or not summary["threeOfFourCommitHeight"] < summary["coldCommitHeight"] <= summary["lastRemoteHeight"] <= evidence["coldRestart"]["finalHeight"] + 1):
        raise RuntimeError("remote network evidence does not bind the normal daemon, actual votes and cold process restart")
    evidence["remoteSigner"] = summary
    return evidence


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


def run(prepared, receipt, case_n=1, consensus_e2e=False, consensus_e2e_retained_history=False,
        consensus_remote_e2e_retained_history=False, consensus_signed_business=False,
        consensus_fresh_paired_business=False):
    profile = selected_profile(consensus_e2e, consensus_e2e_retained_history,
                               consensus_remote_e2e_retained_history, consensus_signed_business,
                               consensus_fresh_paired_business)
    caps = fixed_caps(profile)
    remote_e2e = profile == REMOTE_E2E_RETAINED_HISTORY_PROFILE
    fresh_business = profile == FRESH_BUSINESS_E2E_PROFILE
    business_e2e = profile in (BUSINESS_E2E_PROFILE, FRESH_BUSINESS_E2E_PROFILE)
    consensus_e2e = profile is not None
    if sys.platform != "linux":
        raise RuntimeError("Linux /proc/smaps_rollup/subreaper required; no macOS substitution")
    started = time.monotonic()
    result = dict(schema=1, kind="single-PQ-paired-Linux-CI-window", launcher=os.getpid(),
                  startedAtUnix=time.time(), caps=caps, firstCause=None, samples=[], known={},
                  child=None, cleanupComplete=False, admissionPlatform="Linux, not macOS dispatch1")
    if consensus_e2e:
        result["kind"] = "four-validator-PQ-consensus-E2E-Linux-CI-window"
    if remote_e2e:
        result["kind"] = "four-validator-PQ-consensus-remote-E2E-Linux-CI-window"
    if business_e2e:
        result["kind"] = "four-validator-PQ-signed-business-E2E-Linux-CI-window"
    if fresh_business:
        result["kind"] = "four-validator-PQ-fresh-paired-business-E2E-Linux-CI-window"
    child = None
    selector = selectors.DefaultSelector()
    logs = {}
    known = {}
    case = build = None
    remote_immutable = None
    business_immutable = None
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
        enforce(item, initial, profile=profile)
        return rows, ids

    try:
        prepared_raw = bounded(prepared, 1 << 20)
        plan = unique_json(prepared_raw) if business_e2e else json.loads(prepared_raw)
        inherited_environment = dict(os.environ)
        if consensus_e2e:
            if case_n != 1:
                raise RuntimeError("consensus E2E cannot select a paired benchmark case")
            if business_e2e:
                source, case, command, pinned_env = validate_consensus_business_recipe(plan, prepared, inherited_environment, fresh_business)
                business_immutable = validate_consensus_business_files(plan, source, case.with_name(case.name + ".build"), fresh=fresh_business)
            elif remote_e2e:
                source, case, command, pinned_env = validate_consensus_remote_e2e_recipe(
                    plan, prepared, inherited_environment)
                remote_immutable = validate_consensus_remote_e2e_files(
                    plan, source, case.with_name(case.name + ".build"))
            else:
                source, case, command, pinned_env = validate_consensus_e2e_recipe(plan, prepared, profile=profile)
        else:
            if "profile" in plan or "caps" in plan:
                raise RuntimeError("explicit consensus E2E profile flag required; paired caps are fixed")
            source, case, command, pinned_env = validate_recipe(plan, prepared, case_n=case_n)
        environment = consensus_runtime_environment(pinned_env, case, case.with_name(case.name + ".build"),
                                                    profile, inherited_environment)
        if receipt.exists() or receipt.is_symlink() or case == receipt.parent or case in receipt.parents:
            raise RuntimeError("new guard receipt must be outside private case")
        result["preparedSHA256"] = digest(prepared)
        result["sourceCommit"] = plan["commit"]
        if consensus_e2e:
            result.update(profile=profile, testSourceSHA256=E2E_SOURCE_SHA256,
                          binaryPin=plan["binaryPin"], command=command,
                          workingDirectory=plan["workingDirectory"], environment=pinned_env)
            if remote_e2e:
                result.update(remoteSignerPin=plan["remoteSignerPin"], sourcePins=plan["sourcePins"])
            if business_e2e:
                result.update(businessManifestPin=plan["businessManifestPin"], sourcePins=plan["sourcePins"],
                              performanceClientCommit=FRESH_BUSINESS_CLIENT_COMMIT if fresh_business else BUSINESS_CLIENT_COMMIT)
                if fresh_business:
                    result["performanceClientTree"] = FRESH_BUSINESS_CLIENT_TREE
        else:
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
            if remote_e2e:
                validate_consensus_remote_e2e_files(plan, source, case.with_name(case.name + ".build"), remote_immutable)
            if business_e2e:
                validate_consensus_business_files(plan, source, case.with_name(case.name + ".build"), business_immutable, fresh_business)
        source_check()
        for name in ("pq-paired-result.json", "pq-paired-result.json.members.snapshot.json", "pq-paired-result.json.whole.snapshot.json", "tmp", "go.stdout.log", "go.stderr.log"):
            if (case / name).exists() or (case / name).is_symlink():
                raise RuntimeError("preserve prior case artifacts")
        build = case.with_name(case.name + ".build")
        if consensus_e2e:
            if build == receipt.parent or build in receipt.parents:
                raise RuntimeError("new guard receipt must be outside monitored build")
            # Normal CI already compiled this one pinned ELF. Freshness was
            # checked without rejecting that required pre-existing artifact.
            validate_consensus_e2e_binary(plan, build)
        else:
            build.mkdir(mode=0o700)
        if remote_e2e or business_e2e:
            (build / "tmp").mkdir(mode=0o700); (case / "tmp").mkdir(mode=0o700)
        else:
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
        if consensus_e2e:
            if remote_e2e:
                validate_consensus_remote_e2e_files(plan, source, build, remote_immutable)
            if business_e2e:
                validate_consensus_business_files(plan, source, build, business_immutable, fresh_business)
            executable = str(validate_consensus_e2e_binary(plan, build))
            working_directory = source / "internal/consensus"
            result["testExecutable"] = dict(path=executable, sha256=plan["binaryPin"]["sha256"])
        else:
            executable = shutil.which("go")
            if not executable:
                raise RuntimeError("configured Go executable missing")
            working_directory = source
            result["goExecutable"] = dict(path=executable, sha256=digest(executable))
        for key in ("stdout", "stderr"):
            logs[key] = open(case / ("go." + key + ".log"), "xb", buffering=0)
        child = subprocess.Popen([executable] + command[1:], cwd=working_directory, env=environment,
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
        # Neither a skipped Go test nor a leftover artifact can qualify success.
        if consensus_e2e:
            validate_consensus_e2e_binary(plan, build)
            stdout, stderr = (bounded(case / "go.stdout.log", CAPS["logBytes"]),
                              bounded(case / "go.stderr.log", CAPS["logBytes"]))
            if fresh_business:
                manifest_raw = bounded(build / "business-manifest.json", 64 << 10)
                if hashlib.sha256(manifest_raw).hexdigest() != plan["businessManifestPin"]["sha256"]:
                    raise RuntimeError("fresh result manifest differs from independent admission pin")
                manifest = unique_json(manifest_raw)
                result["networkEvidence"] = validate_consensus_fresh_business_result(stdout, stderr, child.returncode, manifest, child.pid)
                result["resultSHA256"] = result["networkEvidence"]["resultSHA256"]
            elif business_e2e:
                result["networkEvidence"] = validate_consensus_business_result(stdout, stderr, child.returncode, plan["commit"])
            elif remote_e2e:
                result["networkEvidence"] = validate_consensus_remote_e2e_result(
                    stdout, stderr, child.returncode, plan["remoteSignerPin"]["sha256"])
            else:
                result["networkEvidence"] = validate_consensus_e2e_result(stdout, stderr, child.returncode)
            result["stdoutSHA256"] = digest(case / "go.stdout.log")
            result["stderrSHA256"] = digest(case / "go.stderr.log")
        else:
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
        if consensus_e2e:
            result["cleanupPolicy"] = "105s active / 120s total; owned identities receive TERM then KILL after 2s. The remaining budget is not a guaranteed 15s graceful Node.Stop window."
        with open(receipt, "x", encoding="utf8") as handle:
            json.dump(result, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        print(json.dumps({k: result[k] for k in ("firstCause", "child", "cleanupComplete", "elapsedMs")}), flush=True)
    return 1 if result["firstCause"] else 0


def argument_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--case-n", type=int, choices=(1, 16), default=1, help="explicit Root-scheduled case only; does not grant execution or expand budgets")
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--execute", action="store_true")
    profiles = parser.add_mutually_exclusive_group()
    profiles.add_argument("--consensus-e2e", action="store_true", help="original 32 MiB separately authorized four-node E2E using only a pinned precompiled consensus.test")
    profiles.add_argument("--consensus-e2e-retained-history", action="store_true", help="separately authorized retained-history-v1 E2E: fixed 512 MiB private files; every other original limit unchanged")
    profiles.add_argument("--consensus-remote-e2e-retained-history", action="store_true", help="separate explicit remote signer retained-history-v1 profile; fixed two binaries, four source pins and unchanged resource limits")
    profiles.add_argument("--consensus-signed-business", action="store_true", help="separately authorized signed-business-v1 four-node profile; four pinned ELFs, original independent proofs, unchanged retained-history resources")
    profiles.add_argument("--consensus-fresh-paired-business", action="store_true", help="separately authorized fresh paired before/after four-node business; exact 70e7 client/whole tree, three source leaves, unchanged resources")
    return parser


def main(argv=None):
    parser = argument_parser()
    args = parser.parse_args(argv)
    profile = selected_profile(args.consensus_e2e, args.consensus_e2e_retained_history,
                               args.consensus_remote_e2e_retained_history, args.consensus_signed_business,
                               args.consensus_fresh_paired_business)
    if not args.execute:
        print(json.dumps(dict(status="prepared_only_no_Go_or_probe_started", supported=sys.platform == "linux", caps=fixed_caps(profile),
                              requires="Linux readable /proc + smaps_rollup, subreaper, exact prepared source, fresh Root isolated CI grant; not a macOS native-guard replacement")))
        return 0
    elif not args.prepared or not args.receipt:
        parser.error("--prepared and a new --receipt outside case are required")
    else:
        options = dict(case_n=args.case_n, consensus_e2e=args.consensus_e2e,
                       consensus_e2e_retained_history=args.consensus_e2e_retained_history)
        if args.consensus_remote_e2e_retained_history:
            options["consensus_remote_e2e_retained_history"] = True
        if args.consensus_signed_business:
            options["consensus_signed_business"] = True
        if args.consensus_fresh_paired_business:
            options["consensus_fresh_paired_business"] = True
        return run(args.prepared.resolve(), args.receipt.resolve(), **options)


if __name__ == "__main__":
    sys.exit(main())
