import * as Dialog from "@radix-ui/react-dialog";
import { Braces, Bug, Cloud, Files, GitBranch, History, Link2, Play, Save, Search, Settings, Sparkles, SplitSquareHorizontal, TerminalSquare, Users, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { DebugPanel } from "../debug/DebugPanel";
import { languageForPath } from "../editor/languages";
import { ExtensionPanel } from "../extensions/ExtensionPanel";
import { FileExplorer } from "../explorer/FileExplorer";
import { loadChainStatus, loadWorkspace, loadExtensions, runActive, runContainerActive, runtimeHealth, saveWorkspace, type CollaborationRole, type InstalledExtension } from "../runtime/client";
import { loadProject, foldersFromFiles, saveProject, validPath, type ProjectState } from "../state/workspace";
import { SourceControlPanel } from "../scm/SourceControlPanel";
import { InteractiveTerminal, TerminalPanel } from "../terminal/TerminalPanel";
import { AgentPanel } from "../chat/AgentPanel";
import { WorkspaceHistoryPanel } from "../history/WorkspaceHistoryPanel";
import { buildLiteralReplacement } from "../search/literalReplace";

const CodeEditor = lazy(() => import("../editor/CodeEditor"));
const CollaborationPanel = lazy(() =>
  import("../collaboration/CollaborationPanel").then((module) => ({
    default: module.CollaborationPanel,
  })),
);
const RuntimePanel = lazy(() =>
  import("../runtime/RuntimePanel").then((module) => ({
    default: module.RuntimePanel,
  })),
);
const ChainPanel = lazy(() =>
  import("../chain/ChainPanel").then((module) => ({
    default: module.ChainPanel,
  })),
);
type View = "files" | "search" | "source" | "run" | "extensions" | "agent" | "collaboration" | "remote" | "history" | "chain";
const activity: [View, React.ReactNode, string][] = [
  ["files", <Files />, "Explorer"],
  ["search", <Search />, "Search"],
  ["source", <GitBranch />, "Source Control"],
  ["run", <Bug />, "Run and Debug"],
  ["extensions", <Braces />, "Extensions"],
  ["agent", <Sparkles />, "AI Engineer"],
  ["collaboration", <Users />, "Collaboration"],
  ["remote", <Cloud />, "Remote Explorer"],
  ["history", <History />, "Workspace History"],
  ["chain", <Link2 />, "YNX Chain"],
];
type EditorPreferences = {
  fontSize: number;
  minimap: boolean;
  wordWrap: "off" | "on";
  autoSave: boolean;
  autoSaveDelay: number;
};
const defaultEditorPreferences: EditorPreferences = { fontSize: 13, minimap: true, wordWrap: "off", autoSave: true, autoSaveDelay: 700 };
function loadEditorPreferences(): EditorPreferences {
  try {
    const value = JSON.parse(localStorage.getItem("ynx-code-editor-preferences/v1") || "null");
    return {
      fontSize: Number.isInteger(value?.fontSize) ? Math.max(10, Math.min(24, value.fontSize)) : 13,
      minimap: typeof value?.minimap === "boolean" ? value.minimap : true,
      wordWrap: value?.wordWrap === "on" ? "on" : "off",
      autoSave: typeof value?.autoSave === "boolean" ? value.autoSave : true,
      autoSaveDelay: Number.isInteger(value?.autoSaveDelay) ? Math.max(300, Math.min(5000, value.autoSaveDelay)) : 700,
    };
  } catch {
    return defaultEditorPreferences;
  }
}
async function sha256Text(content: string) {
  const bytes = new TextEncoder().encode(content),
    digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function verifiedBuildArtifacts(
  artifacts: {
    path: string;
    bytes: number;
    sha256: string;
    content?: string;
  }[],
) {
  const files: Record<string, string> = {};
  let total = 0;
  for (const artifact of artifacts) {
    if (!artifact.path.startsWith(".ynx-build/") || !validPath(artifact.path) || typeof artifact.content !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("Compiler returned an invalid build artifact envelope.");
    const bytes = new TextEncoder().encode(artifact.content);
    total += bytes.byteLength;
    if (bytes.byteLength !== artifact.bytes || bytes.byteLength > 2 * 1024 * 1024 || total > 8 * 1024 * 1024) throw new Error("Compiler artifact size evidence does not match its bounded content.");
    const digest = await sha256Text(artifact.content);
    if (digest !== artifact.sha256) throw new Error(`Compiler artifact digest mismatch: ${artifact.path}`);
    files[artifact.path] = artifact.content;
  }
  return files;
}

export function Workbench() {
  const [project, setProject] = useState<ProjectState>(() => loadProject()),
    [view, setView] = useState<View>("files"),
    [dirty, setDirty] = useState<Set<string>>(new Set()),
    [bottom, setBottom] = useState<"task" | "terminal" | "problems">("terminal"),
    [output, setOutput] = useState("YNX Code task output\n"),
    [running, setRunning] = useState(false),
    [runtime, setRuntime] = useState("connecting"),
    [connectionBusy, setConnectionBusy] = useState(true),
    [split, setSplit] = useState(false),
    [diff] = useState<{ path: string; base: string } | null>(null),
    [palette, setPalette] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [editorPreferences, setEditorPreferences] = useState(loadEditorPreferences),
    [runReview, setRunReview] = useState(false),
    [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem("ynx-code-theme") === "light" ? "light" : "dark")),
    [search, setSearch] = useState(""),
    [replacement, setReplacement] = useState(""),
    [matchCase, setMatchCase] = useState(false),
    [hydrated, setHydrated] = useState(false),
    [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({}),
    [debugLine, setDebugLine] = useState<number>(),
    [extensions, setExtensions] = useState<InstalledExtension[]>([]),
    [extensionTheme, setExtensionTheme] = useState(() => localStorage.getItem("ynx-extension-theme") || ""),
    [collaborationRole, setCollaborationRole] = useState<CollaborationRole>(),
    [collaborationSession, setCollaborationSession] = useState(() => Boolean(localStorage.getItem(`ynx-code-room:${project.id}`))),
    [collaborationCursor, setCollaborationCursor] = useState({
      path: project.active,
      anchor: 0,
      head: 0,
    });
  const [selectedRuntime, setSelectedRuntime] = useState<string | undefined>(() => localStorage.getItem(`ynx-code-runtime:${project.id}`) || undefined);
  const [collaborationMounted, setCollaborationMounted] = useState(() => Boolean(localStorage.getItem(`ynx-code-room:${project.id}`)));
  const lastSynced = useRef("");
  const reconnect = useCallback(async () => {
    setConnectionBusy(true);
    setRuntime("connecting");
    try {
      const [health, chain] = await Promise.all([runtimeHealth(), loadChainStatus()]);
      if (!health.sandboxReady) throw new Error("Workspace sandbox is unavailable.");
      if (chain.chainId !== 6423 || chain.catchingUp) throw new Error("YNX Testnet identity is not ready.");
      setRuntime(`connected · block ${chain.height}`);
      return true;
    } catch {
      setRuntime("offline · retry");
      return false;
    } finally {
      setConnectionBusy(false);
    }
  }, []);
  const workspace = useMemo(
      () => ({
        name: project.name,
        folders: project.folders,
        files: project.files,
        open: project.open,
        active: project.active,
      }),
      [project.name, project.folders, project.files, project.open, project.active],
    ),
    workspaceKey = useMemo(() => JSON.stringify(workspace), [workspace]);
  const workspaceKeyRef = useRef(workspaceKey);
  workspaceKeyRef.current = workspaceKey;
  const languageOf = useCallback(
    (path: string) => {
      const lower = path.toLowerCase();
      for (const extension of extensions) if (extension.enabled) for (const contribution of extension.manifest.contributes.languages) if (contribution.extensions.some((suffix) => lower.endsWith(suffix.toLowerCase()))) return contribution.id;
      return languageForPath(path);
    },
    [extensions],
  );
  useEffect(() => {
    saveProject(project);
  }, [project]);
  useEffect(() => {
    const key = `ynx-code-runtime:${project.id}`;
    if (selectedRuntime) localStorage.setItem(key, selectedRuntime);
    else localStorage.removeItem(key);
  }, [project.id, selectedRuntime]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ynx-code-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("ynx-code-editor-preferences/v1", JSON.stringify(editorPreferences));
  }, [editorPreferences]);
  useEffect(() => {
    localStorage.setItem("ynx-extension-theme", extensionTheme);
    const selected = extensions
        .filter((extension) => extension.enabled)
        .flatMap((extension) =>
          extension.manifest.contributes.themes.map((value) => ({
            extension,
            value,
          })),
        )
        .find(({ extension, value }) => `${extension.id}/${value.id}` === extensionTheme),
      style = document.documentElement.style,
      mapping = {
        background: "--bg",
        panel: "--panel",
        editor: "--editor",
        text: "--text",
        muted: "--muted",
        border: "--border",
        accent: "--blue",
      };
    for (const variable of Object.values(mapping)) style.removeProperty(variable);
    if (selected)
      for (const [key, value] of Object.entries(selected.value.colors)) {
        const variable = mapping[key as keyof typeof mapping];
        if (variable) style.setProperty(variable, value);
      }
    return () => {
      for (const variable of Object.values(mapping)) style.removeProperty(variable);
    };
  }, [extensionTheme, extensions]);
  useEffect(() => {
    loadExtensions()
      .then(setExtensions)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await runtimeHealth();
        if (cancelled) return;
        if (!health.sandboxReady) throw new Error("Workspace sandbox is unavailable.");
        const remote = await loadWorkspace(project.id);
        if (cancelled) return;
        if (remote) {
          const value = {
            ...project,
            name: remote.name,
            folders: remote.folders,
            files: remote.files,
            open: remote.open,
            active: remote.active,
            revision: project.revision + 1,
            remoteRevision: remote.revision,
          };
          lastSynced.current = JSON.stringify({
            name: value.name,
            folders: value.folders,
            files: value.files,
            open: value.open,
            active: value.active,
          });
          setProject(value);
        } else {
          const saved = await saveWorkspace(project.id, 0, workspace);
          if (cancelled) return;
          lastSynced.current = workspaceKey;
          setProject((current) => ({
            ...current,
            remoteRevision: saved.revision,
          }));
        }
        setHydrated(true);
        void reconnect();
      } catch {
        if (!cancelled) {
          setRuntime("offline · retry");
          setConnectionBusy(false);
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reconnect]);
  useEffect(() => {
    const handleOnline = () => void reconnect();
    addEventListener("online", handleOnline);
    return () => removeEventListener("online", handleOnline);
  }, [reconnect]);
  useEffect(() => {
    if (!hydrated || collaborationSession || !editorPreferences.autoSave || workspaceKey === lastSynced.current) return;
    const timer = setTimeout(() => {
      const expected = project.remoteRevision;
      saveWorkspace(project.id, expected, workspace)
        .then((saved) => {
          lastSynced.current = workspaceKey;
          setProject((current) => ({
            ...current,
            remoteRevision: saved.revision,
          }));
        })
        .catch((error) => setRuntime(error?.code === "revision_conflict" ? "save conflict" : "save unavailable"));
    }, editorPreferences.autoSaveDelay);
    return () => clearTimeout(timer);
  }, [collaborationSession, editorPreferences.autoSave, editorPreferences.autoSaveDelay, hydrated, project.id, project.remoteRevision, workspace, workspaceKey]);
  const collaborationReadOnly = Boolean(collaborationRole && !["owner", "editor"].includes(collaborationRole));
  const activeContent = project.files[project.active] ?? "";
  const second = project.open.find((path) => path !== project.active);
  const open = useCallback(
    (path: string) =>
      setProject((current) => ({
        ...current,
        active: path,
        open: current.open.includes(path) ? current.open : [...current.open, path],
      })),
    [],
  );
  const update = (value: string | undefined) => {
    if (collaborationReadOnly) return;
    const content = value ?? "";
    setProject((current) => ({
      ...current,
      revision: current.revision + 1,
      files: { ...current.files, [current.active]: content },
    }));
    setDirty((current) => new Set(current).add(project.active));
  };
  const save = () => {
    saveProject(project);
    const clearActiveDirty = () =>
      setDirty((current) => {
        const next = new Set(current);
        next.delete(project.active);
        return next;
      });
    if (!editorPreferences.autoSave && hydrated && !collaborationSession && workspaceKey !== lastSynced.current) {
      saveWorkspace(project.id, project.remoteRevision, workspace)
        .then((saved) => {
          lastSynced.current = workspaceKey;
          setProject((current) => ({ ...current, remoteRevision: saved.revision }));
          if (workspaceKeyRef.current === workspaceKey) clearActiveDirty();
        })
        .catch((error) => setRuntime(error?.code === "revision_conflict" ? "save conflict" : "save unavailable"));
      return;
    }
    clearActiveDirty();
  };
  const create = (path: string, kind: "file" | "folder") => {
    if (collaborationReadOnly) return "Your collaboration role is read-only.";
    if (!validPath(path)) return "Use a safe workspace-relative path.";
    if (project.files[path] !== undefined || project.folders.includes(path)) return "That path already exists.";
    setProject((current) =>
      kind === "folder"
        ? {
            ...current,
            revision: current.revision + 1,
            folders: [...current.folders, path].sort(),
          }
        : {
            ...current,
            revision: current.revision + 1,
            files: { ...current.files, [path]: "" },
            active: path,
            open: [...current.open, path],
            folders: [
              ...new Set([
                ...current.folders,
                ...path
                  .split("/")
                  .slice(0, -1)
                  .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
              ]),
            ].sort(),
          },
    );
    return null;
  };
  const addGeneratedFile = (path: string, content: string) => {
    if (collaborationReadOnly) return;
    if (!validPath(path)) return;
    if (project.files[path] !== undefined && !confirm(`Replace ${path} with the reviewed template?`)) return;
    setProject((current) => ({
      ...current,
      revision: current.revision + 1,
      files: { ...current.files, [path]: content },
      active: path,
      open: current.open.includes(path) ? current.open : [...current.open, path],
      folders: [
        ...new Set([
          ...current.folders,
          ...path
            .split("/")
            .slice(0, -1)
            .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
        ]),
      ].sort(),
    }));
    setDirty((current) => new Set(current).add(path));
  };
  const rename = (from: string, to: string, kind: "file" | "folder") => {
    if (collaborationReadOnly) return "Your collaboration role is read-only.";
    if (!validPath(to)) return "Use a safe workspace-relative path.";
    if (project.files[to] !== undefined || project.folders.includes(to)) return "That path already exists.";
    setProject((current) => {
      if (kind === "file") {
        const files = { ...current.files, [to]: current.files[from] };
        delete files[from];
        return {
          ...current,
          revision: current.revision + 1,
          files,
          active: current.active === from ? to : current.active,
          open: current.open.map((path) => (path === from ? to : path)),
        };
      }
      const rewrite = (path: string) => (path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path);
      return {
        ...current,
        revision: current.revision + 1,
        folders: current.folders.map(rewrite),
        files: Object.fromEntries(Object.entries(current.files).map(([path, content]) => [rewrite(path), content])),
        active: rewrite(current.active),
        open: current.open.map(rewrite),
      };
    });
    return null;
  };
  const remove = (path: string, kind: "file" | "folder") => {
    if (collaborationReadOnly) return;
    if (!confirm(`Move ${path} ${kind} to workspace trash?`)) return;
    setProject((current) => {
      const removed = (item: string) => item === path || (kind === "folder" && item.startsWith(`${path}/`));
      const files = Object.fromEntries(Object.entries(current.files).filter(([item]) => !removed(item)));
      const folders = current.folders.filter((item) => !removed(item));
      const open = current.open.filter((item) => !removed(item));
      const active = removed(current.active) ? open[0] || Object.keys(files)[0] || "" : current.active;
      return {
        ...current,
        revision: current.revision + 1,
        files,
        folders,
        open,
        active,
      };
    });
  };
  const close = (path: string) =>
    setProject((current) => {
      const open = current.open.filter((item) => item !== path);
      return {
        ...current,
        open,
        active: current.active === path ? open.at(-1) || "" : current.active,
      };
    });
  const toggleBreakpoint = (line: number) =>
    setBreakpoints((current) => {
      const lines = current[project.active] || [],
        next = lines.includes(line) ? lines.filter((value) => value !== line) : [...lines, line].sort((a, b) => a - b);
      return { ...current, [project.active]: next };
    });
  const execute = async () => {
    setRunReview(false);
    setRunning(true);
    setBottom("task");
    setOutput((current) => `${current}\n$ ynx task run ${project.active}\n`);
    try {
      if (selectedRuntime?.startsWith("ssh-")) throw new Error("Remote SSH is open as an editable terminal workspace. Start this task in the remote terminal; one-click remote task execution has not been approved yet.");
      const result = selectedRuntime
        ? await runContainerActive(selectedRuntime, project.id, project.active, project.files)
        : await runActive(project.id, project.active, project.files, (event) => {
            if (event.type === "phase" && event.status === "started") setOutput((current) => `${current}${event.phase}> `);
            if (event.type === "output") setOutput((current) => `${current}${event.data}`);
          });
      if (selectedRuntime) setOutput((current) => `${current}${result.output}`);
      setOutput((current) => `${current}\n[exit ${result.code}] ${result.compiler.executable} · ${result.durationMs} ms · ${result.sandbox.kind}\n`);
      if (result.ok && result.artifacts?.length) {
        const materialized = await verifiedBuildArtifacts(result.artifacts);
        const sourceDigests = Object.fromEntries(
          await Promise.all(
            Object.entries(project.files)
              .filter(([path]) => path.endsWith(".sol"))
              .map(async ([path, content]) => [path, await sha256Text(content)]),
          ),
        );
        materialized[".ynx-build/manifest.json"] = `${JSON.stringify({ protocolVersion: "ynx-code-artifact/v1", taskId: result.taskId, language: result.language, compiler: result.compiler, sourceDigests, artifacts: result.artifacts.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) }, null, 2)}\n`;
        const candidate = { ...project.files, ...materialized },
          candidateBytes = Object.values(candidate).reduce((total, content) => total + new TextEncoder().encode(content).byteLength, 0);
        if (Object.keys(candidate).length > 256 || candidateBytes > 2 * 1024 * 1024) throw new Error("Verified artifacts exceed the persistent workspace's 256-file or 2 MiB boundary. The build remains successful, but the artifacts were not saved.");
        setProject((current) => {
          const files = { ...current.files, ...materialized },
            paths = Object.keys(materialized),
            folders = [...new Set([...current.folders, ...foldersFromFiles(paths)])].sort();
          return { ...current, revision: current.revision + 1, files, folders };
        });
        setDirty((current) => new Set([...current, ...Object.keys(materialized)]));
        setOutput((current) => `${current}[artifacts] verified and saved ${Object.keys(materialized).length} file(s) under .ynx-build\n`);
      }
    } catch (error) {
      setOutput((current) => `${current}\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
    } finally {
      setRunning(false);
    }
  };
  const refreshWorkspace = useCallback(
    async (revision: number) => {
      const remote = await loadWorkspace(project.id);
      if (!remote || remote.revision !== revision) return;
      lastSynced.current = JSON.stringify({
        name: remote.name,
        folders: remote.folders,
        files: remote.files,
        open: remote.open,
        active: remote.active,
      });
      setProject((current) => ({
        ...current,
        name: remote.name,
        folders: remote.folders,
        files: remote.files,
        open: remote.open,
        active: remote.active,
        remoteRevision: remote.revision,
        revision: current.revision + 1,
      }));
    },
    [project.id],
  );
  const applyCollaborativeFiles = useCallback((files: Record<string, string>) => {
    setProject((current) => {
      if (JSON.stringify(current.files) === JSON.stringify(files)) return current;
      const paths = Object.keys(files),
        active = files[current.active] !== undefined ? current.active : paths[0] || "",
        open = current.open.filter((path) => files[path] !== undefined);
      return {
        ...current,
        files,
        folders: foldersFromFiles(paths),
        active,
        open: active && !open.includes(active) ? [...open, active] : open,
        revision: current.revision + 1,
      };
    });
  }, []);
  const leaveCollaboration = useCallback(async () => {
    const remote = await loadWorkspace(project.id);
    if (!remote) return;
    lastSynced.current = JSON.stringify({
      name: remote.name,
      folders: remote.folders,
      files: remote.files,
      open: remote.open,
      active: remote.active,
    });
    setProject((current) => ({
      ...current,
      name: remote.name,
      folders: remote.folders,
      files: remote.files,
      open: remote.open,
      active: remote.active,
      remoteRevision: remote.revision,
      revision: current.revision + 1,
    }));
  }, [project.id]);
  const results = useMemo(() => {
    const query = matchCase ? search : search.toLocaleLowerCase();
    if (!query) return [];
    return Object.entries(project.files)
      .flatMap(([path, content]) =>
        content
          .split("\n")
          .map((line, index) => ({ path, line, index: index + 1 }))
          .filter((item) => (matchCase ? item.line : item.line.toLocaleLowerCase()).includes(query)),
      )
      .slice(0, 200);
  }, [matchCase, project.files, search]);
  const replacementPlan = useMemo(() => buildLiteralReplacement(project.files, search, replacement, matchCase), [matchCase, project.files, replacement, search]);
  const replaceAll = () => {
    if (!replacementPlan.matches || collaborationReadOnly) return;
    if (!window.confirm(`Replace ${replacementPlan.matches} literal match${replacementPlan.matches === 1 ? "" : "es"} across ${replacementPlan.changedPaths.length} file${replacementPlan.changedPaths.length === 1 ? "" : "s"}? The changed files will remain recoverable in Workspace History.`)) return;
    const changed = new Set(replacementPlan.changedPaths);
    setProject((current) => ({
      ...current,
      revision: current.revision + 1,
      files: replacementPlan.files,
    }));
    setDirty((current) => new Set([...current, ...changed]));
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPalette(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        setRunReview(true);
      }
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  });
  const commands = [
    {
      label: "File: New File",
      run: () => {
        setView("files");
        setPalette(false);
      },
    },
    {
      label: "File: Save",
      run: () => {
        save();
        setPalette(false);
      },
    },
    {
      label: "View: Toggle Split Editor",
      run: () => {
        setSplit((value) => !value);
        setPalette(false);
      },
    },
    {
      label: "Task: Build and Run Active File",
      run: () => {
        setRunReview(true);
        setPalette(false);
      },
    },
    {
      label: "View: Toggle Color Theme",
      run: () => {
        setTheme((value) => (value === "dark" ? "light" : "dark"));
        setPalette(false);
      },
    },
    {
      label: "Search: Find in Files",
      run: () => {
        setView("search");
        setPalette(false);
      },
    },
  ];
  return (
    <div className="workbench">
      <header className="titlebar">
        <div className="brand">
          <span className="mark">YX</span>
          <strong>YNX Code</strong>
          <span className="edition">TESTNET</span>
        </div>
        <nav>
          <button onClick={() => setPalette(true)}>Commands</button>
          <button onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}>{theme === "dark" ? "Light" : "Dark"} theme</button>
        </nav>
        <div className="runtime-state" role="status" aria-live="polite">
          <span className={`status-dot ${runtime.startsWith("connected") ? "ready" : ""}`} />
          <span className="runtime-label">{runtime}</span>
          <button type="button" disabled={connectionBusy} onClick={() => void reconnect()}>
            {connectionBusy ? "Connecting" : "Reconnect"}
          </button>
        </div>
      </header>
      <aside className="activity" aria-label="Primary activity bar">
        {activity.map(([id, icon, label]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => {
              setView(id);
              if (id === "collaboration") setCollaborationMounted(true);
            }}
            title={label}
            aria-label={label}
          >
            {icon}
          </button>
        ))}
        <button className="settings" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings />
        </button>
      </aside>
      <aside className="sidebar">
        {view === "files" && <FileExplorer files={project.files} folders={project.folders} active={project.active} onOpen={open} onCreate={create} onRename={rename} onDelete={remove} />}{" "}
        {view === "search" && (
          <section className="side-section">
            <header>
              <strong>SEARCH</strong>
            </header>
            <input autoFocus className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" />
            <div className="replace-controls">
              <input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Replace with" aria-label="Replace with" />
              <label><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /> Match case</label>
              <button type="button" disabled={!replacementPlan.matches || collaborationReadOnly} onClick={replaceAll}>Replace all</button>
              <small>{search ? `${replacementPlan.matches} literal matches in ${replacementPlan.changedPaths.length} files` : "Enter text to preview replacements"}</small>
            </div>
            <div className="search-results">
              {results.map((item) => (
                <button key={`${item.path}:${item.index}`} onClick={() => open(item.path)}>
                  <strong>
                    {item.path}:{item.index}
                  </strong>
                  <span>{item.line.trim()}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {view === "source" && <SourceControlPanel projectId={project.id} revision={project.remoteRevision} onWorkspaceChanged={refreshWorkspace} />}
        {view === "run" && <DebugPanel projectId={project.id} activePath={project.active} breakpoints={breakpoints[project.active] || []} onStoppedLine={setDebugLine} />}
        {view === "extensions" && <ExtensionPanel extensions={extensions} onChange={setExtensions} onApplyTheme={setExtensionTheme} />}
        {view === "agent" && <AgentPanel projectId={project.id} revision={project.remoteRevision} activePath={project.active} onApplied={refreshWorkspace} />}
        {collaborationMounted && (
          <div hidden={view !== "collaboration"} className="collaboration-host">
            <Suspense fallback={<div className="editor-loading">Loading collaboration engine…</div>}>
              <CollaborationPanel projectId={project.id} files={project.files} cursor={collaborationCursor} onRemoteFiles={applyCollaborativeFiles} onCheckpoint={refreshWorkspace} onAccessChange={setCollaborationRole} onSessionChange={setCollaborationSession} onLeave={leaveCollaboration} />
            </Suspense>
          </div>
        )}
        {view === "remote" && (
          <Suspense fallback={<div className="editor-loading">Loading runtime control plane…</div>}>
            <RuntimePanel projectId={project.id} selected={selectedRuntime} onSelect={setSelectedRuntime} />
          </Suspense>
        )}
        {view === "history" && <WorkspaceHistoryPanel projectId={project.id} currentRevision={project.remoteRevision} onRestored={refreshWorkspace} />}
        {view === "chain" && (
          <Suspense fallback={<div className="editor-loading">Connecting to YNX Testnet…</div>}>
            <ChainPanel files={project.files} onAddFile={addGeneratedFile} />
          </Suspense>
        )}
      </aside>
      <main className="main">
        <div className="editor-tabs">
          <div>
            {project.open.map((path) => (
              <button key={path} className={path === project.active ? "active" : ""} onClick={() => open(path)}>
                <span>{path.split("/").pop()}</span>
                {dirty.has(path) && <i />}
                <X
                  size={12}
                  onClick={(event) => {
                    event.stopPropagation();
                    close(path);
                  }}
                />
              </button>
            ))}
          </div>
          <div className="editor-actions">
            <Button variant="ghost" title="Save" onClick={save}>
              <Save size={14} />
            </Button>
            <Button variant="ghost" title="Toggle split editor" onClick={() => setSplit((value) => !value)}>
              <SplitSquareHorizontal size={14} />
            </Button>
            <Button variant="default" onClick={() => setRunReview(true)} disabled={!project.active || running}>
              <Play size={13} /> Run
            </Button>
          </div>
        </div>
        <section className={`editors ${split && second ? "split" : ""}`}>
          <Suspense fallback={<div className="editor-loading">Loading Monaco editor engine…</div>}>
            <CodeEditor
              projectId={project.id}
              runtimeId={selectedRuntime?.startsWith("ssh-") ? undefined : selectedRuntime}
              files={project.files}
              activePath={project.active}
              activeContent={activeContent}
              language={languageOf(project.active)}
              theme={theme}
              extensions={extensions.filter((extension) => extension.enabled)}
              extensionTheme={extensionTheme}
              onChange={update}
              onCursorChange={(path, anchor, head) => setCollaborationCursor({ path, anchor, head })}
              readOnly={collaborationReadOnly}
              breakpoints={breakpoints[project.active] || []}
              debugLine={debugLine}
              onToggleBreakpoint={toggleBreakpoint}
              splitPath={split ? second : undefined}
              splitContent={second ? project.files[second] : undefined}
              splitLanguage={second ? languageOf(second) : undefined}
              onSplitChange={(value) =>
                second &&
                setProject((current) => ({
                  ...current,
                  files: { ...current.files, [second]: value ?? "" },
                }))
              }
              diffBase={diff?.base}
              fontSize={editorPreferences.fontSize}
              minimap={editorPreferences.minimap}
              wordWrap={editorPreferences.wordWrap}
            />
          </Suspense>
        </section>
        <section className="bottom">
          <div className="bottom-tabs">
            <button className={bottom === "problems" ? "active" : ""} onClick={() => setBottom("problems")}>
              PROBLEMS <span>0</span>
            </button>
            <button className={bottom === "task" ? "active" : ""} onClick={() => setBottom("task")}>
              TASK OUTPUT
            </button>
            <button className={bottom === "terminal" ? "active" : ""} onClick={() => setBottom("terminal")}>
              <TerminalSquare size={13} /> TERMINAL
            </button>
            <span className="spacer" />
            {bottom === "task" && <button onClick={() => setOutput("YNX Code task output\n")}>Clear</button>}
          </div>
          <div className="bottom-body">{bottom === "task" ? <TerminalPanel output={output} running={running} /> : bottom === "terminal" ? <InteractiveTerminal projectId={project.id} runtimeId={selectedRuntime} onWorkspaceSync={refreshWorkspace} /> : <div className="empty-state">Diagnostics are provided by the active language server and shown inline in the editor.</div>}</div>
        </section>
        <footer className="statusbar">
          <span>
            <GitBranch size={12} /> main*
          </span>
          <span>{languageOf(project.active)}</span>
          <span>UTF-8</span>
          <span>Spaces: 2</span>
          <span className="grow" />
          <span>YNX Testnet · 6423</span>
        </footer>
      </main>
      <Dialog.Root open={palette} onOpenChange={setPalette}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="palette">
            <Dialog.Title>Command Palette</Dialog.Title>
            {commands.map((command) => (
              <button key={command.label} onClick={command.run}>
                {command.label}
              </button>
            ))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="settings-dialog">
            <Dialog.Title>Editor settings</Dialog.Title>
            <Dialog.Description>These device-local preferences apply immediately and persist across restarts.</Dialog.Description>
            <label>
              <span>Editor font size</span>
              <output>{editorPreferences.fontSize}px</output>
              <input type="range" min="10" max="24" step="1" value={editorPreferences.fontSize} onChange={(event) => setEditorPreferences((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
            </label>
            <label className="settings-toggle">
              <span>Minimap</span>
              <input type="checkbox" checked={editorPreferences.minimap} onChange={(event) => setEditorPreferences((current) => ({ ...current, minimap: event.target.checked }))} />
            </label>
            <label>
              <span>Word wrap</span>
              <select value={editorPreferences.wordWrap} onChange={(event) => setEditorPreferences((current) => ({ ...current, wordWrap: event.target.value === "on" ? "on" : "off" }))}>
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </label>
            <label className="settings-toggle">
              <span>Auto save to workspace service</span>
              <input type="checkbox" checked={editorPreferences.autoSave} onChange={(event) => setEditorPreferences((current) => ({ ...current, autoSave: event.target.checked }))} />
            </label>
            <label>
              <span>Auto-save delay</span>
              <output>{editorPreferences.autoSaveDelay}ms</output>
              <input type="range" min="300" max="5000" step="100" disabled={!editorPreferences.autoSave} value={editorPreferences.autoSaveDelay} onChange={(event) => setEditorPreferences((current) => ({ ...current, autoSaveDelay: Number(event.target.value) }))} />
            </label>
            <div>
              <Button onClick={() => setEditorPreferences(defaultEditorPreferences)}>Reset defaults</Button>
              <Button variant="default" onClick={() => setSettingsOpen(false)}>Done</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={runReview} onOpenChange={setRunReview}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="run-dialog">
            <Dialog.Title>Build and run active file</Dialog.Title>
            <Dialog.Description>Review the exact one-time execution request. Network stays disabled and only this workspace is writable. Successful compiler artifacts are digest-verified before being saved under .ynx-build.</Dialog.Description>
            <pre>
              {JSON.stringify(
                {
                  task: "build-run-active",
                  path: project.active,
                  language: languageOf(project.active),
                  files: Object.keys(project.files).length,
                  approval: "execute-once",
                  network: false,
                },
                null,
                2,
              )}
            </pre>
            <div>
              <Button onClick={() => setRunReview(false)}>Cancel</Button>
              <Button variant="default" onClick={execute}>
                Approve and run once
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
