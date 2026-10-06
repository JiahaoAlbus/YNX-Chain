// Check only explicitly selected content. Errors never echo the matching bytes.
// This is a conservative content guard, not proof that arbitrary text is secret-free.
const SECRET_PATTERNS = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i,
  /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /(?:["']?\b(?:api[_-]?key|[A-Z][A-Z0-9_]*_(?:API_KEY|SECRET|TOKEN|PASSWORD)|client[_-]?secret|private[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|mnemonic|seed[_-]?phrase)\b["']?\s*[:=]\s*["']?)(?!\s*(?:<|\$|\{|process\.|import\.|undefined\b|null\b|false\b|true\b|REDACTED\b|YOUR[_-]|EXAMPLE[_-]|PLACEHOLDER\b))[^\s"',;}{]{8,}/i,
  /(?:\b(?:mnemonic|seed[_ -]?phrase)\b|助记词|助記詞)["']?\s*[:=]\s*["']?(?:[a-z]{2,12}[ \t]+){11,23}[a-z]{2,12}(?:["']|[ \t]*(?=\r?\n|$|[,;}]))/i,
  /(?:私钥|私鑰|密钥|密鑰|密码|密碼)["']?\s*[:=]\s*["']?(?!\s*(?:<|\$|\{|REDACTED\b|YOUR[_-]|EXAMPLE[_-]|PLACEHOLDER\b))[^\s"',;}{]{8,}/i,
  /\b(?:private[_ -]?key|seed[_ -]?phrase|mnemonic)\b\s*[:=]\s*["']?(?:0x)?[a-f0-9]{64}\b/i,
];

export function assertNoSelectedSecrets(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    // JSON captures and attachments may escape line breaks or assignment quotes.
    const normalized = value.replace(/\\n/g, '\n').replace(/\\["']/g, '"');
    if (SECRET_PATTERNS.some(pattern => pattern.test(normalized)))
      throw Object.assign(new Error('The selected request contains a possible key or credential. Remove it before reviewing and sending the context.'), { code: 'model_context_secret', status: 400 });
  }
}
