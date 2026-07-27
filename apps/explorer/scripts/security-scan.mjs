import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const explorerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(explorerRoot, '../..');
const targets = [
  resolve(explorerRoot, 'src'),
  resolve(explorerRoot, 'server'),
  resolve(explorerRoot, 'public'),
  resolve(explorerRoot, 'index.html'),
  resolve(explorerRoot, 'scripts/real-service-smoke.mjs'),
  resolve(repositoryRoot, 'internal/explorer'),
  resolve(repositoryRoot, 'internal/indexer'),
  resolve(repositoryRoot, 'cmd/ynx-explorerd'),
  resolve(repositoryRoot, 'cmd/ynx-indexerd'),
  resolve(repositoryRoot, 'docs/integration'),
  resolve(repositoryRoot, 'release/integration'),
  resolve(repositoryRoot, 'product-release.json')
];

const textExtensions = new Set([
  '', '.css', '.go', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.webmanifest'
]);
const ignoredNames = new Set(['node_modules', 'dist', 'test-results', 'screenshots']);
const checks = [
  {
    name: 'embedded private key',
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/
  },
  {
    name: 'provider secret token',
    pattern: /(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]+)/
  },
  {
    name: 'deployment filler',
    pattern: /(?:example\.com|your_key_here|changeme|\bNYXT\b|fake\s+(?:TPS|TVL|user|balance|transaction|price|revenue|APY|liquidity|provider|health)|coming\s+soon)/i
  },
  {
    name: 'unfinished marker',
    pattern: /\b(?:TODO|FIXME)\b/
  }
];

async function collect(path) {
  const info = await stat(path);
  if (info.isFile()) return textExtensions.has(extname(path).toLowerCase()) ? [path] : [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter(entry => !ignoredNames.has(entry.name))
    .map(entry => collect(resolve(path, entry.name))));
  return nested.flat();
}

const files = (await Promise.all(targets.map(collect))).flat();
const findings = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const relative = file.slice(repositoryRoot.length + 1);
  for (const check of checks) {
    const match = check.pattern.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split('\n').length;
    findings.push(`${relative}:${line}: ${check.name}`);
  }
}

if (findings.length > 0) {
  console.error('Explorer security scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Explorer security scan passed across ${files.length} source and release files.`);
