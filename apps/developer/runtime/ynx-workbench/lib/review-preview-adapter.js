// The framework's virtual text resource lacks the optional readOnly property,
// so Monaco otherwise treats a content-provider document as editable. Restrict
// this adapter to our immutable suggested-change scheme; other resources keep
// their existing behavior and filesystem/write authority.
function install() {
  const { TextContentResource } = require('@theia/plugin-ext/lib/main/browser/workspace-main');
  const marker = Symbol.for('ynx.review-preview-readonly.v1');
  if (TextContentResource.prototype[marker]) return;
  if (Object.getOwnPropertyDescriptor(TextContentResource.prototype, 'readOnly')) throw Error('Review the framework virtual-resource contract before replacing its readOnly property.');
  Object.defineProperty(TextContentResource.prototype, 'readOnly', {
    get() { return this.uri.scheme === 'ynx-review' ? true : undefined; },
  });
  Object.defineProperty(TextContentResource.prototype, marker, { value: true });
}
module.exports = { install };
