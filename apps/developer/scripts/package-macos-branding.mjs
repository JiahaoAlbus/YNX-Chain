import { readFile, writeFile, mkdir, copyFile, lstat, symlink, mkdtemp, rm, realpath, readdir, readlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
export async function createDmgMountWorkspace() {
  // This host rejects mountpoints on the external build volume. Only the
  // mount view and tiny alias metadata use OS temp; image bytes stay external.
  const base = '/private/tmp', stat = await lstat(base);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(base) !== base
    || stat.uid !== 0 || (stat.mode & 0o1777) !== 0o1777) throw Error('Unsafe system mount scratch root.');
  const work = await mkdtemp(join(base, 'ynx-dmg-branding-'));
  const owned = await lstat(work);
  if (!owned.isDirectory() || owned.isSymbolicLink() || owned.uid !== process.getuid()
    || (owned.mode & 0o777) !== 0o700 || await realpath(work) !== work) throw Error('Unsafe private mount workspace.');
  return work;
}
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const xmlEscape = value => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
function binaryPlist(values) {
  const entries = Object.entries(values).map(([key, value]) => `<key>${xmlEscape(key)}</key>` +
    (Buffer.isBuffer(value) ? `<data>${value.toString('base64')}</data>` : typeof value === 'boolean' ? `<${value}/>` : typeof value === 'number' ? Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>` : `<string>${xmlEscape(value)}</string>`)).join('');
  return run('/usr/bin/plutil', ['-convert', 'binary1', '-o', '-', '--', '-'], { input: `<?xml version="1.0"?><plist version="1.0"><dict>${entries}</dict></plist>` });
}
function dsRecord(name, code, type, value) {
  const nameBytes = Buffer.from(name, 'utf16le'); nameBytes.swap16();
  return Buffer.concat([u32(name.length), nameBytes, Buffer.from(code + type), type === 'blob' ? u32(value.length) : Buffer.alloc(0), value]);
}
/** A bounded single-leaf Finder store. No desktop automation, user store or
 * opaque template is consumed. Offsets are relative to the four-byte prefix;
 * allocator root, DSDB superblock and B-tree leaf occupy disjoint power blocks.
 */
export function finderStore(alias, appName) {
  if (!Buffer.isBuffer(alias) || alias.length < 150 || alias.length > 2048 || !/^[^/\0]+\.app$/.test(appName)) throw Error('Invalid Finder layout input.');
  const records = [
    dsRecord('.', 'bwsp', 'blob', binaryPlist({ ShowStatusBar: false, ShowToolbar: false, ShowSidebar: false, ShowTabView: false, ContainerShowSidebar: false, SidebarWidth: 0, WindowBounds: '{{100, 100}, {780, 520}}' })),
    dsRecord('.', 'icvp', 'blob', binaryPlist({ viewOptionsVersion: 1, backgroundType: 2, backgroundImageAlias: alias, backgroundColorRed: 17/255, backgroundColorGreen: 18/255, backgroundColorBlue: 20/255,
      iconSize: 96, textSize: 13, gridSpacing: 100, gridOffsetX: 0, gridOffsetY: 0, arrangeBy: 'none', labelOnBottom: true, showItemInfo: false, showIconPreview: true })),
    dsRecord('.', 'vstl', 'type', Buffer.from('icnv')),
    dsRecord('Applications', 'Iloc', 'blob', Buffer.concat([u32(550), u32(336), u32(0xffffffff), u32(0xffff0000)])),
    dsRecord(appName, 'Iloc', 'blob', Buffer.concat([u32(230), u32(336), u32(0xffffffff), u32(0xffff0000)])),
  ];
  const leaf = Buffer.concat([u32(0), u32(records.length), ...records]);
  if (leaf.length > 4096) throw Error('Finder layout exceeds its single-leaf bound.');
  const bytes = Buffer.alloc(8196);
  Buffer.concat([u32(1), Buffer.from('Bud1'), u32(2048), u32(2048), u32(2048), Buffer.alloc(16)]).copy(bytes);
  // DSDB block: root node id, tree levels, records, nodes, leaf size.
  Buffer.concat([u32(2), u32(0), u32(records.length), u32(1), u32(4096)]).copy(bytes, 36);
  // The allocator root is itself block0; DSDB TOC points to block1. A leaf
  // root has height0. Confirmed against retained Finder-produced store bytes.
  const table = Buffer.alloc(256 * 4); table.writeUInt32BE(2048 | 11, 0); table.writeUInt32BE(32 | 5, 4); table.writeUInt32BE(4096 | 12, 8);
  const free = [];
  for (let order = 0; order < 32; order++) free.push(order >= 6 && order <= 10 ? Buffer.concat([u32(1), u32(2 ** order)]) : u32(0));
  const root = Buffer.concat([u32(3), u32(0), table, u32(1), Buffer.from([4]), Buffer.from('DSDB'), u32(1), ...free]);
  root.copy(bytes, 2052); leaf.copy(bytes, 4100);
  return bytes;
}
async function regular(path) { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw Error('Regular branding input required: ' + path); return readFile(path); }
async function newDirectory(path) { await mkdir(path, { recursive: false, mode: 0o700 }); }
async function buildTool(root) {
  const tool = join(root, 'macos-brand-assets');
  run('/usr/bin/clang', ['-fobjc-arc', '-mmacosx-version-min=13.5', '-Wno-deprecated-declarations', join(sourceRoot, 'scripts/macos-brand-assets.m'), '-framework', 'Cocoa', '-framework', 'CoreServices', '-o', tool]);
  return tool;
}
export async function generateAssets(output) {
  await newDirectory(output);
  const inputs = { icon: join(sourceRoot, 'native/ynx-brand/ynx-app-icon.png'), logo: join(sourceRoot, 'native/ynx-brand/ynx-logo.png') };
  const original = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([key, path]) => [key, { path: path.slice(sourceRoot.length + 1), sha256: sha(await regular(path)) }])));
  const tool = await buildTool(output); run(tool, ['assets', inputs.icon, inputs.logo, output]);
  run('/usr/bin/iconutil', ['-c', 'icns', join(output, 'YNXDeveloper.iconset'), '-o', join(output, 'YNXDeveloper.icns')]);
  const files = {};
  for (const name of ['YNXDeveloper.icns', 'installer-background.png']) files[name] = sha(await regular(join(output, name)));
  for (const [key, path] of Object.entries(inputs)) if (sha(await regular(path)) !== original[key].sha256) throw Error('Branding input changed during generation.');
  const manifest = { schemaVersion: 1, product: 'YNX Developer', sourceInputs: original, transformation: 'Cocoa resampling/compositing of existing PNGs; no logo redraw', iconSizes: [16,32,64,128,256,512,1024], background: { width: 780, height: 520, base: '#111214', text: '#E8ECF5', accent: '#7399FF' }, files,
    producer: { path: 'scripts/macos-brand-assets.m', sha256: sha(await regular(join(sourceRoot, 'scripts/macos-brand-assets.m'))) },
    coordinator: { path: 'scripts/package-macos-branding.mjs', sha256: sha(await regular(fileURLToPath(import.meta.url))) } };
  await writeFile(join(output, 'branding-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}
export async function verifyAssets(input) {
  const manifest = JSON.parse(await regular(join(input, 'branding-manifest.json')));
  if (manifest.schemaVersion !== 1 || manifest.product !== 'YNX Developer' || Object.keys(manifest.files ?? {}).sort().join(',') !== 'YNXDeveloper.icns,installer-background.png' ||
      Object.keys(manifest.sourceInputs ?? {}).sort().join(',') !== 'icon,logo') throw Error('Invalid branding manifest.');
  for (const [key, path] of [['icon','native/ynx-brand/ynx-app-icon.png'],['logo','native/ynx-brand/ynx-logo.png']]) {
    if (manifest.sourceInputs[key].path !== path || !/^[a-f0-9]{64}$/.test(manifest.sourceInputs[key].sha256)) throw Error('Invalid original branding input provenance.');
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!['YNXDeveloper.icns','installer-background.png'].includes(name) || sha(await regular(join(input, name))) !== expected) throw Error('Brand asset bytes differ: ' + name);
  }
  return manifest;
}
export async function verifyAppBranding(app) {
  const resources = join(app, 'Contents/Resources'), manifest = await verifyAssets(resources);
  if (run('/usr/bin/plutil', ['-extract','CFBundleIconFile','raw','-o','-',join(app,'Contents/Info.plist')], {encoding:'utf8'}).trim() !== 'YNXDeveloper.icns') throw Error('App icon declaration differs.');
  const provenance = JSON.parse(await regular(join(resources, 'build-provenance.json')));
  if (provenance.branding?.path !== 'Contents/Resources/branding-manifest.json' || provenance.branding.sha256 !== sha(await regular(join(resources,'branding-manifest.json')))) throw Error('App branding provenance differs.');
  return manifest;
}
export async function createBrandedDmg({ stage, assets, output, brandingFixture = false }) {
  const manifest = await verifyAssets(assets); await lstat(output).then(() => { throw Error('Refusing existing image output.'); }, error => { if (error.code !== 'ENOENT') throw error; });
  const apps = (await readdir(stage)).filter(name => name.endsWith('.app'));
  if (apps.length !== 1 || !(await lstat(join(stage, apps[0]))).isDirectory()) throw Error('One staged app is required.');
  if (!brandingFixture) {
    await verifyAppBranding(join(stage, apps[0])); run('/usr/bin/codesign', ['--verify','--deep','--strict',join(stage, apps[0])]);
  }
  await mkdir(join(stage, '.background'), { mode: 0o700 }); await copyFile(join(assets, 'installer-background.png'), join(stage, '.background/installer-background.png'));
  await copyFile(join(assets, 'YNXDeveloper.icns'), join(stage, '.VolumeIcon.icns')); await symlink('/Applications', join(stage, 'Applications'));
  await copyFile(join(assets, 'branding-manifest.json'), join(stage, '.background/branding-manifest.json'));
  const work = await createDmgMountWorkspace(), mount = join(work, 'mount'), writable = output + '.writable.dmg';
  await newDirectory(mount);
  let attached = false;
  try {
    // HFS+ retains Finder metadata/volume icon, and is readable on supported
    // macOS versions. This helper never opens Finder or launches the app.
    run('/usr/bin/hdiutil', ['create', '-format', 'UDRW', '-fs', 'HFS+', '-volname', 'YNX Developer Testnet Preview', '-srcfolder', stage, writable]);
    run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-noautoopen', '-mountpoint', mount, writable]); attached = true;
    const aliasFile = join(work, 'background.alias'); run(join(assets, 'macos-brand-assets'), ['alias', join(mount, '.background/installer-background.png'), aliasFile]);
    run(join(assets, 'macos-brand-assets'), ['verify-alias', aliasFile, join(mount, '.background/installer-background.png')]);
    const store = finderStore(await regular(aliasFile), apps[0]); await writeFile(join(mount, '.DS_Store'), store, { flag: 'wx' });
    run('/usr/bin/SetFile', ['-a', 'C', mount]); run('/usr/bin/SetFile', ['-a', 'V', join(mount, '.VolumeIcon.icns')]);
    run('/usr/bin/hdiutil', ['detach', mount]); attached = false;
    run('/usr/bin/hdiutil', ['convert', writable, '-format', 'UDZO', '-o', output]);
    run('/usr/bin/hdiutil', ['verify', output]);
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, output]); attached = true;
    if (sha(await regular(join(mount, '.background/installer-background.png'))) !== manifest.files['installer-background.png'] || sha(await regular(join(mount, '.VolumeIcon.icns'))) !== manifest.files['YNXDeveloper.icns'] || sha(await regular(join(mount, '.DS_Store'))) !== sha(store)) throw Error('Mounted image branding changed.');
    run(join(assets, 'macos-brand-assets'), ['verify-alias', aliasFile, join(mount, '.background/installer-background.png')]);
    if (await readlink(join(mount, 'Applications')) !== '/Applications') throw Error('Applications target differs.');
    if (!run('/usr/bin/GetFileInfo', ['-a', mount], {encoding:'utf8'}).includes('C')) throw Error('Custom volume icon flag missing.');
    if (!brandingFixture) { await verifyAppBranding(join(mount, apps[0])); run('/usr/bin/codesign', ['--verify','--deep','--strict',join(mount, apps[0])]); }
    run('/usr/bin/hdiutil', ['detach', mount]); attached = false;
    const receipt = { schemaVersion: 1, artifactClass: brandingFixture ? 'branding-fixture' : 'unsigned-testnet-preview', imageSha256: sha(await regular(output)), brandingManifestSha256: sha(await regular(join(assets, 'branding-manifest.json'))), finderStoreSha256: sha(store), appName: apps[0], checks: { hdiutilVerify: 'PASS', mountedAssets: 'PASS', mountedNativeBackgroundAlias: 'PASS', applicationsSymlink: 'PASS', volumeIconFlag: 'PASS', mountedAppBranding: brandingFixture ? 'NOT_APPLICABLE_FIXTURE' : 'PASS', mountedAppCodeSignature: brandingFixture ? 'NOT_APPLICABLE_FIXTURE' : 'PASS', finderGUI: 'NOT_VERIFIED' } };
    receipt.mountScratch = { path: work, uid: process.getuid(), location: 'private-system-temp', imageBytesLocation: dirname(output) };
    await writeFile(output + '.branding.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rm(writable); await rm(work, { recursive: true }); return receipt;
  } finally { if (attached) run('/usr/bin/hdiutil', ['detach', mount]); }
}
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'assets' && args.length === 1) console.log(JSON.stringify(await generateAssets(resolve(args[0]))));
  else if (mode === 'dmg' && args.length === 3) console.log(JSON.stringify(await createBrandedDmg({ stage: resolve(args[0]), assets: resolve(args[1]), output: resolve(args[2]) })));
  else if (mode === 'verify-app' && args.length === 1) console.log(JSON.stringify(await verifyAppBranding(resolve(args[0]))));
  else throw Error('Expected assets OUTPUT | dmg STAGE ASSETS OUTPUT | verify-app APP');
}
