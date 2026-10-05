// Preserve Theia's process resolver; admission applies only to the complete
// product-generated pair, never to a label alone or a user's customized task.
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
function generatedPair(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return;
  for (const language of ['C', 'C++']) {
    const build = 'YNX: Build active ' + language, sdk = raw[0]?.args?.[3];
    if (typeof sdk !== 'string' || !sdk.startsWith('/Library/Developer/CommandLineTools/SDKs/')) continue;
    const expected = [
      { label: build, type: 'process', command: '/Library/Developer/CommandLineTools/usr/bin/' + (language === 'C' ? 'clang' : 'clang++'),
        args: [language === 'C' ? '-std=c11' : '-std=c++17', '-fmessage-length=0', '-isysroot', sdk, '-g', '-O0', '${file}', '-o', '${fileDirname}/${fileBasenameNoExtension}'],
        options: { cwd: '${fileDirname}' }, problemMatcher: ['$gcc'], group: { kind: 'build', isDefault: true }, presentation: { reveal: 'always' } },
      { label: 'YNX: Run active ' + language, type: 'process', command: '${fileDirname}/${fileBasenameNoExtension}', dependsOn: [build],
        options: { cwd: '${fileDirname}' }, problemMatcher: [], presentation: { reveal: 'always' } },
    ];
    if (equal(raw, expected)) return { language, expected };
  }
}
class GeneratedCppTaskGuard {
  constructor(resolver, configurations, messages, commands, locale) { Object.assign(this, { resolver, configurations, messages, commands, locale }); }
  async resolveTask(task) {
    const raw = this.configurations.getRawTaskConfigurations(task._scope), pair = generatedPair(raw);
    const item = pair?.expected.find(value => value.label === task.label);
    if (!item || task.type !== 'process' || task._scope !== task._source || typeof task._scope !== 'string' ||
        !['command', 'args', 'options', 'dependsOn'].every(key => equal(task[key], item[key]))) return this.resolver.resolveTask(task);
    const snapshot = JSON.stringify(raw), isBuild = !!item.args;
    // A run task has no source argument. Resolve a temporary source argument in
    // the same mature resolver pass, then remove it before running the program.
    const resolved = await this.resolver.resolveTask(isBuild ? task : { ...task, args: ['${file}'] });
    if (JSON.stringify(this.configurations.getRawTaskConfigurations(task._scope)) !== snapshot) {
      const message = /^zh\b/i.test(this.locale || '') ? 'C/C++ 任务配置已变化，本次操作已取消，请重新运行。' : 'C/C++ task configuration changed. This operation was cancelled; run the task again.';
      Promise.resolve(this.messages.error(message)).catch(() => {});
      throw Error(message);
    }
    const source = resolved.args?.[isBuild ? 6 : 0], extension = typeof source === 'string' ? source.slice(source.lastIndexOf('.')) : '';
    const allowed = pair.language === 'C' ? ['.c', '.i'] : ['.cpp', '.cc', '.cxx', '.c++', '.C', '.ii', '.cppm', '.ixx'];
    const output = typeof source === 'string' ? source.slice(0, source.lastIndexOf('.')) : undefined;
    if (!source?.startsWith('/') || !allowed.includes(extension) || (isBuild ? resolved.args?.[8] : resolved.command) !== output) {
      const zh = /^zh\b/i.test(this.locale || ''), python = extension === '.py';
      const message = zh ? '此 YNX C/C++ 活动文件任务与当前源文件不匹配，未启动编译或运行。请选择 C/C++ 源文件或对应语言的运行入口。' : 'This YNX active-file C/C++ task does not match the resolved source. No build or program was started. Select a C/C++ source or its language-specific run action.';
      const pythonAction = zh ? '调试 Python 文件' : 'Debug Python File', viewAction = zh ? '打开运行和调试' : 'Open Run and Debug';
      Promise.resolve(this.messages.error(message, ...(python ? [pythonAction] : []), viewAction)).then(action => {
        if (action === pythonAction && python) return this.commands.executeCommand('debugpy.debugInTerminal');
        if (action === viewAction) return this.commands.executeCommand('workbench.view.debug');
      }).catch(error => this.messages.error(String(error.message || error)));
      throw Error(message);
    }
    if (!isBuild) resolved.args = undefined;
    return resolved;
  }
}
module.exports = { GeneratedCppTaskGuard, generatedPair };
