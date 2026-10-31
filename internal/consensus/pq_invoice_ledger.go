package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

const pqInvoiceHistoryMemo = "ynx-abci-pq-invoice-v1:"
const PQInvoiceEffectVersion = "YNX-INVOICE-EFFECT/v1"

func isPQInvoiceHistory(tx chain.Transaction) bool {
	return strings.HasPrefix(tx.Memo, pqInvoiceHistoryMemo)
}

// This classification is used only after validatePQInvoiceLedger has replayed
// the complete merchant proofs and exact fee/lot receipts during state sealing.
func pqInvoiceFeeHash(s CommittedState, hash string) bool {
	if s.InvoiceLedger == nil {
		return false
	}
	for _, r := range s.InvoiceLedger.Records {
		if r.TermsABCIHash == hash {
			return true
		}
	}
	return false
}

// Only invoice commitments and execution receipts live here. Money and nonce
// remain in the original accounts/trace lots, mutated by the original executor.
type PQInvoiceLedger struct {
	Schedule *PQInvoiceSchedule `json:"schedule"`
	Records  []PQInvoiceRecord  `json:"records"`
}

type PQInvoiceRecord struct {
	Slot            string              `json:"slot"`
	Merchant        string              `json:"merchant"`
	InvoiceID       string              `json:"invoiceId"`
	TermsMessage    []byte              `json:"termsMessage"`
	TermsHash       string              `json:"termsHash"`
	TermsNativeHash string              `json:"termsNativeHash"`
	TermsABCIHash   string              `json:"termsABCIHash"`
	IssuedAt        int64               `json:"issuedAt,string"`
	Settlement      *PQInvoiceMovement  `json:"settlement,omitempty"`
	RefundedAtoms   uint64              `json:"refundedAtoms,string"`
	Refunds         []PQInvoiceMovement `json:"refunds"`
}

type PQInvoiceMovement struct {
	RefundID   string    `json:"refundId,omitempty"`
	NativeHash string    `json:"nativeHash"`
	ABCIHash   string    `json:"abciHash"`
	From       string    `json:"from"`
	Recipient  string    `json:"recipient"`
	Amount     uint64    `json:"amount,string"`
	Fee        uint64    `json:"fee,string"`
	Height     int64     `json:"height,string"`
	Member     uint32    `json:"member,string"`
	At         time.Time `json:"at"`
}

// Exact ExecTxResult.Data is committed through the existing H+1 result root.
// An RPC copy of this value is still only an observation until that proof is
// independently verified against an admitted checkpoint and original member.
type PQInvoiceEffect struct {
	Version              string `json:"version"`
	Kind                 string `json:"kind"`
	Genesis              string `json:"genesis"`
	NativeChainID        uint64 `json:"nativeChainId,string"`
	AssetID              string `json:"assetId"`
	UnitVersion          string `json:"unitVersion"`
	Slot                 string `json:"slot"`
	Merchant             string `json:"merchant"`
	InvoiceID            string `json:"invoiceId"`
	SessionID            string `json:"sessionId"`
	TermsHash            string `json:"termsHash"`
	TermsRevision        uint64 `json:"termsRevision,string"`
	Payer                string `json:"payer"`
	Recipient            string `json:"recipient"`
	RefundID             string `json:"refundId,omitempty"`
	SettlementNativeHash string `json:"settlementNativeHash,omitempty"`
	Principal            uint64 `json:"principalAtoms,string"`
	Fee                  uint64 `json:"feeAtoms,string"`
	Paid                 uint64 `json:"paidAtoms,string"`
	Refunded             uint64 `json:"refundedAtoms,string"`
	NetPaid              uint64 `json:"netPaidAtoms,string"`
	NativeHash           string `json:"nativeHash"`
	ABCIHash             string `json:"abciHash"`
	Height               int64  `json:"height,string"`
	Member               uint32 `json:"member,string"`
	Event                uint32 `json:"event,string"`
}

func clonePQInvoiceLedger(in *PQInvoiceLedger) *PQInvoiceLedger {
	if in == nil {
		return nil
	}
	out := *in
	if in.Schedule != nil {
		s := *in.Schedule
		out.Schedule = &s
	}
	if in.Records != nil {
		out.Records = make([]PQInvoiceRecord, len(in.Records))
		copy(out.Records, in.Records)
	}
	for i := range out.Records {
		r := &out.Records[i]
		r.TermsMessage = bytes.Clone(r.TermsMessage)
		if r.Refunds != nil {
			refunds := make([]PQInvoiceMovement, len(r.Refunds))
			copy(refunds, r.Refunds)
			r.Refunds = refunds
		}
		if r.Settlement != nil {
			s := *r.Settlement
			r.Settlement = &s
		}
	}
	return &out
}

func invoiceSlot(network []byte, merchant, id string) string {
	raw, _ := ynxbatch.EncodeFields([]byte("YNX-INVOICE-SLOT/v1"), network, []byte(merchant), []byte(id))
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func invoiceRecordAt(records []PQInvoiceRecord, slot string) (int, bool) {
	i := sort.Search(len(records), func(i int) bool { return records[i].Slot >= slot })
	return i, i < len(records) && records[i].Slot == slot
}

func invoiceTerms(r PQInvoiceRecord) (ynxauth.Action, ynxauth.InvoiceTermsPayload, error) {
	a, e := ynxauth.DecodeAction(r.TermsMessage)
	if e != nil || a.Kind != ynxauth.ActionInvoiceTerms {
		return a, ynxauth.InvoiceTermsPayload{}, errors.New("invoice lacks original merchant terms")
	}
	v, e := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
	if e != nil {
		return a, ynxauth.InvoiceTermsPayload{}, e
	}
	return a, v.(ynxauth.InvoiceTermsPayload), nil
}

// Registration authenticates the issuer at creation. A new payment must also
// see that issuer epoch still active; key rotation/revocation cannot leave an
// old queued invoice usable for a new debit. Historical receipts stay valid,
// and a current merchant key may still refund its already-paid old invoices.
func validateInvoiceIssuerPolicy(ledger *PQInvoiceLedger, action ynxauth.Action, policy *ynxauth.State, height uint64) error {
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return err
	}
	var merchant string
	var epoch uint64
	switch p := value.(type) {
	case ynxauth.InvoiceTermsPayload:
		merchant, epoch = action.Owner, p.KeyEpoch
	case ynxauth.InvoiceSettlePayload:
		if ledger == nil {
			return errors.New("invoice merchant authority is unavailable")
		}
		i, exists := invoiceRecordAt(ledger.Records, invoiceSlot(action.ChainID, p.Merchant, p.InvoiceID))
		if !exists {
			return errors.New("invoice merchant terms are absent")
		}
		_, terms, e := invoiceTerms(ledger.Records[i])
		if e != nil {
			return e
		}
		merchant, epoch = p.Merchant, terms.KeyEpoch
	default:
		return nil
	}
	if policy == nil {
		return errors.New("invoice requires the merchant current epoch")
	}
	trusted, err := policy.TrustedRegistration(merchant, ynxauth.TransactionPurpose, height)
	if err != nil || trusted.PolicyRevision != strconv.FormatUint(epoch, 10) {
		return errors.New("invoice merchant epoch is no longer current")
	}
	return nil
}

func invoiceMovement(action ynxauth.Action, wire, raw []byte, height int64, at time.Time, member uint32, to string, amount uint64, refund string) PQInvoiceMovement {
	return PQInvoiceMovement{RefundID: refund, NativeHash: SignedTransactionHash(wire), ABCIHash: SignedTransactionHash(raw), From: action.Owner, Recipient: to, Amount: amount, Fee: action.Fee, Height: height, Member: member, At: at.UTC()}
}

// Produces a detached semantic candidate. It never moves funds or consumes a
// nonce. The caller publishes it only after the original monetary move succeeds.
func invoiceTransition(ledger *PQInvoiceLedger, action ynxauth.Action, wire, raw []byte, height int64, at time.Time, member uint32) (*PQInvoiceLedger, PQInvoiceEffect, error) {
	fail := func(s string) (*PQInvoiceLedger, PQInvoiceEffect, error) {
		return nil, PQInvoiceEffect{}, errors.New(s)
	}
	if ledger == nil || ledger.Schedule == nil || height < ledger.Schedule.ActivationHeight || height <= 0 {
		return fail("invoice feature is not independently activated")
	}
	if action.NativeChainID != uint64(ledger.Schedule.NativeChainID) || hex.EncodeToString(action.ChainID) != ledger.Schedule.OriginalGenesisHash || action.Fee != ynxauth.InvoiceActionFee {
		return fail("invoice network, unit billing or schedule mismatch")
	}
	value, e := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if e != nil {
		return nil, PQInvoiceEffect{}, e
	}
	merchant, id := action.Owner, ""
	switch p := value.(type) {
	case ynxauth.InvoiceTermsPayload:
		id = p.InvoiceID
	case ynxauth.InvoiceSettlePayload:
		merchant, id = p.Merchant, p.InvoiceID
	case ynxauth.InvoiceRefundPayload:
		id = p.InvoiceID
	default:
		return fail("unsupported invoice action")
	}
	slot := invoiceSlot(action.ChainID, merchant, id)
	i, exists := invoiceRecordAt(ledger.Records, slot)
	next := clonePQInvoiceLedger(ledger)
	var record PQInvoiceRecord
	if exists {
		record = next.Records[i]
	}
	var terms ynxauth.InvoiceTermsPayload
	var target, payer, refund, settlementHash string
	var principal uint64
	switch p := value.(type) {
	case ynxauth.InvoiceTermsPayload:
		if exists {
			return fail("canonical merchant invoice already has immutable terms")
		}
		if p.ExpiresAt < uint64(height) || p.MaxFee < ynxauth.InvoiceActionFee || p.Amount > math.MaxInt64-ynxauth.InvoiceActionFee {
			return fail("invoice terms are expired or exclude the original fee")
		}
		message, e := action.SigningBytes()
		if e != nil {
			return nil, PQInvoiceEffect{}, e
		}
		digest := sha256.Sum256(message)
		record = PQInvoiceRecord{Slot: slot, Merchant: merchant, InvoiceID: id, TermsMessage: message, TermsHash: hex.EncodeToString(digest[:]), TermsNativeHash: SignedTransactionHash(wire), TermsABCIHash: SignedTransactionHash(raw), IssuedAt: height, Refunds: []PQInvoiceMovement{}}
		terms, target, payer = p, p.Recipient, p.Payer
	case ynxauth.InvoiceSettlePayload:
		if !exists || record.Settlement != nil {
			return fail("invoice is absent or its one principal slot is occupied")
		}
		_, terms, e = invoiceTerms(record)
		if e != nil {
			return nil, PQInvoiceEffect{}, e
		}
		if record.TermsHash != hex.EncodeToString(p.TermsHash) || p.Amount != terms.Amount || uint64(height) > terms.ExpiresAt || terms.Payer != "" && terms.Payer != action.Owner || action.Fee > terms.MaxFee {
			return fail("settlement differs from merchant terms, payer, principal, fee cap or expiry")
		}
		if action.Owner == terms.Recipient || action.Owner == record.Merchant {
			return fail("invoice principal requires distinct original payer and merchant recipients")
		}
		principal, target, payer = p.Amount, terms.Recipient, action.Owner
		movement := invoiceMovement(action, wire, raw, height, at, member, target, principal, "")
		record.Settlement = &movement
	case ynxauth.InvoiceRefundPayload:
		if !exists || record.Settlement == nil {
			return fail("refund requires the original paid invoice")
		}
		_, terms, e = invoiceTerms(record)
		if e != nil {
			return nil, PQInvoiceEffect{}, e
		}
		original, e := hex.DecodeString(strings.TrimPrefix(record.Settlement.NativeHash, "0x"))
		if e != nil || !bytes.Equal(original, p.SettlementHash) || record.TermsHash != hex.EncodeToString(p.TermsHash) || record.Merchant != action.Owner || record.RefundedAtoms > record.Settlement.Amount || p.Amount > record.Settlement.Amount-record.RefundedAtoms || action.Fee > terms.MaxFee {
			return fail("refund authority, original settlement, amount or fee cap mismatch")
		}
		j := sort.Search(len(record.Refunds), func(j int) bool { return record.Refunds[j].RefundID >= p.RefundID })
		if j < len(record.Refunds) && record.Refunds[j].RefundID == p.RefundID {
			return fail("refund identifier already consumed")
		}
		if action.Owner == record.Settlement.From {
			return fail("refund cannot count a self-transfer as returned principal")
		}
		principal, target, payer, refund, settlementHash = p.Amount, record.Settlement.From, record.Settlement.From, p.RefundID, record.Settlement.NativeHash
		movement := invoiceMovement(action, wire, raw, height, at, member, target, principal, p.RefundID)
		record.Refunds = append(record.Refunds, PQInvoiceMovement{})
		copy(record.Refunds[j+1:], record.Refunds[j:])
		record.Refunds[j] = movement
		record.RefundedAtoms += principal
	}
	if exists {
		next.Records[i] = record
	} else {
		next.Records = append(next.Records, PQInvoiceRecord{})
		copy(next.Records[i+1:], next.Records[i:])
		next.Records[i] = record
	}
	paid := uint64(0)
	if record.Settlement != nil {
		paid = record.Settlement.Amount
		settlementHash = record.Settlement.NativeHash
	}
	effect := PQInvoiceEffect{Version: PQInvoiceEffectVersion, Kind: action.Kind, Genesis: hex.EncodeToString(action.ChainID), NativeChainID: action.NativeChainID, AssetID: terms.AssetID, UnitVersion: terms.UnitVersion, Slot: slot, Merchant: merchant, InvoiceID: id, SessionID: terms.SessionID, TermsHash: record.TermsHash, TermsRevision: terms.Revision, Payer: payer, Recipient: target, RefundID: refund, SettlementNativeHash: settlementHash, Principal: principal, Fee: action.Fee, Paid: paid, Refunded: record.RefundedAtoms, NetPaid: paid - record.RefundedAtoms, NativeHash: SignedTransactionHash(wire), ABCIHash: SignedTransactionHash(raw), Height: height, Member: member, Event: 0}
	return next, effect, nil
}

func invoiceHistoryTransaction(action ynxauth.Action, raw []byte, e PQInvoiceEffect, at time.Time, flows []chain.LotFlow) chain.Transaction {
	return chain.Transaction{Hash: e.NativeHash, Type: action.Kind, From: action.Owner, To: e.Recipient, Amount: int64(e.Principal), Fee: int64(e.Fee), Nonce: action.Nonce, BlockNum: uint64(e.Height), Timestamp: at.UTC(), Memo: pqInvoiceHistoryMemo + hex.EncodeToString(raw), LotFlows: flows}
}

func (a *Application) applyPQInvoiceAction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(e error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, e)
	}
	wire, action, e := DecodePQNativeActionTransaction(raw)
	if e != nil {
		return fail(e)
	}
	if state.invoiceLedger == nil || state.accountPolicy == nil || height <= 0 {
		return fail(errors.New("invoice feature or account policy is unavailable"))
	}
	member, e := ynxbatch.DecodeMember(wire)
	if e != nil {
		return fail(e)
	}
	if e = a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); e != nil {
		return fail(e)
	}
	if _, exists := accountIndex(state.accounts, action.Owner); !exists {
		return fail(errors.New("invoice signer has no original ledger account"))
	}
	account, _ := nativeAccountAt(state, action.Owner)
	if account.account.ResourceUsage.PayCreditsUsed == math.MaxInt64 {
		return fail(errors.New("invoice original Pay resource counter overflows"))
	}
	for _, previous := range state.pqHistory {
		if previous.Transaction.Hash == SignedTransactionHash(wire) || previous.ABCITransactionHash == SignedTransactionHash(raw) {
			return fail(errors.New("invoice original authorization already executed"))
		}
	}
	value, e := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if e != nil {
		return fail(e)
	}
	if e = validateInvoiceIssuerPolicy(state.invoiceLedger, action, state.accountPolicy, uint64(height)); e != nil {
		return fail(e)
	}
	if p, ok := value.(ynxauth.InvoiceTermsPayload); ok {
		// Opaque pre-upgrade aliases remain readable but cannot be silently
		// reissued as new authority or used to change a historical price.
		for _, old := range state.payInvoices {
			if old.ID == p.InvoiceID {
				return fail(errors.New("historical invoice alias requires an independently bound migration"))
			}
		}
		if state.legacyPaySource != nil {
			if _, ok := state.legacyPaySource.Invoices[p.InvoiceID]; ok {
				return fail(errors.New("historical native invoice alias is not newly authorized terms"))
			}
		}
	}
	if at.IsZero() {
		at = time.Unix(height, 0)
	}
	at = at.UTC()
	ledger, effect, e := invoiceTransition(state.invoiceLedger, action, wire, raw, height, at, member.Index)
	if e != nil {
		return fail(e)
	}
	var flows []chain.LotFlow
	if action.Kind == ynxauth.ActionInvoiceTerms {
		flows, e = a.chargePQContract(&state, action, 0)
		if e != nil {
			return fail(e)
		}
		state.feeEvents = state.feeEvents.append(newCurrentFeeEvent(effect.ABCIHash, PQActionType, action.Owner, a.feeRecipient, 1, height, at))
	} else {
		native := SignedTransaction{Version: SignedTransactionVersion, ChainID: a.migration.Network.ChainID, Type: SignedTransactionType, From: action.Owner, To: effect.Recipient, Amount: int64(effect.Principal), Fee: int64(effect.Fee), Nonce: action.Nonce}
		state, _, e = a.applyNativeTransfer(state, native, effect.ABCIHash, height, at, true)
		if e != nil {
			return fail(e)
		}
	}
	// No record/claim is installed before the original money/fee/nonce move.
	account, _ = nativeAccountAt(state, action.Owner)
	account.account.ResourceUsage.PayCreditsUsed++
	state.nativeAccounts = deltaPut(state.nativeAccounts, action.Owner, account)
	state.invoiceLedger = ledger
	tx := invoiceHistoryTransaction(action, raw, effect, at, flows)
	state.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: effect.ABCIHash, Transaction: tx})
	data, e := json.Marshal(effect)
	if e != nil {
		return fail(e)
	}
	return state, transactionExecution{typeName: PQActionType, hash: effect.ABCIHash, resultData: data, event: abci.Event{Type: "ynx.invoice", Attributes: []abci.EventAttribute{{Key: "kind", Value: action.Kind, Index: true}, {Key: "merchant", Value: effect.Merchant, Index: true}, {Key: "invoice_id", Value: effect.InvoiceID, Index: true}, {Key: "native_hash", Value: effect.NativeHash, Index: true}}}}, nil
}

func decodePQInvoiceHistory(entry PQCommittedAuthorization) ([]byte, []byte, ynxauth.Action, ynxbatch.Member, error) {
	var action ynxauth.Action
	var member ynxbatch.Member
	if !strings.HasPrefix(entry.Transaction.Memo, pqInvoiceHistoryMemo) || len(entry.Transaction.Memo) > 4*chain.MaxPQActionMemberBytes+1024 {
		return nil, nil, action, member, errors.New("invalid invoice original history bound")
	}
	raw, e := hex.DecodeString(strings.TrimPrefix(entry.Transaction.Memo, pqInvoiceHistoryMemo))
	if e != nil || entry.Transaction.Memo != pqInvoiceHistoryMemo+hex.EncodeToString(raw) {
		return nil, nil, action, member, errors.New("noncanonical invoice history")
	}
	wire, action, e := DecodePQNativeActionTransaction(raw)
	if e != nil {
		return nil, nil, action, member, e
	}
	member, e = ynxbatch.DecodeMember(wire)
	if e != nil || !ynxauth.IsInvoiceAction(action.Kind) {
		return nil, nil, action, member, errors.New("invoice history has another signed kind")
	}
	return raw, wire, action, member, nil
}

func validatePQInvoiceLedger(s CommittedState, m chain.ConsensusMigrationState) error {
	if s.InvoiceLedger == nil {
		for _, entry := range s.PQHistory {
			if ynxauth.IsInvoiceAction(entry.Transaction.Type) || strings.HasPrefix(entry.Transaction.Memo, pqInvoiceHistoryMemo) {
				return errors.New("invoice history exists without authorized feature state")
			}
		}
		return nil
	}
	ledger := s.InvoiceLedger
	if ledger.Schedule == nil || ledger.Schedule.Validate() != nil || ledger.Schedule.OriginalGenesisHash != m.OriginalGenesisHash || ledger.Schedule.MigrationStateHash != m.StateHash || ledger.Schedule.NativeChainID != m.Network.ChainID || s.Height < ledger.Schedule.AuthorizedAt {
		return errors.New("invoice ledger schedule differs from original chain")
	}
	rebuilt := &PQInvoiceLedger{Schedule: ledger.Schedule, Records: []PQInvoiceRecord{}}
	cache := chain.NewPQCertificateCache()
	feeRecipient := ""
	for _, validator := range m.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	seen := map[string]bool{}
	lastHeight := int64(0)
	for _, entry := range s.PQHistory {
		if !ynxauth.IsInvoiceAction(entry.Transaction.Type) && !strings.HasPrefix(entry.Transaction.Memo, pqInvoiceHistoryMemo) {
			continue
		}
		raw, wire, action, member, e := decodePQInvoiceHistory(entry)
		if e != nil {
			return e
		}
		tx := entry.Transaction
		if tx.BlockNum > uint64(s.Height) || tx.BlockNum == 0 || int64(tx.BlockNum) < lastHeight || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || seen[entry.ABCITransactionHash] {
			return errors.New("invoice history height/order/identity is invalid")
		}
		lastHeight = int64(tx.BlockNum)
		seen[entry.ABCITransactionHash] = true
		if s.AccountPolicy == nil || cache.VerifyDecodedMember(s.AccountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum) != nil {
			return errors.New("invoice historical original AND authority is invalid")
		}
		value, e := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
		if e != nil {
			return e
		}
		if e = validateInvoiceIssuerPolicy(rebuilt, action, s.AccountPolicy, tx.BlockNum); e != nil {
			return e
		}
		if p, ok := value.(ynxauth.InvoiceTermsPayload); ok {
			record, active := s.AccountPolicy.PolicyAt(action.Owner, tx.BlockNum)
			if !active || record.Revision != p.KeyEpoch {
				return errors.New("invoice historical issuer epoch differs")
			}
		}
		next, effect, e := invoiceTransition(rebuilt, action, wire, raw, int64(tx.BlockNum), tx.Timestamp, member.Index)
		if e != nil {
			return e
		}
		expected := invoiceHistoryTransaction(action, raw, effect, tx.Timestamp, tx.LotFlows)
		if !reflect.DeepEqual(expected, tx) || effect.ABCIHash != entry.ABCITransactionHash {
			return errors.New("invoice history differs from the original action")
		}
		if action.Kind == ynxauth.ActionInvoiceTerms {
			if m.Runtime == nil {
				return errors.New("invoice terms fee requires the original complete source lineage")
			}
			var feeCount int
			for _, fee := range s.FeeEvents {
				if fee.TxHash == entry.ABCITransactionHash {
					feeCount++
					if fee != newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, action.Owner, feeRecipient, 1, int64(tx.BlockNum), tx.Timestamp) {
						return errors.New("invoice original issue fee event differs from execution")
					}
				}
			}
			if feeCount != 1 {
				return errors.New("invoice issue requires exactly one original fee event")
			}
			var total int64
			previousLot := ""
			for _, flow := range tx.LotFlows {
				lot, known := m.Runtime.Lots[flow.LotID]
				if !known || lot.LotID != flow.LotID || lot.Amount < flow.Amount || flow.LotID <= previousLot || flow.Amount <= 0 || flow.Amount > 1-total || flow.From != action.Owner || flow.To != feeRecipient {
					return errors.New("invoice fee history has invalid original lot flow")
				}
				previousLot = flow.LotID
				total += flow.Amount
			}
			if total != 1 {
				return errors.New("invoice issue fee lacks exact original lot movement")
			}
		} else {
			var feeCount int
			for _, fee := range s.FeeEvents {
				if fee.TxHash == entry.ABCITransactionHash {
					feeCount++
					if fee != newCurrentFeeEvent(entry.ABCITransactionHash, SignedTransactionType, action.Owner, feeRecipient, 1, int64(tx.BlockNum), tx.Timestamp) {
						return errors.New("invoice atomic original transfer fee event differs")
					}
				}
			}
			if feeCount != 1 {
				return errors.New("invoice principal requires exactly one original transfer fee")
			}
			if len(tx.LotFlows) != 0 {
				return errors.New("invoice native movement has unbound extra lot receipt")
			}
			var found bool
			for _, native := range s.NativeTransfers {
				if native.TransactionHash == entry.ABCITransactionHash {
					if found || native.From != action.Owner || native.To != effect.Recipient || native.Amount != int64(effect.Principal) || native.Fee != 1 || native.BlockHeight != int64(tx.BlockNum) || !native.CommittedAt.Equal(tx.Timestamp) {
						return errors.New("invoice native receipt differs from atomic principal movement")
					}
					found = true
				}
			}
			if !found {
				return errors.New("invoice atomic native movement is missing")
			}
		}
		rebuilt = next
	}
	if len(rebuilt.Records) == 0 && len(ledger.Records) == 0 {
		return nil
	}
	if !reflect.DeepEqual(rebuilt, ledger) {
		return fmt.Errorf("invoice state is not the exact replay of its original signed transitions")
	}
	return nil
}
