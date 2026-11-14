import test from 'node:test';
import assert from 'node:assert/strict';
import {YNXCloudClient} from '../sdk/index.js';

for (const reason of [null, false, 0, '']) {
  test(`deployment read retains ${JSON.stringify(reason)} cancellation and suppresses late HTTP`, async () => {
    const controller = new AbortController();
    let entered, release, fetches = 0;
    const started = new Promise(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const client = new YNXCloudClient({
      endpoint: 'https://public.invalid/api/v1', product: 'cloud',
      getDeploymentRequestHeaders: async () => {
        entered(); await waiting; return {'X-Public-Fixture': 'NOT_A_SIGNATURE'};
      },
      fetch: async () => { fetches++; throw Error('unexpected HTTP dispatch'); }
    });
    const pending = client.getIDEDeploymentStatus('req_PUBLIC_ABORT_REASON_00001', {signal: controller.signal});
    const rejected = assert.rejects(pending, error => error === reason);
    await started;
    controller.abort(reason);
    await rejected;
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetches, 0);
  });
}
