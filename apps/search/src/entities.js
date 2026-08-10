const productDefinitions = [
  ["YNX Wallet", "wallet", ["ynx wallet auth", "wallet auth"]],
  ["YNX Social", "social", []],
  ["YNX Pay", "pay", []],
  ["YNX Merchant Console", "merchant-console", ["merchant console"]],
  ["YNX Card", "card", []],
  ["YNX Exchange", "exchange", []],
  ["YNX Quant Lab", "quant", ["quant lab", "ynx quant"]],
  ["YNX Shop", "shop", []],
  ["YNX Seller Console", "seller-console", ["seller console"]],
  ["YNX Developer", "developer", ["ynx ai build"]],
  ["YNX Explorer", "explorer", []],
  ["YNX Monitor", "monitor", []],
  ["YNX AI", "ai", []],
  ["YNX Trust Center", "trust-center", ["trust center"]],
  ["YNX Resource Market", "resource-market", ["resource market"]],
  ["YNX Economics", "economics", ["ynxt economics", "ynx tokenomics"]],
  ["YNX Docs and Compliance", "docs-compliance", ["ynx whitepaper", "ynx compliance"]],
  ["YNX Oracle", "oracle", ["ynx market data"]],
  ["YNX Cloud", "cloud", []],
  ["YNX Bridge", "bridge", ["ynx interoperability"]],
  ["YNX Browser", "browser", []],
  ["YNX Search", "search", []],
  ["YNX Finance", "finance", []],
  ["YNX Mail", "mail", []],
  ["YNX Data Fabric", "data-fabric", ["ynx billing ledger"]],
  ["YNX DEX", "dex", []],
  ["YNX Website", "website", ["ynxweb4.com"]],
  ["YNX Integration", "integration", []],
  ["YNX Security", "security", ["ynx sre", "ynx release platform"]],
  ["YNX Governance", "governance", ["ynx protocol control"]],
  ["YNX Music", "music", []],
  ["YNX Video", "video", []],
  ["YNX Creator Studio", "creator-studio", ["creator studio"]],
  ["YNX Docs", "docs", []],
  ["YNX Calendar", "calendar", []],
];

const coreEntities = [
  {
    id: "ynx-chain",
    type: "organization",
    canonicalName: "YNX Chain",
    aliases: ["ynx", "ynx chain", "ynx chain core", "streambft"],
    canonicalUrl: "https://ynxweb4.com/",
    description: "The YNX Web4 Layer-1 ecosystem.",
    facts: { network: "YNX Testnet", evmChainId: 6423, cosmosChainId: "ynx_6423-1", nativeAsset: "YNXT" },
  },
  {
    id: "ynx-web4",
    type: "ecosystem",
    canonicalName: "YNX Web4",
    aliases: ["ynx web4", "ynxweb4"],
    canonicalUrl: "https://ynxweb4.com/products",
    description: "The independent product ecosystem powered by YNX Chain.",
  },
  {
    id: "ynxt",
    type: "testnet-asset",
    canonicalName: "YNXT",
    aliases: ["ynxt", "ynx token"],
    canonicalUrl: "https://ynxweb4.com/economics",
    description: "The native YNX Testnet asset; it is not a Mainnet or fiat asset.",
    facts: { network: "YNX Testnet", valueBoundary: "testnet asset" },
  },
  {
    id: "ynx-testnet",
    type: "network",
    canonicalName: "YNX Testnet",
    aliases: ["6423", "ynx testnet", "ynx_6423-1", "0x1917"],
    canonicalUrl: "https://ynxweb4.com/testnet",
    description: "YNX Testnet uses EVM chain ID 6423 and Cosmos chain ID ynx_6423-1.",
    facts: { evmChainId: 6423, evmChainIdHex: "0x1917", cosmosChainId: "ynx_6423-1", nativeAsset: "YNXT" },
  },
];

const productEntities = productDefinitions.map(([canonicalName, slug, extraAliases]) => ({
  id: `product-${slug}`,
  type: "product",
  canonicalName,
  aliases: [canonicalName.toLocaleLowerCase(), ...extraAliases],
  canonicalUrl: `https://ynxweb4.com/${slug}`,
  description: `${canonicalName} is an independent product in the YNX Web4 ecosystem.`,
}));

export const ENTITY_REGISTRY = Object.freeze({
  version: "1.0.0",
  effectiveAt: "2026-07-27",
  correctionPolicy: "exact aliases only; YNX is never corrected to Lynx",
  entities: Object.freeze([...coreEntities, ...productEntities]),
});

export function normalizeEntityQuery(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u2010-\u2015_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveEntities(query) {
  const normalized = normalizeEntityQuery(query);
  if (!normalized) return [];
  const matches = [];
  for (const entity of ENTITY_REGISTRY.entities) {
    const aliases = [...new Set([entity.canonicalName.toLocaleLowerCase(), ...entity.aliases.map(normalizeEntityQuery)])];
    const exactAlias = aliases.find(alias => normalized === alias);
    if (exactAlias) {
      matches.push({ ...entity, match: { type: "exact-alias", alias: exactAlias, score: 100 } });
      continue;
    }
    const phraseAlias = aliases
      .filter(alias => alias.length >= 4 && normalized.includes(alias))
      .sort((a, b) => b.length - a.length)[0];
    if (phraseAlias) matches.push({ ...entity, match: { type: "phrase-alias", alias: phraseAlias, score: 60 } });
  }
  return matches.sort((a, b) => b.match.score - a.match.score || a.canonicalName.localeCompare(b.canonicalName));
}

export function inferQueryIntent(query, entities = resolveEntities(query)) {
  const normalized = normalizeEntityQuery(query);
  if (entities.some(entity => entity.match.type === "exact-alias")) return "navigational-entity";
  if (/\b(how|guide|docs?|whitepaper|spec|api|faq|what is)\b/u.test(normalized)) return "informational-document";
  if (/\b(status|health|release|download|rpc|explorer|faucet)\b/u.test(normalized)) return "operational";
  return "informational";
}
