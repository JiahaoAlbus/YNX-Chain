import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const WORKFLOW = new URL("../../../.github/workflows/wallet-contract-testnet-deploy.yml", import.meta.url);

test("Wallet contract deployment workflow is manual, environment-protected and source-bound", async () => {
  const source = await readFile(WORKFLOW, "utf8");
  assert.match(source, /^name: wallet-contract-testnet-deploy$/m);
  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(source, /^  (?:push|pull_request|schedule):/m);
  assert.match(source, /^permissions:\n  contents: read$/m);
  assert.match(source, /^    environment: ynx-testnet-wallet-contracts$/m);
  assert.match(source, /ref: \$\{\{ inputs\.source_commit \}\}/);
  assert.match(source, /\[\[ "\$SOURCE_COMMIT" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_COMMIT"/);
  assert.match(source, /DEPLOYER_PRIVATE_KEY: \$\{\{ secrets\.DEPLOYER_PRIVATE_KEY \}\}/);
  assert.match(source, /YNX_EVM_RPC_URL: \$\{\{ secrets\.YNX_EVM_RPC_URL \}\}/);
  assert.match(source, /npm run hardhat:test:wallet/);
  assert.match(source, /npm --prefix packages\/wallet-auth test/);
  assert.match(source, /npm run hardhat:deploy:wallet-smart-account/);
  assert.match(source, /npm --prefix packages\/wallet-auth run verify:testnet-deployment/);
  assert.match(source, /if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(source, /pull_request|git push|gh pr|Caddy|website.*deploy/i);
});
