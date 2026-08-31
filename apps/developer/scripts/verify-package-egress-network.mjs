#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const PACKAGE_EGRESS_POLICY = Object.freeze({
  version: "ynx-code-package-egress/v1",
  network: "ynx-pkg-egress",
  acl: "ynx-code-package-egress-acl",
  address: "10.251.0.1/24",
  description: "YNX Code temporary reviewed package egress",
  aclDescription: "YNX Code package DNS and HTTPS only; private destinations denied",
});

const PRIVATE_IPV4 = "10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,224.0.0.0/4";
const PRIVATE_IPV6 = "::1/128,fc00::/7,fe80::/10,ff00::/8";

const EXPECTED_EGRESS = [
  { action: "drop", description: "Block private and special IPv4 destinations", destination: PRIVATE_IPV4, state: "enabled" },
  { action: "drop", description: "Block private and special IPv6 destinations", destination: PRIVATE_IPV6, state: "enabled" },
  { action: "allow", description: "Allow package registry HTTPS", protocol: "tcp", destination_port: "443", state: "enabled" },
  { action: "allow", description: "Allow DNS queries", protocol: "udp", destination_port: "53", state: "enabled" },
  { action: "allow", description: "Allow DNS queries over TCP", protocol: "tcp", destination_port: "53", state: "enabled" },
];

function fail(message) {
  throw Object.assign(new Error(message), { code: "package_egress_policy_mismatch" });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function exactRules(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) fail(`${label} must contain exactly ${expected.length} reviewed rules.`);
  const left = actual.map(canonical).sort(), right = expected.map(canonical).sort();
  if (left.some((value, index) => value !== right[index])) fail(`${label} differs from the reviewed rule set.`);
}

export function verifyPackageEgressNetwork(networkValue, aclValue) {
  const network = object(networkValue, "LXD network"), acl = object(aclValue, "LXD network ACL"), config = object(network.config, "LXD network config");
  if (network.name !== PACKAGE_EGRESS_POLICY.network || network.type !== "bridge" || network.managed !== true || network.status !== "Created")
    fail("The reviewed package-egress network must be the dedicated managed bridge in Created state.");
  if (network.description !== PACKAGE_EGRESS_POLICY.description || config["user.ynx-code-policy"] !== PACKAGE_EGRESS_POLICY.version)
    fail("The package-egress network is missing its reviewed identity metadata.");
  if (config["ipv4.address"] !== PACKAGE_EGRESS_POLICY.address || config["ipv4.nat"] !== "true" || config["ipv6.address"] !== "none")
    fail("The package-egress bridge address/NAT boundary differs from review.");
  if (config["security.acls"] !== PACKAGE_EGRESS_POLICY.acl || config["security.acls.default.ingress.action"] !== "reject" || config["security.acls.default.egress.action"] !== "reject")
    fail("The package-egress bridge must attach only the reviewed ACL with default reject.");
  if (config["ipv4.firewall"] === "false" || config["ipv6.firewall"] === "false" || config["ipv6.nat"] === "true" || Object.keys(config).some((key) => key.startsWith("raw.") || key === "bridge.external_interfaces"))
    fail("The package-egress bridge contains a firewall bypass or external bridge attachment.");
  if (!Array.isArray(network.used_by) || network.used_by.some((value) => typeof value !== "string" || value.includes("/profiles/") || !/^\/1\.0\/instances\/ynx-[a-f0-9]{10}-[a-f0-9]{24}$/.test(value)))
    fail("The package-egress bridge is attached outside an owner-bound YNX runtime lease.");
  if (acl.name !== PACKAGE_EGRESS_POLICY.acl || acl.description !== PACKAGE_EGRESS_POLICY.aclDescription || object(acl.config, "LXD ACL config")["user.ynx-code-policy"] !== PACKAGE_EGRESS_POLICY.version)
    fail("The package-egress ACL is missing its reviewed identity metadata.");
  exactRules(acl.ingress, [], "ACL ingress");
  exactRules(acl.egress, EXPECTED_EGRESS, "ACL egress");
  return {
    ok: true,
    policy: PACKAGE_EGRESS_POLICY.version,
    network: network.name,
    acl: acl.name,
    ipv4: config["ipv4.address"],
    nat: true,
    ipv6: false,
    defaultIngress: "reject",
    defaultEgress: "reject",
    allowedEgress: ["DNS udp/53", "DNS tcp/53", "HTTPS tcp/443"],
    privateDestinationsDenied: true,
    attachedRuntimeLeases: network.used_by.length,
  };
}

async function main(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  if (values.size !== 2 || !values.get("--network") || !values.get("--acl")) throw new Error("Usage: verify-package-egress-network.mjs --network <network.json> --acl <acl.json>");
  const [network, acl] = await Promise.all([values.get("--network"), values.get("--acl")].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  process.stdout.write(`${JSON.stringify(verifyPackageEgressNetwork(network, acl), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
