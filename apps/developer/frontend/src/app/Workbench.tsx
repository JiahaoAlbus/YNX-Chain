import * as Dialog from "@radix-ui/react-dialog";
import {
  Braces,
  Bug,
  ChevronDown,
  Files,
  GitBranch,
  Play,
  Save,
  Search,
  Settings,
  Sparkles,
  SplitSquareHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../components/ui/button";
import { DebugPanel } from "../debug/DebugPanel";
import { languageForPath } from "../editor/languages";
import { ExtensionPanel } from "../extensions/ExtensionPanel";
import { FileExplorer } from "../explorer/FileExplorer";
import {
  loadWorkspace,
  loadExtensions,
  runActive,
  runtimeHealth,
  saveWorkspace,
  type InstalledExtension,
} from "../runtime/client";
import {
  loadProject,
  saveProject,
  validPath,
  type ProjectState,
} from "../state/workspace";
import { SourceControlPanel } from "../scm/SourceControlPanel";
import { InteractiveTerminal, TerminalPanel } from "../terminal/TerminalPanel";

const CodeEditor = lazy(() => import("../editor/CodeEditor"));
type View = "files" | "search" | "source" | "run" | "extensions" | "agent";
const activity: [View, React.ReactNode, string][] = [
  ["files", <Files />, "Explorer"],
  ["search", <Search />, "Search"],
  ["source", <GitBranch />, "Source Control"],
  ["run", <Bug />, "Run and Debug"],
  ["extensions", <Braces />, "Extensions"],
  ["agent", <Sparkles />, "AI Engineer"],
];

export function Workbench() {
  const [project, setProject] = useState<ProjectState>(() => loadProject()),
    [view, setView] = useState<View>("files"),
    [dirty, setDirty] = useState<Set<string>>(new Set()),
    [bottom, setBottom] = useState<"task" | "terminal" | "problems">(
      "terminal",
    ),
    [output, setOutput] = useState("YNX Code task output\n"),
    [running, setRunning] = useState(false),
    [runtime, setRuntime] = useState("checking"),
    [split, setSplit] = useState(false),
    [diff] = useState<{ path: string; base: string } | null>(null),
    [palette, setPalette] = useState(false),
    [runReview, setRunReview] = useState(false),
    [theme, setTheme] = useState<"light" | "dark">(() =>
      localStorage.getItem("ynx-code-theme") === "light" ? "light" : "dark",
    ),
    [search, setSearch] = useState(""),
    [hydrated, setHydrated] = useState(false),
    [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({}),
    [debugLine, setDebugLine] = useState<number>(),
    [extensions, setExtensions] = useState<InstalledExtension[]>([]),
    [extensionTheme, setExtensionTheme] = useState(
      () => localStorage.getItem("ynx-extension-theme") || "",
    );
  const lastSynced = useRef("");
  const workspace = useMemo(
      () => ({
        name: project.name,
        folders: project.folders,
        files: project.files,
        open: project.open,
        active: project.active,
      }),
      [
        project.name,
        project.folders,
        project.files,
        project.open,
        project.active,
      ],
    ),
    workspaceKey = useMemo(() => JSON.stringify(workspace), [workspace]);
  const languageOf = useCallback(
    (path: string) => {
      const lower = path.toLowerCase();
      for (const extension of extensions)
        for (const contribution of extension.manifest.contributes.languages)
          if (
            contribution.extensions.some((suffix) =>
              lower.endsWith(suffix.toLowerCase()),
            )
          )
            return contribution.id;
      return languageForPath(path);
    },
    [extensions],
  );
  useEffect(() => {
    saveProject(project);
  }, [project]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ynx-code-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("ynx-extension-theme", extensionTheme);
    const selected = extensions
        .flatMap((extension) =>
          extension.manifest.contributes.themes.map((value) => ({
            extension,
            value,
          })),
        )
        .find(
          ({ extension, value }) =>
            `${extension.id}/${value.id}` === extensionTheme,
        ),
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
    for (const variable of Object.values(mapping))
      style.removeProperty(variable);
    if (selected)
      for (const [key, value] of Object.entries(selected.value.colors)) {
        const variable = mapping[key as keyof typeof mapping];
        if (variable) style.setProperty(variable, value);
      }
    return () => {
      for (const variable of Object.values(mapping))
        style.removeProperty(variable);
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
        setRuntime(
          health.sandboxReady ? "sandbox ready" : "sandbox unavailable",
        );
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
      } catch {
        if (!cancelled) {
          setRuntime("runtime offline");
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!hydrated || workspaceKey === lastSynced.current) return;
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
        .catch((error) =>
          setRuntime(
            error?.code === "revision_conflict"
              ? "save conflict"
              : "save unavailable",
          ),
        );
    }, 700);
    return () => clearTimeout(timer);
  }, [hydrated, project.id, project.remoteRevision, workspace, workspaceKey]);
  const activeContent = project.files[project.active] ?? "";
  const second = project.open.find((path) => path !== project.active);
  const open = useCallback(
    (path: string) =>
      setProject((current) => ({
        ...current,
        active: path,
        open: current.open.includes(path)
          ? current.open
          : [...current.open, path],
      })),
    [],
  );
  const update = (value: string | undefined) => {
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
    setDirty((current) => {
      const next = new Set(current);
      next.delete(project.active);
      return next;
    });
  };
  const create = (path: string, kind: "file" | "folder") => {
    if (!validPath(path)) return "Use a safe workspace-relative path.";
    if (project.files[path] !== undefined || project.folders.includes(path))
      return "That path already exists.";
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
                  .map((_, index, parts) =>
                    parts.slice(0, index + 1).join("/"),
                  ),
              ]),
            ].sort(),
          },
    );
    return null;
  };
  const rename = (from: string, to: string, kind: "file" | "folder") => {
    if (!validPath(to)) return "Use a safe workspace-relative path.";
    if (project.files[to] !== undefined || project.folders.includes(to))
      return "That path already exists.";
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
      const rewrite = (path: string) =>
        path === from || path.startsWith(`${from}/`)
          ? `${to}${path.slice(from.length)}`
          : path;
      return {
        ...current,
        revision: current.revision + 1,
        folders: current.folders.map(rewrite),
        files: Object.fromEntries(
          Object.entries(current.files).map(([path, content]) => [
            rewrite(path),
            content,
          ]),
        ),
        active: rewrite(current.active),
        open: current.open.map(rewrite),
      };
    });
    return null;
  };
  const remove = (path: string, kind: "file" | "folder") => {
    if (!confirm(`Move ${path} ${kind} to workspace trash?`)) return;
    setProject((current) => {
      const removed = (item: string) =>
        item === path || (kind === "folder" && item.startsWith(`${path}/`));
      const files = Object.fromEntries(
        Object.entries(current.files).filter(([item]) => !removed(item)),
      );
      const folders = current.folders.filter((item) => !removed(item));
      const open = current.open.filter((item) => !removed(item));
      const active = removed(current.active)
        ? open[0] || Object.keys(files)[0] || ""
        : current.active;
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
        next = lines.includes(line)
          ? lines.filter((value) => value !== line)
          : [...lines, line].sort((a, b) => a - b);
      return { ...current, [project.active]: next };
    });
  const execute = async () => {
    setRunReview(false);
    setRunning(true);
    setBottom("task");
    setOutput((current) => `${current}\n$ ynx task run ${project.active}\n`);
    try {
      const result = await runActive(
        project.id,
        project.active,
        project.files,
        (event) => {
          if (event.type === "phase" && event.status === "started")
            setOutput((current) => `${current}${event.phase}> `);
          if (event.type === "output")
            setOutput((current) => `${current}${event.data}`);
        },
      );
      setOutput(
        (current) =>
          `${current}\n[exit ${result.code}] ${result.compiler.executable} · ${result.durationMs} ms · ${result.sandbox.kind}\n`,
      );
    } catch (error) {
      setOutput(
        (current) =>
          `${current}\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`,
      );
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
  const results = useMemo(() => {
    const query = search.toLowerCase();
    if (!query) return [];
    return Object.entries(project.files)
      .flatMap(([path, content]) =>
        content
          .split("\n")
          .map((line, index) => ({ path, line, index: index + 1 }))
          .filter((item) => item.line.toLowerCase().includes(query)),
      )
      .slice(0, 200);
  }, [project.files, search]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
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
          <button
            onClick={() =>
              setTheme((value) => (value === "dark" ? "light" : "dark"))
            }
          >
            {theme === "dark" ? "Light" : "Dark"} theme
          </button>
        </nav>
        <div className="runtime-state">
          <span className={runtime === "sandbox ready" ? "ready" : ""} />
          {runtime}
        </div>
      </header>
      <aside className="activity" aria-label="Primary activity bar">
        {activity.map(([id, icon, label]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
            title={label}
            aria-label={label}
          >
            {icon}
          </button>
        ))}
        <button className="settings" title="Settings">
          <Settings />
        </button>
      </aside>
      <aside className="sidebar">
        {view === "files" && (
          <FileExplorer
            files={project.files}
            folders={project.folders}
            active={project.active}
            onOpen={open}
            onCreate={create}
            onRename={rename}
            onDelete={remove}
          />
        )}{" "}
        {view === "search" && (
          <section className="side-section">
            <header>
              <strong>SEARCH</strong>
            </header>
            <input
              autoFocus
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files"
            />
            <div className="search-results">
              {results.map((item) => (
                <button
                  key={`${item.path}:${item.index}`}
                  onClick={() => open(item.path)}
                >
                  <strong>
                    {item.path}:{item.index}
                  </strong>
                  <span>{item.line.trim()}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {view === "source" && <SourceControlPanel projectId={project.id} />}
        {view === "run" && (
          <DebugPanel
            projectId={project.id}
            activePath={project.active}
            breakpoints={breakpoints[project.active] || []}
            onStoppedLine={setDebugLine}
          />
        )}
        {view === "extensions" && (
          <ExtensionPanel
            extensions={extensions}
            onChange={setExtensions}
            onApplyTheme={setExtensionTheme}
          />
        )}
        {view === "agent" && (
          <SideStatus
            title="AI SOFTWARE ENGINEER"
            text="The legacy suggestion panel is not treated as an autonomous agent. The permissioned orchestrator must pass its separate tool/audit gate before activation."
          />
        )}
      </aside>
      <main className="main">
        <div className="editor-tabs">
          <div>
            {project.open.map((path) => (
              <button
                key={path}
                className={path === project.active ? "active" : ""}
                onClick={() => open(path)}
              >
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
            <Button
              variant="ghost"
              title="Toggle split editor"
              onClick={() => setSplit((value) => !value)}
            >
              <SplitSquareHorizontal size={14} />
            </Button>
            <Button
              variant="default"
              onClick={() => setRunReview(true)}
              disabled={!project.active || running}
            >
              <Play size={13} /> Run
            </Button>
            <Button variant="ghost">
              <ChevronDown size={13} />
            </Button>
          </div>
        </div>
        <section className={`editors ${split && second ? "split" : ""}`}>
          <Suspense
            fallback={
              <div className="editor-loading">
                Loading Monaco editor engine…
              </div>
            }
          >
            <CodeEditor
              files={project.files}
              activePath={project.active}
              activeContent={activeContent}
              language={languageOf(project.active)}
              theme={theme}
              extensions={extensions}
              extensionTheme={extensionTheme}
              onChange={update}
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
            />
          </Suspense>
        </section>
        <section className="bottom">
          <div className="bottom-tabs">
            <button
              className={bottom === "problems" ? "active" : ""}
              onClick={() => setBottom("problems")}
            >
              PROBLEMS <span>0</span>
            </button>
            <button
              className={bottom === "task" ? "active" : ""}
              onClick={() => setBottom("task")}
            >
              TASK OUTPUT
            </button>
            <button
              className={bottom === "terminal" ? "active" : ""}
              onClick={() => setBottom("terminal")}
            >
              <TerminalSquare size={13} /> TERMINAL
            </button>
            <span className="spacer" />
            {bottom === "task" && (
              <button onClick={() => setOutput("YNX Code task output\n")}>
                Clear
              </button>
            )}
          </div>
          <div className="bottom-body">
            {bottom === "task" ? (
              <TerminalPanel output={output} running={running} />
            ) : bottom === "terminal" ? (
              <InteractiveTerminal
                projectId={project.id}
                onWorkspaceSync={refreshWorkspace}
              />
            ) : (
              <div className="empty-state">
                Diagnostics are provided by the active language server and shown
                inline in the editor.
              </div>
            )}
          </div>
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
      <Dialog.Root open={runReview} onOpenChange={setRunReview}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="run-dialog">
            <Dialog.Title>Build and run active file</Dialog.Title>
            <Dialog.Description>
              Review the exact one-time execution request. Network stays
              disabled and only this workspace is writable.
            </Dialog.Description>
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
function SideStatus({ title, text }: { title: string; text: string }) {
  return (
    <section className="side-section">
      <header>
        <strong>{title}</strong>
      </header>
      <div className="honest-boundary">{text}</div>
    </section>
  );
}
