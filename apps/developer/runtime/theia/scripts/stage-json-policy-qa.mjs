import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, realpath } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composedTreeDigest, verifyComposedRuntime } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const owned = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.ynx-developer-candidates') + '/';
const [baseInput, destination] = process.argv.slice(2), base = await realpath(baseInput);
assert.ok(base.startsWith(owned) && destination.startsWith(owned) && resolve(destination) === destination);
await verifyComposedRuntime(base, JSON.parse(await readFile(base + '.pin.json', 'utf8')));
await mkdir(destination, { mode: 0o700 });
const original = await composedTreeDigest(join(base, 'plugins'));
await cp(join(base, 'plugins'), join(destination, 'plugins'), { recursive: true, force: false, errorOnExist: true });
assert.equal(await composedTreeDigest(join(destination, 'plugins')), original);
const fixture = join(destination, 'plugins/ynx.json-policy-qa'); await mkdir(fixture, { mode: 0o700 });
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'json-policy-qa', publisher: 'ynx', version: '0.0.1', engines: { vscode: '^1.77.0' }, main: './index.js', activationEvents: ['onCommand:ynx.qa.inspectJsonPolicy'], contributes: { commands: [{ command: 'ynx.qa.inspectJsonPolicy', title: 'YNX JSON QA: Inspect Schema Policy' }] } }), { flag: 'wx' });
await writeFile(join(fixture, 'index.js'), `const vscode = require('vscode');
exports.activate = context => {
  context.subscriptions.push(vscode.commands.registerCommand('ynx.qa.inspectJsonPolicy', async () => {
    const extension = vscode.extensions.getExtension('vscode.json-language-features');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!extension || !root || !vscode.workspace.isTrusted) throw Error('Use an owned trusted QA workspace.');
    await extension.activate();
    const documentUri = vscode.Uri.joinPath(root, 'json-auto-diagnostic-probe.json');
    await vscode.workspace.fs.writeFile(documentUri, Buffer.from(JSON.stringify({ $schema: 'https://json.schemastore.org/package', name: 'ynx-owned-policy-probe' })));
    const document = await vscode.workspace.openTextDocument(documentUri);
    await vscode.window.showTextDocument(document);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const report = { version: extension.packageJSON.version, active: extension.isActive,
      schemaDownload: vscode.workspace.getConfiguration('json').get('schemaDownload.enable'),
      inspection: vscode.workspace.getConfiguration('json').inspect('schemaDownload.enable'),
      validation: vscode.workspace.getConfiguration('json').get('validate.enable'),
      validationInspection: vscode.workspace.getConfiguration('json').inspect('validate.enable'),
      document: { uri: document.uri.toString(), languageId: document.languageId, version: document.version },
      automaticDiagnostics: vscode.languages.getDiagnostics(document.uri),
      diagnostics: await vscode.commands.executeCommand('json.validate', vscode.Uri.parse('https://json.schemastore.org/package'), '{}') };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, 'json-policy-report.json'), Buffer.from(JSON.stringify(report, null, 2)));
    await vscode.window.showInformationMessage('YNX JSON QA policy inspection complete');
  }));
};
`, { flag: 'wx' });
await writeFile(join(destination, 'receipt.json'), JSON.stringify({ base, originalPluginTree: original, qaPluginTree: await composedTreeDigest(join(destination, 'plugins')), scope: 'Test-only probe of actual extension APIs. Excluded from product packaging and formal admission.' }, null, 2), { flag: 'wx' });
console.log(destination);
