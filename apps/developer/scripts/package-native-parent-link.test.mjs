import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const recipe = new URL('./package-local-macos.sh', import.meta.url);
test('normal Mac package links the original Native successor, excluding the superseded implementation', async () => {
  const script = await readFile(recipe, 'utf8');
  const commands = script.split('\n').filter(line => /^\/usr\/bin\/clang/.test(line));
  assert.ok(!commands.some(line => line.includes('ynx-wallet-admission-parent.m')));
  const link = commands.find(line => line.includes('original-ide-parent-supplier.mm'));
  assert.ok(link, 'normal package must actually link the delivered parent supplier');
  for (const unit of ['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-observation.mm']) assert.ok(link.includes(unit), unit);
  assert.ok(link.includes('-lbsm'));
  assert.ok(link.includes('-std=c++17'));
  assert.ok(commands.some(line => line.includes('-c desktop/macos/main.m')), 'preserve Objective-C compilation of existing shell');
});
