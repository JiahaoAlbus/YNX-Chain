const { isAbsolute } = require('node:path');
const URI = require('@theia/core/lib/common/uri').default;
const { AbstractLineMatcher } = require('@theia/task/lib/node/task-abstract-line-matcher');
const { FileLocationKind } = require('@theia/task/lib/common/problem-matcher-protocol');
const installed = Symbol.for('ynx.gcc.absolute-resource-adapter');

// Compiler tasks may emit absolute source paths even when their matcher has a
// workspace-relative default. Preserve the upstream resolver for all other
// matchers and relative paths, including contributed URI providers.
exports.install = () => {
  const prototype = AbstractLineMatcher.prototype;
  if (prototype[installed]) return;
  const resolve = prototype.getResource;
  prototype.getResource = function (filename, matcher) {
    if (matcher.name === 'gcc' && matcher.fileLocation === FileLocationKind.Relative && isAbsolute(filename)) {
      return matcher.uriProvider ? matcher.uriProvider(filename) : URI.fromFilePath(filename);
    }
    return resolve.call(this, filename, matcher);
  };
  Object.defineProperty(prototype, installed, { value: true });
};
