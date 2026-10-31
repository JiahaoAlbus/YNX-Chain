import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface, zeroPadValue} from 'ethers';
import {EVMAdapter} from '../../multichain-evm.mjs';
import {CctpReader} from './cctp-reader.mjs';
import {ROUTE, encodeMint} from './cctp-wire.mjs';

// Controlled RPC/ABI fixtures only. No network, real attestation, signer or send.
const hash = byte => '0x' + byte.repeat(32), account = '0x' + '11'.repeat(20), recipient = '0x' + '22'.repeat(20);
const txHash = hash('32'), oldBlock = hash('42'), newBlock = hash('43'), nonce = hash('91');
const network = {chainId: '0x14a34', genesis: hash('a2'), rpcUrl: 'https://controlled-target.example'};
const intent = {account, recipient, destinationNetwork: network, amountUnits: '1000000', maxFeeUnits: '500'};
const attestation = '0x' + 'aa'.repeat(65);
const token = new Interface(['function balanceOf(address) view returns(uint256)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const transmitter = new Interface(['function usedNonces(bytes32) view returns(uint256)', 'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)']);
function message() {
  const uint = (value, bytes) => BigInt(value).toString(16).padStart(bytes * 2, '0'), address = value => zeroPadValue(value, 32).slice(2).toLowerCase();
  return '0x' + uint(1, 4) + uint(0, 4) + uint(6, 4) + nonce.slice(2) + address(ROUTE.source.tokenMessenger) + address(ROUTE.destination.tokenMessenger) +
    address(account) + uint(2000, 4) + uint(2000, 4) + uint(1, 4) + address(ROUTE.source.usdc) + address(recipient) + uint(intent.amountUnits, 32) +
    address(account) + uint(intent.maxFeeUnits, 32) + uint(100, 32) + uint(0, 32);
}
function fixture(mode = 'stable') {
  const raw = message(), data = encodeMint({message: raw, attestation}), calls = [];
  const original = {transactionHash: txHash, blockHash: oldBlock, blockNumber: '0x64', transactionIndex: '0x0', from: account,
    to: ROUTE.destination.messageTransmitter, status: '0x1', logs: []};
  const event = (contract, abi, name, args) => ({address: contract, ...abi.encodeEventLog(abi.getEvent(name), args), transactionHash: txHash,
    blockHash: oldBlock, blockNumber: '0x64', transactionIndex: '0x0', logIndex: '0x' + original.logs.length.toString(16), removed: false});
  original.logs.push(event(ROUTE.destination.messageTransmitter, transmitter, 'MessageReceived', [account, 0, nonce,
    zeroPadValue(ROUTE.source.tokenMessenger, 32), 2000, '0x' + raw.slice(2 + 148 * 2)]));
  original.logs.push(event(ROUTE.destination.usdc, token, 'Transfer', ['0x' + '00'.repeat(20), recipient, 999900]));
  let changed = false;
  const currentReceipt = () => {
    if (changed && mode === 'missing') return null;
    const receipt = structuredClone(original);
    if (changed && mode === 'reincluded') {receipt.blockHash = newBlock; for (const log of receipt.logs) log.blockHash = newBlock}
    if (changed && mode === 'status') receipt.status = '0x0';
    if (changed && mode === 'logs') receipt.logs[1].data = '0x' + 1n.toString(16).padStart(64, '0');
    return receipt;
  };
  const evm = new EVMAdapter({rpc: async (_url, method, params = []) => {
    calls.push({method, params, changed});
    if (method === 'eth_chainId') return network.chainId;
    if (method === 'eth_getTransactionReceipt') return currentReceipt();
    if (method === 'eth_getTransactionByHash') {
      const receipt = currentReceipt();
      return receipt && {hash: txHash, from: account, to: receipt.to, input: data, value: '0x0', chainId: network.chainId,
        blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex};
    }
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === '0x0') return {hash: network.genesis, number: '0x0'};
      if (params[0] === 'finalized') return {hash: hash('51'), number: '0x69'};
      assert.equal(params[0], '0x64');
      return {hash: changed && ['canonical-reorg', 'reincluded'].includes(mode) ? newBlock : oldBlock, number: '0x64', transactions: [txHash]};
    }
    if (method === 'eth_call') {
      if (params[0].to.toLowerCase() === ROUTE.destination.messageTransmitter.toLowerCase()) {
        assert.equal(params[1], '0x64'); return transmitter.encodeFunctionResult('usedNonces', [1]);
      }
      assert.equal(token.parseTransaction({data: params[0].data}).name, 'balanceOf');
      // Change the chain after both the initial receipt check and finalized tag.
      changed = true; return token.encodeFunctionResult('balanceOf', [9000000]);
    }
    assert.fail('Unexpected read; no RPC write is allowed: ' + method);
  }});
  const reader = new CctpReader({evm, fetchImpl: () => assert.fail('Destination recovery must not use HTTP')});
  return {reader, calls, input: {...intent, transactionHash: txHash, message: raw, attestation}};
}

test('stable finalized receipt is re-read after balance and keeps exact original identity', async () => {
  const f = fixture(), result = await f.reader.destination(f.input);
  assert.equal(result.state, 'finalized'); assert.equal(result.receipt.blockHash, oldBlock); assert.equal(result.receipt.hash, txHash);
  assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 2);
  const lastBalance = f.calls.findLastIndex(call => call.method === 'eth_call');
  const lastReceipt = f.calls.findLastIndex(call => call.method === 'eth_getTransactionReceipt');
  assert.ok(lastReceipt > lastBalance, 'canonical receipt recheck must be after all earlier async reads');
  assert.deepEqual(f.calls.slice(lastReceipt).map(call => call.method), ['eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber']);
});

for (const mode of ['canonical-reorg', 'missing', 'reincluded', 'status', 'logs']) {
  test(`late ${mode} readback cannot publish the earlier receipt as finalized`, async () => {
    const f = fixture(mode);
    await assert.rejects(f.reader.destination(f.input), {code: 'CCTP_RECEIPT_MISMATCH'});
    assert.equal(f.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 2);
  });
}
