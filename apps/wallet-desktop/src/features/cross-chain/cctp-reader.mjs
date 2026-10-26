import {Interface, zeroPadValue} from 'ethers';
import {EVMAdapter, address, quantity} from '../../multichain-evm.mjs';
import {ROUTE, decodeAndValidateMessage, encodeBurn, encodeMint} from './cctp-wire.mjs';

// Circle V2 ABIs: circlefin/evm-cctp-contracts src/v2/{TokenMessengerV2,MessageTransmitterV2}.sol.
const usdc = new Interface([
  'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const messenger = new Interface([
  'function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
  'event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)',
]);
const transmitter = new Interface([
  'function receiveMessage(bytes,bytes) returns(bool)',
  'function usedNonces(bytes32) view returns(uint256)',
  'event MessageSent(bytes message)',
  'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
]);
const API = 'https://iris-api-sandbox.circle.com';
const MAX_BODY = 1_000_000;
const PREFLIGHT_ERRORS = new Set(['MULTICHAIN_NETWORK_MISMATCH', 'MULTICHAIN_RPC_TIMEOUT', 'MULTICHAIN_RPC_ERROR', 'CCTP_NETWORK_MISMATCH', 'CCTP_PREFLIGHT_TIMEOUT']);
const HASH = /^0x[0-9a-f]{64}$/i;
const ZERO = '0x' + '0'.repeat(40);
const lower = value => typeof value === 'string' ? value.toLowerCase() : '';
const hex = value => '0x' + BigInt(value).toString(16);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
function uint(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 1n << 256n)
    fail('CCTP_INPUT_INVALID', 'Expected exact unsigned token units.');
  return BigInt(value);
}
function input(values) {
  const amount = uint(values.amountUnits), fee = uint(values.maxFeeUnits);
  if (amount === 0n || fee >= amount) fail('CCTP_INPUT_INVALID', 'The fee cap must be smaller than the positive amount.');
  return {...values, account: address(values.account), recipient: address(values.recipient)};
}
function txHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) fail('CCTP_INPUT_INVALID', 'A recorded transaction hash is required.');
  return value.toLowerCase();
}
function attestationBytes(value) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{130}){1,20}$/i.test(value))
    fail('CCTP_ATTESTATION_INVALID', 'Circle attestation signatures have an invalid encoding.');
  return value.toLowerCase();
}
function nonce(value) {
  if (typeof value === 'string' && HASH.test(value)) return value.toLowerCase();
  return '0x' + uint(value).toString(16).padStart(64, '0');
}

function receiptEvidence(receipt) {
  return JSON.stringify([
    lower(receipt.transactionHash), lower(receipt.blockHash), quantity(receipt.blockNumber).toString(),
    quantity(receipt.transactionIndex).toString(), lower(receipt.from), lower(receipt.to), quantity(receipt.status).toString(),
    receipt.logs.map(log => [lower(log.address), log.topics.map(lower), lower(log.data), lower(log.transactionHash),
      lower(log.blockHash), quantity(log.blockNumber).toString(), quantity(log.transactionIndex).toString(), quantity(log.logIndex).toString(), log.removed]),
  ]);
}

/** Public read-only reader. The main-only original wallet owns every review, signature and send. */
export class CctpReader {
  constructor({evm = new EVMAdapter(), fetchImpl = globalThis.fetch, now = Date.now} = {}) {
    this.evm = evm; this.fetch = fetchImpl; this.now = now;
  }

  async network(network, route) {
    if (!network || network.chainId !== hex(route.chainId) || !HASH.test(network.genesis ?? ''))
      fail('CCTP_NETWORK_MISMATCH', 'This route requires the saved Sepolia and Base Sepolia networks.');
    await this.evm.verify(network);
  }

  /** Read only the saved RPC's chain ID and genesis; this is not route/asset readiness. */
  async preflightNetwork(network, route) {
    const result = errorCode => Object.freeze({status: errorCode === null ? 'verified' : 'unverified', stage: 'rpc-identity', errorCode});
    let timer;
    const deadline = new Promise(resolve => {timer = setTimeout(() => resolve(result('CCTP_PREFLIGHT_TIMEOUT')), 25_000)});
    const identity = Promise.resolve().then(() => this.network(network, route)).then(
      () => result(null),
      error => {let code; try {code = error?.code} catch {} return result(PREFLIGHT_ERRORS.has(code) ? code : 'CCTP_PREFLIGHT_UNAVAILABLE')},
    );
    // Both branches have closed results. A late identity completion cannot publish
    // another result, and its rejection remains consumed after the deadline wins.
    try {return await Promise.race([identity, deadline])} finally {clearTimeout(timer)}
  }

  async contracts(network, route) {
    for (const contract of [route.usdc, route.tokenMessenger, route.messageTransmitter]) {
      const code = await this.evm.call(network, 'eth_getCode', [contract, 'latest']);
      if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || /^0x0+$/i.test(code))
        fail('CCTP_CONTRACT_MISSING', 'A pinned Circle contract has no deployed code on this network.');
    }
    if (await this.read(network, route.usdc, usdc, 'decimals', []) !== '6')
      fail('CCTP_ASSET_MISMATCH', 'The pinned USDC contract must have six decimals.');
  }

  async read(network, contract, abi, method, args, block = 'latest') {
    const result = await this.evm.call(network, 'eth_call', [{to: contract, data: abi.encodeFunctionData(method, args)}, block]);
    try { return abi.decodeFunctionResult(method, result)[0].toString(); }
    catch { fail('CCTP_RPC_INVALID', 'A contract read returned invalid ABI data.'); }
  }

  async get(path, {pending404 = false} = {}) {
    // No caller-supplied URL, redirects, retry, credential or write endpoint.
    const url = API + path, controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); const error = new Error('Circle query timed out; query the same recorded transaction again.');
      error.code = 'CCTP_HTTP_TIMEOUT'; reject(error);
    }, 12_000); });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetch(url, {method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: {accept: 'application/json'}});
        if (response.redirected || (response.url && response.url !== url)) fail('CCTP_HTTP_INVALID', 'Circle queries must not redirect.');
        if (pending404 && response.status === 404) { await response.body?.cancel(); return null; }
        if (response.status !== 200) fail('CCTP_HTTP_UNAVAILABLE', 'Circle did not return HTTP 200; no fee or completion can be inferred.');
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') ?? '')) fail('CCTP_HTTP_INVALID', 'Circle returned an unsupported content type.');
        const advertised = response.headers.get('content-length');
        if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_BODY)) fail('CCTP_HTTP_INVALID', 'Circle response exceeds the size limit.');
        if (!response.body?.getReader) fail('CCTP_HTTP_INVALID', 'A bounded response stream is required.');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          for (;;) { const {done, value} = await reader.read(); if (done) break;
            size += value.byteLength; if (size > MAX_BODY) fail('CCTP_HTTP_INVALID', 'Circle response exceeds the size limit.'); chunks.push(value);
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
        catch { fail('CCTP_HTTP_INVALID', 'Circle returned invalid JSON.'); }
      })()]);
    } catch (error) {
      if (error?.code?.startsWith('CCTP_')) throw error;
      fail('CCTP_HTTP_UNAVAILABLE', 'Circle query failed; no fee or transaction completion can be inferred.');
    } finally { clearTimeout(timer); controller.abort(); }
  }

  async quote(values) {
    const request = input(values), {sourceNetwork, destinationNetwork, account, recipient, amountUnits, maxFeeUnits} = request;
    await this.network(sourceNetwork, ROUTE.source); await this.network(destinationNetwork, ROUTE.destination);
    await this.contracts(sourceNetwork, ROUTE.source); await this.contracts(destinationNetwork, ROUTE.destination);
    const fees = await this.get(`/v2/burn/USDC/fees/${ROUTE.source.domain}/${ROUTE.destination.domain}`);
    if (!Array.isArray(fees) || fees.length > 20) fail('CCTP_FEE_INVALID', 'Circle fee table is invalid.');
    const selected = fees.filter(fee => fee?.finalityThreshold === ROUTE.minFinalityThreshold);
    if (selected.length !== 1) fail('CCTP_FEE_INVALID', 'Exactly one standard-finality fee is required.');
    const raw = selected[0].minimumFee;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) fail('CCTP_FEE_INVALID', 'Circle fee basis points are invalid.');
    const feeBps = String(raw);
    if (!/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,6})?$/.test(feeBps)) fail('CCTP_FEE_INVALID', 'Circle fee precision is unsupported.');
    const [whole, fraction = ''] = feeBps.split('.'), denominator = 10000n * 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole + fraction), required = (uint(amountUnits) * numerator + denominator - 1n) / denominator;
    if (required > uint(maxFeeUnits)) fail('CCTP_FEE_EXCEEDS_CAP', 'The current Circle fee exceeds the reviewed fee cap.');
    const allowanceUnits = await this.read(sourceNetwork, ROUTE.source.usdc, usdc, 'allowance', [account, ROUTE.source.tokenMessenger]);
    const sourceBalanceUnits = await this.read(sourceNetwork, ROUTE.source.usdc, usdc, 'balanceOf', [account]);
    const destinationBalanceUnits = await this.read(destinationNetwork, ROUTE.destination.usdc, usdc, 'balanceOf', [recipient]);
    if (uint(sourceBalanceUnits) < uint(amountUnits)) fail('CCTP_INSUFFICIENT_USDC', 'Source USDC balance is below the requested amount.');
    return {feeBps, requiredFeeUnits: required.toString(), allowanceUnits, sourceBalanceUnits, destinationBalanceUnits};
  }

  verifyTransaction(tx, network, hash, account, to, data) {
    if (!tx || lower(tx.hash) !== hash || lower(tx.from) !== account || lower(tx.to) !== lower(to) || lower(tx.input) !== data ||
      quantity(tx.value) !== 0n || quantity(tx.chainId) !== BigInt(network.chainId))
      fail('CCTP_TRANSACTION_MISMATCH', 'The recorded transaction does not match this exact CCTP operation.');
  }

  async receipt(network, hash, account, to, data) {
    const receipt = await this.evm.call(network, 'eth_getTransactionReceipt', [hash]);
    const tx = await this.evm.call(network, 'eth_getTransactionByHash', [hash]);
    if (receipt === null) { if (tx !== null) this.verifyTransaction(tx, network, hash, account, to, data); return null; }
    this.verifyTransaction(tx, network, hash, account, to, data);
    const block = await this.evm.call(network, 'eth_getBlockByNumber', [receipt.blockNumber, false]);
    if (lower(receipt.transactionHash) !== hash || !HASH.test(receipt.blockHash ?? '') || lower(block?.hash) !== lower(receipt.blockHash) ||
      quantity(block.number) !== quantity(receipt.blockNumber) || lower(tx.blockHash) !== lower(receipt.blockHash) || quantity(tx.blockNumber) !== quantity(receipt.blockNumber) ||
      lower(receipt.from) !== account || lower(receipt.to) !== lower(to) || !Array.isArray(block.transactions) ||
      quantity(receipt.transactionIndex) > BigInt(Number.MAX_SAFE_INTEGER) || quantity(tx.transactionIndex) !== quantity(receipt.transactionIndex) ||
      lower(block.transactions[Number(quantity(receipt.transactionIndex))]) !== hash || !Array.isArray(receipt.logs) || receipt.logs.length > 2000 || quantity(receipt.status) > 1n)
      fail('CCTP_RECEIPT_MISMATCH', 'The receipt is not bound to the original transaction in a canonical RPC block.');
    return receipt;
  }

  events(receipt, contract, abi, name) {
    const topic = abi.getEvent(name).topicHash, events = [], indices = new Set();
    for (const log of receipt.logs) {
      if (lower(log.address) !== lower(contract) || lower(log.topics?.[0]) !== topic) continue;
      if (log.removed !== false || lower(log.transactionHash) !== lower(receipt.transactionHash) || lower(log.blockHash) !== lower(receipt.blockHash) ||
        quantity(log.blockNumber) !== quantity(receipt.blockNumber) || quantity(log.transactionIndex) !== quantity(receipt.transactionIndex))
        fail('CCTP_EVENT_MISMATCH', 'A CCTP event is not bound to the canonical receipt.');
      const index = quantity(log.logIndex).toString();
      if (indices.has(index)) fail('CCTP_EVENT_MISMATCH', 'A receipt contains duplicate event indices.');
      indices.add(index);
      try { events.push(abi.parseLog(log).args); } catch { fail('CCTP_EVENT_MISMATCH', 'A CCTP event has invalid ABI data.'); }
    }
    return events;
  }

  async attestation(values) {
    const request = input(values), hash = txHash(request.sourceTxHash);
    await this.network(request.sourceNetwork, ROUTE.source); await this.network(request.destinationNetwork, ROUTE.destination);
    const receipt = await this.receipt(request.sourceNetwork, hash, request.account, ROUTE.source.tokenMessenger, encodeBurn(request).toLowerCase());
    if (!receipt) return null;
    if (quantity(receipt.status) === 0n) fail('CCTP_SOURCE_REVERTED', 'The recorded source burn reverted; it did not create a mint claim.');
    const deposits = this.events(receipt, ROUTE.source.tokenMessenger, messenger, 'DepositForBurn');
    const messages = this.events(receipt, ROUTE.source.messageTransmitter, transmitter, 'MessageSent');
    if (deposits.length !== 1 || messages.length !== 1) fail('CCTP_SOURCE_EVENT_MISMATCH', 'Exactly one source deposit and one source message are required.');
    const deposit = deposits[0];
    if (lower(deposit.burnToken) !== lower(ROUTE.source.usdc) || deposit.amount !== uint(request.amountUnits) || lower(deposit.depositor) !== request.account ||
      lower(deposit.mintRecipient) !== zeroPadValue(request.recipient, 32) || deposit.destinationDomain !== BigInt(ROUTE.destination.domain) ||
      lower(deposit.destinationTokenMessenger) !== lower(zeroPadValue(ROUTE.destination.tokenMessenger, 32)) || lower(deposit.destinationCaller) !== zeroPadValue(request.account, 32) ||
      deposit.maxFee !== uint(request.maxFeeUnits) || deposit.minFinalityThreshold !== BigInt(ROUTE.minFinalityThreshold) || deposit.hookData !== '0x')
      fail('CCTP_SOURCE_EVENT_MISMATCH', 'The source deposit differs from the reviewed burn.');
    decodeAndValidateMessage(messages[0].message, {...request, mode: 'source'});
    const response = await this.get(`/v2/messages/${ROUTE.source.domain}?transactionHash=${hash}`, {pending404: true});
    if (response === null) return null;
    if (!response || lower(response.sourceTxHash) !== hash || !Array.isArray(response.messages) || response.messages.length > 1)
      fail('CCTP_ATTESTATION_MISMATCH', 'Circle response does not identify the original unique source transaction.');
    if (response.messages.length === 0) return null;
    const item = response.messages[0];
    if (item.status === 'pending_confirmations') return null;
    if (item.status !== 'complete' || item.cctpVersion !== 2) fail('CCTP_ATTESTATION_INVALID', 'Circle returned an unsupported attestation status or version.');
    const destinationBlockNumber = quantity(await this.evm.call(request.destinationNetwork, 'eth_blockNumber')).toString();
    const decoded = decodeAndValidateMessage(item.message, {...request, mode: 'attested', destinationBlockNumber});
    if (nonce(item.eventNonce) !== decoded.nonce) fail('CCTP_ATTESTATION_MISMATCH', 'Circle event nonce differs from the signed message nonce.');
    return {message: lower(item.message), attestation: attestationBytes(item.attestation), nonce: decoded.nonce,
      sourceTxHash: hash, feeExecuted: decoded.feeExecuted, amountReceived: decoded.amountReceived};
  }

  async destination(values) {
    const request = input(values), hash = txHash(request.transactionHash), proof = attestationBytes(request.attestation);
    await this.network(request.destinationNetwork, ROUTE.destination);
    // Recovery is read-only and may examine an already expired original transaction.
    // Height zero here validates every static intent field, not permission for a new mint.
    decodeAndValidateMessage(request.message, {...request, mode: 'attested', destinationBlockNumber: '0'});
    const data = encodeMint({message: request.message, attestation: proof}).toLowerCase();
    const receipt = await this.receipt(request.destinationNetwork, hash, request.account, ROUTE.destination.messageTransmitter, data);
    if (!receipt) return {state: 'pending', receipt: null};
    const blockNumber = quantity(receipt.blockNumber).toString();
    const result = {hash, blockHash: lower(receipt.blockHash), blockNumber, status: Number(quantity(receipt.status)), confirmationScope: 'rpc-block-inclusion'};
    if (result.status === 0) return {state: 'reverted', receipt: result};
    // Successful historical mint must have been unexpired at its inclusion height.
    const decoded = decodeAndValidateMessage(request.message, {...request, mode: 'attested', destinationBlockNumber: blockNumber});
    const received = this.events(receipt, ROUTE.destination.messageTransmitter, transmitter, 'MessageReceived');
    if (received.length !== 1 || lower(received[0].caller) !== request.account || received[0].sourceDomain !== BigInt(ROUTE.source.domain) ||
      lower(received[0].nonce) !== decoded.nonce || lower(received[0].sender) !== lower(zeroPadValue(ROUTE.source.tokenMessenger, 32)) ||
      received[0].finalityThresholdExecuted !== BigInt(ROUTE.minFinalityThreshold) || lower(received[0].messageBody) !== lower(decoded.messageBody))
      fail('CCTP_DESTINATION_EVENT_MISMATCH', 'The exact CCTP V2 MessageReceived event was not verified.');
    const mints = this.events(receipt, ROUTE.destination.usdc, usdc, 'Transfer').filter(event => lower(event.from) === ZERO && lower(event.to) === request.recipient);
    if (mints.length !== 1 || mints[0].value !== uint(decoded.amountReceived)) fail('CCTP_MINT_MISMATCH', 'The exact target USDC mint amount and recipient were not verified.');
    if (await this.read(request.destinationNetwork, ROUTE.destination.messageTransmitter, transmitter, 'usedNonces', [decoded.nonce], receipt.blockNumber) !== '1')
      fail('CCTP_NONCE_MISMATCH', 'The minted message nonce was not consumed at the receipt block.');
    const finalized = await this.evm.call(request.destinationNetwork, 'eth_getBlockByNumber', ['finalized', false]);
    let state = 'included';
    if (finalized !== null) {
      if (!HASH.test(finalized.hash ?? '')) fail('CCTP_RPC_INVALID', 'Finalized block identity is invalid.');
      if (quantity(finalized.number) >= BigInt(blockNumber)) {
        if (quantity(finalized.number) === BigInt(blockNumber) && lower(finalized.hash) !== result.blockHash) fail('CCTP_RECEIPT_MISMATCH', 'Finalized block differs from the target receipt.');
        state = 'finalized'; result.confirmationScope = 'rpc-finalized-block';
        result.finalizedBlockHash = lower(finalized.hash); result.finalizedBlockNumber = quantity(finalized.number).toString();
      }
    }
    const balanceUnits = await this.read(request.destinationNetwork, ROUTE.destination.usdc, usdc, 'balanceOf', [request.recipient]);
    // The canonical chain may have changed while nonce/finality/balance reads
    // were outstanding. Reuse the full original-transaction verification last;
    // a higher finalized head alone cannot prove this receipt is still included.
    const currentReceipt = await this.receipt(request.destinationNetwork, hash, request.account, ROUTE.destination.messageTransmitter, data);
    if (!currentReceipt || receiptEvidence(currentReceipt) !== receiptEvidence(receipt))
      fail('CCTP_RECEIPT_MISMATCH', 'The original target receipt changed during verification. Query the same transaction again.');
    return {state, receipt: result, balanceUnits};
  }
}
