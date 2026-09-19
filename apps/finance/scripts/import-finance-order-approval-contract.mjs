#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  throw new Error("usage: import-finance-order-approval-contract.mjs <frozen-contract-directory>");
}

const expected = Object.freeze({
  "finance-order-approval-v1.md": "f236823ba32a892c4157745490d2ff2767dcc33928b4d4b9dbbbfb8e0dc334f3",
  "finance-order-approval-v1.schema.json": "c3e61e2e7808985041164132b797862a79715ef08e837d26ddb7e9048356d067",
  "finance-order-approval-v1.transport.schema.json": "f45c7ab4c28ce6f01ba7043358cb3e43ed4523990f19754c2ed59777d4ecbc52",
  "finance-order-approval-v1.vectors.json": "f8f4810e699400f019c33d045088401507d37b8d694e4e9b65498f817e895a5a",
});
const destination = new URL("../integration/wallet-auth/", import.meta.url);
await mkdir(destination, { recursive: true });

const manifest = {
  schemaVersion: "ynx-finance-wallet-auth-contract-import/1",
  authority: "central-coordination-freeze-20260919",
  sourceHashes: expected,
  walletAuthority: {
    commit: "ab4dfa927be3d16fde3048b72d705d90c770dcd3",
    verifier: { path: "packages/wallet-auth/src/finance-order-approval.js", blob: "cd0a0a89d490bcc762b93c6a38b60a74a51089b6", bytes: 19189, sha256: "4aa50e5827ab00d0a8d0d87b29a78f2324aafd8c9f4aa3bc1ce0858f81711425" },
    transport: { path: "packages/wallet-auth/src/finance-order-approval-transport.js", blob: "c3cdbfee7d95f78cd0ce51a55db4176706dcbedc", bytes: 8531, sha256: "820204fc52d645f3f40b6c6866511df8e5a0b895a760fb200ea95a60aebca945" },
  },
};

for (const [name, expectedHash] of Object.entries(expected)) {
  const bytes = await readFile(path.join(sourceDirectory, name));
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`${name}: expected ${expectedHash}, got ${actualHash}`);
  }
  await writeFile(new URL(name, destination), bytes, { mode: 0o644 });
}

await writeFile(
  new URL("finance-order-approval-v1.import.json", destination),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
