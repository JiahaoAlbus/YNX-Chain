#!/usr/bin/env python3
"""Fixed original-input per-height CI intake, not the four-scope controller.

Only the existing Perf prepare/run/compare and original Window do the work.
No signing, input generation, node, pressure, finality or optimization grant.
"""
import argparse
import ast
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
TOOLS = "41041e368812142808cc874421078406b8fb5885"
TOOLS_TREE = "efa33c14cf01900863b13cf0e310722aaf64f90c"
KERNEL_TOOLS = "a786dda03df9cef03f27ca0de788d0f718dc30b3"
KERNEL_TREE = "4a73122d19c0975f3322dffb474680d2a2cd759b"
KERNEL_SHA = "d17f5d7c991ffd01fdbba61d9ead6bbdaeeb9c5d3998a8906e5280656c5561ed"
GUARD_ARTIFACT = dict(artifactId=13052310092, runId=41226547284,
    name="pq-height-linux-guard-controls-41226547284", size=5395,
    digest="6ecf2298994054d786d6bb3a5e1077ff3ce6b9ee59f7357bd8c113d1f650f92a",
    workflowCommit="de6e43a8af0ba04fd7f3c1ad0b364ffe56e88732")
GUARD_PROCESSES = ["controller-identity", *["tools-checkout-%d" % i for i in range(6)],
    "tools-identity", "test_linux_owned_rss", "test_pq_height_vectors",
    "test_consensus_linux_cohort", "preserved-tools"]
GUARD_NAMES = {"HEIGHT-GUARD-CONTROLS.json", *[name + ".log" for name in GUARD_PROCESSES]}
BEFORE_TOOLS = "9c22b0700d4e21f7fc35ec3067339722fb8bc330"
FUNCTIONAL_LEAF = "3dda570d92374df2e66aaedadb35907354ec7073ac142fb72de67a16dd2ce0e0"
BEFORE_ARTIFACT = dict(artifactId=13050898515, runId=41223769700,
    name="pq-height-before-41223769700", size=676742462,
    digest="e5369f3ea4211a1041d9f3e0a1625b91e6551760bfe2ebeca4d66617b377e2e4",
    workflowCommit="759957070c303cf2adfc5e0db70275cb51ed9c2b")
RETAINED_LINUX_CONTROLS = {"test_linux_owned_rss.py": 15, "test_pq_height_vectors.py": 10,
                           "test_consensus_linux_cohort.py": 8}
LINUX_CONTROLS = {"test_process_evidence.py": 6}
ARMS = {
    "before": ("fdc08527514587d5756264e43ab63588791e189a", "883069d6f4c123d55dea797044186e6b7de2ad0e"),
    "after-a": ("b77a3df453d880ab31aca99ce94fc9a7feb4fffb", "1ab3bcca16cd7335866231af1554b9a27a0ea049"),
    "after-b": ("b2120f6a0dc65666145cc9976b9f13d8b175f34d", "3d083b7da930d86c3312024268b846312341d95c"),
}
INPUT_SHA = "c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401"
VENDOR = {
    "consensus-linux-cohort.py": "9a313e7230050b46da196bce64f1cc7b763f0874b7a1cd26c3ac499f5e68084d",
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
    require(lab.CAPS == CAPS and lab.RSS_OBSERVER_VERSION == "same-process-rss-v2",
            "original Window caps or fixed RSS observer changed")
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
        if profile == "height-original":
            return height_names()
        if profile == "linux-guard-original":
            return GUARD_NAMES
        return original(profile)

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


def controls_record(raw, count=10, required=()):
    require(len(raw) <= CAPS["logBytes"], "bounded upstream control log required")
    lines = raw.decode("utf-8", errors="strict").splitlines()
    require(sum(re.fullmatch(r"Ran " + str(count) + r" tests in [0-9.]+s", line) is not None for line in lines) == 1 and
            lines.count("OK") == 1 and not any("skipped" in line.lower() or "FAILED" in line for line in lines),
            "exact actual upstream fixture controls with zero skips required")
    for name in required:
        require(sum(line.startswith(name + " (") and line.endswith(" ... ok") for line in lines) == 1,
                "named actual Linux kernel control did not pass: " + name)


def fixed_diff(diff, commit):
    require(diff.get("before") == ARMS["before"][0] and diff.get("after") == commit and
            diff.get("inputSHA256") == INPUT_SHA and diff.get("recordsCompared") == 41 and
            diff.get("perHeightFunctionalEqual") is True and
            diff.get("guardOnlyFunctionalCompatibility") is True and
            diff.get("performanceComparisonQualified") is False and
            diff.get("optimizedPressureAuthorized") is False,
            "complete exact 41-record guard-only functional differential required")


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
            receipt.get("toolsCommit") == (BEFORE_TOOLS if arm == "before" else TOOLS) and receipt.get("caps") == CAPS and
            receipt.get("inputSHA256") == INPUT_SHA and receipt.get("profile") == "original" and
            receipt.get("newFunctionalValidation") is True and receipt.get("performanceComparison") is False and
            receipt.get("evidenceObserverRetired") is True,
            "actual complete pinned per-height execution required")
    require(manifest.get("goVersion") == "go1.26.10" and manifest.get("architecture") == "amd64" and
            type(manifest.get("gomaxprocs")) is int and manifest["gomaxprocs"] == 1 and len(records) == 41,
            "actual exact compiler/configuration and 41-record denominator required")
    expected_leaf = intake.digest(tools / "scripts/loadtest/overlays/pq_height_vectors_test.go.in")
    require(expected_leaf == FUNCTIONAL_LEAF and receipt.get("heightVectorLeafSHA256") == expected_leaf,
            "actual height observer differs from fixed tools")
    if arm != "before":
        require(receipt.get("resourceObserverVersion") == "same-process-rss-v2" and
                receipt.get("resourceObserverSHA256") == intake.digest(tools / "scripts/loadtest/consensus-linux-cohort.py") and
                receipt.get("compatibleFunctionalToolsCommit") == BEFORE_TOOLS,
                "actual fixed guard-only successor provenance required")
    children = receipt.get("processes", [])
    require([p.get("name") for p in children] == ["compile-height-vectors", "actual-height-vectors"] and
            all(type(p.get("pid")) is int and p["pid"] > 0 and type(p.get("startTicks")) is int and
                p["startTicks"] > 0 and p.get("exited") is True and p.get("rawReturnCode") == 0 for p in children),
            "actual compile/replay process identities and terminal zero required")
    pass_record((root / "actual-height-vectors.log").read_bytes())
    if published:
        require(arm == "before" and expected_run == str(BEFORE_ARTIFACT["runId"]) and
                expected_workflow == BEFORE_ARTIFACT["workflowCommit"],
                "only the fixed independently successful original before may be reused")
        controller = intake.read_json(root / "HEIGHT-CI.json", 4 << 20)
        require(controller.get("schema") == "YNX-PQ-HEIGHT-CI/v1" and controller.get("arm") == arm and
                controller.get("mode") == "replay" and controller.get("sourceCommit") == commit and
                controller.get("toolsCommit") == BEFORE_TOOLS and controller.get("inputSHA256") == INPUT_SHA and
                controller.get("caps") == CAPS and controller.get("firstCause") is None and
                controller.get("cleanupComplete") is True and controller.get("perHeightComplete") is True and
                controller.get("runId") == expected_run and controller.get("workflowCommit") == expected_workflow,
                "before must be the actual complete fixed prior run, never a regenerated baseline")
        original = controller.get("originalArtifact", {})
        require(original == intake.OLD_ARTIFACT, "original signed corpus provenance changed")
    return dict(schema="YNX-PQ-HEIGHT-READBACK/v1", sourceCommit=commit, toolsCommit=receipt["toolsCommit"],
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
    # No caller-supplied output may silently replace the retained 41-record
    # before. The official API will bind ID, run, workflow, byte count/digest.
    require(not any(key.startswith("HEIGHT_BEFORE_") for key in environment),
            "fixed original before artifact cannot be overridden")
    require(intake.normalize_digest(BEFORE_ARTIFACT["digest"]) == BEFORE_ARTIFACT["digest"],
            "fixed original before digest changed")
    return dict(BEFORE_ARTIFACT)


def retained_guard_artifact(environment):
    require(not any(key.startswith("HEIGHT_GUARD_") for key in environment),
            "fixed original Linux controls cannot be overridden")
    return dict(GUARD_ARTIFACT)


def validate_guard_record(record):
    require(record.get("schema") == "YNX-PQ-HEIGHT-LINUX-GUARD-CONTROLS/v1" and
            record.get("toolsCommit") == KERNEL_TOOLS and record.get("toolsTree") == KERNEL_TREE and
            record.get("workflowCommit") == GUARD_ARTIFACT["workflowCommit"] and
            record.get("runId") == str(GUARD_ARTIFACT["runId"]) and record.get("caps") == CAPS and
            record.get("resourceObserverVersion") == "same-process-rss-v2" and
            record.get("resourceObserverSHA256") == KERNEL_SHA and
            record.get("firstCause") is None and record.get("cleanupComplete") is True and
            record.get("actualLinux") is True and record.get("actualKernelControlPassed") is True and
            record.get("inputGenerated") is False and record.get("publicNetwork") is False and
            record.get("performanceComparisonQualified") is False and
            record.get("optimizedPressureAuthorized") is False,
            "retained controls are not the actual fixed successful Linux source/run")
    counts = record.get("fixtureCounts")
    require(type(counts) is dict and set(counts) == set(RETAINED_LINUX_CONTROLS),
            "retained complete 33-control denominator required")
    for name, count in RETAINED_LINUX_CONTROLS.items():
        value = counts[name]
        require(type(value) is dict and set(value) == {"passed", "skipped"} and
                type(value["passed"]) is int and value["passed"] == count and
                type(value["skipped"]) is int and value["skipped"] == 0,
                "retained actual Linux controls cannot skip or change denominator")
    processes = record.get("processes")
    require(type(processes) is list and [row.get("name") for row in processes] == GUARD_PROCESSES and
            all(type(row.get("pid")) is int and row["pid"] > 0 and
                type(row.get("startTicks")) is int and row["startTicks"] > 0 and
                row.get("exited") is True and type(row.get("rawReturnCode")) is int and
                row["rawReturnCode"] == 0 for row in processes),
            "retained actual Linux child identities and terminal success required")


def verify_retained_guard(root):
    intake, _ = dependencies()
    root = Path(root)
    require(root.is_absolute() and root.resolve(strict=True) == root and not root.is_symlink() and
            {p.name for p in root.iterdir()} == GUARD_NAMES, "retained closed 13-file controls catalog required")
    for path in root.iterdir():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 <= info.st_size <= CAPS["logBytes"],
                "retained control leaf must be bounded regular and unaliased")
    record = intake.read_json(root / "HEIGHT-GUARD-CONTROLS.json", CAPS["logBytes"])
    validate_guard_record(record)
    for name, count in RETAINED_LINUX_CONTROLS.items():
        required = ("test_actual_owned_thread_group_read_after_injected_leader_esrch",
                    "test_actual_nonzero_exit_and_cleanup_signal_are_preserved",
                    "test_actual_short_lived_descendants_do_not_create_fake_zero_samples") if name == "test_linux_owned_rss.py" else ()
        controls_record((root / (name.removesuffix(".py") + ".log")).read_bytes(), count, required)
    return dict(artifact=GUARD_ARTIFACT, actualLinux=True, actualKernelControlPassed=True,
                fixtureCounts=record["fixtureCounts"], originalReceiptUnchanged=True)


def kernel_ast(raw):
    tree = ast.parse(raw.decode("utf-8", errors="strict"))
    names = ("same_process_rss_alternative", "owned_rss")
    result = {}
    for name in names:
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
        require(len(functions) == 1, "one actual kernel function required: " + name)
        result[name] = ast.dump(functions[0], include_attributes=False)
    caps = [node for node in tree.body if isinstance(node, ast.Assign) and
            any(isinstance(target, ast.Name) and target.id == "CAPS" for target in node.targets)]
    require(len(caps) == 1, "one original CAPS definition required")
    result["CAPS"] = ast.dump(caps[0], include_attributes=False)
    return result


def kernel_equivalence(original, successor):
    sources, pins = [], (KERNEL_SHA, VENDOR["consensus-linux-cohort.py"])
    for path, pin in zip((Path(original), Path(successor)), pins):
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= 1 << 20,
                "actual bounded unaliased kernel source required")
        raw = path.read_bytes()
        require(len(raw) == info.st_size and hashlib.sha256(raw).hexdigest() == pin,
                "actual kernel source differs from independent pin")
        sources.append(kernel_ast(raw))
    require(sources[0] == sources[1], "original kernel AST or CAPS changed")
    return dict(originalCommit=KERNEL_TOOLS, successorCommit=TOOLS, originalSourceSHA256=pins[0],
                successorSourceSHA256=pins[1], actualKernelASTEqual=True, originalCapsEqual=True,
                functionASTSHA256={name: hashlib.sha256(value.encode()).hexdigest()
                                   for name, value in sources[0].items()})


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
    require(args.arm == "after-a", "only the missing after-a arm may execute")
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
                  resourceObserverVersion=lab.RSS_OBSERVER_VERSION,
                  resourceObserverSHA256=VENDOR["consensus-linux-cohort.py"],
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
            expectation = before_artifact(os.environ, intake)
            before = intake.download_artifact(expectation, work / ".private/height-before", "height-original", window.sample)
            window.wait(window.launch("validate-before-heights", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                        "verify-height", "--public", str(before), "--arm", "before", "--tools", str(tools), "--published",
                        "--run-id", str(BEFORE_ARTIFACT["runId"]), "--workflow", BEFORE_ARTIFACT["workflowCommit"]]))
            command = [sys.executable, "-B", str(tools / "scripts/loadtest/pq-height-vectors.py"), "run",
                       "--prepared", str(prepared / "height-prepared.json"), "--input", str(before / "baseline-input.json"),
                       "--input-sha256", INPUT_SHA, "--profile", "original", "--execute"]
            window.wait(window.launch("original-height-run", command))
            public = public_from_runner(work / "public/original-height-run.log", work)
            window.wait(window.launch("validate-actual-heights", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                        "verify-height", "--public", str(public), "--arm", args.arm, "--tools", str(tools)]))
            record.update(compileComplete=True, perHeightComplete=True)
            target = work / "public/HEIGHT-DIFFERENTIAL.json"
            window.wait(window.launch("compare-original-heights", [sys.executable, "-B", str(tools / "scripts/loadtest/pq-height-vectors.py"),
                        "compare", "--before", str(before), "--after", str(public), "--output", str(target)]))
            diff = intake.read_json(target, 1 << 20)
            fixed_diff(diff, commit)
            record.update(comparisonComplete=True, guardOnlyFunctionalCompatibility=True,
                          performanceComparisonQualified=False, reusedBeforeArtifact=expectation)
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
                      resourceSamples=window.samples, retiredSamplingEvidence=window.retired_samples,
                      rssSamplingFallbackEvidence=window.rss_fallback_samples)
        intake.write_new(work / "public/HEIGHT-CI.json", record)
        if public is not None:
            intake.write_new(public / "HEIGHT-CI.json", record)
            github_output("public", str(public))
    require(record["firstCause"] is None and record["cleanupComplete"] and record["compileComplete"] and
            (args.mode == "compile-only" or (record["perHeightComplete"] and record["comparisonComplete"])),
            "height arm incomplete; retained original first cause and process evidence")
    return record


def run_controls(args):
    intake, lab = dependencies()
    height_catalog(intake)
    if not args.execute:
        return dict(status="prepared-only", command="controls", toolsCommit=TOOLS,
                    actualLinux=False, executed=False, tests=LINUX_CONTROLS, caps=CAPS)
    require(sys.platform == "linux" and os.environ.get("GITHUB_ACTIONS") == "true" and
            os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and os.environ.get("GITHUB_RUN_ATTEMPT") == "1",
            "fresh sole hosted Linux first attempt required")
    require(os.uname().machine == "x86_64" and len(os.sched_getaffinity(0)) >= 2,
            "actual amd64 two CPU affinity required")
    parent = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    work = Path(args.operation)
    require(work.is_absolute() and work.parent == parent and not work.exists() and not work.is_symlink(),
            "fresh exact job-owned control operation required")
    rows, _ = lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(), shutil.disk_usage(parent).free, lab.heavy_processes(rows))
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, "original subreaper required")
    work.mkdir(mode=0o700)
    for name in (".private", "public"):
        (work / name).mkdir(mode=0o700)
    window = lab.Window(HERE, work, additional_storage=(parent, workspace))
    window.storage_roots = intake.nonoverlapping_roots(window.storage_roots)
    window.env.update(RUNNER_TEMP=str(work), GOMAXPROCS="1", PYTHONDONTWRITEBYTECODE="1",
                      GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1")
    window.env.pop("GH_TOKEN", None)
    window.env.pop("GITHUB_TOKEN", None)
    record = dict(schema="YNX-PQ-HEIGHT-LINUX-EVIDENCE-CONTROLS/v1", toolsCommit=TOOLS, toolsTree=TOOLS_TREE,
                  workflowCommit=os.environ["GITHUB_SHA"], runId=os.environ["GITHUB_RUN_ID"],
                  caps=CAPS, resourceObserverVersion=lab.RSS_OBSERVER_VERSION,
                  resourceObserverSHA256=VENDOR["consensus-linux-cohort.py"], firstCause=None,
                  actualLinux=True, actualKernelControlPassed=False, fixtureCounts={}, cleanupComplete=False,
                  publicNetwork=False, inputGenerated=False, performanceComparisonQualified=False,
                  optimizedPressureAuthorized=False)
    github_output("diagnostics", str(work / "public"))
    try:
        window.wait(window.launch("controller-identity", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                    "check-controller", "--source", str(workspace), "--commit", os.environ["GITHUB_SHA"]]))
        tools = checkout(window, "tools", TOOLS, TOOLS_TREE, ["/scripts/loadtest/"])
        original = checkout(window, "original-kernel", KERNEL_TOOLS, KERNEL_TREE, ["/scripts/loadtest/"])
        expectation = retained_guard_artifact(os.environ)
        retained = intake.download_artifact(expectation, work / ".private/retained-linux-controls", "linux-guard-original", window.sample)
        record["retainedLinuxControls"] = verify_retained_guard(retained)
        equivalence = kernel_equivalence(original / "scripts/loadtest/consensus-linux-cohort.py",
                                         tools / "scripts/loadtest/consensus-linux-cohort.py")
        intake.write_new(work / "public/KERNEL-EQUIVALENCE.json", equivalence)
        record["kernelEquivalence"] = equivalence
        window.source = tools
        label = "test_process_evidence"
        window.wait(window.launch(label, [sys.executable, "-B", "-m", "unittest", "discover",
                    "-s", "scripts/loadtest", "-p", "test_process_evidence.py", "-v"]))
        controls_record((work / ("public/" + label + ".log")).read_bytes(), 6,
                        ("test_actual_owned_zombie_reobserved_until_real_wait_and_exit",))
        record["fixtureCounts"]["test_process_evidence.py"] = dict(passed=6, skipped=0)
        window.wait(window.launch("preserved-original-kernel", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                    "check-source", "--source", str(original), "--commit", KERNEL_TOOLS, "--tree", KERNEL_TREE]))
        window.wait(window.launch("preserved-tools", [sys.executable, "-B", str(HERE / "pq-height-ci-arm.py"),
                    "check-source", "--source", str(tools), "--commit", TOOLS, "--tree", TOOLS_TREE]))
        window.sample()
        record["actualKernelControlPassed"] = True
    except BaseException as error:
        record["firstCause"] = str(error)
    finally:
        try:
            record["cleanupComplete"] = window.stop()
        except BaseException as error:
            record["cleanupError"] = str(error)
        if not record["cleanupComplete"] and record["firstCause"] is None:
            record["firstCause"] = record.get("cleanupError", "original cleanup incomplete")
        record.update(elapsedSeconds=time.monotonic() - window.started, peakRSSBytes=window.peak_rss,
                      peakNewBytes=window.peak_bytes, processes=window.process_receipt(),
                      resourceSamples=window.samples, retiredSamplingEvidence=window.retired_samples,
                      rssSamplingFallbackEvidence=window.rss_fallback_samples)
        intake.write_new(work / "public/HEIGHT-EVIDENCE-CONTROLS.json", record)
    require(record["firstCause"] is None and record["cleanupComplete"] and record["actualKernelControlPassed"] and
            set(record["fixtureCounts"]) == set(LINUX_CONTROLS),
            "actual new Linux evidence controls or retained original controls incomplete; original first cause retained")
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("arm", allow_abbrev=False)
    p.add_argument("--arm", choices=("after-a",), required=True)
    p.add_argument("--operation", required=True)
    p.add_argument("--mode", choices=("compile-only", "replay"), default="replay")
    p.add_argument("--execute", action="store_true")
    p = sub.add_parser("controls", allow_abbrev=False)
    p.add_argument("--operation", required=True)
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
    elif args.command == "controls":
        value = run_controls(args)
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
