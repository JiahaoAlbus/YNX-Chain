const { randomUUID } = require('node:crypto');
const { basename } = require('node:path');
function createReviewPreview(vscode, context) {
  const previews = new Map();
  // TextDocumentContentProvider documents are read-only. The approved bundle,
  // rather than an editable untitled draft, remains the source of the preview.
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('ynx-review', {
    provideTextDocumentContent: uri => {
      const text = previews.get(uri.toString());
      if (text === undefined) throw Error('This suggested-change preview is closed. Review the proposal again.');
      return text;
    },
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => previews.delete(document.uri.toString())));
  context.subscriptions.push({ dispose: () => previews.clear() });
  return async (change, document) => {
    if (previews.size >= 64) throw Error('Close earlier suggested-change previews before opening more.');
    const uri = vscode.Uri.parse(`ynx-review:/${randomUUID()}/${encodeURIComponent(basename(document.uri.fsPath || 'suggestion.txt'))}`);
    previews.set(uri.toString(), change.text);
    try { return await vscode.workspace.openTextDocument(uri); }
    catch (error) { previews.delete(uri.toString()); throw error; }
  };
}
module.exports = { createReviewPreview };
