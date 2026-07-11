#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roles = ["primary", "singapore", "silicon-valley", "seoul"];

function decodeAccount(file, allowMissing = false) {
  const response = JSON.parse(fs.readFileSync(file, "utf8")).result?.response;
  if (!response) throw new Error(`missing ABCI response in ${file}`);
  if (Number(response.code || 0) !== 0) {
    if (allowMissing && Number(response.code) === 1) return { balance: 0, nonce: 0 };
    throw new Error(`ABCI query failed in ${file}: ${response.log}`);
  }
  return JSON.parse(Buffer.from(response.value, "base64").toString("utf8"));
}

function verify(root, sender, recipient, amount, nonce) {
  const broadcast = JSON.parse(fs.readFileSync(path.join(root, "broadcast.json"), "utf8"));
  if (Number(broadcast.result?.check_tx?.code || 0) !== 0 || Number(broadcast.result?.tx_result?.code || 0) !== 0 || !/^[0-9A-F]{64}$/.test(broadcast.result?.hash || "")) {
    throw new Error("candidate signed transaction broadcast did not commit successfully");
  }
  let expectedAfter = null;
  for (const role of roles) {
    const beforeSender = decodeAccount(path.join(root, "before", role, "sender.json"));
    const beforeRecipient = decodeAccount(path.join(root, "before", role, "recipient.json"), true);
    const afterSender = decodeAccount(path.join(root, "after", role, "sender.json"));
    const afterRecipient = decodeAccount(path.join(root, "after", role, "recipient.json"));
    if (afterSender.address !== sender || afterRecipient.address !== recipient || afterSender.balance !== beforeSender.balance - amount - 1 || afterSender.nonce !== nonce || beforeSender.nonce + 1 !== nonce || afterRecipient.balance !== beforeRecipient.balance + amount) {
      throw new Error(`${role} account result does not match signed transfer semantics`);
    }
    const current = JSON.stringify({ senderBalance: afterSender.balance, senderNonce: afterSender.nonce, recipientBalance: afterRecipient.balance });
    if (expectedAfter === null) expectedAfter = current;
    else if (current !== expectedAfter) throw new Error(`${role} account state differs after the committed transaction`);
  }
  return {
    schemaVersion: 1,
    status: "passed",
    scope: "remote-parallel-consensus-candidate-signed-transaction",
    publicCutoverAuthorized: false,
    txHash: broadcast.result.hash,
    height: Number(broadcast.result.height),
    sender,
    recipient,
    amount,
    nonce,
    fee: 1,
    convergedAccountState: JSON.parse(expectedAfter),
  };
}

function queryResponse(account) {
  return { result: { response: { value: Buffer.from(JSON.stringify(account)).toString("base64") } } };
}

function writeSelfTest(root, sender, recipient) {
  fs.writeFileSync(path.join(root, "broadcast.json"), `${JSON.stringify({ result: { check_tx: { code: 0 }, tx_result: { code: 0 }, hash: "C".repeat(64), height: "12" } })}\n`);
  for (const role of roles) {
    for (const phase of ["before", "after"]) fs.mkdirSync(path.join(root, phase, role), { recursive: true });
    fs.writeFileSync(path.join(root, "before", role, "sender.json"), `${JSON.stringify(queryResponse({ address: sender, balance: 1000, nonce: 0 }))}\n`);
    fs.writeFileSync(path.join(root, "before", role, "recipient.json"), `${JSON.stringify({ result: { response: { code: 1, log: "YNX account not found" } } })}\n`);
    fs.writeFileSync(path.join(root, "after", role, "sender.json"), `${JSON.stringify(queryResponse({ address: sender, balance: 874, nonce: 1 }))}\n`);
    fs.writeFileSync(path.join(root, "after", role, "recipient.json"), `${JSON.stringify(queryResponse({ address: recipient, balance: 125, nonce: 0 }))}\n`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-consensus-tx-evidence-"));
  const sender = `0x${"1".repeat(40)}`;
  const recipient = `0x${"2".repeat(40)}`;
  try {
    writeSelfTest(root, sender, recipient);
    const result = verify(root, sender, recipient, 125, 1);
    if (result.status !== "passed" || result.publicCutoverAuthorized !== false || result.convergedAccountState.senderBalance !== 874) throw new Error("signed transaction evidence self-test did not pass");
    const divergentPath = path.join(root, "after", "seoul", "recipient.json");
    fs.writeFileSync(divergentPath, `${JSON.stringify(queryResponse({ address: recipient, balance: 124, nonce: 0 }))}\n`);
    let rejected = false;
    try { verify(root, sender, recipient, 125, 1); } catch { rejected = true; }
    if (!rejected) throw new Error("signed transaction evidence self-test accepted divergent account state");
    console.log("consensus candidate signed transaction evidence self-test passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  const [root, sender, recipient, amountRaw, nonceRaw, output] = args;
  const amount = Number(amountRaw), nonce = Number(nonceRaw);
  if (!root || !/^0x[0-9a-f]{40}$/.test(sender || "") || !/^0x[0-9a-f]{40}$/.test(recipient || "") || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(nonce) || nonce <= 0 || !output) {
    throw new Error("usage: consensus-candidate-tx-evidence.mjs <evidence-root> <sender> <recipient> <amount> <nonce> <output>");
  }
  const result = verify(root, sender, recipient, amount, nonce);
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`candidate signed transaction passed: hash=${result.txHash} height=${result.height}`);
}
