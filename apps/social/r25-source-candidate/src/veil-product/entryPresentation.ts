import type {AccountEntryCase} from './accountEntry';
import type {VeilLocalOwnerRead} from './localOwner';

/** Navigation from an observed local lifecycle, never proof of a new identity,
 * key absence, device approval or permission to replace an original operation. */
export function localEntryPresentation(owner: VeilLocalOwnerRead | undefined, intent: AccountEntryCase) {
  if (!owner || owner.status !== 'OBSERVED') return {mode: 'checking', canPrepare: false, showOriginal: false} as const;
  if (owner.ownerState === 'CLOSED' || owner.ownerState === 'CLOSING') return {mode: 'closed', canPrepare: false, showOriginal: false} as const;
  const original = owner.ownerState === 'RECOVERY_PENDING' || owner.localGenesisAttempted || owner.reopenedPendingRows > 0 || owner.pendingTickets > 0 ||
    owner.pendingStoreState === 'RECONCILIATION_REQUIRED' || owner.pendingStoreState === 'UNKNOWN';
  if (original) return {mode: 'retained', canPrepare: false, showOriginal: true} as const;
  const canPrepare = intent === 'newIdentityFirstDevice' && owner.ownerState === 'LOCAL_PENDING' &&
    !owner.failureRetained && owner.queued === 0 &&
    (owner.pendingStoreState === 'FRESH' || owner.pendingStoreState === 'READY');
  return {mode: canPrepare ? 'prepare' : 'unavailable', canPrepare, showOriginal: false} as const;
}
