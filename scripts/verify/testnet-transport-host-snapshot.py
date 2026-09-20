#!/usr/bin/env python3
"""Read-only Linux host observation; stdin-safe for `ssh ... python3 -`.

No packets, request bodies, remote client addresses, environment, keys or raw
log messages are retained. This never reloads/configures a service.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
import pathlib
import ipaddress
import re
import subprocess
import time
import urllib.request

COUNTERS = {"ListenOverflows", "ListenDrops", "TCPBacklogDrop", "TCPReqQFullDrop",
            "TCPReqQFullDoCookies", "SyncookiesSent", "TCPSynRetrans", "TCPTimeouts",
            "TCPMemoryPressures", "RetransSegs", "AttemptFails", "EstabResets"}
HOSTS = ("rpc.ynxweb4.com", "rpc-testnet.ynxweb4.com",
         "faucet.ynxweb4.com", "faucet-testnet.ynxweb4.com")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(args, timeout=3):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return {"exitCode": r.returncode, "output": r.stdout[:262144]}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"exitCode": None, "errorType": type(e).__name__, "output": ""}


def counters(text):
    lines = text.splitlines()
    result = {}
    for i in range(0, len(lines) - 1, 2):
        names, values = lines[i].split(), lines[i + 1].split()
        if names[0] == values[0]:
            result.update({k: int(v) for k, v in zip(names[1:], values[1:]) if k in COUNTERS})
    return result


def snapshot():
    out = {"observedAt": now(), "load": list(os.getloadavg())}
    for filename in ("netstat", "snmp"):
        try:
            out.setdefault("tcpCounters", {}).update(counters(pathlib.Path("/proc/net/" + filename).read_text()))
        except (OSError, ValueError) as e:
            out[filename + "Error"] = type(e).__name__
    listeners = run(["ss", "-H", "-lnt"])
    out["listenerReadExitCode"] = listeners["exitCode"]
    out["listeners"] = []
    for line in listeners["output"].splitlines():
        p = line.split()
        if len(p) >= 5 and p[3].rsplit(":", 1)[-1] in ("80", "443", "6420", "6428"):
            out["listeners"].append({"local": p[3], "recvQ": int(p[1]), "backlog": int(p[2])})
    connections = run(["ss", "-Hnt", "(", "sport", "=", ":443", ")"])
    out["socketReadExitCode"] = connections["exitCode"]
    out["port443States"] = dict(collections.Counter(line.split()[0] for line in connections["output"].splitlines() if line.split()))
    # Timestamps + host-wide deltas are correlation, not per-flow proof.
    return out


def journal_summary(unit=None):
    args = ["sudo", "-n", "journalctl", "--since", "2 minutes ago", "-n", "300", "--no-pager", "-o", "json"]
    args += ["-u", unit] if unit else ["-k"]
    r = run(args, 4)
    categories = collections.Counter()
    rows = 0
    for line in r["output"].splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        rows += 1
        message = str(entry.get("MESSAGE", "")).lower()
        for word in ("handshake", "timeout", "tls", "too many open files", "connection reset",
                     "refused", "syn flooding", "conntrack", "oom", "error"):
            if word in message:
                categories[word] += 1
    return {"exitCode": r["exitCode"], "entries": rows, "possiblyTruncated": rows >= 300,
            "categoryCounts": dict(categories), "rawMessagesRetained": False}


def config_summary(config):
    fields = ("listen", "read_timeout", "read_header_timeout", "write_timeout", "idle_timeout",
              "keepalive_interval", "max_header_bytes", "protocols")
    servers = {}
    for name, server in config.get("apps", {}).get("http", {}).get("servers", {}).items():
        item = {k: server[k] for k in fields if k in server}
        item["accessLoggingConfigured"] = "logs" in server
        item["tlsPolicies"] = [{k: p[k] for k in ("protocol_min", "protocol_max", "cipher_suites", "curves", "alpn") if k in p}
                               for p in server.get("tls_connection_policies", [])]
        servers[name] = item
    return {"servers": servers, "runtimeLogNames": sorted(config.get("logging", {}).get("logs", {})),
            "fullConfigRetained": False}


def firewall_summary(text):
    """Project nft list JSON; never export names, IPs, expressions or comments."""
    value = json.loads(text)
    result = {"available": True, "baseChains": [], "ruleCount": 0,
              "terminalRules": [], "rawRulesRetained": False, "cloudFirewallVisible": False}
    for item in value.get("nftables", []):
        chain = item.get("chain", {})
        if "hook" in chain:
            result["baseChains"].append({k: chain[k] for k in ("family", "hook", "policy")
                                         if chain.get(k) in ("ip", "ip6", "inet", "bridge", "netdev", "arp", "input", "output", "forward", "prerouting", "postrouting", "ingress", "egress", "accept", "drop")})
        rule = item.get("rule")
        if not rule:
            continue
        result["ruleCount"] += 1
        verdict, count, port443 = None, None, False
        for expression in rule.get("expr", []):
            for target in ("accept", "drop", "reject"):
                if target in expression:
                    verdict = target
            counter = expression.get("counter")
            if isinstance(counter, dict):
                count = {k: counter[k] for k in ("packets", "bytes") if isinstance(counter.get(k), int) and counter[k] >= 0}
            match = expression.get("match", {})
            payload = match.get("left", {}).get("payload", {}) if isinstance(match.get("left"), dict) else {}
            if payload.get("field") == "dport" and match.get("op") == "==" and match.get("right") == 443:
                port443 = True
        if verdict:
            result["terminalRules"].append({"verdict": verdict, "counter": count,
                                             "explicitSingleDport443Match": port443,
                                             "completeMatchSemanticsRetained": False})
    return result


def details():
    out = {"observedAt": now(), "cpuCount": os.cpu_count(), "kernel": os.uname().release}
    out["caddyVersion"] = run(["caddy", "version"])
    out["services"] = run(["systemctl", "show", "caddy", "ynx-chaind", "ynx-faucetd", "ynx-finance.service",
                           "-p", "Id", "-p", "ActiveState", "-p", "MainPID", "-p", "NRestarts", "-p", "LimitNOFILE", "-p", "MemoryCurrent"])
    out["sysctls"] = run(["sysctl", "net.core.somaxconn", "net.ipv4.tcp_max_syn_backlog",
                         "net.ipv4.tcp_syncookies", "net.ipv4.tcp_synack_retries", "net.ipv4.tcp_syn_retries", "net.ipv4.tcp_mtu_probing"])
    mem = pathlib.Path("/proc/meminfo").read_text().splitlines()
    out["memoryKB"] = {line.split(":")[0]: int(line.split()[1]) for line in mem if line.split(":")[0] in ("MemTotal", "MemAvailable", "SwapFree")}
    # Consume config locally; only allowlisted non-secret settings leave host.
    adapted = run(["sudo", "-n", "caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], 5)
    try:
        out["diskConfig"] = config_summary(json.loads(adapted["output"]))
    except ValueError:
        out["diskConfig"] = {"available": False, "exitCode": adapted["exitCode"]}
    try:
        # Direct loopback; never use an environment proxy for the admin read.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:2019/config/", timeout=2) as response:
            raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ValueError("oversize")
        out["loadedConfig"] = config_summary(json.loads(raw))
    except (OSError, ValueError) as e:
        out["loadedConfig"] = {"available": False, "errorType": type(e).__name__}
    out["caddyfileSHA256"] = run(["sudo", "-n", "sha256sum", "/etc/caddy/Caddyfile"])
    out["caddyJournal"] = journal_summary("caddy")
    out["kernelJournal"] = journal_summary()
    firewall = run(["sudo", "-n", "nft", "-j", "list", "ruleset"], 4)
    try:
        out["firewall"] = firewall_summary(firewall["output"]) if firewall["exitCode"] == 0 else {"available": False, "exitCode": firewall["exitCode"]}
    except (ValueError, TypeError, AttributeError):
        out["firewall"] = {"available": False, "reason": "unsupported or truncated nft JSON"}
    out["conntrack"] = {}
    for name in ("nf_conntrack_count", "nf_conntrack_max"):
        try:
            out["conntrack"][name] = int(pathlib.Path("/proc/sys/net/netfilter/" + name).read_text())
        except (OSError, ValueError):
            out["conntrack"][name] = None
    out["localProbes"] = []
    for host in HOSTS:
        path = "/health" if host.startswith("faucet") else "/status"
        args = ["curl", "--disable", "--silent", "--show-error", "--proto", "=https", "--noproxy", "*",
                "--connect-timeout", "2", "--max-time", "3", "--max-filesize", "1048576", "--output", "/dev/null",
                "--resolve", host + ":443:127.0.0.1", "--write-out", "%{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{ssl_verify_result}",
                "https://" + host + path]
        out["localProbes"].append({"host": host, "kind": "caddy-loopback-normal-TLS", **run(args, 4)})
    for port, path in ((6420, "/status"), (6428, "/health")):
        out["localProbes"].append({"port": port, "kind": "upstream-loopback-HTTP", **run([
            "curl", "--disable", "--silent", "--show-error", "--noproxy", "*", "--max-time", "3",
            "--max-filesize", "1048576", "--output", "/dev/null", "--write-out", "%{http_code} %{time_starttransfer} %{time_total}",
            "http://127.0.0.1:" + str(port) + path], 4)})
    return out


def packet_metadata(text, peer, ports=()):
    events = []
    for line in text.splitlines():
        m = re.search(r"(\d+\.\d+\.\d+\.\d+)\.(\d+) > (\d+\.\d+\.\d+\.\d+)\.(\d+):.*Flags \[([^]]*)\]", line)
        if not m:
            continue
        if "443" not in (m[2], m[4]):
            continue
        client_port = int(m[2] if m[4] == "443" else m[4])
        if (ports and client_port not in ports) or (not ports and peer not in (m[1], m[3])):
            continue
        from_client = m[4] == "443"
        seq = re.search(r"seq (\d+(?::\d+)?)", line)
        ack = re.search(r"ack (\d+)", line)
        events.append({"timestamp": line.split()[0], "direction": "from-client" if from_client else "to-client",
                       "clientPort": client_port, "flags": m[5],
                       "clientAddressSHA256": hashlib.sha256((m[1] if from_client else m[3]).encode()).hexdigest(),
                       "sequence": seq[1] if seq else None, "ack": ack[1] if ack else None,
                       "length": int(re.search(r"length (\d+)", line)[1]) if re.search(r"length (\d+)", line) else None})
    return events


def start_capture(ports=()):
    # SSH's peer is a candidate HTTPS egress identity, not assumed identical.
    peer = os.environ.get("SSH_CONNECTION", "").split(" ")[0]
    try:
        if not ports:
            ipaddress.IPv4Address(peer)
        capture_filter = "tcp port 443 and (" + " or ".join("port " + str(p) for p in ports) + ")" if ports else "host " + peer + " and tcp port 443"
        process = subprocess.Popen(["sudo", "-n", "timeout", "-s", "INT", "25", "tcpdump", "-i", "any",
                                    "-nn", "-tt", "-S", "-l", "-c", "120", "-s", "96",
                                    capture_filter], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return process, peer
    except (OSError, ValueError):
        return None, peer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--interval", type=int, default=2)
    parser.add_argument("--details", action="store_true")
    parser.add_argument("--packet-metadata", action="store_true")
    parser.add_argument("--probe-ports", default="")
    args = parser.parse_args()
    if not 1 <= args.samples <= 16 or not 1 <= args.interval <= 3:
        parser.error("bounded samples 1..16, interval 1..3 seconds required")
    ports = [int(p) for p in args.probe_ports.split(",")] if re.fullmatch(r"\d+(,\d+){0,3}", args.probe_ports) else []
    if args.probe_ports and (not ports or any(p < 20000 or p > 65000 for p in ports)):
        parser.error("one to four probe ports 20000..65000 required")
    out = {"schema": "ynx-transport-host-window/v1", "startedAt": now(), "readOnly": True, "samples": []}
    capture, peer = start_capture(ports) if args.packet_metadata else (None, None)
    print(json.dumps({"type": "host-ready", "observedAt": now(), "packetMetadataRequested": args.packet_metadata}), flush=True)
    for n in range(args.samples):
        out["samples"].append(snapshot())
        if n + 1 < args.samples:
            time.sleep(args.interval)
    if args.packet_metadata:
        result = {"available": False, "payloadRetained": False, "rawPacketTextRetained": False,
                  "scope": "TCP443 metadata for planned client source ports" if ports else "TCP443 metadata for SSH peer only; HTTPS egress may differ",
                  "plannedClientPorts": ports, "natPortPreservationUnproven": True,
                  "sshPeerAddressSHA256": hashlib.sha256(peer.encode()).hexdigest()}
        if capture:
            try:
                output, errors = capture.communicate(timeout=8)
                result.update({"available": "listening on" in errors, "exitCode": capture.returncode,
                               "boundedTimeout": capture.returncode == 124, "events": packet_metadata(output, peer, ports),
                               "packetLimitReached": capture.returncode == 0})
            except subprocess.TimeoutExpired:
                capture.kill()
                capture.communicate()
                result["error"] = "collector deadline exceeded"
        out["packetMetadata"] = result
    if args.details:
        out["details"] = details()
    out["finishedAt"] = now()
    print(json.dumps(out))


if __name__ == "__main__":
    main()
