import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifiedWalletDownloads, suggestedWalletDownload} from './wallet-downloads.js';
const manifestText = await readFile(new URL('./wallet-download-manifest.json', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestText);
const preview = JSON.parse(await readFile(new URL('./wallet-download-preview.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

test('every publisher-approved SDK artifact is selected exactly; PWA archives never become installs', () => {
  const artifacts = verifiedWalletDownloads(manifestText, preview);
  assert.equal(artifacts.length, manifest.artifacts.length);
  assert(artifacts.every(row => row.status === 'published' && row.platform !== 'pwa-archive' && row.browser !== 'firefox'));
  for (const row of artifacts) assert.equal(row.url, preview.artifacts.find(item => item.id === row.id).url);
});
for (const field of ['url','sha256','bytes','sourceCommit','filename','platform','architecture','installation']) test(`a publisher evidence mismatch in ${field} cannot expose a download`, () => {
  const input = clone(preview), row = input.artifacts.find(item => item.id === manifest.artifacts[0].id);
  row[field] = field === 'bytes' ? row.bytes + 1 : 'mismatch';
  assert(!verifiedWalletDownloads(manifest, input).some(item => item.id === row.id));
});
for (const [field, value] of [['browser', 'firefox'], ['mimeType', 'text/html']]) test(`Chromium evidence must bind ${field}`, () => {
  const input = clone(preview);
  const artifact = manifest.artifacts.find(item => item.browser === 'chromium');
  input.artifacts.find(item => item.id === artifact.id)[field] = value;
  assert(!verifiedWalletDownloads(manifest, input).some(item => item.id === artifact.id));
});
test('unverified, duplicate and unpublished evidence cannot enable the link', () => {
  for (const field of ['published','publicDownloadVerified']) {
    const input = clone(preview); input.artifacts.forEach(row => {row[field] = false;});
    assert.deepEqual(verifiedWalletDownloads(manifest, input), []);
  }
  assert.throws(() => verifiedWalletDownloads(manifest, {...preview,artifacts:[...preview.artifacts,preview.artifacts[0]]}));
  const local = clone(manifest);local.artifacts.forEach(row => {row.status='local-only';row.url=null;});
  assert.deepEqual(verifiedWalletDownloads(local, preview), []);
});
test('a manifest cannot substitute a website URL or unknown artifact format', () => {
  const website=clone(manifest);website.artifacts[0].url='https://www.ynxweb4.com/dapp/download';
  assert.throws(() => verifiedWalletDownloads(website, preview));
  const pwa=clone(manifest);pwa.artifacts[0].installation='zip-archive';
  assert.throws(() => verifiedWalletDownloads(pwa, preview));
});
test('default device hints are conservative and never imply installation', () => {
  const artifacts=verifiedWalletDownloads(manifest,preview);
  const mac=artifacts.find(row=>row.platform==='macos'&&row.architecture==='universal');
  assert.equal(suggestedWalletDownload(artifacts,{platform:'MacIntel',userAgent:'Macintosh Chrome/140',maxTouchPoints:0}),mac.id);
  assert.equal(suggestedWalletDownload(artifacts,{platform:'MacIntel',userAgent:'Macintosh',maxTouchPoints:5}),null);
  assert.equal(suggestedWalletDownload(artifacts,{userAgent:'iPhone'}),null);
  assert.equal(suggestedWalletDownload(artifacts,{platform:'Linux x86_64',userAgent:'Linux'}),null);
  assert.equal(suggestedWalletDownload(artifacts,{platform:'Win32',userAgent:'Windows NT 10.0; Win64; x64'}),null);
  const chromium=artifacts.find(row=>row.browser==='chromium');
  assert.equal(suggestedWalletDownload(artifacts,{userAgent:'Chrome/140'}),chromium.id);
  assert.equal(suggestedWalletDownload(artifacts,{userAgent:'Firefox/140'}),null);
  assert.equal(suggestedWalletDownload(artifacts,{userAgent:'Android'}),artifacts.find(row=>row.platform==='android'&&row.architecture==='universal').id);
});
