let installed = false;

function stableTokenInsert(original, emptyLineTokens) {
  return function (tokens, offset, length) {
    // An empty-line sentinel is only accurate until text is inserted. Retaining
    // it lets a later cross-line delete append a nonempty suffix as an empty
    // line, producing tokens shorter than the document. null is the existing
    // upstream "not tokenized" state: it uses accurate full-line fallback
    // tokens until the normal grammar/background tokenizer fills this cache.
    if (tokens === emptyLineTokens && length > 0) return null;
    return original.call(this, tokens, offset, length);
  };
}

function install() {
  if (installed) return;
  const { ContiguousTokensEditing, EMPTY_LINE_TOKENS } = require('@theia/monaco-editor-core/esm/vs/editor/common/tokens/contiguousTokensEditing');
  ContiguousTokensEditing.insert = stableTokenInsert(ContiguousTokensEditing.insert, EMPTY_LINE_TOKENS);
  installed = true;
}
module.exports = { install, stableTokenInsert };
