// Business discovery only. Parsing does not authorize, redeem or navigate.
export function discoveryEntry(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Use an original Social personal QR or invitation link.');
  const match = /^https:\/\/social\.ynxweb4\.com\/(people\/(sp_[A-Za-z0-9_-]{32})|invite\/([A-Za-z0-9_-]{32}))$/.exec(value);
  if (!match) throw new Error('Use an original Social personal QR or invitation link. Wallet, Pair and payment codes are not contact requests.');
  return Object.freeze({source: match[2] ? 'qr' : 'invite', value, personId: match[2] ?? null});
}
