import { createHash } from 'node:crypto';
import { fault } from './central-identity.mjs';
export const sourceDigest = content => createHash('sha256').update(content).digest('hex');
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === expected.sort().join();
export function validSolidityPath(path) {
  return typeof path === 'string' && path.length <= 240 && path.endsWith('.sol') && !/[\\:\u0000-\u001f\u007f]/.test(path) && !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..');
}
export function reviewedSoliditySnapshot(value, sessionId) {
  if (!keys(value, ['protocol', 'sessionId', 'entryPath', 'sources']) || value.protocol !== 'ynx-solidity-project/v1' || !sessionId || value.sessionId !== sessionId || !validSolidityPath(value.entryPath) || !value.sources || typeof value.sources !== 'object' || Array.isArray(value.sources))
    throw fault('Use a Solidity project snapshot copied from this editor session.', 'compiler_snapshot', 400);
  const entries = Object.entries(value.sources);
  if (!entries.length || entries.length > 32 || !Object.hasOwn(value.sources, value.entryPath)) throw fault('Review between 1 and 32 source files including the entry file.', 'compiler_snapshot', 400);
  let bytes = 0; const sources = {}, sourceDigests = {};
  for (const [path, row] of entries) {
    if (!validSolidityPath(path) || !keys(row, ['content', 'sha256', 'documentVersion']) || typeof row.content !== 'string' || Buffer.byteLength(row.content) > 65536 || (bytes += Buffer.byteLength(row.content)) > 262144 || !Number.isInteger(row.documentVersion) || row.documentVersion < 0 || sourceDigest(row.content) !== row.sha256)
      throw fault('The Solidity snapshot has invalid paths, changed source or exceeds its source limit.', 'compiler_snapshot', 400);
    Object.defineProperty(sources, path, { value: { content: row.content }, enumerable: true });
    Object.defineProperty(sourceDigests, path, { value: row.sha256, enumerable: true });
  }
  return { sourceName: value.entryPath, sources, sourceDigests, sourceBytes: bytes };
}
