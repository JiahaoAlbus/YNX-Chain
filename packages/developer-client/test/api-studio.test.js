import assert from "node:assert/strict";
import test from "node:test";
import { OpenAPIStudio, createConnectorTemplate, listConnectorTemplates } from "../src/index.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

test("API Studio validates OpenAPI JSON and rejects external references", () => {
  const studio = new OpenAPIStudio();
  const imported = studio.import(createConnectorTemplate("oracle"));
  assert.equal(imported.operationCount, 1);
  assert.deepEqual(studio.listOperations()[0], {
    operationId: "getOraclePrice",
    method: "GET",
    path: "/v1/oracle/prices/{symbol}",
    summary: "Read a source-versioned Oracle price",
  });
  const unsafe = createConnectorTemplate("search");
  unsafe.paths["/v1/search"].get.parameters[0].schema = { $ref: "https://schemas.invalid/query.json" };
  assert.throws(() => studio.import(unsafe), (error) => error.code === "external_reference_rejected");
  assert.throws(() => studio.import("openapi: 3.1.0\ninfo: {}"), (error) => error.code === "openapi_json_required");
});

test("API Studio request preview is bounded and credential-reference only", () => {
  const studio = new OpenAPIStudio({
    defaultOrigin: "https://developer.ynxweb4.com",
    allowedOrigins: ["https://developer.ynxweb4.com"],
  });
  studio.import(createConnectorTemplate("oracle"));
  assert.throws(
    () => studio.preview({ operationId: "getOraclePrice", baseURL: "/api-sandbox", path: { symbol: "YNXT-USD" } }),
    (error) => error.code === "credential_reference_required",
  );
  const preview = studio.preview({
    operationId: "getOraclePrice",
    baseURL: "/api-sandbox",
    path: { symbol: "YNXT/USD" },
    credentialReferences: { providerReference: "credential-ref:oracle/testnet" },
  });
  assert.equal(preview.url, "https://developer.ynxweb4.com/api-sandbox/v1/oracle/prices/YNXT%2FUSD");
  assert.equal(preview.credentialReferences[0].reference, "credential-ref:oracle/testnet");
  assert.equal(JSON.stringify(preview).includes("Bearer "), false);
});

test("API Studio sandbox transport requires approval and delegates secured requests to host broker", async () => {
  const sent = [];
  const studio = new OpenAPIStudio({
    defaultOrigin: "https://developer.ynxweb4.com",
    allowedOrigins: ["https://developer.ynxweb4.com"],
    credentialBroker: {
      send: async (request) => {
        sent.push(request);
        return json({ source: "sandbox", ok: true });
      },
    },
  });
  studio.import(createConnectorTemplate("search"));
  const preview = studio.preview({
    operationId: "searchPublicIndex",
    baseURL: "/api-sandbox",
    query: { q: "YNX" },
    credentialReferences: { providerReference: "credential-ref:search/testnet" },
  });
  await assert.rejects(() => studio.execute(preview), (error) => error.code === "api_sandbox_approval_required");
  const inspected = await studio.execute(preview, { approved: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].request.credentialReferences[0].reference, "credential-ref:search/testnet");
  assert.equal(inspected.response.status, 200);
  assert.equal(inspected.credentialValuesPersisted, false);
});

test("API Studio generates typed clients, adapter manifests and failure simulations", () => {
  const studio = new OpenAPIStudio({ defaultOrigin: "https://developer.ynxweb4.com" });
  studio.import(createConnectorTemplate("bridge"));
  const preview = studio.preview({
    operationId: "createBridgeQuote",
    baseURL: "/api-sandbox",
    body: { asset: "YNXT" },
    credentialReferences: { providerReference: "credential-ref:bridge/testnet" },
  });
  assert.match(studio.generateTypeScriptClient(), /createBridgeQuote/);
  const manifest = studio.generateAdapterManifest({ connector: "bridge" });
  assert.equal(manifest.owner, "21-bridge");
  assert.equal(manifest.affiliationClaim, false);
  assert.equal(studio.simulate(preview, "rate-limit").response.status, 429);
  assert.equal(studio.simulate(preview, "timeout").response.body.code, "provider_timeout");
  assert.deepEqual(
    listConnectorTemplates().map((item) => item.id),
    ["walletconnect", "bridge", "card", "search", "storage", "mail", "shipping", "oracle"],
  );
});
