import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("independent Web Product exposes dense IDE workflow and accessibility landmarks", async () => {
  const html = await read("index.html");
  for (const evidence of ["YNX Developer", "WEB PRODUCT", "Source control review", "AI Coding Agent", "RPC Tools", "Receipts & logs", "Wallet only", "Skip to editor", "aria-label=\"Source editor\""]) assert.match(html, new RegExp(evidence, "i"));
  assert.match(html, /ynx_6423-1/); assert.match(html, /Solidity 0\.8\.24/);
});

test("visual foundation is Klein blue and responsive without benchmark branding", async () => {
  const css = await read("styles.css");
  assert.match(css, /--blue:#002FA7/); assert.match(css, /@media \(max-width:740px\)/); assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch((await read("index.html")).toLowerCase(), /visual studio code|vscode|remix logo/);
});

test("unsupported execution and signing paths are explicit", async () => {
  const app = await read("app.js");
  for (const evidence of ["Web Product cannot execute local commands", "Submission is not confirmation", "not established", "Wallet", "bounded"] ) assert.match(app, new RegExp(evidence, "i"));
  assert.doesNotMatch(app, /privateKey|seed phrase|mnemonic/i);
});

test("CSP and build do not permit inline script or embedded provider secrets", async () => {
  const server = await read("scripts/server.mjs"); const html = await read("index.html");
  assert.match(server, /object-src 'none'/); assert.match(server, /frame-ancestors 'none'/); assert.doesNotMatch(html, /<script(?![^>]*src=)/i); assert.doesNotMatch(await read("app.js"), /OPENAI_API_KEY|sk-[a-z0-9]{20,}/i);
});

test("local servers expose only bounded same-origin YNX proxy prefixes", async () => {
  for (const file of ["scripts/server.mjs", "desktop/server.mjs"]) {
    const server = await read(file); assert.match(server, /"\/chain"/); assert.match(server, /"\/ai-gateway"/); assert.match(server, /"\/app-gateway"/); assert.match(server, /2 \* 1024 \* 1024/); assert.doesNotMatch(server, /request\.headers\s*[,}]/);
  }
});

test("localized UI and native desktop sources preserve language, permission and release boundaries", async () => {
  const html=await read("index.html"), app=await read("app.js"), mac=await read("desktop/macos/main.swift"), windows=await read("desktop/windows/MainWindow.xaml.cs");
  assert.match(html,/locale-select/); assert.match(html,/ai-language/); assert.match(app,/DeveloperI18n/); assert.match(app,/DeveloperWalletSession/);
  for(const source of [mac,windows]) { assert.match(source,/Testnet Preview/); assert.match(source,/Check(?: for )?Updates/); assert.match(source,/window|Window/); }
  assert.match(mac,/New Project/); assert.match(windows,/owner-signed manifest/); assert.doesNotMatch(mac+windows,/production release is signed/i);
});
