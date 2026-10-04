export type CopiedSelection = { uri: string; version: number; fullTextDigest: string; selectedText: string; sessionId: string };

// This checks clipboard formatting for display, not file or identity authority.
// The server still validates the request and the editor checks the live file.
export function parseCopiedSelection(text: string, sessionId: string): CopiedSelection {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const invalid = () => Error('Copy a selection from this editor session with YNX: Copy Selected Context for Review.');
  if (bytes(text) > 512 * 1024) throw invalid();
  let value;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== 'fullTextDigest,selectedText,sessionId,uri,version' ||
      !sessionId || value.sessionId !== sessionId || typeof value.uri !== 'string' || !value.uri || value.uri.length > 2048 ||
      !Number.isSafeInteger(value.version) || value.version < 0 || typeof value.fullTextDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.fullTextDigest) ||
      typeof value.selectedText !== 'string' || !value.selectedText.length || bytes(value.selectedText) > 64 * 1024) throw invalid();
  try { if (new URL(value.uri).protocol !== 'file:') throw invalid(); } catch { throw invalid(); }
  return value;
}

export function selectionFilename(selection: CopiedSelection): string {
  const name = new URL(selection.uri).pathname.split('/').pop() || 'Selected file';
  try { return decodeURIComponent(name); } catch { return name; }
}
