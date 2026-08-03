#!/usr/bin/env python3
"""Cold-start a fresh macOS Quant Lab archive and emit bounded evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Optional


API_BASE = "http://127.0.0.1:16444"
WEB_BASE = "http://127.0.0.1:16447"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(url: str, timeout: float = 1.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "ynx-quant-desktop-verifier/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"unexpected HTTP status {response.status} from {url}")
        return response.read()


def fetch_json(url: str) -> dict[str, Any]:
    payload = json.loads(fetch(url).decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"expected JSON object from {url}")
    return payload


def endpoint_is_closed(url: str) -> bool:
    try:
        fetch(url, timeout=0.25)
    except (OSError, urllib.error.URLError, TimeoutError):
        return True
    return False


def wait_for(predicate, description: str, timeout: float = 15.0) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Optional[Exception] = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:
            last_error = exc
        time.sleep(0.1)
    if last_error is not None:
        raise RuntimeError(f"timed out waiting for {description}: {last_error}") from last_error
    raise RuntimeError(f"timed out waiting for {description}")


def safe_extract(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        for entry in entries:
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts:
                raise RuntimeError(f"unsafe archive path: {entry.filename}")
            file_type = (entry.external_attr >> 16) & 0o170000
            if file_type == stat.S_IFLNK:
                raise RuntimeError(f"archive symlink is not allowed: {entry.filename}")
        bundle.extractall(destination)
        for entry in entries:
            permissions = (entry.external_attr >> 16) & 0o777
            extracted = destination.joinpath(*PurePosixPath(entry.filename).parts)
            if permissions and extracted.exists():
                extracted.chmod(permissions)


def terminate(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--expected-bytes", required=True, type=int)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    archive = args.archive.resolve()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("macOS arm64 host is required for packaged cold-start verification")
    if not archive.is_file():
        raise RuntimeError(f"archive does not exist: {archive}")

    actual_bytes = archive.stat().st_size
    actual_sha256 = sha256_file(archive)
    if actual_bytes != args.expected_bytes:
        raise RuntimeError(f"archive byte mismatch: expected {args.expected_bytes}, got {actual_bytes}")
    if actual_sha256 != args.expected_sha256:
        raise RuntimeError(
            f"archive SHA-256 mismatch: expected {args.expected_sha256}, got {actual_sha256}"
        )
    if not endpoint_is_closed(f"{API_BASE}/health") or not endpoint_is_closed(f"{WEB_BASE}/"):
        raise RuntimeError("Quant desktop verification ports are already occupied")

    started_at = datetime.now(timezone.utc)
    checks: list[str] = []
    with tempfile.TemporaryDirectory(prefix="ynx-quant-desktop-verify-") as temp_name:
        temp = Path(temp_name)
        extraction = temp / "Applications"
        extraction.mkdir()
        safe_extract(archive, extraction)
        app = extraction / "YNX Quant Lab.app"
        executable = app / "Contents" / "MacOS" / "ynx-quant-desktop"
        if not executable.is_file():
            raise RuntimeError("packaged desktop supervisor is missing")

        subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", str(app)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        checks.append("strict-adhoc-signature")

        state_path = temp / "state.json"
        stdout_path = temp / "desktop.stdout.log"
        stderr_path = temp / "desktop.stderr.log"
        env = os.environ.copy()
        env["YNX_QUANT_DESKTOP_NO_OPEN"] = "1"
        env["YNX_QUANT_STATE_PATH"] = str(state_path)
        with stdout_path.open("wb") as stdout_handle, stderr_path.open("wb") as stderr_handle:
            process = subprocess.Popen(
                [str(executable)],
                env=env,
                stdout=stdout_handle,
                stderr=stderr_handle,
            )
            try:
                version = wait_for(lambda: fetch_json(f"{API_BASE}/version"), "version endpoint")
                health = wait_for(lambda: fetch_json(f"{API_BASE}/health"), "health endpoint")
                metrics = wait_for(
                    lambda: fetch(f"{API_BASE}/metrics").decode("utf-8"), "metrics endpoint"
                )
                frontend = wait_for(
                    lambda: fetch(f"{WEB_BASE}/").decode("utf-8"), "frontend endpoint"
                )
                if version.get("productId") != "ynx-quant-lab":
                    raise RuntimeError("version endpoint returned the wrong product")
                if version.get("commit") != args.expected_commit:
                    raise RuntimeError(
                        f"version commit mismatch: expected {args.expected_commit}, got {version.get('commit')}"
                    )
                if health.get("ready") is not True or health.get("liveFundsEnabled") is not False:
                    raise RuntimeError("health endpoint is not ready with live funds disabled")
                if health.get("commit") != args.expected_commit:
                    raise RuntimeError("health endpoint commit does not match the release source")
                if "ynx_quant_build_info" not in metrics or "ynx_quant_risk" not in metrics:
                    raise RuntimeError("required build and risk metrics are missing")
                if "YNX Quant Lab" not in frontend:
                    raise RuntimeError("frontend identity is missing")
                checks.extend(
                    [
                        "fresh-applications-layout-extraction",
                        "exact-version-commit",
                        "ready-health",
                        "live-funds-disabled",
                        "build-and-risk-metrics",
                        "frontend-identity",
                    ]
                )
            finally:
                terminate(process)

        if process.returncode not in (0, -signal.SIGINT):
            stderr_tail = stderr_path.read_text(errors="replace")[-2000:]
            raise RuntimeError(f"desktop supervisor exited with {process.returncode}: {stderr_tail}")
        wait_for(
            lambda: endpoint_is_closed(f"{API_BASE}/health")
            and endpoint_is_closed(f"{WEB_BASE}/"),
            "clean shutdown and port release",
            timeout=8.0,
        )
        checks.append("clean-shutdown-port-release")

    verified_at = datetime.now(timezone.utc)
    evidence = {
        "schemaVersion": 1,
        "productId": "ynx-quant-lab",
        "evidenceClass": "local-macos-arm64-cold-start",
        "verifiedAt": verified_at.isoformat().replace("+00:00", "Z"),
        "durationMs": round((verified_at - started_at).total_seconds() * 1000),
        "archive": {
            "name": archive.name,
            "bytes": actual_bytes,
            "sha256": actual_sha256,
            "signingClass": "adhoc-test-only",
            "hosted": False,
        },
        "sourceCommit": args.expected_commit,
        "host": {
            "os": platform.platform(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
        },
        "checks": checks,
        "installedLocal": True,
        "coldStartVerified": True,
        "productionSigned": False,
        "deployedPublic": False,
    }
    rendered = json.dumps(evidence, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Quant desktop candidate verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
