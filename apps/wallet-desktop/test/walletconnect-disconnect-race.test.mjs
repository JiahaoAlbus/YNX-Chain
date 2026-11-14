import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('disconnect retires the topic and all reviews before awaiting a stalled cleanup', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('handleWalletIPC("wallet:walletconnect-disconnect"');
  const end = source.indexOf('handleWalletIPC("wallet:walletconnect-proposal-action"', begin);
  assert(begin >= 0 && end > begin);
  let handler, release;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [{key:'first',event:{topic:'chosen'}},{key:'second',event:{topic:'chosen'}}];
  const retired = [], order = [];
  const transport = {
    sessionOrigin: () => 'origin',
    disconnectSession: async () => { order.push('topic'); await gate; return {disconnected:true}; },
  };
  const inbox = {pending:() => events, finish:key => retired.push(key)};
  const execute = new Function('handleWalletIPC','safeIPC','originalPayContextBridge','walletConnect',
    'walletConnectInbox','terminateWalletConnectReview','walletAuthority','mainWindow',
    source.slice(begin, end));
  execute((_name, fn) => { handler = fn; }, fn => fn(), {invalidateAll(){}},
    transport, inbox, async entry => { order.push(entry.key); await gate; },
    {revokeOrigin:async()=>{}}, null);
  const pending = handler(null, 'chosen');
  assert.deepEqual(order, ['topic','first']);
  assert.deepEqual(retired, ['first','second']);
  release();
  assert.equal((await pending).localPermissionRevoked, true);
});
