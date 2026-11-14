//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Compact public reconciliation DATA for the original product. It is not a
// signer, grant, current balance, retry permission or private payer review.
type NativePayArchiveReceipt struct {
	Version              string `json:"version"`
	ProductID            string `json:"productId"`
	StoreID              string `json:"storeId,omitempty"`
	SourceOrder          string `json:"sourceOrder"`
	Merchant             string `json:"merchant"`
	InvoiceID            string `json:"invoiceId"`
	SessionID            string `json:"sessionId"`
	Genesis              string `json:"genesis"`
	NativeChainID        string `json:"nativeChainId"`
	NativeHash           string `json:"nativeHash"`
	ABCIHash             string `json:"abciHash"`
	Kind                 string `json:"kind"`
	Status               string `json:"status"`
	ArchiveDigest        string `json:"archiveDigest"`
	TermsHash            string `json:"termsHash"`
	SettlementNativeHash string `json:"settlementNativeHash,omitempty"`
	RefundID             string `json:"refundId,omitempty"`
	Payer                string `json:"payer,omitempty"`
	Recipient            string `json:"recipient,omitempty"`
	AssetID              string `json:"assetId"`
	UnitVersion          string `json:"unitVersion"`
	EventClaim           string `json:"eventClaim,omitempty"`
	ExecutionHeight      string `json:"executionHeight"`
	ExecutionIndex       string `json:"executionIndex"`
	ExecutionMember      string `json:"executionMember"`
	ExecutionEvent       string `json:"executionEvent"`
	PrincipalAtoms       string `json:"principalAtoms"`
	PaidAtoms            string `json:"paidAtoms"`
	RefundedAtoms        string `json:"refundedAtoms"`
	NetPaidAtoms         string `json:"netPaidAtoms"`
	ProofVerification    string `json:"proofVerification"`
	DataOnly             bool   `json:"dataOnly"`
	QueryOnly            bool   `json:"queryOnly"`
	CanRetry             bool   `json:"canRetry"`
	SourceAdmission      bool   `json:"SourceAdmission"`
	NativeGrant          bool   `json:"nativeGrant"`
}
type NativePayArchiveReconciliation struct {
	Version                string                    `json:"version"`
	ProductID              string                    `json:"productId"`
	StoreID                string                    `json:"storeId,omitempty"`
	SourceOrder            string                    `json:"sourceOrder"`
	Merchant               string                    `json:"merchant"`
	InvoiceID              string                    `json:"invoiceId"`
	Genesis                string                    `json:"genesis"`
	NativeChainID          string                    `json:"nativeChainId"`
	PrincipalAtoms         string                    `json:"principalAtoms"`
	PaidAtoms              string                    `json:"paidAtoms"`
	RefundedAtoms          string                    `json:"refundedAtoms"`
	NetPaidAtoms           string                    `json:"netPaidAtoms"`
	Receipts               []NativePayArchiveReceipt `json:"receipts"`
	PendingOriginals       []string                  `json:"pendingOriginals"`
	CompleteKnownOriginals bool                      `json:"completeKnownOriginals"`
	ProofVerification      string                    `json:"proofVerification"`
	DataOnly               bool                      `json:"dataOnly"`
	QueryOnly              bool                      `json:"queryOnly"`
	CanRetry               bool                      `json:"canRetry"`
	SourceAdmission        bool                      `json:"SourceAdmission"`
	NativeGrant            bool                      `json:"nativeGrant"`
}

func (c *NativeInvoiceIntentClient) originalArchiveIntent(ctx context.Context, original NativeInvoiceProductIntent, id string, current func() error) (NativeInvoiceIntentView, error) {
	if current == nil {
		return NativeInvoiceIntentView{}, ErrNativePayUnavailable
	}
	if err := current(); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	original.DomainData = bytes.Clone(original.DomainData)
	view, err := c.ReadInvoiceIntent(ctx, nativeIntentSlot(original))
	if err != nil {
		return view, err
	}
	if err = current(); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if validateNativeIntentReply(original, view) != nil || view.Terms.InvoiceID != id || view.Merchant != original.Merchant {
		return NativeInvoiceIntentView{}, errors.New("archive reference differs from original product intent")
	}
	return view, nil
}

func verifyNativeArchiveReceipt(ctx context.Context, a NativePayOriginalArchive, source NativePayProofSource) (consensus.PQTransactionProofResult, error) {
	if source == nil {
		return consensus.PQTransactionProofResult{}, ErrNativePayUnavailable
	}
	original := a.Original
	original.Member = bytes.Clone(original.Member)
	original.Envelope = bytes.Clone(original.Envelope)
	trust, expected, err := source.Trust(ctx, original)
	if err != nil {
		return consensus.PQTransactionProofResult{}, err
	}
	trust, expected, proof, err := freezeNativeArchiveVerificationInput(trust, expected, a.Proof)
	if err != nil {
		return consensus.PQTransactionProofResult{}, err
	}
	// The archived anchor/result cannot select its own trust or expected headers.
	if hashJSON(expected) != hashJSON(a.Expected) || expected.TransactionType != consensus.PQActionType || !bytes.Equal(expected.NativeWire, a.Original.Member) || !bytes.Equal(expected.Envelope, a.Original.Envelope) || consensus.SignedTransactionHash(a.Original.Member) != a.Original.NativeHash || consensus.SignedTransactionHash(a.Original.Envelope) != a.Original.ABCIHash {
		return consensus.PQTransactionProofResult{}, errors.New("independent archive expectation differs from original")
	}
	verified, err := consensus.VerifyPQTransactionProof(trust, expected, proof)
	if err != nil {
		return verified, err
	}
	if !verified.Finalized || !verified.Included || verified.NativeGrant || "0x"+verified.NativeWireHash != a.Original.NativeHash || "0x"+verified.TransactionHash != a.Original.ABCIHash || verified.Height != a.Verified.Height || verified.Index != a.Verified.Index || verified.TransactionHash != a.Verified.TransactionHash || verified.NativeWireHash != a.Verified.NativeWireHash || verified.ExecutionCode != a.Verified.ExecutionCode || !bytes.Equal(verified.ExecutionData, a.Verified.ExecutionData) || verified.ExecutionSuccessful != a.Verified.ExecutionSuccessful {
		return verified, errors.New("independent archived proof result differs")
	}
	return verified, nil
}

func (c *NativeInvoiceIntentClient) readArchiveReceipt(ctx context.Context, original NativeInvoiceProductIntent, intent NativeInvoiceIntentView, nativeHash string, source NativePayProofSource, current func() error) (NativePayArchiveReceipt, error) {
	var receipt NativePayArchiveReceipt
	a, err := c.ReadOriginalArchive(ctx, original.Merchant, intent.Terms.InvoiceID, nativeHash, current)
	if err != nil {
		return receipt, err
	}
	return nativeArchiveReceiptForIntent(ctx, original, intent, nativeHash, a, source, current)
}

func nativeArchiveReceiptForIntent(ctx context.Context, original NativeInvoiceProductIntent, intent NativeInvoiceIntentView, nativeHash string, a NativePayOriginalArchive, source NativePayProofSource, current func() error) (NativePayArchiveReceipt, error) {
	var receipt NativePayArchiveReceipt
	if a.Genesis != original.Genesis || strconv.FormatUint(a.NativeChainID, 10) != original.NativeChainID || a.SourceOrder != original.SourceOrder || a.SessionID != intent.Terms.SessionID || a.Original.Merchant != original.Merchant || a.Original.InvoiceID != intent.Terms.InvoiceID || a.TermsHash != intent.SigningMessageHash {
		return receipt, errors.New("archive product/order/terms binding changed")
	}
	action, err := ynxauth.DecodeAction(a.TermsMessage)
	if err != nil {
		return receipt, err
	}
	payload, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	terms, ok := payload.(ynxauth.InvoiceTermsPayload)
	if err != nil || !ok || action.Kind != ynxauth.ActionInvoiceTerms || action.Owner != original.Merchant || hex.EncodeToString(action.ChainID) != original.Genesis || action.NativeChainID != a.NativeChainID || terms.InvoiceID != intent.Terms.InvoiceID || terms.SessionID != intent.Terms.SessionID || terms.Recipient != original.Recipient || strconv.FormatUint(terms.Amount, 10) != original.AmountAtoms || terms.AssetID != original.AssetID || terms.UnitVersion != original.UnitVersion || nativeIntentMessageHash(a.TermsMessage) != a.TermsHash {
		return receipt, errors.New("archive canonical original terms differ")
	}
	verified, err := verifyNativeArchiveReceipt(ctx, a, source)
	if err != nil {
		return receipt, err
	}
	if err = current(); err != nil {
		return receipt, err
	}
	member, err := ynxbatch.DecodeMember(a.Original.Member)
	if err != nil {
		return receipt, err
	}
	receipt = NativePayArchiveReceipt{Version: "ynx.pay.native.archive-receipt/v1", ProductID: original.ProductID, StoreID: original.StoreID, SourceOrder: original.SourceOrder, Merchant: original.Merchant, InvoiceID: intent.Terms.InvoiceID, SessionID: a.SessionID, Genesis: a.Genesis, NativeChainID: original.NativeChainID, NativeHash: nativeHash, ABCIHash: a.Original.ABCIHash, Kind: a.Kind, Status: a.Status, ArchiveDigest: a.Digest, TermsHash: a.TermsHash, AssetID: original.AssetID, UnitVersion: original.UnitVersion, ExecutionHeight: strconv.FormatInt(verified.Height, 10), ExecutionIndex: strconv.FormatInt(verified.Index, 10), ExecutionMember: strconv.FormatUint(uint64(member.Index), 10), ExecutionEvent: "0", PrincipalAtoms: "0", PaidAtoms: "0", RefundedAtoms: "0", NetPaidAtoms: "0", ProofVerification: "original-independent-core-verifier", DataOnly: true, QueryOnly: true}
	if verified.ExecutionSuccessful {
		effect, e := consensus.ValidatePQInvoiceEffectData(a.Original.Member, a.Original.Envelope, uint64(verified.Height), verified.ExecutionData)
		if e != nil || a.Status != "confirmed" || a.Effect == nil || effect.Kind != a.Kind || hashJSON(effect) != hashJSON(*a.Effect) || a.EventClaim != nativeEventClaim(effect) || effect.Merchant != original.Merchant || effect.InvoiceID != intent.Terms.InvoiceID || effect.SessionID != a.SessionID || effect.TermsHash != a.TermsHash || effect.NativeHash != nativeHash || effect.ABCIHash != a.Original.ABCIHash {
			return NativePayArchiveReceipt{}, errors.New("archive canonical effect receipt differs")
		}
		receipt.EventClaim = a.EventClaim
		receipt.SettlementNativeHash = effect.SettlementNativeHash
		receipt.RefundID = effect.RefundID
		receipt.Payer = effect.Payer
		receipt.Recipient = effect.Recipient
		receipt.ExecutionMember = strconv.FormatUint(uint64(effect.Member), 10)
		receipt.ExecutionEvent = strconv.FormatUint(uint64(effect.Event), 10)
		receipt.PrincipalAtoms = strconv.FormatUint(effect.Principal, 10)
		receipt.PaidAtoms = strconv.FormatUint(effect.Paid, 10)
		receipt.RefundedAtoms = strconv.FormatUint(effect.Refunded, 10)
		receipt.NetPaidAtoms = strconv.FormatUint(effect.NetPaid, 10)
	} else if a.Status != "confirmed_failed" || a.Effect != nil {
		return NativePayArchiveReceipt{}, errors.New("failed archive carries successful effect")
	}
	return receipt, nil
}

func jsonOperationMap(invoice map[string]any) (map[string]NativePayOperation, error) {
	var operations map[string]NativePayOperation
	if invoice == nil || invoice["operations"] == nil {
		return nil, errors.New("original invoice operation map unavailable")
	}
	raw, err := json.Marshal(invoice["operations"])
	if err != nil || len(raw) > 16<<20 {
		return nil, errors.New("bounded original operation map required")
	}
	if err = strictJSON(raw, &operations); err != nil {
		return nil, err
	}
	if len(operations) > 1024 {
		return nil, errors.New("bounded original operation count required")
	}
	for hash, op := range operations {
		if hash != op.NativeHash {
			return nil, errors.New("original operation hash map changed")
		}
	}
	return operations, nil
}

// GET only. Real independent Source trust is mandatory; the archived result or
// anchor is never substituted for it. No reconciliation or money POST occurs.
func (c *NativeInvoiceIntentClient) ReadOriginalArchiveReceipt(ctx context.Context, original NativeInvoiceProductIntent, id, nativeHash string, source NativePayProofSource, current func() error) (NativePayArchiveReceipt, error) {
	intent, err := c.originalArchiveIntent(ctx, original, id, current)
	if err != nil {
		return NativePayArchiveReceipt{}, err
	}
	return c.readArchiveReceipt(ctx, original, intent, nativeHash, source, current)
}

func (c *NativeInvoiceIntentClient) ReadOriginalArchiveReconciliation(ctx context.Context, original NativeInvoiceProductIntent, id string, source NativePayProofSource, current func() error) (NativePayArchiveReconciliation, error) {
	var out NativePayArchiveReconciliation
	intent, err := c.originalArchiveIntent(ctx, original, id, current)
	if err != nil {
		return out, err
	}
	return nativeArchiveReconciliationForIntent(original, id, intent,
		func(hash string) (NativePayArchiveReceipt, error) {
			return c.readArchiveReceipt(ctx, original, intent, hash, source, current)
		},
		func() (NativeInvoiceIntentView, error) { return c.originalArchiveIntent(ctx, original, id, current) })
}
func nativeArchiveReconciliationForIntent(original NativeInvoiceProductIntent, id string, intent NativeInvoiceIntentView, readReceipt func(string) (NativePayArchiveReceipt, error), readAgain func() (NativeInvoiceIntentView, error)) (NativePayArchiveReconciliation, error) {
	var out NativePayArchiveReconciliation
	raw, err := jsonOperationMap(intent.Invoice)
	if err != nil {
		return out, err
	}
	out = NativePayArchiveReconciliation{Version: "ynx.pay.native.archive-reconciliation/v1", ProductID: original.ProductID, StoreID: original.StoreID, SourceOrder: original.SourceOrder, Merchant: original.Merchant, InvoiceID: id, Genesis: original.Genesis, NativeChainID: original.NativeChainID, PrincipalAtoms: original.AmountAtoms, PaidAtoms: "0", RefundedAtoms: "0", NetPaidAtoms: "0", Receipts: []NativePayArchiveReceipt{}, PendingOriginals: []string{}, ProofVerification: "original-independent-core-verifier", DataOnly: true, QueryOnly: true}
	for hash, op := range raw {
		if op.Kind != ynxauth.ActionInvoiceSettle && op.Kind != ynxauth.ActionInvoiceRefund {
			continue
		}
		if op.Status != "confirmed" && op.Status != "confirmed_failed" {
			out.PendingOriginals = append(out.PendingOriginals, hash)
			continue
		}
		receipt, e := readReceipt(hash)
		if e != nil {
			return NativePayArchiveReconciliation{}, e
		}
		out.Receipts = append(out.Receipts, receipt)
	}
	// Core execution order, never a transaction-hash ordering. Independent
	// proofs authenticate the block transaction index and original Member.
	coordinates := make(map[string][4]uint64, len(out.Receipts))
	used := make(map[[4]uint64]bool, len(out.Receipts))
	for _, receipt := range out.Receipts {
		var coordinate [4]uint64
		for i, field := range []string{receipt.ExecutionHeight, receipt.ExecutionIndex, receipt.ExecutionMember, receipt.ExecutionEvent} {
			n, e := strconv.ParseUint(field, 10, 64)
			if e != nil || strconv.FormatUint(n, 10) != field || i == 0 && n == 0 || i > 0 && n > 1<<32-1 {
				return NativePayArchiveReconciliation{}, errors.New("archive execution coordinate invalid")
			}
			coordinate[i] = n
		}
		if used[coordinate] {
			return NativePayArchiveReconciliation{}, errors.New("archive execution coordinate repeated")
		}
		used[coordinate], coordinates[receipt.NativeHash] = true, coordinate
	}
	sort.Slice(out.Receipts, func(i, j int) bool {
		a, b := coordinates[out.Receipts[i].NativeHash], coordinates[out.Receipts[j].NativeHash]
		for k := range a {
			if a[k] != b[k] {
				return a[k] < b[k]
			}
		}
		return false
	})
	sort.Strings(out.PendingOriginals)
	var paid, refunded uint64
	settlement := ""
	refundIDs := make(map[string]bool)
	for _, receipt := range out.Receipts {
		if receipt.Status != "confirmed" {
			continue
		}
		amount, _ := strconv.ParseUint(receipt.PrincipalAtoms, 10, 64)
		if receipt.Kind == ynxauth.ActionInvoiceSettle {
			if settlement != "" || receipt.PrincipalAtoms != original.AmountAtoms || receipt.PaidAtoms != original.AmountAtoms || receipt.RefundedAtoms != "0" {
				return NativePayArchiveReconciliation{}, errors.New("more than one original payment claim")
			}
			settlement = receipt.NativeHash
			paid = amount
		} else {
			if settlement == "" || receipt.SettlementNativeHash != settlement || amount > paid-refunded || receipt.RefundID == "" || refundIDs[receipt.RefundID] {
				return NativePayArchiveReconciliation{}, errors.New("refund receipt original settlement/principal mismatch")
			}
			refundIDs[receipt.RefundID] = true
			refunded += amount
			if receipt.RefundedAtoms != strconv.FormatUint(refunded, 10) || receipt.NetPaidAtoms != strconv.FormatUint(paid-refunded, 10) {
				return NativePayArchiveReconciliation{}, errors.New("archived refund history incomplete or cumulative amount changed")
			}
		}
	}
	again, err := readAgain()
	if err != nil {
		return NativePayArchiveReconciliation{}, err
	}
	if hashJSON(again.Invoice) != hashJSON(intent.Invoice) {
		return NativePayArchiveReconciliation{}, errors.New("original invoice changed during archive reconciliation")
	}
	out.PaidAtoms = strconv.FormatUint(paid, 10)
	out.RefundedAtoms = strconv.FormatUint(refunded, 10)
	out.NetPaidAtoms = strconv.FormatUint(paid-refunded, 10)
	out.CompleteKnownOriginals = len(out.PendingOriginals) == 0
	return out, nil
}
