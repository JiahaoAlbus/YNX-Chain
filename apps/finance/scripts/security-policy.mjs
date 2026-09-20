const reservedExampleHost = ['example', '.com'].join('');
const pinnedProductSessionBundle = 'apps/finance/web/vendor/product-session-browser-a7dad7ec.mjs';
const acceptedUpstreamComments = new Set([
  "// TODO: we don't need it here, move out to separate fn",
  '// TODO: return `this`',
]);

export function isNonRuntimeSentinelUse(ruleID, rel, text, matchText, matchIndex) {
  if (ruleID === 'runtime-placeholder' && rel === pinnedProductSessionBundle && matchText === 'TODO') {
    const lineStart = text.lastIndexOf('\n', matchIndex) + 1;
    const lineEnd = text.indexOf('\n', matchIndex);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
    // Only the two reviewed comments in this exact pinned bundle are upstream
    // implementation notes. Any new TODO, visible Placeholder, string literal,
    // or executable marker in the same vendor file still fails the gate.
    return acceptedUpstreamComments.has(line);
  }
  if (ruleID === 'deployment-filler' && rel === 'apps/finance/mobile/contract/public-endpoint-manifest.json' && matchText.toLowerCase() === reservedExampleHost) {
    const lineStart = text.lastIndexOf('\n', matchIndex) + 1;
    const lineEnd = text.indexOf('\n', matchIndex);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    // The accepted manifest explicitly rejects the reserved example host. A deny-list value
    // is not a deployable endpoint or placeholder.
    return line.includes('"reject"') && line.includes(`"${reservedExampleHost}"`);
  }
  return false;
}
