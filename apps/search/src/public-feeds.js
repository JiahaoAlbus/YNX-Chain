import { createHash } from "node:crypto";

const FEED_VERSION = "1.0.0";
const FORBIDDEN_PUBLIC_MARKERS = ["/users/", "worktree", "codex/", "local path", ".ai-bridge", "ynx final worktrees"];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function idFor(...parts) {
  return digest(parts.join("\u001f")).slice(0, 24);
}

function asOfDate(release) {
  const configured = process.env.SOURCE_DATE_EPOCH;
  if (configured && Number.isFinite(Number(configured))) return new Date(Number(configured) * 1000).toISOString();
  return `${release.lastUpdated}T00:00:00.000Z`;
}

function feed(name, release, coverage, items) {
  return {
    schemaVersion: 1,
    feedName: name,
    version: FEED_VERSION,
    asOf: asOfDate(release),
    sourceCommit: release.source.commit,
    coverage,
    items,
  };
}

function sorted(values, key = value => value.id) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function publicEntity(entity, registry) {
  return {
    id: entity.id,
    type: entity.type,
    canonicalName: entity.canonicalName,
    aliases: sorted([...new Set(entity.aliases ?? [])], value => value),
    canonicalUrl: entity.canonicalUrl,
    description: entity.description,
    facts: entity.facts ?? null,
    registryVersion: registry.version,
    registryEffectiveAt: registry.effectiveAt,
    source: "ynx-entity-registry",
  };
}

function productItem(entity, metadata, release) {
  const currentProduct = entity.canonicalName === metadata.name;
  return {
    id: entity.id,
    name: entity.canonicalName,
    aliases: sorted([...new Set(entity.aliases ?? [])], value => value),
    canonicalUrl: entity.canonicalUrl,
    summary: entity.description,
    publicationStatus: currentProduct ? metadata.status : "metadata-candidate",
    routeVerified: false,
    releaseVersion: currentProduct ? release.product.version : null,
    source: currentProduct ? "ynx-search-public-product-metadata" : "ynx-entity-registry",
  };
}

function faqItem(entry, metadata) {
  return {
    id: idFor("faq", entry.question),
    question: entry.question,
    answer: entry.answer,
    canonicalUrl: `https://ynxweb4.com${metadata.canonicalRoute}#faq-${idFor(entry.question).slice(0, 12)}`,
    source: "ynx-search-public-product-metadata",
  };
}

function searchRecord(item) {
  return {
    id: idFor("search-record", item.type, item.canonicalUrl, item.title),
    type: item.type,
    title: item.title,
    aliases: item.aliases ?? [],
    canonicalUrl: item.canonicalUrl,
    summary: item.summary,
    source: item.source,
    publicationStatus: item.publicationStatus ?? null,
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function assertPublicFeedSafety(files) {
  for (const [name, contents] of Object.entries(files)) {
    const normalized = contents.toLocaleLowerCase();
    for (const marker of FORBIDDEN_PUBLIC_MARKERS) {
      if (normalized.includes(marker)) throw new Error(`${name} contains forbidden public marker: ${marker}`);
    }
  }
}

export function buildPublicFeeds({ metadata, release, entityRegistry, documents = [] }) {
  if (!metadata?.name || !metadata?.canonicalRoute) throw new Error("public product metadata required");
  if (!release?.source?.commit || !release?.product?.version || !release?.lastUpdated) throw new Error("release record required");
  if (!entityRegistry?.version || !entityRegistry?.effectiveAt || !Array.isArray(entityRegistry.entities)) throw new Error("entity registry required");

  const publicEntities = sorted(entityRegistry.entities.map(entity => publicEntity(entity, entityRegistry)));
  const products = sorted(publicEntities.filter(entity => entity.type === "product").map(entity => productItem(entity, metadata, release)));
  const publicDocuments = sorted(documents.map(document => ({
    id: document.id ?? idFor("document", document.canonicalUrl),
    title: document.title,
    canonicalUrl: document.canonicalUrl,
    summary: document.summary,
    language: document.language,
    publishedAt: document.publishedAt,
    updatedAt: document.updatedAt,
    sourceCommit: document.sourceCommit,
    evidenceId: document.evidenceId,
    source: document.source ?? "approved-public-document-registry",
  })));
  const releases = [{
    id: idFor("release", metadata.name, release.product.version),
    product: metadata.name,
    version: release.product.version,
    releaseClass: release.product.releaseClass,
    status: release.product.goalStatus,
    canonicalUrl: `https://ynxweb4.com${metadata.canonicalRoute}`,
    sourceCommit: release.source.commit,
    deployedPublic: release.status.deployedPublic,
    downloadHosted: release.status.downloadHosted,
    productionSigned: release.status.productionSigned,
    storeReleased: release.status.storeReleased,
    source: "ynx-search-release-record",
  }];
  const faq = sorted((metadata.faq ?? []).map(entry => faqItem(entry, metadata)));

  const searchRecords = [
    searchRecord({
      type: "application",
      title: metadata.name,
      aliases: metadata.alternateNames ?? [],
      canonicalUrl: `https://ynxweb4.com${metadata.canonicalRoute}`,
      summary: metadata.metaDescription,
      source: "ynx-search-public-product-metadata",
      publicationStatus: metadata.status,
    }),
    ...products.map(product => searchRecord({
      type: "product",
      title: product.name,
      aliases: product.aliases,
      canonicalUrl: product.canonicalUrl,
      summary: product.summary,
      source: product.source,
      publicationStatus: product.publicationStatus,
    })),
    ...publicEntities.filter(entity => entity.type !== "product").map(entity => searchRecord({
      type: "entity",
      title: entity.canonicalName,
      aliases: entity.aliases,
      canonicalUrl: entity.canonicalUrl,
      summary: entity.description,
      source: entity.source,
    })),
    ...publicDocuments.map(document => searchRecord({
      type: "document",
      title: document.title,
      aliases: [],
      canonicalUrl: document.canonicalUrl,
      summary: document.summary,
      source: document.source,
    })),
    ...faq.map(entry => searchRecord({
      type: "faq",
      title: entry.question,
      aliases: [],
      canonicalUrl: entry.canonicalUrl,
      summary: entry.answer,
      source: entry.source,
    })),
  ];

  const objects = {
    "public-products.json": feed("public-products", release, "YNX product metadata candidates; routes are unverified unless explicitly stated", products),
    "public-documents.json": feed("public-documents", release, publicDocuments.length ? "approved public document registry" : "no approved public document inventory supplied", publicDocuments),
    "public-releases.json": feed("public-releases", release, "YNX Search release record only", releases),
    "public-faq.json": feed("public-faq", release, "YNX Search public FAQ", faq),
    "public-entities.json": feed("public-entities", release, "versioned YNX canonical entity registry", publicEntities),
    "public-search-index.json": feed("public-search-index", release, "metadata-only public discovery index; not the live Search corpus", sorted(searchRecords)),
  };

  const files = Object.fromEntries(Object.entries(objects).map(([name, value]) => [name, serialize(value)]));
  assertPublicFeedSafety(files);
  const manifest = {
    schemaVersion: 1,
    feedSet: "ynx-search-public-feeds",
    version: FEED_VERSION,
    asOf: asOfDate(release),
    sourceCommit: release.source.commit,
    files: sorted(Object.entries(files).map(([name, contents]) => ({
      name,
      bytes: Buffer.byteLength(contents),
      sha256: digest(contents),
    })), item => item.name),
  };
  files["public-feed-manifest.json"] = serialize(manifest);
  assertPublicFeedSafety(files);
  return files;
}
