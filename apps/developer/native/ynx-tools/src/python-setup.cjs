const { realpath } = require('node:fs/promises');

async function configurePython(api, environment, t = text => text) {
  const folder = api.workspace.workspaceFolders?.[0];
  const root = environment.YNX_LOCAL_WORKSPACE;
  async function assertProject() {
    if (environment.YNX_WORKSPACE_MODE !== 'local' || environment.YNX_LOCAL_WORKSPACE !== root || !root || !api.workspace.isTrusted ||
        api.workspace.workspaceFolders?.length !== 1 || api.workspace.workspaceFolders[0] !== folder ||
        folder?.uri.scheme !== 'file' || await realpath(root) !== root || await realpath(folder.uri.fsPath) !== root)
      throw Error(t('Open one trusted local project to configure Python.'));
  }
  await assertProject();
  if (!api.extensions.getExtension('ms-python.python'))
    throw Error(t('Install the Python extension before configuring Python.'));
  const selected = await api.window.showQuickPick([{ label: t('Jedi · bundled Python language service'),
    detail: t('Configure this project, then choose its Python interpreter. Other project settings are preserved.') }],
    { title: t('Configure Python for this project') });
  if (!selected) return;
  await assertProject();
  // The normal configuration API changes these keys at project scope only.
  // Interpreter selection remains the installed Python extension's own UI.
  const config = api.workspace.getConfiguration('python', folder.uri);
  await config.update('languageServer', 'Jedi', api.ConfigurationTarget.WorkspaceFolder);
  if (!api.extensions.getExtension('ms-python.vscode-python-envs')) {
    await assertProject();
    await config.update('useEnvironmentsExtension', false, api.ConfigurationTarget.WorkspaceFolder);
  }
  await assertProject();
  await api.commands.executeCommand('python.setInterpreter');
}
module.exports = { configurePython };
