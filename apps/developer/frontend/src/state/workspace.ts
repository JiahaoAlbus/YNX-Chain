export type ProjectState = { id:string; name:string; revision:number; remoteRevision:number; files:Record<string,string>; folders:string[]; open:string[]; active:string };
type DesktopWorkspace = {
  initialProject: unknown;
  saveProject: (project: ProjectState) => Promise<void>;
  exportProject: (filename: string, content: string) => Promise<void>;
};
declare global { interface Window { ynxDesktopWorkspace?: DesktopWorkspace; __ynxFlushWorkspace?: () => Promise<void> } }
const KEY="ynx-code-project-v1";
const initial:ProjectState={id:crypto.randomUUID(),name:"YNX C++ Starter",revision:1,remoteRevision:0,open:["src/main.cpp"],active:"src/main.cpp",folders:["src"],files:{"src/main.cpp":"#include <iostream>\n\nint main() {\n  std::cout << \"Hello from YNX Code\" << std::endl;\n  return 0;\n}\n","README.md":"# YNX C++ Starter\n\nRun the active C++ file through an isolated YNX Code workspace runtime.\n"}};

// The native host uses an ephemeral loopback port. Its private, app-scoped
// snapshot preserves the UI's project identity without persisting Wallet or
// collaboration credentials, or weakening the runtime's origin checks.
export function restoreProject(value: unknown): ProjectState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const project = value as Record<string, unknown>;
  if (typeof project.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(project.id) || typeof project.name !== "string" || project.name.length > 160) return null;
  if (!project.files || typeof project.files !== "object" || Array.isArray(project.files)) return null;
  const entries = Object.entries(project.files);
  if (entries.length > 256 || entries.some(([path, content]) => !validPath(path) || typeof content !== "string")) return null;
  const files = Object.fromEntries(entries) as Record<string, string>;
  if (new TextEncoder().encode(JSON.stringify(files)).byteLength > 2 * 1024 * 1024) return null;
  const active = typeof project.active === "string" ? project.active : "";
  if (active && !Object.hasOwn(files, active)) return null;
  const folders = Array.isArray(project.folders) ? project.folders.filter((path): path is string => typeof path === "string" && validPath(path)) : foldersFromFiles(Object.keys(files));
  const open = Array.isArray(project.open) ? project.open.filter((path): path is string => typeof path === "string" && Object.hasOwn(files, path)) : active ? [active] : [];
  return { id: project.id, name: project.name, files, active, folders, open,
    revision: Number.isSafeInteger(project.revision) && Number(project.revision) >= 0 ? Number(project.revision) : 1,
    remoteRevision: Number.isSafeInteger(project.remoteRevision) && Number(project.remoteRevision) >= 0 ? Number(project.remoteRevision) : 0 };
}
export function loadProject(): ProjectState {
  const native = typeof window !== "undefined" ? window.ynxDesktopWorkspace : undefined;
  const restored = restoreProject(native?.initialProject);
  let local: ProjectState | null = null;
  try { local = restoreProject(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { /* Recover from the app snapshot when browser storage is unavailable. */ }
  if (restored) return local?.id === restored.id && local.revision >= restored.revision ? local : restored;
  return local || initial;
}
export async function saveProject(project: ProjectState): Promise<void> {
  const snapshot = restoreProject(project);
  if (!snapshot) throw new Error("Workspace exceeds its safe recovery limits.");
  const native = typeof window !== "undefined" ? window.ynxDesktopWorkspace : undefined;
  // Native acknowledgement is required before the UI reports a durable save.
  if (native) await native.saveProject(snapshot);
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch (error) { if (!native) throw error; }
}
export function validPath(path:string){return path.length>0&&path.length<=240&&!path.startsWith("/")&&!path.includes("..")&&/^[A-Za-z0-9_./ +@-]+$/.test(path)&&!path.split("/").some(part=>!part||part===".");}
export function foldersFromFiles(paths:string[]){const folders=new Set<string>();for(const path of paths){const parts=path.split("/").slice(0,-1);for(let index=1;index<=parts.length;index++)folders.add(parts.slice(0,index).join("/"));}return [...folders].sort();}
