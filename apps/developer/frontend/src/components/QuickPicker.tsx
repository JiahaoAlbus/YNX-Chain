import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type QuickPickItem = { id: string; label: string; description?: string; search?: string; run(): void };

// Prefer contiguous matches, then ordered abbreviation matches (src/foo.ts → sf).
function score(value: string, query: string): number | null {
  const text = value.toLocaleLowerCase(), needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const direct = text.indexOf(needle);
  if (direct >= 0) return direct;
  let position = -1, gaps = 0;
  for (const character of needle) {
    const next = text.indexOf(character, position + 1);
    if (next < 0) return null;
    gaps += next - position - 1;
    position = next;
  }
  return text.length + gaps + 100;
}

export function QuickPicker({ title, placeholder, items, onClose }: { title: string; placeholder: string; items: QuickPickItem[]; onClose(): void }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const listId = useId(), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => items.map((item, index) => ({ item, index, score: score(item.search ?? item.label, query) }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index).map(entry => entry.item), [items, query]);
  const active = Math.min(selected, Math.max(0, matches.length - 1));
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, query]);
  const choose = (item: QuickPickItem) => { onClose(); item.run(); };
  return <Dialog.Root open onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="palette quick-picker" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description className="quick-picker-hint">Type to filter. Use ↑ and ↓ to select, Enter to open, Escape to cancel.</Dialog.Description>
        <input ref={input} role="combobox" aria-label={title} aria-expanded="true" aria-autocomplete="list" aria-controls={listId}
          aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
          placeholder={placeholder} value={query} autoComplete="off" spellCheck={false}
          onChange={event => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (matches.length) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (matches[active]) choose(matches[active]);
            }
          }} />
        <div ref={list} id={listId} role="listbox" aria-label={`${title} results`} className="quick-picker-results">
          {matches.map((item, index) => <div id={`${listId}-${index}`} role="option" aria-selected={index === active}
            key={item.id} onMouseMove={() => setSelected(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
            <span>{item.label}</span>{item.description && <small>{item.description}</small>}
          </div>)}
        </div>
        {!matches.length && <p role="status" className="quick-picker-empty">No matching results</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
