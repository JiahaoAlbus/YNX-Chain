import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSnapshotReply } from './productBoundary';

const context = { callId: 1, epoch: 1, action: 'readSnapshot' as const, accountViewRef: null, viewRevision: null };
const view = () => ({
  kind: 'AUTHORIZED', messageWindow: { mode: 'latest', anchorMessageId: null, hasEarlier: false }, accountViewRef: 'account-a', viewRevision: 'view-a',
  profile: { displayName: 'Alice', publicIdentifier: 'alice' },
  conversations: [{ id: 'route-a', title: 'Bob', preview: '', unreadCount: 0 }, { id: 'route-b', title: 'C', preview: '', unreadCount: 0 }],
  messages: [] as Record<string, unknown>[], activeConversationId: 'route-a',
  contacts: [{ id: 'contact-a', peerAccountId: 'peer-b', displayName: 'Bob', publicIdentifier: 'bob', conversationId: 'route-a' }] as Record<string, unknown>[],
  contactRequests: [], blockedContacts: [], moments: [], devices: [], audiences: [], recoveries: [], actions: ['openConversation', 'sendMessage'], localAi: 'unsupported',
});
const decode = (snapshot: ReturnType<typeof view>) => {
  const result = decodeSnapshotReply({ context, snapshot }, context);
  assert.equal(result.kind, 'AUTHORIZED');
  if (result.kind !== 'AUTHORIZED') throw new Error('Expected a decoded public control view');
  return result;
};
const message = (id: string, conversationId: string, replyToMessageId: string | null = null) => ({
  id, conversationId, senderLabel: 'Public user', body: 'Public test body', direction: 'incoming',
  submission: 'confirmed', delivery: 'unconfirmed', attachments: [], replyToMessageId,
});

test('contact route is explicit rather than derived from the contact identifier', () => {
  const result = decode(view());
  assert.equal(result.contacts[0]?.id, 'contact-a');
  assert.equal(result.contacts[0]?.conversationId, 'route-a');
  assert.ok(Object.isFrozen(result.contacts[0]));
});
test('absent contact route remains unavailable even when contact id resembles a route', () => {
  const input = view(); input.contacts = [{ id: 'route-a', peerAccountId: 'peer-b', displayName: 'Bob', publicIdentifier: 'bob' }];
  assert.equal(decode(input).contacts[0]?.conversationId, null);
});
test('foreign or getter-backed contact routing fails the normal boundary', () => {
  const input = view(); input.contacts[0]!.conversationId = 'unlisted-route';
  assert.throws(() => decode(input));
  const getter = view(); let read = false;
  Object.defineProperty(getter.contacts[0], 'conversationId', { enumerable: true, get() { read = true; return 'route-a'; } });
  assert.throws(() => decode(getter)); assert.equal(read, false);
});
test('authenticated reply references survive without inventing quoted plaintext', () => {
  const input = view(); input.messages = [message('m1', 'route-a'), message('m2', 'route-a', 'm1')];
  const result = decode(input); assert.equal(result.messages[1]?.replyToMessageId, 'm1');
  input.messages = [message('m3', 'route-a', 'not-loaded')];
  assert.equal(decode(input).messages[0]?.replyToMessageId, 'not-loaded');
});
test('known cross-conversation and self references are refused', () => {
  const input = view(); input.messages = [message('m1', 'route-b'), message('m2', 'route-a', 'm1')];
  assert.throws(() => decode(input));
  input.messages = [message('m2', 'route-a', 'm2')]; assert.throws(() => decode(input));
});
