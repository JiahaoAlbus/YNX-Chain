import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeSbom, createNormalizedLockView, serializeCanonicalSbom } from "./sbom-canonical.mjs";

const node22Fixture = {
  metadata: {
    timestamp: "2026-08-14T12:00:00Z",
    tools: { components: [{ name: "npm", type: "application", version: "11.5.1" }, { name: "cyclonedx-npm", group: "@cyclonedx", version: "6.0.0", type: "application" }] },
  },
  components: [{ name: "b", "bom-ref": "b", properties: [{ name: "cdx:npm:package:path", value: "node_modules/b" }] }, { "bom-ref": "a", name: "a" }, { name: "lightningcss-darwin-arm64", version: "1.32.0", "bom-ref": "darwin" }],
  dependencies: [{ dependsOn: ["darwin", "b", "a"], ref: "root" }, { ref: "darwin" }, { ref: "a" }],
};

const node24Fixture = {
  dependencies: [{ ref: "a" }, { ref: "root", dependsOn: ["a", "b"] }],
  components: [{ name: "lightningcss-linux-x64-gnu", version: "1.32.0", "bom-ref": "linux" }, { name: "a", "bom-ref": "a" }, { properties: [{ value: "/home/runner/node_modules/b", name: "cdx:npm:package:path" }], "bom-ref": "b", name: "b" }],
  metadata: {
    tools: { components: [{ type: "application", version: "6.0.0", group: "@cyclonedx", name: "cyclonedx-npm" }, { version: "11.17.0", name: "npm", type: "application" }] },
    timestamp: "2026-08-14T12:05:00Z",
  },
};

test("Linux Node 22 and macOS Node 24 SBOM fixtures normalize to exact UTF-8 LF bytes", () => {
  const options = {
    npmVersion: "11.5.1",
    platformSpecificPackages: new Set([
      "lightningcss-darwin-arm64@1.32.0",
      "lightningcss-linux-x64-gnu@1.32.0",
    ]),
  };
  const node22 = serializeCanonicalSbom(canonicalizeSbom(node22Fixture, options));
  const node24 = serializeCanonicalSbom(canonicalizeSbom(node24Fixture, options));
  assert.deepEqual(node22, node24);
  assert.equal(node22.includes(13), false);
  assert.equal(node22.at(-1), 10);
  assert.match(node22.toString("utf8"), /"version": "11\.5\.1"/);
  assert.doesNotMatch(node22.toString("utf8"), /timestamp|11\.17\.0/);
});

test("local package lock view is repeatable and never mutates its source documents", () => {
  const manifest = { name: "app", version: "1.0.1", private: true, license: "UNLICENSED", packageManager: "npm@11.5.1", dependencies: { local: "file:../local", stable: "2.0.0" }, scripts: { unsafe: "ignored" } };
  const lock = { lockfileVersion: 3, packages: { "": { dependencies: { local: "file:../local", stable: "2.0.0" } }, "../local": { name: "local", version: "1.0.0", dependencies: { stable: "2.0.0" } }, "node_modules/local": { resolved: "../local", link: true }, "node_modules/stable": { version: "2.0.0" } } };
  const before = JSON.stringify({ manifest, lock });
  const options = { localPackageName: "local", localPackagePath: "../local" };
  const first = createNormalizedLockView(manifest, lock, options);
  const second = createNormalizedLockView(manifest, lock, options);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ manifest, lock }), before);
  assert.equal(first.manifest.scripts, undefined);
  assert.equal(first.manifest.dependencies.local, "1.0.0");
  assert.equal(first.lock.packages["../local"], undefined);
  assert.deepEqual(first.lock.packages["node_modules/local"], { dependencies: { stable: "2.0.0" }, name: "local", version: "1.0.0" });
});
