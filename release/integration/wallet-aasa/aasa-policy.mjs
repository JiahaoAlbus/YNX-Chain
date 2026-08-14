const TEAM_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z][A-Za-z0-9.-]{2,127}$/;

export function buildAASA(env) {
  if (env.YNX_ASSOCIATED_DOMAIN_FROZEN !== "true") {
    throw new Error("Core associated-domain contract is not frozen");
  }
  const teamId = env.APPLE_TEAM_ID ?? "";
  const bundleId = env.WALLET_BUNDLE_ID ?? "";
  if (!TEAM_ID.test(teamId) || teamId === "FAKETEAMID") {
    throw new Error("APPLE_TEAM_ID must be a real 10-character Apple Team ID");
  }
  if (!BUNDLE_ID.test(bundleId) || bundleId !== "com.ynxweb4.wallet") {
    throw new Error("WALLET_BUNDLE_ID must equal the signed Wallet bundle identifier");
  }
  let components;
  try {
    components = JSON.parse(env.YNX_AASA_COMPONENTS_JSON ?? "");
  } catch {
    throw new Error("YNX_AASA_COMPONENTS_JSON must be frozen Core JSON");
  }
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error("Core AASA components must be a non-empty array");
  }
  for (const component of components) {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      throw new Error("Each Core AASA component must be an object");
    }
    if (typeof component["/"] !== "string" || !component["/"].startsWith("/")) {
      throw new Error("Each Core AASA component must contain an absolute path pattern");
    }
  }
  return Object.freeze({
    applinks: Object.freeze({
      apps: Object.freeze([]),
      details: Object.freeze([
        Object.freeze({
          appID: `${teamId}.${bundleId}`,
          components: Object.freeze(components.map((value) => Object.freeze({ ...value }))),
        }),
      ]),
    }),
  });
}

export function verifyAASA({ body, contentType, redirected, expected }) {
  if (redirected) throw new Error("AASA endpoint must not redirect");
  if (!/^application\/json(?:\s*;|$)/i.test(contentType ?? "")) {
    throw new Error("AASA endpoint must use application/json");
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes === 0 || bytes > 128 * 1024) throw new Error("AASA body size is invalid");
  let actual;
  try {
    actual = JSON.parse(body);
  } catch {
    throw new Error("AASA body must be JSON, not an SPA fallback");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Public AASA does not match the frozen signed-app contract");
  }
  return Object.freeze({ valid: true, bytes });
}
