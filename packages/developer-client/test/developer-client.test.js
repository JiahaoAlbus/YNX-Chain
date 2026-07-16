import assert from "node:assert/strict";
import test from "node:test";
import {
  AICodingAgent, CommandAudit, DeveloperError, MemoryPersistence, ProjectWorkspace,
  DeveloperI18n, MESSAGES, SUPPORTED_LOCALES, DeveloperWalletSession, LocalNonceLedger, WalletDeployment, YNXChainClient, commandPreview, sourceDiagnostics
} from "../src/index.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("project create, persistence, export/import, search, checkpoint, diff and revert", async () => {
  let tick = 1000;
  const persistence = new MemoryPersistence();
  const workspace = new ProjectWorkspace({ persistence, clock: () => ++tick });
  const project = await workspace.create({ name: "Counter Lab", template: "counter" });
  assert.equal((await workspace.list()).length, 1);
  assert.equal((await workspace.search(project.id, "increment", ["src/Counter.sol"])).length, 1);
  const checkpoint = await workspace.checkpoint(project.id, "clean compile");
  await workspace.write(project.id, "src/Counter.sol", project.files["src/Counter.sol"].replace("count += value", "count += value + 1"));
  assert.equal((await workspace.diff(project.id))[0].status, "modified");
  const reverted = await workspace.revert(project.id, checkpoint.id);
  assert.equal(reverted.files["src/Counter.sol"], project.files["src/Counter.sol"]);
  const imported = await workspace.import(await workspace.export(project.id));
  assert.notEqual(imported.id, project.id);
});

test("imports reject traversal and unsupported versions", async () => {
  const workspace = new ProjectWorkspace();
  await assert.rejects(() => workspace.import({ version: 2, name: "bad", files: { "a.sol": "x" } }), (error) => error.code === "unsupported_project_version");
  await assert.rejects(() => workspace.import({ version: 1, name: "bad", files: { "../secret": "x" } }), (error) => error.code === "invalid_path");
});

test("AI writes require reviewed diff", async () => {
  const workspace = new ProjectWorkspace();
  const project = await workspace.create({ name: "Review Gate" });
  await assert.rejects(() => workspace.write(project.id, "src/Counter.sol", "changed", { origin: "ai" }), (error) => error.code === "review_required");
  const applied = await workspace.write(project.id, "src/Counter.sol", "reviewed", { origin: "ai", reviewed: true });
  assert.equal(applied.files["src/Counter.sol"], "reviewed");
});

test("AI conversation history persists approved context without access tokens and can be deleted", async () => {
  const persistence = new MemoryPersistence(); const workspace = new ProjectWorkspace({ persistence });
  let project = await workspace.create({ name: "AI History" });
  project = await workspace.recordConversation(project.id, { intent: "explain source", approvedPaths: ["src/Counter.sol"], model: "provider-model", status: "review-required", output: "src/Counter.sol:1" });
  assert.equal(project.conversations.length, 1); assert.equal(JSON.stringify(project).includes("accessToken"), false);
  project = await workspace.clearConversationHistory(project.id); assert.equal(project.conversations.length, 0); assert.equal(project.audit.at(-1).event, "ai.history.cleared");
});

test("command preview and approvals expose command cwd environment and audit", async () => {
  const preview = commandPreview("test", "/workspace/project");
  assert.deepEqual({ command: preview.command, cwd: preview.cwd, environmentClass: preview.environmentClass }, { command: "node --test test/*.test.js", cwd: "/workspace/project", environmentClass: "desktop-project-sandbox" });
  const audit = new CommandAudit({ executor: async (_preview, { onChunk }) => { onChunk("2 passing\n"); return { code: 0 }; } });
  await assert.rejects(() => audit.run(preview, { command: true }), (error) => error.code === "write_approval_required");
  const result = await audit.run(preview, { command: true, write: true });
  assert.equal(result.status, "passed"); assert.match(result.output, /2 passing/);
});

test("web terminal fails closed without desktop executor", async () => {
  const audit = new CommandAudit();
  await assert.rejects(() => audit.run(commandPreview("git-diff", "/workspace/project"), { command: true }), (error) => error.code === "desktop_executor_unavailable");
});

test("pinned compiler compiles only exact Solidity 0.8.24 and preserves evidence", async () => {
  const calls = [];
  const client = new YNXChainClient({ fetcher: async (url, options = {}) => {
    calls.push([url, options]);
    if (url.endsWith("/ide/compiler")) return json({ version: "0.8.24", optimizerEnabled: true, optimizerRuns: 200, pinned: true });
    return json({ ok: true, artifactHash: "0xartifact", bytecodeHash: "0xbytecode", diagnostics: [] });
  }});
  const result = await client.compile({ name: "C", source: "pragma solidity 0.8.24; contract C {}" });
  assert.equal(result.artifactHash, "0xartifact"); assert.equal(calls.length, 2);
  await assert.rejects(() => client.compile({ name: "C", source: "pragma solidity ^0.8.0; contract C {}" }), (error) => error.code === "unsupported_compiler_path");
});

test("unsupported or mutating RPC methods fail clearly", async () => {
  const client = new YNXChainClient({ fetcher: async () => json({ result: "0x1927" }) });
  assert.equal(await client.rpc("eth_chainId"), "0x1927");
  assert.throws(() => client.rpc("eth_sendTransaction", []), (error) => error.code === "rpc_method_not_allowed");
});

test("Wallet-only deployment requires confirmation, provider and authoritative receipt", async () => {
  const chainClient = { receipt: async (hash) => ({ transactionHash: hash, status: "0x1", contractAddress: "0x00000000000000000000000000000000000000aa" }) };
  const absent = new WalletDeployment({ wallet: null, chainClient });
  const review = absent.review({ projectId: "p", account: "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k", artifact: { artifactHash: "artifact" } });
  await assert.rejects(() => absent.authorize(review, { confirmed: true }), (error) => error.code === "wallet_unavailable");
  const wallet = { authorizeDeployment: async () => ({ status: "authorized", requestId: "wallet-request" }), signAndSubmitDeployment: async () => ({ submitted: true, txHash: `0x${"a".repeat(64)}` }) };
  const deployment = new WalletDeployment({ wallet, chainClient });
  await assert.rejects(() => deployment.authorize(review), (error) => error.code === "deployment_confirmation_required");
  const authorization = await deployment.authorize(review, { confirmed: true });
  const submission = await deployment.signAndSubmit(review, authorization, { approved: true });
  assert.equal((await deployment.confirm(submission)).status, "confirmed");
});

test("source match never promotes local evidence to remote proof", async () => {
  const deployment = new WalletDeployment({ chainClient: { verify: async () => ({ verified: true }), verifier: async () => ({ deployedBytecodeComparisonStatus: "matched_local_deployed_bytecode_hash", remotePublicProofStatus: "not_remote_public_proof" }) } });
  const result = await deployment.sourceMatch({ address: "0x1" }, "source");
  assert.equal(result.status, "source-matched-local-evidence"); assert.equal(result.remotePublicProof, false);
});

test("Wallet Auth uses exact Developer binding, POST Gateway completion and memory-only session", async () => {
  let request; const calls = []; const now = Date.parse("2026-07-16T00:00:00.000Z");
  const wallet = {
    getProductDevicePublicKey: async () => `A${"a".repeat(43)}`,
    authorize: async (value) => { request = value; return { version:"1",requestDigest:"a".repeat(64),nonce:value.nonce,chainId:value.chainId,requestingProduct:value.requestingProduct,productClientId:value.productClientId,bundleId:value.bundleId,productDeviceAlgorithm:value.productDeviceAlgorithm,productDeviceKey:value.productDeviceKey,callback:value.callback,account:`ynx1${"q".repeat(38)}`,accountPublicKey:`02${"a".repeat(64)}`,grantedScopes:[...value.scopes],purpose:value.purpose,issuedAt:value.issuedAt,expiresAt:value.expiresAt,walletSignature:"b".repeat(128) }; },
    signProductChallenge: async (challenge) => ({ challenge, deviceSignature: "device-proof" }),
  };
  const fetcher = async (url, options) => { calls.push([url, options]); if (url.endsWith("/challenges")) return json({ challenge: "server-bound" }); return json({ account:`ynx1${"q".repeat(38)}`,expiresAt:request.expiresAt,productClientId:"ynx-developer-v1",sessionToken:"memory-only-token",scopes:["account:read","developer:deploy"] }); };
  const session = new DeveloperWalletSession({ wallet, gatewayURL:"https://gateway.invalid/app", fetcher, clock:()=>now, ledger:new LocalNonceLedger({ getItem:()=>null, setItem(){} }) });
  await assert.rejects(() => session.signIn(), (error) => error.code === "wallet_permission_required");
  const result = await session.signIn({ approved:true });
  assert.equal(result.productClientId, "ynx-developer-v1"); assert.equal(request.bundleId, "com.ynxweb4.developer.testnetpreview");
  assert.deepEqual(calls.map((call) => call[1].method), ["POST","POST"]); assert.equal(JSON.stringify(calls).includes("memory-only-token"), false);
});

test("Wallet nonce ledger persists replay rejection and altered approval fails before Gateway", async () => {
  const data = new Map(); const storage = { getItem:(key)=>data.get(key) ?? null, setItem:(key,value)=>data.set(key,value) }; const ledger = new LocalNonceLedger(storage);
  ledger.consume("nonce"); assert.throws(() => ledger.consume("nonce"), (error) => error.code === "wallet_replay_rejected");
  let network = false; const now = Date.parse("2026-07-16T00:00:00.000Z");
  const wallet = { getProductDevicePublicKey:async()=>`A${"a".repeat(43)}`, authorize:async(value)=>({ version:"1",requestDigest:"a".repeat(64),nonce:value.nonce,chainId:value.chainId,requestingProduct:value.requestingProduct,productClientId:"substituted",bundleId:value.bundleId,productDeviceAlgorithm:value.productDeviceAlgorithm,productDeviceKey:value.productDeviceKey,callback:value.callback,account:`ynx1${"q".repeat(38)}`,accountPublicKey:`02${"a".repeat(64)}`,grantedScopes:[...value.scopes],purpose:value.purpose,issuedAt:value.issuedAt,expiresAt:value.expiresAt,walletSignature:"b".repeat(128)}), signProductChallenge:async()=>({}) };
  const session = new DeveloperWalletSession({ wallet, fetcher:async()=>{ network=true; return json({}); }, clock:()=>now, ledger:new LocalNonceLedger(storage,"second") });
  await assert.rejects(() => session.signIn({ approved:true }), (error) => error.code === "wallet_tamper_rejected"); assert.equal(network,false);
});

test("AI context is least privilege, cost is labeled estimate, permission is mandatory", async () => {
  const project = { files: { "src/A.sol": "line one", "secret.txt": "do not send" } };
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"Patch with src/A.sol:1"}\n\nevent: done\ndata: {}\n\n')); controller.close(); } });
  let requestURL; let requestOptions;
  const agent = new AICodingAgent({ fetcher: async (url, options) => { requestURL = url; requestOptions = options; return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }); } });
  const prepared = agent.prepare({ intent: "explain this source", project, approvedPaths: ["src/A.sol"] });
  assert.deepEqual(prepared.privacyPreview.map((item) => item.path), ["src/A.sol"]);
  assert.equal(prepared.prompt.includes("do not send"), false); assert.equal(prepared.estimate.estimatedYNXT, null);
  await assert.rejects(() => agent.stream(prepared, { accessToken: "session-token" }), (error) => error.code === "ai_permission_required");
  const result = await agent.stream(prepared, { accessToken: "session-token", approved: true });
  assert.equal(result.status, "review-required"); assert.match(result.output, /src\/A.sol:1/);
  assert.equal(requestURL, "http://127.0.0.1:6429/ai/stream"); assert.equal(requestOptions.method, "POST");
  assert.equal(requestURL.includes(prepared.prompt), false); assert.equal(JSON.parse(requestOptions.body).workflow, "developer.coding-agent");
  assert.equal(agent.review(result, "reject").status, "rejected");
});

test("AI context fails before network when the Gateway request limit would be exceeded", () => {
  const agent = new AICodingAgent();
  assert.throws(() => agent.prepare({ intent: "review source", project: { files: { "src/Large.sol": "x".repeat(8000) } }, approvedPaths: ["src/Large.sol"] }), (error) => error.code === "ai_context_too_large");
});

test("diagnostics explain unsupported compiler and syntax shape", () => {
  const diagnostics = sourceDiagnostics("src/A.sol", "pragma solidity ^0.8.0; contract A {");
  assert.deepEqual(diagnostics.map((item) => item.code), ["YNX001", "YNX003", "YNX004"]);
});

test("all 12 locales are complete, persistent and Arabic is RTL", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"]);
  const keys = Object.keys(MESSAGES.en); for (const locale of SUPPORTED_LOCALES) assert.deepEqual(Object.keys(MESSAGES[locale]), keys), assert.ok(Object.values(MESSAGES[locale]).every((value)=>value.trim()));
  const data = new Map(); const storage={getItem:(key)=>data.get(key),setItem:(key,value)=>data.set(key,value)}; const i18n=new DeveloperI18n({locale:"ar",storage});
  assert.equal(i18n.dir,"rtl"); assert.match(i18n.t("privateKeyBoundary"),/المفتاح الخاص/); i18n.setLocale("ja"); assert.equal(new DeveloperI18n({storage}).locale,"ja");
  assert.ok(i18n.number(1234).length>0); assert.ok(i18n.date("2026-07-16T00:00:00.000Z").length>0); assert.equal(i18n.plural(2,{other:"files"}),"files");
});
