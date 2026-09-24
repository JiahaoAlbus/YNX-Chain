import assert from "node:assert/strict";
import test from "node:test";
import { createWalletProviderDiscovery } from "../src/index.js";

class Scope extends EventTarget { constructor() { super(); this.Event = Event; } }
const uuid = "12345678-1234-4123-8123-123456789abc";
function announce(scope, provider, info = {}) { scope.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { provider, info: { uuid, rdns: "io.metamask", name: "MetaMask", icon: "data:image/svg+xml,x", ...info } } })); }

test("continuous discovery receives late announcements, deduplicates and cleans up", () => {
  const scope = new Scope(), provider = { request() {}, isMetaMask: true }, revisions = [];
  let requests = 0; scope.addEventListener("eip6963:requestProvider", () => requests++);
  const discovery = createWalletProviderDiscovery(scope), unsubscribe = discovery.subscribe((value) => revisions.push(value));
  assert.equal(requests, 1); assert.equal(discovery.snapshot().metamask, null);
  announce(scope, provider); announce(scope, provider);
  assert.equal(discovery.snapshot().metamask.provider, provider); assert.equal(revisions.length, 2);
  unsubscribe(); discovery.dispose(); announce(scope, { request() {}, isMetaMask: true });
  assert.equal(discovery.disposed, true); assert.equal(discovery.snapshot().metamask, null);
  assert.throws(() => discovery.request(), /disposed/);
});

test("a UUID rebound to another provider is permanently conflicted", () => {
  const scope = new Scope(), first = { request() {}, isMetaMask: true }, second = { request() {}, isMetaMask: true };
  const discovery = createWalletProviderDiscovery(scope);
  announce(scope, first); announce(scope, second);
  const result = discovery.snapshot();
  assert.equal(result.metamask, null); assert.equal(result.conflictedAnnouncements, 1);
  discovery.dispose();
});
