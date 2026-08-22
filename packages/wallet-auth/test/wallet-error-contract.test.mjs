import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WALLET_ERROR_CONTRACT,
  WALLET_PROVIDER_ERROR_CODES,
  walletErrorDescriptor,
  walletErrorResponse,
} from "../src/wallet-error-contract.js";

const REQUIRED = [
  "USER_REJECTED", "UNAUTHORIZED", "UNSUPPORTED_METHOD", "PROVIDER_DISCONNECTED", "CHAIN_DISCONNECTED", "UNKNOWN_CHAIN",
  "GATEWAY_UNAVAILABLE", "ROUTE_NOT_MOUNTED", "DEVICE_NOT_REGISTERED", "INVALID_DEVICE_PROOF", "DEVICE_KEY_MISMATCH",
  "REGISTRY_VERSION_MISMATCH", "ORIGIN_NOT_REGISTERED", "ORIGIN_MISMATCH", "CALLBACK_MISMATCH", "PACKAGE_MISMATCH",
  "UNKNOWN_PRODUCT", "CLIENT_RETIRED", "PRODUCT_SESSION_REQUIRED", "PRODUCT_SESSION_EXPIRED", "PRODUCT_SESSION_REVOKED",
  "SCOPE_NOT_ALLOWED", "REPLAY", "CLOCK_SKEW", "VERSION_INCOMPATIBLE", "UPGRADE_REQUIRED",
];

test("canonical Wallet error contract defines every required provider and YNX error", () => {
  assert.deepEqual(Object.keys(WALLET_ERROR_CONTRACT), REQUIRED);
  for (const [code, definition] of Object.entries(WALLET_ERROR_CONTRACT)) {
    assert.equal(Number.isInteger(definition.httpStatus) && definition.httpStatus >= 400 && definition.httpStatus <= 599, true, code);
    assert.equal(typeof definition.retryable, "boolean", code);
    for (const field of ["safeMessage", "developerMessage", "monitoringClass", "userAction"]) {
      assert.equal(typeof definition[field] === "string" && definition[field].length > 0, true, `${code}.${field}`);
    }
    assert.doesNotMatch(definition.safeMessage, /\boffline\b/i);
    assert.equal(Object.isFrozen(definition), true);
  }
  assert.equal(Object.isFrozen(WALLET_ERROR_CONTRACT), true);
});

test("EIP-1193 codes retain their standard identity and never collapse into Gateway status", () => {
  assert.deepEqual(WALLET_PROVIDER_ERROR_CODES, {
    4001: "USER_REJECTED", 4100: "UNAUTHORIZED", 4200: "UNSUPPORTED_METHOD",
    4900: "PROVIDER_DISCONNECTED", 4901: "CHAIN_DISCONNECTED", 4902: "UNKNOWN_CHAIN",
  });
  for (const [providerCode, code] of Object.entries(WALLET_PROVIDER_ERROR_CODES)) {
    const definition = walletErrorDescriptor(providerCode);
    assert.equal(definition.code, code);
    assert.equal(definition.providerCode, Number(providerCode));
    assert.notEqual(definition.code, "GATEWAY_UNAVAILABLE");
  }
});

test("legacy runtime codes normalize to the final contract without inventing authority", () => {
  for (const [legacy, canonical] of [
    ["NETWORK_UNAVAILABLE", "GATEWAY_UNAVAILABLE"], ["INVALID_DEVICE_KEY", "DEVICE_KEY_MISMATCH"],
    ["SESSION_EXPIRED", "PRODUCT_SESSION_EXPIRED"], ["SESSION_REVOKED", "PRODUCT_SESSION_REVOKED"],
    ["SCOPE_WIDENING", "SCOPE_NOT_ALLOWED"], ["ISSUED_IN_FUTURE", "CLOCK_SKEW"],
    ["UNSUPPORTED_VERSION", "VERSION_INCOMPATIBLE"],
  ]) assert.equal(walletErrorDescriptor(legacy).code, canonical);
  assert.throws(() => walletErrorDescriptor("NOT_A_REAL_CODE"), (error) => error.code === "UNKNOWN_WALLET_ERROR");
});

test("safe HTTP response preserves classification and bounded correlation IDs", () => {
  const response = walletErrorResponse("INVALID_DEVICE_PROOF", { requestId: "req_123", traceId: "trace_123", errorId: "err_123" });
  assert.deepEqual(response, {
    status: 403,
    body: {
      code: "INVALID_DEVICE_PROOF",
      retryable: false,
      safeMessage: "Device verification failed.",
      monitoringClass: "device-proof",
      userAction: "register-device",
      requestId: "req_123",
      traceId: "trace_123",
      errorId: "err_123",
    },
  });
  assert.equal("developerMessage" in response.body, false);
  assert.throws(() => walletErrorResponse("REPLAY", { requestId: " bad " }), (error) => error.code === "INVALID_CORRELATION_ID");
});
