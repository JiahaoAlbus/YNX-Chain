import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeSbom, serializeCanonicalSbom } from "./sbom-canonical.mjs";

const node22Fixture = {
  metadata: {
    timestamp: "2026-08-14T12:00:00Z",
    tools: { components: [{ name: "npm", type: "application", version: "11.5.1" }, { name: "cyclonedx-npm", group: "@cyclonedx", version: "6.0.0", type: "application" }] },
  },
  components: [{ name: "b", "bom-ref": "b" }, { "bom-ref": "a", name: "a" }],
  dependencies: [{ dependsOn: ["b", "a"], ref: "root" }, { ref: "a" }],
};

const node24Fixture = {
  dependencies: [{ ref: "a" }, { ref: "root", dependsOn: ["a", "b"] }],
  components: [{ name: "a", "bom-ref": "a" }, { "bom-ref": "b", name: "b" }],
  metadata: {
    tools: { components: [{ type: "application", version: "6.0.0", group: "@cyclonedx", name: "cyclonedx-npm" }, { version: "11.17.0", name: "npm", type: "application" }] },
    timestamp: "2026-08-14T12:05:00Z",
  },
};

test("Node 22 and Node 24 SBOM fixtures normalize to exact UTF-8 LF bytes", () => {
  const options = { npmVersion: "11.5.1" };
  const node22 = serializeCanonicalSbom(canonicalizeSbom(node22Fixture, options));
  const node24 = serializeCanonicalSbom(canonicalizeSbom(node24Fixture, options));
  assert.deepEqual(node22, node24);
  assert.equal(node22.includes(13), false);
  assert.equal(node22.at(-1), 10);
  assert.match(node22.toString("utf8"), /"version": "11\.5\.1"/);
  assert.doesNotMatch(node22.toString("utf8"), /timestamp|11\.17\.0/);
});
