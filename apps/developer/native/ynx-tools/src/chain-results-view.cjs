'use strict';
// Project-owned saved observations only. Opening this view never queries a
// service; a result/reference is not Wallet authority or deployment proof.
function registerChainResultsView(vscode, context, { load, open, translate = text => text }) {
  const changed = new vscode.EventEmitter();
  let disposed = false, revision = 0;
  const refresh = () => { if (!disposed) { revision++; changed.fire(); } };
  // An in-flight history response from the old workspace must not populate
  // this view after the host changes folders, even without a manual refresh.
  const foldersChanged = vscode.workspace?.onDidChangeWorkspaceFolders?.(refresh);
  if (foldersChanged) context.subscriptions.push(foldersChanged);
  const provider = {
    onDidChangeTreeData: changed.event,
    async getChildren(item) {
      if (item || disposed) return [];
      const captured = revision;
      try {
        const records = await load();
        if (disposed || captured !== revision) return [];
        if (!records.length) return [{ label: translate('No saved Chain observations for this project.') }];
        return records.slice().reverse().map(record => ({
          label: record.operation.hash || record.operation.address || record.operation.kind,
          description: `${record.savedAt} · ${translate(record.evidence ? 'Saved observation; not current chain proof' : 'Saved query reference has no chain evidence yet')}`,
          reference: { id: record.id, projectId: record.projectId, workspace: record.workspace },
        }));
      } catch {
        if (disposed || captured !== revision) return [];
        // Don't expose filesystem paths or raw transport errors in the UI.
        return [{ label: translate('Chain query failed. Existing project data is preserved.') }];
      }
    },
    getTreeItem(item) {
      return { label: item.label, description: item.description, collapsibleState: 0,
        ...(item.reference ? { id: `${item.reference.projectId}:${item.reference.id}` } : {}),
        ...(item.reference ? { command: { command: 'ynx.chainResults.open', title: translate('Open saved observation'), arguments: [item.reference] } } : {}) };
    },
  };
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ynx.chainResults', provider),
    vscode.commands.registerCommand('ynx.chainResults.refresh', refresh),
    vscode.commands.registerCommand('ynx.chainResults.open', reference => disposed ? undefined : open(reference)),
    { dispose() { disposed = true; revision++; changed.dispose(); } },
  );
  return { refresh };
}
module.exports = { registerChainResultsView };
