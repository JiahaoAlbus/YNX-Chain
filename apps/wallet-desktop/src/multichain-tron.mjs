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
  if (!response?.result || response.result.result !== true || !Array.isArray(response.constant_result) || response.constant_result.length !== 1) fail('TRON_CONTRACT_FAILED');
  const amount = BigInt('0x' + hex(response.constant_result[0], 32)).toString();
  return Object.freeze({units: amount, display: tronDisplay(amount, decimals)});
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
    const owner = tronAddress(account), token = tronAddress(contract); await this.verify();
    const response = await this.#transport(this.network, '/wallet/triggerconstantcontract', {owner_address: owner.hex, contract_address: token.hex, function_selector: 'balanceOf(address)', parameter: owner.hex.slice(2).padStart(64, '0'), visible: false});
    return trc20Balance(response, decimals);
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
