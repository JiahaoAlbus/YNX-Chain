import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { parseLsofFields } from '../scoped-collector.mjs';
const execute = promisify(execFile);

// The OS query is selected by the exact owned listener BEFORE output is consumed. No global
// WebKit-name search, whole-process socket dump, payload read or machine-wide DNS capture.
export async function attributeOwnedSocksConnection({ port, runID, socksRecords, identityTool, allowedHosts = [`${runID}.leak.test`], listenerPID = process.pid }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-z0-9-]{1,40}$/.test(runID) || !identityTool.startsWith('/')) throw new Error('Exact owned loopback listener/run and public identity helper required');
  const args = ['-nP', '-iTCP@127.0.0.1:' + port, '-F0pfPnT'];
  let stdout = '', stderr = '', exit = 0;
  try { ({ stdout, stderr } = await execute('/usr/sbin/lsof', args, { maxBuffer: 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; exit = error.code; }
  const pids = [...new Set([...stdout.matchAll(/(?:^|\0|\n)p(\d+)\0/g)].map(match => Number(match[1])))];
  const sockets = parseLsofFields(stdout, pids.map(pid => ({ pid, role: pid === listenerPID ? 'owned-fixture' : 'owned-listener-peer' })));
  const runRequests = socksRecords.filter(record => record.kind === 'connect-request' && allowedHosts.includes(record.hostname));
  const peers = runRequests.map(record => record.peerPort);
  const candidates = sockets.filter(socket => socket.pid !== listenerPID && socket.remote?.host === '127.0.0.1' && socket.remote.port === port && peers.includes(socket.local?.port));
  const identities = [];
  for (const pid of [...new Set(candidates.map(socket => socket.pid))]) {
    try {
      const identity = JSON.parse((await execute(identityTool, ['--pid', String(pid)], { maxBuffer: 64 * 1024 })).stdout);
      identities.push({ ...identity, exactOwnedSocketObserved: true, runBoundSocksRequestObserved: candidates.some(socket => socket.pid === pid && peers.includes(socket.local?.port)), appleWebKitCode: identity.identityStable && identity.signatureStatus === 0 && identity.appleAnchorStatus === 0 && /^com\.apple\.WebKit\./.test(identity.signingIdentifier), attributionLimit: 'Only this controlled 5-tuple; no claim that every flow of this XPC PID belongs to this UI' });
    } catch (error) { identities.push({ pid, error: (error.stderr ?? error.message).trim().slice(0, 256), exactOwnedSocketObserved: true }); }
  }
  return { schema: 'P05_OWNED_ENDPOINT_ATTRIBUTION_V1', runID, queriedEndpoint: { host: '127.0.0.1', port, transport: 'tcp' }, command: ['/usr/sbin/lsof', ...args], queryExit: exit, queryError: stderr.slice(0, 256), outputSHA256: createHash('sha256').update(stdout).digest('hex'), sockets, identities, kernelResponsibleAppAuditTokenObserved: false, allXPCFlowsClaimedOwned: false, targetVerdict: 'INCOMPLETE' };
}
