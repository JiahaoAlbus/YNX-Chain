import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import {
  createPortPreview,
  revokePortPreview,
  type PortPreviewGrant,
} from "./client";

type Props = {
  open: boolean;
  runtimeId: string;
  projectId: string;
  onOpenChange: (open: boolean) => void;
};

type PreviewScope = Pick<Props, "open" | "runtimeId" | "projectId">;
type OwnedPreview = { scope: PreviewScope; grant: PortPreviewGrant };

export function PortPreviewDialog({ open, runtimeId, projectId, onOpenChange }: Props) {
  const [port, setPort] = useState(3000),
    [grant, setGrant] = useState<PortPreviewGrant>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    grantRef = useRef<OwnedPreview | undefined>(undefined),
    scopeRef = useRef<PreviewScope>({ open, runtimeId, projectId }),
    requestRef = useRef(0),
    liveRef = useRef(true);
  if (scopeRef.current.open !== open || scopeRef.current.runtimeId !== runtimeId || scopeRef.current.projectId !== projectId)
    scopeRef.current = { open, runtimeId, projectId };
  const scope = scopeRef.current;
  const retire = (ownerRuntime: string, previewId: string) =>
    Promise.resolve().then(() => revokePortPreview(ownerRuntime, previewId)).catch(() => {});
  useEffect(() => {
    liveRef.current = true;
    setGrant(undefined);
    setBusy(false);
    setError("");
    return () => {
      if (scopeRef.current === scope) { liveRef.current = false; requestRef.current++; }
      const held = grantRef.current;
      if (held?.scope === scope) {
        grantRef.current = undefined;
        void retire(scope.runtimeId, held.grant.previewId);
      }
    };
  }, [scope]);

  const release = async () => {
    const held = grantRef.current;
    grantRef.current = undefined;
    setGrant(undefined);
    if (held) await retire(held.scope.runtimeId, held.grant.previewId);
  };
  const close = () => {
    if (!liveRef.current || scopeRef.current !== scope || !scope.open) return;
    requestRef.current++;
    // Closing the local UI never waits for a service response. Its exact old
    // grant is retired separately; it cannot close a subsequently opened view.
    void release();
    setBusy(false);
    setError("");
    onOpenChange(false);
  };
  const approve = async () => {
    if (!liveRef.current || scopeRef.current !== scope || !scope.open || !Number.isInteger(port) || port < 1024 || port > 65535) return;
    const request = ++requestRef.current;
    const current = () => liveRef.current && scopeRef.current === scope && requestRef.current === request && scope.open;
    setBusy(true);
    setError("");
    try {
      await release();
      if (!current()) return;
      const next = await createPortPreview(scope.runtimeId, scope.projectId, port);
      if (
        typeof next?.previewId !== "string" || !next.previewId ||
        next.runtimeId !== scope.runtimeId ||
        next.projectId !== scope.projectId ||
        next.port !== port ||
        next.sandbox !== "opaque-origin" ||
        next.network !== "container-loopback-only" ||
        next.maximumResponseBytes !== 1024 * 1024 ||
        !/^\/runtime\/previews\/[A-Za-z0-9_-]{43}\/$/.test(next.url)
      )
        throw new Error("Preview broker returned an invalid capability envelope.");
      if (!current()) {
        await retire(scope.runtimeId, next.previewId);
        return;
      }
      grantRef.current = { scope, grant: next };
      setGrant(next);
      setReload((value) => value + 1);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "Port preview could not open.");
    } finally {
      if (current()) setBusy(false);
    }
  };
  const activeGrant = open && grantRef.current?.scope === scope && grantRef.current.grant === grant ? grant : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(value) => { if (!value) void close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="run-dialog port-preview-dialog">
          <div className="preview-heading">
            <div>
              <Dialog.Title>Preview a container port</Dialog.Title>
              <Dialog.Description>
                Review one unprivileged loopback port. The preview receives a short-lived capability, runs in an opaque-origin iframe, and cannot inherit IDE cookies or authorization headers.
              </Dialog.Description>
            </div>
            <Button variant="ghost" aria-label="Close port preview" onClick={() => void close()}><X size={15} /></Button>
          </div>
          <div className="preview-controls">
            <label>
              Container port
              <input type="number" min="1024" max="65535" value={port} onChange={(event) => setPort(Number(event.target.value))} aria-label="Container preview port" />
            </label>
            <Button variant="default" disabled={busy || !Number.isInteger(port) || port < 1024 || port > 65535} onClick={() => void approve()}>{activeGrant ? "Replace preview grant" : "Approve preview"}</Button>
            {activeGrant && <Button variant="secondary" onClick={() => setReload((value) => value + 1)}><RefreshCcw size={13} /> Reload</Button>}
          </div>
          {activeGrant ? (
            <>
              <div className="honest-boundary">Port {activeGrant.port} · expires {new Date(activeGrant.expiresAt).toLocaleTimeString()} · 1 MiB per response · container loopback only · WebSocket upgrades are not forwarded</div>
              <iframe key={`${activeGrant.previewId}:${reload}`} src={activeGrant.url} title={`Container port ${activeGrant.port} preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-[60vh] min-h-[360px] w-full rounded border border-white/15 bg-white" />
            </>
          ) : (
            <div className="empty-state">Start the application in the selected LXD terminal, then approve its listening port. No network device is added to the container.</div>
          )}
          {error && <div className="collab-error">{error}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
