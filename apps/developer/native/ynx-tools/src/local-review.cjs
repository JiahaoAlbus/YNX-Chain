const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { digest } = require('./guards.cjs');
const LOCAL_REVIEW_TRANSLATIONS = Object.freeze({
  "Local Change Review": "本地修改审阅",
  "The local project changed. Capture the selection again.": "本地项目已变化，请重新捕获选区。",
  "Open the canonical local project root.": "请打开本地项目的真实根目录。",
  "The local project directory changed.": "本地项目目录已变化。",
  "The selection must belong to this local project.": "选区必须属于当前本地项目。",
  "Local review cannot follow symbolic links.": "本地审阅不支持符号链接。",
  "The selected path must be a canonical regular file.": "所选路径必须是真实的普通文件。",
  "The reviewed document changed. Capture the selection again.": "审阅的文档已变化，请重新捕获选区。",
  "The reviewed path changed. Capture the selection again.": "审阅的路径已变化，请重新捕获选区。",
  "This selection review was retired.": "本次选区审阅已失效。",
  "OS-user local editor only": "仅用于当前系统用户的本地编辑器",
  "Manually entered replacement": "手动输入的替换内容",
  "Select text in a local project file first.": "请先在本地项目文件中选择文本。",
  "Review at most 32 KiB of selected text in a document of at most 256 KiB.": "文档最多为 256 KiB，审阅选区最多为 32 KiB。",
  "The active selection changed. Capture it again.": "当前选区已变化，请重新捕获。",
  "This selection capture was retired.": "本次选区捕获已失效。",
  "The selection review changed. Review its current source.": "选区审阅已变化，请审阅当前来源。",
  "Enter a text replacement of at most 32 KiB.": "请输入最多 32 KiB 的替换文本。",
  "This suggestion was retired.": "本次建议已失效。",
  "The proposed document exceeds 256 KiB.": "建议修改后的文档超过 256 KiB。",
  "Review a current replacement first.": "请先审阅当前替换内容。",
  "Open the current diff before applying.": "应用前请先打开当前差异。",
  "Apply this manually entered replacement to the reviewed local buffer? It has not been sent to AI. Save separately; Undo remains available.": "将手动输入的替换内容应用到已审阅的本地缓冲区？内容尚未发送给 AI。请单独保存，仍可撤销。",
  "Apply local change": "应用本地修改",
  "The editor refused the change. Preserve your buffer and review again.": "编辑器拒绝了修改，请保留缓冲区并重新审阅。",
  "Unsupported local review message.": "不支持的本地审阅消息。",
  "This review changed. Use its current source.": "审阅已变化，请使用当前来源。",
  "Unexpected replacement payload.": "收到了意外的替换内容。",
  "Product identity: not connected. AI model: not connected. Waiting for the product identity and model services. Nothing is sent from this panel.": "产品身份：未连接。AI 模型：未连接。等待产品身份与模型服务接入。本面板不会发送任何内容。",
  "This review uses your current local editor buffer. A manually entered replacement is not an AI result. Applying changes does not save the file.": "审阅使用当前本地编辑器缓冲区。手动输入的替换内容不是 AI 结果。应用修改不会保存文件。",
  "Capture current selection": "捕获当前选区",
  "Select text in the editor to begin.": "请先在编辑器中选择文本。",
  "Manually entered replacement (maximum 32 KiB)": "手动输入的替换内容（最多 32 KiB）",
  "Review replacement": "审阅替换内容",
  "Open diff": "打开差异",
  "Apply reviewed change": "应用已审阅的修改"
});
function localTranslate(vscode, text) { return vscode.l10n?.t ? vscode.l10n.t(text) : text; }
const LIMIT = 32 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Local provenance is an edit precondition, never account or model authority.
function createLocalReview(vscode, environment, previewChange) {
  const t = text => localTranslate(vscode, text);
  let captured, proposal, revision = 0, disposed = false;
  const root = environment.YNX_LOCAL_WORKSPACE, projectId = environment.YNX_LOCAL_PROJECT_ID;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri, folderKey = folder?.toString();
  function assertRuntime() {
    if (disposed || environment.YNX_WORKSPACE_MODE !== 'local' || !UUID.test(projectId || '') ||
        !root || !path.isAbsolute(root) || environment.YNX_LOCAL_WORKSPACE !== root ||
        environment.YNX_LOCAL_PROJECT_ID !== projectId || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE ||
        vscode.workspace.workspaceFolders?.length !== 1 || folder?.scheme !== 'file' ||
        vscode.workspace.workspaceFolders[0].uri.toString() !== folderKey)
      throw Error(t('The local project changed. Capture the selection again.'));
  }
  async function fileIdentity(file) {
    assertRuntime();
    if (await fs.realpath(root) !== root || await fs.realpath(folder.fsPath) !== root || folder.fsPath !== root)
      throw Error(t('Open the canonical local project root.'));
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error(t('The local project directory changed.'));
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || path.resolve(file) !== file)
      throw Error(t('The selection must belong to this local project.'));
    let current = root, stat;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part); stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || (current !== file && !stat.isDirectory())) throw Error(t('Local review cannot follow symbolic links.'));
    }
    if (!stat.isFile() || await fs.realpath(file) !== file) throw Error(t('The selected path must be a canonical regular file.'));
    assertRuntime();
    return JSON.stringify({ rootDev: rootStat.dev, rootIno: rootStat.ino, dev: stat.dev, ino: stat.ino });
  }
  function currentDocument(source) {
    assertRuntime();
    const doc = vscode.workspace.textDocuments.find(value => value.uri.toString() === source.uri);
    if (doc !== source.document || doc.isClosed || doc.version !== source.version ||
        (doc.isDirty === true) !== source.bufferWasUnsaved || digest(doc.getText()) !== source.fullTextDigest)
      throw Error(t('The reviewed document changed. Capture the selection again.'));
    return doc;
  }
  async function verify(source) {
    currentDocument(source);
    if (source.identity !== await fileIdentity(source.document.uri.fsPath)) throw Error(t('The reviewed path changed. Capture the selection again.'));
    currentDocument(source);
    if (captured !== source) throw Error(t('This selection review was retired.'));
  }
  function transmission(source) {
    const values = [...(source?.attempts?.values() || [])];
    return source?.confirmedSent ? 'confirmed-sent' : source?.possiblySent || values.includes('possible') ? 'possibly-sent' : 'not-dispatched';
  }
  function sourceMetadata(source) {
    if (!source) return null;
    return { protocol: 'ynx-local-selected-edit/v1', captureId: source.captureId, projectId, workspace: root,
      uri: source.uri, version: source.version, fullTextDigest: source.fullTextDigest,
      start: source.start, end: source.end, selectedText: source.selectedText,
      bufferWasUnsaved: source.bufferWasUnsaved, authority: t('OS-user local editor only'), sent: transmission(source) === 'confirmed-sent' ? true : transmission(source) === 'possibly-sent' ? null : false, transmission: transmission(source) };
  }
  function state() {
    return { revision, source: sourceMetadata(captured), proposal: proposal ? { protocol: 'ynx-local-reviewed-text/v1',
      captureId: captured.captureId, provenance: proposal.generation ? t('AI-generated replacement') : t('Manually entered replacement'), replacement: proposal.replacement,
      previewed: proposal.previewed } : null, identityConnected: false, modelConnected: !!proposal?.generation, sent: transmission(captured) === 'confirmed-sent' ? true : transmission(captured) === 'possibly-sent' ? null : false, transmission: transmission(captured) };
  }
  async function captureSelection() {
    assertRuntime();
    // Retire the previous approval before asynchronous file checks begin.
    captured = undefined; proposal = undefined; const operation = ++revision;
    const editor = vscode.window.activeTextEditor, document = editor?.document, selection = editor?.selection;
    if (!document || document.uri.scheme !== 'file' || document.isClosed || !selection || selection.isEmpty)
      throw Error(t('Select text in a local project file first.'));
    const text = document.getText(), start = document.offsetAt(selection.start), end = document.offsetAt(selection.end);
    const selectedText = text.slice(start, end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length ||
        !selectedText || Buffer.byteLength(selectedText) > LIMIT || Buffer.byteLength(text) > 256 * 1024)
      throw Error(t('Review at most 32 KiB of selected text in a document of at most 256 KiB.'));
    const source = { captureId: randomUUID(), document, uri: document.uri.toString(), version: document.version,
      fullTextDigest: digest(text), start, end, selectedText, bufferWasUnsaved: document.isDirty === true };
    source.identity = await fileIdentity(document.uri.fsPath);
    currentDocument(source);
    if (vscode.window.activeTextEditor !== editor || editor.document !== document ||
        document.offsetAt(editor.selection.start) !== start || document.offsetAt(editor.selection.end) !== end)
      throw Error(t('The active selection changed. Capture it again.'));
    if (revision !== operation) throw Error(t('This selection capture was retired.'));
    captured = source;
    return state();
  }
  async function stageReplacement(replacement, expectedRevision, generation) {
    if (generation && (Object.keys(generation).sort().join() !== 'conversationId,model' || typeof generation.model !== 'string' || generation.model.length > 120 || !UUID.test(generation.conversationId || ''))) throw Error(t('Unsupported local review message.'));
    if (expectedRevision !== revision || !captured) throw Error(t('The selection review changed. Review its current source.'));
    if (typeof replacement !== 'string' || Buffer.byteLength(replacement) > LIMIT || replacement.includes('\0'))
      throw Error(t('Enter a text replacement of at most 32 KiB.'));
    const source = captured, operation = revision;
    await verify(source);
    if (revision !== operation) throw Error(t('This suggestion was retired.'));
    const original = source.document.getText(), text = original.slice(0, source.start) + replacement + original.slice(source.end);
    if (Buffer.byteLength(text) > 256 * 1024) throw Error(t('The proposed document exceeds 256 KiB.'));
    proposal = { replacement, text, previewed: false, ...(generation ? { generation } : {}) }; ++revision;
    return state();
  }
  async function preview(expectedRevision) {
    if (expectedRevision !== revision || !captured || !proposal) throw Error(t('Review a current replacement first.'));
    const source = captured, suggested = proposal, operation = revision;
    await verify(source);
    const previewDocument = await previewChange({ uri: source.uri, text: suggested.text }, source.document);
    await verify(source);
    if (revision !== operation || proposal !== suggested) throw Error(t('This suggestion was retired.'));
    await vscode.commands.executeCommand('vscode.diff', source.document.uri, previewDocument.uri, t('Local Change Review'));
    await verify(source);
    if (revision !== operation || proposal !== suggested) throw Error(t('This suggestion was retired.'));
    suggested.previewed = true; ++revision;
    return state();
  }
  async function apply(expectedRevision) {
    if (expectedRevision !== revision || !captured || !proposal?.previewed) throw Error(t('Open the current diff before applying.'));
    const source = captured, suggested = proposal, operation = revision;
    await verify(source);
    const approval = await vscode.window.showWarningMessage(t(suggested.generation ? 'Apply this AI-generated replacement to the reviewed local buffer? Save separately; Undo remains available.' : transmission(source) === 'possibly-sent' ? 'Apply this manually edited replacement to the reviewed local buffer? The original selection may have been sent to AI; the outcome is UNKNOWN. Save separately; Undo remains available.' : transmission(source) === 'confirmed-sent' ? 'Apply this manually edited replacement to the reviewed local buffer? The original selection was sent to AI. Save separately; Undo remains available.' : 'Apply this manually entered replacement to the reviewed local buffer? It has not been sent to AI. Save separately; Undo remains available.'), { modal: true }, t('Apply local change'));
    if (approval !== t('Apply local change')) return state();
    await verify(source);
    if (revision !== operation || proposal !== suggested) throw Error(t('This suggestion was retired.'));
    const document = currentDocument(source), edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(source.start), document.positionAt(source.end)), suggested.replacement);
    // Consume approval before handing the single text transaction to the host.
    proposal = undefined; captured = undefined; ++revision;
    if (!await vscode.workspace.applyEdit(edit)) throw Error(t('The editor refused the change. Preserve your buffer and review again.'));
    return state();
  }
  return { state, captureSelection, stageReplacement, preview, apply,
    async assertCaptured(source) { if (!captured || source?.captureId !== captured.captureId) throw Error(t('This selection capture was retired.')); await verify(captured); },
    async beginTransmission(source) {
      if (!captured || source?.captureId !== captured.captureId) throw Error(t('This selection capture was retired.'));
      const original = captured; await verify(original);
      if (captured !== original) throw Error(t('This selection capture was retired.'));
      const id = randomUUID(); original.attempts ||= new Map(); original.attempts.set(id, 'possible');
      return { captureId: original.captureId, id };
    },
    async finishTransmission(source, attempt, outcome) {
      if (!captured || source?.captureId !== captured.captureId || attempt?.captureId !== captured.captureId || !captured.attempts?.has(attempt.id) || !['confirmed', 'not-dispatched', 'unknown'].includes(outcome)) throw Error(t('This selection capture was retired.'));
      const original = captured;
      if (outcome === 'unknown') { original.possiblySent = true; original.attempts.delete(attempt.id); return; }
      if (outcome === 'not-dispatched') { original.attempts.delete(attempt.id); return; }
      await verify(original);
      if (captured !== original) throw Error(t('This selection capture was retired.'));
      // Only this exact attempt can become definitively not dispatched.
      original.confirmedSent = true; original.attempts.delete(attempt.id);
    },
    dispose() { disposed = true; captured = undefined; proposal = undefined; ++revision; } };
}
module.exports = { createLocalReview, localTranslate, LOCAL_REVIEW_TRANSLATIONS, LOCAL_REVIEW_TEXT_LIMIT: LIMIT };
