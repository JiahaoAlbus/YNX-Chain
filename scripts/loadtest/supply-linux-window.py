#!/usr/bin/env python3
"""Fixed private Supply probe; default prints a recipe and launches nothing.

Linux evidence is a separate environment, never a matched Darwin comparison.
Reuse the original native resource monitor without changing its global caps.
"""
import argparse
import ctypes
import errno
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pq_native", HERE / "pq-paired-linux-window.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
PROFILE = dict(name="supply-256x4", senders=256, rounds=4, offeredRate=512,
               concurrency=4, observers=4, activeMs=45000, cleanupMs=15000,
               totalMs=60000, ownedProcesses=10, longLivedChildren=9,
               ownedRSSBytes=1 << 30, privateBytes=32 << 20, threads=320,
               availableMemoryFloorBytes=native.CAPS["availableMemoryFloorBytes"])
PROFILES = {"supply-256x4": PROFILE,
            "supply-512x2": dict(PROFILE, name="supply-512x2", senders=512, rounds=2)}
ENV = dict(GOMAXPROCS="1", GOGC="100", GOMEMLIMIT="off")
BINARIES = ("ynx-abci", "cometbft", "ynx-consensus-perf-fixture", "ynx-consensus-perf-client")
PAIR_CAPS = dict(totalMs=120000, retainedBytes=64 << 20, logBytes=2 << 20,
                 buildBytes=1 << 30, metadataReserveMs=500)


def recipe(transport="socket", profile_name="supply-256x4", pacing="relative"):
    if transport not in ("socket", "grpc"):
        raise RuntimeError("only existing socket/grpc ABCI transports allowed")
    if profile_name not in PROFILES:
        raise RuntimeError("only fixed 256x4 or 512x2 Supply profiles allowed")
    if profile_name == "supply-512x2" and transport != "grpc":
        raise RuntimeError("the new 512x2 profile is explicitly gRPC only")
    if pacing not in ("relative", "bounded-cadence") or pacing == "bounded-cadence" and profile_name != "supply-512x2":
        raise RuntimeError("bounded cadence is explicit fixed512x2/gRPC only")
    profile = dict(PROFILES[profile_name], name=profile_name + ("-grpc" if transport == "grpc" else "") + ("-bounded-cadence" if pacing == "bounded-cadence" else ""))
    return dict(schema=1, profile=profile, abciTransport=transport, pacingMode=pacing,
                pacingCatchupOfferLimit=4 if pacing == "bounded-cadence" else 1, environment=ENV, execute=False,
                requiresSeparateRootGrant=True, nodesStarted=False,
                platform="Linux native /proc; not macOS pressure1",
                comparison="Independent private CI case; no Darwin before/after multiplier",
                resourceCaps=native.CAPS,
                input="workflow_dispatch.run_linux_supply (default false)")


def pair_recipe():
    return dict(schema=1, kind="fixed-same-VM-pacing-pair", execute=False,
                requiresSeparateRootGrant=True, nodesStarted=False, pairCaps=PAIR_CAPS,
                cases=[recipe("grpc", "supply-512x2", mode) for mode in ("relative", "bounded-cadence")],
                order="relative then bounded-cadence; never concurrent; stop after any failed or unclean first case",
                binaries="same exact four ELF files, built once before pair runtime",
                input=dict(run_linux_supply=True, linux_supply_transport="grpc", linux_supply_profile="supply-512x2", linux_supply_pacing="paired-relative-bounded"),
                timing="Both case guards, raw receipt fsync, empty closure checks and pair receipt fsync count toward120s. Per-case invocation including fsync must also stay within60s. Remaining global time can shorten admission, never extend a case.",
                interpretation="Two fresh private fixtures with matched generation policy on one actual VM. Startup order and random fixture identities differ; finite paired observation, not sustained capacity or a generalized speedup.")


class PairBudget:
    """Fixed pair accounting in the original wrapper, not a new job framework."""
    def __init__(self, root, evidence, started, build):
        self.root, self.evidence, self.started = root, evidence, started
        self.build, self.active_case = build, root
        self.deadline = started + PAIR_CAPS["totalMs"]/1000
        self.samples = []

    def remaining(self):
        return self.deadline-time.monotonic()

    def io_timeout(self):
        remaining = self.remaining()-PAIR_CAPS["metadataReserveMs"]/1000
        if remaining <= 0:
            raise RuntimeError("pair120s metadata budget exhausted")
        return min(5, remaining)

    def observe(self, sample=None):
        if self.remaining() <= 0:
            raise RuntimeError("pair120s total deadline exceeded")
        if sample is None:
            sample = native_sample(self.active_case, self.build, {}, self.started)
        native.enforce(sample)
        roots = (self.root, self.evidence)
        retained = sum(native.directory_bytes(p) for p in roots)
        logs = sum(p.stat().st_size for r in roots for p in r.rglob("*.log"))
        if retained > PAIR_CAPS["retainedBytes"] or logs > PAIR_CAPS["logBytes"]:
            raise RuntimeError("combined pair retained64MiB/log2MiB cap exceeded")
        row = dict(elapsedMs=int((time.monotonic()-self.started)*1000), retainedBytes=retained, logBytes=logs)
        row.update({k:sample[k] for k in ("rssBytes", "threads", "availableMemoryBytes", "freeDiskBytes", "buildBytes")})
        self.samples.append(row)
        if self.remaining() <= 0:
            raise RuntimeError("pair120s exceeded during guard I/O")


def empty_pair_closure(budget):
    scans = []
    for _ in range(2):
        budget.observe()
        rows, _ = native.proc_inventory()
        ids = native.owned_set(rows, os.getpid())
        if ids != [os.getpid()]:
            raise RuntimeError("pair prior owned closure is not empty; second case forbidden")
        scans.append(dict(elapsedMs=int((time.monotonic()-budget.started)*1000), owned=ids,
                          launcherStartTicks=rows[os.getpid()]["startTicks"]))
        time.sleep(.05)
    return scans


def pair_case_qualified(row, mode):
    if row.get("firstCause") is not None or row.get("cleanupComplete") is not True or row.get("nodesStarted") is not True:
        raise RuntimeError("pair case failed or cleanup incomplete")
    if row.get("pacingMode") != mode or row.get("abciTransport") != "grpc" or row.get("profile") != recipe("grpc", "supply-512x2", mode)["profile"]:
        raise RuntimeError("pair case fixed configuration mismatch")
    m = row.get("measurement", {})
    if (any(m.get("summary", {}).get(k) != 1024 for k in ("input", "offered", "submitted", "checkTxAccepted", "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"))
            or any(m.get("summary", {}).get(k) != 0 for k in ("submissionUnknown", "timedOut", "notSubmitted", "executionFailed", "checkTxRejected", "checkTxUnverifiedResponses", "observationFailed"))
            or len(row.get("nodePhases", [])) != 4):
        raise RuntimeError("pair case incomplete business results; no second case")


def run_pair(source, build, root, receipt):
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("same native Linux amd64 VM required")
    source, build, root, receipt = map(lambda p:p.absolute(), (source, build, root, receipt))
    if (root.exists() or root.is_symlink() or receipt.exists() or receipt.is_symlink()
            or root.is_relative_to(source) or source.is_relative_to(root)
            or root.is_relative_to(build) or build.is_relative_to(root)
            or receipt.is_relative_to(root) or root.is_relative_to(receipt.parent)
            or any(p.resolve() != p for p in (source, build, root.parent, receipt.parent))):
        raise RuntimeError("exclusive disjoint fixed-pair roots required")
    started = time.monotonic()
    root.mkdir(mode=0o700)
    budget = PairBudget(root, receipt.parent, started, build)
    result = dict(pair_recipe(), execute=True, nodesStarted=None, launcher=os.getpid(), startedAtUnix=time.time(),
                  host=dict(uname=list(platform.uname()), cpuCount=os.cpu_count(),
                            bootID=native.bounded(Path("/proc/sys/kernel/random/boot_id")).decode().strip(),
                            pidNamespace=os.readlink("/proc/self/ns/pid")),
                  cases=[], closureScans=[], firstCause=None, casesQualified=False,
                  preparedCases=pair_recipe()["cases"],
                  terminalQualification="Requires post-fsync stdout verdict and exit0; receipt alone is not total-window PASS")
    def exhausted(_signum, _frame):
        raise RuntimeError("pair120s outer watchdog expired")
    prior = signal.signal(signal.SIGALRM, exhausted)
    signal.setitimer(signal.ITIMER_REAL, max(.001, budget.remaining()))
    baseline = None
    try:
        for index, mode in enumerate(("relative", "bounded-cadence")):
            budget.observe()
            if budget.remaining() <= 15.5:
                raise RuntimeError("pair lacks cleanup and metadata reserve; next case refused")
            if baseline is not None:
                for name in BINARIES:
                    if native.digest(build/name) != baseline["binaries"][name]["sha256"]:
                        raise RuntimeError("pair compiled binary changed before second case")
                if list(platform.uname()) != baseline["host"]["uname"] or os.cpu_count() != baseline["host"]["cpuCount"]:
                    raise RuntimeError("pair actual host changed")
            case = root / ("before-relative" if index == 0 else "after-bounded-cadence")
            out = root / (mode+"-actual.json")
            budget.active_case = case
            invoked = time.monotonic()
            code = run(source, build, case, out, "grpc", "supply-512x2", mode, pair_budget=budget)
            duration = time.monotonic()-invoked
            row = json.loads(native.bounded(out, 4 << 20))
            if result["nodesStarted"] is not True: result["nodesStarted"] = row.get("nodesStarted")
            result["cases"].append(dict(order=index+1, mode=mode, receipt=str(out), sha256=native.digest(out),
                                        invocationElapsedMs=int(duration*1000), code=code,
                                        firstCause=row.get("firstCause"), summary=row.get("measurement", {}).get("summary")))
            if code != 0 or duration > 60:
                raise RuntimeError("pair case failed or invocation/fsync exceeded60s: "+str(row.get("firstCause")))
            pair_case_qualified(row, mode)
            result["closureScans"].append(empty_pair_closure(budget))
            if baseline is None:
                baseline = row
                result["compiledBinaries"] = row["binaries"]
                result["sourceCommit"], result["compiler"] = row["sourceCommit"], row["compiler"]
            else:
                for key in ("sourceCommit", "sourceTree", "internalTree", "compiler", "binaries", "environment"):
                    if row[key] != baseline[key]:
                        raise RuntimeError("pair identity differs: "+key)
                if row["host"]["uname"] != baseline["host"]["uname"] or row["host"]["cpuCount"] != baseline["host"]["cpuCount"]:
                    raise RuntimeError("pair VM identity differs")
            budget.observe()
        result["casesQualified"] = True
    except Exception as error:
        result["firstCause"] = str(error)
    finally:
        try:
            budget.observe()
        except Exception as error:
            result["firstCause"] = result["firstCause"] or str(error)
        result["samples"] = budget.samples
        result["elapsedBeforePairReceiptFsyncMs"] = int((time.monotonic()-started)*1000)
        try:
            with receipt.open("x") as handle:
                json.dump(result, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
            budget.observe()  # Includes the actual pair receipt bytes and fsync wall time.
        except Exception as error:
            result["firstCause"] = result["firstCause"] or str(error)
        pair_sha = native.digest(receipt) if receipt.is_file() else None
        elapsed_exact = (time.monotonic()-started)*1000
        elapsed = int(elapsed_exact)
        if elapsed_exact > PAIR_CAPS["totalMs"]:
            result["firstCause"] = result["firstCause"] or "pair total including fsync exceeded120s"
        verdict = dict(schema=1, kind="fixed-pair-post-fsync-verdict", elapsedMs=elapsed,
                       firstCause=result["firstCause"], casesQualified=result["casesQualified"],
                       pairReceipt=str(receipt), pairReceiptSHA256=pair_sha,
                       retainedBytesAfterFsync=budget.samples[-1]["retainedBytes"] if budget.samples else None,
                       qualified=result["firstCause"] is None and result["casesQualified"])
        try:
            print("YNX_SUPPLY_PAIR_TERMINAL "+json.dumps(verdict), flush=True)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, prior)
    return 0 if verdict["qualified"] else 1


def server_commands(build, node, migration, transport):
    recipe(transport)  # Reject unknown transports before any process is spawned.
    comet = [str(build / "cometbft"), "start", "--home", node["home"], "--abci", transport]
    if transport == "grpc":
        endpoint(node["abciListen"])
        target = urlparse(node["abciListen"])
        # grpc.NewClient defaults to the DNS resolver: tcp:// is a server
        # listen URI, not a gRPC client target. Numeric loopback avoids DNS.
        comet += ["--proxy_app", "127.0.0.1:" + str(target.port)]
    return ([str(build / "ynx-abci"), "-listen", node["abciListen"], "-transport", transport,
             "-migration-state", migration, "-state", node["abciStatePath"], "-state-layout", "block-journal", "-phase-timing"],
            comet)


def partial_measurement(output):
    if not output.is_file():
        return None
    row = json.loads(native.bounded(output, 16 << 20))
    return dict(qualified=False, resultSHA256=native.digest(output), summary=row.get("summary"),
                supply=row.get("readySenders", {}).get("supply"), setupErrors=row.get("setupErrors"))


def inside(value, root):
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or path.resolve() == root.resolve():
        raise RuntimeError("fixture path escapes exclusive private root")
    return str(path)


def endpoint(value):
    parsed = urlparse(value)
    if (parsed.scheme not in ("tcp", "http") or parsed.hostname != "127.0.0.1"
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or parsed.port is None or not 1024 <= parsed.port <= 65535):
        raise RuntimeError("only explicit loopback fixture endpoints allowed")
    return value


def validate_manifest(m, root):
    if m.get("purpose") != "local-ephemeral-consensus-quorum-only-not-for-remote-or-custody" or len(m.get("nodes", [])) != 4:
        raise RuntimeError("private four-node fixture identity required")
    inside(m["migrationPath"], root)
    ports = set()
    for node in m["nodes"]:
        inside(node["home"], root)
        inside(node["abciStatePath"], root)
        for key in ("p2pListen", "rpcListen", "abciListen", "rpcUrl"):
            endpoint(node[key])
        for key in ("p2pListen", "rpcListen", "abciListen"):
            port = urlparse(node[key]).port
            if port in ports:
                raise RuntimeError("overlapping fixture ports")
            ports.add(port)
        if urlparse(node["rpcUrl"]).port != urlparse(node["rpcListen"]).port:
            raise RuntimeError("RPC listen/observation port mismatch")
    return m


def validate_report(report, profile_name="supply-256x4", pacing="relative"):
    profile = recipe("grpc", profile_name, pacing)["profile"]
    if (report.get("roundsCompleted") != profile["rounds"] or report.get("roundsRequested") != profile["rounds"] or report.get("senderMode") != "ready-pool"
            or report.get("inclusionMode") != "block-scan" or report.get("configuredOfferedRate") != 512
            or report.get("pacingMode") != pacing or report.get("setupErrors")):
        raise RuntimeError("fixed Supply workload incomplete")
    s = report["summary"]
    for key in ("input", "offered", "submitted", "checkTxAccepted", "includedCodeZero",
                "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"):
        if type(s.get(key)) is not int or s[key] != 1024:
            raise RuntimeError("unqualified business count: " + key)
    for key in ("checkTxRejected", "checkTxUnverifiedResponses", "executionFailed", "submissionUnknown",
                "timedOut", "observationFailed", "notSubmitted"):
        if type(s.get(key)) is not int or s[key] != 0:
            raise RuntimeError("business failure/UNKNOWN: " + key)
    supply = report["readySenders"]["supply"]
    for key, value in supply.items():
        if type(value) is not int or value < 0:
            raise RuntimeError("invalid measured Supply counter: " + key)
    for key in ("signAttempts", "encodeAttempts", "signedSuccessors"):
        if supply.get(key) != 1024-profile["senders"]:
            raise RuntimeError("successor timing coverage missing: " + key)
    if supply.get("journalDurableEnvelopes") != 1024 or supply.get("terminalSinkAttempts") != 0 or supply.get("terminalSinkNs") != 0:
        raise RuntimeError("finite journal/sink mode differs from fixed profile")
    for prefix in ("completionWait", "offerDecode", "pacingWait", "dispatch", "sign", "encode", "journalAppend"):
        if supply.get(prefix + "Attempts", 0) <= 0 or supply.get(prefix + "Ns", 0) <= 0:
            raise RuntimeError("Supply phase timing missing: " + prefix)
    if supply.get("journalSetupNs", 0) <= 0 or supply.get("journalDurableBytes", 0) <= 0:
        raise RuntimeError("durable Supply setup missing")
    for suffix in ("Attempts", "Ns"):
        parts = [supply.get("completion"+name+"Wait"+suffix) for name in ("Supply", "Drain", "Failure")]
        if any(type(v) is not int or v < 0 for v in parts) or sum(parts) != supply["completionWait"+suffix] or parts[2] != 0:
            raise RuntimeError("Supply/final-drain/failure wait partition incomplete")
    if (supply.get("pacingFutureTargetAttempts", -1)+supply.get("pacingAlreadyDueAttempts", -1) != supply["pacingWaitAttempts"]
            or any(type(supply.get(k)) is not int or supply[k] < 0 for k in ("pacingPositiveRemainingNs", "pacingWakeLatenessNs", "pacingMaxWakeLatenessNs"))
            or supply["pacingMaxWakeLatenessNs"] > supply["pacingWakeLatenessNs"]):
        raise RuntimeError("pacing scheduled/wake timing coverage missing")
    decisions = [supply.get(k) for k in ("pacingCatchupTargets", "pacingCadenceResets")]
    if (any(type(v) is not int or v < 0 for v in decisions) or sum(decisions) > 1024
            or type(supply.get("pacingPeakCatchupTargets")) is not int or not 0 <= supply["pacingPeakCatchupTargets"] <= 3
            or pacing == "relative" and (any(decisions) or supply["pacingPeakCatchupTargets"] != 0)):
        raise RuntimeError("pacing decision counters differ from selected mode")
    transactions = report.get("transactions", [])
    if len(transactions) != 1024 or {t.get("index") for t in transactions} != set(range(1024)):
        raise RuntimeError("complete per-transaction evidence required")
    for t in transactions:
        if (t.get("status") != "confirmed" or t.get("checkTxCode") != 0 or t.get("executionCode") != 0
                or any(t.get(k) is not True for k in ("checkTxIdentityVerified", "quorumVerified", "transactionProofVerified", "durableStateVerified", "durableInfoVerified"))
                or t.get("height", 0) <= 0 or t.get("durableStateHeight", 0) < t["height"]
                or t.get("durableInfoHeight", 0) < t["durableStateHeight"]
                or not t.get("durableSnapshotSha256") or not t.get("confirmedObservedAt")):
            raise RuntimeError("per-transaction business qualification missing")
    return dict(summary=s, supply=supply)


def native_sample(case, build, known, started, initial=False):
    rows, vanished = native.proc_inventory()
    ids = native.owned_set(rows, os.getpid(), known=known)
    if len(ids) > PROFILE["ownedProcesses"]:
        raise RuntimeError("Supply owned process cap exceeded")
    tasks = []
    for pid in ids:
        before = rows[pid]
        try:
            raw = native.bounded(Path("/proc") / str(pid) / "smaps_rollup") if before["state"] != "Z" else None
            after = native.parse_stat(native.bounded(Path("/proc") / str(pid) / "stat"), pid)
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH):
                raise
            try:
                after = native.parse_stat(native.bounded(Path("/proc") / str(pid) / "stat"), pid)
            except OSError as absent:
                if absent.errno in (errno.ENOENT, errno.ESRCH):
                    continue
                raise
            if after["startTicks"] != before["startTicks"] or after["state"] != "Z":
                raise RuntimeError("live owned RSS unreadable")
            raw = None
        if before["startTicks"] != after["startTicks"] or raw is None and after["state"] != "Z":
            raise RuntimeError("owned identity changed during sample")
        tasks.append(dict(after, rssBytes=native.smaps_rss(raw) if raw is not None else 0))
    known.update({p["pid"]: p["startTicks"] for p in tasks if p["pid"] != os.getpid()})
    disk = os.statvfs(case)
    row = dict(elapsedMs=int((time.monotonic()-started)*1000), tasks=tasks,
               rssBytes=sum(t["rssBytes"] for t in tasks), threads=sum(t["threads"] for t in tasks),
               privateBytes=native.directory_bytes(case), buildBytes=native.directory_bytes(build),
               freeDiskBytes=disk.f_bavail*disk.f_frsize, availableMemoryBytes=native.memory_available(),
               hostIdentities=len(rows), vanishedHostPIDs=vanished)
    native.enforce(row, initial)
    if sum(p.stat().st_size for p in case.glob("*.log")) > native.CAPS["logBytes"]:
        raise RuntimeError("combined process log cap exceeded")
    return row


def preflight(build, case):
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("native Linux amd64 runner required")
    if case.exists() or case.is_symlink():
        raise RuntimeError("new resource-probe directory required")
    case.mkdir(mode=0o700)
    if build.stat().st_dev != case.stat().st_dev:
        raise RuntimeError("build and private data must share monitored filesystem")
    # No children or builds: actual host kernel data, not synthetic test values.
    return native_sample(case, build, {}, time.monotonic(), initial=True)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("fixture RPC redirect refused")


def run(source, build, case, receipt, transport="socket", profile_name="supply-256x4", pacing="relative", pair_budget=None):
    selected = recipe(transport, profile_name, pacing)
    profile = selected["profile"]
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("native Linux amd64 runner required; no Darwin pressure substitution")
    source, build, case, receipt = map(lambda p: p.absolute(), (source, build, case, receipt))
    if (case.exists() or case.is_symlink() or receipt.exists() or receipt.is_symlink()
            or case.is_relative_to(source) or source.is_relative_to(case)
            or build.is_relative_to(case) or receipt.is_relative_to(case)):
        raise RuntimeError("exclusive external case and receipt paths required")
    if any(p.resolve() != p for p in (source, build, case.parent, receipt.parent)):
        raise RuntimeError("symlinked runner roots refused")
    case.mkdir(mode=0o700)
    result = dict(selected, execute=True, source=str(source), build=str(build), case=str(case),
                  host=dict(uname=list(platform.uname()), cpuCount=os.cpu_count()),
                  samples=[], children=[], timeline=[], readinessWaitErrors=0,
                  firstCause=None, cleanupComplete=False)
    children, handles, known = [], [], {}
    started = time.monotonic()

    def mark(phase):
        result["timeline"].append(dict(phase=phase, elapsedNs=int((time.monotonic()-started)*1e9), unixNs=time.time_ns()))

    def command(args):
        return subprocess.check_output(args, cwd=source, timeout=pair_budget.io_timeout() if pair_budget else 5, stderr=subprocess.STDOUT).decode().strip()

    def tick(initial=False):
        if time.monotonic()-started >= 45:
            raise RuntimeError("active45s deadline exceeded")
        if pair_budget and pair_budget.remaining() <= 15.5:
            raise RuntimeError("pair active reserve exhausted; begin cleanup")
        sampled = native_sample(case, build, known, started, initial)
        result["samples"].append(sampled)
        if pair_budget: pair_budget.observe(sampled)
        if any(p.poll() is not None for p in children if getattr(p, "server", False)):
            raise RuntimeError("node exited during active window")

    def spawn(name, args, server=False):
        if len([p for p in children if p.poll() is None]) >= 9:
            raise RuntimeError("nine-child role cap exceeded")
        handle = open(case / (name + ".log"), "xb", buffering=0)
        handles.append(handle)
        p = subprocess.Popen(args, cwd=case, env={**os.environ, **ENV}, stdin=subprocess.DEVNULL,
                             stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
        p.server = server
        children.append(p)
        result["children"].append(dict(role=name, pid=p.pid, command=args))
        tick()
        return p

    def wait(p):
        while p.poll() is None:
            tick(); time.sleep(.1)
        tick()
        if p.returncode != 0:
            raise RuntimeError("child failed: " + str(p.args))

    def interrupted(signum, _):
        raise RuntimeError("wrapper signal " + str(signum))

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    try:
        head = command(["git", "rev-parse", "HEAD"])
        if command(["git", "status", "--porcelain"]):
            raise RuntimeError("clean exact source required")
        result["sourceCommit"] = head
        result["compiler"] = command(["go", "version"])
        result["sourceTree"] = command(["git", "rev-parse", "HEAD^{tree}"])
        result["internalTree"] = command(["git", "rev-parse", "HEAD:internal"])
        if len({p.stat().st_dev for p in (source, case, build)}) != 1:
            raise RuntimeError("source/build/private data must share monitored filesystem")
        result["binaries"] = {}
        for name in BINARIES:
            binary = build / name
            if binary.is_symlink() or not binary.is_file() or binary.stat().st_size > 64 << 20:
                raise RuntimeError("binary type/size bound")
            with binary.open("rb") as f:
                header = f.read(20)
            if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
                raise RuntimeError("Linux amd64 ELF required")
            info = command(["go", "version", "-m", str(binary)])
            for pin in ("GOOS=linux", "GOARCH=amd64", "CGO_ENABLED=0"):
                if pin not in info:
                    raise RuntimeError("binary target pin missing")
            if name != "cometbft" and ("vcs.revision="+head not in info or "vcs.modified=false" not in info):
                raise RuntimeError("binary source identity mismatch")
            if name == "cometbft" and "github.com/cometbft/cometbft\tv0.38.23\th1:jtCe5Do4EcHVf/FCyZMvkBm+AmsRGGyvswImXYAabdM=" not in info:
                raise RuntimeError("Comet module identity mismatch")
            result["binaries"][name] = dict(sha256=native.digest(binary), bytes=binary.stat().st_size, buildInfo=info)
        mounts = [line.split() for line in native.bounded(Path("/proc/mounts"), 1 << 20).splitlines()]
        proc = [r for r in mounts if len(r) >= 4 and r[1:3] == [b"/proc", b"proc"]]
        if len(proc) != 1 or any(o.startswith(b"hidepid=") and o != b"hidepid=0" for o in proc[0][3].split(b",")):
            raise RuntimeError("complete native procfs required")
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        value = ctypes.c_int()
        if libc.prctl(36, 1, 0, 0, 0) or libc.prctl(37, ctypes.cast(ctypes.pointer(value), ctypes.c_void_p).value, 0, 0, 0) or value.value != 1:
            raise RuntimeError("subreaper unavailable")
        result["subreaper"] = True
        tick(True)
        result["host"].update(meminfo=native.bounded(Path("/proc/meminfo")).decode(),
                               cpuinfo=native.bounded(Path("/proc/cpuinfo"), 1 << 20).decode())
        network = case / "network"
        mark("fixture_start")
        wait(spawn("fixture", [str(build / BINARIES[2]), "-ephemeral", "-output", str(network), "-count", str(profile["senders"]), "-retain-ephemeral-senders"]))
        mark("fixture_complete")
        manifest_path = network / "network-manifest.json"
        manifest = validate_manifest(json.loads(native.bounded(manifest_path, 1 << 20)), network)
        for i, node in enumerate(manifest["nodes"]):
            app, _ = server_commands(build, node, manifest["migrationPath"], transport)
            spawn("abci-"+str(i), app, True)
        for i, node in enumerate(manifest["nodes"]):
            _, comet = server_commands(build, node, manifest["migrationPath"], transport)
            spawn("comet-"+str(i), comet, True)
        result["nodesStarted"] = True
        mark("nodes_spawned")
        opener = build_opener(ProxyHandler({}), NoRedirect())
        for node in manifest["nodes"]:
            while True:
                tick()
                try:
                    with opener.open(node["rpcUrl"]+"/status", timeout=.05) as response:
                        raw = response.read((1 << 20)+1)
                    if len(raw) > 1 << 20:
                        raise RuntimeError("RPC status bound")
                    if int(json.loads(raw)["result"]["sync_info"]["latest_block_height"]) >= 2:
                        break
                except (OSError, ValueError, KeyError):
                    result["readinessWaitErrors"] += 1
                time.sleep(.05)
        mark("all_nodes_height2")
        output = network / "transactions-result.json"
        mark("client_start")
        wait(spawn("client", [str(build / BINARIES[3]), "-manifest", str(manifest_path), "-transactions", str(network / "transactions.json"), "-output", str(output), "-timeout", "10s", "-concurrency", "4", "-observers", "4", "-offered-rate", "512", "-rounds", str(profile["rounds"]), "-sender-mode", "ready-pool", "-inclusion-mode", "block-scan", "-pacing-mode", pacing]))
        result["measurement"] = validate_report(json.loads(native.bounded(output, 16 << 20)), profile_name, pacing)
        mark("client_complete")
        result["resultSHA256"] = native.digest(output)
    except Exception as error:
        result["firstCause"] = str(error)
        try:
            result["partialMeasurement"] = partial_measurement(case / "network/transactions-result.json")
        except Exception as diagnostic_error:
            result["partialReadError"] = str(diagnostic_error)
    finally:
        mark("cleanup_start")
        cleanup = time.monotonic()
        cleanup_deadline = min(cleanup+15, started+60)
        if pair_budget: cleanup_deadline = min(cleanup_deadline, pair_budget.deadline-.5)
        empty = 0
        while time.monotonic() < cleanup_deadline:
            for p in children:
                p.poll()
            try:
                rows, _ = native.proc_inventory()
                ids = [pid for pid in native.owned_set(rows, os.getpid(), known=known) if pid != os.getpid()]
                if not ids:
                    empty += 1
                    if empty == 2:
                        result["cleanupComplete"] = True
                        break
                else:
                    empty = 0
                for pid in ids:
                    row = rows[pid]
                    fresh = native.parse_stat(native.bounded(Path("/proc")/str(pid)/"stat"), pid)
                    if fresh["startTicks"] != row["startTicks"]:
                        raise RuntimeError("cleanup PID identity changed; not signalled")
                    if fresh["state"] == "Z" and fresh["parent"] == os.getpid():
                        os.waitpid(pid, os.WNOHANG)
                    else:
                        os.kill(pid, signal.SIGINT if time.monotonic()-cleanup < 2 else signal.SIGKILL)
                    known[pid] = row["startTicks"]
            except Exception as error:
                result["firstCause"] = result["firstCause"] or str(error)
                for p in children:
                    if p.poll() is None:
                        p.kill()
            time.sleep(.05)
        for handle in handles:
            handle.close()
        mark("cleanup_complete" if result["cleanupComplete"] else "cleanup_incomplete")
        if not result["cleanupComplete"]:
            result["firstCause"] = result["firstCause"] or "owned closure cleanup incomplete"
        try:
            native.enforce(native_sample(case, build, known, started))
            code = "import{readNodePhaseTiming as r}from './scripts/loadtest/node-phase-timing.mjs';import fs from'node:fs';console.log(JSON.stringify(process.argv.slice(1).map(p=>r(fs.readFileSync(p,'utf8')))));"
            result["nodePhases"] = json.loads(command(["node", "--input-type=module", "-e", code] + [str(case / ("abci-"+str(i)+".log")) for i in range(4)]))
        except Exception as error:
            result["firstCause"] = result["firstCause"] or str(error)
        result["elapsedMs"] = int((time.monotonic()-started)*1000)
        if result["elapsedMs"] > 60000:
            result["firstCause"] = result["firstCause"] or "total60s deadline exceeded"
        result["measurementLimits"] = "Sampled RSS, not a hard cgroup ceiling; non-atomic proc scans. Build occurs before the bounded runtime window in the existing CI job. Finite 1024 business transactions, not sustained TPS. Terminal sink disabled in this finite profile; zero is not a missing measurement. No Darwin matched comparison."
        with receipt.open("x") as handle:
            json.dump(result, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        print(json.dumps({k: result.get(k) for k in ("firstCause", "nodesStarted", "cleanupComplete", "elapsedMs", "partialMeasurement")}), flush=True)
    return 1 if result["firstCause"] else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--prepare-pair", action="store_true")
    parser.add_argument("--execute-pair", action="store_true")
    parser.add_argument("--transport", choices=("socket", "grpc"), default="socket")
    parser.add_argument("--profile", choices=tuple(PROFILES), default="supply-256x4")
    parser.add_argument("--pacing", choices=("relative", "bounded-cadence"), default="relative")
    parser.add_argument("--check-runner", action="store_true")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--build", type=Path)
    parser.add_argument("--case", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    if args.prepare_pair or args.execute_pair:
        if (args.prepare_pair and args.execute_pair or args.execute or args.check_runner
                or args.transport != "grpc" or args.profile != "supply-512x2" or args.pacing != "relative"):
            parser.error("fixed pair requires explicit grpc/512x2, no individual pacing or other action")
        if args.prepare_pair:
            print(json.dumps(pair_recipe(), indent=2))
        else:
            if not all((args.source, args.build, args.case, args.receipt)):
                parser.error("pair execute requires exact source/build/new pair root/new receipt")
            sys.exit(run_pair(args.source, args.build, args.case, args.receipt))
    elif args.check_runner:
        if args.execute or not args.build or not args.case:
            parser.error("check-runner requires build/new case and excludes execute")
        print(json.dumps(preflight(args.build, args.case), indent=2))
    elif not args.execute:
        print(json.dumps(recipe(args.transport, args.profile, args.pacing), indent=2))
    else:
        if not all((args.source, args.build, args.case, args.receipt)):
            parser.error("execute requires exact source/build/new case/new receipt")
        sys.exit(run(args.source, args.build, args.case, args.receipt, args.transport, args.profile, args.pacing))
