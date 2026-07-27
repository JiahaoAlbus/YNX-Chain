import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('seller UI wires operations instead of navigation shells', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  for (const text of ['Catalog', 'Orders', 'Returns & refunds', 'Settlements', 'Store & policy', 'Roles', 'Audit', 'authoritative Pay settlement evidence', 'Store onboarding']) assert.ok(html.includes(text), text);
  for (const path of ['/seller/stores', '/seller/products', '/seller/inventory', '/seller/settlements', '/seller/audit', '/roles', '/revoke', '/seller/invitations', '/invitations', '/accept', '/cancel', '/orders', '/transition', '/ai/jobs']) assert.ok(js.includes(path), path);
  for (const action of ['Publish explicitly', 'shipped', 'return_approved', 'return_rejected', 'refund_approved', 'refund_rejected']) assert.ok(js.includes(action), action);
  for (const workflow of ['catalog_creation', 'fulfillment_triage']) assert.ok(js.includes(workflow), workflow);
  for (const role of ['admin', 'catalog', 'inventory', 'fulfillment', 'finance', 'support', 'viewer']) assert.ok(html.includes(`<option>${role}</option>`), role);
  for (const status of ['confirmed', 'unavailable', 'rejected']) assert.ok(js.includes(status), status);
  for (const boundary of ['Local Seller authority is removed immediately', 'Central Wallet session invalidation', 'target canonical Wallet account', 'grants no authority until that account accepts it once', 'Cancellation is permanent']) assert.ok(html.includes(boundary), boundary);
  for (const dialog of ['roleDialog', 'revokeRoleDialog', 'cancelInvitationDialog']) assert.ok(html.includes(`id="${dialog}"`), dialog);
  for (const action of ['data-revoke-role', 'data-accept-invitation', 'data-cancel-invitation']) assert.ok(js.includes(action), action);
  for (const status of ['pending', 'accepted', 'cancelled', 'expired']) assert.ok(js.includes(status), status);
  assert.ok(js.includes('ExpiresInMinutes'));
  assert.ok(!html.includes('<option>manager</option>'));
});
