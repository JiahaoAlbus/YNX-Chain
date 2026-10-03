import { WalletAuthError } from "./canonical.js";
import { parseProductSessionRegistry, productPlatformBinding } from "./product-session-registry.js";
import {
  parseApplicationActionRequest, applicationActionRequestDigest,
  encodeApplicationActionWalletURL, parseApplicationActionReturnURL,
} from "./application-action-request.js";

/** Explicit Web launch transport for the existing native DEX protocol.
 * The product owns its durable pending journal and transaction submission.
 * Neither a launch attempt nor page visibility proves installation/approval. */
export function createApplicationActionLauncher(registryInput, options) {
  const registry = parseProductSessionRegistry(registryInput);
  const { productId, loadPendingRequest, getActiveAccount, now = () => new Date(), environment = globalThis.window } = options || {};
  if (productId !== "dex" || typeof loadPendingRequest !== "function" || typeof getActiveAccount !== "function" || typeof now !== "function") {
    fail("INVALID_LAUNCHER_OPTIONS", "DEX launcher requires durable pending-request and active-account readers");
  }
  const binding = productPlatformBinding(registry, productId, "web");
  if (!environment?.location || typeof environment.location.assign !== "function") {
    fail("BROWSER_UNAVAILABLE", "Application action launch requires a browser location");
  }
  let epoch = 0, disposed = false, prepared = null;
  const invalidate = () => { epoch++; prepared = null; };
  const visibilityChanged = () => { if (environment.document?.visibilityState === "hidden") invalidate(); };
  environment.addEventListener?.("pagehide", invalidate);
  environment.document?.addEventListener?.("visibilitychange", visibilityChanged);

  function assertContext(request) {
    if (disposed) fail("LAUNCHER_DISPOSED", "Application action launcher is disposed");
    if (environment.location.origin !== binding.origin) fail("BINDING_MISMATCH", "Current page must match the registered product origin");
    if (request && (request.productId !== productId || request.platform !== "web" || request.account !== getActiveAccount())) {
      fail("BINDING_MISMATCH", "Pending action must match this Web product and the currently selected native account");
    }
  }
  function checkEpoch(expected) {
    assertContext();
    if (epoch !== expected) fail("APPLICATION_ACTION_CANCELLED", "Pending action changed while reading its saved request");
  }
  async function readRequest(expected) {
    assertContext();
    const value = await loadPendingRequest();
    checkEpoch(expected);
    if (value === null || value === undefined) return null;
    const request = parseApplicationActionRequest(registry, value, now());
    assertContext(request);
    return request;
  }

  return Object.freeze({
    /** Read an already committed request. No request creation, renewal, storage
     * write, URI launch, account access or provider permission happens here. */
    async prepare() {
      invalidate();
      const expected = epoch;
      const request = await readRequest(expected);
      checkEpoch(expected);
      if (!request) return Object.freeze({ status: "no-pending-request", installation: "unknown", automatic: false });
      const target = Object.freeze({
        status: "ready", installation: "unknown", automatic: false,
        requestDigest: applicationActionRequestDigest(request),
        walletURL: encodeApplicationActionWalletURL(registry, request, now()),
        callback: request.callback, downloadURL: binding.walletDownloadUrl,
        expiresAt: request.expiresAt,
      });
      prepared = { request, target, epoch: expected };
      return target;
    },

    /** Call synchronously from the user's Open button click after prepare.
     * No timers, hidden frames, popup probes or install-detection inference. */
    open(event, expectedRequestDigest) {
      assertContext();
      if (!prepared || prepared.epoch !== epoch) fail("APPLICATION_ACTION_NOT_PREPARED", "Read the saved request before opening Wallet");
      if (expectedRequestDigest !== prepared.target.requestDigest) fail("BINDING_MISMATCH", "Open must refer to the exact request shown in the current review");
      if (typeof environment.MouseEvent !== "function" || !(event instanceof environment.MouseEvent)
          || event.type !== "click" || event.isTrusted !== true || event.defaultPrevented === true
          || !event.currentTarget || ![1, 2, 3].includes(event.eventPhase)
          || environment.navigator?.userActivation?.isActive !== true) {
        fail("USER_ACTIVATION_REQUIRED", "Open Wallet must be a current explicit user click");
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (typeof event.button === "number" && event.button !== 0)) {
        fail("USER_ACTIVATION_REQUIRED", "Open Wallet requires an unmodified primary click");
      }
      const request = parseApplicationActionRequest(registry, prepared.request, now());
      assertContext(request);
      const url = encodeApplicationActionWalletURL(registry, request, now());
      if (url !== prepared.target.walletURL) fail("BINDING_MISMATCH", "The prepared request changed");
      const requestDigest = prepared.target.requestDigest;
      event.preventDefault();
      // Keep the browser receiver: an unbound Location.assign fails in browsers.
      environment.location.assign(url);
      return Object.freeze({ status: "launch-attempted", installation: "unknown", automatic: false, requestDigest });
    },

    /** First, still-live return verification only; this does not atomically
     * consume or persist a result. DEX already has journal.acceptReturn and
     * must use that as its sole callback consumer, including exact historical
     * duplicate recovery. Do not put this helper in front of that journal. */
    async handleReturn(url) {
      invalidate();
      const expected = epoch;
      const request = await readRequest(expected);
      checkEpoch(expected);
      if (!request) fail("APPLICATION_ACTION_NOT_FOUND", "No saved application action matches this return");
      const result = parseApplicationActionReturnURL(registry, url, request, now());
      checkEpoch(expected);
      assertContext(request);
      invalidate();
      return result;
    },

    /** Call immediately on journal/account/network changes, lock, disconnect
     * or abandonment. This invalidates only transient launch UI, never storage. */
    invalidate,
    dispose() {
      invalidate();
      disposed = true;
      environment.removeEventListener?.("pagehide", invalidate);
      environment.document?.removeEventListener?.("visibilitychange", visibilityChanged);
    },
  });
}

function fail(code, message) { throw new WalletAuthError(code, message); }
