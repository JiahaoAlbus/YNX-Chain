package commerce

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// Select only the existing V4 header family. Schema, PQ signatures, originals,
// history and durable nonce verification belong to the original Auth supplier.
// A V4 attempt never falls through to the legacy introspection verifier.
func originalShopV4Request(r *http.Request) (bool, error) {
	if r == nil {
		return false, ErrUnauthorized
	}
	v4, v2 := 0, false
	for name, values := range r.Header {
		if strings.EqualFold(name, "x-ynx-product-session-proof-v4") {
			v4++
			if len(values) != 1 || values[0] == "" {
				return true, ErrUnauthorized
			}
		}
		v2 = v2 || strings.EqualFold(name, "x-ynx-product-session-proof-v2")
	}
	if v4 > 1 || v4 != 0 && v2 {
		return true, ErrUnauthorized
	}
	return v4 != 0, nil
}

func (s *Store) captureOriginalShopSessionForSourceRead(ctx context.Context, r *http.Request, scope originalShopInvoiceReadScope, held originalShopInvoiceReadHold) (*OriginalShopSession, error) {
	v4, err := originalShopV4Request(r)
	if err != nil {
		return nil, err
	}
	if !v4 {
		return s.captureOriginalShopSessionForRead(ctx, r, scope)
	}
	// Only the normal concrete Auth-backed Source loan can reach the opaque V4
	// constructor. PUBLIC profile DATA and arbitrary permission callbacks cannot.
	h, ok := held.(*originalShopProductReadHold)
	if !ok || h == nil {
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	v, err := h.verifyOriginalShopSessionV4(ctx)
	if err != nil {
		return nil, err
	}
	return s.captureVerifiedOriginalShopSession(ctx, scope, v)
}

func (h *originalShopProductReadHold) verifyOriginalShopSessionV4(ctx context.Context) (*verifiedBusinessRequest, error) {
	if err := h.current(ctx); err != nil {
		return nil, err
	}
	p, ok := h.permission.(*originalAuthShopProductPermission)
	if !ok || p == nil || p.owner == nil {
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	// The original Source Hold owns every nonnull partial and drains it when
	// closed, even when verification fails before an OriginalShopSession exists.
	owner, err := p.owner.VerifyOriginalShopGET(ctx)
	if err != nil {
		return nil, err
	}
	if owner == nil {
		return nil, ErrUnauthorized
	}
	data, err := owner.DATA(ctx)
	if err != nil {
		return nil, err
	}
	account, err := accountaddress.Normalize(data.Account)
	if err != nil || data.Role != h.selected.role || !sameBusinessAccount(data.Account, h.selected.actor) || !validSessionDigest(data.SessionDigest) || data.SessionBinding == "" {
		return nil, ErrUnauthorized
	}
	scopes := ShopScopes
	if data.Role == "seller" {
		scopes = SellerScopes
	} else if data.Role != "buyer" {
		return nil, ErrUnauthorized
	}
	if !exactScopes(data.Scopes, scopes) {
		return nil, ErrUnauthorized
	}
	expires := data.SessionExpiresAt
	if data.IssuerExpiresAt.Before(expires) {
		expires = data.IssuerExpiresAt
	}
	if !time.Now().Before(expires) || !time.Now().Before(data.ProofLoanUntil) || data.ProofLoanUntil.After(expires) {
		return nil, ErrUnauthorized
	}
	original := ctx
	return &verifiedBusinessRequest{
		shopSessionIssuer:       &verifiedShopSessionIssuer{effectDigest("original-auth-product-session-v4", data.SessionDigest)},
		shopSessionCaptureUntil: data.ProofLoanUntil,
		walletAccount:           data.Account,
		principal: Principal{Account: account, Role: data.Role, SessionBinding: data.SessionBinding,
			Scopes: slices.Clone(data.Scopes), ExpiresAt: expires.UTC()},
		// This private read has no Shop effect/action nonce. The original Auth
		// ledger already consumed the exact V4 HTTP proof once.
		proof: businessActionAuthorization{SessionBinding: data.SessionBinding},
		fence: func() error { return owner.CurrentLocal(original) },
		revalidate: func(call context.Context) error {
			if call == nil || call.Err() != nil {
				return ErrUnauthorized
			}
			// Auth requires its SAME original context. A derived Store operation
			// may cancel only this child, never replace the context or close parent.
			stop := context.AfterFunc(call, func() { _ = owner.Close() })
			defer stop()
			if err := owner.Current(original); err != nil {
				return err
			}
			return call.Err()
		},
	}, nil
}
