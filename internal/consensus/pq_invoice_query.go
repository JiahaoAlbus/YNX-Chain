package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

const PQInvoiceQueryPath = "/pq-invoices/"

// PQInvoiceView is a bounded observation from one committed state. History is
// the complete ordered invoice prefix through ThroughNativeHash. In an action
// history view that prefix ends at the original action, not at today's refund
// total. Neither the schedule nor policy projections are independent trust.
type PQInvoiceView struct {
	Source            string             `json:"source"`
	CommittedHeight   int64              `json:"committedHeight,string"`
	CommittedAppHash  string             `json:"committedAppHash"`
	ThroughNativeHash string             `json:"throughNativeHash"`
	Schedule          *PQInvoiceSchedule `json:"schedule"`
	Record            PQInvoiceRecord    `json:"record"`
	// Canonical bytes preserve original uint64 nonces without JSON float loss.
	History        [][]byte              `json:"history"`
	Authorizations []PQWalletAccountView `json:"authorizations"`
}

type pqActionInvoiceEffects struct {
	Original PQInvoiceView      `json:"original"`
	Result   PQInvoiceEffect    `json:"result"`
	Transfer *BFTNativeTransfer `json:"transfer"`
}

// ValidatePQInvoiceEffectData binds mathematical execution DATA to the complete
// original Member and transport. Merchant terms and the original buyer are
// independently re-established by ValidatePQInvoiceView/history replay; this
// function alone does not authenticate those observations or authorize money.
func ValidatePQInvoiceEffectData(wire, envelope []byte, height uint64, data []byte) (PQInvoiceEffect, error) {
	var e PQInvoiceEffect
	if err := strictPQActionJSON(data, &e); err != nil {
		return e, err
	}
	original, action, err := DecodePQActionTransport(envelope)
	if err != nil || !bytes.Equal(wire, original) || !ynxauth.IsInvoiceAction(action.Kind) {
		return e, errors.New("invoice effect requires exact original Invoice action transport")
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return e, err
	}
	if height == 0 || height > math.MaxInt64 || e.Version != PQInvoiceEffectVersion || e.Kind != action.Kind || e.Genesis != hex.EncodeToString(action.ChainID) || e.NativeChainID != action.NativeChainID || e.AssetID != "YNXT" || e.UnitVersion != "1" || e.NativeHash != SignedTransactionHash(wire) || e.ABCIHash != SignedTransactionHash(envelope) || e.Height != int64(height) || e.Member != m.Index || e.Event != 0 || e.Fee != ynxauth.InvoiceActionFee || action.Fee != e.Fee || e.Paid > math.MaxInt64 || e.Refunded > e.Paid || e.NetPaid != e.Paid-e.Refunded || e.Principal > math.MaxInt64 || !walletHex(e.Merchant, 20, true) || !walletHex(e.Recipient, 20, true) || e.Payer != "" && !walletHex(e.Payer, 20, true) || !walletHex(e.TermsHash, 32, false) || e.TermsRevision == 0 || e.TermsRevision > math.MaxInt64 {
		return e, errors.New("invoice effect identity, amount, fee or execution coordinate mismatch")
	}
	payload, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return e, err
	}
	switch p := payload.(type) {
	case ynxauth.InvoiceTermsPayload:
		sum := sha256.Sum256(m.Message)
		if e.Merchant != action.Owner || e.InvoiceID != p.InvoiceID || e.SessionID != p.SessionID || e.Recipient != p.Recipient || e.Payer != p.Payer || e.TermsHash != hex.EncodeToString(sum[:]) || e.TermsRevision != p.Revision || e.Principal != 0 || e.Paid != 0 || e.Refunded != 0 || e.RefundID != "" || e.SettlementNativeHash != "" {
			return e, errors.New("invoice terms effect differs from complete signed terms")
		}
	case ynxauth.InvoiceSettlePayload:
		if e.Merchant != p.Merchant || e.InvoiceID != p.InvoiceID || e.TermsHash != hex.EncodeToString(p.TermsHash) || e.Payer != action.Owner || e.Payer == e.Merchant || e.Payer == e.Recipient || e.Principal != p.Amount || e.Paid != p.Amount || e.Refunded != 0 || e.RefundID != "" || e.SettlementNativeHash != e.NativeHash {
			return e, errors.New("invoice settlement effect differs from original payment")
		}
	case ynxauth.InvoiceRefundPayload:
		if e.Merchant != action.Owner || e.InvoiceID != p.InvoiceID || e.TermsHash != hex.EncodeToString(p.TermsHash) || e.SettlementNativeHash != "0x"+hex.EncodeToString(p.SettlementHash) || e.RefundID != p.RefundID || e.Principal != p.Amount || e.Payer == "" || e.Payer == e.Merchant || e.Recipient != e.Payer || e.Paid == 0 || e.Refunded < p.Amount {
			return e, errors.New("invoice refund effect differs from original settlement reference")
		}
	default:
		return e, errors.New("unsupported invoice effect")
	}
	// Reuse the canonical codec for IDs/revision/session fields that a settle or
	// refund obtains from its previous signed terms rather than its own payload.
	if _, err = ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, ynxauth.InvoiceTermsPayload{InvoiceID: e.InvoiceID, SessionID: e.SessionID, Recipient: e.Recipient, Payer: e.Payer, AssetID: e.AssetID, UnitVersion: e.UnitVersion, FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: e.TermsRevision, Amount: 1, MaxFee: 1, ExpiresAt: 1}); err != nil {
		return e, err
	}
	if e.Slot != invoiceSlot(action.ChainID, e.Merchant, e.InvoiceID) {
		return e, errors.New("invoice effect slot mismatch")
	}
	return e, nil
}

func invoiceActionIdentity(action ynxauth.Action) (string, string, error) {
	p, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return "", "", err
	}
	switch v := p.(type) {
	case ynxauth.InvoiceTermsPayload:
		return action.Owner, v.InvoiceID, nil
	case ynxauth.InvoiceSettlePayload:
		return v.Merchant, v.InvoiceID, nil
	case ynxauth.InvoiceRefundPayload:
		return action.Owner, v.InvoiceID, nil
	default:
		return "", "", errors.New("not an invoice action")
	}
}

func validateInvoiceQuerySubject(merchant, id string) error {
	_, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: merchant, InvoiceID: id, TermsHash: bytes.Repeat([]byte{1}, 32), Amount: 1})
	return err
}

// ValidatePQInvoiceView verifies actual historical AND signatures and replays
// immutable terms/payment/refund transitions. The RPC's current AppHash remains
// an observation until a caller supplies its independent light-client anchor.
func ValidatePQInvoiceView(v PQInvoiceView, merchant, id string, queryHeight int64) error {
	_, err := replayPQInvoiceView(v, merchant, id, queryHeight)
	return err
}

func replayPQInvoiceView(v PQInvoiceView, merchant, id string, queryHeight int64) (PQInvoiceEffect, error) {
	var last PQInvoiceEffect
	if err := validateInvoiceQuerySubject(merchant, id); err != nil {
		return last, err
	}
	if v.Source != "comet-rpc" || queryHeight <= 0 || v.CommittedHeight != queryHeight || !walletHex(v.CommittedAppHash, 32, false) || v.Schedule.Validate() != nil || v.Schedule.ActivationHeight > queryHeight || !walletHex(v.ThroughNativeHash, 32, true) || len(v.History) == 0 || len(v.History) > MaxPQWalletQueryBytes/128 || len(v.Authorizations) == 0 || len(v.Authorizations) > 2 {
		return last, errors.New("invalid bounded committed invoice observation")
	}
	policies := make(map[string]PQWalletAccountView, len(v.Authorizations))
	previousOwner := ""
	for _, a := range v.Authorizations {
		if a.Owner <= previousOwner || a.CommittedHeight != queryHeight || a.CommittedAppHash != v.CommittedAppHash || a.NativeChainID != v.Schedule.NativeChainID || a.NetworkID != v.Schedule.OriginalGenesisHash || a.Policy == nil {
			return last, errors.New("invoice policy projection is not the same committed state")
		}
		if err := ValidatePQWalletAccountView(a, a.Owner); err != nil {
			return last, err
		}
		policies[a.Owner] = a
		previousOwner = a.Owner
	}
	ledger := &PQInvoiceLedger{Schedule: v.Schedule, Records: []PQInvoiceRecord{}}
	budget := MaxPQWalletQueryBytes
	for _, original := range v.History {
		if len(original) == 0 || len(original) > budget {
			return last, errors.New("complete invoice prefix exceeds bounded query input")
		}
		budget -= len(original)
	}
	seen := map[string]bool{}
	nonces := map[string]uint64{}
	used := map[string]bool{}
	var previousHeight uint64
	cache := chain.NewPQCertificateCache()
	for _, original := range v.History {
		var entry PQCommittedAuthorization
		if err := strictPQActionJSON(original, &entry); err != nil {
			return last, err
		}
		raw, wire, action, member, err := decodePQInvoiceHistory(entry)
		if err != nil {
			return last, err
		}
		m, i, err := invoiceActionIdentity(action)
		if err != nil || m != merchant || i != id {
			return last, errors.New("invoice prefix contains another slot")
		}
		tx := entry.Transaction
		a, exists := policies[action.Owner]
		if !exists || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC || tx.BlockNum == 0 || tx.BlockNum > uint64(queryHeight) || tx.BlockNum < previousHeight || tx.Nonce <= nonces[action.Owner] || tx.Nonce > a.LedgerNonce || seen[tx.Hash] || seen[entry.ABCITransactionHash] {
			return last, errors.New("invoice prefix height, nonce, owner or duplicate identity mismatch")
		}
		if err = cache.VerifyDecodedMember(a.Policy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
			return last, err
		}
		if err = validateInvoiceIssuerPolicy(ledger, action, policies[merchant].Policy, tx.BlockNum); err != nil {
			return last, err
		}
		ledger, last, err = invoiceTransition(ledger, action, wire, raw, int64(tx.BlockNum), tx.Timestamp, member.Index)
		if err != nil {
			return last, err
		}
		if !reflect.DeepEqual(tx, invoiceHistoryTransaction(action, raw, last, tx.Timestamp, tx.LotFlows)) || entry.ABCITransactionHash != last.ABCIHash {
			return last, errors.New("invoice prefix contains unexecuted history metadata")
		}
		if action.Kind != ynxauth.ActionInvoiceTerms && len(tx.LotFlows) != 0 {
			return last, errors.New("invoice movement acquired unsupported history lot metadata")
		}
		used[action.Owner] = true
		seen[tx.Hash] = true
		seen[entry.ABCITransactionHash] = true
		nonces[action.Owner] = tx.Nonce
		previousHeight = tx.BlockNum
	}
	if len(used) != len(policies) || last.NativeHash != v.ThroughNativeHash || len(ledger.Records) != 1 || !reflect.DeepEqual(ledger.Records[0], v.Record) {
		return last, errors.New("invoice record differs from complete original ordered prefix")
	}
	return last, nil
}

func pqInvoiceView(s CommittedState, m chain.ConsensusMigrationState, merchant, id, through string) (PQInvoiceView, PQInvoiceEffect, error) {
	var v PQInvoiceView
	var last PQInvoiceEffect
	if err := validateInvoiceQuerySubject(merchant, id); err != nil {
		return v, last, err
	}
	if err := validatePQInvoiceLedger(s, m); err != nil {
		return v, last, err
	}
	if s.InvoiceLedger == nil {
		return v, last, errors.New("invoice schedule is unavailable")
	}
	network, err := hex.DecodeString(m.OriginalGenesisHash)
	if err != nil {
		return v, last, err
	}
	slot := invoiceSlot(network, merchant, id)
	idx, exists := invoiceRecordAt(s.InvoiceLedger.Records, slot)
	if !exists {
		return v, last, errors.New("committed invoice not found")
	}
	ledger := &PQInvoiceLedger{Schedule: s.InvoiceLedger.Schedule, Records: []PQInvoiceRecord{}}
	v = PQInvoiceView{Source: "comet-rpc", CommittedHeight: s.Height, CommittedAppHash: s.AppHash, Schedule: clonePQInvoiceLedger(ledger).Schedule, History: [][]byte{}, Authorizations: []PQWalletAccountView{}}
	owners := map[string]bool{}
	budget := MaxPQWalletQueryBytes
	for _, entry := range s.PQHistory {
		if !isPQInvoiceHistory(entry.Transaction) {
			continue
		}
		raw, wire, a, member, e := decodePQInvoiceHistory(entry)
		if e != nil {
			return v, last, e
		}
		owner, invoice, e := invoiceActionIdentity(a)
		if e != nil {
			return v, last, e
		}
		if owner != merchant || invoice != id {
			continue
		}
		ledger, last, e = invoiceTransition(ledger, a, wire, raw, int64(entry.Transaction.BlockNum), entry.Transaction.Timestamp, member.Index)
		if e != nil {
			return v, last, e
		}
		original, e := json.Marshal(entry)
		if e != nil {
			return v, last, e
		}
		encoded := 4*((len(original)+2)/3) + 3
		if encoded > budget {
			return v, last, errors.New("complete invoice prefix exceeds bounded query output")
		}
		budget -= encoded
		v.History = append(v.History, original)
		owners[a.Owner] = true
		if through != "" && entry.Transaction.Hash == through {
			break
		}
	}
	if len(ledger.Records) != 1 || through != "" && last.NativeHash != through {
		return v, last, errors.New("requested invoice historical prefix is unavailable")
	}
	if through == "" && !reflect.DeepEqual(ledger.Records[0], s.InvoiceLedger.Records[idx]) {
		return v, last, errors.New("invoice current record differs from historical replay")
	}
	v.Record = ledger.Records[0]
	v.ThroughNativeHash = last.NativeHash
	for owner := range owners {
		a, e := pqWalletAccountView(s, m, owner)
		if e != nil {
			return v, last, e
		}
		v.Authorizations = append(v.Authorizations, a)
	}
	sort.Slice(v.Authorizations, func(i, j int) bool { return v.Authorizations[i].Owner < v.Authorizations[j].Owner })
	// Detach all returned history slices/maps from the committed state.
	b, err := json.Marshal(v)
	if err != nil || len(b) > MaxPQWalletQueryBytes {
		return v, last, errors.New("complete invoice history exceeds bounded query response")
	}
	if err = json.Unmarshal(b, &v); err != nil {
		return v, last, err
	}
	return v, last, ValidatePQInvoiceView(v, merchant, id, s.Height)
}

func validatePQActionInvoice(entry PQCommittedAuthorization, e pqActionEffects, auth PQWalletAccountView) error {
	if e.Invoice == nil || e.Resource != nil || e.DEX != nil || e.Contract != nil || e.Staking != nil {
		return errors.New("invoice lacks exclusive original execution effects")
	}
	i := e.Invoice
	if i.Original.CommittedAppHash != auth.CommittedAppHash {
		return errors.New("invoice action and prefix are from different checkpoints")
	}
	last, err := replayPQInvoiceView(i.Original, i.Result.Merchant, i.Result.InvoiceID, auth.CommittedHeight)
	if err != nil {
		return err
	}
	original, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(last, i.Result) || !bytes.Equal(i.Original.History[len(i.Original.History)-1], original) {
		return errors.New("invoice action differs from exact historical prefix result")
	}
	matched := false
	for _, a := range i.Original.Authorizations {
		if a.Owner == auth.Owner {
			matched = reflect.DeepEqual(a, auth)
		}
	}
	if !matched {
		return errors.New("invoice action and prefix policy projections differ")
	}
	raw, wire, a, _, err := decodePQInvoiceHistory(entry)
	if err != nil {
		return err
	}
	data, err := json.Marshal(last)
	if err != nil {
		return err
	}
	if _, err = ValidatePQInvoiceEffectData(wire, raw, entry.Transaction.BlockNum, data); err != nil {
		return err
	}
	if a.Kind == ynxauth.ActionInvoiceTerms {
		if i.Transfer != nil || len(e.TraceLots) != len(entry.Transaction.LotFlows) {
			return errors.New("invoice terms acquired a principal transfer or unrelated lot lineage")
		}
		return validatePQActionFee(entry, e)
	}
	tx := entry.Transaction
	if len(tx.LotFlows) != 0 || len(e.TraceLots) != 0 || e.FeeRecipient == "" || e.Fee == nil || *e.Fee != newCurrentFeeEvent(entry.ABCITransactionHash, SignedTransactionType, tx.From, e.FeeRecipient, tx.Fee, int64(tx.BlockNum), tx.Timestamp) || i.Transfer == nil || *i.Transfer != (BFTNativeTransfer{TransactionHash: entry.ABCITransactionHash, From: tx.From, To: tx.To, Amount: tx.Amount, Fee: tx.Fee, BlockHeight: int64(tx.BlockNum), CommittedAt: tx.Timestamp}) {
		return errors.New("invoice payment/refund lacks exact native transfer and fee coverage")
	}
	return nil
}

// PQInvoiceActionResult returns the canonical replayed result after validating
// the complete history view. It is used to bind actual indexed ExecTxResult.Data
// to the original record, not merely to fields selected by an RPC response.
func PQInvoiceActionResult(v PQActionHistoryView, queryHeight int64) ([]byte, error) {
	_, a, err := ValidatePQActionHistoryView(v, queryHeight)
	if err != nil {
		return nil, err
	}
	if !ynxauth.IsInvoiceAction(a.Kind) {
		return nil, errors.New("action is not an invoice")
	}
	var e pqActionEffects
	if err = strictPQActionJSON(v.Effects, &e); err != nil {
		return nil, err
	}
	return json.Marshal(e.Invoice.Result)
}

func queryPQInvoice(response *abci.ResponseQuery, req *abci.RequestQuery, s CommittedState, m chain.ConsensusMigrationState) bool {
	if !strings.HasPrefix(req.Path, PQInvoiceQueryPath) {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	parts := strings.Split(strings.TrimPrefix(req.Path, PQInvoiceQueryPath), "/")
	if len(parts) != 2 || req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != s.Height {
		fail(errors.New("invoice query requires exact merchant/invoice and current committed state without data or proof"))
		return true
	}
	v, _, err := pqInvoiceView(s, m, parts[0], parts[1], "")
	if err != nil {
		fail(err)
		return true
	}
	response.Value, err = json.Marshal(v)
	if err != nil || len(response.Value) > MaxPQWalletQueryBytes {
		fail(errors.New("complete invoice query exceeds bounded response"))
	}
	return true
}
