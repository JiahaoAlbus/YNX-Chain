import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { NativeWalletController } = createRequire(import.meta.url)('../lib/native-wallet-controller.js');

// Public fault injection exercises the actual UI controller; this does not
// supply a Native owner, create a session or prove Wallet authorization.
for (const stage of ['admission', 'native-factory']) {
  for (const reason of [null, undefined, false, 0, '']) {
    test(`${stage} rejecting ${String(reason)} settles UI and allows explicit retry`, async () => {
      let attempts = 0, factories = 0;
      const api = {
        DEVELOPER_WALLET_V2_SOURCE: { gatewayOrigin: 'https://wallet-auth.ynxweb4.com' },
        subscribeDeveloperWalletCallbacks: () => () => {},
        async beginDeveloperWalletV2Connection() {
          factories++;
          if (stage === 'native-factory' && attempts === 1) throw reason;
          throw Error('TEST_ONLY_RETRY_REJECTED');
        },
      };
      const admission = { async assertCurrent() {
        attempts++;
        if (stage === 'admission') {
          if (attempts === 1) throw reason;
          throw Error('TEST_ONLY_RETRY_REJECTED');
        }
      } };
      const controller = new NativeWalletController(api, () => {}, admission);
      await assert.doesNotReject(controller.connect());
      assert.equal(controller.state.phase, 'error');
      assert.equal(controller.state.busy, false);
      assert.equal(controller.state.sessionCurrent, false);
      assert.equal(controller.state.projectCapability, 'not-supplied');
      assert.equal(controller.state.message, 'Wallet operation failed.');
      assert.equal(controller.inFlight, undefined);
      assert.equal(controller.runtime, undefined);
      assert.equal(factories, stage === 'admission' ? 0 : 1);
      await assert.doesNotReject(controller.connect());
      assert.equal(attempts, 2);
      assert.equal(controller.state.message, 'TEST_ONLY_RETRY_REJECTED');
      assert.equal(controller.state.busy, false);
      assert.equal(controller.inFlight, undefined);
      await controller.dispose();
    });
  }
}
