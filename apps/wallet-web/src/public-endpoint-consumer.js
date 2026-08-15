const MATRIX_ID = "ynx-wallet-auth-public-endpoint-service-discovery-v1";
const RPC_URL = "https://rpc.ynxweb4.com/evm";
const REST_URL = "https://rest.ynxweb4.com";

function fail(message) {
  throw Object.assign(new Error(message), {code: "PUBLIC_ENDPOINT_MATRIX_MISMATCH"});
}

function exactEndpoint(matrix, id) {
  const matches = Array.isArray(matrix?.endpoints) ? matrix.endpoints.filter((item) => item?.id === id) : [];
  if (matches.length !== 1) fail(`Frozen endpoint ${id} is missing or duplicated.`);
  return matches[0];
}

function https(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { fail(`${label} is not a URL.`); }
  const canonical = parsed.pathname === "/" && !parsed.search ? parsed.origin : parsed.toString();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || canonical !== value) {
    fail(`${label} is not canonical HTTPS.`);
  }
  return value;
}

/** Consume Central's immutable endpoint matrix; this module does not discover or redefine endpoints. */
export function derivePublicEndpointBinding(matrix) {
  if (matrix?.schemaVersion !== 1 || matrix?.matrixId !== MATRIX_ID || matrix?.owner !== "02-wallet-auth-integration") {
    fail("Frozen endpoint matrix identity is invalid.");
  }
  if (matrix?.network?.chainIdDecimal !== 6423 || matrix?.network?.chainIdHex !== "0x1917") {
    fail("Frozen endpoint matrix network identity is invalid.");
  }
  const rpc = exactEndpoint(matrix, "chain-rpc-canonical");
  const appGateway = exactEndpoint(matrix, "app-gateway-v1");
  if (matrix?.canonical?.rpcUrl !== RPC_URL || rpc.url !== RPC_URL || rpc.service !== "chain-json-rpc") {
    fail("Frozen canonical RPC binding is invalid.");
  }
  if (matrix?.canonical?.restUrl !== REST_URL || appGateway.url !== `${REST_URL}/app/health`) {
    fail("Frozen canonical REST binding is invalid.");
  }
  return Object.freeze({
    matrixId: MATRIX_ID,
    chainIdDecimal: 6423,
    chainIdHex: "0x1917",
    rpcUrl: https(RPC_URL, "RPC URL"),
    restUrl: https(REST_URL, "REST URL"),
    rpc: Object.freeze({availability: rpc.availability === true, cors: rpc.cors === true, mobileReachable: rpc.mobileReachable === true}),
    rest: Object.freeze({availability: appGateway.availability === true, cors: appGateway.cors === true, mobileReachable: appGateway.mobileReachable === true}),
    aggregatePublic: matrix?.aggregate?.deployedPublic === true,
  });
}

// Exact immutable projection of Central commit d0f89797; tests/build compare it to that Git object.
export const PUBLIC_ENDPOINT_BINDING = Object.freeze({
  matrixId: MATRIX_ID,
  chainIdDecimal: 6423,
  chainIdHex: "0x1917",
  rpcUrl: RPC_URL,
  restUrl: REST_URL,
  rpc: Object.freeze({availability: true, cors: false, mobileReachable: false}),
  rest: Object.freeze({availability: true, cors: false, mobileReachable: false}),
  aggregatePublic: false,
});
