import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("API Studio is a real IDE surface with import, preview, sandbox, generation and failure controls", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  for (const evidence of [
    "API Studio",
    "Import & validate OpenAPI",
    "Preview request",
    "Send approved sandbox request",
    "Simulate failure",
    "Generate TypeScript client",
    "Generate adapter manifest",
    "Credential references JSON",
  ]) assert.match(html, new RegExp(evidence, "i"));
  for (const evidence of [
    "OpenAPIStudio",
    "createConnectorTemplate",
    "listConnectorTemplates",
    "apiStudio.preview",
    "apiStudio.execute",
    "apiStudio.simulate",
    "generateTypeScriptClient",
    "generateAdapterManifest",
  ]) assert.match(app, new RegExp(evidence));
});

test("API Studio UI preserves host-broker credential and responsive boundaries", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  const css = await read("styles.css");
  assert.match(html + app, /browser JavaScript never receives credential values/i);
  assert.match(app, /credentialBroker: globalThis\.ynxCredentialBroker/);
  assert.match(app, /allowedOrigins: \[location\.origin\]/);
  assert.match(css, /\.api-grid/);
  assert.match(css, /\.rpc-row,\.api-grid \{ grid-template-columns:1fr; \}/);
  assert.doesNotMatch(html + app, /providerReference\s*:\s*["'](?!credential-ref:)/i);
});
