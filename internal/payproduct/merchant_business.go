package payproduct

import (
	"bytes"
	"context"
	"crypto/hmac"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// Only the reviewed shared SDK adapter constructs production admissions. The
// proof scopes identify the product; original MerchantMembers grant every role.
type merchantBusinessVerifier interface {
	verify(*http.Request, []byte) (*merchantAdmission, error)
}
type merchantAdmission struct {
	account, binding, nonce, digest, method, path string
	expires, proofExpires                         time.Time
	// Each call obtains A's fresh joint private/actor snapshot OUTSIDE Store locks.
	// Its returned synchronous fence is safe under the original Store lock.
	refresh                    func(context.Context) (func() error, time.Time, error)
	merchantID, role, domainID string
	merchantIdentity           *Merchant
	browserBindingDigest       string
	browserBindingCaptured     bool
	domainToken                string
	admitted                   atomic.Bool
}
type merchantBusinessError struct {
	code   string
	status int
}

func (e *merchantBusinessError) Error() string     { return e.code }
func merchantDenied(code string, status int) error { return &merchantBusinessError{code, status} }
func businessError(w http.ResponseWriter, err error) {
	var e *merchantBusinessError
	if errors.As(err, &e) {
		writeJSON(w, e.status, map[string]string{"error": e.code, "code": e.code})
		return
	}
	writeJSON(w, 503, map[string]string{"error": "MERCHANT_AUTHORITY_UNAVAILABLE", "code": "MERCHANT_AUTHORITY_UNAVAILABLE"})
}

// Formal mounting never falls through to V1 HMAC or a bearer-only handler.
// A installs the actual shared snapshot reader and exact registered SDK adapter.
func newMerchantBusinessServer(service *Service, verifier merchantBusinessVerifier) *Server {
	server := NewServer(service)
	server.privateUnavailable = verifier == nil
	server.business = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/v1/settlement-assets" {
			server.mux.ServeHTTP(w, r)
			return
		}
		permission, creation, recovery := merchantBusinessRoute(r.Method, r.URL.Path)
		if permission == "" {
			businessError(w, merchantDenied("PAY_CANONICAL_AUTHORITY_NOT_CONFIGURED", 503))
			return
		}
		if verifier == nil {
			businessError(w, merchantDenied("MERCHANT_AUTHORITY_NOT_CONFIGURED", 503))
			return
		}
		if r.URL.RawQuery != "" || r.URL.RawPath != "" || r.URL.Fragment != "" {
			businessError(w, merchantDenied("HTTP_BINDING_MISMATCH", 403))
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
		if err != nil {
			businessError(w, merchantDenied("INVALID_ACTION_BODY", 413))
			return
		}
		if r.Method == "GET" && len(raw) != 0 {
			businessError(w, merchantDenied("INVALID_ACTION_BODY", 403))
			return
		}
		admission, err := verifier.verify(r, raw)
		if err != nil {
			businessError(w, err)
			return
		}
		if admission == nil || admission.refresh == nil || admission.method != r.Method || admission.path != r.URL.Path {
			businessError(w, merchantDenied("INVALID_AUTHORITY_RESULT", 503))
			return
		}
		if creation {
			var in struct {
				MerchantID string `json:"merchantId"`
			}
			if strictJSON(raw, &in) != nil || !identifierRE.MatchString(in.MerchantID) {
				businessError(w, merchantDenied("INVALID_MERCHANT", 400))
				return
			}
			admission.merchantID = in.MerchantID
		} else if recovery {
			oldNonce := strings.TrimPrefix(r.URL.Path, "/v1/merchant/sessions/")
			if !identifierRE.MatchString(oldNonce) {
				businessError(w, merchantDenied("INVALID_RECOVERY", 400))
				return
			}
			err = service.store.View(func(data Snapshot) error {
				record, ok := data.MerchantActions[admission.binding+":"+oldNonce]
				if !ok || record.Method != "POST" || record.Path != "/v1/merchant/sessions" || record.Account != admission.account || record.SessionID == "" {
					return merchantDenied("MERCHANT_SESSION_OUTCOME_UNCONFIRMED", 409)
				}
				admission.merchantID = record.MerchantID
				admission.domainID = record.SessionID
				return nil
			})
			if err != nil {
				businessError(w, err)
				return
			}
		} else {
			parts := strings.Split(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), ".")
			if len(parts) != 2 || !strings.HasPrefix(parts[0], "mcs_") {
				businessError(w, merchantDenied("MERCHANT_BOUND_CARRIER_REQUIRED", 401))
				return
			}
			admission.domainID, admission.domainToken = parts[0], parts[1]
			err = service.store.View(func(data Snapshot) error {
				carrier, ok := data.ConsoleSessions[admission.domainID]
				if !ok {
					return merchantDenied("MERCHANT_BOUND_CARRIER_REQUIRED", 401)
				}
				admission.merchantID = carrier.MerchantID
				return nil
			})
			if err != nil {
				businessError(w, err)
				return
			}
		}
		scoped := service.merchantScope(r.Context(), admission, permission)
		var principal MerchantPrincipal
		err = scoped.store.View(func(data Snapshot) error {
			merchant := data.Merchants[admission.merchantID]
			member := data.MerchantMembers[admission.merchantID+":"+admission.account]
			principal = MerchantPrincipal{Merchant: merchant, Account: admission.account, Role: member.Role, Session: admission.domainID}
			return nil
		})
		if err != nil {
			businessError(w, err)
			return
		}
		if creation {
			out, err := scoped.completeCanonicalMerchantSession(admission)
			if err != nil {
				businessError(w, err)
				return
			}
			writeJSON(w, 201, out)
			return
		}
		if recovery {
			// Fresh proofs consume a NEW read nonce; the original creation nonce/body
			// and carrier remain unchanged. A lost reply never mints another carrier.
			err = scoped.store.Update(func(*Snapshot) error { return nil })
			if err != nil {
				businessError(w, err)
				return
			}
			out, err := scoped.recoveredMerchantSession(admission)
			if err != nil {
				businessError(w, err)
				return
			}
			writeJSON(w, 200, out)
			return
		}
		if r.Method == "GET" {
			err = scoped.store.Update(func(*Snapshot) error { return nil })
			if err != nil {
				businessError(w, err)
				return
			}
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		r = r.WithContext(context.WithValue(r.Context(), canonicalMerchantKey{}, principal))
		child := NewServer(scoped)
		response := &merchantPrivateResponse{header: make(http.Header)}
		child.mux.ServeHTTP(response, r)
		// An idempotent cached success is still a private read. Consume its fresh
		// action once before returning, even when the original helper does no write.
		if response.status >= 200 && response.status < 300 && !admission.admitted.Load() {
			if err := scoped.store.Update(func(*Snapshot) error { return nil }); err != nil {
				businessError(w, err)
				return
			}
		}
		if response.overflow || response.body.Len() > 2<<20 {
			businessError(w, merchantDenied("PRIVATE_RESPONSE_LIMIT", 503))
			return
		}
		if err := scoped.store.View(func(Snapshot) error { return nil }); err != nil {
			businessError(w, err)
			return
		}
		for key, values := range response.header {
			w.Header()[key] = values
		}
		w.WriteHeader(response.status)
		_, _ = w.Write(response.body.Bytes())
	})
	return server
}

type canonicalMerchantKey struct{}

// These are the ORIGINAL public routes and permissions. No caller scope/role,
// wildcard private route, unsigned query, proxy alias or arbitrary path grants access.
func merchantBusinessRoute(method, path string) (permission string, creation, recovery bool) {
	fixed := map[string]string{
		"POST /v1/merchant/sessions": "read", "POST /v1/merchant/members": "members",
		"POST /v1/merchant/mutations/lookup": "read",
		"GET /v1/merchant/state":             "read", "GET /v1/merchant/analytics": "read", "GET /v1/merchant/reconciliation.csv": "reconcile",
		"POST /v1/merchant/catalog": "invoice", "POST /v1/merchant/invoices": "invoice", "POST /v1/merchant/split-payments": "invoice", "POST /v1/merchant/quant-bills": "invoice", "POST /v1/merchant/recurring-drafts": "invoice", "PUT /v1/merchant/webhook": "webhook", "POST /v1/merchant/webhook/rotate": "webhook",
	}
	if p := fixed[method+" "+path]; p != "" {
		return p, path == "/v1/merchant/sessions", false
	}
	parts := strings.Split(path, "/")
	if method == "GET" && len(parts) == 5 && parts[1] == "v1" && parts[2] == "merchant" && parts[3] == "sessions" && identifierRE.MatchString(parts[4]) {
		return "read", false, true
	}
	if method == "POST" && len(parts) == 6 && parts[1] == "v1" && parts[2] == "merchant" && identifierRE.MatchString(parts[4]) {
		if parts[3] == "webhooks" && parts[5] == "retry" {
			return "webhook", false, false
		}
		if parts[3] == "refunds" && parts[5] == "submit" {
			return "refund", false, false
		}
		if parts[3] == "refunds" && parts[5] == "refresh" {
			return "case", false, false
		}
	}
	// Async AI and payer/Native routes require the separately protected shared
	// signer/authority/provider recovery composition; no legacy fallback is mounted.
	return "", false, false
}

func merchantOriginalContext(ctx context.Context) error {
	if ctx == nil || ctx.Err() != nil {
		return merchantDenied("AUTHORITY_UNAVAILABLE", 503)
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return merchantDenied("AUTHORITY_UNAVAILABLE", 503)
	}
	return nil
}

func (s *Service) merchantScope(ctx context.Context, a *merchantAdmission, permission string) *Service {
	child := *s // shared mutex pointers and original maps; NEVER copy mutex values.
	child.merchantAction = a
	child.store = &Store{parent: s.store, authorize: func() (func(*Snapshot) error, error) {
		if err := merchantOriginalContext(ctx); err != nil {
			return nil, err
		}
		fence, until, err := a.refresh(ctx)
		if err != nil {
			return nil, err
		}
		if fence == nil || until.IsZero() {
			return nil, merchantDenied("AUTHORITY_SNAPSHOT_REQUIRED", 503)
		}
		return func(data *Snapshot) error {
			now := s.now().UTC()
			if err := merchantOriginalContext(ctx); err != nil {
				return err
			}
			if !now.Before(a.expires) || !now.Before(a.proofExpires) || !now.Before(until) {
				return merchantDenied("MERCHANT_SESSION_EXPIRED", 401)
			}
			if err := fence(); err != nil {
				return err
			}
			merchant, ok := data.Merchants[a.merchantID]
			if !ok || merchant.Status != "active" {
				return merchantDenied("MERCHANT_INACTIVE", 403)
			}
			if a.merchantIdentity == nil {
				snapshot := merchant
				a.merchantIdentity = &snapshot
			} else if merchant.CentralMerchantID != a.merchantIdentity.CentralMerchantID || merchant.PayoutAddress != a.merchantIdentity.PayoutAddress || merchant.InvoiceSigningPublicKey != a.merchantIdentity.InvoiceSigningPublicKey || merchant.InvoiceSigningPrivateCipher != a.merchantIdentity.InvoiceSigningPrivateCipher {
				return merchantDenied("MERCHANT_IDENTITY_CHANGED", 403)
			}
			member, ok := data.MerchantMembers[a.merchantID+":"+a.account]
			if !ok || member.Status != "active" || member.Account != a.account || member.MerchantID != a.merchantID || !validMerchantRole(member.Role) || !roleAllows(member.Role, permission) {
				return merchantDenied("MERCHANT_MEMBERSHIP_REQUIRED", 403)
			}
			if a.role == "" {
				a.role = member.Role
			} else if member.Role != a.role {
				return merchantDenied("MERCHANT_MEMBERSHIP_CHANGED", 403)
			}
			if a.domainID != "" {
				carrier, ok := data.ConsoleSessions[a.domainID]
				if !ok || carrier.SessionBinding != a.binding || carrier.BrowserBindingDigest != a.browserBindingDigest || carrier.Account != a.account || carrier.MerchantID != a.merchantID || carrier.Role != member.Role || carrier.RevokedAt != nil || !now.Before(carrier.ExpiresAt) || !carrier.PrivateExpiresAt.Equal(a.expires) {
					return merchantDenied("MERCHANT_CARRIER_BINDING_MISMATCH", 401)
				}
				if a.domainToken != "" && !hmac.Equal([]byte(carrier.TokenHash), []byte(hashString(a.domainToken))) {
					return merchantDenied("MERCHANT_BOUND_CARRIER_REQUIRED", 401)
				}
			}
			return nil
		}, nil
	}, consume: func(data *Snapshot) error {
		if data.MerchantActions == nil {
			data.MerchantActions = map[string]MerchantActionRecord{}
		}
		key := a.binding + ":" + a.nonce
		if a.admitted.Load() {
			old, ok := data.MerchantActions[key]
			if !ok || old.Account != a.account || old.BodyDigest != a.digest || old.Path != a.path || old.Method != a.method || old.MerchantID != a.merchantID {
				return merchantDenied("MERCHANT_ACTION_BINDING_MISMATCH", 403)
			}
			return nil
		}
		if _, ok := data.MerchantActions[key]; ok {
			return merchantDenied("MERCHANT_ACTION_REPLAY", 409)
		}
		data.MerchantActions[key] = MerchantActionRecord{SessionBinding: a.binding, Nonce: a.nonce, BodyDigest: a.digest, Method: a.method, Path: a.path, Account: a.account, MerchantID: a.merchantID, ExpiresAt: a.expires}
		return nil
	}, afterCommit: func() { a.admitted.Store(true) }}
	child.pay = &merchantGuardedPay{original: s.pay, service: &child, base: s, admission: a}
	return &child
}
func (s *Service) completeCanonicalMerchantSession(a *merchantAdmission) (MerchantSessionResult, error) {
	var out MerchantSessionResult
	err := s.store.Update(func(data *Snapshot) error {
		merchant := data.Merchants[a.merchantID]
		member := data.MerchantMembers[a.merchantID+":"+a.account]
		now := s.now().UTC()
		var carrier MerchantConsoleSession
		for _, existing := range data.ConsoleSessions {
			if existing.SessionBinding == a.binding && existing.MerchantID == a.merchantID && existing.Account == a.account && (existing.BrowserBindingDigest != a.browserBindingDigest || existing.Role != member.Role || existing.RevokedAt != nil) {
				return merchantDenied("ORIGINAL_MERCHANT_ASSOCIATION_CHANGED", 401)
			}
			if existing.SessionBinding == a.binding && existing.BrowserBindingDigest == a.browserBindingDigest && existing.MerchantID == a.merchantID && existing.Account == a.account && existing.Role == member.Role && existing.RevokedAt == nil && now.Before(existing.ExpiresAt) && existing.PrivateExpiresAt.Equal(a.expires) {
				carrier = existing
				break
			}
		}
		token := ""
		if carrier.ID != "" {
			var err error
			token, err = s.open(carrier.TokenCipher)
			if err != nil {
				return merchantDenied("MERCHANT_CARRIER_RECOVERY_REQUIRED", 409)
			}
		} else {
			token = randomToken(32)
			expiry := now.Add(15 * time.Minute)
			if a.expires.Before(expiry) {
				expiry = a.expires
			}
			carrier = MerchantConsoleSession{ID: "mcs_" + randomToken(16), MerchantID: a.merchantID, Account: a.account, Role: member.Role, TokenHash: hashString(token), TokenCipher: s.seal(token), SessionBinding: a.binding, BrowserBindingDigest: a.browserBindingDigest, PrivateExpiresAt: a.expires, ExpiresAt: expiry, CreatedAt: now}
			data.ConsoleSessions[carrier.ID] = carrier
			appendAudit(data, a.merchantID, a.account, "merchant.session.create", carrier.ID, "committed", "role="+member.Role, now)
		}
		key := a.binding + ":" + a.nonce
		record := data.MerchantActions[key]
		record.SessionID = carrier.ID
		data.MerchantActions[key] = record
		out = MerchantSessionResult{SessionID: carrier.ID, Token: carrier.ID + "." + token, Merchant: publicMerchant(merchant), Account: a.account, Role: member.Role, ExpiresAt: carrier.ExpiresAt}
		return nil
	})
	return out, err
}
func (s *Service) recoveredMerchantSession(a *merchantAdmission) (MerchantSessionResult, error) {
	var out MerchantSessionResult
	err := s.store.View(func(data Snapshot) error {
		carrier := data.ConsoleSessions[a.domainID]
		token, err := s.open(carrier.TokenCipher)
		if err != nil {
			return merchantDenied("MERCHANT_CARRIER_RECOVERY_REQUIRED", 409)
		}
		out = MerchantSessionResult{SessionID: carrier.ID, Token: carrier.ID + "." + token, Merchant: publicMerchant(data.Merchants[a.merchantID]), Account: a.account, Role: carrier.Role, ExpiresAt: carrier.ExpiresAt}
		return nil
	})
	return out, err
}

// Buffer legacy handlers until final current authority/member readback.
type merchantPrivateResponse struct {
	overflow bool
	header   http.Header
	body     bytes.Buffer
	status   int
}

func (r *merchantPrivateResponse) Header() http.Header { return r.header }
func (r *merchantPrivateResponse) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}
func (r *merchantPrivateResponse) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = 200
	}
	if r.body.Len()+len(b) > 2<<20 {
		r.overflow = true
		return 0, errors.New("private response limit")
	}
	return r.body.Write(b)
}
