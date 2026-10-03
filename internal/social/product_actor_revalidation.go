package social

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Root supplies the registered, confidential same-session reader explicitly.
// A registered authority may implement both exact interfaces; old authorizers
// and the separate legacy Matrix reader are not silently promoted to it.
func (s *Server) productActorRevalidation(r *http.Request, original productsessionv2.Session, binding productSessionBinding) func(string) error {
	reader := s.service.cfg.ProductSessionRevalidator
	if reader == nil {
		reader, _ = s.service.cfg.ProductSessionAuthority.(MatrixAudienceSessionRevalidator)
	}
	combined := s.service.cfg.ProductBrowserSessionRevalidator
	if combined == nil {
		combined, _ = s.service.cfg.ProductSessionAuthority.(ProductBrowserSessionRevalidator)
	}
	if reader == nil && combined == nil {
		return nil
	}
	frozen, freezeErr := json.Marshal(original)
	return func(scope string) error {
		// Separate private-session and browser-family reads are not an atomic
		// current authorization. The original joint producer must supply that
		// contract before this web business path can claim current authority.
		if original.Platform == "web" && combined == nil {
			return &productsessionv2.Error{Status: http.StatusServiceUnavailable, Code: "SOCIAL_JOINT_CURRENT_AUTHORITY_REQUIRED"}
		}
		if freezeErr != nil {
			return ErrUnauthorized
		}
		if err := r.Context().Err(); err != nil {
			return err
		}
		var expected productsessionv2.Session
		if json.Unmarshal(frozen, &expected) != nil || !allowedScopes[scope] || !contains(expected.Scopes, scope) {
			return ErrUnauthorized
		}
		expires, err := time.Parse(time.RFC3339Nano, expected.ExpiresAt)
		if err != nil || !expires.After(s.service.cfg.Now()) {
			return ErrUnauthorized
		}
		// Each invocation receives a deep copy of the complete original Session.
		// Never replay Authorize or let a reader mutate the frozen authority.
		var input productsessionv2.Session
		if json.Unmarshal(frozen, &input) != nil {
			return ErrUnauthorized
		}
		var current productsessionv2.Session
		if expected.Platform == "web" {
			current, err = s.revalidateProductBrowser(r, input, binding, scope, combined)
		} else if reader != nil {
			current, err = reader.Revalidate(r.Context(), input, []string{scope})
		} else {
			return &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
		}
		if contextErr := r.Context().Err(); contextErr != nil {
			return contextErr
		}
		if err != nil {
			return err
		}
		if objectDigest(current) != objectDigest(expected) || !expires.After(s.service.cfg.Now()) {
			return ErrUnauthorized
		}
		return nil
	}
}

// Caller owns the mutex only after success. Canonical revalidation is always
// outside the mutex; do not queue a fresh remote decision behind another writer.
// A busy caller retains its original intent and must retry explicitly with a
// new request proof, not repeat an external effect automatically.
func (s *Service) lockAfterProductRevalidation(actor Session, scope string) error {
	if actor.revalidateProduct == nil {
		// Existing legacy behavior is preserved, not declared canonical-ready.
		s.mu.Lock()
		return nil
	}
	if err := actor.revalidateProduct(scope); err != nil {
		return err
	}
	if !s.mu.TryLock() {
		return ErrConflict
	}
	if err := s.requireCurrentProductActorLocked(actor, scope); err != nil {
		s.mu.Unlock()
		return err
	}
	if actor.validateProductBindingLocked != nil {
		if err := actor.validateProductBindingLocked(); err != nil {
			s.mu.Unlock()
			return err
		}
	}
	return nil
}
