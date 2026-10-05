const path = require('node:path');
const { realpath } = require('node:fs/promises');
const validEntry = value => typeof value === 'string' && value.length <= 240 && value.endsWith('.sol') && !/[\\:\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..');
function validBuild(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === 'contractName,entryPath' && validEntry(value.entryPath) && typeof value.contractName === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(value.contractName);
}
function createSolidityBuild(api, language, environment, t = value => value) {
  async function run(configureOnly = false) {
    // Connected runtimes retain their existing compile path. Persistent local
    // configuration never supplies a canonical grant or changes the compiler.
    if (environment.YNX_WORKSPACE_MODE !== 'local') return language.compileProject();
    const root = environment.YNX_LOCAL_WORKSPACE, projectId = environment.YNX_LOCAL_PROJECT_ID;
    const folder = api.workspace.workspaceFolders?.[0], document = api.window.activeTextEditor?.document;
    const assertProject = async () => {
      if (!root || !/^[a-f0-9-]{36}$/.test(projectId || '') || environment.YNX_WORKSPACE_MODE !== 'local' || environment.YNX_LOCAL_WORKSPACE !== root || environment.YNX_LOCAL_PROJECT_ID !== projectId || environment.YNX_CORE_SESSION_ID || environment.YNX_CORE_WORKSPACE || api.workspace.isTrusted !== true || api.workspace.workspaceFolders?.length !== 1 || api.workspace.workspaceFolders[0] !== folder || folder?.uri.scheme !== 'file' || !document || document.isClosed || api.window.activeTextEditor?.document !== document || document.uri.scheme !== 'file' || await realpath(root) !== root || await realpath(folder.uri.fsPath) !== root)
        throw Error(t('Open one trusted local Solidity project to configure or build.'));
    };
    await assertProject();
    const entryPath = path.relative(root, document.uri.fsPath).split(path.sep).join('/');
    if (!validEntry(entryPath)) throw Error(t('Open a Solidity file inside this project to build.'));
    const config = api.workspace.getConfiguration('ynx.solidity', folder.uri);
    // Use only the explicit project value; user/global settings cannot select
    // a contract in a different admitted project.
    const previous = config.inspect('build')?.workspaceFolderValue;
    const previousSerialized = JSON.stringify(previous);
    if (!configureOnly && previous !== undefined && !validBuild(previous)) throw Error(t('The saved Solidity build configuration is invalid. Use Configure Solidity Build to replace it.'));
    const saved = validBuild(previous) && previous.entryPath === entryPath ? previous : undefined;
    const result = await language.compileProject({
      configureOnly,
      ...(!configureOnly && saved ? { contractName: saved.contractName } : {}),
      onContractChosen: async (selection, verify) => {
        await assertProject(); await verify();
        if (selection.entryPath !== entryPath || !validBuild({ entryPath, contractName: selection.contractName })) throw Error(t('The selected Solidity entry changed. Configure it again.'));
        // Do not overwrite a setting changed by another configuration action.
        if (JSON.stringify(config.inspect('build')?.workspaceFolderValue) !== previousSerialized) throw Error(t('The Solidity build configuration changed. Run the build again.'));
        if (!saved || configureOnly) {
          await config.update('build', { entryPath, contractName: selection.contractName }, api.ConfigurationTarget.WorkspaceFolder);
          await assertProject(); await verify();
          if (JSON.stringify(config.inspect('build')?.workspaceFolderValue) !== JSON.stringify({ entryPath, contractName: selection.contractName })) throw Error(t('The Solidity build configuration changed. Run the build again.'));
        }
      }
    });
    if (result) {
      await assertProject();
      await api.window.showInformationMessage(t(configureOnly ? 'Solidity build configured for this project. Run Compile Solidity Project to produce ABI and bytecode.' : 'Solidity compilation completed. ABI and bytecode are open. Deployment and contract calls require an admitted Chain and Wallet connection; compilation does not submit a transaction.'));
    }
    return result;
  }
  return { compile: () => run(false), configure: () => run(true), cancel: () => language.cancelCompileProject() };
}
module.exports = { createSolidityBuild, validBuild };
