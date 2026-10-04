// The compiler's parse tree supplies declarations even while a member name
// is unfinished. Suggestions never reuse a previous document's symbol index.
function completionSymbols(index, file, offset, receiver) {
  const scopes = index.scopes || [], declarations = index.declarations || [];
  const byId = new Map(scopes.map(row => [row.id, row]));
  const enclosing = scopes.filter(row => row.location.file === file && row.location.start <= offset && offset <= row.location.end).sort((a, b) => (a.location.end - a.location.start) - (b.location.end - b.location.start));
  const visibleScopes = new Set(enclosing.map(row => row.id));
  const visible = declarations.filter(row => row.location.file === file && visibleScopes.has(row.scopeId) && !(row.kind === 'VariableDeclaration' && byId.get(row.scopeId)?.kind === 'Block' && row.location.start > offset));
  const topLevel = source => declarations.filter(row => row.location.file === source && byId.get(row.scopeId)?.kind === 'SourceUnit');
  const resolveBase = (contract, base) => {
    if (base.id !== undefined) return declarations.find(row => row.id === base.id && row.kind === 'ContractDefinition');
    const pieces = base.name.split('.');
    let candidates = pieces.length === 1 ? topLevel(contract.location.file).filter(row => row.name === base.name) : [];
    if (!candidates.length) for (const imported of (index.imports || []).filter(row => row.file === contract.location.file)) {
      if (imported.namespace) {
        if (pieces.length === 2 && pieces[0] === imported.namespace) candidates.push(...topLevel(imported.source).filter(row => row.name === pieces[1]));
      } else if (pieces.length === 1) {
        candidates.push(...topLevel(imported.source).filter(row => {
          const alias = imported.symbols.find(alias => alias.name === row.name);
          return (!imported.symbols.length || alias) && (alias?.local || row.name) === base.name;
        }));
      }
    }
    candidates = [...new Map(candidates.filter(row => row.kind === 'ContractDefinition').map(row => [row.id, row])).values()];
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  // Resolve only compiler-authored base paths against its declaration/import
  // tables. Ambiguous imports, cycles and inconsistent C3 graphs yield no bases.
  const linearizations = new Map();
  const linearize = (contract, seen = new Set()) => {
    if (seen.has(contract.id) || seen.size >= 64) return undefined;
    if (linearizations.has(contract.id)) return linearizations.get(contract.id);
    if (contract.linearizedBaseContracts) return contract.linearizedBaseContracts.map(id => declarations.find(row => row.id === id)).filter(Boolean);
    const next = new Set(seen).add(contract.id), parents = (contract.baseContracts || []).map(base => resolveBase(contract, base)).reverse();
    if (parents.some(row => !row)) return undefined;
    const sequences = parents.map(parent => linearize(parent, next)?.slice());
    if (sequences.some(row => !row)) return undefined;
    sequences.push([...parents]);
    const result = [contract];
    while (sequences.some(row => row.length)) {
      const head = sequences.find(row => row.length && !sequences.some(other => other.slice(1).some(item => item.id === row[0].id)))?.[0];
      if (!head) return undefined;
      result.push(head);
      for (const row of sequences) if (row[0]?.id === head.id) row.shift();
    }
    linearizations.set(contract.id, result);
    return result;
  };
  const enclosingContract = declarations.find(row => row.id === enclosing.find(row => row.kind === 'ContractDefinition')?.id);
  if (enclosingContract) for (const base of (linearize(enclosingContract) || []).slice(1)) {
    visible.push(...declarations.filter(row => row.scopeId === base.id && row.visibility !== 'private' && !(row.kind === 'FunctionDefinition' && row.visibility === 'external')));
  }
  for (const imported of (index.imports || []).filter(row => row.file === file)) {
    if (imported.namespace) continue;
    for (const row of declarations.filter(row => row.location.file === imported.source && byId.get(row.scopeId)?.kind === 'SourceUnit')) {
      const alias = imported.symbols.find(alias => alias.name === row.name);
      if (imported.symbols.length && !alias) continue;
      visible.push({ ...row, name: alias?.local || row.name });
    }
  }
  if (!receiver) return visible.filter(row => row.name !== '__ynx_completion');
  const namespace = (index.imports || []).filter(row => row.file === file && row.namespace === receiver);
  if (namespace.length === 1 && !visible.some(row => row.name === receiver)) return topLevel(namespace[0].source);
  const builtin = {
    msg: ['sender', 'value', 'data', 'sig'],
    tx: ['origin', 'gasprice'],
    block: ['number', 'timestamp', 'chainid', 'basefee', 'coinbase', 'gaslimit', 'prevrandao'],
  };
  if (builtin[receiver]) return builtin[receiver].map(name => ({ name, kind: 'VariableDeclaration', type: `Solidity ${receiver} member` }));
  let target, instance = false;
  const typeKinds = ['ContractDefinition', 'StructDefinition', 'EnumDefinition'];
  function qualifiedType(name, contextFile, localTypes) {
    if (typeof name !== 'string') return undefined;
    const parts = name.split('.');
    if (parts.length < 2 || parts.length > 8) return undefined;
    // Namespace paths are resolved from the compiler's import declaration,
    // never from a matching identifier elsewhere in the project.
    if (localTypes.some(row => row.name === parts[0])) return undefined;
    const imports = (index.imports || []).filter(row => row.file === contextFile && row.namespace === parts[0]);
    if (imports.length !== 1) return undefined;
    let candidates = topLevel(imports[0].source).filter(row => row.name === parts[1] && typeKinds.includes(row.kind));
    if (candidates.length !== 1) return undefined;
    let result = candidates[0];
    for (const part of parts.slice(2)) {
      candidates = declarations.filter(row => row.scopeId === result.id && row.name === part && typeKinds.includes(row.kind));
      if (candidates.length !== 1) return undefined;
      result = candidates[0];
    }
    return result;
  }
  if (receiver === 'this') {
    target = declarations.find(row => row.id === enclosing.find(row => row.kind === 'ContractDefinition')?.id); instance = true;
  } else {
    const rank = row => { const index = enclosing.findIndex(scope => scope.id === row.scopeId); return index < 0 ? enclosing.length : index; };
    const candidates = visible.filter(row => row.name === receiver).sort((a, b) => rank(a) - rank(b));
    target = candidates.length && (candidates.length === 1 || rank(candidates[0]) < rank(candidates[1])) ? candidates[0] : undefined;
    if (!target && receiver.includes('.')) target = qualifiedType(receiver, file, visible);
    if (target?.kind === 'VariableDeclaration') {
      instance = true;
      const declaration = target, owningScopes = new Set();
      let scope = byId.get(declaration.scopeId);
      while (scope && !owningScopes.has(scope.id)) { owningScopes.add(scope.id); scope = byId.get(scope.parentId); }
      const contextTypes = declarations.filter(row => row.location.file === declaration.location.file && owningScopes.has(row.scopeId));
      const types = contextTypes.filter(row => typeKinds.includes(row.kind) && row.name === declaration.typeName);
      target = types.length === 1 ? types[0] : qualifiedType(declaration.typeName, declaration.location.file, contextTypes);
      if (!target && declaration.location.file === file) {
        const importedTypes = visible.filter(row => typeKinds.includes(row.kind) && row.name === declaration.typeName);
        if (importedTypes.length === 1) target = importedTypes[0];
      }
    }
  }
  if (!target || !['ContractDefinition', 'StructDefinition', 'EnumDefinition'].includes(target.kind)) return [];
  const members = new Set((target.kind === 'ContractDefinition' ? linearize(target) || [target] : [target]).map(row => row.id));
  return declarations.filter(row => members.has(row.scopeId) && row.name !== '__ynx_completion' &&
    (target.kind !== 'ContractDefinition' || (instance ? ['public', 'external'].includes(row.visibility) : target.contractKind === 'library' && row.visibility !== 'private')));
}
module.exports = { completionSymbols };
