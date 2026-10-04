//go:build commerce_v2

package commerce

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"slices"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// A supplies a real current central actor/account/device generation binding.
// The returned fence must be synchronous, safe under the Store lock and must
// reject replacement/logout. A private session alone is not this actor guard.
type CommerceV2ActorBinder func(context.Context, v2.Session) (func() error, error)

type commerceV2Consumer struct {
	policy v2.Policy
	client *v2.Client
	live   *v2.Revalidator
}
type commerceV2Verifier struct {
	consumers     []commerceV2Consumer
	bind          CommerceV2ActorBinder
	browser       *v2.BrowserSSO
	bindBrowser   CommerceBrowserActorBinder
	currentPolicy func(context.Context, string) error
}

// This source must compose with A's reviewed shared package using commerce_v2.
// No production key is generated, loaded or registered by the product owner.
// Seller is a capability of Shop; its original two scopes need A's registry
// successor. Registering the allowed union does not grant it to any account.
func NewCommerceV2Server(store *Store, cfg ServerConfig, platforms []string, backendKeyID string, backendKey ed25519.PrivateKey, transport http.RoundTripper, bind CommerceV2ActorBinder) (*Server, error) {
	if store == nil || len(platforms) == 0 || bind == nil {
		return nil, errors.New("complete Commerce v2 composition required")
	}
	if err := validateCommerceBusinessRoutes(); err != nil {
		return nil, err
	}
	verifier := &commerceV2Verifier{bind: bind}
	seen := map[string]bool{}
	for _, platform := range platforms {
		if seen[platform] || !slices.Contains([]string{"web", "android", "macos"}, platform) {
			return nil, errors.New("unsupported or duplicate Commerce platform")
		}
		seen[platform] = true
		p := v2.Policy{ProductID: "shop", ClientID: ShopClientID, ApplicationID: ShopBundleID, Platform: platform, Origin: "app://" + platform + "/" + ShopBundleID, Callback: ShopCallback, AllowedScopes: []string{"account:read", "shop:orders:write", "shop:profile:write", "shop:seller:operate"}}
		if platform == "web" {
			p.ApplicationID += ".web"
			p.Origin = "https://shop.ynxweb4.com"
			p.Callback = p.Origin + "/wallet-auth/callback"
		} else if platform == "android" {
			value := ShopBundleID
			p.PackageID = &value
		} else {
			value := ShopBundleID
			p.BundleID = &value
		}
		client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", p, transport)
		if err != nil {
			return nil, err
		}
		live, err := v2.NewBusinessRevalidator(client, ShopClientID+"-sso-v1", backendKeyID, backendKey)
		if err != nil {
			return nil, err
		}
		verifier.consumers = append(verifier.consumers, commerceV2Consumer{p, client, live})
	}
	cfg.businessV2 = verifier
	return NewServer(store, cfg), nil
}

func commerceV2Error(err error) error {
	var shared *v2.Error
	if errors.As(err, &shared) {
		return &businessHTTPError{shared.Code, shared.Status}
	}
	return err
}

func (g *commerceV2Verifier) verify(r *http.Request, body []byte, route businessRoutePolicy) (*verifiedBusinessRequest, error) {
	values := r.Header.Values(v2.ProofHeader)
	if len(values) != 1 || len(values[0]) > 16384 {
		return nil, &businessHTTPError{"PROOF_REQUIRED", 401}
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(values[0])
	if err != nil {
		return nil, &businessHTTPError{"INVALID_PROOF", 401}
	}
	var hint struct {
		ProductID     string `json:"productId"`
		ClientID      string `json:"clientId"`
		ApplicationID string `json:"applicationId"`
		Origin        string `json:"origin"`
		Callback      string `json:"callback"`
		BodyDigest    string `json:"bodyDigest"`
	}
	if json.Unmarshal(raw, &hint) != nil {
		return nil, &businessHTTPError{"INVALID_PROOF", 401}
	}
	var consumer *commerceV2Consumer
	for i := range g.consumers {
		c := &g.consumers[i]
		p := c.policy
		if hint.ProductID == p.ProductID && hint.ClientID == p.ClientID && hint.ApplicationID == p.ApplicationID && hint.Origin == p.Origin && hint.Callback == p.Callback {
			consumer = c
			break
		}
	}
	if consumer == nil {
		return nil, &businessHTTPError{"CROSS_PRODUCT_SESSION", 403}
	}
	// A hint can select only among router-fixed commitments. Shared Authorize
	// still verifies canonical proof, exact policy, signature and live authority.
	browserForConsumer := consumer.policy.Platform == "web" && g.browser != nil
	assertConsumerCurrent := func(ctx context.Context) error {
		if g.currentPolicy == nil {
			return ctx.Err()
		}
		return g.currentPolicy(ctx, consumer.policy.Platform)
	}
	if err := assertConsumerCurrent(r.Context()); err != nil {
		return nil, err
	}
	role := ""
	var scopes []string
	for candidate, required := range route.scopes {
		wire, _ := json.Marshal(struct {
			RequiredScopes []string `json:"requiredScopes"`
		}{required})
		digest := sha256.Sum256(wire)
		if hint.BodyDigest == hex.EncodeToString(digest[:]) {
			if role != "" {
				return nil, &businessHTTPError{"AMBIGUOUS_CAPABILITY", 403}
			}
			role = candidate
			scopes = slices.Clone(required)
		}
	}
	if role == "" {
		return nil, &businessHTTPError{"INTROSPECTION_BINDING_MISMATCH", 403}
	}
	var sealedBinding string
	var browserGrant v2.BrowserGrant
	if browserForConsumer {
		var err error
		sealedBinding, browserGrant, err = g.browser.Binding(r)
		if err != nil {
			return nil, &businessHTTPError{"ORIGINAL_BROWSER_REQUIRED", 401}
		}
		if r.Method != "GET" {
			origins, csrf := r.Header.Values("Origin"), r.Header.Values("X-YNX-SSO-CSRF")
			if len(origins) != 1 || origins[0] != "https://shop.ynxweb4.com" || len(csrf) != 1 || len(browserGrant.CSRF) < 32 || subtle.ConstantTimeCompare([]byte(csrf[0]), []byte(browserGrant.CSRF)) != 1 {
				return nil, &businessHTTPError{"ORIGIN_CSRF_REQUIRED", 403}
			}
		}
	}
	original, err := consumer.client.Authorize(r.Context(), r, scopes)
	if err != nil {
		return nil, commerceV2Error(err)
	}
	if err := assertConsumerCurrent(r.Context()); err != nil {
		return nil, err
	}
	expected := ShopScopes
	if role == "seller" {
		expected = SellerScopes
	}
	canonicalAccount, addressError := accountaddress.Normalize(original.Account)
	if addressError != nil || !exactScopes(original.Scopes, expected) {
		return nil, &businessHTTPError{"CAPABILITY_BINDING_MISMATCH", 403}
	}
	actions := r.Header.Values(v2.ActionProofHeader)
	if len(actions) != 1 {
		return nil, &businessHTTPError{"ACTION_PROOF_REQUIRED", 403}
	}
	action, err := consumer.client.VerifyHTTPAction(actions[0], original, r.Method, r.URL.Path, body, scopes, time.Now())
	if err != nil {
		return nil, commerceV2Error(err)
	}
	expires, err := time.Parse(time.RFC3339Nano, original.ExpiresAt)
	if err != nil {
		return nil, ErrUnauthorized
	}
	var fence func() error
	if browserForConsumer {
		if browserGrant.Identity.Account != original.Account || g.bindBrowser == nil {
			return nil, ErrUnauthorized
		}
		fence, err = g.bindBrowser(r, original, browserGrant, sealedBinding)
	} else {
		fence, err = g.bind(r.Context(), original)
	}
	if err != nil {
		return nil, err
	}
	if fence == nil {
		return nil, ErrUnauthorized
	}
	browserDigest := ""
	if browserForConsumer {
		raw, _ := json.Marshal(browserGrant)
		digest := sha256.Sum256(raw)
		browserDigest = hex.EncodeToString(digest[:])
	}
	validUntil := expires
	if browserForConsumer {
		if browserGrant.ExpiresAt.Before(validUntil) {
			validUntil = browserGrant.ExpiresAt
		}
		if browserGrant.Identity.ExpiresAt.Before(validUntil) {
			validUntil = browserGrant.Identity.ExpiresAt
		}
	}
	originalFence := fence
	fence = func() error {
		if !time.Now().Before(validUntil) {
			return ErrUnauthorized
		}
		return originalFence()
	}
	return &verifiedBusinessRequest{browserBindingDigest: browserDigest, walletAccount: original.Account, principal: Principal{Account: canonicalAccount, Role: role, ProductClientID: original.ClientID, BundleID: ShopBundleID, SessionBinding: original.SessionBinding, Scopes: slices.Clone(original.Scopes), ExpiresAt: expires}, proof: businessActionAuthorization{action.SessionBinding, action.Nonce, action.ExpiresAt}, fence: fence, revalidate: func(ctx context.Context) error {
		if err := assertConsumerCurrent(ctx); err != nil {
			return err
		}
		if browserForConsumer {
			verified, grant, err := consumer.live.RevalidateBrowser(ctx, original, g.browser, sealedBinding, scopes)
			if err != nil {
				return commerceV2Error(err)
			}
			if !reflect.DeepEqual(verified, original) || !reflect.DeepEqual(grant, browserGrant) {
				return ErrUnauthorized
			}
			return assertConsumerCurrent(ctx)
		}
		_, err := consumer.live.Revalidate(ctx, original, scopes)
		if err != nil {
			return commerceV2Error(err)
		}
		return assertConsumerCurrent(ctx)
	}}, nil
}
