//go:build commerce_v2

package payproduct

import (
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"reflect"
	"slices"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// A supplies the EXISTING authenticated actor/current-generation fence, bound
// to this original private Session and original sealed Browser grant. No grant
// or sealed binding is accepted from caller JSON or disclosed to the browser.
type MerchantCombinedActorBinder func(*http.Request, v2.Session, v2.BrowserGrant, string) (func() error, error)
type MerchantCombinedConfig struct {
	Transport      http.RoundTripper
	BackendKeyID   string
	BackendKey     ed25519.PrivateKey
	BrowserSealKey []byte
	BindActor      MerchantCombinedActorBinder
}
type merchantRequestAuthority interface {
	captureMerchantRequest(*http.Request, v2.Session) (MerchantV2AuthorityReader, error)
}
type merchantCombinedTemplate struct {
	reader  *v2.Revalidator
	browser *v2.BrowserSSO
	actor   MerchantCombinedActorBinder
}
type merchantCombinedOriginal struct {
	reader   *v2.Revalidator
	browser  *v2.BrowserSSO
	binding  string
	grant    v2.BrowserGrant
	current  func() error
	original v2.Session
}

// This factory uses ACTUAL shared RevalidateBrowser. Its approved Browser policy
// must exist for pay-merchant; it cannot borrow AI/Mail or register a tuple.
// The exact641 BrowserSSO roster omits Merchant, so that input stays closed503.
// A owns the qualification successor, keys and Host. No permissive substitute.
func NewMerchantCombinedV2ServerWithLogger(service *Service, cfg MerchantCombinedConfig, build buildinfo.Info, logger *slog.Logger) (*Server, error) {
	if service == nil || service.store == nil {
		return NewMerchantV2ServerWithLogger(service, cfg.Transport, nil, build, logger)
	}
	if cfg.BindActor == nil || cfg.BackendKeyID == "" || len(cfg.BackendKey) != ed25519.PrivateKeySize || len(cfg.BrowserSealKey) < 32 {
		return NewMerchantV2ServerWithLogger(service, cfg.Transport, nil, build, logger)
	}
	browser, err := v2.NewBrowserSSO(MerchantProductID, "https://wallet-auth.ynxweb4.com", cfg.BrowserSealKey, []string{"merchant"}, cfg.Transport)
	if err != nil {
		return NewMerchantV2ServerWithLogger(service, cfg.Transport, nil, build, logger)
	}
	policy := v2.Policy{ProductID: MerchantProductID, ClientID: MerchantClientID, ApplicationID: MerchantBundleID + ".web", Platform: "web", Origin: "https://pay.ynxweb4.com", Callback: MerchantCallback, AllowedScopes: slices.Clone(merchantConsoleScopes)}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, cfg.Transport)
	if err != nil {
		return nil, err
	}
	reader, err := v2.NewPrivateBusinessRevalidator(client, MerchantClientID+"-business-web-v1", cfg.BackendKeyID, cfg.BackendKey)
	if err != nil {
		return nil, err
	}
	return NewMerchantV2ServerWithLogger(service, cfg.Transport, &merchantCombinedTemplate{reader, browser, cfg.BindActor}, build, logger)
}
func (t *merchantCombinedTemplate) ReadMerchantAuthority(context.Context, v2.Session, []string) (MerchantV2AuthoritySnapshot, error) {
	return MerchantV2AuthoritySnapshot{}, merchantDenied("ORIGINAL_BROWSER_CAPTURE_REQUIRED", 503)
}
func (t *merchantCombinedTemplate) captureMerchantRequest(r *http.Request, original v2.Session) (MerchantV2AuthorityReader, error) {
	if r == nil || r.Context().Err() != nil {
		return nil, merchantDenied("AUTHORITY_UNAVAILABLE", 503)
	}
	binding, grant, err := t.browser.Binding(r)
	if err != nil || grant.Identity.Account != original.Account {
		return nil, merchantDenied("ORIGINAL_BROWSER_BINDING_REQUIRED", 401)
	}
	if r.Method != "GET" {
		origin, csrf := r.Header.Values("Origin"), r.Header.Values("X-YNX-SSO-CSRF")
		if len(origin) != 1 || origin[0] != "https://pay.ynxweb4.com" || len(csrf) != 1 || len(grant.CSRF) < 32 || subtle.ConstantTimeCompare([]byte(csrf[0]), []byte(grant.CSRF)) != 1 {
			return nil, merchantDenied("MERCHANT_ORIGIN_CSRF_REQUIRED", 403)
		}
	}
	fence, err := t.actor(r, original, grant, binding)
	if err != nil {
		return nil, err
	}
	if fence == nil {
		return nil, merchantDenied("ORIGINAL_ACTOR_REQUIRED", 503)
	}
	grant.Scopes = slices.Clone(grant.Scopes)
	original.Scopes = slices.Clone(original.Scopes)
	return &merchantCombinedOriginal{t.reader, t.browser, binding, grant, fence, original}, nil
}
func (o *merchantCombinedOriginal) ReadMerchantAuthority(ctx context.Context, original v2.Session, scopes []string) (MerchantV2AuthoritySnapshot, error) {
	if ctx == nil || ctx.Err() != nil || !reflect.DeepEqual(original, o.original) || !slices.Equal(scopes, merchantConsoleScopes) {
		return MerchantV2AuthoritySnapshot{}, merchantDenied("ORIGINAL_AUTHORITY_BINDING_CHANGED", 503)
	}
	// ONE shared decision, full original Session + original sealed Browser binding.
	// No VerifyBinding/private Revalidate pair, proof replay, renewal or rebind.
	session, grant, err := o.reader.RevalidateBrowser(ctx, original, o.browser, o.binding, scopes)
	if err != nil {
		return MerchantV2AuthoritySnapshot{}, err
	}
	if ctx.Err() != nil || !reflect.DeepEqual(grant, o.grant) || !reflect.DeepEqual(session, o.original) {
		return MerchantV2AuthoritySnapshot{}, merchantDenied("ORIGINAL_AUTHORITY_BINDING_CHANGED", 503)
	}
	expires, err := time.Parse(time.RFC3339Nano, original.ExpiresAt)
	if err != nil {
		return MerchantV2AuthoritySnapshot{}, merchantDenied("SESSION_EXPIRED", 401)
	}
	if grant.ExpiresAt.Before(expires) {
		expires = grant.ExpiresAt
	}
	if grant.Identity.ExpiresAt.Before(expires) {
		expires = grant.Identity.ExpiresAt
	}
	return MerchantV2AuthoritySnapshot{Session: session, ValidUntil: expires, BrowserBindingDigest: hashCanonical(grant), Current: func() error {
		if ctx.Err() != nil {
			return merchantDenied("AUTHORITY_UNAVAILABLE", 503)
		}
		if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
			return merchantDenied("AUTHORITY_UNAVAILABLE", 503)
		}
		return o.current()
	}}, nil
}
