import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { getRandomBytesAsync } from "expo-crypto";
import { ArrowLeft, LockKeyhole, MessageCircle, Plus, RefreshCw, RotateCw, Send, ShieldCheck, Smartphone, X } from "lucide-react-native";
import { YNXMobileAppClient } from "../api/mobileSession";
import type { ChatConversation, ChatDevice, DecryptedChatMessage } from "../api/chat";
import { fetchSquareProfile, fetchSquareProfileByHandle } from "../api/ynxGateway";
import type { SquareProfile } from "../api/square";
import { accountIdentity } from "../crypto/ynxSigner";
import type { PendingChatRotation } from "../storage/chatRotationRecord";
import { deletePendingChatRotation, loadPendingChatRotation, saveIdentity, savePendingChatRotation, type StoredIdentity } from "../storage/secureIdentity";

const BLUE = "#002FA7";
const INK = "#111827";
const MUTED = "#667085";
const LINE = "#E5E7EB";
type PendingSend = Readonly<{ content: string; messageId: string; entropy: Uint8Array }>;

export function NativeChatScreen(props: { stored: StoredIdentity | null; openWallet: () => void; onDetailChange?: (open: boolean) => void; onIdentityChange: (value: StoredIdentity) => void }) {
  const [client, setClient] = useState<YNXMobileAppClient | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, SquareProfile>>({});
  const [selected, setSelected] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<DecryptedChatMessage[]>([]);
  const [peerInput, setPeerInput] = useState("");
  const [draft, setDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<ChatDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const listRef = useRef<FlatList<DecryptedChatMessage>>(null);

  const closeConversation = useCallback(() => {
    setSelected(null);
    setMessages([]);
    setDraft("");
    setPendingSend(null);
    props.onDetailChange?.(false);
  }, [props.onDetailChange]);

  const lock = useCallback(async (reason?: string) => {
    const current = client;
    setClient(null);
    closeConversation();
    if (reason) setError(reason);
    if (current) await current.lockAndRevokeSession().catch(() => undefined);
  }, [client, closeConversation]);

  useEffect(() => () => { if (client) void client.lockAndRevokeSession().catch(() => undefined); }, [client]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && client) void lock("Chat locked when YNX left the foreground. Unlock to continue.");
    });
    return () => subscription.remove();
  }, [client, lock]);

  useEffect(() => {
    if (!client || !props.stored) return;
    const account = accountIdentity(props.stored.accountSecret).account;
    if (client.account !== account) void lock("Local identity changed. Unlock Chat with the current account.");
  }, [client, lock, props.stored]);

  const loadConversations = useCallback(async (active: YNXMobileAppClient, refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const records = await active.listChatConversations();
      setConversations(records);
      const accounts = [...new Set(records.flatMap((record) => record.members).filter((account) => account !== active.account))];
      const resolved = await Promise.all(accounts.map(async (account) => {
        try { return [account, await fetchSquareProfile(account)] as const; }
        catch { return null; }
      }));
      setProfiles(Object.fromEntries(resolved.filter((record): record is readonly [string, SquareProfile] => record !== null)));
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadMessages = useCallback(async (active: YNXMobileAppClient, conversation: ChatConversation, quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const records = await active.listChatMessages(conversation);
      setMessages(records);
      setError(null);
      const unread = records.filter((record) => record.sender !== active.account && !record.readAt[active.deviceId]);
      await Promise.all(unread.map((record) => active.acknowledgeChatMessage(conversation.id, record.id, "read").catch(() => undefined)));
    } catch (caught) {
      if (!quiet) setError(message(caught));
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!client || !selected) return;
    const timer = setInterval(() => { if (client.connected) void loadMessages(client, selected, true); }, 5000);
    return () => clearInterval(timer);
  }, [client, loadMessages, selected]);

  const connect = async () => {
    if (!props.stored) { props.openWallet(); return; }
    setBusy(true);
    setError(null);
    const next = new YNXMobileAppClient(props.stored);
    try {
      await next.connect({ registerSquare: false });
      const pending = await loadPendingChatRotation();
      if (pending) {
        if (pending.account !== next.account || pending.authorizingDeviceId !== next.deviceId) throw new Error("Pending Chat rotation does not match this secure identity. Keep this identity on the device and contact YNX support.");
        await next.rotateCurrentChatDevice(pending.newDeviceSecret, pending.idempotencyKey);
        await finishRotation(next, props.stored, pending);
        return;
      }
      setClient(next);
      await loadConversations(next);
    } catch (caught) {
      next.lock();
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const openConversation = async (conversation: ChatConversation) => {
    if (!client) return;
    setSelected(conversation);
    props.onDetailChange?.(true);
    setMessages([]);
    setError(null);
    await loadMessages(client, conversation);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  };

  const createConversation = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await fetchSquareProfileByHandle(socialHandle(peerInput));
      if (profile.account === client.account) throw new Error("Choose another Social username");
      const random = await getRandomBytesAsync(12);
      const conversation = await client.createChatConversation(profile.account, `conversation-${hex(random)}`);
      setProfiles((current) => ({ ...current, [profile.account]: profile }));
      setPeerInput("");
      setCreateOpen(false);
      await loadConversations(client);
      await openConversation(conversation);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const openDevices = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      setDevices(await client.listChatDevices(client.account));
      setDevicesOpen(true);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirmRotation = () => {
    if (!client || !props.stored) return;
    Alert.alert("Rotate Chat device?", "This creates a new device key, revokes this Chat device, and requires you to unlock Chat again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Rotate", style: "destructive", onPress: () => void rotateDevice() },
    ]);
  };

  const rotateDevice = async () => {
    if (!client || !props.stored) return;
    const current = client;
    const stored = props.stored;
    let pending: PendingChatRotation | null = null;
    setBusy(true);
    setError(null);
    try {
      pending = await loadPendingChatRotation();
      if (pending && (pending.account !== current.account || pending.authorizingDeviceId !== current.deviceId)) throw new Error("Pending Chat rotation does not match this secure identity. Keep this identity on the device and contact YNX support.");
      if (!pending) {
        const [nextSecret, random] = await Promise.all([getRandomBytesAsync(32), getRandomBytesAsync(12)]);
        pending = Object.freeze({ account: current.account, authorizingDeviceId: current.deviceId, newDeviceSecret: nextSecret, idempotencyKey: `rotate-${hex(random)}` });
        await savePendingChatRotation(pending);
      }
      await current.rotateCurrentChatDevice(pending.newDeviceSecret, pending.idempotencyKey);
      await finishRotation(current, stored, pending);
    } catch (caught) {
      const detail = message(caught);
      setError(pending && uncertain(detail) ? `Rotation result is unknown. The new key and exact request are secured on this device. Keep the App open and tap Rotate again. ${detail}` : detail);
    } finally {
      setBusy(false);
    }
  };

  const finishRotation = async (current: YNXMobileAppClient, stored: StoredIdentity, pending: PendingChatRotation) => {
    await saveIdentity(stored.accountSecret, pending.newDeviceSecret);
    const updated = Object.freeze({ accountSecret: stored.accountSecret.slice(), deviceSecret: pending.newDeviceSecret.slice() });
    await deletePendingChatRotation();
    props.onIdentityChange(updated);
    setDevicesOpen(false);
    setClient(null);
    closeConversation();
    await current.lockAndRevokeSession().catch(() => undefined);
    setError("Chat device rotated. Unlock again with the new device identity.");
  };

  const send = async () => {
    if (!client || !selected || !draft.trim()) return;
    const content = draft;
    setBusy(true);
    setError(null);
    try {
      let attempt = pendingSend;
      if (!attempt || attempt.content !== content) {
        const [idRandom, entropy] = await Promise.all([getRandomBytesAsync(12), getRandomBytesAsync(32)]);
        attempt = Object.freeze({ content, messageId: `message-${hex(idRandom)}`, entropy });
        setPendingSend(attempt);
      }
      await client.sendChatMessage(selected, attempt.content, attempt.messageId, attempt.entropy);
      setDraft("");
      setPendingSend(null);
      await loadMessages(client, selected, true);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      setError(submissionMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (selected && client) {
    const peer = selected.members.find((member) => member !== client.account) ?? "YNX account";
    const peerProfile = profiles[peer];
    return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0} style={styles.screen}>
      <View style={styles.conversationHeader}>
        <Pressable accessibilityLabel="Back to conversations" onPress={closeConversation} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><ArrowLeft color={INK} size={22} /></Pressable>
        <View style={styles.conversationIdentity}><Text numberOfLines={1} style={styles.peerTitle}>{peerProfile?.displayName || "YNX member"}</Text><View style={styles.encryptedRow}><ShieldCheck color="#067647" size={12} /><Text style={styles.encryptedText}>{peerProfile?.handle ? `@${peerProfile.handle} · ` : ""}End-to-end encrypted</Text></View></View>
        <Pressable accessibilityLabel="Refresh messages" onPress={() => void loadMessages(client, selected)} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><RefreshCw color={INK} size={19} /></Pressable>
      </View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={messages.length ? styles.messageList : styles.emptyMessageList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadMessages(client, selected)} tintColor={BLUE} />}
        ListEmptyComponent={<View style={styles.empty}><MessageCircle color={BLUE} size={32} strokeWidth={1.5} /><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyText}>Messages are encrypted on this device before the service receives them.</Text></View>}
        renderItem={({ item }) => <MessageBubble item={item} own={item.sender === client.account} />}
        onContentSizeChange={() => { if (messages.length) listRef.current?.scrollToEnd({ animated: false }); }}
      />
      <View style={styles.composer}>
        <TextInput accessibilityLabel="Message" autoCapitalize="sentences" autoCorrect multiline maxLength={16000} onChangeText={(value) => { setDraft(value); if (pendingSend?.content !== value) setPendingSend(null); }} placeholder="Message" placeholderTextColor="#98A2B3" style={styles.composerInput} value={draft} />
        <Pressable accessibilityLabel="Send message" disabled={busy || !draft.trim()} onPress={() => void send()} style={({ pressed }) => [styles.sendButton, (!draft.trim() || busy) && styles.disabled, pressed && styles.sendPressed]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Send color="#FFFFFF" size={18} />}</Pressable>
      </View>
    </KeyboardAvoidingView>;
  }

  return <View style={styles.screen}>
    <View style={styles.heading}>
      <View><Text style={styles.eyebrow}>PRIVATE MESSAGING</Text><Text style={styles.title}>Chat</Text></View>
      <View style={styles.actions}>{client?.connected ? <><Pressable accessibilityLabel="Manage Chat devices" onPress={() => void openDevices()} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><Smartphone color={INK} size={19} /></Pressable><Pressable accessibilityLabel="Lock Chat" onPress={() => void lock()} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><LockKeyhole color={INK} size={19} /></Pressable><Pressable accessibilityLabel="New conversation" onPress={() => setCreateOpen(true)} style={({ pressed }) => [styles.addButton, pressed && styles.sendPressed]}><Plus color="#FFFFFF" size={21} /></Pressable></> : <Pressable disabled={busy} onPress={() => void connect()} style={({ pressed }) => [styles.unlockButton, pressed && styles.pressed]}>{busy ? <ActivityIndicator color={BLUE} /> : <><LockKeyhole color={BLUE} size={16} /><Text style={styles.unlockText}>{props.stored ? "Unlock" : "Create"}</Text></>}</Pressable>}</View>
    </View>
    {error ? <Text style={styles.inlineError}>{error}</Text> : null}
    {!client?.connected ? <View style={styles.empty}><View style={styles.chatGlyph}><MessageCircle color={BLUE} size={31} strokeWidth={1.5} /></View><Text style={styles.emptyTitle}>Private by design</Text><Text style={styles.emptyText}>Unlock your Social identity to access encrypted direct conversations.</Text></View> : <FlatList
      data={conversations}
      keyExtractor={(item) => item.id}
      contentContainerStyle={conversations.length ? styles.conversationList : styles.emptyConversationList}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadConversations(client, true)} tintColor={BLUE} />}
      ListEmptyComponent={<View style={styles.empty}><MessageCircle color={BLUE} size={31} strokeWidth={1.5} /><Text style={styles.emptyTitle}>No conversations yet</Text><Text style={styles.emptyText}>Find someone by username or scan their Social QR code.</Text><Pressable onPress={() => setCreateOpen(true)} style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}><Plus color={BLUE} size={18} /><Text style={styles.startText}>New conversation</Text></Pressable></View>}
      renderItem={({ item }) => { const peer = item.members.find((member) => member !== client.account); return <ConversationRow conversation={item} profile={peer ? profiles[peer] : undefined} onPress={() => void openConversation(item)} />; }}
    />}
    <Modal animationType="slide" onRequestClose={() => setCreateOpen(false)} transparent visible={createOpen}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>New conversation</Text><Pressable accessibilityLabel="Close" onPress={() => setCreateOpen(false)} style={styles.headerIcon}><X color={INK} size={20} /></Pressable></View>
        <Text style={styles.sheetLabel}>Username or Social QR</Text>
        <TextInput accessibilityLabel="Social username or QR" autoCapitalize="none" autoCorrect={false} onChangeText={setPeerInput} placeholder="@username" placeholderTextColor="#98A2B3" style={styles.addressInput} value={peerInput} />
        <Text style={styles.sheetNote}>The recipient needs an active Social profile and Chat device. Their chain account is resolved securely in the background.</Text>
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <Pressable disabled={busy || !validSocialInput(peerInput)} onPress={() => void createConversation()} style={({ pressed }) => [styles.createButton, (busy || !validSocialInput(peerInput)) && styles.disabled, pressed && styles.sendPressed]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.createText}>Create conversation</Text>}</Pressable>
      </View></View>
    </Modal>
    <Modal animationType="slide" onRequestClose={() => setDevicesOpen(false)} transparent visible={devicesOpen}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Chat devices</Text><Pressable accessibilityLabel="Close device manager" onPress={() => setDevicesOpen(false)} style={styles.headerIcon}><X color={INK} size={20} /></Pressable></View>
        <Text style={styles.sheetNote}>Active devices receive their own encrypted copy of each message. Revoked device keys remain visible only for historical signature verification.</Text>
        <View style={styles.deviceList}>{devices.map((device) => <View key={device.id} style={styles.deviceRow}><View style={styles.deviceGlyph}><Smartphone color={device.status === "active" ? BLUE : MUTED} size={18} /></View><View style={styles.deviceCopy}><Text numberOfLines={1} style={styles.deviceName}>{device.id === client?.deviceId ? "This device" : short(device.id)}</Text><Text style={styles.deviceStatus}>{device.status === "active" ? "Active" : "Revoked"}</Text></View>{device.id === client?.deviceId && device.status === "active" ? <Pressable accessibilityLabel="Rotate this Chat device" disabled={busy} onPress={confirmRotation} style={({ pressed }) => [styles.rotateButton, pressed && styles.pressed]}><RotateCw color={BLUE} size={17} /><Text style={styles.rotateText}>Rotate</Text></Pressable> : null}</View>)}</View>
      </View></View>
    </Modal>
  </View>;
}

function ConversationRow({ conversation, profile, onPress }: { conversation: ChatConversation; profile?: SquareProfile; onPress: () => void }) {
  const title = profile?.displayName || "YNX member";
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.conversationRow, pressed && styles.rowPressed]}><View style={styles.avatar}><Text style={styles.avatarText}>{title.slice(0, 2).toUpperCase()}</Text></View><View style={styles.rowCopy}><View style={styles.rowTop}><Text numberOfLines={1} style={styles.rowTitle}>{title}</Text><Text style={styles.rowTime}>{formatTime(conversation.updatedAt)}</Text></View><Text numberOfLines={1} style={styles.rowSubtitle}>{profile?.handle ? `@${profile.handle} · ` : ""}Encrypted direct conversation</Text></View></Pressable>;
}

function MessageBubble({ item, own }: { item: DecryptedChatMessage; own: boolean }) {
  return <View style={[styles.messageRow, own && styles.messageRowOwn]}><View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubblePeer, item.decryptionError && styles.bubbleError]}><Text style={[styles.messageText, own && styles.messageTextOwn, item.decryptionError && styles.messageError]}>{item.plaintext ?? item.decryptionError}</Text><Text style={[styles.messageTime, own && styles.messageTimeOwn]}>{formatMessageTime(item.createdAt)}{own ? `  ${messageState(item)}` : ""}</Text></View></View>;
}

function short(value: string): string { return value.length > 22 ? `${value.slice(0, 11)}...${value.slice(-7)}` : value; }
function socialHandle(value: string): string { return value.trim().replace(/^ynxsocial:\/\/profile\//i, "").replace(/^@/, "").toLowerCase(); }
function validSocialInput(value: string): boolean { return /^[a-z][a-z0-9_]{2,23}$/.test(socialHandle(value)); }
function hex(value: Uint8Array): string { return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function message(error: unknown): string { return error instanceof Error ? error.message : "YNX Chat is unavailable"; }
function submissionMessage(error: unknown): string { const detail = message(error); return /abort|network|fetch|timeout|connection|invalid json/i.test(detail) ? `Message result is unknown. Refresh before retrying; the same message ID will be reused. ${detail}` : detail; }
function uncertain(detail: string): boolean { return /abort|network|fetch|timeout|connection|invalid json/i.test(detail); }
function messageState(item: DecryptedChatMessage): string { return Object.keys(item.readAt).length ? "Read" : Object.keys(item.deliveredAt).length ? "Delivered" : "Sent"; }
function formatTime(value: string): string { const date = new Date(value); return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatMessageTime(value: string): string { const date = new Date(value); return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  heading: { minHeight: 76, paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  eyebrow: { color: BLUE, fontSize: 11, fontWeight: "700" }, title: { color: INK, fontSize: 30, lineHeight: 36, fontWeight: "700", marginTop: 3 }, actions: { flexDirection: "row", gap: 8 },
  headerIcon: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" }, addButton: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: BLUE },
  unlockButton: { minWidth: 92, height: 40, paddingHorizontal: 13, borderRadius: 8, borderWidth: 1, borderColor: "#C7D7FE", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#F5F8FF" }, unlockText: { color: BLUE, fontSize: 13, fontWeight: "700" },
  inlineError: { color: "#B42318", fontSize: 12, lineHeight: 18, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: "#FFFBFA" },
  empty: { flex: 1, minHeight: 260, paddingHorizontal: 42, alignItems: "center", justifyContent: "center" }, chatGlyph: { width: 64, height: 64, borderRadius: 18, backgroundColor: "#EEF3FF", alignItems: "center", justifyContent: "center" }, emptyTitle: { color: INK, fontSize: 18, fontWeight: "700", marginTop: 16 }, emptyText: { color: MUTED, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  startButton: { height: 44, marginTop: 20, paddingHorizontal: 18, borderRadius: 8, borderWidth: 1, borderColor: "#C7D7FE", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F5F8FF" }, startText: { color: BLUE, fontSize: 13, fontWeight: "700" },
  conversationList: { paddingBottom: 16 }, emptyConversationList: { flexGrow: 1 }, conversationRow: { minHeight: 78, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, rowPressed: { backgroundColor: "#F8FAFC" }, avatar: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF3FF" }, avatarText: { color: BLUE, fontSize: 14, fontWeight: "800" }, rowCopy: { flex: 1, marginLeft: 13 }, rowTop: { flexDirection: "row", alignItems: "center" }, rowTitle: { flex: 1, color: INK, fontSize: 15, fontWeight: "700" }, rowTime: { color: "#98A2B3", fontSize: 11, marginLeft: 8 }, rowSubtitle: { color: MUTED, fontSize: 12, marginTop: 6 },
  conversationHeader: { height: 62, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, conversationIdentity: { flex: 1, alignItems: "center" }, peerTitle: { maxWidth: "90%", color: INK, fontSize: 14, fontWeight: "700" }, encryptedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }, encryptedText: { color: "#067647", fontSize: 10, fontWeight: "600" },
  messageList: { paddingHorizontal: 14, paddingVertical: 16 }, emptyMessageList: { flexGrow: 1 }, messageRow: { width: "100%", alignItems: "flex-start", marginVertical: 4 }, messageRowOwn: { alignItems: "flex-end" }, bubble: { maxWidth: "82%", paddingHorizontal: 13, paddingTop: 9, paddingBottom: 7, borderRadius: 18 }, bubblePeer: { backgroundColor: "#F2F4F7", borderBottomLeftRadius: 5 }, bubbleOwn: { backgroundColor: BLUE, borderBottomRightRadius: 5 }, bubbleError: { borderWidth: 1, borderColor: "#FECDCA", backgroundColor: "#FFFBFA" }, messageText: { color: INK, fontSize: 15, lineHeight: 21 }, messageTextOwn: { color: "#FFFFFF" }, messageError: { color: "#B42318", fontSize: 12 }, messageTime: { color: "#98A2B3", fontSize: 9, marginTop: 4, textAlign: "right" }, messageTimeOwn: { color: "#D6E0FF" },
  composer: { minHeight: 62, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "flex-end", gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE, backgroundColor: "#FFFFFF" }, composerInput: { flex: 1, minHeight: 44, maxHeight: 112, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 22, color: INK, fontSize: 15, lineHeight: 20, backgroundColor: "#F2F4F7" }, sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: BLUE },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.32)" }, sheet: { padding: 22, paddingBottom: 36, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: "#FFFFFF" }, sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sheetTitle: { color: INK, fontSize: 22, fontWeight: "700" }, sheetLabel: { color: INK, fontSize: 13, fontWeight: "700", marginTop: 24 }, addressInput: { height: 50, marginTop: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: LINE, borderRadius: 8, color: INK, fontSize: 13 }, sheetNote: { color: MUTED, fontSize: 11, lineHeight: 17, marginTop: 11 }, sheetError: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 12 }, createButton: { minHeight: 50, marginTop: 22, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: BLUE }, createText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  deviceList: { marginTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE }, deviceRow: { minHeight: 66, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, deviceGlyph: { width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#F5F8FF" }, deviceCopy: { flex: 1, marginLeft: 11 }, deviceName: { color: INK, fontSize: 13, fontWeight: "700" }, deviceStatus: { color: MUTED, fontSize: 11, marginTop: 3 }, rotateButton: { minWidth: 82, height: 38, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: "#C7D7FE", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#F5F8FF" }, rotateText: { color: BLUE, fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.62 }, sendPressed: { backgroundColor: "#001F70" }, disabled: { opacity: 0.38 },
});
