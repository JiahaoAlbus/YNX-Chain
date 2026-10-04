const { parse, modify, applyEdits } = require('jsonc-parser');

function readShortcuts(text, validate) {
  const errors = [], entries = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !Array.isArray(entries) || entries.length > 4096) throw Error('Expected a valid keyboard shortcuts array. Open the JSON file to correct it.');
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string' || !entry.key || typeof entry.command !== 'string' || !entry.command || entry.command === '-'
      || entry.when !== undefined && typeof entry.when !== 'string'
      || entry.context !== undefined && typeof entry.context !== 'string') throw Error('Each shortcut needs a key and command, with optional text conditions.');
    validate?.(entry);
  }
  return entries;
}

// Modify individual JSONC paths, preserving unrelated properties and comments.
function changeShortcuts(text, change, validate) {
  let entries = readShortcuts(text, validate);
  const edit = (path, value) => {
    text = applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' } }));
    entries = readShortcuts(text, validate);
  };
  const row = change.row;
  if (!row || typeof row.command !== 'string' || !row.command || row.command.startsWith('-')) throw Error('Select a registered command.');
  if (change.kind === 'reset') {
    for (let i = entries.length - 1; i >= 0; i--) if ([row.command, '-' + row.command].includes(entries[i].command)) edit([i], undefined);
    return text;
  }
  if (row.index !== undefined && JSON.stringify(entries[row.index]) !== JSON.stringify(row.entry)) throw Error('Shortcuts changed. Refresh this view before editing.');
  if (change.kind === 'remove') {
    if (row.index !== undefined) edit([row.index], undefined);
    else if (row.key) edit([-1], { key: row.key, command: '-' + row.command, ...(row.when !== undefined ? { when: row.when } : {}) });
    return text;
  }
  if (!['edit', 'add'].includes(change.kind)) throw Error('Unknown shortcut change.');
  const entry = { ...(change.kind === 'edit' && row.entry ? row.entry : {}), key: change.key.trim(), command: row.command };
  if (change.when?.trim()) entry.when = change.when.trim(); else delete entry.when;
  // Preserve framework context and arguments when changing a default shortcut.
  if (row.context !== undefined) entry.context = row.context;
  if (row.args !== undefined && !row.entry) entry.args = row.args;
  validate?.(entry);
  if (change.kind === 'edit' && row.index !== undefined) {
    edit([row.index, 'key'], entry.key);
    if (entries[row.index].when !== entry.when) edit([row.index, 'when'], entry.when);
    if (entries[row.index].context !== entry.context) edit([row.index, 'context'], entry.context);
  }
  else {
    if (change.kind === 'edit' && row.key) edit([-1], { key: row.key, command: '-' + row.command, ...(row.when !== undefined ? { when: row.when } : {}) });
    edit([-1], entry);
  }
  return text;
}
module.exports = { readShortcuts, changeShortcuts };
