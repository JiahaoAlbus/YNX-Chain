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
  assert.match(transaction, /package_network == ynx-code-package-egress/);
  assert.match(transaction, /lxc network show "\$package_network" --format json/);
  assert.match(transaction, /lxc network acl show "\$package_acl" --format json/);
  assert.match(transaction, /verify-package-egress-network\.mjs/);
  assert.ok(
    transaction.indexOf("verify-package-egress-network.mjs") <
      transaction.indexOf("install-reviewed-dependencies.sh"),
  );
  assert.match(transaction, /git_safe=.*safe\.directory/);
  assert.match(transaction, /merge-base --is-ancestor/);
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
  assert.match(transaction, /live-public-candidate-check\.mjs prepare/);
  assert.match(transaction, /systemctl restart "\$service"/);
  assert.match(transaction, /live-public-candidate-check\.mjs resume/);
  assert.match(transaction, /https:\/\/developer\.ynxweb4\.com\/healthz/);
  assert.doesNotMatch(transaction, /PRIVATE KEY|mnemonic|seed phrase/);
  assert.doesNotMatch(transaction, /cp -a "\$backup_(?:dir|tar)".*"\$state_dir"/);
});

test("candidate release and image identity come only from the protected environment", () => {
  assert.doesNotMatch(unit, /^Environment=YNX_CODE_RELEASE=/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/ynx\/ynx-code-candidate\.env$/m);
  assert.match(image, /ynx-code-ubuntu-24\.04-v3/);
  assert.match(image, /openjdk-21-jdk-headless/);
  assert.match(image, /ynx-code-jdk-packages\.txt/);
});
