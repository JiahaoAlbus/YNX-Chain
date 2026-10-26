// One trusted-registry, exact-certificate, strict AND verifier implementation.
import {equalBytes, base64Bytes} from './public-bytes.mjs';
export function createVerifierFactory({wire, copy, tree, selectProvider}) {
  const {requireThat, VERSION, LIMIT, encodeFields, encodeContext, encodeDescriptor,
    decodeCertificate, encodeCertificate, decodeMember, decodeWhole, encodeProof, decodeProof,
    validateMessages, bytes} = wire;
  const {createHasher, buildTree, pathRoot} = tree;
  const token = () => Object.freeze(Object.create(null));
  const signedMessage = (branch, certificate) => encodeFields([VERSION + '/CERT/' + branch, encodeDescriptor(certificate)]);
  function heightValue(n) { requireThat(Number.isSafeInteger(n) && n >= 0, 'execution height required'); return n; }
  function bindTrust(c, r, height) {
    requireThat(r && r.enabled === true && r.algorithmVersion === VERSION, 'inactive/unknown registration');
    requireThat(r.owner === c.owner && r.purpose === c.purpose, 'untrusted owner/purpose');
    for (const [field, n] of [['chainId', 32], ['pkA', 2592], ['pkB', 64]]) {
      requireThat(equalBytes(wire.exact(r[field], n, field), c[field]), 'untrusted ' + field);
    }
    requireThat(typeof r.policyRevision === 'string' && /^[\x20-\x7e]{1,128}$/.test(r.policyRevision), 'policy revision required');
    heightValue(r.activeFrom);
    requireThat(r.revokedAt === null || (Number.isSafeInteger(r.revokedAt) && r.revokedAt >= r.activeFrom), 'revocation height required');
    requireThat(height >= r.activeFrom && (r.revokedAt === null || height < r.revokedAt), 'registration inactive at height');
    // This fingerprint binds all trust fields. It is not an on-chain policy format.
    return encodeFields([r.algorithmVersion, r.chainId, r.owner, r.pkA, r.pkB, r.purpose,
      r.policyRevision, String(r.activeFrom), r.revokedAt === null ? 'none' : String(r.revokedAt)]);
  }

  function createVerifier({chainId, purpose = 'TX-BATCH', resolveTrustedOwner,
    cacheEntries = 8, optimized = true, provider = 'native'}) {
    const implementation = selectProvider(provider); implementation.info();
    const network = copy(wire.exact(chainId, 32, 'trusted chainId'));
    requireThat(typeof resolveTrustedOwner === 'function', 'trusted resolver required');
    requireThat(typeof purpose === 'string' && /^[\x20-\x7e]{1,64}$/.test(purpose), 'trusted purpose required');
    requireThat(Number.isSafeInteger(cacheEntries) && cacheEntries >= 0 && cacheEntries <= 64, 'cache bound 0..64');
    requireThat(typeof optimized === 'boolean', 'invalid optimization flag');
    let handles = new WeakMap(); const cache = new Map(), publicKeys = new Map();
    let signatureChecks = 0, cacheHits = 0, publicKeyImports = 0;
    function current(c, execution) {
      const height = heightValue(execution?.height);
      requireThat(equalBytes(c.chainId, network) && c.purpose === purpose, 'wrong trusted network/purpose');
      const r = resolveTrustedOwner(Object.freeze({chainId: copy(network), owner: c.owner, purpose, height}));
      return bindTrust(c, r, height);
    }
    function authenticateCertificate(certificateWire, execution) {
      try {
        // Full strict parse before expensive public-key import and verification.
        const c = decodeCertificate(certificateWire), frozenWire = encodeCertificate(c), trust = current(c, execution);
        // Exact bytes, not batchId or a single collision-prone digest. Bounded LRU.
        const cacheKey = base64Bytes(frozenWire) + ':' + base64Bytes(trust);
        let state = cache.get(cacheKey);
        if (state) { cache.delete(cacheKey); cache.set(cacheKey, state); cacheHits++; }
        else {
          const publicKeyId = base64Bytes(trust);
          let keys = publicKeys.get(publicKeyId);
          if (!keys) { keys = implementation.importPublic(c); publicKeyImports += 2; }
          signatureChecks += 2;
          const okA = implementation.verify(keys, 'A', signedMessage('A', c), c.sigmaA);
          const okB = implementation.verify(keys, 'B', signedMessage('B', c), c.sigmaB);
          if (!okA || !okB) return null;
          // Refresh after crypto as well; resolver may expose changing state.
          requireThat(equalBytes(current(c, execution), trust), 'registration changed during authentication');
          state = {c, trust, hash: createHasher(encodeContext(c), c.N, optimized, provider)};
          if (cacheEntries > 0) {
            cache.set(cacheKey, state);
            if (cache.size > cacheEntries) cache.delete(cache.keys().next().value);
            publicKeys.delete(publicKeyId); publicKeys.set(publicKeyId, keys);
            if (publicKeys.size > cacheEntries) publicKeys.delete(publicKeys.keys().next().value);
          }
        }
        const handle = token(); handles.set(handle, state); return handle;
      } catch { return null; }
    }
    function verifyMember(handle, member, execution) {
      try {
        const state = handles.get(handle); if (!state) return false;
        const {c, trust, hash} = state;
        requireThat(equalBytes(current(c, execution), trust), 'stale handle');
        // Detached snapshot prevents caller buffers from altering authenticated state.
        const proof = decodeProof(encodeProof(member, c.N), c.N);
        const message = copy(bytes(member.message, 'message', LIMIT.message));
        const okA = equalBytes(pathRoot(hash.A, proof.index, message, proof.pathA), c.rootA);
        const okB = equalBytes(pathRoot(hash.B, proof.index, message, proof.pathB), c.rootB);
        return okA && okB && equalBytes(current(c, execution), trust);
      } catch { return false; }
    }
    function verifyWholeBatch(certificateWire, messages, execution) {
      try {
        const c = decodeCertificate(certificateWire); validateMessages(messages, c.N);
        const snapshot = messages.map(m => copy(m));
        const handle = authenticateCertificate(certificateWire, execution), state = handles.get(handle);
        if (!state) return false;
        const okA = equalBytes(buildTree(state.hash.A, snapshot).at(-1)[0], state.c.rootA);
        const okB = equalBytes(buildTree(state.hash.B, snapshot).at(-1)[0], state.c.rootB);
        return okA && okB && equalBytes(current(state.c, execution), state.trust);
      } catch { return false; }
    }
    return Object.freeze({
      authenticateCertificate, verifyMember, verifyWholeBatch,
      verifyOne(memberWire, execution) {
        try {
          const m = decodeMember(memberWire), h = authenticateCertificate(encodeCertificate(m.certificate), execution);
          return h !== null && verifyMember(h, m, execution);
        } catch { return false; }
      },
      verifyWhole(wholeWire, execution) {
        try { const w = decodeWhole(wholeWire); return verifyWholeBatch(encodeCertificate(w.certificate), w.messages, execution); }
        catch { return false; }
      },
      clear() { cache.clear(); publicKeys.clear(); handles = new WeakMap(); },
      stats() { return Object.freeze({cachedCertificates: cache.size, cachedPublicKeyPairs: publicKeys.size,
        signatureChecks, cacheHits, publicKeyImports}); },
    });
  }

  return createVerifier;
}
