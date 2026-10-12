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
  const messages = await read("../../packages/developer-client/src/api-i18n.js");
  assert.match(html + app + messages, /browser JavaScript never receives credential values/i);
  assert.match(app, /credentialBroker: globalThis\.ynxCredentialBroker/);
  assert.match(app, /allowedOrigins: \[location\.origin\]/);
  assert.match(css, /\.api-grid/);
  assert.match(css, /\.rpc-row,\.api-grid \{ grid-template-columns:1fr; \}/);
  assert.doesNotMatch(html + app, /providerReference\s*:\s*["'](?!credential-ref:)/i);
});

test("API Studio localizes dynamic states and exposes keyboard, RTL and 390px accessibility gates", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  const css = await read("styles.css");
  for (const key of ["apiStudio","connectorTemplate","previewRequest","failureSimulation","apiBoundaryNote"]) {
    assert.match(html, new RegExp(`data-i18n=["']${key}["']`));
  }
  assert.match(html, /id="api-output"[^>]+data-api-state="empty"[^>]+aria-live="polite"[^>]+tabindex="0"/);
  assert.match(app, /apiMessageKeyForError/);
  assert.match(app, /i18n\.t\("apiApprovalTitle"\)/);
  assert.match(app, /event\.key==="ArrowRight"/);
  assert.match(app, /setAttribute\("role","tablist"\)/);
  assert.match(app, /setAttribute\("aria-selected",String\(active\)\)/);
  assert.match(css, /\[dir="rtl"\][^{]+\.api-studio/);
  assert.match(css, /@media \(max-width:740px\)/);
  assert.match(css, /\.api-toolbar label \{ width:100%; min-width:0; \}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});
