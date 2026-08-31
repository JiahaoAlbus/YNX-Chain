import { validPath } from "../state/workspace";

export const PROJECT_TRANSFER_SCHEMA = "ynx-code-project/v1";
export const PROJECT_FILE_LIMIT = 256;
export const PROJECT_BYTE_LIMIT = 2 * 1024 * 1024;

export type ImportedProject = { name: string; files: Record<string, string> };

export function validateImportedProject(value: unknown): ImportedProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project JSON must be an object.");
  const envelope = value as Record<string, unknown>;
  if (envelope.schemaVersion !== PROJECT_TRANSFER_SCHEMA) throw new Error("Unsupported project export schema.");
  if (typeof envelope.name !== "string" || !envelope.name.trim() || envelope.name.length > 160) throw new Error("Project name is invalid.");
  if (!envelope.files || typeof envelope.files !== "object" || Array.isArray(envelope.files)) throw new Error("Project files are invalid.");
  const files = envelope.files as Record<string, unknown>,
    paths = Object.keys(files);
  if (paths.length > PROJECT_FILE_LIMIT) throw new Error(`Project import exceeds the ${PROJECT_FILE_LIMIT}-file limit.`);
  if (paths.some((path) => !validPath(path))) throw new Error("Project import contains an unsafe path.");
  if (Object.values(files).some((content) => typeof content !== "string")) throw new Error("Project import supports UTF-8 text files only.");
  const typedFiles = Object.fromEntries(paths.map((path) => [path, files[path]])) as Record<string, string>;
  if (new TextEncoder().encode(JSON.stringify(typedFiles)).byteLength > PROJECT_BYTE_LIMIT) throw new Error("Project import exceeds the 2 MiB text-workspace limit.");
  return { name: envelope.name.trim(), files: typedFiles };
}

export function projectExportJSON(name: string, files: Record<string, string>) {
  return `${JSON.stringify({ schemaVersion: PROJECT_TRANSFER_SCHEMA, name, exportedAt: new Date().toISOString(), files }, null, 2)}\n`;
}
