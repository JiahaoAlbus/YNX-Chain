// Route multi-file search replacements through the same workspace history as
// extension edits. Saving remains a separate operation; a save error must not
// discard the search results or pretend that all files reached disk.
function collectMatches(nodes, isFile, isLine) {
  const rows = [];
  const visit = node => {
    if (isLine(node)) rows.push(node);
    else if (isFile(node) || Array.isArray(node?.children)) for (const child of node.children || []) visit(child);
  };
  for (const node of nodes) visit(node);
  return rows;
}
function expectedMatch(row) {
  const preview = typeof row.lineText === 'string' ? { text: row.lineText, character: row.character } : row.lineText;
  return preview.text.slice(preview.character - 1, preview.character - 1 + row.length);
}
async function replaceBatch(widget, node, dependencies) {
  if (widget.ynxReplacing) return;
  const nodes = node ? [node] : Array.from(widget.resultTree.values());
  const rows = collectMatches(nodes, dependencies.isFile, dependencies.isLine);
  if (new Set(rows.map(row => row.fileUri)).size < 2) return dependencies.original.call(widget, node);
  const replacement = widget._replaceTerm, query = widget.searchTerm;
  const targets = rows.map(row => ({ resource: row.fileUri, expected: expectedMatch(row), range: dependencies.range(row, widget.findEndCharacterPosition(row)) }));
  const references = [];
  const workspace = widget.workspaceService, editorManager = widget.editorManager;
  const workspaceKey = () => JSON.stringify([workspace?.workspace?.resource?.toString(), workspace?.tryGetRoots?.().map(root => root.resource.toString()) || []]);
  const reviewedWorkspace = workspaceKey(), options = JSON.stringify(widget.searchOptions), search = widget.cancelIndicator;
  const positions = rows.map(row => ({ fileUri: row.fileUri, line: row.line, character: row.character, length: row.length }));
  const resources = new Set(targets.map(target => target.resource));
  const openEditors = [];
  for (const editor of editorManager?.all || []) {
    if (!resources.has(editor.editor?.uri?.toString())) continue;
    const model = editor.editor?.getControl?.()?.getModel?.();
    if (model) openEditors.push({ editor, model, version: model.getVersionId() });
  }
  const contextCurrent = () => !widget.isDisposed && widget.workspaceService === workspace && widget.editorManager === editorManager
    && widget.searchTerm === query && widget._replaceTerm === replacement && JSON.stringify(widget.searchOptions) === options && workspaceKey() === reviewedWorkspace;
  const rowsCurrent = () => {
    const current = new Set(collectMatches(Array.from(widget.resultTree.values()), dependencies.isFile, dependencies.isLine));
    return rows.every((row, index) => current.has(row) && row.fileUri === positions[index].fileUri && row.line === positions[index].line
      && row.character === positions[index].character && row.length === positions[index].length && expectedMatch(row) === targets[index].expected);
  };
  const assertPlanCurrent = () => {
    if (!contextCurrent() || widget.cancelIndicator !== search || !rowsCurrent() || openEditors.some(({ editor, model, version }) =>
      editor.isDisposed || !editorManager.all.includes(editor) || editor.editor.getControl().getModel() !== model || model.isDisposed?.() || model.getVersionId() !== version))
      throw Error('Search, replacement, workspace, or source changed. Review the current results again.');
  };
  widget.ynxReplacing = true;
  try {
    if (!await widget.confirmReplaceAll(rows.length, new Set(targets.map(row => row.resource)).size, replacement)) return;
    assertPlanCurrent();
    const models = new Map(), versions = new Map();
    for (const target of targets) {
      if (!models.has(target.resource)) {
        const ref = await widget.ynxSearchWorkspace.textModelService.createModelReference(dependencies.uri(target.resource));
        references.push(ref);
        assertPlanCurrent();
        models.set(target.resource, ref.object.textEditorModel);
        versions.set(target.resource, ref.object.textEditorModel.getVersionId());
      }
      const model = models.get(target.resource);
      if (model.getValueInRange(target.range) !== target.expected) throw Error('A search match changed. Refresh the search before replacing.');
    }
    for (const [resource, model] of models) if (model.getVersionId() !== versions.get(resource)) throw Error('A search document changed. Refresh the search before replacing.');
    assertPlanCurrent();
    const edits = targets.map(target => dependencies.edit(target, replacement, versions.get(target.resource)));
    const result = await widget.ynxSearchWorkspace.applyBulkEdit(edits);
    if (!result.isApplied) throw Error(result.ariaSummary || 'The workspace replacement could not be applied.');
    // The admitted edit may already have changed old buffers. Do not roll it
    // back or save a different workspace if its visible context has departed.
    if (!contextCurrent()) throw Error('Replacement edited the reviewed buffers, but the search or workspace changed. Review, save or undo those buffers explicitly.');
    await widget.ynxSearchWorkspace.saveAll(resources);
    // Remove the precise old matches, rather than a root which a new search
    // may have populated while the save was pending.
    if (contextCurrent() && widget.cancelIndicator === search && rowsCurrent())
      for (const row of rows) if (row.parent?.children?.includes(row)) widget.removeNode(row);
  } catch (error) {
    // A notification settles when dismissed; it must not retain model refs or
    // prevent the user's next explicit Replace request from being admitted.
    try { void Promise.resolve(widget.ynxSearchMessages.error(error.message)).catch(() => {}); }
    catch { /* Reporting cannot prevent final ownership/reference release. */ }
  } finally {
    for (const ref of references.reverse()) ref.dispose();
    widget.ynxReplacing = false;
  }
}
function install() {
  const { inject } = require('@theia/core/shared/inversify');
  const { MonacoWorkspace } = require('@theia/monaco/lib/browser/monaco-workspace');
  const { MessageService } = require('@theia/core/lib/common/message-service');
  const { SearchInWorkspaceResultTreeWidget: Widget, SearchInWorkspaceFileNode, SearchInWorkspaceResultLineNode } = require('@theia/search-in-workspace/lib/browser/search-in-workspace-result-tree-widget');
  const { ResourceTextEdit } = require('@theia/monaco-editor-core/esm/vs/editor/browser/services/bulkEditService');
  const { URI } = require('@theia/monaco-editor-core/esm/vs/base/common/uri');
  const { Range } = require('@theia/monaco-editor-core/esm/vs/editor/common/core/range');
  const marker = Symbol.for('ynx.search-replace-transaction.v1');
  if (Widget.prototype[marker]) return;
  inject(MonacoWorkspace)(Widget.prototype, 'ynxSearchWorkspace');
  inject(MessageService)(Widget.prototype, 'ynxSearchMessages');
  const original = Widget.prototype.replace;
  Widget.prototype.replace = function (node) {
    return replaceBatch(this, node, {
      original, isFile: SearchInWorkspaceFileNode.is, isLine: SearchInWorkspaceResultLineNode.is,
      uri: value => URI.parse(value),
      range: (row, end) => new Range(row.line, row.character, end.line + 1, end.character + 1),
      edit: (target, text, version) => new ResourceTextEdit(URI.parse(target.resource), { range: target.range, text }, version),
    });
  };
  Object.defineProperty(Widget.prototype, marker, { value: true });
}
module.exports = { collectMatches, expectedMatch, replaceBatch, install };
