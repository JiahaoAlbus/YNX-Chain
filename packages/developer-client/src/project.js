import { DeveloperError, invariant } from "./errors.js";

const PROJECT_VERSION = 1;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[\w.@+()\- /]+$/u;

function clone(value) { return structuredClone(value); }
function nowISO(clock) { return new Date(clock()).toISOString(); }
function id(prefix, clock) { return `${prefix}_${clock().toString(36)}_${crypto.randomUUID().slice(0, 8)}`; }

export function normalizePath(value) {
  const path = String(value ?? "").trim().replace(/\/{2,}/g, "/");
  invariant(path && path.length <= 240 && PATH_PATTERN.test(path), "invalid_path", "File path must be relative, bounded, and cannot traverse directories.", { path });
  return path;
}

function validateFiles(files) {
  invariant(files && typeof files === "object" && !Array.isArray(files), "invalid_files", "Project files must be an object keyed by relative path.");
  const entries = Object.entries(files);
  invariant(entries.length > 0 && entries.length <= MAX_FILES, "invalid_file_count", `Projects require 1-${MAX_FILES} files.`);
  let total = 0;
  const normalized = {};
  for (const [rawPath, rawText] of entries) {
    const path = normalizePath(rawPath);
    const text = String(rawText ?? "");
    const bytes = new TextEncoder().encode(text).byteLength;
    invariant(bytes <= MAX_FILE_BYTES, "file_too_large", `${path} exceeds the 512 KiB editor limit.`);
    invariant(!(path in normalized), "duplicate_path", `Duplicate path: ${path}`);
    total += bytes;
    normalized[path] = text;
  }
  invariant(total <= MAX_PROJECT_BYTES, "project_too_large", "Project exceeds the 5 MiB import limit.");
  return normalized;
}

export class MemoryPersistence {
  #projects = new Map();
  async list() { return [...this.#projects.values()].map(clone); }
  async get(projectId) { return this.#projects.has(projectId) ? clone(this.#projects.get(projectId)) : null; }
  async put(project) { this.#projects.set(project.id, clone(project)); }
  async delete(projectId) { this.#projects.delete(projectId); }
}

export class IndexedDBPersistence {
  constructor(name = "ynx-developer-v1") { this.name = name; }
  async #db() {
    invariant(typeof indexedDB !== "undefined", "persistence_unavailable", "IndexedDB is unavailable in this browser.");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new DeveloperError("persistence_failed", "Could not open project storage."));
    });
  }
  async #request(mode, operation) {
    const db = await this.#db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("projects", mode);
        const request = operation(tx.objectStore("projects"));
        request.onsuccess = () => resolve(clone(request.result));
        request.onerror = () => reject(new DeveloperError("persistence_failed", "Project storage operation failed."));
      });
    } finally { db.close(); }
  }
  list() { return this.#request("readonly", (store) => store.getAll()); }
  get(projectId) { return this.#request("readonly", (store) => store.get(projectId)); }
  put(project) { return this.#request("readwrite", (store) => store.put(project)); }
  delete(projectId) { return this.#request("readwrite", (store) => store.delete(projectId)); }
}

export class ProjectWorkspace {
  constructor({ persistence = new MemoryPersistence(), clock = Date.now } = {}) {
    this.persistence = persistence;
    this.clock = clock;
  }

  async create({ name, template = "counter" }) {
    name = String(name ?? "").trim();
    invariant(name.length >= 2 && name.length <= 80, "invalid_project_name", "Project name must be 2-80 characters.");
    const files = templateFiles(template);
    const at = nowISO(this.clock);
    const project = { version: PROJECT_VERSION, id: id("project", this.clock), name, createdAt: at, updatedAt: at, files, baseline: clone(files), checkpoints: [], conversations: [], settings: { compiler: "solc-0.8.24", optimizer: true, optimizerRuns: 200 }, audit: [] };
    this.#audit(project, "project.created", { template });
    await this.persistence.put(project);
    return clone(project);
  }

  async import(serialized) {
    let value;
    try { value = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized); }
    catch { throw new DeveloperError("invalid_import", "Import is not valid JSON."); }
    invariant(value?.version === PROJECT_VERSION, "unsupported_project_version", `Only project format ${PROJECT_VERSION} is supported.`);
    const name = String(value.name ?? "").trim();
    invariant(name.length >= 2 && name.length <= 80, "invalid_project_name", "Imported project name must be 2-80 characters.");
    const files = validateFiles(value.files);
    const at = nowISO(this.clock);
    const project = { version: PROJECT_VERSION, id: id("project", this.clock), name, createdAt: at, updatedAt: at, files, baseline: clone(files), checkpoints: [], conversations: [], settings: { compiler: "solc-0.8.24", optimizer: true, optimizerRuns: 200 }, audit: [] };
    this.#audit(project, "project.imported", { fileCount: Object.keys(files).length });
    await this.persistence.put(project);
    return clone(project);
  }

  async export(projectId) {
    const project = await this.#required(projectId);
    return JSON.stringify({ version: PROJECT_VERSION, name: project.name, files: project.files }, null, 2);
  }

  async list() { return this.persistence.list(); }
  async get(projectId) { return this.#required(projectId); }

  async write(projectId, path, text, { reviewed = false, origin = "user" } = {}) {
    invariant(origin !== "ai" || reviewed, "review_required", "AI-proposed file writes require diff review before apply.");
    const project = await this.#required(projectId);
    path = normalizePath(path);
    const nextFiles = validateFiles({ ...project.files, [path]: String(text ?? "") });
    project.files = nextFiles;
    project.updatedAt = nowISO(this.clock);
    this.#audit(project, "file.written", { path, origin, reviewed });
    await this.persistence.put(project);
    return clone(project);
  }

  async remove(projectId, path, { reviewed = false, origin = "user" } = {}) {
    invariant(origin !== "ai" || reviewed, "review_required", "AI-proposed file deletion requires diff review before apply.");
    const project = await this.#required(projectId);
    path = normalizePath(path);
    invariant(path in project.files, "file_not_found", `File not found: ${path}`);
    const files = { ...project.files }; delete files[path];
    project.files = validateFiles(files);
    this.#audit(project, "file.removed", { path, origin, reviewed });
    await this.persistence.put(project);
    return clone(project);
  }

  async search(projectId, query, approvedPaths = []) {
    const project = await this.#required(projectId);
    query = String(query ?? "");
    invariant(query.length >= 2 && query.length <= 200, "invalid_search", "Search query must be 2-200 characters.");
    const allowed = new Set(approvedPaths.map(normalizePath));
    const matches = [];
    for (const [path, text] of Object.entries(project.files)) {
      if (allowed.size && !allowed.has(path)) continue;
      text.split("\n").forEach((line, index) => { if (line.toLowerCase().includes(query.toLowerCase())) matches.push({ path, line: index + 1, preview: line.trim().slice(0, 240) }); });
    }
    return matches.slice(0, 250);
  }

  async diff(projectId) {
    const project = await this.#required(projectId);
    const paths = [...new Set([...Object.keys(project.baseline), ...Object.keys(project.files)])].sort();
    return paths.flatMap((path) => {
      const before = project.baseline[path]; const after = project.files[path];
      if (before === after) return [];
      return [{ path, status: before === undefined ? "added" : after === undefined ? "deleted" : "modified", before: before ?? "", after: after ?? "" }];
    });
  }

  async checkpoint(projectId, label) {
    const project = await this.#required(projectId);
    label = String(label ?? "").trim();
    invariant(label.length >= 2 && label.length <= 80, "invalid_checkpoint", "Checkpoint label must be 2-80 characters.");
    const checkpoint = { id: id("checkpoint", this.clock), label, createdAt: nowISO(this.clock), files: clone(project.files) };
    project.checkpoints = [...project.checkpoints.slice(-19), checkpoint];
    project.baseline = clone(project.files);
    this.#audit(project, "checkpoint.created", { checkpointId: checkpoint.id, label });
    await this.persistence.put(project);
    return clone(checkpoint);
  }

  async recordConversation(projectId, entry) {
    const project = await this.#required(projectId);
    const output = String(entry?.output ?? "");
    invariant(output.length <= 100_000, "ai_history_too_large", "AI result exceeds the local history limit.");
    const paths = Array.isArray(entry?.approvedPaths) ? entry.approvedPaths.map(normalizePath) : [];
    invariant(paths.every((path) => path in project.files), "invalid_ai_history", "AI history may reference only project files.");
    const record = { id: id("conversation", this.clock), at: nowISO(this.clock), intent: String(entry?.intent ?? "").slice(0, 4000), approvedPaths: paths, provider: String(entry?.provider ?? "YNX AI Gateway").slice(0, 120), model: String(entry?.model ?? "unavailable").slice(0, 120), status: String(entry?.status ?? "unknown").slice(0, 80), output };
    project.conversations = [...(project.conversations ?? []).slice(-49), record];
    this.#audit(project, "ai.history.recorded", { conversationId: record.id, status: record.status, approvedPaths: paths });
    await this.persistence.put(project);
    return clone(project);
  }

  async clearConversationHistory(projectId) {
    const project = await this.#required(projectId);
    const removed = (project.conversations ?? []).length;
    project.conversations = [];
    this.#audit(project, "ai.history.cleared", { removed });
    await this.persistence.put(project);
    return clone(project);
  }

  async revert(projectId, checkpointId) {
    const project = await this.#required(projectId);
    const checkpoint = project.checkpoints.find((item) => item.id === checkpointId);
    invariant(checkpoint, "checkpoint_not_found", "Checkpoint does not exist.");
    project.files = clone(checkpoint.files);
    this.#audit(project, "checkpoint.reverted", { checkpointId });
    await this.persistence.put(project);
    return clone(project);
  }

  async #required(projectId) {
    const project = await this.persistence.get(projectId);
    invariant(project, "project_not_found", "Project does not exist or was removed.");
    return project;
  }
  #audit(project, event, details) { project.audit.push({ id: id("audit", this.clock), at: nowISO(this.clock), event, details }); }
}

function templateFiles(template) {
  invariant(template === "counter" || template === "blank", "unsupported_template", "Only bounded Counter and blank Solidity templates are supported.");
  if (template === "blank") return { "src/Contract.sol": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n\ncontract Contract {\n}\n", "README.md": "# YNX Solidity project\n\nPinned compiler: Solidity 0.8.24.\n" };
  return {
    "src/Counter.sol": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n\ncontract Counter {\n    uint256 public count;\n    event CountChanged(address indexed caller, uint256 value);\n\n    constructor(uint256 initialValue) { count = initialValue; }\n    function increment(uint256 value) external returns (uint256) {\n        count += value;\n        emit CountChanged(msg.sender, count);\n        return count;\n    }\n}\n",
    "test/Counter.test.js": "import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\n\ntest('Counter targets the pinned bounded YNX path', async () => {\n  const source = await readFile(new URL('../src/Counter.sol', import.meta.url), 'utf8');\n  assert.match(source, /pragma solidity 0\\.8\\.24/);\n  assert.match(source, /function increment\\(uint256 value\\)/);\n});\n",
    "package.json": "{\n  \"name\": \"ynx-counter-project\",\n  \"private\": true,\n  \"type\": \"module\",\n  \"scripts\": {\n    \"test\": \"node --test test/*.test.js\",\n    \"check\": \"node --check test/Counter.test.js\"\n  }\n}\n",
    "README.md": "# Counter\n\nTargets the pinned YNX Solidity 0.8.24 toolchain and bounded local execution subset. Arbitrary EVM compatibility is not claimed.\n"
  };
}
