import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat, lstat, readlink, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateAssets, verifyAssets, verifyAppBranding, createBrandedDmg, createDmgMountWorkspace } from './package-macos-branding.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url))), sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'darwin') throw Error('Run actual macOS branding tests on macOS.');
const fixture = await mkdtemp(join(tmpdir(), 'ynx-native-branding-')), assets = join(fixture, 'assets');
const manifest = await generateAssets(assets);
console.log('Retained branding fixture:', fixture);
function readStore(bytes) {
  assert.equal(bytes.readUInt32BE(0), 1); assert.equal(bytes.toString('ascii', 4, 8), 'Bud1');
  const rootAt = bytes.readUInt32BE(8) + 4, rootSize = bytes.readUInt32BE(12); assert.equal(bytes.readUInt32BE(16) + 4, rootAt);
  assert.ok(rootAt + rootSize <= bytes.length); const count = bytes.readUInt32BE(rootAt); assert.equal(count, 3);
  const block = id => { const encoded = bytes.readUInt32BE(rootAt + 8 + id * 4), size = 2 ** (encoded & 31), offset = (encoded & ~31) + 4; assert.ok(offset + size <= bytes.length); return { offset, size }; };
  assert.deepEqual(block(0), {offset: rootAt, size: rootSize});
  const toc = rootAt + 8 + Math.ceil(count / 256) * 1024; assert.equal(bytes.readUInt32BE(toc), 1); assert.equal(bytes[toc+4], 4); assert.equal(bytes.toString('ascii',toc+5,toc+9), 'DSDB');
  const db = block(bytes.readUInt32BE(toc+9)), leaf = block(bytes.readUInt32BE(db.offset)); assert.equal(bytes.readUInt32BE(db.offset + 4), 0);
  assert.equal(bytes.readUInt32BE(leaf.offset), 0); const records = bytes.readUInt32BE(leaf.offset + 4); assert.equal(records, bytes.readUInt32BE(db.offset + 8));
  let p = leaf.offset + 8; const result = [];
  for (let i = 0; i < records; i++) {
    const length = bytes.readUInt32BE(p); p += 4; const chars = Buffer.from(bytes.subarray(p, p + length * 2)); chars.swap16(); p += length * 2;
    const code = bytes.toString('ascii', p, p + 4), type = bytes.toString('ascii', p + 4, p + 8); p += 8;
    const size = type === 'blob' ? bytes.readUInt32BE(p) : 4; if (type === 'blob') p += 4;
    result.push({ name: chars.toString('utf16le'), code, type, data: bytes.subarray(p, p + size) }); p += size;
  }
  assert.ok(p <= leaf.offset + leaf.size); return result;
}

test('original logo/icon identity and actual complete icns/PNG assets', async () => {
  for (const input of Object.values(manifest.sourceInputs)) assert.equal(input.sha256, sha(await readFile(join(root, input.path))));
  assert.deepEqual(await verifyAssets(assets), manifest);
  const icon = await readFile(join(assets, 'YNXDeveloper.icns')); assert.equal(icon.toString('ascii', 0, 4), 'icns'); assert.equal(icon.readUInt32BE(4), icon.length);
  let offset = 8, chunks = [];
  while (offset < icon.length) { const size = icon.readUInt32BE(offset + 4); assert.ok(size >= 8); chunks.push(icon.toString('ascii', offset, offset + 4)); offset += size; }
  assert.equal(offset, icon.length); for (const alternatives of [['icp4','ic04'],['icp5','ic05'],['ic07'],['ic08'],['ic09'],['ic10']]) assert.ok(alternatives.some(type => chunks.includes(type)), alternatives.join('/'));
  const decoded = join(fixture, 'decoded.iconset'); execFileSync('/usr/bin/iconutil', ['-c','iconset',join(assets,'YNXDeveloper.icns'),'-o',decoded]);
  for (const size of [16,32,128,256,512]) for (const scale of [1,2]) {
    const file = join(decoded, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), dimensions = execFileSync('/usr/bin/sips', ['-g','pixelWidth','-g','pixelHeight',file], {encoding:'utf8'});
    assert.match(dimensions, new RegExp(`pixelWidth: ${size*scale}\\b`)); assert.match(dimensions, new RegExp(`pixelHeight: ${size*scale}\\b`));
  }
  const info = execFileSync('/usr/bin/sips', ['-g','pixelWidth','-g','pixelHeight',join(assets,'installer-background.png')], { encoding:'utf8' });
  assert.match(info, /pixelWidth: 780/); assert.match(info, /pixelHeight: 520/);
  assert.equal((await stat(join(assets, 'branding-manifest.json'))).mode & 0o777, 0o600);
  const plist = await readFile(join(root, 'desktop/macos/Info.plist'), 'utf8'); assert.match(plist, /CFBundleIconFile<\/key><string>YNXDeveloper\.icns/);
});

test('real small branded image mounts with resolvable background, valid native plists and original assets', async () => {
  const stage = join(fixture, 'stage'); await mkdir(stage); const appName = 'YNX Developer Testnet Preview.app';
  await mkdir(join(stage, appName)); await writeFile(join(stage, appName, 'fixture.txt'), 'Branding fixture only; no executable application.\n');
  const output = join(fixture, 'branding-fixture.dmg'), receipt = await createBrandedDmg({ stage, assets, output, brandingFixture: true });
  assert.equal(receipt.checks.hdiutilVerify, 'PASS'); assert.equal(receipt.checks.mountedNativeBackgroundAlias, 'PASS'); assert.equal(receipt.checks.finderGUI, 'NOT_VERIFIED');
  assert.ok(receipt.mountScratch.path.startsWith('/private/tmp/ynx-dmg-branding-'));
  assert.equal(receipt.mountScratch.imageBytesLocation, fixture);
  const work = await createDmgMountWorkspace(), mount = join(work, 'verify-mount'); await mkdir(mount);
  const workStat = await lstat(work);
  assert.equal(workStat.uid, process.getuid()); assert.equal(workStat.mode & 0o777, 0o700); assert.equal(workStat.isSymbolicLink(), false);
  execFileSync('/usr/bin/hdiutil', ['attach','-readonly','-nobrowse','-noautoopen','-mountpoint',mount,output]);
  try {
    assert.equal(await readlink(join(mount, 'Applications')), '/Applications'); assert.equal((await lstat(join(mount,'.VolumeIcon.icns'))).isFile(), true);
    const store = readStore(await readFile(join(mount, '.DS_Store'))); assert.equal(store.length, 5);
    const view = store.find(row => row.code === 'icvp');
    const extract = key => execFileSync('/usr/bin/plutil', ['-extract',key,'raw','-o','-','--','-'], { input:view.data,encoding:'utf8' }).trim();
    assert.equal(extract('backgroundType'), '2'); assert.equal(extract('iconSize'), '96'); assert.equal(extract('arrangeBy'), 'none');
    assert.equal(store.find(row => row.name === 'Applications').data.readUInt32BE(0), 550); assert.equal(store.find(row => row.name === appName).data.readUInt32BE(0), 230);
    const window = store.find(row => row.code === 'bwsp'), settings = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert','json','-o','-','--','-'], { input:window.data,encoding:'utf8' }));
    assert.equal(settings.WindowBounds, '{{100, 100}, {780, 520}}'); assert.equal(settings.ShowToolbar, false);
    assert.equal(receipt.imageSha256, sha(await readFile(output)));
  } finally { execFileSync('/usr/bin/hdiutil', ['detach', mount]); }
});

test('app resource bytes, Info.plist and source provenance must bind the same logo assets', async () => {
  const app = join(fixture, 'metadata-fixture.app'), resources = join(app, 'Contents/Resources'); await mkdir(resources, {recursive:true});
  await copyFile(join(root, 'desktop/macos/Info.plist'), join(app, 'Contents/Info.plist'));
  for (const name of ['YNXDeveloper.icns','installer-background.png','branding-manifest.json']) await copyFile(join(assets,name),join(resources,name));
  const provenance = {branding:{path:'Contents/Resources/branding-manifest.json',sha256:sha(await readFile(join(resources,'branding-manifest.json')))}};
  await writeFile(join(resources,'build-provenance.json'),JSON.stringify(provenance)); assert.deepEqual(await verifyAppBranding(app),manifest);
  provenance.branding.sha256 = '0'.repeat(64); await writeFile(join(resources,'build-provenance.json'),JSON.stringify(provenance));
  await assert.rejects(verifyAppBranding(app), /branding provenance differs/);
});

test('existing output and altered assets are refused without replacing original bytes', async () => {
  const before = await readFile(join(assets,'YNXDeveloper.icns'));
  await assert.rejects(generateAssets(assets), /EEXIST/); assert.deepEqual(await readFile(join(assets,'YNXDeveloper.icns')), before);
  const bad = join(fixture, 'bad-assets'); await mkdir(bad); await writeFile(join(bad, 'branding-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(bad, 'YNXDeveloper.icns'), Buffer.from('changed'));
  await assert.rejects(verifyAssets(bad), /bytes differ/);
});
