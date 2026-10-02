import assert from "node:assert/strict";
import test from "node:test";
import { reviewWalletConnectQrPayload } from "./qr";

const uri=`wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`;
test("camera QR uses the strict WalletConnect parser",()=>assert.equal(reviewWalletConnectQrPayload(uri,"ready",new Date("2026-09-20T00:00:00Z")),uri));
test("camera denial and absence fail closed before inspecting scanned content",()=>{
  assert.throws(()=>reviewWalletConnectQrPayload(uri,"denied"),/permission was denied/);
  assert.throws(()=>reviewWalletConnectQrPayload(uri,"unavailable"),/No camera is available/);
});
test("malformed and non-WalletConnect QR values fail closed",()=>{
  for(const value of ["https://example.com",`wc:${"a".repeat(64)}@1?relay-protocol=irn&symKey=${"b".repeat(64)}`,"",null])assert.throws(()=>reviewWalletConnectQrPayload(value,"ready"));
});
