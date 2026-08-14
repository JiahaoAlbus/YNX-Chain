import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Wallet deployment preflights, persists and rolls back Product Session v2 state", async()=>{
  const install=await readFile(new URL("../../../scripts/deploy/install-wallet-gateway-testnet-remote.sh",import.meta.url),"utf8");
  const deploy=await readFile(new URL("../../../scripts/deploy/deploy-testnet.sh",import.meta.url),"utf8");
  const walletDeploy=await readFile(new URL("../../../scripts/deploy/deploy-wallet-gateway-testnet.sh",import.meta.url),"utf8");
  assert.match(deploy,/YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH=\/var\/lib\/ynx-chain\/wallet-gateway\/product-session-v2\.json/);
  assert.match(install,/cp -a "\$v2_state_file" "\$preflight_v2_state"/);
  assert.match(install,/YNX_WALLET_PRODUCT_SESSION_V2_STATE_PATH="\$preflight_v2_state"/);
  assert.match(install,/YNX_WALLET_GATEWAY_ALLOW_LEGACY_STATE_MIGRATION=true/);
  assert.match(install,/cp -a "\$preflight_state" "\$candidate_state"/);
  assert.match(install,/req_preflight_v2_00001/);
  assert.match(install,/cp -a "\$v2_state_file" "\$backup_dir\/product-session-v2\.json"/);
  assert.match(install,/install -m 0600 -o ynx -g ynx "\$backup_dir\/product-session-v2\.json" "\$v2_state_file"/);
  assert.match(install,/else rm -f "\$v2_state_file"/);
  assert.match(install,/req_runtime_v2_0000001/);
  assert.match(install,/install -m 0600 -o ynx -g ynx "\$candidate_state" "\$state_file"/);
  assert.match(walletDeploy,/packages\/wallet-auth\/product-session-registry\.json/);
  assert.match(walletDeploy,/wallet-auth\/product-session-registry\.json/);
  assert.match(walletDeploy,/go build .*ynx-app-gatewayd/);
  assert.match(install,/candidate App Gateway failed config preflight/);
  assert.match(install,/cp -a \/usr\/local\/bin\/ynx-app-gatewayd "\$backup_dir\/ynx-app-gatewayd"/);
  assert.match(install,/install -m 0755 "\$release_dir\/bin\/ynx-app-gatewayd" \/usr\/local\/bin\/ynx-app-gatewayd/);
  assert.match(install,/systemctl restart ynx-app-gatewayd/);
  assert.match(install,/127\.0\.0\.1:6437\/app\/version/);
});
