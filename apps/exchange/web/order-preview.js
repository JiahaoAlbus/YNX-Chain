// Advisory arithmetic only: no provider, identity, signing or POST capability.
export const MAX_RULE_AGE_MS = 120_000;
const SCALE = 1_000_000n;
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
const decimalInteger = value => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value);
export function parseMicro(value) {
  // Deliberately reject exponent notation, commas, signs, whitespace and excess
  // precision instead of normalizing an ambiguous monetary input.
  if (typeof value !== 'string' || value.length > 26 || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) fail('DECIMAL_INVALID', 'Enter a plain decimal with at most 6 decimal places; no exponent, sign or separators.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
export function validateTradingRules(rules) {
  if (rules?.schemaVersion !== 'exchange-limit-rules-v2' || rules.market !== 'YNXT-YUSD_TEST' || rules.scale !== '1000000' ||
      !Array.isArray(rules.orderTypes) || rules.orderTypes.length !== 1 || rules.orderTypes[0] !== 'limit' ||
      rules.notionalRounding !== 'floor_micro' || rules.feeRounding !== 'ceil_micro_per_fill' ||
      rules.quoteAssetType !== 'venue_only_test_credit_not_token' || rules.admissionMinimumQuote !== 'one_micro_credit' || rules.reservationShortfall !== 'atomic_order_request_rejection' ||
      !Number.isInteger(rules.makerFeeBps) || !Number.isInteger(rules.takerFeeBps) || rules.makerFeeBps < 0 || rules.takerFeeBps < rules.makerFeeBps || rules.takerFeeBps > 1000)
    fail('RULES_INVALID', 'Verified venue trading rules are unavailable. Reconnect market data.');
  for (const name of ['minPriceMicro', 'maxPriceMicro', 'minAmountMicro', 'maxAmountMicro', 'maxOrderNotionalMicro']) {
    if (!decimalInteger(rules[name]) || BigInt(rules[name]) <= 0n || BigInt(rules[name]) > 9_223_372_036_854_775_807n)
      fail('RULES_INVALID', 'The venue returned unsafe trading limits.');
  }
  if (rules.minPriceMicro !== '1' || rules.minAmountMicro !== '1' || rules.maxPriceMicro !== '1000000000000' || rules.maxAmountMicro !== '1000000000000')
    fail('RULES_INVALID', 'The venue rule version and its input bounds do not agree.');
  return rules;
}
export function feeMicro(notional, basisPoints) {
  if (typeof notional !== 'bigint' || notional < 0n || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 1000) fail('FEE_INVALID', 'Invalid fee input.');
  return (notional * BigInt(basisPoints) + 9999n) / 10000n;
}
export function buildOrderPreview({price, amount, side, rules, source, marketPhase, now = Date.now()}) {
  validateTradingRules(rules);
  const observed = Date.parse(source?.asOf);
  if (!['live', 'polling'].includes(marketPhase) || source?.authority !== 'YNX-owned deterministic order state' || source.classification !== 'testnet' ||
      !['live', 'degraded_single_host'].includes(source.status) || !Number.isFinite(observed) || observed > now + 5000 || now - observed > MAX_RULE_AGE_MS)
    fail('RULES_STALE', 'Reconnect market data to refresh the venue rules before reviewing.');
  if (!['buy', 'sell'].includes(side)) fail('SIDE_INVALID', 'Choose buy or sell.');
  const priceMicro = parseMicro(price), amountMicro = parseMicro(amount);
  if (priceMicro < BigInt(rules.minPriceMicro) || priceMicro > BigInt(rules.maxPriceMicro)) fail('PRICE_LIMIT', 'Price must be between 0.000001 and 1,000,000 YUSD_TEST.');
  if (amountMicro < BigInt(rules.minAmountMicro) || amountMicro > BigInt(rules.maxAmountMicro)) fail('AMOUNT_LIMIT', 'Amount must be between 0.000001 and 1,000,000 YNXT.');
  const notionalMicro = amountMicro * priceMicro / SCALE;
  if (notionalMicro === 0n) fail('ZERO_QUOTE_UNSAFE', 'This order rounds to zero quote credits. The venue requires at least 0.000001 YUSD_TEST of notional.');
  if (notionalMicro > BigInt(rules.maxOrderNotionalMicro)) fail('NOTIONAL_LIMIT', 'Order notional exceeds this venue’s configured maximum.');
  const makerFeeMicro = feeMicro(notionalMicro, rules.makerFeeBps), takerFeeMicro = feeMicro(notionalMicro, rules.takerFeeBps);
  return Object.freeze({market: rules.market, type: 'limit', side, priceMicro, amountMicro, notionalMicro, makerFeeMicro, takerFeeMicro,
    initialReservationMicro: side === 'buy' ? notionalMicro + takerFeeMicro : amountMicro,
    reservationAsset: side === 'buy' ? 'YUSD_TEST' : 'YNXT', rulesObservedAt: source.asOf, sourceStatus: source.status,
    fundsVerified: false, executionAuthorized: false, submitted: false});
}
