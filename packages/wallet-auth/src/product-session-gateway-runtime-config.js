import { dirname, isAbsolute, join } from "node:path";
import { exactFields, WalletAuthError } from "./canonical.js";

const DEFAULT_FIELDS = ["defaultRegistryPath", "gatewayStatePath"];

export function resolveProductSessionGatewayRuntimePaths(environment, defaults) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) fail("INVALID_RUNTIME_CONFIG", "Product Session environment is invalid");
  exactFields(defaults, DEFAULT_FIELDS, "Product Session runtime defaults");
  const defaultRegistryPath = absolute(defaults.defaultRegistryPath, "default registry path");
  const gatewayStatePath = absolute(defaults.gatewayStatePath, "Gateway state path");
  const registryPath = boundPath(environment, "YNX_WALLET_PRODUCT_SESSION_V2_REGISTRY_PATH", "YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH", defaultRegistryPath);
  const statePath = boundPath(environment, "YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH", "YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH", join(dirname(gatewayStatePath), "product-session-v2.json"));
  return Object.freeze({ registryPath, statePath });
}

function boundPath(environment, currentName, legacyName, fallback) {
  const current = optionalPath(environment[currentName], currentName);
  const legacy = optionalPath(environment[legacyName], legacyName);
  if (current && legacy && current !== legacy) fail("CONFLICTING_RUNTIME_CONFIG", `${currentName} and ${legacyName} must bind the same exact path`);
  return current ?? legacy ?? fallback;
}

function optionalPath(value, label) {
  if (value === undefined) return null;
  return absolute(value, label);
}

function absolute(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || !isAbsolute(value)) fail("INVALID_RUNTIME_CONFIG", `${label} must be an absolute path`);
  return value;
}

function fail(code, message) { throw new WalletAuthError(code, message); }
