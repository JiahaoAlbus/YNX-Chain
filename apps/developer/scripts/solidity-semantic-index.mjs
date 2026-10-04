// Compact only compiler-authored declaration/reference locations. This index
// does not infer symbols from lexical matches or execute source code.
export function soliditySemanticIndex(output, sources) {
  const fileIds = new Map(), declarations = [], references = [];
  for (const [name, row] of Object.entries(output.sources || {})) {
    if (Object.hasOwn(sources, name) && Number.isSafeInteger(row.id) && row.id >= 0) fileIds.set(row.id, name);
  }
  function location(src) {
    if (typeof src !== 'string' || !/^\d+:\d+:\d+$/.test(src)) return undefined;
    const [start, length, fileId] = src.split(':').map(Number), file = fileIds.get(fileId);
    if (!file || !Number.isSafeInteger(start) || !Number.isSafeInteger(length)) return undefined;
    const bytes = Buffer.from(sources[file].content), end = start + length;
    if (!Number.isSafeInteger(end) || end > bytes.length || (start < bytes.length && (bytes[start] & 0xc0) === 0x80) || (end < bytes.length && (bytes[end] & 0xc0) === 0x80)) return undefined;
    return { file, start, end };
  }
  const kinds = new Set(['ContractDefinition', 'FunctionDefinition', 'ModifierDefinition', 'VariableDeclaration', 'StructDefinition', 'EnumDefinition', 'EnumValue', 'EventDefinition', 'ErrorDefinition', 'UserDefinedValueTypeDefinition']);
  const stack = Object.entries(output.sources || {}).filter(([name]) => Object.hasOwn(sources, name)).map(([, row]) => ({ value: row.ast, parentId: undefined }));
  let visited = 0;
  while (stack.length) {
    if (++visited > 100000) throw Object.assign(new Error('The Solidity semantic tree exceeds its limit.'), { status: 413, code: 'compiler_semantic_limit' });
    const { value: node, parentId } = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (const value of node) stack.push({ value, parentId }); continue; }
    const id = Number.isSafeInteger(node.id) && node.id >= 0 ? node.id : undefined;
    const definition = kinds.has(node.nodeType) && typeof node.name === 'string' && node.name.length ? location(node.nameLocation || node.src) : undefined;
    if (definition && id !== undefined) declarations.push({ id, name: node.name, kind: node.nodeType, location: definition, ...(parentId !== undefined ? { parentId } : {}), ...(Number.isSafeInteger(node.scope) && node.scope >= 0 ? { scopeId: node.scope } : {}), ...(typeof node.typeDescriptions?.typeString === 'string' ? { type: node.typeDescriptions.typeString } : {}) });
    const reference = Number.isSafeInteger(node.referencedDeclaration) && node.referencedDeclaration >= 0 ? location(node.memberLocation || node.src) : undefined;
    if (reference) references.push({ targetId: node.referencedDeclaration, location: reference, ...(typeof node.typeDescriptions?.typeString === 'string' ? { type: node.typeDescriptions.typeString } : {}) });
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push({ value, parentId: id ?? parentId });
    if (declarations.length + references.length > 16384) throw Object.assign(new Error('The Solidity semantic index exceeds its limit.'), { status: 413, code: 'compiler_semantic_limit' });
  }
  const known = new Set(declarations.map(row => row.id));
  const byLocation = (a, b) => a.location.file.localeCompare(b.location.file) || a.location.start - b.location.start || a.location.end - b.location.end;
  return { protocol: 'ynx-solidity-semantics/v1', declarations: declarations.sort(byLocation), references: references.filter(row => known.has(row.targetId)).sort(byLocation) };
}
