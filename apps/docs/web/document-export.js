function escapeHTML(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Export only an explicitly supplied, acknowledged version snapshot.
export function createDocsLocalExport({id, name, version, content}, format) {
  if (typeof id !== 'string' || typeof name !== 'string' || !Number.isInteger(version) || version < 1 || typeof content !== 'string') throw new TypeError('A saved document version is required for export');
  const filename = (name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'document') + `-v${version}`;
  switch (format) {
    case 'text': return {body: content, type: 'text/plain;charset=utf-8', filename: filename + '.txt'};
    case 'markdown': return {body: content, type: 'text/markdown;charset=utf-8', filename: filename + '.md'};
    case 'html': return {body: `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(name)}</title></head><body><pre>${escapeHTML(content)}</pre></body></html>`, type: 'text/html;charset=utf-8', filename: filename + '.html'};
    case 'json': return {body: JSON.stringify({id, name, version, content}, null, 2) + '\n', type: 'application/json;charset=utf-8', filename: filename + '.json'};
    default: throw new TypeError('Unsupported document export format');
  }
}
