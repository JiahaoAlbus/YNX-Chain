#!/usr/bin/env python3
"""Read only the four new consumer process receipts. No IPC/process/network."""
import hashlib
import json
from pathlib import Path
import sys


def verify(directory):
    directory = Path(directory)
    result = json.loads((directory / "RESULT.json").read_text())
    modes = ["consumer-valid", "consumer-bindings", "consumer-cancel", "consumer-stale"]
    assert result["status"] == "PASS" and [row["case"] for row in result["cases"]] == modes
    assert len({row["servicePID"] for row in result["cases"]}) == 4
    checks = 0
    artifacts = {}
    for row in result["cases"]:
        mode = row["case"]
        sub = directory / mode
        fixture = json.loads((sub / "fixture.json").read_text())
        closed = json.loads((sub / "closed.json").read_text())
        released = json.loads((sub / "released.json").read_text())
        assert row["childExited"] and fixture["pid"] == row["servicePID"]
        assert fixture["rootQualified"] is False and fixture["authQualified"] is False
        assert closed == {"active": 0, "closed": True, "pid": fixture["pid"]}
        assert released["active"] == 0 and released["released"] is True
        checks += 1
        if mode == "consumer-bindings":
            rejected = json.loads((sub / "rejections.json").read_text())
            assert rejected == {"variants": ["session", "task", "revision", "generation", "run", "unknown-ref", "unknown-profile"], "extracts": 0}
            assert row["rejectedVariants"] == rejected["variants"] and released["extracts"] == 0
            assert not (sub / "held.json").exists() and not (sub / "actual-public-readout.json").exists()
            checks += 7
            continue
        request = json.loads((sub / "actual-P08-request.json").read_text())
        assert request["schema"] == "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1" and request["runId"] == "PUBLIC_RUN_17"
        assert request["task"]["revision"] == 17 and request["task"]["generation"] == 9007199254740993
        assert request["task"]["id"] == "PUBLIC-IPC-PREPARATION"
        assert request["references"] == fixture["references"]
        checks += 1
        if mode == "consumer-cancel":
            assert released["extracts"] == 1 and not (sub / "actual-public-readout.json").exists()
            assert json.loads((sub / "held.json").read_text())["borrowHeld"] is True
            checks += 1
            continue
        path = sub / "actual-public-readout.json"
        data = path.read_bytes()
        batch = json.loads(data)
        assert batch["schema"] == "YNX_BROWSER_SELECTED_PAGE_READOUT_V1" and len(batch["pages"]) == 3
        assert batch["preparationID"] == "PUBLIC-IPC-PREPARATION" and batch["profileID"] == "PUBLIC-ordinary"
        assert [page["reference"] for page in batch["pages"]] == fixture["references"]
        assert released["extracts"] == (2 if mode == "consumer-stale" else 3)
        for index, page in enumerate(batch["pages"]):
            for key, value in fixture["metadata"][index].items():
                assert page[key] == value
            if mode == "consumer-stale" and index == 0:
                assert page["state"] == "STALE" and "snapshotUTF8" not in page
            else:
                assert page["state"] == "AVAILABLE"
                raw = page["snapshotUTF8"].encode("utf-8")
                assert len(raw) == page["bytes"] and hashlib.sha3_512(raw).hexdigest() == page["sha3_512"]
                assert hashlib.sha512(raw).hexdigest() == page["reference"]["version"]
                envelope = json.loads(raw)
                assert envelope["taskID"] == batch["preparationID"] and envelope["profileID"] == batch["profileID"]
                assert envelope["generation"] == str(page["generation"]) and envelope["tabID"] == page["tabId"]
                assert envelope["origin"] == page["origin"] and envelope["fields"] == page["fields"] == ["text", "title"]
                assert envelope["content"] == {"text": "PUBLIC_SYNTHETIC_PAGE_" + str(index), "title": "PUBLIC page " + str(index)}
            checks += 1
        artifacts[str(path.relative_to(directory))] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    report = {"schema": "YNX_PUBLIC_IPC_CONSUMER_DELTA_READBACK_V1", "status": "PASS", "checks": checks,
              "runtimeCases": 4, "bindingRejections": 7, "artifacts": artifacts,
              "RootAuthQualification": "NOT_RUN", "network": "NOT_RUN", "oldTransportCasesRepeated": 0}
    (directory / "READBACK.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    verify(sys.argv[1])
