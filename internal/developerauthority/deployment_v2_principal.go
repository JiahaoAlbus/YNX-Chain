package developerauthority

import (
	"context"
	"net/http"
	"time"
)

// Reborrow only a previously authenticated SAME request object. No body is
// ignored during first authentication; no new request/clone can reuse a proof.
func (o *OriginalDeveloperHTTPAuthority) borrowOriginalRequestPrincipal(ctx context.Context, r *http.Request) (Principal, bool, error) {
	if o == nil || ctx == nil || ctx.Err() != nil || r == nil {
		return Principal{}, false, ErrDenied
	}
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return Principal{}, false, ErrDenied
	}
	var held *originalHTTPPrincipalRecord
	for _, v := range o.records {
		if v.originalRequest == r {
			if held != nil {
				o.mu.Unlock()
				return Principal{}, true, ErrDenied
			}
			held = v
		}
	}
	if held == nil {
		o.mu.Unlock()
		return Principal{}, false, nil
	}
	in := held.input
	phase := held.phase
	p := held.principal
	expiry := held.expires
	o.mu.Unlock()
	id, iok := originalSingleHeader(r.Header, "x-request-id")
	proof, pok := originalSingleHeader(r.Header, originalHTTPProofHeader)
	if phase != "verified" || r.URL == nil || r.URL.RawQuery != "" || r.URL.Fragment != "" || r.URL.Opaque != "" || r.Method != in.Method || r.URL.EscapedPath() != in.Path || !iok || id != in.RequestID || !pok || proof != in.ProofHeader || time.Now().UnixMilli() >= expiry {
		return Principal{}, true, ErrDenied
	}
	if e := o.AssertPrincipalCurrent(ctx, p); e != nil {
		return Principal{}, true, e
	}
	if ctx.Err() != nil || time.Now().UnixMilli() >= min(expiry, p.ExpiresMS) {
		return Principal{}, true, ErrDenied
	}
	return p, true, nil
}
func (o *OriginalIDEPublicationSourceOwner) borrowOriginalDeploymentV2Principal(ctx context.Context, r *http.Request) (Principal, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return Principal{}, e
	}
	if originalBinaryV5Request(r) {
		return o.principal.currentOriginalBinaryPrincipalV5(ctx, r)
	}
	p, found, e := o.principal.borrowOriginalRequestPrincipal(ctx, r)
	if !found {
		return Principal{}, ErrDeploymentV2OriginalRequestUnavailable
	}
	return p, e
}
