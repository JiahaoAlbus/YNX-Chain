import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const execute = promisify(execFile);

// Isolated, short-lived CA/server keys. Never installs trust or writes a key into the repo.
export async function createTemporaryTLS() {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-p05-leak-ca-'));
  await chmod(directory, 0o700);
  try {
    const caKey = join(directory, 'ca.key'), caCert = join(directory, 'ca.pem');
    const key = join(directory, 'server.key'), csr = join(directory, 'server.csr'), cert = join(directory, 'server.pem');
    const extension = join(directory, 'server.ext');
    await writeFile(extension, 'subjectAltName=DNS:*.leak.test,DNS:leak.test,IP:127.0.0.1,IP:::1\nextendedKeyUsage=serverAuth\n', { mode: 0o600 });
    await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=YNX isolated synthetic leak test CA', '-keyout', caKey, '-out', caCert]);
    await execute('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=leak.test', '-keyout', key, '-out', csr]);
    await execute('openssl', ['x509', '-req', '-in', csr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-days', '1', '-extfile', extension, '-out', cert]);
    return { key: await readFile(key), cert: await readFile(cert), ca: await readFile(caCert), cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
