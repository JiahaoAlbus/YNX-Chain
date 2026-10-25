// Test-only public fixture and assertions shared by Node and a real browser.
// No private material is serialized; this module needs no runtime polyfills.
const fixtureSchema = 'ynx-batch-browser-public-test-vector/v1';
const execution = Object.freeze({height: 7});
const ordinaryBytes = value => Uint8Array.from(value);
const publicJSON = value => value instanceof Uint8Array ? Array.from(value)
  : Array.isArray(value) ? value.map(publicJSON)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, publicJSON(v)])) : value;

// Invoked only by the Node test driver with its original native signer.
export function makePublicFixture(native, fromBytes) {
  const keys = native.keyGen(); let signed;
  try {
    const metadata = {chainId: fromBytes(Array(32).fill(0xa7)), owner: 'ynx-browser-test-only-owner', purpose: 'TX-BATCH'};
    const messages = [fromBytes([0, 255, 128, 1, 89, 78, 88]), fromBytes([])];
    signed = native.batchSign(keys.privateKey, metadata, messages);
    return publicJSON({schema: fixtureSchema, certificateWire: signed.certificateWire, wholeWire: signed.wholeWire,
      memberWires: messages.map((_, i) => native.encodeMember(native.extract(signed.batch, i)))});
  } finally {
    if (signed) native.discardBatch(signed.batch);
    native.destroyKey(keys.privateKey);
  }
}

export function runVerificationVectors(api, fixture, {fromBytes = ordinaryBytes, publicBoundary = false,
  sharedBytes = size => new Uint8Array(new SharedArrayBuffer(size)), requireSharedArrayBuffer = true} = {}) {
  let checks = 0; const cases = [];
  const check = (condition, label) => { checks++; if (!condition) throw Error(label); };
  const equal = (actual, expected, label) => check(actual === expected, label + ': ' + String(actual));
  const sameBytes = (actual, expected, label) => check(actual instanceof Uint8Array && actual.length === expected.length &&
    actual.every((b, i) => b === expected[i]), label);
  const rejects = (fn, label) => {
    let error; try { fn(); } catch (caught) { error = caught; }
    check(error?.code === 'ERR_YNX_BATCH', label);
  };
  const run = (name, fn) => { fn(); cases.push(name); };
  check(fixture?.schema === fixtureSchema, 'public fixture schema');
  check(JSON.stringify(Object.keys(fixture).sort()) === JSON.stringify(['certificateWire', 'memberWires', 'schema', 'wholeWire']),
    'fixture contains only public wires');
  const certificateWire = fromBytes(fixture.certificateWire), wholeWire = fromBytes(fixture.wholeWire);
  const memberWires = fixture.memberWires.map(fromBytes);
  const certificate = () => api.decodeCertificate(fromBytes(fixture.certificateWire));
  const record = (overrides = {}) => {
    const c = certificate();
    return {algorithmVersion: api.VERSION, chainId: fromBytes(c.chainId), owner: c.owner, purpose: c.purpose,
      pkA: fromBytes(c.pkA), pkB: fromBytes(c.pkB), enabled: true, policyRevision: 'BROWSER-TEST-ONLY-1',
      activeFrom: 3, revokedAt: null, ...overrides};
  };
  const verifier = (overrides = {}) => api.createVerifier({chainId: fromBytes(certificate().chainId),
    resolveTrustedOwner: () => record(), ...overrides});
  const member = index => api.decodeMember(fromBytes(fixture.memberWires[index]));
  const changed = (field, value) => {
    const c = certificate(); if (value === undefined) c[field][0] ^= 1; else c[field] = value;
    return api.encodeCertificate(c);
  };
  const append = input => { const out = fromBytes(Array(input.length + 1).fill(0)); out.set(input); return out; };

  run('exact native wire grammar and detached byte outputs', () => {
    const c = certificate(), whole = api.decodeWhole(wholeWire);
    equal(c.N, 2, 'two messages'); equal(whole.messages.length, 2, 'whole count');
    equal(whole.messages[1].length, 0, 'empty second message');
    sameBytes(api.encodeCertificate(c), certificateWire, 'certificate round trip');
    sameBytes(api.encodeWhole(whole.certificate, whole.messages), wholeWire, 'whole round trip');
    sameBytes(api.encodeContext(api.decodeContext(api.encodeContext(c))), api.encodeContext(c), 'context round trip');
    sameBytes(api.encodeDescriptor(api.decodeDescriptor(api.encodeDescriptor(c))), api.encodeDescriptor(c), 'descriptor round trip');
    sameBytes(api.u32(0x01020304), [1, 2, 3, 4], 'network byte order');
    for (const [i, wire] of memberWires.entries()) {
      const m = api.decodeMember(wire);
      equal(m.index, i, 'member index'); equal(m.pathA.length, 1, 'A depth'); equal(m.pathB.length, 1, 'B depth');
      sameBytes(api.encodeMember(m), wire, 'member round trip');
      const proof = api.encodeProof(m, c.N);
      sameBytes(api.encodeProof(api.decodeProof(proof, c.N), c.N), proof, 'proof round trip');
    }
    c.pkA.fill(0); c.chainId.fill(0);
    sameBytes(api.encodeCertificate(certificate()), certificateWire, 'decoder copies external wire');
    if (publicBoundary) {
      const visit = value => {
        if (value instanceof Uint8Array) check(Object.getPrototypeOf(value) === Uint8Array.prototype, 'ordinary Uint8Array output');
        else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      visit(whole); visit(member(0)); visit(api.encodeCertificate(certificate()));
    }
  });

  run('both tree modes authenticate the native pair and both members', () => {
    for (const optimized of [false, true]) {
      const v = verifier({optimized});
      equal(v.verifyWhole(wholeWire, execution), true, 'whole/native signature pair');
      equal(v.verifyOne(memberWires[0], execution), true, 'first member');
      equal(v.verifyOne(memberWires[1], execution), true, 'empty member');
      const handle = v.authenticateCertificate(certificateWire, execution);
      check(handle !== null && typeof handle === 'object', 'opaque certificate handle');
      equal(v.verifyMember(handle, member(0), execution), true, 'handle member');
      equal(v.stats().signatureChecks, 2, 'one full pair before success cache');
      equal(v.stats().cachedCertificates, 1, 'one certificate');
      equal(v.stats().cachedPublicKeyPairs, 1, 'one public pair');
      equal(v.stats().publicKeyImports, 2, 'both public keys imported');
    }
  });

  run('either signature, root or bound identity fails closed', () => {
    const v = verifier();
    check(v.authenticateCertificate(certificateWire, execution) !== null, 'warm exact certificate success cache');
    for (const field of ['sigmaA', 'sigmaB', 'rootA', 'rootB', 'batchId', 'pkA', 'pkB', 'chainId']) {
      equal(v.authenticateCertificate(changed(field), execution), null, 'reject changed ' + field);
      equal(v.stats().cachedCertificates, 1, 'failure never cached or confused with warm certificate: ' + field);
      equal(v.stats().cacheHits, 0, 'altered bytes cannot hit certificate cache: ' + field);
    }
    for (const [field, value] of [['owner', 'another-test-owner'], ['purpose', 'REGISTER'], ['N', 1]])
      equal(v.authenticateCertificate(changed(field, value), execution), null, 'reject changed ' + field);
    equal(v.authenticateCertificate(certificateWire, execution) !== null, true, 'untampered pair remains valid');
  });

  run('both membership paths and message/index bind to the certificate', () => {
    const v = verifier(), h = v.authenticateCertificate(certificateWire, execution);
    for (const mutate of [m => m.pathA[0][0] ^= 1, m => m.pathB[0][0] ^= 1, m => m.message[0] ^= 1,
      m => m.index = 1, m => m.index = -1, m => m.pathA.pop(), m => m.pathB.pop()]) {
      const m = member(0); mutate(m); equal(v.verifyMember(h, m, execution), false, 'reject altered member');
    }
    const original = api.decodeWhole(wholeWire).messages;
    for (const messages of [[original[1], original[0]], [original[0]], [fromBytes([1]), original[1]]])
      equal(v.verifyWholeBatch(certificateWire, messages, execution), false, 'reject altered complete message list');
    equal(v.verifyMember(h, member(0), execution), true, 'tampering did not poison state');
  });

  run('strict frames reject trailing bytes, truncation and invalid field counts', () => {
    const v = verifier();
    for (const [wire, decode, verify] of [[certificateWire, api.decodeCertificate, w => v.authenticateCertificate(w, execution)],
      [wholeWire, api.decodeWhole, w => v.verifyWhole(w, execution)], [memberWires[0], api.decodeMember, w => v.verifyOne(w, execution)]]) {
      for (const bad of [append(wire), fromBytes(wire.subarray(0, wire.length - 1)), fromBytes([255, 255, 255, 255])]) {
        rejects(() => decode(bad), 'strict parse rejected malformed frame');
        const result = verify(bad); check(result === null || result === false, 'malformed verification fails closed');
      }
    }
    equal(v.stats().signatureChecks, 0, 'malformed wires rejected before crypto');
  });

  run('execution height and synchronous trust are required', () => {
    for (const resolveTrustedOwner of [() => null, () => Promise.resolve(record()), () => { throw Error('test resolver unavailable'); },
      () => record({policyRevision: undefined}), () => record({enabled: false}), () => record({revokedAt: 7}), () => record({activeFrom: 8})]) {
      const v = verifier({resolveTrustedOwner});
      equal(v.authenticateCertificate(certificateWire, execution), null, 'invalid trust rejected');
      equal(v.stats().signatureChecks, 0, 'trust rejected before crypto');
    }
    const v = verifier();
    for (const at of [undefined, {}, {height: -1}, {height: 1.5}, {height: Number.MAX_SAFE_INTEGER + 1}, {height: 2}]) {
      equal(v.authenticateCertificate(certificateWire, at), null, 'invalid/inactive execution height');
      equal(v.verifyWhole(wholeWire, at), false, 'whole needs execution height');
    }
    const end = verifier({resolveTrustedOwner: () => record({revokedAt: 8})});
    equal(end.verifyOne(memberWires[0], execution), true, 'height before revocation');
    equal(end.verifyOne(memberWires[0], {height: 8}), false, 'revocation is exclusive upper bound');
  });

  run('resolver is rechecked after crypto and receives a detached frozen query', () => {
    let calls = 0;
    const changing = verifier({resolveTrustedOwner: () => record({enabled: ++calls === 1})});
    equal(changing.authenticateCertificate(certificateWire, execution), null, 'trust changed during pair verification');
    equal(changing.stats().cachedCertificates, 0, 'changing trust not cached');
    const seen = [];
    const detached = verifier({resolveTrustedOwner: query => {
      check(Object.isFrozen(query), 'frozen resolver query'); equal(query.height, 7, 'resolver execution height');
      seen.push(Array.from(query.chainId)); query.chainId.fill(0); return record();
    }});
    equal(detached.verifyOne(memberWires[0], execution), true, 'query mutation cannot alter network binding');
    check(seen.length >= 3 && seen.every(chain => chain.every(x => x === 0xa7)), 'every resolver query owns chain snapshot');
    let changeOnSecond = false, reads = 0;
    const duringPaths = verifier({resolveTrustedOwner: () => record({enabled: !changeOnSecond || ++reads === 1})});
    const handle = duringPaths.authenticateCertificate(certificateWire, execution);
    check(handle !== null, 'handle before live change'); changeOnSecond = true;
    equal(duringPaths.verifyMember(handle, member(0), execution), false, 'trust rechecked after both membership paths');
    reads = 0;
    equal(duringPaths.verifyWhole(wholeWire, execution), false, 'trust rechecked after both complete trees with cached certificate');
  });

  run('authenticated snapshots and opaque handles remain verifier local', () => {
    const v = verifier(), mutable = fromBytes(fixture.certificateWire);
    const handle = v.authenticateCertificate(mutable, execution); check(handle !== null, 'snapshot handle');
    mutable.fill(0);
    equal(v.verifyMember(handle, member(0), execution), true, 'mutating input wire cannot change authenticated state');
    equal(verifier().verifyMember(handle, member(0), execution), false, 'handle is local to its verifier');
    const untrusted = member(0); untrusted.message.fill(0); untrusted.pathA[0].fill(0); untrusted.pathB[0].fill(0);
    equal(v.verifyMember(handle, untrusted, execution), false, 'mutated member rejected');
    equal(v.verifyMember(handle, member(0), execution), true, 'mutated member cannot poison handle');
  });

  run('policy revision and revocation invalidate cached handles', () => {
    let r = record(); const v = verifier({resolveTrustedOwner: () => r});
    const old = v.authenticateCertificate(certificateWire, execution);
    check(old !== null, 'original handle');
    r = record({policyRevision: 'BROWSER-TEST-ONLY-2'});
    equal(v.verifyMember(old, member(0), execution), false, 'old policy handle rejected');
    const fresh = v.authenticateCertificate(certificateWire, execution);
    check(fresh !== null, 'new policy authenticates full pair');
    equal(v.stats().signatureChecks, 4, 'policy revision bypasses old success cache');
    equal(v.verifyMember(fresh, member(0), execution), true, 'new policy member');
    for (const change of [{enabled: false}, {revokedAt: 7}, {activeFrom: 8}, {pkA: fromBytes(Array(2592).fill(0))},
      {pkB: fromBytes(Array(64).fill(0))}]) {
      r = record({...change, policyRevision: 'BROWSER-TEST-ONLY-2'});
      equal(v.verifyMember(fresh, member(0), execution), false, 'live policy change rejects cached handle');
      equal(v.authenticateCertificate(certificateWire, execution), null, 'live policy change rejects cache lookup');
    }
  });

  run('success-only bounded cache, zero cache and clear retain semantics', () => {
    let revision = 'LRU-1'; const v = verifier({cacheEntries: 1, resolveTrustedOwner: () => record({policyRevision: revision})});
    const first = v.authenticateCertificate(certificateWire, execution);
    check(first !== null, 'first LRU handle');
    check(v.authenticateCertificate(certificateWire, execution) !== null, 'LRU hit');
    equal(v.stats().signatureChecks, 2, 'LRU cache avoids repeated pair'); equal(v.stats().cacheHits, 1, 'one cache hit');
    revision = 'LRU-2'; check(v.authenticateCertificate(certificateWire, execution) !== null, 'new policy cache entry');
    equal(v.stats().cachedCertificates, 1, 'certificate LRU bound'); equal(v.stats().cachedPublicKeyPairs, 1, 'public pair LRU bound');
    revision = 'LRU-1'; check(v.authenticateCertificate(certificateWire, execution) !== null, 'evicted policy reauthenticated');
    equal(v.stats().signatureChecks, 6, 'eviction requires full pair');
    v.clear(); equal(v.stats().cachedCertificates, 0, 'clear certificate cache'); equal(v.stats().cachedPublicKeyPairs, 0, 'clear key cache');
    equal(v.verifyMember(first, member(0), execution), false, 'clear invalidates handles');
    equal(v.verifyMember({verified: true}, member(0), execution), false, 'forged handle rejected');
    const none = verifier({cacheEntries: 0});
    check(none.authenticateCertificate(certificateWire, execution) !== null, 'zero cache first');
    check(none.authenticateCertificate(certificateWire, execution) !== null, 'zero cache second');
    equal(none.stats().signatureChecks, 4, 'zero cache repeats full pair'); equal(none.stats().publicKeyImports, 4, 'zero cache repeats imports');
    equal(none.stats().cachedCertificates, 0, 'zero cache certificate count'); equal(none.stats().cachedPublicKeyPairs, 0, 'zero cache key count');
    for (const cacheEntries of [-1, 65, 1.5]) rejects(() => verifier({cacheEntries}), 'invalid cache bound');
    rejects(() => verifier({optimized: 1}), 'optimization must be boolean');
  });

  run('shared backing stores fail closed without reaching crypto', () => {
    if (requireSharedArrayBuffer) check(typeof SharedArrayBuffer === 'function', 'SharedArrayBuffer available for real negative case');
    if (typeof SharedArrayBuffer !== 'function') return;
    const shared = sharedBytes(certificateWire.length); shared.set(certificateWire);
    rejects(() => api.decodeCertificate(shared), 'shared certificate rejected');
    const v = verifier(); equal(v.authenticateCertificate(shared, execution), null, 'shared wire authentication rejected');
    equal(v.stats().signatureChecks, 0, 'shared wire rejected before crypto');
    const c = certificate(); c.chainId = sharedBytes(32); c.chainId.fill(0xa7);
    rejects(() => api.encodeContext(c), 'shared context rejected');
    rejects(() => api.validateMessages([sharedBytes(0), fromBytes([])]), 'shared message rejected');
  });

  if (publicBoundary) run('browser public surface exposes no signer or provider switch', () => {
    for (const name of ['keyGen', 'KeyGen', 'batchSign', 'BatchSign', 'extract', 'Extract', 'destroyKey', 'discardBatch',
      'importKeyMaterial', 'exportKeyMaterial', 'KEY_MATERIAL_FORMAT', 'nativeProvider', 'portableProvider', 'providerInfo'])
      equal(name in api, false, 'no private/runtime export ' + name);
    rejects(() => verifier({provider: 'native'}), 'no native provider selection');
    const info = api.browserProviderInfo();
    equal(info.provider, 'noble-public', 'explicit public provider'); equal(info.verificationOnly, true, 'verification only');
    equal(info.dependencyVersionVerified, false, 'runtime does not invent package version verification');
    equal(info.releaseDependencies['@noble/post-quantum'], '0.6.1', 'release PQ dependency');
    equal(info.releaseDependencies['@noble/hashes'], '2.2.0', 'release hash dependency');
    equal(JSON.stringify(info.algorithms), JSON.stringify(['ML-DSA-87', 'SLH-DSA-SHA2-256f']), 'full AND algorithm pair');
    equal(info.runtime.environment, 'javascript-esm', 'ESM environment'); equal(info.runtime.dependencyVersions, 'not-observable', 'runtime version boundary');
    equal(info.runtime.loadedModuleIntegrity, 'release-loader-responsibility', 'loader integrity boundary');
    for (const item of [info, info.algorithms, info.releaseDependencies, info.runtime]) check(Object.isFrozen(item), 'metadata snapshot frozen');
    for (const value of [[], new ArrayBuffer(4), new DataView(new ArrayBuffer(4))]) rejects(() => api.bytes(value), 'only byte arrays accepted');
  });
  return Object.freeze({schema: 'ynx-batch-browser-verification-results/v1', checks, cases: Object.freeze(cases)});
}
