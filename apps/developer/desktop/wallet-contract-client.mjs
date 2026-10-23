import {createHash, randomUUID} from 'node:crypto';
import {openContractReferenceJournal} from './wallet-contract-reference-journal.mjs';

const methods = new Set(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
const bindingKeys = ['owner','workspaceOwner','account','generation','identityReference','localProjectId','workspace','launch','sessionId'];
const failure = (code, cause) => Object.assign(Error('The original project Wallet request cannot be continued.'), {code, ...(cause === undefined ? {} : {cause})});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function signedReference(value,account){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join()!=='account,confirmed,hash,memberHash,operationId,savedLocally,submitted,transportHash,version'||value.version!==1||value.account!==account||value.hash!==value.transportHash||!/^0x[a-f0-9]{64}$/.test(value.transportHash)||!/^0x[a-f0-9]{64}$/.test(value.memberHash)||!/^[A-Za-z0-9:_-]{1,160}$/.test(value.operationId||'')||value.savedLocally!==true||value.submitted!==false||value.confirmed!==false)throw failure('IDE_CONTRACT_SIGNED_REFERENCE_INVALID');
  return{operationId:value.operationId,transportHash:value.transportHash,memberHash:value.memberHash};
}
export function contractBroadcastReferenceId(referenceId){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(referenceId||''))throw failure('IDE_CONTRACT_REQUEST_INVALID');
  // Stable LOCAL journal intent, never a Wallet JSON-RPC ID or a signature.
  // Reopening an UNKNOWN broadcast cannot create a second submit intent.
  const hex=createHash('sha256').update('ynx-ide-local-broadcast-reference-v1\0'+referenceId).digest('hex').slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Backend-only consumer. The production caller supplies the SDK's fixed
// developer factory, never a renderer-selected origin, module or RPC transport.
// This constructor does not initialize Relay, restore a session or send a request.
export async function openProjectContractClient({context, admittedProject, createConnection, now = Date.now}) {
  if (!context?.profile || !context.id || !context.workspace || typeof admittedProject?.assertCurrent !== 'function' || typeof createConnection !== 'function') throw failure('IDE_CONTRACT_NOT_SUPPLIED');
  let closed = false, busy = false, captured, deadline, journal, provider, connection;
  const retained = new Set();
  async function current() {
    if (closed) throw failure('IDE_CONTRACT_RETIRED');
    const state = await admittedProject.assertCurrent();
    if (closed || !state || bindingKeys.some(key => state[key] === undefined) || state.workspace !== context.workspace || !Number.isSafeInteger(state.generation) || state.generation < 0 || !Number.isFinite(state.expiresAt) || state.expiresAt <= now()) throw failure('IDE_CONTRACT_RETIRED');
    if (captured && (bindingKeys.some(key => captured[key] !== state[key]) || state.expiresAt < deadline || now() >= deadline)) throw failure('IDE_CONTRACT_RETIRED');
    if (!captured) { captured = Object.freeze({...state}); deadline = state.expiresAt; }
    return state;
  }
  await current();
  journal = await openContractReferenceJournal({profile:context.profile, projectId:context.id, owner:captured.owner, account:captured.account});
  await current();
  const connectOwner=()=>{if(!connection){connection=createConnection();if(typeof connection?.beginContractRequest!=='function'||typeof connection.connect!=='function'||typeof connection.cancel!=='function')throw failure('IDE_CONTRACT_NOT_SUPPLIED');}return connection;};
  async function exclusive(work) {
    if (busy) throw failure('IDE_CONTRACT_BUSY');
    busy = true;
    try { await current(); return await work(); } finally { busy = false; }
  }
  async function walletAccount() {
    await current();
    if (!provider) throw failure('IDE_CONTRACT_NOT_CONNECTED');
    const accounts = await provider.request({method:'eth_accounts'});
    const chain = await provider.request({method:'eth_chainId'});
    await current();
    if (!Array.isArray(accounts) || accounts.length !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0]) || chain !== '0x1917') throw failure('IDE_CONTRACT_WALLET_CHANGED');
    return accounts[0].toLowerCase();
  }
  async function execute(referenceId, input, acceptResult) {
    const account = await walletAccount();
    const request = structuredClone(input);
    if (!request || Object.keys(request).sort().join() !== 'method,params' || !methods.has(request.method) || !Array.isArray(request.params) || request.params.length !== 1 || request.params[0]?.version !== 1 || request.params[0]?.account !== account) throw failure('IDE_CONTRACT_REQUEST_INVALID');
    if (await journal.read(referenceId)) throw failure('IDE_CONTRACT_REFERENCE_EXISTS');
    if(request.method==='ynx_preparePQContractAction'){
      const rows=await journal.list(true),digest=hash(request);
      for(const original of rows.filter(row=>row.method===request.method&&row.requestPayloadSHA256===digest)){
        const broadcast=rows.find(row=>row.referenceId===contractBroadcastReferenceId(original.referenceId));
        const unresolved=original.state!=='saved'?original:broadcast&&broadcast.state!=='saved'?broadcast:null;
        if(unresolved)throw Object.assign(failure('IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'),{referenceId:unresolved.referenceId});
      }
    }
    let row = {account, method:request.method, requestPayloadSHA256:hash(request), originalRequestKeyHash:null, operationId:null, transportHash:null, memberHash:null, state:'pending'};
    // An original pending record is durable before the one and only send. An
    // interrupted process never turns this record into permission to resend.
    await journal.append(referenceId, row);
    await current();
    let handle, queue = Promise.resolve(), persistenceError;
    const enqueue = snapshot => {
      queue = queue.then(async () => {
        if (persistenceError) return;
        try {
          if (snapshot.scope !== 'local-only' || snapshot.origin !== 'https://developer.ynxweb4.com' || snapshot.chainId !== 'eip155:6423' || snapshot.replayAllowed !== false || snapshot.remoteOutcome !== 'not-proven' || snapshot.method !== row.method || snapshot.account.toLowerCase() !== account || snapshot.requestPayloadSHA256 !== row.requestPayloadSHA256 || snapshot.correlation === 'conflict') throw failure('IDE_CONTRACT_CORRELATION_CONFLICT');
          const next = {...row, originalRequestKeyHash:snapshot.originalRequestKeyHash, state:closed || row.state === 'unknown' || snapshot.state === 'unknown' ? 'unknown' : row.state === 'saved' || snapshot.state === 'fulfilled' ? 'saved' : 'pending'};
          await journal.append(referenceId, next);
          row = next;
        } catch (error) {
          // A conflicting callback cannot erase the first observed hash. Mark
          // the original reference unknown if that append is still possible.
          try { await journal.append(referenceId, {...row, state:'unknown'}); row = {...row, state:'unknown'}; } catch { /* retain original bytes and writer lock */ }
          persistenceError = error;
        }
      });
      return queue;
    };
    try {
      handle = connection.beginContractRequest(request);
      // Keep the original handle for a late original sent event after timeout.
      // The listener only appends query coordinates; it never starts an action.
      const retainedRequest = {handle}; retained.add(retainedRequest);
      retainedRequest.unsubscribe = handle.onCorrelation(enqueue);
      const observed = handle.outcome.then(value => ({value}), error => ({error, failed:true}));
      await enqueue(handle.snapshot());
      const outcome = await observed;
      await enqueue(handle.snapshot());
      if (outcome.failed) throw outcome.error;
      if (persistenceError) throw failure('IDE_CONTRACT_REFERENCE_NOT_DURABLE', persistenceError);
      await current();
      if(acceptResult){
        queue=queue.then(async()=>{const accepted=acceptResult(outcome.value,account);const next={...row,...accepted};await journal.append(referenceId,next);row=next;});
        await queue;await current();
      }
      if (!row.originalRequestKeyHash || row.state !== 'saved') throw failure('IDE_CONTRACT_REFERENCE_NOT_DURABLE');
      return Object.freeze({reference:await journal.read(referenceId), result:outcome.value});
    } catch (error) {
      await queue.catch(()=>{});
      // Preserve the original RPC cause and bytes if the durable append itself
      // failed. Never retry a partially written record or the remote request.
      if (!persistenceError) {
        row = {...row, state:'unknown'};
        try { await journal.append(referenceId, row); } catch (journalError) { persistenceError = journalError; }
      }
      throw error;
    }
  }
  return Object.freeze({
    connect(options = {}) { return exclusive(async () => {
      if (Object.keys(options).some(key => key !== 'onURI') || options.onURI !== undefined && typeof options.onURI !== 'function') throw failure('IDE_CONTRACT_REQUEST_INVALID');
      provider = await connectOwner().connect({restore:false, onURI:uri => { if (!closed) options.onURI?.(uri); }});
      await walletAccount();
      return Object.freeze({connected:true, chainId:'eip155:6423'});
    }); },
    request({referenceId = randomUUID(), input}) { return exclusive(() => execute(referenceId, input)); },
    prepareDeployment({referenceId,action,deployment}){return exclusive(async()=>{
      const account=await walletAccount();
      return execute(referenceId,{method:'ynx_preparePQContractAction',params:[{version:1,account,action:{...action,deployment}}]},signedReference);
    });},
    broadcastDeployment(referenceId){return exclusive(async()=>{
      const original=await journal.read(referenceId),account=await walletAccount();
      if(!original||original.method!=='ynx_preparePQContractAction'||original.state!=='saved'||!original.operationId||!original.transportHash||!original.memberHash||original.account!==account)throw failure('IDE_CONTRACT_BROADCAST_NOT_PREPARED');
      return execute(contractBroadcastReferenceId(referenceId),{method:'ynx_preparePQContractBroadcast',params:[{version:1,account,operationId:original.operationId}]});
    });},
    read(referenceId) { return exclusive(() => journal.read(referenceId)); },
    listReferences(){return exclusive(()=>journal.list());},
    query(referenceId, {refresh = false} = {}) { return exclusive(async () => {
      const original = await journal.read(referenceId);
      if (!original?.originalRequestKeyHash || typeof refresh !== 'boolean') throw failure('IDE_CONTRACT_QUERY_UNAVAILABLE');
      const account = await walletAccount();
      if (original.account !== account) throw failure('IDE_CONTRACT_WALLET_CHANGED');
      return execute(randomUUID(), {method:'ynx_getPQContractOriginal',params:[{version:1,account,originalRequestKeyHash:original.originalRequestKeyHash,refresh}]});
    }); },
    async close() { closed = true; provider = undefined; await connection?.cancel?.(); },
    cleanupSnapshot() { return connection?.cleanupSnapshot?.()||Object.freeze({scope:'local-only',connection:'not-started',remoteCleanup:'not-proven'}); },
  });
}
