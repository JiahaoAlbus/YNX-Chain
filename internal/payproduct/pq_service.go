//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var ErrNativePayUnavailable = errors.New("native Pay current authority or trusted finality context unavailable")

// This is an in-process dependency port to the original Auth/Source owner.
// Requests, headers, Members and RPC responses cannot construct this authority.
type NativePayAccess struct {
	Terms                                       *ynxauth.InvoiceTermsPayload
	Operation, Merchant, InvoiceID, SourceOrder string
	Action                                      *ynxauth.Action
}
type NativePayAuthorization struct {
	// Original Source may explicitly authorize a product reader for this exact
	// existing order/invoice/session; this is never accepted from HTTP.
	BoundInvoiceRead              bool
	BoundInvoiceID                string
	BoundOrderID, BoundSessionID  string
	ProductMerchantID             string
	Principal                     string
	Registration                  ynxbatch.Registration
	Height, KeyEpoch, LedgerNonce uint64
	Until                         time.Time
	Current                       func() error
}
type NativePayAuthority interface {
	Authorize(context.Context, NativePayAccess) (NativePayAuthorization, error)
}
type NativePayOriginal struct {
	Merchant   string `json:"merchant"`
	InvoiceID  string `json:"invoiceId"`
	NativeHash string `json:"nativeHash"`
	ABCIHash   string `json:"abciHash"`
	Member     []byte `json:"member"`
	Envelope   []byte `json:"envelope"`
}

type NativePayProofSource interface {
	// Both headers, index, exact tx and light trust come from independent Source,
	// never from an untrusted collector selecting its own anchor.
	Trust(context.Context, NativePayOriginal) (consensus.PQLightProofTrust, consensus.PQTransactionProofExpectation, error)
}
type NativePayConfig struct {
	Genesis       []byte
	NativeChainID uint64
	HTTP          *NativePayHTTP
	Authority     NativePayAuthority
	ProofSource   NativePayProofSource
}
type NativePayService struct {
	parent *Service
	cfg    NativePayConfig
}
type NativePayOperation struct {
	NativePayOriginal
	Kind        string                     `json:"kind"`
	Owner       string                     `json:"owner"`
	Status      string                     `json:"status"`
	Failure     string                     `json:"failure,omitempty"`
	Observation *bftgateway.PQActionView   `json:"observation,omitempty"`
	Effect      *consensus.PQInvoiceEffect `json:"effect,omitempty"`
}

type NativePayInvoice struct {
	ProductMerchantID                                      string
	Merchant, InvoiceID, SessionID, SourceOrder, TermsHash string
	Terms                                                  ynxauth.InvoiceTermsPayload
	TermsOperation                                         string
	SettlementOperation                                    string
	RefundOperations                                       map[string]string
	Operations                                             map[string]NativePayOperation
	// Append-only verified public originals. Absent on old journals; never
	// reconstructed from current account state or another payer's private journal.
	OriginalArchives map[string]string `json:",omitempty"`
}
type NativePaySigningRequest struct {
	Kind    string
	Action  ynxauth.Action
	Message []byte
	Status  string
}

func NewNativePayService(parent *Service, cfg NativePayConfig) (*NativePayService, error) {
	if parent == nil || len(cfg.Genesis) != 32 || cfg.NativeChainID == 0 || cfg.NativeChainID > math.MaxInt64 || cfg.HTTP == nil || cfg.Authority == nil {
		return nil, ErrNativePayUnavailable
	}
	cfg.Genesis = bytes.Clone(cfg.Genesis)
	return &NativePayService{parent: parent, cfg: cfg}, nil
}
func nativeInvoiceSlot(genesis []byte, merchant, id string) string {
	return hashJSON([]string{"YNX_PAY_NATIVE_INVOICE_V1", hex.EncodeToString(genesis), merchant, id})
}
func (n *NativePayService) load(data Snapshot, merchant, id string) (NativePayInvoice, bool, error) {
	record, ok := data.BusinessDispatches[nativeInvoiceSlot(n.cfg.Genesis, merchant, id)]
	if !ok {
		return NativePayInvoice{}, false, nil
	}
	var state NativePayInvoice
	raw, err := n.parent.open(record.ResultCipher)
	if err != nil || strictJSON([]byte(raw), &state) != nil || state.Merchant != merchant || state.InvoiceID != id || record.Operation != "native.invoice" || state.Operations == nil {
		return state, true, errors.New("original native invoice journal requires recovery")
	}
	return state, true, nil
}
func (n *NativePayService) save(data *Snapshot, state NativePayInvoice) error {
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if len(raw) > 16<<20 {
		return errors.New("native invoice journal exceeds bounded service storage")
	}
	if data.BusinessDispatches == nil {
		data.BusinessDispatches = map[string]BusinessDispatchRecord{}
	}
	data.BusinessDispatches[nativeInvoiceSlot(n.cfg.Genesis, state.Merchant, state.InvoiceID)] = BusinessDispatchRecord{MerchantID: state.Merchant, Operation: "native.invoice", RequestHash: state.TermsHash, Phase: "retained", ResultCipher: n.parent.seal(string(raw)), UpdatedAt: n.parent.now().UTC()}
	return nil
}
func (n *NativePayService) grant(ctx context.Context, access NativePayAccess) (NativePayAuthorization, error) {
	grant, err := n.cfg.Authority.Authorize(ctx, access)
	if err != nil {
		return grant, err
	}
	if grant.Current == nil || grant.Principal == "" || grant.Height == 0 || !n.parent.now().Before(grant.Until) {
		return grant, ErrNativePayUnavailable
	}
	if err = ctx.Err(); err != nil {
		return grant, err
	}
	return grant, grant.Current()
}
func (n *NativePayService) fence(ctx context.Context, g NativePayAuthorization) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if g.Current == nil || !n.parent.now().Before(g.Until) {
		return ErrNativePayUnavailable
	}
	return g.Current()
}
func (n *NativePayService) member(ctx context.Context, access NativePayAccess, wire []byte) (ynxauth.Action, any, NativePayAuthorization, []byte, error) {
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return ynxauth.Action{}, nil, NativePayAuthorization{}, nil, err
	}
	action, err := ynxauth.DecodeAction(m.Message)
	if err != nil {
		return action, nil, NativePayAuthorization{}, nil, err
	}
	if !ynxauth.IsInvoiceAction(action.Kind) || !bytes.Equal(action.ChainID, n.cfg.Genesis) || action.NativeChainID != n.cfg.NativeChainID || action.Fee != ynxauth.InvoiceActionFee || m.Certificate.N != 1 || m.Index != 0 || m.Certificate.Purpose != "TX-BATCH" || m.Certificate.Owner != action.Owner {
		return action, nil, NativePayAuthorization{}, nil, errors.New("native invoice Member differs from fixed network/kind/fee/N1")
	}
	access.Action = &action
	grant, err := n.grant(ctx, access)
	if err != nil {
		return action, nil, grant, nil, err
	}
	if grant.Principal != action.Owner || grant.LedgerNonce == math.MaxUint64 || action.Nonce != grant.LedgerNonce+1 {
		return action, nil, grant, nil, errors.New("native invoice owner or next ledger nonce differs from current authority")
	}
	registration := grant.Registration
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: n.cfg.Genesis, Purpose: "TX-BATCH", ResolveTrustedOwner: func(ynxbatch.TrustRequest) (ynxbatch.Registration, error) { return registration, nil }})
	if err != nil {
		return action, nil, grant, nil, err
	}
	certificate, err := ynxbatch.EncodeCertificate(m.Certificate)
	if err != nil {
		return action, nil, grant, nil, err
	}
	handle, err := verifier.AuthenticateCertificate(certificate, grant.Height)
	if err != nil {
		return action, nil, grant, nil, err
	}
	if err = verifier.VerifyMember(handle, m.Message, m.Proof, grant.Height); err != nil {
		return action, nil, grant, nil, err
	}
	payload, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return action, nil, grant, nil, err
	}
	envelope, err := consensus.EncodePQNativeActionTransaction(wire)
	return action, payload, grant, envelope, err
}
func (n *NativePayService) Read(ctx context.Context, merchant, id string) (NativePayInvoice, error) {
	state, _, err := n.readInvoiceWithGrant(ctx, merchant, id)
	return state, err
}
func (n *NativePayService) readInvoiceWithGrant(ctx context.Context, merchant, id string) (NativePayInvoice, NativePayAuthorization, error) {
	grant, err := n.grant(ctx, NativePayAccess{Operation: "read", Merchant: merchant, InvoiceID: id})
	if err != nil {
		return NativePayInvoice{}, grant, err
	}
	var state NativePayInvoice
	err = n.parent.store.View(func(data Snapshot) error {
		if err := n.fence(ctx, grant); err != nil {
			return err
		}
		var found bool
		var err error
		state, found, err = n.load(data, merchant, id)
		if err != nil {
			return err
		}
		if !found {
			return errors.New("native invoice not found")
		}
		allowed := grant.BoundInvoiceRead && grant.BoundInvoiceID == state.InvoiceID && grant.BoundOrderID == state.SourceOrder && grant.BoundSessionID == state.SessionID || grant.Principal == state.Merchant || grant.Principal == state.Terms.Payer || state.Terms.Payer == "" && grant.BoundOrderID == state.SourceOrder && grant.BoundSessionID == state.SessionID
		if op, ok := state.Operations[state.SettlementOperation]; ok {
			allowed = allowed || grant.Principal == op.Owner
		}
		if !allowed {
			return errors.New("native invoice unavailable for principal")
		}
		return nil
	})
	return state, grant, err
}
func (n *NativePayService) RegisterTerms(ctx context.Context, sourceOrder string, wire []byte) (NativePayOperation, error) {
	if !identifierRE.MatchString(sourceOrder) {
		return NativePayOperation{}, errors.New("exact source order binding required")
	}
	_, decoded, err := nativePayHTTPMember(wire)
	if err != nil {
		return NativePayOperation{}, err
	}
	decodedPayload, err := ynxauth.DecodeActionPayload(decoded.Kind, decoded.Payload)
	if err != nil {
		return NativePayOperation{}, err
	}
	decodedTerms, ok := decodedPayload.(ynxauth.InvoiceTermsPayload)
	if !ok {
		return NativePayOperation{}, errors.New("merchant terms Member required")
	}
	if old, found, err := n.replayOperation(ctx, decoded.Owner, decodedTerms.InvoiceID, wire); found || err != nil {
		if err == nil {
			state, e := n.Read(ctx, decoded.Owner, decodedTerms.InvoiceID)
			if e != nil {
				return old, e
			}
			if state.SourceOrder != sourceOrder {
				return old, errors.New("original order binding changed")
			}
		}
		return old, err
	}
	action, payload, grant, envelope, err := n.member(ctx, NativePayAccess{Operation: "register_terms", SourceOrder: sourceOrder}, wire)
	if err != nil {
		return NativePayOperation{}, err
	}
	terms, ok := payload.(ynxauth.InvoiceTermsPayload)
	if !ok || grant.BoundOrderID != sourceOrder || grant.BoundSessionID != terms.SessionID || grant.BoundInvoiceID != terms.InvoiceID || terms.KeyEpoch != grant.KeyEpoch || terms.ExpiresAt < grant.Height || terms.Amount > math.MaxInt64-ynxauth.InvoiceActionFee {
		return NativePayOperation{}, errors.New("merchant terms epoch/height/principal mismatch")
	}
	hash := sha256.Sum256(mustActionBytes(action))
	termsHash := hex.EncodeToString(hash[:])
	op := nativeOperation(action.Owner, terms.InvoiceID, action, wire, envelope)
	fresh := false
	err = n.parent.store.Update(func(data *Snapshot) error {
		if err := n.fence(ctx, grant); err != nil {
			return err
		}
		state, found, err := n.load(*data, action.Owner, terms.InvoiceID)
		if err != nil {
			return err
		}
		if found {
			if state.SourceOrder != sourceOrder || state.Terms != terms {
				return errors.New("native invoice immutable terms/order already bound")
			}
			old := state.Operations[state.TermsOperation]
			if old.NativeHash == op.NativeHash {
				op = old
				return nil
			}
			if old.Status != "confirmed_failed" {
				return errors.New("original terms outcome unresolved or already registered")
			}
			// Independent proof established no effect; this is a NEW fully
			// authorized Member. Preserve the failed attempt in the journal.
			state.TermsHash = termsHash
			state.TermsOperation = op.NativeHash
			state.Operations[op.NativeHash] = op
			fresh = true
			return n.save(data, state)
		}
		for _, record := range data.BusinessDispatches {
			if record.Operation != "native.invoice" || record.MerchantID != action.Owner {
				continue
			}
			var other NativePayInvoice
			text, err := n.parent.open(record.ResultCipher)
			if err != nil || strictJSON([]byte(text), &other) != nil {
				return errors.New("original native invoice journal requires recovery")
			}
			if other.SourceOrder == sourceOrder || other.SessionID == terms.SessionID {
				return errors.New("source order or native session already bound to another invoice")
			}
		}
		if grant.ProductMerchantID != "" {
			m, exists := data.Merchants[grant.ProductMerchantID]
			recipient, e := accountaddress.Normalize(m.PayoutAddress)
			if !exists || m.Status != "active" || e != nil || recipient != terms.Recipient {
				return errors.New("original product merchant/recipient association unavailable")
			}
		}
		state = NativePayInvoice{ProductMerchantID: grant.ProductMerchantID, Merchant: action.Owner, InvoiceID: terms.InvoiceID, SessionID: terms.SessionID, SourceOrder: sourceOrder, TermsHash: termsHash, Terms: terms, TermsOperation: op.NativeHash, RefundOperations: map[string]string{}, Operations: map[string]NativePayOperation{op.NativeHash: op}}
		fresh = true
		return n.save(data, state)
	})
	if err != nil || !fresh {
		return op, err
	}
	return n.dispatch(ctx, grant, op)
}
func mustActionBytes(action ynxauth.Action) []byte { raw, _ := action.SigningBytes(); return raw }
func nativeOperation(merchant, id string, action ynxauth.Action, wire, envelope []byte) NativePayOperation {
	return NativePayOperation{NativePayOriginal: NativePayOriginal{Merchant: merchant, InvoiceID: id, NativeHash: consensus.SignedTransactionHash(wire), ABCIHash: consensus.SignedTransactionHash(envelope), Member: bytes.Clone(wire), Envelope: bytes.Clone(envelope)}, Kind: action.Kind, Owner: action.Owner, Status: "unknown"}
}
func (n *NativePayService) dispatch(ctx context.Context, g NativePayAuthorization, op NativePayOperation) (NativePayOperation, error) {
	if err := n.fence(ctx, g); err != nil {
		return op, err
	}
	if err := n.cfg.HTTP.registerOriginalReadRoutes(ctx, g, op); err != nil {
		return op, err
	}
	observation, err := n.cfg.HTTP.Submit(ctx, op.Member)
	// Persist observations only. Even committed/RPC200 cannot turn this into paid.
	if err != nil {
		op.Failure = "SUBMISSION_OUTCOME_UNKNOWN"
	} else {
		op.Status = "submitted"
		op.Observation = &observation
	}
	saveErr := n.parent.store.Update(func(data *Snapshot) error {
		state, found, e := n.load(*data, op.Merchant, op.InvoiceID)
		if e != nil {
			return e
		}
		if !found {
			return errors.New("original native dispatch journal missing")
		}
		current, exists := state.Operations[op.NativeHash]
		if !exists || !bytes.Equal(current.Member, op.Member) {
			return errors.New("original native dispatch changed")
		}
		if current.Status == "confirmed" || current.Status == "confirmed_failed" {
			op = current
			return nil
		}
		state.Operations[op.NativeHash] = op
		return n.save(data, state)
	})
	if saveErr != nil {
		return op, saveErr
	}
	return op, err
}

func (n *NativePayService) SubmitSettlement(ctx context.Context, merchant, id string, wire []byte) (NativePayOperation, error) {
	return n.submitMovement(ctx, merchant, id, wire, false)
}
func (n *NativePayService) SubmitRefund(ctx context.Context, merchant, id string, wire []byte) (NativePayOperation, error) {
	return n.submitMovement(ctx, merchant, id, wire, true)
}
func (n *NativePayService) submitMovement(ctx context.Context, merchant, id string, wire []byte, refund bool) (NativePayOperation, error) {
	purpose := "settle"
	if refund {
		purpose = "refund"
	}
	if old, found, err := n.replayOperation(ctx, merchant, id, wire); found || err != nil {
		if err == nil && (refund && old.Kind != ynxauth.ActionInvoiceRefund || !refund && old.Kind != ynxauth.ActionInvoiceSettle) {
			return old, errors.New("original operation kind differs from route")
		}
		return old, err
	}
	action, payload, grant, envelope, err := n.member(ctx, NativePayAccess{Operation: purpose, Merchant: merchant, InvoiceID: id}, wire)
	if err != nil {
		return NativePayOperation{}, err
	}
	op := nativeOperation(merchant, id, action, wire, envelope)
	fresh := false
	err = n.parent.store.Update(func(data *Snapshot) error {
		if err := n.fence(ctx, grant); err != nil {
			return err
		}
		state, found, err := n.load(*data, merchant, id)
		if err != nil {
			return err
		}
		if !found {
			return errors.New("merchant terms not registered")
		}
		if old, exists := state.Operations[op.NativeHash]; exists {
			op = old
			return nil
		}
		if state.Operations[state.TermsOperation].Status != "confirmed" {
			return errors.New("merchant terms lack independently verified finality")
		}
		termsHash, _ := hex.DecodeString(state.TermsHash)
		if !refund {
			p, ok := payload.(ynxauth.InvoiceSettlePayload)
			if !ok || p.Merchant != merchant || p.InvoiceID != id || !bytes.Equal(p.TermsHash, termsHash) || p.Amount != state.Terms.Amount || grant.Height > state.Terms.ExpiresAt || state.Terms.Payer != "" && state.Terms.Payer != action.Owner || action.Owner == state.Merchant || action.Owner == state.Terms.Recipient {
				return errors.New("payment differs from fixed merchant terms/current payer/height")
			}
			if state.SettlementOperation != "" && state.Operations[state.SettlementOperation].Status != "confirmed_failed" {
				return errors.New("original invoice payment already reserved; reconcile only")
			}
			state.SettlementOperation = op.NativeHash
		} else {
			p, ok := payload.(ynxauth.InvoiceRefundPayload)
			settled, exists := state.Operations[state.SettlementOperation]
			if !ok || !exists || settled.Status != "confirmed" || settled.Effect == nil || action.Owner != state.Merchant || p.InvoiceID != id || !bytes.Equal(p.TermsHash, termsHash) || "0x"+hex.EncodeToString(p.SettlementHash) != settled.NativeHash {
				return errors.New("refund lacks original merchant/settlement binding")
			}
			var reserved uint64
			for _, hash := range state.RefundOperations {
				existing := state.Operations[hash]
				if existing.Status == "confirmed_failed" {
					continue
				}
				m, e := ynxbatch.DecodeMember(existing.Member)
				if e != nil {
					return e
				}
				a, e := ynxauth.DecodeAction(m.Message)
				if e != nil {
					return e
				}
				v, e := ynxauth.DecodeActionPayload(a.Kind, a.Payload)
				if e != nil {
					return e
				}
				r := v.(ynxauth.InvoiceRefundPayload)
				if r.Amount > state.Terms.Amount-reserved {
					return errors.New("refund journal exceeds original principal")
				}
				reserved += r.Amount
				if existing.Status != "confirmed" {
					return errors.New("original refund outcome unresolved; reconcile only")
				}
			}
			previousHash, exists := state.RefundOperations[p.RefundID]
			if exists && state.Operations[previousHash].Status != "confirmed_failed" || p.Amount > state.Terms.Amount-reserved {
				return errors.New("refund ID consumed or exceeds unrefunded principal")
			}
			if state.RefundOperations == nil {
				state.RefundOperations = map[string]string{}
			}
			state.RefundOperations[p.RefundID] = op.NativeHash
		}
		state.Operations[op.NativeHash] = op
		fresh = true
		return n.save(data, state)
	})
	if err != nil || !fresh {
		return op, err
	}
	return n.dispatch(ctx, grant, op)
}

// PrepareSettlement returns ONLY Core's exact signing message to the original
// Native signer. No secret or synthetic signature exists in this service.
func (n *NativePayService) PrepareSettlement(ctx context.Context, merchant, id string) (NativePaySigningRequest, error) {
	state, err := n.Read(ctx, merchant, id)
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	g, err := n.grant(ctx, NativePayAccess{Operation: "review_settlement", Merchant: merchant, InvoiceID: id})
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	if state.Operations[state.TermsOperation].Status != "confirmed" || state.SettlementOperation != "" && state.Operations[state.SettlementOperation].Status != "confirmed_failed" || g.LedgerNonce == math.MaxUint64 || g.Height > state.Terms.ExpiresAt || g.Principal == state.Merchant || g.Principal == state.Terms.Recipient || state.Terms.Payer != "" && state.Terms.Payer != g.Principal {
		return NativePaySigningRequest{}, errors.New("invoice not open under current payer/terms/height")
	}
	termsHash, _ := hex.DecodeString(state.TermsHash)
	body, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: merchant, InvoiceID: id, TermsHash: termsHash, Amount: state.Terms.Amount})
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	action := ynxauth.Action{ChainID: bytes.Clone(n.cfg.Genesis), NativeChainID: n.cfg.NativeChainID, Owner: g.Principal, Nonce: g.LedgerNonce + 1, Fee: ynxauth.InvoiceActionFee, Kind: ynxauth.ActionInvoiceSettle, Payload: body}
	message, err := action.SigningBytes()
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	if err = n.fence(ctx, g); err != nil {
		return NativePaySigningRequest{}, err
	}
	return NativePaySigningRequest{Kind: action.Kind, Action: action, Message: message, Status: "awaiting_original_native_signature"}, nil
}

// A known original is read under fresh resource authority, not re-authorized as
// a new spend at a later nonce/epoch. This is also the response-loss path.
func (n *NativePayService) replayOperation(ctx context.Context, merchant, id string, wire []byte) (NativePayOperation, bool, error) {
	hash := consensus.SignedTransactionHash(wire)
	exists := false
	err := n.parent.store.View(func(data Snapshot) error {
		state, found, err := n.load(data, merchant, id)
		if err != nil {
			return err
		}
		if found {
			old, found := state.Operations[hash]
			exists = found && bytes.Equal(old.Member, wire)
		}
		return nil
	})
	if err != nil || !exists {
		return NativePayOperation{}, false, err
	}
	state, err := n.Read(ctx, merchant, id)
	if err != nil {
		return NativePayOperation{}, true, err
	}
	return state.Operations[hash], true, nil
}

// PrepareTerms is the unsigned producer for a real merchant-approved bill.
// The typed payload and its Money metadata remain CORE-owned. Current Source
// must bind bill/order, invoice, session, price terms and merchant identity;
// this method never interprets a raw Cloud JSON bill as signing authority.
func (n *NativePayService) PrepareTerms(ctx context.Context, sourceOrder string, terms ynxauth.InvoiceTermsPayload) (NativePaySigningRequest, error) {
	if !identifierRE.MatchString(sourceOrder) {
		return NativePaySigningRequest{}, errors.New("exact source order/bill identity required")
	}
	body, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, terms)
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	grant, err := n.grant(ctx, NativePayAccess{Operation: "prepare_terms", SourceOrder: sourceOrder, InvoiceID: terms.InvoiceID, Terms: &terms})
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	if grant.BoundOrderID != sourceOrder || grant.BoundInvoiceID != terms.InvoiceID || grant.BoundSessionID != terms.SessionID || grant.KeyEpoch != terms.KeyEpoch || grant.Height > terms.ExpiresAt || grant.LedgerNonce == math.MaxUint64 || terms.Amount > math.MaxInt64-ynxauth.InvoiceActionFee {
		return NativePaySigningRequest{}, errors.New("merchant-approved bill identity/price metadata/height/epoch unavailable")
	}
	action := ynxauth.Action{ChainID: bytes.Clone(n.cfg.Genesis), NativeChainID: n.cfg.NativeChainID, Owner: grant.Principal, Nonce: grant.LedgerNonce + 1, Fee: ynxauth.InvoiceActionFee, Kind: ynxauth.ActionInvoiceTerms, Payload: body}
	message, err := action.SigningBytes()
	if err != nil {
		return NativePaySigningRequest{}, err
	}
	if err = n.fence(ctx, grant); err != nil {
		return NativePaySigningRequest{}, err
	}
	return NativePaySigningRequest{Kind: action.Kind, Action: action, Message: message, Status: "awaiting_original_merchant_native_signature"}, nil
}
