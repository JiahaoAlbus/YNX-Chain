import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const scanRoots = [
  'apps/finance',
  'internal/finance',
  'docs/integration',
  'release/integration',
  '.ai-bridge',
  'infra/secrets-template/finance.env.template',
];
const skippedNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.gradle',
  'Pods',
  'DerivedData',
  'security-check.mjs',
]);
const textExtensions = new Set([
  '',
  '.css',
  '.go',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mjs',
  '.sh',
  '.template',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yml',
  '.yaml',
]);

const rules = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
    message: 'private key material',
  },
  {
    id: 'openai-secret',
    pattern: /sk-[A-Za-z0-9_-]{20,}/g,
    message: 'provider-style secret token',
  },
  {
    id: 'aws-access-key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    message: 'AWS access key identifier',
  },
  {
    id: 'slack-token',
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    message: 'Slack token',
  },
  {
    id: 'deployment-filler',
    pattern: /example\.com|your_key_here|change\s*me|fake\s+(?:TPS|TVL|user)|\bNYXT\b/gi,
    message: 'disallowed deployment filler or fake claim',
  },
  {
    id: 'runtime-placeholder',
    pattern: /\b(?:TODO|FIXME|Coming soon)\b|>\s*Placeholder\s*</gi,
    message: 'unfinished runtime or visible public placeholder marker',
    runtimeOnly: true,
  },
];

const runtimeRoots = [
  'apps/finance/cmd',
  'apps/finance/gateway/src',
  'apps/finance/mobile/src',
  'apps/finance/web',
  'internal/finance',
];

function collect(path) {
  const info = statSync(path);
  if (info.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (skippedNames.has(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...collect(child));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(child);
  }
  return files;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

const findings = [];
const files = scanRoots.flatMap((path) => collect(resolve(root, path)));
for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  for (const rule of rules) {
    if (rule.runtimeOnly && !runtimeRoots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        rule: rule.id,
        path: rel,
        line: lineNumber(text, match.index ?? 0),
        message: rule.message,
      });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`);
  }
  console.error(`Finance security gate failed with ${findings.length} finding(s).`);
  process.exit(1);
}

console.log(`Finance security gate passed across ${files.length} text files.`);
