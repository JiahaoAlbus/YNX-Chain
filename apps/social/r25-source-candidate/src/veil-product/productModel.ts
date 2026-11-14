import type { VeilLocalOwnerRead } from './localOwner';
import type { AcceptedDeviceObservation, ProtectedMessageSessionObservation } from './nativeProductPorts';
/** Local product DTOs, not a canonical transport, signed proof, or grant.
 * Routing ids/revisions never authorize an operation. The genuine native facade
 * must recheck its own account/device/store/restore scope for every call.
 * These types specify what the UI needs; they do not assert Hyp's facade ABI.
 */
export const productLimits = Object.freeze({ body: 16000, moment: 5000, identifier: 512, query: 256, reference: 256 });
export type VeilViewRevision = string;
export type VeilSubmission = 'confirmed' | 'queued' | 'unknown' | 'aborted';
export type VeilDelivery = 'unconfirmed' | 'delivered' | 'read';
export type VeilMessage = Readonly<{
  id: string; conversationId: string; senderLabel: string; body: string;
  replyToMessageId?: string | null;
  direction: 'incoming' | 'outgoing'; submission: VeilSubmission; delivery: VeilDelivery;
  attachments: readonly Readonly<{ reference: string; name: string }>[];
}>;
export type VeilConversation = Readonly<{ id: string; title: string; preview: string; unreadCount: number }>;
// Missing routing is not permission to derive a room from an identifier.
export type VeilContact = Readonly<{ id: string; peerAccountId: string; displayName: string; publicIdentifier: string | null; conversationId?: string | null }>;
export type VeilContactRequest = Readonly<{ id: string; peerAccountId: string; displayName: string; publicIdentifier: string | null; direction: 'incoming' | 'outgoing' }>;
export type VeilBlockedContact = Readonly<{ peerAccountId: string; displayName: string }>;
export type VeilMoment = Readonly<{ id: string; authorLabel: string; body: string; audienceLabel: string }>;
export type VeilDevice = Readonly<{ id: string; label: string; state: 'approved' | 'pending' | 'revoked' }>;
export type VeilRecoveryItem = Readonly<{
  originalOperationRef: string; label: string;
  state: 'unknown' | 'review-required' | 'resolved';
}>;
export type VeilMessageWindow = Readonly<{ mode: 'latest' | 'anchored'; anchorMessageId: string | null; hasEarlier: boolean }>;
export type VeilMessageSearch = Readonly<{ kind: 'messageSearch'; query: string; matches: readonly Readonly<{ messageId: string; conversationId: string; title: string; excerpt: string }>[]; nextBeforeMessageId: string | null; completion: 'read'; originalOperationRef: null }>;
export type VeilAuthorizedSnapshot = Readonly<{
  kind: 'AUTHORIZED'; viewRevision: VeilViewRevision; accountViewRef: string;
  profile: Readonly<{ displayName: string; publicIdentifier: string }>;
  conversations: readonly VeilConversation[]; messages: readonly VeilMessage[];
  activeConversationId: string | null; messageWindow: VeilMessageWindow;
  contacts: readonly VeilContact[]; contactRequests: readonly VeilContactRequest[];
  blockedContacts: readonly VeilBlockedContact[];
  moments: readonly VeilMoment[]; devices: readonly VeilDevice[];
  audiences: readonly Readonly<{ id: string; label: string }>[];
  recoveries: readonly VeilRecoveryItem[];
  // Native-supported capability projection is a UI hint, never authorization.
  actions: readonly VeilProductCommand['type'][];
  localAi: 'unsupported' | 'off' | 'on';
}>;
export type VeilProductSnapshot =
  | Readonly<{ kind: 'UNAVAILABLE'; localOwner?: VeilLocalOwnerRead; deviceObservation?: AcceptedDeviceObservation; sessionObservation?: ProtectedMessageSessionObservation; gaps: readonly string[] }>
  | Readonly<{ kind: 'LOCKED' }>
  | Readonly<{ kind: 'RECOVERY_REQUIRED'; accountViewRef: string; viewRevision: string; items: readonly VeilRecoveryItem[] }>
  | VeilAuthorizedSnapshot;

type ViewCommand = Readonly<{ viewRevision: VeilViewRevision }>;
export type VeilProductCommand =
  | (ViewCommand & Readonly<{ type: 'openConversation'; conversationId: string }>)
  | (ViewCommand & Readonly<{ type: 'searchLocalMessages'; query: string; beforeMessageId: string | null }>)
  | (ViewCommand & Readonly<{ type: 'viewStoredMessage'; conversationId: string; messageId: string }>)
  | (ViewCommand & Readonly<{ type: 'markConversationRead'; conversationId: string; throughMessageId: string }>)
  | (ViewCommand & Readonly<{ type: 'loadDraft'; conversationId: string }>)
  | (ViewCommand & Readonly<{ type: 'saveDraft'; conversationId: string; draftRevision: string; body: string; replyToMessageId: string | null }>)
  | (ViewCommand & Readonly<{ type: 'sendMessage'; conversationId: string; body: string; replyToMessageId: string | null }>)
  | (ViewCommand & Readonly<{ type: 'selectAttachment'; conversationId: string }>)
  | (ViewCommand & Readonly<{ type: 'sendAttachment'; conversationId: string; selectionReference: string; caption: string }>)
  | (ViewCommand & Readonly<{ type: 'openAttachment'; conversationId: string; messageId: string; attachmentReference: string }>)
  | (ViewCommand & Readonly<{ type: 'requestContact'; identifier: string }>)
  | (ViewCommand & Readonly<{ type: 'acceptContact'; requestId: string }>)
  | (ViewCommand & Readonly<{ type: 'rejectContact'; requestId: string }>)
  | (ViewCommand & Readonly<{ type: 'blockContact'; peerAccountId: string }>)
  | (ViewCommand & Readonly<{ type: 'unblockContact'; peerAccountId: string }>)
  | (ViewCommand & Readonly<{ type: 'publishMoment'; body: string; audienceId: string }>)
  | (ViewCommand & Readonly<{ type: 'reviewDevice'; deviceId: string }>)
  | (ViewCommand & Readonly<{ type: 'setLocalAi'; preference: 'off' | 'on' }>)
  | Readonly<{ type: 'reviewRecovery'; originalOperationRef: string }>;

export type VeilProductErrorCode = 'UNAVAILABLE' | 'INPUT_INVALID' | 'LOCKED' | 'STALE_VIEW' | 'REVIEW_REQUIRED' | 'OUTCOME_UNKNOWN' | 'BOUNDARY_INVALID';
export type VeilProductError = Readonly<{ kind: 'error'; code: VeilProductErrorCode; field?: string }>;
export type VeilProductResult =
  | VeilProductError
  | VeilMessageSearch
  | Readonly<{ kind: 'draft'; conversationId: string; draftRevision: string; body: string; replyToMessageId: string | null; completion: 'read' | 'stored'; originalOperationRef: null }>
  | Readonly<{ kind: 'snapshot'; snapshot: VeilAuthorizedSnapshot; completion: 'read' | 'confirmed'; originalOperationRef: string | null }>
  | Readonly<{ kind: 'pending'; disposition: 'queued' | 'unknown'; originalOperationRef: string }>
  | Readonly<{ kind: 'attachmentSelection'; selectionReference: string; displayName: string }>
  | Readonly<{ kind: 'originalReview'; originalOperationRef: string; resolution: 'unresolved' | 'confirmed' | 'aborted'; nextStep: 'review-only' | 'none' | 'new-draft'; eventObservation?: 'present' }>
  | Readonly<{ kind: 'recovery'; state: Extract<VeilProductSnapshot, { kind: 'RECOVERY_REQUIRED' }> }>;

const bounded = (value: unknown, limit: number, empty = false): value is string =>
  typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const reference = (value: unknown) => bounded(value, productLimits.reference) && !/[\r\n\t]/.test(value);
function scalar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export const validProductSearchQuery = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= productLimits.query && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && scalar(value);
export function validateProductCommand(command: VeilProductCommand): VeilProductError | null {
  const invalid = (field: string): VeilProductError => ({ kind: 'error', code: 'INPUT_INVALID', field });
  if (!command || typeof command !== 'object' || Array.isArray(command)) return invalid('command');
  const fields: Record<VeilProductCommand['type'], readonly string[]> = {
    openConversation: ['type', 'viewRevision', 'conversationId'],
    searchLocalMessages: ['type', 'viewRevision', 'query', 'beforeMessageId'],
    viewStoredMessage: ['type', 'viewRevision', 'conversationId', 'messageId'],
    markConversationRead: ['type', 'viewRevision', 'conversationId', 'throughMessageId'],
    sendMessage: ['type', 'viewRevision', 'conversationId', 'body', 'replyToMessageId'],
    loadDraft: ['type', 'viewRevision', 'conversationId'],
    saveDraft: ['type', 'viewRevision', 'conversationId', 'draftRevision', 'body', 'replyToMessageId'],
    selectAttachment: ['type', 'viewRevision', 'conversationId'],
    sendAttachment: ['type', 'viewRevision', 'conversationId', 'selectionReference', 'caption'],
    openAttachment: ['type', 'viewRevision', 'conversationId', 'messageId', 'attachmentReference'],
    requestContact: ['type', 'viewRevision', 'identifier'],
    acceptContact: ['type', 'viewRevision', 'requestId'],
    rejectContact: ['type', 'viewRevision', 'requestId'],
    blockContact: ['type', 'viewRevision', 'peerAccountId'],
    unblockContact: ['type', 'viewRevision', 'peerAccountId'],
    publishMoment: ['type', 'viewRevision', 'body', 'audienceId'],
    reviewDevice: ['type', 'viewRevision', 'deviceId'],
    setLocalAi: ['type', 'viewRevision', 'preference'],
    reviewRecovery: ['type', 'originalOperationRef'],
  };
  if (!Object.hasOwn(fields, command.type)) return invalid('type');
  const expected = fields[command.type];
  const actual = Object.keys(command);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) return invalid('command');
  if (command.type === 'reviewRecovery') return reference(command.originalOperationRef) ? null : invalid('originalOperationRef');
  if (!reference(command.viewRevision)) return invalid('viewRevision');
  switch (command.type) {
    case 'searchLocalMessages':
      if (!validProductSearchQuery(command.query)) return invalid('query');
      return command.beforeMessageId === null || (reference(command.beforeMessageId) && scalar(command.beforeMessageId)) ? null : invalid('beforeMessageId');
    case 'viewStoredMessage':
      if (!reference(command.conversationId) || !scalar(command.conversationId)) return invalid('conversationId');
      return reference(command.messageId) && scalar(command.messageId) ? null : invalid('messageId');
    case 'openConversation': case 'selectAttachment': case 'loadDraft':
      return reference(command.conversationId) ? null : invalid('conversationId');
    case 'markConversationRead':
      return reference(command.conversationId) && reference(command.throughMessageId) ? null : invalid('throughMessageId');
    case 'saveDraft':
      if (!reference(command.conversationId)) return invalid('conversationId');
      if (!/^(0|[1-9][0-9]{0,15})$/.test(command.draftRevision) || Number(command.draftRevision) > 9007199254740990) return invalid('draftRevision');
      if (!bounded(command.body, productLimits.body, true)) return invalid('body');
      return command.replyToMessageId === null || reference(command.replyToMessageId) ? null : invalid('replyToMessageId');
    case 'sendMessage':
      if (!reference(command.conversationId)) return invalid('conversationId');
      if (!bounded(command.body, productLimits.body)) return invalid('body');
      return command.replyToMessageId === null || reference(command.replyToMessageId) ? null : invalid('replyToMessageId');
    case 'sendAttachment':
      if (!reference(command.conversationId)) return invalid('conversationId');
      if (!reference(command.selectionReference)) return invalid('selectionReference');
      return bounded(command.caption, productLimits.body, true) ? null : invalid('caption');
    case 'openAttachment':
      if (!reference(command.conversationId)) return invalid('conversationId');
      if (!reference(command.messageId)) return invalid('messageId');
      return reference(command.attachmentReference) ? null : invalid('attachmentReference');
    case 'requestContact':
      return bounded(command.identifier, productLimits.identifier) && !/[\r\n\t]/.test(command.identifier) ? null : invalid('identifier');
    case 'acceptContact': case 'rejectContact': return reference(command.requestId) ? null : invalid('requestId');
    case 'blockContact': case 'unblockContact':
      return typeof command.peerAccountId === 'string' && /^[\x21-\x7e]{1,256}$/.test(command.peerAccountId) ? null : invalid('peerAccountId');
    case 'publishMoment':
      if (!bounded(command.body, productLimits.moment)) return invalid('body');
      return reference(command.audienceId) ? null : invalid('audienceId');
    case 'reviewDevice': return reference(command.deviceId) ? null : invalid('deviceId');
    case 'setLocalAi': return command.preference === 'off' || command.preference === 'on' ? null : invalid('preference');
    default: return invalid('type');
  }
}

export function messageStatusKey(message: Pick<VeilMessage, 'submission' | 'delivery'>): 'queued' | 'unknown' | 'aborted' | 'confirmed' | 'delivered' | 'read' {
  if (message.submission === 'queued' || message.submission === 'unknown' || message.submission === 'aborted') return message.submission;
  return message.delivery === 'unconfirmed' ? 'confirmed' : message.delivery;
}

export function productActionDisabled(snapshot: VeilProductSnapshot | null, action: VeilProductCommand['type']): boolean {
  if (action === 'reviewRecovery' && snapshot?.kind === 'RECOVERY_REQUIRED') return false;
  return snapshot?.kind !== 'AUTHORIZED' || !snapshot.actions.includes(action);
}
