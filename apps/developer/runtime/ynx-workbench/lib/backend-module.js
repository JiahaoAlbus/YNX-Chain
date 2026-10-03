const { ContainerModule, injectable, decorate } = require('@theia/core/shared/inversify');
const { ProcessUtils } = require('@theia/core/lib/node/process-utils');
const { spawnSync, spawn } = require('node:child_process');
const { BackendApplicationContribution } = require('@theia/core/lib/node');
const { join } = require('node:path');

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
    if (result.error || result.status !== 0) throw result.error || Error(`Owned process cleanup refused: ${result.stderr}`);
  }
}
decorate(injectable(), YnxProcessUtils);
module.exports.default = new ContainerModule((bind, unbind, isBound, rebind) => {
  if (process.platform === 'darwin') rebind(ProcessUtils).to(YnxProcessUtils).inSingletonScope();
  let adapter;
  bind(BackendApplicationContribution).toConstantValue({
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
