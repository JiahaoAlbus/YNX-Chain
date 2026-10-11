import {createHash, timingSafeEqual} from 'node:crypto';
import {HDNodeWallet, computeAddress} from 'ethers';

// TRON-specific read/intent adapter. Not mounted in main/preload/UI. No signer,
// HTTP implementation, protobuf codec, transaction construction or broadcaster.
export const TRON_CAPABILITIES = Object.freeze({read: true, intentPreview: true,
  verifiedTransactionPreview: false, sign: false, broadcast: false});
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
