import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVerifier, decodeMember, decodeWhole} from '@ynx/batch-v01-candidate';
import {createPQWalletKeyHandle, readPQWalletKeyPublic, destroyPQWalletKeyHandle,
  signPQWalletNativeTransfer, createPQWalletMigrationPossession, signPQWalletCurrentMigration} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys, encodePQMigrationRequest} from '../src/pq-wallet-authorization.js';
import {parsePQAccountAuthorization, assertPQMigrationRequestPolicy} from '../src/pq-wallet-policy.js';
// Fresh isolated QA keys + explicit synthetic policy. This is actual SDK crypto
// wiring, NOT real chain registration, a user approval or migration execution.
test('typed SDK signs only registered pair and exact N1 domains, with no classic co-signature or raw signer', async () => {
  const network = {chainId: '71'.repeat(32), owner: '0x' + '11'.repeat(20)}, height = '9007199254740993';
  const current = await createPQWalletKeyHandle(network), proposed = await createPQWalletKeyHandle(network);
  try {
    const oldKeys = pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(current));
    const newKeys = pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(proposed));
    const dto = {owner: network.owner, executionHeight: height, ledgerNonce: height, algorithmVersion: 'YNX-BATCH/v0.1', enabled: true,
      policyVersion: 'YNX-ACCOUNT-POLICY/v1', networkId: network.chainId, enableAt: '10', activeRevision: '1',
      records: [{algorithmVersion: oldKeys.algorithmVersion, owner: network.owner, pkA: oldKeys.pkA, pkB: oldKeys.pkB, revision: '1', registeredAt: '10', activeFrom: '20', ledgerNonce: '1'}]};
    const snapshot = parsePQAccountAuthorization(dto, {...network, nativeChainId: '6423'});
    const transfer = {chainId: network.chainId, nativeChainId: '6423', from: network.owner, to: '0x' + '22'.repeat(20), amount: '3', fee: '1', nonce: '9007199254740994'};
    const signed = signPQWalletNativeTransfer(current, transfer, snapshot);
    const member = decodeMember(Buffer.from(signed.body));
    assert.equal(member.certificate.N, 1); assert.equal(member.certificate.purpose, 'TX-BATCH');
    const verifier = (keys, purpose) => createVerifier({provider: 'portable', chainId: Buffer.from(network.chainId, 'hex'), purpose, resolveTrustedOwner: () => ({
      algorithmVersion: 'YNX-BATCH/v0.1', enabled: true, owner: network.owner, chainId: Buffer.from(network.chainId, 'hex'),
      pkA: Buffer.from(keys.pkA, 'hex'), pkB: Buffer.from(keys.pkB, 'hex'), purpose, policyRevision: 'isolated-source-wiring-only', activeFrom: 0, revokedAt: null})});
    assert.equal(verifier(oldKeys, 'TX-BATCH').verifyOne(Buffer.from(signed.body), {height: 0}), true);
    assert.throws(() => signPQWalletNativeTransfer(proposed, transfer, snapshot), {code: 'PQ_CURRENT_REGISTERED_KEY_MISMATCH'});
    const intent = {...newKeys, priorRevision: '1', newRevision: '2', ledgerNonce: transfer.nonce, activateAt: '9007199254741024'};
    const newWhole = createPQWalletMigrationPossession(proposed, intent);
    const oldMember = signPQWalletCurrentMigration(current, intent, snapshot);
    assert.equal(decodeWhole(Buffer.from(newWhole)).certificate.N, 1);
    assert.equal(verifier(newKeys, 'ACCOUNT-MIGRATION').verifyWhole(Buffer.from(newWhole), {height: 0}), true);
    assert.equal(verifier(oldKeys, 'ACCOUNT-MIGRATION').verifyOne(Buffer.from(oldMember), {height: 0}), true);
    const wire = encodePQMigrationRequest({intent, classicPublicKey: Buffer.alloc(0), classicSignature: Buffer.alloc(0), currentPQMember: oldMember, newKeyWholeProof: newWhole});
    assert.equal(assertPQMigrationRequestPolicy(snapshot, wire).policy.mode, 'pq');
    assert.throws(() => createPQWalletMigrationPossession(current, intent), {code: 'PQ_CURRENT_REGISTERED_KEY_MISMATCH'});
    destroyPQWalletKeyHandle(current);
    assert.throws(() => signPQWalletNativeTransfer(current, transfer, snapshot), {code: 'PQ_KEY_HANDLE_UNAVAILABLE'});
  } finally { destroyPQWalletKeyHandle(current); destroyPQWalletKeyHandle(proposed); }
});
