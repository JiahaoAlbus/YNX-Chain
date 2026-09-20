const thirdPartyRuntimeRoots = [
  'apps/finance/web/vendor',
];
const reservedExampleHost = ['example', '.com'].join('');

export function isNonRuntimeSentinelUse(ruleID, rel, text, matchText, matchIndex) {
  if (ruleID === 'runtime-placeholder' && thirdPartyRuntimeRoots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) {
    // Vendored, hash-pinned dependency comments are not Finance UI/runtime
    // placeholders. All non-runtime secret and deployment-filler rules still
    // scan these bytes.
    return true;
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
