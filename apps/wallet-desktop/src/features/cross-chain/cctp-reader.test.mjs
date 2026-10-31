import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface, zeroPadValue} from 'ethers';
import {EVMAdapter} from '../../multichain-evm.mjs';
import {CctpReader} from './cctp-reader.mjs';
import {ROUTE, encodeBurn, encodeMint} from './cctp-wire.mjs';

const hash = value => '0x' + value.repeat(32), hex = value => '0x' + BigInt(value).toString(16);
const account = '0x' + '11'.repeat(20), recipient = '0x' + '22'.repeat(20);
const sourceHash = hash('31'), targetHash = hash('32'), sourceBlock = hash('41'), targetBlock = hash('42');
const sourceNetwork = {chainId: '0xaa36a7', genesis: hash('a1'), rpcUrl: 'https://source.example'};
const destinationNetwork = {chainId: '0x14a34', genesis: hash('a2'), rpcUrl: 'https://target.example'};
const intent = {account, recipient, sourceNetwork, destinationNetwork, amountUnits: '1000000', maxFeeUnits: '500'};
const proof = '0x' + 'aa'.repeat(65), assignedNonce = hash('91');
const tokenABI = new Interface(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function decimals() view returns(uint8)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const messengerABI = new Interface(['event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)']);
const transmitterABI = new Interface(['function usedNonces(bytes32) view returns(uint256)', 'event MessageSent(bytes message)', 'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)']);
function message({source = false, fee = 100, expiry = 0, nonce = assignedNonce} = {}) {
  const uint = (number, bytes) => BigInt(number).toString(16).padStart(bytes * 2, '0');
  const addr = address => zeroPadValue(address, 32).slice(2).toLowerCase();
  return '0x' + uint(1, 4) + uint(0, 4) + uint(6, 4) + (source ? hash('00') : nonce).slice(2) +
    addr(ROUTE.source.tokenMessenger) + addr(ROUTE.destination.tokenMessenger) + addr(account) + uint(2000, 4) + uint(source ? 0 : 2000, 4) +
    uint(1, 4) + addr(ROUTE.source.usdc) + addr(recipient) + uint(intent.amountUnits, 32) + addr(account) + uint(intent.maxFeeUnits, 32) + uint(source ? 0 : fee, 32) + uint(source ? 0 : expiry, 32);
}
function fixture(options = {}) {
  const raw = message(options.message), emitted = message({source: true});
  const calls = [], requests = [];
  const makeReceipt = (isSource, data) => ({transactionHash: isSource ? sourceHash : targetHash, blockHash: isSource ? sourceBlock : targetBlock,
    blockNumber: '0x64', transactionIndex: '0x0', from: account, to: isSource ? ROUTE.source.tokenMessenger : ROUTE.destination.messageTransmitter,
    status: '0x1', logs: [], data});
  const sourceReceipt = makeReceipt(true, encodeBurn(intent)), targetReceipt = makeReceipt(false, encodeMint({message: raw, attestation: proof}));
  const event = (receipt, address, abi, name, args) => ({address, ...abi.encodeEventLog(abi.getEvent(name), args), transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex, logIndex: hex(receipt.logs.length), removed: false});
  sourceReceipt.logs.push(event(sourceReceipt, ROUTE.source.tokenMessenger, messengerABI, 'DepositForBurn', [ROUTE.source.usdc, intent.amountUnits, account, zeroPadValue(recipient, 32), 6, zeroPadValue(ROUTE.destination.tokenMessenger, 32), zeroPadValue(account, 32), intent.maxFeeUnits, 2000, '0x']));
  sourceReceipt.logs.push(event(sourceReceipt, ROUTE.source.messageTransmitter, transmitterABI, 'MessageSent', [emitted]));
  targetReceipt.logs.push(event(targetReceipt, ROUTE.destination.messageTransmitter, transmitterABI, 'MessageReceived', [account, 0, assignedNonce, zeroPadValue(ROUTE.source.tokenMessenger, 32), 2000, '0x' + raw.slice(2 + 148 * 2)]));
  targetReceipt.logs.push(event(targetReceipt, ROUTE.destination.usdc, tokenABI, 'Transfer', ['0x' + '00'.repeat(20), recipient, 1000000 - (options.message?.fee ?? 100)]));
  const tx = (receipt, network) => ({hash: receipt.transactionHash, from: account, to: receipt.to, input: receipt.data, value: '0x0', chainId: network.chainId,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, transactionIndex: receipt.transactionIndex});
  const sourceTx = tx(sourceReceipt, sourceNetwork), targetTx = tx(targetReceipt, destinationNetwork);
  const state = {sourceReceipt, targetReceipt, sourceTx, targetTx, feeTable: [{finalityThreshold: 1000, minimumFee: 1}, {finalityThreshold: 2000, minimumFee: 0}],
    iris: {sourceTxHash: sourceHash, messages: [{message: raw, attestation: proof, eventNonce: assignedNonce, status: 'complete', cctpVersion: 2}]},
    finality: {hash: hash('51'), number: '0x65'}, balance: '9000000', allowance: '0', decimals: '6', used: '1', latest: '0x66', ...options.state};
  const evm = new EVMAdapter({rpc: async (url, method, params = []) => {
    const source = url === sourceNetwork.rpcUrl, network = source ? sourceNetwork : destinationNetwork;
    calls.push({source, method, params});
    if (options.rpc) { const result = options.rpc({source, method, params, state}); if (result !== undefined) return result; }
    if (method === 'eth_chainId') return network.chainId;
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === '0x0') return {hash: network.genesis, number: '0x0'};
      if (params[0] === 'finalized') return state.finality;
      return {hash: source ? sourceBlock : targetBlock, number: '0x64', transactions: [source ? sourceHash : targetHash]};
    }
    if (method === 'eth_blockNumber') return state.latest;
    if (method === 'eth_getCode') return '0x1234';
    if (method === 'eth_getTransactionReceipt') return source ? state.sourceReceipt : state.targetReceipt;
    if (method === 'eth_getTransactionByHash') return source ? state.sourceTx : state.targetTx;
    if (method === 'eth_call') {
      if (params[0].to.toLowerCase() === ROUTE.destination.messageTransmitter.toLowerCase()) return transmitterABI.encodeFunctionResult('usedNonces', [state.used]);
      const parsed = tokenABI.parseTransaction({data: params[0].data});
      return tokenABI.encodeFunctionResult(parsed.name, [parsed.name === 'decimals' ? state.decimals : parsed.name === 'allowance' ? state.allowance : state.balance]);
    }
    throw new Error('Unexpected RPC (no signing or send allowed): ' + method);
  }});
  const fetchImpl = async (url, init) => { requests.push({url, init});
    if (options.fetchImpl) return options.fetchImpl(url, init);
    return new Response(JSON.stringify(url.includes('/fees/') ? state.feeTable : state.iris), {status: 200, headers: {'content-type': 'application/json'}});
  };
  return {reader: new CctpReader({evm, fetchImpl}), state, calls, requests, raw, event};
}
const sourceInput = {...intent, sourceTxHash: sourceHash};
const targetInput = raw => ({...intent, transactionHash: targetHash, message: raw, attestation: proof});

test('quote reads pinned network/contracts, live standard fees and exact source/target units', async () => {
  const f = fixture();
  assert.deepEqual(await f.reader.quote(intent), {feeBps: '0', requiredFeeUnits: '0', allowanceUnits: '0', sourceBalanceUnits: '9000000', destinationBalanceUnits: '9000000'});
  assert.equal(f.calls.filter(call => call.method === 'eth_getCode').length, 6);
  assert.equal(f.requests[0].url, 'https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6');
  assert.equal(f.requests[0].init.redirect, 'error'); assert.equal(f.requests[0].init.method, 'GET');
});

test('fee uses exact ceiling, never a fallback or duplicated threshold', async () => {
  const f = fixture({state: {feeTable: [{finalityThreshold: 2000, minimumFee: 0.01}]}});
  assert.equal((await f.reader.quote({...intent, amountUnits: '1000001'})).requiredFeeUnits, '2');
  await assert.rejects(f.reader.quote({...intent, amountUnits: '1000001', maxFeeUnits: '1'}), {code: 'CCTP_FEE_EXCEEDS_CAP'});
  f.state.feeTable = [{finalityThreshold: 1000, minimumFee: 0}];
  await assert.rejects(f.reader.quote(intent), {code: 'CCTP_FEE_INVALID'});
  f.state.feeTable = [{finalityThreshold: 2000, minimumFee: 0}, {finalityThreshold: 2000, minimumFee: 0}];
  await assert.rejects(f.reader.quote(intent), {code: 'CCTP_FEE_INVALID'});
});

test('wrong network, replaced genesis, missing code, altered decimals and insufficient asset fail closed', async () => {
  await assert.rejects(fixture().reader.quote({...intent, sourceNetwork: {...sourceNetwork, chainId: '0x1'}}), {code: 'CCTP_NETWORK_MISMATCH'});
  await assert.rejects(fixture({rpc: ({method, params}) => method === 'eth_getBlockByNumber' && params[0] === '0x0' ? {hash: hash('ff')} : undefined}).reader.quote(intent), {code: 'MULTICHAIN_NETWORK_MISMATCH'});
  await assert.rejects(fixture({rpc: ({method}) => method === 'eth_getCode' ? '0x' : undefined}).reader.quote(intent), {code: 'CCTP_CONTRACT_MISSING'});
  await assert.rejects(fixture({state: {decimals: '18'}}).reader.quote(intent), {code: 'CCTP_ASSET_MISMATCH'});
  await assert.rejects(fixture({state: {balance: '999999'}}).reader.quote(intent), {code: 'CCTP_INSUFFICIENT_USDC'});
});

test('HTTP failures, redirects and unbounded bodies cannot imply free fees', async () => {
  for (const response of [new Response('{}', {status: 500}), new Response('{}', {status: 302}), new Response('{}', {headers: {'content-type': 'application/json', 'content-length': '1000001'}}), new Response('{}', {headers: {'content-type': 'text/html'}})]) {
    const f = fixture({fetchImpl: () => response}); await assert.rejects(f.reader.quote(intent)); assert.equal(f.requests.length, 1);
  }
  const f = fixture({fetchImpl: () => new Response(' '.repeat(1000001), {headers: {'content-type': 'application/json'}})});
  await assert.rejects(f.reader.quote(intent), {code: 'CCTP_HTTP_INVALID'});
});

test('a stalled Circle response times out once without retry', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture({fetchImpl: () => new Promise(() => {})});
  const pending = f.reader.quote(intent), rejection = assert.rejects(pending, {code: 'CCTP_HTTP_TIMEOUT'});
  for (let count = 0; count < 100 && f.requests.length === 0; count++) await Promise.resolve();
  assert.equal(f.requests.length, 1); t.mock.timers.tick(12_000); await rejection;
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.signal.aborted, true);
});

test('source attestation binds receipt, unique burn/message, original hash and V2 nonce', async () => {
  const f = fixture(), result = await f.reader.attestation(sourceInput);
  assert.deepEqual(result, {message: f.raw, attestation: proof, nonce: assignedNonce, sourceTxHash: sourceHash, feeExecuted: '100', amountReceived: '999900'});
  assert.equal(f.requests[0].url, 'https://iris-api-sandbox.circle.com/v2/messages/0?transactionHash=' + sourceHash);
  f.state.iris.sourceTxHash = hash('fe'); await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_ATTESTATION_MISMATCH'});
  f.state.iris.sourceTxHash = sourceHash; f.state.iris.messages[0].eventNonce = hash('fe');
  await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_ATTESTATION_MISMATCH'});
});

test('source receipt mismatch, removed message, duplicate deposit or wrong source calldata is rejected', async () => {
  const f = fixture();
  f.state.sourceReceipt.blockHash = hash('fe'); await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_RECEIPT_MISMATCH'});
  f.state.sourceReceipt.blockHash = sourceBlock; f.state.sourceReceipt.logs[1].removed = true;
  await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_EVENT_MISMATCH'});
  f.state.sourceReceipt.logs[1].removed = false; f.state.sourceReceipt.logs.push({...f.state.sourceReceipt.logs[0], logIndex: '0x2'});
  await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_SOURCE_EVENT_MISMATCH'});
  f.state.sourceReceipt.logs.pop(); f.state.sourceTx.input = encodeBurn({...intent, recipient: account});
  await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_TRANSACTION_MISMATCH'});
});

test('not-yet-observed source/attestation only returns waiting, never retries or sends', async () => {
  const f = fixture({state: {sourceReceipt: null, sourceTx: null}});
  assert.equal(await f.reader.attestation(sourceInput), null); assert.equal(f.requests.length, 0);
  const pending = fixture({fetchImpl: () => new Response('', {status: 404})});
  assert.equal(await pending.reader.attestation(sourceInput), null); assert.equal(pending.requests.length, 1);
  const incomplete = fixture(); incomplete.state.iris.messages[0].status = 'pending_confirmations';
  assert.equal(await incomplete.reader.attestation(sourceInput), null);
});

test('target requires exact nonce event + mint Transfer and reports finalized separately from included', async () => {
  const f = fixture(), result = await f.reader.destination(targetInput(f.raw));
  assert.equal(result.state, 'finalized'); assert.equal(result.receipt.confirmationScope, 'rpc-finalized-block');
  assert.equal(result.balanceUnits, '9000000');
  f.state.finality.number = '0x63'; assert.equal((await f.reader.destination(targetInput(f.raw))).state, 'included');
  f.state.targetReceipt.logs[0].topics[2] = hash('ff');
  await assert.rejects(f.reader.destination(targetInput(f.raw)), {code: 'CCTP_DESTINATION_EVENT_MISMATCH'});
});

test('high target balance does not hide missing mint, wrong mint amount, removed logs or unused nonce', async () => {
  const f = fixture(); f.state.targetReceipt.logs.pop();
  await assert.rejects(f.reader.destination(targetInput(f.raw)), {code: 'CCTP_MINT_MISMATCH'});
  f.state.targetReceipt.logs.push(f.event(f.state.targetReceipt, ROUTE.destination.usdc, tokenABI, 'Transfer', ['0x' + '00'.repeat(20), recipient, 1000000]));
  await assert.rejects(f.reader.destination(targetInput(f.raw)), {code: 'CCTP_MINT_MISMATCH'});
  const removed = fixture(); removed.state.targetReceipt.logs[1].removed = true;
  await assert.rejects(removed.reader.destination(targetInput(removed.raw)), {code: 'CCTP_EVENT_MISMATCH'});
  const unused = fixture({state: {used: '0'}}); await assert.rejects(unused.reader.destination(targetInput(unused.raw)), {code: 'CCTP_NONCE_MISMATCH'});
});

test('destination pending/reverted/reorg are not mistaken for final settlement', async () => {
  const pending = fixture({state: {targetReceipt: null, targetTx: null}});
  assert.deepEqual(await pending.reader.destination(targetInput(pending.raw)), {state: 'pending', receipt: null});
  const reverted = fixture(); reverted.state.targetReceipt.status = '0x0'; reverted.state.targetReceipt.logs = [];
  assert.equal((await reverted.reader.destination(targetInput(reverted.raw))).state, 'reverted');
  const reorg = fixture({state: {finality: {hash: hash('ff'), number: '0x64'}}});
  await assert.rejects(reorg.reader.destination(targetInput(reorg.raw)), {code: 'CCTP_RECEIPT_MISMATCH'});
  const modified = fixture(); modified.state.targetTx.input = '0x';
  await assert.rejects(modified.reader.destination(targetInput(modified.raw)), {code: 'CCTP_TRANSACTION_MISMATCH'});
});

test('recovery accepts a message minted before its expiry even after latest height passed expiry', async () => {
  const f = fixture({message: {expiry: 101}, state: {latest: '0x1000'}});
  assert.equal((await f.reader.destination(targetInput(f.raw))).state, 'finalized');
  await assert.rejects(f.reader.attestation(sourceInput), {code: 'CCTP_INVALID_EXPIRY'});
});

test('expired original mint remains queryable while pending or after an onchain revert', async () => {
  const pending = fixture({message: {expiry: 99}, state: {targetReceipt: null, targetTx: null, latest: '0x1000'}});
  assert.deepEqual(await pending.reader.destination(targetInput(pending.raw)), {state: 'pending', receipt: null});
  const reverted = fixture({message: {expiry: 99}}); reverted.state.targetReceipt.status = '0x0'; reverted.state.targetReceipt.logs = [];
  assert.equal((await reverted.reader.destination(targetInput(reverted.raw))).state, 'reverted');
});
