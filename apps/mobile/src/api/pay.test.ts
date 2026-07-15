import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPayInvoice, parsePaySettlement, payInvoiceID } from "./pay";

const invoice = { id: "invoice_123", intentId: "intent_123", merchant: "merchant_demo", payoutAddress: "ynx1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zcrwn4", amount: 25, currency: "YNXT", status: "issued", createdAt: "2026-07-15T00:00:00Z", dueAt: "2026-07-16T00:00:00Z" };

test("loads a canonical native YNXT invoice through the mobile app gateway", async () => {
  let observed = "";
  const result = await fetchPayInvoice("ynx://pay/invoice/invoice_123", { baseURL: "http://127.0.0.1:17437", fetchImpl: async (url, init) => {
    observed = `${url}|${(init?.headers as Record<string, string>)["X-YNX-Client"]}`;
    return json(invoice);
  } });
  assert.equal(result.id, "invoice_123");
  assert.equal(result.amount, 25);
  assert.equal(observed, "http://127.0.0.1:17437/app/pay/invoices/invoice_123|ynx-mobile-v1");
  assert.equal(payInvoiceID("https://ynxweb4.com/pay/invoices/invoice_123"), "invoice_123");
});

test("rejects non-native invoices and malformed settlement evidence", async () => {
  await assert.rejects(fetchPayInvoice("invoice_123", { fetchImpl: async () => json({ ...invoice, currency: "USDT" }) }), /not denominated/);
  assert.throws(() => parsePaySettlement({ id: "settlement_1", intentId: "intent_123", invoiceId: "invoice_123", merchant: "merchant_demo", payoutAddress: invoice.payoutAddress, payer: invoice.payoutAddress, amount: 25, currency: "YNXT", status: "paid", transactionHash: `0x${"a".repeat(64)}`, blockNumber: 3, auditHash: "bad", createdAt: invoice.createdAt }), /proof is not canonical/);
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
