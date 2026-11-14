"""The original runner hashes the same bytes it validated."""

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

ENTRY = Path(__file__).resolve().parents[1] / "run_profile_operation.py"
spec = importlib.util.spec_from_file_location("run_profile_operation", ENTRY)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ChangingTable:
    def __init__(self, object_value):
        self.original = json.dumps(object_value).encode()
        self.reads = 0

    def read_bytes(self):
        self.reads += 1
        return self.original if self.reads == 1 else b'{"changed":true}'


class RunnerDirectoryBinding(unittest.TestCase):
    def test_runtime_fingerprint_is_of_exact_validated_snapshot(self):
        now = datetime.now(timezone.utc)
        gateway, requester = "gateway-fixture", "recipient-fixture"
        table = [
            {"node_id": 11, "role": "EntryGateway", "supported_roles": {"entry": True},
             "entry": {"hostname": "example.invalid", "wss_port": 9000},
             "ed25519_identity_pubkey": "entry-fixture"},
            {"node_id": 22, "role": "ExitGateway", "supported_roles": {"exit_nr": True},
             "ed25519_identity_pubkey": gateway},
        ]
        epoch = {"current_epoch_start": now.replace(microsecond=0).isoformat(),
                 "total_elapsed_epochs": 7, "epoch_length": {"secs": 3600, "nanos": 0}}
        metadata = {"refreshed_at": now.strftime("%Y-%m-%d %H:%M:%S.%f +00:00:00"),
                    "absolute_epoch_id": 7, "status": None}
        basic = ChangingTable({"metadata": metadata,
                               "nodes": {"pagination": {"page": 0, "total": 2}, "data": table}})
        described = ChangingTable({"pagination": {"page": 0, "total": 1}, "data": [
            {"node_id": 22, "description": {"host_information": {"keys": {"ed25519": gateway}},
                                            "network_requester": {"address": requester + "@" + gateway}}},
        ]})
        interval = ChangingTable(epoch)
        args = SimpleNamespace(directory_basic=basic, directory_described=described, directory_epoch=interval,
                               entry_node_id=11, requester_node_id=22, provider=requester + "@" + gateway)
        bound = runner.validate_directory(args)
        for label, source in (("basic", basic), ("described", described), ("epoch", interval)):
            self.assertEqual(bound[label + "SHA256"], hashlib.sha256(source.original).hexdigest())
            self.assertEqual(source.reads, 1)


if __name__ == "__main__":
    unittest.main()
