import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

const BLUE = "#002FA7",
  INK = "#101828",
  MUTED = "#667085",
  LINE = "#E4E7EC",
  SURFACE = "#F7F8FA";
const localizeNode = (value: unknown, t: (input: string) => string): any =>
  typeof value === "string"
    ? t(value)
    : Array.isArray(value)
      ? value.map((item) => localizeNode(item, t))
      : value;
function Text({ children, ...props }: any) {
  const { t } = useI18n();
  return <NativeText {...props}>{localizeNode(children, t)}</NativeText>;
}
function TextInput(props: any) {
  const { t } = useI18n();
  return (
    <NativeTextInput
      {...props}
      placeholder={props.placeholder ? t(props.placeholder) : undefined}
      accessibilityLabel={
        props.accessibilityLabel ? t(props.accessibilityLabel) : undefined
      }
    />
  );
}
function Pressable(props: any) {
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
  alert(title: string, body?: string, buttons?: any[], options?: any) {
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
type Tab = "contacts" | "messages" | "moments" | "alerts" | "profile";

export default function App() {
  return (
    <I18nProvider>
      <SafeAreaProvider>
        <SocialApp />
      </SafeAreaProvider>
    </I18nProvider>
  );
}
function SocialApp() {
  const { t, isRTL } = useI18n();
  const [tab, setTab] = useState<Tab>("messages"),
    [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const api = useMemo(() => {
    try {
      return new SocialAPI(process.env.EXPO_PUBLIC_YNX_SOCIAL_API_BASE ?? "");
    } catch (caught) {
      setError(message(caught));
      return null;
    }
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const [value, deviceRaw] = await Promise.all([
          SecureStore.getItemAsync(SESSION_KEY),
          SecureStore.getItemAsync(DEVICE_KEY),
        ]);
        if (!value) return;
        const parsed = JSON.parse(value) as Session;
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
        setSession(parsed);
      } catch (caught) {
        setError(message(caught));
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);
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
  useEffect(() => {
    const subscription = Linking.addEventListener(
      "url",
      ({ url }) => void handleURL(url),
    );
    void Linking.getInitialURL().then((url) => {
      if (url) void handleURL(url);
    });
    return () => subscription.remove();
  }, [handleURL]);
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
        <ActivityIndicator color={BLUE} />
        <Text style={styles.muted}>
          {t("Restoring private Social session…")}
        </Text>
      </SafeAreaView>
    );
  if (!session || !api)
    return (
      <SafeAreaView style={[styles.auth, { direction: isRTL ? "rtl" : "ltr" }]}>
        <StatusBar style="dark" />
        <LanguagePicker />
        <View style={styles.mark}>
          <UsersRound color="#FFFFFF" size={34} />
        </View>
        <Text style={styles.authTitle}>YNX Social</Text>
        <Text style={styles.authBody}>
          {t(
            "Private conversations, thoughtful moments, and people you choose.",
          )}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(error)}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Sign in with YNX Wallet")}
          onPress={() => void signIn()}
          style={styles.primary}
        >
          <KeyRound color="#FFFFFF" size={19} />
          <Text style={styles.primaryText}>{t("Sign in with YNX Wallet")}</Text>
        </Pressable>
        <Text style={styles.securityNote}>
          {t("Social never creates, imports, or receives your recovery key.")}
        </Text>
      </SafeAreaView>
    );
  return (
    <SafeAreaView
      style={[styles.safe, { direction: isRTL ? "rtl" : "ltr" }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <UsersRound color="#FFFFFF" size={19} />
        </View>
        <Text style={styles.brand}>Social</Text>
        <View style={styles.privateBadge}>
          <ShieldCheck color="#067647" size={13} />
          <Text style={styles.privateText}>{t("Private")}</Text>
        </View>
        <LanguagePicker compact />
      </View>
      <View style={styles.body}>
        {tab === "contacts" ? (
          <Contacts api={api} />
        ) : tab === "messages" ? (
          <Messages api={api} session={session} />
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
      <View style={styles.tabBar}>
        <TabButton
          tab="contacts"
          active={tab === "contacts"}
          label={t("People")}
          icon={ContactRound}
          onPress={setTab}
        />
        <TabButton
          tab="messages"
          active={tab === "messages"}
          label={t("Messages")}
          icon={MessageCircle}
          onPress={setTab}
        />
        <TabButton
          tab="moments"
          active={tab === "moments"}
          label={t("Moments")}
          icon={Sparkles}
          onPress={setTab}
        />
        <TabButton
          tab="alerts"
          active={tab === "alerts"}
          label={t("Alerts")}
          icon={Bell}
          onPress={setTab}
        />
        <TabButton
          tab="profile"
          active={tab === "profile"}
          label={t("Me")}
          icon={UserRound}
          onPress={setTab}
        />
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

function Contacts({ api }: { api: SocialAPI }) {
  type Source = "handle" | "contacts" | "qr" | "invite" | "recommendation";
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
  const load = async () => {
    setLoading(true);
    try {
      setData(await api.contacts());
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
  const normalized = () =>
    source === "handle" || source === "recommendation"
      ? value.trim().replace(/^@/, "")
      : value.trim();
  const request = async () => {
    try {
      const candidate = normalized();
      if (/^ynx1/i.test(candidate))
        throw new Error("Wallet addresses cannot be used to add friends");
      await api.requestContact(source, candidate, `request-${Date.now()}`);
      setAdd(false);
      setValue("");
      await load();
    } catch (caught) {
      setError(message(caught));
    }
  };
  const transition = async (
    item: ContactRequest,
    action: "accept" | "reject" | "withdraw",
  ) => {
    try {
      await api.transitionRequest(item.id, action);
      await load();
    } catch (caught) {
      setError(message(caught));
    }
  };
  const manage = (person: Person) =>
    Alert.alert(person.displayName, `@${person.handle}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mute",
        onPress: () =>
          void api
            .mute(person.id, true)
            .catch((caught) => setError(message(caught))),
      },
      {
        text: "Delete contact",
        style: "destructive",
        onPress: () =>
          void api
            .deleteContact(person.id)
            .then(load)
            .catch((caught) => setError(message(caught))),
      },
      {
        text: "Block",
        style: "destructive",
        onPress: () =>
          void api
            .block(person.id)
            .then(load)
            .catch((caught) => setError(message(caught))),
      },
    ]);
  const pending = data.requests.filter((item) => item.status === "pending"),
    requestHeader = (
      <View>
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
        ? "ynxsocial://profile/handle"
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
        onRequestClose={() => setAdd(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle title="Add someone" close={() => setAdd(false)} />
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
                  onChangeText={setValue}
                  placeholder={placeholder}
                  placeholderTextColor="#98A2B3"
                  style={styles.input}
                />
                {source === "qr" ? (
                  <Pressable
                    accessibilityLabel="Scan profile QR with camera"
                    onPress={() => setScan(true)}
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
              disabled={!normalized() || /^ynx1/i.test(normalized())}
              onPress={() => void request()}
              style={[
                styles.primary,
                (!normalized() || /^ynx1/i.test(normalized())) &&
                  styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>Send request</Text>
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
        close={() => setScan(false)}
        onValue={(payload) => {
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
    if (locked) return;
    setLocked(true);
    try {
      if (data.length > 512) throw new Error("Profile QR payload is too large");
      const parsed = new URL(data);
      if (
        parsed.protocol !== "ynxsocial:" ||
        parsed.hostname !== "profile" ||
        !/^\/[a-z][a-z0-9_]{2,23}$/.test(parsed.pathname) ||
        parsed.search ||
        parsed.hash
      )
        throw new Error("This is not a canonical YNX Social profile QR");
      onValue(data);
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
        {!permission?.granted ? (
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

function Messages({ api, session }: { api: SocialAPI; session: Session }) {
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
  const load = async () => {
    setLoading(true);
    try {
      setItems((await api.conversations(query)).conversations);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [query]);
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
  if (selected)
    return (
      <MessageThread
        api={api}
        session={session}
        conversation={selected}
        close={() => {
          setSelected(null);
          void load();
        }}
      />
    );
  return (
    <Screen
      title="Messages"
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
          <Pressable onPress={() => setSelected(item)} style={styles.row}>
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
  const account = session.session.account,
    deviceId = session.session.deviceId;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const file = outboxFile(),
        [keyRaw, deviceResult, messageResult, outboxRaw] = await Promise.all([
          SecureStore.getItemAsync(DEVICE_KEY),
          api.conversationDevices(conversation.id),
          api.messages(conversation.id),
          file.exists ? file.text() : Promise.resolve(null),
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
      setPending(null);
      if (outboxRaw) {
        const stored = JSON.parse(outboxRaw) as {
          account: string;
          conversationId: string;
          request: SendMessageRequest;
        };
        if (
          stored.account === account &&
          stored.conversationId === conversation.id
        )
          setPending(stored.request);
      }
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
      await api.sendMessage(conversation.id, request);
      const file = outboxFile();
      if (file.exists) file.delete();
      setPending(null);
      setDraft("");
      await load();
    } catch (caught) {
      setPending(request);
      setError(`Waiting to retry · ${message(caught)}`);
    } finally {
      setSending(false);
    }
  };
  const sendPlaintext = async (plaintext: string) => {
    try {
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
      outboxFile().write(
        JSON.stringify({ account, conversationId: conversation.id, request }),
      );
      setPending(request);
      await transmit(request);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const pickAttachment = async () => {
    try {
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
      const uploaded = await api.uploadMedia({
          idempotencyKey: `attachment-${Date.now()}`,
          purpose: "message",
          conversationId: conversation.id,
          mimeType,
          sha256: encrypted.sha256,
          data: encodeRawBase64(encrypted.ciphertext),
        }),
        payload: AttachmentPayload = {
          type: "attachment",
          name,
          mimeType,
          sizeBytes: bytes.length,
          mediaId: uploaded.record.id,
          key: encodeRawBase64(key),
          nonce: encodeRawBase64(nonce),
        };
      bytes.fill(0);
      key.fill(0);
      await sendPlaintext(`${ATTACHMENT_PREFIX}${JSON.stringify(payload)}`);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const openAttachment = async (value: AttachmentPayload) => {
    try {
      const ciphertext = await api.downloadMedia(value.mediaId),
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
      Alert.alert(
        "Attachment verified",
        `${value.name} · ${formatNumber(Math.ceil(value.sizeBytes / 1024))} KB\nAuthenticated end-to-end on this device.`,
      );
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
    <View style={styles.screen}>
      <View style={styles.threadHeader}>
        <Pressable
          accessibilityLabel="Back to messages"
          onPress={close}
          style={styles.iconButton}
        >
          <ArrowLeft color={INK} size={20} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.name}>{conversation.title}</Text>
          {conversation.handle ? (
            <Text style={styles.handle}>@{conversation.handle}</Text>
          ) : null}
        </View>
        <View style={styles.e2ee}>
          <ShieldCheck color="#067647" size={14} />
          <Text style={styles.e2eeText}>E2EE</Text>
        </View>
      </View>
      <View style={styles.search}>
        <Search color={MUTED} size={18} />
        <TextInput
          accessibilityLabel="Search decrypted messages on this device"
          value={query}
          onChangeText={setQuery}
          placeholder="Search on this device"
          placeholderTextColor="#98A2B3"
          style={styles.searchInput}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.inlineError}>
          {error}
        </Text>
      ) : null}
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
        renderItem={({ item }) => {
          const mine = item.record.sender === account;
          return (
            <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              <View style={[styles.bubble, mine && styles.bubbleMine]}>
                {item.attachment ? (
                  <Pressable
                    accessibilityLabel={`Verify encrypted attachment ${item.attachment.name}`}
                    onPress={() => void openAttachment(item.attachment!)}
                    style={styles.attachment}
                  >
                    <Paperclip color={mine ? "#FFFFFF" : BLUE} size={18} />
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
                  <ShieldCheck color={mine ? "#DCE6FF" : "#067647"} size={11} />
                  {mine ? <CheckCheck color="#DCE6FF" size={12} /> : null}
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
          );
        }}
      />
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
          onPress={() => void pickAttachment()}
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
    </View>
  );
}

function Moments({ api, session }: { api: SocialAPI; session: Session }) {
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
    setLoading(true);
    try {
      setItems((await api.feed()).posts);
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
  const publish = () =>
    Alert.alert(
      "Publish this moment?",
      `Visibility: ${visibility}. You can delete it later.`,
      [
        { text: "Review", style: "cancel" },
        {
          text: "Publish",
          onPress: () =>
            void api
              .publishMoment({
                idempotencyKey: `moment-${Date.now()}`,
                text,
                visibility,
                media: media.map((item) => item.id),
              })
              .then(() => {
                setCompose(false);
                setText("");
                setMedia([]);
                return load();
              })
              .catch((caught) => setError(message(caught))),
        },
      ],
    );
  const react = async (item: FeedPost) => {
    await api.react(
      item.id,
      item.viewerReaction ?? "support",
      !item.viewerReaction,
      `reaction-${Date.now()}`,
    );
    await load();
  };
  const follow = async (item: FeedPost) => {
    const active = !following.has(item.author.handle);
    try {
      await api.follow(item.author.handle, active, `follow-${Date.now()}`);
      setFollowing((current) => {
        const next = new Set(current);
        if (active) next.add(item.author.handle);
        else next.delete(item.author.handle);
        return next;
      });
    } catch (caught) {
      setError(message(caught));
    }
  };
  const remove = (item: FeedPost) =>
    Alert.alert(
      "Delete this moment?",
      "This removes it from every audience. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void api
              .deleteMoment(item.id)
              .then(load)
              .catch((caught) => setError(message(caught))),
        },
      ],
    );
  const submitReport = async (item: FeedPost) => {
    try {
      const evidence = await digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          [
            "ynx-social-trust-evidence-v1",
            item.id,
            item.author.handle,
            item.text,
            ...item.media.map((value) => value.sha256),
          ].join("\n"),
        ),
        result = await api.report({
          idempotencyKey: `report-${Date.now()}`,
          targetType: "moment",
          targetId: item.id,
          category: "other",
          detail: "User requested Trust review from the moment menu.",
          evidenceHashes: [evidence],
        });
      setReportRecord(result.record);
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  const report = (item: FeedPost) =>
    Alert.alert(
      "Report this moment?",
      "Trust review receives one SHA-256 evidence fingerprint and your explicit report. No penalty is applied automatically.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: () => void submitReport(item),
        },
      ],
    );
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
          onPress={() => setCompose(true)}
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
      <Modal visible={compose} transparent animationType="slide">
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <SheetTitle title="New moment" close={() => setCompose(false)} />
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
      const value = (await api.profile()).record;
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
        next: Session = { ...session, session: result.session };
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
      await SecureStore.deleteItemAsync(ROTATION_KEY);
      onSessionChange(next);
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
    try {
      await api.deleteAccount();
      await Promise.all(
        [SESSION_KEY, DEVICE_KEY, ROTATION_KEY, PENDING_KEY].map((key) =>
          SecureStore.deleteItemAsync(key),
        ),
      );
      const file = outboxFile();
      if (file.exists) file.delete();
      api.setToken(null);
      onSessionChange(null);
    } catch (caught) {
      setError(message(caught));
    }
  };
  return (
    <Screen
      title="Me"
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
            {person?.handle ? (
              <QRCode
                value={`ynxsocial://profile/${person.handle}`}
                size={148}
                color={INK}
                backgroundColor="#FFFFFF"
              />
            ) : (
              <QrCode color={BLUE} size={60} />
            )}
          </View>
          <Text style={styles.securityNote}>
            Your profile QR contains a Social handle, never a wallet address.
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
  authTitle: { fontSize: 34, fontWeight: "700", color: INK, marginTop: 22 },
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
    height: 54,
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
  body: { flex: 1 },
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  titleRow: {
    height: 64,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 28, fontWeight: "700", color: INK },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  inlineError: {
    color: "#B42318",
    backgroundColor: "#FEF3F2",
    paddingHorizontal: 20,
    paddingVertical: 10,
    fontSize: 12,
  },
  tabBar: {
    height: 66,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  tabText: { fontSize: 10.5, color: "#7C8491" },
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
    borderRadius: 15,
    backgroundColor: "#EAF0FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: 46, height: 46, borderRadius: 15 },
  avatarText: { fontSize: 16, fontWeight: "800", color: BLUE },
  name: { fontSize: 15, fontWeight: "700", color: INK },
  handle: { fontSize: 12, color: MUTED, marginTop: 3 },
  preview: { fontSize: 13, color: MUTED, marginTop: 4 },
  time: { fontSize: 11, color: "#98A2B3" },
  e2ee: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  e2eeText: { fontSize: 10.5, color: MUTED },
  aiButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#F0F4FF",
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 8,
    height: 42,
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
    minHeight: 66,
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
    backgroundColor: SURFACE,
  },
  bubbleMine: {
    backgroundColor: BLUE,
    borderBottomLeftRadius: 17,
    borderBottomRightRadius: 5,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, color: INK },
  bubbleTextMine: { color: "#FFFFFF" },
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
  messageStateText: { fontSize: 9.5, color: MUTED },
  composerRow: {
    minHeight: 66,
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
    minHeight: 38,
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
    minWidth: 38,
    minHeight: 34,
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
    minHeight: 36,
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
