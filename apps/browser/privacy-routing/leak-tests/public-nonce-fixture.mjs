import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function startPublicNonceFixture({ runID, nonce = randomBytes(16).toString('hex'), lifetimeSeconds = 300 } = {}) {
  if (!/^[a-z0-9-]{1,40}$/.test(runID) || !/^[a-f0-9]{32}$/.test(nonce) || !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 600) throw new Error('One public synthetic run/nonce and bounded 1...600 second lifetime required');
  const prefix = `/ynx-route-probe/${runID}`, records = [], sockets = new Set(), publicOrigins = new Set();
  const proof = Buffer.from(JSON.stringify({ schema: 'P05_PUBLIC_NONCE_PROOF_V1', runID, nonce: runID, contentNonce: nonce, content: 'Only generated public synthetic bytes. No user files or credentials.' }));
  const download = Buffer.from(`P05 public synthetic download\n${runID}\n${nonce}\n`), wss = Buffer.from(`p05-synthetic:${runID}:${nonce}`);
  let closed = false, sequence = 0;
  const record = value => records.push({ sequence: ++sequence, at: Date.now(), runID, originTransport: 'http-loopback; external TLS must be independently verified', ...value });
  const validHost = request => { const host = request.headers.host?.split(':')[0] ?? ''; return host === '127.0.0.1' || publicOrigins.has(`https://${host}`); };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!validHost(request) || !url.pathname.startsWith(prefix + '/')) { response.writeHead(404).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const probeID = url.searchParams.get('probe') ?? 'public-calibration';
    if (!/^[a-z0-9-]{1,80}$/.test(probeID)) { response.writeHead(400).end(); return; }
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (publicOrigins.has(request.headers.origin)) headers['access-control-allow-origin'] = request.headers.origin;
    let bytes, protocol;
    if (url.pathname === prefix + '/proof') { bytes = proof; protocol = 'https'; headers['content-type'] = 'application/json'; }
    else if (url.pathname === prefix + '/download') { bytes = download; protocol = 'download'; headers['content-type'] = 'application/octet-stream'; headers['content-disposition'] = 'attachment; filename="p05-public-synthetic.txt"'; }
    else { response.writeHead(404).end(); return; }
    record({ kind: 'receipt', protocol, probeID, bytes: bytes.length, sha256: hash(bytes) });
    response.writeHead(200, headers).end(request.method === 'HEAD' ? undefined : bytes);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, 'http://127.0.0.1'), key = request.headers['sec-websocket-key'], probeID = url.searchParams.get('probe') ?? 'public-calibration';
    if (!validHost(request) || url.pathname !== prefix + '/wss' || typeof key !== 'string' || !/^[a-z0-9-]{1,80}$/.test(probeID)) { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.concat([Buffer.from([0x81, wss.length]), wss]));
    record({ kind: 'receipt', protocol: 'wss', probeID, bytes: wss.length, sha256: hash(wss) });
    socket.on('error', () => {}); socket.on('data', data => { if ((data[0] & 15) === 8) socket.end(Buffer.from([0x88, 0])); });
  });
  const address = await new Promise((resolve_, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve_(server.address()); }); });
  const close = async () => { if (closed) return; closed = true; clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise(resolve_ => server.close(resolve_)); };
  const timer = setTimeout(close, lifetimeSeconds * 1000);
  return {
    endpoint: { host: '127.0.0.1', port: address.port, transport: 'tcp', pid: process.pid }, records, prefix,
    registerPublicOrigins(origins) {
      if (!Array.isArray(origins) || origins.length < 1 || origins.length > 2) throw new Error('One or two explicit published fixture origins required');
      for (const origin of origins) if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) throw new Error('Only an explicit official Quick Tunnel hostname may be registered by this adapter');
      publicOrigins.clear(); origins.forEach(origin => publicOrigins.add(origin));
    },
    manifest() { return { schema: 'P05_PUBLIC_NONCE_FIXTURE_V1', runID, nonce: runID, prefix, endpoint: { host: '127.0.0.1', port: address.port, transport: 'tcp', pid: process.pid }, originTransport: 'http-loopback; external TLS must be independently verified', origins: [...publicOrigins], paths: { proof: prefix + '/proof', download: prefix + '/download', wss: prefix + '/wss' }, expectedSHA256: { proof: hash(proof), download: hash(download), wss: hash(wss) }, publicFixture: { origins: [...publicOrigins], nonce: runID, responseSHA256: hash(proof), downloadSHA256: hash(download) }, lifetimeSeconds, exposesFilesystem: false, readsCredentials: false, tunnelStarted: false, targetVerdict: 'INCOMPLETE' }; },
    close
  };
}

async function main(args) {
  const directory = resolve(args[0] ?? ''), runID = args[1];
  if (!args[0]?.startsWith('/')) throw new Error('Absolute private receipt directory required');
  await mkdir(directory, { mode: 0o700 });
  const fixture = await startPublicNonceFixture({ runID });
  const manifestPath = join(directory, 'fixture-manifest.json'), registrationPath = join(directory, 'public-origin-registration.json');
  const emptyConfig = join(directory, 'empty-cloudflared.yml'); await writeFile(emptyConfig, '{}\n', { mode: 0o600, flag: 'wx' });
  await writeFile(manifestPath, JSON.stringify(fixture.manifest(), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const command = ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin:/opt/homebrew/bin', '/opt/homebrew/bin/cloudflared', 'tunnel', '--config', emptyConfig, '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${fixture.endpoint.port}`];
  await writeFile(join(directory, 'quick-tunnel-review.json'), JSON.stringify({ schema: 'P05_QUICK_TUNNEL_REVIEW_V1', command, localFixture: fixture.manifest(), termsURL: 'https://www.cloudflare.com/website-terms/', officialDocumentation: 'https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/', officialDisclaimerSource: 'https://github.com/cloudflare/cloudflared/blob/master/cmd/cloudflared/tunnel/quick_tunnel.go', humanTermsConsentRequired: true, executed: false, noAccountRequired: true, noServiceInstall: true, noUserFilesOrSecretsExposed: true, cleanup: 'Stop this exact cloudflared process and the bounded localhost fixture; no service is installed.' }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const interval = setInterval(async () => {
    try { const registration = JSON.parse(await readFile(registrationPath, 'utf8')); if (registration.runID !== runID) return; fixture.registerPublicOrigins(registration.origins); const temporary = manifestPath + '.next'; await writeFile(temporary, JSON.stringify(fixture.manifest(), null, 2) + '\n', { mode: 0o600 }); await rename(temporary, manifestPath); }
    catch (error) { if (error.code !== 'ENOENT') process.stderr.write('Fixture registration rejected; no external host admitted.\n'); }
  }, 500);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; clearInterval(interval); clearTimeout(stopTimer); await fixture.close(); await writeFile(join(directory, 'target-receipts.json'), JSON.stringify(fixture.records, null, 2) + '\n', { mode: 0o600 }); };
  const stopTimer = setTimeout(stop, 300000); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.stdout.write(JSON.stringify({ manifestPath, registrationPath, review: join(directory, 'quick-tunnel-review.json'), endpoint: fixture.endpoint, tunnelStarted: false }) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
