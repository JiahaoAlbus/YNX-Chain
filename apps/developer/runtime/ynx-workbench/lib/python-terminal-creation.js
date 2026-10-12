'use strict';

// Shared by the actual plugin-host bundle and its adjacent owned initializer.
// The build plugin externalizes ONLY its inserted import from the pinned module.
const CONTRACT = '5e5e4d521fe829aecf4e4f904fdf5da86d409a0ba5d9ef113bed0a79194b5f9f';
const ATTRIBUTE = 'ynx-debug-terminal-creation';
const pending = new WeakMap();
let registered = false, creating = false;
exports.registerCompiledCreationContract = hash => {
  if (hash !== CONTRACT) throw Error('Unsupported Theia terminal creation contract.');
  registered = true;
};
// This does not expose a marker setter. The returned closure is held only by
// the owned Python descriptor, and never added to the extension's API object.
exports.createPythonTerminalFactory = api => (capability, options) => {
  if (!registered || typeof api.window?.createTerminal !== 'function') throw Error('The owned Python terminal creation bridge is missing.');
  if (creating || !/^[a-f0-9-]{36}$/i.test(capability || '') || !options?.pty) throw Error('Invalid or reentrant Python terminal creation.');
  const entry = { capability, taken: false };
  pending.set(options, entry); creating = true;
  try {
    const terminal = api.window.createTerminal(options);
    if (!entry.taken || !terminal?.id?.promise) throw Error('The Theia terminal creation contract changed.');
    return terminal;
  } finally { creating = false; pending.delete(options); }
};
exports.takeCreationAttributes = options => {
  const entry = pending.get(options);
  if (!entry) return {};
  if (!creating || entry.taken) throw Error('Python terminal creation was reused.');
  entry.taken = true;
  return { attributes: { [ATTRIBUTE]: entry.capability } };
};
exports.CONTRACT = CONTRACT;
exports.ATTRIBUTE = ATTRIBUTE;
