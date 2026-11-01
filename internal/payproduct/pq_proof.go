//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"math"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Reconcile queries only the retained original native identity. The collector,
// including its HTTP200/committed flag, never supplies this method's trust.
func (n *NativePayService) Reconcile(ctx context.Context, merchant, id, nativeHash string) (NativePayOperation, error) {
	state, grant, err := n.readInvoiceWithGrant(ctx, merchant, id)
	if err != nil {
		return NativePayOperation{}, err
	}
	op, found := state.Operations[nativeHash]
	if !found {
		return op, errors.New("native operation not in original invoice journal")
	}
	if op.Status == "confirmed" || op.Status == "confirmed_failed" {
		return op, nil
	}
	if err = n.cfg.HTTP.registerOriginalReadRoutes(ctx, grant, op); err != nil {
		return op, err
	}
	observation, err := n.cfg.HTTP.Original(ctx, nativeHash)
	if err != nil {
		return op, err
	}
	op.Observation = &observation
	finality, err := n.cfg.HTTP.Finality(ctx, nativeHash)
	if err != nil {
		return op, err
	}
	if finality.Proof == nil || n.cfg.ProofSource == nil {
		return op, ErrNativePayUnavailable
	}
	original := op.NativePayOriginal
	original.Member = bytes.Clone(original.Member)
	original.Envelope = bytes.Clone(original.Envelope)
	trust, expected, err := n.cfg.ProofSource.Trust(ctx, original)
	if err != nil {
		return op, err
	}
	trust, expected, proof, err := freezeNativeArchiveVerificationInput(trust, expected, *finality.Proof)
	if err != nil {
		return op, err
	}
	nativeBytes, err := hex.DecodeString(nativeHash[2:])
	if err != nil {
		return op, err
	}
	abciBytes, err := hex.DecodeString(op.ABCIHash[2:])
	if err != nil {
		return op, err
	}
	if expected.TransactionType != consensus.PQActionType || !bytes.Equal(expected.NativeWire, op.Member) || !bytes.Equal(expected.Envelope, op.Envelope) || !bytes.Equal(expected.NativeWireHash, nativeBytes) || !bytes.Equal(expected.TransactionHash, abciBytes) {
		return op, errors.New("independent proof expectation differs from original native operation")
	}
	verified, err := consensus.VerifyPQTransactionProof(trust, expected, proof)
	if err != nil {
		return op, err
	}
	if !verified.Finalized || !verified.Included {
		return op, errors.New("transaction inclusion is not independent finality")
	}
	op.Status = "confirmed_failed"
	if verified.ExecutionSuccessful && verified.ExecutionCode == 0 {
		effect, err := consensus.ValidatePQInvoiceEffectData(op.Member, op.Envelope, uint64(verified.Height), verified.ExecutionData)
		if err != nil {
			return op, err
		}
		if err = n.bindEffect(state, op, effect); err != nil {
			return op, err
		}
		// The exact independently proven DATA is the only money projection source.
		view, err := n.cfg.HTTP.Invoice(ctx, merchant, id)
		if err != nil {
			return op, err
		}
		if err = consensus.ValidatePQInvoiceView(view, merchant, id, view.CommittedHeight); err != nil {
			return op, err
		}
		termsMember, err := ynxbatch.DecodeMember(state.Operations[state.TermsOperation].Member)
		if err != nil {
			return op, err
		}
		if view.Record.TermsHash != state.TermsHash || !bytes.Equal(view.Record.TermsMessage, termsMember.Message) {
			return op, errors.New("committed invoice prefix differs from original merchant terms")
		}
		seen := view.Record.TermsNativeHash == op.NativeHash
		if view.Record.Settlement != nil {
			seen = seen || view.Record.Settlement.NativeHash == op.NativeHash
		}
		for _, refund := range view.Record.Refunds {
			seen = seen || refund.NativeHash == op.NativeHash
		}
		if !seen {
			return op, errors.New("original operation absent from complete committed invoice prefix")
		}
		op.Status = "confirmed"
		op.Effect = &effect
		op.Failure = ""
	} else {
		op.Failure = "INDEPENDENTLY_PROVEN_EXECUTION_FAILED"
	}
	archive, err := n.captureOriginalArchive(state, op, trust, expected, proof, verified)
	if err != nil {
		return op, err
	}
	err = n.parent.store.Update(func(data *Snapshot) error {
		if e := n.fence(ctx, grant); e != nil {
			return e
		}
		current, found, e := n.load(*data, merchant, id)
		if e != nil {
			return e
		}
		if !found {
			return errors.New("original invoice journal missing")
		}
		old, found := current.Operations[nativeHash]
		if !found || !bytes.Equal(old.Member, op.Member) || !bytes.Equal(old.Envelope, op.Envelope) {
			return errors.New("original native operation changed")
		}
		if old.Status == "confirmed" || old.Status == "confirmed_failed" {
			if hashJSON(old.Effect) != hashJSON(op.Effect) || old.Status != op.Status {
				return errors.New("finalized original native fact changed")
			}
			op = old
			return nil
		}
		if _, exists := current.OriginalArchives[nativeHash]; exists {
			return errors.New("native original archive already present before finality transition")
		}
		if op.Effect != nil {
			if err = n.bindEffect(current, op, *op.Effect); err != nil {
				return err
			}
			claim := nativeEventClaim(*op.Effect)
			for _, record := range data.BusinessDispatches {
				if record.Operation != "native.invoice" {
					continue
				}
				text, e := n.parent.open(record.ResultCipher)
				var other NativePayInvoice
				if e != nil || strictJSON([]byte(text), &other) != nil {
					return errors.New("native event claims require recovery")
				}
				for hash, claimed := range other.Operations {
					if hash != nativeHash && claimed.Status == "confirmed" && claimed.Effect != nil && nativeEventClaim(*claimed.Effect) == claim {
						return errors.New("native funds event already claimed")
					}
				}
			}
			if current.ProductMerchantID != "" {
				registered, exists := data.Merchants[current.ProductMerchantID]
				if !exists {
					return errors.New("original product merchant binding unavailable")
				}
				ref := nativeInvoiceWebhookReference(current, *op.Effect)
				if err = n.parent.enqueueWebhookReference(data, registered, "native.invoice."+op.Kind, nativeHash, ref); err != nil {
					return err
				}
			}
		}
		current.Operations[nativeHash] = op
		if err = n.appendOriginalArchive(data, &current, op, archive); err != nil {
			return err
		}
		if err = n.save(data, current); err != nil {
			return err
		}
		appendAudit(data, current.ProductMerchantID, "native-proof", "native.invoice.finality", nativeHash, op.Status, "original H/H+1 independently verified", n.parent.now())
		return nil
	})
	return op, err
}

func nativeEventClaim(e consensus.PQInvoiceEffect) string {
	return hashJSON([]any{e.Genesis, e.ABCIHash, e.Member, e.Event})
}
func (n *NativePayService) bindEffect(state NativePayInvoice, op NativePayOperation, e consensus.PQInvoiceEffect) error {
	bad := errors.New("proven invoice effect differs from original merchant/session/principal/refund binding")
	if e.Genesis != hex.EncodeToString(n.cfg.Genesis) || e.NativeChainID != n.cfg.NativeChainID || e.Merchant != state.Merchant || e.InvoiceID != state.InvoiceID || e.SessionID != state.SessionID || e.TermsHash != state.TermsHash || e.TermsRevision != state.Terms.Revision || e.AssetID != state.Terms.AssetID || e.UnitVersion != state.Terms.UnitVersion || e.Kind != op.Kind || e.NativeHash != op.NativeHash || e.ABCIHash != op.ABCIHash || e.Fee != ynxauth.InvoiceActionFee || e.Member != 0 || e.Event != 0 {
		return bad
	}
	switch op.Kind {
	case ynxauth.ActionInvoiceTerms:
		if op.NativeHash != state.TermsOperation || e.Paid != 0 || e.Refunded != 0 || e.Principal != 0 || e.Recipient != state.Terms.Recipient || e.Payer != state.Terms.Payer {
			return bad
		}
	case ynxauth.ActionInvoiceSettle:
		if op.NativeHash != state.SettlementOperation || e.Payer != op.Owner || e.Recipient != state.Terms.Recipient || e.Height <= 0 || uint64(e.Height) > state.Terms.ExpiresAt || e.Principal != state.Terms.Amount || e.Paid != state.Terms.Amount || e.Refunded != 0 {
			return bad
		}
	case ynxauth.ActionInvoiceRefund:
		settled := state.Operations[state.SettlementOperation]
		if settled.Status != "confirmed" || settled.Effect == nil || e.Payer != settled.Effect.Payer || e.Recipient != settled.Effect.Payer || e.SettlementNativeHash != settled.NativeHash || state.RefundOperations[e.RefundID] != op.NativeHash || e.Paid != state.Terms.Amount {
			return bad
		}
		var prior uint64
		for _, hash := range state.RefundOperations {
			old := state.Operations[hash]
			if hash != op.NativeHash && old.Status == "confirmed" && old.Effect != nil {
				if old.Effect.Principal > state.Terms.Amount-prior {
					return bad
				}
				prior += old.Effect.Principal
			}
		}
		if e.Principal > state.Terms.Amount-prior || e.Refunded != prior+e.Principal || e.NetPaid != state.Terms.Amount-e.Refunded {
			return bad
		}
	default:
		return bad
	}
	return nil
}

func (n *NativePayService) PrepareRefund(ctx context.Context, merchant, id, refundID string, amount uint64) (NativePaySigningRequest, error) {
	state, err := n.Read(ctx, merchant, id)
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	grant, err := n.grant(ctx, NativePayAccess{Operation: "review_refund", Merchant: merchant, InvoiceID: id})
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	settled := state.Operations[state.SettlementOperation]
	if grant.Principal != merchant || settled.Status != "confirmed" || settled.Effect == nil || grant.LedgerNonce == math.MaxUint64 {
		return NativePaySigningRequest{}, errors.New("original merchant and verified settlement required")
	}
	termsHash, _ := hex.DecodeString(state.TermsHash)
	settlementHash, _ := hex.DecodeString(settled.NativeHash[2:])
	var reserved uint64
	for key, hash := range state.RefundOperations {
		if key == refundID && state.Operations[hash].Status != "confirmed_failed" {
			return NativePaySigningRequest{}, errors.New("refund business ID already reserved")
		}
		op := state.Operations[hash]
		if op.Status == "confirmed_failed" {
			continue
		}
		if op.Status != "confirmed" || op.Effect == nil {
			return NativePaySigningRequest{}, errors.New("original refund outcome unresolved")
		}
		if op.Effect.Principal > state.Terms.Amount-reserved {
			return NativePaySigningRequest{}, errors.New("refund totals require recovery")
		}
		reserved += op.Effect.Principal
	}
	if amount == 0 || amount > state.Terms.Amount-reserved {
		return NativePaySigningRequest{}, errors.New("refund exceeds remaining original principal")
	}
	body, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceRefund, ynxauth.InvoiceRefundPayload{InvoiceID: id, RefundID: refundID, TermsHash: termsHash, SettlementHash: settlementHash, Amount: amount})
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	action := ynxauth.Action{ChainID: bytes.Clone(n.cfg.Genesis), NativeChainID: n.cfg.NativeChainID, Owner: merchant, Nonce: grant.LedgerNonce + 1, Fee: ynxauth.InvoiceActionFee, Kind: ynxauth.ActionInvoiceRefund, Payload: body}
	message, err := action.SigningBytes()
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	if err = n.fence(ctx, grant); err != nil {
		return NativePaySigningRequest{}, err
	}
	return NativePaySigningRequest{Kind: action.Kind, Action: action, Message: message, Status: "awaiting_original_native_signature"}, nil
}

// This projection is called only after the original independent finality/effect
// checks above. Callback recipients must still use their own qualified reader.
func nativeInvoiceWebhookReference(state NativePayInvoice, e consensus.PQInvoiceEffect) *NativeWebhookReference {
	return &NativeWebhookReference{Version: "ynx.pay.native.webhook-reference/v1", Genesis: e.Genesis, NativeChainID: strconv.FormatUint(e.NativeChainID, 10), Merchant: e.Merchant, InvoiceID: e.InvoiceID, SessionID: e.SessionID, SourceOrder: state.SourceOrder, NativeHash: e.NativeHash, ABCIHash: e.ABCIHash, EventClaim: nativeEventClaim(e)}
}
