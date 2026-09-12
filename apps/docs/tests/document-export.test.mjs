import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsLocalExport} from '../web/document-export.js';
const snapshot = {id: 'doc-1', name: '../Notes', version: 3, content: '<script>alert(1)</script>\n& draft'};

test('HTML export escapes document content and title instead of creating executable markup', () => {
  const result = createDocsLocalExport(snapshot, 'html');
  assert.ok(result.body.includes('&lt;script&gt;'));
  assert.ok(!result.body.includes('<script>'));
  assert.ok(!result.filename.includes('/'));
  assert.ok(result.filename.endsWith('-v3.html'));
});

test('plain-text and JSON exports preserve the supplied saved snapshot', () => {
  assert.equal(createDocsLocalExport(snapshot, 'text').body, snapshot.content);
  assert.deepEqual(JSON.parse(createDocsLocalExport(snapshot, 'json').body), snapshot);
});

test('unsupported PDF and missing saved version are not fabricated', () => {
  assert.throws(() => createDocsLocalExport(snapshot, 'pdf'), /Unsupported/);
  assert.throws(() => createDocsLocalExport({...snapshot, version: 0}, 'text'), /saved document version/);
});
