#!/usr/bin/env python3
"""Bind the already-tested validator directory repair to the exact 9cf032 source tree."""

import argparse
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
BASE_RUNTIME = "9cf0324880bdb8d8b8909581c81b91f750174b6ff0569e4f5270426c0dacb5a6"
BASE_TREE = "6fa745da878e62eff74d079febaf5af1e9ca172546272c5c3ea37e294a183af6"
LOCK = "29275bf9e41f6d6acad87f4737b5640e89ada39e0d7752a9211d04fec7871558"
PHASE_PATCH = HERE.parent / "directory-diagnostics/directory-phase.patch"
PROGRESS_PATCH = HERE / "directory-progress.patch"
PHASE_PIN = PHASE_PATCH.with_name("source-pin.json")
PROGRESS_PIN = PROGRESS_PATCH.with_name("source-pin.json")
BASE_PATCH_SHA = "382895ca68660776a0d92ad99e448c4289c8234e8075d24fb4c199cdbb6e69a3"
BASE_MANIFEST_SHA = "6b74dee00f6c84eecf49dd1dc20f8709fc2f66bfa2dc11ef5d54427964694bd1"
PRIOR_BUILD_SHA = "4ad99081150d9c33223759df660253fb8d26087d03dde0163276e2f614ea0ca5"
PRIOR_BINARY_SHA = "e769b4e3c40a1b729dc0ab803570e93875014c6a80b87e032c53898dfc5949ef"
EXPECTED_PATCHES = {
    PHASE_PATCH: "3752e13cc43de47d5254697ea24c9caaa73ae8b51eeef81375fac6e37f1f42f6",
    PHASE_PIN: "94776e3faecf655051410512e402509c63fee9a54bc43e1b73dfbce648e4151c",
    PROGRESS_PATCH: "8ad46f7b54417b8127fe8bb649f5187c7bb44c4cfc127ed1156351294d293397",
    PROGRESS_PIN: "b47b53e36814e367535dd2200e296d58afa36ccc215ef596140d32365e3f5bd7",
}
ARGV = ["build", "--offline", "--release", "--locked", "-p", "nym-socks5-client", "--jobs", "1"]


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for part in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def load(path):
    return json.loads(path.read_text())


def check_pins(pins):
    for path, digest in pins.items():
        require(path.is_file() and not path.is_symlink() and sha(path) == digest, "input-pin:" + str(path))


def manifest_hash(entries):
    return hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def apply_patch(directory, patch, *options):
    result = subprocess.run(["/usr/bin/git", "apply", "--whitespace=error",
                             *options, str(patch)], cwd=directory, check=True, timeout=5)
    return result.returncode


def build_input(base, historical, out):
    baseline_manifest = base / "source-before-build.json"
    baseline_patch = base / "source.patch"
    previous_receipt = historical / "receipt.json"
    check_pins({**EXPECTED_PATCHES, baseline_manifest: BASE_MANIFEST_SHA,
                baseline_patch: BASE_PATCH_SHA, base / "nym-socks5-client": BASE_RUNTIME,
                historical / "nym-socks5-client": PRIOR_BINARY_SHA, previous_receipt: PRIOR_BUILD_SHA})
    baseline = load(baseline_manifest)
    entries = baseline["entries"]
    phase, progress = load(PHASE_PIN), load(PROGRESS_PIN)
    proof = load(previous_receipt)
    require(len(entries) == 6611 and manifest_hash(entries) == BASE_TREE
            and baseline["lockSHA256"] == entries["Cargo.lock"]["sha256"] == LOCK, "baseline-manifest")
    require(phase["previousRuntimeSHA256"] == progress["originalRuntimeSHA256"] == BASE_RUNTIME
            and phase["cargoLockSHA256"] == progress["cargoLockSHA256"] == LOCK
            and phase["files"].keys() == progress["files"].keys(), "patch-chain")
    require(proof["exit"] == 0 and proof["reaped"] is True and proof["remainingOwned"] == []
            and proof["lockUnchanged"] is True and proof["sourceDrift"] == {}
            and proof["command"][1:] == ARGV and proof["binarySHA256"] == PRIOR_BINARY_SHA
            and proof["sourcePinSHA256"] == EXPECTED_PATCHES[PROGRESS_PIN], "historical-build")
    require(out.parent.is_dir() and not out.exists() and not out.is_symlink(), "require-fresh-output-directory")
    with tempfile.TemporaryDirectory(prefix="normal-directory-rebase.", dir=out.parent) as scratch:
        tmp = Path(scratch)
        trial = tmp / "trial"
        trial.mkdir()
        names = sorted(progress["files"])
        existing = [name for name in names if name in entries]
        include = ["--include=" + name for name in existing]
        apply_patch(trial, baseline_patch, *include)
        originals = {}
        for name in names:
            first, second = phase["files"][name], progress["files"][name]
            require(first["after"] == second["before"], "patch-predecessor:" + name)
            path = trial / name
            if name in entries:
                require(sha(path) == first["before"] == entries[name]["sha256"], "baseline-leaf:" + name)
                originals[name] = path.read_text().splitlines(keepends=True)
            else:
                require(not path.exists() and first["before"] is None, "unexpected-new-leaf:" + name)
                originals[name] = []

        apply_patch(trial, PHASE_PATCH, "--check")
        apply_patch(trial, PHASE_PATCH)
        check_pins({trial / name: phase["files"][name]["after"] for name in names})
        apply_patch(trial, PROGRESS_PATCH, "--check")
        apply_patch(trial, PROGRESS_PATCH)
        check_pins({trial / name: progress["files"][name]["after"] for name in names})
        check_pins({historical / "source" / name: progress["files"][name]["after"] for name in names})
        require(proof["sourceSHA256"] == {name: progress["files"][name]["after"] for name in names},
                "historical-build-leaves")
        require(sorted(str(path.relative_to(trial)) for path in trial.rglob("*") if path.is_file()) == names,
                "unexpected-patched-file")

        combined = tmp / "normal-directory-progress-from-9cf032.patch"
        delta = []
        candidate_entries = dict(entries)
        for name in names:
            leaf = trial / name
            delta.extend(difflib.unified_diff(originals[name], leaf.read_text().splitlines(keepends=True),
                         "a/" + name if name in entries else "/dev/null", "b/" + name))
            candidate_entries[name] = {"bytes": leaf.stat().st_size, "sha256": sha(leaf)}
        combined.write_text("".join(delta))

        replay = tmp / "replay"
        replay.mkdir()
        apply_patch(replay, baseline_patch, *include)
        apply_patch(replay, combined, "--check")
        apply_patch(replay, combined)
        check_pins({replay / name: progress["files"][name]["after"] for name in names})

        out.mkdir(mode=0o700)
        deliverable = out / combined.name
        combined.rename(deliverable)
        manifest_path = out / "source-manifest.json"
        manifest_path.write_text(json.dumps(candidate_entries, sort_keys=True, indent=2) + "\n")
        result = {
            "schema": "P05_NYM_NORMAL_DIRECTORY_PROGRESS_SUCCESSOR_V1",
            "state": "EXACT_SOURCE_INPUT_VERIFIED",
            "installerChanged": False, "publicNetwork": False, "cargoStarted": False,
            "baseRuntimeSHA256": BASE_RUNTIME, "baseSourceTreeSHA256": BASE_TREE,
            "upstreamCommit": baseline["baseCommit"], "baseSourceManifestSHA256": BASE_MANIFEST_SHA,
            "baseOverlayPatchSHA256": BASE_PATCH_SHA,
            "bootstrapEndpoint": "validator.nymtech.net", "runtimeContract": "ynx-protected-numeric-v2",
            "cargoArgvAfterExecutable": ARGV,
            "cargoLockSHA256": LOCK, "sourceFileCount": len(candidate_entries),
            "successorSourceTreeSHA256": manifest_hash(candidate_entries),
            "sourceManifestSHA256": sha(manifest_path), "directPatchSHA256": sha(deliverable),
            "files": {name: {"before": phase["files"][name]["before"],
                             "after": candidate_entries[name]["sha256"]} for name in names},
            "responseLimits": {"connectSeconds": 8, "headersSeconds": 20,
                               "positiveBodyIdleSeconds": 20, "maxBodyBytesPerPage": 4194304,
                               "requestTotal": "original policy wall+monotonic remainder",
                               "directoryPolicyMaximumSeconds": 120},
            "previousMatchingCalleeBuild": {"receiptSHA256": PRIOR_BUILD_SHA, "binarySHA256": PRIOR_BINARY_SHA,
                                            "exactChangedLeafBytesVerified": True,
                                            "fullCandidateTreeBuildAttested": False},
        }
        result_path = out / "INPUTS.json"
        result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"path": str(result_path), "SHA256": sha(result_path), **result}, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--historical-build", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build_input(args.base, args.historical_build, args.out)


if __name__ == "__main__":
    main()
