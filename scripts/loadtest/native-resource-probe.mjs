import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// One owned process group at a time. A failed monitor remains fatal to callers.
export function createNativeResourceProbe(command, { timeoutMs = 1500, maxBytes = 1024 * 1024 } = {}) {
  let pending;
  let cancel;
  let stopped = false;
  const records = [];
  function run(args) {
    if (stopped) return Promise.reject(Error('native resource probe stopped'));
    if (pending) return Promise.reject(Error('native resource probe overlap'));
    const started = performance.now();
    const record = { startedAt: new Date().toISOString(), pid: null, status: null, signal: null, error: null, stdout: '', stderr: '', exited: false, groupGone: false };
    records.push(record);
    const operation = new Promise((resolve, reject) => {
      let bytes = 0;
      const output = { stdout: [], stderr: [] };
      const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      record.pid = child.pid ?? null;
      const kill = () => {
        if (!child.pid) return;
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') record.error ??= error.message; }
      };
      cancel = () => { record.error ??= 'native resource probe cancelled'; kill(); };
      const timer = setTimeout(() => { record.error ??= 'native resource probe ETIMEDOUT'; kill(); }, timeoutMs);
      const capture = key => data => {
        bytes += data.length;
        if (bytes <= maxBytes) output[key].push(data);
        record[key] += data.subarray(0, Math.max(0, 65536 - Buffer.byteLength(record[key]))).toString('utf8');
        if (bytes > maxBytes) { record.error ??= 'native resource probe output limit'; kill(); }
      };
      child.stdout.on('data', capture('stdout'));
      child.stderr.on('data', capture('stderr'));
      child.on('error', error => { record.error ??= error.message; });
      child.on('close', (status, signal) => {
        clearTimeout(timer);
        record.status = status; record.signal = signal; record.exited = true;
        // Also retire a descendant if the probe parent exited unexpectedly.
        kill();
        if (!child.pid) record.groupGone = true;
        else try { process.kill(-child.pid, 0); }
        catch (error) { record.groupGone = error.code === 'ESRCH'; }
        record.elapsedMs = performance.now() - started;
        if (record.elapsedMs >= timeoutMs) record.error ??= 'native resource probe deadline exceeded';
        if (record.error || status !== 0 || signal || !record.groupGone) {
          reject(Error(`native resource probe failed: ${record.error ?? signal ?? status ?? 'group still present'}`));
        } else resolve({ ...record, stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') });
      });
    });
    pending = operation.finally(() => { pending = undefined; cancel = undefined; });
    return pending;
  }
  return {
    run, records,
    get busy() { return !!pending; },
    async stop() {
      stopped = true;
      cancel?.();
      try { await pending; } catch { /* original failure is retained in records */ }
    },
  };
}
