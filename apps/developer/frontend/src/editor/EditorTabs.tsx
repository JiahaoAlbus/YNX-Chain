import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

type Props = { paths: string[]; active: string; dirty: Set<string>; onOpen(path: string): void; onClose(path: string): void };
export function EditorTabs({ paths, active, dirty, onOpen, onClose }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const reveal = () => element.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, paths.length]);
  return <div ref={strip} className="editor-tab-strip" role="tablist" aria-label="Open files"
    onWheel={event => {
      const element = event.currentTarget;
      if (element.scrollWidth <= element.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      element.scrollLeft += event.deltaY;
    }}>
    {paths.map((path, index) => <div key={path} className={`editor-tab${path === active ? ' active' : ''}`}
      onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onClose(path); } }}>
      <button type="button" role="tab" aria-selected={path === active} aria-label={path}
        tabIndex={path === active ? 0 : -1} title={path} onClick={() => onOpen(path)}
        onKeyDown={event => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % paths.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + paths.length) % paths.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = paths.length - 1;
          else if (event.key === 'Delete') { event.preventDefault(); onClose(path); return; }
          else return;
          event.preventDefault(); onOpen(paths[next]);
          strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>
        <span>{path.split('/').pop()}</span>
        {dirty.has(path) && <i aria-label="Unsaved changes" />}
      </button>
      <button type="button" className="editor-tab-close" aria-label={`Close ${path}`} title={`Close ${path}`} onClick={() => onClose(path)}><X size={12} /></button>
    </div>)}
  </div>;
}
