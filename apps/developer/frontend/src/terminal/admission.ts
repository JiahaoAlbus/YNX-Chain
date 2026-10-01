// A terminal stop commits the remote snapshot. Merge only changes with an
// unambiguous common base; conflicting file edits require user reconciliation.
export function mergeTerminalFiles(base: Record<string, string>, local: Record<string, string>, remote: Record<string, string>) {
  const files: Record<string, string> = {}, conflicts: string[] = [];
  for (const path of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const before = base[path], ours = local[path], theirs = remote[path];
    if (ours !== before && theirs !== before && ours !== theirs) { conflicts.push(path); continue; }
    const value = ours === before ? theirs : ours;
    if (value !== undefined) files[path] = value;
  }
  if (conflicts.length) throw new Error(`Local and terminal edits conflict: ${conflicts.join(", ")}. Both copies are retained; reconcile them before installing packages.`);
  return files;
}
export async function stopSelectedTerminals<T extends { sessionId: string; runtimeId?: string }>(runtimeId: string, list: () => Promise<T[]>, stop: (id: string) => Promise<unknown>) {
  const selected = (await list()).filter(value => value.runtimeId === runtimeId);
  for (const value of selected) await stop(value.sessionId);
  if ((await list()).some(value => value.runtimeId === runtimeId)) throw new Error("The selected terminal is still active or awaiting recovery. Retry Stop before installing packages.");
}
export async function persistTerminalWorkspace<T>(expectedKey: string, currentKey: () => string, save: () => Promise<T>): Promise<T> {
  if (currentKey() !== expectedKey) throw new Error("The editor changed while stopping the terminal. Edits are retained; review the package request again.");
  const saved = await save();
  if (currentKey() !== expectedKey) throw new Error("Edits made during workspace synchronization are retained. Review the package request again.");
  return saved;
}
export function terminalCommonBase(previous: string, remoteKey: string, expectedRevision: number, actualRevision: number) {
  return expectedRevision === actualRevision ? remoteKey : previous;
}
export function applyPackageMetadata(current: Record<string, string>, expected: Record<string, string>, updates: Record<string, string>) {
  if (Object.keys(updates).some(path => current[path] !== expected[path])) return null;
  return { ...current, ...updates };
}
