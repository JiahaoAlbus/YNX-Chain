package productreadsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type shopV4Identity struct {
	NetworkID          string  `json:"networkId"`
	CanonicalOwner     string  `json:"canonicalOwner"`
	Account            string  `json:"account"`
	SessionBinding     string  `json:"sessionBinding"`
	ProductID          string  `json:"productId"`
	ClientID           string  `json:"clientId"`
	Platform           string  `json:"platform"`
	ApplicationID      string  `json:"applicationId"`
	BundleID           *string `json:"bundleId"`
	PackageID          *string `json:"packageId"`
	Origin             string  `json:"origin"`
	Callback           string  `json:"callback"`
	DeviceID           string  `json:"deviceId"`
	Generation         string  `json:"generation"`
	RegistrationID     string  `json:"registrationId"`
	Revision           string  `json:"revision"`
	RegistrationDigest string  `json:"registrationDigest"`
}
type shopV4Projection struct {
	Account            string         `json:"account"`
	SessionBinding     string         `json:"sessionBinding"`
	Identity           shopV4Identity `json:"identity"`
	Role               string         `json:"role"`
	Scopes             []string       `json:"scopes"`
	SessionOriginal    string         `json:"sessionOriginal"`
	IssuerExpires      int64          `json:"serverIssuerExpiresAtMs"`
	SessionExpires     int64          `json:"sessionExpiresAtMs"`
	ProofExpires       int64          `json:"proofExpiresAtMs"`
	LoanUntil          int64          `json:"loanUntilMs"`
	NonceConsumed      bool           `json:"nonceConsumed"`
	SignatureVerified  bool           `json:"signatureVerified"`
	IdentityVerified   bool           `json:"identityVerified"`
	BusinessAuthorized bool           `json:"businessAuthorized"`
	RequestDigest      string         `json:"requestDigest"`
	SessionDigest      string         `json:"sessionDigest"`
	DataOnly           bool           `json:"dataOnly"`
	Authorized         bool           `json:"authorized"`
}
type shopV4Failure struct {
	Code       string          `json:"code"`
	FirstKind  string          `json:"firstKind"`
	FirstValue json.RawMessage `json:"firstValue"`
}

func (f *shopV4Failure) Error() string { return "SHOP_V4_ORIGINAL_DRIVER_FAILURE" }

type shopV4Result struct {
	Version      int               `json:"version"`
	Phase        string            `json:"phase"`
	ErrorPresent bool              `json:"errorPresent"`
	Failure      *shopV4Failure    `json:"failure"`
	Projection   *shopV4Projection `json:"projection"`
}

// Guarded DATA only; no constructor accepts it. Stable issuer/session expiry
// is not the finite proof/request loan deadline and does not renew that loan.
type VerifiedShopGETDATA struct {
	Account, Role, SessionBinding, SessionDigest      string
	Scopes                                            []string
	IssuerExpiresAt, SessionExpiresAt, ProofLoanUntil time.Time
}

// Privately minted from SAME existing Source Hold, request, context and LINK
// caller. No expected17/provider/role/URL/Source/approved Boolean parameter.
type VerifiedShopGET struct {
	hold            *Hold
	ctx             context.Context
	cancel          context.CancelFunc
	operation       sync.Mutex
	lifecycle       sync.Mutex
	firstMu         sync.Mutex
	first           error
	active          atomic.Int64
	retired         atomic.Bool
	physical        atomic.Bool
	processPending  atomic.Bool
	processUnknown  atomic.Bool
	selected        bool
	verified        atomic.Bool
	originalRequest []byte
	requestDigest   string
	projection      shopV4Projection
	stable          string
	until           time.Time
	wallStart       int64
}

// A previously requested Hold close may complete its own LOCAL child release
// after the actual Run/Wait and all postchecks finish. This never redispatches
// a physical close, Source verification, nonce or another operation.
func (v *VerifiedShopGET) finishOriginalWork() {
	if !v.originalObject() {
		return
	}
	v.lifecycle.Lock()
	v.physical.Store(!v.processPending.Load() && !v.processUnknown.Load())
	finishHold := v.active.Add(-1) == 0 && v.hold.closed.Load()
	v.lifecycle.Unlock()
	if finishHold {
		_ = v.hold.Close()
	}
}

func (v *VerifiedShopGET) originalObject() bool {
	return v != nil && v.hold != nil && v.hold.parent != nil && v.hold.ctx != nil && v.ctx != nil && v.cancel != nil
}

func (v *VerifiedShopGET) beginOriginalWork() bool {
	v.lifecycle.Lock()
	defer v.lifecycle.Unlock()
	if v.retired.Load() {
		return false
	}
	v.active.Add(1)
	v.physical.Store(false)
	return true
}

func sameShopContext(a, b context.Context) bool {
	return a != nil && b != nil && reflect.TypeOf(a).Comparable() && reflect.TypeOf(b).Comparable() && a == b
}

func (v *VerifiedShopGET) remember(e error) error {
	if e == nil {
		return nil
	}
	v.firstMu.Lock()
	defer v.firstMu.Unlock()
	if v.first == nil {
		v.first = e
	}
	return v.first
}
func (v *VerifiedShopGET) originalError() error {
	v.firstMu.Lock()
	defer v.firstMu.Unlock()
	return v.first
}
func requestOriginal(r *http.Request) ([]byte, error) {
	if r == nil || r.URL == nil || r.Method != "GET" || r.ContentLength != 0 || len(r.TransferEncoding) != 0 || len(r.Trailer) != 0 || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.Fragment != "" || strings.ContainsAny(r.URL.Path, "%\\\r\n") {
		return nil, ErrDenied
	}
	keys := make([]string, 0, len(r.Header))
	for k := range r.Header {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	headers := []string{}
	for _, k := range keys {
		for _, value := range r.Header[k] {
			for _, c := range k + value {
				if c > 126 || c < 32 {
					return nil, ErrDenied
				}
			}
			headers = append(headers, k, value)
		}
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if enc.Encode(map[string]any{"body": "", "method": "GET", "path": r.URL.Path, "rawHeaders": headers}) != nil {
		return nil, ErrDenied
	}
	raw := bytes.TrimSuffix(b.Bytes(), []byte{'\n'})
	if len(raw) > 393216 {
		return nil, ErrDenied
	}
	return bytes.Clone(raw), nil
}
func rawDigest(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func (h *Hold) VerifyOriginalShopGET(ctx context.Context) (*VerifiedShopGET, error) {
	if h == nil || h.parent == nil || !sameShopContext(ctx, h.ctx) {
		return nil, ErrDenied
	}
	if prior := h.v4.Load(); prior != nil {
		prior.operation.Lock()
		defer prior.operation.Unlock()
		if prior.verified.Load() && prior.originalError() == nil {
			return prior, ErrDenied
		}
		if e := prior.originalError(); e != nil {
			return prior, e
		}
		return prior, ErrDenied
	}
	child, cancel := context.WithCancel(ctx)
	v := &VerifiedShopGET{hold: h, ctx: child, cancel: cancel}
	if !h.v4.CompareAndSwap(nil, v) {
		cancel()
		return h.VerifyOriginalShopGET(ctx)
	}
	v.operation.Lock()
	defer v.operation.Unlock()
	if !v.beginOriginalWork() {
		return v, v.remember(ErrRetired)
	}
	defer v.finishOriginalWork()
	fail := func(e error) (*VerifiedShopGET, error) { return v, v.remember(e) }
	if e := h.Current(ctx); e != nil {
		return fail(e)
	}
	raw, e := requestOriginal(h.request)
	if e != nil {
		return fail(e)
	}
	if h.request.URL.Path != shopPath(h.scope.SourceOrder) {
		return fail(ErrDenied)
	}
	v.originalRequest = raw
	v.requestDigest = rawDigest(raw)
	v.wallStart = time.Now().UnixMilli()
	v.until = time.Now().Add(5 * time.Second)
	if e = h.parent.Current(child); e != nil {
		return fail(e)
	}
	if e = h.Current(ctx); e != nil {
		return fail(e)
	}
	v.selected = true
	p, e := h.parent.shopV4RuntimeOwned(child, "VERIFY", raw, v)
	if e != nil {
		return fail(e)
	}
	if e = v.acceptProjection(p, true); e != nil {
		return fail(e)
	}
	if e = h.parent.Current(child); e != nil {
		return fail(e)
	}
	if e = v.sameRequest(); e != nil {
		return fail(e)
	}
	v.projection = *p
	v.stable = stableShopV4(p)
	v.verified.Store(true)
	return v, nil
}
func (v *VerifiedShopGET) sameRequest() error {
	if v == nil || v.hold == nil {
		return ErrDenied
	}
	if e := v.hold.Current(v.hold.ctx); e != nil {
		return e
	}
	raw, e := requestOriginal(v.hold.request)
	if e != nil || !bytes.Equal(raw, v.originalRequest) {
		return ErrDenied
	}
	return nil
}
func stableShopV4(p *shopV4Projection) string {
	b, _ := json.Marshal(struct {
		Identity                                    shopV4Identity
		Role                                        string
		Scopes                                      []string
		SessionDigest                               string
		IssuerExpires, SessionExpires, ProofExpires int64
	}{p.Identity, p.Role, p.Scopes, p.SessionDigest, p.IssuerExpires, p.SessionExpires, p.ProofExpires})
	return rawDigest(b)
}
func (v *VerifiedShopGET) acceptProjection(p *shopV4Projection, fresh bool) error {
	h := v.hold
	s := h.parent.state.Load()
	if s == nil || p == nil || p.RequestDigest != v.requestDigest || p.NonceConsumed != fresh || !p.SignatureVerified || !p.IdentityVerified || !p.DataOnly || p.Authorized || p.BusinessAuthorized || p.Identity.NetworkID != s.scope.NetworkID || p.Identity.CanonicalOwner != s.scope.Account || p.Identity.ProductID != "shop" || p.Role != h.scope.Role || p.Account != p.Identity.Account || p.SessionBinding != p.Identity.SessionBinding || p.SessionDigest != rawDigest([]byte(p.SessionOriginal)) || len(p.SessionOriginal) > 16384 || p.SessionOriginal == "" {
		return ErrDenied
	}
	if h.scope.Actor != p.Account && h.scope.Actor != p.Identity.CanonicalOwner {
		return ErrDenied
	}
	required := []string{"account:read", "shop:orders:write", "shop:profile:write"}
	if p.Role == "seller" {
		required = []string{"account:read", "shop:seller:operate"}
	} else if p.Role != "buyer" {
		return ErrDenied
	}
	if strings.Join(required, "\x00") != strings.Join(p.Scopes, "\x00") {
		return ErrDenied
	}
	now := time.Now()
	if p.IssuerExpires <= now.UnixMilli() || p.SessionExpires <= now.UnixMilli() || p.ProofExpires <= now.UnixMilli() || p.LoanUntil <= now.UnixMilli() || p.LoanUntil > p.IssuerExpires || p.LoanUntil > p.SessionExpires || p.LoanUntil > p.ProofExpires {
		return ErrDenied
	}
	if fresh {
		candidate := now.Add(time.Until(time.UnixMilli(p.LoanUntil)))
		if candidate.Before(v.until) {
			v.until = candidate
		}
		if h.epoch.until.Before(v.until) {
			v.until = h.epoch.until
		}
	} else if stableShopV4(p) != v.stable {
		return ErrDenied
	}
	if now.UnixMilli() < v.wallStart || !now.Before(v.until) {
		return ErrRetired
	}
	return nil
}

// Pure Store-lock fence: no FD/process/network/math or request reparsing.
func (v *VerifiedShopGET) CurrentLocal(ctx context.Context) error {
	if v == nil || v.hold == nil || !sameShopContext(ctx, v.hold.ctx) {
		return ErrDenied
	}
	if e := v.originalError(); e != nil {
		return e
	}
	if v.processUnknown.Load() {
		return ErrUnknown
	}
	if !v.verified.Load() || v.retired.Load() || v.ctx.Err() != nil || time.Now().UnixMilli() < v.wallStart || !time.Now().Before(v.until) {
		return ErrRetired
	}
	return v.hold.Current(ctx)
}
func (v *VerifiedShopGET) Current(ctx context.Context) error {
	if !v.originalObject() {
		return ErrDenied
	}
	v.operation.Lock()
	defer v.operation.Unlock()
	if !v.beginOriginalWork() {
		if e := v.originalError(); e != nil {
			return e
		}
		return ErrRetired
	}
	defer v.finishOriginalWork()
	if e := v.CurrentLocal(ctx); e != nil {
		return v.remember(e)
	}
	if e := v.hold.parent.Current(v.ctx); e != nil {
		return v.remember(e)
	}
	if e := v.sameRequest(); e != nil {
		return v.remember(e)
	}
	p, e := v.hold.parent.shopV4RuntimeOwned(v.ctx, "CURRENT", v.originalRequest, v)
	if e != nil {
		return v.remember(e)
	}
	if e = v.acceptProjection(p, false); e != nil {
		return v.remember(e)
	}
	if e = v.hold.parent.Current(v.ctx); e != nil {
		return v.remember(e)
	}
	if e = v.sameRequest(); e != nil {
		return v.remember(e)
	}
	return v.CurrentLocal(ctx)
}
func (v *VerifiedShopGET) DATA(ctx context.Context) (VerifiedShopGETDATA, error) {
	if e := v.CurrentLocal(ctx); e != nil {
		return VerifiedShopGETDATA{}, e
	}
	p := v.projection
	return VerifiedShopGETDATA{p.Account, p.Role, p.SessionBinding, p.SessionDigest, append([]string(nil), p.Scopes...), time.UnixMilli(p.IssuerExpires), time.UnixMilli(p.SessionExpires), v.until}, nil
}
func (v *VerifiedShopGET) Close() error {
	if v == nil {
		return nil
	}
	if !v.originalObject() {
		return ErrDenied
	}
	v.lifecycle.Lock()
	defer v.lifecycle.Unlock()
	v.retired.Store(true)
	v.cancel()
	if v.active.Load() != 0 {
		return ErrPending
	}
	if v.processPending.Load() || v.processUnknown.Load() {
		if e := v.originalError(); e != nil {
			return e
		}
		return ErrUnknown
	}
	v.physical.Store(true)
	return v.originalError()
}

// Read-only mechanical witness. It neither invokes Close/current, changes
// permission nor interprets the original failure as physical completion.
func (v *VerifiedShopGET) AssertOriginalClosed() error {
	if !v.originalObject() {
		return ErrDenied
	}
	v.lifecycle.Lock()
	defer v.lifecycle.Unlock()
	if !v.retired.Load() || v.active.Load() != 0 {
		return ErrPending
	}
	if !v.physical.Load() || v.processPending.Load() || v.processUnknown.Load() {
		return ErrUnknown
	}
	return nil
}

func (a *Authority) shopV4Runtime(ctx context.Context, phase string, raw []byte) (*shopV4Projection, error) {
	return a.shopV4RuntimeOwned(ctx, phase, raw, nil)
}

func (a *Authority) shopV4RuntimeOwned(ctx context.Context, phase string, raw []byte, owned *VerifiedShopGET) (*shopV4Projection, error) {
	if ctx == nil || (phase != "VERIFY" && phase != "CURRENT") {
		return nil, ErrDenied
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if e := a.atomicCurrent(ctx, nil); e != nil {
		return nil, e
	}
	if e := a.files.current(); e != nil {
		return nil, e
	}
	manifest, e := a.load(a.release.manifest)
	if e != nil {
		return nil, e
	}
	var closure struct {
		Version string        `json:"version"`
		Files   []originalPin `json:"files"`
	}
	if decode(manifest, &closure) != nil || closure.Version != "YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1" {
		return nil, ErrDenied
	}
	needed := map[string]bool{"native/original-shop-v4-get-dispatch.mjs": false, "src/original-shop-v4-get-server.js": false, "src/product-pair-session-v4-source.js": false, "src/product-pair-session-v4-store.js": false, "src/original-product-device-v4-server-current.js": false}
	for _, p := range closure.Files {
		if _, ok := needed[p.Path]; ok {
			needed[p.Path] = true
		}
	}
	for _, found := range needed {
		if !found {
			return nil, ErrNotSupplied
		}
	}
	encoded, e := json.Marshal(map[string]any{"operation": "shop-original-product-session-get/v4", "phase": phase, "requestOriginal": string(raw)})
	if e != nil || len(encoded) > 2<<20 {
		return nil, ErrDenied
	}
	call, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(call, a.release.node.Path, a.release.verifier.Path)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "NODE_NO_WARNINGS=1"}
	cmd.Stdin = bytes.NewReader(encoded)
	out := &boundedOutput{limit: 2 << 20}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	// Explicit Start/Wait observes the actual process and copy goroutines. No
	// stdout/error flags clear process debt. Never retries an UNKNOWN call.
	if e = cmd.Start(); e != nil {
		if owned != nil && cmd.Process != nil {
			owned.processPending.Store(true)
			owned.processUnknown.Store(true)
		}
		return nil, errors.Join(ErrDenied, e)
	}
	if owned != nil {
		owned.processPending.Store(true)
	}
	e = cmd.Wait()
	// ProcessState is the actual Wait result, independent of exit status or
	// stdout/error flags. WaitDelay is unset: returning Wait also drains the
	// original private stdin/stdout copy pipes. Missing state stays UNKNOWN.
	if owned != nil {
		if cmd.ProcessState == nil {
			owned.processUnknown.Store(true)
		} else {
			owned.processPending.Store(false)
		}
	}
	if cmd.ProcessState == nil {
		return nil, errors.Join(ErrUnknown, e)
	}
	if e != nil {
		return nil, errors.Join(ErrDenied, e)
	}
	if e = a.files.current(); e != nil {
		return nil, e
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	var result shopV4Result
	if decode(out.Bytes(), &result) != nil || result.Version != 1 || result.Phase != phase {
		return nil, ErrDenied
	}
	if result.ErrorPresent {
		if result.Failure == nil {
			return nil, ErrDenied
		}
		return nil, result.Failure
	}
	if result.Failure != nil || result.Projection == nil {
		return nil, ErrDenied
	}
	return result.Projection, nil
}
