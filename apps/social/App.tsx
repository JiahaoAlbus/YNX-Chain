import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Alert as NativeAlert,
  AppState,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable as NativePressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextProps,
  type TextInputProps,
  type PressableProps,
  type AlertButton,
  type AlertOptions,
} from "react-native";
import {
  CryptoDigestAlgorithm,
  digest,
  digestStringAsync,
  getRandomBytesAsync,
} from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as ExpoContacts from "expo-contacts";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { AccountIntentIndex } from "./src/accountIntentIndex";
import { File, Paths } from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import {
  ArrowLeft,
  Bell,
  Bot,
  CheckCheck,
  ContactRound,
  Flag,
  Heart,
  KeyRound,
  MessageCircle,
  MoreVertical,
  Settings,
  Paperclip,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import {
  SocialAPI,
  adoptRotatedSession,
  type AIJob,
  type AlertItem,
  type ContactMatch,
  type ContactRequest,
  type Conversation,
  type FeedPost,
  type MomentComment,
  type Person,
  type PrivacySettings,
  type Session,
  type SocialProfile,
  type SocialReport,
} from "./src/api";
import {
  base64Raw,
  chatRegistrationPayload,
  createWalletRequest,
  deviceProofPayload,
  encodeBase64URL,
  parseWalletCallback,
  registrationIdempotencyKey,
  signGatewayChallenge,
  squareRegistrationPayload,
  walletRequestURL,
  type WalletAuthorizationRequest,
} from "./src/walletAuth";
import {
  createDeviceRotation,
  createEnvelopeSet,
  decodeRawBase64,
  decryptAttachment,
  decryptDeviceMessage,
  encodeRawBase64,
  encryptAttachment,
  verifyMessageSignature,
  type AttachmentPayload,
  type ChatMessage,
  type SendMessageRequest,
} from "./src/chatCrypto";
import {
  formatDate,
  formatNumber,
  localeNames,
  locales,
  translate,
} from "./src/i18n";
import { I18nProvider, useI18n } from "./src/i18nProvider";
import { queueMessage, acknowledgeQueued, pendingFor, assertPendingRecipients } from "./src/messageOutbox";
import { DurableOutbox } from "./src/durableOutbox";
import { SocialCloudAttachments, type CloudObjectRecord } from "./src/cloudAttachments";
import { NativeSessionPanel } from "./src/NativeSessionPanel";
import { nativeSocialSession, nativeChatDevice } from "./src/nativeSessionRuntime";
import { bindScopedSocialSession } from "./src/scopedSessionBridge";
import {ContactRequestFlow,socialProfileQR,requireSocialProfileQR,socialDiscoveryEntry,type SocialDiscoveryEntry,type ContactReview} from "./src/contactRequestFlow";
import {runCurrentContactAction} from './src/contactActionGuard';
import {NativeMomentIntents,publishOriginalNativeMoment} from './src/nativeMomentIntent';
import {NativeMomentActions} from './src/nativeMomentActions';
import {NativeDiscoveryIntents,isOriginalDiscoveryReview} from './src/nativeDiscoveryIntent';
import {NativeContactIntents} from './src/nativeContactIntent';
import {ContactOperation} from './src/contactOperation';
import { SocialAppearanceProvider, AppearanceSettings, useSocialAppearance } from './src/SocialAppearance';
import { GuestWorkspace } from './src/GuestWorkspace';
import { socialLayout, messageDayBoundary } from './src/socialPresentation';
import { ChatAppearanceSettings, NativeChatWallpaper, useNativeChatAppearance } from './src/ChatAppearanceSettings';

const BLUE = "#002FA7",
  INK = "#101828",
  MUTED = "#667085",
  LINE = "#E4E7EC",
  SURFACE = "#F7F8FA";
const localizeNode = (value: React.ReactNode, t: (input: string) => string): React.ReactNode =>
  typeof value === "string"
    ? t(value)
    : Array.isArray(value)
      ? value.map((item) => localizeNode(item, t))
      : value;
function Text({ children, ...props }: TextProps) {
  const { t } = useI18n();
  const { scale } = useSocialAppearance();
  const original = StyleSheet.flatten(props.style) ?? {};
  return <NativeText {...props} allowFontScaling style={[props.style, {
    fontSize: (original.fontSize ?? 14) * scale,
    ...(typeof original.lineHeight === 'number' ? { lineHeight: original.lineHeight * scale } : {}),
  }]}>{localizeNode(children, t)}</NativeText>;
}
function TextInput(props: TextInputProps) {
  const { t } = useI18n();
  const { scale } = useSocialAppearance();
  const original = StyleSheet.flatten(props.style) ?? {};
  return (
    <NativeTextInput
      {...props}
      allowFontScaling
      style={[props.style, { fontSize: (original.fontSize ?? 15) * scale }]}
      placeholder={props.placeholder ? t(props.placeholder) : undefined}
      accessibilityLabel={
        props.accessibilityLabel ? t(props.accessibilityLabel) : undefined
      }
    />
  );
}
function Pressable(props: PressableProps) {
  const { t } = useI18n();
  return (
    <NativePressable
      {...props}
      accessibilityLabel={
        props.accessibilityLabel ? t(props.accessibilityLabel) : undefined
      }
    />
  );
}
const Alert = {
  alert(title: string, body?: string, buttons?: AlertButton[], options?: AlertOptions) {
    NativeAlert.alert(
      translate(title),
      body ? translate(body) : undefined,
      buttons?.map((button) => ({
        ...button,
        text: button.text ? translate(button.text) : button.text,
      })),
      options,
    );
  },
};
const SESSION_KEY = "ynx.social.session.v1",
  DEVICE_KEY = "ynx.social.device.v1",
  PENDING_KEY = "ynx.social.wallet.pending.v1";
const OUTBOX_KEY = "ynx.social.outbox.v1",
  ROTATION_KEY = "ynx.social.rotation.v1";
const outboxFile = () => new File(Paths.document, `${OUTBOX_KEY}.json`);
const outboxSlot = (slot: string) => slot === "legacy" ? outboxFile() : new File(Paths.document, `${OUTBOX_KEY}.${slot}.json`);
const messageOutbox = new DurableOutbox({
  read(slot) { const file = outboxSlot(slot); return file.exists ? file.textSync() : null; },
  write(slot, value) { outboxSlot(slot).write(value); },
  remove(slot) { const file = outboxSlot(slot); if (file.exists) file.delete(); },
});
const accountIntentIndex=new AccountIntentIndex({
  read:key=>SecureStore.getItemAsync(key),
  write:(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),
  remove:key=>SecureStore.deleteItemAsync(key),
});
type Tab = "contacts" | "messages" | "moments" | "alerts" | "profile";

export default function App() {
  return (
    <I18nProvider>
      <SocialAppearanceProvider><SafeAreaProvider>
        <SocialApp />
      </SafeAreaProvider></SocialAppearanceProvider>
    </I18nProvider>
  );
}
function SocialApp() {
  const { t, isRTL } = useI18n();
  const { width } = useWindowDimensions();
  const desktop = socialLayout(width).desktop;
  const [threadOpen, setThreadOpen] = useState(false);
  const [discovery,setDiscovery]=useState<SocialDiscoveryEntry|null>(null);
  const discoveryIntents=useMemo(()=>new NativeDiscoveryIntents({
    read:()=>SecureStore.getItemAsync('ynx.social.discovery.intent.v1'),
    write:value=>SecureStore.setItemAsync('ynx.social.discovery.intent.v1',value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),
  }),[]);
  const consumeDiscovery=useCallback((value:string)=>{
    setDiscovery(original=>original?.value===value?null:original);
    void discoveryIntents.consume(value).catch(caught=>setError(message(caught)));
  },[discoveryIntents]);
  useEffect(()=>{
    let active=true,received=false,revision=0;
    const accept=(value:string)=>{
      const entry=socialDiscoveryEntry(value);if(!active||!entry)return;received=true;const own=++revision;
      void discoveryIntents.save(entry).then(()=>{if(active&&own===revision)setDiscovery(entry)}).catch(caught=>{if(active&&own===revision)setError(message(caught))});
    };
    void discoveryIntents.load().then(entry=>{if(active&&!received&&entry)setDiscovery(entry)}).catch(caught=>{if(active&&!received)setError(message(caught))});
    const subscription=Linking.addEventListener('url',event=>{received=true;accept(event.url)});
    void Linking.getInitialURL().then(value=>{if(active&&!received&&value)accept(value)}).catch(()=>{});
    return()=>{active=false;subscription.remove()};
  },[discoveryIntents]);
  const [tab, setTab] = useState<Tab>("messages"),
    [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const api = useMemo(() => {
    try {
      const client=new SocialAPI();
      client.onPrivateInvalidated=()=>setSession(null);
      return client;
    } catch (caught) {
      setError(message(caught));
      return null;
    }
  }, []);
  const connectScoped = useCallback(async(account:string)=>{
    if(!api)throw new Error("Social API is unavailable");
    const device=await nativeChatDevice(account);
    const result=await bindScopedSocialSession(api,nativeSocialSession("chat"),device);
    if(result.session.account!==account)throw new Error("Social account changed before binding");
    const profile=await api.profileOrSetup();
    await SecureStore.setItemAsync(SESSION_KEY,JSON.stringify(result),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
    setSession(result);if(!profile)setTab("profile");setError(null);
  },[api]);
  useEffect(()=>{if(session&&discovery)setTab('contacts')},[session,discovery]);
  useEffect(() => {
    void (async () => {
      try {
        const [value, deviceRaw] = await Promise.all([
          SecureStore.getItemAsync(SESSION_KEY),
          SecureStore.getItemAsync(DEVICE_KEY),
        ]);
        if (!value) return;
        const parsed = JSON.parse(value) as Session;
        if(parsed.authMode==="product-session-v2"){
          const restored=await nativeSocialSession("chat").restore();
          if(restored.status!=="connected"||restored.account!==parsed.session.account)throw new Error("Saved Social permission needs an explicit reconnect");
          await connectScoped(restored.account);return;
        }
        if (deviceRaw) {
          const device = JSON.parse(deviceRaw) as Record<string, string>;
          if (
            /^[0-9a-f]{64}$/.test(device.signingSeed ?? "") &&
            /^[0-9a-f]{64}$/.test(device.encryptionSeed ?? "") &&
            (!/^social-[0-9a-f]{24}$/.test(device.deviceId ?? "") ||
              !/^[0-9a-f]{64}$/.test(device.productSecret ?? ""))
          ) {
            let productSecret = await getRandomBytesAsync(32);
            while (!p256.utils.isValidSecretKey(productSecret))
              productSecret = await getRandomBytesAsync(32);
            await SecureStore.setItemAsync(
              DEVICE_KEY,
              JSON.stringify({
                ...device,
                deviceId: parsed.session.deviceId,
                productSecret: Array.from(productSecret, (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join(""),
              }),
              {
                keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
              },
            );
          }
        }
        api?.setToken(parsed.token);
        if (!api) throw new Error("Social API is unavailable");
        await api.profile();
        setSession(parsed);
      } catch (caught) {
        setError(message(caught));
      } finally {
        setLoading(false);
      }
    })();
  }, [api,connectScoped]);
  useEffect(()=>nativeSocialSession("chat").subscribe(value=>{
    if(session?.authMode==="product-session-v2"&&(value.status!=="connected"||value.account!==session.session.account)){
      api?.setToken(null);setSession(null);
    }
  }),[api,session]);
  const handleURL = useCallback(
    async (value: string) => {
      if (!api) return;
      try {
        const pendingRaw = await SecureStore.getItemAsync(PENDING_KEY),
          keyRaw = await SecureStore.getItemAsync(DEVICE_KEY);
        if (!pendingRaw || !keyRaw)
          throw new Error("No Wallet sign-in request is pending");
        const pending = JSON.parse(pendingRaw) as {
          request: WalletAuthorizationRequest;
          deviceId: string;
          devicePublicKey: string;
          encryptionPublicKey: string;
        };
        const approval = parseWalletCallback(value, pending.request);
        const keys = JSON.parse(keyRaw) as {
          signingSeed: string;
          encryptionSeed: string;
          productSecret: string;
        };
        const seed = hexBytes(keys.signingSeed),
          productSecret = hexBytes(keys.productSecret),
          challenge = (await api.walletChallenge(pending.request, approval))
            .challenge,
          completion = signGatewayChallenge(challenge, productSecret),
          squareKey = registrationIdempotencyKey(
            "social-square",
            approval.requestDigest,
          ),
          chatKey = registrationIdempotencyKey(
            "social-chat",
            approval.requestDigest,
          );
        const proofInput = {
            approval,
            challenge,
            deviceId: pending.deviceId,
            deviceSigningPublicKey: pending.devicePublicKey,
            deviceEncryptionPublicKey: pending.encryptionPublicKey,
          },
          deviceProofSignature = base64Raw(
            ed25519.sign(deviceProofPayload(proofInput), seed),
          ),
          squareRegistrationSignature = base64Raw(
            ed25519.sign(
              squareRegistrationPayload(
                approval,
                pending.deviceId,
                pending.devicePublicKey,
                squareKey,
              ),
              seed,
            ),
          ),
          chatRegistrationSignature = base64Raw(
            ed25519.sign(
              chatRegistrationPayload(
                approval,
                pending.deviceId,
                pending.devicePublicKey,
                pending.encryptionPublicKey,
                chatKey,
              ),
              seed,
            ),
          );
        const result = await api.login({
          ...completion,
          deviceId: pending.deviceId,
          deviceSigningPublicKey: pending.devicePublicKey,
          deviceEncryptionPublicKey: pending.encryptionPublicKey,
          deviceProofSignature,
          squareRegistrationSignature,
          chatRegistrationSignature,
        });
        api.setToken(result.token);
        await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(result));
        await SecureStore.deleteItemAsync(PENDING_KEY);
        setSession(result);
        setError(null);
      } catch (caught) {
        setError(message(caught));
      }
    },
    [api],
  );
  // Official v2 callback ownership lives in NativeSessionPanel. Legacy protected
  // records are retained, but the retired v1 parser cannot consume v2 returns.
  const signIn = async () => {
    try {
      const hex = (value: Uint8Array) =>
        Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        );
      const storedRaw = await SecureStore.getItemAsync(DEVICE_KEY);
      let stored:
        | {
            deviceId: string;
            signingSeed: string;
            encryptionSeed: string;
            productSecret: string;
          }
        | undefined;
      try {
        const candidate = storedRaw ? JSON.parse(storedRaw) : null;
        if (
          candidate &&
          /^social-[0-9a-f]{24}$/.test(candidate.deviceId) &&
          /^[0-9a-f]{64}$/.test(candidate.signingSeed) &&
          /^[0-9a-f]{64}$/.test(candidate.encryptionSeed) &&
          /^[0-9a-f]{64}$/.test(candidate.productSecret) &&
          p256.utils.isValidSecretKey(hexBytes(candidate.productSecret))
        )
          stored = candidate;
      } catch {}
      if (!stored) {
        const signingSeed = await getRandomBytesAsync(32),
          encryptionSeed = await getRandomBytesAsync(32),
          deviceRandom = await getRandomBytesAsync(18);
        let productSecret = await getRandomBytesAsync(32);
        while (!p256.utils.isValidSecretKey(productSecret))
          productSecret = await getRandomBytesAsync(32);
        stored = {
          deviceId: `social-${hex(deviceRandom).slice(0, 24)}`,
          signingSeed: hex(signingSeed),
          encryptionSeed: hex(encryptionSeed),
          productSecret: hex(productSecret),
        };
        await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(stored), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      const random = await getRandomBytesAsync(32),
        signingSeed = hexBytes(stored.signingSeed),
        encryptionSeed = hexBytes(stored.encryptionSeed),
        productSecret = hexBytes(stored.productSecret),
        deviceId = stored.deviceId,
        nonce = encodeBase64URL(random),
        devicePublicKey = base64Raw(ed25519.getPublicKey(signingSeed)),
        encryptionPublicKey = base64Raw(x25519.getPublicKey(encryptionSeed)),
        request = createWalletRequest(
          nonce,
          encodeBase64URL(p256.getPublicKey(productSecret, true)),
        );
      await SecureStore.setItemAsync(
        PENDING_KEY,
        JSON.stringify({
          request,
          deviceId,
          devicePublicKey,
          encryptionPublicKey,
        }),
      );
      await Linking.openURL(walletRequestURL(request));
    } catch (caught) {
      setError(message(caught));
    }
  };
  const signOut = () =>
    Alert.alert(
      "Sign out of YNX Social?",
      "Messages remain encrypted on this device. You can sign in again with YNX Wallet.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () =>
            void (async () => {
              api?.setToken(null);
              const retained=await SecureStore.getItemAsync(DEVICE_KEY);
              if(retained&&session)await SecureStore.setItemAsync(DEVICE_KEY,JSON.stringify({...JSON.parse(retained),account:session.session.account}),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
              if(session?.authMode==="product-session-v2")await nativeSocialSession("chat").disconnect().catch(()=>setError("Revocation is pending; private API access is suspended"));
              await SecureStore.deleteItemAsync(SESSION_KEY);
              api?.setToken(null);
              setSession(null);
            })(),
        },
      ],
    );
  if (loading)
    return (
      <SafeAreaView
        style={[styles.center, { direction: isRTL ? "rtl" : "ltr" }]}
      >
        <Image source={require("./assets/ynx-original-logo.png")} accessibilityLabel="Original YNX logo" resizeMode="contain" style={{ width: 24 * 798 / 420, height: 24 }} />
        <ActivityIndicator color={BLUE} />
        <Text style={styles.muted}>
          {t("Restoring private Social session…")}
        </Text>
      </SafeAreaView>
    );
  if (!session || !api)
    return <GuestWorkspace error={error} discoveryPending={Boolean(discovery)}
      language={<LanguagePicker compact />} signIn={<NativeSessionPanel onChatReady={connectScoped} />} />;
  return (
    <SafeAreaView
      style={[styles.safe, { direction: isRTL ? "rtl" : "ltr" }]}
      edges={["top", "bottom", "left", "right"]}
    >
      <StatusBar style="dark" />
      {!(threadOpen && !desktop && tab === "messages") && <View style={styles.header}>
        <View style={[styles.brandMark, { backgroundColor: "transparent", width: 46, height: 46 * 420 / 798 }]}>
          <Image source={require("./assets/ynx-original-logo.png")} accessibilityLabel="Original YNX logo" resizeMode="contain" style={{ width: 46, height: 46 * 420 / 798, flexShrink: 0 }} />
        </View>
        <Text style={styles.brand}>YNX Social</Text>
        <View style={styles.privateBadge}>
          <ShieldCheck color="#067647" size={13} />
          <Text style={styles.privateText}>{t("Private")}</Text>
        </View>
        <LanguagePicker compact />
        {(session.authMode !== 'product-session-v2' || session.session.scopes.includes('social.contacts')) &&
          <Pressable accessibilityLabel="Notifications" onPress={() => setTab('alerts')} style={styles.iconButton}><Bell size={20} color={BLUE} /></Pressable>}
      </View>}
      <View style={[styles.appWorkspace, desktop && styles.desktopWorkspace]}>
      <View style={styles.body}>
        {tab === "contacts" ? (
          <Contacts key={api.authorizationGeneration} api={api} account={session.session.account} discovery={discovery} onDiscoveryConsumed={consumeDiscovery} />
        ) : tab === "messages" ? (
          <Messages api={api} session={session} onThreadChange={setThreadOpen} />
        ) : tab === "moments" ? (
          <Moments api={api} session={session} />
        ) : tab === "alerts" ? (
          <Alerts api={api} />
        ) : (
          <Profile
            api={api}
            session={session}
            onSessionChange={setSession}
            onSignOut={signOut}
          />
        )}
      </View>
      {!(threadOpen && !desktop && tab === "messages") && <View style={[styles.tabBar, desktop && styles.desktopTabs]}>
        {(session.authMode!=="product-session-v2"||session.session.scopes.includes("social.contacts"))?<TabButton
          tab="contacts"
          active={tab === "contacts"}
          label={t("Contacts")}
          icon={ContactRound}
          onPress={setTab}
        />:null}
        <TabButton
          tab="messages"
          active={tab === "messages"}
          label={t("Chats")}
          icon={MessageCircle}
          onPress={setTab}
        />
        {(session.authMode!=="product-session-v2"||session.session.scopes.includes("social.feed"))?<TabButton
          tab="moments"
          active={tab === "moments"}
          label={t("Moments")}
          icon={Sparkles}
          onPress={setTab}
        />:null}
        <TabButton
          tab="profile"
          active={tab === "profile"}
          label={t("Settings")}
          icon={Settings}
          onPress={setTab}
        />
      </View>}
      </View>
    </SafeAreaView>
  );
}

function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n(),
    [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Language")}
        onPress={() => setOpen(true)}
        style={compact ? styles.languageCompact : styles.languageButton}
      >
        <Text style={styles.languageText}>{localeNames[locale]}</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle title={t("Language")} close={() => setOpen(false)} />
            <ScrollView>
              <Pressable
                onPress={() => void setLocale(null).then(() => setOpen(false))}
                style={styles.languageRow}
              >
                <Text style={styles.name}>{t("Use system language")}</Text>
              </Pressable>
              {locales.map((item) => (
                <Pressable
                  key={item}
                  accessibilityLabel={localeNames[item]}
                  onPress={() =>
                    void setLocale(item).then(() => setOpen(false))
                  }
                  style={[
                    styles.languageRow,
                    item === locale && styles.languageActive,
                  ]}
                >
                  <Text style={styles.name}>{localeNames[item]}</Text>
                  {item === locale ? (
                    <ShieldCheck color={BLUE} size={18} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Contacts({ api,account,discovery,onDiscoveryConsumed }: { api: SocialAPI;account:string;discovery?:SocialDiscoveryEntry|null;onDiscoveryConsumed?:(value:string)=>void }) {
  type Source = "handle" | "contacts" | "qr" | "invite" | "recommendation";
  const flow=useMemo(()=>new ContactRequestFlow(api,async()=>Array.from(await getRandomBytesAsync(16),byte=>byte.toString(16).padStart(2,"0")).join("")),[api]);
  const requestGeneration=useRef(0);
  const relationshipPending=useRef(new Set<string>());
  const contactIntents=useMemo(()=>new NativeContactIntents({read:key=>SecureStore.getItemAsync(key),write:(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}),[]);
  const contactStorageWait=useMemo(()=>new ContactOperation(),[]);
  const mounted=useRef(true),scanGuard=useRef<()=>boolean>(()=>false);
  const [review,setReview]=useState<ContactReview|null>(null),[requesting,setRequesting]=useState(false),[requestMessage,setRequestMessage]=useState("");
  const [data, setData] = useState<{
      contacts: Person[];
      requests: ContactRequest[];
    }>({ contacts: [], requests: [] }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [add, setAdd] = useState(false),
    [scan, setScan] = useState(false),
    [source, setSource] = useState<Source>("handle"),
    [value, setValue] = useState("");
  const cancelRequest=()=>{requestGeneration.current++;flow.cancel();contactStorageWait.cancel();setRequesting(false)};
  useEffect(()=>{
    if(!discovery)return;
    requestGeneration.current++;flow.cancel();setRequesting(false);setReview(null);setRequestMessage('');setSource(discovery.source);setValue(discovery.value);setAdd(true);
  },[discovery,flow,onDiscoveryConsumed]);
  const load = async () => {
    const current=api.authorizationGuard();
    setLoading(true);
    try {
      const result=await api.contacts();if(!mounted.current||!current())return;setData(result);
      setError(null);
    } catch (caught) {
      if(mounted.current&&current())setError(message(caught));
    } finally {
      if(mounted.current&&current())setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current=true;
    void load();
    const subscription=AppState.addEventListener("change",state=>{if(state!=="active"){cancelRequest();scanGuard.current=()=>false;setReview(null);setRequestMessage("");setScan(false);setAdd(false)}});
    return()=>{mounted.current=false;cancelRequest();scanGuard.current=()=>false;subscription.remove()};
  }, []);
  const normalized = () =>
    source === "handle" || source === "recommendation"
      ? value.trim().replace(/^@/, "")
      : value.trim();
  const request = async () => {
    const authority=api.authorizationGuard();if(requesting)return;const generation=++requestGeneration.current;const current=()=>authority()&&requestGeneration.current===generation;setRequesting(true);
    try {
      if(!review){const next=await flow.preview(source,value);if(mounted.current&&current()){setReview(next);setError(null)}return}
      const intent=await contactStorageWait.run(signal=>contactIntents.prepare({schemaVersion:1,account,source:review.source,value:review.value,personId:review.person.id,idempotencyKey:review.idempotencyKey,message:requestMessage.trim()},()=>mounted.current&&current()&&!signal.aborted));
      if(!mounted.current||!current())return;
      if(!intent.operationReturned){await flow.confirm(review,intent.message);if(!mounted.current||!current())return;await contactStorageWait.run(signal=>contactIntents.returned(intent,()=>mounted.current&&current()&&!signal.aborted))}
      if(!mounted.current||!current())return;
      setReview(null);setRequestMessage("");
      setAdd(false);
      if(discovery&&isOriginalDiscoveryReview(discovery,review))onDiscoveryConsumed?.(discovery.value);
      setValue("");
      await load();
    } catch (caught) {
      if(mounted.current&&current())setError(message(caught));
    } finally {
      if(mounted.current&&current())setRequesting(false);
    }
  };
  const restoreContactRequest=async()=>{
    cancelRequest();const authority=api.authorizationGuard(),generation=++requestGeneration.current,current=()=>mounted.current&&authority()&&requestGeneration.current===generation;setRequesting(true);
    try{
      const original=await contactStorageWait.run(()=>contactIntents.load(account));if(!current())return;
      if(!original){setError('No original pending contact request was found');return}
      if(original.operationReturned){await load();if(current())setError('The original request API returned previously. Read the actual request status; acceptance remains separate.');return}
      const next=await flow.restore(original);if(!current())return;setSource(next.source);setValue(next.value);setReview(next);setRequestMessage(original.message);setAdd(true);setError(null);
    }catch(caught){if(current())setError(message(caught))}finally{if(current())setRequesting(false)}
  };
  const transition = async (
    item: ContactRequest,
    action: "accept" | "reject" | "withdraw",
  ) => {
    const authority=api.authorizationGuard(),key=`request:${item.id}`;
    if(relationshipPending.current.has(key))return;
    relationshipPending.current.add(key);
    try {
      if(!await runCurrentContactAction(()=>mounted.current&&authority(),()=>api.transitionRequest(item.id,action)))return;
      await load();
    } catch (caught) {
      if(mounted.current&&authority())setError(message(caught));
    } finally {
      relationshipPending.current.delete(key);
    }
  };
  const changeRelationship=async(person:Person,action:'mute'|'remove'|'block',reviewCurrent:()=>boolean)=>{
    const authority=api.authorizationGuard(),key=`person:${person.id}`;
    if(relationshipPending.current.has(key))return;
    relationshipPending.current.add(key);
    try{
      if(!await runCurrentContactAction(()=>reviewCurrent()&&mounted.current&&authority(),async()=>{
       if(action==='mute')await api.mute(person.id,true);
       else if(action==='remove')await api.deleteContact(person.id);
       else await api.block(person.id);
      }))return;
      if(mounted.current&&authority())await load();
    }catch(caught){if(mounted.current&&authority())setError(message(caught))}
    finally{relationshipPending.current.delete(key)}
  };
  const manage = (person: Person) => {
    const reviewedAuthority=api.authorizationGuard(),reviewCurrent=()=>mounted.current&&reviewedAuthority();
    Alert.alert(person.displayName, `@${person.handle}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mute",
        onPress: () => void changeRelationship(person,'mute',reviewCurrent),
      },
      {
        text: "Delete contact",
        style: "destructive",
        onPress: () => void changeRelationship(person,'remove',reviewCurrent),
      },
      {
        text: "Block",
        style: "destructive",
        onPress: () => void changeRelationship(person,'block',reviewCurrent),
      },
    ]);
  };
  const pending = data.requests.filter((item) => item.status === "pending"),
    requestHeader = (
      <View>
        <Pressable accessibilityLabel="Restore original pending contact request" onPress={()=>void restoreContactRequest()} style={styles.secondary}><Text style={styles.secondaryText}>Restore original pending request</Text></Pressable>
        {pending.map((item) => (
          <View key={item.id} style={styles.request}>
            <Avatar person={item.person} />
            <View style={styles.flex}>
              <Text style={styles.name}>{item.person.displayName}</Text>
              <Text style={styles.handle}>
                @{item.person.handle} ·{" "}
                {item.direction === "incoming"
                  ? "wants to connect"
                  : "request pending"}
              </Text>
              {item.message?<Text style={styles.emptyBody}>{item.message}</Text>:null}
            </View>
            {item.direction === "incoming" ? (
              <>
                <Pressable
                  accessibilityLabel="Accept request"
                  onPress={() => void transition(item, "accept")}
                  style={styles.smallPrimary}
                >
                  <Text style={styles.smallPrimaryText}>Accept</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Reject request"
                  onPress={() => void transition(item, "reject")}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>Reject</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityLabel="Withdraw request"
                onPress={() => void transition(item, "withdraw")}
                style={styles.chip}
              >
                <Text style={styles.chipText}>Withdraw</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    );
  const placeholder =
    source === "handle" || source === "recommendation"
      ? "@handle"
      : source === "qr"
        ? "https://social.ynxweb4.com/people/sp_..."
        : source === "invite"
          ? "https://social.ynxweb4.com/invite/…"
          : "Authorized contact match token";
  return (
    <Screen
      title="People"
      action={
        <Pressable
          accessibilityLabel="Add a contact"
          onPress={() => setAdd(true)}
          style={styles.iconButton}
        >
          <Plus color={BLUE} size={20} />
        </Pressable>
      }
      error={error}
    >
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={BLUE}
          />
        }
        data={data.contacts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          data.contacts.length ? styles.list : styles.emptyList
        }
        ListHeaderComponent={requestHeader}
        ListEmptyComponent={
          <Empty
            icon={ContactRound}
            title="Your circle starts here"
            body="Find people by @handle, QR, invite link, recommendations, or contacts you explicitly allow."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`Manage ${item.displayName}`}
            onPress={() => manage(item)}
            style={styles.row}
          >
            <Avatar person={item} />
            <View style={styles.flex}>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.handle}>@{item.handle}</Text>
            </View>
            <MessageCircle color={MUTED} size={19} />
          </Pressable>
        )}
      />
      <Modal
        visible={add}
        transparent
        animationType="slide"
        onRequestClose={() => {cancelRequest();setReview(null);setRequestMessage("");setAdd(false);if(discovery)onDiscoveryConsumed?.(discovery.value)}}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle title={review?"Review this person":"Add someone"} close={() => {cancelRequest();setReview(null);setRequestMessage("");setAdd(false);if(discovery)onDiscoveryConsumed?.(discovery.value)}} />
            {review?<View><Text style={styles.name}>{review.person.displayName}</Text><Text style={styles.handle}>@{review.person.handle}</Text><Text style={styles.securityNote}>They must accept before you become contacts. This profile does not verify encryption keys.</Text><TextInput accessibilityLabel="Optional request message" value={requestMessage} onChangeText={(next:string)=>setRequestMessage(Array.from(next).slice(0,200).join(""))} maxLength={400} multiline placeholder="Optional request message (200 characters)" style={styles.input} editable={!requesting}/></View>:null}
            <View style={styles.aiKinds}>
              {(
                [
                  "handle",
                  "qr",
                  "invite",
                  "recommendation",
                  "contacts",
                ] as Source[]
              ).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    cancelRequest();setReview(null);setRequestMessage("");
                    setSource(item);
                    setValue("");
                  }}
                  style={[styles.chip, source === item && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      source === item && styles.chipTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>{source.toUpperCase()}</Text>
            {source === "contacts" ? (
              <PhoneContactMatcher api={api} onSelect={setValue} />
            ) : (
              <>
                <TextInput
                  accessibilityLabel={`Discovery by ${source}`}
                  autoCapitalize="none"
                  value={value}
                  onChangeText={(next:string)=>{cancelRequest();setReview(null);setRequestMessage("");setValue(next)}}
                  placeholder={placeholder}
                  placeholderTextColor="#98A2B3"
                  style={styles.input}
                />
                {source === "qr" ? (
                  <Pressable
                    accessibilityLabel="Scan profile QR with camera"
                    onPress={() => {cancelRequest();setReview(null);scanGuard.current=api.authorizationGuard();setScan(true)}}
                    style={styles.secondary}
                  >
                    <Text style={styles.secondaryText}>Scan profile QR</Text>
                  </Pressable>
                ) : null}
              </>
            )}
            <View style={styles.discovery}>
              <QrCode color={BLUE} size={19} />
              <Text style={styles.discoveryText}>
                {source === "contacts"
                  ? "Only a match token created after explicit Contacts permission is accepted."
                  : "Only this selected discovery method is sent."}
              </Text>
            </View>
            <Pressable
              disabled={requesting || !normalized() || /^ynx1/i.test(normalized())}
              onPress={() => void request()}
              style={[
                styles.primary,
                (!normalized() || /^ynx1/i.test(normalized())) &&
                  styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>{requesting?"Please wait":review?"Send request":"Preview person"}</Text>
            </Pressable>
            <Text style={styles.securityNote}>
              Wallet addresses are never accepted for friend discovery. Requests
              are rate-limited and block-aware.
            </Text>
          </View>
        </View>
      </Modal>
      <QRScanner
        visible={scan}
        close={() => {scanGuard.current=()=>false;setScan(false)}}
        onValue={(payload) => {
          if(!mounted.current||!scanGuard.current())return;
          cancelRequest();setReview(null);setRequestMessage("");scanGuard.current=()=>false;
          setValue(payload);
          setScan(false);
        }}
      />
    </Screen>
  );
}

function QRScanner({
  visible,
  close,
  onValue,
}: {
  visible: boolean;
  close: () => void;
  onValue: (value: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions(),
    [error, setError] = useState<string | null>(null),
    [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!visible) {
      setError(null);
      setLocked(false);
    }
  }, [visible]);
  const scanned = ({ data }: { data: string }) => {
    if (!visible || locked) return;
    setLocked(true);
    try {
      if (data.length > 512) throw new Error("Profile QR payload is too large");
      onValue(requireSocialProfileQR(data));
    } catch (caught) {
      setError(message(caught));
      setLocked(false);
    }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.scannerScreen}>
        <View style={styles.threadHeader}>
          <Pressable accessibilityLabel="Close QR scanner" onPress={close}>
            <X color={INK} size={24} />
          </Pressable>
          <Text style={styles.name}>Scan profile QR</Text>
        </View>
        {!visible ? null : !permission?.granted ? (
          <View style={styles.center}>
            <QrCode color={BLUE} size={44} />
            <Text style={styles.authBody}>
              Camera access is used only while you scan a Social profile QR.
            </Text>
            {permission?.canAskAgain === false ? (
              <Text accessibilityRole="alert" style={styles.error}>
                Camera permission is unavailable. Paste the QR payload instead.
              </Text>
            ) : (
              <Pressable
                onPress={() => void requestPermission()}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>
                  Allow camera for this scan
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={locked ? undefined : scanned}
          />
        )}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function Messages({ api, session, onThreadChange }: { api: SocialAPI; session: Session; onThreadChange: (open: boolean) => void }) {
  const { width } = useWindowDimensions();
  const desktop = socialLayout(width).desktop;
  const [items, setItems] = useState<Conversation[]>([]),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [ai, setAI] = useState<Conversation | null>(null),
    [selected, setSelected] = useState<Conversation | null>(null),
    [create, setCreate] = useState(false),
    [group, setGroup] = useState(false),
    [title, setTitle] = useState(""),
    [handle, setHandle] = useState("");
  const loadRevision = useRef(0);
  const load = async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const result = await api.conversations(query);
      if (revision !== loadRevision.current) return;
      setItems(result.conversations);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => { loadRevision.current++; };
  }, [query]);
  useEffect(() => { onThreadChange(Boolean(selected)); }, [selected, onThreadChange]);
  useEffect(() => () => onThreadChange(false), [onThreadChange]);
  useEffect(() => {
    if (!selected) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setSelected(null); return true; });
    return () => subscription.remove();
  }, [selected]);
  const start = async () => {
    try {
      const handles = handle
          .split(",")
          .map((value) => value.trim().replace(/^@/, ""))
          .filter(Boolean),
        result = group
          ? await api.createGroup(title.trim(), handles, `group-${Date.now()}`)
          : await api.createConversation(
              "handle",
              handles[0] ?? "",
              `conversation-${Date.now()}`,
            );
      setCreate(false);
      setHandle("");
      setTitle("");
      await load();
      const match = (await api.conversations()).conversations.find(
        (item) => item.id === result.record.id,
      );
      if (match) setSelected(match);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const handlesValid = handle
      .split(",")
      .map((value) => value.trim().replace(/^@/, ""))
      .filter(Boolean),
    canStart =
      handlesValid.every((value) => /^[a-z][a-z0-9_]{2,23}$/.test(value)) &&
      (group
        ? handlesValid.length >= 2 && Boolean(title.trim())
        : handlesValid.length === 1);
  const thread = selected ? <MessageThread key={selected.id} api={api} session={session}
    conversation={selected} close={() => { setSelected(null); void load(); }} /> :
    <View style={styles.chatWelcome}><Image source={require('./assets/ynx-original-logo.png')}
      resizeMode="contain" style={{ width: 76, height: 40 }} /><Text style={styles.emptyTitle}>Your conversations</Text>
      <Text style={styles.emptyBody}>Select a chat to continue. Your contacts and private messages stay yours.</Text></View>;
  if (selected && !desktop) return thread;
  return (
    <View style={styles.chatSplit}>
    <View style={desktop ? styles.chatSidebar : styles.flex}>
    <Screen
      title="Chats"
      action={
        <Pressable
          accessibilityLabel="New conversation"
          onPress={() => setCreate(true)}
          style={styles.iconButton}
        >
          <Plus color={BLUE} size={20} />
        </Pressable>
      }
      error={error}
    >
      <View style={styles.search}>
        <Search color={MUTED} size={18} />
        <TextInput
          accessibilityLabel="Search conversations"
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations"
          placeholderTextColor="#98A2B3"
          style={styles.searchInput}
        />
      </View>
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={BLUE}
          />
        }
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <Empty
            icon={MessageCircle}
            title="No conversations yet"
            body="Start an end-to-end encrypted conversation with one of your contacts."
          />
        }
        renderItem={({ item }) => (
          <Pressable accessibilityState={{ selected: selected?.id === item.id }} onPress={() => setSelected(item)} style={[styles.row, selected?.id === item.id && styles.selectedChat]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.title.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.flex}>
              <View style={styles.rowTitle}>
                <Text numberOfLines={1} style={styles.name}>
                  {item.title}
                </Text>
                <Text style={styles.time}>{relative(item.updatedAt)}</Text>
              </View>
              <Text numberOfLines={1} style={styles.preview}>
                {item.lastMessage}
              </Text>
              <View style={styles.e2ee}>
                <ShieldCheck
                  color={item.e2ee === "verified" ? "#067647" : "#B54708"}
                  size={12}
                />
                <Text style={styles.e2eeText}>
                  {item.e2ee === "verified"
                    ? "Verified on this device"
                    : "Device recovery needed"}
                </Text>
              </View>
            </View>
            {item.unread > 0 && <View style={styles.unreadBadge}><Text style={styles.unreadCount}>{formatNumber(item.unread)}</Text></View>}
            <Pressable
              accessibilityLabel={`AI tools for ${item.title}`}
              onPress={() => setAI(item)}
              style={styles.aiButton}
            >
              <Bot color={BLUE} size={18} />
            </Pressable>
          </Pressable>
        )}
      />
      <AIModal conversation={ai} close={() => setAI(null)} api={api} />
      <Modal
        visible={create}
        transparent
        animationType="slide"
        onRequestClose={() => setCreate(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle
              title={group ? "New group" : "New private conversation"}
              close={() => setCreate(false)}
            />
            <View style={styles.aiKinds}>
              <Pressable
                onPress={() => setGroup(false)}
                style={[styles.chip, !group && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, !group && styles.chipTextActive]}
                >
                  Private
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setGroup(true)}
                style={[styles.chip, group && styles.chipActive]}
              >
                <Text style={[styles.chipText, group && styles.chipTextActive]}>
                  Group
                </Text>
              </Pressable>
            </View>
            {group ? (
              <>
                <Text style={styles.label}>GROUP NAME</Text>
                <TextInput
                  accessibilityLabel="Group name"
                  maxLength={80}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Group name"
                  placeholderTextColor="#98A2B3"
                  style={styles.input}
                />
              </>
            ) : null}
            <Text style={styles.label}>
              {group
                ? "ACCEPTED CONTACTS · COMMA SEPARATED"
                : "ACCEPTED CONTACT"}
            </Text>
            <TextInput
              accessibilityLabel="Contact handles"
              autoCapitalize="none"
              value={handle}
              onChangeText={setHandle}
              placeholder={group ? "@ada, @lin" : "@handle"}
              placeholderTextColor="#98A2B3"
              style={styles.input}
            />
            <Text style={styles.securityNote}>
              Every participant must be an accepted Social contact with an
              active encryption device. Wallet addresses are rejected.
            </Text>
            <Pressable
              disabled={!canStart}
              onPress={() => void start()}
              style={[styles.primary, !canStart && styles.disabled]}
            >
              <Text style={styles.primaryText}>
                Start encrypted {group ? "group" : "chat"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
    </View>
    {desktop && <View style={styles.chatDetail}>{thread}</View>}
    </View>
  );
}

const ATTACHMENT_PREFIX = "YNX_SOCIAL_ATTACHMENT_V1:";
type VisibleMessage = {
  record: ChatMessage;
  plaintext: string;
  verified: boolean;
  attachment?: AttachmentPayload;
};

function parseAttachment(value: string): AttachmentPayload | undefined {
  if (!value.startsWith(ATTACHMENT_PREFIX)) return undefined;
  const parsed = JSON.parse(
    value.slice(ATTACHMENT_PREFIX.length),
  ) as Partial<AttachmentPayload>;
  if (
    parsed.type !== "attachment" ||
    typeof parsed.name !== "string" ||
    !parsed.name ||
    parsed.name.length > 255 ||
    typeof parsed.mimeType !== "string" ||
    !parsed.mimeType ||
    parsed.mimeType.length > 100 ||
    typeof parsed.sizeBytes !== "number" ||
    !Number.isSafeInteger(parsed.sizeBytes) ||
    parsed.sizeBytes < 1 ||
    parsed.sizeBytes > 25 * 1024 * 1024 ||
    typeof parsed.mediaId !== "string" ||
    typeof parsed.key !== "string" ||
    typeof parsed.nonce !== "string"
  )
    throw new Error("Encrypted attachment metadata is invalid");
  if (
    decodeRawBase64(parsed.key, "attachment key").length !== 32 ||
    decodeRawBase64(parsed.nonce, "attachment nonce").length !== 24
  )
    throw new Error("Encrypted attachment key material is invalid");
  return parsed as AttachmentPayload;
}

function MessageThread({
  api,
  session,
  conversation,
  close,
}: {
  api: SocialAPI;
  session: Session;
  conversation: Conversation;
  close: () => void;
}) {
  const [items, setItems] = useState<VisibleMessage[]>([]),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [sending, setSending] = useState(false),
    [pending, setPending] = useState<SendMessageRequest | null>(null),
    [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [threadAI, setThreadAI] = useState(false);
  const [attachmentPending, setAttachmentPending] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState<{name:string;uri:string}|null>(null);
  const account = session.session.account,
    deviceId = session.session.deviceId;
  const chatAppearance = useNativeChatAppearance(account, conversation.id);
  const uploadKey = `ynx.social.upload.${account}.${deviceId}.${conversation.id}`;
  type UploadJob = { id: string; payload: AttachmentPayload; record?: CloudObjectRecord };
  const uploadFile = (id: string, request = false) => {
    if (!/^attachment_[a-f0-9]{24}$/.test(id)) throw new Error("Pending attachment identity is invalid");
    return new File(Paths.document, `${id}${request ? ".request.json" : ".bin"}`);
  };
  const cloud = () => {
    const base = process.env.EXPO_PUBLIC_YNX_SOCIAL_CLOUD_BASE ?? "https://web4.ynxweb4.com";
    if (!base) throw new Error("Cloud attachment service is not configured for this build");
    return new SocialCloudAttachments(api, base);
  };
  useEffect(() => { setAttachmentPreview(null); void SecureStore.getItemAsync(uploadKey).then(raw => setAttachmentPending(Boolean(raw))); }, [uploadKey]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPending(pendingFor(messageOutbox.read(), account, deviceId, conversation.id));
      const [keyRaw, deviceResult, messageResult] = await Promise.all([
          SecureStore.getItemAsync(DEVICE_KEY),
          api.conversationDevices(conversation.id),
          api.messages(conversation.id),
        ]);
      if (!keyRaw)
        throw new Error("This device no longer has its Social encryption key");
      const keys = JSON.parse(keyRaw) as {
          signingSeed: string;
          encryptionSeed: string;
        },
        encryptionSeed = hexBytes(keys.encryptionSeed),
        devices = new Map(
          deviceResult.devices.map((device) => [device.id, device]),
        ),
        visible: VisibleMessage[] = [];
      for (const record of messageResult.messages) {
        const sender = devices.get(record.senderDeviceId);
        if (!sender || !verifyMessageSignature(record, sender))
          throw new Error("A message failed sender verification");
        const plaintext = decryptDeviceMessage({
            encryptionSeed,
            deviceId,
            message: record,
          }),
          attachment = parseAttachment(plaintext);
        visible.push({ record, plaintext, verified: true, attachment });
        if (record.sender !== account && !record.readAt?.[deviceId])
          await api.acknowledge(conversation.id, record.id, "read");
      }
      setItems(visible);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [account, api, conversation.id, deviceId]);
  useEffect(() => {
    void load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  const transmit = async (request: SendMessageRequest) => {
    setSending(true);
    try {
      const currentDevices = await api.conversationDevices(conversation.id);
      assertPendingRecipients({ account, deviceId, conversationId: conversation.id, request }, currentDevices.devices);
      await api.sendMessage(conversation.id, request);
      const remaining = messageOutbox.update((entries) => acknowledgeQueued(entries, { account, deviceId, conversationId: conversation.id, request }));
      setPending(pendingFor(remaining, account, deviceId, conversation.id));
      setDraft("");
      await load();
    } catch (caught) {
      setPending(request);
      setError(`Waiting to retry · ${message(caught)}`);
    } finally {
      setSending(false);
    }
  };
  const prepareMessage = async (plaintext: string) => {
      const [keyRaw, devices, entropy] = await Promise.all([
        SecureStore.getItemAsync(DEVICE_KEY),
        api.conversationDevices(conversation.id),
        getRandomBytesAsync(32),
      ]);
      if (!keyRaw)
        throw new Error("This device no longer has its Social signing key");
      const keys = JSON.parse(keyRaw) as {
          signingSeed: string;
          encryptionSeed: string;
        },
        random = await getRandomBytesAsync(12),
        messageId = `msg_${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
        request = createEnvelopeSet({
          signingSeed: hexBytes(keys.signingSeed),
          senderAccount: account,
          senderDeviceId: deviceId,
          conversationId: conversation.id,
          messageId,
          plaintext,
          devices: devices.devices,
          entropy,
        });
      return request;
  };
  const sendPlaintext = async (plaintext: string) => {
    try {
      const request = await prepareMessage(plaintext);
      messageOutbox.update((entries) => queueMessage(entries, { account, deviceId, conversationId: conversation.id, request }));
      setPending(request);
      await transmit(request);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const resumeAttachment = async () => {
    setSending(true);
    try {
      const raw = await SecureStore.getItemAsync(uploadKey);
      if (!raw) { setAttachmentPending(false); return; }
      const job = JSON.parse(raw) as UploadJob;
      const requestFile = uploadFile(job.id, true);
      let request: SendMessageRequest;
      if (requestFile.exists) {
        request = JSON.parse(requestFile.textSync()) as SendMessageRequest;
      } else {
        const ciphertext = await uploadFile(job.id).bytes();
        const transport = cloud();
        if (!job.record) {
          job.record = await transport.register(conversation.id, job.id, ciphertext);
          await SecureStore.setItemAsync(uploadKey, JSON.stringify(job));
        }
        await transport.upload(job.record, ciphertext, (sent,total) => setAttachmentProgress(`Uploading encrypted attachment: ${Math.round(sent/total*100)}%`));
        job.payload = {...job.payload, mediaId:job.record.objectId, storage:"cloud-v1",ciphertextHash:job.record.sha256,ciphertextBytes:job.record.totalCiphertextBytes};
        request = await prepareMessage(`${ATTACHMENT_PREFIX}${JSON.stringify(job.payload)}`);
        // Persist the exact signed ciphertext before enqueuing. Retrying cleanup
        // cannot generate another message ID or a different envelope set.
        requestFile.write(JSON.stringify(request));
      }
      messageOutbox.update(entries => queueMessage(entries, {account,deviceId,conversationId:conversation.id,request}));
      setPending(request);
      await SecureStore.deleteItemAsync(uploadKey);
      setAttachmentPending(false);
      const ciphertextFile = uploadFile(job.id);
      if (ciphertextFile.exists) ciphertextFile.delete();
      if (requestFile.exists) requestFile.delete();
      setAttachmentProgress("");
      await transmit(request);
    } catch (caught) { setError(message(caught)); }
    finally { setSending(false); }
  };
  const pickAttachment = async () => {
    try {
      cloud();
      if (await SecureStore.getItemAsync(uploadKey)) throw new Error("Resume the pending encrypted attachment before choosing another");
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Photo access is required only for the attachment you choose",
        );
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.9,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64)
        throw new Error("The selected attachment could not be read");
      const bytes = Uint8Array.from(atob(asset.base64), (char) =>
        char.charCodeAt(0),
      );
      if (bytes.length > 25 * 1024 * 1024 - 16)
        throw new Error("Encrypted attachments must be smaller than 25 MB");
      const [key, nonce] = await Promise.all([
          getRandomBytesAsync(32),
          getRandomBytesAsync(24),
        ]),
        name = (asset.fileName ?? "social-image.jpg").slice(0, 255),
        mimeType = asset.mimeType ?? "image/jpeg",
        encrypted = encryptAttachment({
          bytes,
          key,
          nonce,
          conversationId: conversation.id,
          name,
          mimeType,
        });
      const payload: AttachmentPayload = {
          type: "attachment",
          name,
          mimeType,
          sizeBytes: bytes.length,
          mediaId: "",
          key: encodeRawBase64(key),
          nonce: encodeRawBase64(nonce),
        };
      const id = `attachment_${Array.from(nonce.slice(0,12),byte=>byte.toString(16).padStart(2,"0")).join("")}`;
      uploadFile(id).write(encrypted.ciphertext);
      await SecureStore.setItemAsync(uploadKey, JSON.stringify({id,payload} satisfies UploadJob));
      setAttachmentPending(true);
      bytes.fill(0);
      key.fill(0);
      await resumeAttachment();
    } catch (caught) {
      setError(message(caught));
    }
  };
  const openAttachment = async (value: AttachmentPayload) => {
    try {
      const ciphertext = value.storage === "cloud-v1" ? await cloud().download(value.mediaId, value.ciphertextHash ?? "", value.ciphertextBytes ?? 0) : await api.downloadMedia(value.mediaId),
        bytes = decryptAttachment({
          ciphertext,
          key: decodeRawBase64(value.key, "attachment key"),
          nonce: decodeRawBase64(value.nonce, "attachment nonce"),
          conversationId: conversation.id,
          name: value.name,
          mimeType: value.mimeType,
        });
      if (bytes.length !== value.sizeBytes)
        throw new Error("Attachment size does not match signed metadata");
      if (!["image/jpeg","image/png","image/webp"].includes(value.mimeType)) throw new Error("This verified attachment format is not supported by the image viewer");
      const encoded = encodeRawBase64(bytes);
      setAttachmentPreview({name:value.name,uri:`data:${value.mimeType};base64,${encoded.padEnd(Math.ceil(encoded.length/4)*4,"=")}`});
      bytes.fill(0);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const filtered = items.filter(
    (item) =>
      !query.trim() ||
      (!item.attachment &&
        item.plaintext
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())) ||
      item.attachment?.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <KeyboardAvoidingView style={styles.threadScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Modal visible={showInfo || showAttachments || showMenu} transparent animationType="slide"
        onRequestClose={() => { setShowInfo(false); setShowAttachments(false); setShowMenu(false); }}>
        <View style={styles.backdrop}><View style={styles.sheet}>
          <SheetTitle title={showInfo ? conversation.title : showAttachments ? 'Attachments' : 'Conversation'}
            close={() => { setShowInfo(false); setShowAttachments(false); setShowMenu(false); }} />
          {showInfo ? <>
            {conversation.handle && <Text style={styles.handle}>@{conversation.handle}</Text>}
            <Text style={styles.securityNote}>{conversation.e2ee === 'verified' ? 'Verified on this device' : 'Device recovery needed'}</Text>
            <Text style={styles.securityNote}>Contact acceptance and following are separate. Device trust is not inferred from a profile.</Text>
          </> : showAttachments ? <Pressable disabled={sending || attachmentPending} style={styles.discovery}
            onPress={() => { setShowAttachments(false); void pickAttachment(); }}>
            <Paperclip color={BLUE} size={20} /><Text>Choose encrypted image</Text></Pressable> : <>
            <Pressable style={styles.discovery} onPress={() => { setShowMenu(false); setShowSearch(value => !value); }}><Search color={BLUE} size={20} /><Text>Search on this device</Text></Pressable>
            <Pressable style={styles.discovery} onPress={() => { setShowMenu(false); setThreadAI(true); }}><Bot color={BLUE} size={20} /><Text>Optional AI tools</Text></Pressable>
            <Pressable style={styles.discovery} onPress={() => { setShowMenu(false); void load(); }}><RefreshCw color={BLUE} size={20} /><Text>Refresh conversation</Text></Pressable>
            <ChatAppearanceSettings account={account} room={conversation.id} />
          </>}
        </View></View>
      </Modal>
      <AIModal conversation={threadAI ? conversation : null} close={() => setThreadAI(false)} api={api} />
      <Modal visible={attachmentPreview !== null} onRequestClose={() => setAttachmentPreview(null)} animationType="fade">
        <View style={{flex:1,backgroundColor:"#101828",padding:24,paddingTop:60}}>
          <Pressable accessibilityLabel="Close decrypted attachment" onPress={() => setAttachmentPreview(null)}><Text style={{color:"#FFFFFF",padding:16}}>Close attachment</Text></Pressable>
          <Text style={{color:"#FFFFFF"}}>{attachmentPreview?.name}</Text>
          {attachmentPreview ? <Image accessibilityLabel={attachmentPreview.name} source={{uri:attachmentPreview.uri}} resizeMode="contain" style={{flex:1,width:"100%"}} /> : null}
        </View>
      </Modal>
      {attachmentPending ? <Pressable disabled={sending} onPress={() => void resumeAttachment()}><Text style={styles.inlineError}>Resume encrypted attachment upload</Text></Pressable> : null}
      {attachmentProgress ? <Text>{attachmentProgress}</Text> : null}
      <View style={styles.threadHeader}>
        <Pressable
          accessibilityLabel="Back to messages"
          onPress={close}
          style={styles.iconButton}
        >
          <ArrowLeft color={INK} size={20} />
        </Pressable>
        <Pressable accessibilityLabel="Conversation information" onPress={() => setShowInfo(true)} style={styles.threadIdentity}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{conversation.title.slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.flex}><Text style={styles.name}>{conversation.title}</Text>
          {conversation.handle ? (
            <Text style={styles.handle}>@{conversation.handle}</Text>
          ) : null}
          </View>
        </Pressable>
        <Pressable accessibilityLabel="Conversation menu" onPress={() => setShowMenu(true)} style={styles.iconButton}><MoreVertical color={INK} size={20} /></Pressable>
        <View style={styles.e2ee}>
          <ShieldCheck color={conversation.e2ee === 'verified' ? '#067647' : '#B54708'} size={14} />
          <Text style={styles.e2eeText}>E2EE</Text>
        </View>
      </View>
      {showSearch && <View style={styles.search}>
        <Search color={MUTED} size={18} />
        <TextInput
          accessibilityLabel="Search decrypted messages on this device"
          value={query}
          onChangeText={setQuery}
          placeholder="Search on this device"
          placeholderTextColor="#98A2B3"
          style={styles.searchInput}
        />
      </View>}
      {error ? (
        <Text accessibilityRole="alert" style={styles.inlineError}>
          {error}
        </Text>
      ) : null}
      <View style={{ flex: 1, minHeight: 0 }}>
      <NativeChatWallpaper appearance={chatAppearance} />
      <FlatList
        inverted
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={BLUE}
          />
        }
        data={[...filtered].reverse()}
        keyExtractor={(item) => item.record.id}
        contentContainerStyle={styles.messages}
        ListEmptyComponent={
          <Empty
            icon={MessageCircle}
            title={query ? "No local matches" : "Private by design"}
            body={
              query
                ? "Search is performed only over plaintext decrypted on this device."
                : "Messages are encrypted separately for every active device. The server stores ciphertext only."
            }
          />
        }
        renderItem={({ item, index }) => {
          const mine = item.record.sender === account;
          const previous = [...filtered].reverse()[index + 1];
          const day = messageDayBoundary(item.record.createdAt, previous?.record.createdAt);
          return (
            <View>
            {day && <View style={styles.dateSeparator}><Text style={styles.dateText}>{formatDate(new Date(item.record.createdAt))}</Text></View>}
            <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                {item.attachment ? (
                  <Pressable
                    accessibilityLabel={`Verify encrypted attachment ${item.attachment.name}`}
                    onPress={() => void openAttachment(item.attachment!)}
                    style={styles.attachment}
                  >
                    <Paperclip color={BLUE} size={18} />
                    <View style={styles.flex}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.bubbleText,
                          mine && styles.bubbleTextMine,
                        ]}
                      >
                        {item.attachment.name}
                      </Text>
                      <Text
                        style={[
                          styles.messageStateText,
                          mine && styles.bubbleTextMine,
                        ]}
                      >
                        {formatNumber(
                          Math.ceil(item.attachment.sizeBytes / 1024),
                        )}{" "}
                        KB · tap to authenticate
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <Text
                    style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                  >
                    {item.plaintext}
                  </Text>
                )}
                <View style={styles.messageState}>
                  <Text style={[styles.messageStateText, mine && styles.bubbleTextMine]}>{new Date(item.record.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Text>
                  <ShieldCheck color={mine ? BLUE : "#067647"} size={11} />
                  {mine ? <CheckCheck color={BLUE} size={12} /> : null}
                  <Text
                    style={[
                      styles.messageStateText,
                      mine && styles.bubbleTextMine,
                    ]}
                  >
                    {mine
                      ? Object.keys(item.record.readAt ?? {}).length
                        ? "Read"
                        : Object.keys(item.record.deliveredAt ?? {}).length
                          ? "Delivered"
                          : "Sent"
                      : "Verified"}
                  </Text>
                </View>
              </View>
            </View>
            </View>
          );
        }}
      />
      </View>
      {pending ? (
        <Pressable
          accessibilityLabel="Retry pending message"
          disabled={sending}
          onPress={() => void transmit(pending)}
          style={styles.retryBar}
        >
          <RefreshCw color={BLUE} size={15} />
          <Text style={styles.retryText}>
            {sending ? "Retrying…" : "Message pending · tap to retry"}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.composerRow}>
        <Pressable
          accessibilityLabel="Attach encrypted image"
          disabled={sending}
          onPress={() => setShowAttachments(true)}
          style={styles.iconButton}
        >
          <Paperclip color={BLUE} size={19} />
        </Pressable>
        <TextInput
          accessibilityLabel="Message"
          multiline
          maxLength={1000}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor="#98A2B3"
          style={styles.messageInput}
        />
        <Pressable
          accessibilityLabel="Send encrypted message"
          disabled={!draft.trim() || sending}
          onPress={() => void sendPlaintext(draft)}
          style={[
            styles.sendButton,
            (!draft.trim() || sending) && styles.disabled,
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Send color="#FFFFFF" size={18} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

import { DurableNativeMomentActions } from './src/durableNativeMomentActions';
import { runCurrentMomentReport } from './src/currentMomentReport';
import { NativeMomentReportIntents, type MomentReportDraft } from './src/nativeMomentReportIntents';

function Moments({ api, session }: { api: SocialAPI; session: Session }) {
  const intentStorage=useMemo(()=>accountIntentIndex.bind(session.session.account,api.authorizationGuard()),[api,session.session.account,api.authorizationGeneration]);
  const momentReportIntents=useMemo(()=>new NativeMomentReportIntents(async()=>Array.from(await getRandomBytesAsync(16),byte=>byte.toString(16).padStart(2,'0')).join(''),intentStorage),[intentStorage]);
  const momentActions=useMemo(()=>new DurableNativeMomentActions(async()=>Array.from(await getRandomBytesAsync(16),byte=>byte.toString(16).padStart(2,'0')).join(''),intentStorage),[intentStorage]);
  const momentIntents=useMemo(()=>new NativeMomentIntents(intentStorage,async()=>Array.from(await getRandomBytesAsync(16),byte=>byte.toString(16).padStart(2,'0')).join('')),[intentStorage]);
  const momentSending=useRef(false),momentMounted=useRef(true),momentCancellation=useRef<AbortController|null>(null);
  const momentNewPublication=useRef(false);
  const closeMomentComposer=()=>{momentCancellation.current?.abort();setCompose(false)};
  useEffect(()=>{
    momentMounted.current=true;
    const subscription=AppState.addEventListener('change',state=>{if(state!=='active')momentCancellation.current?.abort()});
    return()=>{momentMounted.current=false;momentCancellation.current?.abort();subscription.remove()};
  },[]);
  useEffect(()=>{momentCancellation.current?.abort()},[api.authorizationGeneration]);
  const [items, setItems] = useState<FeedPost[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [compose, setCompose] = useState(false),
    [text, setText] = useState(""),
    [visibility, setVisibility] = useState<"public" | "contacts" | "private">(
      "contacts",
    ),
    [selected, setSelected] = useState<FeedPost | null>(null),
    [media, setMedia] = useState<{ id: string; uri: string }[]>([]),
    [following, setFollowing] = useState<Set<string>>(new Set()),
    [reportRecord, setReportRecord] = useState<SocialReport | null>(null),
    [explainReport, setExplainReport] = useState<SocialReport | null>(null),
    [appeal, setAppeal] = useState("");
  const load = async () => {
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority();
    if(!current())return;
    setLoading(true);
    try {
      const result=await api.feed();if(!current())return;setItems(result.posts);
      setError(null);
    } catch (caught) {
      if(current())setError(message(caught));
    } finally {
      if(current())setLoading(false);
    }
  };
  useEffect(() => {
    setItems([]);setFollowing(new Set());setSelected(null);setReportRecord(null);setExplainReport(null);
    void load();
  }, [api.authorizationGeneration]);
  const pickMedia = async () => {
    try {
      if (media.length >= 4)
        throw new Error("A moment can contain at most four images");
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Photo access is required only for the image you choose",
        );
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64)
        throw new Error("The selected image could not be read");
      if ((asset.fileSize ?? 0) > 25 * 1024 * 1024)
        throw new Error("Images must be 25 MB or smaller");
      const raw = asset.base64.replace(/=+$/, ""),
        bytes = Uint8Array.from(atob(asset.base64), (char) =>
          char.charCodeAt(0),
        ),
        hash = Array.from(
          new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
        uploaded = await api.uploadMedia({
          idempotencyKey: `media-${Date.now()}`,
          purpose: "moment",
          mimeType: asset.mimeType ?? "image/jpeg",
          sha256: hash,
          data: raw,
        });
      setMedia((current) => [
        ...current,
        { id: uploaded.record.id, uri: asset.uri },
      ]);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const restoreOriginalMoment=async()=>{
    momentNewPublication.current=false;
    const authority=api.authorizationGuard();
    try{const original=await momentIntents.load(session.session.account);if(!momentMounted.current||!authority())return;if(!original){setError('No original pending publication was found');return}if(original.publishedRecordId){setCompose(false);await load();if(momentMounted.current&&authority())setError('The original publication already returned a record. It was not sent again.');return}setText(original.text);setVisibility(original.visibility);setMedia(original.media);setCompose(true);setError(null)}catch(caught){if(momentMounted.current&&authority())setError(message(caught))}
  };
  const publish = () => {
    momentCancellation.current?.abort();
    const controller=new AbortController();momentCancellation.current=controller;
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority()&&!controller.signal.aborted;
    const account=session.session.account,snapshot={text,visibility,media:media.map(item=>({...item}))},newPublication=momentNewPublication.current;
    const sendOriginal=async()=>{
      if(!current()||momentSending.current)return;momentSending.current=true;
      try{
        const confirmed=await publishOriginalNativeMoment(momentIntents,account,snapshot,current,payload=>api.publishMoment(payload),30000,controller.signal,newPublication);
        if(!confirmed)return;setCompose(false);setText('');setMedia([]);await load();
      }catch(caught){if(current())setError(message(caught))}finally{momentSending.current=false;if(momentCancellation.current===controller)momentCancellation.current=null}
    };
    Alert.alert(
      "Publish this moment?",
      `Visibility: ${visibility}. You can delete it later.`,
      [
        { text: "Review", style: "cancel" },
        {
          text: "Publish",
          onPress: () => void sendOriginal(),
        },
      ],
    );
  };
  const react = async (item: FeedPost) => {
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority();
    try{
      const confirmed=await momentActions.run(session.session.account,{kind:'reaction',subject:item.id,reaction:item.viewerReaction??'support',active:!item.viewerReaction},current,(action,key)=>{
        if(action.kind!=='reaction')throw new Error('Review the original reaction again');
        return api.react(action.subject,action.reaction,action.active,key);
      });
      if(confirmed)await load();
    }catch(caught){if(current())setError(message(caught))}
  };
  const follow = async (item: FeedPost) => {
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority();
    const active = !following.has(item.author.handle);
    try {
      const confirmed=await momentActions.run(session.session.account,{kind:'follow',subject:item.author.handle,active},current,(action,key)=>{
        if(action.kind!=='follow')throw new Error('Review the original follow again');
        return api.follow(action.subject,action.active,key);
      });
      if(!confirmed)return;
      setFollowing((current) => {
        const next = new Set(current);
        if (active) next.add(item.author.handle);
        else next.delete(item.author.handle);
        return next;
      });
    } catch (caught) {
      if(current())setError(message(caught));
    }
  };
  const remove = (item: FeedPost) => {
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority(),account=session.session.account,target=item.id;
    const send=async()=>{
      try{const confirmed=await momentActions.run(account,{kind:'delete',subject:target},current,action=>api.deleteMoment(action.subject));if(confirmed)await load()}catch(caught){if(current())setError(message(caught))}
    };
    Alert.alert(
      "Delete this moment?",
      "This removes it from every audience. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void send(),
        },
      ],
    );
  };
  const submitReport = async (item: FeedPost, originalDraft?: MomentReportDraft) => {
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority();
    try {
      const result = originalDraft
        ? await momentReportIntents.run(session.session.account,originalDraft,current,body=>api.report(body))
        : await runCurrentMomentReport(current,()=>digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          [
            "ynx-social-trust-evidence-v1",
            item.id,
            item.author.handle,
            item.text,
            ...item.media.map((value) => value.sha256),
          ].join("\n"),
        ),evidence=>momentReportIntents.run(session.session.account,{
          targetType: "moment",
          targetId: item.id,
          category: "other",
          detail: "User requested Trust review from the moment menu.",
          evidenceHashes: [evidence],
        },current,body=>api.report(body)));
      if(!result)return;
      setReportRecord(result.record);
      setError(null);
    } catch (caught) {
      if(current())setError(message(caught));
    }
  };
  const report = async (item: FeedPost) => {
    const authority=api.authorizationGuard(),current=()=>momentMounted.current&&authority();
    try {
      const original=await momentReportIntents.reviewOriginal(session.session.account,item.id,current);
      if(!current())return;
      const pending=original&&!original.completed?original.draft:undefined;
      Alert.alert(
        pending?"Retry the original report?":"Report this moment?",
        pending
          ? `The previous result is unknown. This retries only your saved ${pending.category} report and ${pending.evidenceHashes.length} original evidence fingerprint(s), without replacing them with this moment's latest content. No penalty is applied automatically.`
          : "Trust review receives one SHA-256 evidence fingerprint and your explicit report. No penalty is applied automatically.",
        [
          {text:"Cancel",style:"cancel"},
          {text:pending?"Retry original":"Report",style:"destructive",onPress:()=>{if(current())void submitReport(item,pending)}},
        ],
      );
    } catch(caught) {if(current())setError(message(caught))}
  };
  const appealReport = async () => {
    if (!reportRecord) return;
    try {
      const result = await api.appealReport(reportRecord.id, appeal.trim());
      setReportRecord(result.record);
      setAppeal("");
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  return (
    <Screen
      title="Moments"
      action={
        <Pressable
          accessibilityLabel="Create moment"
          onPress={() => {momentNewPublication.current=true;setCompose(true)}}
          style={styles.iconButton}
        >
          <Plus color={BLUE} size={20} />
        </Pressable>
      }
      error={error}
    >
      <Pressable accessibilityLabel="Restore original pending moment" onPress={()=>void restoreOriginalMoment()} style={styles.secondary}><Text style={styles.secondaryText}>Restore original pending publication</Text></Pressable>
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={BLUE}
          />
        }
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={items.length ? styles.feed : styles.emptyList}
        ListEmptyComponent={
          <Empty
            icon={Sparkles}
            title="A quieter kind of feed"
            body="Visible moments appear here. Nothing synthetic is inserted."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.post}>
            <View style={styles.postHeader}>
              <Avatar person={item.author} />
              <View style={styles.flex}>
                <Text style={styles.name}>{item.author.displayName}</Text>
                <Text style={styles.handle}>
                  @{item.author.handle} · {relative(item.createdAt)}
                </Text>
              </View>
              {item.author.id !== session.session.account ? (
                <Pressable
                  accessibilityLabel={`${following.has(item.author.handle) ? "Unfollow" : "Follow"} ${item.author.displayName}`}
                  onPress={() => void follow(item)}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>
                    {following.has(item.author.handle) ? "Following" : "Follow"}
                  </Text>
                </Pressable>
              ) : null}
              <Text style={styles.visibility}>{item.visibility}</Text>
            </View>
            {item.text ? (
              <Text style={styles.postText}>{item.text}</Text>
            ) : null}
            {item.media.map((media) =>
              media.mimeType.startsWith("image/") ? (
                <Image
                  key={media.id}
                  accessibilityLabel="Moment image"
                  source={api.mediaSource(media.id)}
                  style={styles.momentImage}
                />
              ) : (
                <View key={media.id} style={styles.mediaCard}>
                  <Text style={styles.preview}>
                    {media.mimeType} ·{" "}
                    {formatNumber(Math.ceil(media.sizeBytes / 1024))} KB
                  </Text>
                </View>
              ),
            )}
            <View style={styles.postMeta}>
              <Pressable
                accessibilityLabel="React to moment"
                onPress={() => void react(item)}
                style={styles.postAction}
              >
                <Heart
                  color={item.viewerReaction ? BLUE : MUTED}
                  fill={item.viewerReaction ? BLUE : "transparent"}
                  size={17}
                />
                <Text style={styles.preview}>{item.reactions}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Open comments"
                onPress={() => setSelected(item)}
                style={styles.postAction}
              >
                <MessageCircle color={MUTED} size={17} />
                <Text style={styles.preview}>{item.comments}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Report moment"
                onPress={() => report(item)}
                style={styles.postAction}
              >
                <Flag color={MUTED} size={16} />
              </Pressable>
              {item.author.id === session.session.account ? (
                <Pressable
                  accessibilityLabel="Delete my moment"
                  onPress={() => remove(item)}
                  style={styles.postAction}
                >
                  <Trash2 color={MUTED} size={16} />
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />
      <Modal visible={compose} transparent animationType="slide" onRequestClose={closeMomentComposer}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle title="New moment" close={closeMomentComposer} />
            <TextInput
              accessibilityLabel="Moment text"
              multiline
              maxLength={2000}
              value={text}
              onChangeText={setText}
              placeholder="What feels worth sharing?"
              placeholderTextColor="#98A2B3"
              style={styles.composer}
            />
            <Text style={styles.label}>VISIBILITY</Text>
            <View style={styles.aiKinds}>
              {(["public", "contacts", "private"] as const).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setVisibility(value)}
                  style={[
                    styles.chip,
                    visibility === value && styles.chipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      visibility === value && styles.chipTextActive,
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.privacy}>
              {visibility === "public"
                ? "Visible to everyone"
                : visibility === "contacts"
                  ? "Visible only to accepted contacts"
                  : "Visible only to you"}
            </Text>
            <View style={styles.aiKinds}>
              {media.map((item) => (
                <Image
                  key={item.id}
                  source={{ uri: item.uri }}
                  style={styles.avatar}
                />
              ))}
            </View>
            <Pressable
              accessibilityLabel="Choose moment image"
              onPress={() => void pickMedia()}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>
                Choose image · {media.length}/4
              </Text>
            </Pressable>
            <Pressable
              disabled={!text.trim() && !media.length}
              onPress={publish}
              style={[
                styles.primary,
                !text.trim() && !media.length && styles.disabled,
              ]}
            >
              <Send color="#FFFFFF" size={17} />
              <Text style={styles.primaryText}>Review & publish</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <CommentsModal
        post={selected}
        api={api}
        close={() => {
          setSelected(null);
          void load();
        }}
      />
      <Modal
        visible={Boolean(reportRecord)}
        transparent
        animationType="slide"
        onRequestClose={() => setReportRecord(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle
              title="Trust review"
              close={() => setReportRecord(null)}
            />
            <Text style={styles.label}>MODERATION OUTCOME</Text>
            <Text style={styles.aiContext}>
              {reportRecord?.outcome} · {reportRecord?.status}
            </Text>
            <Text style={styles.aiPreview}>{reportRecord?.explanation}</Text>
            <Text style={styles.provider}>
              Trust evidence · {reportRecord?.evidenceHashes.length ?? 0}{" "}
              SHA-256 fingerprint · no automatic penalty
            </Text>
            <Pressable
              onPress={() => {
                setExplainReport(reportRecord);
                setReportRecord(null);
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>
                Ask AI to explain this outcome
              </Text>
            </Pressable>
            <TextInput
              accessibilityLabel="Correction or report appeal"
              maxLength={2000}
              multiline
              value={appeal}
              onChangeText={setAppeal}
              placeholder="Add context or appeal this outcome"
              placeholderTextColor="#98A2B3"
              style={styles.composer}
            />
            <Pressable
              disabled={!appeal.trim()}
              onPress={() => void appealReport()}
              style={[styles.primary, !appeal.trim() && styles.disabled]}
            >
              <Text style={styles.primaryText}>Submit correction / appeal</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <AIModerationModal
        report={explainReport}
        api={api}
        close={() => setExplainReport(null)}
      />
    </Screen>
  );
}

function CommentsModal({
  post,
  api,
  close,
}: {
  post: FeedPost | null;
  api: SocialAPI;
  close: () => void;
}) {
  const [items, setItems] = useState<MomentComment[]>([]),
    [text, setText] = useState(""),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    if (!post) return;
    try {
      setItems((await api.comments(post.id)).comments);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  useEffect(() => {
    void load();
  }, [post?.id]);
  const send = async () => {
    if (!post) return;
    try {
      await api.comment(post.id, text, `comment-${Date.now()}`);
      setText("");
      await load();
    } catch (caught) {
      setError(message(caught));
    }
  };
  return (
    <Modal
      visible={Boolean(post)}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <SheetTitle title="Comments" close={close} />
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={styles.commentList}
            ListEmptyComponent={
              <Text style={styles.emptyBody}>No comments yet.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Avatar person={item.author} />
                <View style={styles.flex}>
                  <Text style={styles.name}>
                    {item.author.displayName}{" "}
                    <Text style={styles.handle}>@{item.author.handle}</Text>
                  </Text>
                  <Text style={styles.preview}>{item.text}</Text>
                </View>
              </View>
            )}
          />
          <View style={styles.composerRow}>
            <TextInput
              accessibilityLabel="Comment"
              maxLength={1000}
              value={text}
              onChangeText={setText}
              placeholder="Write a comment"
              placeholderTextColor="#98A2B3"
              style={styles.messageInput}
            />
            <Pressable
              disabled={!text.trim()}
              onPress={() => void send()}
              style={[styles.sendButton, !text.trim() && styles.disabled]}
            >
              <Send color="#FFFFFF" size={18} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Alerts({ api }: { api: SocialAPI }) {
  const [items, setItems] = useState<AlertItem[]>([]),
    [unread, setUnread] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try {
      const result = await api.alerts();
      setItems(result.notifications);
      setUnread(result.unread);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <Screen title={`Alerts${unread ? ` · ${unread}` : ""}`} error={error}>
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={BLUE}
          />
        }
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <Empty
            icon={Bell}
            title="You're all caught up"
            body="Requests, comments, reactions, follows, mentions, and message state appear here."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void api.markRead(item.id).then(load)}
            style={[styles.row, !item.readAt && styles.unread]}
          >
            <Avatar person={item.actor} />
            <View style={styles.flex}>
              <Text style={styles.name}>{item.summary}</Text>
              <Text style={styles.handle}>
                @{item.actor.handle} · {relative(item.createdAt)}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function Profile({
  api,
  session,
  onSessionChange,
  onSignOut,
}: {
  api: SocialAPI;
  session: Session;
  onSessionChange: (session: Session | null) => void;
  onSignOut: () => void;
}) {
  const [person, setPerson] = useState<SocialProfile | null>(null),
    [edit, setEdit] = useState(false),
    [handle, setHandle] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [bio, setBio] = useState(""),
    [avatarUrl, setAvatarUrl] = useState(""),
    [error, setError] = useState<string | null>(null),
    [rotating, setRotating] = useState(false),
    [exportText, setExportText] = useState("");
  const load = async () => {
    try {
      const value = await api.profileOrSetup();
      if(!value){setPerson(null);setEdit(true);setError(null);return}
      setPerson(value);
      setHandle(value.handle);
      setDisplayName(value.displayName);
      setBio(value.bio);
      setAvatarUrl(value.avatarUrl ?? "");
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    try {
      const result = await api.updateProfile({
        idempotencyKey: `profile-${Date.now()}`,
        handle: handle.trim().replace(/^@/, ""),
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl: avatarUrl.trim() || undefined,
      });
      setPerson(result.record);
      setEdit(false);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const rotate = async () => {
    setRotating(true);
    try {
      let pendingRaw = await SecureStore.getItemAsync(ROTATION_KEY),
        pending:
          | undefined
          | {
              replacedDeviceId: string;
              newSigningSeed: string;
              newEncryptionSeed: string;
              productSecret: string;
              request: ReturnType<typeof createDeviceRotation>;
            };
      if (pendingRaw) pending = JSON.parse(pendingRaw) as typeof pending;
      if (pending && session.session.deviceId === pending.request.newDeviceId) {
        await SecureStore.deleteItemAsync(ROTATION_KEY);
        setError(null);
        return;
      }
      if (!pending) {
        const oldRaw = await SecureStore.getItemAsync(DEVICE_KEY);
        if (!oldRaw)
          throw new Error("Current Social device key is unavailable");
        const old = JSON.parse(oldRaw) as {
            signingSeed: string;
            productSecret: string;
          },
          newSigning = await getRandomBytesAsync(32),
          newEncryption = await getRandomBytesAsync(32),
          random = await getRandomBytesAsync(18),
          hex = (value: Uint8Array) =>
            Array.from(value, (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
          newDeviceId = `social-${hex(random).slice(0, 24)}`,
          idempotencyKey = `rotate-${hex(random)}`;
        if (!/^[0-9a-f]{64}$/.test(old.productSecret ?? ""))
          throw new Error(
            "Sign in with YNX Wallet once before rotating this legacy device",
          );
        pending = {
          replacedDeviceId: session.session.deviceId,
          newSigningSeed: hex(newSigning),
          newEncryptionSeed: hex(newEncryption),
          productSecret: old.productSecret,
          request: createDeviceRotation({
            account: session.session.account,
            authorizingDeviceId: session.session.deviceId,
            replacedDeviceId: session.session.deviceId,
            authorizingSigningSeed: hexBytes(old.signingSeed),
            newSigningSeed: newSigning,
            newEncryptionSeed: newEncryption,
            idempotencyKey,
            newDeviceId,
          }),
        };
        await SecureStore.setItemAsync(ROTATION_KEY, JSON.stringify(pending), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      const result = await api.rotateDevice(
          pending.replacedDeviceId,
          pending.request,
        ),
        next: Session = adoptRotatedSession(session, result);
      await SecureStore.setItemAsync(
        DEVICE_KEY,
        JSON.stringify({
          deviceId: pending.request.newDeviceId,
          signingSeed: pending.newSigningSeed,
          encryptionSeed: pending.newEncryptionSeed,
          productSecret: pending.productSecret,
        }),
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      api.useSession(next);
      onSessionChange(next);
      await SecureStore.deleteItemAsync(ROTATION_KEY);
      Alert.alert(
        "Device rotated",
        "The previous Social device is revoked. New messages now use this device identity.",
      );
    } catch (caught) {
      setError(`Device rotation can be retried safely · ${message(caught)}`);
    } finally {
      setRotating(false);
    }
  };
  const exportData = async () => {
    try {
      setExportText(JSON.stringify(await api.exportData(), null, 2));
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const deleteAccount = async () => {
    const originalCurrent=api.authorizationGuard();
    let receipt:Awaited<ReturnType<SocialAPI['deleteAccountReceipt']>>|undefined;
    try {
      receipt=await api.deleteAccountReceipt(session.session.account);
      await accountIntentIndex.cleanupConfirmed(receipt.account,receipt.current);
      if(!receipt.current())return;
      messageOutbox.clearAccount(receipt.account,receipt.current);
      if(!receipt.current())return;
      onSessionChange(null);
      Alert.alert("Social data deleted","Known pending records for this account were cleared. Older unindexed local records and legacy device keys were retained for explicit recovery; local erasure is not complete.");
    } catch (caught) {
      if(receipt?.current()||!receipt&&originalCurrent())setError(`${receipt?'Deletion confirmed; local cleanup requires explicit recovery. ':''}${message(caught)}`);
    }
  };
  return (
    <Screen
      title="Settings"
      action={
        <Pressable
          accessibilityLabel="Edit Social profile"
          onPress={() => setEdit(true)}
          style={styles.iconButton}
        >
          <UserRound color={BLUE} size={20} />
        </Pressable>
      }
      error={error}
    >
      <ScrollView contentContainerStyle={styles.profileScroll}>
        <AppearanceSettings />
        <ChatAppearanceSettings account={session.session.account} />
        <View style={{ paddingHorizontal: 20, alignItems: 'flex-start' }}><LanguagePicker compact /></View>
        <View style={styles.profileCard}>
          <View style={styles.largeAvatar}>
            {person?.avatarUrl ? (
              <Image
                accessibilityLabel={`${person.displayName} avatar`}
                source={{ uri: person.avatarUrl }}
                style={styles.largeAvatarImage}
              />
            ) : (
              <Text style={styles.largeAvatarText}>
                {person?.displayName?.slice(0, 1).toUpperCase() ?? "Y"}
              </Text>
            )}
          </View>
          <Text style={styles.profileName}>
            {person?.displayName || "Complete your profile"}
          </Text>
          {person?.handle ? (
            <Text style={styles.profileHandle}>@{person.handle}</Text>
          ) : null}
          {person?.bio ? (
            <Text style={styles.emptyBody}>{person.bio}</Text>
          ) : null}
          <View style={styles.qr}>
            {socialProfileQR(person?.privacy.profileQrPayload) ? (
              <QRCode
                value={socialProfileQR(person?.privacy.profileQrPayload)!}
                size={148}
                color={INK}
                backgroundColor="#FFFFFF"
              />
            ) : (
              <QrCode color={BLUE} size={60} />
            )}
          </View>
          <Text style={styles.securityNote}>
            Your profile QR uses a stable public Social identifier, never a wallet address. Refresh your profile if its stable QR is unavailable. Legacy username QRs are not identity proof.
          </Text>
        </View>
        <PrivacyPanel api={api} />
        <Pressable
          accessibilityLabel="Rotate this Social encryption device"
          disabled={rotating}
          onPress={() =>
            Alert.alert(
              "Rotate this Social device?",
              "The current signing and encryption device will be revoked. A saved exact retry protects recovery if the response is interrupted.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Rotate",
                  style: "destructive",
                  onPress: () => void rotate(),
                },
              ],
            )
          }
          style={styles.secondary}
        >
          {rotating ? (
            <ActivityIndicator color={BLUE} />
          ) : (
            <Text style={styles.secondaryText}>Rotate encryption device</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Export my Social data"
          onPress={() => void exportData()}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Export my Social data</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Delete my Social account"
          onPress={() =>
            Alert.alert(
              "Delete your Social account?",
              "Social-owned profile settings, contacts, Moments, media, device records, AI jobs and sessions will be permanently deleted. Central Chat and Square erasure is requested separately in the handoff.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete permanently",
                  style: "destructive",
                  onPress: () => void deleteAccount(),
                },
              ],
            )
          }
          style={styles.secondary}
        >
          <Text style={styles.destructiveText}>Delete Social account</Text>
        </Pressable>
        <Pressable onPress={onSignOut} style={styles.secondary}>
          <Text style={styles.destructiveText}>Sign out</Text>
        </Pressable>
        <Modal
          visible={edit}
          transparent
          animationType="slide"
          onRequestClose={() => setEdit(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              <SheetTitle
                title="Social identity"
                close={() => setEdit(false)}
              />
              <Text style={styles.label}>UNIQUE HANDLE</Text>
              <TextInput
                accessibilityLabel="Unique Social handle"
                autoCapitalize="none"
                maxLength={24}
                value={handle}
                onChangeText={setHandle}
                placeholder="@handle"
                placeholderTextColor="#98A2B3"
                style={styles.input}
              />
              <Text style={styles.label}>DISPLAY NAME</Text>
              <TextInput
                accessibilityLabel="Display name"
                maxLength={64}
                value={displayName}
                onChangeText={setDisplayName}
                style={styles.input}
              />
              <Text style={styles.label}>BIO</Text>
              <TextInput
                accessibilityLabel="Bio"
                multiline
                maxLength={280}
                value={bio}
                onChangeText={setBio}
                style={styles.composer}
              />
              <Text style={styles.label}>AVATAR HTTPS URL</Text>
              <TextInput
                accessibilityLabel="Avatar URL"
                autoCapitalize="none"
                value={avatarUrl}
                onChangeText={setAvatarUrl}
                placeholder="https://"
                placeholderTextColor="#98A2B3"
                style={styles.input}
              />
              <Pressable
                disabled={
                  !/^[a-z][a-z0-9_]{2,23}$/.test(handle.replace(/^@/, "")) ||
                  !displayName.trim()
                }
                onPress={() => void save()}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Save identity</Text>
              </Pressable>
              <Text style={styles.securityNote}>
                Your wallet address remains in the signature and audit layer
                only.
              </Text>
            </View>
          </View>
        </Modal>
        <Modal
          visible={Boolean(exportText)}
          transparent
          animationType="slide"
          onRequestClose={() => setExportText("")}
        >
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              <SheetTitle
                title="Your Social export"
                close={() => setExportText("")}
              />
              <Text style={styles.securityNote}>
                This export contains your Social-owned records and ciphertext
                metadata. Treat it as private.
              </Text>
              <TextInput
                accessibilityLabel="Social privacy export"
                editable={false}
                multiline
                value={exportText}
                style={styles.exportText}
              />
            </View>
          </View>
        </Modal>
      </ScrollView>
    </Screen>
  );
}

function AIModal({
  conversation,
  close,
  api,
}: {
  conversation: Conversation | null;
  close: () => void;
  api: SocialAPI;
}) {
  const { locale, t } = useI18n();
  const [kind, setKind] = useState("conversation_summary"),
    [outputLanguage, setOutputLanguage] = useState(locale),
    [allowed, setAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [job, setJob] = useState<AIJob | null>(null),
    [controller, setController] = useState<AbortController | null>(null),
    [correction, setCorrection] = useState("");
  useEffect(() => {
    setResult("");
    setJob(null);
    setAllowed(false);
    setCorrection("");
  }, [conversation?.id]);
  const selectedContext = async () => {
    if (!conversation) throw new Error("Select one conversation");
    const [sessionRaw, keyRaw, devicesResult, messagesResult] =
      await Promise.all([
        SecureStore.getItemAsync(SESSION_KEY),
        SecureStore.getItemAsync(DEVICE_KEY),
        api.conversationDevices(conversation.id),
        api.messages(conversation.id),
      ]);
    if (!sessionRaw || !keyRaw)
      throw new Error("Social session keys are unavailable");
    const session = JSON.parse(sessionRaw) as Session,
      keys = JSON.parse(keyRaw) as { encryptionSeed: string },
      devices = new Map(
        devicesResult.devices.map((device) => [device.id, device]),
      ),
      lines: string[] = [];
    for (const record of messagesResult.messages.slice(-50)) {
      const sender = devices.get(record.senderDeviceId);
      if (!sender || !verifyMessageSignature(record, sender))
        throw new Error("A selected message failed sender verification");
      const plaintext = decryptDeviceMessage({
        encryptionSeed: hexBytes(keys.encryptionSeed),
        deviceId: session.session.deviceId,
        message: record,
      });
      if (!parseAttachment(plaintext))
        lines.push(
          `${record.sender === session.session.account ? "You" : "Participant"}: ${plaintext}`,
        );
    }
    const context = lines.join("\n");
    if (!context)
      throw new Error("The selected thread has no decryptable text messages");
    return context.slice(-6000);
  };
  const run = async () => {
    if (!conversation) return;
    setBusy(true);
    setResult("");
    const abort = new AbortController();
    setController(abort);
    try {
      const context = await selectedContext(),
        started = await api.aiBegin({
          idempotencyKey: `ai-${Date.now()}`,
          kind,
          selectionIds: [conversation.id],
          contextClasses: ["selected_thread_messages"],
          privacyPreview:
            "Only decrypted text from this selected thread is shared. Handles, contacts, attachments, profile identity, and wallet identity are excluded.",
          provider: "ynx-ai-gateway",
          model: "social-balanced",
          estimatedTokens: 1600,
          outputLanguage,
        });
      await api.aiTransition(started.record.id, "allow");
      setJob({ ...started.record, status: "streaming" });
      let streamed = "";
      const reviewed = await api.streamAI(
        started.record.id,
        context,
        (chunk) => {
          streamed += chunk;
          setResult(streamed);
        },
        abort.signal,
      );
      setJob(reviewed);
      setResult(reviewed.output ?? streamed);
    } catch (caught) {
      if ((caught as { name?: string })?.name !== "AbortError") {
        setJob((current) =>
          current ? { ...current, status: "provider_failed" } : current,
        );
        setResult(message(caught));
      }
    } finally {
      setBusy(false);
      setController(null);
    }
  };
  const cancel = async () => {
    controller?.abort();
    if (job)
      try {
        setJob(await api.aiTransition(job.id, "cancel"));
      } catch {}
    setBusy(false);
  };
  const transition = async (
    action: "apply" | "reject" | "retry" | "appeal",
    output = "",
  ) => {
    if (!job) return;
    try {
      const updated = await api.aiTransition(job.id, action, output);
      setJob(updated);
      if (action === "retry") {
        setAllowed(false);
        setResult("");
      }
    } catch (caught) {
      setResult(message(caught));
    }
  };
  return (
    <Modal
      visible={Boolean(conversation)}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <SheetTitle title="AI for this conversation" close={close} />
          <Text style={styles.label}>SELECTED CONTEXT</Text>
          <Text style={styles.aiContext}>
            {conversation?.title} · one explicitly selected thread
          </Text>
          <Text style={styles.label}>PRIVACY PREVIEW</Text>
          <Text style={styles.aiPreview}>
            Only decrypted text from this thread. No handles, contacts,
            attachments, profile identity, wallet data, or recovery material.
          </Text>
          <Text style={styles.provider}>
            YNX AI Gateway · social-balanced · estimated{" "}
            {formatNumber(0.0024, undefined, {
              style: "currency",
              currency: "USD",
            })}
          </Text>
          <Text style={styles.label}>{t("AI output language")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.aiKinds}>
              {locales.map((value) => (
                <Pressable
                  key={value}
                  disabled={busy}
                  accessibilityLabel={`${t("AI output language")}: ${localeNames[value]}`}
                  onPress={() => setOutputLanguage(value)}
                  style={[
                    styles.chip,
                    outputLanguage === value && styles.chipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      outputLanguage === value && styles.chipTextActive,
                    ]}
                  >
                    {localeNames[value]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <View style={styles.aiKinds}>
            {[
              "reply_draft",
              "conversation_summary",
              "translation",
              "inbox_classification",
            ].map((value) => (
              <Pressable
                key={value}
                disabled={busy}
                onPress={() => setKind(value)}
                style={[styles.chip, kind === value && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    kind === value && styles.chipTextActive,
                  ]}
                >
                  {value.replaceAll("_", " ")}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allowed }}
            disabled={busy}
            onPress={() => setAllowed(!allowed)}
            style={styles.permission}
          >
            <View
              style={[styles.checkbox, allowed && styles.checkboxChecked]}
            />
            <Text style={styles.permissionText}>
              Allow exactly this request. AI cannot send, publish, follow,
              block, report, or punish.
            </Text>
          </Pressable>
          {result ? (
            <Text selectable style={styles.aiResult}>
              {result}
            </Text>
          ) : null}
          {job?.status === "review" ? (
            <View style={styles.aiKinds}>
              <Pressable
                onPress={() => void transition("apply")}
                style={styles.smallPrimary}
              >
                <Text style={styles.smallPrimaryText}>
                  Accept for manual use
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void transition("reject")}
                style={styles.chip}
              >
                <Text style={styles.chipText}>Reject</Text>
              </Pressable>
            </View>
          ) : null}
          {job &&
          (job.status === "cancelled" ||
            job.status === "provider_failed" ||
            job.status === "rejected") ? (
            <Pressable
              onPress={() => void transition("retry")}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>
                Retry with new permission
              </Text>
            </Pressable>
          ) : null}
          {job && (job.status === "applied" || job.status === "review") ? (
            <>
              <TextInput
                accessibilityLabel="AI correction or appeal"
                value={correction}
                onChangeText={setCorrection}
                placeholder="Correction or appeal"
                placeholderTextColor="#98A2B3"
                style={styles.input}
              />
              <Pressable
                disabled={!correction.trim()}
                onPress={() => void transition("appeal", correction.trim())}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>
                  Submit correction / appeal
                </Text>
              </Pressable>
            </>
          ) : null}
          {busy ? (
            <Pressable onPress={() => void cancel()} style={styles.secondary}>
              <Text style={styles.secondaryText}>Cancel stream</Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={
                !allowed ||
                Boolean(
                  job &&
                    !["cancelled", "provider_failed", "rejected"].includes(
                      job.status,
                    ),
                )
              }
              onPress={() => void run()}
              style={[
                styles.primary,
                (!allowed ||
                  Boolean(
                    job &&
                      !["cancelled", "provider_failed", "rejected"].includes(
                        job.status,
                      ),
                  )) &&
                  styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>Start streaming</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function AIModerationModal({
  report,
  api,
  close,
}: {
  report: SocialReport | null;
  api: SocialAPI;
  close: () => void;
}) {
  const { locale, t } = useI18n();
  const [outputLanguage, setOutputLanguage] = useState(locale),
    [allowed, setAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [job, setJob] = useState<AIJob | null>(null),
    [controller, setController] = useState<AbortController | null>(null),
    [correction, setCorrection] = useState("");
  useEffect(() => {
    setAllowed(false);
    setBusy(false);
    setResult("");
    setJob(null);
    setCorrection("");
  }, [report?.id]);
  const run = async () => {
    if (!report) return;
    setBusy(true);
    setResult("");
    const abort = new AbortController();
    setController(abort);
    try {
      const context = [
          `Report status: ${report.status}`,
          `Moderation outcome: ${report.outcome}`,
          `Official explanation: ${report.explanation}`,
          `Evidence fingerprints: ${report.evidenceHashes.length}`,
        ].join("\n"),
        started = await api.aiBegin({
          idempotencyKey: `ai-moderation-${Date.now()}`,
          kind: "moderation_explanation",
          selectionIds: [report.id],
          contextClasses: ["selected_moderation_report"],
          privacyPreview:
            "Only this selected report outcome, explanation, and evidence count are shared. The reported content, handles, wallet identity, and evidence values are excluded.",
          provider: "ynx-ai-gateway",
          model: "social-balanced",
          estimatedTokens: 900,
          outputLanguage,
        });
      await api.aiTransition(started.record.id, "allow");
      setJob({ ...started.record, status: "streaming" });
      let streamed = "";
      const reviewed = await api.streamAI(
        started.record.id,
        context,
        (chunk) => {
          streamed += chunk;
          setResult(streamed);
        },
        abort.signal,
      );
      setJob(reviewed);
      setResult(reviewed.output ?? streamed);
    } catch (caught) {
      if ((caught as { name?: string })?.name !== "AbortError") {
        setJob((current) =>
          current ? { ...current, status: "provider_failed" } : current,
        );
        setResult(message(caught));
      }
    } finally {
      setBusy(false);
      setController(null);
    }
  };
  const transition = async (
    action: "cancel" | "apply" | "reject" | "retry" | "appeal",
    output = "",
  ) => {
    if (!job) return;
    try {
      if (action === "cancel") controller?.abort();
      const updated = await api.aiTransition(job.id, action, output);
      setJob(updated);
      if (action === "retry") {
        setAllowed(false);
        setResult("");
      }
    } catch (caught) {
      setResult(message(caught));
    } finally {
      if (action === "cancel") setBusy(false);
    }
  };
  return (
    <Modal
      visible={Boolean(report)}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <SheetTitle title="AI moderation explanation" close={close} />
          <Text style={styles.label}>SELECTED CONTEXT</Text>
          <Text style={styles.aiContext}>
            {report?.id} · one explicitly selected Trust report
          </Text>
          <Text style={styles.label}>PRIVACY PREVIEW</Text>
          <Text style={styles.aiPreview}>
            Only the outcome, official explanation and evidence count. No
            reported content, handles, evidence values, wallet identity, or
            recovery material.
          </Text>
          <Text style={styles.provider}>
            YNX AI Gateway · social-balanced · estimated{" "}
            {formatNumber(0.0014, undefined, {
              style: "currency",
              currency: "USD",
            })}
          </Text>
          <Text style={styles.label}>{t("AI output language")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.aiKinds}>
              {locales.map((value) => (
                <Pressable
                  key={value}
                  disabled={busy}
                  accessibilityLabel={`${t("AI output language")}: ${localeNames[value]}`}
                  onPress={() => setOutputLanguage(value)}
                  style={[
                    styles.chip,
                    outputLanguage === value && styles.chipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      outputLanguage === value && styles.chipTextActive,
                    ]}
                  >
                    {localeNames[value]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allowed }}
            disabled={busy}
            onPress={() => setAllowed(!allowed)}
            style={styles.permission}
          >
            <View
              style={[styles.checkbox, allowed && styles.checkboxChecked]}
            />
            <Text style={styles.permissionText}>
              Allow exactly this explanation. AI cannot change moderation,
              punish, report, block, follow, publish, or send.
            </Text>
          </Pressable>
          {result ? (
            <Text selectable style={styles.aiResult}>
              {result}
            </Text>
          ) : null}
          {job?.status === "review" ? (
            <View style={styles.aiKinds}>
              <Pressable
                onPress={() => void transition("apply")}
                style={styles.smallPrimary}
              >
                <Text style={styles.smallPrimaryText}>Accept explanation</Text>
              </Pressable>
              <Pressable
                onPress={() => void transition("reject")}
                style={styles.chip}
              >
                <Text style={styles.chipText}>Reject</Text>
              </Pressable>
            </View>
          ) : null}
          {job &&
          ["cancelled", "provider_failed", "rejected"].includes(job.status) ? (
            <Pressable
              onPress={() => void transition("retry")}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>
                Retry with new permission
              </Text>
            </Pressable>
          ) : null}
          {job && (job.status === "applied" || job.status === "review") ? (
            <>
              <TextInput
                accessibilityLabel="AI explanation correction or appeal"
                value={correction}
                onChangeText={setCorrection}
                placeholder="Correction or appeal"
                placeholderTextColor="#98A2B3"
                style={styles.input}
              />
              <Pressable
                disabled={!correction.trim()}
                onPress={() => void transition("appeal", correction.trim())}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>
                  Submit correction / appeal
                </Text>
              </Pressable>
            </>
          ) : null}
          {busy ? (
            <Pressable
              onPress={() => void transition("cancel")}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Cancel stream</Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={
                !allowed ||
                Boolean(
                  job &&
                    !["cancelled", "provider_failed", "rejected"].includes(
                      job.status,
                    ),
                )
              }
              onPress={() => void run()}
              style={[
                styles.primary,
                (!allowed ||
                  Boolean(
                    job &&
                      !["cancelled", "provider_failed", "rejected"].includes(
                        job.status,
                      ),
                  )) &&
                  styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>Start streaming</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PrivacyPanel({ api }: { api: SocialAPI }) {
  const [settings, setSettings] = useState<PrivacySettings | null>(null),
    [invite, setInvite] = useState(""),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setSettings((await api.settings()).record);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async (patch: Partial<PrivacySettings>) => {
    if (!settings) return;
    try {
      const result = await api.updateSettings({
        idempotencyKey: `privacy-${Date.now()}`,
        discoverableByHandle:
          patch.discoverableByHandle ?? settings.discoverableByHandle,
        contactsMatching: patch.contactsMatching ?? settings.contactsMatching,
        allowRecommendations:
          patch.allowRecommendations ?? settings.allowRecommendations,
        allowRequestsFrom: (patch.allowRequestsFrom ??
          settings.allowRequestsFrom) as "everyone" | "contacts" | "nobody",
        avatarUrl: settings.avatarUrl,
      });
      setSettings(result.record);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const createInvite = async () => {
    try {
      setInvite((await api.createInvite()).record.link);
    } catch (caught) {
      setError(message(caught));
    }
  };
  if (!settings)
    return (
      <View style={styles.profileCard}>
        <ActivityIndicator color={BLUE} />
      </View>
    );
  return (
    <View style={styles.profileCard}>
      <Text style={styles.name}>Privacy & discovery</Text>
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: settings.discoverableByHandle }}
        onPress={() =>
          void save({ discoverableByHandle: !settings.discoverableByHandle })
        }
        style={styles.permission}
      >
        <View
          style={[
            styles.checkbox,
            settings.discoverableByHandle && styles.checkboxChecked,
          ]}
        />
        <Text style={styles.permissionText}>
          Discoverable by unique @handle
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: settings.allowRecommendations }}
        onPress={() =>
          void save({ allowRecommendations: !settings.allowRecommendations })
        }
        style={styles.permission}
      >
        <View
          style={[
            styles.checkbox,
            settings.allowRecommendations && styles.checkboxChecked,
          ]}
        />
        <Text style={styles.permissionText}>
          Allow privacy-bounded recommendations
        </Text>
      </Pressable>
      <Text style={styles.label}>CONTACT REQUESTS</Text>
      <View style={styles.aiKinds}>
        {(["everyone", "contacts", "nobody"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => void save({ allowRequestsFrom: value })}
            style={[
              styles.chip,
              settings.allowRequestsFrom === value && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                settings.allowRequestsFrom === value && styles.chipTextActive,
              ]}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => void createInvite()} style={styles.secondary}>
        <Text style={styles.secondaryText}>Create 24-hour invite link</Text>
      </Pressable>
      {invite ? (
        <Text selectable style={styles.aiPreview}>
          {invite}
        </Text>
      ) : null}
      <Text style={styles.securityNote}>
        Phone matching stays off until explicit Contacts permission and never
        exposes your address book to other users.
      </Text>
    </View>
  );
}

function PhoneContactMatcher({
  api,
  onSelect,
}: {
  api: SocialAPI;
  onSelect: (token: string) => void;
}) {
  const [matches, setMatches] = useState<ContactMatch[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const match = async () => {
    setBusy(true);
    try {
      const permission = await ExpoContacts.requestPermissionsAsync();
      if (!permission.granted)
        throw new Error("Contacts permission was not granted");
      const current = (await api.settings()).record;
      if (!current.contactsMatching)
        await api.updateSettings({
          idempotencyKey: `contacts-permission-${Date.now()}`,
          discoverableByHandle: current.discoverableByHandle,
          contactsMatching: true,
          allowRecommendations: current.allowRecommendations,
          allowRequestsFrom: current.allowRequestsFrom as
            | "everyone"
            | "contacts"
            | "nobody",
          avatarUrl: current.avatarUrl,
        });
      const book = await ExpoContacts.getContactsAsync({
          fields: [ExpoContacts.Fields.PhoneNumbers],
          pageSize: 500,
        }),
        numbers = new Set<string>();
      for (const contact of book.data)
        for (const phone of contact.phoneNumbers ?? []) {
          const normalized = (phone.number ?? "").replace(/[\s().-]/g, "");
          if (/^\+[1-9]\d{7,14}$/.test(normalized)) numbers.add(normalized);
        }
      const hashes = await Promise.all(
        [...numbers].map((number) =>
          digestStringAsync(
            CryptoDigestAlgorithm.SHA256,
            `ynx-social-contact-v1\n${number}`,
          ),
        ),
      );
      setMatches((await api.contactMatches(hashes)).matches);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <Pressable onPress={() => void match()} style={styles.secondary}>
        {busy ? (
          <ActivityIndicator color={BLUE} />
        ) : (
          <Text style={styles.secondaryText}>
            Allow & match contacts locally
          </Text>
        )}
      </Pressable>
      {matches.map((item) => (
        <Pressable
          key={item.token}
          onPress={() => onSelect(item.token)}
          style={styles.request}
        >
          <Avatar person={item.person} />
          <View style={styles.flex}>
            <Text style={styles.name}>{item.person.displayName}</Text>
            <Text style={styles.handle}>@{item.person.handle}</Text>
          </View>
          <Plus color={BLUE} size={18} />
        </Pressable>
      ))}
      <Text style={styles.securityNote}>
        Only domain-separated SHA-256 hashes of canonical +country-code numbers
        are sent. Raw contacts remain on this device.
      </Text>
    </View>
  );
}

function Screen({
  title,
  action,
  error,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {action}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.inlineError}>
          {error}
        </Text>
      ) : null}
      <View style={styles.flex}>{children}</View>
    </View>
  );
}
function TabButton({
  tab,
  active,
  label,
  icon: Icon,
  onPress,
}: {
  tab: Tab;
  active: boolean;
  label: string;
  icon: typeof Bell;
  onPress: (tab: Tab) => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => onPress(tab)}
      style={styles.tab}
    >
      <Icon
        color={active ? BLUE : "#7C8491"}
        size={21}
        strokeWidth={active ? 2.4 : 1.8}
      />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Bell;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <Icon color={BLUE} size={34} strokeWidth={1.5} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}
function Avatar({ person }: { person: Person }) {
  return (
    <View style={styles.avatar}>
      {person.avatarUrl ? (
        <Image
          accessibilityLabel={`${person.displayName} avatar`}
          source={{ uri: person.avatarUrl }}
          style={styles.avatarImage}
        />
      ) : (
        <Text style={styles.avatarText}>
          {person.displayName.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
function SheetTitle({ title, close }: { title: string; close: () => void }) {
  return (
    <View style={styles.sheetTitle}>
      <Text style={styles.sheetHeading}>{title}</Text>
      <Pressable
        accessibilityLabel="Close"
        onPress={close}
        style={styles.iconButton}
      >
        <X color={INK} size={20} />
      </Pressable>
    </View>
  );
}
function message(value: unknown) {
  return value instanceof Error ? value.message : "Unexpected Social error";
}
function relative(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return formatDate(date);
}
function hexBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new Error("Secure Social device key is invalid");
  return Uint8Array.from(value.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  auth: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#FFFFFF",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  authTitle: { fontSize: 24, fontWeight: "700", color: INK, marginTop: 16 },
  authBody: {
    fontSize: 16,
    lineHeight: 24,
    color: MUTED,
    textAlign: "center",
    maxWidth: 330,
    marginTop: 10,
  },
  securityNote: {
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    textAlign: "center",
    marginTop: 14,
  },
  error: {
    color: "#B42318",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 16,
  },
  primary: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: BLUE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 22,
    marginTop: 22,
  },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  header: {
    minHeight: 54,
    paddingVertical: 8,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  brandMark: {
    width: 31,
    height: 31,
    borderRadius: 10,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 18, fontWeight: "700", color: INK, marginLeft: 9 },
  privateBadge: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#ECFDF3",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  privateText: { fontSize: 11, fontWeight: "700", color: "#067647" },
  body: { flex: 1, minWidth: 0, minHeight: 0 },
  appWorkspace: { flex: 1, minHeight: 0 },
  desktopWorkspace: { flexDirection: 'row-reverse' },
  desktopTabs: { width: 100, height: '100%', flexDirection: 'column', borderTopWidth: 0,
    borderEndWidth: StyleSheet.hairlineWidth, borderEndColor: LINE, paddingVertical: 12 },
  chatSplit: { flex: 1, flexDirection: 'row', minHeight: 0 },
  chatSidebar: { width: 340, borderEndWidth: StyleSheet.hairlineWidth, borderEndColor: LINE },
  chatDetail: { flex: 1, minWidth: 0 },
  chatWelcome: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#edf2f7' },
  selectedChat: { backgroundColor: '#eef3ff' },
  unreadBadge: { minWidth: 24, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 12, backgroundColor: BLUE },
  unreadCount: { fontSize: 12, color: '#fff', textAlign: 'center' },
  threadScreen: { flex: 1, backgroundColor: '#e9eff5' },
  threadIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  dateSeparator: { alignSelf: 'center', backgroundColor: '#d4dfeb', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginVertical: 12 },
  dateText: { fontSize: 12, color: '#42566e' },
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  titleRow: {
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 20, fontWeight: "600", color: INK },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  inlineError: {
    color: "#B42318",
    backgroundColor: "#FEF3F2",
    paddingHorizontal: 20,
    paddingVertical: 10,
    fontSize: 12,
  },
  tabBar: {
    minHeight: 66,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7 },
  tabText: { fontSize: 12, color: "#7C8491" },
  tabTextActive: { color: BLUE, fontWeight: "700" },
  flex: { flex: 1 },
  muted: { color: MUTED, fontSize: 13 },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  empty: {
    minHeight: 300,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 38,
  },
  emptyTitle: { fontSize: 19, fontWeight: "700", color: INK, marginTop: 15 },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
    textAlign: "center",
    marginTop: 7,
  },
  row: {
    minHeight: 76,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  rowTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#EAF0FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: 46, height: 46, borderRadius: 23 },
  avatarText: { fontSize: 16, fontWeight: "800", color: BLUE },
  name: { fontSize: 15, fontWeight: "700", color: INK },
  handle: { fontSize: 12, color: MUTED, marginTop: 3 },
  preview: { fontSize: 13, color: MUTED, marginTop: 4 },
  time: { fontSize: 11, color: "#98A2B3" },
  e2ee: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  e2eeText: { fontSize: 12, color: MUTED },
  aiButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#F0F4FF",
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 8,
    minHeight: 44,
    borderRadius: 13,
    backgroundColor: SURFACE,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: INK },
  request: {
    minHeight: 78,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#F0F4FF",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  smallPrimary: {
    backgroundColor: BLUE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallPrimaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(16,24,40,.35)",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: 36,
    maxHeight: "90%",
  },
  sheetTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetHeading: { fontSize: 22, fontWeight: "700", color: INK },
  label: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: BLUE,
    marginTop: 22,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 13,
    paddingHorizontal: 14,
    fontSize: 15,
    color: INK,
    marginTop: 8,
  },
  discovery: {
    minHeight: 48,
    marginTop: 12,
    backgroundColor: SURFACE,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
  },
  discoveryText: { fontSize: 13, color: MUTED },
  feed: { padding: 16, gap: 12 },
  post: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  visibility: { fontSize: 10, color: MUTED, textTransform: "uppercase" },
  postText: { fontSize: 15, lineHeight: 23, color: INK, marginTop: 14 },
  postMeta: {
    flexDirection: "row",
    gap: 18,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
  },
  composer: {
    minHeight: 160,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 15,
    padding: 14,
    fontSize: 16,
    lineHeight: 24,
    color: INK,
    textAlignVertical: "top",
    marginTop: 18,
  },
  privacy: { fontSize: 13, color: BLUE, fontWeight: "600", marginTop: 12 },
  unread: { backgroundColor: "#F4F7FF" },
  profileCard: {
    alignItems: "center",
    margin: 20,
    padding: 24,
    borderRadius: 22,
    backgroundColor: SURFACE,
  },
  profileScroll: { paddingBottom: 32 },
  largeAvatar: {
    width: 78,
    height: 78,
    borderRadius: 26,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  largeAvatarImage: { width: 78, height: 78, borderRadius: 26 },
  largeAvatarText: { fontSize: 30, fontWeight: "800", color: "#FFFFFF" },
  profileName: { fontSize: 22, fontWeight: "700", color: INK, marginTop: 14 },
  profileHandle: { fontSize: 14, color: MUTED, marginTop: 4 },
  qr: {
    width: 180,
    height: 180,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  secondary: {
    height: 48,
    marginHorizontal: 20,
    marginTop: 10,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 14, fontWeight: "700", color: BLUE },
  destructiveText: { fontSize: 14, fontWeight: "700", color: "#B42318" },
  exportText: {
    height: 420,
    marginTop: 14,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    padding: 12,
    fontSize: 11,
    lineHeight: 16,
    color: INK,
    textAlignVertical: "top",
    backgroundColor: SURFACE,
  },
  aiContext: { fontSize: 15, fontWeight: "700", color: INK, marginTop: 5 },
  aiPreview: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    backgroundColor: SURFACE,
    padding: 12,
    borderRadius: 12,
    marginTop: 6,
  },
  provider: { fontSize: 12, color: BLUE, marginTop: 12 },
  aiKinds: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 16 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LINE,
  },
  chipActive: { backgroundColor: BLUE, borderColor: BLUE },
  chipText: { fontSize: 11, color: MUTED },
  chipTextActive: { color: "#FFFFFF", fontWeight: "700" },
  permission: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 18,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#98A2B3",
  },
  checkboxChecked: { backgroundColor: BLUE, borderColor: BLUE },
  permissionText: { flex: 1, fontSize: 12, lineHeight: 18, color: MUTED },
  aiResult: {
    fontSize: 13,
    lineHeight: 20,
    color: INK,
    backgroundColor: "#F0F4FF",
    padding: 12,
    borderRadius: 12,
    marginTop: 14,
  },
  disabled: { opacity: 0.4 },
  threadHeader: {
    minHeight: 64,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  messages: { padding: 14, gap: 9 },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-start" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 17,
    borderBottomLeftRadius: 5,
    backgroundColor: "#FFFFFF",
  },
  bubbleMine: {
    backgroundColor: "#e0eaff",
    borderBottomLeftRadius: 17,
    borderBottomRightRadius: 5,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, color: INK },
  bubbleTextMine: { color: INK },
  attachment: {
    minWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  messageState: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
    marginTop: 5,
  },
  messageStateText: { fontSize: 12, color: MUTED },
  composerRow: {
    minHeight: 66,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  messageInput: {
    flex: 1,
    maxHeight: 110,
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: SURFACE,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: INK,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  retryBar: {
    minHeight: 48,
    backgroundColor: "#F0F4FF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  retryText: { fontSize: 12, fontWeight: "700", color: BLUE },
  momentImage: {
    width: "100%",
    height: 240,
    borderRadius: 14,
    marginTop: 14,
    backgroundColor: SURFACE,
  },
  mediaCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: SURFACE,
    marginTop: 12,
  },
  postAction: {
    minWidth: 48,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  commentList: { minHeight: 160, maxHeight: 420, marginTop: 12 },
  languageButton: {
    position: "absolute",
    top: 18,
    right: 18,
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  languageCompact: {
    marginLeft: "auto",
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
  },
  languageText: { fontSize: 12, fontWeight: "700", color: BLUE },
  languageRow: {
    minHeight: 50,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  languageActive: { backgroundColor: "#F0F4FF" },
  scannerScreen: { flex: 1, backgroundColor: "#FFFFFF" },
  camera: { flex: 1, margin: 20, borderRadius: 22, overflow: "hidden" },
});
