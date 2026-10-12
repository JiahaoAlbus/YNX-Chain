// A modal can be closed while its asynchronous validator is pending. Only
// the same still-open promise may receive that validator's eventual result.
async function acceptCurrentDialog(CancellationTokenSource, DialogError, Widget) {
  const resolve = this.resolve;
  if (typeof resolve !== 'function') return;
  this.acceptCancellationSource.cancel();
  this.acceptCancellationSource = new CancellationTokenSource();
  const token = this.acceptCancellationSource.token, value = this.value;
  const error = await this.isValid(value, 'open');
  if (token.isCancellationRequested || this.resolve !== resolve) return;
  if (!DialogError.getResult(error)) this.setErrorMessage(error);
  else { resolve(value); Widget.detach(this); }
}
function install() {
  const { AbstractDialog, DialogError } = require('@theia/core/lib/browser/dialogs');
  const { Widget } = require('@theia/core/lib/browser/widgets');
  const { CancellationTokenSource } = require('@theia/core/lib/common');
  const marker = Symbol.for('ynx.dialog-accept-liveness.v1');
  if (AbstractDialog.prototype[marker]) return;
  Object.defineProperty(AbstractDialog.prototype, marker, { value: true });
  AbstractDialog.prototype.accept = function () { return acceptCurrentDialog.call(this, CancellationTokenSource, DialogError, Widget); };
}
module.exports = { install, acceptCurrentDialog };
