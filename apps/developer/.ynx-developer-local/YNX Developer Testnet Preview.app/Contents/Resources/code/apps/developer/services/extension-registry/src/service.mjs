import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const PROTOCOL = "ynx-code-extension/v1",
  MAX_BODY = 512 * 1024;
export function createExtensionRegistry({ filename, ownerForRequest }) {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS extensions(owner_id TEXT NOT NULL, extension_id TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL, manifest TEXT NOT NULL, installed_at TEXT NOT NULL, PRIMARY KEY(owner_id,extension_id));",
  );
  const list = db.prepare(
      "SELECT extension_id,version,digest,manifest,installed_at FROM extensions WHERE owner_id=? ORDER BY extension_id",
    ),
    read = db.prepare(
      "SELECT digest,manifest,installed_at FROM extensions WHERE owner_id=? AND extension_id=?",
    ),
    upsert = db.prepare(
      "INSERT INTO extensions(owner_id,extension_id,version,digest,manifest,installed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,extension_id) DO UPDATE SET version=excluded.version,digest=excluded.digest,manifest=excluded.manifest,installed_at=excluded.installed_at",
    ),
    remove = db.prepare(
      "DELETE FROM extensions WHERE owner_id=? AND extension_id=?",
    );
  async function handler(request, response) {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (url.pathname !== "/runtime/extensions") return false;
    const owner = ownerForRequest(request);
    if (!owner) {
      json(response, 401, {
        error: "A signed workspace session is required.",
        code: "workspace_session_required",
      });
      return true;
    }
    try {
      if (request.method === "GET") {
        json(response, 200, {
          protocolVersion: PROTOCOL,
          extensions: list.all(owner).map((row) => record(row)),
        });
        return true;
      }
      if (request.method === "POST") {
        const body = JSON.parse(
          (await readBody(request, MAX_BODY)).toString("utf8"),
        );
        if (body.protocolVersion !== PROTOCOL)
          throw fault(
            "Extension protocol version is required.",
            "protocol_mismatch",
            400,
          );
        const manifest = validateManifest(body.manifest),
          serialized = stableStringify(manifest),
          digest = createHash("sha256").update(serialized).digest("hex"),
          id = `${manifest.publisher}.${manifest.name}`,
          existing = read.get(owner, id);
        if (existing?.digest === digest) {
          json(response, 200, {
            protocolVersion: PROTOCOL,
            extension: record({
              extension_id: id,
              version: manifest.version,
              digest,
              manifest: serialized,
              installed_at: existing.installed_at,
            }),
            replayed: true,
          });
          return true;
        }
        const installedAt = new Date().toISOString();
        upsert.run(
          owner,
          id,
          manifest.version,
          digest,
          serialized,
          installedAt,
        );
        json(response, 200, {
          protocolVersion: PROTOCOL,
          extension: {
            id,
            version: manifest.version,
            digest,
            manifest,
            installedAt,
          },
          replayed: false,
        });
        return true;
      }
      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (
          !/^[a-z0-9][a-z0-9-]{1,63}\.[a-z0-9][a-z0-9-]{1,63}$/.test(id || "")
        )
          throw fault(
            "Valid extension ID is required.",
            "invalid_extension_id",
            400,
          );
        remove.run(owner, id);
        json(response, 200, { protocolVersion: PROTOCOL, removed: id });
        return true;
      }
      throw fault("Method not allowed.", "method_not_allowed", 405);
    } catch (error) {
      json(response, error.status || 400, {
        error: error.message || "Extension operation failed.",
        code: error.code || "extension_operation_failed",
      });
      return true;
    }
  }
  return { handler, close: () => db.close() };
}
function record(row) {
  return {
    id: row.extension_id,
    version: row.version,
    digest: row.digest,
    manifest: JSON.parse(row.manifest),
    installedAt: row.installed_at,
  };
}
function validateManifest(value) {
  if (
    !value ||
    value.apiVersion !== PROTOCOL ||
    value.kind !== "declarative-web" ||
    !name(value.publisher) ||
    !name(value.name) ||
    typeof value.displayName !== "string" ||
    value.displayName.length < 1 ||
    value.displayName.length > 120 ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version || "")
  )
    throw fault(
      "Invalid declarative extension identity.",
      "invalid_extension_manifest",
      400,
    );
  const contributes = value.contributes || {},
    languages = Array.isArray(contributes.languages)
      ? contributes.languages.map((language) => {
          if (
            !name(language.id) ||
            !Array.isArray(language.extensions) ||
            language.extensions.length > 32 ||
            language.extensions.some(
              (extension) =>
                !/^\.[A-Za-z0-9][A-Za-z0-9+_-]{0,15}$/.test(extension),
            )
          )
            throw fault(
              "Invalid language contribution.",
              "invalid_language_contribution",
              400,
            );
          return {
            id: language.id,
            aliases: Array.isArray(language.aliases)
              ? language.aliases
                  .filter(
                    (alias) => typeof alias === "string" && alias.length <= 64,
                  )
                  .slice(0, 8)
              : [],
            extensions: [...new Set(language.extensions)],
          };
        })
      : [],
    snippets = Array.isArray(contributes.snippets)
      ? contributes.snippets.map((snippet) => {
          if (
            !name(snippet.language) ||
            typeof snippet.label !== "string" ||
            snippet.label.length < 1 ||
            snippet.label.length > 120 ||
            typeof snippet.prefix !== "string" ||
            snippet.prefix.length < 1 ||
            snippet.prefix.length > 120 ||
            !Array.isArray(snippet.body) ||
            snippet.body.length > 100 ||
            snippet.body.some(
              (line) => typeof line !== "string" || line.length > 1000,
            )
          )
            throw fault(
              "Invalid snippet contribution.",
              "invalid_snippet_contribution",
              400,
            );
          return {
            language: snippet.language,
            label: snippet.label,
            prefix: snippet.prefix,
            body: snippet.body,
            description:
              typeof snippet.description === "string"
                ? snippet.description.slice(0, 500)
                : "",
          };
        })
      : [],
    themes = Array.isArray(contributes.themes)
      ? contributes.themes.map((theme) => {
          if (
            !name(theme.id) ||
            typeof theme.label !== "string" ||
            theme.label.length > 80 ||
            !theme.colors ||
            typeof theme.colors !== "object" ||
            Array.isArray(theme.colors)
          )
            throw fault(
              "Invalid theme contribution.",
              "invalid_theme_contribution",
              400,
            );
          const allowed = new Set([
              "background",
              "panel",
              "editor",
              "text",
              "muted",
              "border",
              "accent",
            ]),
            colors = {};
          for (const [key, color] of Object.entries(theme.colors)) {
            if (
              !allowed.has(key) ||
              typeof color !== "string" ||
              !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(color)
            )
              throw fault(
                "Invalid theme color.",
                "invalid_theme_contribution",
                400,
              );
            colors[key] = color;
          }
          return {
            id: theme.id,
            label: theme.label,
            type: theme.type === "light" ? "light" : "dark",
            colors,
          };
        })
      : [];
  if (
    languages.length + snippets.length + themes.length < 1 ||
    languages.length > 32 ||
    snippets.length > 500 ||
    themes.length > 8
  )
    throw fault(
      "Extension must contain bounded declarative contributions.",
      "empty_extension_contribution",
      400,
    );
  return {
    apiVersion: PROTOCOL,
    kind: "declarative-web",
    publisher: value.publisher,
    name: value.name,
    displayName: value.displayName,
    version: value.version,
    description:
      typeof value.description === "string"
        ? value.description.slice(0, 500)
        : "",
    contributes: { languages, snippets, themes },
  };
}
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function name(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}
async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit)
      throw fault(
        "Extension request is too large.",
        "extension_request_too_large",
        413,
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
function fault(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
