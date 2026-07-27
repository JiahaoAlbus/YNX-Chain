import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rules = [
  { id: "task-marker", pattern: /\b(?:TODO|FIXME)\b/g },
  { id: "comment-task-marker", pattern: /(?:\/\/|\/\*|\*|<!--)\s*(?:todo|fixme)\b/gi },
  { id: "coming-soon", pattern: /\bcoming\s+soon\b/gi },
  { id: "example-domain", pattern: /\bexample\.com\b/gi },
  { id: "private-key", pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/g },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "live-secret-key", pattern: /\bsk_live_[A-Za-z0-9]+\b/g },
];

export function scanRuntimeText(text, file = "<memory>") {
  const findings = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const offset = match.index ?? 0;
      const line = text.slice(0, offset).split("\n").length;
      findings.push({ file, line, rule: rule.id, match: match[0] });
    }
  }
  return findings;
}

export function scanRuntimeDirectory(root) {
  const findings = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile()) {
        findings.push(...scanRuntimeText(fs.readFileSync(target, "utf8"), target));
      }
    }
  };
  visit(root);
  return findings;
}

function main() {
  const root = path.resolve(process.argv[2] ?? "src");
  const findings = scanRuntimeDirectory(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}: ${finding.rule}: ${finding.match}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`runtime source scan passed: ${root}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
