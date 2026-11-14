import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessLeakSuite } from './trace-verdict.mjs';
import { createTemporaryTLS } from './temporary-tls.mjs';
import { startSyntheticEndpoints } from './synthetic-endpoints.mjs';

export async function assessFile(filename) {
  const bytes = await readFile(filename);
  const evidence = JSON.parse(bytes);
  const verdict = assessLeakSuite(evidence);
  return { ...verdict, inputSHA256: createHash('sha256').update(bytes).digest('hex') };
}

async function main(args) {
  if (args[0] === '--assess' && args[1]) {
    const verdict = await assessFile(args[1]);
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
    process.exitCode = verdict.targetVerdict === 'FAIL' ? 1 : verdict.targetVerdict === 'PASS' ? 0 : 2;
    return;
  }
  if (args[0] === '--serve' && args[1]) {
    // Explicit path receives public synthetic receipts only. Never emits TLS keys or installs trust.
    const output = resolve(args[1]);
    const tls = await createTemporaryTLS();
    let endpoints;
    try { endpoints = await startSyntheticEndpoints({ tls }); }
    catch (error) { await tls.cleanup(); throw error; }
    let closing = false;
    const close = async () => {
      if (closing) return; closing = true;
      await endpoints.close();
      await writeFile(output, JSON.stringify({ ...endpoints.manifest, records: endpoints.records }, null, 2) + '\n', { mode: 0o600 });
      await tls.cleanup();
    };
    process.once('SIGINT', () => { close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); });
    process.once('SIGTERM', () => { close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); });
    process.stdout.write(JSON.stringify(endpoints.manifest, null, 2) + '\n');
    return;
  }
  throw new Error('Usage: node runner.mjs --assess evidence.json | --serve /absolute/synthetic-receipts.json');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
