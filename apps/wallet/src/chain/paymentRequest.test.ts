import assert from "node:assert/strict";
import test from "node:test";
import { ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { walletCopy, type WalletDetailMessage } from "../i18n/i18n";
import { createPaymentURI, parsePaymentRecipient, PaymentRequestError } from "./paymentRequest";

const recipient = ynxAddressFromEVM("0x1234567890123456789012345678901234567890");
const uri = `ynx:${recipient}?chainId=ynx_6423-1&asset=YNXT`;

test("Native and Desktop receiving URI format produces only a canonical public recipient", () => {
  assert.equal(createPaymentURI(recipient), uri);
  const parsed = parsePaymentRecipient(uri);
  assert.deepEqual(parsed, { recipient, chainId: "ynx_6423-1", asset: "YNXT", kind: "payment-uri" });
  assert.equal(Object.isFrozen(parsed), true);
  assert.deepEqual(parsePaymentRecipient(`ynx:${recipient}?asset=YNXT&chainId=ynx_6423-1`), parsed);
  assert.deepEqual(parsePaymentRecipient(recipient), { ...parsed, kind: "address" });
});

test("receiving input rejects unknown, duplicate, encoded and action-bearing parameters", () => {
  const wrongChecksum = recipient.slice(0, -1) + (recipient.endsWith("q") ? "p" : "q");
  const invalid: unknown[] = [
    null, undefined, true, {}, [], 123, "", "x".repeat(257),
    "0x1234567890123456789012345678901234567890", wrongChecksum, recipient.toUpperCase(),
    uri + "&amount=2", uri + "&fee=0", uri + "&callback=https://evil.invalid", uri + "&authorize=true",
    uri + "&chainId=ynx_6423-1", uri + "&asset=YNXT", uri + "&__proto__=x", uri + "&",
    `ynx:${recipient}?chainId=ynx_6423-1&chainId=ynx_6423-1`,
    `ynx:${recipient}?asset=YNXT&asset=YNXT`, `ynx:${recipient}?chainId=ynx_6423-1`,
    `ynx:${recipient}?%63hainId=ynx_6423-1&asset=YNXT`, `ynx:${recipient}?chainId=ynx_6423-1&asset=%59NXT`,
    `ynx:${recipient}?chainId=ynx_6423-1&asset=YNXT=extra`, `ynx:${recipient}?chainId=ynx_6423-1;asset=YNXT`,
    `ynx:${recipient}?chainId=ynx_6423-1&Asset=YNXT`, `ynx:${recipient}?chainId=ynx_6423-1&asset=YNXT+`,
    uri + "#ignored", uri + "?ignored", uri + "\n", " " + uri, uri + "\u200b", uri.replace("ynx:", "YNX:"),
    uri.replace("ynx:", "ynx://"), uri.replace("ynx:", "https://"), uri.replace("ynx:", "javascript:"),
    uri.replace("ynx:", "ynxwallet:"), uri.replace(recipient, "owner@" + recipient),
    uri.replace(recipient, "%79" + recipient.slice(1)), uri.replace(recipient, wrongChecksum),
    uri.replace(recipient, recipient + "/"), uri.replace(recipient, recipient + "\\"),
  ];
  for (const input of invalid) assert.throws(() => parsePaymentRecipient(input), PaymentRequestError);
});

test("different network or asset is rejected, with no fallback to a native address", () => {
  for (const value of [uri.replace("ynx_6423-1", "ynx_1-1"), uri.replace("ynx_6423-1", "0x1917"), uri.replace("YNXT", "ETH"), uri.replace("YNXT", "ynxt")]) {
    assert.throws(() => parsePaymentRecipient(value), (error: unknown) => error instanceof PaymentRequestError && error.code === "UNSUPPORTED_PAYMENT_NETWORK");
  }
});

test("invalid clipboard content never enters an error message or a receiving URI", () => {
  const unrelatedSecretLikeInput = "ab".repeat(32);
  for (const value of [unrelatedSecretLikeInput, `ynx:${unrelatedSecretLikeInput}?chainId=ynx_6423-1&asset=YNXT`]) {
    assert.throws(() => parsePaymentRecipient(value), (error: unknown) => error instanceof PaymentRequestError && !error.message.includes(unrelatedSecretLikeInput));
    assert.throws(() => createPaymentURI(value), PaymentRequestError);
  }
});

test("new receiving input and rejection messages have Chinese and Arabic copy", () => {
  const messages: WalletDetailMessage[] = ["Paste address or receiving link", "Reading clipboard…", "Copy a receiving link from a QR code, then paste it here.", "Recipient added. Enter an amount and review the transfer.", "Use a valid native ynx1 address or YNX Testnet receiving link.", "This receiving link is for a different network or asset.", "Clipboard could not be read. Paste the native address manually.", "Recipient ynx1 address", "Whole YNXT amount", "Review transfer"];
  for (const text of messages) for (const locale of ["zh-Hans", "ar"] as const) assert.notEqual(walletCopy(locale, text), text);
});
