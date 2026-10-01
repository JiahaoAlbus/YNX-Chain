const crypto = require('node:crypto');
const fs = require('node:fs/promises'), path = require('node:path');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function capture(document, text) { return { uri: document.uri.toString(), version: document.version, fullTextDigest: digest(document.getText()), selectedText: text }; }
function validateChanges(value, documents, sessionId) {
  if (!sessionId || value?.sessionId !== sessionId || !value || value.protocol !== 'ynx-reviewed-text/v1' || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 16) throw Error('Use a reviewed YNX text change bundle.');
  const seen = new Set();
  for (const change of value.changes) {
    const document = documents.get(change.uri);
    if (seen.has(change.uri) || !document || document.version !== change.version || digest(document.getText()) !== change.fullTextDigest || typeof change.text !== 'string' || Buffer.byteLength(change.text) > 256 * 1024) throw Error('A document changed or is not open. Preserve both versions and review again.');
    seen.add(change.uri);
  }
  return value.changes;
}
async function assertWorkspacePath(documentPath, workspacePath) {
  const root = await fs.realpath(workspacePath), file = await fs.realpath(documentPath);
  if (!file.startsWith(root + path.sep)) throw Error('The reviewed file is outside this project workspace.');
}
module.exports = { digest, capture, validateChanges, assertWorkspacePath };
