package commerce

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type businessRoutePolicy struct {
	mode   string
	scopes map[string][]string
}

// Configured only by the shared-verifier adapter. There is no HTTP endpoint
// that creates this authority and no conversion from a legacy bearer token.
type businessVerifier interface {
	verify(*http.Request, []byte, businessRoutePolicy) (*verifiedBusinessRequest, error)
}
type verifiedBusinessRequest struct {
	walletAccount string
	principal     Principal
	proof         businessActionAuthorization
	revalidate    func(context.Context) error
	fence         func() error
}
type businessRequestContextKey struct{}

func (v *verifiedBusinessRequest) current(ctx context.Context) error {
	if v == nil || v.fence == nil || ctx == nil || ctx.Err() != nil || !v.principal.ExpiresAt.After(time.Now()) {
		return ErrUnauthorized
	}
	return v.fence()
}

type businessHTTPError struct {
	code   string
	status int
}

func (e *businessHTTPError) Error() string { return e.code }
func failBusiness(w http.ResponseWriter, err error) {
	var e *businessHTTPError
	if errors.As(err, &e) {
		write(w, e.status, map[string]string{"error": e.code, "code": e.code})
		return
	}
	fail(w, status(err), err)
}

type bufferedBusinessResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *bufferedBusinessResponse) Header() http.Header { return w.header }
func (w *bufferedBusinessResponse) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
}
func (w *bufferedBusinessResponse) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.body.Write(data)
}
func (w *bufferedBusinessResponse) publish(out http.ResponseWriter) {
	for k, values := range w.header {
		out.Header()[k] = append([]string(nil), values...)
	}
	code := w.status
	if code == 0 {
		code = 200
	}
	out.WriteHeader(code)
	_, _ = out.Write(w.body.Bytes())
}

type rejectedBusinessResponse struct{}

func (rejectedBusinessResponse) Error() string { return "business handler rejected request" }

func (s *Server) handleFunc(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.businessV2 == nil {
			handler(w, r)
			return
		}
		policy, exists := commerceBusinessRoutes[pattern]
		if !exists {
			failBusiness(w, &businessHTTPError{"BUSINESS_ROUTE_POLICY_REQUIRED", 503})
			return
		}
		if policy.mode == "public" {
			handler(w, r)
			return
		}
		if policy.mode == "retired" {
			failBusiness(w, &businessHTTPError{"LEGACY_AUTH_RETIRED", 410})
			return
		}
		if r.Method == http.MethodHead || r.URL.RawPath != "" || r.URL.EscapedPath() != r.URL.Path {
			failBusiness(w, &businessHTTPError{"EXACT_BUSINESS_PATH_REQUIRED", 403})
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			failBusiness(w, &businessHTTPError{"INVALID_ACTION_BODY", 413})
			return
		}
		if r.Method == http.MethodGet && len(body) != 0 {
			failBusiness(w, &businessHTTPError{"INVALID_ACTION_BODY", 403})
			return
		}
		verified, err := s.cfg.businessV2.verify(r, body, policy)
		if err != nil {
			failBusiness(w, err)
			return
		}
		if verified == nil || verified.revalidate == nil || verified.fence == nil || verified.proof.SessionBinding != verified.principal.SessionBinding {
			failBusiness(w, ErrUnauthorized)
			return
		}
		if _, ok := policy.scopes[verified.principal.Role]; !ok {
			failBusiness(w, ErrUnauthorized)
			return
		}
		expected := ShopScopes
		if verified.principal.Role == "seller" {
			expected = SellerScopes
		}
		if !exactScopes(verified.principal.Scopes, expected) {
			failBusiness(w, ErrUnauthorized)
			return
		}
		if err := verified.revalidate(r.Context()); err != nil {
			failBusiness(w, err)
			return
		}
		if err := verified.current(r.Context()); err != nil {
			failBusiness(w, err)
			return
		}
		if policy.mode != "local" {
			// External side effects/streams need their durable admission and
			// post-await checks before this v2 service can execute them.
			s.serveBusinessExternal(w, r, pattern, body, verified)
			return
		}
		capture := &bufferedBusinessResponse{header: make(http.Header)}
		ctx := context.WithValue(r.Context(), businessRequestContextKey{}, verified)
		err = s.store.withBusinessAction(ctx, verified.proof, func() error { return verified.current(ctx) }, func(tx *Store) error {
			cfg := s.cfg
			cfg.businessV2 = nil
			staged := NewServer(tx, cfg)
			bound := *verified
			if verified.walletAccount != "" {
				actor, err := tx.resolveBusinessActor(verified.walletAccount)
				if err != nil {
					return err
				}
				bound.principal.Account = actor
			}
			request := r.Clone(context.WithValue(ctx, businessRequestContextKey{}, &bound))
			request.Body = io.NopCloser(bytes.NewReader(body))
			staged.mux.ServeHTTP(capture, request)
			if capture.status >= 400 {
				return rejectedBusinessResponse{}
			}
			return nil
		})
		if err != nil {
			var rejected rejectedBusinessResponse
			if errors.As(err, &rejected) {
				capture.publish(w)
			} else {
				failBusiness(w, err)
			}
			return
		}
		capture.publish(w)
	})
}

// Every registered private route remains explicit even while its external
// admission is unfinished. An unknown route cannot fall back to legacy auth.
func validateCommerceBusinessRoutes() error {
	for pattern, policy := range commerceBusinessRoutes {
		if policy.mode != "public" && policy.mode != "retired" && len(policy.scopes) == 0 {
			return fmt.Errorf("missing scopes for %s", pattern)
		}
	}
	return nil
}
