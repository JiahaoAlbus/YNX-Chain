#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "../../apps/pay/node_modules/@noble/curves/secp256k1.js";
import { p256 } from "../../apps/pay/node_modules/@noble/curves/nist.js";
import { sha256 } from "../../apps/pay/node_modules/@noble/hashes/sha2.js";
import { keccak_256 } from "../../apps/pay/node_modules/@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "../../apps/pay/node_modules/@noble/hashes/utils.js";
import {
  canonicalJSON,
  createAuthorizationRequest,
  createGatewayCompletion,
  deviceSecret,
  paymentIntent,
  paymentIntentDigest,
  requestDigest,
} from "../../apps/pay/src/walletAuth.ts";
import { createGatewayChallenge, createProductSessionProof, encodeBase64url, httpBodyDigest, parseAuthorizationRequest, registryParserBinding } from "../../packages/wallet-auth/src/index.js";
import { encodeGatewayProofHeader } from "../../packages/wallet-auth/src/gateway-node-host.js";

const productURL = required("YNX_PAY_PRODUCT_URL").replace(/\/$/, "");
const gatewayURL = required("YNX_PAY_GATEWAY_URL").replace(/\/$/, "");
const bootstrapKey = required("YNX_PAY_PRODUCT_BOOTSTRAP_KEY");
const rpcURL = (process.env.YNX_PAY_RPC_URL || "https://rpc.ynxweb4.com").replace(/\/$/, "");
const faucetURL = (process.env.YNX_PAY_FAUCET_URL || "https://faucet.ynxweb4.com").replace(/\/$/, "");
const outputPath = resolve(process.env.YNX_PAY_PROOF_OUTPUT || "internal/payproduct/proof/live-testnet-payment.json");
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + randomBytes(4).toString("hex");
const payerSecret = validSecret();
const merchantSecret = validSecret();
const payer = accountIdentity(payerSecret);
const merchantWallet = accountIdentity(merchantSecret);

const health = await jsonRequest(`${productURL}/health`);
assert(health.ok === true && health.network === "ynx_6423-1" && health.asset === "YNXT" && health.paidEvidence === "authoritative-central-pay-api", "product health authority boundary is invalid");

const faucet = await jsonRequest(`${faucetURL}/request`, { method: "POST", body: { address: payer.evmAddress, amount: 100 } });
assert(/^0x[0-9a-f]{64}$/.test(transactionHash(faucet)), "faucet did not return a canonical transaction hash");
const funded = await eventually(async () => {
  const account = await fetchNativeAccount(payer.account, { rpcURL });
  return account.balance >= 100 ? account : null;
}, "faucet funding did not become authoritative");

const onboard = await jsonRequest(`${productURL}/v1/merchants/onboard`, {
  method: "POST",
  headers: { "X-YNX-Bootstrap-Key": bootstrapKey },
  body: { displayName: `YNX Testnet Merchant ${runID}`, payoutAddress: merchantWallet.account, ownerAccount: merchantWallet.account, webhookUrl: "https://httpbingo.org/post", idempotencyKey: `onboard-${runID}` },
});
const merchantID = onboard.merchant?.id;
assert(/^mrc_[0-9a-f]{20}$/.test(merchantID), "merchant onboarding did not return a bounded merchant identity");

const merchantSession = await completeWalletGateway({ kind: "merchant", identity: merchantWallet, merchantId: merchantID });
assert(merchantSession.account === merchantWallet.account && merchantSession.role === "owner", "merchant Wallet/Gateway owner session binding failed");

const invoice = await merchantRequest("POST", "/v1/merchant/invoices", { description: "Authoritative YNX Testnet proof", amount: 7, expiresInMinutes: 20, idempotencyKey: `invoice-${runID}` });
assert(invoice.status === "pending" && invoice.amount === 7 && invoice.asset === "YNXT" && invoice.payoutAddress === merchantWallet.account, "signed invoice does not match the merchant request");

const device = validP256Secret();
const deviceText = deviceSecret(device);
const authRequest = createAuthorizationRequest(deviceText, randomBytes(24));
const approvalUnsigned = {
  version: authRequest.version,
  requestDigest: requestDigest(authRequest),
  nonce: authRequest.nonce,
  chainId: authRequest.chainId,
  requestingProduct: authRequest.requestingProduct,
  productClientId: authRequest.productClientId,
  bundleId: authRequest.bundleId,
  productDeviceAlgorithm: authRequest.productDeviceAlgorithm,
  productDeviceKey: authRequest.productDeviceKey,
  callback: authRequest.callback,
  account: payer.account,
  accountPublicKey: payer.accountPublicKey,
  grantedScopes: [...authRequest.scopes],
  purpose: authRequest.purpose,
  issuedAt: authRequest.issuedAt,
  expiresAt: authRequest.expiresAt,
};
const approval = {
  ...approvalUnsigned,
  walletSignature: compactWalletSignature("YNX_WALLET_AUTH_APPROVAL_V1", approvalUnsigned, payerSecret),
};
const challengeNow = new Date();
const challenge = createGatewayChallenge(approval, { challenge: randomBytes(24).toString("base64url"), expiresAt: new Date(Math.min(Date.parse(approval.expiresAt), challengeNow.getTime() + 60_000)).toISOString() }, challengeNow);
const completion = createGatewayCompletion(challenge, deviceText);
const payCompletionBody = { authorizationRequest: authRequest, walletApproval: approval, gatewayCompletion: completion };
const walletEnvelope = await jsonRequest(`${gatewayURL}/v1/wallet/sessions/complete`, { method: "POST", body: payCompletionBody });
const walletSession = walletEnvelope.result;
const walletReplay = await fetch(`${gatewayURL}/v1/wallet/sessions/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: canonicalJSON(payCompletionBody) });
await walletReplay.text();
const walletSessionReplayRejected = !walletReplay.ok;
assert(walletEnvelope.ok === true && walletSession.account === payer.account && walletSession.scopes?.join("\n") === "account:read\npay:case:create\npay:route:select\npay:settlement:submit\npay:sponsorship:request", "Wallet/Gateway session binding failed");

const quoteIssuedAt = new Date().toISOString();
const quoteExpiresAt = new Date(Math.min(Date.parse(invoice.expiresAt), Date.now() + 4 * 60_000)).toISOString();
const intent = paymentIntent({
  requestId: randomBytes(24).toString("base64url"),
  sessionBinding: walletSession.sessionBinding,
  invoiceId: invoice.id,
  centralInvoiceId: invoice.centralInvoiceId,
  merchantId: invoice.merchantId,
  merchantName: invoice.merchantName,
  payoutAddress: invoice.payoutAddress,
  amount: invoice.amount,
  asset: invoice.asset,
  fee: invoice.fee,
  total: invoice.amount + invoice.fee,
  quoteIssuedAt,
  quoteExpiresAt,
  invoiceSignature: invoice.signature,
});

const accountBefore = await fetchNativeAccount(payer.account, { rpcURL });
const signedTransfer = signNativeTransfer({ secret: payerSecret, identity: payer, to: invoice.payoutAddress, amount: invoice.amount, nonce: accountBefore.nonce + 1, balance: accountBefore.balance });
const submitted = await broadcastNativeTransfer(signedTransfer, { rpcURL });
assert(submitted.transaction.hash === signedTransfer.hash, "broadcast response substituted the Wallet transaction");
const finality = await trackNativeTransferFinality(signedTransfer.hash, { rpcURL, attempts: 30, intervalMs: 1000 });
assert(finality.status === "confirmed" && finality.transaction.blockNumber > 0, "YNX transaction was not committed in a block");

const resultUnsigned = {
  version: "1",
  intentDigest: paymentIntentDigest(intent),
  requestId: intent.requestId,
  invoiceId: intent.invoiceId,
  chainId: intent.chainId,
  account: payer.account,
  accountPublicKey: payer.accountPublicKey,
  transactionHash: signedTransfer.hash,
  issuedAt: new Date().toISOString(),
};
const walletResult = { ...resultUnsigned, walletSignature: compactWalletSignature("YNX_PAY_WALLET_RESULT_V1", resultUnsigned, payerSecret) };
const committed = await payProductRequest("pay:settlement:submit", `/v1/invoices/${invoice.id}/settlements`, { intent, result: walletResult, idempotencyKey: `settlement-${runID}` });
assertCommitted(committed, signedTransfer.hash);
const receipt = await jsonRequest(`${gatewayURL}/app/pay-product/v1/invoices/${invoice.id}`);
assertCommitted(receipt, signedTransfer.hash);

const refund = await payProductRequest("pay:case:create", `/v1/invoices/${invoice.id}/refund-requests`, { amount: 2, reason: "Live Testnet refund workflow proof", idempotencyKey: `refund-${runID}` });
const dispute = await payProductRequest("pay:case:create", `/v1/invoices/${invoice.id}/disputes`, { reason: "Live Testnet dispute and Trust review workflow proof", trustEvidence: [`tx:${signedTransfer.hash}`], idempotencyKey: `dispute-${runID}` });
assert(refund.status === "requested" && dispute.status === "open", "refund/dispute states are not human-review boundaries");

const merchantAccount = await eventually(async () => {
  const account = await fetchNativeAccount(merchantWallet.account, { rpcURL });
  return account.balance >= refund.amount + 1 ? account : null;
}, "merchant payout did not become available for the Wallet-authorized refund");
const signedRefundTransfer = signNativeTransfer({ secret: merchantSecret, identity: merchantWallet, to: payer.account, amount: refund.amount, nonce: merchantAccount.nonce + 1, balance: merchantAccount.balance });
const refundBroadcast = await broadcastNativeTransfer(signedRefundTransfer, { rpcURL });
assert(refundBroadcast.transaction.hash === signedRefundTransfer.hash, "refund broadcast substituted the merchant Wallet transaction");
const refundFinality = await trackNativeTransferFinality(signedRefundTransfer.hash, { rpcURL, attempts: 30, intervalMs: 1000 });
assert(refundFinality.status === "confirmed" && refundFinality.transaction.blockNumber > 0, "refund transaction was not committed in a block");
const refundAuthorizationUnsigned = {
  version: "1",
  requestId: randomBytes(24).toString("base64url"),
  invoiceId: invoice.id,
  chainId: "ynx_6423-1",
  merchantId: merchantID,
  account: merchantWallet.account,
  accountPublicKey: merchantWallet.accountPublicKey,
  payer: payer.account,
  amount: refund.amount,
  asset: invoice.asset,
  transactionHash: signedRefundTransfer.hash,
  issuedAt: new Date().toISOString(),
};
const refundAuthorization = { ...refundAuthorizationUnsigned, walletSignature: compactWalletSignature("YNX_PAY_REFUND_AUTHORIZATION_V1", refundAuthorizationUnsigned, merchantSecret) };
const submittedRefund = await merchantRequest("POST", `/v1/merchant/refunds/${refund.id}/submit`, { authorization: refundAuthorization, idempotencyKey: `refund-submit-${runID}` });
assert(submittedRefund.status === "submitted" && submittedRefund.refundTransactionHash === signedRefundTransfer.hash, "merchant refund authorization was not bound to the reverse transaction");
const committedRefund = await eventually(async () => {
  const current = await merchantRequest("POST", `/v1/merchant/refunds/${refund.id}/refresh`, {});
  return current.status === "refunded" ? current : null;
}, "authoritative refund evidence did not commit", 30, 1000);
assert(committedRefund.evidence?.transactionHash === signedRefundTransfer.hash && committedRefund.evidence?.blockNumber === refundFinality.transaction.blockNumber && committedRefund.evidence?.finality === "committed", "authoritative refund evidence is incomplete or mismatched");

const secondPayerSecret = validSecret();
const secondPayer = accountIdentity(secondPayerSecret);
const secondFaucet = await jsonRequest(`${faucetURL}/request`, { method: "POST", body: { address: secondPayer.evmAddress, amount: 100 } });
assert(/^0x[0-9a-f]{64}$/.test(transactionHash(secondFaucet)), "second split payer faucet request did not return a transaction hash");
await eventually(async () => (await fetchNativeAccount(secondPayer.account, { rpcURL })).balance >= 100, "second split payer funding did not become authoritative");
const firstSplitPayBundle = await completePayWalletGateway(payer);
const split = await merchantRequest("POST", "/v1/merchant/split-payments", { description: "Two-account authoritative YNX Testnet split", shares: [{ label: "Primary payer", amount: 3 }, { label: "Second payer", amount: 4 }], expiresInMinutes: 20, idempotencyKey: `split-${runID}` });
assert(split.status === "open" && split.totalAmount === 7 && split.shares?.length === 2, "merchant split plan is invalid");
const firstClaim = await payProductRequest("pay:settlement:submit", `/v1/split-payments/${split.id}/shares/${split.shares[0].id}/claim`, { idempotencyKey: `split-first-${runID}` }, firstSplitPayBundle);
const firstShare = firstClaim.shares.find((share) => share.id === split.shares[0].id);
assert(firstShare?.invoiceId && firstShare.status === "pending" && !firstShare.payerAccount, "first split share did not create a payer-private child invoice");
const firstChildInvoice = await jsonRequest(`${gatewayURL}/app/pay-product/v1/invoices/${firstShare.invoiceId}`);
const firstSplitSettlement = await settleClaimedInvoice(firstChildInvoice, payer, firstSplitPayBundle, `split-first-${runID}`);

const secondPayBundle = await completePayWalletGateway(secondPayer);
const secondClaim = await payProductRequest("pay:settlement:submit", `/v1/split-payments/${split.id}/shares/${split.shares[1].id}/claim`, { idempotencyKey: `split-second-${runID}` }, secondPayBundle);
const secondShare = secondClaim.shares.find((share) => share.id === split.shares[1].id);
assert(secondShare?.invoiceId && secondShare.status === "pending" && !secondShare.payerAccount, "second split share did not create a payer-private child invoice");
const secondChildInvoice = await jsonRequest(`${gatewayURL}/app/pay-product/v1/invoices/${secondShare.invoiceId}`);
const secondSplitSettlement = await settleClaimedInvoice(secondChildInvoice, secondPayer, secondPayBundle, `split-second-${runID}`);
const committedSplit = await jsonRequest(`${gatewayURL}/app/pay-product/v1/split-payments/${split.id}`);
assert(committedSplit.status === "committed" && committedSplit.shares.every((share) => share.status === "committed" && !share.payerAccount), "two-account split did not reach a public payer-redacted committed state");

let state = await merchantRequest("GET", "/v1/merchant/state");
const queuedDelivery = Object.values(state.deliveries || {})[0];
assert(queuedDelivery?.id && queuedDelivery.payloadHash?.length === 64 && queuedDelivery.signature?.length === 64, "webhook delivery lacks signed replay-safe evidence");
const delivery = await eventually(async () => {
  const snapshot = await merchantRequest("GET", "/v1/merchant/state");
  const current = snapshot.deliveries?.[queuedDelivery.id];
  return current?.attempt >= 1 ? current : null;
}, "webhook delivery did not execute an authoritative attempt", 60, 500);
const retried = delivery.status === "dead_letter"
  ? await merchantRequest("POST", `/v1/merchant/webhooks/${delivery.id}/retry`, { reason: "Operator acceptance retry after authoritative Testnet settlement", idempotencyKey: `webhook-retry-${runID}` })
  : delivery;
assert(retried.attempt >= 1 && ["delivered", "retrying"].includes(retried.status), "webhook delivery did not persist an authoritative attempt");

const aiRun = await merchantRequest("POST", "/v1/merchant/ai/runs", { workflow: "anomaly_review", contextIds: [invoice.id, dispute.id, delivery.id], permission: "allow-once", outputLanguage: "ar" });
const reviewable = await eventually(async () => {
  const snapshot = await merchantRequest("GET", "/v1/merchant/state");
  const run = snapshot.aiRuns?.[aiRun.id];
  return run && run.status !== "running" ? run : null;
}, "AI risk explanation did not finish", 70, 1000);
let reviewed = reviewable;
let aiExternalBlocker = "";
if (reviewable.status === "review") {
  assert(typeof reviewable.result === "string" && reviewable.result.length > 0, "AI review result is empty");
  reviewed = await merchantRequest("POST", `/v1/merchant/ai/runs/${aiRun.id}/review`, { decision: "applied" });
  assert(reviewed.status === "applied" && reviewed.decision === "applied", "AI explanation approval was not audited");
} else {
  assert(["provider_failed", "provider_unavailable"].includes(reviewable.status), `AI run failed with an invalid state (${reviewable.status})`);
  aiExternalBlocker = "YNX AI Gateway did not return provider-backed output; no explanation or approval was fabricated";
}

const analytics = await merchantRequest("GET", "/v1/merchant/analytics");
const csv = await merchantRequest("GET", "/v1/merchant/reconciliation.csv", undefined, true);
state = await merchantRequest("GET", "/v1/merchant/state");
assert(analytics.committedCount === 3 && analytics.grossYnxt === invoice.amount + split.totalAmount, "merchant analytics are not derived from the committed invoice and both split shares");
assert(analytics.refundedYnxt === refund.amount && analytics.netYnxt === invoice.amount + split.totalAmount - refund.amount, "merchant analytics did not reconcile payment, Split and authoritative refund");
assert(csv.includes(invoice.id) && csv.includes(signedTransfer.hash) && csv.includes(firstSplitSettlement.signedTransfer.hash) && csv.includes(secondSplitSettlement.signedTransfer.hash), "reconciliation export omitted authoritative payment or Split transaction evidence");
if (reviewed.status === "applied") assert(state.audit?.some((entry) => entry.action === "ai.review" && entry.outcome === "applied"), "AI approval audit entry is missing");
assert(state.audit?.some((entry) => entry.action === "webhook.deliver"), "webhook delivery audit entry is missing");
assert(state.audit?.some((entry) => entry.action === "refund.committed" && entry.objectId === refund.id), "authoritative refund audit entry is missing");

assert(merchantSession.replayRejected === true && walletSessionReplayRejected === true && firstSplitPayBundle.replayRejected === true && secondPayBundle.replayRejected === true, "Gateway challenge/session replay was not rejected");

const proof = {
  proofType: "ynx-pay-authoritative-testnet-payment",
  generatedAt: new Date().toISOString(),
  network: "ynx_6423-1",
  evmChainId: 6423,
  asset: "YNXT",
  productURL,
  rpcURL,
  publicRPCURL: "https://rpc.ynxweb4.com",
  transport: rpcURL.startsWith("http://127.0.0.1:") ? "operator SSH tunnel to the public-testnet backend" : "direct",
  merchant: { id: merchantID, payoutAddress: invoice.payoutAddress },
  payer: payer.account,
  invoice: { id: invoice.id, centralInvoiceId: invoice.centralInvoiceId, intentId: invoice.intentId, amount: invoice.amount, fee: invoice.fee, status: receipt.status },
  settlement: receipt.settlement,
  refund: { id: committedRefund.id, amount: committedRefund.amount, status: committedRefund.status, transactionHash: signedRefundTransfer.hash, blockNumber: refundFinality.transaction.blockNumber, centralRefundId: committedRefund.centralRefundId, receiptId: committedRefund.evidence.receiptId, auditHash: committedRefund.evidence.auditHash, source: committedRefund.evidence.source, confidence: committedRefund.evidence.confidence },
  split: { id: committedSplit.id, totalAmount: committedSplit.totalAmount, status: committedSplit.status, shares: [{ id: committedSplit.shares[0].id, amount: committedSplit.shares[0].amount, invoiceId: committedSplit.shares[0].invoiceId, transactionHash: firstSplitSettlement.signedTransfer.hash, blockNumber: firstSplitSettlement.finality.transaction.blockNumber, payer: payer.account }, { id: committedSplit.shares[1].id, amount: committedSplit.shares[1].amount, invoiceId: committedSplit.shares[1].invoiceId, transactionHash: secondSplitSettlement.signedTransfer.hash, blockNumber: secondSplitSettlement.finality.transaction.blockNumber, payer: secondPayer.account }], publicPayerAccountsRedacted: true },
  dispute: { id: dispute.id, status: dispute.status, trustEvidence: dispute.trustEvidence },
  webhook: { id: retried.id, attempt: retried.attempt, status: retried.status, payloadHash: retried.payloadHash, secretVersion: retried.secretVersion },
  ai: { id: reviewed.id, workflow: reviewed.workflow, outputLanguage: reviewed.outputLanguage, status: reviewed.status, decision: reviewed.decision, provider: reviewed.provider, model: reviewed.model, externalBlocker: aiExternalBlocker || undefined },
  reconciliation: { committedCount: analytics.committedCount, grossYnxt: analytics.grossYnxt, refundedYnxt: analytics.refundedYnxt, netYnxt: analytics.netYnxt, csvIncludesInvoice: true, csvIncludesTransaction: true },
  auditCount: state.audit.length,
  replayRejected: merchantSession.replayRejected && walletSessionReplayRejected && firstSplitPayBundle.replayRejected && secondPayBundle.replayRejected,
  truthfulBoundary: "paid only after authoritative central Pay API matched a committed YNX Testnet YNXT transaction",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(proof, null, 2) + "\n", { mode: 0o644 });
console.log(JSON.stringify(proof, null, 2));

async function merchantRequest(method, path, body, raw = false) {
  const response = await fetch(gatewayURL + "/app/pay-merchant" + path, { method, headers: { Authorization: `Bearer ${merchantSession.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`merchant request ${path} failed (${response.status}): ${text}`);
  return raw ? text : JSON.parse(text);
}

async function payProductRequest(scope, path, body, bundle = { walletSession, deviceText }) {
  const activeSession = bundle.walletSession;
  const activeDevice = bundle.deviceText;
  const productBody = canonicalJSON(body);
  const introspectionBody = canonicalJSON({ requiredScopes: [scope] });
  const issuedAt = new Date();
  const proof = encodeGatewayProofHeader(createProductSessionProof(activeSession, {
    method: "POST",
    path: "/v1/wallet/sessions/introspect",
    bodyDigest: httpBodyDigest(introspectionBody),
    nonce: randomBytes(24).toString("base64url"),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(Math.min(Date.parse(activeSession.expiresAt), issuedAt.getTime() + 60_000)).toISOString(),
  }, activeDevice));
  const response = await fetch(gatewayURL + "/app/pay-product" + path, { method: "POST", headers: { "Content-Type": "application/json", "X-YNX-Product-Session-Proof": proof }, body: productBody, signal: AbortSignal.timeout(65_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pay Product request ${path} failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

async function completePayWalletGateway(identity) {
  const secret = validP256Secret();
  const secretText = deviceSecret(secret);
  const auth = createAuthorizationRequest(secretText, randomBytes(24));
  const unsigned = { version: auth.version, requestDigest: requestDigest(auth), nonce: auth.nonce, chainId: auth.chainId, requestingProduct: auth.requestingProduct, productClientId: auth.productClientId, bundleId: auth.bundleId, productDeviceAlgorithm: auth.productDeviceAlgorithm, productDeviceKey: auth.productDeviceKey, callback: auth.callback, account: identity.account, accountPublicKey: identity.accountPublicKey, grantedScopes: [...auth.scopes], purpose: auth.purpose, issuedAt: auth.issuedAt, expiresAt: auth.expiresAt };
  const approval = { ...unsigned, walletSignature: compactWalletSignature("YNX_WALLET_AUTH_APPROVAL_V1", unsigned, identity.secret) };
  const now = new Date();
  const challenge = createGatewayChallenge(approval, { challenge: randomBytes(24).toString("base64url"), expiresAt: new Date(Math.min(Date.parse(approval.expiresAt), now.getTime() + 60_000)).toISOString() }, now);
  const body = { authorizationRequest: auth, walletApproval: approval, gatewayCompletion: createGatewayCompletion(challenge, secretText) };
  const envelope = await jsonRequest(`${gatewayURL}/v1/wallet/sessions/complete`, { method: "POST", body });
  assert(envelope.ok === true && envelope.result?.account === identity.account, "second payer Wallet/Gateway session binding failed");
  const replay = await fetch(`${gatewayURL}/v1/wallet/sessions/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: canonicalJSON(body) });
  await replay.text();
  assert(!replay.ok, "Gateway accepted a replayed second-payer completion");
  return { walletSession: envelope.result, deviceText: secretText, replayRejected: true };
}

async function settleClaimedInvoice(childInvoice, identity, bundle, idempotencyPrefix) {
  assert(childInvoice.version === 4 && childInvoice.expectedPayerHash?.length === 64, "split child invoice lacks expected-payer binding");
  const quoteIssuedAt = new Date().toISOString();
  const quoteExpiresAt = new Date(Math.min(Date.parse(childInvoice.expiresAt), Date.now() + 4 * 60_000)).toISOString();
  const childIntent = paymentIntent({ requestId: randomBytes(24).toString("base64url"), sessionBinding: bundle.walletSession.sessionBinding, invoiceId: childInvoice.id, centralInvoiceId: childInvoice.centralInvoiceId, merchantId: childInvoice.merchantId, merchantName: childInvoice.merchantName, payoutAddress: childInvoice.payoutAddress, amount: childInvoice.amount, asset: childInvoice.asset, fee: childInvoice.fee, total: childInvoice.amount + childInvoice.fee, quoteIssuedAt, quoteExpiresAt, invoiceSignature: childInvoice.signature });
  const account = await fetchNativeAccount(identity.account, { rpcURL });
  const signedTransfer = signNativeTransfer({ secret: identity.secret, identity, to: childInvoice.payoutAddress, amount: childInvoice.amount, nonce: account.nonce + 1, balance: account.balance });
  const broadcast = await broadcastNativeTransfer(signedTransfer, { rpcURL });
  assert(broadcast.transaction.hash === signedTransfer.hash, "split broadcast substituted the Wallet transaction");
  const finality = await trackNativeTransferFinality(signedTransfer.hash, { rpcURL, attempts: 30, intervalMs: 1000 });
  assert(finality.status === "confirmed" && finality.transaction.blockNumber > 0, "split share transaction was not committed");
  const resultUnsigned = { version: "1", intentDigest: paymentIntentDigest(childIntent), requestId: childIntent.requestId, invoiceId: childIntent.invoiceId, chainId: childIntent.chainId, account: identity.account, accountPublicKey: identity.accountPublicKey, transactionHash: signedTransfer.hash, issuedAt: new Date().toISOString() };
  const result = { ...resultUnsigned, walletSignature: compactWalletSignature("YNX_PAY_WALLET_RESULT_V1", resultUnsigned, identity.secret) };
  const committed = await payProductRequest("pay:settlement:submit", `/v1/invoices/${childInvoice.id}/settlements`, { intent: childIntent, result, idempotencyKey: `${idempotencyPrefix}-settlement` }, bundle);
  assertCommitted(committed, signedTransfer.hash);
  return { committed, signedTransfer, finality };
}

async function completeWalletGateway({ kind, identity, merchantId }) {
  const secret = validP256Secret();
  const now = new Date();
  const merchant = kind === "merchant";
  const registry = merchant
    ? { schemaVersion: 2, productClientId: "ynx-merchant-console-v1", requestingProduct: "pay-merchant", bundleId: "com.ynxweb4.merchant-console", callbacks: ["https://pay.ynxweb4.com/merchant/wallet-auth/callback"], scopes: ["account:read", "merchant:session:create"], maxScopes: 2, productDeviceAlgorithms: ["p256-sha256"] }
    : null;
  assert(registry, "operator helper supports merchant sessions only");
  const request = parseAuthorizationRequest({ version: "1", nonce: randomBytes(24).toString("base64url"), chainId: "ynx_6423-1", requestingProduct: registry.requestingProduct, productClientId: registry.productClientId, bundleId: registry.bundleId, productDeviceAlgorithm: "p256-sha256", productDeviceKey: encodeBase64url(p256.getPublicKey(secret, true)), callback: registry.callbacks[0], scopes: registry.scopes, purpose: "Operate this YNX Testnet merchant through the canonical Wallet", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() }, { now, registry: registryParserBinding(registry) });
  const unsigned = { version: request.version, requestDigest: requestDigest(request), nonce: request.nonce, chainId: request.chainId, requestingProduct: request.requestingProduct, productClientId: request.productClientId, bundleId: request.bundleId, productDeviceAlgorithm: request.productDeviceAlgorithm, productDeviceKey: request.productDeviceKey, callback: request.callback, account: identity.account, accountPublicKey: identity.accountPublicKey, grantedScopes: [...request.scopes], purpose: request.purpose, issuedAt: request.issuedAt, expiresAt: request.expiresAt };
  const approval = { ...unsigned, walletSignature: compactWalletSignature("YNX_WALLET_AUTH_APPROVAL_V1", unsigned, identity.secret) };
  const challengeNow = new Date();
  const challenge = createGatewayChallenge(approval, { challenge: randomBytes(24).toString("base64url"), expiresAt: new Date(Math.min(Date.parse(approval.expiresAt), challengeNow.getTime() + 60_000)).toISOString() }, challengeNow);
  const completion = createGatewayCompletion(challenge, deviceSecret(secret));
  const body = { authorizationRequest: request, walletApproval: approval, gatewayCompletion: completion };
  const completed = await jsonRequest(gatewayURL + "/v1/wallet/sessions/complete", { method: "POST", body });
  const productSession = completed.result;
  assert(completed.ok === true && productSession?.account === identity.account, "canonical Merchant Product Session completion failed");
  const introspectionBody = canonicalJSON({ requiredScopes: ["merchant:session:create"] });
  const issuedAt = new Date();
  const proof = encodeGatewayProofHeader(createProductSessionProof(productSession, { method: "POST", path: "/v1/wallet/sessions/introspect", bodyDigest: httpBodyDigest(introspectionBody), nonce: randomBytes(24).toString("base64url"), issuedAt: issuedAt.toISOString(), expiresAt: new Date(Math.min(Date.parse(productSession.expiresAt), issuedAt.getTime() + 60_000)).toISOString() }, deviceSecret(secret)));
  const merchantBody = canonicalJSON({ merchantId });
  const merchantResponse = await fetch(gatewayURL + "/app/pay-merchant/v1/merchant/sessions", { method: "POST", headers: { "Content-Type": "application/json", "X-YNX-Product-Session-Proof": proof }, body: merchantBody, signal: AbortSignal.timeout(65_000) });
  const merchantText = await merchantResponse.text();
  if (!merchantResponse.ok) throw new Error(`Merchant session exchange failed (${merchantResponse.status}): ${merchantText}`);
  const session = JSON.parse(merchantText);
  const replay = await fetch(gatewayURL + "/v1/wallet/sessions/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: canonicalJSON(body) });
  await replay.text();
  assert(!replay.ok, "Gateway accepted a consumed merchant completion");
  return { ...session, replayRejected: true };
}

async function jsonRequest(url, options = {}) {
  const body = options.body === undefined ? undefined : (typeof options.body === "string" ? options.body : canonicalJSON(options.body));
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { Accept: "application/json", ...(options.headers || {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body,
    signal: AbortSignal.timeout(65_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

async function eventually(check, message, attempts = 40, delay = 500) {
  let last;
  for (let index = 0; index < attempts; index += 1) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
  }
  throw new Error(`${message}${last instanceof Error ? `: ${last.message}` : ""}`);
}

function compactWalletSignature(domain, value, secret) {
  return bytesToHex(secp256k1.sign(sha256(utf8ToBytes(`${domain}\n${canonicalJSON(value)}`)), secret, { prehash: false, format: "compact", lowS: true }));
}

function validSecret() {
  for (;;) {
    const value = randomBytes(32);
    if (secp256k1.utils.isValidSecretKey(value)) return value;
  }
}
function validP256Secret() {
  for (;;) {
    const value = randomBytes(32);
    if (p256.utils.isValidSecretKey(value)) return value;
  }
}

function assertCommitted(value, hash) {
  assert(value.status === "committed" && value.settlement?.status === "committed", "invoice was not committed");
  assert(value.settlement.transactionHash === hash && value.settlement.blockNumber > 0 && value.settlement.auditHash?.length === 64 && value.settlement.source === "authoritative-central-pay-api", "receipt lacks matching authoritative evidence");
}

function transactionHash(value) {
  return value?.hash || value?.transactionHash || value?.transaction?.hash || "";
}

function accountIdentity(secret) {
  const publicKey = secp256k1.getPublicKey(secret, true);
  const payload = keccak_256(secp256k1.getPublicKey(secret, false).slice(1)).slice(-20);
  return Object.freeze({ account: encodeYNXAddress(payload), accountPublicKey: bytesToHex(publicKey), evmAddress: `0x${bytesToHex(payload)}`, secret });
}

function signNativeTransfer({ secret, identity, to, amount, nonce, balance }) {
  assert(Number.isSafeInteger(amount) && amount > 0 && amount + 1 <= balance, "Wallet balance cannot cover amount and fee");
  assert(Number.isSafeInteger(nonce) && nonce > 0, "Wallet nonce is invalid");
  const recipient = decodeYNXAddress(to);
  assert(recipient !== identity.evmAddress, "merchant payout must differ from payer");
  const document = { domain: "YNX_NATIVE_TX_V1", version: 1, chainId: 6423, type: "transfer", from: identity.evmAddress, to: recipient, amount, fee: 1, nonce, publicKey: identity.accountPublicKey };
  const signature = bytesToHex(secp256k1.sign(sha256(utf8ToBytes(JSON.stringify(document))), secret, { format: "der", lowS: true, prehash: false }));
  const transaction = { version: 1, chainId: 6423, type: "transfer", from: identity.evmAddress, to: recipient, amount, fee: 1, nonce, publicKey: identity.accountPublicKey, signature };
  const payload = JSON.stringify(transaction);
  return Object.freeze({ payload, hash: `0x${bytesToHex(sha256(utf8ToBytes(payload)))}`, transaction });
}

async function fetchNativeAccount(address, { rpcURL: base }) {
  const value = await jsonRequest(`${base}/accounts/${encodeURIComponent(address)}`);
  const account = value.account || value;
  return { balance: account.balance, nonce: account.nonce };
}

async function broadcastNativeTransfer(signed, { rpcURL: base }) {
  const response = await fetch(`${base}/transactions/broadcast`, { method: "POST", headers: { "Content-Type": "application/json" }, body: signed.payload, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`broadcast failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

async function trackNativeTransferFinality(hash, { rpcURL: base, attempts, intervalMs }) {
  let transaction;
  for (let index = 0; index < attempts; index += 1) {
    const response = await fetch(`${base}/txs/${hash}`, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      transaction = await response.json();
      if (transaction.blockNumber > 0) return { status: "confirmed", transaction };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  return { status: "submitted", transaction };
}

function encodeYNXAddress(payload) {
  const data = convertBits([...payload], 8, 5, true);
  const values = [...hrpExpand("ynx"), ...data, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(values) ^ 1;
  const tail = Array.from({ length: 6 }, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return `ynx1${[...data, ...tail].map((value) => BECH32[value]).join("")}`;
}
function decodeYNXAddress(address) {
  const data = [...address.slice(address.lastIndexOf("1") + 1)].map((value) => BECH32.indexOf(value));
  assert(address.startsWith("ynx1") && polymod([...hrpExpand("ynx"), ...data]) === 1, "merchant payout address checksum is invalid");
  return `0x${bytesToHex(Uint8Array.from(convertBits(data.slice(0, -6), 5, 8, false)))}`;
}
function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0, bits = 0;
  const result = [], maximum = (1 << toBits) - 1, mask = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    accumulator = ((accumulator << fromBits) | value) & mask;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; result.push((accumulator >> bits) & maximum); }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maximum);
  assert(pad || (bits < fromBits && ((accumulator << (toBits - bits)) & maximum) === 0), "address padding is invalid");
  return result;
}
function hrpExpand(hrp) { return [...hrp].map((value) => value.charCodeAt(0) >> 5).concat([0], [...hrp].map((value) => value.charCodeAt(0) & 31)); }
function polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    generators.forEach((generator, index) => { if ((top >>> index) & 1) checksum = (checksum ^ generator) >>> 0; });
  }
  return checksum >>> 0;
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
