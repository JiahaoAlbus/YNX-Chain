// PUBLIC whole-transport fixture. Actual PQ TLS/inbound caller and continuation
// are exercised, without an Auth Source, reservation, grant or resource Store.
import assert from 'node:assert/strict';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {openTaskGrantInboundTransportForOriginalBootstrap as openInbound} from './task-grant-transport.mjs';
import {openOriginalTaskReadContinuationTransport as openContinuation} from './task-read-resource-continuation.mjs';

const [socketPath, resourceSocket, goUID, goPID, mode] = process.argv.slice(2);
assert.ok(['normal', 'revoked'].includes(mode));
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const routes = ['issue', 'effect', 'query', 'effect-query', 'effect-reconcile', 'revoke', 'management'].map(id => ({
  method: 'POST', path: '/internal/auth/task-grants/' + id, maxRequestBytes: 1048576, maxResponseBytes: 1048576,
}));
const profile = {socketPath: resourceSocket, serverUID: Number(goUID), serverPID: Number(goPID),
  service: 'ynx-ai-original-task-read-v1', connectTimeoutMs: 1000, requestTimeoutMs: 5000,
  routes: ['input', 'execute', 'query'].map(id => ({id, method: 'POST', path: '/internal/ai/original-task-read/' + id,
    maxRequestBytes: 1048576, maxResponseBytes: 1048576}))};
let inbound, completed = 0;
const opened = await openInbound({socketPath, nodeUID: process.geteuid(), bridgeUID: Number(goUID), bridgePID: Number(goPID),
  service: 'desktop-grant-continuation-tls-test', acceptTimeoutMs: 500, currentTimeoutMs: 2000, maxConnections: 8, routes}, async (req, res) => {
  let caller, transport, response, failure;
  const stats = {current: 0, read: 0, claims: 0, retire: 0, join: 0, close: 0};
  try {
    const acquired = await inbound.acquireOriginalInbound(req); caller = acquired.caller;
    if (acquired.errorPresent) throw acquired.error;
    const material = await inbound.currentOriginalInbound(caller);
    assert.equal(material.Channel.LocalSAN, 'adapter.ynx.test');
    assert.equal(material.Channel.Peer.SubjectAltName, 'pay.ynx.test');
    assert.equal(material.Channel.Exporter.length, 32);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks); assert.deepEqual(body, material.Body);
    const digest = createHash('sha256').update(body).digest('hex');
    // This PUBLIC child delegates freshness to the genuine original TLS caller.
    // It deliberately does not pretend to be Auth's recognized inventory.
    const child = Object.freeze({
      async assertCurrent() {
        stats.current++;
        const fresh = await inbound.currentOriginalInbound(caller);
        assert.deepEqual(fresh.Body, body);
      },
      readOriginalRequestDATA() {
        stats.read++; inbound.assertOriginalInboundAtCommit(caller);
        return {PUBLIC: 'original TLS transport DATA', entitySHA256: digest};
      },
      claimAtOriginalResourceFence() {inbound.assertOriginalInboundAtCommit(caller); stats.claims++;},
      retire() {stats.retire++;}, async join() {stats.join++;}, async close() {stats.close++;},
    });
    const acquiredTransport = await openContinuation(profile, body, child); transport = acquiredTransport.owner;
    assert.ok(transport); if (acquiredTransport.errorPresent) throw acquiredTransport.error;
    const exchanged = await transport.exchange(); response = exchanged.response;
    if (exchanged.errorPresent) throw exchanged.error;
    assert.ok(response);
    const returned = response.copyDATA();
    assert.equal(returned.statusCode, 200); assert.equal(returned.bodyComplete, true);
    assert.deepEqual(returned.body, body);
    assert.equal(returned.sourceVerified, false); assert.equal(returned.operationVerified, false);
  } catch (error) {failure = error;}
  finally {
    response?.release();
    if (transport) {
      const closed = await transport.close({signal: AbortSignal.timeout(3000)});
      assert.equal(closed.physicalDone, true, 'actual outbound continuation must drain');
      const life = transport.lifetime();
      assert.equal(life.closed, true); assert.equal(life.heldWork, 0); assert.equal(life.controlDone, true);
      emit({event: 'continuation-closed', physicalDone: closed.physicalDone, life});
    }
    if (caller) await inbound.releaseOriginalInbound(caller);
  }
  assert.deepEqual([stats.retire, stats.join, stats.close], [0, 0, 0], 'LINK must not finalize borrowed child');
  assert.equal(Boolean(failure), mode === 'revoked');
  assert.equal(stats.claims, mode === 'normal' ? 1 : 0);
  assert.equal(stats.read, 1);
  completed++;
  emit({event: 'completed', stats, errorPresent: Boolean(failure), RootAdmission: false, SourceAdmission: false});
  if (!res.destroyed) {res.writeHead(failure ? 409 : 200, {'content-type': 'application/json'}); res.end(materialResponse(mode));}
});
function materialResponse(value) {return JSON.stringify({PUBLIC: value});}
inbound = opened.owner; if (opened.errorPresent) throw opened.error;
emit({event: 'ready', pid: process.pid, node: process.version, napi: process.versions.napi});
const lines = readline.createInterface({input: process.stdin});
let stopped = false;
for await (const line of lines) {
  assert.equal(line, 'stop'); assert.equal(stopped, false); stopped = true;
  inbound.retire(); await inbound.join(); await inbound.close();
  const life = inbound.lifetime();
  assert.equal(life.closed, true); assert.equal(life.joined, true); assert.equal(life.callerHolds, 0);
  assert.equal(life.pending, 0); assert.equal(life.cleanupUnknown, false); assert.equal(completed, 1);
  emit({event: 'closed', completed, life}); break;
}
lines.close(); process.stdin.pause(); assert.equal(stopped, true);
