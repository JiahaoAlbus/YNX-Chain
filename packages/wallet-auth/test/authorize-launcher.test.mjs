import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AUTHORIZATION_LAUNCH_PLATFORM_MATRIX,
  createCanonicalAuthorizeLaunch,
  launchCanonicalAuthorization,
  launchNativeAuthorization,
  launchWebAuthorization,
  parseWalletDeepLink,
} from "../src/index.js";
import { NOW, REGISTRY, request } from "./fixtures.mjs";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    emit(type) { listeners.get(type)?.(); },
  };
}

function browser() {
  const documentEvents = eventTarget();
  const windowEvents = eventTarget();
  const body = { children: [], appendChild(element) { this.children.push(element); } };
  const document = {
    ...documentEvents,
    body,
    visibilityState: "visible",
    createElement() { return { style: {}, setAttribute() {}, remove() { body.children.length = 0; } }; },
  };
  return { document, window: windowEvents, body };
}

test("all supported platforms have a canonical launcher strategy", () => {
  assert.deepEqual(Object.keys(AUTHORIZATION_LAUNCH_PLATFORM_MATRIX).sort(), ["android", "extension", "ios", "macos", "web", "windows"]);
  const launch = createCanonicalAuthorizeLaunch(request());
  assert.equal(parseWalletDeepLink(launch.uri, "android", { now: NOW, registry: REGISTRY }).request.nonce, request().nonce);
  assert.equal(launch.fallbackActions[0].id, "official-ynx-wallet-download");
  assert.equal(launch.fallbackActions[1].id, "standard-metamask");
});

test("native resolver reports installed or unsupported without claiming a session", async () => {
  for (const platform of ["android", "ios", "macos", "windows"]) {
    const installed = await launchNativeAuthorization(request(), platform, async (uri) => uri === createCanonicalAuthorizeLaunch(request()).uri);
    assert.equal(installed.status, "installed");
    assert.equal("session" in installed, false);
    const unavailable = await launchNativeAuthorization(request(), platform, async () => false);
    assert.equal(unavailable.status, "unsupported");
  }
});

test("web and extension use a controlled frame and lifecycle, never top-level navigation", async () => {
  for (const platform of ["web", "extension"]) {
    const page = browser();
    const pending = launchCanonicalAuthorization(request(), { platform, document: page.document, window: page.window, timeoutMs: 100 });
    assert.equal(page.body.children.length, 1);
    assert.equal(page.body.children[0].src, createCanonicalAuthorizeLaunch(request()).uri);
    if (platform === "web") {
      page.document.visibilityState = "hidden";
      page.document.emit("visibilitychange");
    } else page.window.emit("pagehide");
    const outcome = await pending;
    assert.equal(outcome.status, "opened");
    assert.equal(outcome.detail, platform === "web" ? "PAGE_HIDDEN" : "PAGE_HIDE");
    assert.equal(page.body.children.length, 0);
  }
});

test("launcher source never assigns a top-level location", () => {
  const source = readFileSync(new URL("../src/authorize-launcher.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:window|document)\.location\s*=|location\.href\s*=/);
});

test("web timeout preserves the page and returns explicit fallback actions", async () => {
  const page = browser();
  const outcome = await launchWebAuthorization(request(), { document: page.document, window: page.window, timeoutMs: 1 });
  assert.equal(outcome.status, "timeout");
  assert.equal(outcome.detail, "NO_VISIBILITY_TRANSITION");
  assert.equal(page.body.children.length, 0);
  assert.equal("session" in outcome, false);
});

test("missing browser or resolver fails closed as unsupported", async () => {
  assert.equal((await launchWebAuthorization(request(), { document: null, window: null })).status, "unsupported");
  assert.equal((await launchCanonicalAuthorization(request(), { platform: "android" })).status, "unsupported");
});
