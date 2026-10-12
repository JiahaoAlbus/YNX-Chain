'use strict';
const { WorkspaceFileJournal, LIMITS } = require('./workspace-file-journal');
const fail = message => Object.assign(Error(message), { code: 'JOURNAL_PROTOCOL' });
const keys = new Set(['type', 'path', 'from', 'to', 'bytesBase64', 'mode', 'directory', 'overwrite', 'ignoreIfExists', 'ignoreIfNotExists', 'recursive']);
function decodeOperations(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > LIMITS.steps) throw fail('Invalid file transaction batch.');
  let bytes = 0;
  return operations.map(operation => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) || Object.keys(operation).some(key => !keys.has(key))) throw fail('Invalid file transaction operation.');
    if (!['create', 'write', 'move', 'delete'].includes(operation.type)) throw fail('Unknown file transaction operation.');
    for (const key of ['path', 'from', 'to']) if (operation[key] !== undefined && (typeof operation[key] !== 'string' || operation[key].length > 8192)) throw fail('Invalid file transaction path.');
    for (const key of ['directory', 'overwrite', 'ignoreIfExists', 'ignoreIfNotExists', 'recursive']) if (operation[key] !== undefined && typeof operation[key] !== 'boolean') throw fail('Invalid file transaction flag.');
    if (operation.mode !== undefined && (!Number.isInteger(operation.mode) || operation.mode < 0 || operation.mode > 0o777)) throw fail('Invalid file transaction mode.');
    const { bytesBase64, ...result } = operation;
    if (bytesBase64 !== undefined) {
      if (!['create', 'write'].includes(operation.type) || operation.directory || typeof bytesBase64 !== 'string' || bytesBase64.length > Math.ceil(LIMITS.bytes / 3) * 4) throw fail('Invalid file transaction contents.');
      const raw = Buffer.from(bytesBase64, 'base64');
      if (raw.toString('base64') !== bytesBase64 || (bytes += raw.length) > LIMITS.bytes) throw fail('Invalid or oversized raw file contents.');
      result.bytes = raw;
    }
    if (operation.type === 'write' && bytesBase64 === undefined) throw fail('Write contents are required.');
    return result;
  });
}
function createWorkspaceFileJournalApi(environment = process.env) {
  const journal = new WorkspaceFileJournal(environment);
  // Roots and project binding come exclusively from the existing local driver.
  // A caller cannot select another workspace/profile or create CORE admission.
  return Object.freeze({
    prepare: operations => journal.prepare(decodeOperations(operations)),
    apply: id => journal.apply(id),
    undo: id => journal.undo(id),
    redo: id => journal.redo(id),
    recover: (id, destination) => journal.recover(id, destination),
    inspect: id => journal.inspect(id),
    describe: id => journal.operation(async () => {
      const scope = await journal.scope(), entry = await journal.load(scope, id);
      const describe = state => Object.fromEntries(Object.entries(state).map(([path, node]) => [path, {
        type: node.type, mode: node.mode,
        ...(node.type === 'file' ? { sha256: node.blob, size: Buffer.from(entry.blobs[node.blob], 'base64').length } : {}),
      }]));
      return { id: entry.id, projectId: scope.projectId, workspace: scope.workspace,
        status: entry.status, position: entry.position, pending: Boolean(entry.pending),
        before: describe(entry.states[0]), after: describe(entry.states.at(-1)) };
    }),
  });
}
module.exports = { createWorkspaceFileJournalApi, decodeOperations };
