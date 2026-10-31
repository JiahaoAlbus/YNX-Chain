#!/usr/bin/env python3
"""Pure, bounded accounting for an explicitly owned experimental window.

The normal Perf supervisor supplies snapshots; this module never starts a node,
reads /proc, fetches metrics, captures packets, or changes a runner receipt.
WireObserver is logical original-C/reencoded data. Original P2P metrics count
serialized bytes accepted by a send queue, not delivery. TCP counters and both
ends of a connection are separate observations. Physical bytes stay unmeasured.
"""
import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat


SCHEMA = "YNX-NETWORK-LAYER-ACCOUNTING/v1"
BINDING_SCHEMA = "YNX-NETWORK-MEASUREMENT-BINDING/v1"
MAX_BYTES = 4 << 20
MAX_METRIC_LINES = 20000
U64_MAX = (1 << 64) - 1
# Original Prometheus counters are float64. Beyond this point the capture
# cannot establish an exact integer even if its text happens to be integral.
PROM_EXACT_MAX = (1 << 53) - 1
WIRE_GROUPS = ("sendAttempts", "sendQueued", "sendNotQueued", "received")
WIRE_FIELDS = ("messages", "transactions", "transactionBytes", "reencodedProtoBytes")
LOSSLESS_FIELDS = ("packCalls", "packEligible", "packRejected", "sendAttempts",
                   "sendQueued", "sendNotQueued", "attemptedFrameBytes",
                   "receivedFrames", "receivedFrameBytes", "restoredFrames",
                   "restoredOriginalBytes", "restoreRejected")
METRICS = {
    "peerSend": "p2p_peer_send_bytes_total",
    "peerReceive": "p2p_peer_receive_bytes_total",
    "messageSend": "p2p_message_send_bytes_total",
    "messageReceive": "p2p_message_receive_bytes_total",
}


class AccountingError(ValueError):
    """Fixed public error codes only; raw captures/paths are never in errors."""


def require(condition, code):
    if not condition:
        raise AccountingError(code)


def counter(value):
    require(type(value) is int or (type(value) is str and re.fullmatch(r"0|[1-9][0-9]{0,19}", value)),
            "invalid_unsigned_counter")
    result = int(value)
    require(0 <= result <= U64_MAX, "counter_out_of_range")
    return result


def digest(value):
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    except (ValueError, TypeError, UnicodeError):
        raise AccountingError("noncanonical_capture_json") from None
    require(len(raw) <= MAX_BYTES, "capture_json_bound")
    return hashlib.sha256(raw).hexdigest()


def text_id(value, code):
    require(type(value) is str and re.fullmatch(r"[A-Za-z0-9_.:/+-]{1,128}", value), code)
    return value


def validate_binding(binding):
    require(type(binding) is dict and binding.get("schema") == BINDING_SCHEMA, "invalid_binding_schema")
    for name in ("runID", "mode", "window"):
        text_id(binding.get(name), "invalid_binding_identity")
    for name, length in (("source", 40), ("tools", 40), ("inputSHA256", 64)):
        require(type(binding.get(name)) is str and re.fullmatch("[0-9a-f]{%d}" % length, binding[name]),
                "invalid_binding_pin")
    for name in ("configuredDemand", "qualifiedCount"):
        if binding.get(name) is not None:
            counter(binding[name])
    nodes = binding.get("nodes")
    require(type(nodes) is list and 1 <= len(nodes) <= 4, "invalid_owned_nodes")
    names, identities, peers = set(), set(), set()
    for node in nodes:
        require(type(node) is dict, "invalid_owned_node")
        name = text_id(node.get("name"), "invalid_owned_node_name")
        require(type(node.get("pid")) is int and 1 < node["pid"] <= (1 << 31) - 1, "invalid_owned_pid")
        identity = (node["pid"], counter(node.get("startTicks")))
        require(identity[1] > 0 and name not in names and identity not in identities, "duplicate_owned_node")
        names.add(name); identities.add(identity)
        peer = node.get("peerID")
        if peer is not None:
            require(type(peer) is str and re.fullmatch(r"[0-9a-f]{40}", peer) and peer not in peers,
                    "invalid_owned_peer")
            peers.add(peer)
    channels = binding.get("channels", ["0x30", "0x31"])
    require(type(channels) is list and 1 <= len(channels) <= 64, "invalid_channel_scope")
    require(all(type(c) is str and re.fullmatch(r"0x[0-9a-f]{1,2}", c) for c in channels),
            "invalid_channel_scope")
    require(len(set(channels)) == len(channels), "invalid_channel_scope")
    return nodes


def unknown(reason, **extra):
    return dict(status="UNKNOWN", value=None, reason=reason, **extra)


def bounds(record):
    require(type(record) is dict, "missing_capture")
    lo, hi = counter(record.get("startMonotonicNs")), counter(record.get("endMonotonicNs"))
    require(lo <= hi, "capture_time_reversed")
    return lo, hi


def validate_checkpoint(checkpoint, binding_hash, owned):
    require(type(checkpoint) is dict and checkpoint.get("bindingSHA256") == binding_hash,
            "checkpoint_binding_mismatch")
    bounds(checkpoint)
    rows = checkpoint.get("nodes")
    require(type(rows) is list and len(rows) <= 4, "invalid_checkpoint_nodes")
    result = {}
    for row in rows:
        require(type(row) is dict and row.get("name") in owned, "unowned_checkpoint_node")
        name = row["name"]
        require(name not in result, "duplicate_checkpoint_node")
        original = owned[name]
        require(row.get("pid") == original["pid"] and counter(row.get("startTicks")) == counter(original["startTicks"]),
                "checkpoint_process_identity_changed")
        result[name] = row
    return result


def _wire(snapshot):
    require(type(snapshot) is dict and snapshot.get("schema") == "YNX-MEMPOOL-WIRE-OBSERVATION/v1",
            "missing_original_wire_snapshot")
    require(snapshot.get("attached") is True and snapshot.get("overflow") is False
            and snapshot.get("physicalBytesMeasured") is False, "wire_lifecycle_or_overflow")
    result = {}
    for group in WIRE_GROUPS:
        require(type(snapshot.get(group)) is dict, "missing_wire_group")
        for field in WIRE_FIELDS:
            result[group + "." + field] = counter(snapshot[group].get(field))
    for field in WIRE_FIELDS:
        require(result["sendAttempts." + field] == result["sendQueued." + field] + result["sendNotQueued." + field],
                "wire_attempt_accounting_mismatch")
    return result


def _lossless(snapshot):
    require(type(snapshot) is dict and snapshot.get("schema") == "YNX-MEMPOOL-LOSSLESS-HEX/v1",
            "missing_lossless_snapshot")
    require(snapshot.get("enabled") is True and snapshot.get("overflow") is False
            and snapshot.get("physicalBytesMeasured") is False, "lossless_disabled_or_overflow")
    result = {key: counter(snapshot.get(key)) for key in LOSSLESS_FIELDS}
    require(result["sendAttempts"] == result["sendQueued"] + result["sendNotQueued"],
            "lossless_attempt_accounting_mismatch")
    require(result["packEligible"] + result["packRejected"] <= result["packCalls"],
            "lossless_pack_accounting_mismatch")
    return result


def cumulative_delta(before, after, parser, meaning):
    try:
        a, b = parser(before), parser(after)
        require(a.keys() == b.keys(), "counter_set_changed")
        require(all(b[key] >= a[key] for key in a), "counter_reset_or_regression")
        return dict(status="OBSERVED", counters={key: str(b[key] - a[key]) for key in a},
                    unit="named original counter; byte fields are bytes", meaning=meaning,
                    startSHA256=digest(before), endSHA256=digest(after), delivered=None)
    except (AccountingError, KeyError, TypeError) as error:
        return unknown(str(error) if isinstance(error, AccountingError) else "invalid_snapshot", meaning=meaning)


def _labels(raw):
    """Parse the strict label subset used by original Prometheus counters."""
    labels, at = {}, 0
    while at < len(raw):
        match = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\\n]|\\[\\"n])*)"', raw[at:])
        require(match is not None, "invalid_metric_labels")
        key, encoded = match.groups()
        require(key not in labels, "duplicate_metric_label")
        labels[key] = re.sub(r"\\([\\\"n])", lambda m: "\n" if m[1] == "n" else m[1], encoded)
        at += match.end()
        if at < len(raw):
            require(raw[at] == ",", "invalid_metric_labels")
            at += 1
            require(at < len(raw), "invalid_metric_labels")
    return labels


def _prom_count(text):
    require(len(text) <= 64, "invalid_metric_counter")
    try:
        value = Decimal(text)
        require(value.is_finite() and value >= 0 and value == value.to_integral_value()
                and value <= PROM_EXACT_MAX, "inexact_or_invalid_prom_counter")
        return int(value)
    except InvalidOperation:
        raise AccountingError("invalid_metric_counter") from None


def parse_original_metrics(capture, *, binding, node, checkpoint):
    require(type(capture) is dict and capture.get("source") == "original-owned-node-prometheus",
            "original_proto_metrics_not_supplied")
    require(capture.get("pid") == node["pid"] and counter(capture.get("startTicks")) == counter(node["startTicks"]),
            "metrics_process_identity_changed")
    lo, hi = bounds(capture); outer_lo, outer_hi = bounds(checkpoint)
    require(outer_lo <= lo <= hi <= outer_hi, "metrics_outside_checkpoint")
    raw = capture.get("raw")
    require(type(raw) is str and len(raw.encode()) <= MAX_BYTES, "metrics_capture_bound")
    raw_hash = hashlib.sha256(raw.encode()).hexdigest()
    require(capture.get("sha256") == raw_hash, "metrics_capture_hash_mismatch")
    namespace = capture.get("namespace")
    require(type(namespace) is str and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", namespace),
            "invalid_metrics_namespace")
    names = {namespace + "_" + value: key for key, value in METRICS.items()}
    peers = {row["peerID"] for row in binding["nodes"] if row.get("peerID") is not None}
    peers.discard(node.get("peerID"))
    require(peers, "owned_peer_scope_not_supplied")
    channels = set(binding.get("channels", ["0x30", "0x31"]))
    # Separate views of the same original event. Never sum peer and message.
    result = {key: {} for key in METRICS}
    lines = raw.splitlines(); require(len(lines) <= MAX_METRIC_LINES, "metrics_line_bound")
    for line in lines:
        if not line or line.startswith("#"):
            continue
        prefix = re.match(r"([A-Za-z_:][A-Za-z0-9_:]*)", line)
        if prefix is None or prefix[1] not in names:
            continue
        match = re.fullmatch(r"([A-Za-z_:][A-Za-z0-9_:]*)\{(.*)\}\s+([^\s]+)(?:\s+[0-9]+)?", line)
        require(match is not None, "invalid_selected_metric_line")
        kind, labels = names[match[1]], _labels(match[2])
        if kind.startswith("peer"):
            if labels.get("peer_id") not in peers or labels.get("chID") not in channels:
                continue
            key = labels["peer_id"] + "/" + labels["chID"]
        else:
            if labels.get("message_type") not in ("mempool_Txs", "mempool_LosslessHexV1"):
                continue
            key = labels["message_type"]
        # Additional labels can distinguish different chains/instances. Their
        # exact set participates in identity; do not silently merge series.
        key += "/" + json.dumps(labels, sort_keys=True, separators=(",", ":"))
        require(key not in result[kind], "duplicate_selected_metric_series")
        result[kind][key] = _prom_count(match[3])
    return result, raw_hash, [str(lo), str(hi)]


def original_metrics_capture(*, node, namespace, raw, start_monotonic_ns, end_monotonic_ns):
    """Wrap bytes already read by the original supervisor; performs no I/O.

    The supervisor supplies its original owned-node identity and capture bounds,
    and records this raw capture with the run artifacts. The hash binds data,
    not authority or authenticity. account_layers applies scope validation.
    """
    require(type(raw) is str and len(raw.encode()) <= MAX_BYTES, "metrics_capture_bound")
    lo, hi = counter(start_monotonic_ns), counter(end_monotonic_ns)
    require(lo <= hi, "capture_time_reversed")
    return dict(source="original-owned-node-prometheus", pid=node["pid"],
                startTicks=str(counter(node["startTicks"])), namespace=namespace, raw=raw,
                sha256=hashlib.sha256(raw.encode()).hexdigest(),
                startMonotonicNs=str(lo), endMonotonicNs=str(hi))


def proto_delta(before, after, *, binding, node, start, end):
    meaning = "original peer send=serialized protobuf accepted by queue; receive=original received msgBytes; no delivery or fragmentation/crypto/physical overhead"
    try:
        a, ah, at = parse_original_metrics(before, binding=binding, node=node, checkpoint=start)
        b, bh, bt = parse_original_metrics(after, binding=binding, node=node, checkpoint=end)
        views = {}
        for kind in METRICS:
            if not a[kind] or not b[kind]:
                views[kind] = unknown("selected_metric_series_not_supplied")
            elif a[kind].keys() != b[kind].keys():
                views[kind] = unknown("metric_series_created_closed_or_labels_changed")
            elif any(b[kind][key] < a[kind][key] for key in a[kind]):
                views[kind] = unknown("metric_counter_reset_or_regression")
            else:
                values = {key: str(b[kind][key] - a[kind][key]) for key in a[kind]}
                total = sum(int(value) for value in values.values())
                require(total <= U64_MAX, "metric_sum_overflow")
                views[kind] = dict(status="OBSERVED", series=values, selectedBytes=str(total))
        return dict(status="OBSERVED" if all(v["status"] == "OBSERVED" for v in views.values()) else "INCOMPLETE",
                    views=views, startSHA256=ah, endSHA256=bh, startCaptureNs=at, endCaptureNs=bt,
                    unit="bytes", meaning=meaning, peerAndMessageViewsAdditive=False,
                    peerCoverage="explicit owned peer IDs and selected channels",
                    messageCoverage="mempool Txs and LosslessHexV1 types, across this node's peer set",
                    delivered=None)
    except (AccountingError, KeyError, TypeError) as error:
        return unknown(str(error) if isinstance(error, AccountingError) else "invalid_metrics_capture", meaning=meaning)


def validate_tcp_scope(snapshot, checkpoint, owned):
    require(type(snapshot) is dict and snapshot.get("schema") == "YNX-OWNED-TCP/1", "invalid_owned_tcp_schema")
    lo, hi = bounds(snapshot); outer_lo, outer_hi = bounds(checkpoint)
    require(outer_lo <= lo <= hi <= outer_hi, "tcp_outside_checkpoint")
    rows = snapshot.get("nodes")
    require(type(rows) is list and len(rows) == len(owned), "tcp_node_scope_changed")
    seen = set()
    for row in rows:
        require(type(row) is dict and row.get("name") in owned, "tcp_unowned_node")
        name = row["name"]; original = owned[name]
        require(name not in seen and row.get("pid") == original["pid"]
                and counter(row.get("startTicks")) == counter(original["startTicks"]), "tcp_process_identity_changed")
        require(row.get("p2pLocalEndpoints") == original.get("p2pLocalEndpoints"), "tcp_p2p_endpoint_binding_mismatch")
        seen.add(name)


def account_layers(*, binding, start, end):
    """Return data only. Qualified count/finality remain the owner's evidence."""
    originals = validate_binding(binding)
    owned = {node["name"]: node for node in originals}
    binding_hash = digest(binding)
    a = validate_checkpoint(start, binding_hash, owned)
    b = validate_checkpoint(end, binding_hash, owned)
    require(bounds(start)[1] <= bounds(end)[0], "overlapping_or_reversed_checkpoints")
    rows = []
    for name, node in owned.items():
        before, after = a.get(name), b.get(name)
        row = dict(name=name, pid=node["pid"], startTicks=str(counter(node["startTicks"])))
        if before is None or after is None:
            row.update(logical=unknown("node_checkpoint_missing"), attempted=unknown("node_checkpoint_missing"),
                       serializedProto=unknown("node_checkpoint_missing"))
        else:
            row["logical"] = cumulative_delta(before.get("wire"), after.get("wire"), _wire,
                "completed original-C sends/retries and reconstructed original-C protobuf sizes; CheckTx/inclusion/finality excluded")
            row["attempted"] = cumulative_delta(before.get("lossless"), after.get("lossless"), _lossless,
                "codec frame attempts include queue-false retries; queued is queue acceptance only; restored bytes are original-C")
            row["serializedProto"] = proto_delta(before.get("proto"), after.get("proto"),
                binding=binding, node=node, start=start, end=end)
        rows.append(row)
    tcp = unknown("owned_tcp_snapshots_not_supplied")
    if start.get("tcp") is not None and end.get("tcp") is not None:
        path = Path(__file__).with_name("owned-tcp-accounting.py")
        if path.is_file():
            try:
                validate_tcp_scope(start["tcp"], start, owned)
                validate_tcp_scope(end["tcp"], end, owned)
                spec = importlib.util.spec_from_file_location("original_owned_tcp_accounting", path)
                module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                tcp = module.diff_owned_tcp(start["tcp"], end["tcp"])
            except (ValueError, KeyError, TypeError) as error:
                tcp = unknown(str(error) if isinstance(error, AccountingError) else "invalid_owned_tcp_snapshots")
                # Keep original sampler first causes even when it could not
                # produce node identities for this outer binding validation.
                for side, sample in (("start", start["tcp"]), ("end", end["tcp"])):
                    if type(sample) is dict and type(sample.get("reasons")) is list:
                        tcp[side + "SamplerReasons"] = [reason for reason in sample["reasons"][:16]
                            if type(reason) is str and re.fullmatch(r"[A-Z0-9_]{1,128}", reason)]
    return dict(schema=SCHEMA, bindingSHA256=binding_hash, binding=binding,
                reportedQualifiedCountIsOwnerEvidence=True, independentFinalityVerified=None,
                startCaptureNs=[str(v) for v in bounds(start)], endCaptureNs=[str(v) for v in bounds(end)],
                captureIsAtomic=False, nodes=rows, tcp=tcp,
                physical=dict(status="UNMEASURED", bytes=None,
                              missing="TCP/IP headers, retransmission packet/header accounting, link framing and complete handshake/closed-connection coverage"),
                physicalBytesMeasured=False, delivered=None, gainsQualified=False,
                totalsAcrossLayersOrEndpointsAdditive=False)


def _read_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_BYTES, "input_file_bound")
        raw = os.read(fd, MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, "input_file_bound")
        after = os.fstat(fd)
        require((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "capture_file_changed_during_read")
        def pairs(items):
            result = {}
            for key, value in items:
                require(key not in result, "duplicate_json_key")
                result[key] = value
            return result
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(AccountingError("nonfinite_json")))
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", action="store_true", help="explicitly read only the supplied JSON captures")
    for name in ("binding", "start", "end", "output"):
        parser.add_argument("--" + name)
    args = parser.parse_args(argv)
    if not args.account:
        print(json.dumps(dict(schema=SCHEMA, status="prepared-only", samplesStarted=False)))
        return 0
    try:
        require(all((args.binding, args.start, args.end)), "capture_paths_required")
        result = account_layers(binding=_read_json(args.binding), start=_read_json(args.start), end=_read_json(args.end))
        encoded = json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n"
        require(len(encoded.encode()) <= MAX_BYTES, "accounting_output_bound")
        if args.output:
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            with os.fdopen(fd, "w") as out:
                out.write(encoded); out.flush(); os.fsync(out.fileno())
        else:
            print(encoded, end="")
        return 0
    except (AccountingError, OSError, json.JSONDecodeError, UnicodeError) as error:
        print(json.dumps(dict(schema=SCHEMA, status="UNKNOWN", reason=str(error) if isinstance(error, AccountingError) else "capture_read_or_write_failed")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
