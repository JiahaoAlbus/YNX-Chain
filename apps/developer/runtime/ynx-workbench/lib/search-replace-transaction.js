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
  widget.ynxReplacing = true;
  const replacement = widget._replaceTerm, query = widget.searchTerm;
  const targets = rows.map(row => ({ resource: row.fileUri, expected: expectedMatch(row), range: dependencies.range(row, widget.findEndCharacterPosition(row)) }));
  const references = [];
  try {
    if (!await widget.confirmReplaceAll(rows.length, new Set(targets.map(row => row.resource)).size, replacement)) return;
    if (widget.searchTerm !== query || widget._replaceTerm !== replacement) throw Error('Search or replacement changed. Review the results again.');
    const models = new Map(), versions = new Map();
    for (const target of targets) {
      if (!models.has(target.resource)) {
        const ref = await widget.ynxSearchWorkspace.textModelService.createModelReference(dependencies.uri(target.resource));
        references.push(ref); models.set(target.resource, ref.object.textEditorModel);
        versions.set(target.resource, ref.object.textEditorModel.getVersionId());
      }
      const model = models.get(target.resource);
      if (model.getValueInRange(target.range) !== target.expected) throw Error('A search match changed. Refresh the search before replacing.');
    }
    for (const [resource, model] of models) if (model.getVersionId() !== versions.get(resource)) throw Error('A search document changed. Refresh the search before replacing.');
    const edits = targets.map(target => dependencies.edit(target, replacement, versions.get(target.resource)));
    const result = await widget.ynxSearchWorkspace.applyBulkEdit(edits);
    if (!result.isApplied) throw Error(result.ariaSummary || 'The workspace replacement could not be applied.');
    await widget.ynxSearchWorkspace.saveAll(new Set(targets.map(target => target.resource)));
    // Remove the precise old matches, rather than a root which a new search
    // may have populated while the save was pending.
    for (const row of rows) if (row.parent?.children?.includes(row)) widget.removeNode(row);
  } catch (error) {
    await widget.ynxSearchMessages.error(error.message);
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
