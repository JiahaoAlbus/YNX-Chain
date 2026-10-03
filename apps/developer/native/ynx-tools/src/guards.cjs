const crypto = require('node:crypto');
const fs = require('node:fs/promises'), path = require('node:path');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function capture(document, text) { return { uri: document.uri.toString(), version: document.version, fullTextDigest: digest(document.getText()), selectedText: text }; }
function validateChanges(value, documents, sessionId) {
  if (!sessionId || value?.sessionId !== sessionId || !value || value.protocol !== 'ynx-reviewed-text/v1' || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 16) throw Error('Use a reviewed YNX text change bundle.');
  const seen = new Set();
  const reviewed = [];
  for (const change of value.changes) {
    const document = documents.get(change.uri);
    if (seen.has(change.uri) || !document || document.version !== change.version || digest(document.getText()) !== change.fullTextDigest) throw Error('A document changed or is not open. Preserve both versions and review again.');
    let text = change.text;
    if (Object.hasOwn(change, 'replacements')) {
      if (Object.hasOwn(change, 'text') || !Array.isArray(change.replacements) || change.replacements.length !== 1) throw Error('Use one exact reviewed selection replacement.');
      const replacement = change.replacements[0], original = document.getText();
      if (!replacement || Object.keys(replacement).sort().join() !== 'find,replace' || typeof replacement.find !== 'string' || !replacement.find.length || typeof replacement.replace !== 'string') throw Error('Use one exact reviewed selection replacement.');
      const start = original.indexOf(replacement.find);
      if (start < 0 || original.indexOf(replacement.find, start + 1) >= 0) throw Error('The reviewed selection is missing or appears more than once. Select a unique passage and review again.');
      text = original.slice(0, start) + replacement.replace + original.slice(start + replacement.find.length);
    }
    if (typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024) throw Error('The reviewed document exceeds its text boundary.');
    reviewed.push({ ...change, text });
    seen.add(change.uri);
  }
  return reviewed;
}
async function assertWorkspacePath(documentPath, workspacePath) {
  const root = await fs.realpath(workspacePath), file = await fs.realpath(documentPath);
  if (!file.startsWith(root + path.sep)) throw Error('The reviewed file is outside this project workspace.');
}
module.exports = { digest, capture, validateChanges, assertWorkspacePath };
