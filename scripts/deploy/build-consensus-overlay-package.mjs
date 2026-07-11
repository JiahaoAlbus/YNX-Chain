#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const expectedAddress = { primary: "10.77.42.1", singapore: "10.77.42.2", "silicon-valley": "10.77.42.3", seoul: "10.77.42.4" };

function hash(payload) { return crypto.createHash("sha256").update(payload).digest("hex"); }
function write(file, payload, mode) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, payload, { mode }); fs.chmodSync(file, mode); }
function isPublicIPv4(value) {
  if (net.isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a !== 224 && a !== 255 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168);
}

function loadRecords(root) {
  const records = roles.map((role) => JSON.parse(fs.readFileSync(path.join(root, `${role}.json`), "utf8")));
  const keys = new Set(), endpoints = new Set(), addresses = new Set();
  for (const record of records) {
    if (record.version !== 1 || record.purpose !== "ynx-consensus-private-overlay-public-keys-only" || record.role !== roles.find((role) => role === record.role) || record.overlayAddress !== expectedAddress[record.role] || !isPublicIPv4(record.publicEndpoint) || !Number.isInteger(record.listenPort) || record.listenPort < 1024 || record.listenPort > 65535 || !/^[A-Za-z0-9+/]{43}=$/.test(record.wireGuardPublicKey) || record.custodyBoundary !== "owner-controlled-host-local") {
      throw new Error(`invalid overlay public record for ${record.role || "unknown"}`);
    }
    const decoded = Buffer.from(record.wireGuardPublicKey, "base64");
    if (decoded.length !== 32) throw new Error(`invalid overlay public key length for ${record.role}`);
    if (keys.has(record.wireGuardPublicKey) || endpoints.has(`${record.publicEndpoint}:${record.listenPort}`) || addresses.has(record.overlayAddress)) throw new Error("overlay records must use unique keys, endpoints, and addresses");
    keys.add(record.wireGuardPublicKey); endpoints.add(`${record.publicEndpoint}:${record.listenPort}`); addresses.add(record.overlayAddress);
  }
  return records;
}

function generate(recordsRoot, output) {
  if (fs.existsSync(output)) throw new Error(`overlay package output already exists: ${output}`);
  const records = loadRecords(recordsRoot);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  const files = {};
  for (const node of records) {
    const roleRoot = path.join(output, "roles", node.role);
    const keyPath = `/etc/ynx/consensus-candidate/${node.role}/wireguard.key`;
    const peerCommands = records.filter((peer) => peer.role !== node.role).map((peer) =>
      `wg set ynxwg0 peer ${peer.wireGuardPublicKey} endpoint ${peer.publicEndpoint}:${peer.listenPort} allowed-ips ${peer.overlayAddress}/32 persistent-keepalive 25\nip route replace ${peer.overlayAddress}/32 dev ynxwg0`
    ).join("\n");
    const up = `#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -s '${keyPath}'
test "$(stat -c %a '${keyPath}')" = 600
if ip link show ynxwg0 >/dev/null 2>&1; then ip link delete ynxwg0; fi
ip link add ynxwg0 type wireguard
cleanup() { ip link delete ynxwg0 2>/dev/null || true; }
trap cleanup ERR
ip address add ${node.overlayAddress}/32 dev ynxwg0
ip link set mtu 1420 dev ynxwg0
wg set ynxwg0 listen-port ${node.listenPort} private-key '${keyPath}'
ip link set up dev ynxwg0
${peerCommands}
trap - ERR
`;
    const service = `[Unit]
Description=YNX Chain private consensus overlay (${node.role})
After=network-online.target
Wants=network-online.target
Before=ynx-consensus-comet-candidate.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/ynx-consensus-overlay-up
ExecStop=/usr/sbin/ip link delete ynxwg0

[Install]
WantedBy=multi-user.target
`;
    const roleManifest = `${JSON.stringify({ version: 1, purpose: "ynx-consensus-private-overlay", node, peers: records.filter((peer) => peer.role !== node.role) }, null, 2)}\n`;
    const artifacts = { "ynx-consensus-overlay-up": [up, 0o755], "ynx-consensus-overlay.service": [service, 0o644], "role-manifest.json": [roleManifest, 0o600] };
    for (const [name, [payload, mode]] of Object.entries(artifacts)) {
      const file = path.join(roleRoot, name); write(file, payload, mode); files[path.relative(output, file)] = hash(payload);
    }
  }
  const manifest = { version: 1, purpose: "ynx-consensus-private-overlay", interface: "ynxwg0", cidr: "10.77.42.0/24", roles, files };
  write(path.join(output, "package-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  return manifest;
}

const [recordsRoot, output] = process.argv.slice(2);
if (!recordsRoot || !output) throw new Error("usage: build-consensus-overlay-package.mjs <public-records-dir> <new-output-dir>");
const result = generate(recordsRoot, output);
console.log(`consensus overlay package ready: roles=${result.roles.length} interface=${result.interface} output=${output}`);
