import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { runtimeHealth, stopTerminalSession, loadWorkspace } from "../runtime/client";

export function TerminalPanel({ output, running }:{output:string;running:boolean}){
  const host=useRef<HTMLDivElement>(null),terminal=useRef<Terminal|null>(null),last=useRef("");
  useEffect(()=>{if(!host.current)return;const instance=new Terminal({convertEol:true,fontFamily:"'SFMono-Regular',Consolas,'Liberation Mono',monospace",fontSize:12,lineHeight:1.35,theme:{background:"#101114",foreground:"#d6d9df",cursor:"#5f8cff",selectionBackground:"#315db480"},disableStdin:true,scrollback:3000});const fit=new FitAddon();instance.loadAddon(fit);instance.open(host.current);fit.fit();terminal.current=instance;const observer=new ResizeObserver(()=>fit.fit());observer.observe(host.current);return()=>{observer.disconnect();instance.dispose();terminal.current=null}},[]);
  useEffect(()=>{const instance=terminal.current;if(!instance)return;if(output.startsWith(last.current))instance.write(output.slice(last.current.length).replaceAll("\n","\r\n"));else{instance.reset();instance.write(output.replaceAll("\n","\r\n"));}last.current=output;if(running)instance.write("\r\n\x1b[38;5;75m● task running…\x1b[0m")},[output,running]);
  return <div ref={host} className="h-full min-h-0 w-full bg-[#101114] p-2" aria-label="Task terminal output" />;
}

export function InteractiveTerminal({ projectId, runtimeId, onWorkspaceSync, onActive }: { projectId: string; runtimeId?: string; onWorkspaceSync: (revision: number) => void; onActive: (active: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null), terminal = useRef<Terminal | null>(null), socket = useRef<WebSocket | null>(null);
  const [generation, setGeneration] = useState(0), [connection, setConnection] = useState<"connecting" | "connected" | "detached" | "stopping" | "stopped" | "recovery">("connecting");
  const storageKey = `ynx-code-terminal:${projectId}:${runtimeId || "local"}`;
  useEffect(() => {
    if (!host.current) return;
    onActive(true);
    const instance = new Terminal({ convertEol: false, fontFamily: "'SFMono-Regular',Consolas,'Liberation Mono',monospace", fontSize: 12, lineHeight: 1.35, theme: { background: "#101114", foreground: "#d6d9df", cursor: "#5f8cff", selectionBackground: "#315db480" }, scrollback: 5000, cursorBlink: true });
    const fit = new FitAddon(); instance.loadAddon(fit); instance.open(host.current); fit.fit(); terminal.current = instance;
    setConnection("connecting"); instance.writeln("YNX Code workspace terminal · connecting…");
    let disposed = false, exited = false, ws: WebSocket | undefined;
    const connect = async () => {
      try {
        await runtimeHealth(); if (disposed) return;
        const scheme = location.protocol === "https:" ? "wss" : "ws", resumeId = localStorage.getItem(storageKey);
        const query = new URLSearchParams({ projectId }); if (runtimeId) query.set("runtimeId", runtimeId); if (resumeId) query.set("sessionId", resumeId);
        ws = new WebSocket(`${scheme}://${location.host}/runtime/terminals?${query}`, "ynx-code-terminal-v1"); socket.current = ws;
        ws.addEventListener("open", () => { fit.fit(); ws?.send(JSON.stringify({ type: "resize", cols: instance.cols, rows: instance.rows })); });
        ws.addEventListener("message", event => {
          if (disposed) return;
          const value = JSON.parse(String(event.data));
          if (value.type === "output" || value.type === "replay") instance.write(value.data);
          else if (value.type === "ready") { localStorage.setItem(storageKey, value.sessionId); setConnection("connected"); instance.writeln(`ready · ${value.sandbox.kind}`); }
          else if (value.type === "workspace-synced") onWorkspaceSync(value.revision);
          else if (value.type === "workspace-sync-conflict") { setConnection("recovery"); instance.writeln(`\r\nWorkspace cleanup ${value.stage || "failed"}: ${value.code} · ${value.message}`); }
          else if (value.type === "exit") { exited = true; localStorage.removeItem(storageKey); setConnection("stopped"); onActive(false); instance.writeln("\r\nTerminal stopped and synchronized."); }
          else if (value.type === "error") { setConnection("recovery"); instance.writeln(value.message); }
        });
        ws.addEventListener("close", event => { if (socket.current === ws) socket.current = null; if (disposed || exited) return; setConnection("detached"); instance.writeln(`\r\nTerminal detached (${event.code}). Use Stop to verify and synchronize this session, or Reconnect.`); });
      } catch (error) { if (!disposed) { setConnection("detached"); instance.writeln(error instanceof Error ? error.message : "Terminal connection failed."); } }
    };
    void connect();
    const input = instance.onData(data => { const active = socket.current; if (active?.readyState === WebSocket.OPEN) active.send(JSON.stringify({ type: "input", data })); });
    const observer = new ResizeObserver(() => { fit.fit(); const active = socket.current; if (active?.readyState === WebSocket.OPEN) active.send(JSON.stringify({ type: "resize", cols: instance.cols, rows: instance.rows })); }); observer.observe(host.current);
    return () => { disposed = true; observer.disconnect(); input.dispose(); ws?.close(); instance.dispose(); terminal.current = null; if (socket.current === ws) socket.current = null; };
  }, [projectId, runtimeId, generation, onWorkspaceSync, onActive, storageKey]);
  const stop = async () => {
    const id = localStorage.getItem(storageKey);
    if (!id) { setConnection("recovery"); terminal.current?.writeln("No admitted session identity. Retry workspace admission or use Remote Explorer."); return; }
    setConnection("stopping");
    try {
      await stopTerminalSession(id);
      const remote = await loadWorkspace(projectId); if (remote) onWorkspaceSync(remote.revision);
      localStorage.removeItem(storageKey); setConnection("stopped"); onActive(false);
      terminal.current?.writeln("\r\nTerminal stopped and synchronized.");
    } catch (error) { setConnection("recovery"); terminal.current?.writeln(error instanceof Error ? error.message : "Stop failed; recovery remains protected."); }
  };
  return <div className="relative h-full min-h-0 w-full bg-[#101114]"><div className="absolute right-3 top-2 z-10 flex gap-1"><button className="rounded border border-white/20 bg-[#20242b] px-2 py-1 text-[11px] text-white" disabled={connection === "connecting" || connection === "stopping"} onClick={() => { if (connection === "stopped") localStorage.removeItem(storageKey); setGeneration(value => value + 1); }}>{connection === "stopped" ? "New terminal" : "Reconnect"}</button><button className="rounded border border-white/20 bg-[#20242b] px-2 py-1 text-[11px] text-white disabled:opacity-40" disabled={connection === "connecting" || connection === "stopped" || connection === "stopping"} onClick={() => void stop()}>{connection === "stopping" ? "Stopping…" : connection === "recovery" ? "Retry Stop" : "Stop"}</button></div><div ref={host} className="h-full min-h-0 w-full p-2" aria-label="Interactive isolated workspace terminal" /></div>;
}
