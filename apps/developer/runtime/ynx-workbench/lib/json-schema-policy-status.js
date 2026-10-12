const { DisposableCollection } = require('@theia/core/lib/common/disposable');
const { StatusBarAlignment } = require('@theia/core/lib/browser/status-bar/status-bar');
const ID = 'ynx-json-schema-policy';

// Surface the effective product preference independently of the extension's
// optional language-status UI. This grants no network or schema access.
class JsonSchemaPolicyStatus {
  constructor(editors, preferences, statusBar) {
    this.editors = editors; this.preferences = preferences; this.statusBar = statusBar;
    this.listeners = new DisposableCollection(); this.editorListeners = new DisposableCollection();
    this.stopped = false;
  }
  async onStart() {
    await this.preferences.ready;
    if (this.stopped) return;
    this.listeners.push(this.editors.onCurrentEditorChanged(() => this.followEditor()));
    this.listeners.push(this.preferences.onPreferenceChanged(change => {
      if (change.preferenceName === 'json.schemaDownload.enable') this.update();
    }));
    this.followEditor();
  }
  followEditor() {
    this.editorListeners.dispose();
    const editor = this.editors.currentEditor?.editor;
    if (editor) this.editorListeners.push(editor.onLanguageChanged(() => this.update()));
    this.update();
  }
  update() {
    if (this.stopped) return;
    const document = this.editors.currentEditor?.editor.document;
    if (!document || !['json', 'jsonc'].includes(document.languageId)
      || this.preferences.get('json.schemaDownload.enable', undefined, document.uri) !== false) {
      this.statusBar.removeElement(ID); return;
    }
    this.statusBar.setElement(ID, {
      text: 'Local schemas', alignment: StatusBarAlignment.RIGHT, priority: 0,
      tooltip: 'Remote JSON schema downloads are disabled. Local project and bundled extension schemas are available.',
    });
  }
  onStop() {
    this.stopped = true; this.listeners.dispose(); this.editorListeners.dispose();
    this.statusBar.removeElement(ID);
  }
}
module.exports = { JsonSchemaPolicyStatus };
