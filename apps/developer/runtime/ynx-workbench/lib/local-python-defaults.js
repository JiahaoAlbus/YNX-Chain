const CLT = '/Library/Developer/CommandLineTools/';
class LocalPythonDefaults {
  constructor(contextApi, schema) { this.contextApi = contextApi; this.schema = schema; }
  async initialize() {
    let context;
    try { context = await this.contextApi.getContext(); } catch (_) { return; }
    if (!context) return;
    const path = context.pythonDefault;
    if (context.mode !== 'local' || typeof path !== 'string' || !path.startsWith(CLT) || path.includes('\0') || path.split('/').includes('..')) return;
    // Default scope only. User/workspace settings and the Python extension's
    // persisted interpreter selection retain their existing precedence.
    this.registration = this.schema.registerOverride('python.defaultInterpreterPath', undefined, path);
  }
  onStop() { this.registration?.dispose(); }
}
module.exports = { LocalPythonDefaults };
