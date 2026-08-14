import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { verifyProductSessionV2PublicNegativeMatrix } from "../scripts/verify-product-session-v2-public-negative-matrix.mjs";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));

test("public negative verifier covers expiry, wrong bindings, scope and device-wide revoke", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-public-negative-")); chmodSync(directory, 0o700);
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const host = new ProductSessionGatewayNodeHost(registry, { emitEvent: () => undefined, now: () => new Date(), statePath: join(directory, "state.json"), tokenFactory: () => crypto.randomUUID().replaceAll("-", "") });
  const server = createServer(host.handler()); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await verifyProductSessionV2PublicNegativeMatrix({ allowLoopback: true, endpoint: `http://127.0.0.1:${server.address().port}`, expiryWaitMs: 2_000, timeoutMs: 5_000 });
  assert.deepEqual(result.cases.map((item) => [item.name, item.status, item.code]), [
    ["wrong-product", 403, "CROSS_PRODUCT_SESSION"],
    ["wrong-device", 403, "CROSS_PRODUCT_SESSION"],
    ["wrong-bundle", 403, "CROSS_PRODUCT_SESSION"],
    ["wrong-scope", 403, "SCOPE_WIDENING"],
    ["devices-revoke", 403, "SESSION_REVOKED"],
    ["expiry", 403, "SESSION_EXPIRED"],
  ]);
  assert.equal(result.deviceRevokeCascaded, true);
  assert.equal(result.installedWalletApprovalVerified, false);
  assert.equal(result.productRuntimeMigrated, false);
});
