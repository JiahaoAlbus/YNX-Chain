import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useI18n } from './i18nProvider';
import { useSocialAppearance } from './SocialAppearance';
import { ChatAppearanceStore, chatBackgrounds, chatCanvas, checkedChatSlot, defaultChatAppearance, effectiveChatBackground,
  type ChatAppearance, type ChatBackground, type ChatTheme } from './chatAppearance';
import { createChatAppearanceJournal } from './chatAppearanceJournal';

const directory = () => new Directory(Paths.document, 'ynx-social-chat-appearance-v1');
const accountDirectory = (slot: string) => new Directory(directory(), checkedChatSlot(slot));
const metadata = (slot: string, side: 'a' | 'b') => new File(accountDirectory(slot), `settings-${side}.json`);
const hash = (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const store = new ChatAppearanceStore(createChatAppearanceJournal({
  async read(slot, side) { const file = metadata(slot, side); return file.exists ? file.textSync() : null; },
  async write(slot, side, raw) { accountDirectory(slot).create({ intermediates: true, idempotent: true }); metadata(slot, side).write(raw); },
  hash,
}));
function imageFile(slot: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('CHAT_APPEARANCE_INVALID_IMAGE');
  return new File(accountDirectory(slot), `${id}.image`);
}
function removeStaged(slot: string, id: string) { const file = imageFile(slot, id); if (file.exists) file.delete(); }
type Scope = { account: string | null; room: string | null; slot: string; roomSlot: string | null; value: ChatAppearance };
export function useNativeChatAppearance(account: string | null, room: string | null = null) {
  const [saved, setSaved] = useState<Scope | null>(null), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const binding = useRef({ account, room }); binding.current = { account, room };
  useEffect(() => {
    let alive = true, unsubscribe: (() => void) | undefined; setError(null);
    void (async () => {
      const slot = account ? 'a_' + await hash(account) : 'guest';
      const roomSlot = account && room ? 'r_' + await hash(room) : null;
      if (!alive) return;
      await store.open(slot); if (!alive) return;
      const publish = () => { if (alive) setSaved({ account, room, slot, roomSlot, value: store.snapshot(slot)! }); };
      unsubscribe = store.subscribe(slot, publish); publish();
    })().catch(() => { if (alive) setError('Chat appearance could not be read. Your previous settings are retained. Retry.'); });
    return () => { alive = false; unsubscribe?.(); };
  }, [account, room, retry]);
  // Hide a prior account immediately, before async effects or hash completion.
  const scope = saved?.account === account && saved.room === room ? saved : null;
  const value = scope?.value ?? defaultChatAppearance(), background = effectiveChatBackground(value, scope?.roomSlot);
  const current = () => !!scope && binding.current.account === scope.account && binding.current.room === scope.room;
  let uri: string | undefined;
  try { if (scope && background.kind === 'image') { const file = imageFile(scope.slot, background.id); if (file.exists) uri = file.uri; } } catch { /* Original preference remains available for recovery. */ }
  return { scope, value, background, uri, error, current, retry: () => setRetry(value => value + 1) };
}
export function NativeChatWallpaper({ appearance }: { appearance: ReturnType<typeof useNativeChatAppearance> }) {
  const system = useColorScheme();
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { backgroundColor: chatCanvas(appearance.background, appearance.value.theme, system === 'dark') }]}>
    {appearance.uri && <Image source={{ uri: appearance.uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
    {appearance.uri && <View style={[StyleSheet.absoluteFill, { backgroundColor: appearance.value.theme === 'dark' || (appearance.value.theme === 'system' && system === 'dark') ? 'rgba(10,22,35,.42)' : 'rgba(255,255,255,.2)' }]} />}
  </View>;
}
export function ChatAppearanceSettings({ account, room = null }: { account: string | null; room?: string | null }) {
  return <Editor key={JSON.stringify([account, room])} account={account} room={room} />;
}
function Editor({ account, room }: { account: string | null; room: string | null }) {
  const appearance = useNativeChatAppearance(account, room), system = useColorScheme(), { t } = useI18n(), { scale } = useSocialAppearance();
  const [open, setOpen] = useState(false), [candidate, setCandidate] = useState<ChatBackground | null>(null), [theme, setTheme] = useState<ChatTheme>('system');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const alive = useRef(true), staged = useRef(new Set<{ slot: string; id: string }>());
  const cleanup = (retained?: string) => {
    for (const entry of staged.current) { if (entry.id !== retained) { try { removeStaged(entry.slot, entry.id); } catch { /* App-private temp copy only; never a user original. */ } } }
    staged.current.clear();
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cleanup(); }; }, []);
  const begin = () => {
    if (!appearance.scope) { appearance.retry(); return; }
    cleanup(); setError(null); setCandidate(room ? appearance.value.rooms[appearance.scope.roomSlot!] ?? null : appearance.value.background);
    setTheme(appearance.value.theme); setOpen(true);
  };
  const cancel = () => { if (busy) return; cleanup(); setError(null); setOpen(false); };
  const selectImage = async () => {
    const scope = appearance.scope; if (!scope || busy) return; setBusy(true); setError(null);
    let stagedId: string | undefined;
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, exif: false, base64: false, quality: 1 });
      if (selected.canceled || !alive.current || !appearance.current()) return;
      const asset = selected.assets[0];
      if (!asset || !/^(file|content):/.test(asset.uri) || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType ?? '') || asset.width > 8192 || asset.height > 8192)
        throw new Error('UNSUPPORTED_LOCAL_IMAGE');
      const original = new File(asset.uri);
      if (!original.exists || original.size <= 0 || original.size > 8 * 1024 * 1024) throw new Error('LOCAL_IMAGE_LIMIT');
      stagedId = Array.from(await Crypto.getRandomBytesAsync(16), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!alive.current || !appearance.current()) return;
      accountDirectory(scope.slot).create({ intermediates: true, idempotent: true }); original.copy(imageFile(scope.slot, stagedId));
      staged.current.add({ slot: scope.slot, id: stagedId });
      setCandidate({ kind: 'image', id: stagedId });
    } catch { if (alive.current && appearance.current()) setError('Choose a JPEG, PNG or WebP image up to 8 MB. Your current background has not changed.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const confirm = async () => {
    const scope = appearance.scope; if (!scope || busy) return; setBusy(true); setError(null);
    const reviewed = candidate;
    // Once persistence begins, keep its original local copy even if this view
    // unmounts. A late, successful ORIGINAL-slot write must not reference a
    // copy removed by the replacement account's cancellation cleanup.
    if (reviewed?.kind === 'image') for (const entry of staged.current) if (entry.id === reviewed.id) staged.current.delete(entry);
    try {
      await store.save(scope.slot, { room: scope.roomSlot, background: reviewed, ...(room ? {} : { theme }) }, () => alive.current && appearance.current());
      if (alive.current && appearance.current()) { cleanup(reviewed?.kind === 'image' ? reviewed.id : undefined); setOpen(false); }
    } catch { if (alive.current && appearance.current()) setError('Background was not confirmed as saved. The previous setting is retained; retry or cancel.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const previewBackground = candidate ?? appearance.value.background;
  const dark = theme === 'dark' || (theme === 'system' && system === 'dark');
  const previewUri = previewBackground.kind === 'image' && appearance.scope ? imageFile(appearance.scope.slot, previewBackground.id).uri : undefined;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t(room ? 'Conversation background' : 'Chat appearance and background')} onPress={begin} style={styles.row}>
      <Text style={{ color: '#14263b', fontSize: 15 * scale, fontWeight: '600' }}>{t(room ? 'Conversation background' : 'Chat appearance and background')}</Text>
      <Text style={{ color: '#667085', fontSize: 12 * scale }}>{t(room ? 'Override only this conversation' : 'Global default on this device')}  ›</Text>
    </Pressable>
    {appearance.error && <Pressable accessibilityRole="button" onPress={appearance.retry}><Text accessibilityRole="alert" style={styles.error}>{t(appearance.error)}</Text></Pressable>}
    {appearance.background.kind === 'image' && !appearance.uri && appearance.scope && <Text style={styles.error}>{t('The saved local image is unavailable. Choose another image or reset the background.')}</Text>}
    <Modal visible={open} transparent animationType="slide" onRequestClose={cancel}>
      <SafeAreaView style={styles.backdrop}><View style={[styles.sheet, dark && { backgroundColor: '#142332' }]}>
        <View style={styles.header}><Text style={[styles.heading, { fontSize: 19 * scale }, dark && { color: '#f4f7fb' }]}>{t(room ? 'Conversation background' : 'Chat appearance')}</Text>
          <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t('Cancel background changes')} onPress={cancel} style={styles.button}><Text style={[styles.link, dark && { color: '#b8d8ff' }]}>{t('Cancel')}</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.help, dark && { color: '#d2deea' }]}>{t('Images stay on this device. Social does not upload your background or share its original file path.')}</Text>
          {!room && <View style={styles.options}>{(['system', 'light', 'dark'] as const).map(value => <Pressable key={value} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: theme === value }} accessibilityLabel={t('Chat theme') + ' ' + value}
            onPress={() => setTheme(value)} style={[styles.option, theme === value && styles.selected]}><Text>{t(value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark')}</Text></Pressable>)}</View>}
          <View accessibilityLabel={t('Background preview')} style={[styles.preview, { backgroundColor: chatCanvas(previewBackground, theme, system === 'dark') }]}>
            {previewUri && <Image source={{ uri: previewUri }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
            <View style={styles.previewBubble}><Text style={styles.previewText}>{t('Preview only. Your conversations are unchanged.')}</Text></View>
            <View style={[styles.previewBubble, styles.previewOwn]}><Text style={{ color: '#fff' }}>{t('Readable text on every background.')}</Text></View>
          </View>
          {room && <Pressable disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: candidate === null }} onPress={() => setCandidate(null)} style={[styles.option, candidate === null && styles.selected]}><Text>{t('Use global default')}</Text></Pressable>}
          <View style={styles.options}>{chatBackgrounds.map(preset => <Pressable key={preset} disabled={busy} accessibilityRole="radio" accessibilityLabel={t('Background') + ' ' + preset} accessibilityState={{ checked: candidate?.kind === 'preset' && candidate.preset === preset }}
            onPress={() => setCandidate({ kind: 'preset', preset })} style={[styles.swatch, { backgroundColor: chatCanvas({ kind: 'preset', preset }, theme, system === 'dark') }, candidate?.kind === 'preset' && candidate.preset === preset && styles.selected]}><Text style={[styles.swatchLabel]}>{preset}</Text></Pressable>)}</View>
          <Pressable disabled={busy} accessibilityRole="button" onPress={() => { void selectImage(); }} style={styles.option}><Text>{t('Choose image from this device')}</Text></Pressable>
          <Pressable disabled={busy} accessibilityRole="button" onPress={() => { setCandidate(room ? null : { kind: 'preset', preset: 'mist' }); if (!room) setTheme('system'); }} style={styles.option}><Text>{t(room ? 'Reset to global default' : 'Reset global background and theme')}</Text></Pressable>
          {error && <Text accessibilityRole="alert" style={[styles.error, dark && { color: '#ffd0cb' }]}>{t(error)}</Text>}
          <Pressable disabled={busy || !appearance.scope} accessibilityRole="button" accessibilityLabel={t('Confirm background')} onPress={() => { void confirm(); }} style={[styles.confirm, busy && { opacity: .6 }]}><Text style={{ color: '#fff', fontWeight: '600' }}>{t(busy ? 'Saving on this device…' : 'Confirm background')}</Text></Pressable>
        </ScrollView>
      </View></SafeAreaView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  row: { minHeight: 64, padding: 20, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e3e8ef' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,24,40,.45)' }, sheet: { maxHeight: '92%', width: '100%', maxWidth: 580, alignSelf: 'center', backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, heading: { color: '#14263b', fontWeight: '600', flex: 1 }, button: { minWidth: 48, minHeight: 48, justifyContent: 'center' }, link: { color: '#002fa7', fontWeight: '600' },
  content: { gap: 14, paddingBottom: 24 }, help: { fontSize: 13, lineHeight: 20, color: '#667085' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: { minHeight: 48, padding: 14, borderRadius: 12, backgroundColor: '#f0f4f8', justifyContent: 'center' }, selected: { borderWidth: 2, borderColor: '#1872db' },
  preview: { minHeight: 160, padding: 18, gap: 14, borderRadius: 16, overflow: 'hidden' }, previewBubble: { maxWidth: '85%', alignSelf: 'flex-start', backgroundColor: '#fff', padding: 12, borderRadius: 14 }, previewOwn: { alignSelf: 'flex-end', backgroundColor: '#002fa7' }, previewText: { color: '#14263b' },
  swatch: { minWidth: 84, minHeight: 62, borderRadius: 12, justifyContent: 'center', alignItems: 'center', padding: 8 }, swatchLabel: { backgroundColor: '#fff', color: '#14263b', padding: 5, borderRadius: 8 },
  confirm: { backgroundColor: '#002fa7', minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, error: { color: '#b42318', fontSize: 13, padding: 10 },
});
