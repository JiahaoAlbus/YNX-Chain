//go:build pay_pq

package paynativesource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

var (
	ErrNotSupplied = errors.New("PAY_ORIGINAL_BUSINESS_SOURCE_COMMISSIONING_NOT_SUPPLIED")
	ErrDenied      = errors.New("PAY_ORIGINAL_SOURCE_DENIED")
)

// Private immutable producer objects. Neither type has a JSON constructor,
// exported factory, public Current callback, approved bool or request setter.
// Original verified commissioning/bill producers alone may populate them.
type originalBill struct {
	intent                               payproduct.NativeInvoiceProductIntent
	productMerchantID, merchant, storeID string
	terms                                ynxauth.InvoiceTermsPayload
	readerPrincipal                      string
	operations                           []string
	until                                time.Time
	generation                           uint64
	cloudOriginal                        originalCloudBillLocator
}
type originalServiceBinding struct {
	service, principal string
	uid                uint32
	pid                int
	operations         []string
	until              time.Time
	// Independently bound original bill index, never caller-provided data.
	bills       map[string]*originalBill
	generation  uint64
	routes      map[string][]string
	submissions map[string]time.Time
}
type commissionedRuntime struct {
	nodeOrigin string
	engine     OriginalPayEngine
	store      *payproduct.Store
	cloudBills *cloud.IDEUsageBillReader
	genesis    []byte
	nativeID   uint64
	ledger     *originalLedger
	proof      *originalProofReader
	bindings   map[string]*originalServiceBinding
	generation atomic.Uint64
	retired    atomic.Bool
}
type sourceContextKey struct{}
type requestLease struct {
	owner           *Owner
	request         *http.Request
	caller          *securelink.LocalCaller
	material        securelink.LocalCallerMaterial
	binding         *originalServiceBinding
	generation      uint64
	active          atomic.Bool
	mu              sync.Mutex
	first           error
	floor, anchor   time.Time
	cloudMu         sync.Mutex
	cloudCaptureMu  sync.Mutex
	cloudHeld       map[string]*heldOriginalCloudBill
	cloudClosed     bool
	cloudCloseFirst error
}

func (l *requestLease) fail(e error) error {
	if l.first == nil {
		l.first = e
	}
	return l.first
}

// Deadlines from original signed material have wall time only. Keep an
// independent monotonic floor so a wall-clock rollback cannot revive a bill
// or a shorter independent submit permission within the parent Source lease.
func (l *requestLease) before(until time.Time) bool {
	if l == nil || l.anchor.IsZero() {
		return false
	}
	logical := l.anchor.UnixNano() + time.Since(l.anchor).Nanoseconds()
	return time.Now().UnixNano() < until.UnixNano() && logical < until.UnixNano()
}
func (l *requestLease) current(ctx context.Context) error {
	if l == nil || ctx == nil {
		return ErrDenied
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.first != nil {
		return l.first
	}
	if l.owner == nil || l.owner.runtime == nil || l.owner.retired.Load() || !l.active.Load() || l.owner.runtime.retired.Load() || l.owner.runtime.generation.Load() != l.generation {
		return l.fail(ErrDenied)
	}
	if l.owner.commissioning != nil {
		if e := l.owner.commissioning.current(); e != nil {
			return l.fail(e)
		}
	}
	if e := ctx.Err(); e != nil {
		return l.fail(e)
	}
	if e := l.heldCloudCurrent(); e != nil {
		return l.fail(e)
	}
	now := time.Now()
	if now.UnixNano() < l.floor.UnixNano() || !l.before(l.binding.until) {
		return l.fail(ErrDenied)
	}
	l.floor = now
	// Full original OS Current and immutable material were captured before
	// entering product locks. This sole LINK getter checks the exact original
	// request's observed lifetime, without Poll/Recv/peer syscall or body copy.
	// It is not claimed to discover an unobserved remote close or fresh OS peer.
	if e := l.caller.CurrentOriginalCaller(l.request); e != nil {
		return l.fail(e)
	}
	return nil
}

type Owner struct {
	runtime           *commissionedRuntime
	commissioning     *originalPayCommissioning
	retired           atomic.Bool
	mu                sync.Mutex
	active            map[*securelink.LocalCaller]*requestLease
	first, closeFirst error
	closeSelected     bool
	partialRequests   []*requestLease
	physicalClosed    bool
}

var _ payproduct.NativeInvoiceSourceReader = (*Owner)(nil)
var _ payproduct.NativePayAuthority = (*Owner)(nil)
var _ payproduct.NativePayProofSource = (*Owner)(nil)

func (o *Owner) InvoiceReader() payproduct.NativeInvoiceSourceReader { return o }
func (o *Owner) Authority() payproduct.NativePayAuthority            { return o }
func (o *Owner) ProofSource() payproduct.NativePayProofSource        { return o }

// Normal listener wrapper retains the SAME request/context. LINK rejects a
// WithContext copy as a different request; this wrapper never manufactures one.
func (o *Owner) WrapOriginalPrivateHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if next == nil {
			http.Error(w, "PAY_SOURCE_UNAVAILABLE", http.StatusServiceUnavailable)
			return
		}
		lease, e := o.capture(r)
		if e != nil {
			http.Error(w, "PAY_SOURCE_UNAVAILABLE", http.StatusServiceUnavailable)
			return
		}
		defer func() {
			lease.active.Store(false)
			closeError := lease.closeCloudHeld()
			o.mu.Lock()
			delete(o.active, lease.caller)
			if closeError != nil {
				o.partialRequests = append(o.partialRequests, lease)
				if o.closeFirst == nil {
					o.closeFirst = closeError
				}
			}
			o.mu.Unlock()
		}()
		next.ServeHTTP(w, r)
	})
}
func (o *Owner) capture(r *http.Request) (*requestLease, error) {
	if o == nil || r == nil || o.runtime == nil || o.retired.Load() || o.runtime.retired.Load() {
		return nil, ErrNotSupplied
	}
	caller, e := securelink.LocalCallerFromRequest(r)
	if e != nil {
		return nil, e
	}
	m, e := caller.Current(r.Context())
	if e != nil {
		return nil, e
	}
	b := o.runtime.bindings[m.Service]
	if b == nil || b.service != m.Service || b.uid != m.PeerUID || b.pid != m.PeerPID || !accountaddress.IsCanonical(b.principal) || !time.Now().Before(b.until) {
		return nil, ErrDenied
	}
	l := &requestLease{owner: o, request: r, caller: caller, material: m, binding: b, generation: o.runtime.generation.Load(), floor: time.Now(), anchor: time.Now()}
	l.active.Store(true)
	if e = l.current(r.Context()); e != nil {
		return nil, e
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.retired.Load() {
		l.active.Store(false)
		return nil, ErrDenied
	}
	if o.active == nil {
		o.active = make(map[*securelink.LocalCaller]*requestLease)
	}
	if _, ok := o.active[caller]; ok {
		return nil, ErrDenied
	}
	o.active[caller] = l
	return l, nil
}
func (o *Owner) request(ctx context.Context) (*requestLease, error) {
	if ctx == nil || o == nil || o.runtime == nil || o.retired.Load() {
		return nil, ErrNotSupplied
	}
	caller, e := securelink.LocalCallerFromContext(ctx)
	if e != nil {
		return nil, e
	}
	o.mu.Lock()
	l := o.active[caller]
	o.mu.Unlock()
	if l == nil || l.owner != o {
		return nil, ErrDenied
	}
	return l, l.current(ctx)
}
func exactIntent(a, b payproduct.NativeInvoiceProductIntent) bool {
	x, y := a, b
	x.DomainData = nil
	y.DomainData = nil
	return x.ProductID == y.ProductID && x.StoreID == y.StoreID && x.SourceOrder == y.SourceOrder && x.Merchant == y.Merchant && x.Recipient == y.Recipient && x.Genesis == y.Genesis && x.NativeChainID == y.NativeChainID && x.AssetID == y.AssetID && x.UnitVersion == y.UnitVersion && x.AmountAtoms == y.AmountAtoms && bytes.Equal(a.DomainData, b.DomainData)
}
func cloneIntent(v payproduct.NativeInvoiceProductIntent) payproduct.NativeInvoiceProductIntent {
	v.DomainData = bytes.Clone(v.DomainData)
	return v
}
func billDigest(v payproduct.NativeInvoiceProductIntent) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func (l *requestLease) bill(ctx context.Context, operation, order string) (*originalBill, error) {
	if e := l.current(ctx); e != nil {
		return nil, e
	}
	if !l.allows(operation) {
		return nil, ErrDenied
	}
	b := l.binding.bills[order]
	if b == nil || b.generation != l.binding.generation || !slices.Contains(b.operations, operation) || !l.before(b.until) || b.intent.SourceOrder != order || b.merchant != b.intent.Merchant || b.storeID != b.intent.StoreID || b.productMerchantID == "" || len(b.intent.DomainData) == 0 || len(b.intent.DomainData) > 65536 {
		return nil, ErrDenied
	}
	if _, e := l.holdCloudBill(ctx, b); e != nil {
		return nil, e
	}
	return b, l.current(ctx)
}
func (l *requestLease) allows(operation string) bool {
	return l != nil && l.binding != nil && slices.Contains(l.binding.operations, operation) && slices.Contains(l.binding.routes[l.material.Method+" "+l.material.Path], operation)
}
func (o *Owner) ReadInvoiceIntentSource(ctx context.Context, a payproduct.NativeInvoiceIntentAccess) (payproduct.NativeInvoiceSourceSnapshot, error) {
	var out payproduct.NativeInvoiceSourceSnapshot
	l, e := o.request(ctx)
	if e != nil {
		return out, e
	}
	b, e := l.bill(ctx, a.Operation, a.Intent.SourceOrder)
	if e != nil {
		return out, e
	}
	if !exactIntent(a.Intent, b.intent) || a.Intent.ProductID == "shop.order" && b.storeID == "" {
		return out, ErrDenied
	}
	if (a.Operation == "merchant_review" || a.Operation == "submit_merchant_member") && l.binding.principal != b.merchant {
		return out, ErrDenied
	}
	fence, e := o.runtime.productAssociation(b, l.binding.principal, a.Operation == "merchant_review" || a.Operation == "submit_merchant_member")
	if e != nil {
		return out, e
	}
	current := func() error {
		if e := l.current(ctx); e != nil {
			return e
		}
		if !l.before(b.until) {
			return ErrDenied
		}
		return fence.Current()
	}
	held, e := l.holdCloudBill(ctx, b)
	if e != nil {
		return out, e
	}
	out = payproduct.NativeInvoiceSourceSnapshot{Caller: l.binding.principal, Intent: cloneIntent(b.intent), ProductMerchantID: b.productMerchantID, MerchantAccount: b.merchant, StoreID: b.storeID, Terms: b.terms, AllowedOperations: slices.Clone(b.operations), Until: minTime(minTime(b.until, l.binding.until), held.until), Current: current}
	return out, current()
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func (o *Owner) Authorize(ctx context.Context, a payproduct.NativePayAccess) (payproduct.NativePayAuthorization, error) {
	var out payproduct.NativePayAuthorization
	l, e := o.request(ctx)
	if e != nil {
		return out, e
	}
	if !l.allows(a.Operation) {
		return out, ErrDenied
	}
	var b *originalBill
	for _, candidate := range l.binding.bills {
		if (a.SourceOrder == "" || candidate.intent.SourceOrder == a.SourceOrder) && (a.InvoiceID == "" || candidate.terms.InvoiceID == a.InvoiceID) && (a.Merchant == "" || candidate.merchant == a.Merchant) {
			if b != nil {
				return out, ErrDenied
			}
			b = candidate
		}
	}
	if b == nil || !slices.Contains(b.operations, a.Operation) || !l.before(b.until) {
		return out, ErrDenied
	}
	heldBill, e := l.holdCloudBill(ctx, b)
	if e != nil {
		return out, e
	}
	fence, e := o.runtime.productAssociation(b, l.binding.principal, a.Operation == "register_terms" || a.Operation == "refund" || a.Operation == "review_refund")
	if e != nil {
		return out, e
	}
	principal := l.binding.principal
	if a.Operation == "prepare_terms" {
		principal = b.merchant
	}
	view, e := o.runtime.ledger.read(principal)
	if e != nil {
		return out, e
	}
	spend := a.Operation == "register_terms" || a.Operation == "settle" || a.Operation == "refund" || a.Operation == "prepare_terms" || a.Operation == "review_settlement" || a.Operation == "review_refund"
	if a.Terms != nil && (*a.Terms != b.terms || a.Operation != "prepare_terms") {
		return out, ErrDenied
	}
	if a.Operation == "prepare_terms" || a.Operation == "register_terms" || a.Operation == "refund" || a.Operation == "review_refund" {
		if principal != b.merchant {
			return out, ErrDenied
		}
	}
	var submitUntil time.Time
	if a.Operation == "register_terms" || a.Operation == "settle" || a.Operation == "refund" {
		if a.Action == nil || a.Action.Owner != principal || view.nonce == math.MaxUint64 || a.Action.Nonce != view.nonce+1 || !bytes.Equal(a.Action.ChainID, o.runtime.genesis) || a.Action.NativeChainID != o.runtime.nativeID {
			return out, ErrDenied
		}
		if e = bindOriginalAction(a, b); e != nil {
			return out, e
		}
		message, e := a.Action.SigningBytes()
		if e != nil {
			return out, e
		}
		hash := sha256.Sum256(message)
		until, allowed := l.binding.submissions[hex.EncodeToString(hash[:])]
		if !allowed || !l.before(until) {
			return out, errors.New("PAY_INDEPENDENT_ORIGINAL_SUBMIT_PERMISSION_REQUIRED")
		}
		submitUntil = until
	}
	if (a.Operation == "prepare_terms" || a.Operation == "register_terms") && (b.terms.KeyEpoch != view.epoch || b.terms.ExpiresAt < view.height) {
		return out, ErrDenied
	}
	current := func() error {
		if e := l.current(ctx); e != nil {
			return e
		}
		if !l.before(b.until) {
			return ErrDenied
		}
		if !submitUntil.IsZero() && !l.before(submitUntil) {
			return ErrDenied
		}
		if e := fence.Current(); e != nil {
			return e
		}
		return o.runtime.ledger.current(principal, view, spend)
	}
	registration := view.registration
	registration.PKA = bytes.Clone(view.registration.PKA)
	registration.PKB = bytes.Clone(view.registration.PKB)
	until := minTime(minTime(b.until, l.binding.until), heldBill.until)
	if !submitUntil.IsZero() {
		until = minTime(until, submitUntil)
	}
	out = payproduct.NativePayAuthorization{Principal: principal, Registration: registration, Height: view.height, KeyEpoch: view.epoch, LedgerNonce: view.nonce, ProductMerchantID: b.productMerchantID, BoundInvoiceRead: true, BoundInvoiceID: b.terms.InvoiceID, BoundOrderID: b.intent.SourceOrder, BoundSessionID: b.terms.SessionID, Until: until, Current: current}
	return out, current()
}
func bindOriginalAction(a payproduct.NativePayAccess, b *originalBill) error {
	if a.Action == nil || a.Action.Fee != ynxauth.InvoiceActionFee {
		return ErrDenied
	}
	payload, e := ynxauth.DecodeActionPayload(a.Action.Kind, a.Action.Payload)
	if e != nil {
		return e
	}
	switch a.Operation {
	case "register_terms":
		v, ok := payload.(ynxauth.InvoiceTermsPayload)
		if !ok || v != b.terms || a.Action.Kind != ynxauth.ActionInvoiceTerms {
			return ErrDenied
		}
	case "settle":
		v, ok := payload.(ynxauth.InvoiceSettlePayload)
		if !ok || a.Action.Kind != ynxauth.ActionInvoiceSettle || v.InvoiceID != b.terms.InvoiceID || v.Merchant != b.merchant || v.Amount != b.terms.Amount {
			return ErrDenied
		}
	case "refund":
		v, ok := payload.(ynxauth.InvoiceRefundPayload)
		if !ok || a.Action.Kind != ynxauth.ActionInvoiceRefund || v.InvoiceID != b.terms.InvoiceID || v.Amount == 0 || v.Amount > b.terms.Amount {
			return ErrDenied
		}
	default:
		return ErrDenied
	}
	return nil
}
func (o *Owner) Trust(ctx context.Context, original payproduct.NativePayOriginal) (consensus.PQLightProofTrust, consensus.PQTransactionProofExpectation, error) {
	var trust consensus.PQLightProofTrust
	var expected consensus.PQTransactionProofExpectation
	l, e := o.request(ctx)
	if e != nil {
		return trust, expected, e
	}
	if !l.allows("reconcile") {
		return trust, expected, ErrDenied
	}
	found := false
	for _, b := range l.binding.bills {
		if b.merchant == original.Merchant && b.terms.InvoiceID == original.InvoiceID && l.before(b.until) && slices.Contains(b.operations, "reconcile") {
			if _, e = l.holdCloudBill(ctx, b); e != nil {
				return trust, expected, e
			}
			found = true
		}
	}
	if !found {
		return trust, expected, ErrDenied
	}
	trust, expected, e = o.runtime.proof.read(ctx, original)
	if e != nil {
		return trust, expected, e
	}
	if e = l.current(ctx); e != nil {
		return consensus.PQLightProofTrust{}, consensus.PQTransactionProofExpectation{}, e
	}
	return trust, expected, nil
}
func (o *Owner) Retire() {
	if o != nil {
		o.retired.Store(true)
	}
}
func (o *Owner) Close() error {
	if o == nil {
		return nil
	}
	o.Retire()
	o.mu.Lock()
	defer o.mu.Unlock()
	o.closeSelected = true
	if o.physicalClosed {
		return o.closeFirst
	}
	if len(o.active) != 0 {
		if o.closeFirst == nil {
			o.closeFirst = errors.New("PAY_SOURCE_REQUEST_CHILDREN_RETAINED")
		}
		return o.closeFirst
	}
	// Request cleanup with a failed or ambiguous child close retains custody.
	// The child has a sticky once-close result, not a physical-done getter;
	// replaying it or clearing this inventory cannot prove safe parent release.
	if len(o.partialRequests) != 0 {
		if o.closeFirst == nil {
			o.closeFirst = errors.New("PAY_SOURCE_PARTIAL_REQUEST_CUSTODY_RETAINED")
		}
		return o.closeFirst
	}
	if e := o.commissioning.close(); e != nil && o.closeFirst == nil {
		o.closeFirst = e
	}
	o.physicalClosed = o.commissioning.closed()
	return o.closeFirst
}

// Closed reports actual completed physical custody, independently from the
// original first Close error. Retire/current failure alone never means closed.
// It does not attempt cleanup, retry an unknown close, or grant any authority.
func (o *Owner) Closed() bool {
	if o == nil {
		return true
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.physicalClosed
}
func (r *commissionedRuntime) productAssociation(b *originalBill, principal string, memberRequired bool) (*payproduct.NativeMerchantFence, error) {
	if r == nil || r.store == nil {
		return nil, ErrNotSupplied
	}
	return r.store.CaptureNativeMerchantFence(b.productMerchantID, principal, b.terms.Recipient, memberRequired)
}
