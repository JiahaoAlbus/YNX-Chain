import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, ChevronRight, Copy, Fingerprint, RefreshCw, Send, Share2, ShieldCheck, Trash2, UserRound, X } from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import {
  broadcastNativeTransfer,
  fetchNativeAccount,
  fetchNativeTransaction,
  fetchNativeWalletSnapshot,
  trackNativeTransferFinality,
  type BroadcastResult,
  type FinalityResult,
  type NativeTransaction,
  type NativeWalletSnapshot,
} from "../api/nativeWallet";
import {
  addressIdentity,
  createNativeTransferPreview,
  signNativeTransfer,
  type NativeTransferPreview,
  type YNXIdentity,
} from "../crypto/ynxSigner";
import { authorizeLocalKeyUse } from "../security/localAuthorization";
import type { StoredIdentity } from "../storage/secureIdentity";

const BLUE = "#002FA7";
const INK = "#111827";
const MUTED = "#667085";
const LINE = "#E5E7EB";

type SendResult = Readonly<{
  broadcast: BroadcastResult | null;
  finality: FinalityResult;
  recoveredAfterUnknownBroadcast: boolean;
}>;

type WalletRoute = "assets" | "activity" | "account";

export function NativeWalletDashboard(props: { stored: StoredIdentity; identity: YNXIdentity; removing: boolean; onRemove: () => void }) {
  const [snapshot, setSnapshot] = useState<NativeWalletSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<NativeTransferPreview | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [route, setRoute] = useState<WalletRoute>("assets");

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      setSnapshot(await fetchNativeWalletSnapshot(props.identity.account));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [props.identity.account]);

  useEffect(() => { void load(); }, [load]);

  const receiveURI = useMemo(() => `ynx:${props.identity.account}?chainId=6423&asset=YNXT`, [props.identity.account]);

  const copyAddress = async () => {
    await Clipboard.setStringAsync(props.identity.account);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };

  const shareAddress = async () => {
    await Share.share({ title: "YNX Testnet address", message: `YNX Testnet YNXT receive address\n${props.identity.account}\nChain ID 6423` });
  };

  const openSend = () => {
    setRecipient("");
    setAmount("");
    setPreview(null);
    setSendResult(null);
    setSendError(null);
    setSendOpen(true);
  };

  const closeSend = () => {
    if (sending) return;
    setSendOpen(false);
    setRecipient("");
    setAmount("");
    setPreview(null);
    setSendResult(null);
    setSendError(null);
  };

  const reviewTransfer = () => {
    setSendError(null);
    try {
      if (!snapshot?.account.exists) throw new Error("Fund this YNX account before sending YNXT.");
      const parsedAmount = parseWholeYNXT(amount);
      setPreview(createNativeTransferPreview({ from: props.identity.account, to: recipient, amount: parsedAmount, nonce: snapshot.account.nonce + 1, balance: snapshot.account.balance }));
    } catch (error) {
      setPreview(null);
      setSendError(errorMessage(error));
    }
  };

  const submitTransfer = async () => {
    if (!preview || !snapshot) return;
    setSending(true);
    setSendError(null);
    try {
      await authorizeLocalKeyUse("native-transfer");
      const current = await fetchNativeAccount(props.identity.account);
      if (!current.exists) throw new Error("This YNX account is not funded on the public testnet.");
      if (current.nonce !== snapshot.account.nonce || current.balance !== snapshot.account.balance) {
        setSnapshot(Object.freeze({ ...snapshot, account: current, fetchedAt: new Date().toISOString() }));
        setPreview(null);
        throw new Error("Account balance or nonce changed. Review the transfer again with current chain state.");
      }
      const currentPreview = createNativeTransferPreview({ from: props.identity.account, to: preview.to.ynxAddress, amount: preview.amount, nonce: current.nonce + 1, balance: current.balance });
      const signed = signNativeTransfer({ accountSecret: props.stored.accountSecret, preview: currentPreview });
      let broadcast: BroadcastResult | null = null;
      let recoveredAfterUnknownBroadcast = false;
      try {
        broadcast = await broadcastNativeTransfer(signed);
      } catch (broadcastError) {
        try {
          const observed = await fetchNativeTransaction(signed.hash);
          const finality = Object.freeze({ status: observed.blockNumber > 0 ? "confirmed" : "submitted", transaction: observed }) as FinalityResult;
          recoveredAfterUnknownBroadcast = true;
          setSendResult(Object.freeze({ broadcast: null, finality, recoveredAfterUnknownBroadcast }));
          await load(true);
          return;
        } catch {
          throw new Error(`Transfer submission result is unknown. Do not send another transfer until ${signed.hash} is checked in activity or Explorer. ${errorMessage(broadcastError)}`);
        }
      }
      const finality = broadcast.committed
        ? Object.freeze({ status: "confirmed" as const, transaction: broadcast.transaction })
        : await trackNativeTransferFinality(signed.hash);
      setSendResult(Object.freeze({ broadcast, finality, recoveredAfterUnknownBroadcast }));
      await load(true);
    } catch (error) {
      setSendError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  if (loading && !snapshot) return <View style={styles.loading}><ActivityIndicator color={BLUE} /><Text style={styles.muted}>Reading public testnet account state</Text></View>;
  if (!snapshot) return <View style={styles.unavailable}>
    <View style={styles.headingRow}><View><Text style={styles.eyebrow}>YNX NATIVE WALLET</Text><Text style={styles.title}>Assets</Text></View></View>
    <Text style={styles.unavailableTitle}>Account state unavailable</Text>
    <Text style={styles.unavailableText}>{friendlyNetworkError(loadError)}</Text>
    <Pressable onPress={() => void load()} style={styles.retryButton}><RefreshCw color={BLUE} size={18} /><Text style={styles.retryText}>Retry account query</Text></Pressable>
    <Pressable onPress={() => void copyAddress()} style={styles.offlineReceive}>{copied ? <Check color={INK} size={18} /> : <Copy color={INK} size={18} />}<Text style={styles.offlineReceiveText}>{copied ? "Address copied" : "Copy receive address"}</Text></Pressable>
  </View>;

  const balance = snapshot?.account.balance ?? 0;
  const sendEnabled = Boolean(snapshot?.account.exists && balance > 1);
  if (route === "activity") return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <SubrouteHeader eyebrow="WALLET ROUTE" title="Activity" back={() => setRoute("assets")} />
      <Text style={styles.routeMeta}>Latest 100 public network transactions filtered for this account.</Text>
      {!snapshot.activityAvailable ? <View style={styles.emptyActivity}><Text style={styles.emptyTitle}>Activity temporarily unavailable</Text><Text style={styles.muted}>{friendlyNetworkError(snapshot.activityError)}</Text></View> : snapshot.activity.length ? snapshot.activity.map((transaction) => <ActivityRow account={props.identity.evmAddress} key={transaction.hash} transaction={transaction} />) : <View style={styles.emptyActivity}><Text style={styles.emptyTitle}>No matching activity</Text><Text style={styles.muted}>No transfers for this address appear in the latest network window.</Text></View>}
    </ScrollView>
  );
  if (route === "account") return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <SubrouteHeader eyebrow="WALLET ROUTE" title="Account" back={() => setRoute("assets")} />
      <Text style={styles.fieldLabel}>YNX address</Text>
      <Text selectable style={styles.address}>{props.identity.account}</Text>
      <Text style={styles.fieldLabel}>EVM compatibility address</Text>
      <Text selectable style={styles.secondaryAddress}>{props.identity.evmAddress}</Text>
      <View style={styles.securityRow}>
        <Fingerprint color={BLUE} size={21} />
        <View style={styles.securityCopy}><Text style={styles.securityTitle}>Strong biometric authorization</Text><Text style={styles.securityText}>Required before native transfer signatures and account-key operations.</Text></View>
      </View>
      <Pressable disabled={props.removing} onPress={props.onRemove} style={({ pressed }) => [styles.destructiveButton, pressed && styles.pressed]}>
        {props.removing ? <ActivityIndicator color="#B42318" /> : <><Trash2 color="#B42318" size={18} /><Text style={styles.destructiveText}>Remove from this device</Text></>}
      </Pressable>
    </ScrollView>
  );
  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headingRow}>
          <View><Text style={styles.eyebrow}>YNX NATIVE WALLET</Text><Text style={styles.title}>Assets</Text></View>
          <View style={styles.headingActions}>
            <Pressable accessibilityLabel="Open wallet account" onPress={() => setRoute("account")} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><UserRound color={INK} size={19} /></Pressable>
            <Pressable accessibilityLabel="Refresh wallet" disabled={refreshing} onPress={() => void load(true)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>{refreshing ? <ActivityIndicator color={INK} /> : <RefreshCw color={INK} size={19} />}</Pressable>
          </View>
        </View>

        <View style={styles.balancePanel}>
          <Text style={styles.balanceLabel}>Total YNXT</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} style={styles.balance}>{formatYNXT(balance)}</Text>
          <Text style={styles.balanceMeta}>{snapshot?.account.exists ? `Nonce ${snapshot.account.nonce}  ·  Public testnet` : "Unfunded public testnet account"}</Text>
          <View style={styles.actions}>
            <WalletAction icon={ArrowDownLeft} label="Receive" onPress={() => setReceiveOpen(true)} />
            <WalletAction disabled={!sendEnabled} icon={ArrowUpRight} label="Send" onPress={openSend} />
          </View>
        </View>

        {loadError ? <Text style={styles.inlineError}>{friendlyNetworkError(loadError)}</Text> : null}

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Assets</Text><Text style={styles.sectionMeta}>1 asset</Text></View>
        <View style={styles.assetRow}>
          <View style={styles.assetMark}><Text style={styles.assetMarkText}>Y</Text></View>
          <View style={styles.assetCopy}><Text style={styles.assetName}>YNXT</Text><Text style={styles.assetSub}>YNX Chain native coin</Text></View>
          <View style={styles.assetAmount}><Text style={styles.assetValue}>{formatYNXT(balance)}</Text><Text style={styles.assetSub}>YNXT</Text></View>
        </View>

        <View style={styles.statusRows}>
          <StatusRow label="Network fee" value="1 YNXT / native transfer" />
          <StatusRow label="Cross-chain" value="Not active" subdued />
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Recent activity</Text><Pressable accessibilityLabel="Open wallet activity" onPress={() => setRoute("activity")} style={styles.routeLink}><Text style={styles.routeLinkText}>See all</Text><ChevronRight color={BLUE} size={16} /></Pressable></View>
        {!snapshot.activityAvailable ? <View style={styles.emptyActivity}><Text style={styles.emptyTitle}>Activity temporarily unavailable</Text><Text style={styles.muted}>{friendlyNetworkError(snapshot.activityError)}</Text></View> : snapshot.activity.length ? snapshot.activity.slice(0, 3).map((transaction) => <ActivityRow account={props.identity.evmAddress} key={transaction.hash} transaction={transaction} />) : (
          <View style={styles.emptyActivity}><Text style={styles.emptyTitle}>No matching activity</Text><Text style={styles.muted}>No transfers for this address appear in the latest 100 network transactions.</Text></View>
        )}

      </ScrollView>

      <Modal visible={receiveOpen} transparent animationType="slide" onRequestClose={() => setReceiveOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalSheet}>
          <ModalHeader title="Receive YNXT" close={() => setReceiveOpen(false)} />
          <View style={styles.qrWrap}><QRCode value={receiveURI} size={196} color={INK} backgroundColor="#FFFFFF" /></View>
          <Text style={styles.receiveNetwork}>YNX Testnet  ·  Chain ID 6423</Text>
          <Text selectable style={styles.receiveAddress}>{props.identity.account}</Text>
          <View style={styles.receiveActions}>
            <Pressable onPress={() => void copyAddress()} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>{copied ? <Check color={BLUE} size={18} /> : <Copy color={BLUE} size={18} />}<Text style={styles.secondaryActionText}>{copied ? "Copied" : "Copy"}</Text></Pressable>
            <Pressable onPress={() => void shareAddress()} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}><Share2 color={BLUE} size={18} /><Text style={styles.secondaryActionText}>Share</Text></Pressable>
          </View>
        </View></View>
      </Modal>

      <Modal visible={sendOpen} transparent animationType="slide" onRequestClose={closeSend}>
        <View style={styles.modalBackdrop}><View style={styles.modalSheet}>
          <ModalHeader title={sendResult ? "Transfer receipt" : preview ? "Review transfer" : "Send YNXT"} close={closeSend} />
          {sendResult ? <TransferReceipt result={sendResult} /> : preview ? (
            <TransferReview preview={preview} sending={sending} submit={() => void submitTransfer()} back={() => { setPreview(null); setSendError(null); }} />
          ) : (
            <>
              <Text style={styles.inputLabel}>Recipient</Text>
              <TextInput value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} style={styles.textInput} placeholder="ynx1... or 0x..." placeholderTextColor="#98A2B3" />
              <Text style={styles.inputLabel}>Amount</Text>
              <View style={styles.amountInputRow}><TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad" style={styles.amountInput} placeholder="0" placeholderTextColor="#98A2B3" /><Text style={styles.amountUnit}>YNXT</Text></View>
              <View style={styles.feeRow}><Text style={styles.feeLabel}>Network fee</Text><Text style={styles.feeValue}>1 YNXT</Text></View>
              <Pressable disabled={!recipient.trim() || !amount.trim()} onPress={reviewTransfer} style={[styles.primaryButton, (!recipient.trim() || !amount.trim()) && styles.disabled]}><Text style={styles.primaryText}>Review transfer</Text></Pressable>
            </>
          )}
          {sendError ? <Text style={styles.modalError}>{sendError}</Text> : null}
        </View></View>
      </Modal>
    </>
  );
}

function WalletAction({ icon: Icon, label, onPress, disabled = false }: { icon: typeof ArrowDownLeft; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, disabled && styles.actionDisabled, pressed && styles.pressed]}><View style={styles.actionIcon}><Icon color={disabled ? "#98A2B3" : BLUE} size={21} /></View><Text style={[styles.actionText, disabled && styles.actionTextDisabled]}>{label}</Text></Pressable>;
}

function StatusRow({ label, value, subdued = false }: { label: string; value: string; subdued?: boolean }) {
  return <View style={styles.statusRow}><Text style={styles.statusLabel}>{label}</Text><Text style={[styles.statusValue, subdued && styles.subdued]}>{value}</Text></View>;
}

function ActivityRow({ account, transaction }: { account: string; transaction: NativeTransaction }) {
  const outgoing = transaction.from.toLowerCase() === account;
  const counterpart = outgoing ? transaction.to : transaction.from;
  let label = counterpart || transaction.type;
  try { label = addressIdentity(counterpart).ynxAddress; } catch { /* Protocol accounts keep their source label. */ }
  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIcon, outgoing ? styles.outgoingIcon : styles.incomingIcon]}>{outgoing ? <ArrowUpRight color="#B42318" size={18} /> : <ArrowDownLeft color="#067647" size={18} />}</View>
      <View style={styles.activityCopy}><Text style={styles.activityTitle}>{outgoing ? "Sent" : "Received"}</Text><Text numberOfLines={1} style={styles.activityCounterparty}>{shortAddress(label)}</Text><Text style={styles.activityMeta}>{transaction.blockNumber > 0 ? `Block ${transaction.blockNumber}` : "Pending"}  ·  {formatDateTime(transaction.timestamp)}</Text></View>
      <Text style={[styles.activityAmount, outgoing ? styles.outgoingAmount : styles.incomingAmount]}>{outgoing ? "-" : "+"}{formatYNXT(transaction.amount)} YNXT</Text>
    </View>
  );
}

function ModalHeader({ title, close }: { title: string; close: () => void }) {
  return <View style={styles.modalHeader}><Text style={styles.modalTitle}>{title}</Text><Pressable accessibilityLabel="Close" onPress={close} style={styles.iconButton}><X color={INK} size={20} /></Pressable></View>;
}

function SubrouteHeader({ eyebrow, title, back }: { eyebrow: string; title: string; back: () => void }) {
  return <View style={styles.subrouteHeader}><Pressable accessibilityLabel="Back to wallet assets" onPress={back} style={styles.iconButton}><ArrowLeft color={INK} size={20} /></Pressable><View style={styles.subrouteCopy}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.subrouteTitle}>{title}</Text></View></View>;
}

function TransferReview({ preview, sending, submit, back }: { preview: NativeTransferPreview; sending: boolean; submit: () => void; back: () => void }) {
  return <>
    <View style={styles.reviewAmount}><Text style={styles.reviewAmountValue}>{formatYNXT(preview.amount)} YNXT</Text><Text style={styles.muted}>YNX Testnet</Text></View>
    <View style={styles.reviewRows}>
      <StatusRow label="To" value={shortAddress(preview.to.ynxAddress)} />
      <StatusRow label="Network fee" value={`${preview.fee} YNXT`} />
      <StatusRow label="Resource impact" value="1 bandwidth unit" />
      <StatusRow label="Total debit" value={`${preview.total} YNXT`} />
      <StatusRow label="Nonce" value={String(preview.nonce)} />
    </View>
    <View style={styles.confirmationRow}><ShieldCheck color={BLUE} size={20} /><Text style={styles.confirmationText}>Final confirmation requires strong biometrics. The signed request is bound to chain ID 6423.</Text></View>
    <Pressable disabled={sending} onPress={submit} style={[styles.primaryButton, sending && styles.disabled]}>{sending ? <ActivityIndicator color="#FFFFFF" /> : <><Send color="#FFFFFF" size={18} /><Text style={styles.primaryText}>Confirm and send</Text></>}</Pressable>
    <Pressable disabled={sending} onPress={back} style={styles.backButton}><Text style={styles.backText}>Edit details</Text></Pressable>
  </>;
}

function TransferReceipt({ result }: { result: SendResult }) {
  const confirmed = result.finality.status === "confirmed";
  return <View style={styles.receipt}>
    <View style={[styles.receiptIcon, confirmed ? styles.receiptConfirmed : styles.receiptPending]}>{confirmed ? <Check color="#067647" size={28} /> : <RefreshCw color="#B54708" size={25} />}</View>
    <Text style={styles.receiptTitle}>{confirmed ? "Transfer confirmed" : "Transfer submitted"}</Text>
    <Text style={styles.receiptStatus}>{confirmed ? `Included in block ${result.finality.transaction.blockNumber}` : "Block inclusion has not been observed yet."}</Text>
    {result.recoveredAfterUnknownBroadcast ? <Text style={styles.recoveredStatus}>The broadcast response was interrupted, but the transaction was recovered from public RPC by its signed hash.</Text> : null}
    <Text style={styles.hashLabel}>Transaction hash</Text><Text selectable style={styles.hash}>{result.finality.transaction.hash}</Text>
  </View>;
}

function parseWholeYNXT(value: string): number {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) throw new Error("Amount must be a positive whole number of YNXT.");
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw new Error("Amount exceeds the exact mobile transaction range.");
  return parsed;
}

function formatYNXT(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function shortAddress(value: string): string { return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-7)}` : value; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unexpected YNX wallet error"; }
function friendlyNetworkError(value: string | null | undefined): string {
  if (!value) return "Public YNX RPC did not return verified account state.";
  return /cancel|abort|timed? ?out|network request failed|fetch failed/i.test(value) ? "Public YNX RPC timed out. Retry when the network path is available." : value;
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 42 },
  loading: { minHeight: 320, alignItems: "center", justifyContent: "center", gap: 12 },
  unavailable: { flex: 1, padding: 20 }, unavailableTitle: { color: INK, fontSize: 18, fontWeight: "700", marginTop: 48 }, unavailableText: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 8 }, retryButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 8, backgroundColor: "#F5F8FF", borderWidth: 1, borderColor: "#C7D7FE", marginTop: 24 }, retryText: { color: BLUE, fontSize: 14, fontWeight: "700" }, offlineReceive: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 8, borderWidth: 1, borderColor: LINE, marginTop: 10 }, offlineReceiveText: { color: INK, fontSize: 14, fontWeight: "600" },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headingActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  subrouteHeader: { flexDirection: "row", alignItems: "center", gap: 12 }, subrouteCopy: { flex: 1 }, subrouteTitle: { color: INK, fontSize: 25, lineHeight: 31, fontWeight: "700", marginTop: 2 }, routeMeta: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 20, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  eyebrow: { color: BLUE, fontSize: 11, fontWeight: "700", letterSpacing: 0 },
  title: { color: INK, fontSize: 30, lineHeight: 36, fontWeight: "700", marginTop: 3, letterSpacing: 0 },
  iconButton: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  balancePanel: { marginTop: 22, padding: 22, borderRadius: 8, backgroundColor: BLUE },
  balanceLabel: { color: "#DCE6FF", fontSize: 13, fontWeight: "600" },
  balance: { color: "#FFFFFF", fontSize: 40, lineHeight: 48, fontWeight: "700", marginTop: 8, letterSpacing: 0 },
  balanceMeta: { color: "#DCE6FF", fontSize: 12, marginTop: 4 },
  actions: { flexDirection: "row", gap: 28, marginTop: 24 },
  action: { alignItems: "center", gap: 7 }, actionDisabled: { opacity: 0.54 }, actionIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }, actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" }, actionTextDisabled: { color: "#DCE6FF" },
  sectionHeader: { marginTop: 28, marginBottom: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sectionTitle: { color: INK, fontSize: 17, fontWeight: "700" }, sectionMeta: { color: MUTED, fontSize: 11 },
  routeLink: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 2 }, routeLinkText: { color: BLUE, fontSize: 12, fontWeight: "700" },
  assetRow: { minHeight: 74, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, assetMark: { width: 42, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF3FF" }, assetMarkText: { color: BLUE, fontSize: 18, fontWeight: "800" }, assetCopy: { flex: 1, marginLeft: 12 }, assetName: { color: INK, fontSize: 15, fontWeight: "700" }, assetSub: { color: MUTED, fontSize: 11, marginTop: 3 }, assetAmount: { alignItems: "flex-end" }, assetValue: { color: INK, fontSize: 15, fontWeight: "700" },
  statusRows: { marginTop: 10 }, statusRow: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE, gap: 18 }, statusLabel: { color: MUTED, fontSize: 13 }, statusValue: { flexShrink: 1, color: INK, fontSize: 13, fontWeight: "600", textAlign: "right" }, subdued: { color: "#B54708" },
  emptyActivity: { paddingVertical: 26, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE }, emptyTitle: { color: INK, fontSize: 14, fontWeight: "600", marginBottom: 5 }, muted: { color: MUTED, fontSize: 12, lineHeight: 18 },
  activityRow: { minHeight: 82, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, activityIcon: { width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center" }, incomingIcon: { backgroundColor: "#ECFDF3" }, outgoingIcon: { backgroundColor: "#FEF3F2" }, activityCopy: { flex: 1, marginLeft: 11 }, activityTitle: { color: INK, fontSize: 13, fontWeight: "700" }, activityCounterparty: { color: MUTED, fontSize: 11, marginTop: 3 }, activityMeta: { color: "#98A2B3", fontSize: 10, marginTop: 3 }, activityAmount: { maxWidth: "35%", fontSize: 12, fontWeight: "700", textAlign: "right" }, incomingAmount: { color: "#067647" }, outgoingAmount: { color: INK },
  fieldLabel: { color: MUTED, fontSize: 11, fontWeight: "600", marginTop: 24 }, address: { color: INK, fontSize: 14, lineHeight: 21, fontWeight: "600", marginTop: 7 }, secondaryAddress: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 7 },
  securityRow: { marginTop: 22, padding: 15, flexDirection: "row", alignItems: "flex-start", gap: 11, borderWidth: 1, borderColor: "#C7D7FE", borderRadius: 8, backgroundColor: "#F5F8FF" }, securityCopy: { flex: 1 }, securityTitle: { color: INK, fontSize: 13, fontWeight: "700" }, securityText: { color: MUTED, fontSize: 11, lineHeight: 17, marginTop: 3 },
  destructiveButton: { marginTop: 24, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderWidth: 1, borderColor: "#FECDCA", borderRadius: 8 }, destructiveText: { color: "#B42318", fontSize: 14, fontWeight: "600" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.32)" }, modalSheet: { maxHeight: "92%", backgroundColor: "#FFFFFF", padding: 22, paddingBottom: 36, borderTopLeftRadius: 18, borderTopRightRadius: 18 }, modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, modalTitle: { color: INK, fontSize: 22, fontWeight: "700" },
  qrWrap: { alignSelf: "center", padding: 18, marginTop: 22, borderWidth: 1, borderColor: LINE, borderRadius: 8 }, receiveNetwork: { color: MUTED, fontSize: 12, textAlign: "center", marginTop: 18 }, receiveAddress: { color: INK, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 10 }, receiveActions: { flexDirection: "row", gap: 10, marginTop: 20 }, secondaryAction: { flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#C7D7FE", borderRadius: 8, backgroundColor: "#F5F8FF" }, secondaryActionText: { color: BLUE, fontSize: 13, fontWeight: "700" },
  inputLabel: { color: INK, fontSize: 13, fontWeight: "700", marginTop: 21 }, textInput: { height: 50, borderWidth: 1, borderColor: LINE, borderRadius: 8, paddingHorizontal: 14, color: INK, fontSize: 14, marginTop: 9 }, amountInputRow: { height: 58, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: LINE, borderRadius: 8, marginTop: 9 }, amountInput: { flex: 1, height: "100%", paddingHorizontal: 14, color: INK, fontSize: 24, fontWeight: "600" }, amountUnit: { color: INK, fontSize: 14, fontWeight: "700", paddingRight: 14 }, feeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, feeLabel: { color: MUTED, fontSize: 13 }, feeValue: { color: INK, fontSize: 13, fontWeight: "600" },
  primaryButton: { minHeight: 50, borderRadius: 8, backgroundColor: BLUE, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 24 }, primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" }, disabled: { opacity: 0.38 }, backButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 }, backText: { color: BLUE, fontSize: 13, fontWeight: "700" },
  reviewAmount: { alignItems: "center", paddingVertical: 24 }, reviewAmountValue: { color: INK, fontSize: 30, fontWeight: "700" }, reviewRows: { borderTopWidth: 1, borderTopColor: LINE }, confirmationRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, marginTop: 18, borderRadius: 8, backgroundColor: "#F5F8FF" }, confirmationText: { flex: 1, color: MUTED, fontSize: 11, lineHeight: 17 },
  receipt: { alignItems: "center", paddingTop: 28 }, receiptIcon: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center" }, receiptConfirmed: { backgroundColor: "#ECFDF3" }, receiptPending: { backgroundColor: "#FFFAEB" }, receiptTitle: { color: INK, fontSize: 20, fontWeight: "700", marginTop: 16 }, receiptStatus: { color: MUTED, fontSize: 13, marginTop: 7, textAlign: "center" }, recoveredStatus: { color: "#B54708", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 14 }, hashLabel: { color: MUTED, fontSize: 11, marginTop: 24 }, hash: { color: INK, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 7 },
  inlineError: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 14 }, modalError: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: "center" }, pressed: { opacity: 0.62 },
});
