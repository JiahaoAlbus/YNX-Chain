const { ShellCommandBuilder } = require('@theia/process/lib/common/shell-command-builder');

// BSD env stops parsing options at the first assignment. Keep upstream shell
// selection and quoting; only stable-partition the Bash/default env arguments.
class EnvironmentOrderedShellCommandBuilder extends ShellCommandBuilder {
  buildForBash(args, cwd, env) {
    const ordered = env?.length ? [
      ...env.filter(([, value]) => value === null),
      ...env.filter(([, value]) => value !== null),
    ] : env;
    return super.buildForBash(args, cwd, ordered);
  }
}
function bindEnvironmentOrderedShellCommandBuilder(rebind) {
  rebind(ShellCommandBuilder).toDynamicValue(() => new EnvironmentOrderedShellCommandBuilder()).inSingletonScope();
}
module.exports = { EnvironmentOrderedShellCommandBuilder, bindEnvironmentOrderedShellCommandBuilder };
