//go:build commerce_v2

package commerce

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
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
	consumers []commerceV2Consumer
	bind      CommerceV2ActorBinder
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
	original, err := consumer.client.Authorize(r.Context(), r, scopes)
	if err != nil {
		return nil, commerceV2Error(err)
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
	fence, err := g.bind(r.Context(), original)
	if err != nil {
		return nil, err
	}
	if fence == nil {
		return nil, ErrUnauthorized
	}
	return &verifiedBusinessRequest{walletAccount: original.Account, principal: Principal{Account: canonicalAccount, Role: role, ProductClientID: original.ClientID, BundleID: ShopBundleID, SessionBinding: original.SessionBinding, Scopes: slices.Clone(original.Scopes), ExpiresAt: expires}, proof: businessActionAuthorization{action.SessionBinding, action.Nonce, action.ExpiresAt}, fence: fence, revalidate: func(ctx context.Context) error {
		_, err := consumer.live.Revalidate(ctx, original, scopes)
		return commerceV2Error(err)
	}}, nil
}
