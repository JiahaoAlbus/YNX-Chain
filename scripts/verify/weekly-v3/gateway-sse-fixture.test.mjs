import test from 'node:test';
import assert from 'node:assert/strict';
import {startGatewayFixture, gatewayFixtureKey, gatewayDraftFixture} from './gateway-sse-fixture.mjs';

const read = (fixture, path = '/ai/stream?session=finance%3Apublic-test&q=public-fixture') => fetch(fixture.url + path, {headers: {'X-YNX-AI-Key': gatewayFixtureKey}, signal: AbortSignal.timeout(2000)});
const joined = wire => wire.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)).text).join('');

test('fixture binds loopback and streams fragmented draft JSON without model claims', async t => {
  const fixture = await startGatewayFixture(); t.after(() => fixture.close());
  assert.equal(new URL(fixture.url).hostname, '127.0.0.1');
  const health = await (await read(fixture, '/health')).json();
  assert.match(health.model, /fixture-not-a-model/);
  const response = await read(fixture);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const wire = await response.text();
  assert(wire.split('data: ').length > 5);
  assert.deepEqual(JSON.parse(joined(wire)), gatewayDraftFixture);
  assert.equal(fixture.requests.length, 2);
  assert(fixture.requests.every(r => r.authenticated));
});
test('missing authentication cannot read the scripted response', async t => {
  const fixture = await startGatewayFixture(); t.after(() => fixture.close());
  const response = await fetch(fixture.url + '/health');
  assert.equal(response.status, 401);
});
test('fixture has no POST or broker execution endpoint', async t => {
  const fixture = await startGatewayFixture(); t.after(() => fixture.close());
  const response = await fetch(fixture.url + '/orders', {method: 'POST', headers: {'X-YNX-AI-Key': gatewayFixtureKey}, body: '{}'});
  assert.equal(response.status, 404);
});
for (const [scenario, status] of [['unauthorized', 401], ['rate-limited', 429]]) {
  test(`scripted ${scenario} is explicit and makes no retry`, async t => {
    const fixture = await startGatewayFixture({scenario}); t.after(() => fixture.close());
    assert.equal((await read(fixture)).status, status);
    assert.equal(fixture.requests.length, 1);
  });
}
for (const scenario of ['invalid-schema', 'unstructured', 'malformed-sse', 'truncated']) {
  test(`negative ${scenario} fixture remains invalid; never repaired by the harness`, async t => {
    const fixture = await startGatewayFixture({scenario}); t.after(() => fixture.close());
    const wire = await (await read(fixture)).text();
    if (scenario === 'malformed-sse') assert.throws(() => joined(wire));
    else if (scenario === 'invalid-schema') {
      const value = JSON.parse(joined(wire));
      assert.equal(typeof value.orderDraft.qty, 'number');
      assert.equal(value.execute, true);
    } else assert.throws(() => JSON.parse(joined(wire)));
  });
}
test('request bound is enforced and fixture shutdown is idempotent', async t => {
  const fixture = await startGatewayFixture({maxRequests: 1}); t.after(() => fixture.close());
  assert.equal((await read(fixture, '/health')).status, 200);
  assert.equal((await read(fixture, '/health')).status, 429);
  assert.equal(fixture.requests.length, 1);
  await fixture.close();
  await fixture.close();
});
