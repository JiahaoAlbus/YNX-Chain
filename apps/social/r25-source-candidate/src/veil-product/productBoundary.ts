import { decodeLocalOwnerProjection } from './localOwner';
import { decodeAcceptedDeviceObservation, decodeProtectedMessageSession } from './nativeProductPorts';
import { productLimits, validateProductCommand, validProductSearchQuery, type VeilAuthorizedSnapshot, type VeilProductCommand, type VeilProductResult, type VeilProductSnapshot } from './productModel';

// Local invocation association only: no wire, signed proof, grant or native ABI.
export type VeilCallContext = Readonly<{
  callId: number; epoch: number; action: 'readSnapshot' | VeilProductCommand['type'];
  accountViewRef: string | null; viewRevision: string | null;
}>;
export type VeilSnapshotReply = Readonly<{ context: VeilCallContext; snapshot: VeilProductSnapshot }>;
export type VeilExecuteReply = Readonly<{ context: VeilCallContext; result: VeilProductResult }>;
export const projectionLimits = Object.freeze({ conversations: 250, messages: 250, contacts: 500, requests: 200, requestsPerDirection: 100, moments: 100, devices: 64, audiences: 64, recoveries: 128, attachments: 20, totalText: 1 << 20 });
const actions = ['openConversation', 'searchLocalMessages', 'viewStoredMessage', 'markConversationRead', 'sendMessage', 'loadDraft', 'saveDraft', 'selectAttachment', 'sendAttachment', 'openAttachment', 'requestContact', 'acceptContact', 'rejectContact', 'blockContact', 'unblockContact', 'publishMoment', 'reviewDevice', 'setLocalAi', 'reviewRecovery'] as const;
const gaps = ['AUTHORIZED_PRODUCT_PROJECTION_UNAVAILABLE', 'NATIVE_PRODUCT_EXPORT_UNAVAILABLE', 'ISSUER_PRODUCT_BINDING_UNAVAILABLE', 'STORE_PRODUCT_BINDING_UNAVAILABLE', 'RESTORE_PRODUCT_BINDING_UNAVAILABLE'] as const;
const errorCodes = ['UNAVAILABLE', 'INPUT_INVALID', 'LOCKED', 'STALE_VIEW', 'REVIEW_REQUIRED', 'OUTCOME_UNKNOWN', 'BOUNDARY_INVALID'] as const;
const inputFields = ['command', 'type', 'viewRevision', 'query', 'beforeMessageId', 'conversationId', 'throughMessageId', 'draftRevision', 'body', 'replyToMessageId', 'selectionReference', 'caption', 'messageId', 'attachmentReference', 'identifier', 'requestId', 'peerAccountId', 'audienceId', 'deviceId', 'preference', 'originalOperationRef', 'draftRevision'] as const;
export class VeilBoundaryError extends Error { constructor() { super('VEIL_PRODUCT_BOUNDARY_INVALID'); } }
function fail(): never { throw new VeilBoundaryError(); }
function record(raw: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key)))) return fail();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string') return fail();
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
    copy[key] = descriptor.value;
  }
  return copy;
}
class Budget {
  private used = 0;
  text(value: unknown, limit: number, empty = false): string {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return fail();
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return fail();
      } else if (code >= 0xdc00 && code <= 0xdfff) return fail();
    }
    this.used += value.length;
    if (this.used > projectionLimits.totalText) return fail();
    return value;
  }
  ref(value: unknown): string {
    const text = this.text(value, productLimits.reference);
    if (/[\r\n\t]/.test(text)) return fail();
    return text;
  }
}
function peerAccountId(raw: unknown, budget: Budget): string {
  const value = budget.ref(raw);
  return /^[\x21-\x7e]{1,256}$/.test(value) ? value : fail();
}
function choice<T extends string>(raw: unknown, values: readonly T[]): T { return typeof raw === 'string' && values.includes(raw as T) ? raw as T : fail(); }
function integer(raw: unknown, minimum = 0): number { return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= minimum ? raw : fail(); }
function array<T>(raw: unknown, max: number, decode: (row: unknown) => T): readonly T[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > max) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== raw.length + 1 || keys.some(key => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))) return fail();
  const owned: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
    owned.push(decode(descriptor.value));
  }
  return Object.freeze(owned);
}
function unique<T>(rows: readonly T[], key: (row: T) => string): readonly T[] { if (new Set(rows.map(key)).size !== rows.length) return fail(); return rows; }
function context(raw: unknown, expected: VeilCallContext, budget: Budget): VeilCallContext {
  const r = record(raw, ['callId', 'epoch', 'action', 'accountViewRef', 'viewRevision']);
  const owned = Object.freeze({ callId: integer(r.callId, 1), epoch: integer(r.epoch, 1), action: choice(r.action, ['readSnapshot', ...actions]), accountViewRef: r.accountViewRef === null ? null : budget.ref(r.accountViewRef), viewRevision: r.viewRevision === null ? null : budget.ref(r.viewRevision) });
  for (const key of ['callId', 'epoch', 'action', 'accountViewRef', 'viewRevision'] as const) if (owned[key] !== expected[key]) return fail();
  return owned;
}
function recoveries(raw: unknown, budget: Budget) {
  return unique(array(raw, projectionLimits.recoveries, value => {
    const r = record(value, ['originalOperationRef', 'label', 'state']);
    return Object.freeze({ originalOperationRef: budget.ref(r.originalOperationRef), label: budget.text(r.label, 256), state: choice(r.state, ['unknown', 'review-required', 'resolved']) });
  }), item => item.originalOperationRef);
}
function snapshot(raw: unknown, budget: Budget): VeilProductSnapshot {
  // First get only the kind from a plain own data property, without invoking getters.
  if (!raw || typeof raw !== 'object') return fail();
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'kind');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail();
  if (descriptor.value === 'UNAVAILABLE') {
    const r = record(raw, ['kind', 'gaps'], ['localOwner', 'deviceObservation', 'sessionObservation']);
    const deviceObservation = Object.hasOwn(r, 'deviceObservation') ? decodeAcceptedDeviceObservation(r.deviceObservation) : undefined;
    const sessionObservation = Object.hasOwn(r, 'sessionObservation') ? decodeProtectedMessageSession(r.sessionObservation) : undefined;
    if (sessionObservation) {
      if (!deviceObservation) return fail();
      for (const key of Object.keys(deviceObservation) as (keyof typeof deviceObservation)[])
        if (deviceObservation[key] !== sessionObservation.device[key]) return fail();
    }
    return Object.freeze({ kind: 'UNAVAILABLE', gaps: unique(array(r.gaps, gaps.length, value => choice(value, gaps)), value => value),
      ...(Object.hasOwn(r, 'localOwner') ? { localOwner: decodeLocalOwnerProjection(r.localOwner) } : {}),
      ...(deviceObservation ? { deviceObservation } : {}),
      ...(sessionObservation ? { sessionObservation } : {}),
    });
  }
  if (descriptor.value === 'LOCKED') { record(raw, ['kind']); return Object.freeze({ kind: 'LOCKED' }); }
  if (descriptor.value === 'RECOVERY_REQUIRED') {
    const r = record(raw, ['kind', 'accountViewRef', 'viewRevision', 'items']);
    return Object.freeze({ kind: 'RECOVERY_REQUIRED', accountViewRef: budget.ref(r.accountViewRef), viewRevision: budget.ref(r.viewRevision), items: recoveries(r.items, budget) });
  }
  if (descriptor.value !== 'AUTHORIZED') return fail();
  const r = record(raw, ['kind', 'accountViewRef', 'viewRevision', 'profile', 'conversations', 'messages', 'activeConversationId', 'contacts', 'contactRequests', 'blockedContacts', 'moments', 'devices', 'audiences', 'recoveries', 'actions', 'localAi', 'messageWindow']);
  const p = record(r.profile, ['displayName', 'publicIdentifier']);
  const conversations = unique(array(r.conversations, projectionLimits.conversations, value => {
    const row = record(value, ['id', 'title', 'preview', 'unreadCount']);
    return Object.freeze({ id: budget.ref(row.id), title: budget.text(row.title, 256), preview: budget.text(row.preview, 512, true), unreadCount: integer(row.unreadCount) });
  }), row => row.id);
  const activeConversationId = r.activeConversationId === null ? null : budget.ref(r.activeConversationId);
  if (activeConversationId !== null && !conversations.some(row => row.id === activeConversationId)) return fail();
  const messages = unique(array(r.messages, projectionLimits.messages, value => {
    const row = record(value, ['id', 'conversationId', 'senderLabel', 'body', 'direction', 'submission', 'delivery', 'attachments'], ['replyToMessageId']);
    const conversationId = budget.ref(row.conversationId);
    if (!conversations.some(item => item.id === conversationId)) return fail();
    const submission = choice(row.submission, ['confirmed', 'queued', 'unknown', 'aborted']);
    const delivery = choice(row.delivery, ['unconfirmed', 'delivered', 'read']);
    if (submission !== 'confirmed' && delivery !== 'unconfirmed') return fail();
    if (submission === 'aborted' && row.direction !== 'outgoing') return fail();
    return Object.freeze({ id: budget.ref(row.id), conversationId, senderLabel: budget.text(row.senderLabel, 256), body: budget.text(row.body, productLimits.body, true), direction: choice(row.direction, ['incoming', 'outgoing']), submission, delivery,
      replyToMessageId: row.replyToMessageId === undefined || row.replyToMessageId === null ? null : budget.ref(row.replyToMessageId),
      attachments: unique(array(row.attachments, projectionLimits.attachments, item => { const attachment = record(item, ['reference', 'name']); return Object.freeze({ reference: budget.ref(attachment.reference), name: budget.text(attachment.name, 256) }); }), item => item.reference) });
  }), row => row.id);
  for (const message of messages) {
    const target = messages.find(item => item.id === message.replyToMessageId);
    if (target && (target.id === message.id || target.conversationId !== message.conversationId)) return fail();
  }
  const window = record(r.messageWindow, ['mode', 'anchorMessageId', 'hasEarlier']);
  if (typeof window.hasEarlier !== 'boolean') return fail();
  const messageWindow = Object.freeze({ mode: choice(window.mode, ['latest', 'anchored']), anchorMessageId: window.anchorMessageId === null ? null : budget.ref(window.anchorMessageId), hasEarlier: window.hasEarlier });
  if (messageWindow.mode === 'latest' ? messageWindow.anchorMessageId !== null : messageWindow.anchorMessageId === null || activeConversationId === null || messages.at(-1)?.id !== messageWindow.anchorMessageId || messages.at(-1)?.conversationId !== activeConversationId) return fail();
  const owned: VeilAuthorizedSnapshot = Object.freeze({
    kind: 'AUTHORIZED', messageWindow, accountViewRef: budget.ref(r.accountViewRef), viewRevision: budget.ref(r.viewRevision), activeConversationId,
    profile: Object.freeze({ displayName: budget.text(p.displayName, 256), publicIdentifier: budget.text(p.publicIdentifier, 512) }), conversations, messages,
    contacts: unique(array(r.contacts, projectionLimits.contacts, value => {
      const row = record(value, ['id', 'peerAccountId', 'displayName', 'publicIdentifier'], ['conversationId']);
      const conversationId = row.conversationId === undefined || row.conversationId === null ? null : budget.ref(row.conversationId);
      if (conversationId !== null && !conversations.some(item => item.id === conversationId)) return fail();
      return Object.freeze({ id: budget.ref(row.id), peerAccountId: peerAccountId(row.peerAccountId, budget), displayName: budget.text(row.displayName, 256), publicIdentifier: row.publicIdentifier === null ? null : budget.text(row.publicIdentifier, 512), conversationId });
    }), row => row.id),
    contactRequests: (() => {
      const rows = unique(unique(array(r.contactRequests, projectionLimits.requests, value => {
        const row = record(value, ['id', 'peerAccountId', 'displayName', 'publicIdentifier', 'direction']);
        return Object.freeze({ id: budget.ref(row.id), peerAccountId: peerAccountId(row.peerAccountId, budget), displayName: budget.text(row.displayName, 256), publicIdentifier: row.publicIdentifier === null ? null : budget.text(row.publicIdentifier, 512), direction: choice(row.direction, ['incoming', 'outgoing'] as const) });
      }), row => row.id), row => row.peerAccountId);
      if (rows.filter(row => row.direction === 'incoming').length > projectionLimits.requestsPerDirection || rows.filter(row => row.direction === 'outgoing').length > projectionLimits.requestsPerDirection) return fail();
      return rows;
    })(),
    blockedContacts: unique(array(r.blockedContacts, projectionLimits.contacts, value => { const row = record(value, ['peerAccountId', 'displayName']); return Object.freeze({ peerAccountId: peerAccountId(row.peerAccountId, budget), displayName: budget.text(row.displayName, 256) }); }), row => row.peerAccountId),
    moments: unique(array(r.moments, projectionLimits.moments, value => { const row = record(value, ['id', 'authorLabel', 'body', 'audienceLabel']); return Object.freeze({ id: budget.ref(row.id), authorLabel: budget.text(row.authorLabel, 256), body: budget.text(row.body, productLimits.moment), audienceLabel: budget.text(row.audienceLabel, 256) }); }), row => row.id),
    devices: unique(array(r.devices, projectionLimits.devices, value => { const row = record(value, ['id', 'label', 'state']); return Object.freeze({ id: budget.ref(row.id), label: budget.text(row.label, 256), state: choice(row.state, ['approved', 'pending', 'revoked']) }); }), row => row.id),
    audiences: unique(array(r.audiences, projectionLimits.audiences, value => { const row = record(value, ['id', 'label']); return Object.freeze({ id: budget.ref(row.id), label: budget.text(row.label, 256) }); }), row => row.id),
    recoveries: recoveries(r.recoveries, budget), actions: unique(array(r.actions, actions.length, value => choice(value, actions)), value => value), localAi: choice(r.localAi, ['unsupported', 'off', 'on']),
  });
  unique(owned.contacts, row => row.peerAccountId);
  unique(owned.contactRequests, row => row.peerAccountId);
  const blocked = new Set(owned.blockedContacts.map(row => row.peerAccountId));
  if (owned.contacts.some(row => blocked.has(row.peerAccountId)) || owned.contactRequests.some(row => blocked.has(row.peerAccountId))) return fail();
  if (messageWindow.mode === 'anchored' && owned.actions.includes('markConversationRead')) return fail();
  return owned;
}
/** Own local invocation correlation before asynchronous dispatch. Not a grant. */
export function ownCallContext(raw: VeilCallContext): VeilCallContext {
  const owned = record(raw, ['callId', 'epoch', 'action', 'accountViewRef', 'viewRevision']);
  return context(owned, owned as VeilCallContext, new Budget());
}
export function decodeSnapshotReply(raw: unknown, expected: VeilCallContext): VeilProductSnapshot {
  if (expected.action !== 'readSnapshot') return fail();
  const budget = new Budget(); const r = record(raw, ['context', 'snapshot']);
  context(r.context, expected, budget);
  return snapshot(r.snapshot, budget);
}
export function isProductMutation(command: VeilProductCommand): boolean {
  return !['openConversation', 'searchLocalMessages', 'viewStoredMessage', 'markConversationRead', 'loadDraft', 'saveDraft', 'openAttachment', 'selectAttachment', 'reviewRecovery'].includes(command.type);
}
/** Own public draft fields without evaluating property accessors. Semantic
 * input errors are returned by the product consumer before native dispatch. */
export function ownProductCommandDraft(command: VeilProductCommand): VeilProductCommand {
  const owned = record(command, ['type'], [
    'viewRevision', 'query', 'beforeMessageId', 'conversationId', 'throughMessageId', 'draftRevision', 'body', 'replyToMessageId', 'selectionReference',
    'caption', 'messageId', 'attachmentReference', 'identifier', 'requestId', 'peerAccountId',
    'audienceId', 'deviceId', 'preference', 'originalOperationRef',
  ]);
  return Object.freeze({ ...owned }) as VeilProductCommand;
}
export function ownProductCommand(command: VeilProductCommand): VeilProductCommand {
  const owned = ownProductCommandDraft(command);
  if (validateProductCommand(owned)) return fail();
  return owned;
}
export function decodeExecuteReply(raw: unknown, expected: VeilCallContext, command: VeilProductCommand): VeilProductResult {
  if (expected.action !== command.type || expected.accountViewRef === null || (command.type !== 'reviewRecovery' && command.viewRevision !== expected.viewRevision)) return fail();
  const budget = new Budget(); const envelope = record(raw, ['context', 'result']); context(envelope.context, expected, budget);
  if (!envelope.result || typeof envelope.result !== 'object') return fail();
  const kind = Object.getOwnPropertyDescriptor(envelope.result, 'kind'); if (!kind || !Object.hasOwn(kind, 'value')) return fail();
  switch (kind.value) {
    case 'error': {
      const r = record(envelope.result, ['kind', 'code'], ['field']);
      return Object.freeze({ kind: 'error', code: choice(r.code, errorCodes), ...(r.field === undefined ? {} : { field: choice(r.field, inputFields) }) });
    }
    case 'pending': {
      if (!isProductMutation(command)) return fail();
      const r = record(envelope.result, ['kind', 'disposition', 'originalOperationRef']);
      return Object.freeze({ kind: 'pending', disposition: choice(r.disposition, ['queued', 'unknown']), originalOperationRef: budget.ref(r.originalOperationRef) });
    }
    case 'messageSearch': {
      if (command.type !== 'searchLocalMessages') return fail();
      const r = record(envelope.result, ['kind', 'query', 'matches', 'nextBeforeMessageId', 'completion', 'originalOperationRef']);
      const query = budget.text(r.query, productLimits.query);
      if (!validProductSearchQuery(query) || query !== command.query || r.completion !== 'read' || r.originalOperationRef !== null) return fail();
      const matches = unique(array(r.matches, 50, value => {
        const row = record(value, ['messageId', 'conversationId', 'title', 'excerpt']);
        return Object.freeze({ messageId: budget.ref(row.messageId), conversationId: budget.ref(row.conversationId), title: budget.text(row.title, 256), excerpt: budget.text(row.excerpt, 512, true) });
      }), item => item.messageId);
      const nextBeforeMessageId = r.nextBeforeMessageId === null ? null : budget.ref(r.nextBeforeMessageId);
      if (nextBeforeMessageId !== null && (matches.length !== 50 || nextBeforeMessageId !== matches.at(-1)?.messageId)) return fail();
      return Object.freeze({ kind: 'messageSearch', query, matches, nextBeforeMessageId, completion: 'read', originalOperationRef: null });
    }
    case 'draft': {
      if (command.type !== 'loadDraft' && command.type !== 'saveDraft') return fail();
      const r = record(envelope.result, ['kind', 'conversationId', 'draftRevision', 'body', 'replyToMessageId', 'completion', 'originalOperationRef']);
      const conversationId = budget.ref(r.conversationId);
      if (conversationId !== command.conversationId || r.originalOperationRef !== null || r.completion !== (command.type === 'loadDraft' ? 'read' : 'stored')) return fail();
      const draftRevision = budget.text(r.draftRevision, 16);
      if (!/^(0|[1-9][0-9]{0,15})$/.test(draftRevision) || Number(draftRevision) > 9007199254740990) return fail();
      const body = budget.text(r.body, productLimits.body, true);
      const replyToMessageId = r.replyToMessageId === null ? null : budget.ref(r.replyToMessageId);
      if (command.type === 'saveDraft' && (Number(draftRevision) !== Number(command.draftRevision) + 1 || body !== command.body || replyToMessageId !== command.replyToMessageId)) return fail();
      if (draftRevision === '0' && (body !== '' || replyToMessageId !== null)) return fail();
      return Object.freeze({ kind: 'draft', conversationId, draftRevision, body, replyToMessageId, completion: r.completion as 'read' | 'stored', originalOperationRef: null });
    }
    case 'attachmentSelection': {
      if (command.type !== 'selectAttachment') return fail();
      const r = record(envelope.result, ['kind', 'selectionReference', 'displayName']);
      return Object.freeze({ kind: 'attachmentSelection', selectionReference: budget.ref(r.selectionReference), displayName: budget.text(r.displayName, 256) });
    }
    case 'originalReview': {
      if (command.type !== 'reviewRecovery') return fail();
      const r = record(envelope.result, ['kind', 'originalOperationRef', 'resolution', 'nextStep'], ['eventObservation']);
      const originalOperationRef = budget.ref(r.originalOperationRef);
      if (originalOperationRef !== command.originalOperationRef) return fail();
      const resolution = choice(r.resolution, ['unresolved', 'confirmed', 'aborted']); const nextStep = choice(r.nextStep, ['review-only', 'none', 'new-draft']);
      if ((resolution === 'unresolved' && nextStep !== 'review-only') || (resolution === 'confirmed' && nextStep !== 'none') || (resolution === 'aborted' && nextStep === 'review-only')) return fail();
      const hasObservation = Object.hasOwn(r, 'eventObservation');
      if (hasObservation && (r.eventObservation !== 'present' || resolution !== 'unresolved' || nextStep !== 'review-only')) return fail();
      return Object.freeze({ kind: 'originalReview', originalOperationRef, resolution, nextStep,
        ...(hasObservation ? { eventObservation: 'present' as const } : {}) });
    }
    case 'recovery': {
      const r = record(envelope.result, ['kind', 'state']); const state = snapshot(r.state, budget);
      if (state.kind !== 'RECOVERY_REQUIRED' || state.accountViewRef !== expected.accountViewRef) return fail();
      return Object.freeze({ kind: 'recovery', state });
    }
    case 'snapshot': {
      const r = record(envelope.result, ['kind', 'snapshot', 'completion', 'originalOperationRef']); const value = snapshot(r.snapshot, budget);
      if (value.kind !== 'AUTHORIZED' || value.accountViewRef !== expected.accountViewRef) return fail();
      const completion = choice(r.completion, ['read', 'confirmed']);
      const originalOperationRef = r.originalOperationRef === null ? null : budget.ref(r.originalOperationRef);
      if (isProductMutation(command) ? completion !== 'confirmed' || originalOperationRef === null : completion !== 'read' || originalOperationRef !== null) return fail();
      if ('conversationId' in command && value.activeConversationId !== command.conversationId) return fail();
      if (command.type === 'searchLocalMessages') return fail();
      if (command.type === 'viewStoredMessage' && (value.messageWindow.mode !== 'anchored' || value.messageWindow.anchorMessageId !== command.messageId)) return fail();
      if ((command.type === 'openConversation' || command.type === 'markConversationRead') && value.messageWindow.mode !== 'latest') return fail();
      return Object.freeze({ kind: 'snapshot', snapshot: value, completion, originalOperationRef });
    }
    default: return fail();
  }
}
