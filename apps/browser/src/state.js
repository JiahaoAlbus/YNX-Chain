import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY = Object.freeze({ version: 1, tabs: [], activeTabId: null, history: [], bookmarks: [], downloads: [], closedTabs: [], audit: [] });

async function load(path) {
  try { return { ...structuredClone(EMPTY), ...JSON.parse(await readFile(path, "utf8")) }; }
  catch (error) { if (error.code === "ENOENT") return structuredClone(EMPTY); throw error; }
}

async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

export class BrowserState {
  constructor(path, { clock = () => new Date().toISOString() } = {}) { this.path = path; this.clock = clock; this.privateTabs = new Map(); }

  async snapshot() { return load(this.path); }
  async tabs() { return [...(await load(this.path)).tabs, ...this.privateTabs.values()]; }

  async openTab(url = "https://search.ynx.local", { privateMode = false } = {}) {
    const tab = { id: randomUUID(), url, title: "New tab", privateMode, crashed: false, createdAt: this.clock(), updatedAt: this.clock() };
    if (privateMode) { this.privateTabs.set(tab.id, tab); return tab; }
    const state = await load(this.path); state.tabs.push(tab); state.activeTabId = tab.id; await save(this.path, state); return tab;
  }

  async updateTab(id, patch) {
    if (this.privateTabs.has(id)) { const tab = { ...this.privateTabs.get(id), ...patch, privateMode: true, updatedAt: this.clock() }; this.privateTabs.set(id, tab); return tab; }
    const state = await load(this.path); const tab = state.tabs.find(item => item.id === id); if (!tab) throw new Error("tab not found");
    Object.assign(tab, patch, { updatedAt: this.clock() }); await save(this.path, state); return tab;
  }

  async closeTab(id) {
    if (this.privateTabs.delete(id)) return;
    const state = await load(this.path); const index = state.tabs.findIndex(tab => tab.id === id); if (index < 0) return;
    const [tab] = state.tabs.splice(index, 1); state.closedTabs.unshift({ ...tab, closedAt: this.clock() }); state.closedTabs = state.closedTabs.slice(0, 20);
    if (state.activeTabId === id) state.activeTabId = state.tabs.at(-1)?.id ?? null; await save(this.path, state);
  }

  async recordVisit(tab, { title, url }) {
    if (tab.privateMode) return;
    const state = await load(this.path); state.history.unshift({ id: randomUUID(), title, url, visitedAt: this.clock() }); state.history = state.history.slice(0, 5000); await save(this.path, state);
  }

  async addBookmark({ title, url }) { const state = await load(this.path); const item = { id: randomUUID(), title, url, createdAt: this.clock() }; state.bookmarks.push(item); await save(this.path, state); return item; }
  async recordDownload(item, { privateMode = false } = {}) { if (privateMode) return { ...item, ephemeral: true }; const state = await load(this.path); state.downloads.unshift({ ...item, id: item.id ?? randomUUID(), updatedAt: this.clock() }); await save(this.path, state); return state.downloads[0]; }
  async recordAudit(event, details = {}) { const state = await load(this.path); state.audit.unshift({ id: randomUUID(), event, details, at: this.clock() }); state.audit = state.audit.slice(0, 1000); await save(this.path, state); }
  closePrivateWindow() { this.privateTabs.clear(); }

  async recoveryPlan() {
    const state = await load(this.path);
    return state.tabs.filter(tab => !tab.privateMode).map(tab => ({ id: tab.id, url: tab.url, title: tab.title, crashed: tab.crashed }));
  }
}

export class PhishingPolicy {
  constructor({ blockedOrigins = [], allowOverrides = [] } = {}) { this.blocked = new Set(blockedOrigins); this.overrides = new Set(allowOverrides); }
  check(url) { const origin = new URL(url).origin; if (this.overrides.has(origin)) return { action: "allow", source: "user-override" }; if (this.blocked.has(origin)) return { action: "warn", source: "operator-blocklist", claim: "known-list-match" }; return { action: "allow", source: "no-known-list-match", claim: "not-a-safety-guarantee" }; }
}

export function updateBoundary({ currentVersion, offeredVersion, signatureValid, channel }) {
  if (!['stable', 'beta'].includes(channel)) throw new Error("unknown update channel");
  if (!signatureValid) return { allowed: false, reason: "invalid-signature" };
  if (!/^\d+\.\d+\.\d+$/.test(offeredVersion)) return { allowed: false, reason: "invalid-version" };
  const a = currentVersion.split('.').map(Number), b = offeredVersion.split('.').map(Number);
  const newer = b.some((part, index) => part > a[index] && b.slice(0, index).every((p, i) => p === a[i]));
  return newer ? { allowed: true, reason: "signed-newer-version" } : { allowed: false, reason: "not-newer" };
}
