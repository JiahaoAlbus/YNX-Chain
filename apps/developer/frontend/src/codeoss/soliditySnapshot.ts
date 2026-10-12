export type SoliditySnapshot = { protocol: 'ynx-solidity-project/v1'; sessionId: string; entryPath: string; sources: Record<string, { content: string; sha256: string; documentVersion: number }> };
export async function parseSoliditySnapshot(text: string, sessionId: string): Promise<SoliditySnapshot> {
  const bytes = (value: string) => new TextEncoder().encode(value);
  if (bytes(text).length > 512 * 1024) throw Error('The project snapshot exceeds 512 KiB.');
  let value;
  try { value = JSON.parse(text); } catch { throw Error('Paste the complete JSON snapshot copied by YNX: Compile Solidity Project.'); }
  const exact = (row: unknown, keys: string[]) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).sort().join() === keys.sort().join();
  const path = (name: unknown): name is string => typeof name === 'string' && name.length <= 240 && name.endsWith('.sol') && !/[\\:\u0000-\u001f\u007f]/.test(name) && !name.startsWith('/') && !name.split('/').some(part => !part || part === '.' || part === '..');
  if (!exact(value, ['protocol', 'sessionId', 'entryPath', 'sources']) || value.protocol !== 'ynx-solidity-project/v1' || !sessionId || value.sessionId !== sessionId || !path(value.entryPath) || !value.sources || typeof value.sources !== 'object' || Array.isArray(value.sources)) throw Error('The snapshot must come from this editor session.');
  const rows = Object.entries(value.sources) as [string, SoliditySnapshot['sources'][string]][];
  if (!rows.length || rows.length > 32 || !Object.hasOwn(value.sources, value.entryPath)) throw Error('Review 1 to 32 Solidity files including the entry source.');
  let total = 0;
  for (const [name, row] of rows) {
    if (!path(name) || !exact(row, ['content', 'sha256', 'documentVersion']) || typeof row.content !== 'string' || bytes(row.content).length > 65536 || (total += bytes(row.content).length) > 262144 || !Number.isInteger(row.documentVersion) || row.documentVersion < 0) throw Error('A project source has an invalid path or exceeds its size limit.');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(row.content)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== row.sha256) throw Error('A source changed after the project snapshot was copied. Capture it again.');
  }
  return value;
}
