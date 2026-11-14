import { PROTOCOLS, SCENARIOS } from '../trace-verdict.mjs';

// Deterministic classifier fixtures only. These events were NOT captured from a browser or route.
export function classifierFixture() {
  const domain = 'classifier.leak.test';
  return {
    schema: 'YNX_SYNTHETIC_LEAK_TRACE_V1', evidenceClass: 'fixture', mode: 'tor', sourceHEAD: '6933941bc5ab8e824c4cd803c5bb40be77afef15',
    platformAdmission: { admitted: false }, syntheticDomains: [domain], routeEndpoints: [{ transport: 'tcp', host: '127.0.0.1', port: 19050 }],
    runs: SCENARIOS.map((scenario, index) => {
      const runID = `fixture-${index}`; let sequence = 0;
      const event = value => ({ sequence: ++sequence, at: value.at ?? 20 + sequence, runID, ...value });
      const events = [event({ kind: 'state', state: 'ready', at: 1 })];
      if (scenario !== 'baseline') events.push(event({ kind: 'fault', fault: scenario, at: 10 }), event({ kind: 'state', state: 'blocked', at: 11 }));
      for (const protocol of PROTOCOLS) {
        const probeID = `${scenario}-${protocol}`;
        events.push(event({ kind: 'probe', protocol, probeID, decision: scenario === 'baseline' ? 'routed' : 'blocked' }));
        if (scenario === 'baseline' && ['https', 'wss', 'download'].includes(protocol)) {
          events.push(event({ kind: 'flow', actor: 'network', protocol, probeID, hostname: domain, destination: { transport: 'tcp', host: '127.0.0.1', port: 19050 } }));
          events.push(event({ kind: 'flow', actor: 'route', protocol, probeID, hostname: domain, destination: { transport: 'tcp', host: '127.0.0.1', port: 19443 } }));
          events.push(event({ kind: 'receipt', actor: 'target', protocol, probeID, hostname: domain }));
        }
      }
      return { scenario, runID, window: { start: 0, end: 6010 }, capture: { available: true, scope: 'client-process-tree+synthetic-dns', roles: ['ui', 'network', 'webcontent', 'route', 'resolver'], coverage: ['tcp', 'udp', 'dns', 'ipv4', 'ipv6'], start: 0, end: 6010, dropped: 0, artifactSHA256: '0'.repeat(64) }, targetObserver: { available: true, complete: true }, events };
    })
  };
}
