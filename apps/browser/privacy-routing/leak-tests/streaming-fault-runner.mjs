import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, fstatSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, unlink, writeFile, stat } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { createTemporaryTLS } from './temporary-tls.mjs';
import { collectOwnedSnapshot } from './scoped-collector.mjs';
import { startSyntheticEndpoints } from './synthetic-endpoints.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const pause = ms => new Promise(resolve_ => setTimeout(resolve_, ms));
async function bounded(predicate, message, milliseconds = 4000) { const end = Date.now() + milliseconds; while (!predicate() && Date.now() < end) await pause(10); if (!predicate()) throw new Error(message); }
function messages(child, kind, nonce) { return new Promise((resolve_, reject) => { const timer = setTimeout(() => { cleanup(); reject(new Error('Owned route IPC timeout')); }, 3000); const listener = value => { if (value.kind !== kind || (nonce && value.nonce !== nonce)) return; cleanup(); resolve_(value); }; function cleanup() { clearTimeout(timer); child.off('message', listener); } child.on('message', listener); }); }
async function target({ temporary, runID }) {
  const hostname = runID + '.leak.test', records = [], sockets = new Set(), chunk = Buffer.alloc(65536, 0x53), chunks = 128, length = chunk.length * chunks;
  Buffer.from(`P05 synthetic stream ${runID}\n`).copy(chunk);
  const fullSHA256 = hash(Buffer.concat(Array(chunks).fill(chunk))), proof = Buffer.from(JSON.stringify({ runID, generated: true }));
  const server = https.createServer({ key: temporary.key, cert: temporary.cert }, (request, response) => {
    if (request.headers.host !== hostname) { response.writeHead(421).end(); return; }
    const url = new URL(request.url, 'https://' + hostname), probeID = url.searchParams.get('probe');
    if (!/^[a-z0-9-]{1,80}$/.test(probeID ?? '')) { response.writeHead(400).end(); return; }
    if (url.pathname === '/proof') { records.push({ kind: 'proof', at: Date.now(), probeID, sha256: hash(proof) }); response.writeHead(200, { 'content-type': 'application/json', 'content-length': proof.length }).end(proof); return; }
    if (url.pathname !== '/stream') { response.writeHead(404).end(); return; }
    const record = { kind: 'download', at: Date.now(), probeID, sentBytes: 0, completed: false }; records.push(record);
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': length, 'content-disposition': 'attachment; filename="synthetic-stream.bin"' });
    const timer = setInterval(() => { response.write(chunk); record.sentBytes += chunk.length; if (record.sentBytes === length) { clearInterval(timer); record.completed = true; response.end(); } }, 20);
    response.once('close', () => clearInterval(timer));
  });
  server.on('connection', socket => { sockets.add(socket); const record = { kind: 'tcp', at: Date.now(), peerPort: socket.remotePort, localPort: socket.localPort, family: socket.remoteFamily }; records.push(record); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, 'https://' + hostname), key = request.headers['sec-websocket-key'];
    if (request.headers.host !== hostname || url.pathname !== '/wss' || typeof key !== 'string') { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let index = 0; const record = { kind: 'wss', at: Date.now(), probeID: url.searchParams.get('probe'), messages: [] }; records.push(record);
    const timer = setInterval(() => { const bytes = Buffer.from(`${runID}:${++index}`); record.messages.push(hash(bytes)); socket.write(Buffer.concat([Buffer.from([0x81, bytes.length]), bytes])); }, 20);
    socket.on('error', () => {}); socket.once('close', () => clearInterval(timer));
  });
  const address = await new Promise((resolve_, reject) => { server.once('error', reject); server.listen(0, '::1', () => resolve_(server.address())); });
  return { runID, hostname, endpoint: { host: '::1', port: address.port, transport: 'tcp' }, records, length, fullSHA256, proofSHA256: hash(proof), close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve_ => server.close(resolve_)); } };
}
async function routeTLS(endpoint, target_, ca) {
  const socket = net.connect(endpoint.port, endpoint.host); await once(socket, 'connect');
  const greeting = once(socket, 'data'); socket.write(Buffer.from([5, 1, 0])); const [reply] = await greeting;
  if (!reply.equals(Buffer.from([5, 0]))) { socket.destroy(); throw new Error('SOCKS authentication denied'); }
  const host = Buffer.from(target_.hostname), request = Buffer.alloc(7 + host.length); request.set([5, 1, 0, 3, host.length]); host.copy(request, 5); request.writeUInt16BE(target_.endpoint.port, request.length - 2);
  const connected = once(socket, 'data'); socket.write(request); const [result] = await connected;
  if (result[1] !== 0) { socket.destroy(); throw new Error('SOCKS CONNECT denied'); }
  const secure = tls.connect({ socket, servername: target_.hostname, ca }); secure.on('error', () => {}); await once(secure, 'secureConnect'); return secure;
}
function httpOver(socket, target_, path) {
  const agent = new https.Agent({ keepAlive: false }); agent.createConnection = () => socket;
  const request = https.get({ hostname: target_.hostname, path, headers: { host: target_.hostname }, agent });
  return { request, agent };
}
async function proof(socket, target_, probeID) { const { request, agent } = httpOver(socket, target_, '/proof?probe=' + probeID); return await new Promise((resolve_, reject) => { request.once('error', reject); request.once('response', response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.once('end', () => { agent.destroy(); resolve_({ status: response.statusCode, sha256: hash(Buffer.concat(chunks)) }); }); }); }); }
export async function download(socket, target_, directory, probeID) {
  const staging = join(directory, probeID + '.partial'), final = join(directory, probeID + '.bin');
  const { request, agent } = httpOver(socket, target_, '/stream?probe=' + probeID);
  const output = createWriteStream(staging, { flags: 'wx', mode: 0o600 });
  const observed = { probeID, bytes: 0, completed: false, committed: false, staging, final, stagingRetirement: 'NOT_OPENED' };
  const outputClosed = new Promise(resolve => output.once('close', resolve));
  const outputFinished = finished(output, { cleanup: true }).catch(failure => failure.code ?? failure.message);
  const done = new Promise(resolve_ => {
    let ended = false, stagingIdentity;
    const digest = createHash('sha256');
    output.once('open', fd => {
      observed.stagingRetirement = 'PENDING';
      try { stagingIdentity = fstatSync(fd, { bigint: true }); }
      catch (failure) { void finish(failure.code ?? failure.message); }
    });
    async function requireOwnedStaging() {
      const current = await lstat(staging, { bigint: true });
      if (!stagingIdentity || !current.isFile() || current.dev !== stagingIdentity.dev || current.ino !== stagingIdentity.ino) {
        throw Object.assign(new Error('Staging path no longer identifies the opened file'), { code: 'STAGING_IDENTITY_CHANGED' });
      }
    }
    async function finish(error) {
      if (ended) return;
      ended = true; observed.error = error;
      output.end(); agent.destroy();
      observed.error ??= await outputFinished;
      await outputClosed;
      observed.sha256 = digest.digest('hex');
      if (!observed.error && stagingIdentity && observed.status === 200 && observed.bytes === target_.length && observed.sha256 === target_.fullSHA256) {
        try {
          await requireOwnedStaging();
          await rename(staging, final);
          observed.completed = true; observed.committed = true; observed.stagingRetirement = 'PROMOTED';
        } catch (failure) { observed.error = failure.code ?? failure.message; }
      }
      if (observed.stagingRetirement === 'PENDING') {
        try {
          await requireOwnedStaging();
          await unlink(staging);
          observed.stagingRetirement = 'REMOVED';
        }
        catch (failure) {
          if (failure.code === 'ENOENT') observed.stagingRetirement = 'ABSENT';
          else { observed.stagingRetirement = 'UNKNOWN'; observed.cleanupError = failure.code ?? failure.message; }
        }
      }
      resolve_(observed);
    }
    output.on('error', error => finish(error.code ?? error.message)); request.on('error', error => finish(error.code ?? error.message));
    request.on('response', response => {
      observed.status = response.statusCode;
      response.on('data', chunk => {
        if (ended) return;
        observed.bytes += chunk.length; digest.update(chunk); output.write(chunk);
      });
      response.on('aborted', () => finish('ABORTED'));
      response.on('error', error => finish(error.code ?? error.message));
      response.on('end', () => finish());
    });
  });
  return { observed, done };
}
export function websocket(socket, target_) {
  const key = randomBytes(16).toString('base64'), expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const observed = { opened: false, messageHashes: [], closed: false, truncatedFrameAtClose: false }; let pending = Buffer.alloc(0);
  const fail = reason => { observed.error ??= reason; socket.destroy(); };
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!observed.opened) {
      const at = pending.indexOf('\r\n\r\n');
      if (at < 0) { if (pending.length > 8192) fail('INVALID_HANDSHAKE'); return; }
      const [status, ...headers] = pending.subarray(0, at).toString('ascii').split('\r\n');
      const accept = headers.filter(header => /^Sec-WebSocket-Accept:/i.test(header));
      if (at > 8192 || !/^HTTP\/1\.1 101(?: |$)/.test(status) || accept.length !== 1 ||
          accept[0].slice(accept[0].indexOf(':') + 1).trim() !== expected ||
          !headers.some(header => /^Upgrade:\s*websocket\s*$/i.test(header)) ||
          !headers.some(header => /^Connection:/i.test(header) && header.slice(header.indexOf(':') + 1)
            .split(',').some(token => token.trim().toLowerCase() === 'upgrade'))) { fail('INVALID_HANDSHAKE'); return; }
      observed.opened = true; pending = pending.subarray(at + 4);
    }
    while (pending.length >= 2) {
      const opcode = pending[0] & 0x0f, length = pending[1] & 0x7f;
      // This controlled server emits only short single-frame text messages. A
      // valid Pong or Close frame is never an application data message.
      if ((pending[0] & 0xf0) !== 0x80 || (pending[1] & 0x80) || length > 125 ||
          ![1, 8, 10].includes(opcode) || (opcode === 8 && length === 1)) { fail('INVALID_FIXTURE_FRAME'); return; }
      if (pending.length < length + 2) return;
      if (opcode === 1) observed.messageHashes.push(hash(pending.subarray(2, length + 2)));
      pending = pending.subarray(length + 2);
      if (opcode === 8) { socket.end(); return; }
    }
  });
  socket.once('close', () => { observed.closed = true; observed.truncatedFrameAtClose = observed.opened && pending.length > 0; });
  socket.once('error', error => { observed.transportError = error.code ?? error.message; });
  socket.write(`GET /wss?probe=baseline-wss HTTP/1.1\r\nHost: ${target_.hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`); return observed;
}

// Start observing before the signal. The independent receiver supplies only this
// generated run's UDP traffic, never general DNS or process attribution.
export function beginStreamingCutoffObservation(targetRecords, udpTarget) {
  const targetCursor = targetRecords.length, udpCursor = udpTarget.records.length;
  const { manifest } = udpTarget;
  return () => ({
    postFaultTargetRecords: targetRecords.slice(targetCursor),
    ownedUDP: udpTarget.records.slice(udpCursor).filter(record => {
      if (record.runID !== manifest.runID || record.hostname !== manifest.hostname || record.actor !== 'target') return false;
      const scope = record.addressFamily === 'ipv4' ? manifest : record.addressFamily === 'ipv6' ? manifest.ipv6 : undefined;
      const endpoint = record.kind === 'dns' && record.protocol === 'dns' ? scope?.dns :
        record.kind === 'receipt' && record.protocol === 'stun' ? scope?.stun : undefined;
      return endpoint && record.targetHost === endpoint.host && record.targetPort === endpoint.port;
    }),
  });
}

export async function runStreamingFault({ outputDirectory }) {
  const runID = 'c-stream-' + randomBytes(6).toString('hex'), directory = join(outputDirectory, runID); await mkdir(directory, { mode: 0o700 });
  const temporary = await createTemporaryTLS(); let target_, udpTarget, child, childExit, cutoff; const sockets = [], downloads = [];
  const result = { schema: 'P05_SYNTHETIC_STREAM_FAULT_V1', runID, directory, evidenceClass: 'Node-only owned IPv6/TLS/WSS/stream pipeline; explicit temporary CA; NOT WebKit normal TLS or Tor/Nym', targetVerdict: 'INCOMPLETE', productionRouteAdmission: false };
  result.ownRoot = { pid: process.pid, executable: process.execPath, executableSHA256: hash(await readFile(process.execPath)), psName: basename(process.execPath), scope: 'This runner owns its exact PID and child handle; Node comm is basename, not a native package identity claim' };
  try {
    target_ = await target({ temporary, runID }); result.target = target_.endpoint;
    udpTarget = await startSyntheticEndpoints({ tls: temporary, runID });
    result.udpObserver = { dns: udpTarget.manifest.dns, stun: udpTarget.manifest.stun,
      ipv6: { status: udpTarget.manifest.ipv6.status, dns: udpTarget.manifest.ipv6.dns, stun: udpTarget.manifest.ipv6.stun },
      attribution: 'own-loopback-target-only; system and WebKit DNS are NOT_TESTED' };
    child = fork(fileURLToPath(new URL('./fixtures/stream-socks-process.mjs', import.meta.url)), [target_.hostname, String(target_.endpoint.port), '::1'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin' } });
    childExit = once(child, 'exit').then(([code, signal]) => ({ code, signal })); const ready = await messages(child, 'ready'); result.route = ready;
    const connect = async () => { const socket = await routeTLS(ready.endpoint, target_, temporary.ca); sockets.push(socket); return socket; };
    const routedProof = async probeID => proof(await connect(), target_, probeID);
    result.httpsProof = await routedProof('baseline-proof'); if (result.httpsProof.status !== 200 || result.httpsProof.sha256 !== target_.proofSHA256) throw new Error('Exact generated HTTPS body mismatch');
    const control = await download(await connect(), target_, directory, 'complete-control'); downloads.push(control.done);
    result.completeDownload = await control.done; if (!result.completeDownload.committed) throw new Error('Complete stream failed to commit');
    const ws = websocket(await connect(), target_); const partial = await download(await connect(), target_, directory, 'interrupted-download');
    downloads.push(partial.done);
    await bounded(() => ws.messageHashes.length >= 2 && partial.observed.bytes >= 131072, 'Long-lived WSS and streamed download not established');
    result.baselineSocketSnapshot = await collectOwnedSnapshot({ rootPID: process.pid, expectedExecutable: basename(process.execPath), routeEndpoints: [ready.endpoint], syntheticTargets: [target_.endpoint] });
    const nonce = randomBytes(8).toString('hex'), snapshot = messages(child, 'snapshot', nonce); child.send({ kind: 'snapshot', nonce }); result.routeRecords = (await snapshot).records;
    cutoff = beginStreamingCutoffObservation(target_.records, udpTarget);
    result.faultAt = Date.now(); child.kill('SIGKILL'); result.routeExit = await childExit;
    result.interruptedDownload = await partial.done; await bounded(() => ws.closed, 'WSS did not close after owned route SIGKILL'); result.wss = ws;
    result.wssBodiesMatch = ws.messageHashes.every((digest, index) => digest === hash(Buffer.from(`${runID}:${index + 1}`)));
    // Exercise the same complete HTTPS call used before the fault. Observe the
    // live target independently, before the intentional direct calibration.
    let unexpectedProof;
    try { unexpectedProof = await routedProof('after-fault-proof'); }
    catch (error) { result.afterFaultRouteError = error.code ?? error.message; }
    if (unexpectedProof) throw new Error('HTTPS unexpectedly succeeded after owned route exit');
    result.postFaultObservationMilliseconds = 1000;
    await pause(result.postFaultObservationMilliseconds);
    const observedCutoff = cutoff();
    cutoff = undefined; // The intentional negative below is outside this boundary.
    result.postFaultTargetRecords = observedCutoff.postFaultTargetRecords;
    result.postFaultOwnedUDP = observedCutoff.ownedUDP;
    result.unrequestedDirectReceipts = result.postFaultTargetRecords.filter(record => record.probeID === 'after-fault-proof').length;
    result.postFaultNewTargetTCP = result.postFaultTargetRecords.filter(record => record.kind === 'tcp').length;
    if (result.unrequestedDirectReceipts || result.postFaultNewTargetTCP || result.postFaultOwnedUDP.length) {
      result.targetVerdict = 'FAIL';
      throw new Error('New synthetic target arrival after cutoff');
    }
    if (result.interruptedDownload.committed || result.interruptedDownload.bytes >= target_.length) throw new Error('Interrupted stream falsely completed');
    try { await stat(result.interruptedDownload.final); throw new Error('Partial stream final filename exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!['REMOVED', 'ABSENT'].includes(result.interruptedDownload.stagingRetirement)) throw new Error('Interrupted staging retirement not confirmed');
    const negative = tls.connect({ host: '::1', port: target_.endpoint.port, servername: target_.hostname, ca: temporary.ca }); sockets.push(negative); negative.on('error', () => {}); await once(negative, 'secureConnect');
    result.intentionalIPv6DirectSnapshot = await collectOwnedSnapshot({ rootPID: process.pid, expectedExecutable: basename(process.execPath), routeEndpoints: [ready.endpoint], syntheticTargets: [target_.endpoint] });
    result.intentionalIPv6DirectProof = await proof(negative, target_, 'intentional-direct-negative');
    const directSocket = result.intentionalIPv6DirectSnapshot.sockets.some(socket => socket.pid === process.pid && socket.destinationClass === 'synthetic-target' && socket.remote?.host === '::1');
    result.intentionalIPv6DirectDetected = directSocket && target_.records.some(record => record.probeID === 'intentional-direct-negative') && result.intentionalIPv6DirectProof.sha256 === target_.proofSHA256;
    result.controlledStreamContract = result.routeExit.signal === 'SIGKILL' && ws.opened && !ws.error && result.wssBodiesMatch && ws.messageHashes.length >= 2 && result.interruptedDownload.bytes > 0 && !result.interruptedDownload.committed && result.afterFaultRouteError === 'ECONNREFUSED' && result.intentionalIPv6DirectDetected;
    if (!result.controlledStreamContract) throw new Error('Controlled stream/fault observer delta did not meet contract');
  } catch (error) { result.firstCause = error.stack; }
  finally {
    for (const socket of sockets) socket.destroy(); if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await childExit; }
    result.downloadRetirements = await Promise.all(downloads);
    if (cutoff) {
      const { postFaultTargetRecords, ownedUDP } = cutoff();
      result.postFaultTargetRecords = postFaultTargetRecords;
      result.postFaultOwnedUDP = ownedUDP;
      if (postFaultTargetRecords.some(record => record.kind === 'tcp') || ownedUDP.length) result.targetVerdict = 'FAIL';
    }
    if (target_) { result.targetRecords = [...target_.records]; await target_.close(); }
    if (udpTarget) await udpTarget.close();
    await temporary.cleanup(); result.ownedResourcesClosed = !result.downloadRetirements.some(value => value.stagingRetirement === 'UNKNOWN');
    await writeFile(join(directory, 'receipt.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runStreamingFault({ outputDirectory: process.argv[2] }).then(result => { process.stdout.write(JSON.stringify({ receipt: join(result.directory, 'receipt.json'), controlledStreamContract: result.controlledStreamContract, firstCause: result.firstCause, targetVerdict: result.targetVerdict }) + '\n'); process.exitCode = result.controlledStreamContract ? 2 : 1; });
