import assert from "node:assert/strict";
import test from "node:test";
import { PACKAGE_EGRESS_POLICY, verifyPackageEgressNetwork } from "../scripts/verify-package-egress-network.mjs";

const egress = [
  { action: "drop", description: "Block private and special IPv4 destinations", destination: "10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,224.0.0.0/4", state: "enabled" },
  { action: "drop", description: "Block private and special IPv6 destinations", destination: "::1/128,fc00::/7,fe80::/10,ff00::/8", state: "enabled" },
  { action: "allow", description: "Allow package registry HTTPS", protocol: "tcp", destination_port: "443", state: "enabled" },
  { action: "allow", description: "Allow DNS queries", protocol: "udp", destination_port: "53", state: "enabled" },
  { action: "allow", description: "Allow DNS queries over TCP", protocol: "tcp", destination_port: "53", state: "enabled" },
];

const fixture = () => ({
  network: {
    name: PACKAGE_EGRESS_POLICY.network,
    description: PACKAGE_EGRESS_POLICY.description,
    type: "bridge",
    managed: true,
    status: "Created",
    config: {
      "ipv4.address": PACKAGE_EGRESS_POLICY.address,
      "ipv4.nat": "true",
      "ipv6.address": "none",
      "security.acls": PACKAGE_EGRESS_POLICY.acl,
      "security.acls.default.ingress.action": "reject",
      "security.acls.default.egress.action": "reject",
      "user.ynx-code-policy": PACKAGE_EGRESS_POLICY.version,
      "volatile.bridge.hwaddr": "00:16:3e:00:00:01",
    },
    used_by: [],
  },
  acl: {
    name: PACKAGE_EGRESS_POLICY.acl,
    description: PACKAGE_EGRESS_POLICY.aclDescription,
    config: { "user.ynx-code-policy": PACKAGE_EGRESS_POLICY.version },
    ingress: [],
    egress,
  },
});

test("reviewed package-egress network is dedicated, default-deny and DNS/HTTPS-only", () => {
  const { network, acl } = fixture(), result = verifyPackageEgressNetwork(network, acl);
  assert.equal(result.ok, true);
  assert.equal(result.privateDestinationsDenied, true);
  assert.deepEqual(result.allowedEgress, ["DNS udp/53", "DNS tcp/53", "HTTPS tcp/443"]);
});

test("package-egress verification rejects broad egress, profile attachment and firewall bypass", () => {
  for (const mutate of [
    ({ acl }) => acl.egress.push({ action: "allow", protocol: "tcp", destination_port: "80", state: "enabled" }),
    ({ network }) => network.used_by.push("/1.0/profiles/default"),
    ({ network }) => { network.config["security.acls.default.egress.action"] = "allow"; },
    ({ network }) => { network.config["ipv4.firewall"] = "false"; },
    ({ network }) => { network.config["bridge.external_interfaces"] = "eth0"; },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => verifyPackageEgressNetwork(value.network, value.acl), (error) => error.code === "package_egress_policy_mismatch");
  }
});
