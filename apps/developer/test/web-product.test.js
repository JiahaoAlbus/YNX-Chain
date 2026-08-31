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

test("Monaco editor is bundled with language models, completion and worker CSP", async () => {
  const html=await read("index.html"),app=await read("app.js"),build=await read("scripts/build.mjs"),server=await read("scripts/server.mjs"),desktop=await read("desktop/server.mjs");
  assert.match(html,/monaco\/vs\/loader\.js/); assert.match(html,/data-editor-engine="monaco"/);
  for(const value of ["solidity","cpp","typescript","javascript","python","java","csharp","go","rust","shell","sql","yaml"])assert.match(app,new RegExp(`\\b${value}\\b`));
  assert.match(app,/registerCompletionItemProvider\("solidity"/);assert.match(app,/registerCompletionItemProvider\("cpp"/);assert.match(app,/bracketPairColorization/);assert.match(app,/quickSuggestions/);assert.match(app,/tabCompletion/);
  assert.match(build,/node_modules\/monaco-editor\/min\/vs/);for(const source of [server,desktop])assert.match(source,/worker-src 'self' blob:/);
  assert.match(server,/const developmentMonaco = monacoAsset && process\.env\.NODE_ENV !== "production"/);assert.match(server,/developmentMonaco \? pathname\.slice\(8\).*pathname\.slice\(1\)/);
  assert.match(build,/cp\(monaco, `\$\{dist\}\/monaco\/vs`/);
});

test("extension workspace separates editing languages from real removable desktop compilers",async()=>{
  const html=await read("index.html"),app=await read("app.js"),desktop=await read("desktop/server.mjs");
  for(const value of ["Language and compiler extensions","Install language pack","Install compiler adapter","Installed language packs","Compiler adapters","Editing support never implies a compiler"])assert.match(html+app,new RegExp(value,"i"));
  assert.match(desktop,/runtime\/toolchains\/remove/);assert.match(desktop,/remove-local-toolchain-once/);assert.match(desktop,/built-in adapters cannot be removed/i);
});

test("YNX AI Build exposes plan, permission, provider, checkpoint and audit controls", async () => {
  const html=await read("index.html"), app=await read("app.js");
  for(const evidence of ["Preview plan","Approved context","Official Grok Build ACP sidecar","YNX hosted open model","Session-only API key","PERMISSIONS","Allow one project write","exportAudit","checkpoint"]) assert.match(html+app,new RegExp(evidence,"i"));
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
  const html=await read("index.html"), app=await read("app.js"), mac=await read("desktop/macos/main.m"), plist=await read("desktop/macos/Info.plist"), windows=await read("desktop/windows/MainWindow.xaml.cs");
  assert.match(html,/locale-select/); assert.match(html,/ai-language/); assert.match(app,/DeveloperI18n/); assert.match(app,/DeveloperWalletSession/);
  for(const source of [mac,windows]) { assert.match(source,/Testnet Preview/); assert.match(source,/Check(?: for )?Updates/); assert.match(source,/window|Window/); }
  assert.match(mac,/New Project/); assert.match(mac,/ynxDesktopWallet/); assert.match(mac,/open-authorization/); assert.match(mac,/developer-deploy/); assert.match(mac,/ynx-wallet-callback/); assert.match(mac,/ynx-deployment-callback/); assert.match(plist,/com\.ynxweb4\.developer\.testnetpreview\.wallet-auth/); assert.match(plist,/>ynxdeveloper</); assert.match(windows,/owner-signed manifest/); assert.doesNotMatch(mac+windows,/production release is signed/i);
  const transport=await read("frontend/src/wallet/transport.ts"),broker=await read("services/wallet-readiness/src/service.mjs");assert.match(transport,/non-extractable|false, \["sign", "verify"\]/);assert.match(transport,/YNX_PRODUCT_SESSION_CHALLENGE_V1/);assert.match(transport,/derSignature/);assert.match(broker,/remoteDeployed/);assert.match(broker,/publicDeploymentReady/);assert.match(broker,/wallet\/sessions\/complete/);
});

test("macOS DMG gate verifies mounted cold launch and bundled runtime cleanup", async () => {
  const packageScript=await read("scripts/package-local-macos.sh"), verify=await read("scripts/verify-local-macos-package.sh"), source=await read("desktop/macos/main.m"), codeServer=await read("desktop/code-server.mjs"), gatewayServer=await read("services/gateway/src/server.mjs"), sbomGenerator=await read("scripts/generate-code-sbom.mjs");
  assert.match(packageScript,/desktop\/macos\/main\.m/); assert.match(packageScript,/Resources\/runtime\/node/); assert.match(packageScript,/codesign --force --deep --sign -/);
  assert.match(packageScript,/hdiutil create/); assert.match(packageScript,/unsigned\.dmg/); assert.doesNotMatch(packageScript,/ditto -c -k/);
  assert.match(packageScript,/npm run code:build/); assert.match(packageScript,/frontend\/dist/); assert.match(packageScript,/services/); assert.match(packageScript,/node_modules/); assert.doesNotMatch(packageScript,/npm run build\s/); assert.match(packageScript,/find .*Contents\/Resources.*type f/); assert.match(packageScript,/codesign --force --sign -.*bundled_binary/);
  assert.match(packageScript,/Refusing to package tracked Developer changes/); assert.match(packageScript,/build-provenance\.json/); assert.match(packageScript,/sbom\.cdx\.json/); assert.match(packageScript,/sourceDirty: false/);
  assert.match(verify,/hdiutil attach/); assert.match(verify,/hdiutil detach/); assert.match(verify,/cold launch/); assert.match(verify,/pgrep -P/); assert.match(verify,/server\.mjs/); assert.match(verify,/survived App termination/); assert.match(verify,/workspace survived second launch/); assert.match(verify,/runtime\/tasks/); assert.match(verify,/runtime\/language\/cpp/); assert.match(verify,/documentSymbols/); assert.match(verify,/darwin-arm64/); assert.match(verify,/darwin-x64/); assert.match(verify,/node-pty\/prebuilds\/\$pty_arch\/pty\.node/);
  assert.match(verify,/provenance sourceCommit mismatch|provenance \$\{key\} mismatch/); assert.match(verify,/sbomSha256/); assert.match(verify,/YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT/);
  assert.match(packageScript,/generate-code-sbom\.mjs/); assert.match(verify,/components\.length < 100/); assert.match(sbomGenerator,/CycloneDX/); assert.match(sbomGenerator,/package-lock\.json/); assert.match(sbomGenerator,/Node\.js/); assert.match(sbomGenerator,/nodeVersion/);
  assert.match(codeServer,/workspace-session\.key/); assert.match(codeServer,/YNX_CODE_WORKSPACE_SESSION_KEY/); assert.match(codeServer,/services.*gateway.*server\.mjs/s); assert.match(codeServer,/mode: 0o600/); assert.match(codeServer,/process\.ppid !== desktopParent/); assert.match(codeServer,/SIGTERM/);
  assert.match(gatewayServer,/closeIdleConnections/); assert.match(gatewayServer,/closeAllConnections/); assert.match(gatewayServer,/Promise\.allSettled/);
  assert.match(source,/\[_server waitUntilExit\]/);
});

test("desktop Grok Build sidecar is pinned, shell-free and permission brokered",async()=>{
  const source=await read("desktop/grok-build-sidecar.mjs");assert.match(source,/98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce/);assert.match(source,/124d85bc5dc6e7805560215fcc6d5413944920e1/);assert.match(source,/\["agent", "stdio"\]/);assert.match(source,/shell: false/);assert.match(source,/permissionBroker/);assert.doesNotMatch(source,/shell:\s*true/);
});

test("Windows proof requires a real Windows build, MSIX installation and cold launch",async()=>{
  const packageScript=await read("scripts/package-windows.ps1"),verify=await read("scripts/verify-windows-package.ps1"),installerVerify=await read("scripts/verify-windows-installer.ps1"),nativeSelfTest=await read("desktop/windows/App.xaml.cs"),windowsHost=await read("desktop/windows/MainWindow.xaml.cs");
  const workflow=await readFile(new URL("../../../.github/workflows/developer-windows.yml",import.meta.url),"utf8");
  assert.match(packageScript,/dotnet publish/);assert.match(packageScript,/hosted-workspace-client/);assert.match(packageScript,/Get-FileHash/);assert.match(packageScript,/Refusing to package tracked Developer changes/);
  assert.match(packageScript,/build-provenance\.json/);assert.match(packageScript,/sbom\.cdx\.json/);assert.match(packageScript,/SignTool\.exe/);assert.match(packageScript,/unsigned-no-authenticode/);assert.match(installerVerify,/Cert:\\LocalMachine\\TrustedPeople/);
  assert.match(packageScript,/MakeAppx\.exe/);assert.match(packageScript,/Windows Kits\\10\\bin/);assert.match(packageScript,/\.msix/);assert.match(packageScript,/test-self-signed-not-production/);assert.match(packageScript,/New-SelfSignedCertificate/);assert.doesNotMatch(packageScript,/AppListEntry="none"/);
  assert.match(verify,/--self-test/);assert.match(verify,/CloseMainWindow/);assert.match(verify,/realCppCompile/);assert.match(verify,/runtime\/tasks/);assert.match(verify,/second launch/);assert.match(verify,/YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT/);
  assert.match(verify,/provenance sourceCommit/);assert.match(verify,/artifactSha256/);assert.match(verify,/authenticodeStatus/);assert.match(nativeSelfTest,/build-provenance\.json/);assert.match(nativeSelfTest,/sbom\.cdx\.json/);
  assert.match(installerVerify,/Add-AppxPackage/);assert.match(installerVerify,/Remove-AppxPackage/);assert.match(installerVerify,/explorer\.exe/);assert.match(installerVerify,/installedExecutable/);assert.match(installerVerify,/test-self-signed-not-production/);assert.match(installerVerify,/second launch/);
  assert.match(nativeSelfTest,/hosted-workspace-client/);assert.match(nativeSelfTest,/MainWindow\.WorkspaceUrl/);assert.match(windowsHost,/https:\/\/developer\.ynxweb4\.com\//);assert.match(windowsHost,/healthz/);
  for(const script of [packageScript,verify]) { assert.match(script,/featureStatus\.ynxCodePlatform\.webSourceCommit/);assert.match(script,/publicDeployment\.sourceCommit/);assert.doesNotMatch(script,/ynxCodePlatform\.sourceCommit/); }
  assert.match(workflow,/runs-on: windows-latest/);assert.match(workflow,/codex\/ynx-code-platform-v1/);assert.match(workflow,/developer-windows-\$\{\{ github\.ref \}\}/);
  assert.match(workflow,/Install pinned Developer dependencies/);assert.match(workflow,/working-directory: apps\/developer\s+run: npm ci --ignore-scripts/);
  assert.match(workflow,/Microsoft\.WindowsSDK\.10\.0\.26100/);assert.match(workflow,/package-windows\.ps1/);assert.match(workflow,/verify-windows-package\.ps1/);assert.match(workflow,/verify-windows-installer\.ps1/);assert.match(workflow,/\.msix/);assert.match(workflow,/upload-artifact@v4/);
});

test("release evidence includes UI audit, SBOM and exact upstream source record",async()=>{
  const audit=await read("docs/UI_DESIGN_AUDIT.md"),integration=await read("docs/GROK_BUILD_INTEGRATION.md"),sbom=await read("sbom.cdx.json");
  for(const value of ["desktop-light-1440x900","mobile-arabic-rtl-390x844","loading-compile-1440x900","failure-provider-unavailable-390x844"])assert.match(audit,new RegExp(value));
  assert.match(integration,/5d9cd70fb23fa2d0ada9b05b8d381b73a50cf535d38a8f0ad00c9d1daf9db31f/);
  assert.match(sbom,/CycloneDX/);assert.match(sbom,/grok-build/);assert.match(sbom,/"ynx:bundled","value":"false"/);
});

test("product release truth separates local proof from central, deployment and signing states",async()=>{
  const release=JSON.parse(await read("product-release.json"));
  for(const key of ["productId","name","branch","commit","version","surfaces","implementedLocal","testedLocal","installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased","publicUrls","healthUrls","artifactUrls","sha256","bytes","signingClass","minOS","installEvidence","centralIntegration","knownLimitations","generatedAt"])assert.ok(Object.hasOwn(release,key),`missing ${key}`);
  assert.equal(release.implementedLocal,true);assert.equal(release.testedLocal,true);assert.equal(release.installedLocal,true);
  for(const key of ["integratedCentral","productionSigned","storeReleased"])assert.equal(release[key],false,key);
  for(const key of ["deployedStaging","deployedPublic"])assert.equal(release[key],true,key);
  assert.equal(release.downloadHosted,false);assert.equal(release.releasePublished,true);
  assert.equal(release.publicUrls.length,2);assert.equal(release.healthUrls.length,2);assert.equal(release.artifactUrls.length,0);
});
