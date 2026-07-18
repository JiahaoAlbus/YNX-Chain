import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("independent Web Product exposes dense IDE workflow and accessibility landmarks", async () => {
  const html = await read("index.html");
  for (const evidence of ["YNX Developer", "WEB IDE", "Source control review", "YNX AI Build", "RPC Tools", "Receipts & logs", "Artifact Center", "Wallet only", "Skip to editor", "aria-label=\"Source editor\""]) assert.match(html, new RegExp(evidence, "i"));
  assert.match(html, /ynx_6423-1/); assert.match(html, /Solidity 0\.8\.24/);
});

test("visual foundation is Klein blue and responsive without benchmark branding", async () => {
  const css = await read("styles.css");
  assert.match(css, /--blue:#002FA7/); assert.match(css, /data-theme="dark"/); assert.match(css, /@media \(max-width:740px\)/); assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch((await read("index.html")).toLowerCase(), /visual studio code|vscode|remix logo/);
});

test("YNX AI Build exposes plan, permission, provider, checkpoint and audit controls", async () => {
  const html=await read("index.html"), app=await read("app.js");
  for(const evidence of ["Preview plan","Approved context","Approved Grok via ACP sidecar","Local inference","PERMISSIONS","Allow one project write","exportAudit","checkpoint"]) assert.match(html+app,new RegExp(evidence,"i"));
  assert.match(app,/AIBuildPersistence/); assert.match(app,/requestPermission\("network"/); assert.match(app,/requestPermission\("write"/);
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
  const html=await read("index.html"), app=await read("app.js"), mac=await read("desktop/macos/main.m"), windows=await read("desktop/windows/MainWindow.xaml.cs");
  assert.match(html,/locale-select/); assert.match(html,/ai-language/); assert.match(app,/DeveloperI18n/); assert.match(app,/DeveloperWalletSession/);
  for(const source of [mac,windows]) { assert.match(source,/Testnet Preview/); assert.match(source,/Check(?: for )?Updates/); assert.match(source,/window|Window/); }
  assert.match(mac,/New Project/); assert.match(windows,/owner-signed manifest/); assert.doesNotMatch(mac+windows,/production release is signed/i);
});

test("macOS package gate verifies extracted cold launch and bundled runtime cleanup", async () => {
  const packageScript=await read("scripts/package-local-macos.sh"), verify=await read("scripts/verify-local-macos-package.sh"), source=await read("desktop/macos/main.m");
  assert.match(packageScript,/desktop\/macos\/main\.m/); assert.match(packageScript,/Resources\/runtime\/node/); assert.match(packageScript,/codesign --force --deep --sign -/);
  assert.match(verify,/cold launch/); assert.match(verify,/pgrep -P/); assert.match(verify,/server\.mjs/); assert.match(verify,/survived App termination/);
  assert.match(source,/\[_server waitUntilExit\]/);
});

test("desktop Grok Build sidecar is pinned, shell-free and permission brokered",async()=>{
  const source=await read("desktop/grok-build-sidecar.mjs");assert.match(source,/98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce/);assert.match(source,/124d85bc5dc6e7805560215fcc6d5413944920e1/);assert.match(source,/\["agent", "stdio"\]/);assert.match(source,/shell: false/);assert.match(source,/permissionBroker/);assert.doesNotMatch(source,/shell:\s*true/);
});

test("Windows proof requires a real Windows build, portable install and cold launch",async()=>{
  const packageScript=await read("scripts/package-windows.ps1"),verify=await read("scripts/verify-windows-package.ps1");
  const workflow=await readFile(new URL("../../../.github/workflows/developer-windows.yml",import.meta.url),"utf8");
  assert.match(packageScript,/dotnet publish/);assert.match(packageScript,/node\.exe/);assert.match(packageScript,/Get-FileHash/);
  assert.match(verify,/--self-test/);assert.match(verify,/CloseMainWindow/);assert.match(verify,/child survived App shutdown/);
  assert.match(workflow,/runs-on: windows-latest/);assert.match(workflow,/package-windows\.ps1/);assert.match(workflow,/verify-windows-package\.ps1/);assert.match(workflow,/upload-artifact@v4/);
});

test("release evidence includes UI audit, SBOM and exact upstream source record",async()=>{
  const audit=await read("docs/UI_DESIGN_AUDIT.md"),integration=await read("docs/GROK_BUILD_INTEGRATION.md"),sbom=await read("sbom.cdx.json");
  for(const value of ["desktop-light-1440x900","mobile-arabic-rtl-390x844","loading-compile-1440x900","failure-provider-unavailable-390x844"])assert.match(audit,new RegExp(value));
  assert.match(integration,/5d9cd70fb23fa2d0ada9b05b8d381b73a50cf535d38a8f0ad00c9d1daf9db31f/);
  assert.match(sbom,/CycloneDX/);assert.match(sbom,/grok-build/);assert.match(sbom,/"ynx:bundled","value":"false"/);
});
