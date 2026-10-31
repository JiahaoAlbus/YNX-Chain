"""Metadata controls only: no process, socket, traffic, node or PQ operation."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location("layers", Path(__file__).with_name("network-layer-accounting.py"))
layers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layers)


def fixture():
    nodes = [dict(name="validator-0", pid=100, startTicks="123", peerID="a" * 40),
             dict(name="validator-1", pid=101, startTicks="124", peerID="b" * 40)]
    binding = dict(schema=layers.BINDING_SCHEMA, runID="normal-original-1", source="c" * 40,
                   tools="d" * 40, inputSHA256="e" * 64, mode="online", window="pq",
                   configuredDemand="4", qualifiedCount=None, nodes=nodes)
    def checkpoint(time, end):
        values = dict(messages=2 if end else 0, transactions=2 if end else 0,
                      transactionBytes=200 if end else 0, reencodedProtoBytes=208 if end else 0)
        wire = dict(schema="YNX-MEMPOOL-WIRE-OBSERVATION/v1", attached=True, overflow=False,
                    physicalBytesMeasured=False, sendAttempts={k: v * 2 for k, v in values.items()},
                    sendQueued=values, sendNotQueued=values, received=values)
        lossless = dict(schema="YNX-MEMPOOL-LOSSLESS-HEX/v1", enabled=True, overflow=False,
                        physicalBytesMeasured=False, **{key: 0 for key in layers.LOSSLESS_FIELDS})
        lossless.update(packCalls=1, packEligible=1, sendAttempts=3 if end else 0,
                        sendQueued=1 if end else 0, sendNotQueued=2 if end else 0,
                        attemptedFrameBytes=210 if end else 0)
        rows = []
        for node in nodes:
            peer = "b" * 40 if node["pid"] == 100 else "a" * 40
            value = "116" if end else "16"
            raw = (f'cometbft_p2p_peer_send_bytes_total{{peer_id="{peer}",chID="0x31"}} {value}\n'
                   f'cometbft_p2p_peer_receive_bytes_total{{peer_id="{peer}",chID="0x31"}} {value}\n'
                   f'cometbft_p2p_message_send_bytes_total{{message_type="mempool_LosslessHexV1"}} {value}\n'
                   f'cometbft_p2p_message_receive_bytes_total{{message_type="mempool_LosslessHexV1"}} {value}\n')
            capture = layers.original_metrics_capture(node=node, namespace="cometbft", raw=raw,
                start_monotonic_ns=time + 1, end_monotonic_ns=time + 2)
            rows.append(dict(name=node["name"], pid=node["pid"], startTicks=node["startTicks"],
                             wire=copy.deepcopy(wire), lossless=copy.deepcopy(lossless), proto=capture))
        return dict(bindingSHA256=layers.digest(binding), startMonotonicNs=str(time),
                    endMonotonicNs=str(time + 10), nodes=rows, tcp=None)
    return binding, checkpoint(100, False), checkpoint(200, True)


class LayerControls(unittest.TestCase):
    def account(self, values):
        return layers.account_layers(binding=values[0], start=values[1], end=values[2])

    def test_retries_layers_and_two_metric_views_never_become_delivery_or_physical(self):
        result = self.account(fixture())
        node = result["nodes"][0]
        self.assertEqual(node["logical"]["counters"]["sendAttempts.transactionBytes"], "400")
        self.assertEqual(node["attempted"]["counters"]["attemptedFrameBytes"], "210")
        proto = node["serializedProto"]
        self.assertEqual(proto["views"]["peerSend"]["selectedBytes"], "100")
        self.assertEqual(proto["views"]["messageSend"]["selectedBytes"], "100")
        self.assertFalse(proto["peerAndMessageViewsAdditive"])
        self.assertIsNone(result["delivered"])
        self.assertIsNone(result["physical"]["bytes"])
        self.assertFalse(result["physicalBytesMeasured"])
        self.assertFalse(result["gainsQualified"])
        self.assertIsNone(result["independentFinalityVerified"])

    def test_missing_disabled_and_disappearing_series_are_unknown_not_zero(self):
        binding, start, end = fixture()
        start["nodes"][0]["wire"] = None
        start["nodes"][0]["lossless"]["enabled"] = False
        # Valid capture hash, but a missing original counter cannot be filled 0.
        capture = start["nodes"][0]["proto"]
        capture["raw"] = capture["raw"].splitlines()[0] + "\n"
        capture["sha256"] = hashlib.sha256(capture["raw"].encode()).hexdigest()
        row = self.account((binding, start, end))["nodes"][0]
        self.assertEqual(row["logical"]["status"], "UNKNOWN")
        self.assertEqual(row["attempted"]["status"], "UNKNOWN")
        self.assertEqual(row["serializedProto"]["views"]["peerReceive"]["status"], "UNKNOWN")
        self.assertIsNone(row["logical"]["value"])

    def test_real_capture_hash_and_time_bounds_are_required(self):
        for mutation, expected in ((lambda c: c.update(sha256="0" * 64), "metrics_capture_hash_mismatch"),
                                   (lambda c: c.update(endMonotonicNs="999"), "metrics_outside_checkpoint")):
            binding, start, end = fixture()
            mutation(end["nodes"][0]["proto"])
            result = self.account((binding, start, end))["nodes"][0]["serializedProto"]
            self.assertEqual(result["status"], "UNKNOWN")
            self.assertEqual(result["reason"], expected)

    def test_counter_reset_duplicate_series_and_inexact_float_fail_closed(self):
        for changed, reason in (("0", "metric_counter_reset_or_regression"),
                                ("9007199254740992", "inexact_or_invalid_prom_counter")):
            binding, start, end = fixture()
            c = end["nodes"][0]["proto"]
            c["raw"] = c["raw"].replace(" 116\n", " " + changed + "\n")
            c["sha256"] = hashlib.sha256(c["raw"].encode()).hexdigest()
            result = self.account((binding, start, end))["nodes"][0]["serializedProto"]
            if reason.startswith("metric_counter"):
                self.assertEqual(result["views"]["peerSend"]["reason"], reason)
            else:
                self.assertEqual(result["reason"], reason)
        binding, start, end = fixture()
        c = end["nodes"][0]["proto"]
        c["raw"] += c["raw"].splitlines()[0] + "\n"
        c["sha256"] = hashlib.sha256(c["raw"].encode()).hexdigest()
        self.assertEqual(self.account((binding, start, end))["nodes"][0]["serializedProto"]["reason"],
                         "duplicate_selected_metric_series")

    def test_pid_source_binding_and_cross_phase_window_cannot_be_mixed(self):
        values = fixture()
        values[2]["nodes"][0]["startTicks"] = "999"
        with self.assertRaisesRegex(layers.AccountingError, "process_identity_changed"):
            self.account(values)
        values = fixture(); values[0]["source"] = "f" * 40
        with self.assertRaisesRegex(layers.AccountingError, "binding_mismatch"):
            self.account(values)
        values = fixture(); values[2]["startMonotonicNs"] = "105"
        with self.assertRaisesRegex(layers.AccountingError, "overlapping_or_reversed"):
            self.account(values)

    def test_changed_counter_label_or_absent_node_is_not_a_zero_baseline(self):
        binding, start, end = fixture()
        c = end["nodes"][0]["proto"]
        c["raw"] = c["raw"].replace('chID="0x31"', 'chID="0x30"')
        c["sha256"] = hashlib.sha256(c["raw"].encode()).hexdigest()
        end["nodes"].pop()
        result = self.account((binding, start, end))
        self.assertEqual(result["nodes"][0]["serializedProto"]["views"]["peerSend"]["reason"],
                         "metric_series_created_closed_or_labels_changed")
        self.assertEqual(result["nodes"][1]["logical"]["reason"], "node_checkpoint_missing")

    def test_uint64_decimal_output_and_overflow_controls(self):
        self.assertEqual(layers.counter("18446744073709551615"), (1 << 64) - 1)
        for invalid in (True, -1, "01", "18446744073709551616", 0.5):
            with self.assertRaises(layers.AccountingError):
                layers.counter(invalid)
        values = fixture(); values[2]["nodes"][0]["wire"]["overflow"] = True
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "wire_lifecycle_or_overflow")

    def test_tcp_cannot_cross_checkpoint_or_owned_process_scope(self):
        binding, start, _ = fixture()
        owned = {node["name"]: node for node in binding["nodes"]}
        snapshot = dict(schema="YNX-OWNED-TCP/1", startMonotonicNs="101", endMonotonicNs="102",
                        nodes=copy.deepcopy(binding["nodes"]))
        layers.validate_tcp_scope(snapshot, start, owned)
        snapshot["nodes"][0]["startTicks"] = "999"
        with self.assertRaisesRegex(layers.AccountingError, "tcp_process_identity_changed"):
            layers.validate_tcp_scope(snapshot, start, owned)
        snapshot["nodes"] = copy.deepcopy(binding["nodes"])
        snapshot["endMonotonicNs"] = "201"
        with self.assertRaisesRegex(layers.AccountingError, "tcp_outside_checkpoint"):
            layers.validate_tcp_scope(snapshot, start, owned)
        snapshot["endMonotonicNs"] = "102"
        snapshot["nodes"][0]["p2pLocalEndpoints"] = [{"address": "127.0.0.1", "port": 31656}]
        with self.assertRaisesRegex(layers.AccountingError, "tcp_p2p_endpoint_binding_mismatch"):
            layers.validate_tcp_scope(snapshot, start, owned)

    def test_nonfinite_or_oversized_extra_capture_data_is_rejected(self):
        values = fixture(); values[2]["nodes"][0]["wire"]["untrustedExtra"] = float("nan")
        self.assertEqual(self.account(values)["nodes"][0]["logical"]["reason"], "noncanonical_capture_json")
        with self.assertRaisesRegex(layers.AccountingError, "capture_json_bound"):
            layers.digest({"raw": "x" * layers.MAX_BYTES})

    def test_composition_keeps_failed_tcp_samples_unknown_without_sampling(self):
        tcp_spec = importlib.util.spec_from_file_location("tcp_control", Path(__file__).with_name("owned-tcp-accounting.py"))
        tcp = importlib.util.module_from_spec(tcp_spec); tcp_spec.loader.exec_module(tcp)
        binding, start, end = fixture()
        for checkpoint in (start, end):
            sample = dict(schema="YNX-OWNED-TCP/1", startMonotonicNs=str(int(checkpoint["startMonotonicNs"]) + 1),
                          endMonotonicNs=str(int(checkpoint["startMonotonicNs"]) + 2),
                          nodes=copy.deepcopy(binding["nodes"]), complete=False, reasons=["NO_MATCHED_OWNED_TCP_SOCKETS"],
                          atomic=False, totalTrafficComplete=False, totalTrafficBytes=None,
                          physicalBytes=None, physicalStatus="UNMEASURED", status="UNKNOWN",
                          firstCause="NO_MATCHED_OWNED_TCP_SOCKETS", coverage="MATCHED_ENDPOINT_SOCKETS_ONLY",
                          ownershipContinuity="ENDPOINT_CHECKS_ONLY")
            sample["sampleSHA256"] = tcp.sample_sha256(sample)
            checkpoint["tcp"] = sample
        with mock.patch("socket.socket", side_effect=AssertionError("accounting must never sample")):
            result = self.account((binding, start, end))
        self.assertFalse(result["tcp"]["complete"])
        self.assertIn("SAMPLE_INCOMPLETE", result["tcp"]["reasons"])
        self.assertIsNone(result["tcp"]["totalTrafficBytes"])
        self.assertFalse(result["physicalBytesMeasured"])


if __name__ == "__main__":
    unittest.main()
