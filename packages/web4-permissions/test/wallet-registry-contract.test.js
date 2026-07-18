import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const entries = JSON.parse(await readFile(new URL("../integration/browser-search-wallet-registry-v2.json", import.meta.url), "utf8"));
const exact = ["bundleId", "callbacks", "maxScopes", "productClientId", "productDeviceAlgorithms", "requestingProduct", "schemaVersion", "scopes"];

test("Browser and Search registry v2 entries are exact, sorted and P-256 only", () => {
  assert.equal(entries.length, 5);
  assert.equal(new Set(entries.map(entry => entry.productClientId)).size, entries.length);
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), exact);
    assert.equal(entry.schemaVersion, 2);
    assert.deepEqual(entry.productDeviceAlgorithms, ["p256-sha256"]);
    assert.deepEqual(entry.callbacks, [...entry.callbacks].sort());
    assert.deepEqual(entry.scopes, [...entry.scopes].sort());
    assert.ok(entry.maxScopes <= entry.scopes.length);
    for (const callback of entry.callbacks) { const url = new URL(callback); assert.equal(url.search, ""); assert.equal(url.hash, ""); }
  }
});

test("implemented platform request builders bind the reviewed registry tuples", async () => {
  const files = {
    "ynx-browser-android": "apps/browser/android/app/src/main/java/com/ynxweb4/browser/MainActivity.java",
    "ynx-browser-ios": "apps/browser/ios/YNXBrowser/BrowserModel.swift",
    "ynx-browser-macos": "apps/browser/native/Sources/YNXBrowserNative/main.swift",
    "ynx-search-web": "apps/search/src/contracts.js"
  };
  for (const entry of entries.filter(value => files[value.productClientId])) {
    const source = await readFile(new URL(files[entry.productClientId], root), "utf8");
    for (const value of [entry.productClientId, entry.requestingProduct, entry.bundleId, ...entry.callbacks, ...entry.scopes, ...entry.productDeviceAlgorithms]) assert.ok(source.includes(value), `${entry.productClientId} source omits ${value}`);
  }
});

test("Windows registry entry remains an integration draft until its request builder exists", async () => {
  const source = await readFile(new URL("apps/browser/windows/YNXBrowser.Windows/MainWindow.xaml.cs", root), "utf8");
  assert.equal(source.includes("ynx-browser-windows"), false);
});
