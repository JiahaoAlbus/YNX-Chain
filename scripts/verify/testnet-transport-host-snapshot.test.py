import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("snapshot", pathlib.Path(__file__).with_name("testnet-transport-host-snapshot.py"))
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class HostSnapshotTests(unittest.TestCase):
    def test_allowlisted_counters(self):
        self.assertEqual(snapshot.counters("TcpExt: ListenDrops SecretField TCPTimeouts\nTcpExt: 9 444 12\n"), {"ListenDrops": 9, "TCPTimeouts": 12})

    def test_configuration_redaction_and_missing_defaults(self):
        value = {"apps": {"http": {"servers": {"s": {"listen": [":443"], "routes": [{"password": "SECRET"}],
                 "tls_connection_policies": [{"protocol_min": "tls1.2", "private_key": "SECRET"}], "logs": {"private": "SECRET"}}}}},
                 "logging": {"logs": {"default": {"secret": "SECRET"}}}, "secret": "SECRET"}
        result = snapshot.config_summary(value)
        self.assertNotIn("SECRET", str(result))
        self.assertTrue(result["servers"]["s"]["accessLoggingConfigured"])
        self.assertNotIn("read_timeout", result["servers"]["s"])
        self.assertFalse(result["fullConfigRetained"])

    def test_failed_command_is_unavailable(self):
        result = snapshot.run(["/nonexistent/ynx-readonly-test"])
        self.assertIsNone(result["exitCode"])
        self.assertEqual(result["output"], "")

    def test_packet_metadata_retains_no_payload_or_other_source(self):
        lines = "1789833900.123 eth0 In IP 1.2.3.4.50000 > 10.0.0.1.443: Flags [S], seq 123, length 0\n1789833900.124 eth0 Out IP 10.0.0.1.443 > 1.2.3.4.50000: Flags [S.], seq 987, length 0\n1789833900.125 IP 5.6.7.8.33 > 10.0.0.1.443: Flags [P.], SECRET length 5"
        values = snapshot.packet_metadata(lines, "1.2.3.4")
        self.assertEqual(len(values), 2)
        self.assertEqual(values[0]["direction"], "from-client")
        self.assertEqual(values[1]["flags"], "S.")
        self.assertNotIn("SECRET", str(values))
        self.assertEqual(values[0]["sequence"], "123")
        self.assertNotIn("1.2.3.4", str(values))

    def test_planned_ports_do_not_assume_ssh_and_https_egress_match(self):
        lines = "1789833900.123 IP 9.8.7.6.24001 > 10.0.0.1.443: Flags [P.], seq 12:212, ack 77, length 200\n1789833900.124 IP 9.8.7.6.24002 > 10.0.0.1.443: Flags [S], seq 987, length 0\n1789833900.125 IP 9.8.7.6.24001 > 10.0.0.1.80: Flags [S], seq 1, length 0"
        values = snapshot.packet_metadata(lines, "1.2.3.4", [24001])
        self.assertEqual(len(values), 1)
        self.assertEqual(values[0]["sequence"], "12:212")
        self.assertEqual(values[0]["ack"], "77")
        self.assertNotIn("9.8.7.6", str(values))


if __name__ == "__main__":
    unittest.main()
