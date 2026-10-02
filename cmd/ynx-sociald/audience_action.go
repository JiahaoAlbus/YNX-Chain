package main

import (
	"context"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/social"
)

// Stateless shared proof verification only. Social retains its original
// BrowserSSO/generation checks and durable actor/intent/policy/nonce ledger.
type socialAudienceActionVerifier struct{ now func() time.Time }

var _ social.MatrixAudienceActionVerifier = socialAudienceActionVerifier{}

func (v socialAudienceActionVerifier) VerifyHTTPAction(ctx context.Context, r *http.Request, session productsessionv2.Session, body []byte, scopes []string) (social.MatrixAudienceActionReceipt, error) {
	var zero social.MatrixAudienceActionReceipt
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if r == nil || r.URL == nil {
		return zero, &productsessionv2.Error{Code: "INVALID_ROUTE_POLICY", Status: http.StatusInternalServerError}
	}
	required := map[string]bool{"social.contacts": true, "social.feed": true, "social.messaging": true, "social.profile": true}
	if len(scopes) != len(required) {
		return zero, &productsessionv2.Error{Code: "INVALID_ROUTE_POLICY", Status: http.StatusInternalServerError}
	}
	for _, scope := range scopes {
		if !required[scope] {
			return zero, &productsessionv2.Error{Code: "INVALID_ROUTE_POLICY", Status: http.StatusInternalServerError}
		}
		delete(required, scope)
	}
	values := r.Header.Values(productsessionv2.ActionProofHeader)
	if len(values) != 1 {
		return zero, &productsessionv2.Error{Code: "INVALID_PROOF", Status: http.StatusForbidden}
	}
	now := time.Now().UTC()
	if v.now != nil {
		now = v.now().UTC()
	}
	verified, err := productsessionv2.VerifySocialAudienceProof(values[0], session, r.Method, r.URL.Path, body, now)
	if err != nil {
		return zero, err
	}
	return socialActionReceipt(verified), nil
}

func socialActionReceipt(verified productsessionv2.ActionAuthorization) social.MatrixAudienceActionReceipt {
	return social.MatrixAudienceActionReceipt{Nonce: verified.Nonce, BodyDigest: verified.BodyDigest, SessionBinding: verified.SessionBinding, ExpiresAt: verified.ExpiresAt}
}
