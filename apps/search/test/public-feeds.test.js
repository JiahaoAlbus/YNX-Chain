import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTITY_REGISTRY } from "../src/entities.js";
import { assertPublicFeedSafety, buildPublicFeeds } from "../src/public-feeds.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(appRoot, "../..");
const metadata = JSON.parse(await readFile(resolve(repositoryRoot, "release/search/public-product-metadata.json"), "utf8"));
const release = JSON.parse(await readFile(resolve(appRoot, "product-release.json"), "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");

test("public Search feeds are deterministic, safe, truthful and hash-addressed", () => {
  const first = buildPublicFeeds({ metadata, release, entityRegistry: ENTITY_REGISTRY });
  const second = buildPublicFeeds({ metadata, release, entityRegistry: ENTITY_REGISTRY });
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), [
    "public-documents.json",
    "public-entities.json",
    "public-faq.json",
    "public-feed-manifest.json",
    "public-products.json",
    "public-releases.json",
    "public-search-index.json",
  ]);
  assert.doesNotThrow(() => assertPublicFeedSafety(first));

  const documents = JSON.parse(first["public-documents.json"]);
  assert.equal(documents.items.length, 0);
  assert.match(documents.coverage, /no approved public document inventory/i);

  const entities = JSON.parse(first["public-entities.json"]);
  const ynx = entities.items.find(item => item.id === "ynx-chain");
  assert.equal(ynx.canonicalName, "YNX Chain");
  assert.ok(ynx.aliases.includes("ynx"));
  assert.equal(ynx.registryEffectiveAt, "2026-07-27");

  const products = JSON.parse(first["public-products.json"]);
  const search = products.items.find(item => item.name === "YNX Search");
  assert.equal(search.publicationStatus, metadata.status);
  assert.equal(search.routeVerified, false);

  const publicRelease = JSON.parse(first["public-releases.json"]).items[0];
  assert.equal(publicRelease.deployedPublic, false);
  assert.equal(publicRelease.downloadHosted, false);
  assert.equal(publicRelease.productionSigned, false);

  const index = JSON.parse(first["public-search-index.json"]);
  assert.match(index.coverage, /not the live Search corpus/);
  assert.ok(index.items.some(item => item.title === "YNX Chain"));
  assert.ok(index.items.some(item => item.title === "YNX Search"));

  const manifest = JSON.parse(first["public-feed-manifest.json"]);
  assert.equal(manifest.files.length, 6);
  for (const entry of manifest.files) {
    assert.equal(entry.sha256, sha256(first[entry.name]));
    assert.equal(entry.bytes, Buffer.byteLength(first[entry.name]));
  }
});

test("public feed safety rejects internal engineering metadata", () => {
  assert.throws(() => assertPublicFeedSafety({ "bad.json": JSON.stringify({ path: "/Users/example/YNX Final Worktrees/23-search" }) }), /forbidden public marker/);
  assert.throws(() => assertPublicFeedSafety({ "bad.json": JSON.stringify({ branch: "codex/final-search" }) }), /forbidden public marker/);
});
