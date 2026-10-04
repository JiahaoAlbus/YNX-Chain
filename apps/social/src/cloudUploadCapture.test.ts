import assert from 'node:assert/strict';
import test from 'node:test';
import { SocialCloudAttachments, ciphertextHash, type CloudObjectRecord } from './cloudAttachments';
import type { SocialAPI } from './api';
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(size = 17) {
  const bytes = new Uint8Array(size).fill(71), expected = bytes.slice();
  const record: CloudObjectRecord = { objectId: `object_${'a'.repeat(32)}`, uploadId: `upload_${'b'.repeat(32)}`,
    conversationId: 'original-conversation', totalCiphertextBytes: bytes.length, sha256: ciphertextHash(bytes) };
  const expectedRecord = { ...record }, waiting = gate(), finish = gate();
  const uploaded: Uint8Array[] = [], urls: string[] = []; let held = true;
  const api: Pick<SocialAPI, 'request'> = { async request<T>(_path: string, options?: Parameters<SocialAPI['request']>[1]): Promise<T> {
    const body = options?.body as { operation: string };
    if (body.operation === 'upload.create' && held) { held = false; waiting.resolve(); await finish.promise; }
    return { capability: `ynx-social-object-v1.${body.operation}`, operation: body.operation,
      objectId: expectedRecord.objectId, uploadId: expectedRecord.uploadId } as T;
  } };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); urls.push(url);
    if (url.includes('/parts/')) {
      const part = new Uint8Array(init?.body as ArrayBuffer); uploaded.push(part.slice());
      assert.equal(new Headers(init?.headers).get('X-Ciphertext-SHA256'), ciphertextHash(part));
    }
    return new Response(JSON.stringify({ ...expectedRecord, status: url.endsWith('/complete') ? 'complete' : 'uploading',
      partBytes: 1024 * 1024, acceptedParts: {} }));
  };
  const client = new SocialCloudAttachments(api, 'https://cloud.example', transport);
  return { bytes, expected, record, expectedRecord, waiting, finish, uploaded, urls, client };
}
function joined(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
test('upload retains exact initial ciphertext while the original capability request awaits', async () => {
  const f = fixture(); const upload = f.client.upload(f.record, f.bytes); await f.waiting.promise;
  f.bytes.fill(9); f.finish.resolve(); await upload;
  assert.deepEqual(joined(f.uploaded), f.expected); assert.equal(ciphertextHash(joined(f.uploaded)), f.expectedRecord.sha256);
  assert.equal(f.bytes[0], 9);
});
test('caller record mutation during capability await does not retarget or abort the original upload', async () => {
  const f = fixture(); const upload = f.client.upload(f.record, f.bytes); await f.waiting.promise;
  f.record.objectId = `object_${'c'.repeat(32)}`; f.record.uploadId = `upload_${'d'.repeat(32)}`;
  f.record.conversationId = 'replacement-conversation'; f.record.sha256 = 'e'.repeat(64); f.record.totalCiphertextBytes = 999;
  f.finish.resolve(); await upload;
  assert.deepEqual(joined(f.uploaded), f.expected);
  assert.ok(f.urls.every(url => !url.includes(f.record.uploadId)));
  assert.ok(f.urls.some(url => url.includes(f.expectedRecord.uploadId)));
  assert.equal(Object.isFrozen(f.record), false);
});
test('progress callback mutation cannot change later multipart ciphertext or retry metadata', async () => {
  const f = fixture(1024 * 1024 + 7), progress: Array<[number, number]> = [];
  const upload = f.client.upload(f.record, f.bytes, (sent, total) => { progress.push([sent, total]); f.bytes.fill(9, 1024 * 1024); });
  await f.waiting.promise; f.finish.resolve(); await upload;
  assert.deepEqual(joined(f.uploaded), f.expected); assert.deepEqual(progress, [[1024 * 1024, f.expected.length], [f.expected.length, f.expected.length]]);
});
