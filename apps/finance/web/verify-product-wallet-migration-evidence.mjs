import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateProductWalletMigrationEvidence } from '@ynx-chain/wallet-auth';

const evidence = JSON.parse(await readFile(new URL('../evidence/p0-finance-product-wallet-migration-evidence-20260821.json', import.meta.url), 'utf8'));
const actual = evaluateProductWalletMigrationEvidence(evidence.input);
assert.deepEqual(actual, evidence.expected, 'Finance migration evidence must be evaluated by the accepted Wallet/Auth root export');
process.stdout.write(`${JSON.stringify({ evaluator: evidence.evaluatorAuthority, result: actual }, null, 2)}\n`);
