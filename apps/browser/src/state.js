import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CURRENT_VERSION = 2;
const EMPTY = Object.freeze({
  version: CURRENT_VERSION,
  tabs: [],
  activeTabId: null,
  history: [],
  bookmarks: [],
  downloads: [],
  closedTabs: [],
  audit: []
});

function emptyState() {
  return structuredClone(EMPTY);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function number(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function cleanTab(value, { closed = false } = {}) {
  if (!isObject(value) || value.privateMode === true) return null;
  const tab = {
    id: text(value.id) || randomUUID(),
    url: text(value.url, "about:blank"),
    title: text(value.title, "Untitled"),
    privateMode: false,
    crashed: Boolean(value.crashed),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt)
  };
  if (typeof value.group === "string") tab.group = value.group;
  if (closed) tab.closedAt = text(value.closedAt);
  return tab;
}

function cleanHistory(value) {
  if (!isObject(value) || value.privateMode === true || value.ephemeral === true) return null;
  return {
    id: text(value.id) || randomUUID(),
    title: text(value.title, "Untitled"),
    url: text(value.url),
    visitedAt: text(value.visitedAt)
  };
}

function cleanBookmark(value) {
  if (!isObject(value) || value.privateMode === true || value.ephemeral === true) return null;
  return {
    id: text(value.id) || randomUUID(),
    title: text(value.title, "Untitled"),
    url: text(value.url),
    createdAt: text(value.createdAt)
  };
}

function cleanDownload(value) {
  if (!isObject(value) || value.ephemeral === true || value.privateMode === true) return null;
  return {
    id: text(value.id) || randomUUID(),
    filename: text(value.filename, "download"),
    url: text(value.url),
    state: text(value.state, "unknown"),
    receivedBytes: number(value.receivedBytes),
    totalBytes: number(value.totalBytes),
    updatedAt: text(value.updatedAt)
  };
}

function cleanAudit(value) {
  if (!isObject(value)) return null;
  return {
    id: text(value.id) || randomUUID(),
    event: text(value.event, "unknown"),
    details: isObject(value.details) ? structuredClone(value.details) : {},
    at: text(value.at)
  };
}

function cleanList(value, cleaner, limit) {
  if (!Array.isArray(value)) return [];
  return value.map(item => cleaner(item)).filter(Boolean).slice(0, limit);
}

function normalizeState(raw) {
  if (!isObject(raw)) throw new Error("browser state must be an object");
  const sourceVersion = raw.version ?? 1;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > CURRENT_VERSION) {
    throw new Error(`unsupported browser state version: ${sourceVersion}`);
  }

  const state = emptyState();
  state.tabs = cleanList(raw.tabs, value => cleanTab(value), 500);
  state.history = cleanList(raw.history, cleanHistory, 5000);
  state.bookmarks = cleanList(raw.bookmarks, cleanBookmark, 5000);
  state.downloads = cleanList(raw.downloads, cleanDownload, 5000);
  state.closedTabs = cleanList(raw.closedTabs, value => cleanTab(value, { closed: true }), 20);
  state.audit = cleanList(raw.audit, cleanAudit, 1000);
  state.activeTabId = state.tabs.some(tab => tab.id === raw.activeTabId)
    ? raw.activeTabId
    : state.tabs.at(-1)?.id ?? null;
  return state;
}

async function readState(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  return { raw, normalized: normalizeState(raw) };
}

async function parseState(path) {
  return (await readState(path)).normalized;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

async function save(path, value, { backupExisting = true } = {}) {
  const normalized = normalizeState(value);
  await mkdir(dirname(path), { recursive: true });
  if (backupExisting) {
    try {
      await copyFile(path, `${path}.bak`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await writeJsonAtomic(path, normalized);
  return normalized;
}

async function load(path) {
  try {
    const { raw, normalized } = await readState(path);
    if ((raw.version ?? 1) !== CURRENT_VERSION) await save(path, normalized);
    return normalized;
  } catch (primaryError) {
    if (primaryError.code === "ENOENT") return emptyState();
    try {
      const recovered = await parseState(`${path}.bak`);
      await save(path, recovered, { backupExisting: false });
      return recovered;
    } catch {
      throw primaryError;
    }
  }
}

export class BrowserState {
  constructor(path, { clock = () => new Date().toISOString() } = {}) {
    this.path = path;
    this.clock = clock;
    this.privateTabs = new Map();
  }

  async snapshot() {
    return load(this.path);
  }

  async tabs() {
    return [...(await load(this.path)).tabs, ...this.privateTabs.values()];
  }

  async openTab(url = "https://search.ynx.local", { privateMode = false } = {}) {
    const tab = {
      id: randomUUID(),
      url,
      title: "New tab",
      privateMode,
      crashed: false,
      createdAt: this.clock(),
      updatedAt: this.clock()
    };
    if (privateMode) {
      this.privateTabs.set(tab.id, tab);
      return tab;
    }
    const state = await load(this.path);
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    await save(this.path, state);
    return tab;
  }

  async updateTab(id, patch) {
    const allowedPatch = {};
    for (const key of ["url", "title", "crashed", "group"]) {
      if (Object.hasOwn(patch ?? {}, key)) allowedPatch[key] = patch[key];
    }

    if (this.privateTabs.has(id)) {
      const tab = {
        ...this.privateTabs.get(id),
        ...allowedPatch,
        id,
        privateMode: true,
        updatedAt: this.clock()
      };
      this.privateTabs.set(id, tab);
      return tab;
    }

    const state = await load(this.path);
    const tab = state.tabs.find(item => item.id === id);
    if (!tab) throw new Error("tab not found");
    Object.assign(tab, allowedPatch, { id, privateMode: false, updatedAt: this.clock() });
    await save(this.path, state);
    return tab;
  }

  async closeTab(id) {
    if (this.privateTabs.delete(id)) return;
    const state = await load(this.path);
    const index = state.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const [tab] = state.tabs.splice(index, 1);
    state.closedTabs.unshift({ ...tab, closedAt: this.clock() });
    state.closedTabs = state.closedTabs.slice(0, 20);
    if (state.activeTabId === id) state.activeTabId = state.tabs.at(-1)?.id ?? null;
    await save(this.path, state);
  }

  async recordVisit(tab, { title, url }) {
    if (this.privateTabs.has(tab?.id)) return;
    const state = await load(this.path);
    if (!state.tabs.some(item => item.id === tab?.id)) throw new Error("tab not found");
    state.history.unshift({ id: randomUUID(), title, url, visitedAt: this.clock() });
    state.history = state.history.slice(0, 5000);
    await save(this.path, state);
  }

  async addBookmark({ title, url }) {
    const state = await load(this.path);
    const item = { id: randomUUID(), title, url, createdAt: this.clock() };
    state.bookmarks.push(item);
    await save(this.path, state);
    return item;
  }

  async recordDownload(item, { privateMode = false } = {}) {
    if (privateMode) return { ...item, ephemeral: true };
    const state = await load(this.path);
    state.downloads.unshift({ ...item, id: item.id ?? randomUUID(), updatedAt: this.clock() });
    const saved = await save(this.path, state);
    return saved.downloads[0];
  }

  async recordAudit(event, details = {}) {
    const state = await load(this.path);
    state.audit.unshift({ id: randomUUID(), event, details, at: this.clock() });
    state.audit = state.audit.slice(0, 1000);
    await save(this.path, state);
  }

  closePrivateWindow() {
    this.privateTabs.clear();
  }

  async recoveryPlan() {
    const state = await load(this.path);
    return state.tabs.map(tab => ({ id: tab.id, url: tab.url, title: tab.title, crashed: tab.crashed }));
  }

  async createBackup(backupPath) {
    const state = await load(this.path);
    await save(backupPath, state, { backupExisting: false });
    return {
      version: state.version,
      path: backupPath,
      records: state.tabs.length + state.history.length + state.bookmarks.length + state.downloads.length + state.audit.length
    };
  }

  async restoreBackup(backupPath) {
    const restored = await parseState(backupPath);
    await save(this.path, restored);
    this.privateTabs.clear();
    return restored;
  }

  async exportTo(exportPath, { includeAudit = false } = {}) {
    const state = await load(this.path);
    const payload = {
      schemaVersion: "ynx.browser.export.v1",
      sourceStateVersion: state.version,
      exportedAt: this.clock(),
      data: {
        ...state,
        audit: includeAudit ? state.audit : []
      }
    };
    await writeJsonAtomic(exportPath, payload);
    return {
      path: exportPath,
      includeAudit,
      records: payload.data.tabs.length + payload.data.history.length + payload.data.bookmarks.length + payload.data.downloads.length + payload.data.audit.length
    };
  }

  async deleteData({ history = false, bookmarks = false, downloads = false, audit = false, sessions = false } = {}) {
    if (![history, bookmarks, downloads, audit, sessions].some(Boolean)) {
      throw new Error("at least one browser data class must be selected");
    }
    const state = await load(this.path);
    const before = {
      history: state.history.length,
      bookmarks: state.bookmarks.length,
      downloads: state.downloads.length,
      audit: state.audit.length,
      sessions: state.tabs.length + state.closedTabs.length
    };
    if (history) state.history = [];
    if (bookmarks) state.bookmarks = [];
    if (downloads) state.downloads = [];
    if (audit) state.audit = [];
    if (sessions) {
      state.tabs = [];
      state.closedTabs = [];
      state.activeTabId = null;
      this.privateTabs.clear();
    }
    await save(this.path, state);
    const selected = { history, bookmarks, downloads, audit, sessions };
    return Object.fromEntries(Object.entries(before).map(([key, count]) => [key, selected[key] ? count : 0]));
  }
}

export class PhishingPolicy {
  constructor({ blockedOrigins = [], allowOverrides = [] } = {}) {
    this.blocked = new Set(blockedOrigins);
    this.overrides = new Set(allowOverrides);
  }

  check(url) {
    const origin = new URL(url).origin;
    if (this.overrides.has(origin)) return { action: "allow", source: "user-override" };
    if (this.blocked.has(origin)) return { action: "warn", source: "operator-blocklist", claim: "known-list-match" };
    return { action: "allow", source: "no-known-list-match", claim: "not-a-safety-guarantee" };
  }
}

export function updateBoundary({ currentVersion, offeredVersion, signatureValid, channel }) {
  if (!["stable", "beta"].includes(channel)) throw new Error("unknown update channel");
  if (!signatureValid) return { allowed: false, reason: "invalid-signature" };
  if (!/^\d+\.\d+\.\d+$/.test(offeredVersion)) return { allowed: false, reason: "invalid-version" };
  const a = currentVersion.split(".").map(Number);
  const b = offeredVersion.split(".").map(Number);
  const newer = b.some((part, index) => part > a[index] && b.slice(0, index).every((value, position) => value === a[position]));
  return newer ? { allowed: true, reason: "signed-newer-version" } : { allowed: false, reason: "not-newer" };
}
