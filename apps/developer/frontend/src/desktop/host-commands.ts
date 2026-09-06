// A host-neutral UI contract. It provides no filesystem, process, Wallet or key access.
export const DESKTOP_HOST_SCHEMA = "ynx-desktop-host/v1";
export type HostState = { projectId: string; revision: number; activePath: string; dirtyPaths: string[]; editorReady: boolean; workspaceReady: boolean; readOnly: boolean };
export type HostActions = {
  state(): HostState;
  save(): Promise<{ saved: boolean; localSaved: boolean; remoteSaved: boolean }>;
  newFile(path: string): Promise<string | null>;
  importProject(filename: string, content: string): Promise<{ cancelled: boolean; error: string | null }>;
  exportProject(): { filename: string; content: string };
};
type HostWindow = Pick<Window, "location" | "top" | "self">;
declare global { interface Window { __ynxDesktopHost?: (input: unknown) => Promise<unknown> } }
const trusted = (window: HostWindow) => window.top === window.self && window.location.origin === "https://developer.ynxweb4.com" && ["/", "/wallet-auth/callback"].includes(window.location.pathname);
export function createHostCommands(window: HostWindow, actions: HostActions) {
  let busy = false;
  return async (input: unknown) => {
    const reply = (status: string, detail: Record<string, unknown> = {}) => ({ schema: DESKTOP_HOST_SCHEMA, status, ...detail });
    if (!trusted(window)) return reply("blocked", { reason: "untrusted-document" });
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply("blocked", { reason: "invalid-command" });
    const value = input as Record<string, unknown>, command = value.command;
    const fields = command === "new-file" ? ["command", "path"] : command === "import-project" ? ["command", "filename", "content"] : ["command"];
    if (typeof command !== "string" || Object.keys(value).some(key => !fields.includes(key)) || !["state", "save", "new-file", "import-project", "export-project"].includes(command)) return reply("blocked", { reason: "invalid-command" });
    if (command === "state") return reply("handled", { state: actions.state() });
    if (busy) return reply("blocked", { reason: "command-busy" });
    if (["new-file", "import-project"].includes(String(command)) && actions.state().readOnly) return reply("blocked", { reason: "read-only" });
    busy = true;
    try {
      if (command === "save") {
        const saved = await actions.save();
        if (!trusted(window)) return reply("blocked", { reason: "document-changed" });
        return reply(saved.saved ? "handled" : "failed", { ...saved, state: actions.state() });
      }
      if (command === "new-file") {
        if (typeof value.path !== "string" || value.path.length > 240) return reply("blocked", { reason: "invalid-path" });
        const error = await actions.newFile(value.path);
        return trusted(window) ? reply(error ? "failed" : "handled", { error, state: actions.state() }) : reply("blocked", { reason: "document-changed" });
      }
      if (command === "import-project") {
        if (typeof value.filename !== "string" || !/^[^/\\\x00-\x1f]{1,180}$/.test(value.filename) || typeof value.content !== "string" || new TextEncoder().encode(value.content).byteLength > 2 * 1024 * 1024 + 256 * 1024) return reply("blocked", { reason: "invalid-import" });
        const result = await actions.importProject(value.filename, value.content);
        if (!trusted(window)) return reply("blocked", { reason: "document-changed" });
        return reply(result.cancelled ? "cancelled" : result.error ? "failed" : "handled", { error: result.error, state: actions.state() });
      }
      const exported = actions.exportProject();
      if (new TextEncoder().encode(exported.content).byteLength > 2 * 1024 * 1024 + 256 * 1024) return reply("failed", { reason: "export-too-large" });
      return reply("handled", { ...exported, state: actions.state() });
    } catch (error) { return reply("failed", { reason: error instanceof Error ? error.message : "command-failed" }); }
    finally { busy = false; }
  };
}
export function installHostCommands(window: Window, actions: HostActions) {
  const dispatcher = createHostCommands(window, actions), previous = window.__ynxDesktopHost;
  window.__ynxDesktopHost = dispatcher;
  return () => { if (window.__ynxDesktopHost === dispatcher) { if (previous) window.__ynxDesktopHost = previous; else delete window.__ynxDesktopHost; } };
}
