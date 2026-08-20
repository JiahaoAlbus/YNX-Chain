import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProductSessionGatewayRuntimePaths } from "../src/index.js";

const defaults = Object.freeze({ defaultRegistryPath: "/opt/candidate/product-session-registry.json", gatewayStatePath: "/var/lib/candidate/v1-state.json" });

test("candidate runtime binds current and legacy environment names to the same exact paths", () => {
  const current = resolveProductSessionGatewayRuntimePaths({
    YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH: "/opt/candidate/product-session-registry.json",
    YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH: "/var/lib/candidate/v2-state.json",
  }, defaults);
  const legacy = resolveProductSessionGatewayRuntimePaths({
    YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: "/opt/candidate/product-session-registry.json",
    YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: "/var/lib/candidate/v2-state.json",
  }, defaults);
  assert.deepEqual(legacy, current);
  assert.deepEqual(resolveProductSessionGatewayRuntimePaths({
    YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: current.registryPath,
    YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: current.statePath,
    YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH: current.registryPath,
    YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH: current.statePath,
  }, defaults), current);
});

test("candidate runtime rejects conflicting, relative, partial and unbound environment paths", () => {
  for (const env of [
    { YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: "/var/lib/a.json", YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH: "/var/lib/b.json" },
    { YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: "relative.json" },
    { YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: "" },
  ]) assert.throws(() => resolveProductSessionGatewayRuntimePaths(env, defaults));
});
