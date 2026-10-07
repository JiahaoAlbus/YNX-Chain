const fs = require('node:fs/promises');
const path = require('node:path');
// Consume mature project tools through the existing task/terminal lifecycle.
// No package installation, endpoint, credential or transaction is supplied here.
function createEvmProject(api, context, environment, t = value => value) {
  let active, starting = false, generation = 0, disposed = false;
  const ended = new WeakSet();
  const stopping = new WeakSet();
  function stopExecution(task) {
    if (!task || ended.has(task)) return;
    // Keep the workspace busy until the task service confirms this exact
    // execution ended. terminate() is a request, not exit confirmation.
    active = task;
    if (!stopping.has(task)) { stopping.add(task); task.terminate(); }
  }
  async function scope() {
    const folders = api.workspace.workspaceFolders;
    if (disposed || environment.YNX_WORKSPACE_MODE !== 'local' || api.workspace.isTrusted !== true
      || folders?.length !== 1 || folders[0].uri.scheme !== 'file') throw Error(t('Open one trusted local EVM project.'));
    const root = await fs.realpath(folders[0].uri.fsPath), stat = await fs.stat(root);
    if (root !== environment.YNX_LOCAL_WORKSPACE || !stat.isDirectory()) throw Error(t('The EVM project changed. Run the command again.'));
    return { folder: folders[0], root, identity: `${stat.dev}:${stat.ino}` };
  }
  async function present(file) {
    try { return (await fs.lstat(file)).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function tools(project) {
    const result = [];
    if (await present(path.join(project.root, 'foundry.toml'))) result.push({ label: 'Foundry', kind: 'foundry' });
    for (const name of ['hardhat.config.ts', 'hardhat.config.js', 'hardhat.config.cjs', 'hardhat.config.mjs']) {
      if (await present(path.join(project.root, name))) { result.push({ label: 'Hardhat', kind: 'hardhat' }); break; }
    }
    if (!result.length) throw Error(t('No Foundry or Hardhat project was found. Open its project folder; a standalone Solidity file can use Compile Solidity Project.'));
    return result;
  }
  async function hardhat(project, action) {
    const folder = await fs.realpath(path.join(project.root, 'node_modules', 'hardhat'));
    if (!folder.startsWith(project.root + path.sep)) throw Error(t('The Hardhat tool is outside this project. Preserve its files and select a project-local installation.'));
    const metadata = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    const major = Number(/^([0-9]+)\./.exec(metadata.version || '')?.[1]);
    const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.hardhat;
    if (metadata.name !== 'hardhat' || ![2, 3].includes(major) || typeof bin !== 'string') throw Error(t('This Hardhat installation is not supported. Use a project-local Hardhat 2 or 3 installation.'));
    const entry = await fs.realpath(path.resolve(folder, bin));
    if (!entry.startsWith(folder + path.sep) || !(await fs.stat(entry)).isFile()) throw Error(t('The Hardhat executable is outside its package.'));
    return new api.ProcessExecution(process.execPath, [entry, action === 'test' ? 'test' : major === 3 ? 'build' : 'compile'], { cwd: project.root });
  }
  async function run(action) {
    if (!['build', 'test'].includes(action)) throw Error(t('Choose Build or Test for this EVM project.'));
    if (starting || active) throw Error(t('An EVM task is already running. Stop it before starting another.'));
    starting = true; const epoch = ++generation;
    const current = () => { if (disposed || epoch !== generation) throw Error(t('The EVM task was cancelled.')); };
    try {
      const project = await scope(), available = await tools(project); current();
      const selected = available.length === 1 ? available[0] : await api.window.showQuickPick(available, { title: t('Select EVM project tool'), ignoreFocusOut: true });
      if (!selected) return;
      current();
      if (!await api.workspace.saveAll(false)) throw Error(t('Save the project files before running EVM tasks.'));
      const checked = await scope(); current();
      if (checked.root !== project.root || checked.identity !== project.identity || checked.folder !== project.folder) throw Error(t('The EVM project changed. Run the command again.'));
      const execution = selected.kind === 'hardhat' ? await hardhat(project, action)
        : new api.ProcessExecution('forge', [action, '--offline'], { cwd: project.root });
      const ready = await scope();
      if (ready.root !== project.root || ready.identity !== project.identity || ready.folder !== project.folder) throw Error(t('The EVM project changed. Run the command again.'));
      current();
      const task = new api.Task({ type: 'ynx-evm', action, tool: selected.kind }, project.folder,
        `${selected.label}: ${action}`, 'YNX', execution, []);
      task.presentationOptions = { reveal: api.TaskRevealKind.Always, panel: api.TaskPanelKind.Dedicated, clear: true, showReuseMessage: false };
      const started = await api.tasks.executeTask(task);
      // Cancellation may win while executeTask is resolving. Terminate only
      // the execution created here, never another project's task/process.
      if (disposed || epoch !== generation) { stopExecution(started); return; }
      try {
        const live = await scope(); current();
        if (live.root !== project.root || live.identity !== project.identity || live.folder !== project.folder) throw Error(t('The EVM project changed. Run the command again.'));
      } catch (error) { stopExecution(started); throw error; }
      if (!ended.has(started)) active = started;
    } catch (error) {
      if (error.code === 'ENOENT') throw Error(t('The project tool is not installed locally. No packages were downloaded. Configure the toolchain, then retry.'));
      throw error;
    } finally { starting = false; }
  }
  function cancel() { generation++; stopExecution(active); }
  context.subscriptions.push(api.tasks.onDidEndTask(event => { ended.add(event.execution); if (event.execution === active) active = undefined; }),
    { dispose() { disposed = true; cancel(); } });
  return { build: () => run('build'), test: () => run('test'), cancel };
}
module.exports = { createEvmProject };
