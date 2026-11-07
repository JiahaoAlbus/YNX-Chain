//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// NativeInvoiceProductIntent is product DATA, never a signing wire or grant.
// DomainData retains the originating immutable bill/order, price/approval refs
// and sample binding so the original Source can resolve and approve them.
type NativeInvoiceProductIntent struct {
	ProductID     string          `json:"productId"`
	StoreID       string          `json:"storeId,omitempty"`
	SourceOrder   string          `json:"sourceOrder"`
	Merchant      string          `json:"merchant"`
	Recipient     string          `json:"recipient"`
	Genesis       string          `json:"genesis"`
	NativeChainID string          `json:"nativeChainId"`
	AssetID       string          `json:"assetId"`
	UnitVersion   string          `json:"unitVersion"`
	AmountAtoms   string          `json:"amountAtoms"`
	DomainData    json.RawMessage `json:"domainData"`
}
type NativeInvoiceIntentAccess struct {
	Operation string
	IntentID  string
	Intent    NativeInvoiceProductIntent
}

// Only original Source constructs this current private caller/bill binding.
// It must verify registered merchant, product/store association, exact bill or
// order and its approved price. Terms/Caller received via JSON are not grants.
type NativeInvoiceIntentBinding struct {
	Caller   string
	Merchant string
	Terms    ynxauth.InvoiceTermsPayload
	Until    time.Time
	Current  func() error
}
type NativeInvoiceIntentSource interface {
	ResolveInvoiceIntent(context.Context, NativeInvoiceIntentAccess) (NativeInvoiceIntentBinding, error)
}
type NativeInvoiceIntentProducer interface {
	CreateInvoiceIntent(context.Context, NativeInvoiceProductIntent, func() error) (NativeInvoiceIntentView, error)
	LookupInvoiceIntent(context.Context, NativeInvoiceProductIntent) (NativeInvoiceIntentView, error)
}
type NativeInvoiceTermsData struct {
	InvoiceID       string `json:"invoiceId"`
	SessionID       string `json:"sessionId"`
	Recipient       string `json:"recipient"`
	Payer           string `json:"payer"`
	AssetID         string `json:"assetId"`
	UnitVersion     string `json:"unitVersion"`
	FeeRule         string `json:"feeRule"`
	KeyEpoch        string `json:"keyEpoch"`
	Revision        string `json:"revision"`
	AmountAtoms     string `json:"amountAtoms"`
	MaxFeeAtoms     string `json:"maxFeeAtoms"`
	ExpiresAtHeight string `json:"expiresAtHeight"`
}
type NativeInvoiceIntentView struct {
	SigningMessageHash string                     `json:"signingMessageHash"`
	IntentID           string                     `json:"intentId"`
	OriginalOperation  string                     `json:"originalOperation"`
	Request            NativeInvoiceProductIntent `json:"request"`
	State              string                     `json:"state"` // PREPARED or ISSUED; never paid.
	Phase              string                     `json:"phase"`
	Merchant           string                     `json:"merchant"`
	Terms              NativeInvoiceTermsData     `json:"terms"`
	TermsNativeHash    string                     `json:"termsNativeHash"`
	TermsABCIHash      string                     `json:"termsAbciHash"`
	Invoice            map[string]any             `json:"invoice,omitempty"`
}
type NativeMerchantTermsReview struct {
	Intent   NativeInvoiceIntentView `json:"intent"`
	Message  []byte                  `json:"message"`
	Kind     string                  `json:"kind"`
	Owner    string                  `json:"owner"`
	Nonce    string                  `json:"nonce"`
	FeeAtoms string                  `json:"feeAtoms"`
	Status   string                  `json:"status"`
}
type nativeInvoiceIntentRecord struct {
	ID         string
	Request    NativeInvoiceProductIntent
	Merchant   string
	Terms      ynxauth.InvoiceTermsPayload
	Message    []byte
	Member     []byte
	NativeHash string
	ABCIHash   string
	Phase      string
}
type NativeInvoiceIntents struct {
	native *NativePayService
	source NativeInvoiceIntentSource
}

func NewNativeInvoiceIntents(native *NativePayService, source NativeInvoiceIntentSource) (*NativeInvoiceIntents, error) {
	if native == nil || source == nil {
		return nil, ErrNativePayUnavailable
	}
	return &NativeInvoiceIntents{native, source}, nil
}

// Normal private composition, without an HTTP/env-grant fallback. Original
// Main/Source supplies its real interfaces. Mount only before serving.
func NewPrivateNativePayServer(parent *Service, cfg NativePayConfig, source NativeInvoiceIntentSource, build buildinfo.Info, logger *slog.Logger) (*Server, *NativeInvoiceIntents, error) {
	native, err := NewNativePayService(parent, cfg)
	if err != nil {
		return nil, nil, err
	}
	intents, err := NewNativeInvoiceIntents(native, source)
	if err != nil {
		return nil, nil, err
	}
	server := NewClosedProductionServerWithLogger(parent, build, logger)
	intentHandler, nativeHandler := intents.Handler(), native.Handler()
	server.nativePay = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v5/pay/products/") || r.URL.Path == "/v5/pay/invoice-intents" || len(r.URL.Path) > len("/v5/pay/invoice-intents/") && r.URL.Path[:len("/v5/pay/invoice-intents/")] == "/v5/pay/invoice-intents/" {
			intentHandler.ServeHTTP(w, r)
			return
		}
		nativeHandler.ServeHTTP(w, r)
	})
	return server, intents, nil
}
func nativeIntentSlot(r NativeInvoiceProductIntent) string {
	return "npi_" + hashJSON([]string{r.Genesis, r.ProductID, r.Merchant, r.SourceOrder})[:48]
}
func (s *NativeInvoiceIntents) validate(r NativeInvoiceProductIntent) error {
	if !identifierRE.MatchString(r.ProductID) || !identifierRE.MatchString(r.SourceOrder) || r.Genesis != hex.EncodeToString(s.native.cfg.Genesis) || r.NativeChainID != strconv.FormatUint(s.native.cfg.NativeChainID, 10) || r.AssetID != "YNXT" || r.UnitVersion != "1" || len(r.DomainData) == 0 || len(r.DomainData) > 64<<10 {
		return errors.New("exact original product/network/Money intent required")
	}
	amount, e := strconv.ParseUint(r.AmountAtoms, 10, 64)
	if e != nil || amount == 0 || strconv.FormatUint(amount, 10) != r.AmountAtoms {
		return errors.New("canonical positive invoice atoms required")
	}
	var fields map[string]json.RawMessage
	if nativePayHTTPDecode(r.DomainData, &fields) != nil {
		return errors.New("exact bounded originating product data required")
	}
	_, e = ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, ynxauth.InvoiceTermsPayload{InvoiceID: "intent", SessionID: "intent", Recipient: r.Recipient, Payer: r.Merchant, AssetID: r.AssetID, UnitVersion: r.UnitVersion, FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: amount, MaxFee: 1, ExpiresAt: 1})
	return e
}
func (s *NativeInvoiceIntents) fence(ctx context.Context, g NativeInvoiceIntentBinding) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if g.Caller == "" || g.Current == nil || !s.native.parent.now().Before(g.Until) {
		return ErrNativePayUnavailable
	}
	return g.Current()
}
func (s *NativeInvoiceIntents) authorize(ctx context.Context, operation, id string, r NativeInvoiceProductIntent) (NativeInvoiceIntentBinding, error) {
	if err := s.validate(r); err != nil {
		return NativeInvoiceIntentBinding{}, err
	}
	requestCopy := r
	requestCopy.DomainData = bytes.Clone(r.DomainData)
	g, err := s.source.ResolveInvoiceIntent(ctx, NativeInvoiceIntentAccess{operation, id, requestCopy})
	if err != nil {
		return g, err
	}
	if err = s.fence(ctx, g); err != nil {
		return g, err
	}
	p := g.Terms
	if g.Merchant != r.Merchant || p.Recipient != r.Recipient || p.AssetID != r.AssetID || p.UnitVersion != r.UnitVersion || strconv.FormatUint(p.Amount, 10) != r.AmountAtoms {
		return g, errors.New("registered Source bill/merchant/price differs from requested product intent")
	}
	if _, err = ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, p); err != nil {
		return g, err
	}
	return g, nil
}
func (s *NativeInvoiceIntents) load(data Snapshot, id string) (nativeInvoiceIntentRecord, bool, error) {
	entry, ok := data.BusinessDispatches[id]
	if !ok {
		return nativeInvoiceIntentRecord{}, false, nil
	}
	var record nativeInvoiceIntentRecord
	text, err := s.native.parent.open(entry.ResultCipher)
	if err != nil || entry.Operation != "native.invoice.intent" || strictJSON([]byte(text), &record) != nil || record.ID != id || nativeIntentSlot(record.Request) != id || entry.RequestHash != hashJSON(record.Request) {
		return record, true, errors.New("original native invoice intent requires recovery")
	}
	return record, true, nil
}
func (s *NativeInvoiceIntents) save(data *Snapshot, r nativeInvoiceIntentRecord) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if len(raw) > 512<<10 {
		return errors.New("native invoice intent storage bound")
	}
	if data.BusinessDispatches == nil {
		data.BusinessDispatches = map[string]BusinessDispatchRecord{}
	}
	data.BusinessDispatches[r.ID] = BusinessDispatchRecord{MerchantID: r.Merchant, Operation: "native.invoice.intent", IdempotencyKey: r.Request.SourceOrder, RequestHash: hashJSON(r.Request), Phase: r.Phase, ResultCipher: s.native.parent.seal(string(raw)), UpdatedAt: s.native.parent.now().UTC()}
	return nil
}
func (s *NativeInvoiceIntents) readRecord(ctx context.Context, id, operation string) (nativeInvoiceIntentRecord, NativeInvoiceIntentBinding, error) {
	var r nativeInvoiceIntentRecord
	err := s.native.parent.store.View(func(data Snapshot) error {
		var found bool
		var err error
		r, found, err = s.load(data, id)
		if err != nil {
			return err
		}
		if !found {
			return errors.New("original invoice intent not found")
		}
		return nil
	})
	if err != nil {
		return r, NativeInvoiceIntentBinding{}, err
	}
	g, err := s.authorize(ctx, operation, id, r.Request)
	if err != nil {
		return r, g, err
	}
	if g.Merchant != r.Merchant || g.Terms != r.Terms {
		return r, g, errors.New("original invoice intent binding changed")
	}
	return r, g, s.fence(ctx, g)
}
func (s *NativeInvoiceIntents) CreateInvoiceIntent(ctx context.Context, request NativeInvoiceProductIntent, finalCurrent func() error) (NativeInvoiceIntentView, error) {
	if finalCurrent == nil {
		return NativeInvoiceIntentView{}, ErrNativePayUnavailable
	}
	if err := finalCurrent(); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	// Clone before the authority await; a caller cannot mutate retained input.
	raw, err := json.Marshal(request)
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	var captured NativeInvoiceProductIntent
	if err = nativePayHTTPDecode(raw, &captured); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	request = captured
	id := nativeIntentSlot(request)
	g, err := s.authorize(ctx, "create", id, request)
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	var prior nativeInvoiceIntentRecord
	var found bool
	err = s.native.parent.store.View(func(data Snapshot) error { var e error; prior, found, e = s.load(data, id); return e })
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if found {
		if hashJSON(prior.Request) != hashJSON(request) || prior.Terms != g.Terms {
			return NativeInvoiceIntentView{}, errors.New("immutable product invoice intent conflict")
		}
		return s.ReadInvoiceIntent(ctx, id)
	}
	prepared, err := s.native.PrepareTerms(ctx, request.SourceOrder, g.Terms)
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if prepared.Action.Owner != g.Merchant {
		return NativeInvoiceIntentView{}, errors.New("registered merchant issuer differs from original native Source")
	}
	record := nativeInvoiceIntentRecord{ID: id, Request: request, Merchant: g.Merchant, Terms: g.Terms, Message: bytes.Clone(prepared.Message), Phase: "awaiting_merchant_approval"}
	err = s.native.parent.store.Update(func(data *Snapshot) error {
		if err := s.fence(ctx, g); err != nil {
			return err
		}
		if err := finalCurrent(); err != nil {
			return err
		}
		old, ok, err := s.load(*data, id)
		if err != nil {
			return err
		}
		if ok {
			if hashJSON(old.Request) != hashJSON(request) || old.Terms != g.Terms || !bytes.Equal(old.Message, record.Message) {
				return errors.New("original intent already frozen")
			}
			record = old
			return nil
		}
		// One merchant/invoice/session cannot alias another pending product request.
		for key, entry := range data.BusinessDispatches {
			if entry.Operation != "native.invoice.intent" || key == id {
				continue
			}
			other, _, err := s.load(*data, key)
			if err != nil {
				return err
			}
			if other.Merchant == record.Merchant && (other.Terms.InvoiceID == record.Terms.InvoiceID || other.Terms.SessionID == record.Terms.SessionID || other.Request.SourceOrder == record.Request.SourceOrder) {
				return errors.New("original merchant invoice/session/order already reserved")
			}
		}
		return s.save(data, record)
	})
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if err = finalCurrent(); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	return s.ReadInvoiceIntent(ctx, id)
}
func (s *NativeInvoiceIntents) LookupInvoiceIntent(ctx context.Context, request NativeInvoiceProductIntent) (NativeInvoiceIntentView, error) {
	id := nativeIntentSlot(request)
	record, _, err := s.readRecord(ctx, id, "lookup")
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if hashJSON(record.Request) != hashJSON(request) {
		return NativeInvoiceIntentView{}, errors.New("original product invoice request differs")
	}
	if len(record.Member) > 0 {
		view, proofErr := s.ReconcileInvoiceIntent(ctx, id)
		if proofErr == nil {
			return view, nil
		}
		// A lookup remains a truthful PREPARED observation while proof is missing
		// or rejected. Reauthorize again; never disclose after a late revocation.
		return s.ReadInvoiceIntent(ctx, id)
	}
	return s.ReadInvoiceIntent(ctx, id)
}
func (s *NativeInvoiceIntents) ReadInvoiceIntent(ctx context.Context, id string) (NativeInvoiceIntentView, error) {
	record, g, err := s.readRecord(ctx, id, "read")
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	view := nativeIntentView(record)
	// No signature and no network write is ever produced by a lookup, including
	// a cold crash between retaining the Member and the original RegisterTerms.
	if record.NativeHash != "" {
		state, err := s.native.Read(ctx, record.Merchant, record.Terms.InvoiceID)
		if err != nil {
			return NativeInvoiceIntentView{}, err
		}
		op, ok := state.Operations[record.NativeHash]
		if !ok || !bytes.Equal(op.Member, record.Member) {
			return NativeInvoiceIntentView{}, errors.New("original native operation unavailable")
		}
		view.Phase = op.Status
		if op.Status == "confirmed" {
			view.State = "ISSUED"
		}
		view.Invoice, err = nativeInvoiceProjection(state)
		if err != nil {
			return NativeInvoiceIntentView{}, err
		}
	}
	if err = s.fence(ctx, g); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	return view, nil
}
func (s *NativeInvoiceIntents) MerchantTermsReview(ctx context.Context, id string) (NativeMerchantTermsReview, error) {
	r, g, err := s.readRecord(ctx, id, "merchant_review")
	if err != nil {
		return NativeMerchantTermsReview{}, err
	}
	if g.Caller != r.Merchant || len(r.Member) != 0 {
		return NativeMerchantTermsReview{}, errors.New("original merchant review required; captured Member is recovery-only")
	}
	prepared, err := s.native.PrepareTerms(ctx, r.Request.SourceOrder, r.Terms)
	if err != nil {
		return NativeMerchantTermsReview{}, err
	}
	if !bytes.Equal(prepared.Message, r.Message) {
		return NativeMerchantTermsReview{}, errors.New("original merchant nonce/epoch changed; retained intent cannot be silently replanned")
	}
	if err = s.fence(ctx, g); err != nil {
		return NativeMerchantTermsReview{}, err
	}
	return NativeMerchantTermsReview{nativeIntentView(r), bytes.Clone(r.Message), prepared.Kind, prepared.Action.Owner, strconv.FormatUint(prepared.Action.Nonce, 10), strconv.FormatUint(prepared.Action.Fee, 10), prepared.Status}, nil
}

// SubmitMerchantTerms accepts only the original Wallet's complete signed N1
// Member. Current Native Source must separately authorize RegisterTerms/send;
// signing, a client callback or a pasted Member alone is not broadcast consent.
func (s *NativeInvoiceIntents) SubmitMerchantTerms(ctx context.Context, id string, wire []byte) (NativeInvoiceIntentView, error) {
	wire = bytes.Clone(wire)
	r, g, err := s.readRecord(ctx, id, "submit_merchant_member")
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if g.Caller != r.Merchant {
		return NativeInvoiceIntentView{}, errors.New("actual registered merchant required")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil || !bytes.Equal(member.Message, r.Message) {
		return NativeInvoiceIntentView{}, errors.New("merchant Member differs from frozen original terms")
	}
	if len(r.Member) > 0 && !bytes.Equal(r.Member, wire) {
		return NativeInvoiceIntentView{}, errors.New("original merchant Member already captured; no replacement signature")
	}
	if len(r.Member) == 0 {
		action, _, grant, _, err := s.native.member(ctx, NativePayAccess{Operation: "register_terms", SourceOrder: r.Request.SourceOrder}, wire)
		if err != nil {
			return NativeInvoiceIntentView{}, err
		}
		if action.Owner != r.Merchant || action.Kind != ynxauth.ActionInvoiceTerms {
			return NativeInvoiceIntentView{}, errors.New("original invoice terms merchant required")
		}
		err = s.native.parent.store.Update(func(data *Snapshot) error {
			if err := s.fence(ctx, g); err != nil {
				return err
			}
			if err := s.native.fence(ctx, grant); err != nil {
				return err
			}
			current, ok, err := s.load(*data, id)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("original intent missing")
			}
			if len(current.Member) > 0 && !bytes.Equal(current.Member, wire) {
				return errors.New("merchant signature already reserved")
			}
			current.Member = wire
			current.Phase = "signed_not_submitted"
			return s.save(data, current)
		})
		if err != nil {
			return NativeInvoiceIntentView{}, err
		}
	}
	op, sendErr := s.native.RegisterTerms(ctx, r.Request.SourceOrder, wire)
	if op.NativeHash != "" {
		err = s.native.parent.store.Update(func(data *Snapshot) error {
			current, ok, err := s.load(*data, id)
			if err != nil {
				return err
			}
			if !ok || !bytes.Equal(current.Member, wire) {
				return errors.New("original signed intent changed")
			}
			current.NativeHash, current.ABCIHash, current.Phase = op.NativeHash, op.ABCIHash, op.Status
			return s.save(data, current)
		})
		if err != nil {
			return NativeInvoiceIntentView{}, err
		}
	}
	view, readErr := s.ReadInvoiceIntent(ctx, id)
	if readErr != nil {
		return NativeInvoiceIntentView{}, readErr
	}
	return view, sendErr
}
func (s *NativeInvoiceIntents) ReconcileInvoiceIntent(ctx context.Context, id string) (NativeInvoiceIntentView, error) {
	r, grant, err := s.readRecord(ctx, id, "reconcile")
	if err != nil {
		return NativeInvoiceIntentView{}, err
	}
	if r.NativeHash == "" {
		// Recover the original hash if archival crashed AFTER RegisterTerms saved
		// its original operation but BEFORE this intent recorded that same hash.
		if len(r.Member) > 0 {
			err = s.native.parent.store.Update(func(data *Snapshot) error {
				if e := s.fence(ctx, grant); e != nil {
					return e
				}
				state, found, e := s.native.load(*data, r.Merchant, r.Terms.InvoiceID)
				if e != nil {
					return e
				}
				if !found {
					return nil
				}
				hash := consensus.SignedTransactionHash(r.Member)
				op, ok := state.Operations[hash]
				if !ok || !bytes.Equal(op.Member, r.Member) {
					return errors.New("original signed invoice operation differs")
				}
				current, ok, e := s.load(*data, id)
				if e != nil {
					return e
				}
				if !ok {
					return errors.New("original intent missing")
				}
				current.NativeHash, current.ABCIHash, current.Phase = op.NativeHash, op.ABCIHash, op.Status
				r = current
				return s.save(data, current)
			})
			if err != nil {
				return NativeInvoiceIntentView{}, err
			}
		}
		if r.NativeHash == "" {
			return s.ReadInvoiceIntent(ctx, id)
		}
	}
	_, proofErr := s.native.Reconcile(ctx, r.Merchant, r.Terms.InvoiceID, r.NativeHash)
	view, readErr := s.ReadInvoiceIntent(ctx, id)
	if readErr != nil {
		return view, readErr
	}
	return view, proofErr
}
func nativeIntentView(r nativeInvoiceIntentRecord) NativeInvoiceIntentView {
	p := r.Terms
	return NativeInvoiceIntentView{SigningMessageHash: nativeIntentMessageHash(r.Message), IntentID: r.ID, OriginalOperation: r.ID, Request: r.Request, State: "PREPARED", Phase: r.Phase, Merchant: r.Merchant, Terms: NativeInvoiceTermsData{p.InvoiceID, p.SessionID, p.Recipient, p.Payer, p.AssetID, p.UnitVersion, p.FeeRule, strconv.FormatUint(p.KeyEpoch, 10), strconv.FormatUint(p.Revision, 10), strconv.FormatUint(p.Amount, 10), strconv.FormatUint(p.MaxFee, 10), strconv.FormatUint(p.ExpiresAt, 10)}, TermsNativeHash: r.NativeHash, TermsABCIHash: r.ABCIHash}
}

func nativeIntentMessageHash(message []byte) string {
	sum := sha256.Sum256(message)
	return hex.EncodeToString(sum[:])
}
