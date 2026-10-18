/** Bare wallet-key/address shapes are ambiguous, not public invoice IDs.
 * Keep explicit original invoice links and ordinary legacy IDs compatible.
 * This is routing/privacy policy, not a key/address validity check: no secret
 * is derived, displayed, logged or sent to a service by this classifier. */
export function ambiguousWalletInvoiceReference(value) {
 return /^ynx1/i.test(value)||/^0x/i.test(value)||/^(?:[a-f0-9]{64}|[a-f0-9]{128})$/i.test(value)
  ||/^(?:xprv|tprv|yprv|zprv|Yprv|Zprv|uprv|vprv|Uprv|Vprv)[1-9A-HJ-NP-Za-km-z]{32,}$/.test(value)
  ||/^[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value)
  ||/^(?:bc1|tb1|bcrt1)[023456789acdefghjklmnpqrstuvwxyz]{14,}$/i.test(value)
  ||/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)
  ||/^[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value);
}
