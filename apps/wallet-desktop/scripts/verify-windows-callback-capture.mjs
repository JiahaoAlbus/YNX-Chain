import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseCallbackURL, requestDigest, verifyAuthorization } from "@ynx-chain/wallet-auth";
import { evaluateWalletCallback } from "../src/callback-policy.mjs";
import { canonicalizeWindowsProductCallbackUrl, canonicalizeWindowsYNXWalletProtocolUrl } from "../src/protocol-activation.mjs";

const [capturePath, approveUrl] = process.argv.slice(2);
if (!capturePath || !approveUrl) throw new Error("usage: verify-windows-callback-capture.mjs <capture-path> <approve-url>");
const raw = (await readFile(capturePath, "utf8")).trim();
const review = evaluateWalletCallback(canonicalizeWindowsYNXWalletProtocolUrl(approveUrl.replace("authorize?", "authorize/?"), "win32"));
if (!review.acceptedForReview) throw new Error(`approve request did not satisfy the frozen contract: ${review.code}`);
const canonical = canonicalizeWindowsProductCallbackUrl(raw, review.request.callback, "win32");
const response = parseCallbackURL(canonical, review.request.callback);
const verified = verifyAuthorization(response, { ...review.request, requestDigest: requestDigest(review.request), now: new Date() });
const route = new URL(raw);
console.log(JSON.stringify({
  rawBytes: Buffer.byteLength(raw),
  rawSha256: createHash("sha256").update(raw).digest("hex"),
  rawPathname: route.pathname,
  protocol: route.protocol,
  host: route.hostname,
  queryKeys: [...route.searchParams.keys()],
  windowsSlashNormalized: raw !== canonical,
  signatureVerified: true,
  requestDigest: response.requestDigest,
  account: verified.account
}, null, 2));
