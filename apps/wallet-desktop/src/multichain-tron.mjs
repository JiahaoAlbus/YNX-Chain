import {createHash, timingSafeEqual} from 'node:crypto';
import {HDNodeWallet, computeAddress} from 'ethers';
import {utils as tronUtils} from 'tronweb';

// Not mounted in main/preload/UI. Offline codec/sign review is distinct from
// financial approval and never supplies transport or broadcast authority.
export const TRON_CAPABILITIES = Object.freeze({read: true, intentPreview: true,
  verifiedTransactionPreview: true, offlineSignReview: true, sign: false, broadcast: false});
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX64 = (1n << 63n) - 1n, MAX256 = (1n << 256n) - 1n;
const sha = bytes => createHash('sha256').update(bytes).digest();
function fail(code, message = code) { const error = new Error(message); error.code = code; throw error; }
function integer(value, max = MAX64) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) fail('TRON_INTEGER_INVALID');
    value = String(value);
  }
  if (typeof value !== 'string' || value.length > 78 || !/^(0|[1-9][0-9]*)$/.test(value)) fail('TRON_INTEGER_INVALID');
  const result = BigInt(value); if (result > max) fail('TRON_INTEGER_INVALID'); return result;
}
function hex(value, bytes) {
  if (typeof value !== 'string' || !new RegExp(`^[a-fA-F0-9]{${bytes * 2}}$`).test(value)) fail('TRON_HEX_INVALID');
  return value.toLowerCase();
}
function encode58(bytes) {
  let n = BigInt('0x' + bytes.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; } return out;
}
export function tronAddress(value) {
  let bytes;
  if (typeof value === 'string' && /^41[a-fA-F0-9]{40}$/.test(value)) bytes = Buffer.from(value, 'hex');
  else {
    if (typeof value !== 'string' || value.length !== 34 || value[0] !== 'T') fail('TRON_ADDRESS_INVALID');
    let n = 0n;
    for (const c of value) { const i = alphabet.indexOf(c); if (i < 0) fail('TRON_ADDRESS_INVALID'); n = n * 58n + BigInt(i); }
    const encoded = Buffer.from(n.toString(16).padStart(50, '0'), 'hex');
    if (encoded.length !== 25 || encoded[0] !== 0x41 || !timingSafeEqual(encoded.subarray(21), sha(sha(encoded.subarray(0, 21))).subarray(0, 4))) fail('TRON_ADDRESS_INVALID');
    bytes = encoded.subarray(0, 21);
  }
  if (bytes.subarray(1).every(b => b === 0)) fail('TRON_ADDRESS_INVALID');
  return Object.freeze({hex: bytes.toString('hex'), base58: encode58(Buffer.concat([bytes, sha(sha(bytes)).subarray(0, 4)]))});
}
export function tronUnits(value, decimals = 6, token = false) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || typeof value !== 'string' || value.length > 400 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) fail('TRON_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.'); if (fraction.length > decimals) fail('TRON_PRECISION');
  const result = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (result <= 0n || result > (token ? MAX256 : MAX64)) fail('TRON_AMOUNT_INVALID'); return result.toString();
}
export function tronDisplay(value, decimals = 6) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail('TRON_DECIMALS_INVALID');
  const n = integer(value, MAX256).toString(); if (!decimals) return n;
  const padded = n.padStart(decimals + 1, '0'), fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}
export function tronNetwork(input) {
  if (!input || !['mainnet', 'shasta', 'nile'].includes(input.id)) fail('TRON_NETWORK_INVALID');
  // Same 0x41 address prefix on these networks. Pin a genesis independently;
  // a name, address or EVM chainId cannot establish TRON network identity.
  return Object.freeze({id: input.id, genesisBlockId: hex(input.genesisBlockId, 32)});
}
export function tronDerivationPath(index = 0) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) fail('TRON_PATH_INVALID');
  return `m/44'/195'/0'/0/${index}`;
}
// Caller owns local secret lifecycle. This pure helper returns only the public
// address; no logging/storage. Integration must invoke inside existing guard.
export function tronMnemonicAddress(phrase, index = 0, passphrase = '') {
  if (typeof phrase !== 'string' || phrase.length > 1024 || ![12, 24].includes(phrase.trim().split(/\s+/).length) || typeof passphrase !== 'string' || passphrase.length > 1024) fail('TRON_MNEMONIC_INVALID');
  try { const node = HDNodeWallet.fromPhrase(phrase, passphrase, tronDerivationPath(index)); return tronAddress('41' + computeAddress(node.publicKey).slice(2)); }
  catch (error) { if (error.code === 'TRON_PATH_INVALID') throw error; fail('TRON_MNEMONIC_INVALID'); }
}
export function trc20Parameter(address, amount) {
  const word = tronAddress(address).hex.slice(2).padStart(64, '0');
  return word + integer(amount, MAX256).toString(16).padStart(64, '0');
}
export function tronBalance(response, account) {
  const expected = tronAddress(account).hex;
  if (!response || typeof response !== 'object' || Array.isArray(response)) fail('TRON_RPC_INVALID');
  // {} means unactivated account only. A different partial response is not 0.
  if (Object.keys(response).length === 0) return Object.freeze({sun: '0', display: '0', activated: false});
  if (tronAddress(response.address).hex !== expected) fail('TRON_ACCOUNT_MISMATCH');
  const sun = integer(response.balance ?? '0').toString(); return Object.freeze({sun, display: tronDisplay(sun), activated: true});
}
export function trc20Balance(response, decimals) {
  const amount = BigInt('0x' + hex(trc20ConstantResult(response, 64), 32)).toString();
  return Object.freeze({units: amount, display: tronDisplay(amount, decimals)});
}
export const TRC20_METADATA_SELECTORS = Object.freeze({name: 'name()', symbol: 'symbol()', decimals: 'decimals()'});
export const TRC20_METADATA_LIMITS = deepFreezeMetadata({name: {codepoints: 64, utf8Bytes: 128}, symbol: {codepoints: 16, utf8Bytes: 32}});
function deepFreezeMetadata(value) { Object.values(value).forEach(Object.freeze); return Object.freeze(value); }
// Only for triggerconstantcontract responses. java-tron callConstantContract
// sets Result.ret=SUCESS (proto3 zero), leaving contractRet=DEFAULT (zero).
// Both may be omitted in JSON. DEFAULT is NOT confirmed transaction execution;
// never reuse this predicate for transaction receipts or broadcast acceptance.
export function tronConstantCallStatus(ret, required=false) {
  if (ret===undefined) return !required;
  if (!Array.isArray(ret) || ret.length!==1 || !ret[0] || typeof ret[0]!=='object' || Array.isArray(ret[0])) return false;
  const status=ret[0];
  return [undefined,0,'SUCESS','SUCCESS'].includes(status.ret) &&
    [undefined,0,1,'DEFAULT','SUCCESS'].includes(status.contractRet);
}
function trc20ConstantResult(response, maxHexLength) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || Object.hasOwn(response, 'Error') ||
    !response.result || typeof response.result !== 'object' || Array.isArray(response.result) || response.result.result !== true ||
    (response.result.code !== undefined && response.result.code !== 'SUCCESS' && response.result.code !== 0) ||
    !Array.isArray(response.constant_result) || response.constant_result.length !== 1) fail('TRON_CONTRACT_FAILED');
  if (!tronConstantCallStatus(response.transaction?.ret)) fail('TRON_CONTRACT_FAILED');
  const value = response.constant_result[0];
  if (typeof value !== 'string' || value.length > maxHexLength || !/^(?:[a-fA-F0-9]{2})+$/.test(value)) fail('TRON_TOKEN_RESULT_INVALID');
  return value.toLowerCase();
}
export function trc20Decimals(response) {
  const value = BigInt('0x' + hex(trc20ConstantResult(response, 64), 32));
  if (value > 255n) fail('TRON_DECIMALS_INVALID'); return Number(value);
}
export function trc20Text(response, field) {
  if (!Object.hasOwn(TRC20_METADATA_LIMITS, field)) fail('TRON_METADATA_FIELD_INVALID');
  const limits = TRC20_METADATA_LIMITS[field], encoded = trc20ConstantResult(response, (64 + Math.ceil(limits.utf8Bytes / 32) * 32) * 2);
  // Canonical single ABI string: offset=32, exact length word, aligned body,
  // zero-only padding, no trailing hidden payload/offset/bytes32 guessing.
  if (encoded.length < 128 || BigInt('0x' + encoded.slice(0, 64)) !== 32n) fail('TRON_TOKEN_ABI_INVALID');
  const length = BigInt('0x' + encoded.slice(64, 128));
  if (length < 1n || length > BigInt(limits.utf8Bytes)) fail('TRON_TOKEN_TEXT_INVALID');
  const n = Number(length), padded = Math.ceil(n / 32) * 32;
  if (encoded.length !== (64 + padded) * 2 || !/^0*$/.test(encoded.slice(128 + n * 2))) fail('TRON_TOKEN_ABI_INVALID');
  let value;
  try { value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(Buffer.from(encoded.slice(128, 128 + n * 2), 'hex')); }
  catch { fail('TRON_TOKEN_TEXT_INVALID'); }
  if ([...value].length > limits.codepoints || !value || value.trim() !== value || /[\p{Cc}\p{Cf}<>]/u.test(value)) fail('TRON_TOKEN_TEXT_INVALID');
  return value;
}
export function tronResources(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) fail('TRON_RPC_INVALID');
  const remaining = (limit, used) => { const l = integer(response[limit] ?? 0), u = integer(response[used] ?? 0); return (l > u ? l - u : 0n).toString(); };
  return Object.freeze({stakedBandwidth: remaining('NetLimit', 'NetUsed'), freeBandwidth: remaining('freeNetLimit', 'freeNetUsed'), energy: remaining('EnergyLimit', 'EnergyUsed')});
}
export function tronResourceEstimate({bandwidth, energy, resources, bandwidthPriceSun, energyPriceSun, extraFeeSun = '0'}) {
  const b = integer(bandwidth), e = integer(energy), availableE = integer(resources.energy);
  // Bandwidth pools are not naively summed: if neither covers the entire
  // transaction, conservatively budget the entire bandwidth burn.
  const burnB = b <= integer(resources.stakedBandwidth) || b <= integer(resources.freeBandwidth) ? 0n : b;
  const burnE = e > availableE ? e - availableE : 0n;
  const sun = burnB * integer(bandwidthPriceSun) + burnE * integer(energyPriceSun) + integer(extraFeeSun);
  if (sun > MAX64) fail('TRON_FEE_INVALID');
  return Object.freeze({estimatedSun: sun.toString(), display: tronDisplay(sun.toString()), guaranteed: false,
    caveat: 'Live chain prices, activation, multisig, dynamic energy and developer sharing require node-backed estimation.'});
}
export function tronIntentPreview({network, owner, to, asset = 'trx', amount, decimals = 6, contract}) {
  const chain = tronNetwork(network), from = tronAddress(owner), recipient = tronAddress(to);
  if (!['trx', 'trc20'].includes(asset) || (asset === 'trx' && (decimals !== 6 || contract !== undefined))) fail('TRON_ASSET_INVALID');
  const units = tronUnits(amount, decimals, asset === 'trc20');
  const intent = {network: chain, owner: from.hex, to: recipient.hex, asset, units, decimals,
    contract: asset === 'trc20' ? tronAddress(contract).hex : null};
  const binding = sha(Buffer.from(JSON.stringify(intent))).toString('hex');
  return Object.freeze({...intent, binding, canSign: false, transactionVerified: false,
    call: Object.freeze(asset === 'trx' ? {endpoint: '/wallet/createtransaction', owner_address: from.hex, to_address: recipient.hex, amount: units, visible: false}
      : {endpoint: '/wallet/triggersmartcontract', owner_address: from.hex, contract_address: intent.contract, function_selector: 'transfer(address,uint256)', parameter: trc20Parameter(recipient.hex, units), call_value: 0, visible: false})});
}
// Metadata diagnostic only: hash equality does NOT prove JSON/protobuf binding.
// Missing audited TRON protobuf codec means this result is never signable.
export function inspectTronEnvelope(transaction, reference, now) {
  if (!transaction || !transaction.raw_data || typeof transaction.raw_data_hex !== 'string' || transaction.raw_data_hex.length > 200000 || !/^(?:[a-fA-F0-9]{2})+$/.test(transaction.raw_data_hex) || (transaction.signature !== undefined && (!Array.isArray(transaction.signature) || transaction.signature.length))) fail('TRON_TRANSACTION_INVALID');
  const raw = transaction.raw_data, timestamp = integer(raw.timestamp), expiration = integer(raw.expiration), clock = integer(now);
  const number = integer(reference.number), block = hex(reference.blockID, 32), headTime = integer(reference.timestamp);
  if (BigInt('0x' + block.slice(0, 16)) !== number || hex(raw.ref_block_bytes, 2) !== (number & 65535n).toString(16).padStart(4, '0') || hex(raw.ref_block_hash, 8) !== block.slice(16, 32)) fail('TRON_REFERENCE_MISMATCH');
  if (timestamp < headTime || timestamp > clock || expiration <= clock || expiration <= timestamp || expiration > headTime + 86400000n) fail('TRON_EXPIRATION_INVALID');
  const txID = sha(Buffer.from(transaction.raw_data_hex, 'hex')).toString('hex');
  if (hex(transaction.txID, 32) !== txID) fail('TRON_TXID_MISMATCH');
  return Object.freeze({txID, expiration: expiration.toString(), transactionVerified: false, canSign: false, reason: 'TRON_PROTOBUF_CODEC_UNAVAILABLE'});
}
export class TronReadAdapter {
  #transport;
  constructor({network, transport} = {}) { Object.defineProperty(this, 'network', {value: tronNetwork(network), enumerable: true}); this.#transport = transport; }
  async verify() {
    if (typeof this.#transport !== 'function') fail('TRON_TRANSPORT_UNAVAILABLE');
    const block = await this.#transport(this.network, '/wallet/getblockbynum', {num: 0});
    const header = block?.block_header?.raw_data;
    // protobuf JSON may omit the default number=0, but must include the header.
    if (!header || (header.number ?? 0) !== 0 || hex(block.blockID, 32) !== this.network.genesisBlockId) fail('TRON_NETWORK_MISMATCH');
  }
  async balance(account) { const owner = tronAddress(account); await this.verify(); return tronBalance(await this.#transport(this.network, '/wallet/getaccount', {address: owner.hex, visible: false}), owner.hex); }
  async tokenBalance(account, contract, decimals) {
    const owner = tronAddress(account), token = tronAddress(contract);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail('TRON_DECIMALS_INVALID'); await this.verify();
    const response = await this.#transport(this.network, '/wallet/triggerconstantcontract', {owner_address: owner.hex, contract_address: token.hex, function_selector: 'balanceOf(address)', parameter: owner.hex.slice(2).padStart(64, '0'), visible: false});
    return trc20Balance(response, decimals);
  }
  async #metadata(owner, token) {
    const responses = {};
    for (const field of ['decimals', 'symbol', 'name']) {
      responses[field] = await this.#transport(this.network, '/wallet/triggerconstantcontract',
        {owner_address: owner.hex, contract_address: token.hex, function_selector: TRC20_METADATA_SELECTORS[field], parameter: '', visible: false});
      // Validate each response immediately: no successful partial object/fallback
      // and no extra node calls after a failed/malicious value.
      responses[field] = field === 'decimals' ? trc20Decimals(responses[field]) : trc20Text(responses[field], field);
    }
    return Object.freeze({networkId: this.network.id, networkGenesis: this.network.genesisBlockId,
      contractHex: token.hex, contractAddress: token.base58, name: responses.name, symbol: responses.symbol,
      decimals: responses.decimals, verification: 'provider-reported-not-consensus'});
  }
  async tokenMetadata(account, contract) {
    const owner = tronAddress(account), token = tronAddress(contract); await this.verify();
    return this.#metadata(owner, token);
  }
  async tokenRead(account, contract) {
    const owner = tronAddress(account), token = tronAddress(contract); await this.verify();
    const metadata = await this.#metadata(owner, token);
    const response = await this.#transport(this.network, '/wallet/triggerconstantcontract',
      {owner_address: owner.hex, contract_address: token.hex, function_selector: 'balanceOf(address)', parameter: owner.hex.slice(2).padStart(64, '0'), visible: false});
    const balance = trc20Balance(response, metadata.decimals);
    return Object.freeze({...metadata, accountHex: owner.hex, accountAddress: owner.base58, units: balance.units, display: balance.display});
  }
  async resources(account) { const owner = tronAddress(account); await this.verify(); return tronResources(await this.#transport(this.network, '/wallet/getaccountresource', {address: owner.hex, visible: false})); }
  sign() { fail('TRON_SIGNING_DISABLED'); }
  broadcast() { fail('TRON_BROADCAST_DISABLED'); }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('TRON_UNKNOWN_FIELD');
}
const deepFreeze = value => { if (value && typeof value === 'object') {for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value);} return value; };
function safeInteger(value) { const n = integer(value); if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail('TRON_CODEC_INTEGER_RANGE'); return Number(n); }
function approvedIntent(intent) {
  const expected = tronIntentPreview({network: intent.network, owner: intent.owner, to: intent.to, asset: intent.asset,
    amount: tronDisplay(intent.units, intent.decimals), decimals: intent.decimals, ...(intent.asset === 'trc20' ? {contract: intent.contract} : {})});
  if (expected.binding !== intent.binding) fail('TRON_INTENT_CHANGED'); return expected;
}
function canonicalTronTransaction(intent, context) {
  const expected = approvedIntent(intent), network = tronNetwork(context.network);
  if (network.id !== expected.network.id || network.genesisBlockId !== expected.network.genesisBlockId) fail('TRON_NETWORK_MISMATCH');
  // V1 intentionally supports owner permission only. Active/multisig requires
  // account permission validation, not an arbitrary unreviewed permission ID.
  if ((context.permissionId ?? 0) !== 0) fail('TRON_PERMISSION_UNSUPPORTED');
  const fee = safeInteger(context.feeLimitSun ?? '0');
  if ((expected.asset === 'trx' && fee !== 0) || (expected.asset === 'trc20' && fee <= 0)) fail('TRON_FEE_INVALID');
  const number = integer(context.reference.number), blockID = hex(context.reference.blockID, 32);
  const type = expected.asset === 'trx' ? 'TransferContract' : 'TriggerSmartContract';
  const value = expected.asset === 'trx'
    ? {owner_address: expected.owner, to_address: expected.to, amount: safeInteger(expected.units)}
    : {owner_address: expected.owner, contract_address: expected.contract, call_value: 0, data: 'a9059cbb' + trc20Parameter(expected.to, expected.units)};
  const raw_data = {contract: [{parameter: {value, type_url: 'type.googleapis.com/protocol.' + type}, type}],
    ref_block_bytes: (number & 65535n).toString(16).padStart(4, '0'), ref_block_hash: blockID.slice(16, 32),
    timestamp: safeInteger(context.timestamp), expiration: safeInteger(context.expiration), ...(fee ? {fee_limit: fee} : {})};
  const pb = tronUtils.transaction.txJsonToPb({visible: false, raw_data});
  const raw_data_hex = tronUtils.transaction.txPbToRawDataHex(pb).toLowerCase();
  const txID = sha(Buffer.from(raw_data_hex, 'hex')).toString('hex');
  return {visible: false, txID, raw_data, raw_data_hex};
}
export function buildTronUnsigned(intent, context, now) {
  const transaction = canonicalTronTransaction(intent, context);
  verifyTronUnsigned(transaction, intent, context, now);
  return deepFreeze(transaction);
}
export function verifyTronUnsigned(transaction, intent, context, now) {
  exactKeys(transaction, ['visible', 'txID', 'raw_data', 'raw_data_hex']);
  if (transaction.visible !== false) fail('TRON_TRANSACTION_INVALID');
  const raw = transaction.raw_data;
  exactKeys(raw, ['contract', 'ref_block_bytes', 'ref_block_hash', 'timestamp', 'expiration', 'fee_limit']);
  if (!Array.isArray(raw.contract) || raw.contract.length !== 1) fail('TRON_CONTRACT_UNSUPPORTED');
  const contract = raw.contract[0]; exactKeys(contract, ['parameter', 'type', 'Permission_id']);
  if ((contract.Permission_id ?? 0) !== 0) fail('TRON_PERMISSION_UNSUPPORTED');
  exactKeys(contract.parameter, ['value', 'type_url']);
  exactKeys(contract.parameter.value, intent.asset === 'trx' ? ['owner_address', 'to_address', 'amount'] : ['owner_address', 'contract_address', 'call_value', 'data']);
  const expected = canonicalTronTransaction(intent, context);
  if (JSON.stringify(raw) !== JSON.stringify(expected.raw_data)) fail('TRON_INTENT_MISMATCH');
  if (transaction.raw_data_hex !== expected.raw_data_hex || transaction.txID !== expected.txID) fail('TRON_PROTOBUF_MISMATCH');
  // Official codec deserializes the canonical original raw bytes. Byte-for-byte
  // reconstruction above rejects hidden/unknown/duplicate proto fields even
  // if the protobuf reader would ignore them. The JSON alone is never trusted.
  const decoded = tronUtils.deserializeTx.deserializeTransaction(contract.type, transaction.raw_data_hex);
  const value = decoded.contract[0].parameter.value;
  if (decoded.contract[0].type !== contract.type || decoded.contract[0].parameter.type_url !== contract.parameter.type_url || decoded.contract[0].Permission_id !== 0 || decoded.data || decoded.scripts || decoded.auths.length ||
    decoded.timestamp !== raw.timestamp || decoded.expiration !== raw.expiration || decoded.ref_block_bytes.toLowerCase() !== raw.ref_block_bytes || decoded.ref_block_hash.toLowerCase() !== raw.ref_block_hash || decoded.fee_limit !== (raw.fee_limit ?? 0)) fail('TRON_PROTOBUF_MISMATCH');
  for (const [key, expectedValue] of Object.entries(contract.parameter.value)) if ((typeof value[key] === 'string' ? value[key].toLowerCase() : value[key]) !== expectedValue) fail('TRON_PROTOBUF_MISMATCH');
  if (intent.asset === 'trc20' && (value.call_token_value !== 0 || value.token_id !== 0)) fail('TRON_PROTOBUF_MISMATCH');
  inspectTronEnvelope(transaction, context.reference, now);
  return Object.freeze({txID: transaction.txID, binding: intent.binding, transactionVerified: true, broadcastAuthorized: false});
}
export function verifyTronSigned(transaction, intent, context, now) {
  exactKeys(transaction, ['visible', 'txID', 'raw_data', 'raw_data_hex', 'signature']);
  if (!Array.isArray(transaction.signature) || transaction.signature.length !== 1) fail('TRON_SIGNATURE_INVALID');
  const signature = hex(transaction.signature[0], 65);
  const {signature: ignored, ...unsigned} = transaction;
  verifyTronUnsigned(unsigned, intent, context, now);
  try { if (tronAddress(tronUtils.crypto.ecRecover(transaction.txID, signature)).hex !== intent.owner) fail('TRON_SIGNATURE_OWNER_MISMATCH'); }
  catch (error) { if (error.code === 'TRON_SIGNATURE_OWNER_MISMATCH') throw error; fail('TRON_SIGNATURE_INVALID'); }
  return Object.freeze({txID: transaction.txID, owner: intent.owner, binding: intent.binding, broadcastAuthorized: false});
}
export class TronSignReview {
  #transaction; #intent; #context; #used = false; #result = null;
  // Construct only after normal user approval in the owner flow. This object
  // does not manufacture UI authorization, permission leases or a broadcaster.
  constructor({transaction, intent, context, now}) {
    verifyTronUnsigned(transaction, intent, context, now);
    this.#transaction = deepFreeze(structuredClone(transaction));
    this.#intent = deepFreeze(structuredClone(intent)); this.#context = deepFreeze(structuredClone(context));
  }
  get result() { return this.#result; }
  async signMnemonic({withMnemonic, guard, onProduced, now}) {
    if (typeof withMnemonic !== 'function') fail('TRON_MNEMONIC_BOUNDARY_INVALID');
    // Product owner passes PasswordWalletVault.withMnemonic with its original
    // permission. The phrase never crosses IPC; derivation and signing occur
    // inside that original guarded callback. No derived-key export.
    return this.sign({guard, onProduced, now, withSecret: action => withMnemonic(async (phrase, identity, keyGuard) => {
      guard.assert(); keyGuard.assert();
      const path = tronDerivationPath(this.#context.derivationIndex ?? 0);
      if (tronMnemonicAddress(phrase, this.#context.derivationIndex ?? 0).hex !== this.#intent.owner) fail('TRON_SIGNATURE_OWNER_MISMATCH');
      let node;
      try { node = HDNodeWallet.fromPhrase(phrase, '', path); return await action(node.privateKey.slice(2), identity, keyGuard); }
      finally { node = null; } // JS strings cannot promise immediate zeroization.
    })});
  }
  async sign({withSecret, guard, onProduced, now}) {
    if (this.#used) fail('TRON_REVIEW_CONSUMED');
    this.#used = true; // One attempt, even if cancelled/failed; no automatic retry.
    if (typeof withSecret !== 'function' || typeof onProduced !== 'function' || typeof now !== 'function' || typeof guard?.assert !== 'function') fail('TRON_SIGN_BOUNDARY_INVALID');
    try {
      guard.assert(); verifyTronUnsigned(this.#transaction, this.#intent, this.#context, now());
      let invoked = false;
      await withSecret(async (secret, identity, keyGuard) => {
        if (invoked) fail('TRON_DUPLICATE_SIGN_CALLBACK'); invoked = true;
        guard.assert(); if (typeof keyGuard?.assert !== 'function') fail('TRON_SIGN_BOUNDARY_INVALID'); keyGuard.assert();
        verifyTronUnsigned(this.#transaction, this.#intent, this.#context, now());
        if (typeof secret !== 'string' || !/^[a-fA-F0-9]{64}$/.test(secret)) fail('TRON_KEY_INVALID');
        if (tronAddress(tronUtils.crypto.pkToAddress(secret)).hex !== this.#intent.owner) fail('TRON_SIGNATURE_OWNER_MISMATCH');
        const signed = tronUtils.crypto.signTransaction(secret, structuredClone(this.#transaction));
        // Capture before any awaited outer post-action gate, exactly like R2.
        this.#result = deepFreeze({state: 'signed-unsubmitted', network: this.#intent.network,
          owner: this.#intent.owner, binding: this.#intent.binding, txID: signed.txID,
          raw_data_hex: signed.raw_data_hex, signature: signed.signature[0], transaction: signed, broadcastAuthorized: false});
        const result = onProduced(this.#result);
        if (result?.then) fail('TRON_CUSTODY_CALLBACK_MUST_BE_SYNC');
        verifyTronSigned(signed, this.#intent, this.#context, now());
        keyGuard.assert(); guard.assert(); return this.#result;
      });
      if (!this.#result) fail('TRON_SIGN_RESULT_MISSING'); guard.assert(); return this.#result;
    } catch (error) {
      if (this.#result) {
        this.#result = deepFreeze({...this.#result, state: 'unknown', cause: String(error.code || 'TRON_SIGN_HANDOFF_FAILED')});
        const unknown = new Error('Original signed result retained; query/recover without signing again.');
        unknown.code = 'TRON_RECORDED_OUTCOME_UNKNOWN'; unknown.txID = this.#result.txID; throw unknown;
      }
      throw error;
    }
  }
}

export const TRON_QUERY_ENDPOINTS = Object.freeze(['/wallet/getblockbynum', '/wallet/gettransactionbyid', '/wallet/gettransactioninfobyid']);
const failures = new Set(['REVERT', 'BAD_JUMP_DESTINATION', 'OUT_OF_MEMORY', 'PRECOMPILED_CONTRACT',
  'STACK_TOO_SMALL', 'STACK_TOO_LARGE', 'ILLEGAL_OPERATION', 'STACK_OVERFLOW', 'OUT_OF_ENERGY',
  'OUT_OF_TIME', 'JVM_STACK_OVER_FLOW', 'TRANSFER_FAILED', 'INVALID_CODE']);
function sortedJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(sortedJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + sortedJSON(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function isMissing(response) { return response && typeof response === 'object' && !Array.isArray(response) && Object.keys(response).length === 0; }
function resultState(network, original, state = 'unknown', receipt = null, evidence = null) {
  return deepFreeze({networkId: network.id, txid: original.txID, state, receipt, ...(evidence ? {evidence} : {})});
}
function assertOriginalTronTuple(network, original, intent, context) {
  if (!original || original.network?.id !== network.id || original.network?.genesisBlockId !== network.genesisBlockId ||
    original.owner !== intent.owner || original.binding !== intent.binding || original.txID !== original.transaction?.txID ||
    original.raw_data_hex !== original.transaction?.raw_data_hex || original.signature !== original.transaction?.signature?.[0]) fail('TRON_ORIGINAL_TUPLE_MISMATCH');
  // Query can happen after expiry. Verify the original signed transaction at
  // its original timestamp, not by inventing a fresh transaction lifetime.
  verifyTronSigned(original.transaction, intent, context, context.timestamp);
}
function assertQueriedTronBody(body, original) {
  exactKeys(body, ['visible', 'txID', 'raw_data', 'raw_data_hex', 'signature', 'ret']);
  if (body.visible !== undefined && body.visible !== false) fail('TRON_QUERY_BODY_MISMATCH');
  if (hex(body.txID, 32) !== original.txID || typeof body.raw_data_hex !== 'string' || body.raw_data_hex.toLowerCase() !== original.raw_data_hex ||
    !Array.isArray(body.signature) || body.signature.length !== 1 || hex(body.signature[0], 65) !== hex(original.signature, 65)) fail('TRON_QUERY_BODY_MISMATCH');
  const raw = structuredClone(body.raw_data);
  exactKeys(raw, ['contract', 'ref_block_bytes', 'ref_block_hash', 'timestamp', 'expiration', 'fee_limit']);
  if (!Array.isArray(raw.contract) || raw.contract.length !== 1) fail('TRON_QUERY_BODY_MISMATCH');
  for (const key of ['timestamp', 'expiration']) raw[key] = safeInteger(raw[key]);
  if (raw.fee_limit !== undefined) raw.fee_limit = safeInteger(raw.fee_limit);
  if (raw.fee_limit === 0) delete raw.fee_limit;
  const contract = raw.contract[0]; exactKeys(contract, ['parameter', 'type', 'Permission_id']);
  if (contract.Permission_id === 0) delete contract.Permission_id;
  exactKeys(contract.parameter, ['type_url', 'value']);
  const value = contract.parameter.value;
  if (original.transaction.raw_data.contract[0].type === 'TransferContract') {
    exactKeys(value, ['owner_address', 'to_address', 'amount']); value.amount = safeInteger(value.amount);
  } else {
    exactKeys(value, ['owner_address', 'contract_address', 'data', 'call_value', 'call_token_value', 'token_id']);
    value.call_value = safeInteger(value.call_value ?? 0);
    for (const key of ['call_token_value', 'token_id']) if (value[key] !== undefined) { if (safeInteger(value[key]) !== 0) fail('TRON_QUERY_BODY_MISMATCH'); delete value[key]; }
  }
  // Supported fields and values must equal the immutable original; object key
  // order and hex casing in FullNode JSON are representation-only differences.
  for (const key of ['ref_block_bytes', 'ref_block_hash']) if (typeof raw[key] === 'string') raw[key] = raw[key].toLowerCase();
  for (const key of ['owner_address', 'to_address', 'contract_address', 'data']) if (typeof contract.parameter.value?.[key] === 'string') contract.parameter.value[key] = contract.parameter.value[key].toLowerCase();
  if (sortedJSON(raw) !== sortedJSON(original.transaction.raw_data)) fail('TRON_QUERY_BODY_MISMATCH');
  if (!tronUtils.transaction.txCheck({visible: false, txID: original.txID, raw_data: raw, raw_data_hex: original.raw_data_hex})) fail('TRON_QUERY_BODY_MISMATCH');
  if (body.ret === undefined) return null;
  if (!Array.isArray(body.ret) || body.ret.length !== 1) fail('TRON_QUERY_BODY_MISMATCH');
  const ret = body.ret[0];
  // TRC20/native execution result only. Other contract families remain blocked.
  exactKeys(ret, ['contractRet', 'fee']); if (ret.fee !== undefined) integer(ret.fee);
  if (ret.contractRet !== 'SUCCESS' && !failures.has(ret.contractRet)) fail('TRON_QUERY_EXECUTION_UNKNOWN');
  return ret.contractRet;
}
export function normalizeTronReceipt({network, original, intent, context, body, info, block}) {
  const chain = tronNetwork(network); assertOriginalTronTuple(chain, original, intent, context);
  if (isMissing(body)) return resultState(chain, original);
  const contractRet = assertQueriedTronBody(body, original);
  if (isMissing(info)) return resultState(chain, original, 'unknown', null, {bodyMatched: true, receiptMissing: true});
  if (!info || typeof info !== 'object' || Array.isArray(info) || info.Error || hex(info.id, 32) !== original.txID) fail('TRON_QUERY_RECEIPT_MISMATCH');
  const height = safeInteger(info.blockNumber);
  const blockHash = hex(block?.blockID, 32);
  if (BigInt('0x' + blockHash.slice(0, 16)) !== BigInt(height) || safeInteger(block?.block_header?.raw_data?.number) !== height ||
    !Array.isArray(block.transactions) || block.transactions.length > 20000) fail('TRON_QUERY_BLOCK_MISMATCH');
  const matches = block.transactions.filter(t => typeof t?.txID === 'string' && t.txID.toLowerCase() === original.txID);
  if (matches.length !== 1) fail('TRON_QUERY_BLOCK_MISMATCH');
  const includedRet = assertQueriedTronBody(matches[0], original);
  if (!contractRet || includedRet !== contractRet) fail('TRON_QUERY_EXECUTION_UNKNOWN');
  if (info.receipt !== undefined && (!info.receipt || typeof info.receipt !== 'object' || Array.isArray(info.receipt))) fail('TRON_QUERY_RECEIPT_MISMATCH');
  const receiptResult = info.receipt?.result ?? null, infoResult = info.result ?? null;
  if (infoResult !== null && infoResult !== 'SUCESS' && infoResult !== 'FAILED') fail('TRON_QUERY_EXECUTION_UNKNOWN');
  let success;
  if (contractRet === 'SUCCESS') {
    if (infoResult === 'FAILED' || (receiptResult !== null && receiptResult !== 'SUCCESS') || (intent.asset === 'trc20' && receiptResult !== 'SUCCESS')) fail('TRON_QUERY_EXECUTION_CONFLICT');
    success = true;
  } else {
    // Failure requires the same included original tuple and explicit agreeing
    // node execution status, never an RPC error/timeout/not-found/expiry guess.
    if (infoResult === 'SUCESS' || (receiptResult !== null && receiptResult !== contractRet) || (receiptResult === null && infoResult !== 'FAILED')) fail('TRON_QUERY_EXECUTION_CONFLICT');
    success = false;
  }
  const evidence = {contractRet, receiptResult, infoResult};
  if (info.resMessage !== undefined) {
    if (typeof info.resMessage !== 'string' || info.resMessage.length > 4096 || !/^(?:[a-fA-F0-9]{2})*$/.test(info.resMessage)) fail('TRON_QUERY_RECEIPT_MISMATCH');
    evidence.resMessageHex = info.resMessage.toLowerCase();
  }
  return resultState(chain, original, success ? 'included' : 'failed',
    {txid: original.txID, blockHash, blockHeight: height, success, confirmationScope: 'rpc-block-inclusion'}, evidence);
}
export class TronTransactionQuery {
  #network; #transport;
  constructor({network, transport}) { this.#network = tronNetwork(network); this.#transport = transport; }
  async check({original, intent, context}) {
    // Freeze original signed tuple before the first asynchronous query. No
    // mutable UI owner/intent can change a pending query or its returned txid.
    const snapshot = structuredClone({original, intent, context});
    assertOriginalTronTuple(this.#network, snapshot.original, snapshot.intent, snapshot.context);
    try {
      if (typeof this.#transport !== 'function') fail('TRON_TRANSPORT_UNAVAILABLE');
      const genesis = await this.#transport(this.#network, '/wallet/getblockbynum', {num: 0});
      if (!genesis?.block_header?.raw_data || (genesis.block_header.raw_data.number ?? 0) !== 0 || hex(genesis.blockID, 32) !== this.#network.genesisBlockId) fail('TRON_NETWORK_MISMATCH');
      const request = {value: snapshot.original.txID};
      const body = await this.#transport(this.#network, '/wallet/gettransactionbyid', request);
      if (isMissing(body)) return resultState(this.#network, snapshot.original);
      assertQueriedTronBody(body, snapshot.original);
      const info = await this.#transport(this.#network, '/wallet/gettransactioninfobyid', request);
      if (isMissing(info)) return resultState(this.#network, snapshot.original, 'unknown', null, {bodyMatched: true, receiptMissing: true});
      if (!info || info.Error || hex(info.id, 32) !== snapshot.original.txID) fail('TRON_QUERY_RECEIPT_MISMATCH');
      const block = await this.#transport(this.#network, '/wallet/getblockbynum', {num: safeInteger(info.blockNumber)});
      return normalizeTronReceipt({...snapshot, network: this.#network, body, info, block});
    } catch (error) {
      // Preserve original signed custody. Query error is not transaction fail.
      return resultState(this.#network, snapshot.original, 'unknown', null,
        {queryError: typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'TRON_QUERY_UNAVAILABLE'});
    }
  }
}
