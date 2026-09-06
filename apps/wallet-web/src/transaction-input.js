const DECIMALS = 18n;
const UNIT = 10n ** DECIMALS;
const MAX_WEI = (1n << 256n) - 1n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function fail(code, field) { throw Object.assign(new Error(code), {code, field}); }

export function decimalYNXTToWei(input) {
  if (typeof input !== "string") fail("INVALID_AMOUNT", "amount");
  const value = input.trim();
  if (value.length > 100 || !/^\d+(?:\.\d{1,18})?$/.test(value)) fail("INVALID_AMOUNT", "amount");
  const [whole, fraction = ""] = value.split(".");
  const wei = BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, "0"));
  if (wei > MAX_WEI) fail("AMOUNT_TOO_LARGE", "amount");
  return `0x${wei.toString(16)}`;
}

export function weiHexToYNXT(input) {
  if (typeof input !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(input)) fail("INVALID_HEX_VALUE", "value");
  const wei = BigInt(input);
  const fraction = (wei % UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  return `${wei / UNIT}${fraction ? `.${fraction}` : ""}`;
}

export function prepareTransaction({from, to, amount, value, data = "0x", useHex = false}) {
  if (!ADDRESS.test(from || "")) fail("INVALID_ACCOUNT", "recipient");
  const recipient = typeof to === "string" ? to.trim() : "";
  if (!ADDRESS.test(recipient)) fail("INVALID_RECIPIENT", "recipient");
  const wei = useHex ? String(value || "").trim() : decimalYNXTToWei(amount);
  const displayAmount = weiHexToYNXT(wei);
  const callData = typeof data === "string" ? data.trim() : "";
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(callData)) fail("INVALID_CALLDATA", "data");
  return Object.freeze({from, to: recipient, value: wei, data: callData, displayAmount});
}

// A review authorizes only its exact provider/account/chain snapshot.
export function reviewMatchesSession(review, session) {
  return Boolean(review && review.provider === session.provider && review.wallet === session.wallet
    && review.account === session.account && review.chainId === session.chainId
    && review.epoch === session.epoch && session.chainId === "0x1917" && ADDRESS.test(session.account || ""));
}
