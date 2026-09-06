import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";

const source = (await readFile(new URL("app.js", import.meta.url), "utf8"))
  .replace(/^import\b[\s\S]*?from\s*["'][^"']+["'];?\n/gm, "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const connected = account => ({ status: "connected", session: { account } });
const privateSnapshot = marker => ({
  analytics: { views: 7, watch_seconds: 12, subscribers: 3, revenue_ynxt: 5 },
  videos: [{ id: marker, title: marker, status: "ready", visibility: "private" }],
  team: [{ channel_id: marker, members: [{ account: marker, role: "owner" }] }],
  rights: [{ video_id: marker, state: "declared" }],
  revenue: [{ id: marker, amount_ynxt: 5 }], payout_intents: [{ id: marker }],
  reports: [{ id: marker }], appeals: [{ id: marker }], disputes: [{ id: marker }],
});
const privateLists = ["videos", "team-list", "rights-list", "revenue-list", "payout-list", "report-list", "appeal-list", "dispute-list"];

class Element {
  constructor() {
    this.textContent = ""; this.innerHTML = ""; this.style = {}; this.hidden = false; this.disabled = false;
    this.listeners = new Map(); this.children = []; this.value = ""; this.checked = false; this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.elements = Object.fromEntries(["channel_id", "video_id", "source_sha256"].map(name => [name, { value: "" }]));
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  replaceChildren() { this.children = []; this.innerHTML = ""; this.textContent = ""; }
  append(child) { this.children.push(child); }
  querySelector() { return new Element(); }
  reset() { for (const field of Object.values(this.elements)) field.value = ""; }
  focus() { this.focused = true; }
}

async function app(overrides = {}) {
  const nodes = new Map();
  const element = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const forms = [element("#channel-form"), element("#upload-form"), element("#rights-form")];
  const document = {
    querySelector: element, querySelectorAll: selector => selector === ".panel form" ? forms : [],
    getElementById: id => element(`#${id}`), createElement: () => new Element(),
  };
  const dependencies = {
    document, localStorage: { getItem: () => null }, location: { origin: "https://creator.ynxweb4.com", assign() {} },
    crypto: { randomUUID, subtle: webcrypto.subtle }, TextDecoder, Uint8Array, FormData,
    atRegisteredOrigin: () => true, prepareProductSignIn: async () => ({ url: "test:creator-signin" }),
    restoreProductSession: async () => ({ status: "disconnected", message: "Sign in" }),
    disconnectProductSession: async () => ({ status: "disconnected" }), productAuthorization: async () => ({}),
    fetch: async () => { throw new Error("Unexpected fetch"); },
    createStandardWalletConnectState: () => ({}), reduceStandardWalletConnectState: state => state,
    discoverWalletProviders: async () => ({}), i18nReady: Promise.resolve(), t: key => key,
    confirm: () => false, prompt: () => null, ...overrides,
  };
  // Execute the shipped controller and its actual registered handlers; only module dependencies and DOM/network are fixtures.
  const controller = await new AsyncFunction(...Object.keys(dependencies), `${source}\nreturn {refresh,restoreCreator,renderProductState,showAI,providerStatus,api,readState:()=>({snapshot,currentAI,creatorAccount})};`)(...Object.values(dependencies));
  return { ...controller, element, forms, click: id => element(`#${id}`).listeners.get("click")(), run: id => element(`#${id}`).onclick() };
}

function assertCleared(controller, marker) {
  assert.equal(controller.readState().snapshot, null);
  assert.equal(controller.readState().currentAI, null);
  assert.equal(controller.readState().creatorAccount, null);
  for (const id of privateLists) {
    const node = controller.element(`#${id}`);
    assert.doesNotMatch(node.innerHTML, new RegExp(marker));
    assert.equal(node.children.length, 0);
  }
  for (const id of ["views", "watch", "subs", "revenue"]) assert.equal(controller.element(`#${id}`).textContent, "—");
  assert.equal(controller.element("#channel-result").textContent, "No channel loaded.");
  assert.equal(controller.element("#ai-result").textContent, "No AI request prepared.");
  for (const id of ["ai-run", "ai-cancel", "ai-accept", "ai-reject", "ai-delete"]) assert.equal(controller.element(`#${id}`).disabled, true);
}

test("sign out immediately clears every private view and form while revocation is pending", async () => {
  const revoke = deferred();
  const controller = await app({ fetch: async () => response(privateSnapshot("private-owner-a")), disconnectProductSession: () => revoke.promise });
  controller.renderProductState(connected("owner-a"));
  assert.equal(await controller.refresh(), true);
  controller.showAI({ id: "private-owner-a", context: "private context", state: "review_required" });
  controller.element("#channel-result").textContent = "private-owner-a";
  for (const form of controller.forms) form.elements.channel_id.value = "private-owner-a";
  controller.element("#product-open").href = "test:old-pending-return";
  const signingOut = controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
  for (const form of controller.forms) assert.equal(form.elements.channel_id.value, "");
  assert.equal(controller.element("#product-open").hidden, true);
  assert.equal(controller.element("#product-open").href, undefined);
  revoke.resolve({ status: "disconnected" });
  await signingOut;
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
  assert.equal(controller.element("#product-status").textContent, "Sign in to manage your channel.");
  assert.equal(controller.element("#product-disconnect").disabled, false);
});

test("a 401 with no studio snapshot still permits complete sign out", async () => {
  const controller = await app({ fetch: async () => response({ error: "Session expired" }, 401) });
  controller.renderProductState(connected("owner-a"));
  assert.equal(await controller.refresh(), false);
  assert.equal(controller.element("#status").textContent, "Session expired");
  await controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
});

test("a studio response arriving after sign out cannot restore account data or replace its status", async () => {
  const request = deferred();
  let calls = 0;
  const controller = await app({ fetch: () => { calls++; return request.promise; } });
  controller.renderProductState(connected("owner-a"));
  const refresh = controller.refresh();
  await turn();
  assert.equal(calls, 1);
  await controller.click("product-disconnect");
  request.resolve(response(privateSnapshot("private-owner-a")));
  assert.equal(await refresh, false);
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
  assert.equal(await controller.refresh(), false);
  assert.equal(calls, 1);
});

test("an old account response cannot overwrite a newly signed-in account", async () => {
  const oldRequest = deferred();
  let calls = 0;
  const controller = await app({ fetch: () => ++calls === 1 ? oldRequest.promise : Promise.resolve(response(privateSnapshot("private-owner-b"))) });
  controller.renderProductState(connected("owner-a"));
  const oldRefresh = controller.refresh();
  await turn();
  await controller.click("product-disconnect");
  controller.renderProductState(connected("owner-b"));
  assert.equal(await controller.refresh(), true);
  oldRequest.resolve(response(privateSnapshot("private-owner-a")));
  assert.equal(await oldRefresh, false);
  assert.equal(controller.readState().creatorAccount, "owner-b");
  assert.equal(controller.readState().snapshot.videos[0].id, "private-owner-b");
  assert.doesNotMatch(controller.element("#revenue-list").innerHTML, /private-owner-a/);
});

test("proof creation completing after sign out never sends an authenticated business request", async () => {
  const proof = deferred();
  let calls = 0;
  const controller = await app({ productAuthorization: () => proof.promise, fetch: async () => { calls++; return response({}); } });
  controller.renderProductState(connected("owner-a"));
  const request = controller.api("/v1/channels", { method: "POST" });
  const rejected = assert.rejects(request, /Creator account changed/);
  await controller.click("product-disconnect");
  proof.resolve({});
  await rejected;
  assert.equal(calls, 0);
});

test("a late channel mutation response cannot refill channel output and upload forms", async () => {
  const request = deferred();
  const controller = await app({ fetch: () => request.promise });
  controller.renderProductState(connected("owner-a"));
  const submit = controller.element("#channel-form").onsubmit({ preventDefault() {}, target: { handle: { value: "test-owner" }, name: { value: "Test owner" } } });
  await turn();
  await controller.click("product-disconnect");
  request.resolve(response({ ID: "private-owner-a", Name: "Private channel" }));
  await submit;
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#upload-form").elements.channel_id.value, "");
});

test("AI stream chunks after sign out are discarded and their reader is cancelled", async () => {
  const chunk = deferred();
  let cancelled = 0, released = 0, reads = 0, calls = 0;
  const reader = { read: () => { reads++; return chunk.promise; }, cancel: async () => { cancelled++; }, releaseLock: () => { released++; } };
  const controller = await app({ fetch: async () => { calls++; return { ok: true, body: { getReader: () => reader } }; } });
  controller.renderProductState(connected("owner-a"));
  controller.showAI({ id: "private-owner-a", state: "awaiting_permission" });
  const stream = controller.run("ai-run");
  await turn();
  assert.equal(reads, 1);
  await controller.click("product-disconnect");
  chunk.resolve({ done: false, value: new TextEncoder().encode('{"delta":"private-owner-a","job":{"id":"private-owner-a","state":"review_required"}}\n') });
  await stream;
  assertCleared(controller, "private-owner-a");
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
  assert.equal(calls, 1);
});

test("a restored session arriving after sign out cannot reconnect the page", async () => {
  const restore = deferred();
  let calls = 0;
  const controller = await app({ restoreProductSession: () => restore.promise, fetch: async () => { calls++; return response({}); } });
  await controller.click("product-disconnect");
  restore.resolve(connected("owner-a"));
  await turn();
  assertCleared(controller, "private-owner-a");
  assert.equal(calls, 0);
  assert.equal(controller.element("#product-status").textContent, "Sign in to manage your channel.");
});

test("missing analytics and nullable audit lists render empty values without throwing", async () => {
  const controller = await app({ fetch: async () => response({ analytics: null, revenue: null, payout_intents: null, reports: null, appeals: null, disputes: null }) });
  controller.renderProductState(connected("owner-a"));
  assert.equal(await controller.refresh(), true);
  for (const id of ["views", "watch", "subs", "revenue"]) assert.equal(controller.element(`#${id}`).textContent, "—");
  await controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
});

test("failed revocation keeps private views empty and offers an explicit sign-out retry", async () => {
  let attempts = 0;
  const controller = await app({ disconnectProductSession: async () => ++attempts === 1
    ? { status: "network-unavailable", message: "Revocation not confirmed; retry when Auth is available." }
    : { status: "disconnected" } });
  controller.renderProductState(connected("owner-a"));
  await controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#product-disconnect").hidden, false);
  assert.equal(controller.element("#product-disconnect").textContent, "Retry sign out");
  assert.equal(controller.element("#product-signin").disabled, true);
  assert.doesNotMatch(controller.element("#status").textContent, /disconnected/);
  await controller.click("product-disconnect");
  assert.equal(attempts, 2);
  assert.equal(controller.element("#product-disconnect").hidden, true);
  assert.equal(controller.element("#product-signin").disabled, false);
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
});

test("prepared Wallet link becomes visible and focused after its exact URL is set", async () => {
  const prepared = deferred();
  const controller = await app({ prepareProductSignIn: () => prepared.promise });
  await turn();
  const preparation = controller.click("product-signin");
  assert.equal(controller.element("#product-open").hidden, true);
  assert.equal(controller.element("#product-open").href, undefined);
  prepared.resolve({ url: "ynxwallet://product-session/v2?request=test-fixture" });
  await preparation;
  assert.equal(controller.element("#product-open").href, "ynxwallet://product-session/v2?request=test-fixture");
  assert.equal(controller.element("#product-open").hidden, false);
  assert.equal(controller.element("#product-open").focused, true);
  assert.equal(controller.element("#product-signin").disabled, false);
});
