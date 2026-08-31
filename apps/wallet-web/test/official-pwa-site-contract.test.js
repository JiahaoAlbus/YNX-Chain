import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  bindWalletManifest,
  WALLET_MANIFEST_HREF,
  WALLET_ROUTE,
} from "../../../release/integration/wallet-web-pwa-site/wallet-manifest-binding.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const publicDir = join(repoRoot, "apps/wallet-web/public");
const frozenPath = join(repoRoot, "release/integration/wallet-web-pwa-site/frozen-wallet-manifest.webmanifest");
const hash = body => createHash("sha256").update(body).digest("hex");

function fakeDocument(initialHref = "/manifest.webmanifest") {
  const attributes = new Map([["rel", "manifest"], ["href", initialHref]]);
  const link = {
    removed: false,
    getAttribute: key => attributes.has(key) ? attributes.get(key) : null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
    remove() { this.removed = true; },
  };
  return {link, head: {append(node) { this.appended = node; }}, querySelector: () => link, createElement: () => link};
}

test("Wallet route binds the frozen manifest and cleanup restores the site identity", () => {
  const documentLike = fakeDocument();
  const binding = bindWalletManifest(documentLike, WALLET_ROUTE);
  assert.equal(binding.bound, true);
  assert.equal(documentLike.link.getAttribute("href"), WALLET_MANIFEST_HREF);
  binding.cleanup();
  binding.cleanup();
  assert.equal(documentLike.link.getAttribute("href"), "/manifest.webmanifest");
});

test("non-Wallet routes never mutate the site manifest", () => {
  const documentLike = fakeDocument();
  const binding = bindWalletManifest(documentLike, "/");
  assert.equal(binding.bound, false);
  assert.equal(documentLike.link.getAttribute("href"), "/manifest.webmanifest");
});

test("Website handoff manifest is exactly the built Wallet manifest with frozen icon identities", async () => {
  const local = JSON.parse(await readFile(join(publicDir, "manifest.webmanifest"), "utf8"));
  const frozen = JSON.parse(await readFile(frozenPath, "utf8"));
  assert.deepEqual(frozen, local);
  assert.deepEqual(
    {name: frozen.name, id: frozen.id, start_url: frozen.start_url, scope: frozen.scope},
    {name: "YNX Wallet Testnet Companion", id: "/wallet/companion", start_url: "./", scope: "./"},
  );
  const expected = new Map([
    ["ynx-icon-192.png", [9838, "02bd7b202a6683d83bbe4b17c246afc969b43284ee945e97167d9606e6df04af"]],
    ["ynx-icon-512.png", [45914, "5a6fb80c48a2047ad5632cf0b69f410ebaefd8aff0bb3da7dce28c1ce8c992c7"]],
    ["ynx-icon-maskable-512.png", [45914, "5a6fb80c48a2047ad5632cf0b69f410ebaefd8aff0bb3da7dce28c1ce8c992c7"]],
  ]);
  for (const icon of frozen.icons) {
    const body = await readFile(join(publicDir, icon.src));
    assert.deepEqual([body.length, hash(body)], expected.get(icon.src.slice(2)));
  }
});
