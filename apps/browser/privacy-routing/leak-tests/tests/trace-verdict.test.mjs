import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLeakSuite, SCENARIOS } from '../trace-verdict.mjs';
import { classifierFixture } from '../fixtures/normalized-trace.mjs';

test('complete synthetic fixture only passes analysis and never target acceptance or opens mode', () => {
  const result = assessLeakSuite(classifierFixture());
  assert.equal(result.analysisVerdict, 'PASS'); assert.equal(result.targetVerdict, 'NOT_RUN'); assert.equal(result.opensRouteMode, false);
});

test('malformed capture/schema input cannot become PASS or echo unrecognized mode data', () => {
  for (const value of [undefined, {}, { syntheticDomains: {}, routeEndpoints: {}, runs: {}, mode: 'private-user-data' }]) {
    const result = assessLeakSuite(value);
    assert.notEqual(result.analysisVerdict, 'PASS'); assert.notEqual(result.targetVerdict, 'PASS');
    assert.equal(JSON.stringify(result).includes('private-user-data'), false);
  }
  const fixture = classifierFixture(); fixture.runs[0].capture.roles = 'ui network webcontent route resolver';
  assert.equal(assessLeakSuite(fixture).analysisVerdict, 'INCOMPLETE');
});

test('a caller cannot promote normalized fixture logs into target PASS with a Boolean', () => {
  const fixture = classifierFixture(); fixture.evidenceClass = 'target'; fixture.platformAdmission.admitted = true;
  const result = assessLeakSuite(fixture);
  assert.equal(result.targetVerdict, 'INCOMPLETE'); assert.ok(result.targetGaps.includes('INDEPENDENT_CLIENT_CAPTURE_ADAPTER_NOT_SUPPLIED'));
});

test('missing capture, packet loss, missing DNS/IPv6/UDP scope and target observer stay incomplete', () => {
  for (const mutate of [
    run => { run.capture.available = false; }, run => { run.capture.dropped = 1; },
    run => { run.capture.coverage = ['tcp', 'ipv4']; }, run => { run.capture.roles = ['ui']; },
    run => { run.targetObserver.complete = false; }, run => { run.capture.artifactSHA256 = ''; }
    , run => { delete run.capture.start; }
  ]) {
    const fixture = classifierFixture(); mutate(fixture.runs[0]);
    assert.equal(assessLeakSuite(fixture).analysisVerdict, 'INCOMPLETE');
  }
});

test('late blocked marker, unattributed receipt and short fault observation cannot pass', () => {
  const fixture = classifierFixture(), run = fixture.runs[1];
  run.events.find(event => event.kind === 'state' && event.state === 'blocked').at = 100;
  run.events.sort((a, b) => a.at - b.at);
  assert.ok(assessLeakSuite(fixture).failures.some(failure => failure.code === 'POST_FAULT_PROBE_PRECEDES_BLOCKED_READBACK'));
  const short = classifierFixture(); short.minimumFaultWindowMs = 0; short.runs[1].window.end = 1000;
  assert.equal(assessLeakSuite(short).analysisVerdict, 'INCOMPLETE');
  const unbound = classifierFixture(), fault = unbound.runs[1];
  fault.events.push({ sequence: 999, at: 1000, runID: fault.runID, kind: 'receipt', actor: 'target', hostname: 'classifier.leak.test' });
  assert.ok(assessLeakSuite(unbound).missing.some(item => item.code === 'POST_FAULT_TARGET_RECEIPT_UNATTRIBUTED'));
});

test('target receipts and changed exit IP cannot substitute for route correlation', () => {
  const fixture = classifierFixture(); fixture.runs[0].events = fixture.runs[0].events.filter(event => event.actor !== 'route');
  assert.equal(assessLeakSuite(fixture).analysisVerdict, 'INCOMPLETE');
});

test('direct target TCP, UDP, STUN, DNS and IPv6 flow from WebKit processes fails', () => {
  for (const [protocol, actor, transport, host] of [['https', 'network', 'tcp', '127.0.0.1'], ['udp', 'webcontent', 'udp', '127.0.0.1'], ['stun', 'webcontent', 'udp', '127.0.0.1'], ['dns', 'resolver', 'udp', '127.0.0.1'], ['ipv6', 'network', 'tcp', '::1']]) {
    const fixture = classifierFixture(), run = fixture.runs[0];
    run.events.push({ sequence: 999, at: 1000, runID: run.runID, kind: protocol === 'dns' ? 'dns' : 'flow', actor, protocol, hostname: 'classifier.leak.test', destination: { transport, host, port: 19443 } });
    assert.equal(assessLeakSuite(fixture).analysisVerdict, 'FAIL', protocol);
  }
});

test('every killroute/WiFi/sleepwake/crash scenario must return blocked and send no new probe', () => {
  for (const scenario of SCENARIOS.filter(value => value !== 'baseline')) {
    let fixture = classifierFixture(), run = fixture.runs.find(value => value.scenario === scenario);
    run.events = run.events.filter(event => event.state !== 'blocked');
    assert.ok(assessLeakSuite(fixture).failures.some(failure => failure.code === 'FAULT_DID_NOT_RETURN_BLOCKED'));
    fixture = classifierFixture(); run = fixture.runs.find(value => value.scenario === scenario);
    run.events.push({ sequence: 999, at: 1000, runID: run.runID, kind: 'receipt', actor: 'target', protocol: 'https', probeID: `${scenario}-https`, hostname: 'classifier.leak.test' });
    assert.ok(assessLeakSuite(fixture).failures.some(failure => failure.code === 'TARGET_REACHED_AFTER_FAULT'));
  }
});

test('new sends to route-entry itself after failure are not accepted as blocked', () => {
  const fixture = classifierFixture(), run = fixture.runs[1];
  run.events.push({ sequence: 999, at: 1000, runID: run.runID, kind: 'flow', actor: 'network', protocol: 'https', probeID: 'killroute-https', destination: fixture.routeEndpoints[0] });
  assert.ok(assessLeakSuite(fixture).failures.some(failure => failure.code === 'POST_FAULT_PROBE_DISPATCHED'));
});

test('WebRTC IP-bearing host/srflx/prflx is distinct from mDNS candidates', () => {
  const fixture = classifierFixture(), run = fixture.runs[0];
  const candidate = { sequence: 999, at: 1000, runID: run.runID, kind: 'ice', candidateType: 'host', addressFamily: 'mdns' };
  run.events.push(candidate); assert.equal(assessLeakSuite(fixture).analysisVerdict, 'PASS');
  candidate.addressFamily = 'ipv6'; assert.equal(assessLeakSuite(fixture).analysisVerdict, 'FAIL');
});

test('real browsing domain input is rejected without reproducing it in output', () => {
  const fixture = classifierFixture(), run = fixture.runs[0];
  run.events.push({ sequence: 999, at: 1000, runID: run.runID, kind: 'receipt', actor: 'target', hostname: 'private-user.example.com' });
  const result = assessLeakSuite(fixture);
  assert.equal(result.analysisVerdict, 'FAIL'); assert.equal(JSON.stringify(result).includes('private-user'), false);
});
