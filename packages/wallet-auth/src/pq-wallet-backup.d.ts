import type {PQPublicBinding} from './pq-wallet-contract.js';
/** Protected main/vault data. Never send either private component over renderer IPC or log it. */
export interface PQPrivateBackupMaterial {
  binding: PQPublicBinding;
  pkcs8A: Uint8Array;
  pkcs8B: Uint8Array;
}
export interface PQEncryptedBackup {
  readonly format: 'YNX-PQ-WALLET-BACKUP/v1';
  readonly binding: PQPublicBinding;
  readonly kdf: Readonly<{algorithm: 'PBKDF2-HMAC-SHA256'; iterations: 600000; salt: string}>;
  readonly cipher: Readonly<{algorithm: 'AES-256-GCM'; nonce: string}>;
  readonly ciphertext: string;
}
export const PQ_BACKUP_LIMIT: 196608;
/** Fresh independent 256-bit recovery credential. Save separately from the encrypted backup. */
export function createPQRecoveryCredential(): string;
/** Material remains owned by the caller. Internal temporary byte copies are cleared. */
export function sealPQWalletBackup(material: PQPrivateBackupMaterial, credential: string): Promise<Uint8Array>;
/** Untrusted public preview; inspection never establishes registration or authority. */
export function inspectPQWalletBackup(wire: Uint8Array): PQEncryptedBackup;
/** Decrypts both materials atomically. Does NOT import keys, prove possession, or grant access.
 * expectedBinding must come from the caller's trusted original/on-chain source, not the file preview.
 * A subsequent restore must import both keys with the sole protocol provider, recompute and match
 * both public keys and current registration, and only then adopt the protected handle. */
export function openPQWalletBackup(wire: Uint8Array, credential: string, expectedBinding: PQPublicBinding): Promise<PQPrivateBackupMaterial>;
