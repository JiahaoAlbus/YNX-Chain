import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ArrowRight, Check, CheckCircle2, ClipboardPaste, Clock3, ReceiptText, RefreshCw, ShieldCheck, WalletCards, X } from "lucide-react-native";
import { YNXMobileAppClient } from "../api/mobileSession";
import { fetchPayInvoice, fetchPaySettlement, type PayInvoice, type PaySettlement } from "../api/pay";
import { broadcastNativeTransfer, fetchNativeAccount, fetchNativeTransaction, trackNativeTransferFinality } from "../api/nativeWallet";
import { createNativeTransferPreview, signNativeTransfer, type YNXIdentity } from "../crypto/ynxSigner";
import { authorizeLocalKeyUse } from "../security/localAuthorization";
import type { StoredIdentity } from "../storage/secureIdentity";

const BLUE = "#002FA7";
const INK = "#111827";
const MUTED = "#667085";
const LINE = "#E5E7EB";

type PendingPayment = Readonly<{ invoice: PayInvoice; transactionHash: string }>;

export function NativePayScreen(props: { stored: StoredIdentity | null; identity: YNXIdentity | null; openWallet: () => void }) {
  const [reference, setReference] = useState("");
  const [invoice, setInvoice] = useState<PayInvoice | null>(null);
  const [settlement, setSettlement] = useState<PaySettlement | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeClient = useRef<YNXMobileAppClient | null>(null);

  useEffect(() => () => activeClient.current?.lock(), []);

  const loadInvoice = async () => {
    setLoading(true);
    setError(null);
    setInvoice(null);
    setSettlement(null);
    setPending(null);
    try {
      const next = await fetchPayInvoice(reference);
      setInvoice(next);
      if (next.status === "paid") {
        try { setSettlement(await fetchPaySettlement(next.id)); } catch (lookupError) { setError(`Invoice is marked paid, but its settlement proof is unavailable. ${message(lookupError)}`); }
      }
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  };

  const pasteReference = async () => {
    const value = await Clipboard.getStringAsync();
    if (value.trim()) setReference(value.trim());
  };

  const pay = async () => {
    if (!invoice || !props.stored || !props.identity) return;
    setPaying(true);
    setError(null);
    let client: YNXMobileAppClient | null = null;
    try {
      assertPayable(invoice);
      client = new YNXMobileAppClient(props.stored);
      activeClient.current = client;
      await client.connect({ registerSquare: false });
      const account = await fetchNativeAccount(props.identity.account);
      if (!account.exists) throw new Error("Fund this YNX account before paying the invoice.");
      const preview = createNativeTransferPreview({ from: props.identity.account, to: invoice.payoutAddress, amount: invoice.amount, nonce: account.nonce + 1, balance: account.balance });
      await authorizeLocalKeyUse("native-transfer");
      const signed = signNativeTransfer({ accountSecret: props.stored.accountSecret, preview });
      let transaction;
      try {
        const broadcast = await broadcastNativeTransfer(signed);
        transaction = broadcast.transaction;
      } catch (broadcastError) {
        try { transaction = await fetchNativeTransaction(signed.hash); } catch { throw new Error(`Payment submission result is unknown. Do not pay again until ${signed.hash} is checked in Explorer. ${message(broadcastError)}`); }
      }
      const finality = transaction.blockNumber > 0 ? { status: "confirmed" as const, transaction } : await trackNativeTransferFinality(signed.hash);
      if (finality.status !== "confirmed") {
        setPending(Object.freeze({ invoice, transactionHash: signed.hash }));
        setReviewOpen(false);
        return;
      }
      setSettlement(await settle(client, invoice, signed.hash));
      setPending(null);
      setReviewOpen(false);
    } catch (paymentError) {
      setError(message(paymentError));
    } finally {
      if (client) {
        try { await client.disconnect(false); } catch { client.lock(); }
      }
      activeClient.current = null;
      setPaying(false);
    }
  };

  const resume = async () => {
    if (!pending || !props.stored) return;
    setPaying(true);
    setError(null);
    let client: YNXMobileAppClient | null = null;
    try {
      const transaction = await fetchNativeTransaction(pending.transactionHash);
      if (transaction.blockNumber === 0) throw new Error("Payment is still waiting for block confirmation.");
      client = new YNXMobileAppClient(props.stored);
      activeClient.current = client;
      await client.connect({ registerSquare: false });
      setSettlement(await settle(client, pending.invoice, pending.transactionHash));
      setPending(null);
    } catch (resumeError) {
      setError(message(resumeError));
    } finally {
      if (client) {
        try { await client.disconnect(false); } catch { client.lock(); }
      }
      activeClient.current = null;
      setPaying(false);
    }
  };

  return <View style={styles.screen}>
    <View style={styles.heading}><View><Text style={styles.eyebrow}>NATIVE YNXT CHECKOUT</Text><Text style={styles.title}>Pay</Text></View><View style={styles.payMark}><ReceiptText color={BLUE} size={22} /></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {settlement ? <Receipt settlement={settlement} onDone={() => { setInvoice(null); setSettlement(null); setReference(""); }} /> : <>
        <Text style={styles.inputLabel}>Invoice</Text>
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="YNX Pay invoice" autoCapitalize="none" autoCorrect={false} onChangeText={setReference} placeholder="Invoice ID or YNX Pay link" placeholderTextColor="#98A2B3" style={styles.input} value={reference} />
          <Pressable accessibilityLabel="Paste invoice" onPress={() => void pasteReference()} style={({ pressed }) => [styles.paste, pressed && styles.pressed]}><ClipboardPaste color={BLUE} size={19} /></Pressable>
        </View>
        <Pressable disabled={loading || !reference.trim()} onPress={() => void loadInvoice()} style={({ pressed }) => [styles.lookup, (!reference.trim() || loading) && styles.disabled, pressed && styles.lookupPressed]}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.lookupText}>Open invoice</Text><ArrowRight color="#FFFFFF" size={18} /></>}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!invoice && !error ? <View style={styles.empty}><ShieldCheck color={BLUE} size={30} strokeWidth={1.6} /><Text style={styles.emptyTitle}>Verified before signing</Text><Text style={styles.emptyText}>YNX checks the native asset, exact amount, payout address, due time, account balance, and chain nonce before a payment can be signed.</Text></View> : null}
        {invoice ? <InvoiceDetails invoice={invoice} /> : null}
        {invoice && !settlement && !pending ? props.stored ? <Pressable disabled={!isPayable(invoice)} onPress={() => { setError(null); setReviewOpen(true); }} style={({ pressed }) => [styles.payButton, !isPayable(invoice) && styles.disabled, pressed && styles.payPressed]}><Text style={styles.payButtonText}>Review {invoice.amount} YNXT payment</Text></Pressable> : <Pressable onPress={props.openWallet} style={({ pressed }) => [styles.walletButton, pressed && styles.pressed]}><WalletCards color={BLUE} size={19} /><Text style={styles.walletButtonText}>Set up wallet to pay</Text></Pressable> : null}
        {pending ? <View style={styles.pending}><Clock3 color="#B54708" size={23} /><View style={styles.pendingCopy}><Text style={styles.pendingTitle}>Waiting for confirmation</Text><Text selectable style={styles.pendingHash}>{pending.transactionHash}</Text></View><Pressable disabled={paying} onPress={() => void resume()} style={styles.retry}>{paying ? <ActivityIndicator color={BLUE} /> : <RefreshCw color={BLUE} size={18} />}</Pressable></View> : null}
      </>}
    </ScrollView>
    <Modal animationType="slide" onRequestClose={() => !paying && setReviewOpen(false)} transparent visible={reviewOpen}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Confirm payment</Text><Pressable disabled={paying} onPress={() => setReviewOpen(false)} style={styles.close}><X color={INK} size={20} /></Pressable></View>
        {invoice ? <><View style={styles.amountBlock}><Text style={styles.amount}>{invoice.amount}</Text><Text style={styles.unit}>YNXT</Text></View><Detail label="Merchant" value={invoice.merchant} /><Detail label="Payout" value={short(invoice.payoutAddress)} /><Detail label="Network fee" value="1 YNXT" /><Detail label="Total debit" value={`${invoice.amount + 1} YNXT`} /><View style={styles.authNote}><ShieldCheck color={BLUE} size={19} /><Text style={styles.authText}>Your device will verify account ownership and require strong biometric authorization before the native transfer key is used.</Text></View><Pressable disabled={paying} onPress={() => void pay()} style={({ pressed }) => [styles.payButton, paying && styles.disabled, pressed && styles.payPressed]}>{paying ? <><ActivityIndicator color="#FFFFFF" /><Text style={styles.payButtonText}>Confirming on YNX</Text></> : <><Text style={styles.payButtonText}>Authorize and pay</Text><ArrowRight color="#FFFFFF" size={18} /></>}</Pressable></> : null}
      </View></View>
    </Modal>
  </View>;
}

function InvoiceDetails({ invoice }: { invoice: PayInvoice }) {
  return <View style={styles.invoice}>
    <View style={styles.invoiceTop}><View><Text style={styles.merchantLabel}>PAY TO</Text><Text style={styles.merchant}>{invoice.merchant}</Text></View><View style={[styles.status, isPayable(invoice) ? styles.statusReady : styles.statusInactive]}><Text style={isPayable(invoice) ? styles.statusReadyText : styles.statusInactiveText}>{invoice.status}</Text></View></View>
    <View style={styles.invoiceAmount}><Text style={styles.invoiceAmountValue}>{invoice.amount}</Text><Text style={styles.invoiceUnit}>YNXT</Text></View>
    <Detail label="Invoice" value={invoice.id} /><Detail label="Payout" value={short(invoice.payoutAddress)} /><Detail label="Due" value={new Date(invoice.dueAt).toLocaleString()} />
  </View>;
}

function Receipt({ settlement, onDone }: { settlement: PaySettlement; onDone: () => void }) {
  return <View style={styles.receipt}>
    <View style={styles.receiptIcon}><CheckCircle2 color="#067647" size={38} /></View><Text style={styles.receiptTitle}>Payment complete</Text><Text style={styles.receiptAmount}>{settlement.amount} YNXT</Text><Text style={styles.receiptMerchant}>{settlement.merchant}</Text>
    <View style={styles.receiptDetails}><Detail label="Block" value={`#${settlement.blockNumber}`} /><Detail label="Payer" value={short(settlement.payer)} /><Detail label="Transaction" value={short(settlement.transactionHash)} /><Detail label="Audit proof" value={short(settlement.auditHash)} /></View>
    <View style={styles.proof}><Check color="#067647" size={18} /><Text style={styles.proofText}>Native transfer and Pay settlement are committed and bound to this account.</Text></View>
    <Pressable onPress={onDone} style={({ pressed }) => [styles.walletButton, pressed && styles.pressed]}><Text style={styles.walletButtonText}>Done</Text></Pressable>
  </View>;
}

function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>; }
function isPayable(invoice: PayInvoice): boolean { return invoice.status === "issued" && new Date(invoice.dueAt).getTime() > Date.now(); }
function assertPayable(invoice: PayInvoice): void { if (!isPayable(invoice)) throw new Error(invoice.status === "paid" ? "This invoice is already paid." : "This invoice is not active or has expired."); }
async function settle(client: YNXMobileAppClient, invoice: PayInvoice, hash: string): Promise<PaySettlement> {
  const result = await client.settlePayInvoice(invoice.id, hash, `settle-mobile-${invoice.id}-${hash.slice(2, 18)}`);
  if (result.invoiceId !== invoice.id || result.transactionHash !== hash || result.amount !== invoice.amount || result.payoutAddress !== invoice.payoutAddress) throw new Error("Pay settlement response does not match the reviewed invoice and transaction");
  return result;
}
function short(value: string): string { return value.length > 22 ? `${value.slice(0, 11)}...${value.slice(-8)}` : value; }
function message(error: unknown): string { return error instanceof Error ? error.message : "YNX Pay is unavailable"; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" }, heading: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, eyebrow: { color: BLUE, fontSize: 11, fontWeight: "700" }, title: { color: INK, fontSize: 30, lineHeight: 36, fontWeight: "700", marginTop: 3 }, payMark: { width: 42, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF3FF" }, content: { padding: 20, paddingBottom: 36 }, inputLabel: { color: INK, fontSize: 13, fontWeight: "700" }, inputRow: { height: 52, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: LINE, borderRadius: 8, marginTop: 9 }, input: { flex: 1, height: "100%", paddingHorizontal: 14, color: INK, fontSize: 14 }, paste: { width: 48, height: "100%", alignItems: "center", justifyContent: "center", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: LINE }, lookup: { minHeight: 48, marginTop: 12, borderRadius: 8, backgroundColor: BLUE, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center" }, lookupPressed: { backgroundColor: "#001F70" }, lookupText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" }, disabled: { opacity: 0.38 }, pressed: { opacity: 0.62 }, error: { color: "#B42318", fontSize: 12, lineHeight: 18, marginTop: 14 }, empty: { alignItems: "center", paddingHorizontal: 20, paddingTop: 48 }, emptyTitle: { color: INK, fontSize: 17, fontWeight: "700", marginTop: 15 }, emptyText: { color: MUTED, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 }, invoice: { marginTop: 24, borderTopWidth: 1, borderTopColor: LINE }, invoiceTop: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, merchantLabel: { color: MUTED, fontSize: 10, fontWeight: "700" }, merchant: { color: INK, fontSize: 16, fontWeight: "700", marginTop: 5 }, status: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 }, statusReady: { backgroundColor: "#ECFDF3" }, statusInactive: { backgroundColor: "#F2F4F7" }, statusReadyText: { color: "#067647", fontSize: 11, fontWeight: "700" }, statusInactiveText: { color: MUTED, fontSize: 11, fontWeight: "700" }, invoiceAmount: { flexDirection: "row", alignItems: "baseline", paddingVertical: 18 }, invoiceAmountValue: { color: INK, fontSize: 42, lineHeight: 50, fontWeight: "700" }, invoiceUnit: { color: MUTED, fontSize: 14, fontWeight: "700", marginLeft: 8 }, detail: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE }, detailLabel: { color: MUTED, fontSize: 12 }, detailValue: { flexShrink: 1, maxWidth: "66%", color: INK, fontSize: 12, fontWeight: "600", textAlign: "right" }, payButton: { minHeight: 50, marginTop: 24, borderRadius: 8, backgroundColor: BLUE, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center" }, payPressed: { backgroundColor: "#001F70" }, payButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" }, walletButton: { minHeight: 48, marginTop: 22, borderWidth: 1, borderColor: "#C7D7FE", borderRadius: 8, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#F5F8FF" }, walletButtonText: { color: BLUE, fontSize: 14, fontWeight: "700" }, pending: { marginTop: 24, paddingVertical: 17, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE }, pendingCopy: { flex: 1 }, pendingTitle: { color: INK, fontSize: 13, fontWeight: "700" }, pendingHash: { color: MUTED, fontSize: 10, marginTop: 5 }, retry: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.32)" }, sheet: { maxHeight: "94%", padding: 22, paddingBottom: 36, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18 }, sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sheetTitle: { color: INK, fontSize: 22, fontWeight: "700" }, close: { width: 38, height: 38, alignItems: "center", justifyContent: "center" }, amountBlock: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", paddingVertical: 24 }, amount: { color: INK, fontSize: 36, fontWeight: "700" }, unit: { color: MUTED, fontSize: 13, fontWeight: "700", marginLeft: 8 }, authNote: { marginTop: 18, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 8, backgroundColor: "#F5F8FF" }, authText: { flex: 1, color: MUTED, fontSize: 11, lineHeight: 17 }, receipt: { alignItems: "center", paddingTop: 24 }, receiptIcon: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: "#ECFDF3" }, receiptTitle: { color: INK, fontSize: 21, fontWeight: "700", marginTop: 16 }, receiptAmount: { color: INK, fontSize: 36, fontWeight: "700", marginTop: 18 }, receiptMerchant: { color: MUTED, fontSize: 13, marginTop: 6 }, receiptDetails: { width: "100%", marginTop: 28, borderTopWidth: 1, borderTopColor: LINE }, proof: { width: "100%", marginTop: 20, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#ECFDF3", borderRadius: 8 }, proofText: { flex: 1, color: "#067647", fontSize: 11, lineHeight: 17 },
});
