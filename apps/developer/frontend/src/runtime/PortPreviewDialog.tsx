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

export function PortPreviewDialog({ open, runtimeId, projectId, onOpenChange }: Props) {
  const [port, setPort] = useState(3000),
    [grant, setGrant] = useState<PortPreviewGrant>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    grantRef = useRef<PortPreviewGrant | undefined>(undefined);
  grantRef.current = grant;

  useEffect(
    () => () => {
      const current = grantRef.current;
      if (current) void revokePortPreview(runtimeId, current.previewId).catch(() => {});
    },
    [runtimeId],
  );

  const release = async () => {
    const current = grantRef.current;
    grantRef.current = undefined;
    setGrant(undefined);
    if (current) await revokePortPreview(runtimeId, current.previewId).catch(() => {});
  };
  const close = async () => {
    await release();
    setError("");
    onOpenChange(false);
  };
  const approve = async () => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return;
    setBusy(true);
    setError("");
    try {
      await release();
      const next = await createPortPreview(runtimeId, projectId, port);
      if (
        next.runtimeId !== runtimeId ||
        next.projectId !== projectId ||
        next.port !== port ||
        next.sandbox !== "opaque-origin" ||
        next.network !== "container-loopback-only" ||
        next.maximumResponseBytes !== 1024 * 1024 ||
        !/^\/runtime\/previews\/[A-Za-z0-9_-]{43}\/$/.test(next.url)
      )
        throw new Error("Preview broker returned an invalid capability envelope.");
      grantRef.current = next;
      setGrant(next);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Port preview could not open.");
    } finally {
      setBusy(false);
    }
  };

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
            <Button variant="default" disabled={busy || !Number.isInteger(port) || port < 1024 || port > 65535} onClick={() => void approve()}>{grant ? "Replace preview grant" : "Approve preview"}</Button>
            {grant && <Button variant="secondary" onClick={() => setReload((value) => value + 1)}><RefreshCcw size={13} /> Reload</Button>}
          </div>
          {grant ? (
            <>
              <div className="honest-boundary">Port {grant.port} · expires {new Date(grant.expiresAt).toLocaleTimeString()} · 1 MiB per response · container loopback only · WebSocket upgrades are not forwarded</div>
              <iframe key={`${grant.previewId}:${reload}`} src={grant.url} title={`Container port ${grant.port} preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-[60vh] min-h-[360px] w-full rounded border border-white/15 bg-white" />
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
