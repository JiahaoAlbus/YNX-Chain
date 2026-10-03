import {serializeMediaBody} from './business-wire.js';
import {connectMediaWallet} from './session-events.js';
import {dispatchPreparedProductRequest} from "./product-session.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";

const source = (await readFile(new URL("app.js", import.meta.url), "utf8"))
  .replace(/^import\b[\s\S]*?from\s*["'][^"']+["'];?\n/gm, "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const connected = account => ({ status: "connected", session: { account } });
const privateSnapshot = marker => ({
  analytics: { views: 7, watch_seconds: 12, subscribers: 3, revenue_ynxt: 5 },
  videos: [{ id: marker, title: marker, status: "ready", visibility: "private" }],
  team: [{ channel_id: marker, members: [{ account: marker, role: "owner" }] }],
  rights: [{ video_id: marker, state: "declared" }],
  revenue: [{ id: marker, amount_ynxt: 5 }], payout_intents: [{ id: marker }],
  reports: [{ id: marker }], appeals: [{ id: marker }], disputes: [{ id: marker }],
});
const privateLists = ["videos", "team-list", "rights-list", "revenue-list", "payout-list", "report-list", "appeal-list", "dispute-list"];

class Element {
  constructor() {
    this.textContent = ""; this.innerHTML = ""; this.style = {}; this.hidden = false; this.disabled = false;
    this.listeners = new Map(); this.children = []; this.value = ""; this.checked = false; this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.elements = Object.fromEntries(["channel_id", "video_id", "source_sha256"].map(name => [name, { value: "" }]));
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  replaceChildren(...children) { this.children = children; this.innerHTML = ""; this.textContent = ""; }
  append(child) { this.children.push(child); }
  before() {}
  querySelector() { return new Element(); }
  reset() { for (const field of Object.values(this.elements)) field.value = ""; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { this.clicked = true; this.onclick?.(); }
}

async function app(overrides = {}) {
  const nodes = new Map();
  const element = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const forms = [element("#channel-form"), element("#upload-form"), element("#rights-form")];
  const document = {
    querySelector: element, querySelectorAll: selector => selector === ".panel form" ? forms : [],
    getElementById: id => element(`#${id}`), createElement: () => new Element(),
  };
  const dependencies = {
    window: {location:{origin:"https://creator.ynxweb4.com"}}, AbortController, document, localStorage: { getItem: () => null }, location: { origin: "https://creator.ynxweb4.com", assign() {} },
    crypto: { randomUUID, subtle: webcrypto.subtle }, TextDecoder, Uint8Array, FormData,
    atRegisteredOrigin: () => true, prepareProductSignIn: async () => ({ url: "test:creator-signin" }),
    restoreProductSession: async () => ({ status: "disconnected", message: "Sign in" }),
    restoreNativeProductReturn:async()=>null, disconnectProductSession: async () => ({ status: "disconnected" }), productAuthorization: async () => ({}),
    fetch: async () => { throw new Error("Unexpected fetch"); },
    createStandardWalletConnectState: () => ({}), reduceStandardWalletConnectState: state => state,
    serializeMediaBody, connectMediaWallet, dispatchPreparedProductRequest, finishProductReturn: async () => connected("fixture-account"),
    discoverWalletProviders: async () => ({candidates: []}), i18nReady: Promise.resolve(), t: key => key,
    confirm: () => false, prompt: () => null, ...overrides,
  };
  // Execute the shipped controller and its actual registered handlers; only module dependencies and DOM/network are fixtures.
  const originalFetch=dependencies.fetch;dependencies.fetch=async(url,input)=>{const response=await originalFetch(url,input);if(String(url).includes('/v1/channels/')&&(!input?.method||input.method==='GET')){const data=await response.json();if(response.ok&&Array.isArray(data.team)&&!data.channel&&!data.Channel){const id=decodeURIComponent(String(url).split('/').at(-1));return {ok:true,status:200,json:async()=>({channel:{ID:id,Name:'Fixture channel'}})};}return {ok:response.ok,status:response.status,json:async()=>data};}return response;};
  const controller = await new AsyncFunction(...Object.keys(dependencies), `${source}\nreturn {refresh,restoreCreator,resumeNativeSignIn,renderProductState,showAI,providerStatus,api,readState:()=>({snapshot,currentAI,creatorAccount})};`)(...Object.values(dependencies));
  return { ...controller, element, forms, click: id => element(`#${id}`).listeners.get("click")(), run: id => element(`#${id}`).onclick() };
}

function assertCleared(controller, marker) {
  assert.equal(controller.readState().snapshot, null);
  assert.equal(controller.readState().currentAI, null);
  assert.equal(controller.readState().creatorAccount, null);
  for (const id of privateLists) {
    const node = controller.element(`#${id}`);
    assert.doesNotMatch(node.innerHTML, new RegExp(marker));
    assert.equal(node.children.length, 0);
  }
  for (const id of ["views", "watch", "subs", "revenue"]) assert.equal(controller.element(`#${id}`).textContent, "—");
  assert.equal(controller.element("#channel-result").textContent, "No channel loaded.");
  assert.equal(controller.element("#ai-result").textContent, "No AI request prepared.");
  for (const id of ["ai-run", "ai-cancel", "ai-accept", "ai-reject", "ai-delete"]) assert.equal(controller.element(`#${id}`).disabled, true);
}

test('sign out releases a private request whose proof provider never settles', async () => {
  let calls=0;
  const controller=await app({productAuthorization:()=>new Promise(()=>{}),fetch:async()=>{calls++;return response({});}});
  controller.renderProductState(connected('owner-a'));
  const pending=controller.api('/v1/studio');
  const rejected=assert.rejects(pending,/Creator account changed/);
  await controller.click('product-disconnect');
  await rejected;
  assert.equal(calls,0);
});

test('multipart upload is sent once when its network result is unknown', async () => {
  let calls=0;
  const controller=await app({fetch:async()=>{calls++;throw new TypeError('Network disconnected');}});
  controller.renderProductState(connected('owner-a'));
  const body=new FormData();body.set('title','Owned video');
  await assert.rejects(controller.api('/v1/uploads',{method:'POST',body}),/Network disconnected/);
  assert.equal(calls,1,'a fresh multipart boundary must not replay the same idempotency key');
});

test('caller cancellation aborts the request and cannot trigger automatic retry', async () => {
  let calls=0,observedSignal;const walletEvents=[];
  const controller=await app({fetch:async(_url,input)=>{calls++;observedSignal=input.signal;return new Promise(()=>{});},reduceStandardWalletConnectState:(state,event)=>{walletEvents.push(event.type);return state;}});
  controller.renderProductState(connected('owner-a'));
  const cancel=new AbortController(),pending=controller.api('/v1/studio',{signal:cancel.signal});
  const rejected=assert.rejects(pending,/cancelled/);
  await turn();cancel.abort(new Error('cancelled'));
  await rejected;
  assert.equal(observedSignal.aborted,true);
  assert.equal(calls,1);
  assert.equal(walletEvents.includes('PRIVATE_SESSION_DEGRADED'),false,'an explicit cancellation is not a degraded private session');
});

test('upload hashes a stable form snapshot and cancel while hashing sends no request', async () => {
  const digest=deferred();let uploads=0,body;
  const controller=await app({crypto:{randomUUID,subtle:{digest:()=>digest.promise}},fetch:async(url,input)=>{
    if(url.endsWith('/v1/uploads')){uploads++;body=await new Request('https://creator.ynxweb4.com/',{method:'POST',body:input.body,headers:input.headers}).formData();return response({id:'owned-source',status:'processing'});}
    return response({team:[],videos:[]});
  }});
  controller.renderProductState(connected('owner-a'));
  const form=controller.element('#upload-form');
  for(const name of ['channel_id','title','description','rights_basis','rights_source','rights_license','rights_territories','rights_expires_at','rights_evidence_sha256'])form[name]={value:''};
  form.title.value='Original title';form.channel_id.value='channel-a';form.owned={checked:true};form.media={files:[new File(['owned media'],'owned.mp4',{type:'video/mp4'})]};
  const first=form.onsubmit({preventDefault(){},target:form});
  form.title.value='Edited while hashing';form.channel_id.value='channel-b';
  digest.resolve(new Uint8Array(32).buffer);await first;
  assert.equal(uploads,1);assert.equal(body.get('title'),'Original title');assert.equal(body.get('channel_id'),'channel-a');
  const second=form.onsubmit({preventDefault(){},target:form});
  controller.element('#upload-cancel').onclick();await second;
  assert.equal(uploads,1);assert.equal(controller.element('#upload-cancel').hidden,true);
  assert.match(controller.element('#status').textContent,/Check Content before trying again/);
});

test('a saved failed upload recovers its original content record without resending the file', async () => {
  let uploads=0;
  const controller=await app({crypto:{randomUUID,subtle:{digest:async()=>new Uint8Array(32).buffer}},fetch:async(url)=>{
    if(url.endsWith('/v1/uploads')){uploads++;return response({error:'Transcoding failed',video_id:'saved-owned',status:'failed',recovery:'retry-processing'},422);}
    return response({team:[],videos:[{id:'saved-owned',channel_id:'channel-a',title:'Owned video',sha256:'0'.repeat(64),status:'failed'}]});
  }});
  controller.renderProductState(connected('owner-a'));
  const form=controller.element('#upload-form');
  for(const name of ['channel_id','title','description','rights_basis','rights_source','rights_license','rights_territories','rights_expires_at','rights_evidence_sha256'])form[name]={value:''};
  form.channel_id.value='channel-a';form.owned={checked:true};form.media={files:[new File(['owned media'],'owned.mp4',{type:'video/mp4'})]};
  await form.onsubmit({preventDefault(){},target:form});
  assert.equal(uploads,1);
  assert.equal(controller.readState().snapshot.videos[0].id,'saved-owned');
  assert.equal(controller.element('nav button[data-panel="content"]').clicked,true);
  assert.match(controller.element('#status').textContent,/uploaded file is saved.*Retry processing/);
});

function ownedUploadForm(controller) {
  const form=controller.element('#upload-form');
  for(const name of ['channel_id','title','description','rights_basis','rights_source','rights_license','rights_territories','rights_expires_at','rights_evidence_sha256'])form[name]={value:''};
  form.channel_id.value='channel-a';form.title.value='New title and rights';form.owned={checked:true};
  form.media={files:[new File(['owned media'],'owned.mp4',{type:'video/mp4'})]};
  return form;
}

test('upload proof failure never claims a matching historical file is this saved upload', async () => {
  let uploadCalls=0,studioReads=0;
  const historical={id:'old-failed',channel_id:'channel-a',title:'Old title and rights',sha256:'0'.repeat(64),status:'failed'};
  const controller=await app({
    crypto:{randomUUID,subtle:{digest:async()=>new Uint8Array(32).buffer}},
    productAuthorization:async path=>{if(path==='/v1/uploads')throw Error('Cannot sign this upload');return {};},
    fetch:async url=>{if(url.endsWith('/v1/uploads'))uploadCalls++;else studioReads++;return response({team:[],videos:[historical]});},
  });
  controller.renderProductState(connected('owner-a'));await controller.refresh();
  const form=ownedUploadForm(controller);
  await form.onsubmit({preventDefault(){},target:form});
  assert.equal(uploadCalls,0);assert.equal(studioReads,1);
  assert.equal(controller.readState().snapshot.videos[0].id,'old-failed');
  assert.notEqual(controller.element('nav button[data-panel="content"]').clicked,true);
  assert.equal(controller.element('#status').textContent,'Cannot sign this upload');
});

test('upload recovery requires the exact service ID, source hash and authorized channel', async t => {
  const stored={id:'saved-owned',channel_id:'channel-a',title:'Owned source',sha256:'0'.repeat(64),status:'failed'};
  for(const [name,details,record] of [
    ['missing service ID',{},stored],
    ['invalid service ID',{video_id:'../saved-owned'},stored],
    ['different record ID',{video_id:'different-record'},stored],
    ['different source hash',{video_id:'saved-owned'},{...stored,sha256:'1'.repeat(64)}],
    ['different channel',{video_id:'saved-owned'},{...stored,channel_id:'channel-b'}],
  ])await t.test(name,async()=>{
    let uploadCalls=0;
    const controller=await app({
      crypto:{randomUUID,subtle:{digest:async()=>new Uint8Array(32).buffer}},
      fetch:async url=>{if(url.endsWith('/v1/uploads')){uploadCalls++;return response({error:'Processing failed',...details},400);}return response({team:[],videos:[record]});},
    });
    controller.renderProductState(connected('owner-a'));
    const form=ownedUploadForm(controller);await form.onsubmit({preventDefault(){},target:form});
    assert.equal(uploadCalls,1);
    assert.notEqual(controller.element('nav button[data-panel="content"]').clicked,true);
    assert.equal(controller.element('#status').textContent,'Processing failed');
  });
});

test('an old AI stream fallback cannot replace a newly selected job', async t => {
  for(const mode of ['stream-error','stream-ended'])await t.test(mode,async()=>{
    const oldRead=deferred();let reading=false,readSignal;
    const controller=await app({fetch:async(url,input)=>{
      if(url.endsWith('/stream'))return mode==='stream-error'?{ok:false,status:503}:{ok:true,status:200,body:{getReader:()=>({read:async()=>({done:true}),cancel:async()=>{},releaseLock(){}})}};
      if(url.endsWith('/v1/ai/jobs/job-a')){reading=true;readSignal=input.signal;return oldRead.promise;}
      throw Error('Unexpected request '+url);
    }});
    controller.renderProductState(connected('owner-a'));controller.showAI({id:'job-a',state:'awaiting_permission'});
    const pending=controller.run('ai-run');await turn();assert.equal(reading,true);
    controller.showAI({id:'job-b',state:'awaiting_permission'});
    assert.equal(readSignal.aborted,true);
    oldRead.resolve(response({id:'job-a',state:'failed'}));await pending;
    assert.equal(controller.readState().currentAI.id,'job-b');
    assert.equal(controller.readState().currentAI.state,'awaiting_permission');
    assert.match(controller.element('#ai-result').textContent,/job-b/);
    assert.doesNotMatch(controller.element('#ai-result').textContent,/job-a/);
  });
});

test('late AI cancel, review and delete replies cannot alter a newer selection', async t => {
  for(const action of ['ai-cancel','ai-accept','ai-reject','ai-delete']){
    for(const sameID of [false,true])await t.test(action+(sameID?' after reselecting the old ID':' after selecting another ID'),async()=>{
      const reply=deferred();let calls=0;
      const controller=await app({confirm:()=>true,fetch:async()=>{calls++;return reply.promise;}});
      controller.renderProductState(connected('owner-a'));controller.showAI({id:'job-a',state:'review_required'});
      const pending=controller.run(action);await turn();assert.equal(calls,1);
      controller.showAI({id:'job-b',state:'awaiting_permission'});
      if(sameID)controller.showAI({id:'job-a',state:'awaiting_permission'});
      controller.element('#status').textContent='New selection remains active';
      reply.resolve(response(action==='ai-delete'?{ok:true}:{id:'job-a',state:'cancelled'}));await pending;
      assert.equal(controller.readState().currentAI.id,sameID?'job-a':'job-b');
      assert.equal(controller.readState().currentAI.state,'awaiting_permission');
      assert.equal(controller.element('#ai-run').disabled,false);
      assert.equal(controller.element('#status').textContent,'New selection remains active');
      assert.equal(calls,1,'old delete must not refresh the new selection');
    });
  }
});

test('newer AI preparation wins when earlier creation completes late', async () => {
  const first=deferred(),second=deferred();let calls=0;
  const controller=await app({fetch:async()=>++calls===1?first.promise:second.promise});
  controller.renderProductState(connected('owner-a'));
  const form=controller.element('#ai-form');form.video_id={value:'video-a'};form.kind={value:'summary'};form.metadata={checked:true};
  const earlier=form.onsubmit({preventDefault(){},target:form});await turn();
  form.video_id.value='video-b';
  const later=form.onsubmit({preventDefault(){},target:form});await turn();assert.equal(calls,2);
  second.resolve(response({id:'job-b',state:'awaiting_permission'}));await later;
  assert.equal(controller.readState().currentAI.id,'job-b');
  controller.element('#status').textContent='New preparation remains active';
  first.resolve(response({id:'job-a',state:'awaiting_permission'}));await earlier;
  assert.equal(controller.readState().currentAI.id,'job-b');
  assert.equal(controller.element('#status').textContent,'New preparation remains active');
});

test("sign out immediately clears every private view and form while revocation is pending", async () => {
  const revoke = deferred();
  const controller = await app({ fetch: async () => response(privateSnapshot("private-owner-a")), disconnectProductSession: () => revoke.promise });
  controller.renderProductState(connected("owner-a"));
  assert.equal(await controller.refresh(), true);
  controller.showAI({ id: "private-owner-a", context: "private context", state: "review_required" });
  controller.element("#channel-result").textContent = "private-owner-a";
  for (const form of controller.forms) form.elements.channel_id.value = "private-owner-a";
  controller.element("#product-native-open").href = "test:old-pending-return";
  const signingOut = controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
  for (const form of controller.forms) assert.equal(form.elements.channel_id.value, "");
  assert.equal(controller.element("#product-native-open").hidden, true);
  assert.equal(controller.element("#product-native-open").href, undefined);
  revoke.resolve({ status: "disconnected" });
  await signingOut;
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
  assert.equal(controller.element("#product-status").textContent, "Sign in to manage your channel.");
  assert.equal(controller.element("#product-disconnect").disabled, false);
});

test("a 401 with no studio snapshot still permits complete sign out", async () => {
  const controller = await app({ fetch: async () => response({ error: "Session expired" }, 401) });
  controller.renderProductState(connected("owner-a"));
  assert.equal(await controller.refresh(), false);
  assert.equal(controller.element("#status").textContent, "Session expired");
  await controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
});

test("a studio response arriving after sign out cannot restore account data or replace its status", async () => {
  const request = deferred();
  let calls = 0;
  const controller = await app({ fetch: () => { calls++; return request.promise; } });
  controller.renderProductState(connected("owner-a"));
  const refresh = controller.refresh();
  await turn();
  assert.equal(calls, 1);
  await controller.click("product-disconnect");
  request.resolve(response(privateSnapshot("private-owner-a")));
  assert.equal(await refresh, false);
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
  assert.equal(await controller.refresh(), false);
  assert.equal(calls, 1);
});

test("an old account response cannot overwrite a newly signed-in account", async () => {
  const oldRequest = deferred();
  let calls = 0;
  const controller = await app({ fetch: () => ++calls === 1 ? oldRequest.promise : Promise.resolve(response(privateSnapshot("private-owner-b"))) });
  controller.renderProductState(connected("owner-a"));
  const oldRefresh = controller.refresh();
  await turn();
  await controller.click("product-disconnect");
  controller.renderProductState(connected("owner-b"));
  assert.equal(await controller.refresh(), true);
  oldRequest.resolve(response(privateSnapshot("private-owner-a")));
  assert.equal(await oldRefresh, false);
  assert.equal(controller.readState().creatorAccount, "owner-b");
  assert.equal(controller.readState().snapshot.videos[0].id, "private-owner-b");
  assert.doesNotMatch(controller.element("#revenue-list").innerHTML, /private-owner-a/);
});

test("proof creation completing after sign out never sends an authenticated business request", async () => {
  const proof = deferred();
  let calls = 0;
  const controller = await app({ productAuthorization: () => proof.promise, fetch: async () => { calls++; return response({}); } });
  controller.renderProductState(connected("owner-a"));
  const request = controller.api("/v1/channels", { method: "POST" });
  const rejected = assert.rejects(request, /Creator account changed/);
  await controller.click("product-disconnect");
  proof.resolve({});
  await rejected;
  assert.equal(calls, 0);
});

test("a late channel mutation response cannot refill channel output and upload forms", async () => {
  const request = deferred();
  const controller = await app({ fetch: () => request.promise });
  controller.renderProductState(connected("owner-a"));
  const submit = controller.element("#channel-form").onsubmit({ preventDefault() {}, target: { handle: { value: "test-owner" }, name: { value: "Test owner" } } });
  await turn();
  await controller.click("product-disconnect");
  request.resolve(response({ ID: "private-owner-a", Name: "Private channel" }));
  await submit;
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#upload-form").elements.channel_id.value, "");
});

test("AI stream chunks after sign out are discarded and their reader is cancelled", async () => {
  const chunk = deferred();
  let cancelled = 0, released = 0, reads = 0, calls = 0;
  const reader = { read: () => { reads++; return chunk.promise; }, cancel: async () => { cancelled++; }, releaseLock: () => { released++; } };
  const controller = await app({ fetch: async () => { calls++; return { ok: true, body: { getReader: () => reader } }; } });
  controller.renderProductState(connected("owner-a"));
  controller.showAI({ id: "private-owner-a", state: "awaiting_permission" });
  const stream = controller.run("ai-run");
  await turn();
  assert.equal(reads, 1);
  await controller.click("product-disconnect");
  await stream; // Cancellation releases a pending reader without waiting for a new chunk.
  chunk.resolve({ done: false, value: new TextEncoder().encode('{"delta":"private-owner-a","job":{"id":"private-owner-a","state":"review_required"}}\n') });
  await turn();
  assertCleared(controller, "private-owner-a");
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
  assert.equal(calls, 1);
});

test("a restored session arriving after sign out cannot reconnect the page", async () => {
  const restore = deferred();
  let calls = 0;
  const controller = await app({ restoreProductSession: () => restore.promise, fetch: async () => { calls++; return response({}); } });
  await controller.click("product-disconnect");
  restore.resolve(connected("owner-a"));
  await turn();
  assertCleared(controller, "private-owner-a");
  assert.equal(calls, 0);
  assert.equal(controller.element("#product-status").textContent, "Sign in to manage your channel.");
});

test("missing analytics and nullable audit lists render empty values without throwing", async () => {
  const controller = await app({ fetch: async () => response({ analytics: null, revenue: null, payout_intents: null, reports: null, appeals: null, disputes: null }) });
  controller.renderProductState(connected("owner-a"));
  assert.equal(await controller.refresh(), true);
  for (const id of ["views", "watch", "subs", "revenue"]) assert.equal(controller.element(`#${id}`).textContent, "—");
  await controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
});

test("failed revocation keeps private views empty and offers an explicit sign-out retry", async () => {
  let attempts = 0;
  const controller = await app({ disconnectProductSession: async () => ++attempts === 1
    ? { status: "network-unavailable", message: "Revocation not confirmed; retry when Auth is available." }
    : { status: "disconnected" } });
  controller.renderProductState(connected("owner-a"));
  await controller.click("product-disconnect");
  assertCleared(controller, "private-owner-a");
  assert.equal(controller.element("#product-disconnect").hidden, false);
  assert.equal(controller.element("#product-disconnect").textContent, "Retry sign out");
  assert.equal(controller.element("#product-signin").disabled, true);
  assert.doesNotMatch(controller.element("#status").textContent, /disconnected/);
  await controller.click("product-disconnect");
  assert.equal(attempts, 2);
  assert.equal(controller.element("#product-disconnect").hidden, true);
  assert.equal(controller.element("#product-signin").disabled, false);
  assert.equal(controller.element("#status").textContent, "Creator account disconnected.");
});

test("prepared Wallet link becomes visible and focused after its exact URL is set", async () => {
  const prepared = deferred();
  const controller = await app({ prepareProductSignIn: () => prepared.promise,setTimeout:()=>1,clearTimeout(){} });
  await turn();
  await controller.click("product-signin");
  const preparation = controller.element("#product-wallet-choices").children.at(-1).onclick();
  assert.equal(controller.element("#product-native-open").hidden, true);
  assert.equal(controller.element("#product-native-open").href, undefined);
  prepared.resolve({ url: "ynxwallet://product-session/v2?request=test-fixture", expiresAt:new Date(Date.now()+60000).toISOString() });
  await preparation;
  assert.equal(controller.element("#product-native-open").href, "ynxwallet://product-session/v2?request=test-fixture");
  assert.equal(controller.element("#product-native-open").hidden, false);
  assert.equal(controller.element("#product-native-open").focused, true);
  assert.equal(controller.element("#product-wallet-chooser").open, true);
  await controller.run("product-wallet-cancel");
});

test('a stored pending logout stays explicit after page restore and blocks new Creator approval', async () => {
  let preparations=0,restores=0;
  const controller=await app({restoreProductSession:async()=>{restores++;return {status:'retry-required',revocationPending:true,message:'Sign-out is pending. Explicitly retry.'};},prepareProductSignIn:async()=>{preparations++;}});
  await turn();
  assert.equal(controller.element('#product-signin').disabled,true);
  assert.equal(controller.element('#product-disconnect').hidden,false);
  assert.equal(controller.element('#product-disconnect').textContent,'Retry sign out');
  assert.equal(controller.element('#product-status').textContent,'Sign-out is pending. Explicitly retry.');
  await controller.click('product-signin');await controller.restoreCreator();
  assert.equal(preparations,0);assert.equal(restores,1);
  await controller.click('product-disconnect');
  assert.equal(controller.element('#product-signin').disabled,false);
});

test('a Creator sign-in racing initial restore retains explicit SDK pending logout controls',async()=>{
 const initial=deferred(),state={status:'retry-required',revocationPending:true,message:'Pending sign-out'};
 const c=await app({restoreProductSession:()=>initial.promise,prepareProductSignIn:async()=>{throw Object.assign(new Error(state.message),{productSessionState:state});}});
 await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();initial.resolve(connected('old'));await turn();
 assert.equal(c.element('#product-signin').disabled,true);
 assert.equal(c.element('#product-disconnect').hidden,false);
 assert.equal(c.element('#product-disconnect').textContent,'Retry sign out');
 assert.equal(c.element('#product-open').hidden,true);
 assert.equal(c.readState().creatorAccount,null);
});

test('normal Creator chooser dispatches selected YNX V2 and refreshes the original owned workspace',async()=>{
 const requests=[];const provider={request:async input=>{requests.push(input);return {version:2,returnUrl:'callback-fixture'};}};
 let returns=0,reads=0;
 const c=await app({discoverWalletProviders:async()=>({candidates:[{kind:'ynx-wallet',name:'YNX Wallet',provider},{kind:'metamask',provider:{request(){throw Error('wrong provider')}}}]}),
 finishProductReturn:async url=>{assert.equal(url,'callback-fixture');returns++;return connected('native-owner');},fetch:async()=>{reads++;return response(privateSnapshot('owned'));}});
 await turn();await c.click('product-signin');assert.equal(c.element('#product-wallet-choices').children.length,4);
 await c.element('#product-wallet-choices').children[0].onclick();
 assert.deepEqual(requests,[{method:'ynx_requestProductSessionV2',params:['test:creator-signin']}]);assert.equal(returns,1);assert.equal(c.readState().creatorAccount,'native-owner');assert.ok(reads>0);assert.equal(c.element('#product-wallet-chooser').open,false);
});
test('Creator cancel and choose-another fence a late Wallet response, with explicit retry after rejection',async()=>{
 const responseWait=deferred();let returns=0,attempts=0;
 const provider={request:()=>{attempts++;return attempts===1?responseWait.promise:Promise.reject(Object.assign(new Error('Rejected'),{code:4001}));}};
 const c=await app({discoverWalletProviders:async()=>({candidates:[{kind:'ynx-wallet',provider}]}),finishProductReturn:async()=>{returns++;return connected('late-owner');}});
 await turn();await c.click('product-signin');const pending=c.element('#product-wallet-choices').children[0].onclick();await turn();
 await c.run('product-wallet-back');assert.equal(c.element('#product-wallet-choices').hidden,false);
 responseWait.resolve({version:2,returnUrl:'late'});await pending;assert.equal(returns,0);assert.equal(c.readState().creatorAccount,null);
 await c.element('#product-wallet-choices').children[0].onclick();assert.match(c.element('#product-wallet-status').textContent,/rejected/);
 await c.run('product-wallet-back');assert.equal(c.element('#product-wallet-choices').children[0].disabled,false);
 await c.run('product-wallet-cancel');assert.equal(c.element('#product-wallet-chooser').open,false);
});

test('Switch Creator account finishes original revocation before offering a new approval',async()=>{
 let revokes=0,prepares=0;
 const c=await app({disconnectProductSession:async()=>{revokes++;return {status:'retry-required',revocationPending:true,message:'Retry sign out'};},prepareProductSignIn:async()=>{prepares++;return {url:'new'};}});
 await turn();c.renderProductState(connected('old-owner'));
 await c.click('product-signin');assert.equal(revokes,1);assert.equal(prepares,0);assert.equal(c.element('#product-wallet-chooser').open,false);assert.equal(c.element('#product-signin').disabled,true);assert.equal(c.readState().creatorAccount,null);
});

test('ordinary Cancel during Creator callback verification revokes the late stored grant before reconnect',async()=>{
 const completing=deferred(),entered=deferred();let stored=null,revokes=0;
 const c=await app({discoverWalletProviders:async()=>({candidates:[{kind:'ynx-wallet',provider:{request:async()=>({version:2,returnUrl:'fixture'})}}]}),finishProductReturn:async()=>{entered.resolve();await completing.promise;stored='late-owner';return connected(stored);},disconnectProductSession:async()=>{revokes++;await completing.promise;await turn();stored=null;return {status:'disconnected'};}});
 await turn();await c.click('product-signin');const selecting=c.element('#product-wallet-choices').children[0].onclick();await entered.promise;
 await c.run('product-wallet-cancel');await turn();assert.equal(revokes,1);assert.equal(c.element('#product-signin').disabled,true);assert.equal(c.readState().creatorAccount,null);
 completing.resolve();await selecting;assert.equal(stored,null);assert.equal(c.readState().creatorAccount,null);assert.equal(c.element('#product-signin').disabled,false);assert.equal(c.element('#product-wallet-chooser').open,false);
});

test('Creator Web Wallet opens from the user click and uses only the product V2 method',async()=>{
 const calls=[];const adapter={connect:()=>{calls.push('popup-open');return Promise.resolve([]);},request:async input=>{calls.push(input.method);return {version:2,returnUrl:'callback'};},suspend(){}};
 const c=await app({createHostedWalletAdapter:()=>adapter,prepareProductSignIn:async()=>{calls.push('prepare');return {url:'fixture'};},fetch:async()=>response(privateSnapshot('owned'))});await turn();await c.click('product-signin');const choosing=c.element('#product-wallet-choices').children[1].onclick();assert.deepEqual(calls,['popup-open']);await choosing;assert.deepEqual(calls,['popup-open','prepare','ynx_requestProductSessionV2']);assert.equal(c.readState().creatorAccount,'fixture-account');
});
test('Creator Mobile shows a QR and returns through product verification, not standard account discovery',async()=>{
 let requested=0,qr=0;class Pair{constructor(input){assert.equal(input.origin,'https://creator.ynxweb4.com');assert.deepEqual(input.methods,['ynx_requestProductSessionV2']);}async connect(input){input.onURI('wc:qa-fixture');return {request:async()=>{requested++;return {version:2,returnUrl:'callback'};}};}cancel(){}}
 const c=await app({WalletConnectDAppConnection:Pair,QRCode:{toCanvas:async()=>{qr++;}},fetch:async()=>response(privateSnapshot('owned'))});await turn();await c.click('product-signin');await c.element('#product-wallet-choices').children[2].onclick();assert.equal(qr,1);assert.equal(requested,1);assert.equal(c.readState().creatorAccount,'fixture-account');assert.equal(c.element('#product-pair-panel').hidden,true);
});

test('Creator native launch stays in its own step and blocks duplicate, cancelled and expired clicks',async()=>{
 let timer;const url='ynxwallet://product-session/v2?request=qa';const c=await app({setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},prepareProductSignIn:async()=>({url,expiresAt:new Date(Date.now()+60000).toISOString()})});await turn();
 await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();const link=c.element('#product-native-open');assert.equal(c.element('#product-wallet-chooser').open,true);assert.equal(c.element('#product-wallet-choices').hidden,true);assert.equal(link.href,url);
 const click=link.onclick;let prevented=0;click({preventDefault(){prevented++;}});assert.equal(prevented,0);click({preventDefault(){prevented++;}});assert.equal(prevented,1);await c.run('product-wallet-cancel');await turn();click({preventDefault(){prevented++;}});assert.equal(prevented,2);assert.equal(link.href,undefined);
 await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();timer();assert.equal(link.href,undefined);assert.match(c.element('#product-wallet-status').textContent,/expired/);await c.run('product-wallet-cancel');
});
test('Creator cancelled preparation never opens a late native request and preserves revoke failure',async()=>{
 const pending=deferred();let revoked=0;const c=await app({prepareProductSignIn:()=>pending.promise,disconnectProductSession:async()=>{revoked++;throw Error('offline');}});await turn();await c.click('product-signin');const prep=c.element('#product-wallet-choices').children.at(-1).onclick();await c.run('product-wallet-cancel');pending.resolve({url:'ynxwallet://product-session/v2?request=late',expiresAt:new Date(Date.now()+60000).toISOString()});await prep;
 assert.equal(revoked,1);assert.equal(c.element('#product-native-open').href,undefined);assert.equal(c.element('#product-signin').disabled,true);assert.match(c.element('#product-status').textContent,/pending|confirmed/i);
});
test('Creator unknown wallet errors show a next step without raw diagnostics',async()=>{
 let discoveries=0;const c=await app({discoverWalletProviders:async()=>{if(++discoveries===1)return {candidates:[]};throw Error('SECRET_INTERNAL_STAGE_99');}});await turn();await c.click('product-signin');assert.doesNotMatch(c.element('#product-wallet-status').textContent,/SECRET_INTERNAL_STAGE_99/);assert.match(c.element('#product-wallet-status').textContent,/try again/);
});

test('Creator native return restores the launched request then reads studio and closes without revoke',async()=>{
 let restores=0,revokes=0,reads=0;const c=await app({setTimeout:()=>1,clearTimeout(){},prepareProductSignIn:async()=>({url:'ynxwallet://authorize?request=qa',state:'intent-a',expiresAt:new Date(Date.now()+60000).toISOString()}),restoreNativeProductReturn:async state=>{assert.equal(state,'intent-a');restores++;return {status:'connected',session:{account:'owner-a',state:'intent-a'}};},disconnectProductSession:async()=>{revokes++;return {status:'disconnected'};},fetch:async()=>{reads++;return response(privateSnapshot('owner-a'));}});await turn();await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();await c.resumeNativeSignIn();assert.equal(restores,0);c.element('#product-native-open').onclick({preventDefault(){throw Error('valid click blocked');}});await c.resumeNativeSignIn();assert.equal(restores,1);assert.equal(c.readState().creatorAccount,'owner-a');assert.ok(reads>0);assert.equal(c.element('#product-wallet-chooser').open,false);assert.equal(c.element('#product-native-open').href,undefined);await c.run('product-wallet-cancel');await turn();assert.equal(revokes,0);
});
test('Creator cancelled native return and another signed request never reconnect the old chooser',async()=>{
 const returning=deferred();let revokes=0;const c=await app({setTimeout:()=>1,clearTimeout(){},prepareProductSignIn:async()=>({url:'ynxwallet://authorize?request=qa',state:'intent-a',expiresAt:new Date(Date.now()+60000).toISOString()}),restoreNativeProductReturn:()=>returning.promise,disconnectProductSession:async()=>{revokes++;return {status:'disconnected'};}});await turn();await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();c.element('#product-native-open').onclick({preventDefault(){}});const reading=c.resumeNativeSignIn();await c.run('product-wallet-cancel');returning.resolve({status:'connected',session:{account:'owner-a',state:'intent-a'}});await reading;await turn();assert.equal(c.readState().creatorAccount,null);assert.equal(revokes,1);
 const other=await app({setTimeout:()=>1,clearTimeout(){},prepareProductSignIn:async()=>({url:'ynxwallet://authorize?request=qa',state:'intent-a',expiresAt:new Date(Date.now()+60000).toISOString()}),restoreNativeProductReturn:async()=>({status:'connected',session:{account:'owner-b',state:'different'}})});await turn();await other.click('product-signin');await other.element('#product-wallet-choices').children.at(-1).onclick();other.element('#product-native-open').onclick({preventDefault(){}});await other.resumeNativeSignIn();assert.equal(other.readState().creatorAccount,null);assert.equal(other.element('#product-wallet-chooser').open,true);
});

test('Creator actual focus hook waits for backend verification and does not revive an expired request',async()=>{
 const handlers=new Map(),returning=deferred();let timer,reads=0;const c=await app({window:{location:{origin:'https://creator.ynxweb4.com'},addEventListener:(type,fn)=>handlers.set(type,fn)},setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},prepareProductSignIn:async()=>({url:'ynxwallet://authorize?request=qa',state:'intent-a',expiresAt:new Date(Date.now()+60000).toISOString()}),restoreNativeProductReturn:()=>{reads++;return returning.promise;}});await turn();await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();c.element('#product-native-open').onclick({preventDefault(){}});handlers.get('focus')();const reading=c.resumeNativeSignIn();assert.equal(reads,1);timer();returning.resolve({status:'connected',session:{account:'owner-a',state:'intent-a'}});await reading;assert.equal(c.readState().creatorAccount,null);assert.equal(c.element('#product-native-open').href,undefined);assert.match(c.element('#product-wallet-status').textContent,/expired/);
});

test('Creator focus before completed native callback remains waiting without network failure',async()=>{
 const c=await app({setTimeout:()=>1,clearTimeout(){},prepareProductSignIn:async()=>({url:'ynxwallet://authorize?request=qa',state:'intent-a',expiresAt:new Date(Date.now()+60000).toISOString()}),restoreNativeProductReturn:async()=>null});await turn();await c.click('product-signin');await c.element('#product-wallet-choices').children.at(-1).onclick();c.element('#product-native-open').onclick({preventDefault(){}});await c.resumeNativeSignIn();assert.match(c.element('#product-wallet-status').textContent,/not been confirmed yet/);assert.doesNotMatch(c.element('#product-wallet-status').textContent,/could not be checked/);assert.equal(c.element('#product-wallet-chooser').open,true);
});

test("reload restores authorized team channels through the real nested ChannelView and preserves drafts", async()=>{
 const paths=[];const controller=await app({fetch:async(url)=>{paths.push(String(url));return response(String(url).includes('/v1/channels/')?{channel:{ID:String(url).split('/').at(-1),Name:'Visible channel',Owner:'another-owner'}}:{team:[{channel_id:'chn_b',members:[{account:'member',role:'editor'}]},{channel_id:'chn_a'}]});}});
 controller.renderProductState(connected('member'));
 controller.element('#upload-form').elements.channel_id.value='unsaved-draft-id';
 controller.element('#channel-form').elements.name={value:'Unsaved new channel'};
 assert.equal(await controller.refresh(),true);
 assert.equal(controller.element('#channel-result').textContent,'Visible channel · chn_a');
 assert.equal(controller.element('#upload-form').elements.channel_id.value,'unsaved-draft-id');
 assert.equal(controller.element('#team-invite-form').elements.channel_id.value,'chn_a');
 assert.equal(controller.element('#channel-form').elements.name.value,'Unsaved new channel');
 const choice=controller.element('#channel-select');assert.equal(choice.children.length,2);choice.value='chn_b';await choice.onchange();
 assert.equal(controller.element('#channel-result').textContent,'Visible channel · chn_b');
 assert.equal(controller.element('#team-invite-form').elements.channel_id.value,'chn_b');
 assert.equal(paths.filter(p=>p.includes('/v1/channels/')).length,2);
});

test("empty team never invents a channel and invalidates an earlier channel read",async()=>{
 const late=deferred();let studios=0,channels=0;const controller=await app({fetch:async(url)=>String(url).includes('/v1/channels/')?(channels++,late.promise):response({team:++studios===1?[{channel_id:'chn_a'}]:[]})});
 controller.renderProductState(connected('owner-a'));const first=controller.refresh();await turn();assert.equal(channels,1);
 assert.equal(await controller.refresh(),true);late.resolve(response({channel:{ID:'chn_a',Name:'Old channel'}}));assert.equal(await first,false);
 assert.equal(controller.element('#channel-result').textContent,'No channel loaded.');assert.equal(controller.element('#channel-select').hidden,true);
});

test("late channel metadata after account switch cannot refill the old account",async()=>{
 const late=deferred();const controller=await app({fetch:async(url)=>String(url).includes('/v1/channels/')?late.promise:response({team:[{channel_id:'chn_a'}]})});
 controller.renderProductState(connected('owner-a'));const first=controller.refresh();await turn();await controller.click('product-disconnect');controller.renderProductState(connected('owner-b'));
 late.resolve(response({channel:{ID:'chn_a',Name:'Old owner channel'}}));assert.equal(await first,false);
 assert.equal(controller.element('#channel-result').textContent,'No channel loaded.');assert.equal(controller.element('#upload-form').elements.channel_id.value,'');
});

test("wrong channel identity and rejected channel reads fail closed",async()=>{
 for(const result of [response({channel:{ID:'chn_other',Name:'Wrong'}}),response({error:'Channel access denied'},403)]){
  const controller=await app({fetch:async(url)=>String(url).includes('/v1/channels/')?result:response({team:[{channel_id:'chn_a'}]})});controller.renderProductState(connected('owner-a'));
  assert.equal(await controller.refresh(),false);assert.equal(controller.element('#channel-result').textContent,'No channel loaded.');assert.equal(controller.element('#upload-form').elements.channel_id.value,'');
 }
});
test('shipped Creator controller sends exactly its signed multipart bytes with original boundary',async()=>{let signed,received;const controller=await app({productAuthorization:async(path,method,body)=>{signed={path,method,body};return {'X-YNX-Product-Session-Action-Proof-V2':'fresh-action'}},fetch:async(url,options)=>{received=options;return response({id:'original'})}});controller.renderProductState(connected('owner-a'));const form=new FormData();form.set('media',new Blob(['original']),'owned.mp4');form.set('title','原作品');await controller.api('/v1/uploads',{method:'POST',body:form,headers:{'Content-Type':'incorrect','Authorization':'old'}});assert.equal(received.body,signed.body);assert.equal(signed.method,'POST');assert.equal(signed.path,'/v1/uploads');assert.equal(received.headers.authorization,undefined);assert.equal(received.headers['X-YNX-Product-Session-Action-Proof-V2'],'fresh-action');const parsed=await new Request('https://creator.ynxweb4.com/',{method:'POST',headers:received.headers,body:received.body}).formData();assert.equal(parsed.get('title'),'原作品');assert.equal(await parsed.get('media').text(),'original')});
