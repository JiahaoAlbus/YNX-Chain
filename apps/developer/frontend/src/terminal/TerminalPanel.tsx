import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export function TerminalPanel({ output, running }:{output:string;running:boolean}){
  const host=useRef<HTMLDivElement>(null),terminal=useRef<Terminal|null>(null),last=useRef("");
  useEffect(()=>{if(!host.current)return;const instance=new Terminal({convertEol:true,fontFamily:"'SFMono-Regular',Consolas,'Liberation Mono',monospace",fontSize:12,lineHeight:1.35,theme:{background:"#101114",foreground:"#d6d9df",cursor:"#5f8cff",selectionBackground:"#315db480"},disableStdin:true,scrollback:3000});const fit=new FitAddon();instance.loadAddon(fit);instance.open(host.current);fit.fit();terminal.current=instance;const observer=new ResizeObserver(()=>fit.fit());observer.observe(host.current);return()=>{observer.disconnect();instance.dispose();terminal.current=null}},[]);
  useEffect(()=>{const instance=terminal.current;if(!instance)return;if(output.startsWith(last.current))instance.write(output.slice(last.current.length).replaceAll("\n","\r\n"));else{instance.reset();instance.write(output.replaceAll("\n","\r\n"));}last.current=output;if(running)instance.write("\r\n\x1b[38;5;75m● task running…\x1b[0m")},[output,running]);
  return <div ref={host} className="h-full min-h-0 w-full bg-[#101114] p-2" aria-label="Task terminal output" />;
}
