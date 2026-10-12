export type NativeSession = { sessionId: string; projectId: string; status: string; failure: string | null; launchURL?: string };

// A catalog may describe an in-flight/recovered runtime, but only a running
// exact session can enter the parent's one-use identity exchange. Never open
// an executor URL, token-bearing URL or a locator from another project.
export function editorEntry(session: NativeSession, projectId: string): string | undefined {
  if (session.projectId !== projectId || session.status !== "running" || session.failure ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(session.sessionId)) return;
  const entry = `/sso/core-open?sessionId=${session.sessionId}`;
  return session.launchURL === entry ? entry : undefined;
}

export function workspaceStatus(session: NativeSession): string {
  if (session.failure || session.status === "recovery-required") return "Workspace needs recovery";
  if (session.status === "preparing") return "Starting workspace…";
  if (session.status === "stopping") return "Saving and stopping workspace…";
  if (session.status === "running") return "Workspace ready";
  return "Workspace state needs refresh";
}
