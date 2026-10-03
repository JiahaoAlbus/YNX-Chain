import { PROJECT_BYTE_LIMIT, PROJECT_FILE_LIMIT, PROJECT_TRANSFER_SCHEMA, validateImportedProject } from "./projectTransfer";

// The retained text-workspace entry opens files without replacing the project.
// Full native workspaces keep upstream filesystem/binary-file behavior.
export async function readOpenedFiles(selected: Pick<File, "name" | "size" | "arrayBuffer">[], existing: Record<string, string>) {
  if (selected.length > PROJECT_FILE_LIMIT || selected.reduce((sum, file) => sum + file.size, 0) > PROJECT_BYTE_LIMIT) throw new Error("Selected files exceed this text workspace's size limit.");
  const additions: Record<string, string> = Object.create(null), decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of selected) {
    if (Object.hasOwn(existing, file.name) || Object.hasOwn(additions, file.name)) throw new Error(`A file named ${file.name} already exists. Rename it before opening; existing content is retained.`);
    try { additions[file.name] = decoder.decode(await file.arrayBuffer()); }
    catch { throw new Error("This recovery workspace opens UTF-8 text files. Use the full workbench for binary files."); }
  }
  validateImportedProject({ schemaVersion: PROJECT_TRANSFER_SCHEMA, name: "Opened files", files: { ...existing, ...additions } });
  return additions;
}
