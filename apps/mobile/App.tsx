import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getRandomBytesAsync } from "expo-crypto";
import { allowScreenCaptureAsync, preventScreenCaptureAsync, usePreventScreenCapture } from "expo-screen-capture";
import { StatusBar } from "expo-status-bar";
import { Activity, KeyRound, LogOut, Plus, Radio, RefreshCw, Send, Trash2, WalletCards, X } from "lucide-react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { fetchGatewayHealth, fetchSquareFeed, type GatewayHealth, type SquarePost } from "./src/api/ynxGateway";
import { YNXMobileAppClient } from "./src/api/mobileSession";
import { accountIdentity, exportAccountSecret, importAccountSecret, isValidAccountSecret, zeroize, type YNXIdentity } from "./src/crypto/ynxSigner";
import { deleteIdentity, loadIdentity, saveIdentity, secureStorageAvailable, type StoredIdentity } from "./src/storage/secureIdentity";

type Tab = "square" | "wallet" | "network";

const BLUE = "#002FA7";
const INK = "#111827";
const MUTED = "#667085";
const LINE = "#E5E7EB";
const RECOVERY_CAPTURE_KEY = "ynx-recovery-key";

export default function App() {
  return (
    <SafeAreaProvider>
      <YNXApp />
    </SafeAreaProvider>
  );
}

function YNXApp() {
  const [tab, setTab] = useState<Tab>("square");
  const [stored, setStored] = useState<StoredIdentity | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!await secureStorageAvailable()) throw new Error("Platform secure storage is unavailable on this device");
        const value = await loadIdentity();
        if (active) setStored(value);
      } catch (error) {
        if (active) setStorageError(errorMessage(error));
      } finally {
        if (active) setStorageReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const identity = useMemo(() => stored ? accountIdentity(stored.accountSecret) : null, [stored]);

  const handleSaved = (value: StoredIdentity) => {
    setStorageError(null);
    setStored(value);
  };

  const handleDeleted = () => {
    setStorageError(null);
    setStored(null);
  };

  const resetUnreadableStorage = async () => {
    await deleteIdentity();
    handleDeleted();
  };

  useEffect(() => () => {
    if (stored) zeroize(stored.accountSecret, stored.deviceSecret);
  }, [stored]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Image source={require("./assets/ynx-logo.png")} resizeMode="contain" style={styles.brandLogo} accessibilityLabel="YNX" />
        <View style={styles.headerStatus}>
          <View style={styles.liveDot} />
          <Text style={styles.headerStatusText}>Testnet</Text>
        </View>
      </View>

      <View style={styles.content}>
        {tab === "square" && <SquareScreen stored={stored} openWallet={() => setTab("wallet")} />}
        {tab === "wallet" && (
          <WalletScreen
            identity={identity}
            loading={!storageReady}
            error={storageError}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onResetUnreadable={storageError?.startsWith("Secure YNX identity record") ? resetUnreadableStorage : null}
          />
        )}
        {tab === "network" && <NetworkScreen />}
      </View>

      <View style={styles.tabBar}>
        <TabButton active={tab === "square"} icon={Radio} label="Square" onPress={() => setTab("square")} />
        <TabButton active={tab === "wallet"} icon={WalletCards} label="Wallet" onPress={() => setTab("wallet")} />
        <TabButton active={tab === "network"} icon={Activity} label="Network" onPress={() => setTab("network")} />
      </View>
    </SafeAreaView>
  );
}

function SquareScreen({ stored, openWallet }: { stored: StoredIdentity | null; openWallet: () => void }) {
  const [posts, setPosts] = useState<SquarePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<YNXMobileAppClient | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [content, setContent] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      setPosts(await fetchSquareFeed());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (client) void client.lockAndRevokeSession().catch(() => undefined);
  }, [client]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || !client) return;
      const current = client;
      setClient(null);
      setComposeOpen(false);
      setContent("");
      setSessionError("Session locked when YNX left the foreground. Connect again to continue.");
      void current.lockAndRevokeSession().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [client]);

  const storedAccount = stored ? accountIdentity(stored.accountSecret).account : null;
  useEffect(() => {
    if (!client || client.account === storedAccount) return;
    const current = client;
    setClient(null);
    setComposeOpen(false);
    setContent("");
    setSessionError("Local identity changed. Connect again to continue.");
    void current.lockAndRevokeSession().catch(() => undefined);
  }, [client, storedAccount]);

  const connect = async () => {
    if (!stored) { openWallet(); return; }
    setSessionBusy(true);
    setSessionError(null);
    const next = new YNXMobileAppClient(stored);
    try {
      await next.connect();
      setClient(next);
    } catch (caught) {
      next.lock();
      setSessionError(errorMessage(caught));
    } finally {
      setSessionBusy(false);
    }
  };

  const disconnect = async () => {
    if (!client) return;
    setSessionBusy(true);
    try { await client.disconnect(true); } catch (caught) { setSessionError(errorMessage(caught)); }
    finally { client.lock(); setClient(null); setSessionBusy(false); }
  };

  const publish = async () => {
    if (!client || !client.connected) return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const random = await getRandomBytesAsync(12);
      const idempotencyKey = `post-${Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("")}`;
      await client.createPost(content, idempotencyKey);
      setContent("");
      setComposeOpen(false);
      await load(true);
    } catch (caught) {
      setSessionError(errorMessage(caught));
    } finally {
      setSessionBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.screenTitleRow}>
        <View>
          <Text style={styles.eyebrow}>PUBLIC SQUARE</Text>
          <Text style={styles.title}>Chain activity</Text>
        </View>
        <View style={styles.headerActions}>
          {client?.connected ? (
            <>
              <Pressable accessibilityLabel="Disconnect Square session" onPress={() => void disconnect()} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><LogOut color={INK} size={18} /></Pressable>
              <Pressable accessibilityLabel="Create Square post" onPress={() => setComposeOpen(true)} style={({ pressed }) => [styles.squareCreateButton, pressed && styles.primaryPressed]}><Plus color="#FFFFFF" size={20} /></Pressable>
            </>
          ) : (
            <Pressable accessibilityLabel={stored ? "Connect Square identity" : "Open wallet"} disabled={sessionBusy} onPress={() => void connect()} style={({ pressed }) => [styles.connectButton, pressed && styles.pressed]}>
              {sessionBusy ? <ActivityIndicator color={BLUE} /> : <><KeyRound color={BLUE} size={16} /><Text style={styles.connectText}>{stored ? "Connect" : "Wallet"}</Text></>}
            </Pressable>
          )}
          <Pressable accessibilityLabel="Refresh Square" onPress={() => void load(true)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><RefreshCw color={INK} size={19} strokeWidth={1.8} /></Pressable>
        </View>
      </View>
      {sessionError ? <Text style={styles.inlineError}>{sessionError}</Text> : null}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={BLUE} /><Text style={styles.centerText}>Connecting to Square</Text></View>
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={BLUE} />}
          contentContainerStyle={posts.length === 0 ? styles.emptyList : styles.feedList}
          ListEmptyComponent={<View style={styles.center}><Radio color={BLUE} size={30} strokeWidth={1.5} /><Text style={styles.emptyTitle}>The Square is quiet</Text><Text style={styles.centerText}>Live public feed connected. No posts are stored yet.</Text></View>}
          renderItem={({ item }) => <PostRow post={item} />}
        />
      )}
      <Modal visible={composeOpen} transparent animationType="slide" onRequestClose={() => setComposeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New post</Text>
              <Pressable accessibilityLabel="Close" onPress={() => setComposeOpen(false)} style={styles.iconButton}><X color={INK} size={20} /></Pressable>
            </View>
            <TextInput value={content} onChangeText={setContent} autoCapitalize="sentences" autoCorrect multiline maxLength={2000} style={styles.composeInput} placeholder="Share with the YNX Square" placeholderTextColor="#98A2B3" />
            <View style={styles.composeFooter}>
              <Text style={styles.characterCount}>{content.length}/2000</Text>
              <Pressable disabled={sessionBusy || content.trim().length === 0} onPress={() => void publish()} style={[styles.publishButton, (sessionBusy || content.trim().length === 0) && styles.disabled]}>
                {sessionBusy ? <ActivityIndicator color="#FFFFFF" /> : <><Send color="#FFFFFF" size={17} /><Text style={styles.primaryButtonText}>Publish</Text></>}
              </Pressable>
            </View>
            {sessionError ? <Text style={styles.errorText}>{sessionError}</Text> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PostRow({ post }: { post: SquarePost }) {
  return (
    <View style={styles.postRow}>
      <View style={styles.avatar}><Text style={styles.avatarText}>Y</Text></View>
      <View style={styles.postBody}>
        <View style={styles.postMeta}>
          <Text numberOfLines={1} style={styles.postAuthor}>{shortAddress(post.author)}</Text>
          <Text style={styles.postTime}>{formatDate(post.createdAt)}</Text>
        </View>
        <Text style={styles.postContent}>{post.content}</Text>
        {post.tags?.length ? <Text style={styles.tags}>{post.tags.map((tag) => `#${tag}`).join("  ")}</Text> : null}
        <Text style={styles.postStats}>{post.commentCount} replies  ·  {post.reactionCount} reactions</Text>
      </View>
    </View>
  );
}

function WalletScreen(props: { identity: YNXIdentity | null; loading: boolean; error: string | null; onSaved: (value: StoredIdentity) => void; onDeleted: () => void; onResetUnreadable: (() => Promise<void>) | null }) {
  const [mode, setMode] = useState<"closed" | "create" | "import">("closed");
  const [pending, setPending] = useState<StoredIdentity | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (pending) zeroize(pending.accountSecret, pending.deviceSecret);
    setPending(null);
    setConfirmed(false);
    setImportValue("");
    setError(null);
    setMode("closed");
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await preventScreenCaptureAsync(RECOVERY_CAPTURE_KEY);
      let accountSecret: Uint8Array;
      do accountSecret = await getRandomBytesAsync(32); while (!isValidAccountSecret(accountSecret));
      const deviceSecret = await getRandomBytesAsync(32);
      setPending(Object.freeze({ accountSecret, deviceSecret }));
      setMode("create");
    } catch (caught) {
      await allowScreenCaptureAsync(RECOVERY_CAPTURE_KEY).catch(() => undefined);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const persist = async (value: StoredIdentity) => {
    setBusy(true);
    setError(null);
    try {
      await saveIdentity(value.accountSecret, value.deviceSecret);
      props.onSaved(Object.freeze({ accountSecret: value.accountSecret.slice(), deviceSecret: value.deviceSecret.slice() }));
      close();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const importExisting = async () => {
    try {
      const accountSecret = importAccountSecret(importValue);
      const deviceSecret = await getRandomBytesAsync(32);
      await persist(Object.freeze({ accountSecret, deviceSecret }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const remove = () => Alert.alert("Remove local identity?", "This device will lose access unless the recovery key is backed up.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: async () => { await deleteIdentity(); props.onDeleted(); } },
  ]);

  const resetUnreadable = () => Alert.alert("Remove unreadable identity data?", "The damaged local record cannot be recovered. Continue only if the recovery key is stored offline.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: async () => {
      setBusy(true);
      setError(null);
      try {
        if (!props.onResetUnreadable) throw new Error("Secure storage cannot be reset on this device");
        await props.onResetUnreadable();
      } catch (caught) { setError(errorMessage(caught)); }
      finally { setBusy(false); }
    } },
  ]);

  if (props.loading) return <View style={styles.center}><ActivityIndicator color={BLUE} /></View>;
  return (
    <View style={styles.screenPadded}>
      <Text style={styles.eyebrow}>NATIVE IDENTITY</Text>
      <Text style={styles.title}>Wallet</Text>
      {props.error ? (
        <View style={styles.recoveryErrorPanel}>
          <Text style={styles.errorText}>{props.error}</Text>
          {props.onResetUnreadable ? (
            <>
              <Text style={styles.walletNote}>YNX will not use an unreadable secure record. Remove it, then import the offline recovery key.</Text>
              <Pressable disabled={busy} onPress={resetUnreadable} style={({ pressed }) => [styles.destructiveButton, pressed && styles.pressed]}>
                {busy ? <ActivityIndicator color="#B42318" /> : <><Trash2 color="#B42318" size={18} /><Text style={styles.destructiveText}>Remove unreadable data</Text></>}
              </Pressable>
            </>
          ) : null}
        </View>
      ) : props.identity ? (
        <View style={styles.walletBody}>
          <Text style={styles.walletLabel}>YNX address</Text>
          <Text selectable style={styles.address}>{props.identity.account}</Text>
          <View style={styles.divider} />
          <Text style={styles.walletLabel}>EVM compatibility address</Text>
          <Text selectable style={styles.secondaryAddress}>{props.identity.evmAddress}</Text>
          <Text style={styles.walletNote}>The ynx1 address is the default YNX identity. The 0x address is exposed only for EVM-compatible tooling.</Text>
          <Pressable onPress={remove} style={({ pressed }) => [styles.destructiveButton, pressed && styles.pressed]}>
            <Trash2 color="#B42318" size={18} /><Text style={styles.destructiveText}>Remove from this device</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.onboarding}>
          <View style={styles.keyCircle}><KeyRound color={BLUE} size={30} strokeWidth={1.5} /></View>
          <Text style={styles.emptyTitle}>Own your YNX identity</Text>
          <Text style={styles.centerText}>Keys stay in iOS Keychain or Android Keystore-backed secure storage.</Text>
          <Pressable disabled={busy} onPress={() => void create()} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>Create identity</Text>}
          </Pressable>
          <Pressable onPress={() => setMode("import")} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>Import recovery key</Text>
          </Pressable>
        </View>
      )}
      <Modal visible={mode !== "closed"} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{mode === "create" ? "Recovery key" : "Import identity"}</Text>
              <Pressable accessibilityLabel="Close" onPress={close} style={styles.iconButton}><X color={INK} size={20} /></Pressable>
            </View>
            {mode === "create" && pending ? (
              <RecoveryPanel pending={pending} confirmed={confirmed} setConfirmed={setConfirmed} busy={busy} persist={persist} />
            ) : (
              <>
                <Text style={styles.modalText}>Enter the 64-character hexadecimal recovery key.</Text>
                <TextInput value={importValue} onChangeText={setImportValue} autoCapitalize="none" autoCorrect={false} secureTextEntry multiline style={styles.input} placeholder="Recovery key" placeholderTextColor="#98A2B3" />
                <Pressable disabled={busy || importValue.trim().length !== 64} onPress={() => void importExisting()} style={[styles.primaryButton, (busy || importValue.trim().length !== 64) && styles.disabled]}>
                  {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>Import securely</Text>}
                </Pressable>
              </>
            )}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RecoveryPanel({ pending, confirmed, setConfirmed, busy, persist }: { pending: StoredIdentity; confirmed: boolean; setConfirmed: (value: boolean) => void; busy: boolean; persist: (value: StoredIdentity) => Promise<void> }) {
  usePreventScreenCapture(RECOVERY_CAPTURE_KEY);
  return (
    <>
      <Text style={styles.modalText}>Store this key offline. YNX cannot recover it. Screen capture is blocked while this panel is open.</Text>
      <Text selectable style={styles.recoveryKey}>{exportAccountSecret(pending.accountSecret)}</Text>
      <Pressable onPress={() => setConfirmed(!confirmed)} style={styles.confirmRow}>
        <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>{confirmed && <Text style={styles.check}>✓</Text>}</View>
        <Text style={styles.confirmText}>I saved the recovery key offline</Text>
      </Pressable>
      <Pressable disabled={!confirmed || busy} onPress={() => void persist(pending)} style={[styles.primaryButton, (!confirmed || busy) && styles.disabled]}>
        {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>Secure on this device</Text>}
      </Pressable>
    </>
  );
}

function NetworkScreen() {
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setHealth(await fetchGatewayHealth()); setError(null); } catch (caught) { setError(errorMessage(caught)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <View style={styles.screenPadded}>
      <View style={styles.screenTitleRow}>
        <View><Text style={styles.eyebrow}>PUBLIC TESTNET</Text><Text style={styles.title}>Network</Text></View>
        <Pressable accessibilityLabel="Refresh network" onPress={() => void load()} style={styles.iconButton}><RefreshCw color={INK} size={19} /></Pressable>
      </View>
      {error ? <ErrorState message={error} retry={() => void load()} /> : !health ? <View style={styles.center}><ActivityIndicator color={BLUE} /></View> : (
        <View style={styles.metrics}>
          <Metric label="Gateway" value={health.ok ? "Operational" : "Degraded"} tone={health.ok ? "good" : "bad"} />
          <Metric label="Deployment" value={health.remoteDeployed ? "Public" : "Local only"} />
          <Metric label="Active sessions" value={String(health.activeSessions)} />
          <Metric label="Release" value={health.build?.release || "Unreported"} />
          <Text style={styles.networkFootnote}>Live status from api.ynxweb4.com. This is public testnet evidence, not a mainnet launch claim.</Text>
        </View>
      )}
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, tone === "good" && styles.good, tone === "bad" && styles.bad]}>{value}</Text></View>;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <View style={styles.center}><Text style={styles.errorText}>{message}</Text><Pressable onPress={retry} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Try again</Text></Pressable></View>;
}

function TabButton({ active, icon: Icon, label, onPress }: { active: boolean; icon: typeof Radio; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}><Icon color={active ? BLUE : "#7A8494"} size={21} strokeWidth={active ? 2.2 : 1.8} /><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}

function shortAddress(value: string): string { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unexpected YNX application error"; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { height: 58, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  brandLogo: { width: 54, height: 29 },
  headerStatus: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#12B76A" },
  headerStatusText: { color: MUTED, fontSize: 12, fontWeight: "600" },
  content: { flex: 1 }, screen: { flex: 1 }, screenPadded: { flex: 1, padding: 20 },
  screenTitleRow: { padding: 20, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: BLUE, fontSize: 11, fontWeight: "700", letterSpacing: 0 },
  title: { color: INK, fontSize: 30, lineHeight: 36, fontWeight: "700", marginTop: 3, letterSpacing: 0 },
  iconButton: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  connectButton: { minWidth: 88, height: 40, borderRadius: 8, borderWidth: 1, borderColor: "#C7D7FE", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#F5F8FF" },
  connectText: { color: BLUE, fontSize: 13, fontWeight: "600" }, squareCreateButton: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: BLUE },
  inlineError: { color: "#B42318", fontSize: 12, lineHeight: 18, paddingHorizontal: 20, paddingBottom: 8 },
  pressed: { opacity: 0.62 }, primaryPressed: { backgroundColor: "#001F70" },
  center: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, gap: 12 },
  centerText: { color: MUTED, textAlign: "center", fontSize: 14, lineHeight: 21 },
  emptyTitle: { color: INK, fontSize: 19, fontWeight: "600", marginTop: 4 }, emptyList: { flexGrow: 1 }, feedList: { paddingBottom: 22 },
  postRow: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  avatar: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#EEF3FF", alignItems: "center", justifyContent: "center" },
  avatarText: { color: BLUE, fontWeight: "800", fontSize: 15 }, postBody: { flex: 1, marginLeft: 12 },
  postMeta: { flexDirection: "row", alignItems: "center", gap: 10 }, postAuthor: { color: INK, fontSize: 13, fontWeight: "600", flexShrink: 1 }, postTime: { color: "#98A2B3", fontSize: 12 },
  postContent: { color: INK, fontSize: 15, lineHeight: 22, marginTop: 7 }, tags: { color: BLUE, fontSize: 13, marginTop: 8 }, postStats: { color: MUTED, fontSize: 12, marginTop: 11 },
  tabBar: { height: 70, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE, backgroundColor: "rgba(255,255,255,0.98)" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5 }, tabText: { color: "#7A8494", fontSize: 11, fontWeight: "600" }, tabTextActive: { color: BLUE },
  walletBody: { marginTop: 36 }, walletLabel: { color: MUTED, fontSize: 12, fontWeight: "600" }, address: { color: INK, fontSize: 17, lineHeight: 25, fontWeight: "600", marginTop: 9 }, secondaryAddress: { color: INK, fontSize: 14, lineHeight: 22, marginTop: 9 },
  recoveryErrorPanel: { marginTop: 24 },
  divider: { height: 1, backgroundColor: LINE, marginVertical: 24 }, walletNote: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 14 },
  onboarding: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, keyCircle: { width: 64, height: 64, borderRadius: 18, backgroundColor: "#EEF3FF", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  primaryButton: { minHeight: 48, borderRadius: 8, backgroundColor: BLUE, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 24 }, primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  secondaryButton: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: LINE, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", marginTop: 12, backgroundColor: "#FFFFFF" }, secondaryButtonText: { color: INK, fontSize: 14, fontWeight: "600" },
  destructiveButton: { marginTop: 32, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderWidth: 1, borderColor: "#FECDCA", borderRadius: 8 }, destructiveText: { color: "#B42318", fontSize: 14, fontWeight: "600" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.32)" }, modalSheet: { backgroundColor: "#FFFFFF", padding: 22, paddingBottom: 36, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, modalTitle: { color: INK, fontSize: 22, fontWeight: "700" }, modalText: { color: MUTED, fontSize: 14, lineHeight: 21, marginTop: 18 },
  recoveryKey: { marginTop: 16, padding: 14, backgroundColor: "#F5F7FA", color: INK, fontSize: 12, lineHeight: 19, borderRadius: 8 }, confirmRow: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 20 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: "#98A2B3", alignItems: "center", justifyContent: "center" }, checkboxChecked: { backgroundColor: BLUE, borderColor: BLUE }, check: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" }, confirmText: { color: INK, fontSize: 14, flex: 1 },
  input: { minHeight: 96, marginTop: 16, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 14, color: INK, fontSize: 14, textAlignVertical: "top" }, disabled: { opacity: 0.38 },
  composeInput: { minHeight: 150, marginTop: 18, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 14, color: INK, fontSize: 16, lineHeight: 23, textAlignVertical: "top" },
  composeFooter: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, characterCount: { color: MUTED, fontSize: 12 }, publishButton: { minHeight: 44, borderRadius: 8, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: BLUE },
  errorText: { color: "#B42318", fontSize: 13, lineHeight: 19, marginTop: 14, textAlign: "center" },
  metrics: { marginTop: 26, borderTopWidth: 1, borderTopColor: LINE }, metric: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, metricLabel: { color: MUTED, fontSize: 14 }, metricValue: { color: INK, fontSize: 14, fontWeight: "600", maxWidth: "58%", textAlign: "right" }, good: { color: "#067647" }, bad: { color: "#B42318" }, networkFootnote: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 22 },
});
