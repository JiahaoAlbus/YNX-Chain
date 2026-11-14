#!/usr/bin/env python3
"""Reproduce the isolated locked macOS dependency build; never publishes or opens a route."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

LOCK_SHA256 = "467c16dec695795084b23a28d76411b3955f993fb9cf17965ee5825faacfa695"
SOURCE_COMMIT = "f92749c5f45bf1fdaacb824f9796bca2d641c6f9"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_binding(source):
    # The official codeload source has no .git/target. Retain every path and every source byte.
    entries = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            entries[str(path.relative_to(source))] = {"link": os.readlink(path)}
        elif path.is_file():
            entries[str(path.relative_to(source))] = {"sha256": digest(path), "bytes": path.stat().st_size}
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
    return {"sha256": hashlib.sha256(encoded).hexdigest(), "files": len(entries)}


SOURCE_ARCHIVE_SHA256 = "a8f1d3f61247487feedbb8a4408e123ab2198091ac36829be598a2ab8e342485"


def validate_source_archive(source, archive, overlay):
    if digest(archive) != SOURCE_ARCHIVE_SHA256:
        raise SystemExit("Official source archive checksum mismatch")
    overrides = {}
    if overlay:
        pin_path = Path(__file__).with_name("recovery-overlay-pin.json")
        pin = json.loads(pin_path.read_text())
        if pin["baseCommit"] != SOURCE_COMMIT:
            raise SystemExit("Overlay base mismatch")
        patch = Path(__file__).with_name("resume-unconfigured.patch")
        if digest(patch) != pin["patchSHA256"]:
            raise SystemExit("Overlay patch checksum mismatch")
        overrides = pin["files"]
    expected = set()
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            parts = Path(member.name).parts
            if len(parts) < 2 or member.isdir():
                continue
            relative = Path(*parts[1:])
            if relative.is_absolute() or ".." in relative.parts:
                raise SystemExit("Unsafe source archive member")
            name = str(relative); expected.add(name); actual = source / relative
            if member.issym():
                if not actual.is_symlink() or os.readlink(actual) != member.linkname:
                    raise SystemExit("Source symlink mismatch: " + name)
                continue
            if not member.isfile() or not actual.is_file() or actual.is_symlink():
                raise SystemExit("Source file mismatch: " + name)
            original_sha = hashlib.sha256(tar.extractfile(member).read()).hexdigest()
            expected_sha = original_sha
            if name in overrides:
                if overrides[name]["before"] != original_sha:
                    raise SystemExit("Overlay before-image mismatch: " + name)
                expected_sha = overrides[name]["after"]
            if digest(actual) != expected_sha:
                raise SystemExit("Source bytes mismatch: " + name)
    found = {str(p.relative_to(source)) for p in source.rglob("*") if p.is_file() or p.is_symlink()}
    if found != expected or not set(overrides).issubset(expected):
        raise SystemExit("Unexpected source paths; build not started")
    return {"archiveSHA256": SOURCE_ARCHIVE_SHA256, "overlay": overlay,
            "overlayPatchSHA256": pin["patchSHA256"] if overlay else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--offline-cached", action="store_true", help="Reuse prior fixed-lock dependency cache; missing cache still fails closed")
    parser.add_argument("--overlay", action="store_true", help="Validate the explicit bundled YNX overlay, never arbitrary source edits")
    parser.add_argument("--toolchain-bin", type=Path, required=True)
    parser.add_argument("--supply-root", type=Path, required=True)
    args = parser.parse_args()
    source, tool, supply = args.source.resolve(), args.toolchain_bin.resolve(), args.supply_root.resolve()
    if source.name != "nym-" + SOURCE_COMMIT or digest(source / "Cargo.lock") != LOCK_SHA256:
        raise SystemExit("Fixed source name/lock mismatch; no build started")
    source_identity = validate_source_archive(source, args.source_archive, args.overlay)
    compiler = subprocess.check_output([str(tool / "rustc"), "-vV"], text=True)
    if not compiler.startswith("rustc 1.94.0 ") or "host: aarch64-apple-darwin" not in compiler:
        raise SystemExit("Expected pinned Rust1.94.0 macOS arm64 toolchain")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    attempt = supply / ("build-" + stamp)
    attempt.mkdir(parents=True, exist_ok=False)
    for name in ["cargo-home", "target", "tmp"]:
        (supply / name).mkdir(parents=True, exist_ok=True)
    environment = {
        "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8",
        "CARGO_HOME": str(supply / "cargo-home"), "CARGO_TARGET_DIR": str(supply / "target"),
        "TMPDIR": str(supply / "tmp"), "RUSTC": str(tool / "rustc"), "RUSTDOC": str(tool / "rustdoc"),
        "RUSTFLAGS": "-Cstrip=none", "CARGO_BUILD_JOBS": "1", "CARGO_NET_OFFLINE": "true",
    }
    command = [str(tool / "cargo"), "build", "-p", "nym-socks5-client", "--release", "--locked", "--jobs", "1"]
    before = source_binding(source)
    receipt = {"sourceCommit": SOURCE_COMMIT, "lockSHA256": LOCK_SHA256, "sourceBefore": before, "validatedSourceIdentity": source_identity,
               "compiler": compiler, "compilerSHA256": digest(tool / "rustc"),
               "cargoSHA256": digest(tool / "cargo"), "command": command, "environment": environment,
               "class": "local macOS dependency build only; no formal package/install/route admission", "state": "building"}
    (attempt / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    # Upstream nym-network-defaults/build.rs invokes workspace-wide cargo metadata, so a
    # host-filtered fetch is insufficient even for a macOS-only binary. Fetch the fixed lock first.
    fetch_environment = dict(environment)
    fetch_environment["CARGO_NET_OFFLINE"] = "false"
    if args.offline_cached:
        receipt["fetchState"] = "explicit fixed-lock cache reuse; cargo build remains offline"
        (attempt / "fetch.log").write_text("Skipped network fetch using --offline-cached; missing locked cache rejects at build.\n")
    else:
        with (attempt / "fetch.log").open("wb") as log:
            fetch = subprocess.run([str(tool / "cargo"), "fetch", "--locked"], cwd=source,
                                   env=fetch_environment, stdout=log, stderr=subprocess.STDOUT)
        receipt["fetchExitCode"] = fetch.returncode
        if fetch.returncode != 0:
            receipt["state"] = "fetch-failed"
            (attempt / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
            return 1
    with (attempt / "cargo.log").open("wb") as log:
        result = subprocess.run(command, cwd=source, env=environment, stdout=log, stderr=subprocess.STDOUT)
    receipt["exitCode"] = result.returncode
    receipt["sourceAfter"] = source_binding(source)
    receipt["sourceUnchanged"] = before == receipt["sourceAfter"]
    receipt["lockUnchanged"] = digest(source / "Cargo.lock") == LOCK_SHA256
    receipt["state"] = "failed"
    if result.returncode == 0 and receipt["sourceUnchanged"] and receipt["lockUnchanged"]:
        binary = supply / "target/release/nym-socks5-client"
        receipt["binary"] = {"path": str(binary), "sha256": digest(binary), "bytes": binary.stat().st_size}
        version = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=20)
        receipt["version"] = {"exitCode": version.returncode, "stdout": version.stdout, "stderr": version.stderr}
        receipt["state"] = "dependency-built" if version.returncode == 0 and "1.1.88" in version.stdout else "version-check-failed"
    (attempt / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(attempt / "receipt.json")
    return 0 if receipt["state"] == "dependency-built" else 1


if __name__ == "__main__":
    raise SystemExit(main())
