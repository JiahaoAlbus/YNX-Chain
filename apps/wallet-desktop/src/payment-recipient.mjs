import { evmAddressFromYNX, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { getAddress } from "ethers";
import { decodeLocalQRText } from "./walletconnect-qr-decoder.mjs";

const invalid = () => { throw Object.assign(new Error("Use a valid YNX Testnet address or a YNXT receiving link for network 6423."), { code: "INVALID_PAYMENT_RECIPIENT" }); };

/** Public recipient data only. Payment input never carries an amount or approval. */
export function parsePaymentRecipient(input, { requireURI = false } = {}) {
  if (typeof input !== "string" || input.length > 512) invalid();
  const value = input.trim();
  let address = value, kind = "address";
  if (value.startsWith("ynx:")) {
    const match = /^ynx:(ynx1[023456789acdefghjklmnpqrstuvwxyz]+)\?(?:chainId=ynx_6423-1&asset=YNXT|asset=YNXT&chainId=ynx_6423-1)$/u.exec(value);
    if (!match) invalid();
    address = match[1]; kind = "receiving-link";
  } else if (requireURI) invalid();
  let account;
  try {
    if (/^ynx1[023456789acdefghjklmnpqrstuvwxyz]+$/u.test(address)) {
      account = evmAddressFromYNX(address);
      if (ynxAddressFromEVM(account) !== address) invalid();
    } else if (/^0x[0-9a-fA-F]{40}$/u.test(address)) {
      account = getAddress(address).toLowerCase();
    } else invalid();
  } catch { invalid(); }
  const ynxAccount = ynxAddressFromEVM(account);
  return Object.freeze({ account, ynxAccount, kind, chainId: "ynx_6423-1", asset: "YNXT" });
}

export function decodePaymentRecipientQR(input) {
  return parsePaymentRecipient(decodeLocalQRText(input), { requireURI: true });
}
