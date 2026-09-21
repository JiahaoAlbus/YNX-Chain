import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const native=readFileSync(new URL("./nativeTransferOutbox.ts",import.meta.url),"utf8");
const web=readFileSync(new URL("../../../wallet-web/src/extension-broadcast-journal.js",import.meta.url),"utf8");

test("Android and Web release only exact persisted successful receipt terminals",()=>{
  assert.match(native,/phase=result\.status==="durable"\?"accepted":result\.status/);
  assert.match(native,/await this\.save\(checked\);return phase==="accepted"\?this\.finalizeTerminal\(checked\):checked/);
  assert.match(native,/NATIVE_OUTBOX_HISTORY_PREFIX\+account\+"\."\+hash/);
  assert.match(web,/PENDING=new Set\(\["broadcasting","uncertain","acknowledged","unresolved"\]\)/);
  assert.match(web,/historyKey=BROADCAST_JOURNAL_PREFIX\+"hash\."\+record\.transactionHash/);
  assert.match(web,/status:"confirmed",resolution:\{kind:"durable-receipt"/);
});
