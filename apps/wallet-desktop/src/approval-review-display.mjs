const labels = Object.freeze({
  account: "Account", from: "From", to: "Recipient", chainId: "Network",
  value: "Amount", data: "Call data", message: "Message", messageHex: "Message bytes",
  domain: "Signing domain", types: "Type definitions", primaryType: "Primary type",
  gas: "Gas limit", gasLimit: "Gas limit", gasPrice: "Gas price (wei)",
  maxFeePerGas: "Maximum gas price (wei)", maxPriorityFeePerGas: "Priority fee per gas (wei)",
  maximumFee: "Maximum network fee (YNXT)", total: "Maximum total (YNXT)",
  actualFee: "Native transfer fee (YNXT)", feeExplanation: "Fee and budget", modelVersion: "Network fee model", fullEVM: "General EVM execution available",
  amount: "Amount (YNXT)", nonce: "Transaction nonce", type: "Transaction type",
  permissions: "Permissions", accessList: "Access list", warning: "Please review",
  authorizingRevision: "签名的当前密钥版本 / Current signing key revision",
  throughRevision: "包含待生效密钥的撤销范围 / Revoke through pending revision",
  executionHeight: "审查执行高度 / Reviewed execution height",
  typedReview: "完整原 PQ 操作、网络、费用、nonce 和密钥版本 / Exact original PQ action, network, fee, nonce and key revision",
  deployment: "部署源码及编译材料的字节数和 SHA-256（尚待 Go 认证） / Deployment material sizes and SHA-256 (Go authentication still required)",
  initiatorOrigin: "请求应用来源（不是预先签名授权） / Requesting app origin (not signing permission)",
  revokeAt: "撤销生效高度 / Revocation effective height",
});

// Directional and invisible characters must not visually rewrite a signature request.
export function visibleText(value) {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function formatApprovalReview(review) {
  const lines = [];
  for (const [field, value] of Object.entries(review)) {
    if (field === "title" || value === undefined) continue;
    let content = typeof value === "object" ? JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2) : String(value);
    if ((field === "message" || field === "messageHex") && typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value)) {
      try {
        const bytes = Uint8Array.from(value.slice(2).match(/../g) ?? [], part => parseInt(part, 16));
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        content = `Text: ${visibleText(text)}\nExact bytes: ${value}`;
      } catch { content = `Exact bytes: ${value}`; }
    } else if (field === "value" && /^0x[0-9a-f]+$/i.test(content)) {
      const amount = BigInt(content), whole = amount / 10n ** 18n;
      const fraction = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
      content = `${whole}${fraction ? `.${fraction}` : ""} YNXT\nExact value: ${content} wei`;
    } else if (field === "chainId" && ["0x1917", "6423"].includes(content)) {
      content = "YNX Testnet · 6423 (0x1917)";
    }
    lines.push(`${labels[field] ?? field}: ${visibleText(content)}`);
  }
  return lines.join("\n\n");
}
