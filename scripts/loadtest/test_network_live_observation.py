"""New live-publisher DATA controls only; no node, socket, load or capture."""
import copy
import hashlib
import json
import unittest
from unittest import mock

from test_network_layer_accounting import fixture, layers


def live_value(node, row, begin, finish):
    status = lambda name: dict(status=name, reason="", attached=name == "OBSERVED",
                               overflow=False, complete=name == "OBSERVED")
    return dict(schema="YNX-MEMPOOL-LIVE-WIRE-OBSERVATION/v1", producerPID=str(node["pid"]),
                reactorLifetimeID=str(node["pid"] + 10), observerLifetimeID=str(node["pid"] + 20),
                lifecycleGeneration="1", clock="CLOCK_MONOTONIC", clockStatus="OBSERVED", clockError="",
                startMonotonicNs=str(begin), endMonotonicNs=str(finish), status="OBSERVED", reason="", complete=True,
                reactorRunningAtStart=True, reactorRunningAtEnd=True, nonAtomic=True, completedCallsOnly=True,
                inFlightExcluded=True, endpointOnly=True, physicalBytesMeasured=False,
                wire=copy.deepcopy(row["wire"]), wireStatus=status("OBSERVED"),
                lossless=copy.deepcopy(row["lossless"]), losslessStatus=status("OBSERVED"),
                proto=None, protoStatus=dict(status="UNKNOWN", reason="not_supplied", attached=False, overflow=False, complete=False))


def wrap(node, value, checkpoint):
    raw = json.dumps(value, separators=(",", ":"))
    return layers.original_live_node_capture(node=node, raw=raw, sha256=hashlib.sha256(raw.encode()).hexdigest(),
        start_monotonic_ns=checkpoint["startMonotonicNs"], end_monotonic_ns=checkpoint["endMonotonicNs"])


def live_fixture():
    binding, start, end = fixture()
    for checkpoint in (start, end):
        for index, node in enumerate(binding["nodes"]):
            at = int(checkpoint["startMonotonicNs"])
            value = live_value(node, checkpoint["nodes"][index], at + 1, at + 2)
            checkpoint["nodes"][index] = wrap(node, value, checkpoint)
    return binding, start, end


class LivePublisherControls(unittest.TestCase):
    def account(self, values):
        return layers.account_layers(binding=values[0], start=values[1], end=values[2])

    def change_end(self, values, change):
        binding, _, end = values
        value = json.loads(end["nodes"][0]["live"]["raw"])
        change(value)
        end["nodes"][0] = wrap(binding["nodes"][0], value, end)

    def test_live_pairs_bind_same_original_process_lifetime_and_keep_layers_distinct(self):
        with mock.patch("socket.socket", side_effect=AssertionError("pure accounting must not sample")):
            result = self.account(live_fixture())
        row = result["nodes"][0]
        self.assertEqual(row["logical"]["status"], "OBSERVED")
        self.assertEqual(row["logical"]["counters"]["sendAttempts.transactionBytes"], "400")
        self.assertEqual(row["attempted"]["counters"]["attemptedFrameBytes"], "210")
        self.assertEqual(row["liveWindow"]["reactorLifetimeID"], "110")
        self.assertTrue(row["liveWindow"]["endpointOnly"])
        self.assertEqual(row["serializedProto"]["status"], "UNKNOWN")
        self.assertIsNone(result["physical"]["bytes"])
        self.assertFalse(result["gainsQualified"])

    def test_disabled_lossless_never_fills_zero_or_disables_original_wire(self):
        values = live_fixture()
        for checkpoint in values[1:]:
            for index, node in enumerate(values[0]["nodes"]):
                value = json.loads(checkpoint["nodes"][index]["live"]["raw"])
                value.update(lossless=None, losslessStatus=dict(status="DISABLED", reason="not_enabled", attached=False, overflow=False, complete=False))
                checkpoint["nodes"][index] = wrap(node, value, checkpoint)
        row = self.account(values)["nodes"][0]
        self.assertEqual(row["logical"]["status"], "OBSERVED")
        self.assertEqual(row["attempted"]["status"], "UNKNOWN")
        self.assertEqual(row["attempted"]["reason"], "live_lossless_disabled")
        self.assertEqual(row["liveWindow"]["losslessStatus"]["end"]["status"], "DISABLED")
        self.assertIsNone(row["attempted"]["value"])

    def test_stop_busy_overflow_and_missing_preserve_first_cause_and_null(self):
        for reason in ("reactor_stopped_during_capture", "wire_lock_busy", "wire_overflow", "wire_not_attached"):
            with self.subTest(reason=reason):
                values = live_fixture()
                self.change_end(values, lambda v: v.update(status="UNKNOWN", complete=False, reason=reason))
                row = self.account(values)["nodes"][0]
                self.assertEqual(row["logical"]["reason"], "live_" + reason)
                self.assertIsNone(row["logical"]["value"])
                self.assertEqual(values[2]["nodes"][0]["liveReason"], "live_" + reason)

    def test_pid_lifetime_and_reset_ABA_cannot_form_a_window(self):
        for field in ("producerPID", "reactorLifetimeID", "observerLifetimeID", "lifecycleGeneration"):
            values = live_fixture()
            self.change_end(values, lambda v: v.update({field: "999"}))
            row = self.account(values)["nodes"][0]
            self.assertEqual(row["logical"]["status"], "UNKNOWN")
            self.assertIsNone(row["attempted"]["value"])
        values = live_fixture(); values[2]["nodes"][0]["live"]["startTicks"] = "999"
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_process_identity_changed")

    def test_cached_stop_clock_and_capture_out_of_bounds_are_not_live(self):
        for change, reason in ((lambda v: v.update(startMonotonicNs="1"), "live_snapshot_stale_or_outside_capture"),
                               (lambda v: v.update(clock="PROCESS_RELATIVE"), "live_kernel_clock_unavailable"),
                               (lambda v: v.update(reactorRunningAtEnd=False), "live_reactor_not_running"),
                               (lambda v: v.update(nonAtomic=False), "live_coverage_claim_invalid")):
            values = live_fixture(); self.change_end(values, change)
            self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], reason)

    def test_raw_hash_duplicate_key_and_plain_material_mutations_refused(self):
        values = live_fixture(); values[2]["nodes"][0]["live"]["sha256"] = "0" * 64
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_capture_hash_mismatch")
        values = live_fixture(); values[2]["nodes"][0]["wire"]["received"]["transactionBytes"] += 1
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_wire_material_changed")
        binding, _, end = live_fixture(); raw = '{"schema":"a","schema":"b"}'
        row = layers.original_live_node_capture(node=binding["nodes"][0], raw=raw,
            sha256=hashlib.sha256(raw.encode()).hexdigest(), start_monotonic_ns="200", end_monotonic_ns="210")
        self.assertEqual(row["liveReason"], "live_duplicate_json_key")
        self.assertIsNone(row["wire"])

    def test_live_metadata_exact_strings_and_proto_claim_rejected(self):
        values = live_fixture(); self.change_end(values, lambda v: v.update(lifecycleGeneration=1))
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_metadata_must_be_decimal_string")
        values = live_fixture(); self.change_end(values, lambda v: v.update(proto={"bytes": 123}))
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_proto_inference_forbidden")
        values = live_fixture(); self.change_end(values, lambda v: v["wireStatus"].update(overflow=True))
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_wire_unavailable_or_overflow")

    def test_one_live_endpoint_and_one_legacy_total_do_not_form_live_window(self):
        values = live_fixture(); values[1]["nodes"][0].pop("live")
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "live_capture_not_supplied")


if __name__ == "__main__":
    unittest.main()
