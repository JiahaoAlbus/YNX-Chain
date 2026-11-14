import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Caller must possess the direct human authorization for this exact short-lived service/terms.
// A string/reference here records that decision; it never manufactures consent.
export async function startApprovedQuickTunnel({ cloudflared, emptyConfig, localPort, approvalReference, lifetimeSeconds = 300 }) {
  if (cloudflared !== '/opt/homebrew/bin/cloudflared' || !emptyConfig.startsWith('/') || !Number.isInteger(localPort) || localPort < 1024 || localPort > 65535 || !approvalReference || !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 300) throw new Error('Exact approved bounded Quick Tunnel configuration required');
  const args = ['-i', 'PATH=/usr/bin:/bin:/opt/homebrew/bin', cloudflared, 'tunnel', '--config', emptyConfig, '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${localPort}`];
  const startedAt = Date.now(), deadlineAt = startedAt + lifetimeSeconds * 1000;
  const child = spawn('/usr/bin/env', args, { stdio: ['ignore', 'pipe', 'pipe'] }), events = [];
  let origin, registered = false, stopPromise;
  const reader = () => { let pending = ''; return chunk => {
    pending += chunk.toString(); const lines = pending.split('\n'); pending = lines.pop().slice(-8192);
    for (const line of lines) {
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !match[0].includes('://api.') && !origin) { origin = match[0]; events.push({ at: Date.now(), kind: 'generated-public-origin', origin }); }
      if (line.includes('Registered tunnel connection')) { registered = true; events.push({ at: Date.now(), kind: 'registered-connection' }); }
      if (/ERR|error|failed/i.test(line)) events.push({ at: Date.now(), kind: 'client-error', detail: line.slice(0, 512) });
    }
  }; };
  child.stdout.on('data', reader()); child.stderr.on('data', reader());
  const exited = once(child, 'exit').then(([code, signal]) => { const result = { at: Date.now(), kind: 'exit', code, signal }; events.push(result); return result; }).catch(error => { const result = { at: Date.now(), kind: 'spawn-error', spawnError: error.code ?? error.message }; events.push(result); return result; });
  const stop = async () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const hard = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, Math.max(1, Math.min(2000, deadlineAt - Date.now())));
      try { return await exited; } finally { clearTimeout(hard); }
    })();
    return stopPromise;
  };
  const timer = setTimeout(stop, Math.max(1, deadlineAt - Date.now() - 2000));
  return { pid: child.pid, approvalReference, args: ['/usr/bin/env', ...args], startedAt, deadlineAt, events, get origin() { return origin; }, get registered() { return registered; }, get alive() { return child.exitCode === null && child.signalCode === null; }, stop };
}
