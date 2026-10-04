// The compiler's parse tree supplies declarations even while a member name
// is unfinished. Suggestions never reuse a previous document's symbol index.
function completionSymbols(index, file, offset, receiver) {
  const scopes = index.scopes || [], declarations = index.declarations || [];
  const byId = new Map(scopes.map(row => [row.id, row]));
  const enclosing = scopes.filter(row => row.location.file === file && row.location.start <= offset && offset <= row.location.end).sort((a, b) => (a.location.end - a.location.start) - (b.location.end - b.location.start));
  const visibleScopes = new Set(enclosing.map(row => row.id));
  const visible = declarations.filter(row => row.location.file === file && visibleScopes.has(row.scopeId) && !(row.kind === 'VariableDeclaration' && byId.get(row.scopeId)?.kind === 'Block' && row.location.start > offset));
  for (const imported of (index.imports || []).filter(row => row.file === file)) {
    if (imported.namespace) continue;
    for (const row of declarations.filter(row => row.location.file === imported.source && byId.get(row.scopeId)?.kind === 'SourceUnit')) {
      const alias = imported.symbols.find(alias => alias.name === row.name);
      if (imported.symbols.length && !alias) continue;
      visible.push({ ...row, name: alias?.local || row.name });
    }
  }
  if (!receiver) return visible.filter(row => row.name !== '__ynx_completion');
  const builtin = {
    msg: ['sender', 'value', 'data', 'sig'],
    tx: ['origin', 'gasprice'],
    block: ['number', 'timestamp', 'chainid', 'basefee', 'coinbase', 'gaslimit', 'prevrandao'],
  };
  if (builtin[receiver]) return builtin[receiver].map(name => ({ name, kind: 'VariableDeclaration', type: `Solidity ${receiver} member` }));
  let target, instance = false;
  if (receiver === 'this') {
    target = declarations.find(row => row.id === enclosing.find(row => row.kind === 'ContractDefinition')?.id); instance = true;
  } else {
    const rank = row => { const index = enclosing.findIndex(scope => scope.id === row.scopeId); return index < 0 ? enclosing.length : index; };
    const candidates = visible.filter(row => row.name === receiver).sort((a, b) => rank(a) - rank(b));
    target = candidates[0];
    if (target?.kind === 'VariableDeclaration') {
      instance = true;
      const types = visible.filter(row => ['ContractDefinition', 'StructDefinition', 'EnumDefinition'].includes(row.kind) && row.name === target.typeName);
      target = types.length === 1 ? types[0] : undefined;
    }
  }
  if (!target || !['ContractDefinition', 'StructDefinition', 'EnumDefinition'].includes(target.kind)) return [];
  return declarations.filter(row => row.scopeId === target.id && row.name !== '__ynx_completion' &&
    (target.kind !== 'ContractDefinition' || (instance ? ['public', 'external'].includes(row.visibility) : target.contractKind === 'library' && row.visibility !== 'private')));
}
module.exports = { completionSymbols };
