#!/usr/bin/env python3
"""Pure parser/ownership/window fixtures. Never run the Linux sampler or traffic."""
import contextlib
import copy
import importlib.util
import io
from pathlib import Path
import socket
import struct
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "owned_tcp_accounting", Path(__file__).with_name("owned-tcp-accounting.py"))
tcp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tcp)


def tcp_info(**overrides):
    # Independent, fixed Linux UAPI vector offsets from tcp.h / pinned x/sys.
    raw = bytearray(216)
    raw[0] = 1
    fields = {"bytesAcked": (120, "Q", (1 << 63) + 3),
              "bytesReceived": (128, "Q", 202),
              "bytesSent": (200, "Q", 303),
              "bytesRetransmitted": (208, "Q", 404),
              "totalRetransmits": (100, "I", 5),
              "segmentsOut": (136, "I", 6), "segmentsIn": (140, "I", 7)}
    for name, (offset, fmt, value) in fields.items():
        struct.pack_into("=" + fmt, raw, offset, overrides.get(name, value))
    return bytes(raw)


def row(inode="123", local="127.0.0.1", lport=30101,
        remote="127.0.0.2", rport=40001, state=1, uid=501):
    return dict(inode=inode, family=socket.AF_INET, localAddress=local, localPort=lport,
                remoteAddress=remote, remotePort=rport, state=state, uid=uid)


def diag_reply(expected=None, *, info=None, attrs=None, seq=9, target=700,
               cookie=0x2233445566778899, interface=0, flags=0):
    expected = expected or row()
    family = expected["family"]
    import ipaddress
    src = ipaddress.ip_address(expected["localAddress"]).packed
    dst = ipaddress.ip_address(expected["remoteAddress"]).packed
    src += b"\0" * (16 - len(src))
    dst += b"\0" * (16 - len(dst))
    # inet_diag_msg: fixed 72 bytes, then native-aligned rtattrs.
    body = (struct.pack("=BBBB", family, expected["state"], 0, 0)
            + struct.pack("!HH", expected["localPort"], expected["remotePort"])
            + src + dst + struct.pack("=III", interface, cookie & 0xffffffff, cookie >> 32)
            + struct.pack("=IIIII", 0, 0, 0, expected["uid"], int(expected["inode"])))
    if attrs is None:
        info = tcp_info() if info is None else info
        attrs = struct.pack("=HH", 4 + len(info), 2) + info
        attrs += b"\0" * (-len(attrs) % 4)
    body += attrs
    return struct.pack("=IHHII", 16 + len(body), 20, flags, seq, target) + body


def proc_table(*lines):
    return ("  sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n"
            + "\n".join(lines) + "\n").encode()


def proc_line(inode=123, address="0100007F", remote="0200007F", state="01"):
    return (" 0: %s:7595 %s:9C41 %s 00000000:00000000 00:00000000 "
            "00000000 501 0 %s 1 0000000000000000" % (address, remote, state, inode))


def pair_nodes(mapping=True):
    a = row()
    b = row(inode="456", local=a["remoteAddress"], lport=a["remotePort"],
            remote=a["localAddress"], rport=a["localPort"])
    nodes = []
    for name, pid, r in (("n0", 101, a), ("n1", 102, b)):
        endpoints = ([dict(address="0.0.0.0", port=30101 if name == "n0" else 30102)]
                     if mapping else None)
        nodes.append(dict(name=name, pid=pid, startTicks=str(pid * 10), uid=501,
                          processUIDs=[501] * 4, netns="net:[10]", userns="user:[11]",
                          p2pLocalEndpoints=endpoints, _rows={r["inode"]: r}))
    return nodes


def snapshot(offset=0, begin=10, finish=20):
    nodes = pair_nodes()
    selected = tcp.select_owned_pairs(nodes)
    for node in nodes:
        node.pop("_rows")
        node.update(complete=True, reasons=[], sockets=[], excludedTCPCount=0)
        for r in selected[node["name"]]:
            node["sockets"].append(dict(r, complete=True, reasons=[],
                                        cookie=str(int(r["inode"]) * 10), interface=0,
                                        observedMonotonicNs=str(begin + 1),
                                        raw={key: str(100 + offset) for key in tcp.COUNTERS}))
    sample = dict(schema=tcp.SCHEMA, startMonotonicNs=str(begin), endMonotonicNs=str(finish),
                  kernelRelease="6.8.0-original", bootID="12345678-1234-1234-1234-123456789abc",
                  launcher=dict(pid=100, startTicks="900", uid=501, netns="net:[10]",
                                userns="user:[11]", processUIDs=[501] * 4),
                  nodes=nodes, complete=True, atomic=False, reasons=[], firstCause=None, status="OBSERVED",
                  coverage="MATCHED_ENDPOINT_SOCKETS_ONLY", totalTrafficComplete=False,
                  ownershipContinuity="ENDPOINT_CHECKS_ONLY",
                  totalTrafficBytes=None, physicalBytes=None, physicalStatus="UNMEASURED")
    return sign(sample)


def sign(sample):
    sample["sampleSHA256"] = tcp.sample_sha256(sample)
    return sample


class TCPInfoTests(unittest.TestCase):
    def test_uapi_named_layout_and_exact_unsigned_values(self):
        expected = {"bytesAcked": str((1 << 63) + 3), "bytesReceived": "202",
                    "bytesSent": "303", "bytesRetransmitted": "404", "totalRetransmits": "5",
                    "segmentsOut": "6", "segmentsIn": "7"}
        self.assertEqual(tcp.parse_tcp_info(tcp_info()), expected)
        self.assertEqual(tcp.ctypes.sizeof(tcp._TCPInfo), 216)
        self.assertEqual(tcp._TCPInfo.bytes_acked.offset, 120)
        self.assertEqual(tcp._TCPInfo.bytes_retrans.offset, 208)
        self.assertEqual(tcp.parse_tcp_info(tcp_info(bytesAcked=tcp.U64_MAX))["bytesAcked"],
                         str(tcp.U64_MAX))

    def test_short_old_kernel_and_non_established_are_unknown(self):
        with self.assertRaisesRegex(tcp.Unknown, "REQUIRED_FIELDS_UNAVAILABLE"):
            tcp.parse_tcp_info(tcp_info()[:215])
        raw = bytearray(tcp_info())
        raw[0] = 8
        with self.assertRaisesRegex(tcp.Unknown, "NOT_ESTABLISHED"):
            tcp.parse_tcp_info(raw)

    def test_trailing_new_kernel_fields_do_not_shift_old_fields(self):
        self.assertEqual(tcp.parse_tcp_info(tcp_info() + b"\xff" * 64),
                         tcp.parse_tcp_info(tcp_info()))


class ProcParserTests(unittest.TestCase):
    def test_ipv4_native_word_endianness_and_owned_filter(self):
        raw = proc_table(proc_line(), proc_line(inode=999, address="NOT_AN_ADDRESS"))
        result = tcp.parse_proc_tcp(raw, socket.AF_INET, {"123"}, "little")
        self.assertEqual(result, {"123": row()})
        big = proc_table(proc_line(address="7F000001", remote="7F000002"))
        self.assertEqual(tcp.parse_proc_tcp(big, socket.AF_INET, {"123"}, "big"), result)
        self.assertNotIn("999", result)

    def test_ipv6_native_word_endianness(self):
        little = proc_table(proc_line(address="00000000000000000000000001000000",
                                     remote="00000000000000000000000002000000"))
        result = tcp.parse_proc_tcp(little, socket.AF_INET6, {"123"}, "little")["123"]
        self.assertEqual((result["localAddress"], result["remoteAddress"]), ("::1", "::2"))
        big = proc_table(proc_line(address="00000000000000000000000000000001",
                                  remote="00000000000000000000000000000002"))
        self.assertEqual(tcp.parse_proc_tcp(big, socket.AF_INET6, {"123"}, "big")["123"], result)

    def test_truncation_duplicate_inode_bad_address_and_bounds_fail(self):
        cases = [(b"bad header", "HEADER"),
                 (proc_table("0: incomplete"), "TRUNCATED"),
                 (proc_table(proc_line(), proc_line()), "AMBIGUOUS"),
                 (proc_table(proc_line(address="bad")), "ADDRESS"),
                 (b"x" * (tcp.MAX_TABLE_BYTES + 1), "BOUND")]
        for raw, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(tcp.Unknown, reason):
                tcp.parse_proc_tcp(raw, socket.AF_INET, {"123"})


class NetlinkTests(unittest.TestCase):
    def test_exact_request_has_no_dump_flags_and_carries_cookie(self):
        request = tcp.exact_diag_request(row(), 9, 700, 0x2233445566778899, 12)
        self.assertEqual(len(request), 72)
        self.assertEqual(struct.unpack_from("=IHHII", request), (72, 20, 1, 9, 700))
        self.assertEqual(struct.unpack_from("=BBBBI", request, 16),
                         (socket.AF_INET, socket.IPPROTO_TCP, 2, 0, 2))
        self.assertEqual(struct.unpack_from("!HH", request, 24), (30101, 40001))
        self.assertEqual(struct.unpack_from("=III", request, 60),
                         (12, 0x66778899, 0x22334455))
        with self.assertRaisesRegex(tcp.Unknown, "NOT_ESTABLISHED"):
            tcp.exact_diag_request(row(state=8), 9, 700)

    def parse(self, packet, **kwargs):
        return tcp.parse_diag_reply(packet, sequence=9, portid=700, expected=row(), **kwargs)

    def test_actual_message_layout_tuple_uid_inode_and_cookie(self):
        result = self.parse(diag_reply(), cookie=0x2233445566778899)
        self.assertEqual(result["cookie"], str(0x2233445566778899))
        self.assertEqual(result["raw"], tcp.parse_tcp_info(tcp_info()))
        self.assertEqual(result["interface"], 0)

    def test_wrong_identity_or_reused_socket_is_unknown(self):
        cases = [(diag_reply(seq=10), {}, "REPLY_IDENTITY"),
                 (diag_reply(target=701), {}, "REPLY_IDENTITY"),
                 (diag_reply(row(uid=502)), {}, "OWNER_MISMATCH"),
                 (diag_reply(row(inode="124")), {}, "OWNER_MISMATCH"),
                 (diag_reply(row(lport=30102)), {}, "OWNER_MISMATCH"),
                 (diag_reply(cookie=1234), {"cookie": 9999}, "COOKIE_CHANGED"),
                 (diag_reply(cookie=0), {}, "COOKIE_UNAVAILABLE"),
                 (diag_reply(flags=2), {}, "MULTIPART_FORBIDDEN")]
        for packet, kwargs, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(tcp.Unknown, reason):
                self.parse(packet, **kwargs)

    def test_missing_duplicate_truncated_info_and_netlink_error(self):
        info = struct.pack("=HH", 220, 2) + tcp_info()
        cases = [(diag_reply(attrs=b""), "TCP_INFO_UNAVAILABLE"),
                 (diag_reply(attrs=info * 2), "TCP_INFO_AMBIGUOUS"),
                 (diag_reply(info=tcp_info()[:100]), "REQUIRED_FIELDS_UNAVAILABLE"),
                 (diag_reply(attrs=struct.pack("=HH", 900, 2) + b"xxxx"), "ATTRIBUTE_LENGTH"),
                 (diag_reply()[:-1], "MESSAGE_LENGTH")]
        for packet, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(tcp.Unknown, reason):
                self.parse(packet)
        error = struct.pack("=IHHIIi", 20, 2, 0, 9, 700, -2)
        with self.assertRaisesRegex(tcp.Unknown, "NETLINK_ERROR_2"):
            self.parse(error)


class OwnershipScopeTests(unittest.TestCase):
    def test_original_guard_cannot_seed_ownership_from_receipt(self):
        guard = tcp._guard()  # source import only; no /proc reads or processes.
        rows = {100: dict(parent=1, startTicks=900),
                101: dict(parent=100, startTicks=1010),
                102: dict(parent=999, startTicks=1020)}
        self.assertEqual(tcp.validate_owned_receipts(rows, 100, [dict(pid=101, startTicks="1010")], guard), 900)
        with self.assertRaisesRegex(tcp.Unknown, "NOT_OWNED_DESCENDANT"):
            tcp.validate_owned_receipts(rows, 100, [dict(pid=102, startTicks="1020")], guard)
        with self.assertRaisesRegex(tcp.Unknown, "PID_REUSED"):
            tcp.validate_owned_receipts(rows, 100, [dict(pid=101, startTicks="1011")], guard)

    def test_only_reverse_owned_pairs_can_be_output(self):
        nodes = pair_nodes()
        nodes[0]["_rows"]["999"] = row(inode="999", remote="203.0.113.200", rport=443)
        selected = tcp.select_owned_pairs(nodes)
        self.assertEqual([s["inode"] for s in selected["n0"]], ["123"])
        self.assertNotIn(b"203.0.113.200", tcp.canonical(selected))
        self.assertEqual(selected["n0"][0]["scope"], tcp.P2P)
        self.assertEqual(selected["n0"][0]["peerNode"], "n1")

    def test_missing_application_mapping_is_unknown_scope(self):
        selected = tcp.select_owned_pairs(pair_nodes(mapping=False))
        self.assertEqual(selected["n0"][0]["scope"], tcp.PAIRED)
        self.assertEqual(selected["n1"][0]["scope"], tcp.PAIRED)

    def test_non_p2p_pair_listeners_and_ambiguous_fd_are_not_attributed(self):
        nodes = pair_nodes()
        nodes[0]["p2pLocalEndpoints"][0]["port"] = 31000
        self.assertEqual(tcp.select_owned_pairs(nodes), {"n0": [], "n1": []})
        nodes = pair_nodes()
        nodes[0]["_rows"]["123"]["state"] = 10
        self.assertEqual(tcp.select_owned_pairs(nodes), {"n0": [], "n1": []})
        nodes = pair_nodes()
        duplicate = copy.deepcopy(nodes[0])
        duplicate.update(name="n2", pid=103)
        nodes.append(duplicate)
        self.assertTrue(all(not sockets for sockets in tcp.select_owned_pairs(nodes).values()))

    def test_receipts_and_endpoint_bounds_are_finite(self):
        with self.assertRaisesRegex(tcp.Unknown, "NODE_RECEIPTS"):
            tcp._nodes([{}] * 5)
        with self.assertRaisesRegex(tcp.Unknown, "INVALID_P2P_PORT"):
            tcp._endpoints([dict(address="127.0.0.1", port=0)])
        with self.assertRaisesRegex(tcp.Unknown, "DUPLICATE_NODE_IDENTITY"):
            tcp._nodes([dict(name="a", pid=101, startTicks=10),
                        dict(name="b", pid=101, startTicks=11)])


class WindowTests(unittest.TestCase):
    def test_hash_bound_independent_endpoint_deltas_never_physical(self):
        start, end = snapshot(), snapshot(25, 30, 40)
        result = tcp.diff_owned_tcp(start, end)
        self.assertTrue(result["complete"], result)
        self.assertEqual(result["startSampleSHA256"], start["sampleSHA256"])
        self.assertEqual(result["endSampleSHA256"], end["sampleSHA256"])
        self.assertEqual(len(result["nodes"]), 2)
        for node in result["nodes"]:
            self.assertEqual(node["sockets"][0]["delta"], {key: "25" for key in tcp.COUNTERS})
        self.assertFalse(result["totalTrafficComplete"])
        self.assertIsNone(result["totalTrafficBytes"])
        self.assertIsNone(result["physicalBytes"])
        self.assertEqual(result["physicalStatus"], "UNMEASURED")
        self.assertEqual(result["coverage"], "MATCHED_ENDPOINT_SOCKETS_ONLY")

    def test_hash_ignores_only_digest_and_derived_window(self):
        start, end = snapshot(), snapshot(25, 30, 40)
        end["window"] = {"anything": "derived"}
        self.assertEqual(tcp.sample_sha256(end), end["sampleSHA256"])
        end["nodes"][0]["sockets"][0]["raw"]["bytesAcked"] = "999"
        end["firstCause"] = "FORGED_FIRST_CAUSE_WITHOUT_MATCHING_HASH"
        result = tcp.diff_owned_tcp(start, end)
        self.assertFalse(result["complete"])
        self.assertIn("SAMPLE_HASH_MISMATCH", result["reasons"])
        self.assertEqual(result["firstCause"], "SAMPLE_HASH_MISMATCH")
        self.assertNotEqual(result["endSampleSHA256"], end["sampleSHA256"])

    def test_reboot_namespace_pid_cookie_inode_tuple_uid_scope_change_unknown(self):
        def mutate(sample, path, value):
            current = sample
            for part in path[:-1]:
                current = current[part]
            current[path[-1]] = value
        cases = [("bootID", "different"), ("kernelRelease", "different"),
                 ("nodes.0.netns", "net:[12]"), ("nodes.0.startTicks", "1011"),
                 ("nodes.0.uid", 502), ("nodes.0.sockets.0.cookie", "1234567"),
                 ("nodes.0.sockets.0.inode", "9999"),
                 ("nodes.0.sockets.0.remotePort", 50000),
                 ("nodes.0.sockets.0.scope", tcp.PAIRED)]
        for path, value in cases:
            with self.subTest(path=path):
                start, end = snapshot(), snapshot(25, 30, 40)
                parts = [int(p) if p.isdecimal() else p for p in path.split(".")]
                mutate(end, parts, value)
                result = tcp.diff_owned_tcp(start, sign(end))
                self.assertFalse(result["complete"], result)
                # A changed endpoint cannot produce a delta; other independent
                # matched endpoints may still retain their own observations.
                for node in result["nodes"]:
                    for r in node["sockets"] if node["name"] == "n0" else []:
                        self.assertIsNone(r["delta"])

    def test_missing_closed_or_new_socket_not_zero(self):
        start, end = snapshot(), snapshot(25, 30, 40)
        end["nodes"][0]["sockets"].pop()
        result = tcp.diff_owned_tcp(start, sign(end))
        self.assertFalse(result["complete"])
        self.assertTrue(result["reasons"])
        self.assertIsNone(result["totalTrafficBytes"])
        start, end = snapshot(), snapshot(25, 30, 40)
        extra = copy.deepcopy(end["nodes"][0]["sockets"][0])
        extra["inode"], extra["cookie"] = "999", "9990"
        extra["remotePort"] = 40111
        end["nodes"][0]["sockets"].append(extra)
        reverse = copy.deepcopy(end["nodes"][1]["sockets"][0])
        reverse["inode"], reverse["cookie"], reverse["localPort"] = "888", "8880", 40111
        end["nodes"][1]["sockets"].append(reverse)
        result = tcp.diff_owned_tcp(start, sign(end))
        self.assertFalse(result["complete"])
        self.assertEqual(result["nodes"][0]["sockets"], [])

    def test_counter_regression_or_missing_field_is_unknown(self):
        for field in tcp.COUNTERS:
            start, end = snapshot(), snapshot(25, 30, 40)
            end["nodes"][0]["sockets"][0]["raw"][field] = "99"
            result = tcp.diff_owned_tcp(start, sign(end))
            self.assertFalse(result["complete"])
            self.assertIsNone(result["nodes"][0]["sockets"][0]["delta"])
        start, end = snapshot(), snapshot(25, 30, 40)
        del end["nodes"][0]["sockets"][0]["raw"]["bytesSent"]
        self.assertFalse(tcp.diff_owned_tcp(start, sign(end))["complete"])

    def test_u64_exact_delta_and_no_implicit_wraparound(self):
        start, end = snapshot(), snapshot(25, 30, 40)
        start["nodes"][0]["sockets"][0]["raw"]["bytesAcked"] = str(tcp.U64_MAX - 5)
        end["nodes"][0]["sockets"][0]["raw"]["bytesAcked"] = str(tcp.U64_MAX)
        result = tcp.diff_owned_tcp(sign(start), sign(end))
        self.assertTrue(result["complete"])
        self.assertEqual(result["nodes"][0]["sockets"][0]["delta"]["bytesAcked"], "5")
        end["nodes"][0]["sockets"][0]["raw"]["bytesAcked"] = "0"
        self.assertFalse(tcp.diff_owned_tcp(sign(start), sign(end))["complete"])

    def test_incomplete_sample_time_overlap_or_false_coverage_claim_invalidates(self):
        start = snapshot()
        for change in (dict(complete=False, reasons=["SOCKET_FD_SET_CHANGED"]),
                       dict(startMonotonicNs="20"), dict(totalTrafficComplete=True),
                       dict(physicalBytes="123")):
            end = snapshot(25, 30, 40)
            end.update(change)
            result = tcp.diff_owned_tcp(start, sign(end))
            self.assertFalse(result["complete"])
            self.assertIsNone(result["physicalBytes"])

    def test_first_failure_survives_later_unknown_and_continuity_is_not_claimed(self):
        start, end = snapshot(), snapshot(25, 30, 40)
        end.update(complete=False, status="UNKNOWN", firstCause="SOCKET_FD_SET_CHANGED",
                   reasons=["SAMPLE_TIME_BOUND"])
        result = tcp.diff_owned_tcp(start, sign(end))
        self.assertEqual(result["firstCause"], "SOCKET_FD_SET_CHANGED")
        self.assertEqual(result["ownershipContinuity"], "ENDPOINT_CHECKS_ONLY")
        self.assertFalse(result["totalTrafficComplete"])
        self.assertEqual(result["status"], "UNKNOWN")

    def test_no_io_for_import_diff_or_default_cli(self):
        with mock.patch.object(socket, "socket", side_effect=AssertionError("no socket permitted")), \
                mock.patch("builtins.open", side_effect=AssertionError("no kernel/input IO permitted")), \
                mock.patch.object(tcp, "sample_owned_tcp", side_effect=AssertionError("not opt-in")):
            self.assertTrue(tcp.diff_owned_tcp(snapshot(), snapshot(25, 30, 40))["complete"])
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                tcp.main([])
            self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
