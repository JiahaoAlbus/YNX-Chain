export type PublicContentBinding=Readonly<{bytes:string;sha3_512:string;sha512:string}>;
/** Compute both digests from a snapshot of actual returned bytes. This does not
 * verify an expected manifest, signature, source, owner or permission. */
export function bindPublicContentBytes(actual:Uint8Array):PublicContentBinding;
