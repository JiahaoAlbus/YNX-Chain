import assert from "node:assert/strict";
import test from "node:test";
import { invoiceID, parseInvoice } from "./api";
test("invoice references accept only canonical IDs and links",()=>{assert.equal(invoiceID("ynxpay://invoice/inv_0123456789abcdef0123"),"inv_0123456789abcdef0123");assert.throws(()=>invoiceID("paid-demo"))});
test("committed state requires authoritative evidence",()=>{const base={version:1,id:"inv_0123456789abcdef0123",centralInvoiceId:"central",intentId:"intent",merchantId:"merchant",merchantName:"Merchant",payoutAddress:"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmcn030",amount:5,asset:"YNXT",network:"ynx_6423-1",fee:1,expiresAt:"2026-07-15T10:00:00Z",createdAt:"2026-07-15T09:00:00Z",signature:"a".repeat(128),signatureKeyId:"merchant-v1",signingPublicKey:"b".repeat(64),signatureAlgorithm:"ed25519"};assert.throws(()=>parseInvoice({...base,status:"committed"}),/missing transaction evidence/);assert.throws(()=>parseInvoice({...base,status:"paid"}),/not authoritative/) });
