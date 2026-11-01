package productsessionv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// RegisteredClientSet selects only immutable server-configured tuples for one
// product. A claimed platform is routing input, never authority. Authorize still
// consumes the original one-shot introspection proof at the actual gateway.
// No tuple, scope, origin or backend role is inferred from an arbitrary caller.
type RegisteredClientSet struct {
	product string
	clients map[string]*Client
	readers map[string]*Revalidator
}

func NewRegisteredClientSet(product string, clients []*Client, readers []*Revalidator) (*RegisteredClientSet, error) {
	if product == "" || len(clients) == 0 || len(clients) > 6 || len(readers) != len(clients) {
		return nil, fail("INVALID_ROUTE_POLICY", 500)
	}
	set := &RegisteredClientSet{product: product, clients: map[string]*Client{}, readers: map[string]*Revalidator{}}
	for i, c := range clients {
		if c == nil || c.policy.ProductID != product || c.endpoint != "https://wallet-auth.ynxweb4.com" || readers[i] == nil || readers[i].client != c || !readers[i].business || set.clients[c.policy.Platform] != nil {
			return nil, fail("INVALID_ROUTE_POLICY", 500)
		}
		set.clients[c.policy.Platform] = c
		set.readers[c.policy.Platform] = readers[i]
	}
	return set, nil
}

func (s *RegisteredClientSet) selectFields(fields map[string]any) (*Client, error) {
	if s == nil {
		return nil, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	var selected *Client
	for platform, c := range s.clients {
		if claimed := text(fields, "platform"); claimed != "" && claimed != platform {
			continue
		}
		if text(fields, "productId") == s.product && c.matchesPolicy(fields) {
			if selected != nil {
				return nil, fail("CROSS_PRODUCT_SESSION", 403)
			}
			selected = c
		}
	}
	if selected == nil {
		return nil, fail("CROSS_PRODUCT_SESSION", 403)
	}
	return selected, nil
}

func (s *RegisteredClientSet) Authorize(ctx context.Context, r *http.Request, scopes []string) (Session, error) {
	if r == nil {
		return Session{}, fail("INVALID_ROUTE_POLICY", 500)
	}
	h := r.Header.Values(ProofHeader)
	if len(h) != 1 || len(h[0]) == 0 || len(h[0]) > 16384 {
		return Session{}, fail("PROOF_REQUIRED", 401)
	}
	raw, e := base64.RawURLEncoding.Strict().DecodeString(h[0])
	if e != nil || base64.RawURLEncoding.EncodeToString(raw) != h[0] {
		return Session{}, fail("INVALID_PROOF", 401)
	}
	fields, e := canonicalObject(raw)
	if e != nil || !exactKeys(fields, proofFields) {
		return Session{}, fail("INVALID_PROOF", 401)
	}
	c, e := s.selectFields(fields)
	if e != nil {
		return Session{}, e
	}
	return c.Authorize(ctx, r, scopes)
}

func (s *RegisteredClientSet) clientForSession(session Session) (*Client, error) {
	raw, e := json.Marshal(session)
	if e != nil {
		return nil, fail("INVALID_SESSION", 403)
	}
	var fields map[string]any
	e = json.Unmarshal(raw, &fields)
	if e != nil || !validSessionFields(fields) {
		return nil, fail("INVALID_SESSION", 403)
	}
	return s.selectFields(fields)
}

// VerifyHTTPAction preserves the raw wire body and exact route. It does NOT
// consume the business nonce. Products consume SessionBinding+Nonce in the SAME
// transaction as current actor/object/role checks and their resulting effect.
func (s *RegisteredClientSet) VerifyHTTPAction(header string, session Session, method, path string, body []byte, scopes []string, now time.Time) (ActionAuthorization, error) {
	c, e := s.clientForSession(session)
	if e != nil {
		return ActionAuthorization{}, e
	}
	return c.VerifyHTTPAction(header, session, method, path, body, scopes, now)
}
func (s *RegisteredClientSet) VerifyHTTPActionStream(ctx context.Context, header string, session Session, method, path string, body io.Reader, maxBytes int64, scopes []string, now time.Time) (ActionAuthorization, error) {
	c, e := s.clientForSession(session)
	if e != nil {
		return ActionAuthorization{}, e
	}
	return c.VerifyHTTPActionStream(ctx, header, session, method, path, body, maxBytes, scopes, now)
}

// Revalidate performs a confidential fresh read of the SAME original session,
// using its separately registered platform backend role, not another browser's
// family. It does not replay Authorize's consumed proof, renew consent, validate
// Central browser identity, or replace the product's live actor/object checks.
func (s *RegisteredClientSet) Revalidate(ctx context.Context, session Session, scopes []string) (Session, error) {
	c, e := s.clientForSession(session)
	if e != nil {
		return Session{}, e
	}
	return s.readers[c.policy.Platform].Revalidate(ctx, session, scopes)
}

// RevalidateBrowser retains the original registered platform and sealed browser
// association. It never selects an identity policy from a caller-supplied tuple.
func (s *RegisteredClientSet) RevalidateBrowser(ctx context.Context, original Session, browser *BrowserSSO, sealedBinding string, fixedRouteScopes []string) (Session, BrowserGrant, error) {
	c, err := s.clientForSession(original)
	if err != nil {
		return Session{}, BrowserGrant{}, err
	}
	return s.readers[c.policy.Platform].RevalidateBrowser(ctx, original, browser, sealedBinding, fixedRouteScopes)
}
