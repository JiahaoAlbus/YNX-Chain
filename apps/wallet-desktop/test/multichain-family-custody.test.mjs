import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FamilyCustody } from '../src/multichain-family-custody.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const input = { id, family: 'bitcoin', networkId: 'testnet4', account: 'PUBLIC-QA', request: { to: 'PUBLIC-recipient', amount: '1', fee: '2' }, outpoints: ['a'.repeat(64) + ':0'] };
const result = { raw: 'PUBLIC-fixture-transaction', txid: 'b'.repeat(64) };
const verifyResult = (record, value) => { assert.equal(record.request.amount, '1'); assert.deepEqual(value, result); };
async function setup() { const dir = await mkdtemp(path.join(tmpdir(), 'ynx-family-custody-public-')); const filePath = path.join(dir, 'ledger.json'); return { filePath, journal: new FamilyCustody({ filePath, verifyResult }) }; }

test('signing fence is durable before signer; reopen is unknown and has no replay permit', async () => {
  const { journal, filePath } = await setup(); const permit = await journal.reserve(input);
  await permit.beginSigning(); assert.equal(JSON.parse(await readFile(filePath, 'utf8')).records[0].state, 'signing');
  const reopened = new FamilyCustody({ filePath, verifyResult });
  assert.equal((await reopened.list())[0].state, 'unknown');
  await assert.rejects(reopened.reserve({ ...input, id: '00000000-0000-4000-8000-000000000002' }));
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.throws(() => permit.capture({ privateKey: 'PUBLIC-DO-NOT-STORE' }));
});
test('exact produced tuple persists and survives reopen; duplicate capture and repeated signing reject', async () => {
  const { journal, filePath } = await setup(); const permit = await journal.reserve(input);
  await permit.beginSigning(); permit.capture(result); assert.throws(() => permit.capture(result));
  await assert.rejects(permit.beginSigning()); await permit.saveProduced();
  const reopened = new FamilyCustody({ filePath, verifyResult });
  const r = (await reopened.list())[0]; assert.equal(r.state, 'signed-unsubmitted'); assert.deepEqual(r.result, result);
  await assert.rejects(reopened.reserve({ ...input, account: 'different-account', id: '00000000-0000-4000-8000-000000000002' }));
  await permit.markSubmissionStarted(); assert.equal((await reopened.list())[0].state, 'submitted-unconfirmed');
  await permit.uncertain(); assert.equal((await reopened.list())[0].state, 'unknown'); assert.deepEqual((await reopened.list())[0].result, result);
});
test('failed produced save retains process hold, durable signing fence blocks after restart', async () => {
  const { journal, filePath } = await setup(); const permit = await journal.reserve(input); await permit.beginSigning(); permit.capture(result);
  const mutate = journal.file.mutate.bind(journal.file); journal.file.mutate = async () => { throw Error('PUBLIC injected disk outage'); };
  await assert.rejects(permit.saveProduced()); const held = (await journal.list())[0]; assert.equal(held.state, 'unknown'); assert.deepEqual(held.result, result);
  const reopened = new FamilyCustody({ filePath, verifyResult }); assert.equal((await reopened.list())[0].state, 'unknown'); assert.equal((await reopened.list())[0].result, null);
  journal.file.mutate = mutate; await permit.uncertain(); assert.deepEqual((await reopened.list())[0].result, result);
});
test('pre-sign cancellation persists, post-sign cancellation cannot relabel original request', async () => {
  const { journal } = await setup(); const permit = await journal.reserve(input); await permit.cancelBeforeSigning();
  assert.equal((await journal.list())[0].state, 'cancelled'); await assert.rejects(permit.beginSigning());
  const next = await journal.reserve({ ...input, id: '00000000-0000-4000-8000-000000000002' }); await next.beginSigning(); await assert.rejects(next.cancelBeforeSigning());
});
test('failed fence write never arms capture; no success reported after ambiguous save', async () => {
  const { journal } = await setup(); const permit = await journal.reserve(input); journal.file.mutate = async () => { throw Error('PUBLIC fence write rejected'); };
  await assert.rejects(permit.beginSigning()); assert.throws(() => permit.capture(result)); await assert.rejects(permit.beginSigning());
});
test('missing verifier and secret-bearing request fail closed without changing existing ledger', async () => {
  assert.throws(() => new FamilyCustody({ filePath: 'unused' })); const { journal, filePath } = await setup(); await journal.reserve(input);
  const before = await readFile(filePath, 'utf8'); await assert.rejects(journal.reserve({ ...input, request: { mnemonic: 'PUBLIC rejected placeholder' } }));
  assert.equal(await readFile(filePath, 'utf8'), before);
});
