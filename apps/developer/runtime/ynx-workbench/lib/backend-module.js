const { ContainerModule, injectable, decorate } = require('@theia/core/shared/inversify');
const { ProcessUtils } = require('@theia/core/lib/node/process-utils');
const { spawnSync, spawn } = require('node:child_process');
const { BackendApplicationContribution } = require('@theia/core/lib/node');
const { join } = require('node:path');
const { PluginHostEnvironmentVariable } = require('@theia/plugin-ext/lib/common/plugin-protocol');
const { ConnectionHandler, RpcConnectionHandler } = require('@theia/core/lib/common');
const { DraftRecoveryStore } = require('./draft-store');
const { LocalWorkbenchStorageStore } = require('./local-workbench-storage-store');
const { createWorkspaceFileJournalApi } = require('./workspace-file-journal-protocol');
const { LocalizationProvider } = require('@theia/core/lib/node/i18n/localization-provider');
const { registerYnxLocalizations } = require('./ynx-localization');
const { registerKeyboardShortcutsLocalizations } = require('./keyboard-shortcuts-localization');
const { registerNativeWalletLocalizations } = require('./native-wallet-localization');
require('./gcc-resource-adapter').install();
require('./macos-bash-input').install(require('@theia/process/lib/node/terminal-process').TerminalProcess.prototype);
require('./plugin-vscode-lifecycle-adapter').install();

// macOS sandbox-exec refuses the setgid system ps binary. Use a nonprivileged
// native helper which accepts only descendants of this backend, verifies PID
// start times, and never obtains process arguments or changes sandbox policy.
class YnxProcessUtils extends ProcessUtils {
  unixTerminateProcessTree(pid) {
    if (process.platform !== 'darwin') return super.unixTerminateProcessTree(pid);
    if (!Number.isSafeInteger(pid) || pid <= 1) throw Error('Invalid child process.');
    const app = process.env.THEIA_APP_PROJECT_PATH;
    if (!app) throw Error('Owned runtime application path is missing.');
    const result = spawnSync(join(app, 'lib/backend/ynx-process-tree'), [String(pid), ...pid === process.pid ? ['--children'] : []], { encoding: 'utf8', timeout: 5000 });
    if (result.error || result.status !== 0) throw result.error || Error(`Owned process cleanup refused (code=${result.status}, signal=${result.signal}): ${result.stderr}`);
  }
}
decorate(injectable(), YnxProcessUtils);
module.exports.default = new ContainerModule((bind, unbind, isBound, rebind) => {
  if (process.env.YNX_WORKSPACE_MODE === 'local') {
    // This dedicated inherited endpoint belongs to this launch only. Ordinary
    // child stdio does not inherit it; no credential is placed in environment.
    const { OVSXClientProvider } = require('@theia/vsx-registry/lib/common/ovsx-client-provider');
    const catalog = require('./marketplace-channel').inheritedCatalog();
    rebind(OVSXClientProvider).toConstantValue(async () => ({
      search: options => catalog.request('search', options),
      query: options => catalog.request('query', options),
    }));
    bind(BackendApplicationContribution).toConstantValue({ onStop: () => catalog.close() });
    require('./marketplace-diagnostics').installOn(require('@theia/vsx-registry/lib/node/vsx-registry-service-impl').VSXRegistryServiceImpl.prototype);
    require('./local-terminal-channel-diagnostics').install();
    require('./local-js-terminal-environment').install(require('@theia/terminal/lib/node/shell-terminal-server').ShellTerminalServer.prototype);
    require('./local-task-cancellation').install(require('@theia/task/lib/node/process/process-task').ProcessTask.prototype);
    const { HostedPluginProcess } = require('@theia/plugin-ext/lib/hosted/node/hosted-plugin-process');
    bind(BackendApplicationContribution).toConstantValue(require('./local-plugin-shutdown').install(HostedPluginProcess.prototype));
  }
  require('./local-filesystem-watcher').bindLocalFilesystemWatcher(rebind);
  let localization, keyboardLocalization, walletLocalization;
  bind(BackendApplicationContribution).toDynamicValue(context => ({
    initialize() {
      const provider = context.container.get(LocalizationProvider);
      localization = registerYnxLocalizations(provider);
      keyboardLocalization = registerKeyboardShortcutsLocalizations(provider);
      walletLocalization = registerNativeWalletLocalizations(provider);
    },
    onStop() { localization?.dispose(); keyboardLocalization?.dispose(); walletLocalization?.dispose(); },
  })).inSingletonScope();
  const walletAdmission = process.env.YNX_WORKSPACE_MODE === 'local'
    ? require('./wallet-admission-channel').inheritedAdmission()
    : { assertCurrent: async () => { throw require('./wallet-admission-channel').missing(); }, close() {} };
  const walletAdmissionRpc = require('./wallet-admission-protocol').createAdmissionRpc(walletAdmission);
  const publicChainRpc = require('./chain-public-channel').createPublicChainRpc(require('./chain-public-channel').inheritedPublicChain());
  bind(ConnectionHandler).toConstantValue(new RpcConnectionHandler('/services/ynx-public-chain', () => publicChainRpc));
  bind(BackendApplicationContribution).toConstantValue({ onStop: () => publicChainRpc.close() });
  bind(ConnectionHandler).toConstantValue(new RpcConnectionHandler('/services/ynx-wallet-admission', () => walletAdmissionRpc));
  bind(BackendApplicationContribution).toConstantValue({ onStop: () => walletAdmission.close() });
  const drafts = new DraftRecoveryStore();
  const draftApi = Object.freeze({ list: () => drafts.list(), getBaseline: (uri, text) => drafts.getBaseline(uri, text),
    upsert: entry => drafts.upsert(entry), remove: uri => drafts.remove(uri) });
  bind(ConnectionHandler).toConstantValue(new RpcConnectionHandler('/services/ynx-draft-recovery', () => draftApi));
  const contextApi = Object.freeze({ getContext: () => process.env.YNX_WORKSPACE_MODE === 'local'
    ? { mode: 'local', workspace: process.env.YNX_LOCAL_WORKSPACE, pythonDefault: process.env.YNX_IDE_PYTHON_ENTRY } : { mode: 'hosted' } });
  bind(ConnectionHandler).toConstantValue(new RpcConnectionHandler('/services/ynx-local-workbench-context', () => contextApi));
  if (process.env.YNX_WORKSPACE_MODE === 'local') {
    const storage = new LocalWorkbenchStorageStore();
    const api = Object.freeze({ getData: key => storage.getData(key), setData: (key, value, remove) => storage.setData(key, value, remove), flush: () => storage.flush() });
    bind(ConnectionHandler).toConstantValue(new RpcConnectionHandler('/services/ynx-local-workbench-storage', () => api));
    const fileJournal = createWorkspaceFileJournalApi();
    bind(ConnectionHandler).toConstantValue(new RpcConnectionHandler('/services/ynx-workspace-file-journal', () => fileJournal));
  }
  if (process.platform === 'darwin') rebind(ProcessUtils).to(YnxProcessUtils).inSingletonScope();
  bind(PluginHostEnvironmentVariable).toConstantValue({
    process(env) {
      // The framework's legacy navigator getter returns undefined but leaves
      // `'navigator' in globalThis` true. Older real VS Code language extensions
      // then select browser-only capabilities inside this Node host. Skip that
      // getter while disabling Node's experimental browser global at startup.
      env.THEIA_SUPPORT_NODE_GLOBAL_NAVIGATOR = 'true';
      delete env.YNX_MARKETPLACE_PIPE;
      delete env.YNX_PUBLIC_CHAIN_PIPE;
      if (Number(process.versions.node.split('.')[0]) >= 21)
        env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --no-experimental-global-navigator`.trim();
    },
  });
  let adapter;
  bind(BackendApplicationContribution).toConstantValue({
    configure(app) {
      app.use((request, response, next) => {
        if (['/', '/index.html', '/secondary-window.html'].includes(request.path)) {
          response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'");
        }
        next();
      });
    },
    onStart() {
      const entry = process.env.YNX_IDE_DAP_ENTRY, port = process.env.YNX_IDE_DAP_PORT;
      if (!entry && !port) return;
      if (!entry?.startsWith('/') || !/^\d{4,5}$/.test(port || '') || Number(port) > 65535) throw Error('Invalid operator-provided debug runtime.');
      const env = Object.fromEntries(['PATH', 'SHELL', 'TMPDIR', 'NODE_OPTIONS'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      adapter = spawn(process.execPath, [entry, port, '127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      adapter.stdout.pipe(process.stdout); adapter.stderr.pipe(process.stderr);
      adapter.on('error', error => console.error('YNX debug adapter startup failed', error));
    },
    onStop() { if (adapter?.exitCode === null && adapter?.signalCode === null) adapter.kill('SIGTERM'); },
  });
});
