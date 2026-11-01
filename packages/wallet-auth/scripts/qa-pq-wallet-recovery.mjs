// Two separate processes, isolated freshly generated QA keys only. Never uses
// a Wallet profile, a real account, or production registration. No secret output.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomBytes, createHash} from 'node:crypto';
import {createPQWalletKeyHandle, readPQWalletKeyPublic, destroyPQWalletKeyHandle,
  exportPQWalletBackup, restorePQWalletKeyHandle, readPQWalletKeyCleanupOutcome,
  pqWalletKeyCleanupUnresolved} from '../src/pq-wallet-key-backup.js';
import {createPQRecoveryCredential, openPQWalletBackup} from '../src/pq-wallet-backup.js';
const [phase, directory] = process.argv.slice(2);
if (!['generate', 'restore'].includes(phase) || !path.isAbsolute(directory || '')) throw Error('QA_ARGUMENTS_INVALID');
const require = createRequire(new URL('../package.json', import.meta.url));
const protocol = await import(pathToFileURL(require.resolve('@ynx/batch-v01-candidate')).href);
const check = (value, code) => { if (!value) throw Error(code); };
const safeWrite = (name, value) => fs.writeFileSync(path.join(directory, name), value, {flag: 'wx', mode: 0o600});
const result = {phase, runtime: {electron: process.versions.electron ?? null, node: process.versions.node},
  isolatedGeneratedQAKeysOnly: true, productionAccountOrWalletAccessed: false, chainRegistrationVerified: false,
  normalWalletMainExecuted: false};
if (phase === 'generate') {
  fs.mkdirSync(directory, {recursive: false, mode: 0o700});
  const network = {chainId: createHash('sha256').update('YNX isolated Wallet backup QA chain, not a real chain').digest('hex'), owner: 'ynx-isolated-backup-qa-no-chain-account'};
  const handle = await createPQWalletKeyHandle(network);
  try {
    const original = readPQWalletKeyPublic(handle), credential = createPQRecoveryCredential();
    const encrypted = await exportPQWalletBackup(handle, credential);
    safeWrite('backup.bin', encrypted); safeWrite('recovery.credential', credential);
    safeWrite('trusted-original-public.json', JSON.stringify(original));
    // New SDK lifecycle check with actual provider: retire while export's KDF
    // is pending, then require the late encrypted result to remain unavailable.
    const late = exportPQWalletBackup(handle, credential);
    check(destroyPQWalletKeyHandle(handle) === true, 'QA_KEY_RETIRE_FAILED');
    let refused = false;
    try { await late; } catch (e) { refused = e.code === 'PQ_KEY_HANDLE_UNAVAILABLE'; }
    check(refused, 'QA_LATE_BACKUP_ESCAPED');
    check(readPQWalletKeyCleanupOutcome(handle).cleanupComplete === true, 'QA_CLEANUP_INCOMPLETE');
    check(pqWalletKeyCleanupUnresolved() === false, 'QA_CLEANUP_DEBT');
    result.bothKeyBackupCreated = true; result.lateExportAfterRetirementRefused = true;
  } finally { destroyPQWalletKeyHandle(handle); }
} else {
  // The generation process has terminated before this independent invocation.
  // Only these three intentionally transferred recovery/original files are read.
  const wire = new Uint8Array(fs.readFileSync(path.join(directory, 'backup.bin')));
  const credential = fs.readFileSync(path.join(directory, 'recovery.credential'), 'utf8');
  const expected = JSON.parse(fs.readFileSync(path.join(directory, 'trusted-original-public.json'), 'utf8'));
  const handle = await restorePQWalletKeyHandle(wire, credential, expected);
  let material, imported;
  try {
    const actual = readPQWalletKeyPublic(handle);
    check(actual.pkA === expected.pkA && actual.pkB === expected.pkB, 'QA_RESTORED_PUBLIC_KEYS_DIFFER');
    check(actual.owner === expected.owner && actual.chainId === expected.chainId, 'QA_RESTORED_BINDING_DIFFERS');
    // Export the RESTORED handle, not original in-memory keys. This proves the
    // restored secrets can perform the actual two-algorithm signing operation.
    material = await openPQWalletBackup(await exportPQWalletBackup(handle, credential), credential, expected);
    const a = Buffer.from(material.pkcs8A), b = Buffer.from(material.pkcs8B);
    try {
      imported = await protocol.importKeyMaterial({format: 'YNX-BATCH/KEY-MATERIAL/v1', algorithmVersion: expected.protocolVersion,
        suite: expected.suite, pkcs8A: a, pkcs8B: b, pkA: Buffer.from(expected.pkA, 'base64url'), pkB: Buffer.from(expected.pkB, 'base64url')}, {provider: 'portable'});
    } finally { a.fill(0); b.fill(0); }
    const chainId = Buffer.from(expected.chainId, 'hex'), purpose = 'WALLET-RECOVERY-CHECK';
    const signed = protocol.batchSign(imported.privateKey, {chainId, owner: expected.owner, purpose}, [randomBytes(32)]);
    try {
      // This is explicit PUBLIC self-verification against the saved ORIGINAL
      // public keys. It is not a real-chain registry or any transaction permit.
      const verifier = protocol.createVerifier({chainId, purpose, provider: 'portable', resolveTrustedOwner: () => ({
        enabled: true, algorithmVersion: expected.protocolVersion, chainId, owner: expected.owner,
        pkA: Buffer.from(expected.pkA, 'base64url'), pkB: Buffer.from(expected.pkB, 'base64url'), purpose,
        policyRevision: 'isolated-recovery-check-only', activeFrom: 0, revokedAt: null})});
      check(verifier.verifyWhole(signed.wholeWire, {height: 0}) === true, 'QA_RESTORED_DUAL_SIGNATURE_FAILED');
      result.dualPublicKeysMatchTrustedOriginal = true; result.restoredDualSignatureVerified = true;
    } finally { protocol.discardBatch(signed.batch); }
  } finally {
    material?.pkcs8A.fill(0); material?.pkcs8B.fill(0);
    if (imported?.privateKey) protocol.destroyKey(imported.privateKey);
    destroyPQWalletKeyHandle(handle);
  }
}
safeWrite(phase + '-result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
