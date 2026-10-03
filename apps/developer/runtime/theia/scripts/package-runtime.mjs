import { readFile, writeFile, mkdir, readdir, cp, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composedTreeDigest, verifyComposedRuntime } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const application = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const developer = resolve(application, '../..');
const destination = process.argv[2], pluginsInput = process.argv[3];
const candidateRoot = join(developer, '.ynx-developer-candidates') + '/';
if (!destination?.startsWith(candidateRoot) || resolve(destination) !== destination || !pluginsInput?.startsWith(candidateRoot))
  throw Error('Use new owned absolute candidate paths.');
const plugins = await realpath(pluginsInput);
if (!plugins.startsWith(candidateRoot)) throw Error('Plugin input escaped its owned candidate root.');
await mkdir(destination, { mode: 0o700 }); // never replace an existing candidate
async function assertRegularTree(root) {
  for (const name of await readdir(root)) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw Error(`Unsupported input: ${path}`);
    if (stat.isDirectory()) await assertRegularTree(path);
  }
}
await assertRegularTree(join(application, 'lib'));
await cp(join(application, 'lib'), join(destination, 'lib'), { recursive: true, errorOnExist: true, force: false });
for (const name of ['package.json', 'package-lock.json']) await cp(join(application, name), join(destination, name), { errorOnExist: true, force: false });
const helper = await readFile(join(developer, 'runtime/ynx-workbench/assets/workbench-activity.js'), 'utf8');
for (const name of ['index.html', 'secondary-window.html']) {
  const path = join(destination, 'lib/frontend', name);
  let html = await readFile(path, 'utf8');
  if (html.includes('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__') || !/<head>/.test(html)) throw Error('Unexpected framework HTML bootstrap.');
  html = html.replace(/<html lang="en">/, '<html>').replace('<head>', `<head><script data-ynx-workbench-activity="v1">${helper}</script>`);
  await writeFile(path, html);
}
const inputs = JSON.parse(await readFile(join(plugins, 'extension-inputs.json'), 'utf8'));
await mkdir(join(destination, 'plugins'), { mode: 0o700 });
for (const input of inputs) {
  const name = `${input.namespace}.${input.name}-${input.version}`;
  const archive = await readFile(join(plugins, `${name}.vsix`));
  if (createHash('sha256').update(archive).digest('hex') !== input.sha256) throw Error('Extension input archive changed.');
  await assertRegularTree(join(plugins, name));
  await cp(join(plugins, name), join(destination, 'plugins', name), { recursive: true, errorOnExist: true, force: false });
}
const tools = join(developer, 'native/ynx-tools');
await assertRegularTree(tools);
await cp(tools, join(destination, 'plugins/ynx.ynx-tools'), { recursive: true, errorOnExist: true, force: false });
const brand = join(developer, 'native/ynx-brand');
await assertRegularTree(brand);
await cp(brand, join(destination, 'plugins/ynx.ynx-developer-brand'), { recursive: true, errorOnExist: true, force: false });
await writeFile(join(destination, 'plugins/extension-inputs.json'), JSON.stringify(inputs, null, 2));
// Keep component license declarations and available upstream legal notices.
// Missing notice files are recorded for release review, never silently waived.
const lock = JSON.parse(await readFile(join(application, 'package-lock.json'), 'utf8'));
const notices = [];
await mkdir(join(destination, 'component-notices'), { mode: 0o700 });
let index = 0;
for (const path of Object.keys(lock.packages).filter(path => path.startsWith('node_modules/'))) {
  const source = join(application, path);
  let metadata;
  try { metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    notices.push({ packagePath: path, ...lock.packages[path], installed: false });
    continue;
  }
  const names = (await readdir(source)).filter(name => /^(licen[sc]e|notice|copying)(\.|$)/i.test(name));
  const entry = { name: metadata.name, version: metadata.version, license: metadata.license, files: [] };
  for (const name of names) {
    const stat = await lstat(join(source, name));
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const target = `${index++}-${name}`;
    await cp(join(source, name), join(destination, 'component-notices', target), { errorOnExist: true, force: false });
    entry.files.push(target);
  }
  notices.push(entry);
}
await cp(join(developer, 'runtime/ynx-workbench/NOTICE'), join(destination, 'component-notices/YNX-VIEW-CONTAINER-NOTICE.txt'), { errorOnExist: true, force: false });
notices.push({ name: '@ynx/developer-workbench/view-container', license: 'EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0', files: ['YNX-VIEW-CONTAINER-NOTICE.txt'] });
await writeFile(join(destination, 'component-notices/index.json'), JSON.stringify(notices, null, 2));
const manifest = { kind: 'ynx-theia', version: '1.76.0', architecture: `${process.platform}-${process.arch}`,
  nodeVersion: process.version, nodeOptions: ['--no-experimental-global-navigator', '--max-old-space-size=1024'],
  entry: 'lib/backend/main.js', frontend: 'lib/frontend/index.html',
  lockSha256: createHash('sha256').update(await readFile(join(destination, 'package-lock.json'))).digest('hex'),
  activitySourceSha256: createHash('sha256').update(helper).digest('hex'),
  ynxToolsVersion: JSON.parse(await readFile(join(tools, 'package.json'), 'utf8')).version,
  acceptance: 'owned composed runtime candidate; formal Host, isolation and release admission remain separate',
  treeSha256: await composedTreeDigest(destination) };
const bytes = JSON.stringify(manifest, null, 2) + '\n';
await writeFile(join(destination, 'YNX-COMPOSED-RUNTIME.json'), bytes, { flag: 'wx' });
const pin = { kind: manifest.kind, version: manifest.version, architecture: manifest.architecture,
  lockSha256: manifest.lockSha256, treeSha256: manifest.treeSha256, manifestSha256: createHash('sha256').update(bytes).digest('hex') };
await writeFile(`${destination}.pin.json`, JSON.stringify(pin, null, 2) + '\n', { flag: 'wx' });
await verifyComposedRuntime(destination, pin);
console.log(JSON.stringify({ destination, pin, noticeDeclarations: notices.length }));
