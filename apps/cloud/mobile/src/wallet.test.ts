import test from "node:test";
import assert from "node:assert/strict";
import {approvalFromURL, binding, requestURL} from "./wallet";

test("Cloud Wallet request is bounded and callback rejects substitution", () => {
  const issued = new Date("2026-07-16T00:00:00.000Z");
  const u = new URL(requestURL("A".repeat(44), "n".repeat(32), issued));
  const request = JSON.parse(u.searchParams.get("request")!);
  assert.equal(request.bundleId, binding.bundleId);
  assert.equal(new Date(request.expiresAt).getTime() - issued.getTime(), 300_000);
  assert.deepEqual(request.scopes, [...request.scopes].sort());

  const approval = {
    account: "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7h6v",
    walletSignature: "signed",
    nonce: request.nonce,
    expiresAt: request.expiresAt,
    productClientId: binding.productClientId,
    bundleId: binding.bundleId,
    callback: binding.callback,
    productDeviceKey: request.productDeviceKey,
    requestingProduct: binding.requestingProduct,
    chainId: request.chainId,
    grantedScopes: binding.scopes,
  };
  const callback = `${binding.callback}?approval=${encodeURIComponent(JSON.stringify(approval))}`;
  assert.equal(approvalFromURL(callback).account, approval.account);
  approval.bundleId = "com.attacker.substitute";
  assert.throws(
    () => approvalFromURL(`${binding.callback}?approval=${encodeURIComponent(JSON.stringify(approval))}`),
    /binding mismatch/,
  );
});
