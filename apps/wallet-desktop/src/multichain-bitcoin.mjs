// Bitcoin-only read/unsigned-review adapter. No secret, signing or broadcast API.
// BIP84/BIP173; Esplora API. Provider data is not consensus/SPV verification.
import { createHash } from 'node:crypto';

const MAX = 2100000000000000n;
const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const NETWORKS = Object.freeze({
  mainnet: { hrp: 'bc', coin: 0, genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f' },
  testnet3: { hrp: 'tb', coin: 1, genesis: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943' },
  testnet4: { hrp: 'tb', coin: 1, genesis: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043' },
  signet: { hrp: 'tb', coin: 1, genesis: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6' }
});
function fail(code) { throw Object.assign(new Error(code), { code }); }
function network(id) { return NETWORKS[id] || fail('BTC_NETWORK_UNSUPPORTED'); }
function integer(value, max = MAX) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('BTC_INTEGER_REQUIRED');
  if (!['number', 'string', 'bigint'].includes(typeof value) || !/^(0|[1-9][0-9]*)$/.test(String(value))) fail('BTC_INTEGER_REQUIRED');
  const n = BigInt(value);
  if (n > max) fail('BTC_AMOUNT_RANGE');
  return n;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function bitcoinDerivationPath(id, { account = 0, change = 0, index = 0 } = {}) {
  const n = network(id);
  integer(account, 2147483647n); integer(index, 2147483647n);
  if (change !== 0 && change !== 1) fail('BTC_CHANGE_INVALID');
  return `m/84'/${n.coin}'/${account}'/${change}/${index}`;
}
export function parseBitcoinAmount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value)) fail('BTC_DECIMAL_REQUIRED');
  const [whole, fraction = ''] = value.split('.');
  return integer(BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'))).toString();
}
export function formatBitcoinAmount(sats) {
  const n = integer(sats);
  return `${n / 100000000n}.${String(n % 100000000n).padStart(8, '0')}`;
}
// Fail closed on legacy, P2WSH, Taproot and future witness types until their
// complete review/fee/signing support exists. No silent P2WPKH reinterpretation.
export function validateBitcoinAddress(address, id) {
  const { hrp } = network(id);
  if (typeof address !== 'string' || address.length > 90 || address.length < 8 ||
      !/^[!-~]+$/.test(address) || (address !== address.toLowerCase() && address !== address.toUpperCase())) fail('BTC_ADDRESS_INVALID');
  const a = address.toLowerCase(), split = a.lastIndexOf('1');
  if (a.slice(0, split) !== hrp) fail('BTC_ADDRESS_NETWORK');
  const words = [...a.slice(split + 1)].map(c => ALPHABET.indexOf(c));
  if (words.length < 7 || words.some(x => x < 0)) fail('BTC_ADDRESS_INVALID');
  const expanded = [...hrp].map(c => c.charCodeAt(0) >> 5).concat(0, [...hrp].map(c => c.charCodeAt(0) & 31));
  let chk = 1;
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  for (const v of [...expanded, ...words]) {
    const top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= generator[i];
  }
  if ((chk >>> 0) !== 1) fail('BTC_ADDRESS_CHECKSUM');
  if (words[0] !== 0) fail('BTC_ADDRESS_TYPE_UNSUPPORTED');
  let bits = 0, acc = 0; const bytes = [];
  for (const v of words.slice(1, -6)) {
    acc = ((acc << 5) | v) & 0xffff; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 255)) fail('BTC_ADDRESS_PADDING');
  if (bytes.length !== 20) fail('BTC_ADDRESS_TYPE_UNSUPPORTED');
  return freeze({ address: a, network: id, type: 'p2wpkh', scriptPubKey: `0014${Buffer.from(bytes).toString('hex')}` });
}
export function normalizeBitcoinUtxos(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) fail('BTC_UTXO_RESPONSE');
  const seen = new Set(); let total = 0n;
  return freeze(rows.map(row => {
    if (!row || !/^[0-9a-f]{64}$/.test(row.txid) || typeof row.status?.confirmed !== 'boolean') fail('BTC_UTXO_RESPONSE');
    const vout = Number(integer(row.vout, 4294967295n));
    const key = `${row.txid}:${vout}`;
    if (seen.has(key)) fail('BTC_DUPLICATE_OUTPOINT'); seen.add(key);
    const value = integer(row.value); total += value;
    if (!value || total > MAX) fail('BTC_UTXO_VALUE');
    const status = { confirmed: row.status.confirmed };
    if (status.confirmed) {
      status.blockHeight = Number(integer(row.status.block_height, 2147483647n));
      if (!/^[0-9a-f]{64}$/.test(row.status.block_hash)) fail('BTC_UTXO_RESPONSE');
      status.blockHash = row.status.block_hash;
    }
    return { txid: row.txid, vout, valueSats: value.toString(), status };
  }));
}
export function createBitcoinPreview({ requestId, network: id, from, to, changeAddress, amount, feeRateSatPerVbyte, utxos }) {
  network(id);
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) fail('BTC_REQUEST_ID');
  const sender = validateBitcoinAddress(from, id), recipient = validateBitcoinAddress(to, id), change = validateBitcoinAddress(changeAddress, id);
  const amountSats = BigInt(parseBitcoinAmount(amount)), rate = integer(feeRateSatPerVbyte, 10000n);
  if (amountSats < 294n || !rate) fail('BTC_DUST_OR_FEE');
  const candidates = normalizeBitcoinUtxos(utxos).filter(u => u.status.confirmed)
    .sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout);
  const inputs = []; let sum = 0n, fee = 0n, changeSats = 0n, vbytes = 0;
  // Conservative review estimate: 69 vB per P2WPKH input + 31/output +11.
  // Not serialized transaction/PSBT; actual signed size and prevouts need
  // validation by a future reliable signer before human approval/broadcast.
  for (const u of candidates) {
    if (inputs.length >= 252) fail('BTC_PREVIEW_INPUT_LIMIT');
    inputs.push(u); sum += BigInt(u.valueSats);
    vbytes = 11 + inputs.length * 69 + 62; fee = BigInt(vbytes) * rate;
    if (sum >= amountSats + fee) {
      changeSats = sum - amountSats - fee;
      if (changeSats < 294n) {
        // Explicitly include sub-dust remainder in the displayed fee.
        vbytes = 11 + inputs.length * 69 + 31; fee = sum - amountSats; changeSats = 0n;
      }
      break;
    }
  }
  if (!inputs.length || sum < amountSats + fee || (changeSats === 0n && sum !== amountSats + fee)) fail('BTC_INSUFFICIENT_CONFIRMED_FUNDS');
  const outputs = [{ address: recipient.address, scriptPubKey: recipient.scriptPubKey, valueSats: amountSats.toString(), role: 'recipient' }];
  if (changeSats) outputs.push({ address: change.address, scriptPubKey: change.scriptPubKey, valueSats: changeSats.toString(), role: 'change' });
  const originalRequest = { requestId, network: id, from: sender.address, to: recipient.address, changeAddress: change.address, amount, feeRateSatPerVbyte: rate.toString() };
  const review = { originalRequest, state: 'unsigned-preview', inputs, outputs, feeSats: fee.toString(), estimatedVbytes: vbytes, feeEstimateOnly: true, signingSupported: false, broadcastSupported: false };
  return freeze({ ...review, requestDigest: createHash('sha256').update(JSON.stringify(review)).digest('hex') });
}
export class BitcoinReadAdapter {
  #id; #request;
  constructor({ network: id, request } = {}) {
    network(id);
    if (typeof request !== 'function') fail('BTC_TRANSPORT_NOT_CONFIGURED');
    this.#id = id; this.#request = request;
  }
  async #get(path, signal) {
    if (signal?.aborted) fail('BTC_REQUEST_CANCELLED');
    const value = await this.#request({ method: 'GET', path, network: this.#id, signal });
    if (signal?.aborted) fail('BTC_REQUEST_CANCELLED');
    return value;
  }
  async #network(signal) {
    if (await this.#get('/block-height/0', signal) !== network(this.#id).genesis) fail('BTC_PROVIDER_NETWORK_MISMATCH');
  }
  async readAddress(address, { signal } = {}) {
    const a = validateBitcoinAddress(address, this.#id).address;
    await this.#network(signal);
    const rows = normalizeBitcoinUtxos(await this.#get(`/address/${a}/utxo`, signal));
    let confirmed = 0n, unconfirmed = 0n;
    for (const row of rows) if (row.status.confirmed) confirmed += BigInt(row.valueSats); else unconfirmed += BigInt(row.valueSats);
    return freeze({ network: this.#id, address: a, confirmedSats: confirmed.toString(), unconfirmedSats: unconfirmed.toString(), utxos: rows, verification: 'provider-reported-not-spv' });
  }
  async preview(request, { signal } = {}) {
    if (!request || (request.network !== undefined && request.network !== this.#id)) fail('BTC_REQUEST_NETWORK_MISMATCH');
    // Copy request before awaits; never read a mutable caller request later.
    const original = { ...request, network: this.#id };
    const address = await this.readAddress(original.from, { signal });
    return createBitcoinPreview({ ...original, utxos: address.utxos.map(u => ({ txid: u.txid, vout: u.vout, value: u.valueSats, status: { confirmed: u.status.confirmed, block_height: u.status.blockHeight, block_hash: u.status.blockHash } })) });
  }
  sign() { fail('BTC_SIGNING_NOT_IMPLEMENTED'); }
  broadcast() { fail('BTC_BROADCAST_NOT_IMPLEMENTED'); }
}
