import { app, BrowserWindow, WebContentsView, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserState, PhishingPolicy } from "./state.js";
import { PermissionStore, ReplayGuard, canonicalOrigin, originPartition, reviewTransaction, securitySummary, selectAiContext, validateWalletRequest } from "@ynx/web4-permissions";

app.commandLine.appendSwitch("site-per-process");
app.commandLine.appendSwitch("enable-features", "StrictOriginIsolation");

let window; let activeView; let activeTab; const views = new Map(); const replay = new ReplayGuard(); const aiRuns = new Map();
const state = new BrowserState(join(app.getPath("userData"), "browser-state.json"));
const permissions = new PermissionStore(join(app.getPath("userData"), "site-permissions.json"));
const phishing = new PhishingPolicy({ blockedOrigins: (process.env.YNX_BROWSER_BLOCKED_ORIGINS ?? "").split(',').filter(Boolean) });

async function emitState(extra = {}) { if (window && !window.isDestroyed()) window.webContents.send("browser:state", { tabs: await state.tabs(), activeTab, ...extra }); }
function bounds() { const [width, height] = window.getContentSize(); return { x: 264, y: 112, width: Math.max(320, width - 264), height: Math.max(240, height - 112) }; }
function normalizeNavigation(input) { const text = input.trim(); if (/^https?:\/\//i.test(text)) return new URL(text).href; return `https://search.ynx.local/?q=${encodeURIComponent(text)}`; }

async function makeView(tab) {
  let view = views.get(tab.id); if (view) return view;
  const partition = tab.privateMode ? originPartition(tab.url, { privateSessionId: tab.id }) : originPartition(tab.url);
  const ses = session.fromPartition(partition, { cache: !tab.privateMode });
  ses.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    const mapped = permission === "media" ? (details.mediaTypes?.includes("video") ? "camera" : "microphone") : permission;
    try { callback((await permissions.get(details.requestingUrl, mapped, { privateSessionId: tab.privateMode ? tab.id : undefined })) === "allow"); } catch { callback(false); }
  });
  view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false } });
  view.webContents.setWindowOpenHandler(({ url }) => { void openTab(url, { privateMode: tab.privateMode }); return { action: "deny" }; });
  view.webContents.on("will-navigate", (event, url) => { if (url.startsWith("ynx-wallet://authorize")) { event.preventDefault(); try { const request=JSON.parse(new URL(url).searchParams.get("request")); emitState({ walletRequest: request }); } catch { emitState({ warning: { kind: "wallet", message: "Malformed Wallet request rejected." } }); } return; } const result = phishing.check(url); if (result.action === "warn") { event.preventDefault(); emitState({ warning: { kind: "phishing", url, ...result } }); } });
  view.webContents.on("did-navigate", async (_event, url) => { activeTab = await state.updateTab(tab.id, { url, title: view.webContents.getTitle(), crashed: false }); await state.recordVisit(activeTab, { url, title: activeTab.title }); emitState(); });
  view.webContents.on("page-title-updated", async (_event, title) => { activeTab = await state.updateTab(tab.id, { title }); emitState(); });
  view.webContents.on("render-process-gone", async (_event, details) => { activeTab = await state.updateTab(tab.id, { crashed: true }); emitState({ crash: { reason: details.reason, recoverable: true } }); });
  ses.on("will-download", (_event, item) => { const record = { filename: item.getFilename(), url: item.getURL(), state: "progressing", receivedBytes: 0, totalBytes: item.getTotalBytes() }; item.on("updated", () => state.recordDownload({ ...record, state: item.getState(), receivedBytes: item.getReceivedBytes() }, { privateMode: tab.privateMode })); });
  views.set(tab.id, view); return view;
}

async function activate(tab) { if (activeView) window.contentView.removeChildView(activeView); activeTab = tab; activeView = await makeView(tab); window.contentView.addChildView(activeView); activeView.setBounds(bounds()); activeView.webContents.focus(); emitState(); }
async function openTab(url, options = {}) { const tab = await state.openTab(normalizeNavigation(url), options); await activate(tab); await activeView.webContents.loadURL(tab.url); return tab; }

app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 900, minHeight: 640, backgroundColor: "#FFFFFF", title: "YNX Browser", webPreferences: { preload: join(import.meta.dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.removeMenu(); window.on("resize", () => activeView?.setBounds(bounds())); window.on("closed", () => state.closePrivateWindow());
  await window.loadURL(pathToFileURL(join(import.meta.dirname, "renderer", "index.html")).href);
  const recovered = await state.recoveryPlan(); if (recovered.length) { const tab = recovered.at(-1); await activate(tab); await activeView.webContents.loadURL(tab.url); } else await openTab("https://search.ynx.local");
});

ipcMain.handle("browser:snapshot", async () => ({ ...(await state.snapshot()), tabs: await state.tabs(), activeTab }));
ipcMain.handle("browser:open-tab", (_e, url, options) => openTab(url, options));
ipcMain.handle("browser:close-tab", async (_e, id) => { const view = views.get(id); if (view) { window.contentView.removeChildView(view); view.webContents.close(); views.delete(id); } await state.closeTab(id); const tabs = await state.tabs(); if (tabs.length) await activate(tabs.at(-1)); else await openTab("https://search.ynx.local"); });
ipcMain.handle("browser:activate-tab", async (_e, id) => { const snapshot = await state.snapshot(); const tab = snapshot.tabs.find(item => item.id === id); if (!tab) throw new Error("tab not found"); await activate(tab); });
ipcMain.handle("browser:navigate", (_e, input) => activeView.webContents.loadURL(normalizeNavigation(input)));
ipcMain.handle("browser:back", () => activeView.webContents.navigationHistory.canGoBack() && activeView.webContents.navigationHistory.goBack());
ipcMain.handle("browser:forward", () => activeView.webContents.navigationHistory.canGoForward() && activeView.webContents.navigationHistory.goForward());
ipcMain.handle("browser:reload", () => activeView.webContents.reload());
ipcMain.handle("browser:bookmark", () => state.addBookmark({ title: activeTab.title, url: activeTab.url }));
ipcMain.handle("browser:permission-decision", async (_e, permission, decision) => { const origin = canonicalOrigin(activeTab.url); const record = await permissions.decide(origin, permission, decision, { privateSessionId: activeTab.privateMode ? activeTab.id : undefined }); await state.recordAudit("permission-decision", { origin, permission, decision }); return record; });
ipcMain.handle("browser:security-info", () => securitySummary(activeTab.url, activeView.webContents.getSSLInfo?.()));
ipcMain.handle("browser:transaction-review", (_e, tx) => reviewTransaction(tx));
ipcMain.handle("browser:wallet-authorize", async (_e, request, decision) => { const policy = JSON.parse(process.env.YNX_BROWSER_WALLET_POLICY ?? '{"allowedCallbacks":{},"allowedScopes":{}}'); const validated = validateWalletRequest(request, policy); replay.consume(validated.requestId, validated.expiresAt); await state.recordAudit("wallet-authorization", { requestId: validated.requestId, origin: validated.origin, scopes: validated.scopes, decision }); if (decision !== "approve") return { status: "rejected" }; return { status: "approved-for-wallet-handoff", callback: validated.callback, request: validated }; });
ipcMain.handle("browser:ai-prepare", async (_e, input) => { const context = selectAiContext(input); await state.recordAudit("ai-context-approved", { action: context.action, urls: context.pages.map(p => p.url) }); return { context, gateway: process.env.YNX_AI_GATEWAY_URL ? "configured" : "unavailable", estimate: { unit: "tokens", maximum: context.pages.reduce((n, p) => n + p.text.length, 0) } }; });
ipcMain.handle("browser:ai-current-page", async () => { if(activeTab.privateMode)throw new Error("AI is unavailable for private tabs");const text=await activeView.webContents.executeJavaScript("document.body?.innerText?.slice(0, 50000) ?? ''",true);return selectAiContext({action:"summarize-page",currentPage:{authorized:true,private:false,url:activeTab.url,title:activeTab.title,text}}); });
ipcMain.handle("browser:ai-run", async (_e, input) => { if(!input?.approved)throw new Error("explicit AI permission required");const context=selectAiContext(input.context);const gateway=process.env.YNX_AI_GATEWAY_URL, token=process.env.YNX_AI_GATEWAY_CLIENT_TOKEN;if(!gateway||!token)throw new Error("YNX AI Gateway unavailable");const id=crypto.randomUUID();const controller=new AbortController();aiRuns.set(id,controller);await state.recordAudit("ai-run-started",{id,action:context.action,urls:context.pages.map(p=>p.url),model:input.model??"default",contextClasses:context.contextClasses,reviewer:"user"});(async()=>{try{const response=await fetch(new URL("/v1/browser/assist",gateway),{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${token}`},body:JSON.stringify({workflow:context.action,model:input.model??"default",context}),signal:controller.signal});if(!response.ok)throw new Error(`AI Gateway failed with HTTP ${response.status}`);for await(const chunk of response.body)window.webContents.send("browser:state",{aiChunk:{id,text:new TextDecoder().decode(chunk)}});window.webContents.send("browser:state",{aiDone:{id}});await state.recordAudit("ai-run-completed",{id});}catch(error){window.webContents.send("browser:state",{aiError:{id,message:error.name==="AbortError"?"cancelled":error.message}});await state.recordAudit(error.name==="AbortError"?"ai-run-cancelled":"ai-run-failed",{id,message:error.message});}finally{aiRuns.delete(id)}})();return{id};});
ipcMain.handle("browser:ai-cancel",async(_e,id)=>{aiRuns.get(id)?.abort();return{cancelled:true}});
ipcMain.handle("browser:ai-review",async(_e,id,decision)=>{if(!['accept','reject'].includes(decision))throw new Error("invalid AI review");await state.recordAudit("ai-result-reviewed",{id,decision,reviewer:"user"});return{decision}});
app.on("web-contents-created", (_event, contents) => contents.on("will-attach-webview", event => event.preventDefault()));
app.on("window-all-closed", () => app.quit());
