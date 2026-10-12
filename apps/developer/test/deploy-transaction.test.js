import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url),
  transaction = await readFile(
    new URL("scripts/deploy-public-candidate-transaction.sh", root),
    "utf8",
  ),
  unit = await readFile(
    new URL("deploy/systemd/ynx-code-candidate.service", root),
    "utf8",
  ),
  image = await readFile(
    new URL("scripts/build-cloud-toolchain-image.sh", root),
    "utf8",
  );

test("public candidate transaction is exact-source, preflighted and rollback-safe", () => {
  assert.match(transaction, /YNX_CODE_DEPLOY_COMMIT:\?/);
  assert.match(transaction, /package_network == ynx-pkg-egress/);
  assert.match(transaction, /lxc query "\/1\.0\/networks\/\$package_network"/);
  assert.match(transaction, /lxc query "\/1\.0\/network-acls\/\$package_acl"/);
  assert.match(transaction, /verify-package-egress-network\.mjs/);
  assert.ok(
    transaction.indexOf("verify-package-egress-network.mjs") <
      transaction.indexOf("install-reviewed-dependencies.sh"),
  );
  assert.match(transaction, /git_safe=.*safe\.directory/);
  assert.match(transaction, /runuser_bin=\/usr\/sbin\/runuser/);
  assert.match(transaction, /reviewed runuser binary is missing/);
  assert.match(transaction, /merge-base --is-ancestor/);
  assert.match(transaction, /rev-parse "\$expected_commit\^\{tree\}"/);
  assert.match(transaction, /status --porcelain=v1 --untracked-files=normal/);
  assert.match(transaction, /candidate_dir="\$candidate_root\/\$expected_commit"/);
  assert.match(transaction, /npm run code:check && npm run code:build && npm test/);
  assert.ok(
    transaction.indexOf("npm run code:check") <
      transaction.indexOf('ln -sfn "$candidate_dir"'),
  );
  assert.match(transaction, /\[\[ \$image_fingerprint =~ \^\[0-9a-f\]\{64\}\$ \]\]/);
  assert.match(transaction, /state-before\.sha256/);
  assert.match(transaction, /ln -sfn "\$previous_target" "\$current_link"/);
  assert.match(transaction, /lxc image delete "\$image_fingerprint"/);
  assert.match(transaction, /live-container-check\.mjs/);
  assert.match(transaction, /Cloud runtime gate failed once; retrying from a fresh isolated runtime/);
  assert.match(transaction, /live-container-retry\.log/);
  assert.match(transaction, /Cloud runtime gate failed in both fresh isolated runtime attempts/);
  assert.match(transaction, /trap rollback ERR EXIT HUP INT TERM/);
  assert.match(transaction, /trap - ERR EXIT HUP INT TERM/);
  assert.match(transaction, /live-package-install-check\.mjs prepare/);
  assert.match(transaction, /package-devices-after-install\.json/);
  assert.match(transaction, /Temporary package egress remains attached/);
  assert.match(transaction, /Array\.isArray\(value\)\?value:value\?\.metadata/);
  assert.match(transaction, /live-public-candidate-check\.mjs prepare/);
  assert.match(transaction, /systemctl restart "\$service"/);
  assert.match(transaction, /health-after-restart\.json/);
  assert.match(transaction, /YNX_CODE_SOURCE_COMMIT/);
  assert.match(transaction, /YNX_CODE_SOURCE_TREE/);
  assert.match(transaction, /v\.sourceCommit!==process\.argv\[3\]/);
  assert.match(transaction, /v\.sourceTree!==process\.argv\[4\]/);
  assert.match(transaction, /live-public-candidate-check\.mjs resume/);
  assert.match(transaction, /live-package-install-check\.mjs resume/);
  assert.match(transaction, /package-devices-after-restart\.json/);
  assert.ok(
    transaction.indexOf("live-package-install-check.mjs prepare") <
      transaction.indexOf('systemctl restart "$service"'),
  );
  assert.ok(
    transaction.indexOf('systemctl restart "$service"') <
      transaction.indexOf("live-package-install-check.mjs resume"),
  );
  assert.match(transaction, /https:\/\/developer\.ynxweb4\.com\/healthz/);
  assert.doesNotMatch(transaction, /PRIVATE KEY|mnemonic|seed phrase/);
  assert.doesNotMatch(transaction, /cp -a "\$backup_(?:dir|tar)".*"\$state_dir"/);
});

test("candidate release and image identity come only from the protected environment", () => {
  assert.doesNotMatch(unit, /^Environment=YNX_CODE_RELEASE=/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/ynx\/ynx-code-candidate\.env$/m);
  assert.match(unit, /^Environment=PATH=\/snap\/lxd\/current\/bin:.*:\/snap\/bin$/m);
  assert.match(unit, /^Environment=LXD_CONF=\/var\/lib\/ynx-code-candidate\/lxd-client$/m);
  assert.match(image, /ynx-code-ubuntu-24\.04-v3/);
  assert.match(image, /openjdk-21-jdk-headless/);
  assert.match(image, /ynx-code-jdk-packages\.txt/);
});
