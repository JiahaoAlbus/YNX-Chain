import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { createDesktopI18n } from "../src/desktop-i18n.mjs";
import { createPasswordVaultUI } from "../src/password-vault-ui.mjs";

function node() {
  const listeners = new Map();
  return {
    dataset: {}, textContent: "", value: "", hidden: false, disabled: false, open: false,
    children: [],
    get options() { return this.children; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
    replaceChildren() { this.children = []; this.value = ""; }, append(child) { this.children.push(child); if (child.selected || !this.value) this.value = child.value; },
    querySelector(selector) { if (selector === ".queue-count") return this.queueCount ??= node(); return null; },
    querySelectorAll() { return []; },
  };
}

function fixture() {
  const nodes = new Map();
  const get = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  const doc = {
    documentElement: { lang: "en", dir: "ltr" },
    querySelector(selector) {
      if (selector === "dialog[open]") return [get("#authorization"), get("#walletconnect-proposal"), get("#provider-request")].find(item => item.open) ?? null;
      return get(selector);
    },
    querySelectorAll(selector) {
      if (selector === "[data-i18n]" || selector === "[data-i18n-placeholder]" || selector === "[data-i18n-aria-label]") return [];
      if (selector === "[data-custody-cancel]") return [get("#custody-cancel")];
      if (selector.includes(" input")) return [get("#local-password"), get("#local-confirm"), get("#recovery-value")];
      return [];
    },
    createElement: () => node(),
  };
  const i18n = createDesktopI18n({ systemLocale: "en-US", storage: new MapStorage(), document: doc });
  return { doc, get, i18n };
}

class MapStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test("visible authorization review changes language without changing approval identity, account or decision", async () => {
  const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("function presentApproval() {");
  const end = source.indexOf("\nfunction scopeLabel", start);
  assert.ok(start >= 0 && end > start);
  const { doc, get, i18n } = fixture();
  const account = "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
  const review = { id: "qa-review", displayName: "QA App", origin: "https://qa.example", account: "0x1111111111111111111111111111111111111111", ynxAccount: account, purpose: "QA purpose", request: { purpose: "QA purpose" }, scopes: [], expiresAt: "2026-09-25T12:30:00Z" };
  const authorization = get("#authorization"), context = {
    document: doc, authorization, authResult: get("#auth-result"),
    approvalQueue: { current: { type: "authorization", review, key: "qa" }, count: 1, busy: false },
    keyState: { locked: false, revision: 7 }, creatingAuthorizationAccount: false, authorizationChoices: new Map(),
    activeAccount: review.account, nativeAccountLabel: value => value, scopeLabel: value => value,
    i18n, t: (english, parameters) => i18n.t(english, parameters), write: (element, english, parameters) => i18n.write(element, english, parameters),
  };
  runInNewContext(`${source.slice(start, end)}\npresentApproval()`, context);
  const before = { ...authorization.dataset };
  assert.equal(authorization.open, true);
  assert.match(get("#auth-product").textContent, /Connect to QA App/);
  i18n.setLocale("ar");
  context.presentApproval(); // The renderer's locale-change listener invokes this same function.
  assert.equal(doc.documentElement.dir, "rtl");
  assert.equal(authorization.open, true);
  assert.deepEqual({ ...authorization.dataset }, before);
  assert.equal(get("#auth-account").textContent, account);
  assert.notEqual(get("#auth-product").textContent, "Connect to QA App");
  assert.notEqual(get("#reject-auth").textContent, "Reject request");
  assert.equal(get("#auth-purpose").textContent, "QA purpose");
});

test("visible recovery review changes language while preserving the selected source and pending preview", async () => {
  const { doc, get, i18n } = fixture();
  const account = "0x1111111111111111111111111111111111111111";
  const publicAddress = "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
  const status = { initialized: true, passwordConfigured: true, account, accounts: [{ account, ynxAccount: publicAddress, state: "recovery-required" }] };
  const keyState = { locked: true, revision: 1, unlockAvailable: true, authenticating: false };
  let preparations = 0, commits = 0;
  const api = {
    async lock() { keyState.revision++; return { revision: keyState.revision }; },
    async accountStatus() { return { ok: true, value: status }; },
    async recoveryHistory() { return { ok: true, value: [] }; },
    async prepareRecovery(input) { preparations++; assert.equal(input.account, account); assert.equal(input.kind, "private-key"); return { ok: true, value: { previewId: "qa-preview", account, resetPassword: false, recoveryRequiredAccounts: [] } }; },
    async commitRecovery() { commits++; throw new Error("Commit must remain user initiated"); },
  };
  const ui = createPasswordVaultUI({ api, document: doc, getKeyState: () => keyState, getAccountStatus: () => status, renderAccount() {}, translate: (english, parameters) => i18n.t(english, parameters), write: (element, english, parameters) => i18n.write(element, english, parameters), locale: () => i18n.locale });
  await get("#recover-wallet").emit("click");
  assert.equal(get("#recovery-sheet").open, true);
  get("#recovery-kind").value = "private-key";
  get("#recovery-password-mode").value = "keep";
  get("#recovery-value").value = "qa-only-value";
  await get("#recovery-form").emit("submit");
  assert.equal(preparations, 1);
  assert.equal(get("#recovery-review").hidden, false);
  const before = get("#recovery-summary").textContent;
  const selected = get("#recovery-account").value;
  i18n.setLocale("ar");
  ui.render(); // The renderer's locale-change listener invokes this same method.
  assert.notEqual(get("#recovery-summary").textContent, before);
  assert.match(get("#recovery-summary").textContent, /ynx1qqqqqqq/);
  assert.equal(get("#recovery-sheet").open, true);
  assert.equal(get("#recovery-review").hidden, false);
  assert.equal(get("#recovery-account").value, selected);
  assert.equal(get("#recovery-kind").value, "private-key");
  assert.equal(commits, 0);
});
