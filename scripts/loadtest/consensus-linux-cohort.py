#!/usr/bin/env python3
"""One isolated hosted-CI normal-node cohort, not public or sustained TPS.

Reuses the original synthetic fixture, ynx-comet bootstrap operator, perf client,
raw readback CLI and Linux /proc ownership primitives. No consensus substitute.
The presently available producer/client profile is explicitly legacy-native;
PQ requires the owning normal producer/client integration, never a relabel.
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
import resource
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.request

_spec = importlib.util.spec_from_file_location("original_linux_guard", Path(__file__).with_name("pq-paired-linux-window.py"))
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

CAPS = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30,
            newBytes=8 << 30, initialMemoryBytes=6 << 30,
            initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
PROFILES = {"smoke": dict(count=4, rounds=2, rate=4, window="2s", timeout="20s"),
            "cohort": dict(count=64, rounds=2, rate=32, window="4s", timeout="30s")}


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def write_new(path, value):
    with open(path, "x", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out, separators=(",", ":")); out.write("\n")
        out.flush(); os.fsync(out.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def git(source, *args):
    return subprocess.check_output(["git", "-C", str(source), *args], timeout=5).decode().strip()


def check_source(source, commit):
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "exact candidate SHA required")
    require(source.is_absolute() and source.resolve(strict=True) == source, "canonical checkout required")
    require(git(source, "rev-parse", "HEAD") == commit, "candidate HEAD differs")
    require(not git(source, "status", "--porcelain", "--untracked-files=normal"), "candidate must be clean")
    require("replace github.com/cometbft/cometbft => ./third_party/cometbft" in (source / "go.mod").read_text(), "original Comet fork required")
    return {"commit": commit, "tree": git(source, "rev-parse", "HEAD^{tree}"),
            "forkTree": git(source, "rev-parse", "HEAD:third_party/cometbft")}


def admit(memory, disk, heavy):
    require(memory >= CAPS["initialMemoryBytes"], "fresh Linux MemAvailable below 6GiB")
    require(disk >= CAPS["initialDiskBytes"], "fresh disk below 16GiB")
    require(not heavy, "another heavy process exists on the hosted runner")


def private_bytes(root):
    # Module download/extraction also belongs to this operation. Bound its
    # inventory separately from the older tiny paired-fixture profile.
    total = count = 0
    for directory, names, files in os.walk(root, followlinks=False):
        require(len(Path(directory).relative_to(root).parts) <= 40, "artifact depth bound")
        for name in names + files:
            count += 1; require(count <= 200000, "artifact inventory bound")
            try: info = (Path(directory) / name).lstat()
            except FileNotFoundError: continue
            require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), "nonregular private artifact")
            if stat.S_ISREG(info.st_mode): total += max(info.st_size, info.st_blocks * 512)
    return total


def owned_rss(pid, before, retired=None):
    """Read one original identity; prove disappearance instead of guessing 0."""
    directory = Path("/proc") / str(pid)
    transitions = []
    # A dying/execing task can still expose a non-Z stat briefly after its mm
    # became unavailable. Reopen only this same original identity, at most six
    # attempts/5ms sleep total. No missing live sample becomes RSS zero.
    for attempt in range(1, 7):
        try:
            size = guard.smaps_rss(guard.bounded(directory / "smaps_rollup"))
            after = guard.parse_stat(guard.bounded(directory / "stat"), pid)
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH):
                raise
            try:
                current = guard.parse_stat(guard.bounded(directory / "stat"), pid)
            except OSError as missing:
                if missing.errno in (errno.ENOENT, errno.ESRCH):
                    if retired is not None:
                        retired(dict(pid=pid, startTicks=before["startTicks"], reason="second-stat-proved-gone", rssError=error.errno, statError=missing.errno, sampleAttempts=attempt))
                    return None
                raise
            require(current["startTicks"] == before["startTicks"], "owned process identity changed after RSS failure")
            if current["state"] == "Z":
                if retired is not None:
                    retired(dict(pid=pid, startTicks=before["startTicks"], reason="same-identity-zombie", rssError=error.errno, sampleAttempts=attempt))
                return 0
            transitions.append(dict(attempt=attempt, state=current["state"], rssError=error.errno))
            require(attempt < 6, "active owned process RSS unreadable: " + json.dumps(dict(pid=pid, startTicks=before["startTicks"], transitions=transitions), separators=(",", ":")))
            time.sleep(.001)
            continue
        require(after["startTicks"] == before["startTicks"], "owned process identity changed during RSS read")
        return size


def heavy_processes(rows):
    # Hosted runner is disposable/exclusive; do not infer ownership from UID.
    result = []
    for pid in rows:
        if pid == os.getpid():
            continue
        try:
            name = guard.bounded(Path("/proc") / str(pid) / "comm", 256).decode().strip()
        except FileNotFoundError:
            continue
        if name in ("go", "compile", "link", "consensus.test") or name.startswith("ynx-"):
            result.append(dict(pid=pid, comm=name))
    return result


def node_args(node, manifest, migration):
    return ["start", "--home", node["home"], "--migration-state", manifest["migrationPath"],
            "--abci-state", node["abciStatePath"], "--abci-state-layout", "atomic-json",
            "--consensus-genesis-sha256", manifest["genesisHash"],
            "--original-genesis-hash", migration["originalGenesisHash"],
            "--bound-migration-state-hash", manifest["migrationStateHash"]]


def validate_manifest(m, network):
    require(len(m.get("nodes", [])) == 4 and "local-ephemeral" in m.get("purpose", ""), "four synthetic validators required")
    endpoints = set()
    for node in m["nodes"]:
        require(node["consensusKeyType"] == "ed25519", "legacy profile cannot consume PQ or unknown keys")
        for key in ("home", "abciStatePath"):
            p = Path(node[key]); require(p.is_absolute() and p.resolve() == p and network in p.parents, "node escaped owned network")
        require(re.fullmatch(r"http://127\.0\.0\.1:[0-9]+", node["rpcUrl"]), "loopback RPC required")
        require(re.fullmatch(r"tcp://127\.0\.0\.1:[0-9]+", node["p2pListen"]), "loopback P2P required")
        peers = node["persistentPeers"].split(",")
        require(len(peers) == 3 and all(re.fullmatch(r"[0-9a-fA-F]{40}@127\.0\.0\.1:[0-9]+", p) for p in peers), "three original loopback peers required")
        require(node["rpcUrl"] not in endpoints, "distinct RPC endpoints required")
        endpoints.add(node["rpcUrl"])
    migration = Path(m["migrationPath"])
    require(migration.resolve() == migration and network in migration.parents, "migration escaped owned network")


class Window:
    def __init__(self, source, work, additional_storage=()):
        self.source, self.work = source, work
        self.storage_roots = [work, *additional_storage]
        self.started = time.monotonic()
        self.children, self.known, self.samples = [], {}, []
        self.retired_samples = []
        self.peak_rss = self.peak_bytes = 0
        self.last_storage_sample = 0
        self.storage_bytes = 0
        self.logs = []
        self.stopping = False
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("CMT_", "YNX_", "GOFLAGS"))}
        self.env.update(GOMAXPROCS="2", GOMEMLIMIT="1024MiB", GOGC="75",
                        GOTOOLCHAIN="local", GOCACHE=str(work / ".private/cache"),
                        GOMODCACHE=str(work / ".private/modules"),
                        GOPATH=str(work / ".private/gopath"), GOENV="off", GOTELEMETRY="off",
                        XDG_CACHE_HOME=str(work / ".private/xdg-cache"),
                        XDG_CONFIG_HOME=str(work / ".private/xdg-config"),
                        GOTMPDIR=str(work / ".private/tmp"), TMPDIR=str(work / ".private/tmp"))
        for name in ("cache", "modules", "tmp", "bin", "gopath", "xdg-cache", "xdg-config"):
            (work / ".private" / name).mkdir(mode=0o700)
        self.cpus = sorted(os.sched_getaffinity(0))[:CAPS["cpus"]]
        require(len(self.cpus) > 0, "no usable CPU affinity")
        os.sched_setaffinity(0, self.cpus)

    def sample(self):
        require(time.monotonic() - self.started < CAPS["totalSeconds"] - CAPS["cleanupSeconds"], "total operation deadline exceeded")
        rows, _ = guard.proc_inventory()
        ids = guard.owned_set(rows, os.getpid(), known=self.known)
        rss = 0
        for pid in ids:
            before = rows[pid]
            self.known[pid] = before["startTicks"]
            if before["state"] == "Z":
                continue
            def retain_retired(event):
                require(len(self.retired_samples) < 4096, "retired process sample evidence bound")
                self.retired_samples.append(event)
            size = owned_rss(pid, before, retain_retired)
            if size is not None:
                rss += size
        if time.monotonic() - self.last_storage_sample >= 1:
            self.storage_bytes = sum(private_bytes(root) for root in self.storage_roots)
            self.last_storage_sample = time.monotonic()
        size = self.storage_bytes
        self.peak_rss, self.peak_bytes = max(self.peak_rss, rss), max(self.peak_bytes, size)
        require(rss <= CAPS["rssBytes"], "owned RSS exceeded 4GiB")
        require(size <= CAPS["newBytes"], "new artifacts exceeded 8GiB")
        require(shutil.disk_usage(self.work).free >= 1 << 30, "runtime disk reserve below 1GiB")
        for _, log in self.logs:
            require(os.fstat(log.fileno()).st_size <= CAPS["logBytes"], "bounded process log exceeded")
        for c in self.children:
            if c["persistent"] and c["process"].poll() is not None and not self.stopping:
                raise RuntimeError("normal node exited early: " + c["name"])
        if len(self.samples) < 1800 and (not self.samples or time.monotonic() - self.samples[-1]["at"] >= 1):
            self.samples.append(dict(at=time.monotonic(), rssBytes=rss, newBytes=size, processes=len(ids)))

    def launch(self, name, command, persistent=False, pass_fds=()):
        self.sample()
        log = open(self.work / "public" / (name + ".log"), "xb", buffering=0)
        os.chmod(log.name, 0o600); self.logs.append((name, log))
        def restrict():
            os.sched_setaffinity(0, self.cpus)
            resource.setrlimit(resource.RLIMIT_FSIZE, (CAPS["newBytes"], CAPS["newBytes"]))
        proc = subprocess.Popen(command, cwd=self.source, env=self.env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True, preexec_fn=restrict,
                                pass_fds=pass_fds)
        row = dict(name=name, process=proc, persistent=persistent, command=list(command), startedNs=time.monotonic_ns())
        self.children.append(row)
        try:
            row["startTicks"] = guard.parse_stat(guard.bounded(Path("/proc") / str(proc.pid) / "stat"), proc.pid)["startTicks"]
            self.known[proc.pid] = row["startTicks"]
        except FileNotFoundError:
            row["startTicks"] = None
        return proc

    def wait(self, proc, allow_failure=False):
        while proc.poll() is None:
            self.sample(); time.sleep(.2)
        self.sample()
        for row in self.children:
            if row["process"] is proc and "elapsedNs" not in row:
                row["elapsedNs"] = time.monotonic_ns() - row["startedNs"]
        require(allow_failure or proc.returncode == 0, "normal command failed; retain original log")
        return proc.returncode

    def rpc(self, url, method, params=""):
        require(re.fullmatch(r"http://127\.0\.0\.1:[0-9]+", url), "non-loopback RPC refused")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url + "/" + method + params, timeout=1) as response:
            raw = response.read((8 << 20) + 1)
        require(len(raw) <= 8 << 20, "RPC read bound exceeded")
        value = json.loads(raw); require("result" in value and not value.get("error"), "RPC error")
        return value["result"]

    def ready(self, manifest):
        until = min(self.started + CAPS["totalSeconds"] - 30, time.monotonic() + 60)
        while time.monotonic() < until:
            self.sample()
            try:
                states = [self.rpc(n["rpcUrl"], "status") for n in manifest["nodes"]]
                if all(s["node_info"]["network"] == manifest["chainId"] and int(s["sync_info"]["latest_block_height"]) >= 2 for s in states):
                    return states
            except (OSError, ValueError, KeyError, RuntimeError):
                pass
            time.sleep(.2)
        raise RuntimeError("normal four-process nodes did not become ready")

    def successor_data(self, manifest, observed, output):
        # Retain original RPC material for CORE's existing H/H+1 verifier. This
        # transports observations only: no new signature/result proof verifier.
        heights = sorted({int(row["height"]) for row in observed["transactions"] if row.get("status") == "confirmed"})
        require(len(heights) <= 2048, "original finite height bound exceeded")
        rows = []
        for height in heights:
            until = time.monotonic() + 10
            while True:
                self.sample()
                try:
                    url = manifest["nodes"][0]["rpcUrl"]
                    first = self.rpc(url, "block", "?height="+str(height))
                    successor = self.rpc(url, "block", "?height="+str(height+1))
                    execution = self.rpc(url, "block_results", "?height="+str(height))
                    rows.append(dict(height=height, block=first, successor=successor, execution=execution))
                    break
                except (OSError, ValueError, KeyError, RuntimeError):
                    if time.monotonic() >= until: raise RuntimeError("normal H/H+1 RPC material unavailable")
                    time.sleep(.2)
        write_new(output, dict(kind="original-RPC-H-Hplus1-material", proofVerified=False,
                               authority="RPC observations only; original CORE verifier still required", rows=rows))
        return len(rows)

    def stop(self):
        self.stopping = True
        started = time.monotonic()
        rows, _ = guard.proc_inventory()
        for pid in guard.owned_set(rows, os.getpid(), known=self.known):
            self.known[pid] = rows[pid]["startTicks"]
        # Session leaders are direct Popen children; PID remains reserved until
        # wait. Descendants are separately checked by original startTicks.
        for c in self.children:
            if c["process"].poll() is None:
                try: os.killpg(c["process"].pid, signal.SIGTERM)
                except ProcessLookupError: pass
        while time.monotonic() - started < CAPS["cleanupSeconds"]:
            rows, _ = guard.proc_inventory()
            for pid in guard.owned_set(rows, os.getpid(), known=self.known):
                self.known[pid] = rows[pid]["startTicks"]
            live = [(pid, row) for pid, row in rows.items() if pid != os.getpid() and self.known.get(pid) == row["startTicks"] and row["state"] != "Z"]
            if not live:
                break
            if time.monotonic() - started > 3:
                for pid, expected in live:
                    try:
                        current = guard.parse_stat(guard.bounded(Path("/proc") / str(pid) / "stat"), pid)
                        if current["startTicks"] == expected["startTicks"]:
                            os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    except FileNotFoundError: pass
            for c in self.children: c["process"].poll()
            time.sleep(.1)
        for c in self.children:
            if c["process"].poll() is None:
                c["process"].kill()
            c["process"].wait(timeout=1)
        for _, log in self.logs: log.close()
        # Reap only our own adopted children, never another runner task.
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0: break
            except ChildProcessError: break
        rows, _ = guard.proc_inventory()
        return not any(pid != os.getpid() and self.known.get(pid) == row["startTicks"] for pid, row in rows.items())

    def process_receipt(self):
        rows = []
        for child in self.children:
            process = child["process"]
            status = process.poll()
            rows.append(dict(name=child["name"], pid=process.pid, startTicks=child.get("startTicks"),
                             command=child["command"],
                             rawReturnCode=status, exitCode=status if status is not None and status >= 0 else None,
                             signal=-status if status is not None and status < 0 else None,
                             exited=status is not None, observedLaunchToExitNs=child.get("elapsedNs")))
        return rows


def ports_available():
    sockets = []
    try:
        for base in (31656, 31757, 31858):
            for offset in range(4):
                sock = socket.socket(); sock.bind(("127.0.0.1", base + offset)); sockets.append(sock)
    finally:
        for sock in sockets: sock.close()


def run(args):
    source, parent = Path(args.source), Path(args.work_parent)
    identity = check_source(source, args.commit)
    require(args.profile == "legacy-native", "PQ normal producer/client not supplied; legacy cannot satisfy PQ")
    if not args.execute:
        return dict(status="prepared-only", source=identity, caps=CAPS, profiles=PROFILES,
                    scope="legacy-native normal four-process prerequisite; PQ and H/H+1 verified-result proof not implemented")
    require(sys.platform == "linux" and os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted", "isolated GitHub hosted Linux job required")
    require(parent.is_absolute() and parent.resolve(strict=True) == parent and source not in parent.parents and parent != source, "canonical work parent outside checkout required")
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    require(parent == runner_temp or runner_temp in parent.parents, "work parent must be this job RUNNER_TEMP")
    rows, _ = guard.proc_inventory(); admit(guard.memory_available(), shutil.disk_usage(parent).free, heavy_processes(rows))
    ports_available()
    # Original paired runner's Linux subreaper model; no shared process-group kill.
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(36, 1, 0, 0, 0) == 0, "Linux child subreaper unavailable")
    import tempfile
    work = Path(tempfile.mkdtemp(prefix="normal-cohort-", dir=parent)); work.chmod(0o700)
    (work / ".private").mkdir(mode=0o700); (work / "public").mkdir(mode=0o700)
    window = Window(source, work)
    result = dict(schema="YNX-NORMAL-FOUR-PROCESS-LAB/v1", source=identity, caps=CAPS,
                  profile=args.profile, sameHost=True, physicalFaultDomains=1, sustainedTPSQualified=False,
                  PQMeasured=False, HPlusOneResultProofVerified=False, firstCause=None, cases=[])
    try:
        bins = work / ".private/bin"
        # Compilation and measurement are sequential; no overlapping build job.
        for name in ("ynx-consensus-perf-fixture", "ynx-comet", "ynx-consensus-perf-client"):
            window.wait(window.launch("build-" + name, ["go", "build", "-mod=readonly", "-p", "1", "-o", str(bins / name), "./cmd/" + name]))
        result["binarySHA256"] = {n: guard.digest(bins / n) for n in ("ynx-consensus-perf-fixture", "ynx-comet", "ynx-consensus-perf-client")}
        for name, profile in PROFILES.items():
            case = work / ".private" / name; case.mkdir(mode=0o700)
            network = case / "network"
            window.wait(window.launch(name + "-fixture", [str(bins / "ynx-consensus-perf-fixture"), "-ephemeral", "-retain-ephemeral-senders", "-output", str(network), "-count", str(profile["count"])]))
            manifest_path = network / "network-manifest.json"
            manifest = json.loads(manifest_path.read_bytes()); validate_manifest(manifest, network)
            migration = json.loads(Path(manifest["migrationPath"]).read_bytes())
            nodes = [window.launch(name + "-node-" + str(i), [str(bins / "ynx-comet"), *node_args(n, manifest, migration)], True) for i, n in enumerate(manifest["nodes"])]
            ready = window.ready(manifest)
            report = work / "public" / (name + "-report.json")
            client = window.launch(name + "-client", [str(bins / "ynx-consensus-perf-client"), "-manifest", str(manifest_path), "-transactions", str(network / "transactions.json"), "-output", str(report), "-sender-mode", "ready-pool", "-rounds", str(profile["rounds"]), "-offered-rate", str(profile["rate"]), "-cohort-window", profile["window"], "-timeout", profile["timeout"], "-concurrency", "2", "-observers", "2"])
            code = window.wait(client, allow_failure=True)
            if code != 0 and result["firstCause"] is None:
                result["firstCause"] = name + " normal client exited " + str(code) + "; original report/log retained"
            observed = json.loads(report.read_bytes())
            successor_heights = window.successor_data(manifest, observed, work / "public" / (name + "-successor-data.json"))
            # No tail drain/backlog reconstructed window: invoke original data CLI.
            files = dict(manifest=manifest_path, input=network / "transactions.json", journal=network / "sender-ready.signed.jsonl", summary=report, plan=Path(str(report) + ".cohort-plan.json"))
            # Retain public signed inputs for the original readback CLI. Never
            # copy the fixture sender bundle, validator keys, HRS or caches.
            for key in ("manifest", "input", "journal"):
                public_copy = work / "public" / (name + "-" + key + (".jsonl" if key == "journal" else ".json"))
                with open(public_copy, "xb") as out:
                    out.write(files[key].read_bytes()); out.flush(); os.fsync(out.fileno())
                os.chmod(public_copy, 0o600)
                files[key] = public_copy
            bindings = dict(run=name, count=profile["count"], rounds=profile["rounds"], fromHeight="1", untilHeight=str(2**53-1), sha256={k: guard.digest(v) for k, v in files.items()})
            binding = work / "public" / (name + "-bindings.json"); write_new(binding, bindings)
            readback = work / "public" / (name + "-readback.json")
            cmd = ["node", str(source / "scripts/loadtest/same-control-readback.mjs")]
            for key, value in files.items(): cmd += ["--" + key, str(value)]
            window.wait(window.launch(name + "-readback", cmd + ["--bindings", str(binding), "--output", str(readback)]))
            result["cases"].append(dict(name=name, clientExitCode=code, nodePIDs=[p.pid for p in nodes], nodeCount=4,
                                        readyHeights=[s["sync_info"]["latest_block_height"] for s in ready],
                                        final=observed["summary"]["finalSubmitted"], requested=profile["count"]*profile["rounds"],
                                        successorHeightObservations=successor_heights, successorProofVerified=False,
                                        readback=str(readback), finalBoundary="original qualified client observation; not physical Commit or H+1 result authentication"))
            require(code == 0 and observed["summary"]["finalSubmitted"] == profile["count"]*profile["rounds"], "full normal cohort failed; preserve original outcomes")
            window.stopping = True
            for p in nodes: p.send_signal(signal.SIGTERM)
            for p in nodes: window.wait(p, allow_failure=True)
            for child in window.children:
                if child["process"] in nodes: child["persistent"] = False
            window.stopping = False
            ports_available()
        check_source(source, args.commit)
    except BaseException as error:
        if result["firstCause"] is None: result["firstCause"] = str(error)
        else: result["followingFailure"] = str(error)
    finally:
        try:
            result["cleanupComplete"] = window.stop()
        except BaseException as error:
            result["cleanupComplete"] = False
            result["cleanupError"] = str(error)
        result.update(peakRSSBytes=window.peak_rss, peakNewBytes=window.peak_bytes,
                      elapsedSeconds=time.monotonic()-window.started, resourceSamples=window.samples,
                      cpuAffinity=window.cpus, physicalCommitMeasured=False,
                      resourceSemantics="sampled /proc owned RSS (200ms wait loop), allocated artifact bytes (1s); not hard cgroup ceilings or atomic host snapshots",
                      processPhaseMeaning="parent monotonic launch-to-observed-exit durations; includes polling; concurrent node lifetimes overlap and are not additive",
                      processPhases=[dict(name=c["name"], elapsedNs=c.get("elapsedNs"), exitCode=c["process"].returncode) for c in window.children])
        write_new(work / "public/receipt.json", result)
        print(json.dumps(dict(publicArtifacts=str(work / "public"), firstCause=result["firstCause"], cleanupComplete=result["cleanupComplete"])))
    require(result["firstCause"] is None and result["cleanupComplete"], "lab failed; original receipt retained")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True); parser.add_argument("--commit", required=True)
    parser.add_argument("--work-parent", required=True)
    parser.add_argument("--profile", choices=["legacy-native", "pq-and"], required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    def interrupted(signum, frame): raise RuntimeError("owned lab received signal " + str(signum))
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    print(json.dumps(run(args), separators=(",", ":")))


if __name__ == "__main__":
    main()
