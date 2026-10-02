// Every Docs editor sharing this storage namespace must use the same Web Lock.
// A storage read followed by a write is not a cross-tab compare-and-swap.
export function withDocsPendingLock(environment, key, callback) {
  if (!environment.navigator?.locks?.request) {
    const error = new Error('Atomic pending-operation locking is unavailable. Keep the draft and use a supported secure browser.');
    error.code = 'PENDING_LOCK_UNAVAILABLE';
    throw error;
  }
  return environment.navigator.locks.request(`ynx.docs.pending:${key}`, {mode: 'exclusive'}, callback);
}
