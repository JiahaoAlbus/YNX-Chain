import https from 'node:https';
import dgram from 'node:dgram';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const listen = (server, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, () => { server.off('error', reject); resolve(server.address()); }); });
const bind = (socket, host) => new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, host, () => { socket.off('error', reject); resolve(socket.address()); }); });

export function dnsQuestion(packet) {
  if (packet.length < 17 || packet.readUInt16BE(4) !== 1) return null;
  const labels = []; let offset = 12;
  while (offset < packet.length) {
    const length = packet[offset++];
    if (!length) {
      if (!labels.length || offset + 4 > packet.length) return null;
      return { name: labels.join('.').toLowerCase(), type: packet.readUInt16BE(offset), end: offset + 4 };
    }
    if (length > 63 || offset + length > packet.length || offset + length >= 12 + 255) return null;
    const label = packet.subarray(offset, offset + length);
    if (!/^[a-z0-9-]+$/i.test(label.toString('latin1'))) return null;
    labels.push(label.toString('ascii')); offset += length;
  }
  return null;
}

function isDNSQuery(packet, question) {
  // Only standard, complete IN questions. RD, AD and CD are valid query flags.
  if ((packet.readUInt16BE(2) & ~0x0130) !== 0 || packet.readUInt16BE(6) !== 0 ||
      packet.readUInt16BE(8) !== 0 || packet.readUInt16BE(question.end - 2) !== 1 ||
      question.type === 0) return false;
  const additional = packet.readUInt16BE(10);
  if (additional === 0) return question.end === packet.length;
  const offset = question.end;
  // A resolver may send one EDNS0 OPT record. The target never acts on its options.
  if (additional !== 1 || offset + 11 > packet.length || packet[offset] !== 0 ||
      packet.readUInt16BE(offset + 1) !== 41 || packet.readUInt16BE(offset + 5) !== 0) return false;
  const end = offset + 11 + packet.readUInt16BE(offset + 9);
  if (end !== packet.length) return false;
  for (let option = offset + 11; option < end;) {
    if (option + 4 > end) return false;
    option += 4 + packet.readUInt16BE(option + 2);
    if (option > end) return false;
  }
  return true;
}

function dnsReply(packet, question) {
  const response = Buffer.from(packet.subarray(0, question.end));
  response.writeUInt16BE(0x8400, 2); response.writeUInt16BE(0, 6); response.writeUInt16BE(0, 8); response.writeUInt16BE(0, 10);
  let address;
  if (question.type === 1) address = Buffer.from([127, 0, 0, 1]);
  if (question.type === 28) { address = Buffer.alloc(16); address[15] = 1; }
  if (!address) return response;
  response.writeUInt16BE(1, 6);
  const answer = Buffer.alloc(12 + address.length); answer.writeUInt16BE(0xc00c, 0); answer.writeUInt16BE(question.type, 2); answer.writeUInt16BE(1, 4); answer.writeUInt16BE(address.length, 10); address.copy(answer, 12);
  return Buffer.concat([response, answer]);
}

export function stunBindingResponse(packet, peer) {
  if (packet.length < 20 || packet.readUInt16BE(0) !== 1 || packet.readUInt32BE(4) !== 0x2112a442 || packet.readUInt16BE(2) + 20 !== packet.length) return null;
  if (packet.length % 4 !== 0) return null;
  for (let offset = 20; offset < packet.length;) {
    if (offset + 4 > packet.length) return null;
    const length = packet.readUInt16BE(offset + 2);
    offset += 4 + Math.ceil(length / 4) * 4;
    if (offset > packet.length) return null;
  }
  if (peer.family === 'IPv6' && peer.address === '::1') {
    const response = Buffer.alloc(44); response.writeUInt16BE(0x0101, 0); response.writeUInt16BE(24, 2); response.writeUInt32BE(0x2112a442, 4); packet.copy(response, 8, 8, 20);
    response.writeUInt16BE(0x0020, 20); response.writeUInt16BE(20, 22); response[25] = 2; response.writeUInt16BE(peer.port ^ 0x2112, 26);
    const mask = Buffer.concat([packet.subarray(4, 8), packet.subarray(8, 20)]), address = Buffer.alloc(16); address[15] = 1;
    address.forEach((value, index) => { response[28 + index] = value ^ mask[index]; });
    return response;
  }
  if (peer.family !== 'IPv4') return null;
  const address = peer.address.split('.').map(Number);
  if (address.length !== 4 || address.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  const response = Buffer.alloc(32); response.writeUInt16BE(0x0101, 0); response.writeUInt16BE(12, 2); response.writeUInt32BE(0x2112a442, 4); packet.copy(response, 8, 8, 20);
  response.writeUInt16BE(0x0020, 20); response.writeUInt16BE(8, 22); response[25] = 1; response.writeUInt16BE(peer.port ^ 0x2112, 26);
  address.forEach((value, index) => { response[28 + index] = value ^ [0x21, 0x12, 0xa4, 0x42][index]; });
  return response;
}

export async function startSyntheticEndpoints({ tls, runID = randomBytes(8).toString('hex') } = {}) {
  if (!tls?.key || !tls?.cert || !/^[a-z0-9-]{1,40}$/.test(runID)) throw new Error('Ephemeral test TLS and a synthetic run ID are required');
  const hostname = `${runID}.leak.test`, records = [], resources = [], sockets = new Set();
  let sequence = 0;
  const record = event => records.push({ sequence: ++sequence, at: Date.now(), runID, ...event });
  const payload = Buffer.from(`YNX synthetic download ${runID}\n`, 'utf8');
  const server = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, async (request, response) => {
    let url;
    try { url = new URL(request.url, `https://${hostname}`); } catch { response.writeHead(400).end(); return; }
    // Only this run's synthetic Host is accepted. No proxying or arbitrary URL fetch is implemented.
    if ((request.headers.host ?? '').split(':')[0] !== hostname) { response.writeHead(421).end(); return; }
    const probeID = url.searchParams.get('probe') ?? 'fixture';
    if (!/^[a-z0-9-]{1,80}$/.test(probeID)) { response.writeHead(400).end(); return; }
    const headers = { 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' wss:; object-src 'none'; frame-src 'none'" };
    if (url.pathname === '/probe') {
      const page = (await readFile(new URL('./fixtures/probe.html', import.meta.url), 'utf8')).replaceAll('__RUN_ID__', runID).replaceAll('__STUN_PORT__', String(stunAddress.port));
      record({ kind: 'receipt', actor: 'target', protocol: 'https', hostname, probeID });
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' }).end(page); return;
    }
    if (url.pathname === '/download') {
      record({ kind: 'receipt', actor: 'target', protocol: 'download', hostname, probeID, bytes: payload.length });
      response.writeHead(200, { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="synthetic-route-test.txt"' }).end(payload); return;
    }
    if (url.pathname === '/https') {
      record({ kind: 'receipt', actor: 'target', protocol: 'https', hostname, probeID });
      response.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify({ runID, probeID, synthetic: true })); return;
    }
    response.writeHead(404, headers).end();
  });
  const trackConnection = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); record({ kind: 'tcp-accepted', actor: 'target', protocol: 'tcp', hostname, peerPort: socket.remotePort, localPort: socket.localPort, addressFamily: socket.remoteFamily === 'IPv6' ? 'ipv6' : 'ipv4' }); };
  server.on('connection', trackConnection);
  server.on('tlsClientError', error => record({ kind: 'tls-client-error', actor: 'target', protocol: 'tls', hostname, code: error.code ?? 'UNKNOWN' }));
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, `https://${hostname}`), key = request.headers['sec-websocket-key'];
    const probeID = url.searchParams.get('probe') ?? 'fixture';
    if ((request.headers.host ?? '').split(':')[0] !== hostname || url.pathname !== '/wss' || typeof key !== 'string' || !/^[a-z0-9-]{1,80}$/.test(probeID)) { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    record({ kind: 'receipt', actor: 'target', protocol: 'wss', hostname, probeID });
    const message = Buffer.from(`synthetic:${runID}`); socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
    socket.on('data', data => { if ((data[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0])); });
  });
  const dns = dgram.createSocket('udp4'), stun = dgram.createSocket('udp4');
  const handleDNS = socket => (packet, peer) => {
    const question = dnsQuestion(packet);
    if (!question || question.name !== hostname || !isDNSQuery(packet, question)) return;
    const local = socket.address();
    record({ kind: 'dns', actor: 'target', protocol: 'dns', hostname, queryType: question.type, peerPort: peer.port,
      targetHost: local.address, targetPort: local.port, transactionID: packet.readUInt16BE(0), addressFamily: peer.family === 'IPv6' ? 'ipv6' : 'ipv4' });
    socket.send(dnsReply(packet, question), peer.port, peer.address);
  };
  const handleSTUN = socket => (packet, peer) => {
    const reply = stunBindingResponse(packet, peer); if (!reply) return;
    const local = socket.address();
    record({ kind: 'receipt', actor: 'target', protocol: 'stun', hostname, peerPort: peer.port, targetHost: local.address, targetPort: local.port, transactionID: packet.subarray(8, 20).toString('hex'), addressFamily: peer.family === 'IPv6' ? 'ipv6' : 'ipv4' });
    socket.send(reply, peer.port, peer.address);
  };
  dns.on('message', handleDNS(dns)); stun.on('message', handleSTUN(stun));
  resources.push(server, dns, stun);
  let tlsAddress, dnsAddress, stunAddress;
  try {
    dnsAddress = await bind(dns, '127.0.0.1'); stunAddress = await bind(stun, '127.0.0.1'); tlsAddress = await listen(server, '127.0.0.1');
    let ipv6 = { status: 'UNAVAILABLE_NOT_COVERED' };
    const dns6 = dgram.createSocket('udp6'), stun6 = dgram.createSocket('udp6');
    const server6 = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, server.listeners('request')[0]);
    server6.on('connection', trackConnection);
    server6.on('tlsClientError', server.listeners('tlsClientError')[0]);
    server6.on('upgrade', server.listeners('upgrade')[0]);
    dns6.on('message', handleDNS(dns6)); stun6.on('message', handleSTUN(stun6));
    try {
      const dns6Address = await bind(dns6, '::1'), stun6Address = await bind(stun6, '::1'), tls6Address = await listen(server6, '::1');
      resources.push(server6, dns6, stun6);
      ipv6 = { status: 'LISTENING', https: { host: '::1', port: tls6Address.port }, dns: { host: '::1', port: dns6Address.port }, stun: { host: '::1', port: stun6Address.port } };
    } catch { for (const resource of [server6, dns6, stun6]) { try { resource.close(); } catch {} } }
    return {
      manifest: { schema: 'YNX_SYNTHETIC_ENDPOINTS_V1', evidenceClass: 'isolated', runID, hostname, https: { host: '127.0.0.1', port: tlsAddress.port }, dns: { host: '127.0.0.1', port: dnsAddress.port }, stun: { host: '127.0.0.1', port: stunAddress.port }, ipv6, webRTC: 'PAGE_PROBE_SUPPLIED_NOT_EXECUTED', targetAcceptance: 'NOT_RUN', payloadSHA256: createHash('sha256').update(payload).digest('hex') },
      records,
      close: async () => { for (const socket of sockets) socket.destroy(); await Promise.all(resources.map(resource => new Promise(resolve => resource.close(resolve)))); }
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    for (const resource of resources) { try { resource.close(); } catch {} }
    throw error;
  }
}
