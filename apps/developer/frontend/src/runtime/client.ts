export type TaskResult = {
  protocolVersion: string;
  taskId: string;
  ok: boolean;
  code: number;
  language: string;
  output: string;
  durationMs: number;
  compiler: { executable: string; version: string };
  sandbox: { kind: string; network: false; writableRoot: string };
  truncated: boolean;
};
export type WorkspaceSnapshot = {
  revision: number;
  updatedAt: string;
  name: string;
  folders: string[];
  files: Record<string, string>;
  open: string[];
  active: string;
};
type StreamEvent =
  | {
      type: "phase";
      phase: string;
      status: "started" | "completed";
      code?: number;
    }
  | {
      type: "output";
      phase: string;
      channel: "stdout" | "stderr";
      data: string;
    }
  | { type: "result"; value: TaskResult }
  | { type: "error"; error: string; code: string };
export async function runActive(
  projectId: string,
  activePath: string,
  files: Record<string, string>,
  onEvent?: (event: StreamEvent) => void,
): Promise<TaskResult> {
  const body = JSON.stringify({
    protocolVersion: "ynx-code/v1",
    task: "build-run-active",
    projectId,
    activePath,
    files,
    approval: "execute-once",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("/runtime/tasks/stream", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    if (!response.ok) {
      const value = await response
        .json()
        .catch(() => ({ error: `Runtime returned HTTP ${response.status}` }));
      throw new Error(value.error || "Workspace task failed.");
    }
    if (!response.body)
      throw new Error("Workspace runtime did not provide an output stream.");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      result: TaskResult | undefined;
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        onEvent?.(event);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result") result = event.value;
      }
      if (done) break;
    }
    if (!result)
      throw new Error("Workspace task ended without a signed result envelope.");
    return result;
  }
  throw new Error("Workspace session could not be established.");
}
export async function runtimeHealth() {
  const response = await fetch("/runtime/health", {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Workspace runtime unavailable");
  return response.json();
}
export async function loadWorkspace(
  projectId: string,
): Promise<WorkspaceSnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(
      `/runtime/workspaces/${encodeURIComponent(projectId)}`,
      { credentials: "same-origin" },
    );
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    if (response.status === 404) return null;
    const value = await response
      .json()
      .catch(() => ({ error: `Workspace returned HTTP ${response.status}` }));
    if (!response.ok)
      throw new Error(value.error || "Workspace could not be loaded.");
    return value.workspace;
  }
  throw new Error("Workspace session could not be established.");
}
export async function saveWorkspace(
  projectId: string,
  expectedRevision: number,
  workspace: Omit<WorkspaceSnapshot, "revision" | "updatedAt">,
): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    `/runtime/workspaces/${encodeURIComponent(projectId)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "ynx-code/v1",
        expectedRevision,
        idempotencyKey: crypto.randomUUID(),
        workspace,
      }),
    },
  );
  const value = await response
    .json()
    .catch(() => ({ error: `Workspace returned HTTP ${response.status}` }));
  if (!response.ok)
    throw Object.assign(
      new Error(value.error || "Workspace could not be saved."),
      { code: value.code, currentRevision: value.currentRevision },
    );
  return value.workspace;
}
export async function languageRequest(
  language: "cpp" | "typescript" | "python" | "go" | "rust",
  files: Record<string, string>,
  activePath: string,
  operation:
    | "completion"
    | "definition"
    | "references"
    | "rename"
    | "format"
    | "diagnostics",
  position?: { line: number; character: number },
  newName?: string,
) {
  const body = JSON.stringify({
    protocolVersion: "ynx-code/v1",
    files,
    activePath,
    operation,
    position,
    newName,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`/runtime/language/${language}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response.json().catch(() => ({
      error: `Language service returned HTTP ${response.status}`,
    }));
    if (!response.ok)
      throw new Error(value.error || "Language request failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}
export function cppLanguageRequest(files:Record<string,string>,activePath:string,operation:"completion"|"definition"|"references"|"rename"|"format"|"diagnostics",position?:{line:number;character:number},newName?:string){return languageRequest("cpp",files,activePath,operation,position,newName)}

export type GitChange = {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
};
export type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};
export type GitStatus = {
  protocolVersion: string;
  initialized: boolean;
  branch: string | null;
  changes: GitChange[];
  commits: GitCommit[];
  replayed?: boolean;
};
export async function gitStatus(projectId: string): Promise<GitStatus> {
  return gitFetch(projectId);
}
export async function gitMutation(
  projectId: string,
  body: Record<string, unknown>,
): Promise<GitStatus> {
  return gitFetch(projectId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code-git-v1", ...body }),
  });
}
export async function gitDiff(
  projectId: string,
  path: string,
  scope: "working" | "staged",
) {
  const query = new URLSearchParams({ view: "diff", path, scope }),
    value = await gitFetch(projectId, {}, query);
  return String(value.diff || "");
}
async function gitFetch(
  projectId: string,
  init: RequestInit = {},
  query?: URLSearchParams,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(
      `/runtime/git/${encodeURIComponent(projectId)}${query ? `?${query}` : ""}`,
      { credentials: "same-origin", ...init },
    );
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response
      .json()
      .catch(() => ({ error: `Git service returned HTTP ${response.status}` }));
    if (!response.ok) throw new Error(value.error || "Git operation failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}

export type ExtensionManifest = {
  apiVersion: "ynx-code-extension/v1";
  kind: "declarative-web";
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  contributes: {
    languages: Array<{ id: string; aliases: string[]; extensions: string[] }>;
    snippets: Array<{
      language: string;
      label: string;
      prefix: string;
      body: string[];
      description: string;
    }>;
    themes: Array<{
      id: string;
      label: string;
      type: "light" | "dark";
      colors: Record<string, string>;
    }>;
  };
};
export type InstalledExtension = {
  id: string;
  version: string;
  digest: string;
  manifest: ExtensionManifest;
  installedAt: string;
};
export async function loadExtensions(): Promise<InstalledExtension[]> {
  const value = await extensionFetch();
  return value.extensions || [];
}
export async function installExtension(
  manifest: unknown,
): Promise<InstalledExtension> {
  const value = await extensionFetch({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code-extension/v1",
      manifest,
    }),
  });
  return value.extension;
}
export async function uninstallExtension(id: string): Promise<void> {
  await extensionFetch({ method: "DELETE" }, new URLSearchParams({ id }));
}
async function extensionFetch(
  init: RequestInit = {},
  query?: URLSearchParams,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(
      `/runtime/extensions${query ? `?${query}` : ""}`,
      { credentials: "same-origin", ...init },
    );
    if (response.status === 401 && attempt === 0) {
      await runtimeHealth();
      continue;
    }
    const value = await response
      .json()
      .catch(() => ({
        error: `Extension registry returned HTTP ${response.status}`,
      }));
    if (!response.ok)
      throw new Error(value.error || "Extension operation failed.");
    return value;
  }
  throw new Error("Workspace session could not be established.");
}

export type ModelCatalog={hosted:{model:string;available:boolean};bringYourOwnKey:Array<{id:string;label:string;defaultModel:string}>};
export type AgentRun={runId:string;projectId:string;status:string;provider:string;model:string;workspaceRevision:number;plan:{summary:string;steps:Array<{title:string;acceptance:string}>;contextPaths:string[]}|null;approvedPaths:string[];proposal:{summary:string;files:Array<{path:string;content:string}>}|null;review:{approved:boolean;summary:string;findings:string[]}|null};
export async function loadModelCatalog():Promise<ModelCatalog>{return agentFetch("/runtime/models")}
export async function createAgentRun(body:Record<string,unknown>):Promise<AgentRun>{const value=await agentFetch("/runtime/agent/runs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-agent/v1",...body})});return value.run}
export async function agentAction(runId:string,body:Record<string,unknown>):Promise<AgentRun>{const value=await agentFetch(`/runtime/agent/runs/${encodeURIComponent(runId)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-agent/v1",...body})});return value.run}
async function agentFetch(path:string,init:RequestInit={}):Promise<any>{for(let attempt=0;attempt<2;attempt++){const response=await fetch(path,{credentials:"same-origin",...init});if(response.status===401&&attempt===0){await runtimeHealth();continue}const value=await response.json().catch(()=>({error:`Agent service returned HTTP ${response.status}`}));if(!response.ok)throw new Error(value.error||"Agent operation failed.");return value}throw new Error("Workspace session could not be established.")}
export async function indexProjectMemory(projectId:string,expectedRevision:number){return agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-memory/v1",expectedRevision})})}
export async function searchProjectMemory(projectId:string,query:string){return agentFetch(`/runtime/memory/${encodeURIComponent(projectId)}?${new URLSearchParams({q:query,limit:"8"})}`)}
