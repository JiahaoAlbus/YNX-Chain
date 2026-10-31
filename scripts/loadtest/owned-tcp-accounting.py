#!/usr/bin/env python3
"""Opt-in, read-only TCP observations for the normal owned Perf supervisor.

Importing this module and diff_owned_tcp never inspect /proc or open sockets.
sample_owned_tcp accepts the supervisor's original {name,pid,startTicks}
receipts, checks its existing guard's real descendant closure twice, and issues
only exact SOCK_DIAG requests for reverse-paired owned TCP socket tuples. It
does not dump netlink tables, enter namespaces, capture traffic, or start work.

Optional node p2pLocalEndpoints=[{address,port}] are the original configured
P2P listening endpoints (0.0.0.0/:: may denote their wildcard address). Without
that mapping, even paired owned sockets have UNKNOWN application scope. Raw
TCP acknowledgement/receive/send/retransmit counters are not protocol bytes,
business delivery, TCP headers, or physical/link bytes. Endpoint snapshots
cannot observe sockets born AND closed between them; no full-traffic total is
ever claimed, including an otherwise complete diff.

UAPI provenance: Linux v6.8 include/uapi/linux/{tcp,inet_diag,sock_diag}.h;
net/{ipv4/inet_diag,core/sock_diag}.c. The named tcp_info layout through
tcpi_bytes_retrans was checked against the repository's pinned
golang.org/x/sys v0.48.0/unix/{linux/types,ztypes_linux,zerrors_linux}.go.
No missing/old kernel fields are substituted with zero.
"""

import argparse
import ctypes
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import struct
import sys
import time


SCHEMA = "YNX-OWNED-TCP/1"
DIFF_SCHEMA = "YNX-OWNED-TCP-WINDOW/1"
U64_MAX = (1 << 64) - 1
MAX_NODES = 4
MAX_FDS = 4096
MAX_SOCKETS = 256
MAX_TABLE_BYTES = 2 << 20
MAX_JSON_BYTES = 4 << 20
MAX_NETLINK_BYTES = 65536
SAMPLE_SECONDS = 3.0
COUNTERS = ("bytesAcked", "bytesReceived", "bytesSent", "bytesRetransmitted",
            "totalRetransmits", "segmentsOut", "segmentsIn")
PAIRED = "OWNED_PAIR_SCOPE_UNKNOWN"
P2P = "REGISTERED_P2P_OWNED_PAIR"
NETLINK_INET_DIAG, SOCK_DIAG_BY_FAMILY, INET_DIAG_INFO = 4, 20, 2
NLM_F_REQUEST, NLM_F_MULTI, NLMSG_ERROR = 1, 2, 2
NOCOOKIE = 0xffffffff


class Unknown(ValueError):
    """Fixed first-cause reason; no raw paths, captures, or arbitrary errors."""


def require(condition, reason):
    if not condition:
        raise Unknown(reason)


def uint(value, bits=64):
    require(type(value) is int or (type(value) is str and
            re.fullmatch(r"0|[1-9][0-9]{0,19}", value)), "INVALID_UNSIGNED_INTEGER")
    result = int(value)
    require(0 <= result < (1 << bits), "UNSIGNED_INTEGER_RANGE")
    return result


def canonical(value):
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False).encode("utf8")
    except (TypeError, ValueError, UnicodeError):
        raise Unknown("INVALID_JSON") from None
    require(len(raw) <= MAX_JSON_BYTES, "JSON_BOUND")
    return raw


def sample_sha256(sample):
    """Hash the exact sample, excluding only its digest and derived window."""
    require(type(sample) is dict, "INVALID_SAMPLE")
    return hashlib.sha256(canonical({k: v for k, v in sample.items()
                                   if k not in ("sampleSHA256", "window")})).hexdigest()


def _reason(error):
    if isinstance(error, Unknown):
        return str(error)
    if isinstance(error, TimeoutError):
        return "SAMPLE_IO_TIMEOUT"
    if isinstance(error, OSError):
        return "OS_ERROR_%s" % (error.errno if error.errno is not None else "UNKNOWN")
    if isinstance(error, (ValueError, OverflowError, UnicodeError, struct.error)):
        return "MALFORMED_KERNEL_INPUT"
    return "GUARD_OR_KERNEL_READ_FAILED"


def _first(sample, reason):
    if sample["firstCause"] is None:
        sample["firstCause"] = reason


def _guard():
    path = Path(__file__).with_name("pq-paired-linux-window.py")
    spec = importlib.util.spec_from_file_location("_ynx_owned_tcp_original_guard", path)
    require(spec is not None and spec.loader is not None, "ORIGINAL_GUARD_UNAVAILABLE")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _deadline(deadline):
    require(time.monotonic() < deadline, "SAMPLE_TIME_BOUND")


def _inventory(guard, deadline):
    # Reuse the original inventory/parser, adding this call's shared deadline
    # between its bounded reads. This is a fresh private imported module, not
    # a mutation of the existing supervisor or an extra fallback scan.
    original = guard.bounded
    def budgeted(*args, **kwargs):
        _deadline(deadline)
        result = original(*args, **kwargs)
        _deadline(deadline)
        return result
    guard.bounded = budgeted
    try:
        _deadline(deadline)
        result = guard.proc_inventory()
        _deadline(deadline)
        return result
    finally:
        guard.bounded = original


def _read(path, limit=65536):
    with open(path, "rb") as handle:
        raw = handle.read(limit + 1)
    require(len(raw) <= limit, "KERNEL_READ_BOUND")
    return raw


def _endpoints(value):
    if value is None:
        return None
    require(type(value) is list and 1 <= len(value) <= 16, "INVALID_P2P_ENDPOINTS")
    result = []
    for endpoint in value:
        require(type(endpoint) is dict and set(endpoint) == {"address", "port"},
                "INVALID_P2P_ENDPOINT")
        require(type(endpoint["address"]) is str and "%" not in endpoint["address"],
                "INVALID_P2P_ADDRESS")
        address = str(ipaddress.ip_address(endpoint["address"]))
        port = uint(endpoint["port"], 16)
        require(port > 0, "INVALID_P2P_PORT")
        row = {"address": address, "port": port}
        require(row not in result, "DUPLICATE_P2P_ENDPOINT")
        result.append(row)
    return sorted(result, key=lambda x: (x["address"], x["port"]))


def _nodes(nodes):
    require(type(nodes) is list and 1 <= len(nodes) <= MAX_NODES, "INVALID_NODE_RECEIPTS")
    result, names, pids = [], set(), set()
    for node in nodes:
        require(type(node) is dict, "INVALID_NODE_RECEIPT")
        name = node.get("name")
        require(type(name) is str and re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", name),
                "INVALID_NODE_NAME")
        pid = uint(node.get("pid"), 31)
        start = uint(node.get("startTicks"))
        require(pid > 1 and start > 0, "INVALID_NODE_IDENTITY")
        require(name not in names and pid not in pids, "DUPLICATE_NODE_IDENTITY")
        names.add(name)
        pids.add(pid)
        result.append(dict(name=name, pid=pid, startTicks=str(start),
                           p2pLocalEndpoints=_endpoints(node.get("p2pLocalEndpoints"))))
    return sorted(result, key=lambda x: x["name"])


def validate_owned_receipts(rows, launcher_pid, nodes, guard):
    """Pure ownership check. A supplied receipt is NEVER passed as known owner."""
    require(launcher_pid in rows, "LAUNCHER_MISSING")
    owned = set(guard.owned_set(rows, launcher_pid))
    for node in nodes:
        row = rows.get(node["pid"])
        require(row is not None and node["pid"] in owned, "NODE_NOT_OWNED_DESCENDANT")
        require(row["startTicks"] == uint(node["startTicks"]), "NODE_PID_REUSED")
    return rows[launcher_pid]["startTicks"]


def _process_identity(pid):
    fields = re.findall(rb"^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$",
                        _read(Path("/proc") / str(pid) / "status"), re.M)
    require(len(fields) == 1, "PROCESS_UID_UNAVAILABLE")
    uids = tuple(uint(x.decode("ascii"), 32) for x in fields[0])
    base = Path("/proc") / str(pid) / "ns"
    netns, userns = os.readlink(base / "net"), os.readlink(base / "user")
    require(re.fullmatch(r"net:\[[0-9]+\]", netns) is not None and
            re.fullmatch(r"user:\[[0-9]+\]", userns) is not None,
            "NAMESPACE_IDENTITY_UNAVAILABLE")
    return dict(uid=uids[3], processUIDs=list(uids), netns=netns, userns=userns)


def _fds(pid):
    root = Path("/proc") / str(pid) / "fd"
    result = {}
    # Bound iteration itself, not just retained sockets.
    with os.scandir(root) as entries:
        for count, entry in enumerate(entries, 1):
            require(count <= MAX_FDS, "PROCESS_FD_BOUND")
            require(entry.name.isdecimal(), "INVALID_PROCESS_FD")
            target = os.readlink(entry.path)
            match = re.fullmatch(r"socket:\[([0-9]+)\]", target)
            if match:
                inode = str(uint(match[1]))
                result.setdefault(inode, []).append(int(entry.name))
    return {key: sorted(value) for key, value in result.items()}


def _proc_address(raw, family, byteorder):
    size = 4 if family == socket.AF_INET else 16
    require(re.fullmatch("[0-9A-Fa-f]{%d}" % (size * 2), raw) is not None,
            "INVALID_PROC_ADDRESS")
    data = bytes.fromhex(raw)
    # /proc prints each native __be32 word as a host-endian hex integer.
    if byteorder == "little":
        data = b"".join(data[i:i + 4][::-1] for i in range(0, size, 4))
    elif byteorder != "big":
        raise Unknown("INVALID_BYTE_ORDER")
    return str(ipaddress.ip_address(data))


def parse_proc_tcp(raw, family, owned_inodes, byteorder=sys.byteorder):
    """Bounded metadata only; discard all rows not already owned by an FD."""
    require(family in (socket.AF_INET, socket.AF_INET6), "INVALID_TCP_FAMILY")
    require(type(raw) is bytes and len(raw) <= MAX_TABLE_BYTES, "PROC_TCP_BOUND")
    lines = raw.decode("ascii").splitlines()
    require(lines and "local_address" in lines[0] and "inode" in lines[0],
            "INVALID_PROC_TCP_HEADER")
    result = {}
    for line in lines[1:]:
        parts = line.split()
        require(len(parts) >= 10, "TRUNCATED_PROC_TCP_ROW")
        inode = str(uint(parts[9]))
        if inode not in owned_inodes:
            continue
        require(inode != "0" and inode not in result, "AMBIGUOUS_SOCKET_INODE")
        local, remote = [], []
        for source, target in ((parts[1], local), (parts[2], remote)):
            address, port = source.rsplit(":", 1)
            require(re.fullmatch(r"[0-9A-Fa-f]{4}", port) is not None,
                    "INVALID_PROC_PORT")
            target.extend((_proc_address(address, family, byteorder), int(port, 16)))
        state = int(parts[3], 16)
        require(0 < state <= 12, "INVALID_TCP_STATE")
        result[inode] = dict(inode=inode, family=family, localAddress=local[0],
                             localPort=local[1], remoteAddress=remote[0],
                             remotePort=remote[1], uid=uint(parts[7], 32), state=state)
    return result


def _tcp_rows(pid, fds):
    result = {}
    for name, family in (("tcp", socket.AF_INET), ("tcp6", socket.AF_INET6)):
        rows = parse_proc_tcp(_read(Path("/proc") / str(pid) / "net" / name,
                                   MAX_TABLE_BYTES), family, fds)
        require(not (set(result) & set(rows)), "AMBIGUOUS_SOCKET_INODE")
        result.update(rows)
    require(len(result) <= MAX_SOCKETS, "OWNED_TCP_SOCKET_BOUND")
    return result


def _tuple(row):
    return tuple(row[key] for key in ("family", "localAddress", "localPort",
                                      "remoteAddress", "remotePort"))


def _reverse(row):
    return (row["family"], row["remoteAddress"], row["remotePort"],
            row["localAddress"], row["localPort"])


def _matches_p2p(node, row):
    for endpoint in node.get("p2pLocalEndpoints") or []:
        address = ipaddress.ip_address(endpoint["address"])
        if (endpoint["port"] == row["localPort"] and
                address.version == ipaddress.ip_address(row["localAddress"]).version and
                (address.is_unspecified or str(address) == row["localAddress"])):
            return True
    return False


def select_owned_pairs(nodes):
    """Only reverse pairs of separately owned FDs may leave this module."""
    lookup, selected = {}, {node["name"]: [] for node in nodes}
    for node in nodes:
        for row in node["_rows"].values():
            if row["state"] != 10:  # LISTEN has no peer and is not traffic.
                lookup.setdefault((node["netns"], _tuple(row)), []).append((node, row))
    mapping_complete = all(node.get("p2pLocalEndpoints") for node in nodes)
    for node in nodes:
        for row in node["_rows"].values():
            if row["state"] == 10:
                continue
            peers = [(other, peer) for other, peer in
                     lookup.get((node["netns"], _reverse(row)), [])
                     if other["pid"] != node["pid"]]
            # An inherited/shared fd or ambiguous tuple is not attributed.
            if len(peers) != 1 or len(lookup[(node["netns"], _tuple(row))]) != 1:
                continue
            other, peer = peers[0]
            scoped = _matches_p2p(node, row) or _matches_p2p(other, peer)
            if mapping_complete and not scoped:
                continue
            selected[node["name"]].append(dict(row, scope=P2P if scoped else PAIRED,
                                                peerNode=other["name"]))
    return selected


# Named Linux UAPI layout, rather than unverified magic byte offsets. The two
# explicit bitfield bytes occupy bytes 6..7 on both little- and big-endian ABI.
class _TCPInfo(ctypes.Structure):
    _fields_ = ([(name, ctypes.c_uint8) for name in
                 ("state", "ca_state", "retransmits", "probes", "backoff", "options")]
                + [("bitfields", ctypes.c_uint8 * 2)]
                + [(name, ctypes.c_uint32) for name in
                   ("rto", "ato", "snd_mss", "rcv_mss", "unacked", "sacked", "lost",
                    "retrans", "fackets", "last_data_sent", "last_ack_sent",
                    "last_data_recv", "last_ack_recv", "pmtu", "rcv_ssthresh", "rtt",
                    "rttvar", "snd_ssthresh", "snd_cwnd", "advmss", "reordering",
                    "rcv_rtt", "rcv_space", "total_retrans")]
                + [(name, ctypes.c_uint64) for name in
                   ("pacing_rate", "max_pacing_rate", "bytes_acked", "bytes_received")]
                + [(name, ctypes.c_uint32) for name in
                   ("segs_out", "segs_in", "notsent_bytes", "min_rtt",
                    "data_segs_in", "data_segs_out")]
                + [(name, ctypes.c_uint64) for name in
                   ("delivery_rate", "busy_time", "rwnd_limited", "sndbuf_limited")]
                + [("delivered", ctypes.c_uint32), ("delivered_ce", ctypes.c_uint32),
                   ("bytes_sent", ctypes.c_uint64), ("bytes_retrans", ctypes.c_uint64)])


_TCP_FIELDS = dict(bytesAcked=("bytes_acked", "Q"), bytesReceived=("bytes_received", "Q"),
                   bytesSent=("bytes_sent", "Q"), bytesRetransmitted=("bytes_retrans", "Q"),
                   totalRetransmits=("total_retrans", "I"), segmentsOut=("segs_out", "I"),
                   segmentsIn=("segs_in", "I"))


def parse_tcp_info(raw):
    require(len(raw) >= ctypes.sizeof(_TCPInfo), "TCP_INFO_REQUIRED_FIELDS_UNAVAILABLE")
    require(raw[0] == 1, "TCP_NOT_ESTABLISHED")
    return {key: str(struct.unpack_from("=" + fmt, raw, getattr(_TCPInfo, field).offset)[0])
            for key, (field, fmt) in _TCP_FIELDS.items()}


def _sockid(row, cookie=U64_MAX, interface=0):
    addresses = []
    for field in ("localAddress", "remoteAddress"):
        raw = ipaddress.ip_address(row[field]).packed
        addresses.append(raw if len(raw) == 16 else raw + b"\0" * 12)
    return (struct.pack("!HH", row["localPort"], row["remotePort"])
            + b"".join(addresses)
            + struct.pack("=III", interface, cookie & NOCOOKIE, cookie >> 32))


def exact_diag_request(row, sequence, portid, cookie=U64_MAX, interface=0):
    """NLM_F_REQUEST only: never NLM_F_DUMP, ROOT, MATCH, or SOCK_DESTROY."""
    require(row["state"] == 1, "TCP_NOT_ESTABLISHED")
    payload = struct.pack("=BBBBI", row["family"], socket.IPPROTO_TCP,
                          1 << (INET_DIAG_INFO - 1), 0, 1 << row["state"])
    payload += _sockid(row, cookie, interface)
    return struct.pack("=IHHII", 16 + len(payload), SOCK_DIAG_BY_FAMILY,
                       NLM_F_REQUEST, sequence, portid) + payload


def parse_diag_reply(packet, *, sequence, portid, expected, cookie=None):
    """Parse exactly one kernel unicast reply. Sender identity is checked by IO."""
    require(type(packet) is bytes and 16 <= len(packet) <= MAX_NETLINK_BYTES,
            "NETLINK_REPLY_BOUND")
    length, kind, flags, seq, target = struct.unpack_from("=IHHII", packet)
    require(seq == sequence and target == portid, "NETLINK_REPLY_IDENTITY")
    require(not flags & NLM_F_MULTI, "NETLINK_MULTIPART_FORBIDDEN")
    require(16 <= length <= len(packet) and (length + 3) & ~3 == len(packet),
            "NETLINK_MESSAGE_LENGTH")
    body = packet[16:length]
    if kind == NLMSG_ERROR:
        require(len(body) >= 4, "NETLINK_ERROR_TRUNCATED")
        code = struct.unpack_from("=i", body)[0]
        raise Unknown("NETLINK_ERROR_%d" % abs(code))
    require(kind == SOCK_DIAG_BY_FAMILY and len(body) >= 72, "NETLINK_REPLY_TYPE")
    family, state = body[0], body[1]
    sport, dport = struct.unpack_from("!HH", body, 4)
    size = 4 if family == socket.AF_INET else 16
    require(family in (socket.AF_INET, socket.AF_INET6), "NETLINK_TCP_FAMILY")
    src = str(ipaddress.ip_address(body[8:8 + size]))
    dst = str(ipaddress.ip_address(body[24:24 + size]))
    interface, low, high = struct.unpack_from("=III", body, 40)
    uid, inode = struct.unpack_from("=II", body, 64)
    actual = dict(family=family, localAddress=src, localPort=sport,
                  remoteAddress=dst, remotePort=dport, uid=uid, inode=str(inode))
    require(_tuple(actual) == _tuple(expected) and actual["inode"] == expected["inode"]
            and uid == expected["uid"], "NETLINK_SOCKET_OWNER_MISMATCH")
    actual_cookie = low | (high << 32)
    require(actual_cookie not in (0, U64_MAX), "KERNEL_COOKIE_UNAVAILABLE")
    require(cookie is None or actual_cookie == cookie, "KERNEL_COOKIE_CHANGED")
    require(state == 1, "TCP_NOT_ESTABLISHED")
    info, offset = None, 72
    while offset < len(body):
        require(len(body) - offset >= 4, "NETLINK_ATTRIBUTE_TRUNCATED")
        length, kind = struct.unpack_from("=HH", body, offset)
        require(length >= 4 and offset + length <= len(body), "NETLINK_ATTRIBUTE_LENGTH")
        if kind & 0x3fff == INET_DIAG_INFO:
            require(info is None and kind == INET_DIAG_INFO, "NETLINK_TCP_INFO_AMBIGUOUS")
            info = body[offset + 4:offset + length]
        offset += (length + 3) & ~3
    require(offset == len(body) and info is not None, "TCP_INFO_UNAVAILABLE")
    return dict(cookie=str(actual_cookie), interface=interface, state=state,
                raw=parse_tcp_info(info))


class _Diag:
    def __init__(self, deadline):
        self.deadline = deadline
        self.sock = None

    def __enter__(self):
        _deadline(self.deadline)
        self.sock = socket.socket(socket.AF_NETLINK, socket.SOCK_RAW, NETLINK_INET_DIAG)
        try:
            self.sock.bind((0, 0))
            self.portid = self.sock.getsockname()[0]
        except BaseException:
            self.sock.close()
            raise
        self.sequence = 0
        return self

    def query(self, row, cookie=None, interface=0):
        _deadline(self.deadline)
        self.sequence += 1
        request = exact_diag_request(row, self.sequence, self.portid,
                                     U64_MAX if cookie is None else cookie, interface)
        self.sock.settimeout(max(.001, self.deadline - time.monotonic()))
        require(self.sock.sendto(request, (0, 0)) == len(request), "NETLINK_SHORT_SEND")
        packet, ancillary, flags, sender = self.sock.recvmsg(MAX_NETLINK_BYTES)
        require(sender == (0, 0) and not ancillary, "NETLINK_NOT_KERNEL_UNICAST")
        require(not flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC), "NETLINK_REPLY_TRUNCATED")
        return parse_diag_reply(packet, sequence=self.sequence, portid=self.portid,
                                expected=row, cookie=cookie)

    def __exit__(self, *_):
        if self.sock is not None:
            self.sock.close()


def _same_socket(before, after):
    return (_tuple(before) == _tuple(after) and before["uid"] == after["uid"]
            and before["inode"] == after["inode"] and after["state"] == 1)


def sample_owned_tcp(*, launcher_pid, nodes, previous=None):
    """One explicit bounded observation; never retries on a failed identity.

    complete describes observed endpoint identity/read validity, not atomicity
    or complete traffic. For sampling errors, raw counters remain null. A
    previous snapshot adds only the pure, hash-bound derived window.
    """
    begin = time.monotonic_ns()
    deadline = time.monotonic() + SAMPLE_SECONDS
    sample = dict(schema=SCHEMA, startMonotonicNs=str(begin), endMonotonicNs=None,
                  kernelRelease=None, bootID=None, launcher=None, nodes=[], complete=False,
                  atomic=False, reasons=[], firstCause=None, status="UNKNOWN",
                  coverage="MATCHED_ENDPOINT_SOCKETS_ONLY",
                  ownershipContinuity="ENDPOINT_CHECKS_ONLY",
                  totalTrafficComplete=False, totalTrafficBytes=None,
                  physicalBytes=None, physicalStatus="UNMEASURED")
    working = []
    try:
        require(sys.platform == "linux", "LINUX_ONLY")
        launcher_pid = uint(launcher_pid, 31)
        require(launcher_pid > 1, "INVALID_LAUNCHER_PID")
        receipts = _nodes(nodes)
        guard = _guard()
        before, _ = _inventory(guard, deadline)
        _deadline(deadline)
        launcher_start = validate_owned_receipts(before, launcher_pid, receipts, guard)
        sample["kernelRelease"] = os.uname().release
        sample["bootID"] = _read("/proc/sys/kernel/random/boot_id", 128).decode("ascii").strip()
        require(re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}",
                             sample["bootID"]) is not None, "BOOT_ID_UNAVAILABLE")
        own = _process_identity(os.getpid())
        launcher = _process_identity(launcher_pid)
        sample["launcher"] = dict(pid=launcher_pid, startTicks=str(launcher_start), **launcher)
        for receipt in receipts:
            _deadline(deadline)
            identity = _process_identity(receipt["pid"])
            require(identity["netns"] == own["netns"] and identity["userns"] == own["userns"],
                    "FOREIGN_NAMESPACE_UNSUPPORTED")
            node = dict(receipt, **identity, sockets=[], complete=True, reasons=[])
            node["_fds"] = _fds(node["pid"])
            node["_rows"] = _tcp_rows(node["pid"], node["_fds"])
            working.append(node)
        selected = select_owned_pairs(working)
        require(any(selected.values()), "NO_MATCHED_OWNED_TCP_SOCKETS")
        with _Diag(deadline) as diag:
            for node in working:
                chosen = selected[node["name"]]
                node["excludedTCPCount"] = len(node["_rows"]) - len(chosen)
                for row in sorted(chosen, key=lambda x: uint(x["inode"])):
                    item = dict(row, raw=None, cookie=None, interface=None,
                                complete=False, reasons=[], observedMonotonicNs=None, _first=None)
                    node["sockets"].append(item)
                    try:
                        require(row["uid"] == node["uid"], "SOCKET_UID_MISMATCH")
                        item["_first"] = diag.query(row)
                    except (Unknown, OSError, ValueError, struct.error) as error:
                        item["reasons"].append(_reason(error))
                        _first(sample, _reason(error))
                        node["complete"] = False
                if not chosen:
                    node["complete"] = False
                    node["reasons"].append("NO_MATCHED_OWNED_TCP_SOCKETS")
                    _first(sample, "NO_MATCHED_OWNED_TCP_SOCKETS")
            # Original normal guard recheck, without supplied `known` identities.
            after, _ = _inventory(guard, deadline)
            require(validate_owned_receipts(after, launcher_pid, receipts, guard) == launcher_start,
                    "LAUNCHER_PID_REUSED")
            require(_process_identity(launcher_pid) == launcher, "LAUNCHER_IDENTITY_CHANGED")
            require(_read("/proc/sys/kernel/random/boot_id", 128).decode("ascii").strip()
                    == sample["bootID"], "BOOT_ID_CHANGED")
            for node in working:
                try:
                    _deadline(deadline)
                    identity = _process_identity(node["pid"])
                    require(all(identity[key] == node[key] for key in identity),
                            "NODE_IDENTITY_CHANGED")
                    fds = _fds(node["pid"])
                    rows = _tcp_rows(node["pid"], fds)
                    # Conservatively reject any TCP/FD churn, including sockets
                    # otherwise excluded from this application scope.
                    require(fds == node["_fds"], "SOCKET_FD_SET_CHANGED")
                    require(set(rows) == set(node["_rows"]), "TCP_SOCKET_SET_CHANGED")
                    for item in node["sockets"]:
                        require(item["inode"] in rows and _same_socket(item, rows[item["inode"]]),
                                "SOCKET_OWNER_OR_TUPLE_CHANGED")
                        first = item["_first"]
                        if first is None:
                            continue  # No retry after any failed first query.
                        # Second exact query is after the ownership recheck and
                        # MUST use the original kernel cookie, never NOCOOKIE.
                        again = diag.query(item, uint(first["cookie"]), first["interface"])
                        require(again["interface"] == first["interface"], "SOCKET_INTERFACE_CHANGED")
                        for field in COUNTERS:
                            require(uint(again["raw"][field]) >= uint(first["raw"][field]),
                                    "TCP_COUNTER_REGRESSION_DURING_SAMPLE")
                        item.update(again, complete=True, observedMonotonicNs=str(time.monotonic_ns()))
                    require(_fds(node["pid"]) == node["_fds"], "SOCKET_FD_SET_CHANGED")
                    stat = guard.parse_stat(_read(Path("/proc") / str(node["pid"]) / "stat"), node["pid"])
                    require(stat["startTicks"] == uint(node["startTicks"]), "NODE_PID_REUSED")
                    require(_process_identity(node["pid"]) == identity, "NODE_IDENTITY_CHANGED")
                    _deadline(deadline)
                except (Unknown, OSError, ValueError, struct.error) as error:
                    _first(sample, _reason(error))
                    node["complete"] = False
                    node["reasons"].append(_reason(error))
                    for item in node["sockets"]:
                        item.update(raw=None, complete=False)
                        item["reasons"].append(_reason(error))
        sample["complete"] = bool(working) and all(node["complete"] for node in working)
    except (Unknown, OSError, ValueError, RuntimeError, ImportError) as error:
        sample["reasons"].append(_reason(error))
        _first(sample, _reason(error))
        # A final ownership/guard failure invalidates earlier counters, too.
        for node in working:
            node["complete"] = False
            for item in node["sockets"]:
                item.update(raw=None, complete=False)
                item["reasons"].append(_reason(error))
    for node in working:
        for item in node["sockets"]:
            item.pop("_first", None)
        sample["nodes"].append({key: value for key, value in node.items() if not key.startswith("_")})
    sample["endMonotonicNs"] = str(time.monotonic_ns())
    sample["status"] = "OBSERVED" if sample["complete"] else "UNKNOWN"
    sample["sampleSHA256"] = sample_sha256(sample)
    if previous is not None:
        sample["window"] = diff_owned_tcp(previous, sample)
    return sample


def _socket_key(row):
    return (str(uint(row["inode"])), str(uint(row["cookie"])), uint(row["uid"], 32),
            uint(row["interface"], 32), *_tuple(row), row["peerNode"], row["scope"])


def _validate_sample(sample):
    require(type(sample) is dict and sample.get("schema") == SCHEMA, "INVALID_SAMPLE_SCHEMA")
    digest = sample_sha256(sample)
    require(sample.get("sampleSHA256") == digest, "SAMPLE_HASH_MISMATCH")
    require(sample.get("atomic") is False and sample.get("totalTrafficComplete") is False
            and sample.get("totalTrafficBytes") is None and sample.get("physicalBytes") is None
            and sample.get("physicalStatus") == "UNMEASURED"
            and sample.get("coverage") == "MATCHED_ENDPOINT_SOCKETS_ONLY"
            and sample.get("ownershipContinuity") == "ENDPOINT_CHECKS_ONLY", "INVALID_COVERAGE_CLAIM")
    require(uint(sample["startMonotonicNs"]) <= uint(sample["endMonotonicNs"]),
            "INVALID_SAMPLE_TIME")
    require(type(sample.get("nodes")) is list and 1 <= len(sample["nodes"]) <= MAX_NODES,
            "INVALID_SAMPLE_NODES")
    require(sample.get("complete") is True and sample.get("reasons") == []
            and sample.get("firstCause") is None and sample.get("status") == "OBSERVED",
            "SAMPLE_INCOMPLETE")
    require(type(sample.get("kernelRelease")) is str and
            re.fullmatch(r"[A-Za-z0-9_.+-]{1,128}", sample["kernelRelease"]), "INVALID_KERNEL_IDENTITY")
    require(type(sample.get("bootID")) is str and
            re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", sample["bootID"]),
            "INVALID_BOOT_IDENTITY")
    launcher = sample.get("launcher")
    require(type(launcher) is dict and uint(launcher["pid"], 31) > 1
            and uint(launcher["startTicks"]) > 0, "INVALID_LAUNCHER_IDENTITY")
    identities, result = set(), {}
    for node in sample["nodes"]:
        identity = (node["name"], uint(node["pid"], 31), uint(node["startTicks"]))
        require(type(identity[0]) is str and re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", identity[0])
                and identity[1] > 1 and identity[2] > 0, "INVALID_SAMPLE_NODE_IDENTITY")
        require(type(node["processUIDs"]) is list and len(node["processUIDs"]) == 4
                and all(uint(uid, 32) == uid for uid in node["processUIDs"])
                and uint(node["uid"], 32) == node["processUIDs"][3], "INVALID_NODE_UID")
        require(type(node["netns"]) is str and re.fullmatch(r"net:\[[0-9]+\]", node["netns"])
                and type(node["userns"]) is str and re.fullmatch(r"user:\[[0-9]+\]", node["userns"]),
                "INVALID_NODE_NAMESPACE")
        require(_endpoints(node["p2pLocalEndpoints"]) == node["p2pLocalEndpoints"],
                "INVALID_NODE_P2P_MAPPING")
        require(identity not in identities and identity[0] not in result, "DUPLICATE_SAMPLE_NODE")
        identities.add(identity)
        require(node.get("complete") is True and node.get("reasons") == [], "NODE_INCOMPLETE")
        require(type(node.get("sockets")) is list and 1 <= len(node["sockets"]) <= MAX_SOCKETS,
                "INVALID_SOCKET_LIST")
        sockets = {}
        for row in node["sockets"]:
            require(row.get("complete") is True and row.get("reasons") == [] and row["state"] == 1,
                    "SOCKET_INCOMPLETE")
            require(row["scope"] in (P2P, PAIRED), "INVALID_SOCKET_SCOPE")
            require(row["family"] in (socket.AF_INET, socket.AF_INET6), "INVALID_SOCKET_FAMILY")
            for field in ("localAddress", "remoteAddress"):
                address = ipaddress.ip_address(row[field])
                require(str(address) == row[field] and "%" not in row[field]
                        and (address.version == 4) == (row["family"] == socket.AF_INET),
                        "INVALID_SOCKET_ADDRESS")
            require(uint(row["localPort"], 16) > 0 and uint(row["remotePort"], 16) > 0
                    and uint(row["inode"]) > 0 and uint(row["cookie"]) not in (0, U64_MAX)
                    and uint(row["uid"], 32) == node["uid"], "INVALID_SOCKET_IDENTITY")
            require(uint(sample["startMonotonicNs"]) <= uint(row["observedMonotonicNs"])
                    <= uint(sample["endMonotonicNs"]), "SOCKET_TIME_OUTSIDE_SAMPLE")
            key = _socket_key(row)
            require(key not in sockets, "DUPLICATE_SAMPLE_SOCKET")
            require(type(row["raw"]) is dict and set(row["raw"]) == set(COUNTERS),
                    "MISSING_TCP_COUNTERS")
            for field in COUNTERS:
                require(type(row["raw"][field]) is str, "COUNTER_MUST_BE_DECIMAL_STRING")
                uint(row["raw"][field], 32 if field in COUNTERS[4:] else 64)
            sockets[key] = row
        result[identity[0]] = (node, identity, sockets)
    # A digest binds content but is not an assertion of peer ownership. Verify
    # that every published tuple really has exactly one supplied owned reverse.
    reconstructed = [dict(node, _rows={r["inode"]: r for r in sockets.values()})
                     for node, _, sockets in result.values()]
    selected = select_owned_pairs(reconstructed)
    for name, (_, _, sockets) in result.items():
        require({_socket_key(row) for row in selected[name]} == set(sockets),
                "SOCKET_OWNED_PAIR_OR_SCOPE_MISMATCH")
    return digest, result


def diff_owned_tcp(start, end):
    """Pure exact-sample delta. No IO, retries, physical totals, or delivery claim."""
    result = dict(schema=DIFF_SCHEMA, startSampleSHA256=None, endSampleSHA256=None,
                  complete=False, reasons=[], firstCause=None, status="UNKNOWN", nodes=[],
                  coverage="MATCHED_ENDPOINT_SOCKETS_ONLY",
                  ownershipContinuity="ENDPOINT_CHECKS_ONLY",
                  totalTrafficComplete=False, totalTrafficBytes=None,
                  physicalBytes=None, physicalStatus="UNMEASURED")
    try:
        # Bind even failed windows to actual input content, not claimed hashes.
        result["startSampleSHA256"] = sample_sha256(start)
        result["endSampleSHA256"] = sample_sha256(end)
        _, left = _validate_sample(start)
        _, right = _validate_sample(end)
        for key in ("kernelRelease", "bootID", "launcher"):
            require(start.get(key) is not None and start[key] == end.get(key),
                    "WINDOW_%s_CHANGED" % key.upper())
        require(uint(start["endMonotonicNs"]) < uint(end["startMonotonicNs"]),
                "WINDOW_TIME_OVERLAP_OR_REVERSED")
        require(set(left) == set(right), "WINDOW_NODE_SET_CHANGED")
        for name in sorted(left):
            a, a_id, a_sockets = left[name]
            b, b_id, b_sockets = right[name]
            require(a_id == b_id, "WINDOW_NODE_PID_REUSED")
            for key in ("uid", "processUIDs", "netns", "userns", "p2pLocalEndpoints"):
                require(a[key] == b[key], "WINDOW_NODE_%s_CHANGED" % key.upper())
            node = dict(name=name, pid=b["pid"], startTicks=b["startTicks"],
                        netns=b["netns"], complete=True, reasons=[], sockets=[])
            result["nodes"].append(node)
            if set(a_sockets) != set(b_sockets):
                node.update(complete=False, reasons=["WINDOW_SOCKET_SET_OR_IDENTITY_CHANGED"])
                continue
            for key in sorted(a_sockets):
                old, new = a_sockets[key], b_sockets[key]
                row = {field: new[field] for field in
                       ("inode", "cookie", "family", "localAddress", "localPort",
                        "remoteAddress", "remotePort", "uid", "interface", "peerNode", "scope")}
                row.update(complete=True, reasons=[], delta=None,
                           startObservedMonotonicNs=old["observedMonotonicNs"],
                           endObservedMonotonicNs=new["observedMonotonicNs"])
                node["sockets"].append(row)
                if any(uint(new["raw"][field]) < uint(old["raw"][field]) for field in COUNTERS):
                    row.update(complete=False, reasons=["WINDOW_TCP_COUNTER_REGRESSION"])
                    node["complete"] = False
                else:
                    row["delta"] = {field: str(uint(new["raw"][field]) - uint(old["raw"][field]))
                                    for field in COUNTERS}
        result["complete"] = bool(result["nodes"]) and all(n["complete"] for n in result["nodes"])
        result["status"] = "OBSERVED_ENDPOINT_DELTA" if result["complete"] else "UNKNOWN"
        if not result["complete"]:
            result["reasons"].append("WINDOW_ENDPOINTS_INCOMPLETE")
            _first(result, "WINDOW_ENDPOINTS_INCOMPLETE")
    except (Unknown, KeyError, TypeError, ValueError, OverflowError) as error:
        result["reasons"].append(_reason(error))
        cause = _reason(error)
        for sample, digest_key in ((start, "startSampleSHA256"), (end, "endSampleSHA256")):
            if (type(sample) is dict and sample.get("sampleSHA256") == result[digest_key]
                    and type(sample.get("firstCause")) is str
                    and re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", sample["firstCause"])):
                cause = sample["firstCause"]
                break
        _first(result, cause)
        # A window-level identity failure cannot leave earlier apparent deltas.
        for node in result["nodes"]:
            node.update(complete=False)
            for row in node["sockets"]:
                row.update(complete=False, delta=None)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-owned", action="store_true", help="explicit opt-in; normal owner hook only")
    parser.add_argument("--launcher-pid", type=int)
    parser.add_argument("--nodes-json", help="original bounded supervisor node receipts JSON array")
    args = parser.parse_args(argv)
    if not args.sample_owned:
        parser.error("no sampling requested; --sample-owned is required")
    if args.launcher_pid is None or args.nodes_json is None:
        parser.error("--launcher-pid and --nodes-json are required")
    try:
        nodes = json.loads(_read(args.nodes_json, 65536))
        sample = sample_owned_tcp(launcher_pid=args.launcher_pid, nodes=nodes)
    except (Unknown, OSError, ValueError) as error:
        parser.exit(2, _reason(error) + "\n")
    print(canonical(sample).decode("utf8"))
    return 0 if sample["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
