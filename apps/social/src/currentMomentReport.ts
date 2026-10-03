/** A local current-view guard, never a grant or server authorization receipt. */
export async function runCurrentMomentReport<T>(
  current: () => boolean,
  fingerprint: () => Promise<string>,
  send: (evidenceHash: string) => Promise<T>,
): Promise<T | undefined> {
  if (!current()) return undefined;
  const evidenceHash = await fingerprint();
  if (!current()) return undefined;
  if (!/^[0-9a-f]{64}$/.test(evidenceHash)) throw new Error('Invalid moment report evidence fingerprint');
  const result = await send(evidenceHash);
  // The effect may have committed. A stale view must not render its receipt;
  // this is not cancellation, rollback, or permission to resend the effect.
  return current() ? result : undefined;
}
