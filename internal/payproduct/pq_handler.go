//go:build pay_pq

package payproduct

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"io"
	"net/http"
	"strconv"
)

func (s *Server) MountNativePay(service *NativePayService) error {
	if service == nil || service.parent != s.service || service.cfg.Authority == nil {
		return ErrNativePayUnavailable
	}
	s.nativePay = service.Handler()
	return nil
}

// Every route goes through the configured real in-process Source authority.
// No JSON request can supply a registration, grant, proof anchor or private key.
func (n *NativePayService) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v5/pay/invoices/{merchant}/{invoice}/originals/{nativeHash}", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.ContentLength != 0 {
			nativePayError(w, errors.New("exact original archive GET without body/query required"))
			return
		}
		archive, err := n.ReadOriginalArchive(r.Context(), r.PathValue("merchant"), r.PathValue("invoice"), r.PathValue("nativeHash"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, archive)
	})
	mux.HandleFunc("GET /v5/pay/invoices/{merchant}/{invoice}/events", func(w http.ResponseWriter, r *http.Request) {
		feed, err := n.InvoiceEvents(r.Context(), r.PathValue("merchant"), r.PathValue("invoice"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, feed)
	})
	mux.HandleFunc("POST /v5/pay/invoice-terms/review", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			SourceOrder string                     `json:"sourceOrder"`
			Terms       map[string]json.RawMessage `json:"terms"`
		}
		if !nativePayBody(w, r, &input) {
			return
		}
		// Numeric terms are canonical decimal strings on the product HTTP edge;
		// use CORE's sole typed encoder after exact integer conversion.
		terms, err := decodeNativeTermsInput(input.Terms)
		if err != nil {
			nativePayError(w, err)
			return
		}
		prepared, err := n.PrepareTerms(r.Context(), input.SourceOrder, terms)
		if err != nil {
			nativePayError(w, err)
			return
		}
		nativeSigningResponse(w, prepared)
	})
	mux.HandleFunc("POST /v5/pay/invoices", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			SourceOrder string `json:"sourceOrder"`
			Member      []byte `json:"member"`
		}
		if !nativePayBody(w, r, &input) {
			return
		}
		op, err := n.RegisterTerms(r.Context(), input.SourceOrder, input.Member)
		if err != nil {
			nativePayError(w, err)
			return
		}
		if _, err = n.Read(r.Context(), op.Merchant, op.InvoiceID); err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, op)
	})
	mux.HandleFunc("GET /v5/pay/invoices/{merchant}/{invoice}", func(w http.ResponseWriter, r *http.Request) {
		state, err := n.Read(r.Context(), r.PathValue("merchant"), r.PathValue("invoice"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		view, err := nativeInvoiceProjection(state)
		if err != nil {
			nativePayError(w, err)
			return
		}
		// Original stored signing DATA, not reconstructed terms/current pricing.
		// Keep this on the authenticated GET only; POST observations retain their
		// existing exact response contract. It grants no approval or finality.
		member, err := ynxbatch.DecodeMember(state.Operations[state.TermsOperation].Member)
		if err != nil {
			nativePayError(w, err)
			return
		}
		digest := sha256.Sum256(member.Message)
		if hex.EncodeToString(digest[:]) != state.TermsHash {
			nativePayError(w, errors.New("stored native terms message hash differs"))
			return
		}
		view["termsMessage"] = bytes.Clone(member.Message)
		writeJSON(w, http.StatusOK, view)
	})
	for _, refund := range []bool{false, true} {
		suffix := "settlements"
		if refund {
			suffix = "refunds"
		}
		refund := refund
		mux.HandleFunc("POST /v5/pay/invoices/{merchant}/{invoice}/"+suffix, func(w http.ResponseWriter, r *http.Request) {
			var input struct {
				Member []byte `json:"member"`
			}
			if !nativePayBody(w, r, &input) {
				return
			}
			merchant, id := r.PathValue("merchant"), r.PathValue("invoice")
			var op NativePayOperation
			var err error
			if refund {
				op, err = n.SubmitRefund(r.Context(), merchant, id, input.Member)
			} else {
				op, err = n.SubmitSettlement(r.Context(), merchant, id, input.Member)
			}
			if err != nil {
				nativePayError(w, err)
				return
			}
			if _, err = n.Read(r.Context(), merchant, id); err != nil {
				nativePayError(w, err)
				return
			}
			writeJSON(w, http.StatusAccepted, op)
		})
	}
	mux.HandleFunc("POST /v5/pay/invoices/{merchant}/{invoice}/operations/{hash}/reconcile", func(w http.ResponseWriter, r *http.Request) {
		var input struct{}
		if !nativePayBody(w, r, &input) {
			return
		}
		merchant, id := r.PathValue("merchant"), r.PathValue("invoice")
		op, err := n.Reconcile(r.Context(), merchant, id, r.PathValue("hash"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		if _, err = n.Read(r.Context(), merchant, id); err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, op)
	})
	mux.HandleFunc("POST /v5/pay/invoices/{merchant}/{invoice}/review", func(w http.ResponseWriter, r *http.Request) {
		var input struct{}
		if !nativePayBody(w, r, &input) {
			return
		}
		prepared, err := n.PrepareSettlement(r.Context(), r.PathValue("merchant"), r.PathValue("invoice"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		nativeSigningResponse(w, prepared)
	})
	mux.HandleFunc("POST /v5/pay/invoices/{merchant}/{invoice}/refund-review", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			RefundID string `json:"refundId"`
			Amount   string `json:"amountAtoms"`
		}
		if !nativePayBody(w, r, &input) {
			return
		}
		amount, err := strconv.ParseUint(input.Amount, 10, 64)
		if err != nil || strconv.FormatUint(amount, 10) != input.Amount {
			nativePayError(w, errors.New("canonical decimal refund atoms required"))
			return
		}
		prepared, err := n.PrepareRefund(r.Context(), r.PathValue("merchant"), r.PathValue("invoice"), input.RefundID, amount)
		if err != nil {
			nativePayError(w, err)
			return
		}
		nativeSigningResponse(w, prepared)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.RawQuery != "" || r.URL.RawPath != "" {
			nativePayError(w, errors.New("exact native Pay route required"))
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func nativeSigningResponse(w http.ResponseWriter, p NativePaySigningRequest) {
	writeJSON(w, http.StatusOK, map[string]any{"kind": p.Kind, "message": p.Message, "status": p.Status, "owner": p.Action.Owner, "nonce": strconv.FormatUint(p.Action.Nonce, 10), "feeAtoms": strconv.FormatUint(p.Action.Fee, 10)})
}
func nativePayBody(w http.ResponseWriter, r *http.Request, out any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil || nativePayHTTPDecode(raw, out) != nil {
		nativePayError(w, errors.New("bounded exact native Pay request required"))
		return false
	}
	return true
}
func nativePayError(w http.ResponseWriter, err error) {
	code, status := "NATIVE_PAY_REQUEST_REJECTED", http.StatusConflict
	if errors.Is(err, ErrNativePayOriginalArchiveUnavailable) {
		code = "NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE"
	}
	if errors.Is(err, ErrNativePayUnavailable) || errors.Is(err, ErrNativeMerchantFenceUnavailable) {
		code, status = "NATIVE_PAY_AUTHORITY_UNAVAILABLE", http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]string{"code": code, "error": err.Error()})
}
func nativeInvoiceProjection(s NativePayInvoice) (map[string]any, error) {
	status := "awaiting_terms_finality"
	paid, refunded, termsFee, paymentFee, refundFees := uint64(0), uint64(0), uint64(0), uint64(0), uint64(0)
	terms := s.Operations[s.TermsOperation]
	if terms.Status == "confirmed" {
		if terms.Effect == nil {
			return nil, errors.New("verified terms effect unavailable")
		}
		status = "awaiting_wallet"
		termsFee = terms.Effect.Fee
	}
	if op, exists := s.Operations[s.SettlementOperation]; exists {
		status = "unknown"
		if op.Status == "confirmed_failed" {
			status = "confirmed_failed"
		}
		if op.Status == "confirmed" && op.Effect != nil {
			status = "committed_paid"
			paid = op.Effect.Paid
			paymentFee = op.Effect.Fee
		}
	}
	refundStatus := "none"
	for _, hash := range s.RefundOperations {
		op := s.Operations[hash]
		if op.Status == "confirmed" && op.Effect != nil {
			if op.Effect.Principal > paid-refunded {
				return nil, errors.New("verified refund projection exceeds original paid principal")
			}
			refunded += op.Effect.Principal
			refundFees += op.Effect.Fee
		} else if op.Status != "confirmed_failed" {
			refundStatus = "unknown"
		}
	}
	if refundStatus != "unknown" && refunded > 0 {
		refundStatus = "partial_refund"
		if refunded == paid {
			refundStatus = "refunded"
		}
	}
	termsOp := s.Operations[s.TermsOperation]
	member, err := ynxbatch.DecodeMember(termsOp.Member)
	if err != nil {
		return nil, err
	}
	action, err := ynxauth.DecodeAction(member.Message)
	if err != nil {
		return nil, err
	}
	return map[string]any{"genesis": hex.EncodeToString(action.ChainID), "nativeChainId": strconv.FormatUint(action.NativeChainID, 10), "merchant": s.Merchant, "invoiceId": s.InvoiceID, "sessionId": s.SessionID, "sourceOrder": s.SourceOrder, "status": status, "refundStatus": refundStatus, "assetId": s.Terms.AssetID, "unitVersion": s.Terms.UnitVersion, "principalAtoms": strconv.FormatUint(s.Terms.Amount, 10), "paidAtoms": strconv.FormatUint(paid, 10), "refundedAtoms": strconv.FormatUint(refunded, 10), "netPaidAtoms": strconv.FormatUint(paid-refunded, 10), "termsFeeAtoms": strconv.FormatUint(termsFee, 10), "paymentFeeAtoms": strconv.FormatUint(paymentFee, 10), "refundFeeAtoms": strconv.FormatUint(refundFees, 10), "feeRule": s.Terms.FeeRule, "maxFeeAtoms": strconv.FormatUint(s.Terms.MaxFee, 10), "expiresAtHeight": strconv.FormatUint(s.Terms.ExpiresAt, 10), "termsHash": s.TermsHash, "termsMember": termsOp.Member, "termsEnvelope": termsOp.Envelope, "termsNativeHash": termsOp.NativeHash, "settlementNativeHash": s.SettlementOperation, "operations": s.Operations, "authority": "core-native-invoice-proof-gated"}, nil
}

func decodeNativeTermsInput(fields map[string]json.RawMessage) (ynxauth.InvoiceTermsPayload, error) {
	var p ynxauth.InvoiceTermsPayload
	stringsOut := map[string]*string{"invoiceId": &p.InvoiceID, "sessionId": &p.SessionID, "recipient": &p.Recipient, "payer": &p.Payer, "assetId": &p.AssetID, "unitVersion": &p.UnitVersion, "feeRule": &p.FeeRule}
	numbers := map[string]*uint64{"keyEpoch": &p.KeyEpoch, "revision": &p.Revision, "amountAtoms": &p.Amount, "maxFeeAtoms": &p.MaxFee, "expiresAtHeight": &p.ExpiresAt}
	if len(fields) != len(stringsOut)+len(numbers) {
		return p, errors.New("complete exact Core terms fields required")
	}
	for name, target := range stringsOut {
		if json.Unmarshal(fields[name], target) != nil {
			return p, errors.New("Core terms string field missing or invalid")
		}
	}
	for name, target := range numbers {
		var value string
		if json.Unmarshal(fields[name], &value) != nil {
			return p, errors.New("canonical decimal Core terms integer required")
		}
		n, err := strconv.ParseUint(value, 10, 64)
		if err != nil || strconv.FormatUint(n, 10) != value {
			return p, errors.New("canonical decimal Core terms integer required")
		}
		*target = n
	}
	_, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, p)
	return p, err
}
