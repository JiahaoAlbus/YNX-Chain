export const PROTOCOL_VERSION = "ynx-code/v1" as const;

export type WorkspaceFile = {
  path: string;
  content: string;
  revision: number;
};

export type WorkspaceSnapshot = {
  protocolVersion: typeof PROTOCOL_VERSION;
  projectId: string;
  revision: number;
  files: Record<string, string>;
};

export type TaskKind = "compile-active" | "build-run-active" | "test" | "check";

export type TaskRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  task: TaskKind;
  projectId: string;
  activePath: string;
  files: Record<string, string>;
  approval: "execute-once";
};

export type TaskResult = {
  protocolVersion: typeof PROTOCOL_VERSION;
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

export type ToolPermission = "read" | "write" | "execute" | "network" | "package" | "git" | "secret" | "deploy";

export type AgentToolCall = {
  runId: string;
  toolCallId: string;
  tool: "read_file" | "write_file" | "edit_file" | "delete_file" | "search_code" | "terminal" | "git" | "browser" | "deploy";
  permissions: ToolPermission[];
  workspaceRevision: number;
  argumentsDigest: string;
};
