const URI = require('@theia/core/lib/common/uri').default;

class DraftRecoveryContribution {
  constructor(editors, service, messages, state) {
    Object.assign(this, { editors, service, messages, state }); this.tracked = new Map(); this.serial = Promise.resolve(); this.warned = new Set();
  }
  onStart() {
    this.editors.onCreated(widget => this.track(widget));
    for (const widget of this.editors.all) this.track(widget);
    this.state.reachedState('ready').then(() => this.restore()).catch(error => this.warning('restore', error));
  }
  warning(uri, error) {
    if (this.warned.has(uri)) return;
    this.warned.add(uri); this.messages.warn(`${error.message || error} Save your changes before closing this window.`);
  }
  enqueue(uri, task) {
    this.serial = this.serial.then(task).then(() => this.warned.delete(uri)).catch(error => this.warning(uri, error));
    return this.serial;
  }
  track(widget) {
    const uri = widget.getResourceUri()?.toString(), document = widget.editor.document;
    if (!uri || !['file', 'untitled'].includes(new URI(uri).scheme)) return;
    if (this.tracked.has(uri)) { this.watchClose(widget, uri, this.tracked.get(uri)); return; }
    const record = { widget, document, hadDirty: document.dirty, baseline: this.service.getBaseline(uri, document.getText()).catch(error => ({ error })) };
    this.tracked.set(uri, record);
    const schedule = () => {
      clearTimeout(record.timer);
      if (!document.dirty) {
        record.baseline = this.service.getBaseline(uri, document.getText()).catch(error => ({ error }));
        if (record.hadDirty) { record.hadDirty = false; this.enqueue(uri, () => this.service.remove(uri)); }
      } else { record.hadDirty = true; record.timer = setTimeout(() => {
        const version = document.version, text = document.getText();
        this.enqueue(uri, async () => {
          const baseline = await record.baseline;
          if (baseline.error) throw baseline.error;
          if (document.dirty && document.version === version) await this.service.upsert({ uri, text, baseHash: baseline.hash });
        });
      }, 200); }
    };
    record.content = document.onContentChanged(schedule); record.dirty = document.onDirtyChanged(schedule);
    this.watchClose(widget, uri, record);
    if (document.dirty) schedule();
  }
  watchClose(widget, uri, record) {
    widget.onDispose(() => {
      if (this.tracked.get(uri) !== record) return;
      const other = this.editors.all.find(item => item !== widget && !item.isDisposed && item.getResourceUri()?.toString() === uri);
      if (other) { record.widget = other; return; }
      clearTimeout(record.timer); record.content.dispose(); record.dirty.dispose(); this.tracked.delete(uri);
      // The framework reverts after an explicit Don't Save. Reload/disconnect
      // of a dirty model retains its checkpoint instead of discarding it.
      if (record.hadDirty && !record.document.dirty) this.enqueue(uri, () => this.service.remove(uri));
    });
  }
  async restore() {
    const result = await this.service.list();
    if (result.warning && result.entries.length) this.messages.warn(result.warning);
    for (const entry of result.entries) {
      const uri = new URI(entry.uri);
      let widget, baseline;
      try {
        widget = await this.editors.open(uri, { mode: 'reveal', preview: false });
        if (widget.editor.document.dirty) continue;
        const version = widget.editor.document.version;
        baseline = await this.service.getBaseline(entry.uri, widget.editor.document.getText());
        if (widget.editor.document.dirty || widget.editor.document.version !== version) continue;
      } catch {}
      if (widget && (uri.scheme === 'untitled' || entry.baseHash && baseline?.hash === entry.baseHash)) {
        widget.editor.document.applySnapshot({ value: entry.text });
      } else {
        // Keep the newer file on disk. A recovered untitled copy is backed up
        // before the old journal record is retired; neither is auto-saved.
        const recovered = new URI(`untitled:Recovered-${Date.now()}-${uri.path.base}`);
        const copy = await this.editors.open(recovered, { mode: 'reveal', preview: false });
        copy.editor.document.applySnapshot({ value: entry.text });
        await this.service.upsert({ uri: recovered.toString(), text: entry.text, baseHash: null });
        await this.service.remove(entry.uri);
        this.messages.info('The file changed since this draft was backed up. Your draft was opened as a recovered copy.');
      }
    }
  }
}
module.exports = { DraftRecoveryContribution };
