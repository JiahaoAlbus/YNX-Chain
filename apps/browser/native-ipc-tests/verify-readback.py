#!/usr/bin/env python3
"""Read back existing PUBLIC runtime evidence only; never launches a process."""
import hashlib
import json
from pathlib import Path
import sys


def verify(directory):
    directory = Path(directory)
    result = json.loads((directory / "RESULT.json").read_text())
    expected = ["normal", "wrong-peer", "wrong-code", "request-limit", "response-limit", "busy", "cancel", "navigate", "clear", "exit"]
    assert result["status"] == "PASS"
    assert [row["case"] for row in result["cases"]] == expected
    assert len({row["servicePID"] for row in result["cases"]}) == len(expected)
    checks = 0
    artifacts = {}
    for row in result["cases"]:
        mode = row["case"]
        sub = directory / mode
        fixture = json.loads((sub / "fixture.json").read_text())
        assert fixture["pid"] == row["servicePID"] and row["childExited"] is True
        assert fixture["rootQualified"] is False and fixture["authQualified"] is False
        checks += 1
        if mode != "exit":
            closed = json.loads((sub / "closed.json").read_text())
            assert closed == {"active": 0, "closed": True, "pid": fixture["pid"]}
            checks += 1
        else:
            assert not (sub / "closed.json").exists()  # Deliberate abrupt child exit != graceful close.
            checks += 1
        if mode in ["wrong-peer", "wrong-code", "request-limit"]:
            assert not (sub / "held.json").exists()  # Rejected before the PUBLIC owner read.
            checks += 1
        if mode in ["normal", "response-limit", "busy", "cancel", "navigate", "clear"]:
            released = json.loads((sub / "released.json").read_text())
            assert released == {"active": 0, "released": True}
            checks += 1
        if mode in ["normal", "busy"]:
            path = sub / "actual-public-readout.json"
            data = path.read_bytes()
            batch = json.loads(data)
            assert len(data) <= 256 * 1024 and batch["schema"] == "YNX_BROWSER_SELECTED_PAGE_READOUT_V1"
            assert batch["preparationID"] == "PUBLIC-IPC-PREPARATION" and batch["profileID"] == "PUBLIC-ordinary"
            assert [page["reference"] for page in batch["pages"]] == fixture["references"]
            for index, page in enumerate(batch["pages"]):
                raw = page["snapshotUTF8"].encode("utf-8")
                assert len(raw) == page["bytes"]
                assert hashlib.sha512(raw).hexdigest() == page["reference"]["version"]
                assert hashlib.sha3_512(raw).hexdigest() == page["sha3_512"]
                envelope = json.loads(raw)
                assert envelope["schema"] == "YNX_BROWSER_SELECTED_PAGE_V1"
                assert envelope["taskID"] == batch["preparationID"] and envelope["profileID"] == batch["profileID"]
                assert envelope["generation"] == str(page["generation"]) and envelope["tabID"] == page["tabId"]
                assert envelope["origin"] == page["origin"] and envelope["fields"] == page["fields"] == ["text", "title"]
                assert envelope["content"] == {"text": "PUBLIC_SYNTHETIC_PAGE_" + str(index), "title": "PUBLIC page " + str(index)}
                checks += 1
            artifacts[str(path.relative_to(directory))] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            checks += 1
        else:
            assert not (sub / "actual-public-readout.json").exists()
            checks += 1
    report = {"schema": "YNX_PUBLIC_IPC_EVIDENCE_READBACK_V1", "status": "PASS", "checks": checks,
              "runtimeCases": len(expected), "artifacts": artifacts, "network": "NOT_RUN",
              "RootAuthQualification": "NOT_RUN", "abruptExitOwnerClose": "NOT_CONFIRMED_EXPECTED"}
    (directory / "READBACK.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    verify(sys.argv[1])
