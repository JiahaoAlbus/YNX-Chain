import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evmAddressFromYNX, parseProductSessionReturnURL } from "@ynx-chain/wallet-auth";
import { evaluateWalletCallback } from "../src/callback-policy.mjs";
import { PRODUCT_SESSION_REGISTRY } from "../src/wallet-auth-contract.mjs";
import { canonicalizeWindowsYNXWalletProtocolUrl } from "../src/protocol-activation.mjs";

export function verifyWindowsCallbackCapture(raw, requestUrl, expectedResult = "approved", expectedAccount = null, now = new Date()) {
  if (!["approved", "rejected"].includes(expectedResult)) throw new Error("Choose approved or rejected");
  const review = evaluateWalletCallback(canonicalizeWindowsYNXWalletProtocolUrl(requestUrl, "win32"), { now });
  if (!review.acceptedForReview) throw new Error(`Request did not satisfy the v2 contract: ${review.code}`);
  const route = new URL(raw), expected = new URL(review.request.callback);
  let canonical = raw;
  if (!expected.pathname && route.pathname === "/" && route.protocol === expected.protocol && route.hostname === expected.hostname && route.port === expected.port && !route.username && !route.password && !route.hash) {
    canonical = `${expected.href}${route.search}`;
  }
  const verified = parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, review.request, canonical, now);
  if (verified.status !== (expectedResult === "approved" ? "ready" : "user-rejected")) throw new Error(`Callback did not match the expected ${expectedResult} result: ${verified.status}`);
  const account = verified.approval?.account ?? null;
  if (expectedResult === "approved" && expectedAccount && evmAddressFromYNX(account) !== expectedAccount.toLowerCase()) throw new Error("Callback signer differs from the installed account");
  return {
    rawBytes: Buffer.byteLength(raw), rawSha256: createHash("sha256").update(raw).digest("hex"),
    rawPathname: route.pathname, protocol: route.protocol, host: route.hostname,
    queryKeys: [...route.searchParams.keys()], windowsSlashNormalized: raw !== canonical,
    windowsRouteVerified: true, productSessionProtocol: "2", result: expectedResult,
    nonceVerified: true, stateVerified: true, signatureVerified: expectedResult === "approved",
    requestDigest: verified.approval?.requestDigest ?? null, account,
    productCallbackCaptured: true, productSessionCreated: false, privateApiVerified: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [capturePath, requestUrl, expectedResult = "approved", expectedAccount = null] = process.argv.slice(2);
  if (!capturePath || !requestUrl) throw new Error("usage: verify-windows-callback-capture.mjs <capture-path> <request-url> [approved|rejected] [expected-evm-account]");
  const raw = (await readFile(capturePath, "utf8")).trim();
  console.log(JSON.stringify(verifyWindowsCallbackCapture(raw, requestUrl, expectedResult, expectedAccount), null, 2));
}
