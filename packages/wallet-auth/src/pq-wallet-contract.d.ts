/** Public data only. A validated binding is not proof of chain registration or signing authority. */
export interface PQPublicBinding {
  readonly protocolVersion: 'YNX-BATCH/v0.1';
  readonly suite: 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
  /** Original chain identity, exactly 32 bytes encoded as 64 lowercase hexadecimal characters. */
  readonly chainId: string;
  /** Original account/address, not an address derived from the new keys. */
  readonly owner: string;
  /** Full ML-DSA-87 public key, 2592 bytes in canonical unpadded base64url. */
  readonly pkA: string;
  /** Full SLH-DSA-SHA2-256f public key, 64 bytes in canonical unpadded base64url. */
  readonly pkB: string;
}
export const PQ_PROTOCOL_VERSION: PQPublicBinding['protocolVersion'];
export const PQ_SUITE: PQPublicBinding['suite'];
export const PQ_BACKUP_FORMAT: 'YNX-PQ-WALLET-BACKUP/v1';
export const PQ_PRIVATE_FORMAT: 'YNX-PQ-WALLET-PRIVATE/v1';
export const PQ_BINDING_FIELDS: readonly (keyof PQPublicBinding)[];
export function validatePQPublicBinding(value: unknown): Readonly<PQPublicBinding>;
export function validatePQNetworkBinding(value: unknown): Readonly<{chainId: string; owner: string}>;
export function assertPQPublicBindingMatches(actual: unknown, expected: unknown): Readonly<PQPublicBinding>;
export function pqBase64url(bytes: Uint8Array): string;
export function pqDecodeBase64url(text: string, limits?: {exact?: number; max?: number}): Uint8Array;
