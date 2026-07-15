import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Bell, KeyRound, RefreshCw, Save, UserRound, X } from "lucide-react-native";
import { getRandomBytesAsync } from "expo-crypto";
import { fetchSquareProfile } from "../api/ynxGateway";
import { YNXMobileAppClient } from "../api/mobileSession";
import type { SquareNotification, SquareProfile } from "../api/square";
import { accountIdentity } from "../crypto/ynxSigner";
import type { StoredIdentity } from "../storage/secureIdentity";

const BLUE = "#002FA7";
const INK = "#111827";
const MUTED = "#667085";
const LINE = "#E5E7EB";

export function NativeSocialAlertsScreen({ stored, openWallet }: { stored: StoredIdentity | null; openWallet: () => void }) {
  const account = useMemo(() => stored ? accountIdentity(stored.accountSecret).account : null, [stored]);
  const [client, setClient] = useState<YNXMobileAppClient | null>(null);
  const [profile, setProfile] = useState<SquareProfile | null>(null);
  const [notifications, setNotifications] = useState<SquareNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  const loadProfile = useCallback(async () => {
    if (!account) { setProfile(null); return; }
    const next = await fetchSquareProfile(account);
    setProfile(next);
    setHandle(next.handle);
    setDisplayName(next.displayName);
    setBio(next.bio);
  }, [account]);

  const loadNotifications = useCallback(async (active: YNXMobileAppClient) => {
    const feed = await active.listSquareNotifications(50);
    setNotifications(feed.notifications);
    setUnread(feed.unreadCount);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadProfile(), client?.connected ? loadNotifications(client) : Promise.resolve()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [client, loadNotifications, loadProfile]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { if (client) void client.lockAndRevokeSession().catch(() => undefined); }, [client]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" || !client) return;
      const active = client;
      setClient(null);
      setNotifications([]);
      setUnread(0);
      setEditing(false);
      setError("Social session locked. Connect again to view private alerts.");
      void active.lockAndRevokeSession().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [client]);

  const connect = async () => {
    if (!stored) { openWallet(); return; }
    setBusy(true);
    setError(null);
    const next = new YNXMobileAppClient(stored);
    try {
      await next.connect({ registerChat: false });
      await loadNotifications(next);
      setClient(next);
    } catch (caught) {
      next.lock();
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (notification: SquareNotification) => {
    if (!client?.connected || notification.readAt) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await client.readSquareNotification(notification.id, await socialKey("notification-read"));
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      setUnread((current) => Math.max(0, current - 1));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!client?.connected) return;
    setBusy(true);
    setError(null);
    try {
      await client.setSquareProfile(handle, displayName, bio, await socialKey("profile"));
      await loadProfile();
      setEditing(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.titleRow}>
        <View><Text style={styles.eyebrow}>SOCIAL INBOX</Text><Text style={styles.title}>Alerts{unread > 0 ? ` · ${unread}` : ""}</Text></View>
        <View style={styles.actions}>
          {client?.connected ? <Pressable accessibilityLabel="Edit Social profile" onPress={() => setEditing(true)} style={styles.iconButton}><UserRound color={INK} size={19} /></Pressable> : <Pressable accessibilityLabel={stored ? "Connect Social alerts" : "Create Social identity"} disabled={busy} onPress={() => void connect()} style={styles.connectButton}>{busy ? <ActivityIndicator color={BLUE} /> : <><KeyRound color={BLUE} size={16} /><Text style={styles.connectText}>{stored ? "Connect" : "Create"}</Text></>}</Pressable>}
          <Pressable accessibilityLabel="Refresh Social alerts" disabled={loading} onPress={() => void refresh()} style={styles.iconButton}>{loading ? <ActivityIndicator color={BLUE} /> : <RefreshCw color={INK} size={19} />}</Pressable>
        </View>
      </View>
      {profile ? <View style={styles.profileStrip}><View style={styles.avatar}><Text style={styles.avatarText}>{profile.displayName.slice(0, 1).toUpperCase() || "Y"}</Text></View><View style={styles.profileCopy}><Text numberOfLines={1} style={styles.profileName}>{profile.displayName || "Create your profile"}</Text><Text numberOfLines={1} style={styles.profileMeta}>{profile.handle ? `@${profile.handle} · ` : ""}{profile.followerCount} followers · {profile.postCount} posts</Text></View></View> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!client?.connected ? <View style={styles.empty}><Bell color={BLUE} size={31} strokeWidth={1.5} /><Text style={styles.emptyTitle}>Private alerts are locked</Text><Text style={styles.emptyText}>Connect your native account to load member-scoped Social activity.</Text></View> : (
        <FlatList data={notifications} keyExtractor={(item) => item.id} contentContainerStyle={notifications.length === 0 ? styles.emptyList : styles.list} ListEmptyComponent={<View style={styles.empty}><Bell color={BLUE} size={31} strokeWidth={1.5} /><Text style={styles.emptyTitle}>No alerts yet</Text><Text style={styles.emptyText}>Comments, reactions, and follows will appear here.</Text></View>} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.readAt ? notificationLabel(item) : `${notificationLabel(item)}, unread`} disabled={busy || Boolean(item.readAt)} onPress={() => void markRead(item)} style={({ pressed }) => [styles.notification, !item.readAt && styles.notificationUnread, pressed && styles.pressed]}><View style={[styles.dot, item.readAt && styles.dotRead]} /><View style={styles.notificationBody}><Text style={styles.notificationTitle}>{notificationLabel(item)}</Text><Text numberOfLines={1} style={styles.notificationActor}>{shortAddress(item.actor)}</Text><Text style={styles.notificationTime}>{formatDate(item.createdAt)}</Text></View></Pressable>} />
      )}
      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.backdrop}><View style={styles.sheet}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Social profile</Text><Pressable accessibilityLabel="Close profile editor" onPress={() => setEditing(false)} style={styles.iconButton}><X color={INK} size={20} /></Pressable></View><TextInput accessibilityLabel="Social username" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} maxLength={24} placeholder="@username" placeholderTextColor="#98A2B3" style={styles.input} /><TextInput value={displayName} onChangeText={setDisplayName} maxLength={64} placeholder="Display name" placeholderTextColor="#98A2B3" style={styles.input} /><TextInput value={bio} onChangeText={setBio} maxLength={280} multiline placeholder="Bio" placeholderTextColor="#98A2B3" style={[styles.input, styles.bioInput]} /><Pressable disabled={busy || !/^[a-z][a-z0-9_]{2,23}$/.test(handle.trim().replace(/^@/, "").toLowerCase()) || displayName.trim().length === 0} onPress={() => void saveProfile()} style={[styles.saveButton, (busy || !/^[a-z][a-z0-9_]{2,23}$/.test(handle.trim().replace(/^@/, "").toLowerCase()) || displayName.trim().length === 0) && styles.disabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <><Save color="#FFFFFF" size={17} /><Text style={styles.saveText}>Save profile</Text></>}</Pressable></View></View>
      </Modal>
    </View>
  );
}

function notificationLabel(notification: SquareNotification): string {
  if (notification.kind === "comment") return "New comment on your post";
  if (notification.kind.startsWith("reaction_")) return `New ${notification.kind.slice(9)} reaction`;
  if (notification.kind === "follow") return "New follower";
  return "New Social activity";
}

function shortAddress(value: string): string { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unexpected Social error"; }
async function socialKey(prefix: string): Promise<string> { const bytes = await getRandomBytesAsync(12); return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  titleRow: { padding: 20, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: BLUE, fontSize: 11, fontWeight: "700", letterSpacing: 0 },
  title: { color: INK, fontSize: 30, lineHeight: 36, fontWeight: "700", marginTop: 3, letterSpacing: 0 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  connectButton: { minWidth: 88, height: 40, borderRadius: 8, borderWidth: 1, borderColor: "#C7D7FE", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#F5F8FF" },
  connectText: { color: BLUE, fontSize: 13, fontWeight: "600" },
  profileStrip: { minHeight: 70, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  avatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#EEF3FF", alignItems: "center", justifyContent: "center" },
  avatarText: { color: BLUE, fontSize: 16, fontWeight: "800" }, profileCopy: { flex: 1, marginLeft: 12 }, profileName: { color: INK, fontSize: 15, fontWeight: "700" }, profileMeta: { color: MUTED, fontSize: 12, marginTop: 4 },
  error: { color: "#B42318", fontSize: 12, lineHeight: 18, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  list: { paddingBottom: 24 }, emptyList: { flexGrow: 1 }, empty: { flex: 1, minHeight: 240, alignItems: "center", justifyContent: "center", paddingHorizontal: 36 }, emptyTitle: { color: INK, fontSize: 19, fontWeight: "600", marginTop: 14 }, emptyText: { color: MUTED, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 7 },
  notification: { minHeight: 82, paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "flex-start", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE, backgroundColor: "#FFFFFF" }, notificationUnread: { backgroundColor: "#F5F8FF" }, pressed: { opacity: 0.62 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BLUE, marginTop: 6, marginRight: 12 }, dotRead: { backgroundColor: "#D0D5DD" }, notificationBody: { flex: 1 }, notificationTitle: { color: INK, fontSize: 14, lineHeight: 20, fontWeight: "700" }, notificationActor: { color: MUTED, fontSize: 12, marginTop: 3 }, notificationTime: { color: "#98A2B3", fontSize: 11, marginTop: 5 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.32)" }, sheet: { backgroundColor: "#FFFFFF", padding: 22, paddingBottom: 36, borderTopLeftRadius: 18, borderTopRightRadius: 18 }, sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sheetTitle: { color: INK, fontSize: 22, fontWeight: "700" }, input: { minHeight: 48, marginTop: 18, borderWidth: 1, borderColor: LINE, borderRadius: 8, paddingHorizontal: 13, color: INK, fontSize: 15 }, bioInput: { minHeight: 110, paddingTop: 12, textAlignVertical: "top" }, saveButton: { minHeight: 46, marginTop: 16, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: BLUE }, saveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" }, disabled: { opacity: 0.38 },
});
