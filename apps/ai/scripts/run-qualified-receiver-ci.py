#!/usr/bin/env python3
"""Run the original portable PUBLIC receiver test; never install a Root row."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--sdk-tgz", required=True, type=pathlib.Path)
parser.add_argument("--evidence", required=True, type=pathlib.Path)
parser.add_argument("--prepare-only", action="store_true")
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parents[3]
package = pathlib.Path(__file__).with_name("receiver-interop-r2")
evidence = args.evidence.resolve()
evidence.mkdir(parents=True, exist_ok=True)
digest = lambda body: hashlib.sha256(body).hexdigest()
assert digest(args.sdk_tgz.read_bytes()) == "83d5a1e90285c07f573f2f059d354a08c4556719b6f67b5c9f53174a6a56913f"
intake = json.loads((repo / "apps/ai/ORIGINAL_AUTH_QUALIFIED_RECEIVER_INTAKE.json").read_text())
for item in intake["imports"]:
    body = (repo / item["target"]).read_bytes()
    assert len(body) == item["source"]["bytes"] and digest(body) == item["source"]["sha256"]
safe = pathlib.Path(tempfile.mkdtemp(prefix=".p08-rx-", dir=pathlib.Path.home().resolve()))
complete = False

def execute(command, name, environment=None, timeout=180):
    """Bound one owned process group and retain its actual exit and output."""
    with (evidence / (name + ".stdout")).open("w") as out, (evidence / (name + ".stderr")).open("w") as err:
        process = subprocess.Popen(command, cwd=repo, env=environment, stdout=out, stderr=err, start_new_session=True)
        try:
            status = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
    (evidence / (name + ".result.json")).write_text(json.dumps({"command": command, "exit": status, "processGroup": process.pid}))
    assert status == 0, (name, status, (evidence / (name + ".stderr")).read_text()[-4000:], (evidence / (name + ".stdout")).read_text()[-4000:])
    groups = subprocess.check_output(["ps", "-axo", "pid=,pgid=,comm="], text=True)
    assert not any(int(row.split()[1]) == process.pid for row in groups.splitlines() if len(row.split()) >= 2), "owned child group still active"

try:
    sdk = safe / "sdk"
    sdk.mkdir()
    with tarfile.open(args.sdk_tgz, "r:gz") as archive:
        count = 0
        for item in archive.getmembers():
            if item.isdir():
                continue
            relative = pathlib.PurePosixPath(item.name)
            assert item.isfile() and not relative.is_absolute() and ".." not in relative.parts and relative.parts[0] == "package"
            target = sdk.joinpath(*relative.parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(item).read())
            target.chmod(item.mode & 0o777)
            count += 1
    assert count == 1301
    node = pathlib.Path(shutil.which("node")).resolve()
    runner = (repo / "packages/wallet-auth/native/original-task-read-receiver-qualification-runner.mjs").resolve()
    execute([str(node), str(package / "prepare-public-runtime.mjs"), str(sdk), str(package / "sdk-fixtures"), str(safe), str(runner), str(evidence)], "prepare")
    runtime = pathlib.Path((evidence / "prepare.stdout").read_text().strip())
    assert runtime.is_dir() and runtime.parent == safe
    consumer_paths = ["internal/aiproduct/link_qualified_receiver_candidate_test.go",
        "internal/authtasklocal/public_qualified_receiver_candidate.go",
        "packages/auth-grant-runtime/go/public_qualified_receiver_candidate.go",
        "packages/auth-grant-runtime/go/public_registered_receiver_fixture.go",
        "internal/aiproduct/task_resource_receiver.go", "internal/aiproduct/task_resource_receiver_mount.go",
        "internal/aiproduct/task_authority_broker.go", "internal/aiproduct/task_runtime_composition.go",
        "internal/aiproduct/task_conversation_broker.go", "internal/aiproduct/task_dispatch.go",
        "internal/aiproduct/task_receiver_dispatch_gate_interop_test.go"]
    source_paths = sorted({*(repo / item["target"] for item in intake["imports"]),
        *(repo / name for name in consumer_paths), pathlib.Path(__file__).resolve(), *package.rglob("*")})
    def snapshot():
        return [{"path": str(p.relative_to(repo)), "bytes": p.stat().st_size, "sha256": digest(p.read_bytes())} for p in source_paths if p.is_file()]
    before = snapshot()
    (evidence / "SOURCE-BEFORE.json").write_text(json.dumps(before, indent=2))
    if not args.prepare_only:
        environment = os.environ.copy()
        environment.update({"PUBLIC_RECEIVER_NODE": str(node), "PUBLIC_RECEIVER_RUNTIME": str(runtime),
            "LINK_RECEIVER_CANDIDATE_SOCKET_ROOT": str(safe), "LINK_RECEIVER_CANDIDATE_ASSETS": str(package),
            "LINK_QUALIFIED_RECEIVER_EVIDENCE": str(evidence), "CGO_ENABLED": "1", "GOMAXPROCS": "2", "GOMEMLIMIT": "1536MiB"})
        binary = evidence / "receiver.test"
        command = ["go", "test", "-mod=readonly", "-race", "-p", "1", "-c",
            "-tags=link_registered_receiver_interop,link_receiver_purpose_candidate", "-o", str(binary), "./internal/aiproduct"]
        execute(command, "build", environment, timeout=600)
        protected = safe / "receiver.test"
        shutil.copyfile(binary, protected)
        protected.chmod(0o700)
        assert digest(binary.read_bytes()) == digest(protected.read_bytes())
        (evidence / "TEST-EXECUTABLE.json").write_text(json.dumps({"bytes": binary.stat().st_size, "sha256": digest(binary.read_bytes()), "safeCopyByteEqual": True}))
        selector = "TestLINKP08QualifiedReceiverPurposeCandidate"
        execute([str(protected), "-test.run", "^" + selector + "$", "-test.timeout=150s", "-test.v"], "consumer", environment)
        output = (evidence / "consumer.stdout").read_text()
        assert len(re.findall(r"^=== RUN\s+" + selector + r"$", output, re.M)) == 1
        assert len(re.findall(r"^--- PASS: " + selector + r" ", output, re.M)) == 1
        assert not re.search(r"--- (?:SKIP|FAIL):", output)
        actual = json.loads((evidence / "actual-candidate.json").read_text())
        assert actual["actualLINKListenerAndDrain"] and not actual["RootAdmission"] and not actual["SourceAdmission"]
    after = snapshot()
    (evidence / "SOURCE-AFTER.json").write_text(json.dumps(after, indent=2))
    assert before == after
    complete = True
    (evidence / "RESULT.json").write_text(json.dumps({"prepared": True, "GoTestExecuted": not args.prepare_only,
        "topPass": int(not args.prepare_only), "skip": 0, "sourceBeforeAfterExact": True,
        "ownedProcessGroupsRemaining": [], "RootAdmission": False, "SourceAdmission": False, "deployed": False}, indent=2))
finally:
    if complete:
        shutil.rmtree(safe)  # only known completed owned PUBLIC originals
        (evidence / "SAFE-ROOT-REMOVED.json").write_text(json.dumps({"path": str(safe), "absent": not safe.exists()}))
    else:
        (evidence / "FAILED-OWNED-ROOT.txt").write_text(str(safe))
