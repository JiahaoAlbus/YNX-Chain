import { AIBuildPersistence, AIBuildRun, GROK_BUILD_ACP } from "/client/ai-build.js";
import { apiMessageKeyForError } from "/client/api-i18n.js?v=1";
import { OpenAPIStudio, createConnectorTemplate, listConnectorTemplates } from "/client/api-studio.js";
import { AICodingAgent } from "/client/ai.js";
import { YNXChainClient } from "/client/chain-client.js";
import { CommandAudit, commandPreview } from "/client/commands.js";
import { sourceDiagnostics } from "/client/diagnostics.js";
import { errorMessage } from "/client/errors.js";
import { DeveloperI18n, SUPPORTED_LOCALES } from "/client/i18n.js?v=2";
import { IndexedDBPersistence, ProjectWorkspace } from "/client/project.js";
import { DeveloperWalletSession } from "/client/wallet-auth.js";
import { WalletDeployment } from "/client/wallet.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
const config = { chainURL: localStorage.getItem("ynx.developer.v1.chainURL") || "/chain", compilerURL: "/compiler", aiURL: "/ai-build" };
const workspace = new ProjectWorkspace({ persistence: new IndexedDBPersistence() });
const chain = new YNXChainClient({ baseURL: config.chainURL, compilerURL: config.compilerURL });
const ai = new AICodingAgent({ gatewayURL: config.aiURL, managedSession: true });
const i18n = new DeveloperI18n();
const walletSession = new DeveloperWalletSession({ transport: globalThis.ynxDesktopWallet, authorizationBuilder: globalThis.ynxWalletAuthorization?.encodeRequestDeepLink, authorizationCallbackParser: globalThis.ynxWalletAuthorization?.parseAuthorizationCallbackURL });
const commands = new CommandAudit({ executor: globalThis.ynxDesktop?.executeApprovedCommand || executeDesktopTask });
const deployment = new WalletDeployment({ wallet: globalThis.ynxWallet, chainClient: chain });
const apiStudio = new OpenAPIStudio({ defaultOrigin: location.origin, allowedOrigins: [location.origin], credentialBroker: globalThis.ynxCredentialBroker });
const aiBuildPersistence = new AIBuildPersistence(localStorage);
const state = { project: null, path: null, artifact: null, aiPrepared: null, aiResult: null, aiBuild: null, aiProposalId: null, deployReview: null, apiPreview: null, apiConnector: "oracle", saveTimer: null };
let monacoAPI = null;
let codeEditor = null;
const editorModels = new Map();
const customLanguageExtensions = new Map();
const BUILTIN_LANGUAGE_EXTENSIONS = Object.freeze({
  ".sol": "solidity", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript", ".json": "json",
  ".html": "html", ".css": "css", ".scss": "scss", ".md": "markdown",
  ".c": "c", ".h": "cpp", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp",
  ".py": "python", ".java": "java", ".cs": "csharp", ".go": "go", ".rs": "rust",
  ".sh": "shell", ".bash": "shell", ".sql": "sql", ".xml": "xml", ".yaml": "yaml", ".yml": "yaml"
});
const languageForPath = (path = "") => { const lower=path.toLowerCase();const custom=[...customLanguageExtensions].find(([extension])=>lower.endsWith(extension));if(custom)return custom[1];const extension=Object.keys(BUILTIN_LANGUAGE_EXTENSIONS).find((item)=>lower.endsWith(item));return BUILTIN_LANGUAGE_EXTENSIONS[extension]||"plaintext"; };

function editorText() { return codeEditor?.getValue() ?? $("#editor").dataset.editorValue ?? $("#editor").textContent ?? ""; }
function modelKey(path) { return `${state.project?.id || "detached"}:${path}`; }
function setEditorText(value, path) {
  const host = $("#editor"); host.dataset.editorValue = value;
  if (!codeEditor || !monacoAPI) { host.textContent = value; return; }
  const key = modelKey(path); let model = editorModels.get(key);
  if (!model) {
    const uri = monacoAPI.Uri.from({ scheme: "ynx-project", authority: state.project?.id || "detached", path: `/${path}` });
    model = monacoAPI.editor.getModel(uri) || monacoAPI.editor.createModel(value, languageForPath(path), uri);
    editorModels.set(key, model);
  } else if (model.getValue() !== value) model.setValue(value);
  codeEditor.setModel(model);
}

function registerSolidityLanguage(monaco) {
  if (monaco.languages.getLanguages().some((item) => item.id === "solidity")) return;
  monaco.languages.register({ id: "solidity", extensions: [".sol"], aliases: ["Solidity", "sol"] });
  monaco.languages.setMonarchTokensProvider("solidity", {
    defaultToken: "", tokenPostfix: ".sol",
    keywords: ["pragma","solidity","contract","interface","library","function","constructor","modifier","event","error","struct","enum","mapping","address","bool","string","bytes","uint","uint256","int","int256","public","private","internal","external","view","pure","payable","returns","return","if","else","for","while","emit","revert","require","assert","memory","storage","calldata","immutable","constant","override","virtual","is","new","delete","this","super"],
    tokenizer: { root: [[/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }], [/0x[0-9a-fA-F]+/, "number.hex"], [/\d+(?:\.\d+)?/, "number"], [/"([^"\\]|\\.)*$/, "string.invalid"], [/"/, { token: "string.quote", bracket: "@open", next: "@string" }], [/\/\//, "comment", "@lineComment"], [/\/\*/, "comment", "@comment"], [/[{}()\[\]]/, "@brackets"], [/[;,.]/, "delimiter"]], string: [[/[^\\"]+/, "string"], [/\\./, "string.escape"], [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }]], comment: [[/[^/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[/*]/, "comment"]], lineComment: [[/.*$/, "comment", "@pop"]] }
  });
  monaco.languages.setLanguageConfiguration("solidity", { comments: { lineComment: "//", blockComment: ["/*", "*/"] }, brackets: [["{","}"],["[","]"],["(",")"]], autoClosingPairs: [{open:"{",close:"}"},{open:"[",close:"]"},{open:"(",close:")"},{open:'"',close:'"'}] });
  const words = ["contract","function","constructor","modifier","event","mapping","address","uint256","bytes32","public","private","internal","external","view","pure","payable","returns","memory","storage","calldata","require","revert","emit"];
  monaco.languages.registerCompletionItemProvider("solidity", { provideCompletionItems(model, position) { const word=model.getWordUntilPosition(position); const range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn}; return { suggestions: words.map((label)=>({label,kind:monaco.languages.CompletionItemKind.Keyword,insertText:label,range})) }; } });
}

function registerCppCompletions(monaco) {
  const words = ["#include","namespace","using","class","struct","template","typename","auto","const","constexpr","public","private","protected","virtual","override","std::string","std::vector","std::cout","std::cin","nullptr","return"];
  monaco.languages.registerCompletionItemProvider("cpp", { provideCompletionItems(model, position) { const word=model.getWordUntilPosition(position); const range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn}; return { suggestions: words.map((label)=>({label,kind:monaco.languages.CompletionItemKind.Keyword,insertText:label,range})) }; } });
}

function validateLanguagePack(value) {
  if(!value||typeof value!=="object"||!/^[-a-z0-9]{2,40}$/.test(value.id))throw new Error("Language pack id must contain 2-40 lowercase letters, numbers or hyphens.");
  const extensions=Array.isArray(value.extensions)?value.extensions:[];if(!extensions.length||extensions.length>16||extensions.some((item)=>!/^\.[a-z0-9][a-z0-9+_-]{0,11}$/.test(item)))throw new Error("Language pack requires 1-16 safe file extensions.");
  const keywords=Array.isArray(value.keywords)?value.keywords:[];if(keywords.length>512||keywords.some((item)=>typeof item!=="string"||item.length>64))throw new Error("Language pack keywords are invalid.");
  return{id:value.id,aliases:Array.isArray(value.aliases)?value.aliases.filter((item)=>typeof item==="string").slice(0,8):[value.id],extensions:[...new Set(extensions)],keywords:[...new Set(keywords)],lineComment:typeof value.lineComment==="string"&&value.lineComment.length<=4?value.lineComment:"//"};
}
function registerLanguagePack(monaco, pack) {
  if(!monaco.languages.getLanguages().some((item)=>item.id===pack.id))monaco.languages.register({id:pack.id,extensions:pack.extensions,aliases:pack.aliases});
  monaco.languages.setMonarchTokensProvider(pack.id,{keywords:pack.keywords,tokenizer:{root:[[/[a-zA-Z_$][\w$]*/,{cases:{"@keywords":"keyword","@default":"identifier"}}],[/\d+(?:\.\d+)?/,"number"],[/"([^"\\]|\\.)*"/,"string"],[new RegExp(`${pack.lineComment.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}.*$`),"comment"],[/[{}()\[\]]/,"@brackets"]]}});
  monaco.languages.registerCompletionItemProvider(pack.id,{provideCompletionItems(model,position){const word=model.getWordUntilPosition(position);const range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};return{suggestions:pack.keywords.map((label)=>({label,kind:monaco.languages.CompletionItemKind.Keyword,insertText:label,range}))};}});
  for(const extension of pack.extensions)customLanguageExtensions.set(extension,pack.id);
}
function loadLanguagePacks(monaco){let packs=[];try{packs=JSON.parse(localStorage.getItem("ynx.developer.language-packs.v1")||"[]");}catch{localStorage.removeItem("ynx.developer.language-packs.v1");}for(const value of Array.isArray(packs)?packs.slice(0,32):[])try{registerLanguagePack(monaco,validateLanguagePack(value));}catch{}}
function storedLanguagePacks(){try{const packs=JSON.parse(localStorage.getItem("ynx.developer.language-packs.v1")||"[]");return Array.isArray(packs)?packs:[];}catch{return[];}}

function initializeCodeEditor() {
  return new Promise((resolve, reject) => {
    if (!globalThis.require?.config) { reject(new Error("Monaco loader is unavailable.")); return; }
    globalThis.require.config({ paths: { vs: "/monaco/vs" } });
    globalThis.require(["vs/editor/editor.main"], (monaco) => {
      monacoAPI = monaco; registerSolidityLanguage(monaco); registerCppCompletions(monaco); loadLanguagePacks(monaco);
      codeEditor = monaco.editor.create($("#editor"), { value: "", language: "plaintext", automaticLayout: true, ariaLabel: "Source editor", accessibilitySupport: "auto", fontSize: document.documentElement.dataset.textSize === "large" ? 16 : 13, lineHeight: document.documentElement.dataset.textSize === "large" ? 25 : 20, minimap: { enabled: true }, bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, stickyScroll: { enabled: true }, quickSuggestions: { other: true, comments: false, strings: true }, suggestOnTriggerCharacters: true, tabCompletion: "on", formatOnPaste: true, formatOnType: true, scrollBeyondLastLine: false, theme: document.documentElement.dataset.theme === "dark" ? "vs-dark" : "vs" });
      codeEditor.onDidChangeModelContent(() => { $("#editor").dataset.editorValue = codeEditor.getValue(); $("#editor").dispatchEvent(new Event("input")); });
      globalThis.ynxDeveloperEditor = { engine: "monaco", version: "0.55.1", getValue: () => codeEditor.getValue(), focus: () => codeEditor.focus(), supportedLanguageIds: () => monaco.languages.getLanguages().map((item) => item.id).sort() };
      resolve();
    }, reject);
  });
}

function toast(message) { const item = $("#toast"); item.textContent = message; item.classList.add("show"); setTimeout(() => item.classList.remove("show"), 2500); }
function localizedErrorMessage(error) { const key = apiMessageKeyForError(error?.code); return key ? i18n.t(key) : errorMessage(error); }
function showError(error, target = $("#command-output")) { const message = localizedErrorMessage(error); target.textContent = `[${error.code || "error"}] ${message}`; if (target.id === "api-output") target.dataset.apiState = "error"; toast(message); }

function modal({ title, content, confirm = "Continue", danger = false }) {
  $("#modal-title").textContent = title; const container = $("#modal-content"); container.replaceChildren();
  if (typeof content === "string") container.append(node("p", "muted", content)); else container.append(content);
  const button = $("#modal-confirm"); button.textContent = confirm; button.className = `button ${danger ? "danger" : "primary"}`;
  const dialog = $("#modal"); dialog.showModal();
  return new Promise((resolve) => { const done = () => { dialog.removeEventListener("close", done); resolve(dialog.returnValue === "default"); }; dialog.addEventListener("close", done); });
}

function field(label, input) { const wrap = node("label", "field"); wrap.append(node("span", "", label), input); return wrap; }

async function executeDesktopTask(payload, { signal, onChunk } = {}) {
  const response=await fetch("/runtime/task",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal});
  const value=await response.json().catch(()=>({error:`Runtime returned HTTP ${response.status}.`}));
  if(!response.ok)throw Object.assign(new Error(value.error||"Desktop runtime task failed."),{code:value.code||"desktop_runtime_unavailable"});
  onChunk?.(value.output||""); return value;
}

async function bootstrap() {
  applyTheme(localStorage.getItem("ynx.developer.theme") || "system");
  document.documentElement.dataset.textSize=localStorage.getItem("ynx.developer.text-size")||"normal";
  try { state.aiBuild = aiBuildPersistence.load(); } catch { aiBuildPersistence.clear(); }
  configureLanguages(); configureAPIStudio(); bindNavigation(); bindActions(); syncResponsiveSurfaces(); addEventListener("resize",syncResponsiveSurfaces);
  try { await initializeCodeEditor(); }
  catch (error) { const host=$("#editor"); host.contentEditable="plaintext-only"; host.setAttribute("role","textbox"); host.addEventListener("input",()=>{host.dataset.editorValue=host.textContent||"";}); toast(`Code editor fallback: ${error.message}`); }
  const projects = await workspace.list();
  if (projects.length) await loadProject(projects.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0].id);
  renderAIBuild();
  await refreshExtensionView();
  $("#artifact-output").textContent=JSON.stringify({integration:GROK_BUILD_ACP,truthfulStatus:"adapter-contract-tested-local; official binary not bundled"},null,2);
  await Promise.allSettled([refreshNetwork(), refreshProvider()]);
}

function configureLanguages() {
  const labels={en:"English","zh-CN":"简体中文","zh-TW":"繁體中文",ja:"日本語",ko:"한국어",es:"Español",fr:"Français",de:"Deutsch",pt:"Português",ru:"Русский",ar:"العربية",id:"Bahasa Indonesia"};
  for (const id of ["locale-select","ai-language"]) for (const locale of SUPPORTED_LOCALES) $(`#${id}`).append(new Option(labels[locale],locale));
  $("#locale-select").value=i18n.locale; $("#ai-language").value=localStorage.getItem("ynx.developer.ai-language")||i18n.locale; applyLocale();
  $("#model-select").addEventListener("change", configureAIProviderFields); configureAIProviderFields();
}

function configureAIProviderFields() {
  const provider=$("#model-select").value; const byo=provider==="xai"||provider==="openai";
  $("#byo-provider-fields").hidden=!byo;
  $("#provider-model").placeholder=provider==="xai"?"grok-code-fast-1":provider==="openai"?"gpt-4.1-mini":"Provider model";
}

function jsonField(id, label, { optional = false } = {}) {
  const text = $(`#${id}`).value.trim();
  if (!text && optional) return undefined;
  try {
    const value = JSON.parse(text || "{}");
    if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be a JSON object.`);
    return value;
  } catch (error) {
    throw Object.assign(new Error(`${label}: ${errorMessage(error)}`), { code: "api_input_json_invalid" });
  }
}

function configureAPIStudio() {
  const template = $("#api-template");
  for (const item of listConnectorTemplates()) template.append(new Option(`${item.label} · ${item.owner}`, item.id));
  template.value = localStorage.getItem("ynx.developer.api-template") || "oracle";
  loadAPIConnectorTemplate();
}

function loadAPIConnectorTemplate() {
  state.apiConnector = $("#api-template").value;
  localStorage.setItem("ynx.developer.api-template", state.apiConnector);
  $("#api-spec").value = JSON.stringify(createConnectorTemplate(state.apiConnector), null, 2);
  $("#api-base-url").value = "/api-sandbox";
  $("#api-path").value = state.apiConnector === "oracle" ? JSON.stringify({ symbol: "YNXT-USD" }, null, 2) : "{}";
  $("#api-query").value = state.apiConnector === "search" ? JSON.stringify({ q: "YNX" }, null, 2) : "{}";
  $("#api-headers").value = "{}";
  $("#api-body").value = ["walletconnect", "bridge", "card", "storage", "mail", "shipping"].includes(state.apiConnector) ? JSON.stringify({ reviewRequired: true }, null, 2) : "";
  $("#api-credential-references").value = JSON.stringify({ providerReference: `credential-ref:${state.apiConnector}/testnet` }, null, 2);
  importAPISpec();
}

function importAPISpec() {
  const output = $("#api-output");
  try {
    const imported = apiStudio.import($("#api-spec").value);
    const operations = $("#api-operation"); operations.replaceChildren();
    for (const item of imported.operations) operations.append(new Option(`${item.method} ${item.path} · ${item.operationId}`, item.operationId));
    state.apiPreview = null;
    output.dataset.apiState = "validated";
    output.textContent = `${i18n.t("apiValidatedLocal")} · ${i18n.t("apiCredentialBoundary")} · ${i18n.t("apiPublicClaim")}\n\n${JSON.stringify({ status: "validated-local", ...imported, credentialBoundary: "reference-only-host-broker", publicConnectivityClaim: false }, null, 2)}`;
    return imported;
  } catch (error) { showError(error, output); return null; }
}

function previewAPIRequest() {
  const output = $("#api-output");
  try {
    state.apiPreview = apiStudio.preview({
      operationId: $("#api-operation").value,
      baseURL: $("#api-base-url").value.trim(),
      path: jsonField("api-path", i18n.t("pathParametersJSON")),
      query: jsonField("api-query", i18n.t("queryParametersJSON")),
      headers: jsonField("api-headers", i18n.t("declaredHeadersJSON")),
      body: jsonField("api-body", i18n.t("requestBodyJSON"), { optional: true }),
      credentialReferences: jsonField("api-credential-references", i18n.t("credentialReferencesJSON")),
    });
    output.dataset.apiState = "preview";
    output.textContent = JSON.stringify(state.apiPreview, null, 2);
    return state.apiPreview;
  } catch (error) { state.apiPreview = null; showError(error, output); return null; }
}

async function sendAPISandboxRequest() {
  const preview = state.apiPreview || previewAPIRequest();
  if (!preview) return;
  const review = node("div");
  review.append(node("pre", "", JSON.stringify(preview, null, 2)), node("p", "muted compact", i18n.t("apiApprovalNote")));
  if (!await modal({ title: i18n.t("apiApprovalTitle"), content: review, confirm: i18n.t("apiApprovalConfirm") })) return;
  try { const output = $("#api-output"); output.dataset.apiState = "response"; output.textContent = JSON.stringify(await apiStudio.execute(preview, { approved: true }), null, 2); }
  catch (error) { showError(error, $("#api-output")); }
}

function simulateAPIRequest() {
  const preview = state.apiPreview || previewAPIRequest();
  if (!preview) return;
  try { const output = $("#api-output"); output.dataset.apiState = "simulation"; output.textContent = JSON.stringify(apiStudio.simulate(preview, $("#api-simulation").value), null, 2); }
  catch (error) { showError(error, $("#api-output")); }
}

function generateAPIClient() {
  try { const output = $("#api-output"); output.dataset.apiState = "generated-client"; output.textContent = apiStudio.generateTypeScriptClient(); }
  catch (error) { showError(error, $("#api-output")); }
}

function generateAPIAdapterManifest() {
  try { const output = $("#api-output"); output.dataset.apiState = "generated-manifest"; output.textContent = JSON.stringify(apiStudio.generateAdapterManifest({ connector: state.apiConnector }), null, 2); }
  catch (error) { showError(error, $("#api-output")); }
}

function applyLocale() {
  document.documentElement.lang=i18n.locale;
  document.documentElement.dir=i18n.dir;
  document.querySelectorAll('[data-i18n]').forEach((item)=>{item.textContent=i18n.t(item.dataset.i18n);});
  const output=$("#api-output");
  if(output?.dataset.apiState === "empty") output.textContent=i18n.t("apiEmptyState");
}
function applyTheme(theme) { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; localStorage.setItem("ynx.developer.theme", theme); $("#theme-toggle")?.setAttribute("data-mode", theme); const dark=theme==="dark"||(theme==="system"&&matchMedia("(prefers-color-scheme: dark)").matches); monacoAPI?.editor.setTheme(dark?"vs-dark":"vs"); }
function toggleTheme() { const current=localStorage.getItem("ynx.developer.theme")||"system"; applyTheme(current === "system" ? "light" : current === "light" ? "dark" : "system"); toast(`Appearance: ${localStorage.getItem("ynx.developer.theme")}`); }
function toggleTextSize(){const large=document.documentElement.dataset.textSize!=="large";document.documentElement.dataset.textSize=large?"large":"normal";localStorage.setItem("ynx.developer.text-size",large?"large":"normal");codeEditor?.updateOptions({fontSize:large?16:13,lineHeight:large?25:20});codeEditor?.layout();toast(large?"Large interface text enabled":"Standard interface text enabled");}

async function loadProject(id) {
  state.project = await workspace.get(id); state.path = Object.keys(state.project.files).find((path) => path.endsWith(".sol")) || Object.keys(state.project.files)[0];
  state.artifact = null; renderProject(); openFile(state.path);
}

function renderProject() {
  $("#project-name").textContent = state.project?.name || "No project";
  const tree = $("#file-tree"); tree.replaceChildren();
  if (!state.project) { tree.append(node("p", "muted compact", "Create or import a project. Local state remains in this browser.")); return; }
  const groups = new Map();
  for (const path of Object.keys(state.project.files).sort()) { const [folder] = path.includes("/") ? path.split("/") : ["root"]; if (!groups.has(folder)) groups.set(folder, []); groups.get(folder).push(path); }
  for (const [folder, paths] of groups) {
    tree.append(node("div", "tree-folder", folder));
    for (const path of paths) { const button = node("button", `tree-file${path === state.path ? " active" : ""}`); button.dataset.path = path; button.setAttribute("role", "treeitem"); button.append(node("span", "", path.endsWith(".sol") ? "◇" : path.endsWith(".js") ? "JS" : "·"), node("span", "", path.split("/").pop())); button.onclick = () => openFile(path); tree.append(button); }
  }
  renderContext(); renderSourceControl(); renderAIHistory();
}

function openFile(path, line) {
  if (!state.project || !(path in state.project.files)) return;
  state.path = path; setEditorText(state.project.files[path], path); $("#active-tab").textContent = path; renderLines(); renderDiagnostics(); renderProject();
  if (line && codeEditor) { codeEditor.revealLineInCenter(line); codeEditor.setPosition({ lineNumber: line, column: 1 }); codeEditor.focus(); }
  else if (line) $("#editor").focus();
}

function renderLines() { codeEditor?.layout(); }
function renderDiagnostics() {
  const list = state.path ? sourceDiagnostics(state.path, editorText()) : []; const container = $("#diagnostics"); container.replaceChildren(); $("#problem-count").textContent = String(list.length);
  if (monacoAPI && codeEditor?.getModel()) { const model=codeEditor.getModel(); monacoAPI.editor.setModelMarkers(model, "ynx-local", list.map((item)=>{const line=Math.max(1,Math.min(item.line,model.getLineCount()));return { startLineNumber:line,startColumn:1,endLineNumber:line,endColumn:Math.max(2,model.getLineMaxColumn(line)),severity:item.severity==="error"?monacoAPI.MarkerSeverity.Error:monacoAPI.MarkerSeverity.Warning,code:item.code,message:item.message };})); }
  if (!list.length) { container.className = "diagnostics empty"; container.textContent = "No local diagnostics. Compile output remains authoritative."; return; }
  container.className = "diagnostics";
  for (const item of list) { const row = node("button", "diagnostic"); row.append(node("span", `severity ${item.severity}`, item.severity), node("span", "", `${item.code} · ${item.message}`), node("span", "muted", `${item.path}:${item.line}`)); row.onclick = () => openFile(item.path, item.line); container.append(row); }
}

function renderContext() {
  const context = $("#context-files"); context.replaceChildren(node("legend", "", i18n.t("approvedContext")));
  if (!state.project) { context.append(node("p", "muted compact", "Open a project to select files.")); return; }
  for (const path of Object.keys(state.project.files).sort()) { const label = node("label"); const box = node("input"); box.type = "checkbox"; box.value = path; box.checked = path === state.path; box.addEventListener("change", updateEstimate); label.append(box, node("span", "", path)); context.append(label); }
  updateEstimate();
}

function selectedContext() { return $$("#context-files input:checked").map((item) => item.value); }
function renderAIHistory() {
  const container = $("#ai-history"); if (!container) return; container.replaceChildren();
  const history = state.project?.conversations ?? [];
  if (!history.length) { container.append(node("p", "muted compact", "No saved AI results.")); return; }
  for (const entry of [...history].reverse().slice(0, 8)) { const item = node("div", "result-item"); item.append(node("strong", "", `${entry.status} · ${entry.model}`), node("code", "", `${entry.intent} · ${entry.approvedPaths.join(", ")}`)); item.onclick = () => { $("#ai-output").textContent = entry.output || `[${entry.status}]`; }; container.append(item); }
}
function updateEstimate() {
  if (!state.project || !selectedContext().length) return;
  try { state.aiPrepared = ai.prepare({ intent: $("#ai-intent").value.trim() || "Review selected source", project: state.project, approvedPaths: selectedContext() }); const box = $("#cost-estimate"); box.replaceChildren(node("span", "", "Local token estimate"), node("strong", "", `≈ ${state.aiPrepared.estimate.estimatedInputTokens.toLocaleString()} input tokens`), node("small", "", state.aiPrepared.estimate.note)); }
  catch { /* intent can remain incomplete while typing */ }
}

function saveAIBuild() { if (state.aiBuild) aiBuildPersistence.save(state.aiBuild); renderAIBuild(); }
function renderAIBuild() {
  const value=state.aiBuild?.snapshot(); const title=$("#ai-build-stage"); if(!title)return;
  if(!value){title.textContent="Intent · waiting";$("#resume-ai-run").disabled=true;$("#export-ai-audit").disabled=true;return;}
  title.textContent=`${value.stage.replace("-"," ")} · ${value.status}`; $("#resume-ai-run").disabled=!(["paused","failed"].includes(value.status)); $("#export-ai-audit").disabled=false;
  const order=["intent","plan","diff","test","build","audit"]; const current=Math.max(0,order.indexOf(value.stage)); $$("#ai-stage-track span").forEach((item,index)=>item.classList.toggle("current",index===current));
  $("#audit-output").textContent=state.aiBuild.exportAudit();
}

async function createAIBuildRun() {
  if(!state.project)return toast("Open a project first.");
  try {
    const intent=$("#ai-intent").value.trim(); const run=new AIBuildRun({intent,provider:$("#model-select").value,model:$("#model-select").selectedOptions[0]?.textContent||"gateway-policy",outputLanguage:$("#ai-language").value});
    const paths=selectedContext(); run.setPlan(["Explore only the approved project context","Propose a reviewable file diff","Run explicitly approved tests","Create a recoverable checkpoint","Package or deploy only after separate review"]);
    const preview=node("div"); preview.append(node("p","muted compact","YNX AI Build will not write, execute, use network, install packages, reference secrets, commit, push or deploy without the matching approval."));
    for(const step of run.snapshot().plan)preview.append(node("div","result-item",step.title));
    if(!await modal({title:"Preview YNX AI Build plan",content:preview,confirm:"Approve plan"})){run.approvePlan("reject");state.aiBuild=run;saveAIBuild();return false;}
    run.approvePlan("approve"); run.approveContext(paths); state.aiBuild=run; state.aiProposalId=null; saveAIBuild(); toast("AI Build plan and context approved."); return true;
  } catch(error){showError(error,$("#ai-output"));return false;}
}

function exportAIBuildAudit(){if(!state.aiBuild)return;const blob=new Blob([state.aiBuild.exportAudit()],{type:"application/json"});const link=node("a");link.href=URL.createObjectURL(blob);link.download=`${state.aiBuild.snapshot().runId}-audit.json`;link.click();URL.revokeObjectURL(link.href);}

function openPalette(){const dialog=$("#palette");dialog.showModal();$("#palette-query").value="";$("#palette-query").focus();}
function setMobileSidebar(open){const sidebar=$(".sidebar"),mobile=matchMedia("(max-width:740px)").matches;sidebar.classList.toggle("mobile-open",mobile&&open);sidebar.inert=mobile&&!open;if(mobile)sidebar.setAttribute("aria-hidden",String(!open));else sidebar.removeAttribute("aria-hidden");}
function syncResponsiveSurfaces(){setMobileSidebar($(".sidebar").classList.contains("mobile-open"));}

async function renderSourceControl() {
  const list = $("#diff-list"); list.replaceChildren();
  if (!state.project) return;
  const changes = await workspace.diff(state.project.id);
  if (!changes.length) list.append(node("p", "muted compact", "No changes from the latest checkpoint."));
  for (const change of changes) {
    const item = node("div", "result-item"); const inspect = node("button", "", `${change.status.toUpperCase()} · ${change.path}`);
    inspect.onclick = () => { const before = change.before.split("\n").map((line) => `- ${line}`).join("\n"); const after = change.after.split("\n").map((line) => `+ ${line}`).join("\n"); modal({ title: `Source diff · ${change.path}`, content: node("pre", "", `--- checkpoint/${change.path}\n+++ working/${change.path}\n${before}\n${after}`), confirm: "Close" }); };
    item.append(inspect, node("code", "", `− ${change.before.split("\n").length} lines  + ${change.after.split("\n").length} lines`)); list.append(item);
  }
  const select = $("#checkpoint-select"); select.replaceChildren();
  for (const checkpoint of [...state.project.checkpoints].reverse()) { const option = node("option", "", `${checkpoint.label} · ${new Date(checkpoint.createdAt).toLocaleString()}`); option.value = checkpoint.id; select.append(option); }
}

function bindNavigation() {
  $$(".activity-button[data-view]").forEach((button) => button.onclick = () => {
    const mobile=matchMedia("(max-width:740px)").matches, agentView=button.dataset.view === "agent", wasActive=button.classList.contains("active");
    if(agentView){ setMobileSidebar(false); $(".agent").classList.toggle("mobile-open",mobile?!$(".agent").classList.contains("mobile-open"):true); }
    else { $(".agent").classList.remove("mobile-open"); $$(".side-view").forEach((view)=>view.classList.toggle("active",view.id===`view-${button.dataset.view}`)); if(mobile)setMobileSidebar(!(wasActive&&$(".sidebar").classList.contains("mobile-open"))); }
    $$(".activity-button").forEach((item)=>item.classList.toggle("active",item===button));
    if(button.dataset.view === "source")renderSourceControl();
    if(button.dataset.view === "extensions")refreshExtensionView();
  });
  $("#close-agent").onclick = () => $("aside.agent").classList.remove("mobile-open");
  $(".workspace").addEventListener("pointerdown",()=>{if(matchMedia("(max-width:740px)").matches)setMobileSidebar(false);});
  document.addEventListener("keydown",(event)=>{if(event.key==="Escape"){setMobileSidebar(false);$(".agent").classList.remove("mobile-open");}});
  const tabs=[...document.querySelectorAll(".panel-tab")]; $(".panel-tabs").setAttribute("role","tablist");
  const activateTab=(button,{focus=false}={})=>{
    tabs.forEach((item)=>{const active=item===button;item.classList.toggle("active",active);item.setAttribute("role","tab");item.setAttribute("aria-selected",String(active));item.tabIndex=active?0:-1;});
    [...document.querySelectorAll(".panel-body")].forEach((panel)=>{const active=panel.id===`panel-${button.dataset.panel}`;panel.classList.toggle("active",active);panel.setAttribute("role","tabpanel");panel.hidden=!active;});
    if(focus)button.focus();
  };
  tabs.forEach((button,index)=>{
    button.id=`panel-tab-${button.dataset.panel}`;button.setAttribute("aria-controls",`panel-${button.dataset.panel}`);button.onclick=()=>activateTab(button);
    button.onkeydown=(event)=>{let target=index;if(event.key==="ArrowRight")target=(index+1)%tabs.length;else if(event.key==="ArrowLeft")target=(index-1+tabs.length)%tabs.length;else if(event.key==="Home")target=0;else if(event.key==="End")target=tabs.length-1;else return;event.preventDefault();activateTab(tabs[target],{focus:true});};
    $(`#panel-${button.dataset.panel}`)?.setAttribute("aria-labelledby",button.id);
  });
  activateTab(tabs.find((button)=>button.classList.contains("active"))||tabs[0]);
}

function bindActions() {
  $("#editor").addEventListener("input", () => { renderLines(); renderDiagnostics(); $("#save-state").textContent = "Saving…"; clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveEditor, 350); });
  $("#ai-intent").addEventListener("input", updateEstimate);
  $("#create-project").onclick = createProject; $("#import-project").onclick = () => $("#file-import").click(); $("#file-import").onchange = importProject; $("#export-project").onclick = exportProject; $("#new-file").onclick = newFile;
  $("#run-search").onclick = runSearch; $("#create-checkpoint").onclick = checkpoint; $("#revert-checkpoint").onclick = revert;
  $("#compile").onclick = compile; $("#run-tests").onclick = () => runTask("test"); $("#run-task").onclick = () => runTask("check"); $("#run-rpc").onclick = runRPC;
  $("#install-package").onclick = installPackage;
  $("#refresh-toolchains").onclick=refreshToolchains;$("#refresh-extensions").onclick=refreshExtensionView;$("#import-language-pack").onclick=()=>$("#language-pack-file").click();$("#sidebar-add-language").onclick=()=>$("#language-pack-file").click();$("#language-pack-file").onchange=importLanguagePack;$("#import-toolchain-adapter").onclick=()=>$("#toolchain-adapter-file").click();$("#sidebar-add-compiler").onclick=()=>$("#toolchain-adapter-file").click();$("#toolchain-adapter-file").onchange=importToolchainAdapter;
  $("#api-template").onchange = loadAPIConnectorTemplate; $("#api-load-template").onclick = loadAPIConnectorTemplate; $("#api-import").onclick = importAPISpec; $("#api-preview").onclick = previewAPIRequest; $("#api-send").onclick = sendAPISandboxRequest; $("#api-simulate").onclick = simulateAPIRequest; $("#api-generate-client").onclick = generateAPIClient; $("#api-generate-manifest").onclick = generateAPIAdapterManifest;
  $("#ask-ai").onclick = askAI; $("#cancel-ai").onclick = () => { try { ai.cancel(); } catch (error) { showError(error, $("#ai-output")); } }; $("#apply-ai").onclick = applyAI; $("#reject-ai").onclick = rejectAI;
  $("#clear-ai-history").onclick = clearAIHistory;
  $("#create-ai-run").onclick=createAIBuildRun; $("#resume-ai-run").onclick=()=>{try{state.aiBuild.resume();saveAIBuild();}catch(error){showError(error,$("#ai-output"));}}; $("#export-ai-audit").onclick=exportAIBuildAudit;
  $("#theme-toggle").onclick=toggleTheme; $("#command-palette").onclick=openPalette;
  $("#text-size-toggle").onclick=toggleTextSize;
  $("#palette-query").oninput=()=>{const query=$("#palette-query").value.toLowerCase();$$(".command-list button").forEach((button)=>button.hidden=!button.textContent.toLowerCase().includes(query));};
  $$(".command-list button").forEach((button)=>button.onclick=()=>{const command=button.dataset.command;if(command==="compile")compile();if(command==="test")runTask("test");if(command==="checkpoint")checkpoint();if(command==="ai")$(".agent").classList.add("mobile-open");if(command==="deploy")reviewDeployment();});
  document.addEventListener("keydown",(event)=>{if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==="p"){event.preventDefault();openPalette();}});
  $("#locale-select").onchange=()=>{i18n.setLocale($("#locale-select").value);applyLocale();};
  $("#ai-language").onchange=()=>localStorage.setItem("ynx.developer.ai-language",$("#ai-language").value);
  $("#wallet-sign-in").onclick=signInWallet;
  $("#review-deployment").onclick = reviewDeployment;
  $$("[data-doc]").forEach((button) => button.onclick = () => showDocumentation(button.dataset.doc));
}

async function createProject() {
  const input = node("input"); input.value = "YNX Counter"; input.autofocus = true;
  const select = node("select", "select"); select.append(new Option("Bounded Counter", "counter"), new Option("Blank Solidity", "blank"));
  const content = node("div"); content.append(field("Project name", input), field("Template", select), node("p", "muted compact", "Created locally with pinned compiler metadata. No repository or deployment claim is made."));
  if (!await modal({ title: "Create project", content, confirm: "Create" })) return;
  try { const project = await workspace.create({ name: input.value, template: select.value }); await loadProject(project.id); toast("Project created and persisted locally."); } catch (error) { showError(error); }
}

async function newFile() {
  if (!state.project) return createProject(); const input = node("input"); input.placeholder = "src/Library.sol";
  if (!await modal({ title: "New file", content: field("Relative path", input), confirm: "Create file" })) return;
  try { state.project = await workspace.write(state.project.id, input.value, ""); openFile(input.value); } catch (error) { showError(error); }
}

async function saveEditor() {
  if (!state.project || !state.path) return;
  try { state.project = await workspace.write(state.project.id, state.path, editorText()); $("#save-state").textContent = "Saved"; renderContext(); }
  catch (error) { $("#save-state").textContent = "Save failed"; showError(error); }
}

async function importProject(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  try { const project = await workspace.import(await file.text()); await loadProject(project.id); toast("Project imported into local persistence."); } catch (error) { showError(error); }
}

async function exportProject() {
  if (!state.project) return toast("No project to export.");
  const blob = new Blob([await workspace.export(state.project.id)], { type: "application/json" }); const link = node("a"); link.href = URL.createObjectURL(blob); link.download = `${state.project.name.replace(/[^a-z0-9_-]+/gi, "-")}.ynx-project.json`; link.click(); URL.revokeObjectURL(link.href); toast("Project exported without credentials or Wallet secrets.");
}

async function runSearch() {
  if (!state.project) return; const container = $("#search-results"); container.replaceChildren();
  try { const results = await workspace.search(state.project.id, $("#search-query").value); if (!results.length) container.append(node("p", "muted compact", "No matches.")); for (const result of results) { const item = node("div", "result-item"); const button = node("button", "", `${result.path}:${result.line}`); button.onclick = () => openFile(result.path, result.line); item.append(button, node("code", "", result.preview)); container.append(item); } } catch (error) { showError(error); }
}

async function checkpoint() {
  if (!state.project) return;
  try { await saveEditor(); const value = await workspace.checkpoint(state.project.id, $("#checkpoint-label").value); state.project = await workspace.get(state.project.id); await renderSourceControl(); toast(`Checkpoint created: ${value.label}`); } catch (error) { showError(error); }
}

async function revert() {
  const checkpointId = $("#checkpoint-select").value; if (!state.project || !checkpointId) return toast("No checkpoint selected.");
  const selected = state.project.checkpoints.find((item) => item.id === checkpointId); if (!await modal({ title: "Revert project checkpoint", content: `This restores every project file to “${selected.label}”. Current uncheckpointed edits will be replaced.`, confirm: "Revert files", danger: true })) return;
  try { state.project = await workspace.revert(state.project.id, checkpointId); openFile(state.path in state.project.files ? state.path : Object.keys(state.project.files)[0]); toast("Checkpoint restored. Revert is recorded in project audit."); } catch (error) { showError(error); }
}

async function compile() {
  if (!state.project || !state.path) return toast("Open a source file to compile."); await saveEditor(); activatePanel("output"); const output = $("#command-output");
  if(state.path.endsWith(".sol")){
    output.textContent = `Checking pinned compiler at ${config.chainURL}…`;
    try { const source = state.project.files[state.path]; const name = source.match(/contract\s+([A-Za-z_]\w*)/u)?.[1] || state.path.split("/").pop().replace(/\.sol$/, ""); state.artifact = await chain.compile({ name, source }); output.textContent = JSON.stringify({ evidence: "real solc 0.8.24 standard-json compiler output", compiler: state.artifact.compiler, boundedExecution: true, artifact: state.artifact }, null, 2); $("#deployment-state").textContent = "Real ABI and EVM bytecode are compiled. Deployment still requires Wallet review, authorization, final approval and an authoritative receipt; unsupported chain execution remains blocked."; $("#deployment-state").className = "state-card success"; toast("Solidity compilation succeeded."); }
    catch (error) { state.artifact = null; showError(error, output); } return;
  }
  const preview={task:"compile-active",activePath:state.path,cwd:`/projects/${state.project.id}`,command:"Resolve the registered desktop toolchain and compile/type-check the active file",environmentClass:"desktop-project-sandbox",risk:"write-build-artifacts",approval:"compile-once",network:false};
  const content=node("div");content.append(node("pre","",JSON.stringify(preview,null,2)),node("p","muted compact","The desktop runtime resolves only a registered installed toolchain, disables network access, limits the workspace and execution time, and returns the real exit code and diagnostics. The Web Product cannot claim a local compiler."));
  if(!await modal({title:`Compile ${state.path}`,content,confirm:"Compile once"}))return;
  output.textContent="Resolving installed desktop toolchain…";
  try{const result=await executeDesktopTask({...preview,projectId:state.project.id,files:state.project.files});output.textContent=JSON.stringify(result,null,2);toast(result.ok?`${result.language} compile passed.`:`${result.language} compiler returned errors.`);}catch(error){showError(error,output);}
}

async function runTask(task) {
  const preview = commandPreview(task, `/projects/${state.project?.id || "none"}`); activatePanel("terminal"); $("#terminal-preview").textContent = JSON.stringify(preview, null, 2);
  const content = node("div"); content.append(node("pre", "", JSON.stringify(preview, null, 2)), node("p", "muted compact", "Web Product cannot execute local commands. An installed unsigned desktop package may provide an allowlisted sandbox executor; destructive, network and deploy actions are not in this task allowlist."));
  if (!await modal({ title: "Approve terminal task", content, confirm: "Approve command" })) return;
  try { const result = await commands.run(preview, { command: true, write: preview.risk !== "read" }, { projectId: state.project?.id, files: state.project?.files }); $("#terminal-preview").textContent = JSON.stringify(result, null, 2); } catch (error) { showError(error, $("#terminal-preview")); }
}

async function installPackage() {
  if(!state.project)return toast("Open a project first."); const spec=$("#package-spec").value.trim();
  if(!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9]+(?:\.[0-9]+){0,2})?$/i.test(spec))return showError(Object.assign(new Error("Enter one npm package name with an optional exact numeric version."),{code:"package_spec_invalid"}),$("#terminal-preview"));
  const preview={task:"install",cwd:`/projects/${state.project.id}`,command:`npm install --ignore-scripts --save-exact ${spec}`,environmentClass:"desktop-project-sandbox",risk:"network-and-write",approval:"package-install"};
  activatePanel("terminal"); $("#terminal-preview").textContent=JSON.stringify(preview,null,2);
  const content=node("div");content.append(node("pre","",JSON.stringify(preview,null,2)),node("p","muted compact","The desktop runtime creates a project-isolated workspace, disables lifecycle scripts, applies package/time/size limits, and never installs globally."));
  if(!await modal({title:"Approve one package installation",content,confirm:"Install exact package"}))return;
  try{const result=await executeDesktopTask({...preview,projectId:state.project.id,files:state.project.files,packageSpec:spec});$("#terminal-preview").textContent=JSON.stringify(result,null,2);toast("Package installed in the isolated desktop workspace.");}catch(error){showError(error,$("#terminal-preview"));}
}

async function refreshToolchains(){
  const output=$("#toolchain-status");output.textContent="Detecting installed desktop toolchains…";
  try{const response=await fetch("/runtime/toolchains");const value=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error("Installed desktop runtime is required for local toolchain detection."),{code:"desktop_runtime_required"});output.textContent=JSON.stringify({platform:value.platform,model:value.model,available:value.adapters?.filter((item)=>item.available).map((item)=>({language:item.id,extensions:item.extensions,command:item.command})),unavailable:value.adapters?.filter((item)=>!item.available).map((item)=>({language:item.id,extensions:item.extensions,installHint:item.installHint,installForCurrentUser:true})),extensionBoundary:"Like VS Code, editing support and executable toolchains are separate. Import a declarative language pack for colors/completion and a reviewed compiler adapter for any additional installed language toolchain."},null,2);}catch(error){showError(error,output);}
}

async function refreshExtensionView(){
  const list=$("#extension-list"),summary=$("#extension-summary");if(!list||!summary)return;list.replaceChildren();summary.textContent="Detecting languages and installed compilers…";
  const languagePacks=storedLanguagePacks();let adapters=[];let runtime="Web editing only";
  try{const response=await fetch("/runtime/toolchains");if(response.ok){const value=await response.json();adapters=value.adapters||[];runtime=`Desktop runtime · ${value.platform}`;}}catch{}
  const builtInIds=monacoAPI?[...new Set(monacoAPI.languages.getLanguages().map((item)=>item.id))].sort():[];
  const sections=[{title:`Built-in editing (${builtInIds.length})`,items:builtInIds.map((id)=>({id,detail:"Syntax/editing support",kind:"builtin"}))},{title:`Installed language packs (${languagePacks.length})`,items:languagePacks.map((pack)=>({id:pack.id,detail:(pack.extensions||[]).join(" · "),kind:"language"}))},{title:`Compiler adapters (${adapters.length})`,items:adapters.map((adapter)=>({id:adapter.id,detail:`${adapter.extensions.join(" · ")} · ${adapter.available?"ready":adapter.installHint||"toolchain missing"}`,kind:adapter.custom?"compiler":"builtin-compiler",ready:adapter.available}))}];
  for(const section of sections){list.append(node("h3","extension-heading",section.title));if(!section.items.length){list.append(node("p","muted compact","None installed."));continue;}for(const item of section.items){const card=node("div",`extension-card ${item.ready?"ready":""}`);const copy=node("div");copy.append(node("strong","",item.id),node("small","",item.detail));card.append(copy);if(item.kind==="language"||item.kind==="compiler"){const remove=node("button","icon-button","×");remove.setAttribute("aria-label",`Remove ${item.id}`);remove.onclick=()=>item.kind==="language"?removeLanguagePack(item.id):removeCompilerAdapter(item.id);card.append(remove);}list.append(card);}}
  summary.textContent=`${runtime}. VS Code-style model: editing extensions and compiler toolchains are independent; users may add both.`;
}

async function removeLanguagePack(id){
  if(!await modal({title:`Remove ${id}`,content:"Remove this declarative editing pack from the current browser profile?",confirm:"Remove pack",danger:true}))return;
  const packs=storedLanguagePacks().filter((item)=>item.id!==id);localStorage.setItem("ynx.developer.language-packs.v1",JSON.stringify(packs));location.reload();
}

async function removeCompilerAdapter(id){
  if(!await modal({title:`Remove ${id}`,content:"Remove this compiler adapter from the current desktop user? Built-in adapters cannot be removed.",confirm:"Remove adapter",danger:true}))return;
  const response=await fetch("/runtime/toolchains/remove",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"remove-local-toolchain-once",id})});const value=await response.json().catch(()=>({}));if(!response.ok)return showError(Object.assign(new Error(value.error||"Adapter removal failed."),{code:value.code||"adapter_removal_failed"}),$("#toolchain-status"));toast(`Compiler adapter ${id} removed.`);await refreshExtensionView();
}

async function importLanguagePack(event){
  const file=event.target.files?.[0];event.target.value="";if(!file)return;if(file.size>128*1024)return showError(Object.assign(new Error("Language pack exceeds 128 KiB."),{code:"language_pack_too_large"}),$("#toolchain-status"));
  try{const pack=validateLanguagePack(JSON.parse(await file.text()));if(!monacoAPI)throw new Error("Editor engine is not ready.");registerLanguagePack(monacoAPI,pack);let packs=storedLanguagePacks().filter((item)=>item.id!==pack.id);packs.push(pack);if(packs.length>32)packs=packs.slice(-32);localStorage.setItem("ynx.developer.language-packs.v1",JSON.stringify(packs));if(state.path&&pack.extensions.some((extension)=>state.path.toLowerCase().endsWith(extension)))monacoAPI.editor.setModelLanguage(codeEditor.getModel(),pack.id);$("#toolchain-status").textContent=JSON.stringify({installed:true,id:pack.id,extensions:pack.extensions,editing:["highlighting","keyword completion"],execution:false,security:"declarative-only; no extension code executed"},null,2);toast(`Language pack ${pack.id} installed locally.`);await refreshExtensionView();}catch(error){showError(Object.assign(error,{code:"language_pack_invalid"}),$("#toolchain-status"));}
}

async function importToolchainAdapter(event){
  const file=event.target.files?.[0];event.target.value="";if(!file)return;if(file.size>64*1024)return showError(Object.assign(new Error("Compiler adapter exceeds 64 KiB."),{code:"adapter_too_large"}),$("#toolchain-status"));
  try{
    const adapter=JSON.parse(await file.text());const review={schemaVersion:adapter.schemaVersion,id:adapter.id,extensions:adapter.extensions,executable:adapter.executable,args:adapter.args,execution:{surface:"installed desktop only",shell:false,network:false,workspace:"project isolated",timeoutSeconds:30,approval:"every compile"}};
    const content=node("div");content.append(node("pre","",JSON.stringify(review,null,2)),node("p","muted compact","Registration stores this adapter for the current desktop user. It may invoke only the named installed executable with literal argument tokens plus ${file}/${build}; it may explicitly override the compiler choice for a built-in file extension, remains removable, and cannot use shell syntax."));
    if(!await modal({title:"Register local compiler adapter",content,confirm:"Register adapter"}))return;
    const response=await fetch("/runtime/toolchains/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"register-local-toolchain-once",adapter})});const value=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(value.error||"Compiler adapter registration failed."),{code:value.code||"adapter_registration_failed"});
    $("#toolchain-status").textContent=JSON.stringify(value,null,2);toast(`Compiler adapter ${value.adapter.id} registered.`);await refreshExtensionView();
  }catch(error){showError(Object.assign(error,{code:error.code||"adapter_invalid"}),$("#toolchain-status"));}
}

async function runRPC() {
  activatePanel("rpc"); try { const params = JSON.parse($("#rpc-params").value); const result = await chain.rpc($("#rpc-method").value, params); $("#rpc-output").textContent = JSON.stringify({ source: config.chainURL, result }, null, 2); } catch (error) { showError(error, $("#rpc-output")); }
}

async function refreshNetwork() {
  const status = $("#network-status"); try { const result = await chain.health(); status.replaceChildren(node("span", "status-dot online"), node("span", "", `YNX Testnet · height ${result.height ?? "live"}`)); } catch { status.replaceChildren(node("span", "status-dot offline"), node("span", "", "YNX Testnet · unavailable")); }
}

async function refreshProvider() {
  const status = await ai.status(); const pill = $("#provider-status"); const unavailableLabel=status.error === "provider_rate_limited" ? "Provider quota unavailable" : "Unavailable"; pill.textContent = status.available ? `${status.model} · ready` : unavailableLabel; pill.className = `provider ${status.available ? "available" : "unavailable"}`;
  const select=$("#model-select"); select.options[0].textContent=status.available?`YNX hosted · ${status.model}`:`YNX hosted · ${unavailableLabel.toLowerCase()}`;
}

async function askAI() {
  if (!state.project) return toast("Open a project first.");
  try {
    if(!state.aiBuild || ["completed","cancelled","reverted"].includes(state.aiBuild.snapshot().status))if(!await createAIBuildRun())return;
    state.aiPrepared = ai.prepare({ intent: $("#ai-intent").value, project: state.project, approvedPaths: selectedContext() });
    const review = node("div"); review.append(node("p", "muted compact", "Only these files leave the browser through the permissioned YNX AI Gateway:")); for (const item of state.aiPrepared.privacyPreview) review.append(node("div", "result-item", `${item.path} · ${item.bytes} bytes`)); review.append(node("p", "muted compact", `${state.aiPrepared.estimate.estimatedInputTokens} estimated input tokens. Provider cost is not known and will not be invented.`));
    if (!await modal({ title: "Approve AI context and estimated cost", content: review, confirm: "Stream from Gateway" })) return;
    const network=state.aiBuild.requestPermission("network",{reason:"Send only the approved context through the selected provider interface",scope:{provider:$("#model-select").value,paths:state.aiPrepared.files.map((file)=>file.path)}}); state.aiBuild.decidePermission(network.requestId,"allow-once"); saveAIBuild();
    $("#ask-ai").disabled = true; $("#cancel-ai").disabled = false; $("#ai-output").textContent = "";
    const provider=$("#model-select").value;
    if(provider==="grok-build-acp")throw Object.assign(new Error("The Grok Build ACP sidecar is available only in the desktop runtime after its separately verified official binary is configured."),{code:"desktop_sidecar_required"});
    const requestedModel=$("#provider-model").value.trim();
    state.aiResult = await ai.stream(state.aiPrepared, { provider, accessToken: $("#provider-api-key").value, model: requestedModel || (provider==="xai"?"grok-code-fast-1":provider==="openai"?"gpt-4.1-mini":"gateway-policy"), outputLanguage: $("#ai-language").value, approved: true, onToken: (token) => { $("#ai-output").textContent += token; } });
    state.aiBuild.recordTool({name:"provider.stream",permission:"network",requestId:network.requestId,inputSummary:`${state.aiPrepared.files.length} approved files`,status:"passed",outputSummary:`${state.aiResult.output.length} output characters`});
    const providerProposals=proposedFiles(state.aiResult.output); if(providerProposals.length){const proposal=state.aiBuild.proposeDiff(providerProposals.map((file)=>({path:file.path,before:state.project.files[file.path]??"",after:file.content})),"Provider-proposed bounded file changes");state.aiProposalId=proposal.id;} saveAIBuild();
    state.project = await workspace.recordConversation(state.project.id, { intent: state.aiPrepared.intent, approvedPaths: state.aiPrepared.files.map((file) => file.path), model: $("#model-select").value, status: state.aiResult.status, output: state.aiResult.output }); renderAIHistory();
    $("#apply-ai").disabled = false; $("#reject-ai").disabled = false;
  } catch (error) {
    if(state.aiBuild && !["cancelled","completed","reverted"].includes(state.aiBuild.snapshot().status)){try{state.aiBuild.fail(error);saveAIBuild();}catch{/* provider error remains primary */}}
    showError(error, $("#ai-output"));
    if (state.project && state.aiPrepared) {
      try { state.project = await workspace.recordConversation(state.project.id, { intent: state.aiPrepared.intent, approvedPaths: state.aiPrepared.files.map((file) => file.path), model: $("#model-select").value, status: error.code || "provider-failed-retry-available", output: errorMessage(error) }); renderAIHistory(); } catch { /* primary provider error remains authoritative */ }
    }
  }
  finally { $("#ask-ai").disabled = false; $("#cancel-ai").disabled = true; }
}

function proposedFiles(output) {
  const proposals = []; const pattern = /```ynx-file\s+path=([^\n]+)\n([\s\S]*?)```/g; let match;
  while ((match = pattern.exec(output))) proposals.push({ path: match[1].trim(), content: match[2].replace(/\n$/, "") });
  return proposals;
}

async function applyAI() {
  try {
    const reviewed = ai.review(state.aiResult, "apply"); const proposals = proposedFiles(reviewed.output);
    if (!proposals.length) throw Object.assign(new Error("Provider result has no machine-applicable `ynx-file path=...` blocks. Nothing was written."), { code: "diff_format_unsupported" });
    const content = node("div"); for (const proposal of proposals) content.append(node("div", "result-item", `${proposal.path} · ${proposal.content.split("\n").length} proposed lines`));
    if (!await modal({ title: "Review proposed AI file diff", content, confirm: "Approve diff" })) return;
    if(state.aiBuild&&state.aiProposalId)state.aiBuild.reviewDiff(state.aiProposalId,"approve");
    const permission=state.aiBuild?.requestPermission("write",{reason:"Apply the reviewed AI proposal",scope:{paths:proposals.map((item)=>item.path)}});
    if(!await modal({title:"Allow one project write",content:"This one-time permission applies only the reviewed files shown above. It does not allow terminal, network, Git or deploy actions.",confirm:"Allow once"})){if(permission)state.aiBuild.decidePermission(permission.requestId,"deny");saveAIBuild();return;}
    if(permission)state.aiBuild.decidePermission(permission.requestId,"allow-once");
    for (const proposal of proposals) state.project = await workspace.write(state.project.id, proposal.path, proposal.content, { origin: "ai", reviewed: true });
    if(state.aiBuild&&state.aiProposalId&&permission){state.aiBuild.applyDiff(state.aiProposalId,permission.requestId,()=>{});state.aiBuild.checkpoint("AI diff applied — validation pending",state.project.files);saveAIBuild();}
    renderProject(); openFile(proposals[0].path); $("#apply-ai").disabled = true; $("#reject-ai").disabled = true; toast("Reviewed AI diff applied. Create a checkpoint after validation.");
  } catch (error) { showError(error, $("#ai-output")); }
}

function rejectAI() { try { state.aiResult = ai.review(state.aiResult, "reject"); if(state.aiBuild&&state.aiProposalId){state.aiBuild.reviewDiff(state.aiProposalId,"reject");saveAIBuild();} $("#apply-ai").disabled = true; $("#reject-ai").disabled = true; $("#ai-output").textContent += "\n\n[Rejected — no files changed]"; } catch (error) { showError(error, $("#ai-output")); } }

async function clearAIHistory() {
  if (!state.project || !(state.project.conversations ?? []).length) return;
  if (!await modal({ title: "Clear local AI history", content: "This removes locally persisted provider results from this project. The deletion is retained only as a project audit event.", confirm: "Clear history", danger: true })) return;
  state.project = await workspace.clearConversationHistory(state.project.id); renderAIHistory(); toast("Local AI conversation history cleared.");
}

async function signInWallet() {
  const stateBox=$("#wallet-state");
  if (!await modal({title:i18n.t("walletSignIn"),content:"Developer requests only public account access and deployment-review scope. The Wallet private key never leaves Wallet; this product device must complete a separate central Gateway challenge.",confirm:i18n.t("continue")})) return;
  stateBox.textContent="Opening the exact reviewed request in YNX Wallet…";
  try { const result=await walletSession.open({approved:true}); stateBox.textContent=`Wallet review opened · expires ${i18n.date(result.expiresAt)}. No Developer session exists until the registered desktop callback and central Gateway completion both pass.`; stateBox.className="state-card"; }
  catch(error){ stateBox.textContent=`${errorMessage(error)} ${i18n.t("retry")}`; stateBox.className="state-card"; toast(errorMessage(error)); }
}

async function reviewDeployment() {
  if (!state.artifact || !state.project || !state.path) return toast("Compile a supported Solidity source first.");
  const box = $("#deployment-state");
  try {
    const constructorArgs = JSON.parse($("#constructor-args").value); state.deployReview = deployment.review({ projectId: state.project.id, account: $("#deploy-account").value.trim(), artifact: state.artifact, constructorArgs });
    const review = node("pre", "", JSON.stringify(state.deployReview, null, 2));
    if (!await modal({ title: "Deployment review · no signature yet", content: review, confirm: "Authorize in Wallet" })) return;
    box.textContent = "Waiting for exact YNX Wallet authorization…";
    const authorization = await deployment.authorize(state.deployReview, { confirmed: true });
    const final = node("div"); final.append(node("pre", "", JSON.stringify({ authorization, review: state.deployReview }, null, 2)), node("p", "muted compact", "This separate approval allows Wallet to sign and submit a network transaction. Developer never handles the private key."));
    if (!await modal({ title: "Final network deployment approval", content: final, confirm: "Sign & submit in Wallet", danger: true })) return;
    const submission = await deployment.signAndSubmit(state.deployReview, authorization, { approved: true }); box.textContent = `Submitted ${submission.txHash}; awaiting authoritative receipt. Submission is not confirmation.`;
    const confirmation = await deployment.confirm(submission); const sourceMatch = await deployment.sourceMatch(confirmation, state.project.files[state.path]);
    box.className = "state-card success"; box.textContent = `Confirmed ${confirmation.address}. Source status: ${sourceMatch.status}. Remote public proof: ${sourceMatch.remotePublicProof ? "verified" : "not established"}.`;
    $("#receipt-output").textContent = JSON.stringify({ confirmation, sourceMatch }, null, 2); activatePanel("receipts");
  } catch (error) { box.className = "state-card error"; box.textContent = `[${error.code || "error"}] ${errorMessage(error)}`; }
}

function showDocumentation(topic) {
  const docs = {
    compiler: ["Pinned compiler & bounded EVM", "YNX Developer accepts exact Solidity 0.8.24 with optimizer enabled and 200 runs. The chain exposes a bounded local bytecode interpreter; unsupported compiler versions, arbitrary opcodes, complex storage paths and remote deployment paths fail explicitly."],
    wallet: ["Wallet authorization & signing", "Developer creates a five-minute, exact deployment review for chain ynx_6423-1. YNX Wallet authorizes, signs and submits. Developer never stores or receives a Wallet private key. A submitted hash is not success; an authoritative receipt must confirm it."],
    ai: ["AI Coding Agent permissions", "Only checked project files are sent through YNX AI Gateway. The UI previews file names, bytes and a local token estimate, streams/cancels provider output, requires result review, and applies only explicit bounded file blocks. Commands and writes have separate approvals."],
    surfaces: ["Product surface evidence", "This build is the standalone Web Product. The local server may support an unsigned local desktop wrapper/executor contract, but no signed macOS or Windows production desktop release is claimed without signing, installation and cold-launch evidence."],
    recovery: ["Recovery, checkpoint & revert", "Projects persist in local IndexedDB and export to bounded JSON. Checkpoints snapshot all files, source control shows changes from the latest baseline, and revert requires destructive confirmation and adds an audit event."]
  };
  const [title, text] = docs[topic]; modal({ title, content: text, confirm: "Close" });
}

function activatePanel(name) { const tab = $(`.panel-tab[data-panel="${name}"]`); if (tab) tab.click(); }

bootstrap().catch((error) => showError(error));
