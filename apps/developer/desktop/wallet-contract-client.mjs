import {createHash, randomUUID} from 'node:crypto';
import {openContractReferenceJournal} from './wallet-contract-reference-journal.mjs';

const methods = new Set(['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']);
const bindingKeys = ['owner','workspaceOwner','account','generation','identityReference','localProjectId','workspace','launch','sessionId'];
const failure = (code, cause) => Object.assign(Error('The original project Wallet request cannot be continued.'), {code, ...(cause === undefined ? {} : {cause})});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Backend-only consumer. The production caller supplies the SDK's fixed
// developer factory, never a renderer-selected origin, module or RPC transport.
// This constructor does not initialize Relay, restore a session or send a request.
export async function openProjectContractClient({context, admittedProject, createConnection, now = Date.now}) {
  if (!context?.profile || !context.id || !context.workspace || typeof admittedProject?.assertCurrent !== 'function' || typeof createConnection !== 'function') throw failure('IDE_CONTRACT_NOT_SUPPLIED');
  let closed = false, busy = false, captured, deadline, journal, provider;
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
  const connection = createConnection();
  if (typeof connection?.beginContractRequest !== 'function' || typeof connection.connect !== 'function' || typeof connection.cancel !== 'function') throw failure('IDE_CONTRACT_NOT_SUPPLIED');
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
  async function execute(referenceId, input) {
    const account = await walletAccount();
    const request = structuredClone(input);
    if (!request || Object.keys(request).sort().join() !== 'method,params' || !methods.has(request.method) || !Array.isArray(request.params) || request.params.length !== 1 || request.params[0]?.version !== 1 || request.params[0]?.account !== account) throw failure('IDE_CONTRACT_REQUEST_INVALID');
    if (await journal.read(referenceId)) throw failure('IDE_CONTRACT_REFERENCE_EXISTS');
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
      if (!row.originalRequestKeyHash || row.state !== 'saved') throw failure('IDE_CONTRACT_REFERENCE_NOT_DURABLE');
      return Object.freeze({reference:await journal.read(referenceId), result:outcome.value});
    } catch (error) {
      await queue;
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
      provider = await connection.connect({restore:false, onURI:uri => { if (!closed) options.onURI?.(uri); }});
      await walletAccount();
      return Object.freeze({connected:true, chainId:'eip155:6423'});
    }); },
    request({referenceId = randomUUID(), input}) { return exclusive(() => execute(referenceId, input)); },
    read(referenceId) { return exclusive(() => journal.read(referenceId)); },
    query(referenceId, {refresh = false} = {}) { return exclusive(async () => {
      const original = await journal.read(referenceId);
      if (!original?.originalRequestKeyHash || typeof refresh !== 'boolean') throw failure('IDE_CONTRACT_QUERY_UNAVAILABLE');
      const account = await walletAccount();
      if (original.account !== account) throw failure('IDE_CONTRACT_WALLET_CHANGED');
      return execute(randomUUID(), {method:'ynx_getPQContractOriginal',params:[{version:1,account,originalRequestKeyHash:original.originalRequestKeyHash,refresh}]});
    }); },
    async close() { closed = true; provider = undefined; await connection.cancel(); },
    cleanupSnapshot() { return connection.cleanupSnapshot(); },
  });
}
