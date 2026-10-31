const labels = Object.freeze({
  networkId: "网络标识 / Network", canonicalOwner: "所选资产账户 / Selected asset account",
  productId: "应用 / App", clientId: "客户端 / Client", platform: "系统 / Platform",
  applicationId: "应用标识 / Application", bundleId: "Bundle ID", packageId: "Package ID",
  origin: "请求来源 / Origin", callback: "返回地址 / Callback", deviceId: "设备标识 / Device",
  generation: "设备密钥代次 / Device key generation", operationId: "本次操作 / Operation",
  issuedAt: "请求时间 / Issued", expiresAt: "截止时间 / Expires",
  binding: "完整创建条款指纹 / Exact creation terms fingerprints",
  stableIdentityBinding: "固定设备身份指纹 / Stable device identity fingerprints",
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
  invoice: "发票原条款、付款／退款对象及原子单位费用 / Original invoice terms, payer or refund recipient and fees in ledger atoms",
  deployment: "部署源码及编译材料的字节数和 SHA-256（尚待 Go 认证） / Deployment material sizes and SHA-256 (Go authentication still required)",
  initiatorOrigin: "请求应用来源（不是预先签名授权） / Requesting app origin (not signing permission)",
  revokeAt: "撤销生效高度 / Revocation effective height",
  purpose: "固定用途 / Fixed purpose", action: "独立请求阶段 / Separate action",
  requestDigest: "原登记消息 SHA-256 / Registration message SHA-256",
  activateAt: "拟生效高度（确认前须核对原执行高度） / Proposed activation height (original execution height must be checked)",
  registrationFee: "新账户登记费 / Initial registration fee",
  publicKeyASHA256: "完整公钥 A 指纹 / Full public key A fingerprint",
  publicKeyBSHA256: "完整公钥 B 指纹 / Full public key B fingerprint",
  effectReady: "真实签名／提交尚未启用 / Signing or submission enabled",
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
    const label=review.purpose==='device.create'&&field==='domain'?'设备创建用途 / Device creation domain':review.purpose==='device.create'&&field==='nonce'?'本次请求唯一值 / Request nonce':labels[field]??field;
    lines.push(`${label}: ${visibleText(content)}`);
  }
  return lines.join("\n\n");
}
