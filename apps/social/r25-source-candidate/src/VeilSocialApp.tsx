import {desktopContactStyles} from "./veil-product/desktop/DesktopContact";
import {desktopChatStyles} from "./veil-product/desktop/DesktopChats";
import {desktopMomentsStyles} from "./veil-product/desktop/DesktopMoments";
import {DesktopWelcomeBrand, desktopWelcomeStyles} from "./veil-product/desktop/DesktopWelcome";
import {DesktopRail} from "./veil-product/desktop/DesktopShell";
import {OwnDirectoryPanel} from './veil-product/OwnDirectoryPanel';
import { localEntryPresentation } from './veil-product/entryPresentation';
import {ownerLifecycleGate} from './veil-product/ownerLifecycle';
import {OwnerLifecyclePanel} from './veil-product/OwnerLifecyclePanel';
import { selectAccountEntry, type AccountEntryCase } from './veil-product/accountEntry';
import { failRootOperation, clearAccountFeedback } from './veil-product/rootFeedback';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, ExternalLink, FileText, Heart, History, Paperclip, Home, Info, LockKeyhole, MessageCircle, Plus, Search, Settings, ShieldCheck, Smartphone, Sparkles, UserRound, Users, X } from 'lucide-react-native';
import { productCopy, productLocale, productLocaleName, productNativeLocale, VEIL_PRODUCT_LOCALES, type VeilCopyKey, type VeilLocale } from './veil-product/copy';
import { useProductTheme } from './veil-product/useProductTheme';
import { veilProductNativeConsumer } from './veil-product/nativeConsumer';
import { messageStatusKey, productLimits, validProductSearchQuery, type VeilMessage, type VeilMessageSearch, type VeilProductCommand, type VeilProductErrorCode } from './veil-product/productModel';
import { veilProductController } from './veil-product/productController';
import { createLocalePreferences } from './veil-product/localePreferences';
import { localDeviceSetupGate, localAuthenticationGate, canContinueLocalAuthentication, type LocalDeviceSetupResult, type LocalAuthenticationStatus } from './veil-product/localDeviceSetup';
import {AccountLoginPanel} from './veil-product/AccountLoginPanel';
import {accountLoginGate} from './veil-product/accountLogin';
import {LocalRecoveryPanel} from './veil-product/LocalRecoveryPanel';
import {FirstDeviceChallengePanel} from './veil-product/FirstDeviceChallengePanel';
import {ConversationDrafts, type ConversationDraft} from './veil-product/conversationDrafts';
import {unavailableFeatures, type UnavailableFeatureId} from './veil-product/unavailableFeatures';

type SavedSearchPage = Readonly<{account: string; view: string; epoch: number; query: string; cursor: string | null; previous: readonly (string | null)[]; result: VeilMessageSearch}>;

type ReadHistory = Readonly<{view: string; messages: readonly VeilMessage[]; mode: 'latest' | 'anchored'; anchor: string | null; hasEarlier: boolean}>;
type ReadPanel = Readonly<{id: number; mode: 'global' | 'conversation' | 'history'; source: 'saved' | 'window'; account: string; epoch: number; room: string | null; title: string; query: string; page: SavedSearchPage | null; history: ReadHistory; trail: readonly Readonly<{history: ReadHistory; offset: number}>[]; parents: readonly ReadPanel[]; status: 'idle' | 'loading' | 'error'; error: VeilProductErrorCode | null; landLatest?: boolean; origin: Readonly<{view: string; room: string | null; offset: number; follow: boolean}>}>;

type Section = 'chats' | 'friends' | 'moments' | 'settings';
type SettingsPage = 'device-detail' | 'operation-detail' | 'appearance' | 'language' | 'profile' | 'devices' | 'operations' | 'privacy' | 'help' | 'diagnostics' | 'close-local' | 'local-ai' | 'account' | UnavailableFeatureId;
type ContactChangeAction = Extract<VeilProductCommand, {type: 'rejectContact' | 'blockContact' | 'unblockContact'}>['type'];
type AttachmentSelection = Readonly<{reference: string; name: string}>;
type ContactConfirmation = Readonly<{sequence: number; action: ContactChangeAction; target: string; account: string; view: string; epoch: number; navigation: number}>;
type Icon = typeof MessageCircle;
const navigation: ReadonlyArray<{ key: Section; icon: Icon }> = [
  { key: 'chats', icon: MessageCircle }, { key: 'moments', icon: Home },
  { key: 'friends', icon: Users }, { key: 'settings', icon: UserRound },
];
const localePreferences = createLocalePreferences({
  async read(key) {
    if (Platform.OS === 'web') return globalThis.localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async write(key, value) {
    if (Platform.OS === 'web') globalThis.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
});
const errorCopy: Record<VeilProductErrorCode, VeilCopyKey> = {
  UNAVAILABLE: 'connectionTitle', INPUT_INVALID: 'inputInvalid', LOCKED: 'locked',
  STALE_VIEW: 'staleView', REVIEW_REQUIRED: 'reviewRequired', OUTCOME_UNKNOWN: 'unknown',
  BOUNDARY_INVALID: 'reviewRequired',
};
const localSetupCopy: Record<LocalDeviceSetupResult['status'], VeilCopyKey> = {
  LOCAL_INITIALIZATION_PENDING: 'localDevicePending', RECOVERY_REQUIRED: 'localDeviceRecovery',
  AUTHENTICATION_CANCELLED: 'localDeviceCancelled', SCREEN_LOCK_REQUIRED: 'localDeviceScreenLock',
  UNAVAILABLE: 'localDeviceUnavailable', OBSERVATION_TIMEOUT: 'localDeviceTimeout',
};
const localAuthenticationCopy: Record<'en' | 'zh' | 'zh-Hant', Record<LocalAuthenticationStatus, string>> = {
  en: {
    LOCAL_SETUP_REQUIRED: 'First prepare this device using the original local setup below, then return here. No authentication attempt has started.',
    LOCAL_INSPECTION_REQUIRED: 'First use Local recovery check to inspect the original operation, then return here. No authentication attempt has started.',
    AUTHENTICATION_ELIGIBLE: 'The original local operation can be checked. This is not authentication or device approval.',
    AUTHENTICATION_PENDING: 'The original device check is still pending. Observe it without starting another prompt.',
    LOCAL_KEYS_AUTHENTICATED: 'Local key verification is complete. Device authorization is still required; chat is not unlocked.',
    AUTHENTICATION_CANCELLED: 'Screen-lock verification was cancelled. Your original local operation is retained. You can explicitly confirm again.',
    SCREEN_LOCK_REQUIRED: 'Set a system screen lock, then confirm again. Your original local operation is retained.',
    RECOVERY_REQUIRED: 'The original local operation needs recovery. No new keys or device authorization were created.',
    UNAVAILABLE: 'The original local operation or native authentication interface is unavailable.',
  },
  zh: {
    LOCAL_SETUP_REQUIRED: '请先通过下方原本机设置准备此设备，再返回这里。尚未开始认证操作。',
    LOCAL_INSPECTION_REQUIRED: '请先使用“本机恢复检查”检查原操作，再返回这里。尚未开始认证操作。',
    AUTHENTICATION_ELIGIBLE: '原本机操作可继续检查；这不是认证成功或设备批准。',
    AUTHENTICATION_PENDING: '原设备检查仍在等待。可观察原结果，不会启动另一个验证窗口。',
    LOCAL_KEYS_AUTHENTICATED: '本机密钥验证已完成。设备仍需授权，聊天尚未解锁。',
    AUTHENTICATION_CANCELLED: '屏幕锁验证已取消，原本机操作仍保留。可主动再次确认。',
    SCREEN_LOCK_REQUIRED: '请先设置系统屏幕锁，再次确认。原本机操作仍保留。',
    RECOVERY_REQUIRED: '原本机操作需要恢复处理，没有创建新密钥或授予设备权限。',
    UNAVAILABLE: '原本机操作或原生认证接口不可用。',
  },

'zh-Hant': {
    LOCAL_SETUP_REQUIRED: '請先通過下方原本機設定準備此裝置，再返回這裡。尚未開始認證操作。',
    LOCAL_INSPECTION_REQUIRED: '請先使用“本機恢復檢查”檢查原操作，再返回這裡。尚未開始認證操作。',
    AUTHENTICATION_ELIGIBLE: '原本機操作可繼續檢查；這不是認證成功或裝置批准。',
    AUTHENTICATION_PENDING: '原裝置檢查仍在等待。可觀察原結果，不會啟動另一個驗證窗口。',
    LOCAL_KEYS_AUTHENTICATED: '本機金鑰驗證已完成。裝置仍需授權，聊天尚未解鎖。',
    AUTHENTICATION_CANCELLED: '螢幕鎖驗證已取消，原本機操作仍保留。可主動再次確認。',
    SCREEN_LOCK_REQUIRED: '請先設定系統螢幕鎖，再次確認。原本機操作仍保留。',
    RECOVERY_REQUIRED: '原本機操作需要恢復處理，沒有創建新金鑰或授予裝置權限。',
    UNAVAILABLE: '原本機操作或原生認證接口不可用。',
  },
};
const ownerIsClosing = () => {
  const state = ownerLifecycleGate.getSnapshot();
  return state.selected || (!!state.result && state.result.closeStatus !== 'NOT_SELECTED');
};

/** Main's normal root. Native consumer is source-owned; no fake supplier props. */
export default function VeilSocialApp() {
  const {colors, styles, mode, preference, selectAppearance, saveFailed: appearanceSaveFailed} = useProductTheme();
  const [locale, setLocale] = useState<VeilLocale>(() => productLocale(getLocales()[0]?.languageTag));
  const [localeSaveFailed, setLocaleSaveFailed] = useState(false);
  const [section, setSectionState] = useState<Section>('chats');
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const settingsHistory = useRef<SettingsPage[]>([]);
  const [selectedDeviceDetail, setSelectedDeviceDetail] = useState<{account: string; id: string} | null>(null);
  const [selectedOperationDetail, setSelectedOperationDetail] = useState<{account: string; original: string | null; local: number | null} | null>(null);
  const [chatDetail, setChatDetail] = useState<{account: string; conversation: string} | null>(null);
  const [readPanel, setReadPanelState] = useState<ReadPanel | null>(null);
  const readPanelOriginal = useRef<ReadPanel | null>(null);
  const setReadPanel = (value: ReadPanel | null) => {readPanelOriginal.current = value; setReadPanelState(value);};
  const [readReturn, setReadReturnState] = useState<ReadPanel | null>(null);
  const readReturnOriginal = useRef<ReadPanel | null>(null);
  const setReadReturn = (value: ReadPanel | null) => {readReturnOriginal.current = value; setReadReturnState(value);};
  const readPanelId = useRef(0);
  const readPanelOffsets = useRef(new Map<number, number>());
  const closedReadPanels = useRef(new Map<string, ReadPanel>());
  const readPanelScroll = useRef<ScrollView>(null);
  const readPanelInput = useRef<TextInput>(null);
  const readPanelRestore = useRef('');
  const locatedScroll = useRef('');
  const locatedOriginal = useRef<{account:string;room:string;id:string} | null>(null);
  const readPanelEnd = useRef<number | null>(null);
  const [accessPage, setAccessPage] = useState<'welcome' | 'identity' | 'browser' | 'device' | 'recovery'>('welcome');
  const [contactDetail, setContactDetail] = useState<{account: string; id: string} | null>(null);
  const [friendPanel, setFriendPanel] = useState<'contacts' | 'requests' | 'blocked'>('contacts');
  const [requestDetail, setRequestDetail] = useState<{account: string; id: string} | null>(null);
  const [contactConfirmation, setContactConfirmation] = useState<ContactConfirmation | null>(null);
  const contactConfirmationOriginal = useRef<ContactConfirmation | null>(null);
  const contactConfirmationSequence = useRef(0);
  const [momentPage, setMomentPage] = useState<'feed' | 'compose' | 'visibility' | 'detail'>('feed');
  const [momentDetail, setMomentDetail] = useState<{account: string; id: string} | null>(null);
  const composerInput = useRef<TextInput>(null);
  const globalSearchInput = useRef<TextInput>(null);
  const searchFocusPending = useRef(false);
  const composingText = useRef(false);
  useEffect(() => {if (section !== 'friends') {setContactDetail(null); setRequestDetail(null); setFriendPanel('contacts');} if (section !== 'settings') setSettingsPage(null);}, [section]);
  const navigationRevision = useRef(0);
  const setSection = (next: Section) => { ++navigationRevision.current; setSectionState(next); };
  const activeSection = useRef(section);
  activeSection.current = section;
  const controller = veilProductController;
  const flow = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const snapshot = flow.snapshot;
  const [search, setSearch] = useState('');
  const [deviceSetupExpanded, setDeviceSetupExpanded] = useState(false);
  const [draftToolsExpanded, setDraftToolsExpanded] = useState(false);
  const [searchMessage, setSearchMessage] = useState<{account: string; conversation: string; message: string} | null>(null);
  const [savedSearch, setSavedSearch] = useState<SavedSearchPage | null>(null);
  const savedSearchRef = useRef<SavedSearchPage | null>(null);
  const searchText = useRef('');
  const searchSequence = useRef(0);
  const [searchingSaved, setSearchingSaved] = useState(false);

  const [friendSearch, setFriendSearch] = useState('');
  const drafts = useRef(new ConversationDrafts()).current;
  const draftLifecycle = useRef(new Map<string, {loadAttempted: boolean; lastAttemptRevision: number | null}>());
  const draftLifecycleKey = (account: string, room: string, generation: number) => JSON.stringify([account, room, generation]);
  const [, updateDrafts] = useState(0);
  const [identifier, setIdentifier] = useState('');
const [momentBody, setMomentBody] = useState('');
const [keyboardVisible, setKeyboardVisible] = useState(false);
const settingsScroll = useRef<ScrollView>(null);
const welcomeScroll = useRef<ScrollView>(null);
const languageAnchorPending = useRef(false);
useEffect(() => {
  if (section === 'settings') settingsScroll.current?.scrollTo({ y: 0, animated: false });
  if (section === 'chats') welcomeScroll.current?.scrollTo({ y: 0, animated: false });
}, [section]);
useEffect(() => {
  const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
  const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
  return () => { shown.remove(); hidden.remove(); };
}, []);

  const [audienceId, setAudienceId] = useState<string | null>(null);
  const [attachment, setAttachmentState] = useState<AttachmentSelection | null>(null);
  const attachmentOriginal = useRef<AttachmentSelection | null>(null);
  const attachmentRevision = useRef(0);
  const setAttachment = (next: React.SetStateAction<AttachmentSelection | null>) => {
    const value = typeof next === 'function' ? next(attachmentOriginal.current) : next;
    if (value === attachmentOriginal.current) return;
    attachmentOriginal.current = value; ++attachmentRevision.current;
    setAttachmentState(value);
  };
  const renderedAttachmentRevision = attachmentRevision.current;
  const [feedback, setFeedback] = useState<VeilCopyKey | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<'aborted' | 'new-draft' | null>(null);
  const busy = flow.busy;
  const [dialog, setDialogState] = useState(false);
  const dialogSelection = useRef({revision: 0, open: false});
  const setDialog = (open: boolean) => {
    dialogSelection.current = {revision: dialogSelection.current.revision + 1, open};
    setDialogState(open);
  };
  const renderedDialog = dialogSelection.current.revision;
  const dismissDialog = () => {
    if (!dialogSelection.current.open || dialogSelection.current.revision !== renderedDialog) return false;
    setDialog(false); return true;
  };
  const [mobileConversation, setMobileConversation] = useState(false);
  const conversationScroll = useRef<ScrollView>(null);
  const unreadViewport = useRef<{account: string | null; conversation: string | null; height: number; offset: number;
    row: {message: string; bottom: number} | null}>({account: null, conversation: null, height: 0, offset: 0, row: null});
  const unreadAttempt = useRef<string | null>(null);
  const followingLatest = useRef<{account: string | null; conversation: string | null; follow: boolean}>({account: null, conversation: null, follow: true});
  const [historyAway, setHistoryAway] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (AppState.currentState !== 'active') return false;
      if (contactConfirmation) {contactConfirmationOriginal.current = null; setContactConfirmation(null); return true;}
      if (dialog) return dismissDialog();
      if (settingsPage) {backSettingsPage(); return true;}
      if (requestDetail) {++navigationRevision.current; setRequestDetail(null); return true;}
      if (contactDetail) {++navigationRevision.current; setContactDetail(null); return true;}
      if (section === 'friends' && friendPanel !== 'contacts') {++navigationRevision.current; setFriendPanel('contacts'); return true;}
      if (section === 'moments' && momentPage !== 'feed') {++navigationRevision.current; setMomentPage(momentPage === 'visibility' ? 'compose' : 'feed'); return true;}
      if (section === 'chats' && controller.getSnapshot().snapshot?.kind !== 'AUTHORIZED' && accessPage !== 'welcome' && !ownerIsClosing()) {++navigationRevision.current; setAccessPage(accessPage === 'device' ? 'identity' : 'welcome'); return true;}
      if (readPanel) {closeReadPanel(); return true;}
      if (readReturn) {returnToReadPanel(); return true;}
      if (chatDetail) {closeChatDetails(); return true;}
      if (mobileConversation) {++navigationRevision.current; setMobileConversation(false); return true;}
      if (section !== 'chats') {setSection('chats'); return true;}
      return false;
    });
    return () => back.remove();
  }, [dialog, renderedDialog, mobileConversation, section, settingsPage, contactDetail, requestDetail, friendPanel, momentPage, contactConfirmation, accessPage, chatDetail, snapshot, flow.epoch, readPanel, readReturn]);
  const [selectedEntryIntent, setEntryIntent] = useState<AccountEntryCase>('newIdentityFirstDevice');
  const [localSetupFeedback, setLocalSetupFeedback] = useState<VeilCopyKey | null>(null);
  const localAuthentication = useSyncExternalStore(localAuthenticationGate.subscribe, localAuthenticationGate.getSnapshot, localAuthenticationGate.getSnapshot);
  const initialSetupBusy = useSyncExternalStore(localDeviceSetupGate.subscribe, localDeviceSetupGate.isPending, localDeviceSetupGate.isPending);
  const localLifecycle = useSyncExternalStore(ownerLifecycleGate.subscribe, ownerLifecycleGate.getSnapshot, ownerLifecycleGate.getSnapshot);
  const localClosing = localLifecycle.selected || (!!localLifecycle.result && localLifecycle.result.closeStatus !== 'NOT_SELECTED');
  const localSetupBusy = initialSetupBusy || localAuthentication.pending;
  const accountLoginAttempt = useSyncExternalStore(accountLoginGate.subscribe, accountLoginGate.getSnapshot, accountLoginGate.getSnapshot);
  const accountLoginBusy = accountLoginAttempt.pending;
  const entryIntent = accountLoginAttempt.intent ?? selectedEntryIntent;
  const activeEntryIntent = useRef(entryIntent);
  activeEntryIntent.current = entryIntent;
  const entryObserved = (accountLoginAttempt.originalState === 'ABSENT' || accountLoginAttempt.originalState === 'RETAINED') && accountLoginGate.canSelectIntent(entryIntent);
  const entry = selectAccountEntry(entryIntent);
  const localEntry = localEntryPresentation(snapshot?.kind === 'UNAVAILABLE' ? snapshot.localOwner : undefined, entryIntent);
  const entryCapabilities = veilProductNativeConsumer.readAccountEntryCapabilities();
  const accountBindingInput = veilProductNativeConsumer.readAccountBindingInput();
  const alive = useRef(true);
  const localAuthenticationReadback = useRef<(() => void) | null>(null);
  const localeRevision = useRef(0);
  const draftScope = useRef<string | null>(null);
  const uncertainReadEpoch = useRef<number | null>(null);
  const identifierRevision = useRef(0);
  const momentRevision = useRef(0);
  const entryDraftAccount = useRef<string | null>(null);
  const identifierOriginal = useRef('');
  const momentOriginal = useRef<{body: string; audienceId: string | null}>({body: '', audienceId: null});
  const ready = snapshot?.kind === 'AUTHORIZED' && !localClosing ? snapshot : null;
  useEffect(() => {setSettingsPage(null); setContactDetail(null); setRequestDetail(null); setFriendPanel('contacts'); setMomentPage('feed'); setMomentDetail(null); setChatDetail(null);}, [ready?.accountViewRef, localClosing]);
  useEffect(() => {
    if (ready || localClosing || !accountLoginAttempt.intent) return;
    setAccessPage(accountLoginAttempt.status === 'ACCOUNT_OBSERVED' ? 'device' : 'browser');
  }, [accountLoginAttempt.intent, accountLoginAttempt.status, ready?.accountViewRef, localClosing]);
  const deviceObservation = snapshot?.kind === 'UNAVAILABLE' && !localClosing ? snapshot.deviceObservation : undefined;
  const sessionObservation = snapshot?.kind === 'UNAVAILABLE' && !localClosing ? snapshot.sessionObservation : undefined;
  const conversationId = ready?.activeConversationId ?? null;
  const conversation = ready?.conversations.find(item => item.id === conversationId);
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const t = (key: VeilCopyKey) => productCopy(locale, key);

  // A rejected mutation hides plaintext, but its LOCKED error does not settle
  // the retained original or discard its editor. A normal explicit lock read
  // and local close keep their existing clearing behavior.
  const lockedOriginalPending = flow.error === 'LOCKED' && flow.pending.some(item =>
    item.accountViewRef === draftScope.current && item.resolution === 'unresolved');
  const uncertainRead = !localClosing && snapshot?.kind === 'LOCKED' &&
    (flow.error === 'OUTCOME_UNKNOWN' || flow.error === 'STALE_VIEW' || lockedOriginalPending || (flow.busy && uncertainReadEpoch.current === flow.epoch));
  const currentScope = localClosing ? null : snapshot?.kind === 'AUTHORIZED' || snapshot?.kind === 'RECOVERY_REQUIRED' ? snapshot.accountViewRef : uncertainRead ? draftScope.current : null;
  const entryDraftReadable = !!ready && entryDraftAccount.current === ready.accountViewRef;
  useEffect(() => {
    if (!localClosing && snapshot?.kind === 'LOCKED' && (flow.error === 'OUTCOME_UNKNOWN' || flow.error === 'STALE_VIEW' || lockedOriginalPending)) uncertainReadEpoch.current = flow.epoch;
    else if (localClosing || !flow.busy) uncertainReadEpoch.current = null;
  }, [snapshot?.kind, flow.error, flow.epoch, flow.busy, localClosing, lockedOriginalPending]);
  useEffect(() => {
    followingLatest.current = {account: ready?.accountViewRef ?? null, conversation: conversationId, follow: true};
    setHistoryAway(false);
  }, [ready?.accountViewRef, conversationId]);
  const draft = drafts.read(ready?.accountViewRef ?? null, conversationId);
  const body = draft.body;
  const replyingMessage = ready?.messages.find(item => item.conversationId === conversationId && item.id === draft.replyToMessageId);
  const replyTo = draft.replyToMessageId;
  const replyUnavailable = replyTo !== null && replyingMessage?.submission !== 'confirmed';
  const query = search.trim().toLocaleLowerCase();
  const matchingConversations = ready?.conversations.filter(item => (item.title + ' ' + item.preview).toLocaleLowerCase().includes(query)) ?? [];
  const matchingMessages = query ? ready?.messages.filter(item => ready.conversations.some(conversation => conversation.id === item.conversationId) && item.body.toLocaleLowerCase().includes(query)) ?? [] : [];
  const selectedSearchMessage = searchMessage?.account === ready?.accountViewRef && searchMessage?.conversation === conversationId &&
    ready?.messages.some(item => item.id === searchMessage.message && item.conversationId === conversationId) ? searchMessage.message : null;
  useEffect(() => {
    if (ready && searchMessage?.account === ready.accountViewRef && searchMessage.conversation === conversationId &&
      !ready.messages.some(item => item.id === searchMessage.message && item.conversationId === conversationId)) setSearchMessage(null);
  }, [ready?.accountViewRef, ready?.messages, conversationId, searchMessage]);
  const currentHistory = (allowCoveredGeometry = false) => {
    const current = controller.getSnapshot().snapshot;
    return (allowCoveredGeometry || (chatDetail === null && readPanel === null)) && !!ready && !!conversationId && current?.kind === 'AUTHORIZED' && current.accountViewRef === ready.accountViewRef &&
      current.viewRevision === ready.viewRevision && current.activeConversationId === conversationId &&
      followingLatest.current.account === ready.accountViewRef && followingLatest.current.conversation === conversationId;
  };
  const renderedNavigation = navigationRevision.current;
  const renderedIdentifier = identifierRevision.current;
  const renderedMoment = momentRevision.current;
  const currentMomentView = () => {
    const current = controller.getSnapshot();
    if (!ready || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation ||
      activeSection.current !== 'moments' || dialogSelection.current.open || current.snapshot?.kind !== 'AUTHORIZED' ||
      current.snapshot.accountViewRef !== ready.accountViewRef || current.snapshot.viewRevision !== ready.viewRevision ||
      entryDraftAccount.current !== current.snapshot.accountViewRef) return null;
    return current.snapshot;
  };
  const editMomentBody = (value: string) => {
    if (!currentMomentView()) return;
    ++momentRevision.current;
    momentOriginal.current = {...momentOriginal.current, body: value};
    setMomentBody(value);
  };
  const selectMomentAudience = (id: string) => {
    const current = currentMomentView();
    if (!current?.audiences.some(item => item.id === id)) return;
    if (momentOriginal.current.audienceId !== id) ++momentRevision.current;
    momentOriginal.current = {...momentOriginal.current, audienceId: id};
    setAudienceId(id);
  };
  const currentConversationView = (allowCoveredGeometry = false) => {
    const current = controller.getSnapshot();
    if (!ready || !conversationId || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() ||
      dialog || (!allowCoveredGeometry && (chatDetail !== null || readPanel !== null)) || activeSection.current !== 'chats' || (!wide && !mobileConversation) || selectedSearchMessage ||
      navigationRevision.current !== renderedNavigation || current.epoch !== flow.epoch || !current.active ||
      current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef ||
      current.snapshot.viewRevision !== ready.viewRevision || current.snapshot.activeConversationId !== conversationId) return false;
    if (unreadViewport.current.account !== ready.accountViewRef || unreadViewport.current.conversation !== conversationId)
      unreadViewport.current = {account: ready.accountViewRef, conversation: conversationId, height: 0, offset: 0, row: null};
    return true;
  };
  const currentUnreadView = () => ready?.messageWindow.mode === 'latest' && currentConversationView();
  const editDraft = (patch: Partial<Pick<ConversationDraft, 'body' | 'replyToMessageId'>>) => {
    if (readPanel || chatDetail) return;
    const state = controller.getSnapshot();
    const current = state.snapshot;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !state.active || state.epoch !== flow.epoch ||
      navigationRevision.current !== renderedNavigation || activeSection.current !== 'chats' || (!wide && !mobileConversation) ||
      !ready || !conversationId || current?.kind !== 'AUTHORIZED' || current.accountViewRef !== ready.accountViewRef || current.activeConversationId !== conversationId) return;
    // Reply controls belong to the editor revision that rendered them. A late
    // selection/cancel must not replace the user's newer reply or edited draft.
    if (patch.replyToMessageId !== undefined && drafts.read(ready.accountViewRef, conversationId).revision !== draft.revision) return;
    if (patch.replyToMessageId && !current.messages.some(item => item.id === patch.replyToMessageId && item.conversationId === conversationId && item.submission === 'confirmed')) return;
    if (drafts.edit(ready.accountViewRef, conversationId, draft.generation, patch)) {
      updateDrafts(value => value + 1);
      setFeedback(value => value === 'draftStored' || value === 'draftRestored' || value === 'draftNewerEditor' || value === 'draftSavedEarlier' ? null : value);
    }
  };
  const removeSelectedAttachment = () => {
    const state = controller.getSnapshot(); const view = state.snapshot;
    const selected = attachmentOriginal.current;
    if (!currentConversationView() || state.busy || view?.kind !== 'AUTHORIZED' || !selected ||
      attachmentRevision.current !== renderedAttachmentRevision) return;
    if (state.pending.some(item => item.accountViewRef === view.accountViewRef &&
      item.command.type === 'sendAttachment' && item.command.selectionReference === selected.reference &&
      (item.resolution === 'unresolved' || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')))) return;
    // Only the not-yet-submitted UI choice is removed. Native retains its own
    // selection; no cancellation, deletion or outcome is inferred for an outbox.
    setAttachment(null);
  };
  const editIdentifier = (value: string) => {
    const current = controller.getSnapshot();
    if (!ready || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation || !dialogSelection.current.open ||
      dialogSelection.current.revision !== renderedDialog || current.snapshot?.kind !== 'AUTHORIZED' ||
      current.snapshot.accountViewRef !== ready.accountViewRef || current.snapshot.viewRevision !== ready.viewRevision ||
      entryDraftAccount.current !== current.snapshot.accountViewRef) return;
    ++identifierRevision.current; identifierOriginal.current = value; setIdentifier(value);
  };
  const clearIdentifierDraft = (account: string, revision: number | null, value: string) => {
    if (entryDraftAccount.current !== account || identifierRevision.current !== revision || identifierOriginal.current !== value) return;
    ++identifierRevision.current; identifierOriginal.current = ''; setIdentifier('');
  };
  const clearMomentDraft = (account: string, revision: number | null, value: string) => {
    if (entryDraftAccount.current !== account || momentRevision.current !== revision || momentOriginal.current.body !== value) return;
    ++momentRevision.current; momentOriginal.current = {...momentOriginal.current, body: ''}; setMomentBody('');
  };
  const confirmDraft = (account: string, conversation: string, revision: number | null) => {
    const key = draftLifecycleKey(account, conversation, drafts.read(account, conversation).generation);
    draftLifecycle.current.delete(key);
    const forgot = drafts.forgetProtectedRevision(account, conversation);
    if (drafts.confirm(account, conversation, revision) || forgot) updateDrafts(value => value + 1);
  };
  useEffect(() => {
    // A refresh/background read hides plaintext without losing the editor.
    // A real account change or explicit lock/close discards the old account.
    if ((snapshot?.kind === 'LOCKED' && !uncertainRead) || localClosing) {
      if (drafts.selectAccount(null)) {draftLifecycle.current.clear(); updateDrafts(value => value + 1);}
    } else if (currentScope && drafts.selectAccount(currentScope)) {draftLifecycle.current.clear(); updateDrafts(value => value + 1);}
  }, [currentScope, snapshot?.kind, localClosing, uncertainRead]);
  useEffect(() => {
    // Missing current data hides private editors without deleting same-account
    // text. An explicit lock/close or an actual account change keeps the prior
    // clearing policy. This in-memory scope supplies no account authority.
    const clear = localClosing || (snapshot?.kind === 'LOCKED' && !uncertainRead);
    if (clear || (currentScope && currentScope !== entryDraftAccount.current)) {
      entryDraftAccount.current = clear ? null : currentScope;
      identifierOriginal.current = ''; momentOriginal.current = {body: '', audienceId: null};
      ++identifierRevision.current; ++momentRevision.current;
      setIdentifier(''); setMomentBody(''); setAudienceId(null);
    }
  }, [currentScope, snapshot?.kind, localClosing, uncertainRead]);
  useEffect(() => {setSelectedDeviceDetail(null); setSelectedOperationDetail(null); settingsHistory.current = [];}, [currentScope, localClosing]);
  const pendingOriginals = flow.pending.filter(item => item.accountViewRef === currentScope && (item.resolution === 'unresolved' || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')));
  useEffect(() => {
    const nextScope = currentScope;
    clearAccountFeedback(draftScope.current, nextScope, setFeedback);
    if (nextScope !== draftScope.current) {
      setReviewFeedback(null);
      setDialog(false);
      void veilProductNativeConsumer.advanceAccountBindingContext().catch(() => {});
      setAttachment(null);
      searchText.current = ''; ++searchSequence.current; savedSearchRef.current = null; setSavedSearch(null); setSearchingSaved(false);
      setSearch(''); setSearchMessage(null); setFriendSearch('');
    }
    draftScope.current = nextScope;
  }, [currentScope]);
  useEffect(() => { setAttachment(null); }, [conversationId, ready?.viewRevision]);
  const refresh = async () => {
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing()) return;
    const lease = controller.beginRead();
    if (!lease) return;
    try {
      const raw = await veilProductNativeConsumer.readSnapshot(lease.context);
      controller.completeRead(lease, raw);
    } catch { controller.fail(lease); }
    finally { controller.release(lease); }
  };
  useEffect(() => {
    alive.current = true;
    const preferenceVersion = localeRevision.current;
    void localePreferences.read().then(value => {
      if (value && alive.current && localeRevision.current === preferenceVersion) setLocale(value);
    }).catch(() => {});
    controller.activate();
    const removeNativeInvalidation = veilProductNativeConsumer.subscribeInvalidation(() => controller.invalidate());
    const appState = AppState.addEventListener('change', state => {
      void veilProductNativeConsumer.advanceAccountBindingContext().catch(() => {});
      if (state === 'active') controller.activate(); else controller.deactivate();
    });
    return () => { alive.current = false; localAuthenticationReadback.current?.(); localAuthenticationReadback.current = null; ++localeRevision.current; removeNativeInvalidation?.(); appState.remove(); controller.deactivate(); void veilProductNativeConsumer.advanceAccountBindingContext().catch(() => {}); };
  }, []);
  useEffect(() => { if (alive.current && flow.active && !flow.busy && flow.needsRead) void refresh(); }, [flow.active, flow.busy, flow.needsRead, flow.epoch]);
  useEffect(() => {
    if (!flow.active || !ready || localClosing) return;
    const account = ready.accountViewRef;
    // Inventory sampling cannot fetch incoming messages. The normal snapshot
    // call advances the existing native inbox once; it never resubmits a command.
    const timer = setInterval(() => {
      const current = controller.getSnapshot();
      if (!alive.current || AppState.currentState !== 'active' || !current.active || current.busy || current.needsRead ||
        current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== account) return;
      if (current.pending.some(item => item.accountViewRef === account &&
        ((item.resolution === 'unresolved' && item.disposition === 'unknown') || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')))) return;
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [flow.active, ready?.accountViewRef, localClosing]);
  const changeLocale = (value: VeilLocale) => {
    const current = ++localeRevision.current;
    setLocale(value); setLocaleSaveFailed(false);
    void localePreferences.write(value).catch(() => {
      if (alive.current && localeRevision.current === current) setLocaleSaveFailed(true);
    });
  };
  const currentLocalEntry = (allowPendingRead = false) => {
    const current = controller.getSnapshot();
    if (Platform.OS !== 'android' || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() ||
      !current.active || (!allowPendingRead && current.busy) || current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation ||
      current.snapshot?.kind !== 'UNAVAILABLE' || activeEntryIntent.current !== entryIntent ||
      (accountLoginGate.getSnapshot().intent ?? activeEntryIntent.current) !== entryIntent ||
      !accountLoginGate.canSelectIntent(entryIntent)) return null;
    return current.snapshot;
  };
  const prepareLocalDevice = async () => {
    const current = currentLocalEntry();
    if (!current || entryIntent !== 'newIdentityFirstDevice' || localDeviceSetupGate.isPending() ||
      localAuthenticationGate.getSnapshot().pending || accountLoginGate.isPending() ||
      !localEntryPresentation(current.localOwner, entryIntent).canPrepare) return;
    setLocalSetupFeedback(null);
    const result = await localDeviceSetupGate.observe(productNativeLocale(locale));
    // Keep the original native operation alive; only its originating view may
    // display this observation. It never grants account or device authority.
    if (currentLocalEntry()) {
      setLocalSetupFeedback(localSetupCopy[result.status]);
      void refresh();
    }
  };
  const inspectLocalDevice = () => {
    const current = currentLocalEntry();
    const authentication = localAuthenticationGate.getSnapshot();
    if (!current || localDeviceSetupGate.isPending() || accountLoginGate.isPending() || authentication.pending ||
      !localEntryPresentation(current.localOwner, entryIntent).showOriginal ||
      (authentication.result && !canContinueLocalAuthentication(authentication.result.status))) return;
    // Observe the same native call even if its JS observation times out. Only
    // its actual authenticated reply may refresh the originating view.
    localAuthenticationReadback.current?.();
    const remove = localAuthenticationGate.subscribe(() => {
      const observed = localAuthenticationGate.getSnapshot();
      if (observed.pending) return;
      remove();
      if (localAuthenticationReadback.current === remove) localAuthenticationReadback.current = null;
      // A previous read may still own admission. Invalidate its publication,
      // then the normal needsRead effect reads again after that lease releases.
      if (observed.result?.status === 'LOCAL_KEYS_AUTHENTICATED' && currentLocalEntry(true)) controller.invalidate();
    });
    localAuthenticationReadback.current = remove;
    void localAuthenticationGate.inspect(productNativeLocale(locale));
  };
  const blocked = (action: VeilProductCommand['type']) => !controller.canExecute(action);
  const run = async (command: VeilProductCommand, restoreLoadedDraft = true) => {
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || navigationRevision.current !== renderedNavigation) return;
    const state = controller.getSnapshot();
    if (!state.active || state.epoch !== flow.epoch) return;
    if ((chatDetail || readPanel) && ['sendMessage', 'sendAttachment', 'selectAttachment', 'openAttachment', 'loadDraft', 'saveDraft', 'markConversationRead', 'loadEarlierMessages', 'jumpToLatest'].includes(command.type)) return;
    const current = state.snapshot;
    if ((current?.kind !== 'AUTHORIZED' && current?.kind !== 'RECOVERY_REQUIRED') || current.accountViewRef !== currentScope) return;
    if (command.type === 'requestContact' && (!dialogSelection.current.open ||
      dialogSelection.current.revision !== renderedDialog || identifierRevision.current !== renderedIdentifier ||
      entryDraftAccount.current !== current.accountViewRef || identifierOriginal.current !== command.identifier)) return;
    if (command.type === 'publishMoment' && (!currentMomentView() || momentPage !== 'compose' ||
      momentRevision.current !== renderedMoment || momentOriginal.current.body !== command.body ||
      momentOriginal.current.audienceId !== command.audienceId)) return;
    if (command.type === 'sendAttachment' && (attachmentRevision.current !== renderedAttachmentRevision ||
      attachmentOriginal.current?.reference !== command.selectionReference)) return;
    if (command.type === 'sendMessage' || command.type === 'sendAttachment' || command.type === 'saveDraft') {
      const original = drafts.read(current.accountViewRef, command.conversationId);
      if (original.generation !== draft.generation || original.revision !== draft.revision || original.body !== (command.type === 'sendMessage' || command.type === 'saveDraft' ? command.body : command.caption)) return;
      if (command.type === 'saveDraft' && command.replyToMessageId !== original.replyToMessageId) return;
      if (command.type === 'saveDraft' && command.draftRevision !== drafts.protectedRevision(current.accountViewRef, command.conversationId)) return;
      // The native attachment command has no reply field. Never drop the
      // selected reply while converting this editor into an attachment send.
      if (command.type === 'sendAttachment' && original.replyToMessageId !== null) return;
      if (command.type === 'sendMessage' && (command.replyToMessageId !== original.replyToMessageId ||
        (command.replyToMessageId !== null && (current.kind !== 'AUTHORIZED' || !current.messages.some(item => item.id === command.replyToMessageId && item.conversationId === command.conversationId && item.submission === 'confirmed'))))) return;
    }
    const draftRevision = command.type === 'sendMessage' || command.type === 'sendAttachment' || command.type === 'loadDraft' || command.type === 'saveDraft' ? drafts.read(ready?.accountViewRef ?? null, command.conversationId).revision : command.type === 'requestContact' ? identifierRevision.current : command.type === 'publishMoment' ? momentRevision.current : null;
    const editorGeneration = command.type === 'loadDraft' || command.type === 'saveDraft' ? drafts.read(current.accountViewRef, command.conversationId).generation : 0;
    const lease = controller.beginExecute(command, draftRevision);
    if (!lease) return;
    setFeedback(null);
    setReviewFeedback(null);
    try {
      const raw = await veilProductNativeConsumer.execute(command, lease.context);
      const result = controller.completeExecute(lease, raw);
      if (!alive.current || !result) return;
      if (result.kind === 'error') {
        if ((command.type === 'saveDraft' || command.type === 'loadDraft') && lease.context.accountViewRef)
          drafts.forgetProtectedRevision(lease.context.accountViewRef, command.conversationId, editorGeneration);
        setFeedback(errorCopy[result.code]);
      } else if (result.kind === 'pending') {
        setFeedback(result.disposition);
        // Keep the local draft. No optimistic message row or delivery receipt.
      } else if (result.kind === 'draft') {
        if (!lease.context.accountViewRef || (command.type !== 'loadDraft' && command.type !== 'saveDraft')) return;
        if (!drafts.observeProtectedRevision(lease.context.accountViewRef, result.conversationId, editorGeneration, result.draftRevision)) return;
        const lifecycle = draftLifecycle.current.get(draftLifecycleKey(lease.context.accountViewRef, result.conversationId, editorGeneration));
        if (command.type === 'saveDraft' && lifecycle) lifecycle.lastAttemptRevision = lease.draftRevision;
        if (command.type === 'loadDraft' && restoreLoadedDraft && drafts.restore(lease.context.accountViewRef, result.conversationId,
          lease.draftRevision, editorGeneration, result.body, result.replyToMessageId)) {
          updateDrafts(value => value + 1);
          setFeedback('draftRestored');
        } else {
          const editor = drafts.read(lease.context.accountViewRef, result.conversationId);
          const exactSavedEditor = editor.generation === editorGeneration && editor.revision === lease.draftRevision &&
            editor.body === result.body && editor.replyToMessageId === result.replyToMessageId;
          setFeedback(command.type === 'saveDraft' ? (exactSavedEditor ? 'draftStored' : 'draftSavedEarlier') : 'draftNewerEditor');
        }
        const observedEditor = drafts.read(lease.context.accountViewRef, result.conversationId);
        if (command.type === 'loadDraft' && lifecycle && observedEditor.generation === editorGeneration &&
          observedEditor.body === result.body && observedEditor.replyToMessageId === result.replyToMessageId) lifecycle.lastAttemptRevision = observedEditor.revision;
      } else if (result.kind === 'attachmentSelection') {
        setAttachment({ reference: result.selectionReference, name: result.displayName });
      } else if (result.kind === 'recovery') {
        setFeedback('recoveryNeeded');
      } else if (result.kind === 'originalReview') {
        setFeedback(result.eventObservation === 'present' ? 'eventPresentPending' : result.resolution === 'unresolved' ? 'unknown' : result.resolution === 'confirmed' ? 'confirmed' : null);
        if (result.resolution === 'aborted') setReviewFeedback(result.nextStep === 'new-draft' ? 'new-draft' : 'aborted');
        const original = pendingOriginals.find(item => item.originalOperationRef === result.originalOperationRef);
        if (original && result.resolution === 'confirmed') {
          if (original.command.type === 'sendMessage' || original.command.type === 'sendAttachment') confirmDraft(original.accountViewRef, original.command.conversationId, original.draftRevision);
          if (original.command.type === 'sendAttachment') {
            const selection = original.command.selectionReference;
            setAttachment(value => value?.reference === selection ? null : value);
          }
          if (original.command.type === 'requestContact' && dialogSelection.current.revision === renderedDialog)
            clearIdentifierDraft(original.accountViewRef, original.draftRevision, original.command.identifier);
          if (original.command.type === 'publishMoment') clearMomentDraft(original.accountViewRef, original.draftRevision, original.command.body);
        }
      } else {
        if (result.completion === 'confirmed') {
          setFeedback('confirmed');
          if (command.type === 'sendMessage') {
            confirmDraft(lease.context.accountViewRef!, command.conversationId, draftRevision);
          } else if (command.type === 'sendAttachment') {
            confirmDraft(lease.context.accountViewRef!, command.conversationId, draftRevision);
            setAttachment(value => value?.reference === command.selectionReference ? null : value);
          }
          else if (command.type === 'requestContact' && dialogSelection.current.open &&
            dialogSelection.current.revision === renderedDialog && identifierRevision.current === draftRevision) {
            clearIdentifierDraft(lease.context.accountViewRef!, draftRevision, command.identifier); setDialog(false);
          }
          else if (command.type === 'publishMoment') clearMomentDraft(lease.context.accountViewRef!, draftRevision, command.body);
        }
      }
      return result;
    } catch {
      if ((command.type === 'saveDraft' || command.type === 'loadDraft') && lease.context.accountViewRef)
        drafts.forgetProtectedRevision(lease.context.accountViewRef, command.conversationId, editorGeneration);
      failRootOperation(controller, lease, () => alive.current, setFeedback);
    } finally {
      controller.release(lease);
    }
  };
  const sendFromComposer = () => {
    const current = controller.getSnapshot();
    if (!ready || !conversationId || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() ||
      !current.active || current.epoch !== flow.epoch || current.snapshot?.kind !== 'AUTHORIZED' ||
      current.snapshot.accountViewRef !== ready.accountViewRef || current.snapshot.viewRevision !== ready.viewRevision ||
      activeSection.current !== 'chats' || chatDetail !== null || readPanel !== null || navigationRevision.current !== renderedNavigation ||
      attachmentOriginal.current !== attachment || attachmentRevision.current !== renderedAttachmentRevision) return false;
    if (attachment) {
      if (blocked('sendAttachment') || replyTo !== null) return false;
      void run({type: 'sendAttachment', viewRevision: ready.viewRevision, conversationId, selectionReference: attachment.reference, caption: body});
    } else {
      if (blocked('sendMessage') || !body.trim() || replyUnavailable) return false;
      void run({type: 'sendMessage', viewRevision: ready.viewRevision, conversationId, body, replyToMessageId: replyTo});
    }
    return true;
  };
  const composerSendDisabled = !conversationId || (attachment
    ? blocked('sendAttachment') || replyTo !== null
    : blocked('sendMessage') || !body.trim() || replyUnavailable);
  useEffect(() => {
    if (Platform.OS !== 'web' || !wide || typeof document === 'undefined' || !ready) return;
    const onCompositionStart = () => {if ((composerInput.current?.isFocused() || readPanelInput.current?.isFocused())) composingText.current = true;};
    const onCompositionEnd = () => {composingText.current = false;};
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || composingText.current || event.keyCode === 229) return;
      const current = controller.getSnapshot();
      if (!alive.current || ownerIsClosing() || !current.active || current.epoch !== flow.epoch ||
        current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef) return;
      if (event.key === 'Escape' && readPanel) {closeReadPanel(); event.preventDefault(); return;}
      if (event.key === 'Escape' && chatDetail) {closeChatDetails(); event.preventDefault(); return;}
      if (event.key === 'Escape' && contactConfirmation) {contactConfirmationOriginal.current = null; setContactConfirmation(null); event.preventDefault(); return;}
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchFocusPending.current = true;
        if (readPanel) {closeReadPanel(); globalSearchInput.current?.focus(); searchFocusPending.current = false; return;}
        if (chatDetail) {++navigationRevision.current; setChatDetail(null); return;}
        if (activeSection.current !== 'chats') {setSection('chats'); setSettingsPage(null); setContactDetail(null); setRequestDetail(null);}
        else {globalSearchInput.current?.focus(); searchFocusPending.current = false;}
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && readPanelInput.current?.isFocused() && submitReadPanel()) {event.preventDefault(); return;}
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey &&
        composerInput.current?.isFocused() && sendFromComposer()) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('compositionstart', onCompositionStart);
    document.addEventListener('compositionend', onCompositionEnd);
    return () => {document.removeEventListener('keydown', onKeyDown); document.removeEventListener('compositionstart', onCompositionStart); document.removeEventListener('compositionend', onCompositionEnd);};
  }, [wide, section, ready, body, replyTo, replyUnavailable, flow.epoch, busy, renderedNavigation, contactConfirmation, chatDetail, attachment, renderedAttachmentRevision, readPanel, readReturn]);
  useEffect(() => {
    if (Platform.OS === 'web' && wide && section === 'chats' && ready && !chatDetail && !readPanel && searchFocusPending.current) {
      globalSearchInput.current?.focus(); searchFocusPending.current = false;
    }
  }, [wide, section, ready, chatDetail, readPanel]);
  useEffect(() => {composingText.current = false;}, [ready?.accountViewRef, flow.epoch, section]);
  const protectedDraftRevision = drafts.protectedRevision(ready?.accountViewRef ?? null, conversationId);
  useEffect(() => {
    if (!ready || !conversationId || busy || !currentConversationView()) return;
    const actual = drafts.read(ready.accountViewRef, conversationId);
    if (actual.generation !== draft.generation || actual.revision !== draft.revision) return;
    const key = draftLifecycleKey(ready.accountViewRef, conversationId, draft.generation);
    let lifecycle = draftLifecycle.current.get(key);
    if (!lifecycle) {lifecycle = {loadAttempted: false, lastAttemptRevision: null}; draftLifecycle.current.set(key, lifecycle);}
    if (protectedDraftRevision === null) {
      if (lifecycle.loadAttempted || !controller.canExecute('loadDraft')) return;
      lifecycle.loadAttempted = true;
      // Existing edits need the real CAS metadata, not replacement by older
      // protected text. Edits made during the read are fenced by the lease.
      void run({type: 'loadDraft', viewRevision: ready.viewRevision, conversationId}, draft.revision === 0);
      return;
    }
    if (draft.revision === 0 || lifecycle.lastAttemptRevision === draft.revision || replyUnavailable || !controller.canExecute('saveDraft')) return;
    const original = lifecycle;
    const timer = setTimeout(() => {
      const current = drafts.read(ready.accountViewRef, conversationId);
      if (!currentConversationView() || controller.getSnapshot().busy || !controller.canExecute('saveDraft') ||
        draftLifecycle.current.get(key) !== original || original.lastAttemptRevision === draft.revision ||
        current.generation !== draft.generation || current.revision !== draft.revision ||
        drafts.protectedRevision(ready.accountViewRef, conversationId) !== protectedDraftRevision) return;
      // Once per exact edit. An uncertain/refused write never becomes a timer
      // retry; only the normal explicit read can re-establish protected CAS.
      original.lastAttemptRevision = draft.revision;
      void run({type: 'saveDraft', viewRevision: ready.viewRevision, conversationId, draftRevision: protectedDraftRevision,
        body: draft.body, replyToMessageId: draft.replyToMessageId});
    }, 500);
    return () => clearTimeout(timer);
  }, [ready?.accountViewRef, ready?.viewRevision, ready?.actions, conversationId, draft.generation, draft.revision, protectedDraftRevision,
    flow.epoch, busy, section, mobileConversation, wide, selectedSearchMessage, dialog, localClosing, replyUnavailable, chatDetail, readPanel]);
  const reviewPending = async (account: string, reference: string) => {
    const retained = () => {
      const current = controller.getSnapshot();
      return alive.current && AppState.currentState === 'active' && current.active && !current.busy &&
        (current.snapshot?.kind === 'AUTHORIZED' || current.snapshot?.kind === 'RECOVERY_REQUIRED') &&
        current.snapshot.accountViewRef === account && current.pending.some(item => item.accountViewRef === account && item.originalOperationRef === reference &&
          (item.resolution === 'unresolved' || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')));
    };
    if (!retained()) return;
    // The original pending reply can precede the capability projection that
    // exposes its review. An explicit check first refreshes that same native
    // view; neither the old action list nor a local reference grants admission.
    if (!controller.canExecute('reviewRecovery')) await refresh();
    if (!retained() || !controller.canExecute('reviewRecovery')) return;
    await run({type: 'reviewRecovery', originalOperationRef: reference});
  };
  const pendingReviewButton = (account: string, reference: string, label: string) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || !flow.active} accessibilityState={{disabled: busy || !flow.active}}
    onPress={() => {void reviewPending(account, reference);}} style={[styles.button, (busy || !flow.active) && styles.buttonDisabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  useEffect(() => {
    setReadPanel(null); setReadReturn(null); readPanelOffsets.current.clear(); closedReadPanels.current.clear(); readPanelRestore.current = ''; locatedScroll.current = ''; locatedOriginal.current = null; readPanelEnd.current = null;
  }, [ready?.accountViewRef, flow.epoch, localClosing]);
  const readPanelCurrent = (panel: ReadPanel) => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    if (readPanelOriginal.current !== panel || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() ||
      !current.active || current.epoch !== panel.epoch || navigationRevision.current !== renderedNavigation || activeSection.current !== 'chats' ||
      !ready || view?.kind !== 'AUTHORIZED' || view.accountViewRef !== panel.account || view.accountViewRef !== ready.accountViewRef || view.viewRevision !== ready.viewRevision) return null;
    return view;
  };
  const captureReadHistory = (view: NonNullable<typeof ready>, room: string | null): ReadHistory => ({view: view.viewRevision,
    messages: view.messages.filter(item => (!room || item.conversationId === room) && view.conversations.some(row => row.id === item.conversationId)),
    mode: view.messageWindow.mode, anchor: view.messageWindow.anchorMessageId, hasEarlier: view.messageWindow.hasEarlier});
  const openReadPanel = (mode: ReadPanel['mode']) => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    if (!ready || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active || current.epoch !== flow.epoch ||
      navigationRevision.current !== renderedNavigation || activeSection.current !== 'chats' || view?.kind !== 'AUTHORIZED' ||
      view.accountViewRef !== ready.accountViewRef || view.viewRevision !== ready.viewRevision || (mode !== 'global' && !conversationId)) return;
    const room = mode === 'global' ? null : conversationId;
    if (readPanelOriginal.current) {if (readPanel?.mode === mode) readPanelInput.current?.focus(); return;}
    const key = JSON.stringify([mode,room]);
    const retained = closedReadPanels.current.get(key);
    const cached = retained?.account === view.accountViewRef && retained.epoch === current.epoch && (mode !== 'global' || retained.query === search) ? retained : null;
    const parent = readReturnOriginal.current;
    const parents = parent ? [...parent.parents, {...parent, parents: []}].filter(item => JSON.stringify([item.mode,item.room]) !== key).slice(-8) : [];

    const panel: ReadPanel = {id: ++readPanelId.current, mode, source: 'saved', account: view.accountViewRef, epoch: current.epoch,
      room, title: room ? view.conversations.find(item => item.id === room)?.title ?? '' : '', query: mode === 'global' ? search : '', page: null,
      history: captureReadHistory(view, room), trail: [], parents, status: 'idle', error: null,
      origin: {view: view.viewRevision, room: conversationId, offset: unreadViewport.current.offset, follow: followingLatest.current.follow}};
    const selected: ReadPanel = cached ? {...cached, parents, origin: panel.origin} : panel;
    if (!cached) readPanelOffsets.current.set(selected.id, 0); readPanelRestore.current = ''; followingLatest.current.follow = false;
    ++navigationRevision.current; setChatDetail(null); setReadReturn(null); setReadPanel(selected); Keyboard.dismiss();
  };
  const closeReadPanel = () => {
    const panel = readPanel; if (!panel || !readPanelCurrent(panel)) return;
    const key = JSON.stringify([panel.mode,panel.room]);
    closedReadPanels.current.delete(key); closedReadPanels.current.set(key,{...panel, parents:[], status:panel.status === 'loading' ? 'idle' : panel.status});
    if (closedReadPanels.current.size > 32) closedReadPanels.current.delete(closedReadPanels.current.keys().next().value!);
    const parent = panel.parents.at(-1); setReadReturn(parent ? {...parent, parents:panel.parents.slice(0,-1)} : null);
    ++navigationRevision.current; setReadPanel(null); readPanelRestore.current = '';
    if (panel.mode === 'global') {searchText.current = panel.query; ++searchSequence.current; setSearch(panel.query); savedSearchRef.current = null; setSavedSearch(null); if (!wide && !parent) setMobileConversation(false);}
    const actual = controller.getSnapshot().snapshot;
    if (actual?.kind === 'AUTHORIZED' && panel.mode === 'history' && panel.landLatest && actual.messageWindow.mode === 'latest' && actual.activeConversationId === panel.room) {followingLatest.current.follow = true; conversationScroll.current?.scrollToEnd({animated:false});}
    else if (actual?.kind === 'AUTHORIZED' && actual.viewRevision === panel.origin.view && actual.activeConversationId === panel.origin.room) {
      followingLatest.current.follow = panel.origin.follow;
      conversationScroll.current?.scrollTo({y: panel.origin.offset, animated: false});
    }
  };
  const editReadPanelQuery = (value: string) => {
    const panel = readPanel; if (!panel || !readPanelCurrent(panel) || panel.mode === 'history') return;
    readPanelOffsets.current.set(panel.id, 0); readPanelRestore.current = '';
    setReadPanel({...panel, query: value, page: null, status: 'idle', error: null});
  };
  const chooseReadSource = (source: ReadPanel['source']) => {
    const panel = readPanel; const view = panel && readPanelCurrent(panel); if (!panel || !view || panel.mode === 'history') return;
    readPanelOffsets.current.set(panel.id, 0); readPanelRestore.current = '';
    setReadPanel({...panel, source, page: null, history: captureReadHistory(view, panel.room), status: 'idle', error: null});
  };
  const readPanelMatches = (panel: ReadPanel) => {
    const view = ready; if (!view || view.accountViewRef !== panel.account) return [];
    const nativeRows = panel.source === 'saved' ? panel.page?.result.matches ?? [] : validProductSearchQuery(panel.query.trim())
      ? panel.history.messages.filter(item => item.body.toLocaleLowerCase().includes(panel.query.trim().toLocaleLowerCase())).map(item => ({messageId: item.id, conversationId: item.conversationId,
        title: view.conversations.find(row => row.id === item.conversationId)?.title ?? '', excerpt: item.body})) : [];
    return nativeRows.filter(item => (!panel.room || item.conversationId === panel.room) && view.conversations.some(row => row.id === item.conversationId));
  };
  const rejectReadPanelCompletion = (waiting: ReadPanel, navigation: number) => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    if (alive.current && !ownerIsClosing() && readPanelOriginal.current === waiting && navigationRevision.current === navigation && activeSection.current === 'chats' &&
      current.epoch === waiting.epoch && view?.kind === 'AUTHORIZED' && view.accountViewRef === waiting.account)
      setReadPanel({...waiting, status: 'error', error: 'STALE_VIEW'});
  };
  const searchReadPanel = async (direction: 'first' | 'next' | 'previous' = 'first') => {
    const panel = readPanel; const view = panel && readPanelCurrent(panel); const navigation = navigationRevision.current;
    if (!panel || !view || panel.mode === 'history' || !validProductSearchQuery(panel.query.trim()) || panel.status === 'loading' ||
      (panel.room && !view.conversations.some(row => row.id === panel.room))) return;
    if (panel.source === 'window') {setReadPanel({...panel, status: 'idle', error: null}); return;}
    if (!controller.canExecute('searchLocalMessages')) return;
    let cursor: string | null = null; let previous: readonly (string | null)[] = [];
    if (direction !== 'first') {
      if (!panel.page || panel.page.query !== panel.query.trim()) return;
      if (direction === 'next') {if (!panel.page.result.nextBeforeMessageId || panel.page.previous.length >= 128) return; cursor = panel.page.result.nextBeforeMessageId; previous = [...panel.page.previous, panel.page.cursor];}
      else {if (!panel.page.previous.length) return; cursor = panel.page.previous.at(-1)!; previous = panel.page.previous.slice(0, -1);}
    }
    const waiting: ReadPanel = {...panel, status: 'loading', error: null}; setReadPanel(waiting);
    const result = await run({type: 'searchLocalMessages', viewRevision: view.viewRevision, query: panel.query.trim(), beforeMessageId: cursor});
    const after = controller.getSnapshot(); const actual = after.snapshot;
    if (readPanelOriginal.current !== waiting || navigationRevision.current !== navigation || !after.active || ownerIsClosing() || AppState.currentState !== 'active' ||
      after.epoch !== panel.epoch || actual?.kind !== 'AUTHORIZED' || actual.accountViewRef !== panel.account || actual.viewRevision !== view.viewRevision) {rejectReadPanelCompletion(waiting,navigation); return;}
    if (result?.kind !== 'messageSearch' || result.query !== panel.query.trim() || !result.matches.every(item => actual.conversations.some(row => row.id === item.conversationId))) {
      setReadPanel({...panel, status: 'error', error: result?.kind === 'error' ? result.code : 'STALE_VIEW'}); return;
    }
    readPanelOffsets.current.set(panel.id, 0); readPanelRestore.current = '';
    const page: SavedSearchPage = {account: panel.account, view: view.viewRevision, epoch: panel.epoch, query: panel.query.trim(), cursor, previous, result};
    setReadPanel({...panel, page, status: 'idle', error: null});
  };
  const submitReadPanel = () => {
    const panel = readPanel; if (!panel || !readPanelCurrent(panel) || panel.mode === 'history' || panel.status === 'loading' || !validProductSearchQuery(panel.query.trim()) ||
      (panel.source === 'saved' && !controller.canExecute('searchLocalMessages'))) return false;
    void searchReadPanel(); return true;
  };
  const openReadPanelOriginal = async (id: string, room: string) => {
    const panel = readPanel; const view = panel && readPanelCurrent(panel); const navigation = navigationRevision.current;
    if (!panel || !view || panel.status === 'loading' || !controller.canExecute('viewStoredMessage') || !view.conversations.some(row => row.id === room) ||
      (panel.mode === 'history' ? !panel.history.messages.some(item => item.id === id && item.conversationId === room) : !readPanelMatches(panel).some(item => item.messageId === id && item.conversationId === room))) return;
    // Cached original rows are display/routing DATA, not a current proof. Never
    // rewrite their source view revision; Native rechecks every current read.
    const waiting: ReadPanel = {...panel, status: 'loading', error: null}; setReadPanel(waiting);
    const result = await run({type: 'viewStoredMessage', viewRevision: view.viewRevision, conversationId: room, messageId: id});
    const after = controller.getSnapshot(); const actual = after.snapshot;
    if (readPanelOriginal.current !== waiting || navigationRevision.current !== navigation || !alive.current || !after.active || ownerIsClosing() || AppState.currentState !== 'active' || after.epoch !== panel.epoch ||
      actual?.kind !== 'AUTHORIZED' || actual.accountViewRef !== panel.account) {rejectReadPanelCompletion(waiting,navigation); return;}
    if (result?.kind !== 'snapshot' || actual.viewRevision !== result.snapshot.viewRevision || actual.activeConversationId !== room || actual.messageWindow.mode !== 'anchored' ||
      actual.messageWindow.anchorMessageId !== id || !actual.messages.some(item => item.id === id && item.conversationId === room)) {
      setReadPanel({...panel, status: 'error', error: result?.kind === 'error' ? result.code : 'STALE_VIEW'}); return;
    }
    locatedOriginal.current = {account: actual.accountViewRef, room, id};
    ++navigationRevision.current; setReadReturn({...panel, status: 'idle', error: null}); setReadPanel(null); setSearchMessage(null); setMobileConversation(true); locatedScroll.current = '';
    followingLatest.current = {account: actual.accountViewRef, conversation: room, follow: false};
  };
  const returnToReadPanel = () => {
    const panel = readReturn; const current = controller.getSnapshot(); const view = current.snapshot;
    if (!panel || readReturnOriginal.current !== panel || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active || current.epoch !== panel.epoch ||
      navigationRevision.current !== renderedNavigation || activeSection.current !== 'chats' || view?.kind !== 'AUTHORIZED' || view.accountViewRef !== panel.account) return;
    ++navigationRevision.current; setReadReturn(null); setReadPanel(panel); readPanelRestore.current = ''; Keyboard.dismiss();
  };
  const moveReadHistory = async (direction: 'earlier' | 'latest' | 'previous') => {
    const panel = readPanel; const view = panel && readPanelCurrent(panel); const navigation = navigationRevision.current;
    if (!panel || !view || panel.mode !== 'history' || !panel.room || panel.status === 'loading' || !view.conversations.some(row => row.id === panel.room)) return;
    if (direction === 'previous') {const old = panel.trail.at(-1); if (!old) return; readPanelOffsets.current.set(panel.id, old.offset); readPanelRestore.current = ''; readPanelEnd.current = null; setReadPanel({...panel, history: old.history, trail: panel.trail.slice(0, -1), status: 'idle', error: null, landLatest:false}); return;}
    const first = panel.history.messages.find(item => item.conversationId === panel.room);
    if (direction === 'earlier' && (!panel.history.hasEarlier || !first || !controller.canExecute('viewStoredMessage'))) return;
    if (direction === 'latest' && !controller.canExecute('openConversation')) return;
    const waiting: ReadPanel = {...panel, status: 'loading', error: null}; setReadPanel(waiting);
    const result = await run(direction === 'latest' ? {type: 'openConversation', viewRevision: view.viewRevision, conversationId: panel.room} : {type: 'viewStoredMessage', viewRevision: view.viewRevision, conversationId: panel.room, messageId: first!.id});
    const after = controller.getSnapshot(); const actual = after.snapshot;
    if (readPanelOriginal.current !== waiting || navigationRevision.current !== navigation || !after.active || ownerIsClosing() || AppState.currentState !== 'active' || after.epoch !== panel.epoch || actual?.kind !== 'AUTHORIZED' || actual.accountViewRef !== panel.account) {rejectReadPanelCompletion(waiting,navigation); return;}
    if (result?.kind !== 'snapshot' || actual.activeConversationId !== panel.room || actual.viewRevision !== result.snapshot.viewRevision ||
      (direction === 'latest' ? actual.messageWindow.mode !== 'latest' : actual.messageWindow.mode !== 'anchored' || actual.messageWindow.anchorMessageId !== first?.id)) {
      setReadPanel({...panel, status: 'error', error: result?.kind === 'error' ? result.code : 'STALE_VIEW'}); return;
    }
    const trail = [...panel.trail.slice(-31), {history: panel.history, offset: readPanelOffsets.current.get(panel.id) ?? 0}];
    readPanelOffsets.current.set(panel.id, 0); readPanelRestore.current = ''; followingLatest.current.follow = false;
    readPanelEnd.current = direction === 'latest' ? panel.id : null;
    setReadPanel({...panel, history: captureReadHistory(actual, panel.room), trail, status: 'idle', error: null, landLatest:direction === 'latest'});
  };
  const openChat = async (target: string, selectedMessage: string | null = null, contactId: string | null = null) => {
    const current = controller.getSnapshot().snapshot;
    const origin = activeSection.current;
    const navigation = navigationRevision.current;
    const searchVersion = searchSequence.current;
    if (!ready || current?.kind !== 'AUTHORIZED' || current.accountViewRef !== ready.accountViewRef ||
      current.viewRevision !== ready.viewRevision || origin !== (contactId ? 'friends' : 'chats') ||
      blocked(selectedMessage ? 'viewStoredMessage' : 'openConversation') || !current.conversations.some(item => item.id === target) ||
      (contactId && !current.contacts.some(item => item.id === contactId && item.conversationId === target)) ||
      (selectedMessage && (!query || searchText.current.trim().toLocaleLowerCase() !== query ||
        !current.messages.some(item => item.id === selectedMessage && item.conversationId === target)))) return;
    // A loaded search hit can belong to an anchored history window. Opening
    // the latest room would discard that original before it can be displayed.
    const result = await run(selectedMessage
      ? {type: 'viewStoredMessage', viewRevision: current.viewRevision, conversationId: target, messageId: selectedMessage}
      : {type: 'openConversation', viewRevision: current.viewRevision, conversationId: target});
    const after = controller.getSnapshot().snapshot;
    if (!alive.current || navigationRevision.current !== navigation || activeSection.current !== origin ||
      result?.kind !== 'snapshot' || after?.kind !== 'AUTHORIZED' || after.accountViewRef !== current.accountViewRef ||
      after.viewRevision !== result.snapshot.viewRevision || after.activeConversationId !== target ||
      (contactId && !after.contacts.some(item => item.id === contactId && item.conversationId === target)) ||
      (selectedMessage && (searchSequence.current !== searchVersion || after.messageWindow.mode !== 'anchored' || after.messageWindow.anchorMessageId !== selectedMessage ||
        !after.messages.some(item => item.id === selectedMessage && item.conversationId === target)))) return;
    setSearchMessage(selectedMessage && after.messages.some(item => item.id === selectedMessage && item.conversationId === target)
      ? {account: after.accountViewRef, conversation: target, message: selectedMessage} : null);
    setDialog(false); setChatDetail(null); setReadPanel(null); setReadReturn(null); setSection('chats'); setMobileConversation(true);
  };
  const openReplyOriginal = async (replyingId: string, target: string, room: string) => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    const navigation = navigationRevision.current;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      navigation !== renderedNavigation || current.epoch !== flow.epoch || activeSection.current !== 'chats' || chatDetail !== null ||
      (!wide && !mobileConversation) || !ready || view?.kind !== 'AUTHORIZED' || view.accountViewRef !== ready.accountViewRef ||
      view.viewRevision !== ready.viewRevision || view.activeConversationId !== room ||
      !view.messages.some(item => item.id === replyingId && item.conversationId === room && item.replyToMessageId === target)) return;
    if (view.messages.some(item => item.id === target && item.conversationId === room)) {
      ++navigationRevision.current;
      setSearchMessage({account: view.accountViewRef, conversation: room, message: target});
      return;
    }
    if (!controller.canExecute('viewStoredMessage')) return;
    const result = await run({type: 'viewStoredMessage', viewRevision: view.viewRevision, conversationId: room, messageId: target});
    const after = controller.getSnapshot(); const actual = after.snapshot;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !after.active ||
      navigationRevision.current !== navigation || activeSection.current !== 'chats' || after.epoch !== current.epoch ||
      result?.kind !== 'snapshot' || actual?.kind !== 'AUTHORIZED' || actual.accountViewRef !== view.accountViewRef ||
      actual.viewRevision !== result.snapshot.viewRevision || actual.activeConversationId !== room ||
      actual.messageWindow.mode !== 'anchored' || actual.messageWindow.anchorMessageId !== target) return;
    setSearchMessage(null); setHistoryAway(false); setSection('chats'); setMobileConversation(true);
  };
  const loadEarlierMessages = async () => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    const navigation = navigationRevision.current;
    if (!currentConversationView() || !ready || view?.kind !== 'AUTHORIZED' ||
      !view.messageWindow.hasEarlier || !controller.canExecute('viewStoredMessage')) return;
    // Native orders this window and anchors at or before this original record.
    // An id is routing DATA only: use the same protected read, never a resend.
    const first = view.messages.find(item => item.conversationId === conversationId);
    if (!first || view.activeConversationId !== conversationId) return;
    const result = await run({type: 'viewStoredMessage', viewRevision: view.viewRevision,
      conversationId: first.conversationId, messageId: first.id});
    const after = controller.getSnapshot(); const actual = after.snapshot;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !after.active ||
      navigationRevision.current !== navigation || activeSection.current !== 'chats' || after.epoch !== current.epoch ||
      result?.kind !== 'snapshot' || actual?.kind !== 'AUTHORIZED' || actual.accountViewRef !== view.accountViewRef ||
      actual.viewRevision !== result.snapshot.viewRevision || actual.activeConversationId !== first.conversationId ||
      actual.messageWindow.mode !== 'anchored' || actual.messageWindow.anchorMessageId !== first.id) return;
    followingLatest.current = {account: actual.accountViewRef, conversation: first.conversationId, follow: false};
    setSearchMessage(null); setHistoryAway(false);
  };
  const leaveMessageFocus = () => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active || current.epoch !== flow.epoch ||
      navigationRevision.current !== renderedNavigation || !ready || view?.kind !== 'AUTHORIZED' ||
      view.accountViewRef !== ready.accountViewRef || view.viewRevision !== ready.viewRevision || view.activeConversationId !== conversationId) return;
    ++navigationRevision.current; setSearchMessage(null);
  };
  const changeHistoryQuery = (value: string) => {
    const current = controller.getSnapshot();
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation || activeSection.current !== 'chats' ||
      !ready || current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef) return;
    searchText.current = value; ++searchSequence.current; savedSearchRef.current = null;
    setSavedSearch(null); setSearchingSaved(false); setSearch(value); setSearchMessage(null);
  };
  const visibleSavedSearch = ready && savedSearch && savedSearch.account === ready.accountViewRef &&
    savedSearch.view === ready.viewRevision && savedSearch.epoch === flow.epoch && savedSearch.query === search.trim()
    ? savedSearch : null;
  const searchSavedMessages = async (direction: 'first' | 'next' | 'previous' = 'first') => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    const query = searchText.current.trim(); const old = savedSearchRef.current;
    const navigation = navigationRevision.current;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      navigation !== renderedNavigation || activeSection.current !== 'chats' || !ready || view?.kind !== 'AUTHORIZED' ||
      current.epoch !== flow.epoch || view.accountViewRef !== ready.accountViewRef || view.viewRevision !== ready.viewRevision ||
      !validProductSearchQuery(query) || !controller.canExecute('searchLocalMessages')) return;
    let cursor: string | null = null; let previous: readonly (string | null)[] = [];
    if (direction !== 'first') {
      if (!old || old !== visibleSavedSearch || old.query !== query || old.account !== view.accountViewRef ||
        old.view !== view.viewRevision || old.epoch !== current.epoch) return;
      if (direction === 'next') {
        if (!old.result.nextBeforeMessageId || old.previous.length >= 128) return;
        cursor = old.result.nextBeforeMessageId; previous = [...old.previous, old.cursor];
      } else {
        if (!old.previous.length) return;
        cursor = old.previous.at(-1)!; previous = old.previous.slice(0, -1);
      }
    }
    const sequence = ++searchSequence.current;
    setSearchingSaved(true);
    try {
      const result = await run({type: 'searchLocalMessages', viewRevision: view.viewRevision, query, beforeMessageId: cursor});
      const after = controller.getSnapshot(); const actual = after.snapshot;
      if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !after.active ||
        searchSequence.current !== sequence || navigationRevision.current !== navigation || activeSection.current !== 'chats' ||
        after.epoch !== current.epoch || actual?.kind !== 'AUTHORIZED' || actual.accountViewRef !== view.accountViewRef ||
        actual.viewRevision !== view.viewRevision || searchText.current.trim() !== query || result?.kind !== 'messageSearch') return;
      if (!result.matches.every(item => actual.conversations.some(row => row.id === item.conversationId))) {
        setFeedback(errorCopy.STALE_VIEW); return;
      }
      const page = Object.freeze({account: view.accountViewRef, view: view.viewRevision, epoch: after.epoch,
        query, cursor, previous: Object.freeze([...previous]), result});
      savedSearchRef.current = page; setSavedSearch(page);
    } finally { if (searchSequence.current === sequence) setSearchingSaved(false); }
  };
  const openSavedMessage = async (page: SavedSearchPage, id: string, room: string) => {
    const current = controller.getSnapshot(); const view = current.snapshot;
    const navigation = navigationRevision.current;
    const sequence = searchSequence.current;
    if (savedSearchRef.current !== page || page !== visibleSavedSearch || !page.result.matches.some(item => item.messageId === id && item.conversationId === room) ||
      !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      navigation !== renderedNavigation || activeSection.current !== 'chats' || current.epoch !== page.epoch ||
      view?.kind !== 'AUTHORIZED' || view.accountViewRef !== page.account || view.viewRevision !== page.view ||
      searchText.current.trim() !== page.query || !controller.canExecute('viewStoredMessage')) return;
    const result = await run({type: 'viewStoredMessage', viewRevision: view.viewRevision, conversationId: room, messageId: id});
    const after = controller.getSnapshot(); const actual = after.snapshot;
    if (!alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !after.active ||
      navigationRevision.current !== navigation || searchSequence.current !== sequence || savedSearchRef.current !== page ||
      activeSection.current !== 'chats' || after.epoch !== page.epoch ||
      searchText.current.trim() !== page.query || result?.kind !== 'snapshot' || actual?.kind !== 'AUTHORIZED' ||
      actual.accountViewRef !== page.account || actual.viewRevision !== result.snapshot.viewRevision || actual.activeConversationId !== room ||
      actual.messageWindow.mode !== 'anchored' || actual.messageWindow.anchorMessageId !== id) return;
    setSearchMessage(null); setDialog(false); setHistoryAway(false); setSection('chats'); setMobileConversation(true);
  };
  const openContact = (contactId: string, routedConversationId: string | null | undefined) => {
    if (routedConversationId) return openChat(routedConversationId, null, contactId);
  };
  const select = (next: Section) => { setReadPanel(null); setReadReturn(null); settingsHistory.current = []; setSection(next); setSettingsPage(null); setContactDetail(null); setRequestDetail(null); setFriendPanel('contacts'); setChatDetail(null); setDialog(false); setMobileConversation(false); };
  const statusKey: VeilCopyKey = localClosing ? 'unavailable' : snapshot?.kind === 'LOCKED' ? 'locked' : snapshot?.kind === 'RECOVERY_REQUIRED' ? 'recoveryNeeded' : snapshot?.kind === 'AUTHORIZED' ? 'confirmed' : snapshot ? 'unavailable' : 'checking';
  const badge = <View style={styles.pill}><Text style={styles.pillText}>{t(statusKey)}</Text></View>;
  const changeContact = async (action: ContactChangeAction, target: string) => {
    const state = controller.getSnapshot();
    const current = state.snapshot;
    if (!ready || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !state.active ||
      state.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation || activeSection.current !== 'friends' ||
      current?.kind !== 'AUTHORIZED' || current.accountViewRef !== ready.accountViewRef ||
      current.viewRevision !== ready.viewRevision || blocked(action)) return;
    if (action === 'rejectContact') {
      if (!current.contactRequests.some(item => item.id === target)) return;
      await run({type: 'rejectContact', viewRevision: current.viewRevision, requestId: target});
    } else if (action === 'blockContact') {
      if (current.blockedContacts.some(item => item.peerAccountId === target) ||
        ![...current.contacts, ...current.contactRequests].some(item => item.peerAccountId === target)) return;
      await run({type: 'blockContact', viewRevision: current.viewRevision, peerAccountId: target});
    } else if (action === 'unblockContact') {
      if (!current.blockedContacts.some(item => item.peerAccountId === target)) return;
      await run({type: 'unblockContact', viewRevision: current.viewRevision, peerAccountId: target});
    }
  };
  const closeContactConfirmation = () => {contactConfirmationOriginal.current = null; setContactConfirmation(null);};
  const chooseContactChange = (action: ContactChangeAction, target: string) => {
    const current = controller.getSnapshot();
    if (!ready || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation || activeSection.current !== 'friends' ||
      current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef ||
      current.snapshot.viewRevision !== ready.viewRevision || blocked(action) || dialogSelection.current.open || contactConfirmationOriginal.current !== null) return;
    const exists = action === 'rejectContact' ? current.snapshot.contactRequests.some(item => item.id === target && item.direction === 'incoming') : action === 'unblockContact'
      ? current.snapshot.blockedContacts.some(item => item.peerAccountId === target)
      : !current.snapshot.blockedContacts.some(item => item.peerAccountId === target) && [...current.snapshot.contacts, ...current.snapshot.contactRequests].some(item => item.peerAccountId === target);
    if (!exists) return;
    const selection = {sequence: ++contactConfirmationSequence.current, action, target, account: ready.accountViewRef, view: ready.viewRevision, epoch: flow.epoch, navigation: renderedNavigation};
    contactConfirmationOriginal.current = selection; setContactConfirmation(selection);
  };
  const confirmContactChange = () => {
    const selection = contactConfirmation;
    const current = controller.getSnapshot();
    if (!selection || selection.sequence !== contactConfirmationOriginal.current?.sequence || !current.active ||
      current.epoch !== selection.epoch || current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== selection.account ||
      current.snapshot.viewRevision !== selection.view || navigationRevision.current !== selection.navigation) return;
    closeContactConfirmation();
    void changeContact(selection.action, selection.target);
  };
  const contactConfirmationVisible = !!contactConfirmation && !!ready && !localClosing && !uncertainRead && flow.active &&
    contactConfirmation.epoch === flow.epoch && contactConfirmation.account === ready.accountViewRef &&
    contactConfirmation.view === ready.viewRevision && contactConfirmation.navigation === renderedNavigation;
  const confirmationName = !contactConfirmation || !ready ? '' : contactConfirmation.action === 'rejectContact'
    ? ready.contactRequests.find(item => item.id === contactConfirmation.target)?.displayName
    : [...ready.contacts, ...ready.contactRequests, ...ready.blockedContacts].find(item => item.peerAccountId === contactConfirmation.target)?.displayName;
  const contactActionButton = (label: 'rejectContact' | 'blockContact' | 'unblockContact', action: ContactChangeAction, target: string, name?: string) => {
    // Only the actual native action projection exposes an operation. These
    // controls never derive permission or optimistically change a relation.
    if (!ready?.actions.includes(action)) return null;
    const disabled = blocked(action);
    const hint: VeilCopyKey = label === 'rejectContact' ? 'rejectContactDetail' : label === 'blockContact' ? 'blockContactDetail' : 'unblockContactDetail';
    return <Pressable accessibilityRole="button" accessibilityLabel={name ? `${t(label)}: ${name}` : t(label)} accessibilityHint={t(hint)}
      disabled={disabled} accessibilityState={{disabled}} onPress={() => chooseContactChange(action, target)}
      style={[styles.button, styles.buttonSecondary, disabled && styles.buttonDisabled]}>
      <Text style={[styles.buttonText, styles.buttonSecondaryText, disabled && styles.buttonDisabledText]}>{t(label)}</Text>
    </Pressable>;
  };
  useEffect(() => {if (contactConfirmation && !contactConfirmationVisible) closeContactConfirmation();}, [contactConfirmationVisible, ready?.accountViewRef, ready?.viewRevision, flow.epoch, renderedNavigation]);
  const actionButton = (label: VeilCopyKey, action: VeilProductCommand['type'], build: () => VeilProductCommand | null, extraBlocked = false, Glyph?: Icon, displayLabel?: string) => {
    const disabled = blocked(action) || extraBlocked;
    const title = displayLabel ?? t(label);
    return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => { const command = build(); if (command) void run(command); }}
      style={[styles.button, disabled && styles.buttonDisabled]}>
      {Glyph && <Glyph size={18} color={disabled ? colors.muted : '#fff'} />}
      <Text style={[styles.buttonText, disabled && styles.buttonDisabledText]}>{title}</Text>
    </Pressable>;
  };
  const markVisibleLatest = () => {
    if (!currentUnreadView() || !ready || !conversationId || !controller.canExecute('markConversationRead')) return;
    if (!ready.conversations.some(item => item.id === conversationId && item.unreadCount > 0)) return;
    const latest = ready.messages.filter(item => item.conversationId === conversationId).at(-1);
    const measured = unreadViewport.current;
    const following = followingLatest.current;
    if (!latest || !measured.row || measured.row.message !== latest.id || measured.height <= 0 ||
      measured.row.bottom <= measured.offset || measured.row.bottom > measured.offset + measured.height + 2 ||
      (following.account === ready.accountViewRef && following.conversation === conversationId && !following.follow)) return;
    const stamp = JSON.stringify([flow.epoch, ready.accountViewRef, conversationId, ready.viewRevision, latest.id, renderedNavigation]);
    if (unreadAttempt.current === stamp) return;
    unreadAttempt.current = stamp;
    void run({type: 'markConversationRead', viewRevision: ready.viewRevision, conversationId, throughMessageId: latest.id});
  };
  // A protected draft read can occupy admission during the first layout.
  // Recheck only the already measured visible latest row when it releases.
  useEffect(() => { if (!busy) markVisibleLatest(); }, [busy, ready?.accountViewRef, ready?.viewRevision,
    conversationId, flow.epoch, section, mobileConversation, selectedSearchMessage, chatDetail, readPanel]);
  const empty = (Glyph: Icon, title: VeilCopyKey, detail: VeilCopyKey, _atmospheric = false) =>
    <View style={styles.empty}>
      <View style={styles.medallion}><Glyph size={28} color={colors.muted} strokeWidth={1.7} /></View>
      <View style={styles.emptyCopy}><Text style={[styles.title, styles.centered]}>{t(title)}</Text><Text style={[styles.text, styles.centered]}>{t(detail)}</Text></View>
    </View>;
  const searchBox = (kind: VeilCopyKey, value: string, change: (value: string) => void, label = t(kind)) => <View style={[styles.search, !wide && kind === 'search' && styles.mobileChatSearch]}>
    <Search size={18} color={colors.muted} /><TextInput ref={kind === 'search' ? globalSearchInput : undefined} value={value} onChangeText={change} accessibilityLabel={kind === 'search' ? (locale === 'zh-Hant' ? '搜索對話和訊息' : locale === 'zh' ? '搜索对话和消息' : 'Search conversations and messages') : label}
      placeholder={label} placeholderTextColor={colors.muted} style={[styles.input, !wide && kind === 'search' && styles.mobileChatSearchInput]} maxLength={productLimits.query} autoCorrect={false} />
    {!!value && <Pressable onPress={() => change('')} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={12}><X size={18} color={colors.muted} /></Pressable>}
  </View>;
  const card = (Glyph: Icon, title: VeilCopyKey, detail: VeilCopyKey, content?: React.ReactNode) =>
    <View style={styles.card}><View style={styles.cardHeader}><Glyph color={colors.accent} size={24} /><Text style={[styles.strong, styles.grow]}>{t(title)}</Text></View><Text style={styles.text}>{t(detail)}</Text>{content}</View>;

  const openChatDetails = () => {
    if (readPanel) return;
    const current = controller.getSnapshot();
    if (!ready || !conversationId || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation || activeSection.current !== 'chats' ||
      (!wide && !mobileConversation) || current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef ||
      current.snapshot.viewRevision !== ready.viewRevision || current.snapshot.activeConversationId !== conversationId ||
      !current.snapshot.conversations.some(item => item.id === conversationId)) return;
    ++navigationRevision.current; setChatDetail({account: ready.accountViewRef, conversation: conversationId}); Keyboard.dismiss();
  };
  const closeChatDetails = () => {
    if (navigationRevision.current !== renderedNavigation) return;
    ++navigationRevision.current; setChatDetail(null);
  };
  const chatDetailConversation = chatDetail?.account === ready?.accountViewRef ? ready?.conversations.find(item => item.id === chatDetail?.conversation) : undefined;
  const chatDetailContacts = chatDetailConversation ? ready?.contacts.filter(item => item.conversationId === chatDetailConversation.id) ?? [] : [];
  const openLinkedChatContact = (id: string) => {
    const current = controller.getSnapshot();
    if (!ready || !chatDetail || !chatDetailConversation || ownerIsClosing() || !current.active || current.epoch !== flow.epoch ||
      navigationRevision.current !== renderedNavigation || current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== chatDetail.account ||
      current.snapshot.viewRevision !== ready.viewRevision || !current.snapshot.contacts.some(item => item.id === id && item.conversationId === chatDetail.conversation)) return;
    setChatDetail(null); setSection('friends'); setContactDetail({account: ready.accountViewRef, id});
  };
  const chatDetailVisible = !!chatDetailConversation && flow.active && !localClosing && !uncertainRead && activeSection.current === 'chats';
  const conversationPane = <KeyboardAvoidingView style={styles.pane} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {ready && conversationId && <View style={styles.conversationHeader}>
      {(!wide || readReturn) && <Pressable style={styles.iconButton} onPress={() => {if (readReturn) returnToReadPanel(); else {++navigationRevision.current; setMobileConversation(false);}}} accessibilityRole="button" accessibilityLabel={readReturn ? t('backToReadResults') : t('back')}><ArrowLeft color={colors.ink} size={22} /></Pressable>}
      <View style={styles.conversationAvatar}><Text style={styles.avatarText}>{Array.from(conversation?.title.trim() ?? '')[0]?.toLocaleUpperCase() ?? 'YNX'}</Text></View>
      <Pressable style={[styles.grow, {minHeight: 44, justifyContent: 'center'}]} accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'Conversation details' : locale === 'zh-Hant' ? '對話詳情' : '对话详情'} onPress={openChatDetails}><Text numberOfLines={1} style={styles.strong}>{conversation?.title}</Text></Pressable>
      <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('searchThisConversation')} onPress={() => openReadPanel('conversation')}><Search size={21} color={colors.muted} /></Pressable><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('browseSavedHistory')} onPress={() => openReadPanel('history')}><History size={21} color={colors.muted} /></Pressable>
    </View>}
    {ready && conversationId ? <ScrollView ref={conversationScroll} accessibilityLabel={(locale === 'zh-Hant' ? '對話訊息' : locale === 'zh' ? '对话消息' : 'Conversation messages')} contentContainerStyle={wide ? { padding: 20, gap: 16 } : styles.mobileMessages} scrollEventThrottle={100}
      onLayout={event => {
        if (ready?.messageWindow.mode !== 'latest' || !currentConversationView(true)) return;
        const height = event.nativeEvent.layout.height;
        if (!Number.isFinite(height) || height <= 0) return;
        unreadViewport.current.height = height; markVisibleLatest();
      }}
      onContentSizeChange={() => {if (currentHistory(true) && !selectedSearchMessage && followingLatest.current.follow) conversationScroll.current?.scrollToEnd({animated: false});}}
      onScroll={event => {
        if (!currentConversationView(true)) return;
        const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (!Number.isFinite(contentOffset.y) || !Number.isFinite(layoutMeasurement.height) || layoutMeasurement.height <= 0) return;
        unreadViewport.current.offset = contentOffset.y; unreadViewport.current.height = layoutMeasurement.height;
        const follow = contentSize.height - (contentOffset.y + layoutMeasurement.height) <= 80;
        followingLatest.current = {account: ready.accountViewRef, conversation: conversationId, follow}; setHistoryAway(!follow);
        markVisibleLatest();
      }}>
      {ready.messageWindow.hasEarlier && !selectedSearchMessage && ready.messages.some(item => item.conversationId === conversationId) &&
        <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '載入更早訊息' : locale === 'zh' ? '加载更早消息' : 'Load earlier messages')}
          disabled={blocked('viewStoredMessage')} accessibilityState={{disabled: blocked('viewStoredMessage')}}
          onPress={() => {void loadEarlierMessages();}} style={[styles.button, styles.buttonSecondary]}>
          <Text style={[styles.buttonText, styles.buttonSecondaryText]}>{(locale === 'zh-Hant' ? '載入更早訊息' : locale === 'zh' ? '加载更早消息' : 'Load earlier messages')}</Text>
        </Pressable>}
      {ready.messageWindow.mode === 'anchored' && <View style={styles.compactNotice}>
        <Text style={[styles.caption, styles.grow]}>{(locale === 'zh-Hant' ? '正在查看已保存的歷史訊息' : locale === 'zh' ? '正在查看已保存的历史消息' : 'Viewing saved message history')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '返回最新訊息' : locale === 'zh' ? '返回最新消息' : 'Return to latest messages')}
          disabled={blocked('openConversation')} accessibilityState={{disabled: blocked('openConversation')}} onPress={() => {void openChat(conversationId);}}>
          <Text style={styles.strong}>{(locale === 'zh-Hant' ? '返回最新訊息' : locale === 'zh' ? '返回最新消息' : 'Return to latest messages')}</Text>
        </Pressable>
      </View>}
      {selectedSearchMessage && <View style={styles.compactNotice}><Text style={[styles.caption, styles.grow]}>{(locale === 'zh-Hant' ? '已載入訊息中的搜索結果' : locale === 'zh' ? '已加载消息中的搜索结果' : 'Search result in loaded messages')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '查看完整對話' : locale === 'zh' ? '查看完整对话' : 'View full conversation')} onPress={leaveMessageFocus}><Text style={styles.strong}>{(locale === 'zh-Hant' ? '查看完整對話' : locale === 'zh' ? '查看完整对话' : 'View full conversation')}</Text></Pressable>
      </View>}
      {ready.messages.filter(message => message.conversationId === conversationId && (!selectedSearchMessage || message.id === selectedSearchMessage)).map(message => {
        const original = message.replyToMessageId ? ready.messages.find(item => item.id === message.replyToMessageId && item.id !== message.id && item.conversationId === message.conversationId) : undefined;
        return <View key={message.id} style={[styles.bubble, message.direction === 'outgoing' && styles.outgoingBubble, readReturn && locatedOriginal.current?.account === ready.accountViewRef && locatedOriginal.current?.room === message.conversationId && locatedOriginal.current?.id === message.id && styles.locatedBubble]}
          onLayout={event => {
            if (readReturn && locatedOriginal.current?.account === ready.accountViewRef && locatedOriginal.current?.room === message.conversationId && locatedOriginal.current?.id === message.id && ready.messageWindow.mode === 'anchored' && ready.messageWindow.anchorMessageId === message.id && currentHistory(true)) {
              const y = event.nativeEvent.layout.y; const key = ready.viewRevision + ':' + message.id;
              if (Number.isFinite(y) && locatedScroll.current !== key) {locatedScroll.current = key; conversationScroll.current?.scrollTo({y: Math.max(0, y - 20), animated: false});}
            }
            if (ready.messageWindow.mode !== 'latest' || !currentConversationView(true) || ready.messages.filter(item => item.conversationId === conversationId).at(-1)?.id !== message.id) return;
            const {y, height} = event.nativeEvent.layout;
            if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return;
            unreadViewport.current.row = {message: message.id, bottom: y + height}; markVisibleLatest();
          }}>
        <Text style={[styles.strong, message.direction === 'outgoing' && styles.outgoingText]}>{message.senderLabel}</Text>
        {message.replyToMessageId && <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '查看回覆的原訊息' : locale === 'zh' ? '查看回复的原消息' : 'View replied message')} disabled={!original && blocked('viewStoredMessage')} accessibilityState={{disabled: !original && blocked('viewStoredMessage')}} style={[styles.replyQuote, message.direction === 'outgoing' && styles.outgoingReplyQuote]}
          onPress={() => {if (message.replyToMessageId) void openReplyOriginal(message.id, message.replyToMessageId, message.conversationId);}}>
        <View style={styles.grow}><Text style={[styles.strong, message.direction === 'outgoing' && styles.outgoingText]}>{original ? `${t('reply')} · ${original.senderLabel}` : t('reply')}</Text><Text numberOfLines={2} style={[styles.caption, message.direction === 'outgoing' && styles.outgoingCaption]}>{original?.body ?? ((locale === 'zh-Hant' ? '原訊息不在已載入的歷史中。' : locale === 'zh' ? '原消息不在已加载的历史中。' : 'The original message is not in loaded history.'))}</Text></View>
        </Pressable>}
        <Text style={[styles.text, message.direction === 'outgoing' && styles.outgoingText]}>{message.body}</Text>
        <Text style={[styles.caption, message.direction === 'outgoing' && styles.outgoingCaption]}>{t(messageStatusKey(message))}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('reply')} disabled={message.submission !== 'confirmed'} accessibilityState={{disabled: message.submission !== 'confirmed'}} onPress={() => editDraft({replyToMessageId: message.id})}><Text style={[styles.strong, message.direction === 'outgoing' && styles.outgoingText]}>{t('reply')}</Text></Pressable>
        {message.attachments.map(item => <Pressable key={item.reference} style={styles.attachmentMessage} accessibilityRole="button"
          accessibilityLabel={`${locale === 'zh-Hant' ? '開啟附件' : locale === 'zh' ? '打开附件' : 'Open attachment'}: ${item.name}`}
          disabled={blocked('openAttachment')} accessibilityState={{disabled: blocked('openAttachment')}}
          onPress={() => {void run({type: 'openAttachment', viewRevision: ready.viewRevision, conversationId, messageId: message.id, attachmentReference: item.reference});}}>
          <FileText size={23} color={message.direction === 'outgoing' ? '#FFFFFF' : colors.ink} />
          <View style={styles.grow}><Text style={[styles.strong, message.direction === 'outgoing' && styles.outgoingText]}>{item.name}</Text><Text style={[styles.caption, message.direction === 'outgoing' && styles.outgoingCaption]}>{t('attachment')}</Text></View>
          <ExternalLink size={18} color={message.direction === 'outgoing' ? '#E3E9FF' : colors.muted} />
        </Pressable>)}
      </View>;})}
    </ScrollView> : empty(MessageCircle, 'chooseChat', 'conversationDetail', true)}
    {ready && ready.messageWindow.mode === 'latest' && conversationId && historyAway && !selectedSearchMessage && <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '查看最新訊息' : locale === 'zh' ? '查看最新消息' : 'Jump to latest messages')} style={[styles.button, styles.buttonSecondary]}
      onPress={() => {if (!currentHistory()) return; followingLatest.current.follow = true; setHistoryAway(false); conversationScroll.current?.scrollToEnd({animated: true});}}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{(locale === 'zh-Hant' ? '查看最新訊息' : locale === 'zh' ? '查看最新消息' : 'Jump to latest messages')}</Text></Pressable>}
    <View style={styles.composer}>
      {pendingOriginals.filter(item => (item.command.type === 'sendMessage' || item.command.type === 'sendAttachment') && item.command.conversationId === conversationId).map(item => <View key={item.localCallId} style={styles.compactNotice}>
        <Text style={[styles.caption, styles.grow]} accessibilityLiveRegion="polite">{t(item.disposition)}</Text>
        {item.originalOperationRef ? pendingReviewButton(item.accountViewRef, item.originalOperationRef, (locale === 'zh-Hant' ? '查看傳送狀態' : locale === 'zh' ? '查看发送状态' : 'Check send status'))
          : <Pressable accessibilityRole="button" accessibilityLabel={t('details')} onPress={() => select('settings')}><Text style={styles.strong}>{t('details')}</Text></Pressable>}
      </View>)}
      {replyTo && <View style={styles.replyQuote}><View style={styles.grow}><Text style={styles.strong}>{t('reply')}{replyingMessage ? ` · ${replyingMessage.senderLabel}` : ''}</Text><Text numberOfLines={2} style={styles.caption}>{replyUnavailable ? ((locale === 'zh-Hant' ? '原訊息暫不可用於回覆，請等待恢復或取消回覆。' : locale === 'zh' ? '原消息暂不可用于回复，请等待恢复或取消回复。' : 'The original message is unavailable for reply. Wait for recovery or cancel the reply.')) : replyingMessage?.body}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t('cancelReply')} style={styles.iconButton} onPress={() => editDraft({replyToMessageId: null})}><X size={18} color={colors.muted} /></Pressable></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={t('localDraft')} accessibilityState={{expanded: draftToolsExpanded}}
        onPress={() => setDraftToolsExpanded(value => !value)} style={styles.draftDisclosure}>
        <Text style={styles.caption}>{t('localDraft')}</Text><ChevronDown size={14} color={colors.muted} />
      </Pressable>
      {draftToolsExpanded && <View style={styles.wrapRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('loadDraft')} disabled={blocked('loadDraft') || !conversationId}
          onPress={() => { if (ready && conversationId) void run({type: 'loadDraft', viewRevision: ready.viewRevision, conversationId}); }}>
          <Text style={styles.text}>{t('loadDraft')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('saveDraft')} disabled={blocked('saveDraft') || !conversationId || drafts.protectedRevision(ready?.accountViewRef ?? null, conversationId) === null}
          onPress={() => { const revision = drafts.protectedRevision(ready?.accountViewRef ?? null, conversationId);
            if (ready && conversationId && revision !== null) void run({type: 'saveDraft', viewRevision: ready.viewRevision, conversationId, draftRevision: revision, body, replyToMessageId: replyTo}); }}>
          <Text style={styles.text}>{t('saveDraft')}</Text>
        </Pressable>
      </View>}

      {attachment && <View style={styles.attachmentSelection} accessibilityLabel={t('attachmentPending')}>
        <FileText size={21} color={colors.ink} />
        <View style={styles.grow}><Text style={[styles.caption, {color: colors.link}]}>{t('attachmentPending')}</Text><Text numberOfLines={2} style={styles.text}>{attachment.name}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={locale === 'zh-Hant' ? '移除所選附件' : locale === 'zh' ? '移除所选附件' : 'Remove selected attachment'}
          disabled={busy || pendingOriginals.some(item => item.command.type === 'sendAttachment' && item.command.selectionReference === attachment.reference)}
          accessibilityState={{disabled: busy || pendingOriginals.some(item => item.command.type === 'sendAttachment' && item.command.selectionReference === attachment.reference)}}
          onPress={removeSelectedAttachment} style={styles.iconButton}><X size={20} color={colors.muted} /></Pressable>
      </View>}
      {attachment && replyTo !== null && <Text accessibilityLiveRegion="polite" style={styles.caption}>{t('attachmentReplyConflict')}</Text>}
      <View style={styles.composerField}>
        <Pressable style={styles.iconButton} disabled={blocked('selectAttachment') || !conversationId} accessibilityRole="button" accessibilityLabel={t('attachment')}
          accessibilityState={{ disabled: blocked('selectAttachment') || !conversationId }}
          onPress={() => { if (ready && conversationId) void run({ type: 'selectAttachment', viewRevision: ready.viewRevision, conversationId }); }}>
          <Paperclip size={23} color={blocked('selectAttachment') ? colors.disabled : colors.muted} />
        </Pressable>
      <TextInput ref={composerInput} value={body} onChangeText={value => editDraft({body: value})} editable={!!ready && !!conversationId && !readPanel && !chatDetail} multiline maxLength={productLimits.body} accessibilityLabel={t('messageDraft')}
          placeholder={t('messageDraft')} placeholderTextColor={colors.muted} style={[styles.input, styles.composerInput]} />
        <Pressable disabled={composerSendDisabled} accessibilityRole="button" accessibilityLabel={t(attachment ? 'sendAttachment' : 'send')}
          accessibilityState={{ disabled: composerSendDisabled }}
          onPress={() => {sendFromComposer();}}
          style={[styles.sendButton, composerSendDisabled && styles.buttonDisabled]}>
          <ArrowUp size={20} color={composerSendDisabled ? colors.muted : '#fff'} />
        </Pressable>
      </View>
    </View>
  </KeyboardAvoidingView>;
  const chatDetailsContent = chatDetailConversation ? <View style={[styles.pane, {backgroundColor: colors.canvas}]} accessibilityViewIsModal={!wide}><View style={styles.detailHeader}><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('back')} onPress={closeChatDetails}><ArrowLeft size={21} color={colors.ink} /></Pressable><Text style={styles.strong}>{locale === 'en' ? 'Conversation details' : locale === 'zh-Hant' ? '對話詳情' : '对话详情'}</Text></View><ScrollView style={styles.pane} contentContainerStyle={styles.content}>
        <Text style={styles.pageTitle}>{chatDetailConversation.title}</Text>
        <Text style={styles.caption}>{locale === 'en' ? 'Contacts linked to this conversation' : locale === 'zh-Hant' ? '與此對話關聯的聯絡人' : '与此对话关联的联系人'}</Text>
        {chatDetailContacts.map(item => <Pressable key={item.id} style={styles.preferenceRow} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View linked contact' : '查看关联联系人'}: ${item.displayName}`} onPress={() => openLinkedChatContact(item.id)}><View style={styles.grow}><Text style={styles.strong}>{item.displayName}</Text><Text style={styles.caption}>{item.publicIdentifier ?? t('publicIdentifierMissing')}</Text></View><ChevronRight size={18} color={colors.muted} /></Pressable>)}
        {!chatDetailContacts.length && <Text style={styles.text}>{locale === 'en' ? 'No linked contact is visible in the current account view.' : locale === 'zh-Hant' ? '目前帳戶視圖中沒有可見的關聯聯絡人。' : '当前账户视图中没有可见的关联联系人。'}</Text>}
      </ScrollView></View> : null;
  const nav = (mobile: boolean) => <View style={mobile ? styles.mobileNav : styles.desktopTabs}>
    {navigation.map(({key, icon: Glyph}) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={t(key)} accessibilityState={{selected: section === key}} onPress={() => select(key)} style={mobile ? [styles.nav, styles.grow] : [styles.desktopTab, section === key && styles.desktopTabActive]}>
      {mobile && <Glyph size={21} color={section === key ? colors.link : colors.muted} strokeWidth={section === key ? 2 : 1.7} />}
      <Text style={[styles.navText, section === key && styles.navTextActive]}>{t(key)}</Text>
    </Pressable>)}
  </View>;
  const visibleReadPanel = readPanel && ready && flow.active && !localClosing && !uncertainRead && section === 'chats' && readPanel.account === ready.accountViewRef && readPanel.epoch === flow.epoch ? readPanel : null;
  const readPanelRoomVisible = !!visibleReadPanel && (!visibleReadPanel.room || !!ready?.conversations.some(item => item.id === visibleReadPanel.room));
  const readPanelDataVisible = !!visibleReadPanel && !!ready && (visibleReadPanel.mode !== 'history' && visibleReadPanel.source === 'saved'
    ? !visibleReadPanel.page || ready.actions.includes('searchLocalMessages')
    : visibleReadPanel.history.messages.every(item => ready.messages.includes(item)) || ready.actions.includes('viewStoredMessage'));
  const visibleReadMatches = visibleReadPanel && readPanelRoomVisible && readPanelDataVisible ? readPanelMatches(visibleReadPanel) : [];
  const restoreReadPanelScroll = () => {
    const panel = visibleReadPanel; if (!panel || !readPanelCurrent(panel)) return;
    const key = panel.id + ':' + renderedNavigation;
    if (readPanelRestore.current === key) return;
    readPanelRestore.current = key;
    if (readPanelEnd.current === panel.id) {readPanelEnd.current = null; readPanelScroll.current?.scrollToEnd({animated:false});}
    else readPanelScroll.current?.scrollTo({y: readPanelOffsets.current.get(panel.id) ?? 0, animated: false});
  };
  const readPanelContent = visibleReadPanel ? <View style={[styles.pane,{backgroundColor: colors.canvas}]} accessibilityViewIsModal={!wide}>
    <View style={styles.detailHeader}><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t(visibleReadPanel.mode === 'history' ? 'closeHistoryView' : 'closeSearchView')} onPress={closeReadPanel}><ArrowLeft size={21} color={colors.ink} /></Pressable><Text style={styles.strong}>{t(visibleReadPanel.mode === 'history' ? 'savedHistoryTitle' : visibleReadPanel.mode === 'conversation' ? 'conversationSearchTitle' : 'localSearchTitle')}</Text></View>
    {!readPanelRoomVisible || !readPanelDataVisible ? <View style={styles.content}><Text style={styles.text}>{t(!readPanelRoomVisible ? 'readRoomUnavailable' : 'readDataUnavailable')}</Text></View> : <>
      {visibleReadPanel.room && <View style={styles.readPanelIntro}><Text style={styles.strong}>{ready?.conversations.find(item => item.id === visibleReadPanel.room)?.title}</Text></View>}
      {visibleReadPanel.mode !== 'history' && <View style={styles.readPanelIntro}>
        <View style={[styles.search,styles.readQueryField]}><Search size={19} color={colors.muted} /><TextInput ref={readPanelInput} style={styles.input} autoFocus autoCorrect={false} onSubmitEditing={event => {if (Platform.OS !== 'web' && !('isComposing' in event.nativeEvent && event.nativeEvent.isComposing)) submitReadPanel();}} value={visibleReadPanel.query} onChangeText={editReadPanelQuery} maxLength={productLimits.query} accessibilityLabel={t('localMessageQuery')} placeholder={t('localMessageQuery')} placeholderTextColor={colors.muted} autoCapitalize="none" returnKeyType="search" /><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('clearReadQuery')} onPress={() => editReadPanelQuery('')}><X size={20} color={colors.muted} /></Pressable></View>
        <View style={styles.row}>{(['saved','window'] as const).map(source => <Pressable key={source} style={[styles.readSource, visibleReadPanel.source === source && styles.readSourceSelected]} accessibilityRole="radio" accessibilityState={{checked: visibleReadPanel.source === source}} accessibilityLabel={t(source === 'saved' ? 'savedReadSource' : 'windowReadSource')} onPress={() => chooseReadSource(source)}><Text style={styles.text}>{t(source === 'saved' ? 'savedReadSource' : 'windowReadSource')}</Text></Pressable>)}</View>
        <Text style={styles.caption}>{t(visibleReadPanel.mode === 'conversation' ? 'conversationReadScope' : 'globalReadScope')}</Text>
        {!!visibleReadPanel.query.trim() && !validProductSearchQuery(visibleReadPanel.query.trim()) && <Text accessibilityLiveRegion="polite" style={styles.text}>{t(errorCopy.INPUT_INVALID)}</Text>}
        {visibleReadPanel.source === 'saved' && <Pressable accessibilityRole="button" accessibilityLabel={t('runLocalSearch')} disabled={blocked('searchLocalMessages') || visibleReadPanel.status === 'loading' || !validProductSearchQuery(visibleReadPanel.query.trim())} accessibilityState={{disabled: blocked('searchLocalMessages') || visibleReadPanel.status === 'loading' || !validProductSearchQuery(visibleReadPanel.query.trim())}} style={[styles.button,styles.buttonSecondary]} onPress={() => {submitReadPanel();}}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('runLocalSearch')}</Text></Pressable>}
      </View>}
      <ScrollView ref={readPanelScroll} style={styles.pane} accessibilityLabel={t(visibleReadPanel.mode === 'history' ? 'savedHistoryResults' : 'localSearchResults')} contentContainerStyle={styles.readPanelResults} keyboardShouldPersistTaps="handled" onContentSizeChange={restoreReadPanelScroll} onScroll={event => {const y=event.nativeEvent.contentOffset.y;if (Number.isFinite(y) && y >= 0 && readPanelOriginal.current === visibleReadPanel) readPanelOffsets.current.set(visibleReadPanel.id,y);}} scrollEventThrottle={100}>
        {visibleReadPanel.status === 'loading' && <ActivityIndicator accessibilityLabel={t('readingLocalMessages')} color={colors.link} />}
        {visibleReadPanel.error && <Text accessibilityLiveRegion="polite" style={styles.text}>{t(errorCopy[visibleReadPanel.error])}</Text>}
        {(visibleReadPanel.page?.view ?? visibleReadPanel.history.view) !== ready?.viewRevision && <Text style={styles.caption}>{t('cachedReadHint')}</Text>}
        {visibleReadPanel.mode === 'history' ? <>
          <Text style={styles.caption}>{t('historyReadScope')}</Text>
          {!!visibleReadPanel.trail.length && <Pressable style={[styles.button,styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={t('previousHistoryWindow')} disabled={busy} onPress={() => {void moveReadHistory('previous');}}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('previousHistoryWindow')}</Text></Pressable>}
          {visibleReadPanel.history.hasEarlier && <Pressable style={[styles.button,styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={t('earlierHistoryWindow')} disabled={blocked('viewStoredMessage')} onPress={() => {void moveReadHistory('earlier');}}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('earlierHistoryWindow')}</Text></Pressable>}
          {visibleReadPanel.history.messages.map(message => <Pressable key={message.id} style={[styles.bubble,message.direction === 'outgoing' && styles.outgoingBubble]} accessibilityRole="button" accessibilityLabel={t('openHistoryOriginal') + ': ' + message.body} disabled={blocked('viewStoredMessage')} onPress={() => {void openReadPanelOriginal(message.id,message.conversationId);}}><Text style={[styles.strong,message.direction === 'outgoing' && styles.outgoingText]}>{message.senderLabel}</Text><Text style={[styles.text,message.direction === 'outgoing' && styles.outgoingText]}>{message.body}</Text>{message.attachments.map(item => <Text key={item.reference} style={[styles.caption,message.direction === 'outgoing' && styles.outgoingCaption]}>{item.name}</Text>)}</Pressable>)}
          {!visibleReadPanel.history.messages.length && <Text style={styles.text}>{t('noHistoryMessages')}</Text>}
          <Pressable style={[styles.button,styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={t('latestHistoryWindow')} disabled={blocked('openConversation')} onPress={() => {void moveReadHistory('latest');}}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('latestHistoryWindow')}</Text></Pressable>
        </> : <>
          <Text style={styles.caption}>{t('readPageMatches')}: {visibleReadMatches.length}</Text>
          {visibleReadMatches.map(item => <Pressable key={item.conversationId + ':' + item.messageId} style={styles.readResultRow} accessibilityRole="button" accessibilityLabel={t('openLocalOriginal') + ': ' + item.excerpt} disabled={blocked('viewStoredMessage') || visibleReadPanel.status === 'loading'} accessibilityState={{disabled: blocked('viewStoredMessage') || visibleReadPanel.status === 'loading'}} onPress={() => {void openReadPanelOriginal(item.messageId,item.conversationId);}}><Text style={styles.strong}>{item.title}</Text><Text style={styles.text}>{item.excerpt}</Text><Text style={styles.caption}>{t('exactOriginalHint')}</Text></Pressable>)}
          {!visibleReadMatches.length && <Text style={styles.text}>{t(!validProductSearchQuery(visibleReadPanel.query.trim()) || (visibleReadPanel.source === 'saved' && !visibleReadPanel.page && visibleReadPanel.status !== 'error') ? 'startReadSearch' : 'noReadPageMatches')}</Text>}
          {visibleReadPanel.source === 'saved' && visibleReadPanel.page && <View style={styles.wrapRow}>
            {!!visibleReadPanel.page.previous.length && <Pressable style={[styles.button,styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={t('previousReadPage')} disabled={blocked('searchLocalMessages')} onPress={() => {void searchReadPanel('previous');}}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('previousReadPage')}</Text></Pressable>}
            {visibleReadPanel.page.result.nextBeforeMessageId !== null && <Pressable style={[styles.button,styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={t('nextReadPage')} disabled={blocked('searchLocalMessages')} onPress={() => {void searchReadPanel('next');}}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('nextReadPage')}</Text></Pressable>}
          </View>}
        </>}
      </ScrollView>
    </>}
  </View> : null;
  const chats = <View style={wide ? styles.split : styles.pane}>
    {(wide || !mobileConversation) && <View style={wide ? styles.listPane : styles.pane}>
      <View style={[styles.paneTop, !wide && styles.mobileChatTop]}><View style={styles.row}><Text style={[styles.title,styles.grow,!wide && styles.mobileChatTitle]}>{t('chats')}</Text><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('openLocalSearch')} onPress={() => openReadPanel('global')}><Search size={21} color={colors.link} /></Pressable></View>{wide && !ready && nav(false)}{searchBox('search', search, changeHistoryQuery, (locale === 'zh-Hant' ? '搜索對話或本機訊息' : locale === 'zh' ? '搜索会话或本地消息' : 'Search conversations or local messages'))}
        {!!search.trim() && <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '搜索已保存的訊息' : locale === 'zh' ? '搜索已保存的消息' : 'Search saved messages')}
          disabled={blocked('searchLocalMessages') || !validProductSearchQuery(search.trim())} accessibilityState={{disabled: blocked('searchLocalMessages') || !validProductSearchQuery(search.trim())}}
          onPress={() => {void searchSavedMessages();}} style={[styles.button, styles.buttonSecondary]}>
          <Text style={[styles.buttonText, styles.buttonSecondaryText]}>{(locale === 'zh-Hant' ? '搜索已保存的訊息' : locale === 'zh' ? '搜索已保存的消息' : 'Search saved messages')}</Text>
        </Pressable>}
        {searchingSaved && <ActivityIndicator accessibilityLabel={(locale === 'zh-Hant' ? '正在搜索已保存的訊息' : locale === 'zh' ? '正在搜索已保存的消息' : 'Searching saved messages')} />}
</View>
      {ready && !wide && !ready.conversations.length && !query && !visibleSavedSearch ? <View style={styles.empty}>
        <View style={[styles.medallion, styles.mobileEmptyIcon]}><MessageCircle size={28} color={colors.muted} strokeWidth={1.7} /></View>
        <View style={styles.emptyCopy}>
          <Text style={[styles.title, styles.centered]}>{locale === 'zh-Hant' ? '還沒有會話' : locale === 'zh' ? '还没有会话' : 'No conversations yet'}</Text>
          <Text style={[styles.text, styles.centered]}>{locale === 'zh-Hant' ? '新增好友，等會話就緒後就可以聊天。' : locale === 'zh' ? '添加好友，等会话就绪后就可以聊天。' : 'Add a friend and wait for the conversation to become available.'}</Text>
        </View>
        <Pressable style={styles.button} accessibilityRole="button" accessibilityLabel={t('addFriend')} onPress={() => {
          if (!flow.active || ownerIsClosing() || controller.getSnapshot().snapshot !== ready) return;
          select('friends');
          if (entryDraftReadable) setDialog(true);
        }}><Text style={styles.buttonText}>{t('addFriend')}</Text></Pressable>
      </View> : ready ? <ScrollView>{matchingConversations.map((item, index) =>
        <Pressable key={item.id} disabled={blocked('openConversation')} accessibilityRole="button" accessibilityLabel={item.title}
          accessibilityState={{disabled: blocked('openConversation'), selected: wide && conversationId === item.id}}
          style={[wide ? styles.listRow : styles.mobileChatRow, wide && conversationId === item.id && desktopChatStyles.selectedConversation, wide && conversationId === item.id && {backgroundColor: colors.selected}]}
          onPress={() => {void openChat(item.id);}}>
          <View style={[styles.row, !wide && styles.mobileChatRowContent]}><View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(item.title.trim())[0]?.toLocaleUpperCase() ?? "YNX"}</Text></View>
            {wide ? <View style={styles.grow}><Text numberOfLines={1} style={styles.strong}>{item.title}</Text><Text numberOfLines={1} style={styles.caption}>{item.preview}</Text></View> : <View style={[styles.mobileChatRowText, index === matchingConversations.length - 1 && {borderBottomWidth: 0}]}>
              <View style={styles.mobileChatRowBody}>
                <Text numberOfLines={1} style={[styles.strong, styles.grow, styles.mobileChatName]}>{item.title}</Text>
                {item.unreadCount > 0 && <View style={styles.chatUnread} accessibilityLabel={(locale === 'zh-Hant' ? `${item.unreadCount} 條未讀訊息` : locale === 'zh' ? `${item.unreadCount} 条未读消息` : `${item.unreadCount} unread messages`)}><Text style={styles.chatUnreadText}>{item.unreadCount}</Text></View>}
              </View>
              <Text numberOfLines={1} style={[styles.caption, styles.mobileChatPreview]}>{item.preview}</Text>
            </View>}
            {wide && item.unreadCount > 0 && <View style={[desktopChatStyles.unread, {backgroundColor: mode === "dark" ? "#5B85FF" : "#002FA7"}]} accessibilityLabel={(locale === 'zh-Hant' ? `${item.unreadCount} 條未讀訊息` : locale === 'zh' ? `${item.unreadCount} 条未读消息` : `${item.unreadCount} unread messages`)}><Text style={desktopChatStyles.unreadText}>{item.unreadCount}</Text></View>}
          </View>
        </Pressable>)}
        {visibleSavedSearch && <View style={styles.paneTop}>
          <Text style={styles.strong}>{(locale === 'zh-Hant' ? '已保存的訊息結果' : locale === 'zh' ? '已保存的消息结果' : 'Saved message results')}</Text>
          <Text style={styles.caption}>{(locale === 'zh-Hant' ? `第 ${visibleSavedSearch.previous.length + 1} 頁` : locale === 'zh' ? `第 ${visibleSavedSearch.previous.length + 1} 页` : `Page ${visibleSavedSearch.previous.length + 1}`)}</Text>
          {!visibleSavedSearch.result.matches.length && <Text style={styles.text}>{(locale === 'zh-Hant' ? '已保存的訊息中沒有匹配結果。' : locale === 'zh' ? '已保存的消息中没有匹配结果。' : 'No matches in saved messages.')}</Text>}
          {visibleSavedSearch.result.matches.map(item => <Pressable key={item.messageId} accessibilityRole="button"
            accessibilityLabel={(locale === 'zh-Hant' ? `打開已保存的訊息：${item.excerpt}` : locale === 'zh' ? `打开已保存的消息：${item.excerpt}` : `Open saved message: ${item.excerpt}`)} style={styles.listRow}
            disabled={blocked('viewStoredMessage')} accessibilityState={{disabled: blocked('viewStoredMessage')}}
            onPress={() => {void openSavedMessage(visibleSavedSearch, item.messageId, item.conversationId);}}>
            <Text style={styles.strong}>{item.title}</Text><Text numberOfLines={3} style={styles.text}>{item.excerpt}</Text>
          </Pressable>)}
          <View style={styles.row}>
            {!!visibleSavedSearch.previous.length && <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '上一頁搜索結果' : locale === 'zh' ? '上一页搜索结果' : 'Previous saved results')}
              disabled={blocked('searchLocalMessages')} accessibilityState={{disabled: blocked('searchLocalMessages')}} onPress={() => {void searchSavedMessages('previous');}}>
              <Text style={styles.strong}>{(locale === 'zh-Hant' ? '上一頁' : locale === 'zh' ? '上一页' : 'Previous')}</Text>
            </Pressable>}
            {visibleSavedSearch.result.nextBeforeMessageId !== null && <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '下一頁搜索結果' : locale === 'zh' ? '下一页搜索结果' : 'Next saved results')}
              disabled={blocked('searchLocalMessages')} accessibilityState={{disabled: blocked('searchLocalMessages')}} onPress={() => {void searchSavedMessages('next');}}>
              <Text style={styles.strong}>{(locale === 'zh-Hant' ? '下一頁' : locale === 'zh' ? '下一页' : 'Next')}</Text>
            </Pressable>}
          </View>
        </View>}
        {!!query && <View style={styles.paneTop}><Text style={styles.strong}>{(locale === 'zh-Hant' ? '搜索已載入的訊息' : locale === 'zh' ? '搜索已加载的消息' : 'Search loaded messages')}</Text><Text style={styles.caption}>{(locale === 'zh-Hant' ? '僅搜索當前帳戶已顯示的訊息，不代表完整歷史。' : locale === 'zh' ? '仅搜索当前账户已显示的消息，不代表完整历史。' : 'Search covers messages available in this account view, not the full history.')}</Text></View>}
        {matchingMessages.map(message => <Pressable key={message.id} accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? `打開搜索結果：${message.body}` : locale === 'zh' ? `打开搜索结果：${message.body}` : `Open message result: ${message.body}`)} disabled={blocked('viewStoredMessage')} accessibilityState={{disabled: blocked('viewStoredMessage')}} style={styles.listRow}
          onPress={() => {void openChat(message.conversationId, message.id);}}>
          <Text style={styles.strong}>{ready.conversations.find(item => item.id === message.conversationId)?.title}</Text><Text numberOfLines={3} style={styles.text}>{message.body}</Text><Text style={styles.caption}>{message.senderLabel}</Text>
        </Pressable>)}
        {!!query && !matchingMessages.length && !matchingConversations.length && <Text style={[styles.text, styles.paneTop]}>{(locale === 'zh-Hant' ? '已載入的對話和訊息中沒有匹配結果。' : locale === 'zh' ? '已加载的对话和消息中没有匹配结果。' : 'No matches in loaded conversations or messages.')}</Text>}
      </ScrollView> : search ? empty(Search, 'searchResults', 'searchUnavailable') : empty(MessageCircle, 'chatTitle', 'chatDetail')}
    </View>}
    {(wide || mobileConversation || !!readPanel) && <View style={styles.pane}>
      <View style={styles.pane} pointerEvents={chatDetailVisible || !!visibleReadPanel ? 'none' : 'auto'} accessibilityElementsHidden={chatDetailVisible || !!visibleReadPanel} importantForAccessibility={chatDetailVisible || !!visibleReadPanel ? 'no-hide-descendants' : 'auto'} aria-hidden={chatDetailVisible || !!visibleReadPanel}>{conversationPane}</View>
      {wide && visibleReadPanel && <View accessibilityLabel="Local read pane" style={{position: 'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:colors.canvas}}>{readPanelContent}</View>}
      {wide && chatDetailVisible && <View accessibilityLabel="Conversation detail pane" style={{position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.canvas}}>{chatDetailsContent}</View>}
    </View>}
  </View>;

const connectionNotice = snapshot?.kind !== 'AUTHORIZED' ? <View style={styles.compactNotice}>
  <Info size={16} color={colors.warm} /><Text style={[styles.caption, styles.grow]}>{t(statusKey)}</Text>
  <Pressable onPress={() => select('settings')} accessibilityRole="button" accessibilityLabel={t('details')}><Text style={styles.caption}>{t('details')}</Text></Pressable>
</View> : null;
  const currentFriendView = () => {
    const current = controller.getSnapshot();
    if (!ready || !alive.current || AppState.currentState !== 'active' || ownerIsClosing() || !current.active ||
      current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation || activeSection.current !== 'friends' ||
      current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef || current.snapshot.viewRevision !== ready.viewRevision) return null;
    return current.snapshot;
  };
  const openContactDetails = (id: string) => {
    const current = currentFriendView();
    if (!current?.contacts.some(item => item.id === id)) return;
    ++navigationRevision.current; setContactDetail({account: current.accountViewRef, id}); setRequestDetail(null); setFriendPanel('contacts');
  };
  const displayedContact = contactDetail?.account === ready?.accountViewRef ? ready?.contacts.find(item => item.id === contactDetail?.id) : undefined;
  const pageHeader = (title: string, back: () => void) => <View style={styles.detailHeader}><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('back')} onPress={back}><ArrowLeft size={21} color={colors.ink} /></Pressable><Text style={styles.strong}>{title}</Text></View>;
  const changeFriendPanel = (page: typeof friendPanel) => {if (!currentFriendView()) return; ++navigationRevision.current; setFriendPanel(page); setContactDetail(null); setRequestDetail(null);};
  const closeFriendDetail = (kind: 'contact' | 'request') => {if (!currentFriendView()) return; ++navigationRevision.current; if (kind === 'contact') setContactDetail(null); else setRequestDetail(null);};
  const openRequestDetails = (id: string) => {
    const current = currentFriendView();
    if (!current?.contactRequests.some(item => item.id === id)) return;
    ++navigationRevision.current; setRequestDetail({account: current.accountViewRef, id}); setContactDetail(null); setFriendPanel('requests');
  };
  const displayedRequest = requestDetail?.account === ready?.accountViewRef ? ready?.contactRequests.find(item => item.id === requestDetail?.id) : undefined;
  useEffect(() => {
    if (!ready || !requestDetail || displayedRequest) return;
    // A confirmed update can remove the invitation while its details are open.
    // Return to the request list and keep the latest snapshot and operation notices.
    setRequestDetail(current => current === requestDetail ? null : current);
  }, [ready, requestDetail, displayedRequest]);
  const contactOperations = pendingOriginals.filter(item => ['requestContact','acceptContact','rejectContact','blockContact','unblockContact'].includes(item.action)).map(item => <View key={item.localCallId} style={styles.compactNotice}>
      <View style={styles.grow}><Text style={styles.strong}>{t('contactChangeProgress')}</Text><Text style={styles.caption}>{t(item.disposition)}</Text></View>
      {item.originalOperationRef ? pendingReviewButton(item.accountViewRef, item.originalOperationRef, t('checkContactChange')) : <Text style={styles.caption}>{t('reviewRequired')}</Text>}
    </View>);
  const contactQuery = friendSearch.trim().toLocaleLowerCase();
  const directoryContacts = ready?.contacts.filter(item => (item.displayName + ' ' + (item.publicIdentifier ?? '')).toLocaleLowerCase().includes(contactQuery)) ?? [];
  const incomingRequests = ready?.contactRequests.filter(item => item.direction === 'incoming') ?? [];
  const outgoingRequests = ready?.contactRequests.filter(item => item.direction === 'outgoing') ?? [];
  const contactDirectory = <View style={styles.directoryContent}>
    {connectionNotice}
    <View style={styles.row}><Text style={[styles.pageTitle, styles.grow]}>{t('friends')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('addFriend')} style={styles.iconButton} onPress={() => {if (currentFriendView()) setDialog(true);}}><Plus size={23} color={colors.link} /></Pressable></View>
    <View style={styles.directorySearch}>{searchBox('searchFriends', friendSearch, value => {if (currentFriendView()) setFriendSearch(value);})}</View>
    {contactOperations}
    <Pressable accessibilityRole="button" accessibilityLabel={t('requests')} accessibilityState={{selected: friendPanel === 'requests'}} style={styles.preferenceRow} onPress={() => changeFriendPanel('requests')}><Users size={21} color={colors.muted} /><Text style={[styles.text, styles.grow]}>{t('requests')}</Text>{!!incomingRequests.length && <View style={styles.count}><Text style={styles.countText}>{incomingRequests.length}</Text></View>}<ChevronRight size={18} color={colors.muted} /></Pressable>
    <Text style={styles.sectionCaption}>{t('contactsHeading')}</Text>
    {ready ? <>{directoryContacts.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View contact' : locale === 'zh-Hant' ? '查看聯絡人' : '查看联系人'}: ${item.displayName}`} accessibilityState={{selected: contactDetail?.account === ready.accountViewRef && contactDetail.id === item.id}}
      style={[styles.personDirectoryRow, contactDetail?.account === ready.accountViewRef && contactDetail.id === item.id && styles.personDirectorySelected]} onPress={() => openContactDetails(item.id)}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(item.displayName.trim())[0]?.toLocaleUpperCase() ?? ''}</Text></View>
      <View style={styles.personDirectoryText}><Text numberOfLines={1} style={styles.strong}>{item.displayName}</Text><Text numberOfLines={1} style={styles.caption}>{item.publicIdentifier ?? t('publicIdentifierMissing')}</Text></View>
    </Pressable>)}{!directoryContacts.length && <Text style={styles.text}>{t(contactQuery ? 'noContactMatches' : 'noContacts')}</Text>}</> : <Text style={styles.text}>{t('friendsUnavailable')}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('blockedContacts')} accessibilityState={{selected: friendPanel === 'blocked'}} style={styles.preferenceRow} onPress={() => changeFriendPanel('blocked')}><ShieldCheck size={21} color={colors.muted} /><Text style={[styles.text, styles.grow]}>{t('blockedContacts')}</Text><ChevronRight size={18} color={colors.muted} /></Pressable>
  </View>;
  const friends = wide && ready ? <View style={styles.empty}><Users size={34} color={colors.muted} /><Text style={styles.title}>{t('chooseContact')}</Text><Text style={styles.text}>{t('chooseContactDetail')}</Text></View>
    : <ScrollView key="friends" style={styles.pane} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">{contactDirectory}</ScrollView>;
  const acceptDirectoryRequest = (id: string) => {
    const current = currentFriendView();
    if (!current?.contactRequests.some(item => item.id === id && item.direction === 'incoming') || blocked('acceptContact')) return;
    void run({type: 'acceptContact', viewRevision: current.viewRevision, requestId: id});
  };
  const requestRows = (items: NonNullable<typeof ready>['contactRequests']) => items.map(item => <View key={item.id} style={styles.requestPerson}>
      <View style={styles.row}><View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(item.displayName.trim())[0] ?? ''}</Text></View><View style={styles.grow}><Text style={styles.strong}>{item.displayName}</Text><Text selectable={item.publicIdentifier !== null} style={styles.caption}>{item.publicIdentifier ?? t('requestIdentifierMissing')}</Text></View></View>
      {item.direction === 'outgoing' && <Text style={styles.caption}>{t('outgoingRequestHelp')}</Text>}
      <View style={styles.wrapRow}>
        {item.direction === 'incoming' && <><Pressable accessibilityRole="button" accessibilityLabel={`${t('accept')}: ${item.displayName}`} disabled={blocked('acceptContact')} accessibilityState={{disabled: blocked('acceptContact')}} onPress={() => acceptDirectoryRequest(item.id)} style={[styles.button, blocked('acceptContact') && styles.buttonDisabled]}><Text style={[styles.buttonText, blocked('acceptContact') && styles.buttonDisabledText]}>{t('accept')}</Text></Pressable>{contactActionButton('rejectContact','rejectContact',item.id,item.displayName)}</>}
        <Pressable accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View request' : locale === 'zh-Hant' ? '查看請求' : '查看请求'}: ${item.displayName}`} style={[styles.button,styles.buttonSecondary]} onPress={() => openRequestDetails(item.id)}><Text style={[styles.buttonText,styles.buttonSecondaryText]}>{t('details')}</Text></Pressable>
      </View>
    </View>);
  const requestList = <View style={styles.pane}>{pageHeader(t('requests'), () => changeFriendPanel('contacts'))}<ScrollView style={styles.pane} contentContainerStyle={styles.content}>
    {connectionNotice}{!wide && contactOperations}
    {ready ? <>
      <Text style={styles.sectionCaption}>{t('incomingRequestsTitle')}</Text>{requestRows(incomingRequests)}{!incomingRequests.length && <Text style={styles.caption}>{t('noIncomingRequests')}</Text>}
      {!!outgoingRequests.length && <><Text style={styles.sectionCaption}>{t('outgoingRequestsTitle')}</Text>{requestRows(outgoingRequests)}</>}
      {!ready.contactRequests.length && <Text style={styles.text}>{locale === 'en' ? 'No friend requests.' : locale === 'zh-Hant' ? '沒有好友請求。' : '没有好友请求。'}</Text>}
    </> : <Text style={styles.text}>{t('friendsUnavailable')}</Text>}
  </ScrollView></View>;
  const requestDetails = <View style={styles.pane}>{pageHeader(t('requests'), () => closeFriendDetail('request'))}<ScrollView style={styles.pane} contentContainerStyle={styles.content}>
    {!wide && contactOperations}{displayedRequest && ready ? <>
      <View style={styles.profileIdentity}><View style={styles.profileAvatar}><Text style={styles.avatarText}>{Array.from(displayedRequest.displayName.trim())[0] ?? ''}</Text></View><Text style={styles.pageTitle}>{displayedRequest.displayName}</Text></View>
      <Text style={styles.caption}>{t(displayedRequest.direction === 'incoming' ? 'incomingRequestsTitle' : 'outgoingRequestsTitle')}</Text>
      <Text selectable={displayedRequest.publicIdentifier !== null} style={styles.caption}>{displayedRequest.publicIdentifier ?? t('requestIdentifierMissing')}</Text>
      {displayedRequest.direction === 'incoming' ? <>{actionButton('accept', 'acceptContact', () => ({type: 'acceptContact', viewRevision: ready.viewRevision, requestId: displayedRequest.id}))}{contactActionButton('rejectContact', 'rejectContact', displayedRequest.id)}</> : <Text style={styles.text}>{t('outgoingRequestHelp')}</Text>}
      {contactActionButton('blockContact', 'blockContact', displayedRequest.peerAccountId)}
    </> : <Text style={styles.text}>{t('friendsUnavailable')}</Text>}
  </ScrollView></View>;
  const blockedList = <View style={styles.pane}>{pageHeader(t('blockedContacts'), () => changeFriendPanel('contacts'))}<ScrollView style={styles.pane} contentContainerStyle={styles.content}>
    {!wide && contactOperations}{ready ? <>{ready.blockedContacts.map(item => <View key={item.peerAccountId} style={styles.preferenceRow}><View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(item.displayName.trim())[0] ?? ''}</Text></View><Text style={[styles.text, styles.grow]}>{item.displayName}</Text>{contactActionButton('unblockContact', 'unblockContact', item.peerAccountId)}</View>)}{!ready.blockedContacts.length && <Text style={styles.text}>{locale === 'en' ? 'No blocked contacts.' : locale === 'zh-Hant' ? '沒有已封鎖的聯絡人。' : '没有已拉黑的联系人。'}</Text>}</> : <Text style={styles.text}>{t('friendsUnavailable')}</Text>}
  </ScrollView></View>;
  const contactDetails = <View style={styles.pane}>
    <View style={styles.detailHeader}><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => closeFriendDetail('contact')}><ArrowLeft size={21} color={colors.ink} /></Pressable><Text style={styles.strong}>{locale === 'en' ? 'Contact' : locale === 'zh-Hant' ? '聯絡人' : '联系人'}</Text></View>
    <ScrollView style={styles.pane} contentContainerStyle={[styles.content, wide && desktopContactStyles.content]}>
      {displayedContact ? <>
        {!wide && contactOperations}<View style={[styles.profileIdentity, wide && desktopContactStyles.identity]}><View style={[styles.profileAvatar, wide && desktopContactStyles.avatar]}><Text style={styles.avatarText}>{Array.from(displayedContact.displayName.trim())[0] ?? ''}</Text></View><View style={wide ? desktopContactStyles.identityText : styles.grow}><Text style={styles.pageTitle}>{displayedContact.displayName}</Text><Text selectable={displayedContact.publicIdentifier !== null} style={styles.caption}>{displayedContact.publicIdentifier ?? t('publicIdentifierMissing')}</Text></View></View><View style={styles.preferenceRow}><Text style={styles.caption}>{t('publicIdentifierLabel')}</Text><Text selectable={displayedContact.publicIdentifier !== null} style={[styles.text, styles.grow]}>{displayedContact.publicIdentifier ?? t('publicIdentifierMissing')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'Chat with' : '发消息给'} ${displayedContact.displayName}`} disabled={blocked('openConversation') || !displayedContact.conversationId || !ready?.conversations.some(item => item.id === displayedContact.conversationId)} accessibilityState={{disabled: blocked('openConversation') || !displayedContact.conversationId || !ready?.conversations.some(item => item.id === displayedContact.conversationId)}} style={[styles.button, wide && desktopContactStyles.messageButton, (blocked('openConversation') || !displayedContact.conversationId || !ready?.conversations.some(item => item.id === displayedContact.conversationId)) && styles.buttonDisabled]} onPress={() => {void openContact(displayedContact.id, displayedContact.conversationId);}}><Text style={styles.buttonText}>{t('chats')}</Text></Pressable>
        {(!displayedContact.conversationId || !ready?.conversations.some(item => item.id === displayedContact.conversationId)) && <><Text style={styles.text}>{t('conversationWaitingDetail')}</Text><Pressable style={styles.button} accessibilityRole="button" accessibilityLabel={t('refresh')} disabled={busy || !flow.active} accessibilityState={{disabled: busy || !flow.active}} onPress={() => {void refresh();}}><Text style={styles.buttonText}>{t('refresh')}</Text></Pressable></>}
        {contactActionButton('blockContact', 'blockContact', displayedContact.peerAccountId)}
      </> : <Text style={styles.text}>{t('friendsUnavailable')}</Text>}
    </ScrollView>
  </View>;
  const changeMomentPage = (page: typeof momentPage) => {
    if (!currentMomentView()) return;
    ++navigationRevision.current; setMomentPage(page);
  };
  const openMomentDetail = (id: string) => {
    const current = currentMomentView();
    if (!current?.moments.some(item => item.id === id)) return;
    ++navigationRevision.current; setMomentDetail({account: current.accountViewRef, id}); setMomentPage('detail');
  };
  const displayedMoment = momentDetail?.account === ready?.accountViewRef ? ready?.moments.find(item => item.id === momentDetail?.id) : undefined;
  const selectedAudience = ready?.audiences.find(item => item.id === audienceId);
  const momentCard = (item: NonNullable<typeof ready>['moments'][number]) => <View style={styles.card}><View style={styles.feedHeader}><View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(item.authorLabel.trim())[0]?.toLocaleUpperCase() ?? 'YNX'}</Text></View><View style={styles.grow}><Text style={styles.strong}>{item.authorLabel}</Text><Text style={styles.caption}>{item.audienceLabel}</Text></View></View><Text style={styles.text}>{item.body}</Text></View>;
  const momentFeed = <ScrollView key="moments" style={styles.pane} contentContainerStyle={[styles.content, wide && desktopMomentsStyles.content, wide && {backgroundColor: colors.field}]} keyboardShouldPersistTaps="handled">
    {connectionNotice}
    <View style={styles.wrapRow}><Text style={[styles.pageTitle, styles.grow]}>{t('moments')}</Text><Pressable style={[styles.button, !ready && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={t('momentTitle')} disabled={!ready} accessibilityState={{disabled: !ready}} onPress={() => changeMomentPage('compose')}><Plus size={18} color="#FFFFFF" /><Text style={styles.buttonText}>{t('momentTitle')}</Text></Pressable></View>
    {ready?.moments.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View moment' : '查看瞬间'}: ${item.authorLabel}`} onPress={() => openMomentDetail(item.id)}>{momentCard(item)}</Pressable>)}
    {ready && !ready.moments.length && <Text style={styles.text}>{locale === 'en' ? 'No moments to show.' : locale === 'zh-Hant' ? '尚無可顯示的瞬間。' : '暂无可显示的瞬间。'}</Text>}
  </ScrollView>;
  const momentCompose = <View style={styles.pane}>{pageHeader(t('momentTitle'), () => changeMomentPage('feed'))}<ScrollView style={styles.pane} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <TextInput value={entryDraftReadable ? momentBody : ''} onChangeText={editMomentBody} maxLength={productLimits.moment} multiline placeholder={t('momentPlaceholder')} accessibilityLabel={t('momentPlaceholder')} placeholderTextColor={colors.muted} style={[styles.input, {minHeight: 240, textAlignVertical: 'top', flex: 0}]} />
    <Pressable style={styles.preferenceRow} accessibilityRole="button" accessibilityLabel={t('audience')} onPress={() => changeMomentPage('visibility')}><Text style={[styles.text, styles.grow]}>{t('audience')}</Text><Text style={styles.caption}>{selectedAudience?.label ?? t('audienceRequired')}</Text><ChevronRight size={18} color={colors.muted} /></Pressable>
    {actionButton('publish', 'publishMoment', () => ready && selectedAudience ? {type: 'publishMoment', viewRevision: ready.viewRevision, body: momentBody, audienceId: selectedAudience.id} : null, !selectedAudience || !momentBody.trim(), Plus)}
  </ScrollView></View>;
  const momentVisibility = <View style={styles.pane}>{pageHeader(t('audience'), () => changeMomentPage('compose'))}<ScrollView style={styles.pane} contentContainerStyle={styles.content}>
    <Text style={styles.text}>{t('audienceRequired')}</Text>
    {ready?.audiences.map(item => <Pressable key={item.id} style={styles.preferenceRow} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{checked: audienceId === item.id}} onPress={() => selectMomentAudience(item.id)}><Text style={[styles.text, styles.grow]}>{item.label}</Text>{audienceId === item.id && <Check size={18} color={colors.link} />}</Pressable>)}
    <Pressable style={[styles.button, !selectedAudience && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'Use selected audience' : locale === 'zh-Hant' ? '使用選取的範圍' : '使用所选范围'} disabled={!selectedAudience} accessibilityState={{disabled: !selectedAudience}} onPress={() => changeMomentPage('compose')}><Text style={styles.buttonText}>{locale === 'en' ? 'Use selected audience' : locale === 'zh-Hant' ? '使用選取的範圍' : '使用所选范围'}</Text></Pressable>
  </ScrollView></View>;
  const momentDetails = <View style={styles.pane}>{pageHeader(t('moments'), () => changeMomentPage('feed'))}<ScrollView style={styles.pane} contentContainerStyle={styles.content}>{displayedMoment ? momentCard(displayedMoment) : <Text style={styles.text}>{t('connectionTitle')}</Text>}</ScrollView></View>;
  const moments = !entryDraftReadable ? momentFeed : momentPage === 'compose' ? momentCompose : momentPage === 'visibility' ? momentVisibility : momentPage === 'detail' ? momentDetails : momentFeed;
  const recoveryItems = ready?.recoveries ?? (snapshot?.kind === 'RECOVERY_REQUIRED' ? snapshot.items : []);
  const additionalRecoveryOriginals = pendingOriginals.filter(original => !recoveryItems.some(item =>
    item.state !== 'resolved' && original.originalOperationRef !== null && item.originalOperationRef === original.originalOperationRef));
  const canChangeAccessPage = () => {
    const current = controller.getSnapshot();
    return alive.current && AppState.currentState === 'active' && !ownerIsClosing() && current.active &&
      current.snapshot?.kind !== 'AUTHORIZED' && current.epoch === flow.epoch && navigationRevision.current === renderedNavigation;
  };
  const changeAccessPage = (page: typeof accessPage) => {
    if (!canChangeAccessPage()) return;
    ++navigationRevision.current; setAccessPage(page);
  };
  const showLoginControls = section === 'settings' || accessPage === 'identity' || accessPage === 'browser';
  const entryContinueDisabled = localSetupBusy || accountLoginBusy || busy;
  const continueAccountEntry = () => {
    const original = accountLoginGate.getSnapshot();
    if (entryContinueDisabled || !canChangeAccessPage() || controller.getSnapshot().busy ||
      activeEntryIntent.current !== entryIntent || localDeviceSetupGate.isPending() ||
      localAuthenticationGate.getSnapshot().pending || original.pending || original.intent !== null ||
      original.originalState !== 'ABSENT' || !accountLoginGate.canSelectIntent(entryIntent)) return;
    setLocalSetupFeedback(null);
    changeAccessPage('identity'); // Navigation only; the next explicit control owns begin.
  };
  const showDeviceControls = section === 'settings' || accessPage === 'device' || accessPage === 'recovery';
  const entryOption = (item: (typeof entryCapabilities)[number], primary: boolean) => {
    const disabled = localSetupBusy || accountLoginBusy || !accountLoginGate.canSelectIntent(item.intent);
    return <Pressable key={item.intent} accessibilityRole="button" accessibilityLabel={t(item.intent)} disabled={disabled}
      accessibilityState={{selected: entryIntent === item.intent, disabled}}
      onPress={() => { if (disabled || !canChangeAccessPage() || localDeviceSetupGate.isPending() || localAuthenticationGate.getSnapshot().pending || accountLoginGate.getSnapshot().pending || !accountLoginGate.canSelectIntent(item.intent)) return; activeEntryIntent.current = item.intent; setLocalSetupFeedback(null); setEntryIntent(item.intent); changeAccessPage('identity'); }}
      style={primary ? [styles.entryChoice, entryIntent === item.intent && styles.entryChoiceSelected] : styles.linkButton}>
      <Text style={primary ? [styles.entryChoiceText, entryIntent === item.intent && styles.entryChoiceTextSelected] : styles.linkText}>{t(item.intent)}</Text>
    </Pressable>;
  };
  const accountSetup = <>
    {!ready && !localClosing && !uncertainRead && snapshot?.kind !== 'RECOVERY_REQUIRED' && <View style={[styles.card, styles.accountCard]}>
      {(section === 'settings' || accessPage === 'welcome') && <View style={styles.entryChoices}>{entryCapabilities.filter(item => item.intent === 'newIdentityFirstDevice' || item.intent === 'existingIdentityAddDevice').map(item => entryOption(item, true))}</View>}
      {!showLoginControls && accessPage === 'welcome' && entryObserved && accountLoginAttempt.intent === null && <Pressable
        accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'Continue' : locale === 'zh-Hant' ? '繼續' : '继续'}
        disabled={entryContinueDisabled} accessibilityState={{disabled: entryContinueDisabled}}
        onPress={continueAccountEntry} style={[styles.button, entryContinueDisabled && styles.buttonDisabled]}>
        <Text style={[styles.buttonText, entryContinueDisabled && styles.buttonDisabledText]}>{locale === 'en' ? 'Continue' : locale === 'zh-Hant' ? '繼續' : '继续'}</Text>
      </Pressable>}
      {Platform.OS === 'android' ? <AccountLoginPanel intent={entryIntent} locale={locale} disabled={localSetupBusy || busy} controlsVisible={showLoginControls} /> : <>
        <Text style={styles.caption}>{t('entryNotConnected')}</Text>
        {accountBindingInput.status === 'UNAVAILABLE_AUTH_PRODUCER' && <Text style={styles.caption}>{t('authProducerMissing')}</Text>}
      </>}
      {(section === 'settings' || accessPage === 'welcome') && <View style={styles.supportLinks}>{entryCapabilities.filter(item => item.intent === 'restoreIdentity' || item.intent === 'revokedDeviceAttempt').map(item => entryOption(item, false))}</View>}
      {showDeviceControls && Platform.OS === 'android' && entryObserved && !localClosing && localEntry.mode !== 'closed' && entryIntent === 'newIdentityFirstDevice' && <>
        <Pressable accessibilityRole="button" accessibilityLabel={t('deviceSetupOptions')} accessibilityState={{expanded: deviceSetupExpanded}}
          onPress={() => setDeviceSetupExpanded(value => !value)} style={styles.deviceDisclosure}>
          <View style={styles.row}><Smartphone size={18} color={colors.muted} /><Text style={styles.caption}>{t('deviceSetupOptions')}</Text></View><ChevronDown size={18} color={colors.muted} />
        </Pressable>
        {(deviceSetupExpanded || accessPage === 'device' || accessPage === 'recovery') && <View style={styles.deviceSetup}>
          <Text style={styles.text}>{t('prepareLocalDeviceDetail')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('prepareLocalDevice')} disabled={!localEntry.canPrepare || localSetupBusy || accountLoginBusy || busy}
            accessibilityState={{ disabled: !localEntry.canPrepare || localSetupBusy || accountLoginBusy || busy }} onPress={() => void prepareLocalDevice()}
            style={[styles.button, (!localEntry.canPrepare || localSetupBusy || accountLoginBusy || busy) && styles.buttonDisabled]}>
            <Text style={[styles.buttonText, (!localEntry.canPrepare || localSetupBusy || accountLoginBusy || busy) && styles.buttonDisabledText]}>{t(localSetupBusy ? 'preparingLocalDevice' : 'prepareLocalDevice')}</Text>
          </Pressable>
          {localEntry.mode !== 'prepare' && <Text style={styles.caption}>{t(localEntry.mode === 'checking' ? 'localEntryChecking' : localEntry.mode === 'retained' ? 'localEntryRetained' : 'localEntryUnavailable')}</Text>}
          {localSetupFeedback && <Text accessibilityLiveRegion="polite" style={styles.text}>{t(localSetupFeedback)}</Text>}
          <Text style={styles.caption}>{t('loginNotGrant')}</Text>
        </View>}
      </>}
      {diagnostics && entryObserved && <><Text style={styles.text}>{entry.requirements.join('\n')}</Text><Text style={styles.text}>{t('sourceEnrollmentGap')}</Text></>}
    </View>}
  </>;
  const originalLocalControls = <>
    {Platform.OS === 'android' && entryObserved && !localClosing && localEntry.showOriginal && <View style={styles.card}>
      <Text style={styles.strong}>{(locale === 'zh-Hant' ? '繼續設定此裝置' : locale === 'zh' ? '继续设置此设备' : 'Continue setting up this device')}</Text>
      <Text style={styles.text}>{(locale === 'zh-Hant' ? '通過系統螢幕鎖驗證原本機金鑰。這不會登入帳號或批准裝置。' : locale === 'zh' ? '通过系统屏幕锁验证原本机密钥。这不会登录账号或批准设备。' : 'Use the system screen lock to verify the original local keys. This does not sign in or approve a device.')}</Text>
      <Pressable accessibilityRole="button" disabled={localSetupBusy || accountLoginBusy || busy || !!localAuthentication.result && !canContinueLocalAuthentication(localAuthentication.result.status)}
        onPress={inspectLocalDevice} style={styles.button}>
        <Text style={styles.buttonText}>{(locale === 'zh-Hant' ? (localAuthentication.result?.status === 'AUTHENTICATION_PENDING' ? '觀察原驗證' : '驗證此裝置') : locale === 'zh' ? (localAuthentication.result?.status === 'AUTHENTICATION_PENDING' ? '观察原验证' : '验证此设备') : (localAuthentication.result?.status === 'AUTHENTICATION_PENDING' ? 'Observe original verification' : 'Verify this device'))}</Text>
      </Pressable>
      {(localAuthentication.pending || localAuthentication.result) && <Text accessibilityLiveRegion="polite" style={styles.text}>{localAuthenticationCopy[locale][localAuthentication.pending ? 'AUTHENTICATION_PENDING' : localAuthentication.result!.status]}</Text>}
    </View>}
    {Platform.OS === 'android' && entryObserved && !localClosing && localEntry.showOriginal && <LocalRecoveryPanel locale={locale} disabled={localSetupBusy || accountLoginBusy || busy} />}
    {Platform.OS === 'android' && entryObserved && !ready && entryIntent === 'newIdentityFirstDevice' && (!localClosing && localEntry.showOriginal) && <FirstDeviceChallengePanel locale={locale} disabled={localSetupBusy || accountLoginBusy || busy} />}
  </>;
  const accessLocked = snapshot?.kind === 'LOCKED' && !uncertainRead && !localClosing;
  const accessTitles = {
    welcome: t('welcomeTitle'), identity: t(entryIntent),
    browser: locale === 'en' ? 'Continue secure sign-in' : locale === 'zh-Hant' ? '繼續安全登入' : '继续安全登录',
    device: !wide && entryIntent === 'newIdentityFirstDevice'
      ? locale === 'en' ? 'Set up your first device' : locale === 'zh-Hant' ? '設定首台裝置' : '设置首台设备'
      : locale === 'en' ? 'Set up device access' : locale === 'zh-Hant' ? '設定裝置存取權限' : '设置设备访问权限',
    recovery: locale === 'en' ? 'Continue saved device setup' : locale === 'zh-Hant' ? '繼續已儲存的裝置設定' : '继续已保存的设备设置',
  };
  const welcome = <View style={styles.pane}>
    {accessPage !== 'welcome' && !localClosing && pageHeader(accessTitles[accessPage], () => changeAccessPage(accessPage === 'device' ? 'identity' : 'welcome'))}
    <ScrollView key="welcome" style={styles.pane} ref={welcomeScroll} contentContainerStyle={[styles.content, styles.welcomeContent, wide && accessPage === "welcome" && desktopWelcomeStyles.content]} keyboardShouldPersistTaps="handled">
      {wide && accessPage === "welcome" && <DesktopWelcomeBrand mode={mode} />}
      <Text style={[styles.welcomeHeading, wide && accessPage === "welcome" && desktopWelcomeStyles.heading]}>{localClosing ? t('welcomeTitle') : accessLocked ? t('locked') : accessTitles[accessPage]}</Text>
      <Text style={[styles.welcomeSummary, wide && accessPage === "welcome" && desktopWelcomeStyles.summary]}>{localClosing ? (locale === 'en' ? 'Local operations are closed. Messages are hidden and saved records are preserved.' : locale === 'zh-Hant' ? '本機操作已關閉，聊天內容已隱藏，已儲存的記錄仍保留。' : '本机操作已关闭，聊天内容已隐藏，已保存的记录仍保留。') : t('welcomeDetail')}</Text>
      {!wide && accessPage === 'device' && entryIntent === 'newIdentityFirstDevice' && !localClosing && <View style={styles.mobileSetupSteps}>
        {(locale === 'zh-Hant' ? ['身分識別', '本機初始化', '確認聊天就緒'] : locale === 'zh' ? ['身份识别', '本机初始化', '确认聊天就绪'] : ['Identify account', 'Set up this device', 'Check chat readiness']).map((label, index) => {
          const step = accountLoginAttempt.status !== 'ACCOUNT_OBSERVED' ? 0 : localAuthentication.result?.status === 'LOCAL_KEYS_AUTHENTICATED' ? 2 : 1;
          return <View key={label} style={styles.mobileSetupStep} accessibilityState={{selected: index === step}}>
            <View style={[styles.mobileSetupMarker, index < step && styles.mobileSetupMarkerDone, index === step && styles.mobileSetupMarkerActive]}>
              {index < step ? <Check size={15} color={colors.link} /> : <Text style={[styles.caption, index === step && styles.outgoingText]}>{index + 1}</Text>}
            </View><Text style={[styles.strong, styles.grow]}>{label}</Text>
          </View>;
        })}
      </View>}
      {accountSetup}
      {accessPage === 'welcome' && !localClosing && (accountLoginAttempt.originalState === 'UNREAD' || accountLoginAttempt.originalState === 'PENDING') && <Text accessibilityLiveRegion="polite" style={styles.caption}>{locale === 'en' ? 'Checking for a sign-in you can continue…' : locale === 'zh-Hant' ? '正在檢查可繼續的登入…' : '正在检查可继续的登录…'}</Text>}
      {accessPage === 'welcome' && !localClosing && accountLoginAttempt.intent !== null && <Pressable accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'View original sign-in' : locale === 'zh-Hant' ? '查看原登入' : '查看原登录'} style={[styles.button, styles.buttonSecondary]} onPress={() => changeAccessPage(accountLoginAttempt.status === 'ACCOUNT_OBSERVED' ? 'device' : 'browser')}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{locale === 'en' ? 'View original sign-in' : locale === 'zh-Hant' ? '查看原登入' : '查看原登录'}</Text></Pressable>}
      {accessPage === 'welcome' && !localClosing && accountLoginAttempt.originalState === 'UNAVAILABLE' && <Pressable accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'Check saved sign-in' : locale === 'zh-Hant' ? '檢查登入記錄' : '检查登录记录'} style={[styles.button, accountLoginBusy && styles.buttonDisabled]} disabled={accountLoginBusy || busy} accessibilityState={{disabled: accountLoginBusy || busy}} onPress={() => {if (!ownerIsClosing()) void accountLoginGate.recoverOriginal();}}><Text style={styles.buttonText}>{locale === 'en' ? 'Check saved sign-in' : locale === 'zh-Hant' ? '檢查登入記錄' : '检查登录记录'}</Text></Pressable>}
      {accessPage === 'welcome' && !localClosing && entryObserved && localEntry.showOriginal && <Pressable accessibilityRole="button" accessibilityLabel={accessTitles.recovery} style={[styles.button, styles.buttonSecondary]} onPress={() => changeAccessPage('recovery')}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{accessTitles.recovery}</Text></Pressable>}
      {(accessPage === 'device' || accessPage === 'recovery') && <>
        {originalLocalControls}
        <Text style={styles.text}>{deviceObservation ? (locale === 'en' ? 'Device verification has been observed. Chat readiness is checked separately.' : locale === 'zh-Hant' ? '已取得裝置驗證結果，聊天是否就緒仍需單獨確認。' : '已取得设备验证结果，聊天是否就绪仍需单独确认。') : (locale === 'en' ? 'Device access is not confirmed yet.' : locale === 'zh-Hant' ? '裝置存取權限尚未確認。' : '设备访问权限尚未确认。')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('refresh')} style={[styles.button, busy && styles.buttonDisabled]} disabled={busy || !flow.active} accessibilityState={{disabled: busy || !flow.active}} onPress={() => {void refresh();}}><Text style={styles.buttonText}>{t('refresh')}</Text></Pressable>
      </>}
      {(accessPage === 'identity' || accessPage === 'browser') && entryObserved && !localClosing && (accountLoginAttempt.status === 'ACCOUNT_OBSERVED' || localEntry.showOriginal) && <Pressable accessibilityRole="button" accessibilityLabel={accessTitles.device} style={[styles.button, styles.buttonSecondary]} onPress={() => changeAccessPage('device')}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{accessTitles.device}</Text></Pressable>}
      {diagnostics && <Text style={styles.caption}>{t('setupStatusDetail')}</Text>}
    </ScrollView>
  </View>;
  const statusRecoveryHome = <ScrollView key="status-recovery" style={styles.pane} contentContainerStyle={wide ? styles.content : styles.mobileStatusContent}>
    {!wide && <Info size={28} color={colors.muted} strokeWidth={1.7} />}
    <Text style={[styles.pageTitle, !wide && styles.centered]}>{(locale === 'zh-Hant' ? '當前狀態尚未確認' : locale === 'zh' ? '当前状态尚未确认' : 'Current status needs a check')}</Text>
    <Text style={[styles.text, !wide && styles.centered]}>{(locale === 'zh-Hant' ? '暫時無法確認最新狀態。草稿和已有操作記錄仍保留，請檢查當前狀態後繼續。' : locale === 'zh' ? '暂时无法确认最新状态。草稿和已有操作记录仍保留，请检查当前状态后继续。' : 'The latest status could not be confirmed. Your draft and existing operations are retained. Check the current state to continue.')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '檢查當前狀態' : locale === 'zh' ? '检查当前状态' : 'Check current status')} disabled={busy || !flow.active} accessibilityState={{disabled: busy || !flow.active}} style={[styles.button, (busy || !flow.active) && styles.buttonDisabled]}
      onPress={() => {void refresh();}}><Text style={styles.buttonText}>{(locale === 'zh-Hant' ? '檢查當前狀態' : locale === 'zh' ? '检查当前状态' : 'Check current status')}</Text></Pressable>
  </ScrollView>;
  const recoveryHome = <ScrollView key="recovery" style={styles.pane} contentContainerStyle={styles.content}>
    <Text style={styles.pageTitle}>{(locale === 'zh-Hant' ? '繼續上次操作' : locale === 'zh' ? '继续上次操作' : 'Resume the previous operation')}</Text>
    <Text style={styles.text}>{(locale === 'zh-Hant' ? '上次操作的結果需要確認。先檢查保留的記錄，完成後再繼續聊天。' : locale === 'zh' ? '上次操作的结果需要确认。先检查保留的记录，完成后再继续聊天。' : 'The previous operation needs a status check. Check its saved record before continuing to chat.')}</Text>
    {recoveryItems.filter(item => item.state !== 'resolved').map(item => <View key={item.originalOperationRef} style={styles.card}>
      <Text style={styles.strong}>{item.label}</Text>
      <Text style={styles.text}>{t(item.state === 'unknown' ? 'unknown' : 'reviewRequired')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '檢查上次操作' : locale === 'zh' ? '检查上次操作' : 'Check previous operation')} disabled={blocked('reviewRecovery')} accessibilityState={{disabled: blocked('reviewRecovery')}} style={[styles.button, blocked('reviewRecovery') && styles.buttonDisabled]}
        onPress={() => {void run({type: 'reviewRecovery', originalOperationRef: item.originalOperationRef});}}><Text style={styles.buttonText}>{(locale === 'zh-Hant' ? '檢查上次操作' : locale === 'zh' ? '检查上次操作' : 'Check previous operation')}</Text></Pressable>
    </View>)}
    {additionalRecoveryOriginals.map(item => <View key={`retained-${item.localCallId}`} style={styles.card}>
      <Text style={styles.strong}>{t('pendingOriginal')}</Text>
      <Text style={styles.text}>{t(item.resolution === 'aborted' ? 'aborted' : item.disposition)}</Text>
      {item.originalOperationRef ? pendingReviewButton(item.accountViewRef, item.originalOperationRef, t('pendingOriginal')) : null}
      {(!item.originalOperationRef || item.resolution === 'aborted') && <Text style={styles.caption}>{t('reviewRequired')}</Text>}
    </View>)}
    {!recoveryItems.some(item => item.state !== 'resolved') && additionalRecoveryOriginals.length === 0 && <Text style={styles.text}>{(locale === 'zh-Hant' ? '暫時沒有可檢查的記錄。可以重新讀取恢復狀態。' : locale === 'zh' ? '暂时没有可检查的记录。可以重新读取恢复状态。' : 'No reviewable record is available yet. You can check the recovery state again.')}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={(locale === 'zh-Hant' ? '重新檢查恢復狀態' : locale === 'zh' ? '重新检查恢复状态' : 'Check recovery again')} disabled={busy} accessibilityState={{disabled: busy}} style={[styles.button, styles.buttonSecondary, busy && styles.buttonDisabled]}
      onPress={() => {void refresh();}}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{(locale === 'zh-Hant' ? '重新檢查恢復狀態' : locale === 'zh' ? '重新检查恢复状态' : 'Check recovery again')}</Text></Pressable>
  </ScrollView>;
  const languageSettings = <View style={styles.card}><Text style={styles.strong}>{t('language')}</Text><View style={styles.wrapRow}>
      {VEIL_PRODUCT_LOCALES.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={productLocaleName(value)} accessibilityState={{ selected: locale === value }} onPress={() => { languageAnchorPending.current = true; changeLocale(value); settingsScroll.current?.scrollTo({ y: 0, animated: false }); }} style={[styles.languageButton, locale === value && styles.languageSelected]}><View style={styles.row}><Text style={styles.strong}>{productLocaleName(value)}</Text>{locale === value && <Check size={17} color={colors.accent} />}</View></Pressable>)}
    </View>{localeSaveFailed && <Text style={styles.text}>{t('languageSaveFailed')}</Text>}</View>;
  const appearanceSettings = <View style={styles.card}><Text style={styles.strong}>{locale === 'en' ? 'Appearance' : locale === 'zh-Hant' ? '外觀' : '外观'}</Text>
      {(['light', 'dark', 'system'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: preference === value}} accessibilityLabel={value === 'light' ? (locale === 'en' ? 'Light' : '浅色') : value === 'dark' ? (locale === 'en' ? 'Dark' : '深色') : (locale === 'en' ? 'Follow system' : '跟随系统')} style={styles.preferenceRow} onPress={() => {void selectAppearance(value);}}><Text style={[styles.text, styles.grow]}>{value === 'light' ? (locale === 'en' ? 'Light' : locale === 'zh-Hant' ? '淺色' : '浅色') : value === 'dark' ? (locale === 'en' ? 'Dark' : '深色') : (locale === 'en' ? 'Follow system' : locale === 'zh-Hant' ? '跟隨系統' : '跟随系统')}</Text>{preference === value && <Check size={18} color={colors.link} />}</Pressable>)}
      {appearanceSaveFailed && <Text accessibilityLiveRegion="polite" style={styles.text}>{locale === 'en' ? 'This appearance is active, but could not be saved. Select it again to retry.' : locale === 'zh-Hant' ? '外觀已套用，但無法儲存。請重新選擇以重試。' : '外观已应用，但无法保存。请重新选择以重试。'}</Text>}
    </View>;
  const profileSettings = ready ? <>
    <View style={styles.profileIdentity}><View style={styles.profileAvatar}><Text style={styles.avatarText}>{Array.from(ready.profile.displayName.trim())[0] ?? ''}</Text></View><View style={styles.grow}><Text style={styles.pageTitle}>{ready.profile.displayName}</Text><Text selectable style={styles.caption}>{ready.profile.publicIdentifier}</Text></View></View>
    <View style={styles.preferenceRow}><Text style={styles.caption}>{t('displayNameLabel')}</Text><Text style={[styles.text, styles.grow]}>{ready.profile.displayName}</Text></View>
    <View style={styles.preferenceRow}><Text style={styles.caption}>{t('publicIdentifierLabel')}</Text><Text selectable style={[styles.text, styles.grow]}>{ready.profile.publicIdentifier}</Text></View>
    <Text style={styles.caption}>{t('profileReadOnly')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('devices')} style={styles.preferenceRow} onPress={() => openSettingsPage('devices', true)}><Smartphone size={20} color={colors.muted} /><Text style={[styles.text, styles.grow]}>{t('devices')}</Text><ChevronRight size={18} color={colors.muted} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={locale === 'en' ? 'Edit profile' : locale === 'zh-Hant' ? '編輯個人資料' : '编辑个人资料'} style={styles.preferenceRow} onPress={() => openSettingsPage('profile-edit', true)}><Text style={[styles.text, styles.grow]}>{locale === 'en' ? 'Edit profile' : locale === 'zh-Hant' ? '編輯個人資料' : '编辑个人资料'}</Text><ChevronRight size={18} color={colors.muted} /></Pressable>
  </> : <Text style={styles.text}>{t('profileDetail')}</Text>;
  const openDeviceDetail = (id: string) => {
    const current = controller.getSnapshot();
    if (!ready || !current.active || ownerIsClosing() || current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation ||
      current.snapshot?.kind !== 'AUTHORIZED' || current.snapshot.accountViewRef !== ready.accountViewRef || current.snapshot.viewRevision !== ready.viewRevision ||
      !current.snapshot.devices.some(item => item.id === id)) return;
    setSelectedDeviceDetail({account: current.snapshot.accountViewRef, id}); openSettingsPage('device-detail', true);
  };
  const openOperationDetail = (original: string | null, local: number | null) => {
    const current = controller.getSnapshot(), view = current.snapshot;
    if (!currentScope || !current.active || ownerIsClosing() || current.epoch !== flow.epoch || navigationRevision.current !== renderedNavigation ||
      (view?.kind !== 'AUTHORIZED' && view?.kind !== 'RECOVERY_REQUIRED') || view.accountViewRef !== currentScope) return;
    const nativeRows = view.kind === 'AUTHORIZED' ? view.recoveries : view.items;
    const exists = local !== null ? current.pending.some(item => item.accountViewRef === currentScope && item.localCallId === local && item.originalOperationRef === original &&
      (item.resolution === 'unresolved' || (item.resolution === 'aborted' && item.nextStep !== 'new-draft')))
      : original !== null && nativeRows.some(item => item.originalOperationRef === original);
    if (!exists) return;
    setSelectedOperationDetail({account: currentScope, original, local}); openSettingsPage('operation-detail', true);
  };
  const displayedDevice = selectedDeviceDetail?.account === ready?.accountViewRef ? ready?.devices.find(item => item.id === selectedDeviceDetail?.id) : undefined;
  const operationViewReadable = !localClosing && (snapshot?.kind === 'AUTHORIZED' || snapshot?.kind === 'RECOVERY_REQUIRED') && snapshot.accountViewRef === currentScope;
  const visibleOperationPending = operationViewReadable ? pendingOriginals : [];
  const displayedPendingOperation = operationViewReadable && selectedOperationDetail?.account === currentScope ? visibleOperationPending.find(item =>
    selectedOperationDetail.local !== null ? item.localCallId === selectedOperationDetail.local && item.originalOperationRef === selectedOperationDetail.original
      : selectedOperationDetail.original !== null && item.originalOperationRef === selectedOperationDetail.original) : undefined;
  const selectedNativeOperation = operationViewReadable && selectedOperationDetail?.account === currentScope && selectedOperationDetail.original !== null ? recoveryItems.find(item => item.originalOperationRef === selectedOperationDetail.original) : undefined;
  // A resolved read-model row is not evidence settling a retained local HOLD.
  // Only the original review result may release that pending operation.
  const displayedNativeOperation = selectedNativeOperation?.state === 'resolved' && displayedPendingOperation ? undefined : selectedNativeOperation;
  const pendingOperationLabel = (action: VeilProductCommand['type']) => t(action === 'sendMessage' || action === 'sendAttachment' ? 'send' : action === 'requestContact' ? 'request' : action === 'publishMoment' ? 'publish' : action === 'rejectContact' ? 'rejectContact' : action === 'blockContact' ? 'blockContact' : action === 'unblockContact' ? 'unblockContact' : action === 'reviewDevice' ? 'deviceAccessOperation' : 'pendingOriginal');
  const deviceSettings = <>{accountSetup}{originalLocalControls}{card(Smartphone, 'devices', 'deviceDetail', <>
      <OwnDirectoryPanel locale={locale} account={ready?.accountViewRef ?? null} scope={ready ? ready.accountViewRef + ':' + flow.epoch : null} />
      {deviceObservation && <View style={{ gap: 8 }}>
        <Text style={styles.strong}>{(locale === 'zh-Hant' ? '已取得此裝置的驗證結果' : locale === 'zh' ? '已取得此设备的验证结果' : 'Device verification observed')}</Text>
        <Text style={styles.text}>{deviceObservation.device}</Text>
        <Text style={styles.caption}>{sessionObservation
          ? ((locale === 'zh-Hant' ? '已觀察到安全會話。訊息投遞仍在接入中，暫時不能傳送。' : locale === 'zh' ? '已观察到安全会话。消息投递仍在接入中，暂时不能发送。' : 'A secure session was observed. Message delivery is still being connected; sending is unavailable.'))
          : ((locale === 'zh-Hant' ? '這是裝置驗證結果，不代表聊天已就緒。安全會話尚未接通，暫時不能傳送訊息。' : locale === 'zh' ? '这是设备验证结果，不代表聊天已就绪。安全会话尚未接通，暂时不能发送消息。' : 'This is a device verification result, not chat readiness. Secure chat is not connected yet; messages cannot be sent.'))}</Text>
      </View>}
      {ready?.devices.map(item => <View key={item.id} style={styles.wrapRow}><View style={styles.grow}><Text style={styles.strong}>{item.label}</Text><Text style={styles.caption}>{(locale === 'zh-Hant' ? ({approved: '已授權', pending: '等待授權', revoked: '已撤銷'} as const)[item.state] : locale === 'zh' ? ({approved: '已授权', pending: '等待授权', revoked: '已撤销'} as const)[item.state] : ({approved: 'Authorized', pending: 'Awaiting approval', revoked: 'Revoked'} as const)[item.state])}</Text></View><Pressable style={[styles.button, styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View device' : '查看设备'}: ${item.label}`} onPress={() => openDeviceDetail(item.id)}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{t('details')}</Text></Pressable></View>)}
    </>)}</>;
  const deviceDetailSettings = displayedDevice && ready ? <>
    <Text style={styles.pageTitle}>{displayedDevice.label}</Text>
    <Text style={styles.text}>{locale === 'en' ? ({approved: 'Authorized', pending: 'Awaiting approval', revoked: 'Revoked'} as const)[displayedDevice.state] : locale === 'zh-Hant' ? ({approved: '已授權', pending: '等待授權', revoked: '已撤銷'} as const)[displayedDevice.state] : ({approved: '已授权', pending: '等待授权', revoked: '已撤销'} as const)[displayedDevice.state]}</Text>
    <Text style={styles.caption}>{locale === 'en' ? 'Device access and chat readiness are checked separately.' : locale === 'zh-Hant' ? '裝置存取權限與聊天是否就緒會分別確認。' : '设备访问权限与聊天是否就绪会分别确认。'}</Text>
    <Text style={styles.text}>{t(displayedDevice.state === 'revoked' ? 'revokedDeviceAccessDetail' : 'deviceAccessReviewUnavailable')}</Text>
    {pendingOriginals.filter(item => item.accountViewRef === ready.accountViewRef && item.command.type === 'reviewDevice' && item.command.deviceId === displayedDevice.id && item.resolution === 'unresolved').map(item => <View key={item.localCallId} style={styles.preferenceRow}><View style={styles.grow}><Text style={styles.text}>{t('deviceChangePending')}</Text><Text style={styles.caption}>{t(item.disposition)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t('pendingOriginal')} onPress={() => openOperationDetail(item.originalOperationRef, item.localCallId)}><Text style={styles.linkText}>{t('pendingOriginal')}</Text></Pressable></View>)}
  </> : <Text style={styles.text}>{locale === 'en' ? 'This device is not in the current visible list. Return and check the device list again.' : locale === 'zh-Hant' ? '此裝置目前不在可見列表中，請返回重新檢查裝置列表。' : '此设备目前不在可见列表中，请返回重新检查设备列表。'}</Text>;
  const operationSettings = card(LockKeyhole, 'recovery', 'recoveryDetail', <>
    {recoveryItems.map(item => <Pressable key={item.originalOperationRef} style={styles.preferenceRow} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View operation' : '查看操作'}: ${item.label}`} onPress={() => openOperationDetail(item.originalOperationRef, null)}><Text style={[styles.text, styles.grow]}>{item.label}</Text><ChevronRight size={18} color={colors.muted} /></Pressable>)}
    {visibleOperationPending.filter(item => !recoveryItems.some(row => row.originalOperationRef === item.originalOperationRef && row.state !== 'resolved')).map(item => <Pressable key={item.localCallId} style={styles.preferenceRow} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'View retained operation' : '查看保留的操作'}: ${pendingOperationLabel(item.action)}`} onPress={() => openOperationDetail(item.originalOperationRef, item.localCallId)}><View style={styles.grow}><Text style={styles.strong}>{pendingOperationLabel(item.action)}</Text><Text style={styles.caption}>{t(item.resolution === 'aborted' ? 'aborted' : item.disposition)}</Text></View><ChevronRight size={18} color={colors.muted} /></Pressable>)}
    {!recoveryItems.length && !visibleOperationPending.length && <Text style={styles.text}>{locale === 'en' ? 'No operation records are currently visible.' : locale === 'zh-Hant' ? '目前沒有可顯示的操作記錄。' : '目前没有可显示的操作记录。'}</Text>}
  </>);
  const operationDetailSettings = <>
    <Text style={styles.pageTitle}>{displayedNativeOperation?.label ?? (displayedPendingOperation ? pendingOperationLabel(displayedPendingOperation.action) : t('pendingOriginal'))}</Text>
    {displayedNativeOperation || displayedPendingOperation ? <>
      <Text style={styles.text}>{displayedNativeOperation ? (displayedNativeOperation.state === 'resolved' ? (locale === 'en' ? 'This record has been resolved. This does not imply message delivery or read status.' : locale === 'zh-Hant' ? '此記錄已處理；這不代表訊息已送達或已讀。' : '此记录已处理；这不代表消息已送达或已读。') : t(displayedNativeOperation.state === 'unknown' ? 'unknown' : 'reviewRequired')) : t(displayedPendingOperation!.resolution === 'aborted' ? 'aborted' : displayedPendingOperation!.disposition)}</Text>
      <Text style={styles.caption}>{locale === 'en' ? 'Check the existing operation. This will not resend it or create a replacement.' : locale === 'zh-Hant' ? '只檢查原操作，不會重新傳送或建立替代操作。' : '只检查原操作，不会重新发送或创建替代操作。'}</Text>
      {displayedNativeOperation ? displayedNativeOperation.state !== 'resolved' && actionButton('pendingOriginal', 'reviewRecovery', () => ({type: 'reviewRecovery', originalOperationRef: displayedNativeOperation.originalOperationRef})) : displayedPendingOperation?.originalOperationRef ? pendingReviewButton(displayedPendingOperation.accountViewRef, displayedPendingOperation.originalOperationRef, t('pendingOriginal')) : <Text style={styles.text}>{locale === 'en' ? 'This record cannot be checked yet. Its contents are retained. Check the current state again later.' : locale === 'zh-Hant' ? '這條記錄暫時無法檢查，已有內容仍保留，請稍後重新讀取狀態。' : '这条记录暂时无法检查，已有内容仍保留，请稍后重新读取状态。'}</Text>}
    </> : <Text style={styles.text}>{locale === 'en' ? 'The record is no longer visible in this view. Return to the list and check its current state; no outcome is inferred.' : locale === 'zh-Hant' ? '此視圖目前無法顯示原記錄，請返回列表檢查最新狀態；尚未推斷操作結果。' : '此视图目前无法显示原记录，请返回列表检查最新状态；尚未推断操作结果。'}</Text>}
  </>;
  const closeLocalSettings = Platform.OS === 'android' && <OwnerLifecyclePanel locale={locale} disabled={localSetupBusy || accountLoginBusy || busy} />;
  const aiSettings = card(Sparkles, 'localAi', 'aiDetail', actionButton(ready?.localAi === 'on' ? 'aiDisable' : 'aiEnable', 'setLocalAi', () => ready ? { type: 'setLocalAi', viewRevision: ready.viewRevision, preference: ready.localAi === 'on' ? 'off' : 'on' } : null, ready?.localAi === 'unsupported'));
  const diagnosticSettings = <View style={styles.card}><View style={styles.wrapRow}><Text style={[styles.strong, styles.grow]}>{t('availability')}</Text>{badge}</View>
      {snapshot?.kind === 'UNAVAILABLE' && snapshot.localOwner && <Text style={styles.text}>{t(snapshot.localOwner.status === 'OBSERVED' ? (snapshot.localOwner.failureRetained || snapshot.localOwner.ownerState === 'INIT_FAILED' ? 'ownerReadFailed' : 'ownerObserved') : snapshot.localOwner.status === 'READ_TIMEOUT' ? 'ownerReadTimeout' : snapshot.localOwner.status === 'MODULE_UNAVAILABLE' ? 'ownerMissing' : 'ownerReadFailed')}</Text>}
      <Pressable onPress={() => void refresh()} disabled={busy} accessibilityRole="button" accessibilityLabel={t('refresh')} style={styles.button}><Text style={styles.buttonText}>{t('refresh')}</Text></Pressable>
      <Pressable onPress={() => setDiagnostics(value => !value)} accessibilityRole="button" accessibilityLabel={t('diagnostics')}><Text style={styles.text}>{t('diagnostics')}</Text></Pressable>
      {diagnostics && snapshot?.kind === 'UNAVAILABLE' && <>
        <Text style={styles.text}>{snapshot.gaps.join('\n')}</Text>
        {snapshot.localOwner && <Text style={styles.text}>{JSON.stringify(snapshot.localOwner)}</Text>}
        <Text style={styles.text}>{t('nativeDependencyGap')}</Text>
        {([['nativeGap', 'nativeGapDetail'], ['issuerGap', 'issuerGapDetail'], ['storeGap', 'storeGapDetail'], ['restoreGap', 'restoreGapDetail']] as const).map(([title, detail]) => <View key={title}><Text style={styles.strong}>{t(title)}</Text><Text style={styles.text}>{t(detail)}</Text></View>)}
      </>}
    </View>;
  const settingsNames = {
    'device-detail': locale === 'en' ? 'Device details' : locale === 'zh-Hant' ? '裝置詳情' : '设备详情',
    'operation-detail': locale === 'en' ? 'Operation details' : locale === 'zh-Hant' ? '操作詳情' : '操作详情',
    appearance: locale === 'en' ? 'Appearance' : locale === 'zh-Hant' ? '外觀' : '外观',
    language: t('language'), profile: t('profile'), devices: t('devices'), operations: t('recovery'),
    privacy: locale === 'en' ? 'Privacy' : locale === 'zh-Hant' ? '隱私' : '隐私',
    help: locale === 'en' ? 'Help' : locale === 'zh-Hant' ? '說明' : '帮助',
    diagnostics: t('diagnostics'), 'close-local': locale === 'en' ? 'Close local operations' : locale === 'zh-Hant' ? '關閉本機操作' : '关闭本机操作',
    'local-ai': t('localAi'), account: locale === 'en' ? 'Account access' : locale === 'zh-Hant' ? '帳戶存取' : '账户访问',
  };
  const canNavigateSettings = () => {
    const current = controller.getSnapshot();
    return alive.current && AppState.currentState === 'active' && current.active && current.epoch === flow.epoch &&
      navigationRevision.current === renderedNavigation && activeSection.current === 'settings' && current.snapshot === snapshot;
  };
  const openSettingsPage = (page: SettingsPage, fromDetail = false) => {
    if (!canNavigateSettings()) return;
    if (fromDetail && settingsPage) settingsHistory.current.push(settingsPage); else settingsHistory.current = [];
    ++navigationRevision.current; setSettingsPage(page);
  };
  const backSettingsPage = () => {
    if (!canNavigateSettings()) return;
    ++navigationRevision.current;
    setSettingsPage(settingsHistory.current.pop() ?? (settingsPage === 'device-detail' ? 'devices' : settingsPage === 'operation-detail' ? 'operations' : settingsPage === 'backup-export' || settingsPage === 'backup-import' || settingsPage === 'identity-recovery' ? 'backup' : null));
  };
  const settingsLink = (page: SettingsPage, label: string, fromDetail = false) => <Pressable key={page} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected: settingsPage === page}} style={styles.preferenceRow} onPress={() => openSettingsPage(page, fromDetail)}><Text style={[styles.text, styles.grow]}>{label}</Text><ChevronRight size={18} color={colors.muted} /></Pressable>;
  const unavailablePage = unavailableFeatures.find(item => item.id === settingsPage);
  const settingsMenuContent = <>
        <Text style={styles.pageTitle}>{t('settings')}</Text>
        {ready ? <Pressable style={styles.profileIdentity} accessibilityRole="button" accessibilityLabel={t('profile')} onPress={() => openSettingsPage('profile')}><View style={styles.avatar}><Text style={styles.avatarText}>{Array.from(ready.profile.displayName.trim())[0] ?? ''}</Text></View><View style={styles.grow}><Text style={styles.strong}>{ready.profile.displayName}</Text><Text style={styles.caption}>{t('profile')}</Text></View><ChevronRight size={18} color={colors.muted} /></Pressable> : settingsLink('profile', settingsNames.profile)}
        <Text style={styles.sectionCaption}>{t('preferencesSection')}</Text>
        {(['appearance','language'] as const).map(page => settingsLink(page,settingsNames[page]))}
        <Text style={styles.sectionCaption}>{t('accessSection')}</Text>
        {(['devices','account','operations','privacy','local-ai'] as const).map(page => settingsLink(page,settingsNames[page]))}
        {unavailableFeatures.filter(item => ['backup','connection','device-revoke','sync-conflict','logout'].includes(item.id)).map(item => settingsLink(item.id, locale === 'en' ? item.en : item.zh))}
        <Text style={styles.sectionCaption}>{t('supportSection')}</Text>
        {settingsLink('help',settingsNames.help)}{settingsLink('close-local',settingsNames['close-local'])}
      </>;
  const settings = <View key="settings" style={styles.pane}>
    {(settingsPage || (wide && ready)) && <View style={styles.detailHeader}>{settingsPage && <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('back')} onPress={backSettingsPage}><ArrowLeft size={21} color={colors.ink} /></Pressable>}<Text style={styles.strong}>{unavailablePage ? (locale === 'en' ? unavailablePage.en : unavailablePage.zh) : settingsPage ? (settingsNames[settingsPage as keyof typeof settingsNames] ?? t('settings')) : t('profile')}</Text></View>}
    <ScrollView ref={settingsScroll} style={styles.pane} contentContainerStyle={[styles.content, styles.settingsContent]} keyboardShouldPersistTaps="handled" onContentSizeChange={() => {if (languageAnchorPending.current) {settingsScroll.current?.scrollTo({y: 0, animated: false}); languageAnchorPending.current = false;}}}>
      {!settingsPage ? (wide && ready ? profileSettings : settingsMenuContent) : settingsPage === 'appearance' ? appearanceSettings : settingsPage === 'language' ? languageSettings : settingsPage === 'profile' ? profileSettings : settingsPage === 'devices' ? deviceSettings : settingsPage === 'device-detail' ? deviceDetailSettings : settingsPage === 'operations' ? operationSettings : settingsPage === 'operation-detail' ? operationDetailSettings : settingsPage === 'close-local' ? closeLocalSettings : settingsPage === 'local-ai' ? aiSettings : settingsPage === 'account' ? <>{accountSetup}{originalLocalControls}</> : settingsPage === 'diagnostics' ? diagnosticSettings : settingsPage === 'privacy' ? <Text style={styles.text}>{t('privacy')}</Text> : settingsPage === 'help' ? <>{settingsLink('account', settingsNames.account)}{settingsLink('operations', settingsNames.operations)}{settingsLink('close-local', settingsNames['close-local'])}{settingsLink('diagnostics', settingsNames.diagnostics)}</> : unavailablePage ? <>
        <Text style={styles.pageTitle}>{locale === 'en' ? unavailablePage.en : unavailablePage.zh}</Text>
        <Text style={styles.text}>{locale === 'en' ? unavailablePage.reasonEn : unavailablePage.reasonZh}</Text>
        {settingsPage === 'backup' && unavailableFeatures.filter(item => ['backup-export', 'backup-import', 'identity-recovery'].includes(item.id)).map(item => settingsLink(item.id, locale === 'en' ? item.en : item.zh, true))}
      </> : null}
    </ScrollView>
  </View>;
  const contactDialogVisible = dialog && entryDraftReadable && flow.active && !localClosing && !uncertainRead;
  return <SafeAreaProvider><SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}><StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.canvas} /><KeyboardAvoidingView style={styles.pane} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    {!ready && <><View style={[styles.header, keyboardVisible && styles.keyboardHeader]}><Image source={require('../assets/ynx-original-logo.png')} accessibilityLabel="YNX" resizeMode="contain" style={styles.logo} /><View style={styles.grow}><Text style={styles.brand}>{t('product')}</Text></View>{busy || !snapshot ? <ActivityIndicator color={colors.accent} /> : <Pressable onPress={() => select('settings')} accessibilityRole="button" accessibilityLabel={t('openSettings')} hitSlop={12}><Settings size={22} color={colors.ink} /></Pressable>}</View></>}
    <View style={[styles.body, wide && styles.desktop]}>{wide && !!ready && <DesktopRail section={section} mode={mode} onSelectSection={select}
      labels={{chats: t("chats"), friends: t("friends"), moments: t("moments"), settings: t("settings")}} />}{wide && (section === "friends" || section === "settings") && ready && <View style={styles.listPane}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={section === 'friends' ? undefined : {paddingHorizontal: 18, paddingVertical: 16}}>
      {section === 'settings' ? settingsMenuContent : section === 'friends' ? contactDirectory : <><Text style={styles.title}>{t('moments')}</Text><Text style={styles.caption}>{t('momentDetail')}</Text></>}
    </ScrollView></View>}<View style={[styles.workspace, wide && section === "moments" && {backgroundColor: colors.field}]}>
      {(flow.error || feedback || reviewFeedback) && <View style={styles.feedback} accessibilityLiveRegion="polite"><Text style={styles.text}>{flow.error || feedback ? t(flow.error ? errorCopy[flow.error] : feedback!) : reviewFeedback === 'new-draft'
        ? ((locale === 'zh-Hant' ? '上次操作已終止，可以重新編輯後傳送。' : locale === 'zh' ? '上次操作已终止，可以重新编辑后发送。' : 'The previous operation was stopped. You can edit the draft and send again.'))
        : ((locale === 'zh-Hant' ? '上次操作已終止，仍需繼續檢查保留的記錄。' : locale === 'zh' ? '上次操作已终止，仍需继续检查保留的记录。' : 'The previous operation was stopped. Its saved record still needs review.'))}</Text></View>}
      {section === 'chats' ? (ready ? chats : snapshot?.kind === 'RECOVERY_REQUIRED' && !localClosing ? recoveryHome : uncertainRead ? statusRecoveryHome : welcome) : section === 'friends' ? ((displayedRequest || (!ready && requestDetail)) ? requestDetails : contactDetail ? contactDetails : friendPanel === 'requests' ? requestList : friendPanel === 'blocked' ? blockedList : friends) : section === 'moments' ? moments : settings}
    </View></View>{!wide && !!ready && !keyboardVisible && !readPanel && !mobileConversation && !settingsPage && !contactDetail && !requestDetail && (section !== 'friends' || friendPanel === 'contacts') && (section !== 'moments' || momentPage === 'feed') && nav(true)}
    </KeyboardAvoidingView>
    <Modal visible={contactDialogVisible} transparent animationType="fade" onRequestClose={dismissDialog}>{contactDialogVisible && <KeyboardAvoidingView style={styles.dialogShade} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView style={{ width: '100%', maxWidth: 480 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled"><View style={styles.dialog} accessibilityViewIsModal>
      <View style={styles.row}><Text style={[styles.title, styles.grow]}>{t('addFriend')}</Text><Pressable onPress={dismissDialog} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={12}><X size={23} color={colors.muted} /></Pressable></View>
      <Text style={styles.text}>{t('friendsDetail')}</Text>
      <View style={styles.search}><TextInput value={entryDraftReadable ? identifier : ''} onChangeText={editIdentifier} maxLength={productLimits.identifier} accessibilityLabel={t('identifier')} placeholder={t('requestDraft')} placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" /></View>
      {!ready && <Text style={styles.text}>{t('friendsUnavailable')}</Text>}
      {actionButton('request', 'requestContact', () => ready ? { type: 'requestContact', viewRevision: ready.viewRevision, identifier } : null, !identifier.trim())}
      <Pressable onPress={dismissDialog} accessibilityRole="button" accessibilityLabel={t('cancel')}><Text style={[styles.strong, styles.centered]}>{t('cancel')}</Text></Pressable>
    </View></ScrollView></KeyboardAvoidingView>}</Modal>
    <Modal visible={contactConfirmationVisible} transparent animationType="fade" onRequestClose={closeContactConfirmation}>
      {contactConfirmation && <View style={styles.dialogShade}><View style={styles.dialog} accessibilityViewIsModal>
        <Text style={styles.title}>{t(contactConfirmation.action)}</Text><Text style={styles.strong}>{confirmationName ?? ''}</Text>
        <Text style={styles.text}>{t(contactConfirmation.action === 'rejectContact' ? 'rejectContactDetail' : contactConfirmation.action === 'blockContact' ? 'blockContactDetail' : 'unblockContactDetail')}</Text>
        <Pressable style={[styles.button, blocked(contactConfirmation.action) && styles.buttonDisabled]} accessibilityRole="button" accessibilityLabel={`${locale === 'en' ? 'Confirm' : locale === 'zh-Hant' ? '確認' : '确认'} ${t(contactConfirmation.action)}`} disabled={blocked(contactConfirmation.action)} accessibilityState={{disabled: blocked(contactConfirmation.action)}} onPress={confirmContactChange}><Text style={styles.buttonText}>{t(contactConfirmation.action)}</Text></Pressable>
        <Pressable style={[styles.button, styles.buttonSecondary]} accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={closeContactConfirmation}><Text style={[styles.buttonText, styles.buttonSecondaryText]}>{t('cancel')}</Text></Pressable>
      </View></View>}
    </Modal>
    <Modal visible={!wide && !!visibleReadPanel} presentationStyle="fullScreen" animationType="slide" onRequestClose={closeReadPanel}>{!wide && visibleReadPanel && <SafeAreaView style={styles.root} edges={['top','bottom','left','right']}>{readPanelContent}</SafeAreaView>}</Modal>
    <Modal visible={!wide && chatDetailVisible} presentationStyle="fullScreen" animationType="slide" onRequestClose={closeChatDetails}>
      {!wide && chatDetailVisible && <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>{chatDetailsContent}</SafeAreaView>}
    </Modal>
  </SafeAreaView></SafeAreaProvider>;
}
