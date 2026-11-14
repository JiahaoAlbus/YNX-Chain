import { decodeExecuteReply, decodeSnapshotReply, isProductMutation, ownProductCommand, type VeilCallContext } from './productBoundary';
import { productActionDisabled, validateProductCommand, type VeilProductCommand, type VeilProductErrorCode, type VeilProductResult, type VeilProductSnapshot } from './productModel';

export type VeilPendingOriginal = Readonly<{
  accountViewRef: string; viewRevision: string; localCallId: number;
  action: VeilProductCommand['type']; command: VeilProductCommand;
  draftRevision: number | null;
  originalOperationRef: string | null; disposition: 'queued' | 'unknown';
  resolution: 'unresolved' | 'confirmed' | 'aborted';
  nextStep: 'review-only' | 'none' | 'new-draft';
}>;
const maxPending = 128;
// Reclaim only terminal UI bookkeeping, never an unresolved or blocked original.
// Native persistence and the fresh-read requirement remain unchanged.
const reusablePendingSlot = (item: VeilPendingOriginal) =>
  (item.resolution === 'confirmed' && item.nextStep === 'none') ||
  (item.resolution === 'aborted' && item.nextStep === 'new-draft');
export function retainPendingOriginals(current: readonly VeilPendingOriginal[], entry: VeilPendingOriginal): readonly VeilPendingOriginal[] {
  const owned = Object.freeze({ ...entry, command: ownProductCommand(entry.command) });
  const same = current.find(item => item.accountViewRef === owned.accountViewRef && (item.localCallId === owned.localCallId || (owned.originalOperationRef !== null && item.originalOperationRef === owned.originalOperationRef)));
  if (same) {
    if (JSON.stringify(same.command) !== JSON.stringify(owned.command) || same.localCallId !== owned.localCallId ||
      same.viewRevision !== owned.viewRevision || same.action !== owned.action || same.draftRevision !== owned.draftRevision ||
      (owned.originalOperationRef !== null && same.originalOperationRef !== owned.originalOperationRef)) throw new Error('VEIL_PENDING_ASSOCIATION_INVALID');
    // An invalidation has no new receipt. Never erase a reference already
    // captured from this exact original flight before its finally/release.
    // Uncertainty is monotone for that unresolved original, even when its
    // reference was captured before invalidation. Never restore queued here.
    if (same.resolution === 'unresolved' && owned.disposition === 'unknown' && same.disposition !== 'unknown') {
      return Object.freeze(current.map(item => item === same ? Object.freeze({...item, disposition: 'unknown' as const}) : item));
    }
    return current;
  }
  let retained = current;
  if (current.length >= maxPending) {
    const reusable = current.findIndex(reusablePendingSlot);
    if (current.length !== maxPending || reusable < 0) throw new Error('VEIL_PENDING_BUDGET_EXCEEDED');
    retained = current.filter((_, index) => index !== reusable);
  }
  return Object.freeze([...retained, owned]);
}
export function settlePendingOriginal(current: readonly VeilPendingOriginal[], account: string, result: Extract<VeilProductResult, { kind: 'originalReview' }>): readonly VeilPendingOriginal[] {
  if (result.resolution === 'unresolved') return current;
  return Object.freeze(current.map(item => item.accountViewRef === account && item.originalOperationRef === result.originalOperationRef && item.resolution === 'unresolved'
    ? Object.freeze({ ...item, resolution: result.resolution, nextStep: result.nextStep }) : item));
}
export type VeilAdmission = Readonly<{ context: VeilCallContext; command: VeilProductCommand | null; draftRevision: number | null }>;
export type VeilControllerState = Readonly<{
  snapshot: VeilProductSnapshot | null; busy: boolean; epoch: number; active: boolean;
  needsRead: boolean; pending: readonly VeilPendingOriginal[];
  error: VeilProductErrorCode | null;
}>;
const scope = (snapshot: VeilProductSnapshot | null) => snapshot?.kind === 'AUTHORIZED' || snapshot?.kind === 'RECOVERY_REQUIRED' ? snapshot : null;

/** Mechanical UI admission/ownership only. No injected/native success provider.
 * Raw completions are only accepted through bounded decoders. The root calls
 * its source-owned native consumer separately; this class issues no authority.
 */
export class VeilProductController {
  private state: VeilControllerState = Object.freeze({ snapshot: null, busy: false, epoch: 1, active: false, needsRead: true, pending: Object.freeze([]), error: null });
  private admission: VeilAdmission | null = null;
  private sequence = 0;
  private selection: Readonly<{ account: string; view: string; conversation: string; reference: string }> | null = null;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<VeilControllerState>) {
    const published = Object.freeze({ ...this.state, ...patch });
    this.state = published;
    // Observers do not own native admission or its result. A broken render
    // listener cannot strand a flight, rewrite an outcome or skip release.
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Keep the original state and operation. */ }
    }
    return this.state === published;
  }
  activate() { this.invalidateState(true); }
  deactivate() { this.invalidateState(false); }
  invalidate() { this.invalidateState(this.state.active); }
  private invalidateState(active: boolean) {
    // Losing the view is not evidence that an admitted mutation did not run.
    const pending = this.admission ? this.pendingFor(this.admission, null, 'unknown') : this.state.pending;
    this.selection = null;
    // An invalidated old call keeps admission until its own finally. Native
    // overlap is never enabled by invalidation, remount or a UI revision change.
    // Publish the cleared view and retained original in the same transition.
    this.update({ active, pending, snapshot: null, epoch: this.state.epoch + 1, needsRead: true, error: null });
  }
  canExecute(action: VeilProductCommand['type']): boolean {
    if (!this.state.active || this.state.needsRead || this.admission || productActionDisabled(this.state.snapshot, action)) return false;
    const account = scope(this.state.snapshot)?.accountViewRef;
    if (!account) return false;
    if (!['openConversation', 'searchLocalMessages', 'viewStoredMessage', 'markConversationRead', 'loadDraft', 'selectAttachment', 'openAttachment', 'reviewRecovery'].includes(action) && this.state.pending.some(item => item.accountViewRef === account && (item.resolution === 'unresolved' || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')))) return false;
    return this.state.pending.length < maxPending ||
      (this.state.pending.length === maxPending && this.state.pending.some(reusablePendingSlot)) ||
      ['openConversation', 'searchLocalMessages', 'viewStoredMessage', 'markConversationRead', 'loadDraft', 'selectAttachment', 'openAttachment', 'reviewRecovery'].includes(action);
  }
  private take(command: VeilProductCommand | null, draftRevision: number | null = null): VeilAdmission | null {
    if (!this.state.active || this.admission || this.sequence >= Number.MAX_SAFE_INTEGER || this.state.epoch >= Number.MAX_SAFE_INTEGER) return null;
    const current = scope(this.state.snapshot);
    const context: VeilCallContext = Object.freeze({ callId: ++this.sequence, epoch: this.state.epoch, action: command?.type ?? 'readSnapshot', accountViewRef: current?.accountViewRef ?? null, viewRevision: current?.viewRevision ?? null });
    const lease: VeilAdmission = Object.freeze({ context, command: command ? ownProductCommand(command) : null, draftRevision });
    this.admission = lease;
    this.update({ busy: true, error: null });
    return lease;
  }
  beginRead(): VeilAdmission | null { return this.take(null); }
  beginExecute(command: VeilProductCommand, draftRevision: number | null = null): VeilAdmission | null {
    if (!this.canExecute(command.type)) return null;
    const view = scope(this.state.snapshot);
    if (!view || validateProductCommand(command)) { this.update({ error: 'INPUT_INVALID' }); return null; }
    if (command.type === 'reviewRecovery') {
      const nativeItems = view.kind === 'AUTHORIZED' ? view.recoveries : view.items;
      if (!nativeItems.some(item => item.originalOperationRef === command.originalOperationRef && item.state !== 'resolved') && !this.state.pending.some(item => item.accountViewRef === view.accountViewRef && item.originalOperationRef === command.originalOperationRef && (item.resolution === 'unresolved' || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')))) return null;
    } else {
      if (view.kind !== 'AUTHORIZED' || command.viewRevision !== view.viewRevision) { this.update({ error: 'STALE_VIEW' }); return null; }
      if ('conversationId' in command) {
        if (!view.conversations.some(item => item.id === command.conversationId) || (!['openConversation', 'viewStoredMessage'].includes(command.type) && view.activeConversationId !== command.conversationId)) return null;
      }
      if (command.type === 'markConversationRead' && (view.messageWindow.mode !== 'latest' || view.activeConversationId !== command.conversationId || !view.messages.some(item => item.id === command.throughMessageId && item.conversationId === command.conversationId))) return null;
      if (command.type === 'sendMessage' && command.replyToMessageId !== null && !view.messages.some(item => item.id === command.replyToMessageId && item.conversationId === command.conversationId && item.submission === 'confirmed')) return null;
      if (command.type === 'sendAttachment' && (!this.selection || this.selection.account !== view.accountViewRef || this.selection.view !== view.viewRevision || this.selection.conversation !== command.conversationId || this.selection.reference !== command.selectionReference)) return null;
      if (command.type === 'openAttachment' && !view.messages.some(item => item.id === command.messageId && item.conversationId === command.conversationId && item.attachments.some(attachment => attachment.reference === command.attachmentReference))) return null;
      if ((command.type === 'acceptContact' || command.type === 'rejectContact') && !view.contactRequests.some(item => item.id === command.requestId && item.direction === 'incoming')) return null;
      // Read-model membership is only UI admission. The native path must still
      // recheck the SAME signed ContactRelease, actor, relation CAS and current.
      if (command.type === 'blockContact' && (!view.contacts.some(item => item.peerAccountId === command.peerAccountId) && !view.contactRequests.some(item => item.peerAccountId === command.peerAccountId))) return null;
      if (command.type === 'unblockContact' && !view.blockedContacts.some(item => item.peerAccountId === command.peerAccountId)) return null;
      if (command.type === 'publishMoment' && !view.audiences.some(item => item.id === command.audienceId)) return null;
      if (command.type === 'reviewDevice' && !view.devices.some(item => item.id === command.deviceId && item.state !== 'revoked')) return null;
      if (command.type === 'setLocalAi' && view.localAi === 'unsupported') return null;
    }
    return this.take(command, draftRevision);
  }
  private current(lease: VeilAdmission) { return this.state.active && this.admission === lease && this.state.epoch === lease.context.epoch; }
  private install(snapshot: VeilProductSnapshot, pending: readonly VeilPendingOriginal[] = this.state.pending) {
    const old = scope(this.state.snapshot); const next = scope(snapshot);
    if (old?.accountViewRef !== next?.accountViewRef || old?.viewRevision !== next?.viewRevision) this.selection = null;
    return this.update({ snapshot, pending, needsRead: false, ...(old?.accountViewRef !== next?.accountViewRef ? { epoch: this.state.epoch + 1 } : {}) });
  }
  private pendingFor(lease: VeilAdmission, originalOperationRef: string | null, disposition: 'queued' | 'unknown') {
    if (!lease.command || !isProductMutation(lease.command) || !lease.context.accountViewRef || !lease.context.viewRevision) return this.state.pending;
    return retainPendingOriginals(this.state.pending, { accountViewRef: lease.context.accountViewRef, viewRevision: lease.context.viewRevision, localCallId: lease.context.callId, action: lease.command.type, command: lease.command, draftRevision: lease.draftRevision, originalOperationRef, disposition, resolution: 'unresolved', nextStep: 'review-only' });
  }
  private unresolved(lease: VeilAdmission, originalOperationRef: string | null, disposition: 'queued' | 'unknown') {
    return this.update({ pending: this.pendingFor(lease, originalOperationRef, disposition) });
  }
  private reject(lease: VeilAdmission, error: VeilProductErrorCode) {
    if (!this.current(lease)) return false;
    const pending = this.pendingFor(lease, null, 'unknown');
    this.selection = null;
    return this.update({ pending, snapshot: Object.freeze({ kind: 'LOCKED' }), epoch: this.state.epoch + 1, needsRead: false, error });
  }
  private retainDecodedOriginal(lease: VeilAdmission, result: VeilProductResult) {
    if (this.admission !== lease || !lease.command || !isProductMutation(lease.command)) return;
    const ref = result.kind === 'pending' || (result.kind === 'snapshot' && result.completion === 'confirmed')
      ? result.originalOperationRef : null;
    if (ref === null) return;
    const original = this.state.pending.find(item => item.accountViewRef === lease.context.accountViewRef &&
      item.localCallId === lease.context.callId && item.viewRevision === lease.context.viewRevision &&
      item.action === lease.command!.type && item.draftRevision === lease.draftRevision &&
      JSON.stringify(item.command) === JSON.stringify(lease.command));
    const conflicting = this.state.pending.some(item => item !== original &&
      item.accountViewRef === lease.context.accountViewRef && item.originalOperationRef === ref);
    if (original && !conflicting && original.resolution === 'unresolved' && original.originalOperationRef === null) {
      this.update({ pending: Object.freeze(this.state.pending.map(item => item === original
        ? Object.freeze({ ...item, originalOperationRef: ref, disposition: 'unknown' as const }) : item)) });
    }
  }
  completeRead(lease: VeilAdmission, raw: unknown): VeilProductSnapshot | null {
    if (!this.current(lease) || lease.command) return null;
    try { const value = decodeSnapshotReply(raw, lease.context); return this.install(value) ? value : null; }
    catch { this.reject(lease, 'BOUNDARY_INVALID'); return null; }
  }
  completeExecute(lease: VeilAdmission, raw: unknown): VeilProductResult | null {
    if (!lease.command) return null;
    if (!this.current(lease)) {
      // Unmount/invalidation revokes publication, not the outstanding receipt.
      // Only the still-owned original flight can attach its bounded reference.
      // This never installs a view, settles a draft or grants retry permission.
      if (this.admission === lease && isProductMutation(lease.command)) {
        try {
          const result = decodeExecuteReply(raw, lease.context, lease.command);
          this.retainDecodedOriginal(lease, result);
        } catch { /* Preserve original uncertainty; no late response can unlock the UI. */ }
      }
      return null;
    }
    try {
      const result = decodeExecuteReply(raw, lease.context, lease.command);
      let published = true;
      if (result.kind === 'pending') published = this.unresolved(lease, result.originalOperationRef, result.disposition);
      else if (result.kind === 'snapshot') published = this.install(result.snapshot);
      else if (result.kind === 'attachmentSelection') this.selection = Object.freeze({ account: lease.context.accountViewRef!, view: lease.context.viewRevision!, conversation: 'conversationId' in lease.command ? lease.command.conversationId : '', reference: result.selectionReference });
      else if (result.kind === 'originalReview') {
        published = this.update({ pending: settlePendingOriginal(this.state.pending, lease.context.accountViewRef!, result), needsRead: result.resolution !== 'unresolved' });
      } else if (result.kind === 'recovery') {
        // A recovery view is not a definite-not-applied result for this call.
        // Empty/unrelated recovery items cannot settle its original draft.
        published = this.install(result.state, this.pendingFor(lease, null, 'unknown'));
      }
      else if (result.kind === 'error') {
        const uncertain = ['OUTCOME_UNKNOWN', 'REVIEW_REQUIRED', 'STALE_VIEW', 'LOCKED'].includes(result.code);
        const locked = result.code === 'STALE_VIEW' || result.code === 'LOCKED';
        if (locked) this.selection = null;
        published = this.update({
          ...(uncertain ? { pending: this.pendingFor(lease, null, 'unknown') } : {}),
          ...(uncertain && lease.command.type === 'saveDraft' && !locked ? { needsRead: true } : {}),
          ...(locked ? { snapshot: Object.freeze({ kind: 'LOCKED' as const }), epoch: this.state.epoch + 1, needsRead: false } : {}),
          error: result.code,
        });
      }
      if (!published || !this.state.active || this.admission !== lease) {
        // An observer may close/invalidate while the result is published. Keep
        // the original reference, but do not clear drafts in the stale screen.
        this.retainDecodedOriginal(lease, result);
        return null;
      }
      return result;
    } catch { this.reject(lease, 'BOUNDARY_INVALID'); return null; }
  }
  fail(lease: VeilAdmission): boolean { return this.reject(lease, 'OUTCOME_UNKNOWN'); }
  release(lease: VeilAdmission) {
    if (this.admission !== lease) return;
    this.admission = null;
    this.update({ busy: false });
  }
}

// One source-owned gate survives React remounts; it has no provider parameter.
export const veilProductController = new VeilProductController();
