import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const browserRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const productionRoots = [
  "src",
  "native/Sources",
  "ios/YNXBrowser",
  "android/app/src/main",
  "windows/YNXBrowser.Windows"
];
const sourceExtensions = new Set([
  ".cs", ".css", ".html", ".java", ".js", ".json", ".kt", ".mjs",
  ".swift", ".ts", ".tsx", ".xaml", ".xml"
]);
const forbidden = [
  { label: "example.com deployment filler", pattern: /https?:\/\/example\.com/i },
  { label: "TODO marker", pattern: /\bTODO\b/ },
  { label: "FIXME marker", pattern: /\bFIXME\b/ },
  { label: "placeholder marker", pattern: /(?:^|[\s"'`>])placeholder(?:[\s"'`<]|$)/i },
  { label: "coming-soon marker", pattern: /\bcoming soon\b/i },
  { label: "credential filler", pattern: /\b(?:your_key_here|changeme)\b/i },
  { label: "fake runtime claim", pattern: /\bfake (?:balance|user|transaction|price|revenue|apy|liquidity|provider|health|success)\b/i },
  { label: "hard-coded success", pattern: /\bhard[- ]coded success\b/i },
  { label: "no-op control", pattern: /\bno[- ]op (?:button|route|handler)\b/i },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { label: "OpenAI-style secret", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]+\b/ }
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const findings = [];
for (const root of productionRoots) {
  for (const path of await sourceFiles(join(browserRoot, root))) {
    const text = await readFile(path, "utf8");
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const rule of forbidden) {
        if (rule.pattern.test(line)) {
          findings.push(`${relative(repositoryRoot, path)}:${index + 1}: ${rule.label}`);
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error("Browser production source gate failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("browser production source gate passed: no filler, fake-success markers, or common embedded secrets");
