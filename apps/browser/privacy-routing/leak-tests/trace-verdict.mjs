// C-owned synthetic leak evidence classification. This is not a packet collector.
export const PROTOCOLS = Object.freeze(['https', 'wss', 'download', 'dns', 'ipv6', 'udp', 'stun', 'webrtc']);
export const SCENARIOS = Object.freeze(['baseline', 'killroute', 'wifiswitch', 'sleepwake', 'crash']);
const CLIENT_ROLES = new Set(['ui', 'network', 'webcontent', 'resolver']);
const COVERAGE = ['tcp', 'udp', 'dns', 'ipv4', 'ipv6'];
const synthetic = value => typeof value === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.test$/i.test(value);
const endpointKey = endpoint => endpoint && `${endpoint.transport}:${endpoint.host}:${endpoint.port}`;

export function assessLeakSuite(evidence) {
  const failures = [], missing = [];
  const fail = (code, scenario) => failures.push({ code, ...(scenario ? { scenario } : {}) });
  const need = (code, scenario) => missing.push({ code, ...(scenario ? { scenario } : {}) });
  if (!evidence || evidence.schema !== 'YNX_SYNTHETIC_LEAK_TRACE_V1') need('SCHEMA_REQUIRED');
  if (!['fixture', 'isolated', 'target'].includes(evidence?.evidenceClass)) need('EVIDENCE_CLASS_REQUIRED');
  if (!['tor', 'nym'].includes(evidence?.mode)) need('ROUTE_MODE_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(evidence?.sourceHEAD ?? '')) need('EXACT_SOURCE_HEAD_REQUIRED');
  const domains = new Set(Array.isArray(evidence?.syntheticDomains) ? evidence.syntheticDomains : []);
  if (!domains.size || [...domains].some(domain => !synthetic(domain))) fail('NON_SYNTHETIC_DOMAIN');
  const routeEndpoints = new Set((Array.isArray(evidence?.routeEndpoints) ? evidence.routeEndpoints : []).map(endpointKey));
  if (!routeEndpoints.size) need('ROUTE_ENTRY_ENDPOINT_REQUIRED');
  const runs = Array.isArray(evidence?.runs) ? evidence.runs : [];
  for (const scenario of SCENARIOS) {
    const matching = runs.filter(run => run.scenario === scenario);
    if (matching.length !== 1) { need('ONE_SCENARIO_RUN_REQUIRED', scenario); continue; }
    const run = matching[0], capture = run.capture;
    if (!run.runID || !run.window || !(run.window.end > run.window.start)) { need('BOUNDED_RUN_REQUIRED', scenario); continue; }
    if (!capture?.available) need('CLIENT_CAPTURE_MISSING', scenario);
    if (capture?.scope !== 'client-process-tree+synthetic-dns') need('SCOPED_CAPTURE_REQUIRED', scenario);
    if (!Array.isArray(capture?.roles) || !['ui', 'network', 'webcontent', 'route', 'resolver'].every(role => capture.roles.includes(role))) need('WEBKIT_AUXILIARY_SCOPE_MISSING', scenario);
    if (!Array.isArray(capture?.coverage) || !COVERAGE.every(protocol => capture.coverage.includes(protocol))) need('PROTOCOL_CAPTURE_COVERAGE_MISSING', scenario);
    if (capture?.dropped !== 0 || !Number.isFinite(capture?.start) || !Number.isFinite(capture?.end) || capture.start > run.window.start || capture.end < run.window.end) need('CAPTURE_WINDOW_OR_LOSS_UNKNOWN', scenario);
    if (!capture?.artifactSHA256 || !/^[a-f0-9]{64}$/.test(capture.artifactSHA256)) need('RAW_CAPTURE_BINDING_REQUIRED', scenario);
    if (!run.targetObserver?.available || !run.targetObserver?.complete) need('CONTROLLED_TARGET_OBSERVER_MISSING', scenario);
    const events = Array.isArray(run.events) ? run.events : [];
    if (!events.length) need('EVENTS_MISSING', scenario);
    const ids = new Set(); let previousTime = -Infinity;
    for (const event of events) {
      if (event.runID !== run.runID || !Number.isFinite(event.at) || !Number.isSafeInteger(event.sequence) || event.at < previousTime || event.at < run.window.start || event.at > run.window.end || ids.has(event.sequence)) { fail('TRACE_ORDER_OR_RUN_BINDING_INVALID', scenario); continue; }
      previousTime = event.at; ids.add(event.sequence);
      // Refuse non-synthetic browsing input rather than echoing it into a report.
      if (event.hostname && (!synthetic(event.hostname) || !domains.has(event.hostname))) fail('NON_SYNTHETIC_EVENT_REJECTED', scenario);
      if (['flow', 'dns', 'receipt'].includes(event.kind) && !['ui', 'network', 'webcontent', 'resolver', 'route', 'target'].includes(event.actor)) need('TRAFFIC_ACTOR_UNATTRIBUTED', scenario);
      if (event.kind === 'flow' && CLIENT_ROLES.has(event.actor)) {
        if (!routeEndpoints.has(endpointKey(event.destination))) fail('CLIENT_BYPASSED_ROUTE_ENTRY', scenario);
      }
      if (event.kind === 'dns' && CLIENT_ROLES.has(event.actor) && !routeEndpoints.has(endpointKey(event.destination))) fail('CLIENT_DNS_OUTSIDE_ROUTE', scenario);
      if (event.kind === 'ice' && ['host', 'srflx', 'prflx'].includes(event.candidateType) && ['ipv4', 'ipv6'].includes(event.addressFamily)) fail('WEBRTC_ADDRESS_EXPOSED', scenario);
    }
    const probes = events.filter(event => event.kind === 'probe');
    for (const protocol of PROTOCOLS) {
      if (!probes.some(probe => probe.protocol === protocol && probe.probeID)) need('PROBE_NOT_EXERCISED_' + protocol.toUpperCase(), scenario);
    }
    if (scenario === 'baseline') {
      for (const protocol of ['https', 'wss', 'download']) {
        const probeIDs = new Set(probes.filter(probe => probe.protocol === protocol).map(probe => probe.probeID));
        if (!events.some(event => event.kind === 'receipt' && event.actor === 'target' && event.protocol === protocol && probeIDs.has(event.probeID))) need('ROUTED_TARGET_RECEIPT_MISSING_' + protocol.toUpperCase(), scenario);
        if (!events.some(event => event.kind === 'flow' && event.actor === 'route' && event.protocol === protocol && probeIDs.has(event.probeID))) need('ROUTE_TO_TARGET_CORRELATION_MISSING_' + protocol.toUpperCase(), scenario);
      }
    } else {
      const faults = events.filter(event => event.kind === 'fault' && event.fault === scenario);
      if (faults.length !== 1) { need('ONE_FAULT_MARKER_REQUIRED', scenario); continue; }
      const fault = faults[0];
      const blocked = events.find(event => event.kind === 'state' && event.state === 'blocked' && event.at >= fault.at);
      if (!blocked) fail('FAULT_DID_NOT_RETURN_BLOCKED', scenario);
      const firstProbe = probes.find(probe => probe.at >= fault.at);
      if (blocked && firstProbe && firstProbe.at < blocked.at) fail('POST_FAULT_PROBE_PRECEDES_BLOCKED_READBACK', scenario);
      if (run.window.end - fault.at < Math.max(5000, Number(evidence.minimumFaultWindowMs) || 5000)) need('FAULT_OBSERVATION_TOO_SHORT', scenario);
      for (const protocol of PROTOCOLS) {
        if (!probes.some(probe => probe.protocol === protocol && probe.at >= fault.at && probe.decision === 'blocked')) need('POST_FAULT_BLOCKED_PROBE_MISSING_' + protocol.toUpperCase(), scenario);
      }
      const postFaultIDs = new Set(probes.filter(probe => probe.at >= fault.at).map(probe => probe.probeID));
      for (const event of events) {
        if (postFaultIDs.has(event.probeID) && event.kind === 'receipt' && event.actor === 'target') fail('TARGET_REACHED_AFTER_FAULT', scenario);
        if (postFaultIDs.has(event.probeID) && event.kind === 'flow') fail('POST_FAULT_PROBE_DISPATCHED', scenario);
        if (event.kind === 'receipt' && event.actor === 'target' && event.at >= fault.at && !event.probeID) need('POST_FAULT_TARGET_RECEIPT_UNATTRIBUTED', scenario);
        if (event.kind === 'state' && event.at >= fault.at && ['direct', 'ready'].includes(event.state)) fail('FAULT_SILENTLY_REOPENED_ROUTE', scenario);
      }
    }
  }
  const analysisVerdict = failures.length ? 'FAIL' : missing.length ? 'INCOMPLETE' : 'PASS';
  // Normalized app/server logs are not independently decoded client packet capture.
  // C has not been authorized to install a collector or perform privileged capture.
  // No caller-supplied Boolean can upgrade these logs into a route acceptance PASS.
  const targetVerdict = analysisVerdict === 'FAIL' ? 'FAIL' : evidence?.evidenceClass === 'target' ? 'INCOMPLETE' : 'NOT_RUN';
  const targetGaps = evidence?.evidenceClass === 'target' ? ['INDEPENDENT_CLIENT_CAPTURE_ADAPTER_NOT_SUPPLIED', ...(evidence?.platformAdmission?.admitted === true ? [] : ['ROUTED_PLATFORM_ISOLATION_NOT_ADMITTED'])] : ['FIXTURE_OR_LOCAL_ENDPOINTS_ARE_NOT_BROWSER_ROUTE_ACCEPTANCE'];
  return { schema: 'YNX_SYNTHETIC_LEAK_VERDICT_V1', mode: ['tor', 'nym'].includes(evidence?.mode) ? evidence.mode : null, evidenceClass: ['fixture', 'isolated', 'target'].includes(evidence?.evidenceClass) ? evidence.evidenceClass : null, analysisVerdict, targetVerdict, failures, missing, targetGaps, opensRouteMode: false };
}
