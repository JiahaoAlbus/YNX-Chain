import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const web = new URL('../web/', import.meta.url);
const read = (name) => readFile(new URL(name, web), 'utf8');

test('Docs protects autosave with version and explicit conflict recovery', async () => {
  const js = await read('app-secure.js');
  assert.match(js, /baseVersion/);
  assert.match(js, /status===409/);
  assert.match(js, /offline draft/i);
  assert.match(js, /nothing was overwritten/i);
  assert.match(js, /localStorage/);
});

test('Docs production entry excludes loopback credentials and insecure DOM rendering', async () => {
  const [html, js] = await Promise.all([read('index.html'), read('app-secure.js')]);
  assert.match(html, /app-secure\.js/);
  assert.doesNotMatch(html, /src="app\.js"/);
  assert.doesNotMatch(js, /dev-signed|local-smoke|loopback smoke|[?&]dev=/i);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /requestSession/);
  assert.match(js, /does not accept recovery keys/i);
});

test('Docs exposes folders, object operations, export evidence, versions and comment threads', async () => {
  const [html, js] = await Promise.all([read('index.html'), read('app-secure.js')]);
  for (const id of ['new-folder', 'folder-up', 'duplicate', 'move', 'trash', 'export-format']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const required of [
    'parentId',
    "method: 'PATCH'",
    '/duplicate',
    '/export?format=',
    '/resolution',
    '/versions/',
    'Restore as new version',
    'selectedAnchor',
  ]) {
    assert.ok(js.includes(required), `missing ${required}`);
  }
});
