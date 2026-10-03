// Copyright (C) 2018-2019 TypeFox and others.
// Adapted from @theia/core 1.76.0 view-container.js doRestoreState.
// EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0.
// https://www.eclipse.org/legal/epl-2.0/
// YNX modification: cancel deferred sizing when the view has been disposed.
const { ViewContainer } = require('@theia/core/lib/browser/view-container');
const { waitForRevealed } = require('@theia/core/lib/browser/widgets');
const { decorate, injectable } = require('@theia/core/shared/inversify');
class YnxViewContainer extends ViewContainer {
  doRestoreState(state) {
    if (this.isDisposed) return;
    this.setTitleOptions(state.title);
    for (const part of state.parts) {
      if (part.widget) this.addWidget(part.widget, undefined, part.originalContainerId, part.originalContainerTitle || {});
    }
    const saved = state.parts.filter(value => this.getParts().some(part => part.partId === value.partId));
    for (let index = 0; index < saved.length; index++) {
      const part = this.getParts().find(value => value.partId === saved[index].partId);
      if (part) this.containerLayout.insertWidget(index, part);
    }
    for (const part of this.getParts()) {
      const value = saved.find(value => value.partId === part.partId);
      if (value) { part.setHidden(value.hidden); part.collapsed = value.collapsed || !value.relativeSize; }
      else if (part.canHide) part.hide();
      this.refreshMenu(part);
    }
    waitForRevealed(this).then(() => {
      // Disabling an extension or reloading disposes a hidden container before
      // waitForRevealed settles. Its layout must not be touched afterwards.
      if (this.isDisposed) return;
      this.containerLayout.setPartSizes(saved.map(value => value.relativeSize));
      this.updateSplitterVisibility();
    });
  }
}
decorate(injectable(), YnxViewContainer);
module.exports = { YnxViewContainer };
