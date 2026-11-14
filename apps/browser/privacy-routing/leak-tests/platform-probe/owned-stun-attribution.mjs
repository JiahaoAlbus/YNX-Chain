import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { parseLsofFields } from '../scoped-collector.mjs';
const execute = promisify(execFile);

// Learn ports only from valid STUN transactions received by THIS run's owned loopback server.
// Select those UDP ports in lsof before consuming output. An unconnected UDP socket does not
// expose its destination, so this is explicitly correlation, never full audit-token attribution.
export async function correlateOwnedStunSenders({ runID, records, identityTool, ownedSocketPIDs = [] }) {
  const ports = [...new Set(records.filter(record => record.runID === runID && record.protocol === 'stun' && record.kind === 'receipt').map(record => record.peerPort))].filter(port => Number.isInteger(port) && port >= 1024 && port <= 65535);
  if (!/^[a-z0-9-]{1,40}$/.test(runID) || !identityTool?.startsWith('/')) throw new Error('Exact owned run/public identity helper required');
  if (!ownedSocketPIDs.length || !ownedSocketPIDs.every(pid => Number.isInteger(pid) && pid > 1)) return { runID, queries: [], identities: [], targetVerdict: 'INCOMPLETE', missing: 'A previously verified exact owned SOCKS peer process is required before selecting UDP FDs' };
  const queries = [], identities = [];
  for (const port of ports.slice(0, 16)) {
    const args = ['-nP', '-a', '-p', ownedSocketPIDs.join(','), '-iUDP:' + port, '-F0pfPnT']; let stdout = '', error, exit = 0;
    try { stdout = (await execute('/usr/sbin/lsof', args, { maxBuffer: 128 * 1024 })).stdout; }
    catch (failure) { stdout = failure.stdout ?? ''; exit = failure.code; error = (failure.stderr ?? '').slice(0, 256); }
    const pids = [...new Set([...stdout.matchAll(/(?:^|\0|\n)p(\d+)\0/g)].map(match => Number(match[1])))];
    const sockets = parseLsofFields(stdout, pids.map(pid => ({ pid, role: 'owned-STUN-source-port-correlation' }))).filter(socket => socket.protocol === 'udp' && socket.local?.port === port);
    queries.push({ port, command: ['/usr/sbin/lsof', ...args], exit, error, outputSHA256: createHash('sha256').update(stdout).digest('hex'), sockets });
    for (const pid of [...new Set(sockets.map(socket => socket.pid))]) {
      try { const identity = JSON.parse((await execute(identityTool, ['--pid', String(pid)], { maxBuffer: 64 * 1024 })).stdout); const exact = sockets.some(socket => socket.pid === pid && records.some(record => record.peerPort === port && record.targetHost === socket.remote?.host && record.targetPort === socket.remote?.port)); identities.push({ ...identity, observedSourcePort: port, exactControlledUDP5TupleObserved: exact, appleWebKitCode: identity.identityStable && identity.signatureStatus === 0 && identity.appleAnchorStatus === 0 && /^com\.apple\.WebKit\./.test(identity.signingIdentifier) }); }
      catch (failure) { identities.push({ pid, observedSourcePort: port, error: (failure.stderr ?? failure.message).slice(0, 256) }); }
    }
  }
  return { schema: 'P05_OWNED_STUN_PORT_CORRELATION_V2', runID, queries, identities, sourcePortCorrelationOnly: !identities.some(value => value.exactControlledUDP5TupleObserved), destinationFlowAuditTokenObserved: false, sharedXPCOwnershipClaimed: false, targetVerdict: 'INCOMPLETE', limits: ['Unconnected UDP without an exact connected tuple remains source-port correlation', 'Snapshots cannot substitute for kernel per-flow source-app/process audit tokens or complete capture', 'Only previously verified owned SOCKS-peer PIDs and received STUN-source ports are queried'] };
}
