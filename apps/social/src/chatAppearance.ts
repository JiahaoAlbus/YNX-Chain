// Local presentation only. These opaque slots never authorize a conversation.
export const chatBackgrounds = ['mist', 'ivory', 'ocean', 'sage', 'ink'] as const;
export type ChatPreset = typeof chatBackgrounds[number];
export type ChatBackground = { kind: 'preset'; preset: ChatPreset } | { kind: 'image'; id: string };
export type ChatTheme = 'system' | 'light' | 'dark';
export type ChatAppearance = { version: 1; theme: ChatTheme; background: ChatBackground; rooms: Record<string, ChatBackground> };
export const defaultChatAppearance = (): ChatAppearance => ({ version: 1, theme: 'system', background: { kind: 'preset', preset: 'mist' }, rooms: {} });
export function checkedChatSlot(value: string, room = false): string {
  if (!(room ? /^r_[a-f0-9]{64}$/ : /^(guest|a_[a-f0-9]{64})$/).test(value)) throw new Error('CHAT_APPEARANCE_INVALID_SLOT');
  return value;
}
export function checkedChatBackground(value: unknown): ChatBackground {
  if (!value || typeof value !== 'object') throw new Error('CHAT_APPEARANCE_INVALID_BACKGROUND');
  const entry = value as Record<string, unknown>;
  if (entry.kind === 'preset' && chatBackgrounds.some(preset => preset === entry.preset) && Object.keys(entry).length === 2)
    return { kind: 'preset', preset: entry.preset as ChatPreset };
  if (entry.kind === 'image' && typeof entry.id === 'string' && /^[a-f0-9]{32}$/.test(entry.id) && Object.keys(entry).length === 2)
    return { kind: 'image', id: entry.id };
  throw new Error('CHAT_APPEARANCE_INVALID_BACKGROUND');
}
export function parseChatAppearance(raw: string | null): ChatAppearance {
  if (raw === null) return defaultChatAppearance();
  if (raw.length > 80000) throw new Error('CHAT_APPEARANCE_INVALID_STORAGE');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('CHAT_APPEARANCE_INVALID_STORAGE');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.theme !== 'string' || !['system', 'light', 'dark'].includes(record.theme) ||
      !record.rooms || typeof record.rooms !== 'object' || Array.isArray(record.rooms) || Object.keys(record).length !== 4)
    throw new Error('CHAT_APPEARANCE_INVALID_STORAGE');
  const entries = Object.entries(record.rooms);
  if (entries.length > 256) throw new Error('CHAT_APPEARANCE_ROOM_LIMIT');
  const rooms: Record<string, ChatBackground> = {};
  for (const [room, background] of entries) rooms[checkedChatSlot(room, true)] = checkedChatBackground(background);
  return { version: 1, theme: record.theme as ChatTheme, background: checkedChatBackground(record.background), rooms };
}
export function effectiveChatBackground(value: ChatAppearance, room?: string | null): ChatBackground {
  return room ? value.rooms[checkedChatSlot(room, true)] ?? value.background : value.background;
}
export function chatCanvas(background: ChatBackground, theme: ChatTheme, systemDark = false): string {
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const colors: Record<ChatPreset, readonly [string, string]> = {
    mist: ['#e9eff5', '#152332'], ivory: ['#f4eee4', '#30291f'], ocean: ['#dceaf6', '#10293d'],
    sage: ['#e4eee6', '#1c3026'], ink: ['#24374c', '#0c1825'],
  };
  return background.kind === 'preset' ? colors[background.preset][dark ? 1 : 0] : dark ? '#152332' : '#e9eff5';
}
export type ChatAppearancePort = { read(slot: string): Promise<string | null>; write(slot: string, raw: string): Promise<void> };
export class ChatAppearanceStore {
  private values = new Map<string, ChatAppearance>();
  private loads = new Map<string, Promise<ChatAppearance>>();
  private writes = new Map<string, Promise<void>>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(private readonly port: ChatAppearancePort) {}
  snapshot(slot: string): ChatAppearance | undefined {
    const value = this.values.get(checkedChatSlot(slot));
    return value ? parseChatAppearance(JSON.stringify(value)) : undefined;
  }
  subscribe(slot: string, listener: () => void): () => void {
    checkedChatSlot(slot);
    const listeners = this.listeners.get(slot) ?? new Set<() => void>();
    this.listeners.set(slot, listeners); listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(slot); };
  }
  open(slot: string): Promise<ChatAppearance> {
    checkedChatSlot(slot);
    const saved = this.values.get(slot);
    if (saved) return Promise.resolve(parseChatAppearance(JSON.stringify(saved)));
    const existing = this.loads.get(slot); if (existing) return existing;
    const loading = this.port.read(slot).then(raw => {
      const value = parseChatAppearance(raw); this.values.set(slot, value);
      return parseChatAppearance(JSON.stringify(value));
    }).finally(() => { this.loads.delete(slot); });
    this.loads.set(slot, loading); return loading;
  }
  async save(slot: string, change: { room?: string | null; background?: ChatBackground | null; theme?: ChatTheme }, current: () => boolean): Promise<void> {
    checkedChatSlot(slot); if (change.room) checkedChatSlot(change.room, true);
    if (change.theme !== undefined && !['system', 'light', 'dark'].includes(change.theme)) throw new Error('CHAT_APPEARANCE_INVALID_THEME');
    if (change.background !== undefined && change.background !== null) checkedChatBackground(change.background);
    const guard = () => { if (!current()) throw new Error('CHAT_APPEARANCE_STALE_VIEW'); };
    guard();
    const previous = this.writes.get(slot) ?? Promise.resolve();
    const writing = previous.catch(() => {}).then(async () => {
      guard(); await this.open(slot); guard();
      const value = this.snapshot(slot)!;
      if (change.theme !== undefined) value.theme = change.theme;
      if (change.background !== undefined) {
        if (change.room) {
          if (change.background === null) delete value.rooms[change.room];
          else value.rooms[change.room] = checkedChatBackground(change.background);
        } else value.background = change.background === null ? defaultChatAppearance().background : checkedChatBackground(change.background);
      }
      const raw = JSON.stringify(value); parseChatAppearance(raw); guard();
      await this.port.write(slot, raw);
      // A completed write belongs to its ORIGINAL slot, even after sign-out.
      // Never publish its result into the new account or room view.
      this.values.set(slot, value);
      for (const listener of this.listeners.get(slot) ?? []) listener();
      guard();
    });
    this.writes.set(slot, writing);
    try { await writing; } finally { if (this.writes.get(slot) === writing) this.writes.delete(slot); }
  }
}
