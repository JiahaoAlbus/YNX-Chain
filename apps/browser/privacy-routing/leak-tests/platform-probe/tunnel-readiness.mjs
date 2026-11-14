import https from 'node:https';
import { createHash } from 'node:crypto';

// URL allocation alone is not readiness. Keep retrying only the SAME approved processes/origins;
// this function never provisions another tunnel, accepts a redirect or disables TLS validation.
export async function readExactPublicProof(origin, manifest, timeoutMilliseconds = 5000) {
  if (!manifest.origins.includes(origin) || !manifest.paths.proof.startsWith(`/ynx-route-probe/${manifest.runID}/`) || !/^[a-f0-9]{64}$/.test(manifest.expectedSHA256.proof)) throw new Error('Exact approved nonce fixture required');
  return await new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const request = https.get(origin + manifest.paths.proof + '?probe=public-calibration', { timeout: timeoutMilliseconds }, response => {
      let length = 0; const chunks = [];
      response.on('data', chunk => { length += chunk.length; if (length > 16384) { response.destroy(); finish({ error: 'BODY_LIMIT' }); } else chunks.push(chunk); });
      response.on('error', error => finish({ error: error.code ?? error.message }));
      response.on('end', () => { const sha256 = createHash('sha256').update(Buffer.concat(chunks)).digest('hex'); finish({ status: response.statusCode, sha256, exactBody: response.statusCode === 200 && sha256 === manifest.expectedSHA256.proof }); });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Bounded public proof timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', error => finish({ error: error.code ?? error.message }));
  });
}

export async function waitForApprovedFixture({ tunnels, fixture, milliseconds = 240000, probe = readExactPublicProof, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  if (!Array.isArray(tunnels) || tunnels.length < 1 || tunnels.length > 2 || milliseconds < 1 || milliseconds > 240000) throw new Error('Only the original one/two approved tunnels and bounded readiness are allowed');
  const deadline = now() + milliseconds, attempts = [], ready = new Map(); let registeredOrigins;
  while (now() < deadline) {
    const origins = tunnels.map(tunnel => tunnel.origin);
    if (origins.every(Boolean) && !registeredOrigins) { fixture.registerPublicOrigins(origins); registeredOrigins = origins; }
    for (const tunnel of tunnels) {
      if (!tunnel.alive || !tunnel.registered || !tunnel.origin || ready.has(tunnel.origin)) continue;
      const result = await probe(tunnel.origin, fixture.manifest(), Math.min(5000, Math.max(1, deadline - now())));
      attempts.push({ at: now(), origin: tunnel.origin, ...result });
      if (result.exactBody) ready.set(tunnel.origin, result);
    }
    if (registeredOrigins && tunnels.every(tunnel => tunnel.alive && tunnel.registered && ready.has(tunnel.origin))) return { ready: true, origins: registeredOrigins, attempts, registered: true, normalTLS: true, exactBodyRequired: true };
    if (tunnels.some(tunnel => !tunnel.alive)) return { ready: false, origins: origins.filter(Boolean), attempts, firstCause: 'An original approved tunnel exited before registered + normal-TLS exact-body readiness', noReplacementProvisioned: true };
    await pause(Math.min(2000, Math.max(1, deadline - now())));
  }
  return { ready: false, origins: tunnels.map(tunnel => tunnel.origin).filter(Boolean), attempts, firstCause: 'Original approved tunnels did not establish registered + normal-TLS exact-body readiness before deadline', noReplacementProvisioned: true };
}
