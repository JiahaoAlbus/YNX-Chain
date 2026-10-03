// Isolated synthetic-data QA. Not a production store, browser bridge or ratchet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [lab, evidence] = process.argv.slice(2);
if (!lab || !evidence) throw new Error('isolated SDK directory and evidence directory required');
const packageRoot = path.join(lab, 'node_modules/@signalapp/libsignal-client');
const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(metadata.version, '0.104.0');
const sdk = await import(pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
const results = [];
const copy = bytes => Uint8Array.from(bytes);
const copyMap = map => new Map([...map].map(([key, value]) => [key, copy(value)]));
const addressKey = address => JSON.stringify([address.name(), address.deviceId()]);

function cloneState(state) {
  return { ...state, sessions: copyMap(state.sessions), identities: copyMap(state.identities),
    prekeys: copyMap(state.prekeys), signed: copyMap(state.signed), kem: copyMap(state.kem),
    usedKem: new Set(state.usedKem), outbox: new Map([...state.outbox].map(([id, entry]) =>
      [id, { type: entry.type, ciphertext: copy(entry.ciphertext) }])) };
}
function equalState(left, right) {
  for (const key of ['sessions', 'identities', 'prekeys', 'signed', 'kem']) {
    if (left[key].size !== right[key].size) return false;
    for (const [id, bytes] of left[key]) {
      const other = right[key].get(id);
      if (!other || !Buffer.from(bytes).equals(Buffer.from(other))) return false;
    }
  }
  if (left.usedKem.size !== right.usedKem.size || [...left.usedKem].some(id => !right.usedKem.has(id))) return false;
  if (left.outbox.size !== right.outbox.size) return false;
  for (const [id, entry] of left.outbox) {
    const other = right.outbox.get(id);
    if (!other || entry.type !== other.type || !Buffer.from(entry.ciphertext).equals(Buffer.from(other.ciphertext))) return false;
  }
  return true;
}

function ports(state) {
  const sessions = new class extends sdk.SessionStore {
    async saveSession(address, record) { state.sessions.set(addressKey(address), copy(record.serialize())); }
    async getSession(address) {
      const bytes = state.sessions.get(addressKey(address));
      return bytes ? sdk.SessionRecord.deserialize(copy(bytes)) : null;
    }
    async getExistingSessions(addresses) {
      const records = [];
      for (const address of addresses) {
        const record = await this.getSession(address);
        if (!record) throw new Error('QA_SESSION_MISSING');
        records.push(record);
      }
      return records;
    }
  };
  const identities = new class extends sdk.IdentityKeyStore {
    async getIdentityKey() { return state.identity.privateKey; }
    async getLocalRegistrationId() { return state.registration; }
    async isTrustedIdentity(address, key) {
      const expected = state.trusted.get(addressKey(address));
      return expected !== undefined && Buffer.from(expected).equals(Buffer.from(key.serialize()));
    }
    async saveIdentity(address, key) {
      if (!await this.isTrustedIdentity(address, key)) throw new Error('QA_IDENTITY_NOT_PINNED');
      state.identities.set(addressKey(address), copy(key.serialize()));
      return sdk.IdentityChange.NewOrUnchanged;
    }
    async getIdentity(address) {
      const bytes = state.identities.get(addressKey(address));
      return bytes ? sdk.PublicKey.deserialize(copy(bytes)) : null;
    }
  };
  const prekeys = new class extends sdk.PreKeyStore {
    async savePreKey(id, record) { state.prekeys.set(id, copy(record.serialize())); }
    async getPreKey(id) {
      const bytes = state.prekeys.get(id);
      if (!bytes) throw new Error('QA_PREKEY_MISSING');
      return sdk.PreKeyRecord.deserialize(copy(bytes));
    }
    async removePreKey(id) { state.prekeys.delete(id); }
  };
  const signed = new class extends sdk.SignedPreKeyStore {
    async saveSignedPreKey(id, record) { state.signed.set(id, copy(record.serialize())); }
    async getSignedPreKey(id) {
      const bytes = state.signed.get(id);
      if (!bytes) throw new Error('QA_SIGNED_PREKEY_MISSING');
      return sdk.SignedPreKeyRecord.deserialize(copy(bytes));
    }
  };
  const kem = new class extends sdk.KyberPreKeyStore {
    async saveKyberPreKey(id, record) { state.kem.set(id, copy(record.serialize())); }
    async getKyberPreKey(id) {
      const bytes = state.kem.get(id);
      if (!bytes) throw new Error('QA_KEM_PREKEY_MISSING');
      return sdk.KyberPreKeyRecord.deserialize(copy(bytes));
    }
    async markKyberPreKeyUsed(id, signedId, baseKey) {
      // Single one-time fixture only; no last-resort or multi-node claim.
      state.usedKem.add(JSON.stringify([id, signedId, Buffer.from(baseKey.serialize()).toString('hex')]));
      state.kem.delete(id);
    }
  };
  return { sessions, identities, prekeys, signed, kem };
}

function endpoint(uuid, registration) {
  return { address: sdk.ProtocolAddress.new(sdk.Aci.fromUuid(uuid), 1), state: {
    identity: sdk.IdentityKeyPair.generate(), registration, trusted: new Map(), sessions: new Map(),
    identities: new Map(), prekeys: new Map(), signed: new Map(), kem: new Map(),
    usedKem: new Set(), outbox: new Map(),
  } };
}
const alice = endpoint('00000000-0000-4000-8000-000000000001', 1001);
const bob = endpoint('00000000-0000-4000-8000-000000000002', 2002);
alice.state.trusted.set(addressKey(bob.address), copy(bob.state.identity.publicKey.serialize()));
bob.state.trusted.set(addressKey(alice.address), copy(alice.state.identity.publicKey.serialize()));

async function transaction(endpoint, action, abortBeforeCommit = false) {
  const working = cloneState(endpoint.state);
  const result = await action(ports(working), working);
  if (abortBeforeCommit) throw new Error('QA_ABORT_BEFORE_COMMIT');
  endpoint.state = working;
  return result;
}
async function encryptNew(sender, recipient, id, plaintext, abort = false) {
  if (sender.state.outbox.has(id)) throw new Error('QA_DUPLICATE_LOCAL_MESSAGE_ID');
  return transaction(sender, async (store, state) => {
    const encrypted = await sdk.signalEncrypt(plaintext, recipient.address, sender.address, store.sessions, store.identities);
    const entry = { type: encrypted.type(), ciphertext: copy(encrypted.serialize()) };
    state.outbox.set(id, entry);
    return { type: entry.type, ciphertext: copy(entry.ciphertext) };
  }, abort);
}
function retry(sender, id) {
  const entry = sender.state.outbox.get(id);
  if (!entry) throw new Error('QA_OUTBOX_MISSING');
  return { type: entry.type, ciphertext: copy(entry.ciphertext) };
}
async function decrypt(receiver, sender, entry) {
  return transaction(receiver, async store => {
    if (entry.type === sdk.CiphertextMessageType.PreKey) return sdk.signalDecryptPreKey(
      sdk.PreKeySignalMessage.deserialize(copy(entry.ciphertext)), sender.address, receiver.address,
      store.sessions, store.identities, store.prekeys, store.signed, store.kem,
    );
    assert.equal(entry.type, sdk.CiphertextMessageType.Whisper, 'unexpected SDK message type');
    return sdk.signalDecrypt(sdk.SignalMessage.deserialize(copy(entry.ciphertext)), sender.address,
      receiver.address, store.sessions, store.identities);
  });
}
async function check(name, action) {
  await action();
  results.push({ name, status: 'PASS' });
  console.log(`PASS ${name}`);
}
async function rejectionWithoutCommit(endpoint, action) {
  const before = cloneState(endpoint.state);
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  assert.equal(rejected, true, 'operation must reject');
  assert.equal(equalState(before, endpoint.state), true, 'rejected operation changed committed state');
}
const message = index => Buffer.from(`YNX isolated synthetic control ${index}`, 'utf8');

try {
  const curve = sdk.PrivateKey.generate();
  const signedCurve = sdk.PrivateKey.generate();
  const kemPair = sdk.KEMKeyPair.generate();
  const now = Date.now();
  const prekey = sdk.PreKeyRecord.new(11, curve.getPublicKey(), curve);
  const signedKey = sdk.SignedPreKeyRecord.new(12, now, signedCurve.getPublicKey(), signedCurve,
    bob.state.identity.privateKey.sign(signedCurve.getPublicKey().serialize()));
  const kemKey = sdk.KyberPreKeyRecord.new(13, now, kemPair,
    bob.state.identity.privateKey.sign(kemPair.getPublicKey().serialize()));
  bob.state.prekeys.set(11, copy(prekey.serialize()));
  bob.state.signed.set(12, copy(signedKey.serialize()));
  bob.state.kem.set(13, copy(kemKey.serialize()));
  const bundle = sdk.PreKeyBundle.new(2002, 1, 11, prekey.publicKey(), 12, signedKey.publicKey(),
    signedKey.signature(), bob.state.identity.publicKey, 13, kemKey.publicKey(), kemKey.signature());
  await check('official signed KEM prekey bundle establishes sender session', () => transaction(alice,
    store => sdk.processPreKeyBundle(bundle, bob.address, alice.address, store.sessions, store.identities)));
  let initial;
  await check('initial native encryption and recipient decryption', async () => {
    initial = await encryptNew(alice, bob, 'initial', message(0));
    assert.equal(initial.type, sdk.CiphertextMessageType.PreKey);
    assert.equal(Buffer.from(await decrypt(bob, alice, initial)).equals(message(0)), true);
  });
  await check('one-time fixture curve and KEM prekeys consumed', async () => {
    assert.equal(bob.state.prekeys.has(11), false);
    assert.equal(bob.state.kem.has(13), false);
    assert.equal(bob.state.usedKem.size, 1);
  });
  await check('reply establishes ordinary native message exchange', async () => {
    const reply = await encryptNew(bob, alice, 'reply', message(1));
    assert.equal(reply.type, sdk.CiphertextMessageType.Whisper);
    assert.equal(Buffer.from(await decrypt(alice, bob, reply)).equals(message(1)), true);
  });
  await check('replay rejected without committed state mutation', () => rejectionWithoutCommit(bob,
    () => decrypt(bob, alice, initial)));
  const pending = [];
  for (let index = 0; index < 3; index++) pending.push(await encryptNew(alice, bob, `order-${index}`, message(index + 2)));
  await check('tampered ciphertext rejected without committed state mutation', async () => {
    const changed = { ...pending[0], ciphertext: copy(pending[0].ciphertext) };
    changed.ciphertext[changed.ciphertext.length - 1] ^= 1;
    await rejectionWithoutCommit(bob, () => decrypt(bob, alice, changed));
  });
  await check('out-of-order native messages recover through SDK skipped-key handling', async () => {
    for (const index of [2, 0, 1]) assert.equal(Buffer.from(await decrypt(bob, alice, pending[index])).equals(message(index + 2)), true);
  });
  await check('abort after native encryption does not commit ratchet or outbox', () => rejectionWithoutCommit(alice,
    () => encryptNew(alice, bob, 'aborted', message(5), true)));
  let committed;
  await check('subsequent committed encryption remains decryptable after abort', async () => {
    committed = await encryptNew(alice, bob, 'committed', message(6));
    assert.equal(Buffer.from(await decrypt(bob, alice, committed)).equals(message(6)), true);
  });
  await check('retry returns identical ciphertext and does not re-encrypt', async () => {
    const before = cloneState(alice.state);
    const resend = retry(alice, 'committed');
    assert.equal(Buffer.from(resend.ciphertext).equals(Buffer.from(committed.ciphertext)), true);
    assert.equal(equalState(before, alice.state), true);
  });
  await check('same local message ID cannot encrypt different plaintext', () => rejectionWithoutCommit(alice,
    () => encryptNew(alice, bob, 'committed', message(7))));
  await check('wrong device address rejected without committed state mutation', async () => {
    const other = { address: sdk.ProtocolAddress.new(alice.address.name(), 2) };
    await rejectionWithoutCommit(bob, () => decrypt(bob, other, committed));
  });
  await check('bounded repeated bidirectional synthetic control exchange', async () => {
    for (let index = 0; index < 16; index++) {
      const outgoing = await encryptNew(alice, bob, `alice-control-${index}`, message(index + 100));
      assert.equal(Buffer.from(await decrypt(bob, alice, outgoing)).equals(message(index + 100)), true);
      const incoming = await encryptNew(bob, alice, `bob-control-${index}`, message(index + 200));
      assert.equal(Buffer.from(await decrypt(alice, bob, incoming)).equals(message(index + 200)), true);
    }
  });
  const report = {
    observed_at: new Date().toISOString(), sdk: '0.104.0',
    sdk_source_commit: '257105c55a7389ca6b1e85185e2769465e6729f1',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    input: 'Two in-memory dedicated synthetic identities and synthetic control strings only',
    results, passed: results.length,
    public_kem_bundle_encoded_bytes: kemKey.publicKey().serialize().length,
    scope: 'Actual official native addon crypto with cloned in-memory transactional QA callbacks, not a production store',
    limits: ['No original fixed vectors executed', 'No persistent crash/restart or multi-node prekey serving',
      'No independently observed SPQR key-mixture status', 'No native mobile/browser bridge',
      'No AGPL release disposition, independent review, migration, production activation or user acceptance',
      'No wallet/account/private message access or network relay'],
  };
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'session-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`RESULT ${results.length}/${results.length} actual-native-addon checks passed`);
} catch (error) {
  // Do not serialize secret states, private keys or arbitrary native diagnostics.
  console.error(`FAIL after ${results.length} successful checks; ${error?.name ?? 'Error'}`);
  process.exitCode = 1;
}
