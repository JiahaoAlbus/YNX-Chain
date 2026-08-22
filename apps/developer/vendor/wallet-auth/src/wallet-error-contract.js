import { WalletAuthError } from "./canonical.js";

const descriptor = (httpStatus, retryable, safeMessage, developerMessage, monitoringClass, userAction, providerCode = null) => Object.freeze({
  httpStatus,
  retryable,
  safeMessage,
  developerMessage,
  monitoringClass,
  userAction,
  providerCode,
});

export const WALLET_ERROR_CONTRACT = Object.freeze({
  USER_REJECTED: descriptor(400, false, "Wallet request was rejected.", "The user rejected the provider request.", "wallet-consent", "return-to-product", 4001),
  UNAUTHORIZED: descriptor(401, false, "Wallet permission is required.", "The provider refused the request because the caller is not authorized.", "wallet-permission", "reconnect-wallet", 4100),
  UNSUPPORTED_METHOD: descriptor(405, false, "This Wallet action is not supported.", "The provider does not implement the requested method.", "wallet-capability", "return-to-product", 4200),
  PROVIDER_DISCONNECTED: descriptor(503, true, "Wallet is disconnected.", "The provider is disconnected from every chain.", "wallet-transport", "reconnect-wallet", 4900),
  CHAIN_DISCONNECTED: descriptor(503, true, "Wallet is disconnected from this chain.", "The provider is not connected to the requested chain.", "chain-transport", "reconnect-wallet", 4901),
  UNKNOWN_CHAIN: descriptor(409, true, "YNX Testnet is not registered in this Wallet.", "The provider does not recognize the requested chain.", "chain-configuration", "add-chain", 4902),

  GATEWAY_UNAVAILABLE: descriptor(503, true, "Private YNX services are temporarily unavailable; your Wallet connection remains active.", "The Product Session Gateway could not be reached.", "gateway-transport", "retry"),
  ROUTE_NOT_MOUNTED: descriptor(503, true, "Private YNX services are temporarily unavailable.", "The canonical Product Session route is not mounted at the selected Gateway.", "gateway-routing", "retry"),
  DEVICE_NOT_REGISTERED: descriptor(403, false, "This device is not registered for the product.", "The selected product device is absent from the approved registry.", "device-registration", "register-device"),
  INVALID_DEVICE_PROOF: descriptor(403, false, "Device verification failed.", "The P-256 device proof did not verify against the registered key and canonical payload.", "device-proof", "register-device"),
  DEVICE_KEY_MISMATCH: descriptor(403, false, "This device key does not match the registered product device.", "The supplied device key differs from the registry or pending authorization binding.", "device-binding", "register-device"),
  REGISTRY_VERSION_MISMATCH: descriptor(409, true, "Product registration changed; reconnect to continue.", "The client and Gateway used different accepted registry versions.", "registry-version", "reconnect-wallet"),
  ORIGIN_NOT_REGISTERED: descriptor(403, false, "This website is not registered for Wallet access.", "The canonical HTTPS Origin is absent from the exact product registration.", "origin-registration", "return-to-product"),
  ORIGIN_MISMATCH: descriptor(403, false, "The Wallet return website does not match the request.", "The canonical Origin differs from the authorization, approval, session, or proof binding.", "origin-binding", "return-to-product"),
  CALLBACK_MISMATCH: descriptor(403, false, "The Wallet return target does not match the request.", "The callback differs from the registered pending authorization tuple.", "callback-binding", "return-to-product"),
  PACKAGE_MISMATCH: descriptor(403, false, "This application is not registered for the Wallet request.", "The package, bundle, application, product, or client tuple does not match the registry.", "application-binding", "return-to-product"),
  UNKNOWN_PRODUCT: descriptor(404, false, "This product is not registered for Wallet access.", "No accepted product registration matches the requested product and client.", "product-registration", "contact-product-support"),
  CLIENT_RETIRED: descriptor(410, false, "This application version has been retired.", "The exact product client is retired and cannot create or upgrade Product Sessions.", "client-retirement", "upgrade-client"),
  PRODUCT_SESSION_REQUIRED: descriptor(401, true, "Reconnect Wallet to use this private YNX service.", "The private route requires an active exact Product Session.", "session-required", "reconnect-wallet"),
  PRODUCT_SESSION_EXPIRED: descriptor(401, true, "Your private YNX session expired; reconnect to continue.", "The Product Session or authorization request is outside its accepted lifetime.", "session-expiry", "reconnect-wallet"),
  PRODUCT_SESSION_REVOKED: descriptor(401, false, "This private YNX session was revoked.", "The Product Session, approval, device, or account authority is terminally revoked.", "session-revocation", "reconnect-wallet"),
  SCOPE_NOT_ALLOWED: descriptor(403, false, "This Wallet permission is not allowed for the product.", "The requested scope is absent, reordered, widened, or outside the exact registry allowlist.", "scope-policy", "return-to-product"),
  REPLAY: descriptor(409, false, "This Wallet request was already used.", "The nonce, proof, challenge, callback, or request identifier was replayed.", "replay-detection", "reconnect-wallet"),
  CLOCK_SKEW: descriptor(400, true, "Device time is incorrect; correct it and retry.", "The issued-at or expiry value is outside the accepted clock-skew window.", "clock-skew", "sync-clock"),
  VERSION_INCOMPATIBLE: descriptor(409, false, "This Wallet protocol version is not compatible.", "The client and service protocol versions cannot interoperate safely.", "protocol-version", "upgrade-client"),
  UPGRADE_REQUIRED: descriptor(426, false, "Update this application before reconnecting Wallet.", "The retired or incompatible client must upgrade before authorization.", "client-upgrade", "upgrade-client"),
});

export const WALLET_PROVIDER_ERROR_CODES = Object.freeze({
  4001: "USER_REJECTED",
  4100: "UNAUTHORIZED",
  4200: "UNSUPPORTED_METHOD",
  4900: "PROVIDER_DISCONNECTED",
  4901: "CHAIN_DISCONNECTED",
  4902: "UNKNOWN_CHAIN",
});

const ALIASES = Object.freeze({
  NETWORK_UNAVAILABLE: "GATEWAY_UNAVAILABLE",
  INVALID_DEVICE_KEY: "DEVICE_KEY_MISMATCH",
  SESSION_EXPIRED: "PRODUCT_SESSION_EXPIRED",
  EXPIRED: "PRODUCT_SESSION_EXPIRED",
  SESSION_REVOKED: "PRODUCT_SESSION_REVOKED",
  REVOKED: "PRODUCT_SESSION_REVOKED",
  SCOPE_NOT_GRANTED: "SCOPE_NOT_ALLOWED",
  SCOPE_WIDENING: "SCOPE_NOT_ALLOWED",
  ISSUED_IN_FUTURE: "CLOCK_SKEW",
  INVALID_TIME: "CLOCK_SKEW",
  UNSUPPORTED_VERSION: "VERSION_INCOMPATIBLE",
});

export function walletErrorDescriptor(input) {
  const raw = input && typeof input === "object" ? input.code : input;
  const numeric = typeof raw === "string" && /^[0-9]{4}$/.test(raw) ? Number(raw) : raw;
  const provider = WALLET_PROVIDER_ERROR_CODES[numeric];
  const code = provider ?? ALIASES[raw] ?? raw;
  const definition = WALLET_ERROR_CONTRACT[code];
  if (!definition) throw new WalletAuthError("UNKNOWN_WALLET_ERROR", "Wallet error code is not defined by the canonical contract");
  return Object.freeze({ code, ...definition });
}

export function walletErrorResponse(input, correlation = {}) {
  const definition = walletErrorDescriptor(input);
  const ids = {};
  for (const key of ["requestId", "traceId", "errorId"]) {
    const value = correlation[key];
    if (value !== undefined) {
      if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.trim() !== value) throw new WalletAuthError("INVALID_CORRELATION_ID", `${key} is invalid`);
      ids[key] = value;
    }
  }
  return Object.freeze({
    status: definition.httpStatus,
    body: Object.freeze({
      code: definition.code,
      retryable: definition.retryable,
      safeMessage: definition.safeMessage,
      monitoringClass: definition.monitoringClass,
      userAction: definition.userAction,
      ...ids,
    }),
  });
}
