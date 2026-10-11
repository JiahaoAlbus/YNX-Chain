// Bitcoin-only reads/review and dependency-verified original-PSBT signing.
// No seed/private-key import or broadcast API; protected custody belongs to parent.
// BIP84/BIP173; Esplora API. Provider data is not consensus/SPV verification.
import { createHash } from 'node:crypto';
import { Psbt, Transaction, payments, networks } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { HDNodeWallet, SigningKey } from 'ethers';
import { ECPairFactory } from 'ecpair';

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
  #id; #request; #networkId;
  constructor({ network: id, networkId = id, request } = {}) {
    network(id);
    if (typeof networkId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(networkId)) fail('BTC_CONFIG_NETWORK_ID');
    if (typeof request !== 'function') fail('BTC_TRANSPORT_NOT_CONFIGURED');
    this.#id = id; this.#networkId = networkId; this.#request = request;
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
  async verify({signal} = {}) { await this.#network(signal); return true; }
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
  async fetchPrevoutProofs(inputs, { signal } = {}) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 252) fail('BTC_PREVOUT_PROOF_REQUIRED');
    const snapshot = inputs.map(i => {
      if (!/^[0-9a-f]{64}$/.test(i?.txid)) fail('BTC_PREVOUT_PROOF_REQUIRED');
      return { txid: i.txid, vout: Number(integer(i.vout, 4294967295n)) };
    });
    await this.#network(signal);
    const previousTransactions = [], unspentChecks = [];
    for (const input of snapshot) {
      const hex = await this.#get(`/tx/${input.txid}/hex`, signal);
      const status = await this.#get(`/tx/${input.txid}/outspend/${input.vout}`, signal);
      if (typeof hex !== 'string' || !status || status.spent !== false) fail('BTC_UNSPENT_CHECK_REQUIRED');
      previousTransactions.push({ txid: input.txid, hex });
      unspentChecks.push({ ...input, network: this.#id, spent: false });
    }
    return freeze({ previousTransactions, unspentChecks, verification: 'provider-reported-not-spv' });
  }
  async querySigned(input, { signal } = {}) {
    if (!input || Object.keys(input).some(k => !['networkId', 'network', 'txid', 'rawTransaction'].includes(k)) || !/^[0-9a-f]{64}$/.test(input.txid)) fail('BTC_QUERY_INPUT_INVALID');
    // Copy original immutable tuple before awaits. No signer/vault/broadcast.
    const original = { networkId: input.networkId, network: input.network, txid: input.txid, rawTransaction: input.rawTransaction };
    const unknown = () => freeze({ networkId: this.#networkId, txid: original.txid, state: 'unknown', receipt: null });
    try {
      if (original.networkId !== this.#networkId || original.network !== this.#id || typeof original.rawTransaction !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(original.rawTransaction) || original.rawTransaction.length > 2000000) fail('BTC_QUERY_BINDING');
      const tx = Transaction.fromHex(original.rawTransaction);
      if (!tx.hasWitnesses() || tx.getId() !== original.txid) fail('BTC_QUERY_BINDING');
      await this.#network(signal);
      const observedRaw = await this.#get(`/tx/${original.txid}/hex`, signal);
      if (observedRaw !== original.rawTransaction) fail('BTC_QUERY_RAW_MISMATCH');
      const status = await this.#get(`/tx/${original.txid}/status`, signal);
      if (status?.confirmed === false) {
        const mempool = await this.#get('/mempool/txids', signal);
        if (!Array.isArray(mempool) || mempool.length > 500000 || mempool.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) || !mempool.includes(original.txid)) fail('BTC_QUERY_MEMPOOL_UNOBSERVED');
        return freeze({ networkId: this.#networkId, txid: original.txid, state: 'submitted-unconfirmed', receipt: null });
      }
      if (status?.confirmed !== true || !/^[0-9a-f]{64}$/.test(status.block_hash)) fail('BTC_QUERY_STATUS_INVALID');
      const height = integer(status.block_height, 2147483647n).toString();
      if (await this.#get(`/block-height/${height}`, signal) !== status.block_hash) fail('BTC_QUERY_REORG');
      const proof = await this.#get(`/tx/${original.txid}/merkle-proof`, signal);
      const header = await this.#get(`/block/${status.block_hash}/header`, signal);
      const receipt = verifyBitcoinInclusion({ txid: original.txid, blockHash: status.block_hash, blockHeight: height, proof, header });
      // Do not combine observations from different canonical-height/status epochs.
      if (await this.#get(`/block-height/${height}`, signal) !== status.block_hash) fail('BTC_QUERY_REORG');
      const last = await this.#get(`/tx/${original.txid}/status`, signal);
      if (last?.confirmed !== true || last.block_hash !== status.block_hash || String(last.block_height) !== height) fail('BTC_QUERY_REORG');
      await this.#network(signal);
      return freeze({ networkId: this.#networkId, txid: original.txid, state: 'included', receipt });
    } catch { return unknown(); }
  }
  sign() { fail('BTC_SIGNING_NOT_IMPLEMENTED'); }
  broadcast() { fail('BTC_BROADCAST_NOT_IMPLEMENTED'); }
}

const doubleSHA256 = bytes => createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest();
// Cryptographic txid-to-Merkle-root/header binding, NOT independent PoW chain,
// header ancestry or consensus/finality validation. Canonicality is RPC-reported.
export function verifyBitcoinInclusion({ txid, blockHash, blockHeight, proof, header }) {
  if (!/^[0-9a-f]{64}$/.test(txid) || !/^[0-9a-f]{64}$/.test(blockHash) || typeof header !== 'string' || !/^[0-9a-f]{160}$/.test(header)) fail('BTC_INCLUSION_HEADER');
  const height = integer(blockHeight, 2147483647n).toString();
  if (!proof || integer(proof.block_height, 2147483647n).toString() !== height || !Array.isArray(proof.merkle) || proof.merkle.length > 32 || proof.merkle.some(x => typeof x !== 'string' || !/^[0-9a-f]{64}$/.test(x))) fail('BTC_INCLUSION_PROOF');
  let index = integer(proof.pos, 4294967295n);
  if (index >= (1n << BigInt(proof.merkle.length))) fail('BTC_INCLUSION_POSITION');
  const bytes = Buffer.from(header, 'hex');
  if (Buffer.from(doubleSHA256(bytes)).reverse().toString('hex') !== blockHash) fail('BTC_INCLUSION_HEADER_HASH');
  let root = Buffer.from(txid, 'hex').reverse();
  for (const hash of proof.merkle) {
    const sibling = Buffer.from(hash, 'hex').reverse();
    root = doubleSHA256((index & 1n) ? Buffer.concat([sibling, root]) : Buffer.concat([root, sibling]));
    index >>= 1n;
  }
  if (!root.equals(bytes.subarray(36, 68))) fail('BTC_INCLUSION_MERKLE_ROOT');
  return freeze({ txid, blockHash, blockHeight: height, success: true, confirmationScope: 'rpc-block-inclusion' });
}

function btcNetwork(id) { network(id); return id === 'mainnet' ? networks.bitcoin : networks.testnet; }
function publicKey(key) {
  if (!(key instanceof Uint8Array) || key.length !== 33 || !ecc.isPoint(key)) fail('BTC_PUBLIC_KEY_INVALID');
  return Uint8Array.from(key);
}
function ownedAddress(key, address, id) {
  const p = payments.p2wpkh({ pubkey: publicKey(key), network: btcNetwork(id) });
  if (p.address !== validateBitcoinAddress(address, id).address) fail('BTC_OWNERSHIP_BINDING');
  return p;
}
// This adapter has no seed/key import and no network broadcast. Parent must persist
// returned PSBT/result in protected wallet storage, under the original operation.
// Provider unspent status is not cryptographic chain inclusion/SPV evidence.
export class BitcoinSigningAdapter {
  #operations = new Map(); #now; #mnemonicAttempts = new Set();
  constructor({ now = () => Date.now() } = {}) { this.#now = now; }
  prepare({ request, publicKey: senderKey, changePublicKey, previousTransactions, unspentChecks, expiresAt, maxFeeSats }) {
    if (!request || this.#operations.has(request.requestId)) fail('BTC_REQUEST_ALREADY_EXISTS');
    const now = this.#now();
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 120000) fail('BTC_REQUEST_DEADLINE');
    const preview = createBitcoinPreview(request), id = preview.originalRequest.network;
    for (const existing of this.#operations.values()) if (existing.state !== 'cancelled' && existing.preview.originalRequest.network === id &&
      existing.preview.inputs.some(a => preview.inputs.some(b => a.txid === b.txid && a.vout === b.vout))) fail('BTC_OUTPOINT_HELD');
    const owned = ownedAddress(senderKey, preview.originalRequest.from, id);
    ownedAddress(changePublicKey, preview.originalRequest.changeAddress, id);
    const feeLimit = integer(maxFeeSats);
    if (BigInt(preview.feeSats) > feeLimit) fail('BTC_FEE_LIMIT');
    if (!Array.isArray(previousTransactions) || !Array.isArray(unspentChecks) || previousTransactions.length !== preview.inputs.length || unspentChecks.length !== preview.inputs.length) fail('BTC_PREVOUT_PROOF_REQUIRED');
    const psbt = new Psbt({ network: btcNetwork(id) });
    psbt.setVersion(2); psbt.setLocktime(0);
    for (const [i, input] of preview.inputs.entries()) {
      const proof = previousTransactions[i], checked = unspentChecks[i];
      if (!proof || proof.txid !== input.txid || typeof proof.hex !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(proof.hex) || proof.hex.length > 8000000) fail('BTC_PREVOUT_PROOF_REQUIRED');
      let tx; try { tx = Transaction.fromHex(proof.hex); } catch { fail('BTC_PREVOUT_TRANSACTION_INVALID'); }
      if (tx.getId() !== input.txid) fail('BTC_PREVOUT_TXID_MISMATCH');
      const out = tx.outs[input.vout];
      if (!out || out.value !== BigInt(input.valueSats) || !Buffer.from(out.script).equals(Buffer.from(owned.output))) fail('BTC_PREVOUT_BINDING');
      if (!checked || checked.network !== id || checked.txid !== input.txid || checked.vout !== input.vout || checked.spent !== false) fail('BTC_UNSPENT_CHECK_REQUIRED');
      psbt.addInput({ hash: input.txid, index: input.vout, sequence: 0xffffffff, nonWitnessUtxo: Buffer.from(proof.hex, 'hex'), witnessUtxo: { value: out.value, script: out.script } });
    }
    for (const output of preview.outputs) psbt.addOutput({ script: Buffer.from(output.scriptPubKey, 'hex'), value: BigInt(output.valueSats) });
    const record = { preview, expiresAt, maxFeeSats: feeLimit.toString(), state: 'prepared', unsignedPsbt: psbt.toBase64(), senderKey: Buffer.from(publicKey(senderKey)).toString('hex'), result: null, error: null };
    this.#operations.set(request.requestId, record);
    return this.status(request.requestId);
  }
  #operation(id) { return this.#operations.get(id) || fail('BTC_REQUEST_NOT_FOUND'); }
  status(id) {
    const r = this.#operation(id);
    return freeze({ requestId: id, state: r.state, expiresAt: r.expiresAt, originalRequest: r.preview.originalRequest, requestDigest: r.preview.requestDigest, unsignedPsbt: r.unsignedPsbt, partialPsbt: r.partialPsbt || null, result: r.result, error: r.error, seedBinding: r.seedBinding || null, persistence: 'parent-protected-store-required' });
  }
  cancel(id) {
    const r = this.#operation(id);
    if (r.state !== 'prepared' || this.#mnemonicAttempts.has(id)) fail('BTC_SIGNING_OUTCOME_NOT_CANCELLABLE');
    r.state = 'cancelled'; return this.status(id);
  }
  async sign(id, options = {}) {
    if (!options || Object.keys(options).some(k => !['signer', 'guard', 'onProduced'].includes(k))) fail('BTC_SIGN_OPTIONS_INVALID');
    const { signer, guard, onProduced } = options;
    const r = this.#operation(id);
    if (r.state !== 'prepared') fail('BTC_SIGNING_ALREADY_ATTEMPTED');
    if (!guard || typeof guard.assert !== 'function' || typeof onProduced !== 'function') fail('BTC_AUTHORIZATION_REQUIRED');
    const assertLive = () => { guard.assert(); if (this.#now() >= r.expiresAt) fail('BTC_REQUEST_EXPIRED'); };
    assertLive();
    if (!signer || typeof signer.sign !== 'function' || Buffer.from(publicKey(signer.publicKey)).toString('hex') !== r.senderKey) fail('BTC_SIGNER_BINDING');
    r.state = 'signing'; // Irreversible attempt fence; no retry after partial/unknown.
    let psbt;
    try {
      // Only the internally prepared PSBT is accepted, never caller PSBT bytes.
      psbt = Psbt.fromBase64(r.unsignedPsbt, { network: btcNetwork(r.preview.originalRequest.network) });
      for (let i = 0; i < r.preview.inputs.length; i++) {
        assertLive();
        // signer can be asynchronous, but must use the original bound public key.
        await psbt.signInputAsync(i, { publicKey: Buffer.from(r.senderKey, 'hex'), sign: hash => signer.sign(Uint8Array.from(hash)) });
      }
      if (!psbt.validateSignaturesOfAllInputs((key, hash, signature) => ecc.verify(hash, key, signature))) fail('BTC_SIGNATURE_INVALID');
      psbt.finalizeAllInputs();
      // Fee limit is checked independently from bitcoinjs default fee-rate ceiling.
      const tx = psbt.extractTransaction();
      const outputs = r.preview.outputs;
      if (tx.version !== 2 || tx.locktime !== 0 || tx.ins.length !== r.preview.inputs.length || tx.outs.length !== outputs.length) fail('BTC_SIGNED_TUPLE_MISMATCH');
      for (const [i, input] of tx.ins.entries()) if (Buffer.from(input.hash).reverse().toString('hex') !== r.preview.inputs[i].txid || input.index !== r.preview.inputs[i].vout || input.sequence !== 0xffffffff) fail('BTC_SIGNED_TUPLE_MISMATCH');
      for (const [i, out] of tx.outs.entries()) if (out.value !== BigInt(outputs[i].valueSats) || Buffer.from(out.script).toString('hex') !== outputs[i].scriptPubKey) fail('BTC_SIGNED_TUPLE_MISMATCH');
      const fee = r.preview.inputs.reduce((sum, i) => sum + BigInt(i.valueSats), 0n) - tx.outs.reduce((sum, o) => sum + o.value, 0n);
      if (fee !== BigInt(r.preview.feeSats) || fee > BigInt(r.maxFeeSats)) fail('BTC_FEE_LIMIT');
      r.result = freeze({ rawTransaction: tx.toHex(), txid: tx.getId(), signedPsbt: psbt.toBase64(), feeSats: fee.toString(), actualVbytes: tx.virtualSize(), originalRequest: r.preview.originalRequest, requestDigest: r.preview.requestDigest, state: 'signed-unsubmitted' });
      r.state = 'signed-unsubmitted';
      // Capture original bytes BEFORE callback/guard post-action can reject.
      // A callback throw leaves result and irreversible fence held, never re-sign.
      const delivered = onProduced(r.result);
      if (delivered && typeof delivered.then === 'function') await delivered;
      assertLive();
      return r.result;
    } catch (error) {
      r.error = { code: error.code || 'BTC_SIGNING_OR_DELIVERY_FAILED', message: 'Original operation retained; no automatic retry.' };
      if (r.result) r.state = 'signed-unsubmitted';
      else { r.state = 'unknown'; if (psbt) r.partialPsbt = psbt.toBase64(); }
      throw Object.assign(new Error(r.result ? 'BTC_SIGNED_RESULT_HELD' : 'BTC_SIGNING_OUTCOME_UNKNOWN'), { code: r.result ? 'BTC_SIGNED_RESULT_HELD' : 'BTC_SIGNING_OUTCOME_UNKNOWN', txid: r.result?.txid, requestId: id });
    }
  }
  broadcast() { fail('BTC_BROADCAST_NOT_IMPLEMENTED'); }
  async prepareMnemonic({ withMnemonic, permission, expectedVaultAccount, derivation, ...prepared } = {}) {
    if (typeof withMnemonic !== 'function' || typeof expectedVaultAccount !== 'string' || !expectedVaultAccount) fail('BTC_MNEMONIC_CUSTODY_REQUIRED');
    const d = normalizeDerivation(derivation);
    if (prepared.request?.network !== d.network) fail('BTC_REQUEST_NETWORK_MISMATCH');
    return withMnemonic((phrase, identity, guard) => {
      guard.assert();
      if (identity?.account !== expectedVaultAccount) fail('BTC_VAULT_ACCOUNT_MISMATCH');
      const keys = deriveKeys(phrase, d);
      // Supplied public keys must never substitute another account/path.
      if (prepared.publicKey && !Buffer.from(prepared.publicKey).equals(Buffer.from(keys.senderPublic))) fail('BTC_DERIVATION_BINDING');
      if (prepared.changePublicKey && !Buffer.from(prepared.changePublicKey).equals(Buffer.from(keys.changePublic))) fail('BTC_DERIVATION_BINDING');
      const status = this.prepare({ ...prepared, publicKey: keys.senderPublic, changePublicKey: keys.changePublic });
      const r = this.#operation(status.requestId);
      r.seedBinding = freeze({ ...d, vaultAccount: expectedVaultAccount, senderPath: keys.senderPath, changePath: keys.changePath, senderPublicKey: Buffer.from(keys.senderPublic).toString('hex'), changePublicKey: Buffer.from(keys.changePublic).toString('hex') });
      return freeze({ ...this.status(status.requestId), seedBinding: r.seedBinding });
    }, permission);
  }
  async signMnemonic(id, { withMnemonic, permission, expectedVaultAccount, persistSigningAttempt, onProduced } = {}) {
    const r = this.#operation(id);
    if (!r.seedBinding || typeof withMnemonic !== 'function' || typeof persistSigningAttempt !== 'function' || typeof onProduced !== 'function') fail('BTC_MNEMONIC_CUSTODY_REQUIRED');
    if (r.seedBinding.vaultAccount !== expectedVaultAccount) fail('BTC_VAULT_ACCOUNT_MISMATCH');
    if (r.state !== 'prepared' || this.#mnemonicAttempts.has(id)) fail('BTC_SIGNING_ALREADY_ATTEMPTED');
    this.#mnemonicAttempts.add(id);
    try {
      return await withMnemonic(async (phrase, identity, guard) => {
        guard.assert();
        if (identity?.account !== r.seedBinding.vaultAccount) fail('BTC_VAULT_ACCOUNT_MISMATCH');
        const keys = deriveKeys(phrase, r.seedBinding);
        if (Buffer.from(keys.senderPublic).toString('hex') !== r.seedBinding.senderPublicKey || Buffer.from(keys.changePublic).toString('hex') !== r.seedBinding.changePublicKey) fail('BTC_DERIVATION_BINDING');
        // Durable original signing-attempt fence/outpoints MUST ACK before signer.
        if (this.#now() >= r.expiresAt) fail('BTC_REQUEST_EXPIRED');
        const ack = await guard.step(() => persistSigningAttempt(freeze({ ...this.status(id), seedBinding: r.seedBinding, state: 'signing-attempt' })));
        if (!ack || ack.durable !== true || ack.state !== 'signing-attempt' || ack.requestId !== id || ack.requestDigest !== r.preview.requestDigest) fail('BTC_SIGNING_FENCE_ACK_REQUIRED');
        guard.assert();
        const bytes = Buffer.from(keys.sender.privateKey.slice(2), 'hex');
        try {
          const signer = ECPairFactory(ecc).fromPrivateKey(bytes, { network: btcNetwork(r.seedBinding.network), compressed: true });
          return await this.sign(id, { signer, guard, onProduced });
        } finally { bytes.fill(0); }
      }, permission);
    } catch (error) {
      if (!r.result && r.state === 'prepared') r.state = 'unknown';
      if (!r.error) r.error = { code: error.code || 'BTC_MNEMONIC_OPERATION_FAILED', message: 'Original operation retained; no automatic retry.' };
      throw error;
    }
  }
}

function normalizeDerivation(input = {}) {
  if (!input || Object.keys(input).some(k => !['network', 'account', 'index', 'changeIndex'].includes(k))) fail('BTC_DERIVATION_INVALID');
  const { network: id, account = 0, index = 0, changeIndex = 0 } = input;
  network(id); integer(account, 2147483647n); integer(index, 2147483647n); integer(changeIndex, 2147483647n);
  return freeze({ network: id, account: Number(account), index: Number(index), changeIndex: Number(changeIndex) });
}
function deriveKeys(phrase, d) {
  if (typeof phrase !== 'string' || ![12, 24].includes(phrase.trim().split(/\s+/).length)) fail('BTC_MNEMONIC_REQUIRED');
  const senderPath = bitcoinDerivationPath(d.network, { account: d.account, change: 0, index: d.index });
  const changePath = bitcoinDerivationPath(d.network, { account: d.account, change: 1, index: d.changeIndex });
  let sender, change;
  try { sender = HDNodeWallet.fromPhrase(phrase, '', senderPath); change = HDNodeWallet.fromPhrase(phrase, '', changePath); } catch { fail('BTC_MNEMONIC_INVALID'); }
  const senderPublic = Uint8Array.from(Buffer.from(SigningKey.computePublicKey(sender.privateKey, true).slice(2), 'hex'));
  const changePublic = Uint8Array.from(Buffer.from(SigningKey.computePublicKey(change.privateKey, true).slice(2), 'hex'));
  return { sender, senderPublic, changePublic, senderPath, changePath };
}
export async function deriveBitcoinMnemonicAccount({ withMnemonic, permission, expectedVaultAccount, derivation } = {}) {
  if (typeof withMnemonic !== 'function' || typeof expectedVaultAccount !== 'string' || !expectedVaultAccount) fail('BTC_MNEMONIC_CUSTODY_REQUIRED');
  const d = normalizeDerivation(derivation);
  return withMnemonic((phrase, identity, guard) => {
    guard.assert();
    if (identity?.account !== expectedVaultAccount) fail('BTC_VAULT_ACCOUNT_MISMATCH');
    const keys = deriveKeys(phrase, d);
    return freeze({ ...d, vaultAccount: expectedVaultAccount, senderPath: keys.senderPath, changePath: keys.changePath, publicKey: Buffer.from(keys.senderPublic).toString('hex'), changePublicKey: Buffer.from(keys.changePublic).toString('hex'), address: payments.p2wpkh({ pubkey: keys.senderPublic, network: btcNetwork(d.network) }).address, changeAddress: payments.p2wpkh({ pubkey: keys.changePublic, network: btcNetwork(d.network) }).address });
  }, permission);
}
