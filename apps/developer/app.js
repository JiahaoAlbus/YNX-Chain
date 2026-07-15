import {
  AICodingAgent, CommandAudit, IndexedDBPersistence, ProjectWorkspace, WalletDeployment,
  YNXChainClient, commandPreview, errorMessage, sourceDiagnostics
} from "/client/index.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
const config = { chainURL: localStorage.getItem("ynx.developer.v1.chainURL") || "/chain", aiURL: localStorage.getItem("ynx.developer.v1.aiURL") || "/ai-gateway" };
const workspace = new ProjectWorkspace({ persistence: new IndexedDBPersistence() });
const chain = new YNXChainClient({ baseURL: config.chainURL });
const ai = new AICodingAgent({ gatewayURL: config.aiURL });
const commands = new CommandAudit({ executor: globalThis.ynxDesktop?.executeApprovedCommand });
const deployment = new WalletDeployment({ wallet: globalThis.ynxWallet, chainClient: chain });
const state = { project: null, path: null, artifact: null, aiPrepared: null, aiResult: null, deployReview: null, saveTimer: null };

function toast(message) { const item = $("#toast"); item.textContent = message; item.classList.add("show"); setTimeout(() => item.classList.remove("show"), 2500); }
function showError(error, target = $("#command-output")) { target.textContent = `[${error.code || "error"}] ${errorMessage(error)}`; toast(errorMessage(error)); }

function modal({ title, content, confirm = "Continue", danger = false }) {
  $("#modal-title").textContent = title; const container = $("#modal-content"); container.replaceChildren();
  if (typeof content === "string") container.append(node("p", "muted", content)); else container.append(content);
  const button = $("#modal-confirm"); button.textContent = confirm; button.className = `button ${danger ? "danger" : "primary"}`;
  const dialog = $("#modal"); dialog.showModal();
  return new Promise((resolve) => { const done = () => { dialog.removeEventListener("close", done); resolve(dialog.returnValue === "default"); }; dialog.addEventListener("close", done); });
}

function field(label, input) { const wrap = node("label", "field"); wrap.append(node("span", "", label), input); return wrap; }

async function bootstrap() {
  bindNavigation(); bindActions();
  const projects = await workspace.list();
  if (projects.length) await loadProject(projects.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0].id);
  await Promise.allSettled([refreshNetwork(), refreshProvider()]);
}

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
  state.path = path; $("#editor").value = state.project.files[path]; $("#active-tab").textContent = path; renderLines(); renderDiagnostics(); renderProject();
  if (line) { const editor = $("#editor"); const position = editor.value.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0); editor.focus(); editor.setSelectionRange(position, position); }
}

function renderLines() { $("#line-numbers").textContent = Array.from({ length: Math.max(1, $("#editor").value.split("\n").length) }, (_, index) => index + 1).join("\n"); }
function renderDiagnostics() {
  const list = state.path ? sourceDiagnostics(state.path, $("#editor").value) : []; const container = $("#diagnostics"); container.replaceChildren(); $("#problem-count").textContent = String(list.length);
  if (!list.length) { container.className = "diagnostics empty"; container.textContent = "No local diagnostics. Compile output remains authoritative."; return; }
  container.className = "diagnostics";
  for (const item of list) { const row = node("button", "diagnostic"); row.append(node("span", `severity ${item.severity}`, item.severity), node("span", "", `${item.code} · ${item.message}`), node("span", "muted", `${item.path}:${item.line}`)); row.onclick = () => openFile(item.path, item.line); container.append(row); }
}

function renderContext() {
  const context = $("#context-files"); context.replaceChildren(node("legend", "", "Approved context"));
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
  $$(".activity-button[data-view]").forEach((button) => button.onclick = () => { $(".agent").classList.toggle("mobile-open", button.dataset.view === "agent"); $$(".activity-button").forEach((item) => item.classList.toggle("active", item === button)); if (button.dataset.view !== "agent") $$(".side-view").forEach((view) => view.classList.toggle("active", view.id === `view-${button.dataset.view}`)); if (button.dataset.view === "source") renderSourceControl(); });
  $("#close-agent").onclick = () => $("aside.agent").classList.remove("mobile-open");
  $$(".panel-tab").forEach((button) => button.onclick = () => { $$(".panel-tab").forEach((item) => item.classList.toggle("active", item === button)); $$(".panel-body").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${button.dataset.panel}`)); });
}

function bindActions() {
  $("#editor").addEventListener("input", () => { renderLines(); renderDiagnostics(); $("#save-state").textContent = "Saving…"; clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveEditor, 350); });
  $("#editor").addEventListener("scroll", () => { $("#line-numbers").scrollTop = $("#editor").scrollTop; });
  $("#ai-intent").addEventListener("input", updateEstimate);
  $("#create-project").onclick = createProject; $("#import-project").onclick = () => $("#file-import").click(); $("#file-import").onchange = importProject; $("#export-project").onclick = exportProject; $("#new-file").onclick = newFile;
  $("#run-search").onclick = runSearch; $("#create-checkpoint").onclick = checkpoint; $("#revert-checkpoint").onclick = revert;
  $("#compile").onclick = compile; $("#run-tests").onclick = () => runTask("test"); $("#run-task").onclick = () => runTask("check"); $("#run-rpc").onclick = runRPC;
  $("#ask-ai").onclick = askAI; $("#cancel-ai").onclick = () => { try { ai.cancel(); } catch (error) { showError(error, $("#ai-output")); } }; $("#apply-ai").onclick = applyAI; $("#reject-ai").onclick = rejectAI;
  $("#clear-ai-history").onclick = clearAIHistory;
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
  try { state.project = await workspace.write(state.project.id, state.path, $("#editor").value); $("#save-state").textContent = "Saved"; renderContext(); }
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
  if (!state.project || !state.path?.endsWith(".sol")) return toast("Open a Solidity file to compile."); await saveEditor(); activatePanel("output"); const output = $("#command-output"); output.textContent = `Checking pinned compiler at ${config.chainURL}…`;
  try { const source = state.project.files[state.path]; const name = source.match(/contract\s+([A-Za-z_]\w*)/u)?.[1] || state.path.split("/").pop().replace(/\.sol$/, ""); state.artifact = await chain.compile({ name, source }); output.textContent = JSON.stringify({ evidence: "real /ide/compile response", compiler: "Solidity 0.8.24", boundedExecution: true, artifact: state.artifact }, null, 2); $("#deployment-state").textContent = "Real compile evidence available. Deployment still requires Wallet review, authorization, final approval and authoritative receipt."; $("#deployment-state").className = "state-card success"; toast("Compile succeeded with returned evidence."); }
  catch (error) { state.artifact = null; showError(error, output); }
}

async function runTask(task) {
  const preview = commandPreview(task, `/projects/${state.project?.id || "none"}`); activatePanel("terminal"); $("#terminal-preview").textContent = JSON.stringify(preview, null, 2);
  const content = node("div"); content.append(node("pre", "", JSON.stringify(preview, null, 2)), node("p", "muted compact", "Web Product cannot execute local commands. An installed unsigned desktop package may provide an allowlisted sandbox executor; destructive, network and deploy actions are not in this task allowlist."));
  if (!await modal({ title: "Approve terminal task", content, confirm: "Approve command" })) return;
  try { const result = await commands.run(preview, { command: true, write: preview.risk !== "read" }, { projectId: state.project?.id, files: state.project?.files }); $("#terminal-preview").textContent = JSON.stringify(result, null, 2); } catch (error) { showError(error, $("#terminal-preview")); }
}

async function runRPC() {
  activatePanel("rpc"); try { const params = JSON.parse($("#rpc-params").value); const result = await chain.rpc($("#rpc-method").value, params); $("#rpc-output").textContent = JSON.stringify({ source: config.chainURL, result }, null, 2); } catch (error) { showError(error, $("#rpc-output")); }
}

async function refreshNetwork() {
  const status = $("#network-status"); try { const result = await chain.health(); status.replaceChildren(node("span", "status-dot online"), node("span", "", `YNX Testnet · height ${result.height ?? "live"}`)); } catch { status.replaceChildren(node("span", "status-dot offline"), node("span", "", "YNX Testnet · unavailable")); }
}

async function refreshProvider() {
  const status = await ai.status(); const pill = $("#provider-status"); pill.textContent = status.available ? `${status.model} · ready` : "Unavailable"; pill.className = `provider ${status.available ? "available" : "unavailable"}`; $("#model-select").replaceChildren(new Option(status.model || "Gateway model unavailable"));
}

async function askAI() {
  if (!state.project) return toast("Open a project first.");
  try {
    state.aiPrepared = ai.prepare({ intent: $("#ai-intent").value, project: state.project, approvedPaths: selectedContext() });
    const review = node("div"); review.append(node("p", "muted compact", "Only these files leave the browser through the permissioned YNX AI Gateway:")); for (const item of state.aiPrepared.privacyPreview) review.append(node("div", "result-item", `${item.path} · ${item.bytes} bytes`)); review.append(node("p", "muted compact", `${state.aiPrepared.estimate.estimatedInputTokens} estimated input tokens. Provider cost is not known and will not be invented.`));
    if (!await modal({ title: "Approve AI context and estimated cost", content: review, confirm: "Stream from Gateway" })) return;
    $("#ask-ai").disabled = true; $("#cancel-ai").disabled = false; $("#ai-output").textContent = "";
    state.aiResult = await ai.stream(state.aiPrepared, { accessToken: $("#gateway-token").value, approved: true, onToken: (token) => { $("#ai-output").textContent += token; } });
    state.project = await workspace.recordConversation(state.project.id, { intent: state.aiPrepared.intent, approvedPaths: state.aiPrepared.files.map((file) => file.path), model: $("#model-select").value, status: state.aiResult.status, output: state.aiResult.output }); renderAIHistory();
    $("#apply-ai").disabled = false; $("#reject-ai").disabled = false;
  } catch (error) {
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
    if (!await modal({ title: "Apply reviewed AI file diff", content, confirm: "Apply files" })) return;
    for (const proposal of proposals) state.project = await workspace.write(state.project.id, proposal.path, proposal.content, { origin: "ai", reviewed: true });
    renderProject(); openFile(proposals[0].path); $("#apply-ai").disabled = true; $("#reject-ai").disabled = true; toast("Reviewed AI diff applied. Create a checkpoint after validation.");
  } catch (error) { showError(error, $("#ai-output")); }
}

function rejectAI() { try { state.aiResult = ai.review(state.aiResult, "reject"); $("#apply-ai").disabled = true; $("#reject-ai").disabled = true; $("#ai-output").textContent += "\n\n[Rejected — no files changed]"; } catch (error) { showError(error, $("#ai-output")); } }

async function clearAIHistory() {
  if (!state.project || !(state.project.conversations ?? []).length) return;
  if (!await modal({ title: "Clear local AI history", content: "This removes locally persisted provider results from this project. The deletion is retained only as a project audit event.", confirm: "Clear history", danger: true })) return;
  state.project = await workspace.clearConversationHistory(state.project.id); renderAIHistory(); toast("Local AI conversation history cleared.");
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
