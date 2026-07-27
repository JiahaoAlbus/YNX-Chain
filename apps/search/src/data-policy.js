const PUBLIC_DATA_CLASSES = new Set([
  "public-web",
  "public-docs",
  "public-product-metadata",
  "public-release",
  "public-chain-evidence",
  "public-governance",
  "public-status",
  "external-public",
]);

const FORBIDDEN_DATA_CLASSES = new Set([
  "private-social",
  "private-mail",
  "private-cloud",
  "wallet-session",
  "wallet-secret",
  "strategy-private",
  "operator-log",
  "engineering-internal",
  "credential-secret",
  "personal-sensitive",
]);

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  { name: "private-key", expression: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/u },
  { name: "authorization-header", expression: /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/=-]{16,}/iu },
  { name: "openai-style-secret", expression: /\bsk-[A-Za-z0-9]{20,}\b/u },
  { name: "github-token", expression: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/u },
  { name: "aws-access-key", expression: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: "generic-api-secret", expression: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{24,}/iu },
  { name: "slack-token", expression: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  { name: "mac-user-path", expression: /\/Users\/[^/\s]+\//u },
  { name: "ynx-worktree-path", expression: /YNX Final Worktrees/iu },
  { name: "internal-branch", expression: /\b(?:codex|refs\/heads)\/[A-Za-z0-9._/-]+\b/iu },
  { name: "environment-file", expression: /(?:^|[\s/])\.env(?:\.[A-Za-z0-9_-]+)?(?:$|[\s:])/u },
];

export const SEARCH_DATA_POLICY = Object.freeze({
  version: "1.0.0",
  registryVersion: 4,
  publicClasses: Object.freeze([...PUBLIC_DATA_CLASSES]),
  forbiddenClasses: Object.freeze([...FORBIDDEN_DATA_CLASSES]),
  rule: "explicit public data class required; private and internal classes fail closed",
});

function normalizedClasses(values) {
  if (!Array.isArray(values)) throw new Error("allowed data classes required");
  const classes = [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))];
  if (!classes.length || classes.length > 20) throw new Error("allowed data classes required");
  return classes;
}

export function validateAllowedDataClasses(values) {
  const classes = normalizedClasses(values);
  for (const value of classes) {
    if (FORBIDDEN_DATA_CLASSES.has(value)) throw new Error(`forbidden data class: ${value}`);
    if (!PUBLIC_DATA_CLASSES.has(value)) throw new Error(`unknown public data class: ${value}`);
  }
  return classes;
}

export function validateDocumentDataClass(source, value) {
  const dataClass = String(value ?? "").trim();
  if (!dataClass) throw new Error("document data class required");
  if (FORBIDDEN_DATA_CLASSES.has(dataClass)) throw new Error(`forbidden data class: ${dataClass}`);
  if (!PUBLIC_DATA_CLASSES.has(dataClass)) throw new Error(`unknown public data class: ${dataClass}`);
  if (!source.dataPolicy?.allowedClasses?.includes(dataClass)) throw new Error("document data class is outside source policy");
  return dataClass;
}

export function scanHighConfidenceSensitiveContent(value) {
  const text = String(value ?? "");
  const findings = HIGH_CONFIDENCE_SECRET_PATTERNS
    .filter(pattern => pattern.expression.test(text))
    .map(pattern => pattern.name);
  return [...new Set(findings)];
}

export function assertPublicIndexContent(value) {
  const findings = scanHighConfidenceSensitiveContent(value);
  if (findings.length) throw new Error(`sensitive content rejected: ${findings.join(",")}`);
  return true;
}
