import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { Button } from "../components/ui/button";
import {
  createCollaborationInvite,
  createCollaborationRoom,
  collaborationAccess,
  redeemCollaborationInvite,
  revokeCollaborationMember,
  runtimeHealth,
  type CollaborationRole,
  type CollaborationMember,
} from "../runtime/client";

type Participant = { clientId: string; role: CollaborationRole; name?: string };
type Chat = {
  clientId: string;
  role: CollaborationRole;
  text: string;
  sentAt: string;
};
type Cursor = { path: string; anchor: number; head: number };
type Props = {
  projectId: string;
  files: Record<string, string>;
  cursor: Cursor;
  onRemoteFiles: (files: Record<string, string>) => void;
  onCheckpoint: (revision: number) => void;
  onAccessChange: (role: CollaborationRole | undefined) => void;
  onSessionChange: (active: boolean) => void;
  onLeave: () => Promise<void>;
};
const WRITERS = new Set<CollaborationRole>(["owner", "editor"]);

export function CollaborationPanel({
  projectId,
  files,
  cursor,
  onRemoteFiles,
  onCheckpoint,
  onAccessChange,
  onSessionChange,
  onLeave,
}: Props) {
  const [roomId, setRoomId] = useState(
      () => localStorage.getItem(`ynx-code-room:${projectId}`) || "",
    ),
    [role, setRole] = useState<CollaborationRole>(),
    [status, setStatus] = useState(roomId ? "reconnecting" : "not shared"),
    [inviteRole, setInviteRole] =
      useState<Exclude<CollaborationRole, "owner">>("editor"),
    [invite, setInvite] = useState<{ token: string; expiresAt: string }>(),
    [joinToken, setJoinToken] = useState(""),
    [participants, setParticipants] = useState<Participant[]>([]),
    [members, setMembers] = useState<CollaborationMember[]>([]),
    [chat, setChat] = useState<Chat[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [reconnectTick, setReconnectTick] = useState(0);
  const socket = useRef<WebSocket | null>(null),
    document = useRef<Y.Doc | null>(null),
    connected = useRef(false),
    remoteCallback = useRef(onRemoteFiles),
    checkpointCallback = useRef(onCheckpoint),
    accessCallback = useRef(onAccessChange),
    sessionCallback = useRef(onSessionChange),
    cursorRef = useRef(cursor);
  remoteCallback.current = onRemoteFiles;
  checkpointCallback.current = onCheckpoint;
  accessCallback.current = onAccessChange;
  sessionCallback.current = onSessionChange;
  cursorRef.current = cursor;

  useEffect(() => {
    if (roomId) localStorage.setItem(`ynx-code-room:${projectId}`, roomId);
    else localStorage.removeItem(`ynx-code-room:${projectId}`);
  }, [projectId, roomId]);
  useEffect(() => {
    sessionCallback.current(Boolean(roomId));
    if (!roomId) {
      setStatus("not shared");
      setRole(undefined);
      setParticipants([]);
      setMembers([]);
      connected.current = false;
      accessCallback.current(undefined);
      return;
    }
    let disposed = false,
      retry: ReturnType<typeof setTimeout> | undefined;
    const doc = new Y.Doc();
    document.current = doc;
    const publish = (update: Uint8Array, origin: unknown) => {
      if (
        origin !== "local-ui" ||
        socket.current?.readyState !== WebSocket.OPEN
      )
        return;
      socket.current.send(
        JSON.stringify({ type: "update", update: toBase64(update) }),
      );
    };
    doc.on("update", publish);
    (async () => {
      try {
        await runtimeHealth();
        const access = await collaborationAccess(roomId);
        if (disposed) return;
        setRole(access.role);
        setMembers(access.members || []);
        const scheme = location.protocol === "https:" ? "wss" : "ws",
          ws = new WebSocket(
            `${scheme}://${location.host}/runtime/collaboration?roomId=${encodeURIComponent(roomId)}`,
            "ynx-code-collaboration-v1",
          );
        socket.current = ws;
        ws.addEventListener("message", (event) => {
          const value = JSON.parse(String(event.data));
          if (value.type === "ready") {
            Y.applyUpdate(doc, fromBase64(value.update), "remote");
            setRole(value.role);
            accessCallback.current(value.role);
            setParticipants(
              value.participants || [
                { clientId: value.clientId, role: value.role },
              ],
            );
            setStatus("connected");
            setError("");
            connected.current = true;
            remoteCallback.current(readFiles(doc));
            if (cursorRef.current.path)
              ws.send(
                JSON.stringify({
                  type: "presence",
                  ...cursorRef.current,
                  name: "YNX collaborator",
                }),
              );
          } else if (value.type === "access-revoked") {
            setError("Your collaboration access was revoked.");
            setRoomId("");
          } else if (value.type === "update") {
            Y.applyUpdate(doc, fromBase64(value.update), "remote");
            remoteCallback.current(readFiles(doc));
          } else if (value.type === "presence") {
            setParticipants((current) =>
              value.action === "leave"
                ? current.filter((item) => item.clientId !== value.clientId)
                : upsert(current, {
                    clientId: value.clientId,
                    role: value.role || "viewer",
                    name: value.name,
                  }),
            );
            if (value.action === "join" && access.role === "owner")
              collaborationAccess(roomId)
                .then((next) => setMembers(next.members || []))
                .catch(() => {});
          } else if (value.type === "chat")
            setChat((current) => [...current, value].slice(-100));
          else if (value.type === "checkpoint") {
            checkpointCallback.current(value.revision);
            setStatus(`checkpoint r${value.revision}`);
          } else if (value.type === "error")
            setError(value.message || "Collaboration operation failed.");
        });
        ws.addEventListener("close", (event) => {
          if (disposed) return;
          connected.current = false;
          if (event.code === 4003) {
            setError("Your collaboration access was revoked.");
            setRoomId("");
            return;
          }
          setStatus("reconnecting");
          retry = setTimeout(
            () => setReconnectTick((value) => value + 1),
            1500,
          );
        });
        ws.addEventListener("error", () =>
          setError("Collaboration connection failed."),
        );
      } catch (value) {
        if (!disposed) {
          const denied =
            typeof value === "object" &&
            value !== null &&
            "code" in value &&
            (value as { code?: string }).code === "collaboration_forbidden";
          setError(
            denied
              ? "Your collaboration access is no longer active."
              : value instanceof Error
                ? value.message
                : "Collaboration connection failed.",
          );
          if (denied) setRoomId("");
          else {
            setStatus("reconnecting");
            retry = setTimeout(
              () => setReconnectTick((value) => value + 1),
              1500,
            );
          }
        }
      }
    })();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      doc.off("update", publish);
      doc.destroy();
      document.current = null;
      socket.current?.close();
      socket.current = null;
      connected.current = false;
    };
  }, [roomId, reconnectTick]);
  useEffect(() => {
    const doc = document.current;
    if (!doc || !connected.current || !role || !WRITERS.has(role)) return;
    doc.transact(() => {
      const paths = doc.getMap<boolean>("paths"),
        next = new Set(Object.keys(files));
      for (const path of [...paths.keys()])
        if (!next.has(path)) paths.delete(path);
      for (const [path, content] of Object.entries(files)) {
        paths.set(path, true);
        const text = doc.getText(`file:${path}`);
        if (text.toString() !== content) {
          text.delete(0, text.length);
          text.insert(0, content);
        }
      }
    }, "local-ui");
  }, [files, role]);
  useEffect(() => {
    if (socket.current?.readyState === WebSocket.OPEN && cursor.path)
      socket.current.send(
        JSON.stringify({
          type: "presence",
          ...cursor,
          name: "YNX collaborator",
        }),
      );
  }, [cursor, roomId]);

  const create = async () => {
      try {
        setError("");
        const value = await createCollaborationRoom(projectId);
        setRoomId(value.roomId);
        setRole(value.role);
      } catch (value) {
        setError(
          value instanceof Error ? value.message : "Room creation failed.",
        );
      }
    },
    join = async () => {
      try {
        setError("");
        const value = await redeemCollaborationInvite(joinToken.trim());
        setJoinToken("");
        setRoomId(value.roomId);
        setRole(value.role);
      } catch (value) {
        setError(
          value instanceof Error
            ? value.message
            : "Invitation could not be redeemed.",
        );
      }
    },
    makeInvite = async () => {
      if (!roomId) return;
      try {
        setError("");
        setInvite(await createCollaborationInvite(roomId, inviteRole, 60));
      } catch (value) {
        setError(
          value instanceof Error
            ? value.message
            : "Invitation could not be created.",
        );
      }
    },
    revoke = async (member: CollaborationMember) => {
      if (
        !window.confirm(
          `Revoke ${member.subjectId} from this collaboration room?`,
        )
      )
        return;
      try {
        const value = await revokeCollaborationMember(roomId, member.subjectId);
        setMembers(value.members);
      } catch (value) {
        setError(
          value instanceof Error
            ? value.message
            : "Collaborator could not be revoked.",
        );
      }
    },
    sendChat = () => {
      if (!message.trim() || socket.current?.readyState !== WebSocket.OPEN)
        return;
      socket.current.send(
        JSON.stringify({ type: "chat", text: message.trim() }),
      );
      setMessage("");
    },
    checkpoint = () =>
      socket.current?.send(JSON.stringify({ type: "checkpoint" })),
    leave = async () => {
      try {
        await onLeave();
        socket.current?.close();
        setRoomId("");
        setInvite(undefined);
      } catch (value) {
        setError(
          value instanceof Error
            ? value.message
            : "Could not restore the last checkpoint.",
        );
      }
    };
  return (
    <section className="side-section collaboration-panel">
      <header>
        <strong>COLLABORATION</strong>
        <span className={status === "connected" ? "collab-online" : ""}>
          {status}
        </span>
      </header>
      {!roomId ? (
        <div className="collab-start">
          <p>
            Create a CRDT room for this workspace or redeem a single-use
            invitation. Every participant still needs a signed product session.
          </p>
          <Button onClick={create}>Share this workspace</Button>
          <label>
            Invitation token
            <input
              value={joinToken}
              onChange={(event) => setJoinToken(event.target.value)}
              placeholder="Paste 43-character token"
            />
          </label>
          <Button
            variant="secondary"
            disabled={joinToken.trim().length !== 43}
            onClick={join}
          >
            Join workspace
          </Button>
        </div>
      ) : (
        <>
          <div className="collab-summary">
            <strong>{role?.toUpperCase()}</strong>
            <code>{roomId}</code>
            <Button variant="ghost" onClick={leave}>
              Disconnect
            </Button>
          </div>
          {role === "owner" && (
            <>
              <div className="collab-invite">
                <label>
                  Invite role
                  <select
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(
                        event.target.value as Exclude<
                          CollaborationRole,
                          "owner"
                        >,
                      )
                    }
                  >
                    <option value="editor">Editor</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="viewer">Viewer</option>
                    <option value="terminal">Terminal collaborator</option>
                  </select>
                </label>
                <Button onClick={makeInvite}>Create one-time invite</Button>
                {invite && (
                  <div className="invite-token">
                    <code>{invite.token}</code>
                    <span>
                      Expires {new Date(invite.expiresAt).toLocaleTimeString()}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        navigator.clipboard.writeText(invite.token)
                      }
                    >
                      Copy token
                    </Button>
                  </div>
                )}
              </div>
              <div className="collab-members">
                <strong>ACCESS · {members.length}</strong>
                {members.map((member) => (
                  <div key={member.subjectId}>
                    <span>{member.subjectId}</span>
                    <em>{member.role}</em>
                    {member.role !== "owner" && (
                      <Button variant="ghost" onClick={() => revoke(member)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="collab-people">
            <strong>ONLINE · {participants.length}</strong>
            {participants.map((item) => (
              <div key={item.clientId}>
                <i />
                <span>{item.name || item.clientId.slice(0, 8)}</span>
                <em>{item.role}</em>
              </div>
            ))}
          </div>
          <div className="collab-chat">
            <strong>ROOM CHAT</strong>
            <div>
              {chat.length ? (
                chat.map((item, index) => (
                  <p key={`${item.clientId}:${item.sentAt}:${index}`}>
                    <b>{item.role}</b> {item.text}
                  </p>
                ))
              ) : (
                <p className="muted">No messages yet.</p>
              )}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendChat();
              }}
            >
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Message collaborators"
              />
              <Button type="submit" disabled={!message.trim()}>
                Send
              </Button>
            </form>
          </div>
          {role && WRITERS.has(role) && (
            <Button variant="default" onClick={checkpoint}>
              Checkpoint shared changes
            </Button>
          )}
        </>
      )}
      {error && <div className="collab-error">{error}</div>}
      <div className="honest-boundary">
        Text updates are CRDT merged. Presence is ephemeral. Disconnected rooms
        retry after 1.5 seconds and revalidate durable access first. Terminal
        input remains separately permissioned and off by default.
      </div>
    </section>
  );
}

function readFiles(document: Y.Doc) {
  const output: Record<string, string> = {};
  for (const [path, active] of document.getMap<boolean>("paths"))
    if (active === true)
      output[path] = document.getText(`file:${path}`).toString();
  return output;
}
function upsert(values: Participant[], next: Participant) {
  const index = values.findIndex((item) => item.clientId === next.clientId);
  return index < 0
    ? [...values, next]
    : values.map((item, at) => (at === index ? { ...item, ...next } : item));
}
function toBase64(value: Uint8Array) {
  let binary = "";
  for (let index = 0; index < value.length; index += 0x8000)
    binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
  return btoa(binary);
}
function fromBase64(value: string) {
  const binary = atob(value),
    output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    output[index] = binary.charCodeAt(index);
  return output;
}
