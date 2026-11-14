import net from 'node:net';

// A controlled SOCKSv5 test instrument, NOT Tor/Nym and never a general forwarding proxy.
export async function startScopedSocksFixture({ hostname, targetPort, refuseConnections = false, holdConnectMilliseconds = 0, publicFixture, allowSyntheticFrame = false }) {
  let allowedHosts = [hostname], upstreamHost = '127.0.0.1';
  if (publicFixture) {
    if (!/^[a-z0-9-]{1,40}$/.test(publicFixture.nonce) || !/^[a-f0-9]{64}$/.test(publicFixture.responseSHA256) || !Array.isArray(publicFixture.origins) || publicFixture.origins.length < 1 || publicFixture.origins.length > 2 || targetPort !== 443) throw new Error('Explicit owned public fixture origins/nonce/hash and TLS443 required');
    allowedHosts = publicFixture.origins.map(origin => { const url = new URL(origin); if (url.origin !== origin || url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com')) throw new Error('This public adapter is restricted to approved generated Quick Tunnel origins'); return url.hostname; });
    if (!allowedHosts.includes(hostname)) throw new Error('Primary hostname must be an explicit owned fixture origin'); upstreamHost = null;
  } else if (!/^[a-z0-9-]{1,40}\.leak\.test$/.test(hostname)) throw new Error('One run-bound synthetic hostname required');
  else if (allowSyntheticFrame) allowedHosts.push(`frame.${hostname}`);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('Exact target port required');
  if (!Number.isInteger(holdConnectMilliseconds) || holdConnectMilliseconds < 0 || holdConnectMilliseconds > 2000) throw new Error('Owned-connection hold must be bounded to 0...2000 ms');
  const sockets = new Set(), records = []; let sequence = 0;
  const record = value => records.push({ sequence: ++sequence, at: Date.now(), ...value });
  const keep = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); return socket; };
  const server = net.createServer(client => {
    keep(client); let pending = Buffer.alloc(0), stage = 'greeting';
    record({ kind: 'accepted', peerFamily: client.remoteFamily, peerPort: client.remotePort });
    function deny(reason, reply = 2) { record({ kind: 'rejected', reason }); client.end(Buffer.from([5, reply, 0, 1, 127, 0, 0, 1, 0, 0])); }
    client.on('data', function receive(data) {
      pending = Buffer.concat([pending, data]);
      if (pending.length > 8192) { deny('oversize-handshake'); return; }
      if (stage === 'greeting') {
        if (pending.length < 2) return;
        if (pending[0] !== 5) { client.destroy(); return; }
        const length = 2 + pending[1]; if (pending.length < length) return;
        if (!pending.subarray(2, length).includes(0)) { record({ kind: 'rejected', reason: 'no-supported-auth-method' }); client.end(Buffer.from([5, 255])); return; }
        pending = pending.subarray(length); stage = 'request'; client.write(Buffer.from([5, 0]));
      }
      if (stage !== 'request' || pending.length < 4) return;
      if (pending[0] !== 5 || pending[1] !== 1 || pending[2] !== 0) { deny('CONNECT-only', 7); return; }
      const addressType = pending[3]; let requestedHost, length;
      if (addressType === 3) {
        if (pending.length < 5) return;
        length = 7 + pending[4]; if (pending.length < length) return;
        requestedHost = pending.subarray(5, length - 2).toString('ascii').toLowerCase();
      } else if (addressType === 1) {
        length = 10; if (pending.length < length) return;
        requestedHost = [...pending.subarray(4, 8)].join('.');
      } else { deny('domain-or-explicit-loopback-IPv4-only', 8); return; }
      const port = pending.readUInt16BE(length - 2), remainder = pending.subarray(length);
      if (![...allowedHosts, ...(publicFixture ? [] : ['127.0.0.1'])].includes(requestedHost) || port !== targetPort) { deny('outside-exact-synthetic-target'); return; }
      record({ kind: 'connect-request', peerPort: client.remotePort, hostname: requestedHost, port, addressType: addressType === 3 ? 'domain' : 'ipv4', resolvesAtFixtureOnly: addressType === 3 });
      stage = 'connecting'; client.off('data', receive);
      if (refuseConnections) { deny('intentional-synthetic-route-refusal', 5); return; }
      const connectTarget = () => { if (client.destroyed) return; const upstream = keep(net.connect({ host: upstreamHost ?? requestedHost, port: targetPort }, () => {
        record({ kind: 'target-connected', hostname: requestedHost, port, upstreamSourcePort: upstream.localPort, upstreamHost: upstreamHost ?? requestedHost, routeClass: publicFixture ? 'restricted-fixture-transport-NOT-Tor-Nym' : 'loopback-fixture' });
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, (upstream.localPort >> 8) & 255, upstream.localPort & 255]));
        if (remainder.length) upstream.write(remainder);
        client.pipe(upstream); upstream.pipe(client);
      }));
      upstream.on('error', () => deny('owned-target-connect-failed', 5));
      client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
      };
      if (holdConnectMilliseconds) { const timer = setTimeout(connectTarget, holdConnectMilliseconds); client.once('close', () => clearTimeout(timer)); }
      else connectTarget();
    });
  });
  const address = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address()); }); });
  return { endpoint: { transport: 'tcp', host: '127.0.0.1', port: address.port }, records, refuseConnections, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
