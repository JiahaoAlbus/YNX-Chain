const pinnedProductSessionBundle = 'apps/finance/web/vendor/product-session-browser-a7dad7ec.mjs';
const acceptedUpstreamComments = new Set([
  "// TODO: we don't need it here, move out to separate fn",
  '// TODO: return `this`',
]);

// Developer markers are case-sensitive: Spanish "todo" is ordinary product
// copy, while uppercase TODO/FIXME still block a release. Visible filler is
// intentionally case-insensitive.
export const runtimePlaceholderPatterns = Object.freeze([
  /\b(?:TODO|FIXME)\b/g,
  /\bComing soon\b|>\s*Placeholder\s*</gi,
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
  return false;
}
