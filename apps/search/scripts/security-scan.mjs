import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowedExtensions = new Set([".js", ".mjs", ".json", ".md", ".html", ".css", ".service", ".caddy", ".example"]);
const excludedDirectories = new Set(["node_modules", "test-results", "playwright-report"]);
const patterns = [
  { name: "private key", expression: new RegExp(["-----BEGIN", "(?:RSA |OPENSSH |EC )?", "PRIVATE KEY-----"].join(" ")) },
  { name: "OpenAI-style secret", expression: new RegExp(["s", "k-", "[A-Za-z0-9]{20,}"].join("")) },
  { name: "AWS access key", expression: new RegExp(["AK", "IA", "[0-9A-Z]{16}"].join("")) },
  { name: "Slack token", expression: new RegExp(["xox", "[baprs]", "-[A-Za-z0-9-]{10,}"].join("")) },
];

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile() && (allowedExtensions.has(extname(entry.name)) || entry.name === "package-lock.json")) yield path;
  }
}

const findings = [];
for await (const path of files(root)) {
  const text = await readFile(path, "utf8");
  for (const pattern of patterns) {
    if (pattern.expression.test(text)) findings.push(`${relative(root, path)}: ${pattern.name}`);
  }
}

if (findings.length) {
  console.error("Search security scan found secret-looking material:\n" + findings.map(item => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Search security scan passed without external scanner dependencies");
}
