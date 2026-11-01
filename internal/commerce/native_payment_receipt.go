package commerce

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"time"
)

// Existing P06 r6 public receipt projection. These fields are DATA, never a
// constructor for a Source/Pay proof. Only the original configured qualified
// Pay transport's fixed product receipt route may feed the private effect below.
type nativeShopArchiveReceipt struct {
	Version              string `json:"version"`
	ProductID            string `json:"productId"`
	StoreID              string `json:"storeId"`
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
	SettlementNativeHash string `json:"settlementNativeHash"`
	RefundID             string `json:"refundId,omitempty"`
	Payer                string `json:"payer,omitempty"`
	Recipient            string `json:"recipient,omitempty"`
	AssetID              string `json:"assetId"`
	UnitVersion          string `json:"unitVersion"`
	EventClaim           string `json:"eventClaim"`
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
type nativeShopArchiveReconciliation struct {
	Version                string                     `json:"version"`
	ProductID              string                     `json:"productId"`
	StoreID                string                     `json:"storeId"`
	SourceOrder            string                     `json:"sourceOrder"`
	Merchant               string                     `json:"merchant"`
	InvoiceID              string                     `json:"invoiceId"`
	Genesis                string                     `json:"genesis"`
	NativeChainID          string                     `json:"nativeChainId"`
	PrincipalAtoms         string                     `json:"principalAtoms"`
	PaidAtoms              string                     `json:"paidAtoms"`
	RefundedAtoms          string                     `json:"refundedAtoms"`
	NetPaidAtoms           string                     `json:"netPaidAtoms"`
	Receipts               []nativeShopArchiveReceipt `json:"receipts"`
	PendingOriginals       []string                   `json:"pendingOriginals"`
	CompleteKnownOriginals bool                       `json:"completeKnownOriginals"`
	ProofVerification      string                     `json:"proofVerification"`
	DataOnly               bool                       `json:"dataOnly"`
	QueryOnly              bool                       `json:"queryOnly"`
	CanRetry               bool                       `json:"canRetry"`
	SourceAdmission        bool                       `json:"SourceAdmission"`
	NativeGrant            bool                       `json:"nativeGrant"`
}

// Separate from legacy display-unit SettlementEvidence/RefundEvidence. Every
// amount remains an exact atom string. Existing BusinessEffects retains the
// original response bytes; this detached projection binds its accepted claims.
type NativeShopPaymentRecord struct {
	InvoiceID, SessionID, TermsHash, SettlementNativeHash  string
	PrincipalAtoms, PaidAtoms, RefundedAtoms, NetPaidAtoms string
	ReconciliationRequired                                 bool
	Receipts                                               []nativeShopArchiveReceipt
	PendingOriginals                                       []string
	CompleteKnownOriginals                                 bool
}
type nativeShopPaymentInput struct {
	Order                        Order
	Request                      NativeShopInvoiceRequestDATA
	SessionID, TermsHash, Origin string
}

func nativeReceiptHex(value string, prefix bool) bool {
	raw := value
	if prefix {
		if !strings.HasPrefix(value, "0x") {
			return false
		}
		raw = value[2:]
	}
	b, e := hex.DecodeString(raw)
	return e == nil && len(b) == 32 && hex.EncodeToString(b) == raw
}
func nativeReceiptAtoms(v string) (uint64, error) {
	n, e := strconv.ParseUint(v, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != v {
		return 0, ErrInvalidState
	}
	return n, nil
}
func nativeReceiptDecode(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > nativePayProductLimit {
		return ErrInvalidState
	}
	// Duplicate names, including nested objects, cannot replace frozen bindings.
	scan := json.NewDecoder(bytes.NewReader(raw))
	depth := 0
	var walk func() error
	walk = func() error {
		depth++
		defer func() { depth-- }()
		if depth > 64 {
			return ErrInvalidState
		}
		v, e := scan.Token()
		if e != nil {
			return e
		}
		if d, ok := v.(json.Delim); ok {
			if d == '{' {
				seen := map[string]bool{}
				for scan.More() {
					k, e := scan.Token()
					s, ok := k.(string)
					if e != nil || !ok || seen[s] {
						return ErrInvalidState
					}
					seen[s] = true
					if e = walk(); e != nil {
						return e
					}
				}
			} else if d == '[' {
				for scan.More() {
					if e = walk(); e != nil {
						return e
					}
				}
			} else {
				return ErrInvalidState
			}
			_, e = scan.Token()
			return e
		}
		return nil
	}
	if walk() != nil {
		return ErrInvalidState
	}
	if _, e := scan.Token(); e != io.EOF {
		return ErrInvalidState
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(new(any)) != io.EOF {
		return ErrInvalidState
	}
	return nil
}

func validateNativeShopReconciliation(saved nativeShopPaymentInput, r nativeShopArchiveReconciliation) (NativeShopPaymentRecord, error) {
	bad := func() (NativeShopPaymentRecord, error) { return NativeShopPaymentRecord{}, ErrInvalidState }
	original, o := saved.Request, saved.Order
	if r.Version != "ynx.pay.native.archive-reconciliation/v1" || r.ProductID != "shop.order" || r.ProductID != original.ProductID || r.StoreID != original.StoreID || r.SourceOrder != o.ID || r.SourceOrder != original.SourceOrder || r.Merchant != original.Merchant || r.Merchant != o.PayMerchant || r.InvoiceID != o.InvoiceID || r.Genesis != original.Genesis || r.NativeChainID != original.NativeChainID || r.PrincipalAtoms != original.AmountAtoms || r.ProofVerification != "original-independent-core-verifier" || !r.DataOnly || !r.QueryOnly || r.CanRetry || r.SourceAdmission || r.NativeGrant || len(r.Receipts) > 1024 || len(r.PendingOriginals) > 1024 || r.CompleteKnownOriginals != (len(r.PendingOriginals) == 0) {
		return bad()
	}
	principal, e := nativeReceiptAtoms(r.PrincipalAtoms)
	if e != nil || principal == 0 {
		return bad()
	}
	seen, claims, refundIDs := map[string]bool{}, map[string]bool{}, map[string]bool{}
	var paid, refunded uint64
	var previousCoordinate [4]uint64
	settlement := ""
	for _, v := range r.Receipts {
		if v.Version != "ynx.pay.native.archive-receipt/v1" || v.ProductID != r.ProductID || v.StoreID != r.StoreID || v.SourceOrder != r.SourceOrder || v.Merchant != r.Merchant || v.InvoiceID != r.InvoiceID || v.Genesis != r.Genesis || v.NativeChainID != r.NativeChainID || v.SessionID != saved.SessionID || v.TermsHash != saved.TermsHash || !nativeReceiptHex(v.NativeHash, true) || !nativeReceiptHex(v.ABCIHash, true) || !nativeReceiptHex(v.ArchiveDigest, false) || seen[v.NativeHash] || v.ProofVerification != r.ProofVerification || !v.DataOnly || !v.QueryOnly || v.CanRetry || v.SourceAdmission || v.NativeGrant {
			return bad()
		}
		seen[v.NativeHash] = true
		h, he := nativeReceiptAtoms(v.ExecutionHeight)
		index, ie := nativeReceiptAtoms(v.ExecutionIndex)
		member, me := nativeReceiptAtoms(v.ExecutionMember)
		event, ee := nativeReceiptAtoms(v.ExecutionEvent)
		n, ne := nativeReceiptAtoms(v.PrincipalAtoms)
		p, pe := nativeReceiptAtoms(v.PaidAtoms)
		f, fe := nativeReceiptAtoms(v.RefundedAtoms)
		net, nette := nativeReceiptAtoms(v.NetPaidAtoms)
		if he != nil || h == 0 || ie != nil || me != nil || ee != nil || event != 0 || ne != nil || pe != nil || fe != nil || nette != nil || v.AssetID != original.AssetID || v.UnitVersion != original.UnitVersion || (v.Kind != "invoice_settle" && v.Kind != "invoice_refund") {
			return bad()
		}
		coordinate := [4]uint64{h, index, member, event}
		ordered := false
		for i, value := range coordinate {
			if value > previousCoordinate[i] {
				ordered = true
				break
			}
			if value < previousCoordinate[i] {
				return bad()
			}
		}
		if !ordered {
			return bad()
		}
		previousCoordinate = coordinate
		if v.Status == "confirmed_failed" {
			if v.EventClaim != "" || v.RefundID != "" || v.Payer != "" || v.Recipient != "" || n != 0 || p != 0 || f != 0 || net != 0 {
				return bad()
			}
			continue
		}
		if v.Status != "confirmed" || !sameBusinessAccount(v.Payer, o.Buyer) || !nativeReceiptHex(v.EventClaim, false) || claims[v.EventClaim] {
			return bad()
		}
		claims[v.EventClaim] = true
		if v.Kind == "invoice_settle" {
			if settlement != "" || v.Recipient != original.Recipient || v.RefundID != "" || n != principal || p != principal || f != 0 || net != principal || v.SettlementNativeHash != v.NativeHash {
				return bad()
			}
			settlement = v.NativeHash
			paid = principal
		} else {
			if settlement == "" || !sameBusinessAccount(v.Recipient, o.Buyer) || !invoiceRecoveryID.MatchString(v.RefundID) || refundIDs[v.RefundID] || v.SettlementNativeHash != settlement || n == 0 || n > paid-refunded {
				return bad()
			}
			refunded += n
			refundIDs[v.RefundID] = true
			if p != paid || f != refunded || net != paid-refunded {
				return bad()
			}
		}
	}
	for _, hash := range r.PendingOriginals {
		if !nativeReceiptHex(hash, true) || seen[hash] {
			return bad()
		}
		seen[hash] = true
	}
	if r.PaidAtoms != strconv.FormatUint(paid, 10) || r.RefundedAtoms != strconv.FormatUint(refunded, 10) || r.NetPaidAtoms != strconv.FormatUint(paid-refunded, 10) {
		return bad()
	}
	return NativeShopPaymentRecord{InvoiceID: r.InvoiceID, SessionID: saved.SessionID, TermsHash: saved.TermsHash, SettlementNativeHash: settlement, PrincipalAtoms: r.PrincipalAtoms, PaidAtoms: r.PaidAtoms, RefundedAtoms: r.RefundedAtoms, NetPaidAtoms: r.NetPaidAtoms, Receipts: append([]nativeShopArchiveReceipt(nil), r.Receipts...), PendingOriginals: append([]string(nil), r.PendingOriginals...), CompleteKnownOriginals: r.CompleteKnownOriginals}, nil
}

// Capture the actual retained original preparation/result under the same Store
// lock; no current-price reconstruction or caller-selected session/terms hash.
func (s *Store) nativePaymentInput(actor, target, origin string) (nativeShopPaymentInput, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nativePaymentInputLocked(actor, target, origin)
}
func (s *Store) nativePaymentInputLocked(actor, target, origin string) (nativeShopPaymentInput, error) {
	var out nativeShopPaymentInput
	o, ok := s.s.Orders[target]
	if !ok {
		return out, ErrNotFound
	}
	if o.Buyer != actor {
		return out, ErrUnauthorized
	}
	if !strings.HasPrefix(o.PayIntentID, "npi_") || o.InvoiceID == "" || origin == "" {
		return out, ErrInvalidState
	}
	for _, record := range s.s.BusinessEffects {
		if record.Kind != "pay.native-create" || record.Target != target || record.Phase != "completed" {
			continue
		}
		var saved nativeInvoiceInput
		if decodeEffect(record.Input, &saved) != nil || saved.Origin != origin || !sameNativeInvoiceBill(o, saved.Order) {
			return out, ErrConflict
		}
		_, binding, err := nativeInvoiceReply(saved, record.Result, true)
		if err != nil {
			return out, err
		}
		if binding.InvoiceID != o.InvoiceID || binding.IntentID != o.PayIntentID || binding.Merchant != o.PayMerchant || binding.PayoutAddress != o.PayPayoutAddress {
			return out, ErrConflict
		}
		var reply struct {
			Terms              NativeShopPayTerms `json:"terms"`
			SigningMessageHash string             `json:"signingMessageHash"`
		}
		if json.Unmarshal(record.Result, &reply) != nil || reply.Terms.SessionID == "" || (reply.Terms.Payer != "" && !sameBusinessAccount(reply.Terms.Payer, o.Buyer)) || !nativeReceiptHex(reply.SigningMessageHash, false) {
			return out, ErrInvalidState
		}
		return nativeShopPaymentInput{Order: cloneOrder(o), Request: saved.Request, SessionID: reply.Terms.SessionID, TermsHash: reply.SigningMessageHash, Origin: origin}, nil
	}
	return out, ErrNotFound
}

func (s *Server) nativePaymentReceiptEffect(target string, body []byte, proof businessActionAuthorization) (businessEffectPlan, error) {
	var empty struct{}
	if decodeBusinessBody(body, &empty) != nil {
		return businessEffectPlan{}, ErrInvalidState
	}
	originalClient := s.cfg.NativePay
	if originalClient == nil || originalClient.client.Transport == nil {
		return businessEffectPlan{}, ErrUnavailable
	}
	client := *originalClient
	client.client = *guardedEffectHTTPClientWithResponseLimit(&client.client, 15*time.Second, nativePayProductLimit)
	plan := businessEffectPlan{kind: "pay.native-receipt", target: target, key: businessNonceDigest(proof.SessionBinding, proof.Nonce), status: 200}
	plan.prepare = func(tx *Store, actor string) (json.RawMessage, error) {
		v, e := tx.nativePaymentInput(actor, target, client.origin)
		if e != nil {
			return nil, e
		}
		return encodeEffect(v)
	}
	plan.check = func(tx *Store, actor string, r BusinessEffect) error {
		var old nativeShopPaymentInput
		if decodeEffect(r.Input, &old) != nil {
			return ErrInvalidState
		}
		now, e := tx.nativePaymentInput(actor, target, client.origin)
		if e != nil {
			return e
		}
		a, _ := json.Marshal(old.Request)
		b, _ := json.Marshal(now.Request)
		if !bytes.Equal(a, b) || old.SessionID != now.SessionID || old.TermsHash != now.TermsHash || old.Order.PayIntentID != now.Order.PayIntentID || old.Order.InvoiceID != now.Order.InvoiceID {
			return ErrConflict
		}
		return nil
	}
	plan.send = func(ctx context.Context, r BusinessEffect) (json.RawMessage, error) {
		var saved nativeShopPaymentInput
		if decodeEffect(r.Input, &saved) != nil {
			return nil, ErrInvalidState
		}
		// This client is borrowed only from the original protected runtime. P06's
		// normal route independently holds ProductSource + invoice Source + trust;
		// its verifier, not these DATA flags, supplies the upstream proof authority.
		path, pathErr := nativeShopProductReceiptPath(saved.Order.ID, saved.Request.Merchant, saved.Order.InvoiceID)
		if pathErr != nil {
			return nil, pathErr
		}
		out, e := client.exchange(ctx, "GET", path, nil, false)
		if e != nil {
			if out.Status == 409 {
				var denied struct {
					Code string `json:"code"`
				}
				json.Unmarshal(out.Response, &denied)
				if denied.Code == ErrNativeShopPayOriginalArchiveUnavailable.Error() {
					return nil, &businessHTTPError{ErrNativeShopPayOriginalArchiveUnavailable.Error(), 409}
				}
				return nil, ErrConflict
			}
			return nil, e
		}
		return bytes.Clone(out.Response), nil
	}
	plan.finish = func(tx *Store, actor string, r BusinessEffect) (any, error) {
		var saved nativeShopPaymentInput
		var received nativeShopArchiveReconciliation
		if decodeEffect(r.Input, &saved) != nil || nativeReceiptDecode(r.Result, &received) != nil {
			return nil, ErrInvalidState
		}
		payment, e := validateNativeShopReconciliation(saved, received)
		if e != nil {
			return nil, e
		}
		return tx.applyNativePaymentReceipt(actor, target, payment)
	}
	plan.view = func(tx *Store, actor string, r BusinessEffect) (any, error) { return tx.Order(actor, "buyer", target) }
	return plan, nil
}

// The P06 product-archive route uses its existing finite encodeURIComponent
// spelling. A colon remains part of the original identifier, encoded exactly
// once as uppercase%3A. Do not change legacy/Member route encodings globally.
func nativeShopProductReceiptPath(order, merchant, invoice string) (string, error) {
	if !nativeShopPaySegment(order) || !nativeShopPaySegment(merchant) || !nativeShopPaySegment(invoice) {
		return "", ErrInvalidState
	}
	return "/v5/pay/products/shop.order/" + strings.ReplaceAll(order, ":", "%3A") + "/invoices/" + merchant + "/" + strings.ReplaceAll(invoice, ":", "%3A") + "/archive-reconciliation", nil
}

// No exported Apply(DATA) method: only the original durable server-owned
// receipt effect calls this after the same-source qualified Pay read/current.
func (s *Store) applyNativePaymentReceipt(actor, target string, p NativeShopPaymentRecord) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.s.Orders[target]
	if !ok {
		return Order{}, ErrNotFound
	}
	if o.Buyer != actor {
		return Order{}, ErrUnauthorized
	}
	if p.InvoiceID != o.InvoiceID || !strings.HasPrefix(o.PayIntentID, "npi_") || o.Settlement != nil || o.Refund != nil {
		return Order{}, ErrConflict
	}
	previous := o.NativePayment
	if previous != nil {
		if previous.InvoiceID != p.InvoiceID || previous.SessionID != p.SessionID || previous.TermsHash != p.TermsHash || previous.PrincipalAtoms != p.PrincipalAtoms {
			return Order{}, ErrConflict
		}
		next := map[string]nativeShopArchiveReceipt{}
		for _, r := range p.Receipts {
			next[r.NativeHash] = r
		}
		for _, r := range previous.Receipts {
			if v, ok := next[r.NativeHash]; !ok || v != r {
				return Order{}, ErrConflict
			}
		}
		for _, hash := range previous.PendingOriginals {
			known := false
			if _, ok := next[hash]; ok {
				known = true
			}
			for _, pending := range p.PendingOriginals {
				if pending == hash {
					known = true
				}
			}
			if !known {
				return Order{}, ErrConflict
			}
		}
		if previous.SettlementNativeHash != "" && previous.SettlementNativeHash != p.SettlementNativeHash {
			return Order{}, ErrConflict
		}
		if previous.PaidAtoms == p.PaidAtoms && previous.RefundedAtoms == p.RefundedAtoms && len(previous.Receipts) == len(p.Receipts) && strings.Join(previous.PendingOriginals, "\x00") == strings.Join(p.PendingOriginals, "\x00") && previous.CompleteKnownOriginals == p.CompleteKnownOriginals {
			before, e := cloneSnapshot(s.s)
			if e != nil {
				return Order{}, e
			}
			if s.observeNativePayNotificationsLocked(o, p) {
				if e = s.persistLocked(); e != nil {
					s.s = before
					return Order{}, e
				}
			}
			return cloneOrder(o), nil
		}
		p.ReconciliationRequired = previous.ReconciliationRequired
	}
	before, e := cloneSnapshot(s.s)
	if e != nil {
		return Order{}, e
	}
	firstPaid := (previous == nil || previous.PaidAtoms == "0") && p.PaidAtoms != "0"
	if firstPaid {
		if o.Status != "payment_pending" || !o.ReservationExpiresAt.After(s.now()) {
			p.ReconciliationRequired = true
		} else {
			if e = s.applyReservationLocked(o, true); e != nil {
				s.s = before
				return Order{}, e
			}
			o.Status = "paid"
		}
	}
	if p.RefundedAtoms != "0" {
		if p.RefundedAtoms == p.PaidAtoms {
			o.RefundStatus = "native_refunded"
			if !p.ReconciliationRequired {
				o.Status = "refunded"
			}
		} else {
			o.RefundStatus = "native_partial_refund"
		}
	}
	p.Receipts = append([]nativeShopArchiveReceipt(nil), p.Receipts...)
	p.PendingOriginals = append([]string(nil), p.PendingOriginals...)
	o.NativePayment = &p
	o.UpdatedAt = s.now()
	s.orderEventLocked(&o, "pay-native-original-receipt", "system", "native_payment_receipt", o.Status, p.SettlementNativeHash)
	s.s.Orders[o.ID] = o
	s.observeNativePayNotificationsLocked(o, p)
	s.auditLocked("pay-native-original-receipt", "system", "native_payment_receipt", "order", o.ID, o.Status, p.SettlementNativeHash)
	if e = s.persistLocked(); e != nil {
		s.s = before
		return Order{}, e
	}
	return cloneOrder(o), nil
}

func originalOrderWasPaid(o Order) bool {
	if strings.HasPrefix(o.PayIntentID, "npi_") {
		p := o.NativePayment
		return p != nil && !p.ReconciliationRequired && p.InvoiceID == o.InvoiceID && p.PaidAtoms == p.PrincipalAtoms && p.PaidAtoms != "0" && nativeReceiptHex(p.SettlementNativeHash, true)
	}
	return o.Settlement != nil && settlementMatchesOrder(o, *o.Settlement)
}

// Stored receipt projections are backed by their original durable completed
// server effect, never standalone imported JSON. Validate on cold open before
// fulfillment/warehouse paths can consume the accepted financial state.
func validateNativePaymentRecords(snapshot Snapshot) error {
	store := &Store{s: snapshot}
	claims := map[string]string{}
	for id, o := range snapshot.Orders {
		if o.NativePayment == nil {
			continue
		}
		found := false
		for _, r := range snapshot.BusinessEffects {
			if r.Kind != "pay.native-receipt" || r.Target != id || r.Phase != "completed" {
				continue
			}
			var in nativeShopPaymentInput
			var wire nativeShopArchiveReconciliation
			if decodeEffect(r.Input, &in) != nil || nativeReceiptDecode(r.Result, &wire) != nil {
				return ErrInvalidState
			}
			p, e := validateNativeShopReconciliation(in, wire)
			if e != nil {
				return e
			}
			actual, e := store.nativePaymentInput(o.Buyer, id, in.Origin)
			if e != nil {
				return e
			}
			a, _ := json.Marshal(actual.Request)
			b, _ := json.Marshal(in.Request)
			if !bytes.Equal(a, b) || actual.TermsHash != in.TermsHash || actual.SessionID != in.SessionID {
				return ErrConflict
			}
			p.ReconciliationRequired = o.NativePayment.ReconciliationRequired
			left, _ := json.Marshal(p)
			right, _ := json.Marshal(o.NativePayment)
			if bytes.Equal(left, right) {
				found = true
			}
		}
		if !found {
			return ErrInvalidState
		}
		for _, r := range o.NativePayment.Receipts {
			if r.EventClaim == "" {
				continue
			}
			if other, ok := claims[r.EventClaim]; ok && other != id {
				return ErrConflict
			}
			claims[r.EventClaim] = id
		}
	}
	return nil
}
