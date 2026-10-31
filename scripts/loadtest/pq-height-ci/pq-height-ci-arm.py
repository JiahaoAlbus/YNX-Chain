#!/usr/bin/env python3
"""Fixed original-input per-height CI intake, not the four-scope controller.

Only the existing Perf prepare/run/compare and original Window do the work.
No signing, input generation, node, pressure, finality or optimization grant.
"""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import sys
import time

HERE = Path(__file__).resolve().parent
TOOLS = "9c22b0700d4e21f7fc35ec3067339722fb8bc330"
TOOLS_TREE = "642d8442606ddc6d7cf44c2497109350f9ebee20"
ARMS = {
    "before": ("fdc08527514587d5756264e43ab63588791e189a", "883069d6f4c123d55dea797044186e6b7de2ad0e"),
    "after-a": ("b77a3df453d880ab31aca99ce94fc9a7feb4fffb", "1ab3bcca16cd7335866231af1554b9a27a0ea049"),
    "after-b": ("b2120f6a0dc65666145cc9976b9f13d8b175f34d", "3d083b7da930d86c3312024268b846312341d95c"),
}
INPUT_SHA = "c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401"
VENDOR = {
    "consensus-linux-cohort.py": "df2f0e885cc52bb1caa095282a491113f044fd428320f74d7bae116bd13ef62b",
    "pq-paired-linux-window.py": "b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2",
    "pq-source-artifact-intake.py": "0c59129b9951de6b0b0b30f098fd732c2652ffbf0a66ecddd99fe525da0b260b",
}
CAPS = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30,
            newBytes=8 << 30, initialMemoryBytes=6 << 30,
            initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
REPOSITORY_URL = "https://github.com/JiahaoAlbus/YNX-Chain.git"
TEST = "TestPQPerHeightVectors"


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # No bytecode cache may replace the source bytes being pinned.
    exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
    return module


def dependencies():
    for name, expected in VENDOR.items():
        path = HERE / "vendor" / name
        require(path.is_file() and not path.is_symlink() and
                hashlib.sha256(path.read_bytes()).hexdigest() == expected,
                "frozen original bootstrap dependency changed: " + name)
    intake = load_module("height_original_intake", HERE / "vendor/pq-source-artifact-intake.py")
    lab = load_module("height_original_window", HERE / "vendor/consensus-linux-cohort.py")
    require(lab.CAPS == CAPS, "original Window caps changed")
    return intake, lab


def height_names(complete=True):
    names = {"baseline-input.json", "compile-height-vectors.log", "actual-height-vectors.log", "height-manifest.json", "receipt.json"}
    names.update("height-%03d-%s.json" % (i, kind) for i in range(41) for kind in ("state", "record"))
    if complete:
        names.add("HEIGHT-CI.json")
    return names


def height_catalog(intake):
    """Extend ONLY the catalog of an isolated original parser module.

    The frozen ZIP framing/CRC/metadata/redirect/size code stays byte-for-byte
    original. It still handles the old artifact under its original profile.
    New height archives have a closed flat catalog and no directory entries.
    """
    original = intake.public_names

    def names(profile):
        return height_names() if profile == "height-original" else original(profile)

    intake.public_names = names


def pass_record(raw):
    require(len(raw) <= CAPS["logBytes"], "bounded actual test log required")
    lines = raw.decode("utf-8", errors="strict").splitlines()
    require(lines.count("=== RUN   " + TEST) == 1 and
            sum(re.fullmatch(r"--- PASS: " + TEST + r" \([0-9.]+s\)", line) is not None for line in lines) == 1 and
            lines.count("PASS") == 1,
            "one actual per-height test RUN and PASS required")
    require(not any("--- SKIP:" in line or "--- FAIL:" in line or "no tests to run" in line or
                    (line.startswith("=== RUN") and line != "=== RUN   " + TEST) for line in lines),
            "skipped/failed/zero-hit/additional test cannot qualify")


def controls_record(raw):
    require(len(raw) <= CAPS["logBytes"], "bounded upstream control log required")
    lines = raw.decode("utf-8", errors="strict").splitlines()
    require(sum(re.fullmatch(r"Ran 9 tests in [0-9.]+s", line) is not None for line in lines) == 1 and
            lines.count("OK") == 1 and not any("skipped" in line.lower() or "FAILED" in line for line in lines),
            "nine actual original fixture controls with zero skips required")


def verify_height(root, arm, tools, published=False, expected_run=None, expected_workflow=None):
    intake, _ = dependencies()
    root, tools = Path(root), Path(tools)
    require(root.resolve(strict=True) == root and not root.is_symlink(), "canonical original height output required")
    require({p.name for p in root.iterdir()} == height_names(published), "complete closed height catalog required")
    for path in root.iterdir():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 256 << 20,
                "regular bounded unaliased public height leaf required")
        if path.suffix == ".json":
            value = intake.read_json(path, 256 << 20)  # Duplicate-key/trailing rejection, one leaf at a time.
            del value
    h = load_module("original_height_validation", tools / "scripts/loadtest/pq-height-vectors.py")
    receipt, manifest, records = h.load_vectors(root)
    commit, tree = ARMS[arm]
    require(receipt.get("sourceCommit") == commit and receipt.get("sourceTree") == tree and
            receipt.get("toolsCommit") == TOOLS and receipt.get("caps") == CAPS and
            receipt.get("inputSHA256") == INPUT_SHA and receipt.get("profile") == "original" and
            receipt.get("newFunctionalValidation") is True and receipt.get("performanceComparison") is False and
            receipt.get("evidenceObserverRetired") is True,
            "actual complete pinned per-height execution required")
    require(manifest.get("goVersion") == "go1.26.10" and manifest.get("architecture") == "amd64" and
            type(manifest.get("gomaxprocs")) is int and manifest["gomaxprocs"] == 1 and len(records) == 41,
            "actual exact compiler/configuration and 41-record denominator required")
    expected_leaf = intake.digest(tools / "scripts/loadtest/overlays/pq_height_vectors_test.go.in")
    require(receipt.get("heightVectorLeafSHA256") == expected_leaf,
            "actual height observer differs from fixed tools")
    children = receipt.get("processes", [])
    require([p.get("name") for p in children] == ["compile-height-vectors", "actual-height-vectors"] and
            all(type(p.get("pid")) is int and p["pid"] > 0 and type(p.get("startTicks")) is int and
                p["startTicks"] > 0 and p.get("exited") is True and p.get("rawReturnCode") == 0 for p in children),
            "actual compile/replay process identities and terminal zero required")
    pass_record((root / "actual-height-vectors.log").read_bytes())
    if published:
        controller = intake.read_json(root / "HEIGHT-CI.json", 4 << 20)
        require(controller.get("schema") == "YNX-PQ-HEIGHT-CI/v1" and controller.get("arm") == arm and
                controller.get("mode") == "replay" and controller.get("sourceCommit") == commit and
                controller.get("toolsCommit") == TOOLS and controller.get("inputSHA256") == INPUT_SHA and
                controller.get("caps") == CAPS and controller.get("firstCause") is None and
                controller.get("cleanupComplete") is True and controller.get("perHeightComplete") is True and
                controller.get("runId") == expected_run and controller.get("workflowCommit") == expected_workflow,
                "before must be actual complete same-run per-height result, not old baseline")
        original = controller.get("originalArtifact", {})
        require(original == intake.OLD_ARTIFACT, "original signed corpus provenance changed")
    return dict(schema="YNX-PQ-HEIGHT-READBACK/v1", sourceCommit=commit, toolsCommit=TOOLS,
                inputSHA256=INPUT_SHA, records=41, exactTestPass=True, perHeightComplete=True,
                fullChainBaselineReady=False, performanceComparison=False)


def checkout(window, name, commit, tree, paths):
    target = window.work / (".private/" + name)
    target.mkdir(mode=0o700)
    commands = [
        ["git", "init", "--quiet", str(target)],
        ["git", "-C", str(target), "remote", "add", "origin", REPOSITORY_URL],
        ["git", "-C", str(target), "-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "--depth=1", "--filter=blob:none", "--no-tags", "origin", commit],
        ["git", "-C", str(target), "sparse-checkout", "init", "--no-cone"],
        ["git", "-C", str(target), "sparse-checkout", "set", "--no-cone", *paths],
        ["git", "-C", str(target), "-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", commit],
    ]
    for index, command in enumerate(commands):
        window.wait(window.launch(name + "-checkout-%d" % index, command))
    window.wait(window.launch(name + "-identity", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                "check-source", "--source", str(target), "--commit", commit, "--tree", tree]))
    return target


def before_artifact(environment, intake):
    fields = ("HEIGHT_BEFORE_ARTIFACT_ID", "HEIGHT_BEFORE_ARTIFACT_DIGEST", "HEIGHT_BEFORE_ARTIFACT_NAME")
    require(all(environment.get(key) for key in fields), "actual successful before artifact outputs required")
    require(re.fullmatch(r"[1-9][0-9]{0,19}", environment[fields[0]]) is not None, "positive actual artifact ID required")
    require(environment[fields[2]] == "pq-height-before-" + environment["GITHUB_RUN_ID"], "same-run before artifact required")
    return dict(artifactId=int(environment[fields[0]]), runId=int(environment["GITHUB_RUN_ID"]),
                name=environment[fields[2]], digest=intake.normalize_digest(environment[fields[1]]), size=None,
                workflowCommit=environment["GITHUB_SHA"])


def public_from_runner(path, operation):
    intake, _ = dependencies()
    require(path.is_file() and path.stat().st_size <= CAPS["logBytes"], "bounded original entry log required")
    rows = []
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line, object_pairs_hook=intake.strict_pairs)
        except ValueError:
            continue
        if type(row) is dict and "publicArtifacts" in row:
            rows.append(row)
    require(len(rows) == 1, "one original height runner public record required")
    public = Path(rows[0]["publicArtifacts"])
    require(public.is_absolute() and public.resolve(strict=True) == public and
            public.parent.parent == operation and re.fullmatch("pq-height-vectors-[A-Za-z0-9_-]+", public.parent.name) and
            public.name == "public", "height public output escaped original Window")
    return public


def github_output(name, value):
    require(name in ("diagnostics", "public") and "\n" not in value and "\r" not in value,
            "closed public workflow output required")
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(name + "=" + value + "\n")


def run(args):
    intake, lab = dependencies()
    height_catalog(intake)
    commit, tree = ARMS[args.arm]
    if not args.execute:
        return dict(status="prepared-only", arm=args.arm, mode=args.mode, sourceCommit=commit,
                    toolsCommit=TOOLS, inputSHA256=INPUT_SHA, caps=CAPS, executed=False)
    require(sys.platform == "linux" and os.environ.get("GITHUB_ACTIONS") == "true" and
            os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and os.environ.get("GITHUB_RUN_ATTEMPT") == "1",
            "fresh sole hosted Linux first attempt required")
    require(os.uname().machine == "x86_64" and len(os.sched_getaffinity(0)) >= 2, "actual amd64 two CPU affinity required")
    parent = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    work = Path(args.operation)
    require(work.is_absolute() and work.parent == parent and not work.exists() and not work.is_symlink(),
            "fresh exact job-owned operation required")
    # Resolve only the executable path. No pre-child go env/version process.
    go = shutil.which("go")
    require(go is not None, "preinstalled pinned Go toolchain required")
    go_root = Path(go).resolve(strict=True).parent.parent
    workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    rows, _ = lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(), shutil.disk_usage(parent).free, lab.heavy_processes(rows))
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, "original subreaper required")
    work.mkdir(mode=0o700)
    (work / ".private").mkdir(mode=0o700)
    (work / "public").mkdir(mode=0o700)
    window = lab.Window(HERE, work, additional_storage=(parent, workspace, go_root))
    window.storage_roots = intake.nonoverlapping_roots(window.storage_roots)
    window.env.update(RUNNER_TEMP=str(work), GOMAXPROCS="1", PYTHONDONTWRITEBYTECODE="1",
                      GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1")
    window.env.pop("GH_TOKEN", None)
    window.env.pop("GITHUB_TOKEN", None)
    record = dict(schema="YNX-PQ-HEIGHT-CI/v1", arm=args.arm, mode=args.mode, toolsCommit=TOOLS,
                  sourceCommit=commit, sourceTree=tree, inputSHA256=INPUT_SHA,
                  workflowCommit=os.environ["GITHUB_SHA"], runId=os.environ["GITHUB_RUN_ID"],
                  originalArtifact=intake.OLD_ARTIFACT, firstCause=None, cleanupComplete=False,
                  compileComplete=False, perHeightComplete=False, comparisonComplete=False,
                  fullChainBaselineReady=False, optimizedPressureAuthorized=False,
                  performanceComparison=False, finality="UNMEASURED", caps=CAPS,
                  storageRoots=[str(path) for path in window.storage_roots])
    public = None
    github_output("diagnostics", str(work / "public"))
    try:
        # Validate the small controller checkout under the same Window too;
        # no untracked replacement controller qualifies a hosted result.
        window.wait(window.launch("controller-identity", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                    "check-controller", "--source", str(workspace), "--commit", os.environ["GITHUB_SHA"]]))
        tools = checkout(window, "tools", TOOLS, TOOLS_TREE, ["/scripts/loadtest/"])
        owner = checkout(window, "owner", commit, tree, ["/go.mod", "/go.sum", "/internal/", "/third_party/cometbft/"])
        if args.arm == "before":
            window.wait(window.launch("upstream-height-controls", [sys.executable, "-B", str(tools / "scripts/loadtest/test_pq_height_vectors.py")]))
            controls_record((work / "public/upstream-height-controls.log").read_bytes())
            record["upstreamFixtureControls"] = dict(passed=9, skipped=0, actualApplicationReplay=False)
        prepared = work / "prepared"
        window.wait(window.launch("prepare-height", [sys.executable, "-B", str(tools / "scripts/loadtest/pq-height-vectors.py"),
                    "prepare", "--owner", str(owner), "--commit", commit, "--output", str(prepared)]))
        if args.mode == "compile-only":
            window.source = prepared / "source"
            binary = work / ".private/bin/height.test"
            window.wait(window.launch("compile-height-only", [str(go), "test", "-overlay", str(prepared / "height-overlay.json"),
                        "-mod=readonly", "-p", "1", "-c", "-o", str(binary), "./internal/consensus"]))
            record.update(compileComplete=True, binarySHA256=intake.digest(binary))
        else:
            if args.arm == "before":
                before = intake.download_artifact(intake.OLD_ARTIFACT, work / ".private/original", "original", window.sample)
                window.wait(window.launch("validate-original-input", [sys.executable, "-B", str(HERE / "vendor/pq-source-artifact-intake.py"),
                            "verify-public", "--public", str(before), "--profile", "original", "--source-commit", ARMS["before"][0], "--expected-input", INPUT_SHA]))
            else:
                expectation = before_artifact(os.environ, intake)
                before = intake.download_artifact(expectation, work / ".private/height-before", "height-original", window.sample)
                window.wait(window.launch("validate-before-heights", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                            "verify-height", "--public", str(before), "--arm", "before", "--tools", str(tools), "--published",
                            "--run-id", os.environ["GITHUB_RUN_ID"], "--workflow", os.environ["GITHUB_SHA"]]))
            command = [sys.executable, "-B", str(tools / "scripts/loadtest/pq-height-vectors.py"), "run",
                       "--prepared", str(prepared / "height-prepared.json"), "--input", str(before / "baseline-input.json"),
                       "--input-sha256", INPUT_SHA, "--profile", "original", "--execute"]
            window.wait(window.launch("original-height-run", command))
            public = public_from_runner(work / "public/original-height-run.log", work)
            window.wait(window.launch("validate-actual-heights", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                        "verify-height", "--public", str(public), "--arm", args.arm, "--tools", str(tools)]))
            record.update(compileComplete=True, perHeightComplete=True)
            if args.arm != "before":
                target = work / "public/HEIGHT-DIFFERENTIAL.json"
                window.wait(window.launch("compare-original-heights", [sys.executable, "-B", str(tools / "scripts/loadtest/pq-height-vectors.py"),
                            "compare", "--before", str(before), "--after", str(public), "--output", str(target)]))
                diff = intake.read_json(target, 1 << 20)
                require(diff.get("before") == ARMS["before"][0] and diff.get("after") == commit and
                        diff.get("inputSHA256") == INPUT_SHA and diff.get("recordsCompared") == 41 and
                        diff.get("perHeightFunctionalEqual") is True and diff.get("optimizedPressureAuthorized") is False,
                        "complete exact 41-record differential required")
                record["comparisonComplete"] = True
        window.wait(window.launch("validate-preserved-source", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                    "check-prepared", "--prepared", str(prepared / "height-prepared.json"), "--tools", str(tools),
                    "--arm", args.arm]))
        window.sample()
    except BaseException as error:
        record["firstCause"] = str(error)
        if public is None:
            try:
                public = public_from_runner(work / "public/original-height-run.log", work)
            except (OSError, ValueError, RuntimeError):
                pass
    finally:
        try:
            record["cleanupComplete"] = window.stop()
        except BaseException as error:
            record["cleanupError"] = str(error)
        if not record["cleanupComplete"] and record["firstCause"] is None:
            record["firstCause"] = record.get("cleanupError", "original cleanup incomplete")
        record.update(elapsedSeconds=time.monotonic() - window.started, peakRSSBytes=window.peak_rss,
                      peakNewBytes=window.peak_bytes, processes=window.process_receipt(),
                      resourceSamples=window.samples, retiredSamplingEvidence=window.retired_samples)
        intake.write_new(work / "public/HEIGHT-CI.json", record)
        if public is not None:
            intake.write_new(public / "HEIGHT-CI.json", record)
            github_output("public", str(public))
    require(record["firstCause"] is None and record["cleanupComplete"] and record["compileComplete"] and
            (args.mode == "compile-only" or (record["perHeightComplete"] and (args.arm == "before" or record["comparisonComplete"]))),
            "height arm incomplete; retained original first cause and process evidence")
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("arm", allow_abbrev=False)
    p.add_argument("--arm", choices=tuple(ARMS), required=True)
    p.add_argument("--operation", required=True)
    p.add_argument("--mode", choices=("compile-only", "replay"), default="replay")
    p.add_argument("--execute", action="store_true")
    p = sub.add_parser("check-source", allow_abbrev=False)
    for name in ("source", "commit", "tree"):
        p.add_argument("--" + name, required=True)
    p = sub.add_parser("check-controller", allow_abbrev=False)
    p.add_argument("--source", required=True)
    p.add_argument("--commit", required=True)
    p = sub.add_parser("check-prepared", allow_abbrev=False)
    p.add_argument("--prepared", required=True)
    p.add_argument("--tools", required=True)
    p.add_argument("--arm", choices=tuple(ARMS), required=True)
    p = sub.add_parser("verify-height", allow_abbrev=False)
    p.add_argument("--public", required=True)
    p.add_argument("--arm", choices=tuple(ARMS), required=True)
    p.add_argument("--tools", required=True)
    p.add_argument("--published", action="store_true")
    p.add_argument("--run-id")
    p.add_argument("--workflow")
    args = parser.parse_args(argv)
    if args.command in ("check-source", "check-controller"):
        intake, _ = dependencies()
        source = Path(args.source)
        require(source.is_absolute() and source.resolve(strict=True) == source, "canonical checkout required")
        require(re.fullmatch("[0-9a-f]{40}", args.commit) is not None and
                intake.git(source, "rev-parse", "HEAD") == args.commit and
                intake.git(source, "status", "--porcelain", "--untracked-files=normal") == "", "exact clean source identity required")
        tree = intake.git(source, "rev-parse", "HEAD^{tree}")
        if args.command == "check-source":
            require(tree == args.tree, "original source tree differs")
        value = dict(commit=args.commit, tree=tree, clean=True)
    elif args.command == "check-prepared":
        intake, _ = dependencies()
        tools = Path(args.tools)
        require(intake.git(tools, "rev-parse", "HEAD") == TOOLS and
                not intake.git(tools, "status", "--porcelain", "--untracked-files=normal"), "original tools changed")
        h = load_module("original_preserved_height_source", tools / "scripts/loadtest/pq-height-vectors.py")
        plan, source = h.validate(args.prepared)
        require((plan["commit"], plan["tree"]) == ARMS[args.arm] and plan["observedOwnerDirty"] == "",
                "preserved original source identity differs")
        require(intake.git(Path(plan["owner"]), "rev-parse", "HEAD") == ARMS[args.arm][0] and
                not intake.git(Path(plan["owner"]), "status", "--porcelain", "--untracked-files=normal"), "original owner checkout changed")
        value = dict(sourceCommit=plan["commit"], sourceTree=plan["tree"], archiveSHA256=plan["archiveSha256"], preserved=True)
    elif args.command == "verify-height":
        value = verify_height(args.public, args.arm, args.tools, args.published, args.run_id, args.workflow)
    else:
        value = run(args)
    print(json.dumps(value, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    def interrupted(number, frame):
        raise RuntimeError("height CI interrupted: " + str(number))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    raise SystemExit(main())
