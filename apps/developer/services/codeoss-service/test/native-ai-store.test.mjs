import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createNativeAIStore, NATIVE_AI_LIMITS } from '../src/native-ai-store.mjs';

const moduleURL = new URL('../src/native-ai-store.mjs', import.meta.url).href;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-native-ai-store-'));
  const options = { filename: join(directory, 'conversations.sqlite'), keyPath: join(directory, 'content.key') };
  const stores = [];
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, options, open(extra) { const store = createNativeAIStore({ ...options, ...extra }); stores.push(store); return store; } };
}
const input = (extra = {}) => ({ owner: 'verified-owner-A', projectId: 'project-A', prompt: 'Explain the selected code', context: 'const value = 7;', model: 'qwen3:4b', ...extra });

test('real SQLite saves and reopens encrypted complete responses with project-scoped metadata', t => {
  const f = fixture(t); let time = 1000;
  const store = f.open({ now: () => time });
  const created = store.create(input({ prompt: 'SECRET_PROMPT_选择语境', context: 'SECRET_CONTEXT_owned source' }));
  assert.match(created.id, /^[0-9a-f-]{36}$/); assert.equal(created.status, 'generating');
  assert.equal(created.createdAt, new Date(1000).toISOString());
  time = 2000;
  const complete = store.complete('verified-owner-A', 'project-A', created.id, { text: 'SECRET_ANSWER_这是解释', model: 'qwen3:4b' });
  assert.equal(complete.status, 'completed'); assert.equal(complete.text, 'SECRET_ANSWER_这是解释');
  assert.equal(complete.updatedAt, new Date(2000).toISOString());
  const listed = store.list('verified-owner-A', 'project-A');
  assert.deepEqual(Object.keys(listed[0]).sort(), ['createdAt', 'id', 'model', 'status', 'updatedAt']);
  assert.equal(listed[0].id, created.id);
  assert.equal(statSync(f.options.keyPath).mode & 0o777, 0o600);
  assert.equal(statSync(f.options.keyPath).size, 32);
  for (const name of readdirSync(f.directory)) {
    const bytes = readFileSync(join(f.directory, name));
    for (const marker of ['SECRET_PROMPT_', 'SECRET_CONTEXT_', 'SECRET_ANSWER_', '选择语境', '这是解释'])
      assert.equal(bytes.includes(Buffer.from(marker)), false, `cleartext marker persisted in ${name}`);
  }
  store.close();
  assert.deepEqual(f.open().get('verified-owner-A', 'project-A', created.id), complete);
});

test('other owners and projects cannot read, list, finish or fail a conversation', t => {
  const store = fixture(t).open(), created = store.create(input());
  for (const [owner, project] of [['verified-owner-B', 'project-A'], ['verified-owner-A', 'project-B']]) {
    assert.equal(store.get(owner, project, created.id), null); assert.deepEqual(store.list(owner, project), []);
    assert.throws(() => store.complete(owner, project, created.id, { text: 'other answer', model: 'qwen3:4b' }), { code: 'native_ai_conversation_not_found' });
    assert.throws(() => store.fail(owner, project, created.id, { code: 'unauthorized' }), { code: 'native_ai_conversation_not_found' });
  }
  assert.equal(store.get('verified-owner-A', 'project-A', created.id).status, 'generating');
});

test('terminal responses are immutable and close/reopen marks unfinished requests interrupted', t => {
  const f = fixture(t), store = f.open(), completed = store.create(input());
  store.complete('verified-owner-A', 'project-A', completed.id, { text: 'final answer', model: 'qwen3:4b' });
  const failed = store.create(input()); store.fail('verified-owner-A', 'project-A', failed.id, { code: 'model_timeout' });
  const pending = store.create(input()); store.close();
  const reopened = f.open();
  assert.equal(reopened.get('verified-owner-A', 'project-A', pending.id).status, 'interrupted');
  assert.equal(reopened.get('verified-owner-A', 'project-A', pending.id).text, undefined);
  assert.equal(reopened.get('verified-owner-A', 'project-A', failed.id).code, 'model_timeout');
  for (const id of [completed.id, failed.id, pending.id]) {
    assert.throws(() => reopened.complete('verified-owner-A', 'project-A', id, { text: 'late replacement', model: 'qwen3:4b' }), { code: 'native_ai_conversation_terminal' });
    assert.throws(() => reopened.fail('verified-owner-A', 'project-A', id, { code: 'late_failure' }), { code: 'native_ai_conversation_terminal' });
  }
  assert.equal(reopened.get('verified-owner-A', 'project-A', completed.id).text, 'final answer');
});

test('missing content key fails before opening or resetting an existing database', t => {
  const f = fixture(t), store = f.open(), value = store.create(input());
  store.complete('verified-owner-A', 'project-A', value.id, { text: 'must survive', model: 'qwen3:4b' }); store.close();
  const key = readFileSync(f.options.keyPath), database = readFileSync(f.options.filename); unlinkSync(f.options.keyPath);
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_key_missing' });
  assert.deepEqual(readFileSync(f.options.filename), database);
  writeFileSync(f.options.keyPath, key, { mode: 0o600 });
  assert.equal(f.open().get('verified-owner-A', 'project-A', value.id).text, 'must survive');
});

test('key permissions, symlinks, wrong lengths and wrong key bytes fail without replacing files', t => {
  const f = fixture(t), store = f.open(), value = store.create(input()); store.close();
  const key = readFileSync(f.options.keyPath);
  chmodSync(f.options.keyPath, 0o644);
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_store_configuration' });
  chmodSync(f.options.keyPath, 0o600);
  writeFileSync(f.options.keyPath, Buffer.alloc(31));
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_key_invalid' });
  writeFileSync(f.options.keyPath, randomBytes(32));
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_content_invalid' });
  unlinkSync(f.options.keyPath); const outsideKey = join(f.directory, 'other-key'); writeFileSync(outsideKey, key, { mode: 0o600 }); symlinkSync(outsideKey, f.options.keyPath);
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_store_configuration' });
  assert.deepEqual(readFileSync(outsideKey), key);
  unlinkSync(f.options.keyPath); writeFileSync(f.options.keyPath, key, { mode: 0o600 });
  assert.equal(f.open().get('verified-owner-A', 'project-A', value.id).status, 'interrupted');
});

test('ciphertext cannot be moved across owner, project or conversation AAD bindings', t => {
  const f = fixture(t), store = f.open();
  const a = store.create(input()); store.complete('verified-owner-A', 'project-A', a.id, { text: 'A-only answer', model: 'qwen3:4b' });
  const b = store.create(input({ owner: 'verified-owner-B', projectId: 'project-B' }));
  store.complete('verified-owner-B', 'project-B', b.id, { text: 'B-only answer', model: 'qwen3:4b' });
  const db = new DatabaseSync(f.options.filename);
  try {
    const sealed = db.prepare('SELECT sealed FROM native_ai_conversations WHERE id=?').get(a.id).sealed;
    db.prepare('UPDATE native_ai_conversations SET sealed=? WHERE id=?').run(sealed, b.id);
  } finally { db.close(); }
  assert.throws(() => store.get('verified-owner-B', 'project-B', b.id), { code: 'native_ai_content_invalid' });
  assert.equal(store.get('verified-owner-A', 'project-A', a.id).text, 'A-only answer');
  assert.equal(store.list('verified-owner-B', 'project-B')[0].id, b.id, 'listing does not decrypt conversation bodies');
});

test('same-process second store is refused before changing a live generation', t => {
  const f = fixture(t), store = f.open(), current = store.create(input());
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_store_busy' });
  assert.equal(store.get('verified-owner-A', 'project-A', current.id).status, 'generating');
  store.complete('verified-owner-A', 'project-A', current.id, { text: 'original process completed', model: 'qwen3:4b' });
});

test('live child owner blocks takeover; a dead child generation is interrupted on recovery', async t => {
  const f = fixture(t);
  const script = `import { createNativeAIStore } from ${JSON.stringify(moduleURL)};
    const store = createNativeAIStore(JSON.parse(process.argv[1]));
    const record = store.create(${JSON.stringify(input())});
    process.stdout.write(JSON.stringify({id:record.id})+'\\n');
    setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(f.options)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stopped = false;
  t.after(async () => { if (!stopped && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } });
  const id = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error(`Child did not acquire storage: ${errors}`)), 5000);
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`Child exited before readiness: ${errors}`)); });
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.trim()).id); } });
  });
  assert.throws(() => createNativeAIStore(f.options), { code: 'native_ai_store_busy' });
  const db = new DatabaseSync(f.options.filename);
  try { assert.equal(db.prepare('SELECT status FROM native_ai_conversations WHERE id=?').get(id).status, 'generating'); } finally { db.close(); }
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; stopped = true;
  const recovered = f.open();
  assert.equal(recovered.get('verified-owner-A', 'project-A', id).status, 'interrupted');
  assert.throws(() => recovered.complete('verified-owner-A', 'project-A', id, { text: 'late answer', model: 'qwen3:4b' }), { code: 'native_ai_conversation_terminal' });
});

test('UTF-8 input and output bounds reject oversize without overwriting a pending result', t => {
  const store = fixture(t).open();
  for (const changes of [{ prompt: '汉'.repeat(1366) }, { context: 'x'.repeat(NATIVE_AI_LIMITS.contextBytes + 1) }, { owner: '' }, { projectId: '../other' }])
    assert.throws(() => store.create(input(changes)), { code: 'native_ai_store_input' });
  const created = store.create(input({ context: 'x'.repeat(NATIVE_AI_LIMITS.contextBytes) }));
  assert.throws(() => store.complete('verified-owner-A', 'project-A', created.id, { text: 'x'.repeat(NATIVE_AI_LIMITS.answerBytes + 1), model: 'qwen3:4b' }), { code: 'native_ai_store_input' });
  assert.equal(store.get('verified-owner-A', 'project-A', created.id).status, 'generating');
  // Valid control characters exercise JSON's largest expansion inside the
  // encrypted envelope. The accepted request's reservation must cover it.
  const answer = '\u0001'.repeat(NATIVE_AI_LIMITS.answerBytes);
  assert.equal(store.complete('verified-owner-A', 'project-A', created.id, { text: answer, model: 'qwen3:4b' }).text, answer);
});

test('owner can delete terminal conversations while live, cross-owner and cross-project records remain protected', t => {
  const f = fixture(t), store = f.open(), completed = store.create(input());
  store.complete('verified-owner-A', 'project-A', completed.id, { text: 'saved answer', model: 'qwen3:4b' });
  for (const [owner, project] of [['verified-owner-B', 'project-A'], ['verified-owner-A', 'project-B']]) {
    assert.throws(() => store.remove(owner, project, completed.id), { code: 'native_ai_conversation_not_found', status: 404 });
    assert.equal(store.get('verified-owner-A', 'project-A', completed.id).text, 'saved answer');
  }
  assert.equal(store.remove('verified-owner-A', 'project-A', completed.id), true);
  assert.equal(store.get('verified-owner-A', 'project-A', completed.id), null);
  assert.deepEqual(store.list('verified-owner-A', 'project-A'), []);
  assert.throws(() => store.remove('verified-owner-A', 'project-A', completed.id), { code: 'native_ai_conversation_not_found', status: 404 });
  const failed = store.create(input()); store.fail('verified-owner-A', 'project-A', failed.id, { code: 'model_timeout' });
  assert.equal(store.remove('verified-owner-A', 'project-A', failed.id), true);
  const pending = store.create(input());
  assert.throws(() => store.remove('verified-owner-A', 'project-A', pending.id), { code: 'native_ai_conversation_generating', status: 409 });
  assert.equal(store.get('verified-owner-A', 'project-A', pending.id).status, 'generating');
  store.close();
  const reopened = f.open();
  assert.equal(reopened.get('verified-owner-A', 'project-A', completed.id), null);
  assert.equal(reopened.get('verified-owner-A', 'project-A', failed.id), null);
  assert.equal(reopened.get('verified-owner-A', 'project-A', pending.id).status, 'interrupted');
  assert.equal(reopened.remove('verified-owner-A', 'project-A', pending.id), true);
  reopened.close();
  assert.deepEqual(f.open().list('verified-owner-A', 'project-A'), []);
});

test('record and byte reservations are bounded, preserve existing data and release after failure', t => {
  const store = fixture(t).open(), pending = store.create(input());
  assert.throws(() => store.create(input()), { code: 'native_ai_store_capacity' });
  store.fail('verified-owner-A', 'project-A', pending.id, { code: 'model_timeout' });
  for (let index = 1; index < NATIVE_AI_LIMITS.projectRecords; index++) {
    const value = store.create(input());
    store.complete('verified-owner-A', 'project-A', value.id, { text: 'saved', model: 'qwen3:4b' });
  }
  assert.throws(() => store.create(input()), { code: 'native_ai_store_capacity' });
  assert.equal(store.list('verified-owner-A', 'project-A').length, NATIVE_AI_LIMITS.projectRecords);
  assert.equal(store.get('verified-owner-A', 'project-A', pending.id).code, 'model_timeout');
  assert.equal(store.remove('verified-owner-A', 'project-A', pending.id), true);
  assert.equal(store.get('verified-owner-A', 'project-A', pending.id), null);
  assert.equal(store.create(input()).status, 'generating', 'explicit deletion frees a full project slot');
  assert.equal(store.list('verified-owner-A', 'project-A').length, NATIVE_AI_LIMITS.projectRecords);
  assert.equal(store.create(input({ projectId: 'project-B' })).status, 'generating');
});
