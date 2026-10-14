import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const key = 'ynx.media.display.v1';
const sources = ['.', '../creator-studio', '../music/web'];

async function loadSettings(directory, saved = 'compact', headerAvailable = true) {
  const stored = new Map([[key, saved], ['wallet.session', 'retained-account']]);
  const reads = [], writes = [], listeners = new Map();
  let readBlocked = false;
  class Element {
    children = []; options = []; value = ''; dataset = {};
    append(...nodes) { this.children.push(...nodes); if (this.tag === 'select') this.options.push(...nodes); }
    setAttribute() {}
    showModal() {}
    close() {}
  }
  const header = new Element(), head = new Element(), body = new Element();
  const document = {
    documentElement: {dataset: {}, lang: 'en'}, head, body,
    querySelector: () => headerAvailable ? header : null,
    createElement(tag) { const node = new Element(); node.tag = tag; return node; },
  };
  const localStorage = {
    getItem(name) { reads.push(name); if (readBlocked) throw Error('storage unavailable'); return stored.get(name) ?? null; },
    setItem(name, value) { writes.push(name); stored.set(name, value); },
  };
  const window = {addEventListener(name, handler) { const rows = listeners.get(name) ?? []; rows.push(handler); listeners.set(name, rows); }};
  const url = new URL(`${directory}/display-settings.js`, import.meta.url);
  const context = vm.createContext({document, window, localStorage, URL, MutationObserver: class {observe() {}}});
  const module = new vm.SourceTextModule(await readFile(url, 'utf8'), {context, initializeImportMeta(meta) {meta.url = url.href;}});
  await module.link(() => {throw Error('unexpected dependency');});
  await module.evaluate();
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const select = descendants(body).find(node => node.id === 'media-text-size');
  if (headerAvailable) assert.ok(select);
  return {
    document, select, stored, reads, writes,
    blockReads() { readBlocked = true; },
    fire(name, event = {}) { for (const handler of listeners.get(name) ?? []) handler(event); },
    storageEvent(name = key, area = localStorage) { for (const handler of listeners.get('storage') ?? []) handler({key: name, storageArea: area}); },
  };
}

for (const directory of sources) {
  test(`${directory}: saves settings and restores the saved selection on reopen`, async () => {
    const first = await loadSettings(directory);
    assert.equal(first.document.documentElement.dataset.mediaTextSize, 'compact');
    first.select.value = 'larger'; first.select.onchange();
    assert.equal(first.stored.get(key), 'larger');
    assert.deepEqual(first.writes, [key]);
    const reopened = await loadSettings(directory, first.stored.get(key));
    assert.equal(reopened.document.documentElement.dataset.mediaTextSize, 'larger');
    assert.equal(reopened.select.value, 'larger');
  });
  test(`${directory}: cross-tab edits and browser return update page and selection`, async () => {
    const page = await loadSettings(directory);
    page.stored.set(key, 'larger'); page.storageEvent();
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'larger');
    assert.equal(page.select.value, 'larger');
    page.stored.set(key, 'standard'); page.fire('pageshow', {persisted: true});
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'standard');
    assert.equal(page.select.value, 'standard');
    assert.deepEqual(page.writes, []);
  });
  test(`${directory}: callback without a settings menu restores its saved text size`, async () => {
    const page = await loadSettings(directory, 'compact', false);
    assert.equal(page.select, undefined);
    page.stored.set(key, 'larger'); page.storageEvent();
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'larger');
    page.stored.set(key, 'standard'); page.fire('pageshow', {persisted: true});
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'standard');
  });
  test(`${directory}: ignores other storage, resets removed preferences, tolerates blocked storage`, async () => {
    const page = await loadSettings(directory), reads = page.reads.length;
    page.stored.set(key, 'larger');
    page.storageEvent('wallet.session'); page.storageEvent(key, {});
    assert.equal(page.reads.length, reads);
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'compact');
    page.stored.delete(key); page.storageEvent(null);
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'standard');
    page.select.value = 'larger'; page.select.onchange();
    page.blockReads(); page.fire('pageshow', {persisted: true});
    assert.equal(page.document.documentElement.dataset.mediaTextSize, 'larger');
    assert.equal(page.select.value, 'larger');
    assert.ok(page.reads.every(name => name === key));
    assert.equal(page.stored.get('wallet.session'), 'retained-account');
  });
}
