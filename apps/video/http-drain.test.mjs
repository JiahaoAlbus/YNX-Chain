import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, get} from 'node:http';
import {createServer as reserveServer, connect} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const products = [
  ['video', fileURLToPath(new URL('./server.mjs', import.meta.url))],
  ['creator', fileURLToPath(new URL('../creator-studio/server.mjs', import.meta.url))],
];
function bounded(promise, ms = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('HTTP lifecycle test timed out')), ms);
  })]).finally(() => clearTimeout(timer));
}
async function unusedPort() {
  const server = reserveServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function launch(product, entry, port, upstream) {
  if (process.env.YNX_HTTP_DRAIN_PARENT_ROOT) {
    entry = join(process.env.YNX_HTTP_DRAIN_PARENT_ROOT, `${product}-parent-server.mjs`);
  }
  const child = spawn(process.execPath, [entry], {
    env: {...process.env, PORT: String(port), YNX_VIDEO_API_ORIGIN: upstream},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = {child, stderr: '', stdout: ''};
  child.stderr.on('data', data => { result.stderr += data; });
  child.stdout.on('data', data => { result.stdout += data; });
  result.exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  result.ready = bounded(Promise.race([
    once(child.stdout, 'data'),
    result.exited.then(exit => { throw new Error(`entry exited before readiness: ${JSON.stringify(exit)}`); }),
  ]));
  // Bind-failure controls await exited instead of readiness.
  result.ready.catch(() => {});
  return result;
}
async function refusesConnections(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const refused = await new Promise(resolve => {
      const socket = connect({host: '127.0.0.1', port});
      socket.once('error', () => resolve(true));
      socket.once('connect', () => { socket.destroy(); resolve(false); });
    });
    if (refused) return;
    await pause(20);
  }
  assert.fail('entry continued accepting new connections after signal');
}
function request(port) {
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const completed = new Promise((resolve, reject) => {
    const outgoing = get(`http://127.0.0.1:${port}/video/api/held`, {agent: false}, incoming => {
      let body = '';
      incoming.on('data', chunk => { body += chunk; startedResolve(); });
      incoming.once('end', () => resolve(body));
      incoming.once('aborted', () => reject(new Error('accepted response aborted')));
      incoming.once('error', reject);
    });
    outgoing.once('error', reject);
  });
  // Keep the original failure available without an unhandled rejection.
  const outcome = completed.then(body => ({body}), error => ({error}));
  return {started, outcome};
}
async function setup(t, product, entry, keepAlive = false) {
  let response, pulse;
  const sockets = new Set();
  const upstream = createServer((_req, res) => {
    response = res;
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write('accepted:');
    if (keepAlive) pulse = setInterval(() => res.write('.'), 100);
    res.once('close', () => clearInterval(pulse));
  });
  upstream.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = await unusedPort();
  const running = launch(product, entry, port, `http://127.0.0.1:${upstream.address().port}`);
  t.after(async () => {
    clearInterval(pulse);
    if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL');
    await bounded(running.exited);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => upstream.close(resolve));
  });
  await running.ready;
  const pending = request(port);
  await bounded(pending.started);
  return {running, pending, port, response: () => response};
}
for (const [product, entry] of products) {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    test(`${product} ${signal} drains accepted proxy response and stops new accepts`, async t => {
      const {running, pending, port, response} = await setup(t, product, entry);
      running.child.kill(signal);
      await refusesConnections(port);
      await pause(100);
      assert.equal(running.child.signalCode, null, 'accepted response must survive termination signal');
      assert.equal(running.child.exitCode, null, 'entry must wait for accepted response');
      // A repeated signal must preserve the one existing drain.
      running.child.kill(signal);
      await pause(20);
      response().end('complete');
      const outcome = await bounded(pending.outcome);
      assert.ifError(outcome.error);
      assert.equal(outcome.body, 'accepted:complete');
      assert.deepEqual(await bounded(running.exited), {code: 0, signal: null});
      await refusesConnections(port);
    });
  }
  test(`${product} normal entry enforces 15 second drain deadline with nonzero exit`, {timeout: 22000}, async t => {
    const {running, pending, port} = await setup(t, product, entry, true);
    const start = Date.now();
    running.child.kill('SIGTERM');
    await refusesConnections(port);
    const outcome = await bounded(pending.outcome, 18000);
    assert.ok(outcome.error, 'deadline must close the unfinished accepted response');
    const exit = await bounded(running.exited);
    assert.equal(exit.signal, null);
    assert.notEqual(exit.code, 0);
    assert.ok(Date.now() - start >= 14500, 'normal entry deadline must not be shortened');
    assert.match(running.stderr, /HTTP shutdown deadline exceeded/);
    await refusesConnections(port);
  });
  test(`${product} normal entry preserves nonzero bind failure`, async t => {
    const occupied = reserveServer();
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    t.after(() => new Promise(resolve => occupied.close(resolve)));
    const running = launch(product, entry, occupied.address().port, 'http://127.0.0.1:1');
    const exit = await bounded(running.exited);
    assert.notEqual(exit.code, 0);
    assert.match(running.stderr, /EADDRINUSE/);
  });
}
