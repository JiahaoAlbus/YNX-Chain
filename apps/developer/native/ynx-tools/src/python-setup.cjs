const { realpath } = require('node:fs/promises');

async function configurePython(api, environment, t = text => text) {
  const folder = api.workspace.workspaceFolders?.[0];
  const root = environment.YNX_LOCAL_WORKSPACE;
  const folderPath = folder?.uri?.fsPath;
  function assertCurrentProject() {
    if (environment.YNX_WORKSPACE_MODE !== 'local' || environment.YNX_LOCAL_WORKSPACE !== root || !root || !api.workspace.isTrusted ||
        api.workspace.workspaceFolders?.length !== 1 || api.workspace.workspaceFolders[0] !== folder ||
        folder?.uri?.scheme !== 'file' || typeof folderPath !== 'string' || folder.uri.fsPath !== folderPath)
      throw Error(t('Open one trusted local project to configure Python.'));
  }
  async function assertProject() {
    assertCurrentProject();
    const [realRoot, realFolder] = await Promise.all([realpath(root), realpath(folderPath)]);
    // Realpath yields to workspace/trust changes. A retired request must not
    // write project settings or open another project's interpreter selector.
    assertCurrentProject();
    if (realRoot !== root || realFolder !== root)
      throw Error(t('Open one trusted local project to configure Python.'));
  }
  await assertProject();
  assertCurrentProject();
  if (!api.extensions.getExtension('ms-python.python'))
    throw Error(t('Install the Python extension before configuring Python.'));
  const selected = await api.window.showQuickPick([{ label: t('Jedi · bundled Python language service'),
    detail: t('Configure this project, then choose its Python interpreter. Other project settings are preserved.') }],
    { title: t('Configure Python for this project') });
  if (!selected) return;
  await assertProject();
  assertCurrentProject();
  // The normal configuration API changes these keys at project scope only.
  // Interpreter selection remains the installed Python extension's own UI.
  const config = api.workspace.getConfiguration('python', folder.uri);
  await config.update('languageServer', 'Jedi', api.ConfigurationTarget.WorkspaceFolder);
  if (!api.extensions.getExtension('ms-python.vscode-python-envs')) {
    await assertProject();
    assertCurrentProject();
    await config.update('useEnvironmentsExtension', false, api.ConfigurationTarget.WorkspaceFolder);
  }
  await assertProject();
  assertCurrentProject();
  await api.commands.executeCommand('python.setInterpreter');
}
module.exports = { configurePython };
