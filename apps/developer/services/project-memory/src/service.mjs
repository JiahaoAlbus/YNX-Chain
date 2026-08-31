import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { posix } from "node:path";

const PROTOCOL = "ynx-code-memory/v1",
  MAX_BODY = 64 * 1024,
  RETENTION = Object.freeze({
    mode: "current-index-only",
    revisionsRetained: 1,
    expiresAutomatically: false,
    deleteTriggers: ["rebuild", "user-clear"],
  });

export function createProjectMemory({
  filename,
  ownerForRequest,
  workspaceStore,
  embed = createOllamaEmbedder(),
}) {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS memory_chunks(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,path TEXT NOT NULL,chunk_index INTEGER NOT NULL,digest TEXT NOT NULL,content TEXT NOT NULL,vector TEXT NOT NULL,dimensions INTEGER NOT NULL,indexed_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id,path,chunk_index)); CREATE INDEX IF NOT EXISTS memory_scope ON memory_chunks(owner_id,project_id,revision); CREATE TABLE IF NOT EXISTS memory_facts(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,path TEXT NOT NULL,fact_type TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,target_path TEXT NOT NULL DEFAULT '',line INTEGER NOT NULL,digest TEXT NOT NULL,indexed_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id,path,fact_type,name,kind,target_path,line)); CREATE INDEX IF NOT EXISTS memory_fact_scope ON memory_facts(owner_id,project_id,revision,fact_type); CREATE TABLE IF NOT EXISTS memory_indexes(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,indexed_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id));",
  );
  db.exec(
    "INSERT OR IGNORE INTO memory_indexes(owner_id,project_id,revision,indexed_at) SELECT owner_id,project_id,MAX(revision),MAX(indexed_at) FROM memory_chunks GROUP BY owner_id,project_id; INSERT OR IGNORE INTO memory_indexes(owner_id,project_id,revision,indexed_at) SELECT owner_id,project_id,MAX(revision),MAX(indexed_at) FROM memory_facts GROUP BY owner_id,project_id;",
  );
  const remove = db.prepare(
      "DELETE FROM memory_chunks WHERE owner_id=? AND project_id=?",
    ),
    removeFacts = db.prepare(
      "DELETE FROM memory_facts WHERE owner_id=? AND project_id=?",
    ),
    removeIndex = db.prepare(
      "DELETE FROM memory_indexes WHERE owner_id=? AND project_id=?",
    ),
    upsertIndex = db.prepare(
      "INSERT INTO memory_indexes(owner_id,project_id,revision,indexed_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,project_id) DO UPDATE SET revision=excluded.revision,indexed_at=excluded.indexed_at",
    ),
    readIndex = db.prepare(
      "SELECT revision,indexed_at FROM memory_indexes WHERE owner_id=? AND project_id=?",
    ),
    insert = db.prepare(
      "INSERT INTO memory_chunks(owner_id,project_id,revision,path,chunk_index,digest,content,vector,dimensions,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ),
    read = db.prepare(
      "SELECT revision,path,chunk_index,digest,content,vector,dimensions,indexed_at FROM memory_chunks WHERE owner_id=? AND project_id=? ORDER BY path,chunk_index",
    ),
    count = db.prepare(
      "SELECT COUNT(*) count,MAX(revision) revision,MAX(indexed_at) indexed_at,MAX(dimensions) dimensions FROM memory_chunks WHERE owner_id=? AND project_id=?",
    ),
    readPage = db.prepare(
      "SELECT revision,path,chunk_index,digest,content,vector,dimensions,indexed_at FROM memory_chunks WHERE owner_id=? AND project_id=? ORDER BY path,chunk_index LIMIT ? OFFSET ?",
    ),
    insertFact = db.prepare(
      "INSERT INTO memory_facts(owner_id,project_id,revision,path,fact_type,name,kind,target_path,line,digest,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ),
    readFacts = db.prepare(
      "SELECT revision,path,fact_type,name,kind,target_path,line,digest,indexed_at FROM memory_facts WHERE owner_id=? AND project_id=? ORDER BY path,line,fact_type,name",
    ),
    readFactPage = db.prepare(
      "SELECT revision,path,fact_type,name,kind,target_path,line,digest,indexed_at FROM memory_facts WHERE owner_id=? AND project_id=? ORDER BY path,line,fact_type,name LIMIT ? OFFSET ?",
    );

  function status(owner, projectId) {
    const value = count.get(owner, projectId),
      index = readIndex.get(owner, projectId),
      facts = readFacts.all(owner, projectId),
      languages = [
        ...new Set(
          facts
            .filter((fact) => fact.fact_type === "file")
            .map((fact) => fact.kind),
        ),
      ].sort();
    return {
      protocolVersion: PROTOCOL,
      projectId,
      chunks: Number(value.count),
      revision: index ? Number(index.revision) : null,
      dimensions: value.dimensions == null ? 0 : Number(value.dimensions),
      indexedAt: index?.indexed_at || null,
      embeddingModel: "nomic-embed-text",
      retention: RETENTION,
      coverage: "text-vectors-declarations-and-file-relations",
      facts: facts.length,
      symbols: facts.filter((fact) => fact.fact_type === "symbol").length,
      relationships: facts.filter((fact) => fact.fact_type === "relation").length,
      languages,
    };
  }

  async function index(owner, projectId, expectedRevision) {
    const workspace = workspaceStore.get(owner, projectId);
    if (!workspace)
      throw fault("Workspace not found.", "workspace_not_found", 404);
    if (workspace.revision !== expectedRevision)
      throw fault(
        "Workspace revision changed before memory indexing.",
        "revision_conflict",
        409,
      );
    const chunks = chunkWorkspace(workspace.files),
      facts = extractFacts(workspace.files),
      previous = new Map(
        read
          .all(owner, projectId)
          .map((row) => [`${row.path}\0${row.chunk_index}\0${row.digest}`, row]),
      ),
      changed = chunks.filter(
        (chunk) => !previous.has(`${chunk.path}\0${chunk.index}\0${sha(chunk.content)}`),
      ),
      embedded = await embedBatches(embed, changed.map((chunk) => chunk.content));
    if (
      embedded.length !== changed.length ||
      embedded.some((vector) => !validVector(vector))
    )
      throw fault(
        "Embedding service returned invalid vectors.",
        "invalid_embedding_result",
        502,
      );
    const newVectors = new Map(
        changed.map((chunk, index) => [
          `${chunk.path}\0${chunk.index}\0${sha(chunk.content)}`,
          embedded[index],
        ]),
      ),
      now = new Date().toISOString();
    if (workspaceStore.get(owner, projectId)?.revision !== expectedRevision)
      throw fault(
        "Workspace revision changed during memory indexing.",
        "revision_conflict",
        409,
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      remove.run(owner, projectId);
      removeFacts.run(owner, projectId);
      for (const chunk of chunks) {
        const digest = sha(chunk.content),
          key = `${chunk.path}\0${chunk.index}\0${digest}`,
          existing = previous.get(key),
          vector = existing ? JSON.parse(existing.vector) : newVectors.get(key);
        insert.run(
          owner,
          projectId,
          workspace.revision,
          chunk.path,
          chunk.index,
          digest,
          chunk.content,
          JSON.stringify(vector),
          vector.length,
          now,
        );
      }
      for (const fact of facts)
        insertFact.run(
          owner,
          projectId,
          workspace.revision,
          fact.path,
          fact.type,
          fact.name,
          fact.kind,
          fact.targetPath || "",
          fact.line,
          sha(JSON.stringify(fact)),
          now,
        );
      upsertIndex.run(owner, projectId, workspace.revision, now);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
    return {
      ...status(owner, projectId),
      indexedAt: now,
      embeddedChunks: changed.length,
      reusedChunks: chunks.length - changed.length,
      indexedFacts: facts.length,
    };
  }

  async function search(owner, projectId, query, limit = 8, allowedPaths) {
    query = text(query, 2, 1000, "query");
    limit = Math.max(1, Math.min(Number(limit) || 8, 20));
    const allow = Array.isArray(allowedPaths) ? new Set(allowedPaths) : null,
      rows = read
        .all(owner, projectId)
        .filter((row) => !allow || allow.has(row.path));
    if (!rows.length)
      return {
        protocolVersion: PROTOCOL,
        projectId,
        results: [],
        indexedRevision: null,
      };
    const [needle] = await embed([query]);
    if (!validVector(needle))
      throw fault(
        "Embedding service returned an invalid query vector.",
        "invalid_embedding_result",
        502,
      );
    const results = rows
      .filter((row) => row.dimensions === needle.length)
      .map((row) => ({
        path: row.path,
        chunkIndex: Number(row.chunk_index),
        digest: row.digest,
        content: row.content,
        score: cosine(needle, JSON.parse(row.vector)),
        revision: Number(row.revision),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return {
      protocolVersion: PROTOCOL,
      projectId,
      indexedRevision: Number(rows[0].revision),
      embeddingModel: "nomic-embed-text",
      results,
    };
  }

  function exportMemory(owner, projectId, cursor = 0, limit = 50, expectedRevision) {
    cursor = Math.max(0, Number(cursor) || 0);
    limit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const project = status(owner, projectId);
    if (
      expectedRevision !== undefined &&
      String(project.revision) !== String(expectedRevision)
    )
      throw Object.assign(
        fault("Memory index changed during export. Restart the export.", "memory_revision_conflict", 409),
        { currentRevision: project.revision },
      );
    const
      chunks = readPage.all(owner, projectId, limit, cursor).map((row) => ({
      revision: Number(row.revision),
      path: row.path,
      chunkIndex: Number(row.chunk_index),
      digest: row.digest,
      content: row.content,
      vector: JSON.parse(row.vector),
      dimensions: Number(row.dimensions),
      indexedAt: row.indexed_at,
    }));
    return {
      protocolVersion: PROTOCOL,
      exportedAt: new Date().toISOString(),
      project,
      chunks,
      cursor,
      nextCursor: cursor + chunks.length < project.chunks ? cursor + chunks.length : null,
    };
  }

  function exportFacts(owner, projectId, cursor = 0, limit = 50, expectedRevision) {
    cursor = Math.max(0, Number(cursor) || 0);
    limit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const project = status(owner, projectId);
    if (
      expectedRevision !== undefined &&
      String(project.revision) !== String(expectedRevision)
    )
      throw Object.assign(
        fault("Memory index changed during export. Restart the export.", "memory_revision_conflict", 409),
        { currentRevision: project.revision },
      );
    const facts = readFactPage.all(owner, projectId, limit, cursor).map((row) => ({
      revision: Number(row.revision),
      path: row.path,
      type: row.fact_type,
      name: row.name,
      kind: row.kind,
      targetPath: row.target_path || null,
      line: Number(row.line),
      digest: row.digest,
      indexedAt: row.indexed_at,
    }));
    return {
      protocolVersion: PROTOCOL,
      exportedAt: new Date().toISOString(),
      project,
      facts,
      cursor,
      nextCursor:
        cursor + facts.length < project.facts ? cursor + facts.length : null,
    };
  }

  function clear(owner, projectId, expectedRevision) {
    const current = status(owner, projectId);
    if (current.revision !== expectedRevision)
      throw Object.assign(
        fault("Memory index changed. Refresh before clearing it.", "memory_revision_conflict", 409),
        { currentRevision: current.revision },
      );
    db.exec("BEGIN IMMEDIATE");
    let chunks, facts;
    try {
      chunks = remove.run(owner, projectId);
      facts = removeFacts.run(owner, projectId);
      removeIndex.run(owner, projectId);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
    return {
      protocolVersion: PROTOCOL,
      projectId,
      removedChunks: Number(chunks.changes),
      removedFacts: Number(facts.changes),
      clearedRevision: expectedRevision,
      retention: RETENTION,
    };
  }

  async function handler(request, response) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (!url.pathname.startsWith("/runtime/memory/")) return false;
    const owner = ownerForRequest(request);
    if (!owner) {
      json(response, 401, {
        error: "A signed workspace session is required.",
        code: "workspace_session_required",
      });
      return true;
    }
    try {
      const projectId = validId(url.pathname.split("/")[3]);
      if (request.method === "GET") {
        const query = url.searchParams.get("q");
        if (query)
          json(
            response,
            200,
            await search(owner, projectId, query, url.searchParams.get("limit")),
          );
        else if (url.searchParams.get("view") === "export")
          json(
            response,
            200,
            exportMemory(
              owner,
              projectId,
              url.searchParams.get("cursor"),
              url.searchParams.get("limit"),
              url.searchParams.has("expectedRevision")
                ? url.searchParams.get("expectedRevision")
                : undefined,
            ),
          );
        else if (url.searchParams.get("view") === "facts")
          json(
            response,
            200,
            exportFacts(
              owner,
              projectId,
              url.searchParams.get("cursor"),
              url.searchParams.get("limit"),
              url.searchParams.has("expectedRevision")
                ? url.searchParams.get("expectedRevision")
                : undefined,
            ),
          );
        else json(response, 200, status(owner, projectId));
        return true;
      }
      if (request.method === "POST") {
        const body = JSON.parse((await readBody(request)).toString("utf8"));
        requireProtocol(body);
        if (body.action && body.action !== "rebuild")
          throw fault("Unsupported memory action.", "unsupported_memory_action", 400);
        json(
          response,
          200,
          await index(owner, projectId, Number(body.expectedRevision)),
        );
        return true;
      }
      if (request.method === "DELETE") {
        if (url.searchParams.get("approval") !== "clear-memory-once")
          throw fault(
            "Clearing memory requires one-time approval.",
            "memory_clear_approval_required",
            403,
          );
        const rawRevision = url.searchParams.get("expectedRevision"),
          expectedRevision = rawRevision === "null" ? null : Number(rawRevision);
        if (expectedRevision !== null && !Number.isInteger(expectedRevision))
          throw fault("Expected memory revision is invalid.", "invalid_revision", 400);
        json(response, 200, clear(owner, projectId, expectedRevision));
        return true;
      }
      throw fault("Method not allowed.", "method_not_allowed", 405);
    } catch (error) {
      json(response, error.status || 400, {
        error: error.message || "Project memory operation failed.",
        code: error.code || "memory_operation_failed",
        ...(error.currentRevision !== undefined
          ? { currentRevision: error.currentRevision }
          : {}),
      });
      return true;
    }
  }
  return {
    handler,
    index,
    search,
    exportMemory,
    exportFacts,
    clear,
    close: () => db.close(),
  };
}

export function createOllamaEmbedder({
  baseURL = process.env.YNX_CODE_EMBEDDING_URL || "http://127.0.0.1:11434",
  model = process.env.YNX_CODE_EMBEDDING_MODEL || "nomic-embed-text",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(baseURL))
    throw new Error("Embedding service must use the fixed loopback boundary.");
  return async (inputs) => {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 512)
      throw fault(
        "Embedding batch is outside its boundary.",
        "invalid_embedding_batch",
        400,
      );
    const response = await fetchImpl(`${baseURL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: inputs, truncate: true, keep_alive: "10m" }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!response?.ok)
      throw fault("Embedding service is unavailable.", "embedding_unavailable", 503);
    const value = await response.json();
    return value.embeddings || [];
  };
}

function chunkWorkspace(files) {
  const chunks = [];
  for (const path of Object.keys(files).sort()) {
    const content = files[path];
    if (!content.trim()) continue;
    const lines = content.split("\n");
    for (let start = 0, index = 0; start < lines.length && chunks.length < 4096; start += 80, index++)
      chunks.push({
        path,
        index,
        content: `Path: ${path}\nLines ${start + 1}-${Math.min(start + 120, lines.length)}\n${lines.slice(start, start + 120).join("\n")}`,
      });
  }
  return chunks;
}
function extractFacts(files) {
  const facts = [],
    paths = new Set(Object.keys(files));
  for (const path of [...paths].sort()) {
    if (facts.length >= 8192) break;
    const content = files[path],
      language = languageForPath(path);
    facts.push({
      path,
      type: "file",
      name: path,
      kind: language,
      targetPath: "",
      line: 1,
    });
    for (const symbol of extractSymbols(language, content)) {
      if (facts.length >= 8192) break;
      facts.push({ path, type: "symbol", targetPath: "", ...symbol });
    }
    for (const relation of extractRelations(language, content)) {
      if (facts.length >= 8192) break;
      facts.push({
        path,
        type: "relation",
        ...relation,
        targetPath: resolveRelation(path, relation.name, language, paths),
      });
    }
  }
  const unique = new Map();
  for (const fact of facts)
    unique.set(
      [fact.path, fact.type, fact.name, fact.kind, fact.targetPath, fact.line].join(
        "\0",
      ),
      fact,
    );
  return [...unique.values()].slice(0, 8192);
}
function languageForPath(path) {
  const extension = posix.extname(path).toLowerCase();
  return (
    {
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".c": "c",
      ".h": "cpp",
      ".hh": "cpp",
      ".hpp": "cpp",
      ".cc": "cpp",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".java": "java",
      ".sol": "solidity",
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".toml": "toml",
      ".md": "markdown",
    }[extension] || "text"
  );
}
function extractSymbols(language, content) {
  const patterns = {
      javascript: [
        ["function", /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([$A-Z_a-z][$\w]*)/],
        ["class", /^\s*(?:export\s+)?(?:default\s+)?class\s+([$A-Z_a-z][$\w]*)/],
        ["variable", /^\s*(?:export\s+)?(?:const|let|var)\s+([$A-Z_a-z][$\w]*)/],
      ],
      typescript: [
        ["function", /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([$A-Z_a-z][$\w]*)/],
        ["class", /^\s*(?:export\s+)?(?:default\s+)?class\s+([$A-Z_a-z][$\w]*)/],
        ["interface", /^\s*(?:export\s+)?interface\s+([$A-Z_a-z][$\w]*)/],
        ["type", /^\s*(?:export\s+)?type\s+([$A-Z_a-z][$\w]*)/],
        ["enum", /^\s*(?:export\s+)?enum\s+([$A-Z_a-z][$\w]*)/],
        ["namespace", /^\s*(?:export\s+)?namespace\s+([$A-Z_a-z][$\w]*)/],
        ["variable", /^\s*(?:export\s+)?(?:const|let|var)\s+([$A-Z_a-z][$\w]*)/],
      ],
      python: [
        ["function", /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/],
        ["class", /^\s*class\s+([A-Za-z_]\w*)/],
      ],
      go: [
        ["function", /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/],
        ["type", /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface|\w+)/],
      ],
      rust: [
        ["function", /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/],
        ["struct", /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/],
        ["enum", /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/],
        ["trait", /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/],
        ["module", /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/],
      ],
      c: cFamilyPatterns(),
      cpp: cFamilyPatterns(),
      java: [
        ["type", /^\s*(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/],
        ["method", /^\s*(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+|synchronized\s+)*(?:[A-Za-z_$][\w$<>,.?\[\]]*\s+)+([A-Za-z_$][\w$]*)\s*\(/],
      ],
      solidity: [
        ["contract", /^\s*(?:abstract\s+)?contract\s+([A-Za-z_]\w*)/],
        ["interface", /^\s*interface\s+([A-Za-z_]\w*)/],
        ["library", /^\s*library\s+([A-Za-z_]\w*)/],
        ["function", /^\s*function\s+([A-Za-z_]\w*)/],
        ["event", /^\s*event\s+([A-Za-z_]\w*)/],
        ["error", /^\s*error\s+([A-Za-z_]\w*)/],
        ["struct", /^\s*struct\s+([A-Za-z_]\w*)/],
        ["enum", /^\s*enum\s+([A-Za-z_]\w*)/],
      ],
    },
    selected = patterns[language] || [],
    symbols = [];
  for (const [index, line] of content.split("\n").entries())
    for (const [kind, pattern] of selected) {
      const match = pattern.exec(line);
      if (match && !CONTROL_WORDS.has(match[1]))
        symbols.push({ name: match[1], kind, line: index + 1 });
    }
  return symbols;
}
function cFamilyPatterns() {
  return [
    ["type", /^\s*(?:class|struct|enum|union|namespace)\s+([A-Za-z_]\w*)/],
    ["function", /^\s*(?:[A-Za-z_]\w*(?:::\w+)?[\s*&<>]+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:\{|$)/],
  ];
}
const CONTROL_WORDS = new Set(["if", "for", "while", "switch", "catch", "return"]);
function extractRelations(language, content) {
  const relations = [],
    lines = content.split("\n");
  let goImportBlock = false;
  for (const [index, line] of lines.entries()) {
    let match;
    if (language === "javascript" || language === "typescript") {
      match = line.match(/\b(?:import|export)\b[^"']*\bfrom\s*["']([^"']+)["']/) ||
        line.match(/\bimport\s*["']([^"']+)["']/) ||
        line.match(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/);
      if (match) relations.push({ name: match[1], kind: "import", line: index + 1 });
    } else if (language === "python") {
      match = line.match(/^\s*from\s+([.\w]+)\s+import\s+/);
      if (match) relations.push({ name: match[1], kind: "import", line: index + 1 });
      else if ((match = line.match(/^\s*import\s+(.+)/)))
        for (const name of match[1].split(",").map((value) => value.trim().split(/\s+as\s+/)[0]))
          if (name) relations.push({ name, kind: "import", line: index + 1 });
    } else if (language === "go") {
      if (/^\s*import\s*\(\s*$/.test(line)) {
        goImportBlock = true;
        continue;
      }
      if (goImportBlock && /^\s*\)\s*$/.test(line)) {
        goImportBlock = false;
        continue;
      }
      match = goImportBlock
        ? line.match(/^\s*(?:[A-Za-z_]\w*\s+)?["`]([^"`]+)["`]/)
        : line.match(/^\s*import\s+(?:[A-Za-z_]\w*\s+)?["`]([^"`]+)["`]/);
      if (match) relations.push({ name: match[1], kind: "import", line: index + 1 });
    } else if (language === "rust") {
      match = line.match(/^\s*use\s+([^;]+);/) || line.match(/^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/);
      if (match) relations.push({ name: match[1].trim(), kind: "use", line: index + 1 });
    } else if (language === "c" || language === "cpp") {
      match = line.match(/^\s*#\s*include\s*["<]([^">]+)[">]/);
      if (match) relations.push({ name: match[1], kind: "include", line: index + 1 });
    } else if (language === "java") {
      match = line.match(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/);
      if (match) relations.push({ name: match[1], kind: "import", line: index + 1 });
    } else if (language === "solidity") {
      match = line.match(/^\s*import\s+(?:[^"']*from\s+)?["']([^"']+)["']/);
      if (match) relations.push({ name: match[1], kind: "import", line: index + 1 });
    }
  }
  return relations;
}
function resolveRelation(sourcePath, specifier, language, paths) {
  const extensions = [
      "",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".go",
      ".rs",
      ".c",
      ".h",
      ".hpp",
      ".cpp",
      ".java",
      ".sol",
    ],
    candidates = [];
  if (specifier.startsWith(".")) {
    const value =
      language === "python"
        ? specifier.replace(/^\.+/, "").replaceAll(".", "/")
        : specifier;
    candidates.push(posix.normalize(posix.join(posix.dirname(sourcePath), value)));
  } else if (language === "python")
    candidates.push(specifier.replaceAll(".", "/"));
  else if (language === "rust") {
    const value = specifier.replace(/^crate::/, "").split("::{")[0].replaceAll("::", "/");
    candidates.push(posix.join("src", value), posix.join(posix.dirname(sourcePath), value));
  } else if ((language === "c" || language === "cpp") && !specifier.includes("/"))
    candidates.push(posix.join(posix.dirname(sourcePath), specifier));
  else if (language === "solidity")
    candidates.push(posix.join(posix.dirname(sourcePath), specifier));
  for (const base of candidates)
    for (const extension of extensions)
      for (const candidate of [base + extension, posix.join(base, `index${extension}`)])
        if (!candidate.startsWith("../") && paths.has(candidate)) return candidate;
  return "";
}
function validVector(value) {
  return (
    Array.isArray(value) &&
    value.length >= 64 &&
    value.length <= 4096 &&
    value.every((number) => Number.isFinite(number))
  );
}
async function embedBatches(embed, inputs) {
  const vectors = [];
  for (let start = 0; start < inputs.length; start += 512) {
    const batch = await embed(inputs.slice(start, start + 512));
    if (!Array.isArray(batch)) return [];
    vectors.push(...batch);
  }
  return vectors;
}
function cosine(a, b) {
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    aa += a[index] * a[index];
    bb += b[index] * b[index];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
function validId(value) {
  if (typeof value !== "string" || !/^[-A-Za-z0-9_]{1,160}$/.test(value))
    throw fault("Invalid project identifier.", "invalid_project", 400);
  return value;
}
function text(value, min, max, label) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < min || result.length > max)
    throw fault(`Invalid ${label}.`, `invalid_${label}`, 400);
  return result;
}
function requireProtocol(body) {
  if (body.protocolVersion !== PROTOCOL)
    throw fault("Memory protocol version is required.", "protocol_mismatch", 400);
}
function fault(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY)
      throw fault("Request too large.", "request_too_large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
