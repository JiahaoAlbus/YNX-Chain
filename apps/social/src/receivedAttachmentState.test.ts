import assert from 'node:assert/strict';
import test from 'node:test';
import { captureReceivedAttachment, completeReceivedAttachment, receivedAttachmentInScope } from './receivedAttachmentState';

test('captured original attachment is visible only in its exact client and event scope', () => {
  const client = {}, target = {}, original = captureReceivedAttachment(client, '$original', target);
  assert.equal(receivedAttachmentInScope(original, client, '$original'), original);
  assert.equal(receivedAttachmentInScope(original, {}, '$original'), undefined);
  assert.equal(receivedAttachmentInScope(original, client, '$next'), undefined);
  assert.equal(receivedAttachmentInScope(undefined, client, '$original'), undefined);
  assert.ok(Object.isFrozen(original));
});

test('old modal close never clears a newer selection of the same event', () => {
  const client = {};
  const original = captureReceivedAttachment(client, '$original', {});
  const replacement = captureReceivedAttachment(client, '$original', {});
  assert.equal(completeReceivedAttachment(replacement, original), replacement);
  assert.equal(completeReceivedAttachment(replacement, replacement), undefined);
});

test('client replacement and error recovery preserve the newly chosen original target', () => {
  const previousClient = {}, currentClient = {};
  const original = captureReceivedAttachment(previousClient, '$original', {});
  const replacement = captureReceivedAttachment(currentClient, '$original', {});
  assert.equal(receivedAttachmentInScope(original, currentClient, '$original'), undefined);
  assert.equal(completeReceivedAttachment(replacement, original), replacement);
  assert.equal(receivedAttachmentInScope(replacement, currentClient, '$original'), replacement);
  assert.equal(completeReceivedAttachment(undefined, original), undefined);
});
